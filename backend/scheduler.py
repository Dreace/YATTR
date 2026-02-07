from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from .cleanup import cleanup_old_entries
from .config import settings
from .db import SessionLocal
from .fetcher import format_fetch_error, iter_due_feeds, process_feed
from .models import Feed

logger = logging.getLogger("uvicorn.error")


def _collect_due_feed_ids() -> list[int]:
    with SessionLocal() as db:
        feed_ids = [feed.id for feed in iter_due_feeds(db)]
    max_feeds = max(1, settings.scheduler_max_feeds_per_tick)
    if len(feed_ids) > max_feeds:
        logger.info(
            "scheduler limited due feeds total=%s processing=%s",
            len(feed_ids),
            max_feeds,
        )
    return feed_ids[:max_feeds]


def _process_due_feed(feed_id: int) -> None:
    with SessionLocal() as db:
        feed = db.query(Feed).filter(Feed.id == feed_id, Feed.disabled.is_(False)).first()
        if not feed:
            return
        try:
            process_feed(db, feed)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning(
                "scheduler feed_update_failed feed_id=%s title=%s url=%s error=%s",
                feed_id,
                feed.title,
                feed.url,
                format_fetch_error(exc),
            )


def _run_fetch_tick() -> None:
    for feed_id in _collect_due_feed_ids():
        _process_due_feed(feed_id)


def _run_cleanup_tick() -> None:
    with SessionLocal() as db:
        try:
            cleanup_old_entries(db)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning("scheduler cleanup_failed error=%s", format_fetch_error(exc))


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC", daemon=True)

    scheduler.add_job(
        _run_fetch_tick,
        "interval",
        minutes=max(1, settings.scheduler_fetch_interval_min),
        max_instances=1,
        coalesce=True,
        misfire_grace_time=30,
    )
    scheduler.add_job(
        _run_cleanup_tick,
        "interval",
        minutes=max(5, settings.scheduler_cleanup_interval_min),
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60,
    )
    scheduler.start()
    return scheduler
