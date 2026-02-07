from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import settings

Base = declarative_base()


def _ensure_data_dir() -> None:
    if settings.db_url.startswith("sqlite"):  # sqlite:///./data/rss.sqlite
        path = settings.db_url.split("sqlite:///", 1)[-1]
        if path.startswith("./"):
            path = path[2:]
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)


def _create_engine() -> "Engine":
    _ensure_data_dir()
    connect_args = {"check_same_thread": False}
    engine = create_engine(settings.db_url, connect_args=connect_args, future=True)
    return engine


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _init_sqlite_pragmas(db: Session) -> None:
    db.execute(text("PRAGMA journal_mode=WAL;"))
    db.execute(text("PRAGMA synchronous=NORMAL;"))


def _init_fts(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts
            USING fts5(title, summary, content_text, content='entries', content_rowid='id');
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
                INSERT INTO entries_fts(rowid, title, summary, content_text)
                VALUES (new.id, new.title, new.summary, new.content_text);
            END;
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
                INSERT INTO entries_fts(entries_fts, rowid, title, summary, content_text)
                VALUES ('delete', old.id, old.title, old.summary, old.content_text);
            END;
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
                INSERT INTO entries_fts(entries_fts, rowid, title, summary, content_text)
                VALUES ('delete', old.id, old.title, old.summary, old.content_text);
                INSERT INTO entries_fts(rowid, title, summary, content_text)
                VALUES (new.id, new.title, new.summary, new.content_text);
            END;
            """
        )
    )


def _table_exists(db: Session, table_name: str) -> bool:
    result = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name = :name"),
        {"name": table_name},
    ).fetchone()
    return result is not None


def _column_exists(db: Session, table_name: str, column_name: str) -> bool:
    rows = db.execute(text(f"PRAGMA table_info({table_name});")).fetchall()
    return any(row[1] == column_name for row in rows)


def _ensure_schema(db: Session) -> None:
    if not settings.db_url.startswith("sqlite"):
        return
    if _table_exists(db, "feeds") and not _column_exists(db, "feeds", "fulltext_enabled"):
        db.execute(
            text(
                "ALTER TABLE feeds ADD COLUMN fulltext_enabled BOOLEAN NOT NULL DEFAULT 0;"
            )
        )
    if _table_exists(db, "feeds") and not _column_exists(db, "feeds", "icon_url"):
        db.execute(
            text(
                "ALTER TABLE feeds ADD COLUMN icon_url TEXT;"
            )
        )
    if _table_exists(db, "feeds") and not _column_exists(db, "feeds", "cleanup_retention_days"):
        db.execute(
            text(
                "ALTER TABLE feeds ADD COLUMN cleanup_retention_days INTEGER NOT NULL DEFAULT 30;"
            )
        )
    if _table_exists(db, "feeds") and not _column_exists(db, "feeds", "cleanup_keep_content"):
        db.execute(
            text(
                "ALTER TABLE feeds ADD COLUMN cleanup_keep_content BOOLEAN NOT NULL DEFAULT 1;"
            )
        )
    if _table_exists(db, "feeds") and not _column_exists(db, "feeds", "image_cache_enabled"):
        db.execute(
            text(
                "ALTER TABLE feeds ADD COLUMN image_cache_enabled BOOLEAN NOT NULL DEFAULT 0;"
            )
        )


def _ensure_indexes(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_entries_feed_published
            ON entries(feed_id, published_at DESC);
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_user_entry_state_user_read_entry
            ON user_entry_state(user_id, is_read, entry_id);
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_feeds_user_folder
            ON feeds(user_id, folder_id);
            """
        )
    )


def init_db() -> None:
    from .models import Base  # noqa: WPS433

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _init_sqlite_pragmas(db)
        _init_fts(db)
        _ensure_schema(db)
        _ensure_indexes(db)
        db.commit()
