from __future__ import annotations

import base64
import hashlib
import secrets
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...cache_assets import favicon_cache_dir
from ...db import get_db
from ...dependencies import get_current_user
from ...models import Entry, Feed, Folder, User, UserEntryState
from ...services import ConfigStore, FeedService, FolderService

router = APIRouter()

FEVER_API_VERSION = 3
ITEM_LIMIT = 50
LINK_LIMIT = 50
DEFAULT_LINK_RANGE_DAYS = 7
RECENTLY_READ_WINDOW_SECONDS = 24 * 60 * 60

READ_ACTION_PRIORITY = [
    "groups",
    "feeds",
    "favicons",
    "items",
    "links",
    "unread_item_ids",
    "saved_item_ids",
]


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


def _parse_positive_ids(raw: Any) -> list[int]:
    if raw is None:
        return []
    values: list[int] = []
    for token in str(raw).split(","):
        parsed = _to_int(token)
        if parsed is not None and parsed > 0:
            values.append(parsed)
    return values


def _parse_signed_ids(raw: Any) -> list[int]:
    if raw is None:
        return []
    values: list[int] = []
    for token in str(raw).split(","):
        parsed = _to_int(token)
        if parsed is not None:
            values.append(parsed)
    return values


def _normalize_username(user: User) -> str:
    username = ConfigStore.get(user, "fever_username", user.email)
    if not username:
        return user.email
    return str(username)


def _md5_api_key(username: str, app_password: str) -> str:
    return hashlib.md5(f"{username}:{app_password}".encode("utf-8")).hexdigest()


def _ensure_credentials(
    db: Session,
    user: User,
    *,
    rotate_password: bool = False,
) -> tuple[str, str, str]:
    username = _normalize_username(user)
    app_password = ConfigStore.get(user, "fever_app_password")
    changed = False
    if rotate_password or not app_password:
        app_password = secrets.token_hex(16)
        ConfigStore.set(user, "fever_app_password", app_password)
        changed = True
    if ConfigStore.get(user, "fever_username") != username:
        ConfigStore.set(user, "fever_username", username)
        changed = True
    if changed:
        db.commit()
    return username, str(app_password), _md5_api_key(username, str(app_password))


def _verify_api_key(db: Session, raw_key: str | None) -> User | None:
    if not raw_key:
        return None
    api_key = str(raw_key).strip().lower()
    if not api_key:
        return None
    users = db.query(User).all()
    for user in users:
        _, _, expected = _ensure_credentials(db, user)
        if expected == api_key:
            return user
    return None


def _last_refreshed_on_time(db: Session, user: User) -> int:
    last_refreshed = db.query(func.max(Feed.last_fetch_at)).filter(Feed.user_id == user.id).scalar()
    return int(last_refreshed or 0)


def _base_response(db: Session, user: User | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "api_version": FEVER_API_VERSION,
        "auth": 1 if user else 0,
    }
    if user:
        payload["last_refreshed_on_time"] = _last_refreshed_on_time(db, user)
    return payload


def _append_xml(parent: ET.Element, key: str, value: Any) -> None:
    if isinstance(value, dict):
        child = ET.SubElement(parent, key)
        for nested_key, nested_value in value.items():
            _append_xml(child, nested_key, nested_value)
        return
    if isinstance(value, list):
        child = ET.SubElement(parent, key)
        item_name = key[:-1] if key.endswith("s") and len(key) > 1 else "item"
        for item in value:
            item_el = ET.SubElement(child, item_name)
            if isinstance(item, dict):
                for nested_key, nested_value in item.items():
                    _append_xml(item_el, nested_key, nested_value)
            else:
                item_el.text = "" if item is None else str(item)
        return
    child = ET.SubElement(parent, key)
    child.text = "" if value is None else str(value)


def _payload_response(payload: dict[str, Any], xml_mode: bool) -> dict[str, Any] | Response:
    if not xml_mode:
        return payload
    root = ET.Element("response")
    for key, value in payload.items():
        _append_xml(root, key, value)
    xml_data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return Response(content=xml_data, media_type="application/xml")


def _settings_payload(
    request: Request,
    username: str,
    app_password: str,
    api_key: str,
) -> dict[str, Any]:
    endpoint_path = "/plugins/fever/?api"
    endpoint_url = f"{str(request.base_url).rstrip('/')}/plugins/fever/?api"
    return {
        "plugin_id": "fever",
        "title": "Fever API",
        "description": "使用 MD5(username:app_password) 作为 api_key，请务必启用 HTTPS。",
        "items": [
            {"key": "username", "label": "用户名", "value": username, "display": "code"},
            {"key": "app_password", "label": "应用密码", "value": app_password, "display": "code"},
            {"key": "api_key", "label": "API Key(MD5)", "value": api_key, "display": "code"},
            {"key": "endpoint_path", "label": "API 路径", "value": endpoint_path, "display": "code"},
            {"key": "endpoint_url", "label": "API 地址", "value": endpoint_url, "display": "code"},
        ],
        "actions": [
            {
                "id": "rotate_credentials",
                "label": "重置应用密码",
                "method": "POST",
                "path": "/plugins/fever/settings/credentials/reset",
            }
        ],
    }


def _detect_read_action(query: dict[str, Any]) -> str | None:
    for action in READ_ACTION_PRIORITY:
        if action in query:
            return action
    return None


def _build_groups_payload(folders: list[Folder], feeds: list[Feed]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    feed_ids_by_group: dict[int, list[int]] = {}
    for feed in feeds:
        if feed.folder_id is None:
            continue
        feed_ids_by_group.setdefault(int(feed.folder_id), []).append(int(feed.id))

    groups = [
        {
            "id": int(folder.id),
            "title": folder.name,
        }
        for folder in folders
    ]
    feeds_groups = [
        {
            "group_id": int(folder.id),
            "feed_ids": ",".join(str(item) for item in sorted(feed_ids_by_group.get(folder.id, []))),
        }
        for folder in folders
    ]
    return groups, feeds_groups


def _load_favicon_base64(icon_url: str | None) -> str:
    if not icon_url:
        return ""
    candidate = Path(favicon_cache_dir()) / Path(icon_url).name
    if not candidate.exists():
        return ""
    raw = candidate.read_bytes()
    if not raw:
        return ""
    suffix = candidate.suffix.lower()
    if suffix == ".png":
        mime = "image/png"
    elif suffix == ".svg":
        mime = "image/svg+xml"
    elif suffix == ".gif":
        mime = "image/gif"
    else:
        mime = "image/x-icon"
    encoded = base64.b64encode(raw).decode("ascii")
    return f"{mime};base64,{encoded}"


def _items_query(db: Session, user: User):
    return (
        db.query(Entry, UserEntryState)
        .join(UserEntryState, UserEntryState.entry_id == Entry.id)
        .filter(UserEntryState.user_id == user.id)
    )


def _list_items(
    db: Session,
    user: User,
    *,
    since_id: int | None,
    max_id: int | None,
    with_ids: list[int],
) -> tuple[int, list[dict[str, Any]]]:
    base_query = _items_query(db, user)
    total_items = base_query.count()
    query = base_query
    if since_id is not None and since_id > 0:
        query = query.filter(Entry.id > since_id)
    if max_id is not None and max_id > 0:
        query = query.filter(Entry.id <= max_id)
    if with_ids:
        query = query.filter(Entry.id.in_(with_ids[:ITEM_LIMIT]))
    rows = query.order_by(Entry.id.desc()).limit(ITEM_LIMIT).all()
    items = [
        {
            "id": int(entry.id),
            "feed_id": int(entry.feed_id),
            "title": entry.title or "",
            "author": entry.author or "",
            "html": entry.content_html or entry.summary or "",
            "url": entry.url or "",
            "is_saved": 1 if state.is_starred else 0,
            "is_read": 1 if state.is_read else 0,
            "created_on_time": int(entry.published_at or 0),
        }
        for entry, state in rows
    ]
    return int(total_items), items


def _ids_csv(db: Session, user: User, *, unread: bool = False, saved: bool = False) -> str:
    query = db.query(UserEntryState.entry_id).filter(UserEntryState.user_id == user.id)
    if unread:
        query = query.filter(UserEntryState.is_read.is_(False))
    if saved:
        query = query.filter(UserEntryState.is_starred.is_(True))
    rows = query.order_by(UserEntryState.entry_id.desc()).all()
    return ",".join(str(int(row[0])) for row in rows)


def _entry_ids_by_feed_ids_before(
    db: Session,
    user: User,
    feed_ids: list[int],
    before: int | None,
) -> list[int]:
    if not feed_ids:
        return []
    query = (
        db.query(Entry.id)
        .join(Feed, Feed.id == Entry.feed_id)
        .filter(Feed.user_id == user.id, Feed.id.in_(feed_ids))
    )
    if before is not None and before > 0:
        query = query.filter(Entry.published_at <= before)
    rows = query.all()
    return [int(row[0]) for row in rows]


def _feed_ids_for_group(db: Session, user: User, group_id: int) -> list[int]:
    # group_id=0 => Kindling (all is_spark=0 feeds; current implementation all feeds)
    # group_id=-1 => Sparks (is_spark=1 feeds; current implementation none)
    if group_id == -1:
        return []
    query = db.query(Feed.id).filter(Feed.user_id == user.id)
    if group_id > 0:
        query = query.filter(Feed.folder_id == group_id)
    rows = query.all()
    return [int(row[0]) for row in rows]


def _mark_items_read(db: Session, user: User, entry_ids: list[int], is_read: bool) -> int:
    if not entry_ids:
        return 0
    now_ts = int(time.time()) if is_read else 0
    return (
        db.query(UserEntryState)
        .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id.in_(entry_ids))
        .update(
            {
                UserEntryState.is_read: is_read,
                UserEntryState.read_at: now_ts,
            },
            synchronize_session=False,
        )
    )


def _mark_items_saved(db: Session, user: User, entry_ids: list[int], is_saved: bool) -> int:
    if not entry_ids:
        return 0
    return (
        db.query(UserEntryState)
        .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id.in_(entry_ids))
        .update({UserEntryState.is_starred: is_saved}, synchronize_session=False)
    )


def _unread_recently_read(db: Session, user: User) -> int:
    cutoff = int(time.time()) - RECENTLY_READ_WINDOW_SECONDS
    return (
        db.query(UserEntryState)
        .filter(
            UserEntryState.user_id == user.id,
            UserEntryState.is_read.is_(True),
            UserEntryState.read_at >= cutoff,
        )
        .update(
            {
                UserEntryState.is_read: False,
                UserEntryState.read_at: 0,
            },
            synchronize_session=False,
        )
    )


def _list_hot_links(
    db: Session,
    user: User,
    *,
    offset_days: int,
    range_days: int,
    page: int,
) -> list[dict[str, Any]]:
    now_ts = int(time.time())
    window_end = now_ts - max(0, offset_days) * 86400
    window_start = window_end - max(1, range_days) * 86400
    query = _items_query(db, user).filter(
        Entry.published_at >= window_start,
        Entry.published_at <= window_end,
    )
    rows = (
        query.order_by(Entry.published_at.desc(), Entry.id.desc())
        .offset(max(0, page - 1) * LINK_LIMIT)
        .limit(LINK_LIMIT)
        .all()
    )
    links: list[dict[str, Any]] = []
    for entry, state in rows:
        age = max(1, window_end - int(entry.published_at or window_end))
        temperature = round(100000.0 / (age + 3600.0), 3)
        links.append(
            {
                "id": int(entry.id),
                "feed_id": int(entry.feed_id),
                "item_id": int(entry.id),
                "temperature": temperature,
                "is_item": 1,
                "is_local": 1,
                "is_saved": 1 if state.is_starred else 0,
                "title": entry.title or "",
                "url": entry.url or "",
                "item_ids": str(int(entry.id)),
            }
        )
    return links


@router.get("/plugins/fever/settings")
def fever_settings(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    username, app_password, api_key = _ensure_credentials(db, user)
    return _settings_payload(request, username, app_password, api_key)


@router.post("/plugins/fever/settings/credentials/reset")
def reset_fever_credentials(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    username, app_password, api_key = _ensure_credentials(db, user, rotate_password=True)
    return _settings_payload(request, username, app_password, api_key)


@router.post("/plugins/fever")
@router.post("/plugins/fever/")
async def fever_api(
    request: Request,
    db: Session = Depends(get_db),
):
    query = dict(request.query_params)
    xml_mode = str(query.get("api", "")).strip().lower() == "xml"
    try:
        form_data = await request.form()
        form: dict[str, Any] = dict(form_data)
    except Exception:  # noqa: BLE001
        form = {}

    api_key = str(form.get("api_key", "") or "").strip()
    user = _verify_api_key(db, api_key)
    read_action = _detect_read_action(query)
    mark_target = str(form.get("mark", "") or "").strip().lower()
    unread_recently_read = str(form.get("unread_recently_read", "") or "").strip() in {"1", "true"}

    if read_action is None and not mark_target and not unread_recently_read:
        return _payload_response(_base_response(db, user), xml_mode)

    if not user:
        return _payload_response(_base_response(db, None), xml_mode)

    base = _base_response(db, user)

    if unread_recently_read:
        affected = _unread_recently_read(db, user)
        db.commit()
        return _payload_response(
            {
                **base,
                "updated_count": int(affected),
                "unread_item_ids": _ids_csv(db, user, unread=True),
            },
            xml_mode,
        )

    if mark_target:
        as_value = str(form.get("as", "") or "").strip().lower()
        before = _to_int(form.get("before"))
        affected = 0
        if mark_target == "item":
            entry_ids = _parse_positive_ids(form.get("id"))
            if as_value in {"read", "unread"}:
                affected = _mark_items_read(db, user, entry_ids, as_value == "read")
                db.commit()
                return _payload_response(
                    {
                        **base,
                        "updated_count": int(affected),
                        "unread_item_ids": _ids_csv(db, user, unread=True),
                    },
                    xml_mode,
                )
            if as_value in {"saved", "starred", "fav", "unsaved", "unstarred", "unfav"}:
                is_saved = as_value in {"saved", "starred", "fav"}
                affected = _mark_items_saved(db, user, entry_ids, is_saved)
                db.commit()
                return _payload_response(
                    {
                        **base,
                        "updated_count": int(affected),
                        "saved_item_ids": _ids_csv(db, user, saved=True),
                    },
                    xml_mode,
                )
        elif mark_target == "feed" and as_value == "read":
            feed_ids = _parse_positive_ids(form.get("id"))
            entry_ids = _entry_ids_by_feed_ids_before(db, user, feed_ids, before)
            affected = _mark_items_read(db, user, entry_ids, True)
            db.commit()
            return _payload_response(
                {
                    **base,
                    "updated_count": int(affected),
                    "unread_item_ids": _ids_csv(db, user, unread=True),
                },
                xml_mode,
            )
        elif mark_target == "group" and as_value == "read":
            group_ids = _parse_signed_ids(form.get("id"))
            all_feed_ids: list[int] = []
            for group_id in group_ids:
                all_feed_ids.extend(_feed_ids_for_group(db, user, group_id))
            unique_feed_ids = sorted(set(all_feed_ids))
            entry_ids = _entry_ids_by_feed_ids_before(db, user, unique_feed_ids, before)
            affected = _mark_items_read(db, user, entry_ids, True)
            db.commit()
            return _payload_response(
                {
                    **base,
                    "updated_count": int(affected),
                    "unread_item_ids": _ids_csv(db, user, unread=True),
                },
                xml_mode,
            )
        return _payload_response({**base, "error": "Unsupported mark action"}, xml_mode)

    if read_action == "groups":
        folders = FolderService.list(db, user)
        feeds = FeedService.list(db, user)
        groups, feeds_groups = _build_groups_payload(folders, feeds)
        return _payload_response(
            {
                **base,
                "groups": groups,
                "feeds_groups": feeds_groups,
            },
            xml_mode,
        )

    if read_action == "feeds":
        feeds = FeedService.list(db, user)
        folders = FolderService.list(db, user)
        _, feeds_groups = _build_groups_payload(folders, feeds)
        payload = [
            {
                "id": int(feed.id),
                "favicon_id": int(feed.id),
                "title": feed.title or "",
                "url": feed.url or "",
                "site_url": feed.site_url or "",
                "is_spark": 0,
                "last_updated_on_time": int(feed.last_fetch_at or 0),
            }
            for feed in feeds
        ]
        return _payload_response(
            {
                **base,
                "feeds": payload,
                "feeds_groups": feeds_groups,
            },
            xml_mode,
        )

    if read_action == "favicons":
        feeds = FeedService.list(db, user)
        payload = [
            {
                "id": int(feed.id),
                "data": _load_favicon_base64(feed.icon_url),
            }
            for feed in feeds
        ]
        return _payload_response({**base, "favicons": payload}, xml_mode)

    if read_action == "items":
        since_id = _to_int(query.get("since_id"))
        max_id = _to_int(query.get("max_id"))
        with_ids = _parse_positive_ids(query.get("with_ids"))[:ITEM_LIMIT]
        total_items, items = _list_items(
            db,
            user,
            since_id=since_id,
            max_id=max_id,
            with_ids=with_ids,
        )
        return _payload_response(
            {
                **base,
                "total_items": total_items,
                "items": items,
            },
            xml_mode,
        )

    if read_action == "links":
        offset_days = max(0, _to_int(query.get("offset")) or 0)
        range_days = max(1, _to_int(query.get("range")) or DEFAULT_LINK_RANGE_DAYS)
        page = max(1, _to_int(query.get("page")) or 1)
        links = _list_hot_links(
            db,
            user,
            offset_days=offset_days,
            range_days=range_days,
            page=page,
        )
        return _payload_response({**base, "links": links}, xml_mode)

    if read_action == "unread_item_ids":
        return _payload_response(
            {**base, "unread_item_ids": _ids_csv(db, user, unread=True)},
            xml_mode,
        )

    if read_action == "saved_item_ids":
        return _payload_response(
            {**base, "saved_item_ids": _ids_csv(db, user, saved=True)},
            xml_mode,
        )

    return _payload_response({**base, "error": "Unsupported action"}, xml_mode)


def register(app) -> None:
    app.include_router(router)
