from __future__ import annotations

from collections.abc import Callable
import json
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


def _ensure_fts_objects(db: Session, *, rebuild: bool = False) -> None:
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
    if rebuild:
        db.execute(text("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');"))


def _table_exists(db: Session, table_name: str) -> bool:
    result = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name = :name"),
        {"name": table_name},
    ).fetchone()
    return result is not None


def _column_exists(db: Session, table_name: str, column_name: str) -> bool:
    rows = db.execute(text(f"PRAGMA table_info({table_name});")).fetchall()
    return any(row[1] == column_name for row in rows)


def _read_user_defaults(settings_json: str | None) -> dict[str, int | bool]:
    defaults = {
        "default_fetch_interval_min": 30,
        "fulltext_enabled": bool(settings.fulltext_enabled),
        "cleanup_retention_days": 30,
        "cleanup_keep_content": True,
        "image_cache_enabled": False,
    }
    if not settings_json:
        return defaults
    try:
        parsed = json.loads(settings_json)
    except json.JSONDecodeError:
        return defaults
    if not isinstance(parsed, dict):
        return defaults
    if "default_fetch_interval_min" in parsed:
        try:
            defaults["default_fetch_interval_min"] = max(
                1,
                min(1440, int(parsed["default_fetch_interval_min"])),
            )
        except Exception:  # noqa: BLE001
            pass
    if "fulltext_enabled" in parsed:
        defaults["fulltext_enabled"] = bool(parsed["fulltext_enabled"])
    if "cleanup_retention_days" in parsed:
        try:
            defaults["cleanup_retention_days"] = max(
                1,
                min(3650, int(parsed["cleanup_retention_days"])),
            )
        except Exception:  # noqa: BLE001
            pass
    if "cleanup_keep_content" in parsed:
        defaults["cleanup_keep_content"] = bool(parsed["cleanup_keep_content"])
    if "image_cache_enabled" in parsed:
        defaults["image_cache_enabled"] = bool(parsed["image_cache_enabled"])
    return defaults


def _infer_feed_global_flags(db: Session) -> None:
    if not _table_exists(db, "feeds") or not _table_exists(db, "users"):
        return
    user_defaults: dict[int, dict[str, int | bool]] = {}
    user_rows = db.execute(text("SELECT id, settings_json FROM users;")).fetchall()
    for row in user_rows:
        user_defaults[int(row[0])] = _read_user_defaults(row[1])

    feed_rows = db.execute(
        text(
            """
            SELECT id, user_id, fetch_interval_min, fulltext_enabled,
                   cleanup_retention_days, cleanup_keep_content, image_cache_enabled
            FROM feeds;
            """
        )
    ).fetchall()
    for row in feed_rows:
        feed_id = int(row[0])
        user_id = int(row[1])
        defaults = user_defaults.get(user_id, _read_user_defaults(None))
        db.execute(
            text(
                """
                UPDATE feeds
                SET use_global_fetch_interval = :use_global_fetch_interval,
                    use_global_fulltext = :use_global_fulltext,
                    use_global_cleanup_retention = :use_global_cleanup_retention,
                    use_global_cleanup_keep_content = :use_global_cleanup_keep_content,
                    use_global_image_cache = :use_global_image_cache
                WHERE id = :feed_id;
                """
            ),
            {
                "feed_id": feed_id,
                "use_global_fetch_interval": (
                    1
                    if int(row[2]) == int(defaults["default_fetch_interval_min"])
                    else 0
                ),
                "use_global_fulltext": (
                    1 if bool(row[3]) == bool(defaults["fulltext_enabled"]) else 0
                ),
                "use_global_cleanup_retention": (
                    1 if int(row[4]) == int(defaults["cleanup_retention_days"]) else 0
                ),
                "use_global_cleanup_keep_content": (
                    1
                    if bool(row[5]) == bool(defaults["cleanup_keep_content"])
                    else 0
                ),
                "use_global_image_cache": (
                    1 if bool(row[6]) == bool(defaults["image_cache_enabled"]) else 0
                ),
            },
        )


def _add_column_if_missing(
    db: Session,
    table_name: str,
    column_name: str,
    ddl_fragment: str,
) -> bool:
    if not _table_exists(db, table_name):
        return False
    if _column_exists(db, table_name, column_name):
        return False
    db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl_fragment};"))
    return True


def _ensure_schema_version_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL
            );
            """
        )
    )
    row = db.execute(text("SELECT version FROM schema_migrations WHERE id = 1;")).fetchone()
    if row is None:
        db.execute(
            text("INSERT INTO schema_migrations (id, version) VALUES (1, 0);")
        )


def _get_schema_version(db: Session) -> int:
    _ensure_schema_version_table(db)
    row = db.execute(text("SELECT version FROM schema_migrations WHERE id = 1;")).fetchone()
    if row is None:
        return 0
    return int(row[0])


def _set_schema_version(db: Session, version: int) -> None:
    _ensure_schema_version_table(db)
    db.execute(
        text("UPDATE schema_migrations SET version = :version WHERE id = 1;"),
        {"version": int(version)},
    )


def _migration_1_feed_columns(db: Session) -> None:
    _add_column_if_missing(
        db,
        "feeds",
        "fulltext_enabled",
        "fulltext_enabled BOOLEAN NOT NULL DEFAULT 0",
    )
    _add_column_if_missing(
        db,
        "feeds",
        "icon_url",
        "icon_url TEXT",
    )
    _add_column_if_missing(
        db,
        "feeds",
        "cleanup_retention_days",
        "cleanup_retention_days INTEGER NOT NULL DEFAULT 30",
    )
    _add_column_if_missing(
        db,
        "feeds",
        "cleanup_keep_content",
        "cleanup_keep_content BOOLEAN NOT NULL DEFAULT 1",
    )
    _add_column_if_missing(
        db,
        "feeds",
        "image_cache_enabled",
        "image_cache_enabled BOOLEAN NOT NULL DEFAULT 0",
    )


def _migration_2_fts_search(db: Session) -> None:
    _ensure_fts_objects(db, rebuild=True)


def _migration_3_feed_global_flags(db: Session) -> None:
    added = False
    added = (
        _add_column_if_missing(
            db,
            "feeds",
            "use_global_fetch_interval",
            "use_global_fetch_interval BOOLEAN NOT NULL DEFAULT 1",
        )
        or added
    )
    added = (
        _add_column_if_missing(
            db,
            "feeds",
            "use_global_fulltext",
            "use_global_fulltext BOOLEAN NOT NULL DEFAULT 1",
        )
        or added
    )
    added = (
        _add_column_if_missing(
            db,
            "feeds",
            "use_global_cleanup_retention",
            "use_global_cleanup_retention BOOLEAN NOT NULL DEFAULT 1",
        )
        or added
    )
    added = (
        _add_column_if_missing(
            db,
            "feeds",
            "use_global_cleanup_keep_content",
            "use_global_cleanup_keep_content BOOLEAN NOT NULL DEFAULT 1",
        )
        or added
    )
    added = (
        _add_column_if_missing(
            db,
            "feeds",
            "use_global_image_cache",
            "use_global_image_cache BOOLEAN NOT NULL DEFAULT 1",
        )
        or added
    )
    if added:
        _infer_feed_global_flags(db)


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


def _migration_4_indexes(db: Session) -> None:
    _ensure_indexes(db)


LATEST_SCHEMA_VERSION = 4
_MIGRATIONS: dict[int, Callable[[Session], None]] = {
    1: _migration_1_feed_columns,
    2: _migration_2_fts_search,
    3: _migration_3_feed_global_flags,
    4: _migration_4_indexes,
}


def migrate_schema(db: Session) -> int:
    if not settings.db_url.startswith("sqlite"):
        return 0
    current = _get_schema_version(db)
    if current >= LATEST_SCHEMA_VERSION:
        return current
    for target in range(current + 1, LATEST_SCHEMA_VERSION + 1):
        migration = _MIGRATIONS.get(target)
        if migration is None:
            continue
        migration(db)
        _set_schema_version(db, target)
    return LATEST_SCHEMA_VERSION


def init_db() -> None:
    from .models import Base  # noqa: WPS433

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _init_sqlite_pragmas(db)
        migrate_schema(db)
        db.commit()
