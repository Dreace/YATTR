import json
import os
import sys
import hashlib
import base64
import time
from pathlib import Path

import feedparser
import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("RSS_DB_URL", "sqlite:///./data/test.sqlite")
os.environ.setdefault("RSS_SECRET_KEY", "test-secret")
os.environ.setdefault("RSS_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("RSS_ADMIN_PASSWORD", "admin123")
os.environ.setdefault("RSS_TESTING", "true")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import main as app_main
from backend.cache_assets import cache_site_favicon, favicon_cache_dir, image_cache_dir
from backend.cleanup import cleanup_old_entries
from backend.config import settings
from backend.db import LATEST_SCHEMA_VERSION, SessionLocal, init_db, migrate_schema, engine
from backend.dependencies import get_current_user
from backend.fetcher import (
    fetch_feed,
    format_fetch_error,
    iter_due_feeds,
    process_feed,
    upsert_entries,
)
from backend.models import Entry, Feed, FetchLog, FilterRule, Folder, User, UserEntryState
from backend.plugin_loader import iter_enabled_plugins, load_plugins
from backend.plugins.fever import plugin as fever_plugin
from backend.rules import apply_filters
from backend.scheduler import (
    _collect_due_feed_ids,
    _run_cleanup_tick,
    _run_fetch_tick,
    shutdown_feed_workers,
    start_scheduler,
)
from backend.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.network_safety import UnsafeOutboundUrlError, ensure_safe_outbound_url
from backend.services import ConfigStore
from backend.static_mounts import mount_frontend_static
from backend.text_extract import extract_fulltext


def test_security_helpers():
    hashed = hash_password("secret")
    assert verify_password("secret", hashed)
    token = create_access_token("admin@example.com", expires_minutes=1)
    assert decode_access_token(token) == "admin@example.com"


def test_secure_runtime_settings_rejects_insecure_defaults():
    original_testing = settings.testing
    original_secret = settings.secret_key
    original_admin_password = settings.admin_password
    try:
        object.__setattr__(settings, "testing", False)
        object.__setattr__(settings, "secret_key", "change_me")
        object.__setattr__(settings, "admin_password", "change_me")
        with pytest.raises(RuntimeError):
            app_main.ensure_secure_runtime_settings()
    finally:
        object.__setattr__(settings, "testing", original_testing)
        object.__setattr__(settings, "secret_key", original_secret)
        object.__setattr__(settings, "admin_password", original_admin_password)


def test_ensure_safe_outbound_url_blocks_private_address():
    with pytest.raises(UnsafeOutboundUrlError):
        ensure_safe_outbound_url("http://127.0.0.1/internal")


def test_ensure_safe_outbound_url_allows_public_ip():
    assert ensure_safe_outbound_url("https://1.1.1.1/rss") == "https://1.1.1.1/rss"


def setup_module(module):
    from pathlib import Path

    db_path = Path("data/test.sqlite")
    if db_path.exists():
        db_path.unlink(missing_ok=True)
    init_db()


def teardown_module(module):
    engine.dispose()


def test_migrate_schema_supports_cross_version_upgrade(tmp_path: Path):
    db_path = tmp_path / "legacy.sqlite"
    legacy_engine = create_engine(f"sqlite:///{db_path}", future=True)
    LegacySession = sessionmaker(
        bind=legacy_engine,
        autoflush=False,
        autocommit=False,
        future=True,
    )
    with LegacySession() as db:
        db.execute(
            text(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    settings_json TEXT NOT NULL
                );
                """
            )
        )
        db.execute(
            text(
                """
                CREATE TABLE feeds (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    folder_id INTEGER,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    fetch_interval_min INTEGER NOT NULL DEFAULT 30,
                    last_fetch_at INTEGER NOT NULL DEFAULT 0,
                    last_status INTEGER NOT NULL DEFAULT 0,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    disabled BOOLEAN NOT NULL DEFAULT 0,
                    fulltext_enabled BOOLEAN NOT NULL DEFAULT 0,
                    cleanup_retention_days INTEGER NOT NULL DEFAULT 30,
                    cleanup_keep_content BOOLEAN NOT NULL DEFAULT 1,
                    image_cache_enabled BOOLEAN NOT NULL DEFAULT 0
                );
                """
            )
        )
        db.execute(
            text(
                """
                CREATE TABLE entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_id INTEGER NOT NULL,
                    guid TEXT,
                    url TEXT,
                    title TEXT NOT NULL,
                    author TEXT,
                    published_at INTEGER NOT NULL,
                    summary TEXT,
                    content_html TEXT,
                    content_text TEXT,
                    hash TEXT NOT NULL
                );
                """
            )
        )
        db.execute(
            text(
                """
                CREATE TABLE user_entry_state (
                    user_id INTEGER NOT NULL,
                    entry_id INTEGER NOT NULL,
                    is_read BOOLEAN NOT NULL DEFAULT 0,
                    is_starred BOOLEAN NOT NULL DEFAULT 0,
                    is_later BOOLEAN NOT NULL DEFAULT 0,
                    read_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (user_id, entry_id)
                );
                """
            )
        )
        db.execute(
            text(
                """
                INSERT INTO users (id, email, password_hash, settings_json)
                VALUES (:id, :email, :password_hash, :settings_json);
                """
            ),
            {
                "id": 1,
                "email": "legacy@example.com",
                "password_hash": "x",
                "settings_json": (
                    '{"default_fetch_interval_min":15,"fulltext_enabled":true,'
                    '"cleanup_retention_days":7,"cleanup_keep_content":false,'
                    '"image_cache_enabled":true}'
                ),
            },
        )
        db.execute(
            text(
                """
                INSERT INTO feeds (
                    id, user_id, title, url, fetch_interval_min, fulltext_enabled,
                    cleanup_retention_days, cleanup_keep_content, image_cache_enabled
                ) VALUES (
                    :id, :user_id, :title, :url,
                    :fetch_interval_min, :fulltext_enabled, :cleanup_retention_days,
                    :cleanup_keep_content, :image_cache_enabled
                );
                """
            ),
            {
                "id": 1,
                "user_id": 1,
                "title": "Legacy Feed",
                "url": "https://legacy.example.com/rss",
                "fetch_interval_min": 15,
                "fulltext_enabled": True,
                "cleanup_retention_days": 30,
                "cleanup_keep_content": True,
                "image_cache_enabled": False,
            },
        )
        db.execute(
            text(
                """
                INSERT INTO entries (
                    id, feed_id, guid, url, title, author, published_at,
                    summary, content_html, content_text, hash
                ) VALUES (
                    :id, :feed_id, :guid, :url,
                    :title, :author, :published_at,
                    :summary, :content_html, :content_text, :hash
                );
                """
            ),
            {
                "id": 1,
                "feed_id": 1,
                "guid": "legacy-1",
                "url": "https://legacy.example.com/post",
                "title": "Legacy title",
                "author": "legacy",
                "published_at": 1,
                "summary": "Legacy summary",
                "content_html": "<p>Legacy summary</p>",
                "content_text": "Legacy summary",
                "hash": "legacy-hash",
            },
        )
        db.commit()

    with LegacySession() as db:
        version = migrate_schema(db)
        db.commit()
        assert version == LATEST_SCHEMA_VERSION

    with LegacySession() as db:
        migration_version = db.execute(
            text("SELECT version FROM schema_migrations WHERE id = 1;")
        ).scalar_one()
        assert int(migration_version) == LATEST_SCHEMA_VERSION

        feed_row = db.execute(
            text(
                """
                SELECT
                    use_global_fetch_interval,
                    use_global_fulltext,
                    use_global_cleanup_retention,
                    use_global_cleanup_keep_content,
                    use_global_image_cache
                FROM feeds
                WHERE id = 1;
                """
            )
        ).fetchone()
        assert feed_row is not None
        assert int(feed_row[0]) == 1
        assert int(feed_row[1]) == 1
        assert int(feed_row[2]) == 0
        assert int(feed_row[3]) == 0
        assert int(feed_row[4]) == 0

        fts_count = db.execute(text("SELECT count(*) FROM entries_fts;")).scalar_one()
        assert int(fts_count) >= 1


def test_get_current_user_dependency():
    with SessionLocal() as db:
        user = User(email="dep@example.com", password_hash=hash_password("x"), settings_json="{}")
        db.add(user)
        db.commit()
        token = create_access_token("dep@example.com")
        resolved = get_current_user(token=token, db=db)
        assert resolved.email == "dep@example.com"


def test_rules_apply_filters_marks_read():
    with SessionLocal() as db:
        user = User(email="u@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        entry = Entry(
            feed_id=1,
            guid="g",
            url="u",
            title="Hello",
            author="A",
            published_at=1,
            summary="Summary",
            content_html=None,
            content_text="Summary",
            hash="h1",
        )
        db.add(entry)
        db.flush()
        db.add(UserEntryState(user_id=user.id, entry_id=entry.id))
        rule = FilterRule(
            user_id=user.id,
            name="AutoRead",
            enabled=True,
            priority=1,
            match_json=json.dumps({"keywords": ["hello"]}),
            actions_json=json.dumps({"mark_read": True}),
        )
        db.add(rule)
        db.commit()

        apply_filters(db, user.id, entry)
        db.commit()
        state = (
            db.query(UserEntryState)
            .filter(UserEntryState.user_id == user.id, UserEntryState.entry_id == entry.id)
            .first()
        )
        assert state.is_read is True


def test_rules_invalid_json_no_crash():
    with SessionLocal() as db:
        user = User(email="badjson@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        entry = Entry(
            feed_id=1,
            guid="g",
            url="u",
            title="Hello",
            author="A",
            published_at=1,
            summary="Summary",
            content_html=None,
            content_text="Summary",
            hash="h1b",
        )
        db.add(entry)
        db.flush()
        db.add(UserEntryState(user_id=user.id, entry_id=entry.id))
        rule = FilterRule(
            user_id=user.id,
            name="Bad",
            enabled=True,
            priority=1,
            match_json="not-json",
            actions_json="not-json",
        )
        db.add(rule)
        db.commit()

        apply_filters(db, user.id, entry)
        db.commit()


def test_services_and_fever_plugin():
    now_ts = int(time.time())
    with SessionLocal() as db:
        user = User(email="fever@example.com", password_hash="x", settings_json="{}")
        ConfigStore.set(user, "fever_username", "fever@example.com")
        ConfigStore.set(user, "fever_app_password", "app-pass")
        db.add(user)
        db.flush()

        folder = Folder(user_id=user.id, name="Tech", sort_order=0)
        db.add(folder)
        db.flush()

        feed1 = Feed(
            user_id=user.id,
            folder_id=folder.id,
            title="FeverFeed-1",
            url="https://example.com/rss-1",
            site_url="https://example.com",
            last_fetch_at=100,
        )
        feed2 = Feed(
            user_id=user.id,
            folder_id=None,
            title="FeverFeed-2",
            url="https://example.org/rss-2",
            site_url="https://example.org",
            last_fetch_at=80,
        )
        db.add(feed1)
        db.add(feed2)
        db.flush()

        icon_name = f"fever-{feed1.id}.gif"
        icon_file = favicon_cache_dir() / icon_name
        icon_file.parent.mkdir(parents=True, exist_ok=True)
        icon_file.write_bytes(
            base64.b64decode("R0lGODlhAQABAIAAAObm5gAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==")
        )
        feed1.icon_url = f"/api/cache/favicons/{icon_name}"

        old_entry = Entry(
            feed_id=feed1.id,
            guid="g-old",
            url="https://example.com/item-old",
            title="Entry Old",
            author="A",
            published_at=now_ts - 4000,
            summary="Summary Old",
            content_html="<p>Summary Old</p>",
            content_text="Summary Old",
            hash="h-old",
        )
        mid_entry = Entry(
            feed_id=feed2.id,
            guid="g-mid",
            url="https://example.org/item-mid",
            title="Entry Mid",
            author="B",
            published_at=now_ts - 2000,
            summary="Summary Mid",
            content_html="<p>Summary Mid</p>",
            content_text="Summary Mid",
            hash="h-mid",
        )
        new_entry = Entry(
            feed_id=feed2.id,
            guid="g-new",
            url="https://example.org/item-new",
            title="Entry New",
            author="C",
            published_at=now_ts - 100,
            summary="Summary New",
            content_html="<p>Summary New</p>",
            content_text="Summary New",
            hash="h-new",
        )
        db.add(old_entry)
        db.add(mid_entry)
        db.add(new_entry)
        db.flush()

        db.add(
            UserEntryState(
                user_id=user.id,
                entry_id=old_entry.id,
                is_read=False,
                is_starred=False,
                is_later=False,
                read_at=0,
            )
        )
        db.add(
            UserEntryState(
                user_id=user.id,
                entry_id=mid_entry.id,
                is_read=True,
                is_starred=True,
                is_later=False,
                read_at=now_ts - 60,
            )
        )
        db.add(
            UserEntryState(
                user_id=user.id,
                entry_id=new_entry.id,
                is_read=False,
                is_starred=False,
                is_later=False,
                read_at=0,
            )
        )
        db.commit()

    app = FastAPI()
    app.include_router(fever_plugin.router)
    client = TestClient(app)
    api_key = hashlib.md5("fever@example.com:app-pass".encode("utf-8")).hexdigest()

    response = client.post("/plugins/fever/?api", data={"api_key": "bad"})
    assert response.status_code == 200
    assert response.json() == {"api_version": 3, "auth": 0}

    response = client.post("/plugins/fever/?api", data={"api_key": api_key})
    assert response.status_code == 200
    assert response.json()["auth"] == 1
    assert response.json()["api_version"] == 3
    assert response.json()["last_refreshed_on_time"] == 100

    response = client.post("/plugins/fever/?api", data={"api_key": api_key, "items": "1"})
    assert response.status_code == 200
    assert "items" not in response.json()

    response = client.post("/plugins/fever/?api=xml", data={"api_key": api_key})
    assert response.status_code == 200
    assert "application/xml" in (response.headers.get("content-type") or "")
    assert "<response>" in response.text

    response = client.post("/plugins/fever/?api&groups", data={"api_key": api_key})
    assert response.status_code == 200
    groups_payload = response.json()
    assert "groups" in groups_payload
    assert "feeds_groups" in groups_payload
    assert groups_payload["groups"][0]["title"] == "Tech"
    assert groups_payload["feeds_groups"][0]["group_id"] > 0

    response = client.post("/plugins/fever/?api&feeds", data={"api_key": api_key})
    assert response.status_code == 200
    feeds_payload = response.json()
    assert "feeds" in feeds_payload
    assert "feeds_groups" in feeds_payload
    assert {"last_updated_on_time", "is_spark"}.issubset(feeds_payload["feeds"][0].keys())
    assert feeds_payload["feeds"][0]["favicon_id"] == feeds_payload["feeds"][0]["id"]

    response = client.post("/plugins/fever/?api&favicons", data={"api_key": api_key})
    assert response.status_code == 200
    favicons_payload = response.json()["favicons"]
    assert len(favicons_payload) == 2
    assert all({"id", "data"}.issubset(item.keys()) for item in favicons_payload)
    assert any(item["data"].startswith("image/") for item in favicons_payload)

    response = client.post("/plugins/fever/?api&items", data={"api_key": api_key})
    assert response.status_code == 200
    items_payload = response.json()
    assert items_payload["total_items"] == 3
    assert len(items_payload["items"]) <= 50
    assert {"id", "feed_id", "title", "author", "html", "url", "is_saved", "is_read", "created_on_time"}.issubset(
        items_payload["items"][0].keys()
    )
    newest_item_id = items_payload["items"][0]["id"]
    oldest_item_id = items_payload["items"][-1]["id"]

    response = client.post(
        f"/plugins/fever/?api&items&since_id={newest_item_id}",
        data={"api_key": api_key},
    )
    assert response.status_code == 200
    assert response.json()["items"] == []

    response = client.post(
        f"/plugins/fever/?api&items&max_id={oldest_item_id}",
        data={"api_key": api_key},
    )
    assert response.status_code == 200
    assert all(item["id"] <= oldest_item_id for item in response.json()["items"])

    response = client.post(
        f"/plugins/fever/?api&items&with_ids={oldest_item_id}",
        data={"api_key": api_key},
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [oldest_item_id]

    response = client.post("/plugins/fever/?api&links", data={"api_key": api_key})
    assert response.status_code == 200
    links = response.json()["links"]
    assert len(links) >= 1
    assert {"id", "feed_id", "item_id", "temperature", "is_item", "is_local", "is_saved", "title", "url", "item_ids"}.issubset(
        links[0].keys()
    )

    response = client.post("/plugins/fever/?api&saved_item_ids", data={"api_key": api_key})
    assert response.status_code == 200
    assert response.json()["saved_item_ids"] != ""

    response = client.post("/plugins/fever/?api&unread_item_ids", data={"api_key": api_key})
    assert response.status_code == 200
    assert response.json()["unread_item_ids"] != ""

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "mark": "item", "as": "saved", "id": str(newest_item_id)},
    )
    assert response.status_code == 200
    assert str(newest_item_id) in response.json()["saved_item_ids"]

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "mark": "item", "as": "unsaved", "id": str(newest_item_id)},
    )
    assert response.status_code == 200
    assert str(newest_item_id) not in response.json()["saved_item_ids"].split(",")

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "mark": "feed", "as": "read", "id": str(feeds_payload["feeds"][1]["id"]), "before": now_ts - 500},
    )
    assert response.status_code == 200
    assert str(newest_item_id) in response.json()["unread_item_ids"].split(",")

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "mark": "group", "as": "read", "id": "0", "before": now_ts},
    )
    assert response.status_code == 200
    assert response.json()["unread_item_ids"] == ""

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "mark": "group", "as": "read", "id": "-1", "before": now_ts},
    )
    assert response.status_code == 200
    assert response.json()["updated_count"] == 0

    response = client.post(
        "/plugins/fever/?api",
        data={"api_key": api_key, "unread_recently_read": "1"},
    )
    assert response.status_code == 200
    assert "unread_item_ids" in response.json()


def test_fever_route_not_shadowed_by_frontend_spa(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    dist = tmp_path / "frontend_dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "main.js").write_text("console.log('ok')", encoding="utf-8")

    monkeypatch.setattr("backend.static_mounts.frontend_dist", lambda: dist)

    app = FastAPI()
    app.include_router(fever_plugin.router)
    mount_frontend_static(app)

    client = TestClient(app)
    response = client.post("/plugins/fever/?api", data={})
    assert response.status_code == 200
    assert "auth" in response.json()


def test_frontend_spa_blocks_path_traversal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    dist = tmp_path / "frontend_dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    secret = tmp_path / "secret.txt"
    secret.write_text("secret", encoding="utf-8")

    monkeypatch.setattr("backend.static_mounts.frontend_dist", lambda: dist)

    app = FastAPI()
    mount_frontend_static(app)

    client = TestClient(app)
    response = client.get("/..%2Fsecret.txt")
    assert response.status_code == 404


def test_upsert_entries_adds_state():
    with SessionLocal() as db:
        user = User(email="u2@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(user_id=user.id, title="T", url="u", fetch_interval_min=1)
        db.add(feed)
        db.commit()
        parsed = feedparser.FeedParserDict(
            {
                "entries": [
                    {
                        "id": "1",
                        "link": "https://e.com/1",
                        "title": "Hello",
                        "summary": "Summary",
                    }
                ]
            }
        )
        added = upsert_entries(db, feed, parsed)
        db.commit()
        assert added == 1
        state = (
            db.query(UserEntryState)
            .filter(UserEntryState.user_id == user.id)
            .first()
        )
        assert state is not None


def test_iter_due_feeds():
    with SessionLocal() as db:
        user = User(email="feeds@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(user_id=user.id, title="T", url="u", fetch_interval_min=1)
        db.add(feed)
        db.commit()

        due = list(iter_due_feeds(db))
        assert any(f.id == feed.id for f in due)


def test_iter_due_feeds_does_not_auto_disable_on_errors():
    with SessionLocal() as db:
        user = User(email="feeds-no-disable@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(
            user_id=user.id,
            title="T",
            url="u",
            fetch_interval_min=1,
            error_count=12,
            disabled=False,
            last_fetch_at=0,
        )
        db.add(feed)
        db.commit()

        due = list(iter_due_feeds(db))
        db.refresh(feed)

        assert feed.disabled is False
        assert any(f.id == feed.id for f in due)


def test_collect_due_feed_ids_respects_limit():
    original_limit = settings.scheduler_max_feeds_per_tick
    object.__setattr__(settings, "scheduler_max_feeds_per_tick", 1)
    try:
        with SessionLocal() as db:
            user = User(email="feeds-limit@example.com", password_hash="x", settings_json="{}")
            db.add(user)
            db.flush()
            feed1 = Feed(user_id=user.id, title="T1", url="u1", fetch_interval_min=1)
            feed2 = Feed(user_id=user.id, title="T2", url="u2", fetch_interval_min=1)
            db.add(feed1)
            db.add(feed2)
            db.commit()
        feed_ids = _collect_due_feed_ids()
        assert len(feed_ids) == 1
    finally:
        object.__setattr__(settings, "scheduler_max_feeds_per_tick", original_limit)


def test_run_fetch_tick_dispatches_due_feed_ids(monkeypatch: pytest.MonkeyPatch):
    handled: list[int] = []
    monkeypatch.setattr("backend.scheduler._collect_due_feed_ids", lambda: [11, 22, 33])
    monkeypatch.setattr(
        "backend.scheduler.enqueue_feed_update",
        lambda feed_id: handled.append(feed_id) or True,
    )
    _run_fetch_tick()
    assert handled == [11, 22, 33]


def test_run_cleanup_tick_handles_failures(monkeypatch: pytest.MonkeyPatch):
    def _boom(_db):
        raise RuntimeError("cleanup fail")

    monkeypatch.setattr("backend.scheduler.cleanup_old_entries", _boom)
    _run_cleanup_tick()


def test_process_feed_error_increments(monkeypatch: pytest.MonkeyPatch):
    with SessionLocal() as db:
        user = User(email="err@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(user_id=user.id, title="T", url="u", fetch_interval_min=1)
        db.add(feed)
        db.commit()

        def _boom(_feed):
            raise RuntimeError("fail")

        monkeypatch.setattr("backend.fetcher.fetch_feed", _boom)
        process_feed(db, feed)
        db.commit()
        assert feed.error_count == 1


def test_process_feed_success(monkeypatch: pytest.MonkeyPatch):
    with SessionLocal() as db:
        user = User(email="ok@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(
            user_id=user.id,
            title="Old",
            url="u",
            fetch_interval_min=1,
            icon_url="/api/cache/favicons/old.svg",
        )
        db.add(feed)
        db.commit()

        def _fake_fetch(_feed):
            return feedparser.FeedParserDict(
                {
                    "feed": {"title": "New", "link": "https://site"},
                    "entries": [
                        {
                            "id": "1",
                            "link": "https://e.com/1",
                            "title": "Hello",
                            "summary": "Summary",
                        }
                    ],
                }
            )

        monkeypatch.setattr("backend.fetcher.fetch_feed", _fake_fetch)
        monkeypatch.setattr(
            "backend.fetcher.cache_site_favicon",
            lambda _source: "/api/cache/favicons/new.svg",
        )
        added = process_feed(db, feed)
        db.commit()
        assert added == 1
        assert feed.title == "New"
        assert feed.icon_url == "/api/cache/favicons/new.svg"


def test_process_feed_304_resets_error_count(monkeypatch: pytest.MonkeyPatch):
    with SessionLocal() as db:
        user = User(email="not-modified@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(
            user_id=user.id,
            title="Old",
            url="u",
            fetch_interval_min=1,
            error_count=3,
        )
        db.add(feed)
        db.commit()

        def _fake_fetch(_feed):
            _feed.last_status = 304
            return feedparser.FeedParserDict({"status": 304})

        monkeypatch.setattr("backend.fetcher.fetch_feed", _fake_fetch)
        added = process_feed(db, feed)
        db.commit()
        assert added == 0
        assert feed.last_status == 304
        assert feed.error_count == 0


def test_fetch_feed_handles_http_304_without_exception(monkeypatch: pytest.MonkeyPatch):
    feed = Feed(user_id=1, title="T", url="https://example.com/rss", fetch_interval_min=1)

    def _raise_304(_client, _url, *, headers=None):
        request = httpx.Request("GET", _url)
        response = httpx.Response(304, request=request)
        raise httpx.HTTPStatusError("Not Modified", request=request, response=response)

    monkeypatch.setattr("backend.fetcher.fetch_text_response", _raise_304)
    parsed = fetch_feed(feed)
    assert parsed.get("status") == 304
    assert feed.last_status == 304


def test_process_feed_icon_refresh_failure_is_ignored(monkeypatch: pytest.MonkeyPatch):
    with SessionLocal() as db:
        user = User(email="iconfail@example.com", password_hash="x", settings_json="{}")
        db.add(user)
        db.flush()
        feed = Feed(
            user_id=user.id,
            title="Old",
            url="u",
            fetch_interval_min=1,
            icon_url="/api/cache/favicons/old.svg",
        )
        db.add(feed)
        db.commit()

        def _fake_fetch(_feed):
            return feedparser.FeedParserDict(
                {
                    "feed": {"title": "New", "link": "https://site"},
                    "entries": [
                        {
                            "id": "1",
                            "link": "https://e.com/1",
                            "title": "Hello",
                            "summary": "Summary",
                        }
                    ],
                }
            )

        def _boom_icon(_source: str) -> str:
            raise RuntimeError("icon refresh failed")

        monkeypatch.setattr("backend.fetcher.fetch_feed", _fake_fetch)
        monkeypatch.setattr("backend.fetcher.cache_site_favicon", _boom_icon)
        added = process_feed(db, feed)
        db.commit()
        assert added == 1
        assert feed.icon_url == "/api/cache/favicons/old.svg"


def test_load_plugins_registers_routes(monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()

    class DummyPlugin:
        @staticmethod
        def register(inner_app):
            @inner_app.get("/dummy")
            def _dummy():
                return {"ok": True}

    sys.modules["backend.plugins.dummy.plugin"] = DummyPlugin

    monkeypatch.setattr("backend.plugin_loader.list_available_plugins", lambda: ["dummy"])
    load_plugins(app)
    client = TestClient(app)
    response = client.get("/dummy")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_start_scheduler_runs_and_stops():
    scheduler = start_scheduler()
    scheduler.shutdown()
    shutdown_feed_workers()


def test_shutdown_scheduler_instance_calls_non_blocking_shutdown():
    class DummyScheduler:
        def __init__(self):
            self.wait_value = None

        def shutdown(self, wait: bool = True):
            self.wait_value = wait

    dummy = DummyScheduler()
    app_main._shutdown_scheduler_instance(dummy)
    assert dummy.wait_value is False


def test_plugin_loader_defaults():
    original = settings.plugins
    try:
        object.__setattr__(settings, "plugins", "")
        assert list(iter_enabled_plugins()) == []
        object.__setattr__(settings, "plugins", "fever,fever,dummy")
        assert list(iter_enabled_plugins()) == ["fever", "dummy"]
    finally:
        object.__setattr__(settings, "plugins", original)


def test_text_extract_none():
    assert extract_fulltext(None) is None


def test_text_extract_success(monkeypatch: pytest.MonkeyPatch):
    class DummyDoc:
        def __init__(self, _html: str):
            pass

        def summary(self) -> str:
            return "<p>ok</p>"

    class DummyResponse:
        def __init__(self):
            self.encoding = "utf-8"
            self.headers = {"Content-Type": "text/html; charset=utf-8"}

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"<html></html>"

    class DummyStreamContext:
        def __enter__(self):
            return DummyResponse()

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyClient:
        def __init__(self, timeout: int, follow_redirects: bool):
            self.timeout = timeout
            self.follow_redirects = follow_redirects

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def stream(self, _method: str, _url: str, headers=None):
            return DummyStreamContext()

    monkeypatch.setattr("backend.text_extract.Document", DummyDoc)
    monkeypatch.setattr("backend.text_extract.httpx.Client", DummyClient)
    assert extract_fulltext("https://1.1.1.1/article") == "<p>ok</p>"


def test_format_fetch_error_friendly():
    message = format_fetch_error(httpx.RemoteProtocolError("peer closed connection"))
    assert "远程协议错误" in message


def test_cleanup_old_entries_removes_cached_images():
    with SessionLocal() as db:
        user = User(email="cleanup@example.com", password_hash="x", settings_json="{}")
        ConfigStore.set(user, "cleanup_retention_days", 1)
        db.add(user)
        db.flush()
        feed = Feed(user_id=user.id, title="CleanupFeed", url="https://example.com/rss")
        db.add(feed)
        db.flush()

        image_name = "cleanup-test.png"
        image_path = image_cache_dir() / image_name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(b"x")

        entry = Entry(
            feed_id=feed.id,
            guid="cleanup-1",
            url="https://example.com/cleanup-1",
            title="Cleanup Entry",
            author="A",
            published_at=1,
            summary=f'<p><img src="/api/cache/images/{image_name}" /></p>',
            content_html=f'<p><img src="/api/cache/images/{image_name}" /></p>',
            content_text="cleanup",
            hash="cleanup-hash-1",
        )
        db.add(entry)
        db.flush()
        db.add(UserEntryState(user_id=user.id, entry_id=entry.id))
        db.add(
            FetchLog(
                feed_id=feed.id,
                status=500,
                fetched_at=1,
                error_message="old-error",
            )
        )
        db.commit()

        result = cleanup_old_entries(db)
        db.commit()
        assert result["deleted_entries"] >= 1
        assert result["deleted_logs"] >= 1
        assert not image_path.exists()


def test_cache_site_favicon_falls_back_to_identicon(monkeypatch: pytest.MonkeyPatch):
    def _fail_remote(_url: str, _kind: str, require_image: bool = False):
        raise RuntimeError("network failed")

    monkeypatch.setattr("backend.cache_assets.cache_remote_asset", _fail_remote)
    icon_url = cache_site_favicon("https://www.Example.com/path")
    assert icon_url is not None
    assert icon_url.startswith("/api/cache/favicons/")

    file_path = favicon_cache_dir() / icon_url.rsplit("/", 1)[-1]
    assert file_path.exists()
    assert file_path.suffix == ".svg"
    assert "<svg" in file_path.read_text(encoding="utf-8")

    icon_url_2 = cache_site_favicon("https://example.com/other")
    assert icon_url_2 == icon_url


def test_cache_site_favicon_rejects_non_image(monkeypatch: pytest.MonkeyPatch):
    class DummyResponse:
        encoding = "utf-8"
        headers = {"Content-Type": "text/html; charset=utf-8"}

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"<!doctype html><html></html>"

    class DummyStreamContext:
        def __enter__(self):
            return DummyResponse()

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyClient:
        def __init__(self, timeout: int, follow_redirects: bool):
            self.timeout = timeout
            self.follow_redirects = follow_redirects

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def stream(self, _method: str, _url: str, headers=None):
            return DummyStreamContext()

    monkeypatch.setattr("backend.cache_assets.httpx.Client", DummyClient)
    icon_url = cache_site_favicon("https://non-image.example.com")
    assert icon_url is not None
    assert icon_url.endswith(".svg")
