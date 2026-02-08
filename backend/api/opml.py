from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import Feed, Folder, User

router = APIRouter()


@router.post("/api/opml/import")
def import_opml(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    import xml.etree.ElementTree as ET

    content = file.file.read()
    root = ET.fromstring(content)

    def get_or_create_folder_id(name: str) -> int:
        folder = (
            db.query(Folder)
            .filter(Folder.user_id == user.id, Folder.name == name)
            .first()
        )
        if folder:
            return folder.id
        folder = Folder(user_id=user.id, name=name, sort_order=0)
        db.add(folder)
        db.flush()
        return folder.id

    def upsert_feed(xml_url: str, title: Optional[str], folder_id: Optional[int]) -> None:
        feed = db.query(Feed).filter(Feed.user_id == user.id, Feed.url == xml_url).first()
        if feed:
            if title:
                feed.title = title
            if folder_id is not None:
                feed.folder_id = folder_id
            return
        db.add(
            Feed(
                user_id=user.id,
                folder_id=folder_id,
                title=title or xml_url,
                url=xml_url,
            )
        )

    def walk(parent, folder_id: Optional[int] = None) -> None:
        for outline in parent.findall("outline"):
            title = outline.attrib.get("title") or outline.attrib.get("text")
            xml_url = (
                outline.attrib.get("xmlUrl")
                or outline.attrib.get("xmlurl")
                or outline.attrib.get("url")
            )
            if xml_url:
                upsert_feed(xml_url, title, folder_id)
                continue

            next_folder_id = folder_id
            if title:
                next_folder_id = get_or_create_folder_id(title)
            walk(outline, next_folder_id)

    body = root.find("body")
    if body is not None:
        walk(body, None)
    else:
        walk(root, None)
    db.commit()
    return {"ok": True}


@router.get("/api/opml/export")
def export_opml(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    import xml.etree.ElementTree as ET

    root = ET.Element("opml", version="1.0")
    body = ET.SubElement(root, "body")
    feeds = db.query(Feed).filter(Feed.user_id == user.id).all()
    for feed in feeds:
        ET.SubElement(
            body,
            "outline",
            text=feed.title,
            title=feed.title,
            type="rss",
            xmlUrl=feed.url,
        )
    xml_bytes = ET.tostring(root, encoding="utf-8")
    return {
        "content": xml_bytes.decode("utf-8"),
        "exported_at": datetime.utcnow().isoformat(),
    }

