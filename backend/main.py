from __future__ import annotations

import json
import logging
from typing import List

import feedparser
import httpx
from fastapi import Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .api.debug import router as debug_router
from .api.entries import router as entries_router
from .api.filters import router as filters_router
from .api.folders import router as folders_router
from .api.opml import router as opml_router
from .api.settings import apply_plugin_settings_to_runtime
from .api.settings import router as settings_router
from .api.system import router as system_router
from .app_factory import create_app
from .auth_routes import router as auth_router
from .cache_assets import cache_identicon, cache_site_favicon, ensure_cache_dirs
from .config import ensure_secure_runtime_settings, settings
from .db import SessionLocal, get_db, init_db
from .dependencies import get_current_user
from .feed_settings import (
    apply_feed_setting_overrides,
    resolve_effective_feed_settings,
    resolve_user_feed_defaults,
)
from .fetcher import format_fetch_error, process_feed
from .models import Entry, Feed, User, UserEntryState
from .network_safety import fetch_text_response_async
from .plugin_loader import load_plugins
from .schemas import FeedIn, FeedOut, FeedUnreadCountOut, FeedValidateIn, FeedValidateOut
from .scheduler import enqueue_feed_update, shutdown_feed_workers, start_scheduler
from .security import hash_password
from .services import ConfigStore
from .static_mounts import mount_cache_static, mount_frontend_static

LOG_FORMAT = (
    "%(asctime)s %(levelname)s [%(name)s] %(filename)s:%(lineno)d - %(message)s"
)


def _configure_runtime_logging() -> None:
    formatter = logging.Formatter(LOG_FORMAT)
    for logger_name in ("uvicorn.error", ""):
        logger = logging.getLogger(logger_name)
        for handler in logger.handlers:
            handler.setFormatter(formatter)


app = create_app()
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(folders_router)
app.include_router(entries_router)
app.include_router(filters_router)
app.include_router(opml_router)
app.include_router(debug_router)
app.include_router(system_router)


def _get_or_create_admin(db: Session) -> User:
    user = db.query(User).filter(User.email == settings.admin_email).first()
    if user:
        return user
    user = User(
        email=settings.admin_email,
        password_hash=hash_password(settings.admin_password),
        settings_json=json.dumps({}),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _ensure_feed_icon(feed: Feed) -> bool:
    if feed.icon_url:
        return False
    source = feed.site_url or feed.url
    if not source:
        return False
    icon_url = cache_identicon(source)
    if not icon_url:
        return False
    feed.icon_url = icon_url
    return True


def _refresh_feed_icon(feed: Feed) -> bool:
    source = feed.site_url or feed.url
    if not source:
        return False
    icon_url = cache_site_favicon(source)
    if not icon_url:
        return False
    changed = icon_url != feed.icon_url
    feed.icon_url = icon_url
    return changed


def _build_feed_out(feed: Feed, user: User, defaults=None) -> FeedOut:
    resolved_defaults = defaults or resolve_user_feed_defaults(user)
    effective = resolve_effective_feed_settings(feed, resolved_defaults)
    return FeedOut(
        id=feed.id,
        title=feed.title,
        url=feed.url,
        folder_id=feed.folder_id,
        fetch_interval_min=effective.fetch_interval_min,
        fulltext_enabled=effective.fulltext_enabled,
        cleanup_retention_days=effective.cleanup_retention_days,
        cleanup_keep_content=effective.cleanup_keep_content,
        image_cache_enabled=effective.image_cache_enabled,
        site_url=feed.site_url,
        icon_url=feed.icon_url,
        last_status=feed.last_status,
        error_count=feed.error_count,
        disabled=feed.disabled,
    )


def _shutdown_scheduler_instance(scheduler) -> None:
    if scheduler is None:
        return
    shutdown = getattr(scheduler, "shutdown", None)
    if not callable(shutdown):
        return
    try:
        shutdown(wait=False)
    except Exception:  # noqa: BLE001
        return


@app.on_event("startup")
def on_startup() -> None:
    _configure_runtime_logging()
    ensure_secure_runtime_settings()
    ensure_cache_dirs()
    init_db()
    with SessionLocal() as db:
        admin = _get_or_create_admin(db)
        apply_plugin_settings_to_runtime(admin)
    load_plugins(app)
    mount_frontend_static(app)
    if not settings.testing:
        app.state.scheduler = start_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    _shutdown_scheduler_instance(getattr(app.state, "scheduler", None))
    shutdown_feed_workers()
    app.state.scheduler = None


@app.get("/api/feeds", response_model=List[FeedOut])
def list_feeds(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feeds = db.query(Feed).filter(Feed.user_id == user.id).all()
    defaults = resolve_user_feed_defaults(user)
    updated = False
    for feed in feeds:
        updated = _ensure_feed_icon(feed) or updated
    if updated:
        db.commit()
    return [_build_feed_out(f, user, defaults) for f in feeds]


@app.post("/api/feeds/validate", response_model=FeedValidateOut)
async def validate_feed_url(
    payload: FeedValidateIn,
    user: User = Depends(get_current_user),
):
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            _, body_text = await fetch_text_response_async(client, payload.url)
        parsed = feedparser.parse(body_text)
        feed_info = parsed.get("feed")
        title = None
        site_url = None
        if isinstance(feed_info, dict):
            title = feed_info.get("title")
            site_url = feed_info.get("link")
        if not title and not parsed.entries:
            raise HTTPException(status_code=400, detail="URL 不是有效的 RSS/Atom 订阅源")
        return FeedValidateOut(
            valid=True,
            title=title or payload.url,
            site_url=site_url,
            message="订阅源校验通过",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=format_fetch_error(exc)) from exc


@app.post("/api/feeds", response_model=FeedOut)
def create_feed(
    payload: FeedIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    defaults = resolve_user_feed_defaults(user)
    feed = Feed(
        user_id=user.id,
        folder_id=payload.folder_id,
        title=payload.title,
        url=payload.url,
        site_url=payload.site_url,
        fetch_interval_min=defaults.default_fetch_interval_min,
        fulltext_enabled=defaults.fulltext_enabled,
        cleanup_retention_days=defaults.cleanup_retention_days,
        cleanup_keep_content=defaults.cleanup_keep_content,
        image_cache_enabled=defaults.image_cache_enabled,
    )
    apply_feed_setting_overrides(
        feed,
        defaults,
        fetch_interval_min=payload.fetch_interval_min,
        fulltext_enabled=payload.fulltext_enabled,
        cleanup_retention_days=payload.cleanup_retention_days,
        cleanup_keep_content=payload.cleanup_keep_content,
        image_cache_enabled=payload.image_cache_enabled,
    )
    db.add(feed)
    _ensure_feed_icon(feed)
    db.commit()
    db.refresh(feed)
    return _build_feed_out(feed, user, defaults)


@app.put("/api/feeds/{feed_id}", response_model=FeedOut)
def update_feed(
    feed_id: int,
    payload: FeedIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    defaults = resolve_user_feed_defaults(user)
    fields_set = (
        set(payload.model_fields_set)
        if hasattr(payload, "model_fields_set")
        else set(payload.__fields_set__)
    )
    effective = resolve_effective_feed_settings(feed, defaults)
    source_before = feed.site_url or feed.url
    feed.title = payload.title
    feed.url = payload.url
    feed.site_url = payload.site_url
    feed.folder_id = payload.folder_id
    if "disabled" in fields_set and payload.disabled is not None:
        feed.disabled = payload.disabled
    apply_feed_setting_overrides(
        feed,
        defaults,
        fetch_interval_min=(
            payload.fetch_interval_min
            if "fetch_interval_min" in fields_set
            else (None if feed.use_global_fetch_interval else effective.fetch_interval_min)
        ),
        fulltext_enabled=(
            payload.fulltext_enabled
            if "fulltext_enabled" in fields_set
            else (None if feed.use_global_fulltext else effective.fulltext_enabled)
        ),
        cleanup_retention_days=(
            payload.cleanup_retention_days
            if "cleanup_retention_days" in fields_set
            else (
                None
                if feed.use_global_cleanup_retention
                else effective.cleanup_retention_days
            )
        ),
        cleanup_keep_content=(
            payload.cleanup_keep_content
            if "cleanup_keep_content" in fields_set
            else (
                None
                if feed.use_global_cleanup_keep_content
                else effective.cleanup_keep_content
            )
        ),
        image_cache_enabled=(
            payload.image_cache_enabled
            if "image_cache_enabled" in fields_set
            else (None if feed.use_global_image_cache else effective.image_cache_enabled)
        ),
    )
    source_after = feed.site_url or feed.url
    if source_before != source_after:
        feed.icon_url = None
    _refresh_feed_icon(feed)
    db.commit()
    db.refresh(feed)
    return _build_feed_out(feed, user, defaults)


@app.delete("/api/feeds/{feed_id}")
def delete_feed(
    feed_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    db.delete(feed)
    db.commit()
    return {"ok": True}


@app.get("/api/feeds/unread_counts", response_model=List[FeedUnreadCountOut])
def list_feed_unread_counts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Entry.feed_id, func.count(UserEntryState.entry_id))
        .join(UserEntryState, UserEntryState.entry_id == Entry.id)
        .filter(UserEntryState.user_id == user.id, UserEntryState.is_read.is_(False))
        .group_by(Entry.feed_id)
        .all()
    )
    return [FeedUnreadCountOut(feed_id=r[0], unread_count=r[1]) for r in rows]


@app.post("/api/feeds/{feed_id}/fetch")
def fetch_once(
    feed_id: int,
    background: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if background:
        enqueue_feed_update(feed.id, user_id=user.id, include_disabled=True)
        return {"ok": True, "added": 0, "queued": True}
    added = process_feed(db, feed)
    db.commit()
    return {"ok": True, "added": added, "queued": False}


@app.post("/api/debug/feeds/{feed_id}/refresh")
def debug_refresh_feed(
    feed_id: int,
    background: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if background:
        enqueue_feed_update(feed.id, user_id=user.id, include_disabled=True)
        return {
            "ok": True,
            "feed_id": feed.id,
            "added": 0,
            "queued": True,
            "last_status": feed.last_status,
            "error_count": feed.error_count,
            "last_fetch_at": feed.last_fetch_at,
        }
    added = process_feed(db, feed)
    db.commit()
    return {
        "ok": True,
        "feed_id": feed.id,
        "added": added,
        "queued": False,
        "last_status": feed.last_status,
        "error_count": feed.error_count,
        "last_fetch_at": feed.last_fetch_at,
    }


mount_cache_static(app)
