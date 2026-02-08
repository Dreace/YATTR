from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import Entry, Feed, User, UserEntryState
from ..schemas import (
    BatchStateUpdate,
    EntryOut,
    EntryPageOut,
    EntryStateUpdate,
    SearchResult,
)

router = APIRouter()


@router.get("/api/entries", response_model=EntryPageOut)
def list_entries(
    state: str = "all",
    feedId: Optional[int] = None,
    folderId: Optional[int] = None,
    cursor: Optional[int] = None,
    limit: int = 40,
    page: int = 1,
    page_size: int = 40,
    sort_by: str = "updated",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = (
        db.query(Entry, UserEntryState)
        .join(UserEntryState, UserEntryState.entry_id == Entry.id)
        .filter(UserEntryState.user_id == user.id)
    )
    if feedId:
        query = query.filter(Entry.feed_id == feedId)
    if folderId is not None:
        query = query.join(Feed, Feed.id == Entry.feed_id).filter(
            Feed.user_id == user.id,
            Feed.folder_id == folderId,
        )
    if state == "unread":
        query = query.filter(UserEntryState.is_read.is_(False))
    if state == "starred":
        query = query.filter(UserEntryState.is_starred.is_(True))
    if state == "later":
        query = query.filter(UserEntryState.is_later.is_(True))

    sort_key = sort_by.lower().strip()
    if sort_key not in {"updated", "title"}:
        raise HTTPException(status_code=400, detail="Invalid sort_by")
    order_fields = (
        [Entry.title.asc(), Entry.id.desc()]
        if sort_key == "title"
        else [Entry.published_at.desc(), Entry.id.desc()]
    )

    if cursor is not None:
        query = query.filter(Entry.id < cursor)
        safe_limit = max(1, min(limit, 100))
        entries = query.order_by(*order_fields).limit(safe_limit + 1).all()
        has_more = len(entries) > safe_limit
        page_entries = entries[:safe_limit]
        current_page = 1
        total_items = len(page_entries)
        total_pages = 1
    else:
        safe_page_size = max(1, min(page_size, 100))
        safe_page = max(1, page)
        total_items = query.count()
        total_pages = max(1, (total_items + safe_page_size - 1) // safe_page_size)
        if safe_page > total_pages:
            safe_page = total_pages
        offset = (safe_page - 1) * safe_page_size
        page_entries = (
            query.order_by(*order_fields).offset(offset).limit(safe_page_size).all()
        )
        has_more = safe_page < total_pages
        current_page = safe_page

    items = [
        EntryOut(
            id=e.id,
            feed_id=e.feed_id,
            title=e.title,
            url=e.url,
            author=e.author,
            published_at=e.published_at,
            summary=e.summary,
            content_html=e.content_html,
            content_text=e.content_text,
            is_read=s.is_read,
            is_starred=s.is_starred,
            is_later=s.is_later,
        )
        for e, s in page_entries
    ]
    next_cursor = items[-1].id if has_more and items else None
    return EntryPageOut(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
        current_page=current_page,
        total_pages=total_pages,
        total_items=total_items,
    )


@router.get("/api/entries/{entry_id}", response_model=EntryOut)
def get_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry_state = (
        db.query(Entry, UserEntryState)
        .join(UserEntryState, UserEntryState.entry_id == Entry.id)
        .filter(UserEntryState.user_id == user.id, Entry.id == entry_id)
        .first()
    )
    if not entry_state:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry, state = entry_state
    return EntryOut(
        id=entry.id,
        feed_id=entry.feed_id,
        title=entry.title,
        url=entry.url,
        author=entry.author,
        published_at=entry.published_at,
        summary=entry.summary,
        content_html=entry.content_html,
        content_text=entry.content_text,
        is_read=state.is_read,
        is_starred=state.is_starred,
        is_later=state.is_later,
    )


def _update_state(db: Session, user: User, entry_id: int, payload: EntryStateUpdate) -> None:
    state = (
        db.query(UserEntryState)
        .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id == entry_id)
        .first()
    )
    if not state:
        raise HTTPException(status_code=404, detail="State not found")
    if payload.is_read is not None:
        state.is_read = payload.is_read
    if payload.is_starred is not None:
        state.is_starred = payload.is_starred
    if payload.is_later is not None:
        state.is_later = payload.is_later


@router.post("/api/entries/{entry_id}/read")
def mark_read(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_read=True))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/{entry_id}/unread")
def mark_unread(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_read=False))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/{entry_id}/star")
def mark_star(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_starred=True))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/{entry_id}/unstar")
def mark_unstar(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_starred=False))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/{entry_id}/later")
def mark_later(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_later=True))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/{entry_id}/unlater")
def mark_unlater(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _update_state(db, user, entry_id, EntryStateUpdate(is_later=False))
    db.commit()
    return {"ok": True}


@router.post("/api/entries/batch")
def batch_update(
    payload: BatchStateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    for entry_id in payload.entry_ids:
        _update_state(
            db,
            user,
            entry_id,
            EntryStateUpdate(
                is_read=payload.is_read,
                is_starred=payload.is_starred,
                is_later=payload.is_later,
            ),
        )
    db.commit()
    return {"ok": True}


@router.get("/api/search", response_model=List[SearchResult])
def search(
    q: str,
    scope: str = "all",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    scope_key = scope.lower()
    if scope_key not in {"all", "title", "summary", "content"}:
        raise HTTPException(status_code=400, detail="Invalid scope")
    clean_query = q.replace('"', " ").strip()
    if not clean_query:
        return []

    terms = [part for part in re.split(r"\s+", clean_query) if part]
    if not terms:
        return []
    quoted_terms = [f'"{term}"' for term in terms]
    field_by_scope = {
        "title": "title",
        "summary": "summary",
        "content": "content_text",
    }
    if scope_key == "all":
        match_query = " AND ".join(quoted_terms)
    else:
        field = field_by_scope[scope_key]
        match_query = " AND ".join(f"{field}:{term}" for term in quoted_terms)

    query = text(
        """
        SELECT
            entries.id,
            entries.feed_id,
            entries.title,
            entries.summary,
            entries.content_text,
            entries.url,
            user_entry_state.is_read,
            user_entry_state.is_starred,
            user_entry_state.is_later
        FROM entries_fts
        JOIN entries ON entries_fts.rowid = entries.id
        JOIN user_entry_state ON user_entry_state.entry_id = entries.id
        WHERE user_entry_state.user_id = :user_id AND entries_fts MATCH :q
        ORDER BY entries.id DESC
        LIMIT 50
        """
    )
    try:
        rows = db.execute(query, {"user_id": user.id, "q": match_query}).fetchall()
    except Exception:  # noqa: BLE001
        rows = []
    if not rows:
        scope_to_filter = {
            "title": "entries.title LIKE :pattern",
            "summary": "entries.summary LIKE :pattern",
            "content": "entries.content_text LIKE :pattern",
            "all": (
                "entries.title LIKE :pattern OR "
                "entries.summary LIKE :pattern OR "
                "entries.content_text LIKE :pattern"
            ),
        }
        like_query = text(
            f"""
            SELECT
                entries.id,
                entries.feed_id,
                entries.title,
                entries.summary,
                entries.content_text,
                entries.url,
                user_entry_state.is_read,
                user_entry_state.is_starred,
                user_entry_state.is_later
            FROM entries
            JOIN user_entry_state ON user_entry_state.entry_id = entries.id
            WHERE user_entry_state.user_id = :user_id
                AND ({scope_to_filter[scope_key]})
            ORDER BY entries.id DESC
            LIMIT 50
            """
        )
        rows = db.execute(
            like_query,
            {"user_id": user.id, "pattern": f"%{clean_query}%"},
        ).fetchall()
    return [
        SearchResult(
            id=r[0],
            feed_id=r[1],
            title=r[2],
            summary=r[3],
            content_text=r[4],
            url=r[5],
            is_read=bool(r[6]),
            is_starred=bool(r[7]),
            is_later=bool(r[8]),
        )
        for r in rows
    ]

