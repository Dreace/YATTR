import os
import json
from pathlib import Path

import pytest

os.environ.setdefault("RSS_DB_URL", "sqlite:///./data/test.sqlite")
os.environ.setdefault("RSS_SECRET_KEY", "test-secret")
os.environ.setdefault("RSS_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("RSS_ADMIN_PASSWORD", "admin123")
os.environ.setdefault("RSS_TESTING", "true")

from fastapi.testclient import TestClient  # noqa: E402

from backend import main  # noqa: E402
from backend.db import SessionLocal, init_db, engine  # noqa: E402
from backend.models import Entry, FetchLog, Feed, UserEntryState  # noqa: E402

client = TestClient(main.app)


def _auth_headers() -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        data={"username": "admin@example.com", "password": "admin123"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_auth_refresh_logout_flow():
    client.cookies.clear()

    login_response = client.post(
        "/api/auth/login",
        data={"username": "admin@example.com", "password": "admin123"},
    )
    assert login_response.status_code == 200
    payload = login_response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] > 0
    assert payload["user"]["email"] == "admin@example.com"
    assert "refresh_token=" in (login_response.headers.get("set-cookie") or "")

    me_response = client.get(
        "/api/me",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert me_response.status_code == 200

    refresh_response = client.post("/api/auth/refresh")
    assert refresh_response.status_code == 200
    refreshed = refresh_response.json()
    assert refreshed["access_token"]
    assert refreshed["user"]["email"] == "admin@example.com"
    assert "refresh_token=" in (refresh_response.headers.get("set-cookie") or "")

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json()["ok"] is True

    refresh_after_logout = client.post("/api/auth/refresh")
    assert refresh_after_logout.status_code == 401


def test_auth_protected_endpoint_requires_bearer():
    client.cookies.clear()
    response = client.get("/api/feeds")
    assert response.status_code == 401


def setup_module(module):
    db_path = Path("data/test.sqlite")
    if db_path.exists():
        db_path.unlink(missing_ok=True)
    init_db()
    with SessionLocal() as db:
        main._get_or_create_admin(db)
    object.__setattr__(main.settings, "plugins", "fever")
    main.load_plugins(main.app)


def teardown_module(module):
    engine.dispose()
    db_path = Path("data/test.sqlite")
    if db_path.exists():
        db_path.unlink(missing_ok=True)


def test_api_key_and_folders():
    headers = _auth_headers()
    fever_settings = client.get("/plugins/fever/settings", headers=headers)
    assert fever_settings.status_code == 200
    payload = fever_settings.json()
    assert payload["plugin_id"] == "fever"
    values = {item["key"]: item["value"] for item in payload["items"]}
    assert values["username"]
    assert values["app_password"]
    assert values["api_key"]
    assert values["endpoint_path"] == "/plugins/fever/?api"
    assert str(values["endpoint_url"]).endswith("/plugins/fever/?api")
    fever_reset = client.post("/plugins/fever/settings/credentials/reset", headers=headers)
    assert fever_reset.status_code == 200
    reset_payload = fever_reset.json()
    reset_values = {item["key"]: item["value"] for item in reset_payload["items"]}
    assert reset_values["api_key"] != values["api_key"]

    response = client.post("/api/folders", headers=headers, json={"name": "Tech"})
    assert response.status_code == 200
    folder_id = response.json()["id"]

    response = client.get("/api/folders", headers=headers)
    assert response.status_code == 200
    assert any(f["id"] == folder_id for f in response.json())


def test_feeds_and_entries_flow():
    headers = _auth_headers()
    response = client.post(
        "/api/feeds",
        headers=headers,
        json={"title": "Example", "url": "https://example.com/rss"},
    )
    assert response.status_code == 200
    assert response.json()["icon_url"]
    feed_id = response.json()["id"]

    with SessionLocal() as db:
        admin = db.query(main.User).filter(main.User.email == "admin@example.com").first()
        entry = Entry(
            feed_id=feed_id,
            guid="1",
            url="https://example.com/1",
            title="Hello",
            author="A",
            published_at=1,
            summary="Summary",
            content_html="<p>Summary</p>",
            content_text="Summary",
            hash="hash1",
        )
        db.add(entry)
        db.flush()
        db.add(
            UserEntryState(
                user_id=admin.id,
                entry_id=entry.id,
                is_read=False,
                is_starred=False,
                is_later=False,
                read_at=0,
            )
        )
        db.commit()

    response = client.get("/api/entries", headers=headers)
    assert response.status_code == 200
    assert response.json()["items"][0]["title"] == "Hello"
    assert "has_more" in response.json()
    assert "current_page" in response.json()
    assert "total_pages" in response.json()

    entry_id = response.json()["items"][0]["id"]
    response = client.post(f"/api/entries/{entry_id}/read", headers=headers)
    assert response.status_code == 200

    response = client.post(f"/api/entries/{entry_id}/star", headers=headers)
    assert response.status_code == 200

    response = client.post(f"/api/entries/{entry_id}/later", headers=headers)
    assert response.status_code == 200

    response = client.post(
        "/api/entries/batch",
        headers=headers,
        json={"entry_ids": [entry_id], "is_read": False},
    )
    assert response.status_code == 200

    response = client.get(f"/api/entries/{entry_id}", headers=headers)
    assert response.status_code == 200


def test_feed_update_delete_and_fetch(monkeypatch: pytest.MonkeyPatch):
    headers = _auth_headers()
    response = client.post(
        "/api/feeds",
        headers=headers,
        json={
            "title": "Temp",
            "url": "https://example.com/rss",
            "site_url": "https://example.com",
        },
    )
    assert response.status_code == 200
    assert response.json()["site_url"] == "https://example.com"
    feed_id = response.json()["id"]

    monkeypatch.setattr(
        main,
        "cache_site_favicon",
        lambda _site_url: "/api/cache/favicons/updated-icon.svg",
    )
    response = client.put(
        f"/api/feeds/{feed_id}",
        headers=headers,
        json={
            "title": "Updated",
            "url": "https://example.com/rss",
            "site_url": "https://example.com/home",
            "fetch_interval_min": 5,
            "fulltext_enabled": True,
            "cleanup_retention_days": 90,
            "cleanup_keep_content": False,
            "image_cache_enabled": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["site_url"] == "https://example.com/home"
    assert response.json()["fulltext_enabled"] is True
    assert response.json()["cleanup_retention_days"] == 90
    assert response.json()["cleanup_keep_content"] is False
    assert response.json()["image_cache_enabled"] is True
    assert response.json()["icon_url"] == "/api/cache/favicons/updated-icon.svg"

    monkeypatch.setattr(main, "process_feed", lambda db, feed: 0)
    response = client.post(f"/api/feeds/{feed_id}/fetch", headers=headers)
    assert response.status_code == 200

    response = client.delete(f"/api/feeds/{feed_id}", headers=headers)
    assert response.status_code == 200


def test_search_and_filters():
    headers = _auth_headers()
    response = client.get("/api/search?q=Summary", headers=headers)
    assert response.status_code == 200

    response = client.post(
        "/api/filters",
        headers=headers,
        json={
            "name": "AutoRead",
            "enabled": True,
            "priority": 1,
            "match_json": json.dumps({"keywords": ["hello"]}),
            "actions_json": json.dumps({"mark_read": True}),
        },
    )
    assert response.status_code == 200


def test_opml_roundtrip():
    headers = _auth_headers()
    opml_path = Path(__file__).resolve().parents[2] / "tt-rss_dreace_2026-02-05.opml"
    opml_content = opml_path.read_bytes()
    response = client.post(
        "/api/opml/import",
        headers=headers,
        files={"file": (opml_path.name, opml_content, "text/xml")},
    )
    assert response.status_code == 200

    response = client.get("/api/opml/export", headers=headers)
    assert response.status_code == 200
    assert "content" in response.json()


def test_opml_import_with_folder_mapping():
    headers = _auth_headers()
    opml = b"""<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="Tech">
      <outline text="Example" type="rss" xmlUrl="https://example.com/rss"/>
    </outline>
  </body>
</opml>
"""
    response = client.post(
        "/api/opml/import",
        headers=headers,
        files={"file": ("sample.opml", opml, "text/xml")},
    )
    assert response.status_code == 200

    folders = client.get("/api/folders", headers=headers)
    assert folders.status_code == 200
    tech = next((item for item in folders.json() if item["name"] == "Tech"), None)
    assert tech is not None

    feeds = client.get("/api/feeds", headers=headers)
    assert feeds.status_code == 200
    assert any(
        item["url"] == "https://example.com/rss" and item["folder_id"] == tech["id"]
        for item in feeds.json()
    )


def test_fetch_logs_and_health():
    headers = _auth_headers()
    with SessionLocal() as db:
        admin = db.query(main.User).filter(main.User.email == "admin@example.com").first()
        feed = Feed(user_id=admin.id, title="LogFeed", url="https://example.com/rss")
        db.add(feed)
        db.flush()
        feed_id = feed.id
        db.add(
            FetchLog(
                feed_id=feed_id,
                status=200,
                fetched_at=1,
                error_message=None,
            )
        )
        db.commit()

    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    response = client.get("/api/fetch/logs", headers=headers)
    assert response.status_code == 200
    assert any(log["feed_id"] == feed_id for log in response.json())


def test_entries_pagination_sort_and_unread_counts():
    headers = _auth_headers()
    response = client.post(
        "/api/feeds",
        headers=headers,
        json={"title": "Paged", "url": "https://example.com/paged.xml"},
    )
    assert response.status_code == 200
    feed_id = response.json()["id"]

    with SessionLocal() as db:
        admin = db.query(main.User).filter(main.User.email == "admin@example.com").first()
        entry_rows = [
            Entry(
                feed_id=feed_id,
                guid="p1",
                url="https://example.com/p1",
                title="Bravo",
                author="A",
                published_at=100,
                summary="S1",
                content_html="<p>S1</p>",
                content_text="S1",
                hash="paged-hash-1",
            ),
            Entry(
                feed_id=feed_id,
                guid="p2",
                url="https://example.com/p2",
                title="Alpha",
                author="A",
                published_at=300,
                summary="S2",
                content_html="<p>S2</p>",
                content_text="S2",
                hash="paged-hash-2",
            ),
            Entry(
                feed_id=feed_id,
                guid="p3",
                url="https://example.com/p3",
                title="Charlie",
                author="A",
                published_at=200,
                summary="S3",
                content_html="<p>S3</p>",
                content_text="S3",
                hash="paged-hash-3",
            ),
        ]
        db.add_all(entry_rows)
        db.flush()
        db.add_all(
            [
                UserEntryState(
                    user_id=admin.id,
                    entry_id=entry_rows[0].id,
                    is_read=False,
                    is_starred=False,
                    is_later=False,
                    read_at=0,
                ),
                UserEntryState(
                    user_id=admin.id,
                    entry_id=entry_rows[1].id,
                    is_read=True,
                    is_starred=False,
                    is_later=False,
                    read_at=0,
                ),
                UserEntryState(
                    user_id=admin.id,
                    entry_id=entry_rows[2].id,
                    is_read=False,
                    is_starred=False,
                    is_later=False,
                    read_at=0,
                ),
            ]
        )
        db.commit()

    by_time = client.get(
        f"/api/entries?feedId={feed_id}&page=1&page_size=2&sort_by=updated",
        headers=headers,
    )
    assert by_time.status_code == 200
    assert by_time.json()["current_page"] == 1
    assert by_time.json()["total_pages"] == 2
    assert by_time.json()["total_items"] == 3
    assert [item["title"] for item in by_time.json()["items"]] == ["Alpha", "Charlie"]

    by_title = client.get(
        f"/api/entries?feedId={feed_id}&page=1&page_size=5&sort_by=title",
        headers=headers,
    )
    assert by_title.status_code == 200
    assert [item["title"] for item in by_title.json()["items"]] == [
        "Alpha",
        "Bravo",
        "Charlie",
    ]

    unread_counts = client.get("/api/feeds/unread_counts", headers=headers)
    assert unread_counts.status_code == 200
    assert any(
        row["feed_id"] == feed_id and row["unread_count"] == 2
        for row in unread_counts.json()
    )


def test_folder_crud_and_settings_general():
    headers = _auth_headers()
    created = client.post(
        "/api/folders",
        headers=headers,
        json={"name": "News", "sort_order": 1},
    )
    assert created.status_code == 200
    folder_id = created.json()["id"]

    updated = client.put(
        f"/api/folders/{folder_id}",
        headers=headers,
        json={"name": "News 2", "sort_order": 2},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "News 2"

    settings_get = client.get("/api/settings/general", headers=headers)
    assert settings_get.status_code == 200
    assert "default_fetch_interval_min" in settings_get.json()
    assert settings_get.json()["time_format"] == "YYYY-MM-DD HH:mm:ss"

    settings_put = client.put(
        "/api/settings/general",
        headers=headers,
        json={
            "default_fetch_interval_min": 45,
            "fulltext_enabled": True,
            "cleanup_retention_days": 120,
            "cleanup_keep_content": False,
            "image_cache_enabled": True,
            "auto_refresh_interval_sec": 30,
            "time_format": "YYYY/MM/DD HH:mm",
        },
    )
    assert settings_put.status_code == 200
    assert settings_put.json()["default_fetch_interval_min"] == 45
    assert settings_put.json()["fulltext_enabled"] is True
    assert settings_put.json()["image_cache_enabled"] is True
    assert settings_put.json()["auto_refresh_interval_sec"] == 30
    assert settings_put.json()["time_format"] == "YYYY/MM/DD HH:mm"

    deleted = client.delete(f"/api/folders/{folder_id}", headers=headers)
    assert deleted.status_code == 200


def test_plugin_settings_endpoints():
    headers = _auth_headers()

    got = client.get("/api/settings/plugins", headers=headers)
    assert got.status_code == 200
    assert "available" in got.json()
    assert "enabled" in got.json()

    updated = client.put(
        "/api/settings/plugins",
        headers=headers,
        json={"enabled": ["fever"]},
    )
    assert updated.status_code == 200
    assert "fever" in updated.json()["enabled"]


def test_plugin_settings_keep_env_baseline():
    headers = _auth_headers()
    with SessionLocal() as db:
        admin = db.query(main.User).filter(main.User.email == "admin@example.com").first()
        assert admin is not None
        main.ConfigStore.set(admin, "enabled_plugins", [])
        db.commit()

    got = client.get("/api/settings/plugins", headers=headers)
    assert got.status_code == 200
    assert "fever" in got.json()["enabled"]

    fever_settings = client.get("/plugins/fever/settings", headers=headers)
    assert fever_settings.status_code == 200


def test_search_scope():
    headers = _auth_headers()
    response = client.get("/api/search?q=Summary&scope=title", headers=headers)
    assert response.status_code == 200

    response = client.get("/api/search?q=Summary&scope=invalid", headers=headers)
    assert response.status_code == 400


def test_validate_feed_url(monkeypatch: pytest.MonkeyPatch):
    class DummyResponse:
        status_code = 200
        encoding = "utf-8"
        headers = {"Content-Type": "application/rss+xml"}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self):
            yield b"<rss><channel><title>Demo</title><item><title>Item</title></item></channel></rss>"

    class DummyStreamContext:
        async def __aenter__(self):
            return DummyResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class DummyAsyncClient:
        def __init__(self, timeout: int, follow_redirects: bool):
            self.timeout = timeout
            self.follow_redirects = follow_redirects

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, _method: str, _url: str, headers=None):
            return DummyStreamContext()

    monkeypatch.setattr(main.httpx, "AsyncClient", DummyAsyncClient)
    headers = _auth_headers()
    response = client.post(
        "/api/feeds/validate",
        headers=headers,
        json={"url": "https://1.1.1.1/rss"},
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_validate_feed_url_reject_private_host():
    headers = _auth_headers()
    response = client.post(
        "/api/feeds/validate",
        headers=headers,
        json={"url": "http://127.0.0.1/rss"},
    )
    assert response.status_code == 400
    assert "受保护网段" in response.json()["detail"]


def test_debug_refresh_and_logs(monkeypatch: pytest.MonkeyPatch):
    headers = _auth_headers()
    response = client.post(
        "/api/feeds",
        headers=headers,
        json={"title": "Debug", "url": "https://example.com/rss"},
    )
    assert response.status_code == 200
    feed_id = response.json()["id"]

    monkeypatch.setattr(main, "process_feed", lambda db, feed: 2)
    refresh = client.post(f"/api/debug/feeds/{feed_id}/refresh", headers=headers)
    assert refresh.status_code == 200
    assert refresh.json()["ok"] is True
    assert refresh.json()["added"] == 2

    logs = client.get(f"/api/debug/feeds/{feed_id}/logs", headers=headers)
    assert logs.status_code == 200

    with SessionLocal() as db:
        entry = Entry(
            feed_id=feed_id,
            guid="debug-1",
            url="https://example.com/debug-1",
            title="Debug Entry",
            author="dbg",
            published_at=1000,
            summary="debug summary",
            content_html="<p>debug html</p>",
            content_text="debug text",
            hash="debug-hash-1",
        )
        db.add(entry)
        db.commit()

    preview = client.get(f"/api/debug/feeds/{feed_id}/entries", headers=headers)
    assert preview.status_code == 200
    assert preview.json()[0]["title"] == "Debug Entry"
    assert preview.json()[0]["content_html"] == "<p>debug html</p>"


def test_background_fetch_endpoints(monkeypatch: pytest.MonkeyPatch):
    headers = _auth_headers()
    response = client.post(
        "/api/feeds",
        headers=headers,
        json={"title": "BgFetch", "url": "https://example.com/rss"},
    )
    assert response.status_code == 200
    feed_id = response.json()["id"]

    monkeypatch.setattr(main, "_process_feed_in_background", lambda feed_id, user_id: None)

    queued_fetch = client.post(
        f"/api/feeds/{feed_id}/fetch?background=true",
        headers=headers,
    )
    assert queued_fetch.status_code == 200
    assert queued_fetch.json()["queued"] is True

    queued_debug = client.post(
        f"/api/debug/feeds/{feed_id}/refresh?background=true",
        headers=headers,
    )
    assert queued_debug.status_code == 200
    assert queued_debug.json()["queued"] is True
