from __future__ import annotations

import logging
import re
from pathlib import Path
import time

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .cache_assets import image_cache_dir
from .models import Entry, Feed, FetchLog, User, UserEntryState

logger = logging.getLogger("uvicorn.error")

_IMAGE_CACHE_REF_RE = re.compile(r"/api/cache/images/([A-Za-z0-9._-]+)")


def _extract_cached_image_names(value: str | None) -> set[str]:
    if not value:
        return set()
    return {match.group(1) for match in _IMAGE_CACHE_REF_RE.finditer(value)}


def _is_image_still_referenced(db: Session, image_name: str) -> bool:
    ref = f"%/api/cache/images/{image_name}%"
    row = (
        db.query(Entry.id)
        .filter(
            or_(
                Entry.summary.like(ref),
                Entry.content_html.like(ref),
            )
        )
        .limit(1)
        .first()
    )
    return row is not None


def _delete_cached_image(path: Path) -> bool:
    try:
        path.unlink(missing_ok=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def cleanup_old_entries(db: Session) -> dict[str, int]:
    now_ts = int(time.time())
    deleted_entries = 0
    deleted_images = 0
    deleted_logs = 0
    users = db.query(User).all()
    image_root = image_cache_dir()

    for user in users:
        feeds = db.query(Feed).filter(Feed.user_id == user.id).all()
        for feed in feeds:
            retention_days = max(1, min(int(feed.cleanup_retention_days), 3650))
            cutoff_ts = now_ts - retention_days * 86400
            deleted_logs += (
                db.query(FetchLog)
                .filter(FetchLog.feed_id == feed.id, FetchLog.fetched_at < cutoff_ts)
                .delete(synchronize_session=False)
            )

            old_entries = (
                db.query(Entry)
                .filter(Entry.feed_id == feed.id, Entry.published_at < cutoff_ts)
                .all()
            )
            if not old_entries:
                continue

            entry_ids = [entry.id for entry in old_entries]
            cached_image_names: set[str] = set()
            for entry in old_entries:
                cached_image_names.update(_extract_cached_image_names(entry.summary))
                cached_image_names.update(_extract_cached_image_names(entry.content_html))

            db.query(UserEntryState).filter(
                UserEntryState.user_id == user.id,
                UserEntryState.entry_id.in_(entry_ids),
            ).delete(synchronize_session=False)
            db.query(Entry).filter(Entry.id.in_(entry_ids)).delete(synchronize_session=False)
            deleted_entries += len(entry_ids)

            for image_name in cached_image_names:
                if _is_image_still_referenced(db, image_name):
                    continue
                if _delete_cached_image(image_root / image_name):
                    deleted_images += 1

    if deleted_entries or deleted_images or deleted_logs:
        logger.info(
            "cleanup result entries_deleted=%s images_deleted=%s logs_deleted=%s",
            deleted_entries,
            deleted_images,
            deleted_logs,
        )
    return {
        "deleted_entries": deleted_entries,
        "deleted_images": deleted_images,
        "deleted_logs": deleted_logs,
    }
