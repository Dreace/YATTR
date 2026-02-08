from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from apscheduler.schedulers.background import BackgroundScheduler

from .cleanup import cleanup_old_entries
from .config import settings
from .db import SessionLocal
from .fetcher import format_fetch_error, iter_due_feeds, process_feed
from .models import Feed

logger = logging.getLogger("uvicorn.error")
_feed_executor: ThreadPoolExecutor | None = None
_feed_executor_lock = threading.Lock()
_feed_in_flight_lock = threading.Lock()
_feed_in_flight: set[int] = set()


def _resolve_feed_worker_count() -> int:
    max_feeds = max(1, settings.scheduler_max_feeds_per_tick)
    return max(1, min(4, max_feeds))


def _get_feed_executor() -> ThreadPoolExecutor:
    global _feed_executor
    with _feed_executor_lock:
        if _feed_executor is None:
            _feed_executor = ThreadPoolExecutor(
                max_workers=_resolve_feed_worker_count(),
                thread_name_prefix="rss-feed",
            )
        return _feed_executor


def shutdown_feed_workers() -> None:
    global _feed_executor
    with _feed_executor_lock:
        executor = _feed_executor
        _feed_executor = None
    with _feed_in_flight_lock:
        _feed_in_flight.clear()
    if executor is None:
        return
    try:
        executor.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        executor.shutdown(wait=False)


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


def _process_feed_job(
    feed_id: int,
    *,
    user_id: int | None = None,
    include_disabled: bool = False,
) -> None:
    with SessionLocal() as db:
        query = db.query(Feed).filter(Feed.id == feed_id)
        if user_id is not None:
            query = query.filter(Feed.user_id == user_id)
        if not include_disabled:
            query = query.filter(Feed.disabled.is_(False))
        feed = query.first()
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


def _run_feed_job(
    feed_id: int,
    *,
    user_id: int | None = None,
    include_disabled: bool = False,
) -> None:
    try:
        _process_feed_job(
            feed_id,
            user_id=user_id,
            include_disabled=include_disabled,
        )
    finally:
        with _feed_in_flight_lock:
            _feed_in_flight.discard(feed_id)


def enqueue_feed_update(
    feed_id: int,
    *,
    user_id: int | None = None,
    include_disabled: bool = False,
) -> bool:
    with _feed_in_flight_lock:
        if feed_id in _feed_in_flight:
            return False
        _feed_in_flight.add(feed_id)
    try:
        executor = _get_feed_executor()
        executor.submit(
            _run_feed_job,
            feed_id,
            user_id=user_id,
            include_disabled=include_disabled,
        )
        return True
    except Exception:  # noqa: BLE001
        with _feed_in_flight_lock:
            _feed_in_flight.discard(feed_id)
        raise


def _run_fetch_tick() -> None:
    submitted = 0
    skipped = 0
    for feed_id in _collect_due_feed_ids():
        if enqueue_feed_update(feed_id):
            submitted += 1
        else:
            skipped += 1
    if skipped:
        logger.info(
            "scheduler skipped_already_running submitted=%s skipped=%s",
            submitted,
            skipped,
        )


def _run_cleanup_tick() -> None:
    with SessionLocal() as db:
        try:
            cleanup_old_entries(db)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning("scheduler cleanup_failed error=%s", format_fetch_error(exc))


def start_scheduler() -> BackgroundScheduler:
    _get_feed_executor()
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
