from __future__ import annotations

import hashlib
import logging
import calendar
import time
from time import struct_time
from typing import Iterable, Sequence, cast

import feedparser
import httpx
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from tenacity import RetryError, retry, stop_after_attempt, wait_exponential

from .cache_assets import cache_images_in_html, cache_site_favicon
from .feed_settings import (
    UserFeedDefaults,
    default_user_feed_defaults,
    resolve_effective_feed_settings,
    resolve_user_feed_defaults,
)
from .models import Entry, Feed, FetchLog, User, UserEntryState
from .network_safety import fetch_text_response
from .rules import apply_filters
from .text_extract import extract_fulltext

try:
    from lxml.html.clean import Cleaner

    _HTML_CLEANER = Cleaner(
        scripts=True,
        javascript=True,
        comments=True,
        style=True,
        links=False,
        meta=False,
        embedded=True,
        frames=True,
        forms=True,
        processing_instructions=True,
        safe_attrs_only=True,
    )
except Exception:  # pragma: no cover
    _HTML_CLEANER = None

logger = logging.getLogger("uvicorn.error")


def _sanitize_html(html_content: str | None) -> str | None:
    if not html_content:
        return None
    if _HTML_CLEANER is None:
        return html_content
    try:
        return _HTML_CLEANER.clean_html(html_content)
    except Exception:  # noqa: BLE001
        return None


def _refresh_feed_icon(feed: Feed) -> None:
    icon_source = feed.site_url or feed.url
    if not icon_source:
        return
    try:
        icon_url = cache_site_favicon(icon_source)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "feed_fetch icon_update=failed title=%s url=%s error=%s",
            feed.title,
            feed.url,
            format_fetch_error(exc),
        )
        return
    if icon_url:
        feed.icon_url = icon_url


def format_fetch_error(exc: Exception) -> str:
    raw = exc
    if isinstance(exc, RetryError):
        inner = exc.last_attempt.exception()
        if isinstance(inner, Exception):
            raw = inner

    if isinstance(raw, httpx.ConnectTimeout | httpx.ReadTimeout | httpx.TimeoutException):
        return "请求订阅源超时，请稍后重试"
    if isinstance(raw, httpx.ConnectError):
        return "无法连接到订阅源，请检查 URL 或网络"
    if isinstance(raw, httpx.RemoteProtocolError):
        message = str(raw) or "远程服务返回了不完整或异常的响应"
        return f"远程协议错误：{message}"
    if isinstance(raw, httpx.HTTPStatusError):
        status_code = raw.response.status_code if raw.response is not None else 0
        return f"订阅源返回 HTTP {status_code}"
    if isinstance(raw, ValueError):
        return f"数据格式错误：{raw}"

    detail = str(raw).strip()
    if not detail:
        detail = raw.__class__.__name__
    return detail


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def fetch_feed(feed: Feed) -> feedparser.FeedParserDict:
    headers = {}
    if feed.etag:
        headers["If-None-Match"] = feed.etag
    if feed.last_modified:
        headers["If-Modified-Since"] = feed.last_modified

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        try:
            response, body_text = fetch_text_response(client, feed.url, headers=headers)
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 304:
                feed.last_status = 304
                return feedparser.FeedParserDict({"status": 304})
            raise
        feed.last_status = response.status_code
        if response.status_code == 304:
            return feedparser.FeedParserDict({"status": 304})
        parsed = feedparser.parse(body_text)
        feed.etag = response.headers.get("ETag")
        feed.last_modified = response.headers.get("Last-Modified")
        return parsed


def _hash_entry(guid: str | None, link: str | None, title: str | None) -> str:
    base = guid or link or title or ""
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def upsert_entries(db, feed: Feed, parsed: feedparser.FeedParserDict) -> int:
    if parsed.get("status") == 304:
        return 0

    user = db.query(User).filter(User.id == feed.user_id).first()
    defaults = (
        resolve_user_feed_defaults(user)
        if user
        else default_user_feed_defaults()
    )
    effective_settings = resolve_effective_feed_settings(feed, defaults)

    added = 0
    for item in parsed.entries:
        guid = cast(str | None, item.get("id") or item.get("guid"))
        link = cast(str | None, item.get("link"))
        title = cast(str | None, item.get("title")) or "(untitled)"
        summary = cast(str | None, item.get("summary"))
        author = cast(str | None, item.get("author"))
        published = cast(struct_time | Sequence[int] | None, item.get("published_parsed"))
        published_at = int(time.time())
        if published:
            published_seq = cast(Sequence[int], published)
            utc_tuple = tuple((list(published_seq[:9]) + [0] * 9)[:9])
            published_at = int(calendar.timegm(utc_tuple))

        content_html = None
        content_text = None
        content_list = item.get("content")
        if isinstance(content_list, list) and content_list:
            first = content_list[0]
            if isinstance(first, dict):
                content_html = cast(str | None, first.get("value"))
        content_html = _sanitize_html(content_html)
        summary = _sanitize_html(summary)
        if effective_settings.image_cache_enabled:
            base_for_assets = link or feed.site_url or feed.url
            content_html = cache_images_in_html(content_html, base_for_assets)
            summary = cache_images_in_html(summary, base_for_assets)

        if effective_settings.fulltext_enabled:
            content_text = extract_fulltext(link)
        else:
            content_text = cast(str | None, item.get("summary"))
        if not effective_settings.cleanup_keep_content:
            content_html = None
            content_text = None

        entry_hash = _hash_entry(guid, link, title)
        exists = (
            db.query(Entry)
            .filter(Entry.feed_id == feed.id, Entry.hash == entry_hash)
            .first()
        )
        if exists:
            continue

        entry = Entry(
            feed_id=feed.id,
            guid=guid,
            url=link,
            title=title,
            author=author,
            published_at=published_at,
            summary=summary,
            content_html=content_html,
            content_text=content_text,
            hash=entry_hash,
        )
        db.add(entry)
        db.flush()
        db.execute(
            sqlite_insert(UserEntryState)
            .values(
                user_id=feed.user_id,
                entry_id=entry.id,
                is_read=False,
                is_starred=False,
                is_later=False,
                read_at=0,
            )
            .on_conflict_do_nothing(index_elements=["user_id", "entry_id"])
        )
        apply_filters(db, feed.user_id, entry)
        added += 1

    return added


def iter_due_feeds(db) -> Iterable[Feed]:
    now_ts = int(time.time())
    feeds = db.query(Feed).filter(Feed.disabled.is_(False)).all()
    defaults_by_user_id: dict[int, UserFeedDefaults] = {}
    for feed in feeds:
        if feed.error_count >= 10:
            feed.disabled = True
            continue
        user_defaults = defaults_by_user_id.get(feed.user_id)
        if user_defaults is None:
            user = db.query(User).filter(User.id == feed.user_id).first()
            user_defaults = (
                resolve_user_feed_defaults(user)
                if user
                else default_user_feed_defaults()
            )
            defaults_by_user_id[feed.user_id] = user_defaults
        effective_settings = resolve_effective_feed_settings(feed, user_defaults)
        interval = effective_settings.fetch_interval_min * 60
        backoff = 1
        if feed.error_count >= 5:
            backoff = 24
        elif feed.error_count >= 3:
            backoff = 4
        elif feed.error_count >= 1:
            backoff = 1
        due = feed.last_fetch_at + interval * backoff
        if now_ts >= due:
            yield feed


def process_feed(db, feed: Feed) -> int:
    try:
        parsed = fetch_feed(feed)
        feed_info = parsed.get("feed")
        if isinstance(feed_info, dict):
            feed.title = cast(str | None, feed_info.get("title")) or feed.title
            feed.site_url = cast(str | None, feed_info.get("link")) or feed.site_url
        _refresh_feed_icon(feed)
        added = upsert_entries(db, feed, parsed)
        feed.last_fetch_at = int(time.time())
        if feed.last_status in (200, 304):
            feed.error_count = 0
        logger.info(
            "feed_fetch result=success title=%s url=%s status=%s added=%s error=%s",
            feed.title,
            feed.url,
            feed.last_status,
            added,
            "",
        )
        db.add(
            FetchLog(
                feed_id=feed.id,
                status=feed.last_status,
                fetched_at=feed.last_fetch_at,
                error_message=None,
            )
        )
        return added
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        tracked_feed = db.query(Feed).filter(Feed.id == feed.id).first() or feed
        error_message = format_fetch_error(exc)
        tracked_feed.error_count += 1
        tracked_feed.last_fetch_at = int(time.time())
        logger.warning(
            "feed_fetch result=failed title=%s url=%s status=%s added=%s error=%s",
            tracked_feed.title,
            tracked_feed.url,
            tracked_feed.last_status or 0,
            0,
            error_message,
        )
        db.add(
            FetchLog(
                feed_id=tracked_feed.id,
                status=tracked_feed.last_status or 0,
                fetched_at=tracked_feed.last_fetch_at,
                error_message=error_message,
            )
        )
        return 0
