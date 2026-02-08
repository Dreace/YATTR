from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import Entry, Feed, FetchLog, User
from ..schemas import FetchLogOut

router = APIRouter()


@router.get("/api/health")
def health(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _ = user
    feeds = db.query(Feed).count()
    entries = db.query(Entry).count()
    failed_feeds = db.query(Feed).filter(Feed.error_count > 0).count()
    logs = db.query(FetchLog).order_by(FetchLog.fetched_at.desc()).limit(100).all()
    if logs:
        successes = sum(1 for log in logs if log.status == 200)
        success_rate = successes / len(logs)
    else:
        success_rate = 0.0
    return {
        "feeds": feeds,
        "entries": entries,
        "failed_feeds": failed_feeds,
        "success_rate": round(success_rate, 3),
        "status": "ok",
    }


@router.get("/api/fetch/logs", response_model=List[FetchLogOut])
def list_fetch_logs(
    feed_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = (
        db.query(FetchLog)
        .join(Feed, FetchLog.feed_id == Feed.id)
        .filter(Feed.user_id == user.id)
    )
    if feed_id:
        query = query.filter(FetchLog.feed_id == feed_id)
    logs = query.order_by(FetchLog.fetched_at.desc()).limit(limit).all()
    return [
        FetchLogOut(
            id=log.id,
            feed_id=log.feed_id,
            status=log.status,
            fetched_at=log.fetched_at,
            error_message=log.error_message,
        )
        for log in logs
    ]
