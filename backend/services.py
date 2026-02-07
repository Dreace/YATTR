from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import Entry, Feed, Folder, User, UserEntryState


def _get_settings(user: User) -> dict[str, Any]:
    try:
        return json.loads(user.settings_json or "{}")
    except json.JSONDecodeError:
        return {}


def _set_settings(user: User, settings: dict[str, Any]) -> None:
    user.settings_json = json.dumps(settings, ensure_ascii=False)


class ConfigStore:
    @staticmethod
    def get(user: User, key: str, default: Any = None) -> Any:
        settings = _get_settings(user)
        return settings.get(key, default)

    @staticmethod
    def set(user: User, key: str, value: Any) -> None:
        settings = _get_settings(user)
        settings[key] = value
        _set_settings(user, settings)


class AuthService:
    @staticmethod
    def verify_api_key(db: Session, api_key: str) -> Optional[User]:
        users = db.query(User).all()
        for user in users:
            if ConfigStore.get(user, "api_key") == api_key:
                return user
        return None


class FeedService:
    @staticmethod
    def list(db: Session, user: User) -> list[Feed]:
        return db.query(Feed).filter(Feed.user_id == user.id).all()

    @staticmethod
    def get(db: Session, user: User, feed_id: int) -> Optional[Feed]:
        return (
            db.query(Feed)
            .filter(Feed.user_id == user.id, Feed.id == feed_id)
            .first()
        )


class EntryService:
    @staticmethod
    def list(db: Session, user: User, since_id: int | None = None) -> list[Entry]:
        query = (
            db.query(Entry)
            .join(UserEntryState, UserEntryState.entry_id == Entry.id)
            .filter(UserEntryState.user_id == user.id)
        )
        if since_id:
            query = query.filter(Entry.id > since_id)
        return query.order_by(Entry.id.desc()).all()

    @staticmethod
    def list_with_state(
        db: Session,
        user: User,
        since_id: int | None = None,
        max_id: int | None = None,
        with_ids: list[int] | None = None,
        limit: int = 50,
    ) -> list[tuple[Entry, UserEntryState]]:
        query = (
            db.query(Entry, UserEntryState)
            .join(UserEntryState, UserEntryState.entry_id == Entry.id)
            .filter(UserEntryState.user_id == user.id)
        )
        if since_id is not None:
            query = query.filter(Entry.id > since_id)
        if max_id is not None:
            query = query.filter(Entry.id <= max_id)
        if with_ids:
            query = query.filter(Entry.id.in_(with_ids))
        return query.order_by(Entry.id.desc()).limit(limit).all()

    @staticmethod
    def unread_ids(db: Session, user: User) -> list[int]:
        rows = (
            db.query(UserEntryState.entry_id)
            .filter(
                UserEntryState.user_id == user.id,
                UserEntryState.is_read.is_(False),
            )
            .order_by(UserEntryState.entry_id.desc())
            .all()
        )
        return [row[0] for row in rows]

    @staticmethod
    def get(db: Session, user: User, entry_id: int) -> Optional[Entry]:
        return (
            db.query(Entry)
            .join(UserEntryState, UserEntryState.entry_id == Entry.id)
            .filter(UserEntryState.user_id == user.id, Entry.id == entry_id)
            .first()
        )

    @staticmethod
    def mark_read(db: Session, user: User, entry_id: int, is_read: bool) -> None:
        state = (
            db.query(UserEntryState)
            .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id == entry_id)
            .first()
        )
        if state:
            state.is_read = is_read

    @staticmethod
    def mark_star(db: Session, user: User, entry_id: int, is_starred: bool) -> None:
        state = (
            db.query(UserEntryState)
            .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id == entry_id)
            .first()
        )
        if state:
            state.is_starred = is_starred


class FolderService:
    @staticmethod
    def list(db: Session, user: User) -> list[Folder]:
        return db.query(Folder).filter(Folder.user_id == user.id).all()
