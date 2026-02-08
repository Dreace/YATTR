# YATTR Development Guide

[简体中文](development.md)

This document is for developers and covers implementation details, APIs, config, and testing.
For end-user usage, see `../README.en.md`.

## 1. Stack and Layout

- Backend: FastAPI + SQLAlchemy + SQLite
- Frontend: React + Vite + TypeScript
- Scheduler: APScheduler
- Plugin system: directory discovery + dynamic loading (currently includes `fever`)
- Backend routing: feature routers live in `backend/api/*.py`; `backend/main.py` keeps app assembly and feed workflow

Main directories:

- `backend/`: backend source
- `frontend/`: frontend source
- `docker-compose.single.yml`: single-container mode (backend serves frontend static assets)
- `docker-compose.yml`: split frontend/backend mode

## 2. Runtime Model

### 2.1 App startup

`backend/main.py` startup sequence:

1. `_configure_runtime_logging()` (includes filename and line number in logs)
2. `ensure_secure_runtime_settings()` (blocks default insecure credentials in production)
3. `init_db()`
4. `_get_or_create_admin()` creates/loads admin user
5. `apply_plugin_settings_to_runtime(admin)` syncs enabled plugins from user settings
6. `load_plugins(app)` always loads discoverable plugins, so enabling in settings works without restart
7. `mount_frontend_static(app)` (active when `backend/frontend_dist` exists)
8. Start scheduler when not in testing mode

### 2.2 Static mounts

- `/api/cache/images`: cached images
- `/api/cache/favicons`: cached favicons
- `/assets` and `/`: frontend assets (when build output exists)
- SPA fallback strictly verifies resolved path stays under `frontend_dist` to prevent path traversal

### 2.3 Auth and security boundary

- `/api/auth/*` is anonymous (login/refresh/logout)
- Other `/api/*` business routes require JWT (`get_current_user`)
- `/api/health` and `/api/fetch/logs` are authenticated
- Fever data endpoints use `api_key` protocol auth; Fever settings endpoints use JWT auth

## 3. Backend API (Current)

### 3.1 Authentication

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`

Auth model:

- Access token (Bearer)
- Refresh token (HttpOnly Cookie)

Constraint:

- Except `POST /api/auth/login|refresh|logout`, business routes should use `get_current_user`

### 3.2 Settings

- `GET /api/settings/general`
- `PUT /api/settings/general`
- `GET /api/settings/plugins`
- `PUT /api/settings/plugins`

### 3.3 Folders and feeds

- `GET /api/folders`
- `POST /api/folders`
- `PUT /api/folders/{folder_id}`
- `DELETE /api/folders/{folder_id}`
- `GET /api/feeds`
- `POST /api/feeds/validate`
- `POST /api/feeds`
- `PUT /api/feeds/{feed_id}`
- `DELETE /api/feeds/{feed_id}`
- `GET /api/feeds/unread_counts`
- `POST /api/feeds/{feed_id}/fetch`

### 3.4 Entries and search

- `GET /api/entries`
- `GET /api/entries/{entry_id}`
- `POST /api/entries/{entry_id}/read`
- `POST /api/entries/{entry_id}/unread`
- `POST /api/entries/{entry_id}/star`
- `POST /api/entries/{entry_id}/unstar`
- `POST /api/entries/{entry_id}/later`
- `POST /api/entries/{entry_id}/unlater`
- `POST /api/entries/batch`
- `GET /api/search`

### 3.5 Other endpoints

- `GET /api/filters`
- `POST /api/filters`
- `POST /api/opml/import`
- `GET /api/opml/export`
- `POST /api/debug/feeds/{feed_id}/refresh`
- `GET /api/debug/feeds/{feed_id}/logs`
- `GET /api/debug/feeds/{feed_id}/entries`
- `GET /api/health`
- `GET /api/fetch/logs`

## 4. Fever Plugin (Current)

Plugin file: `backend/plugins/fever/plugin.py`

### 4.1 Routes and entrypoints

- Fever API entry:
- `POST /plugins/fever`
- `POST /plugins/fever/`
- Recommended path returned by plugin settings:
- `/plugins/fever/?api`
- Plugin settings endpoints:
- `GET /plugins/fever/settings`
- `POST /plugins/fever/settings/credentials/reset`

### 4.2 Authentication and base payload

- API key auth via `md5(username:app_password)`
- Base fields:
- `api_version` (currently `3`)
- `auth` (`0`/`1`)
- `last_refreshed_on_time` on successful auth

### 4.3 Implemented read actions

- `groups`
- `feeds`
- `favicons`
- `items`
- `links`
- `unread_item_ids`
- `saved_item_ids`

Supported params:

- `items`: `since_id`, `max_id`, `with_ids` (up to 50)
- `links`: `offset`, `range`, `page`

### 4.4 Implemented write actions

- `unread_recently_read=1`
- `mark=item`:
- `as=read` / `unread`
- `as=saved` / `starred` / `fav`
- `as=unsaved` / `unstarred` / `unfav`
- `mark=feed&as=read&id=...&before=...`
- `mark=group&as=read&id=...&before=...`

Return fields:

- read/unread/feed/group: `unread_item_ids` + `updated_count`
- saved/unsaved: `saved_item_ids` + `updated_count`

### 4.5 Current limitations

- Fever routes currently implement only `POST`
- Unknown actions return base payload or `error` field (no 500)
- `is_spark` is fixed to `0` in `feeds`
- For `mark=group`:
- `id=0`: all feeds
- `id=-1`: currently empty set

## 5. Configuration

Config source: `backend/config.py`

Auth and session:

- `RSS_SECRET_KEY`
- `RSS_ADMIN_EMAIL`
- `RSS_ADMIN_PASSWORD`
- `RSS_AUTH_ACCESS_TOKEN_MINUTES`
- `RSS_AUTH_REFRESH_TOKEN_DAYS`
- `RSS_AUTH_COOKIE_SECURE`
- `RSS_AUTH_COOKIE_SAMESITE`
- `RSS_AUTH_COOKIE_DOMAIN`

Database and plugins:

- `RSS_DB_URL`

Plugin enablement:

- Plugin enablement is no longer controlled by env vars
- Runtime enablement comes from `PUT /api/settings/plugins` (stored in user settings)
- `load_plugins(app)` loads all discoverable plugins; enable/disable only controls availability

CORS:

- `RSS_CORS_ORIGINS`
- `RSS_CORS_ALLOW_ORIGIN_REGEX`
- `RSS_CORS_ALLOW_CREDENTIALS`

Scheduler:

- `RSS_SCHEDULER_FETCH_INTERVAL_MIN`
- `RSS_SCHEDULER_CLEANUP_INTERVAL_MIN`
- `RSS_SCHEDULER_MAX_FEEDS_PER_TICK`

Network safety:

- `RSS_NETWORK_BLOCK_PRIVATE`
- `RSS_NETWORK_MAX_RESPONSE_BYTES`

Frontend API base override:

- `VITE_API_BASE_URL`
- `REACT_APP_API_BASE_URL`

`.env` load order:

1. Current working directory `.env`
2. `backend/.env`
3. Repository root `.env`

## 6. Database Migration Rules

Database migrations are centrally managed in `backend/db.py` with these rules:

1. **Versioned only**: all schema changes must be versioned in `schema_migrations.version`; no manual-only table edits.
2. **Cross-version upgrade**: old databases must be able to upgrade directly to latest by running ordered migration steps.
3. **Auto on startup**: pending migrations are executed during `init_db()`.
4. **Idempotent**: each migration step should be repeatable safely.
5. **Data backfill included**: semantic field changes require migration-time backfill.
6. **Indexes and FTS covered**: schema-dependent query objects must be migrated and usable after upgrade.

Current implementation:

- Version table: `schema_migrations` (fixed `id=1`, stores current version)
- Migration entry: `migrate_schema(db)`
- Startup execution: called from `init_db()`
- Latest version constant: `LATEST_SCHEMA_VERSION`

Submission requirements:

1. Add migration steps and update `LATEST_SCHEMA_VERSION`
2. Add/update tests for at least:
- upgrading old schema to latest
- key backfill/query capability (for example FTS)
3. Run backend tests in project venv and ensure pass

## 7. Development and Testing

Backend (Windows):

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m pytest -q
```

Frontend (Windows):

```bash
cd frontend
npm.cmd install
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## 8. Docker Notes

### 8.1 Single container

- Compose: `docker-compose.single.yml`
- Host port: `8001`
- Container port: `8000`
- `Dockerfile.single` copies frontend build output to `backend/frontend_dist`
- `Dockerfile.single` uses `uv` + cache mount for faster Python dependency installation

### 8.2 Split frontend/backend

- Compose: `docker-compose.yml`
- Backend: `8000`
- Frontend: `5173` (Vite dev server)
