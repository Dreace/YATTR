from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import Entry, Feed, FetchLog, User
from ..schemas import DebugEntryOut, FetchLogOut

router = APIRouter()


@router.get("/api/debug/feeds/{feed_id}/logs", response_model=List[FetchLogOut])
def debug_feed_logs(
    feed_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    logs = (
        db.query(FetchLog)
        .filter(FetchLog.feed_id == feed_id)
        .order_by(FetchLog.fetched_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
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


@router.get("/api/debug/feeds/{feed_id}/entries", response_model=List[DebugEntryOut])
def debug_feed_entries(
    feed_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    rows = (
        db.query(Entry)
        .filter(Entry.feed_id == feed_id)
        .order_by(Entry.published_at.desc(), Entry.id.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [
        DebugEntryOut(
            id=row.id,
            feed_id=row.feed_id,
            title=row.title,
            url=row.url,
            published_at=row.published_at,
            summary=row.summary,
            content_html=row.content_html,
            content_text=row.content_text,
        )
        for row in rows
    ]

