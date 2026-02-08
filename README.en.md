# YATTR · Yet Another Tiny Tiny RSS

[简体中文](README.md)

**YATTR** is a **single-user, web-first** RSS reader focused on:

- self-hosting
- lightweight runtime
- reading experience
- Fever API compatibility (for mainstream RSS clients)

This document covers **deployment, login, and daily usage**.
For architecture and development details, see `docs/development.en.md`.

---

## 1. Quick Start (Recommended)

### 1.1 Create `.env`

Create a `.env` file in the project root with at least:

```env
RSS_SECRET_KEY=change_me
RSS_ADMIN_EMAIL=your_email
RSS_ADMIN_PASSWORD=your_password
RSS_DB_URL=sqlite:///./data/rss.sqlite
```

Notes:

- The app currently uses a **single-admin mode**.
- User registration is not supported.
- Existing users are not overwritten by `.env` password changes.
- In production, `RSS_SECRET_KEY` and `RSS_ADMIN_PASSWORD` cannot stay as `change_me`; otherwise backend startup is blocked.

---

### 1.2 Single-container Deployment (Simplest)

```bash
docker compose -f docker-compose.single.yml up --build
```

Access:

```text
http://localhost:8001
```

---

## 2. Other Deployment Modes

### 2.1 Split Frontend/Backend (Docker)

```bash
docker compose up --build
```

Access:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:8000](http://localhost:8000)

---

### 2.2 Use Remote Image

```bash
docker compose -f docker-compose.remote.yml up -d
```

Useful when you do not need local builds.

---

### 2.3 Run Locally (Windows)

#### Backend

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

#### Frontend

1. Configure `frontend/.env.local`

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

2. Start frontend

```bash
cd frontend
npm.cmd install
npm.cmd run dev
```

3. Open:

```text
http://localhost:5173
```

---

## 3. Login and First-time Flow

1. Open `/`, unauthenticated users are redirected to `/login`.
2. Sign in with admin credentials from `.env`.
3. Recommended first steps:
- Add a feed from the left panel with RSS/Atom URL.
- Optionally import OPML from Settings.
- Start reading from Unread or All.

---

## 4. Daily Usage

### 4.1 Feed Management

- Add feeds with URL validation.
- Feed context menu supports:
- Edit
- Debug
- Delete
- Feed-level options include:
- Fetch interval
- Full-text extraction
- Retention policy
- Image cache

---

### 4.2 Reading Operations

**Middle pane**

- Filter / sort / search / pagination
- Batch actions:
- Mark current page as read
- Mark all as read
- Mark selected as read

**Right pane (entry actions)**

- Read/unread toggle
- Star
- Read later
- Open original link

**Keyboard shortcuts**

| Key | Action |
| -- | -- |
| `j` | Next |
| `k` | Previous |
| `m` | Toggle read |
| `s` | Toggle star |
| `t` | Toggle later |
| `o` | Open original |

---

### 4.3 Settings and Debug

**Settings panel**

- Global fetch/cleanup policy
- Time format (DB uses UTC timestamp; UI renders in browser timezone)
- Language switch (简体中文 / English / System)
- Auto refresh (seconds, `0` means off)
- OPML import/export
- System health (`/api/health`)
- Plugin management
- All plugins are disabled by default
- Enabling from settings is effective immediately (no restart needed)

**Debug panel**

- Trigger one feed fetch manually
- View fetch logs and errors
- Preview fetched result

---

## 5. Fever Client Support

Compatible with Fever clients like Reeder, Fiery Feeds, and ReadKit.

Steps:

1. Sign in on Web.
2. Enable `fever` in Settings -> Plugin Management.
3. Open Fever plugin settings and get:
- `username`
- `app_password`
- `api_key`
- `endpoint_url`
4. Fill these values in your Fever client.

Fever endpoint:

```text
/plugins/fever/?api
```

---

## 6. FAQ

### 6.1 Login failed

- Check admin email/password in `.env`.
- Existing users are not auto-updated by `.env` changes.

---

### 6.2 Frontend request failed / CORS

- Ensure `VITE_API_BASE_URL` points to the correct backend.
- Check CORS settings in `docs/development.en.md`.

---

### 6.3 Single-container service unreachable

- Exposed host port is **8001**.
- Check container status:

```bash
docker compose -f docker-compose.single.yml ps
```

---

## 7. GitHub Actions: Docker Auto Build

Workflow file:

```text
.github/workflows/docker-publish.yml
```

### Triggers

- push to `main`
- push tags matching `v*` (for example `v1.0.0`)
- manual trigger

### Required Secrets

Path:

```text
Settings -> Secrets and variables -> Actions
```

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Optional variable:

- `DOCKERHUB_REPOSITORY` (defaults to GitHub repository name)

### Image Tag Strategy

- `latest`
- branch name
- Git tag (for example `v1.0.0`)
- `sha-<short_sha>`
