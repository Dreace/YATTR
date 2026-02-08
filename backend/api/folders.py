from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import Entry, Feed, Folder, User
from ..schemas import FolderArticleCountOut, FolderIn, FolderOut

router = APIRouter()


@router.get("/api/folders", response_model=List[FolderOut])
def list_folders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folders = db.query(Folder).filter(Folder.user_id == user.id).all()
    return [FolderOut(id=f.id, name=f.name, sort_order=f.sort_order) for f in folders]


@router.get("/api/folders/article_counts", response_model=List[FolderArticleCountOut])
def list_folder_article_counts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Feed.folder_id, func.count(Entry.id))
        .outerjoin(Entry, Entry.feed_id == Feed.id)
        .filter(Feed.user_id == user.id)
        .group_by(Feed.folder_id)
        .all()
    )
    return [
        FolderArticleCountOut(
            folder_id=row[0],
            article_count=int(row[1] or 0),
        )
        for row in rows
    ]


@router.post("/api/folders", response_model=FolderOut)
def create_folder(
    payload: FolderIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = Folder(user_id=user.id, name=payload.name, sort_order=payload.sort_order)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderOut(id=folder.id, name=folder.name, sort_order=folder.sort_order)


@router.put("/api/folders/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: int,
    payload: FolderIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = (
        db.query(Folder)
        .filter(Folder.user_id == user.id, Folder.id == folder_id)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder.name = payload.name
    folder.sort_order = payload.sort_order
    db.commit()
    db.refresh(folder)
    return FolderOut(id=folder.id, name=folder.name, sort_order=folder.sort_order)


@router.delete("/api/folders/{folder_id}")
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = (
        db.query(Folder)
        .filter(Folder.user_id == user.id, Folder.id == folder_id)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    db.query(Feed).filter(Feed.user_id == user.id, Feed.folder_id == folder_id).update(
        {Feed.folder_id: None}
    )
    db.delete(folder)
    db.commit()
    return {"ok": True}
