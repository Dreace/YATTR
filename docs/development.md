# YATTR 开发说明

本文件面向开发者，记录实现细节、接口、配置和测试方式。  
用户使用说明请看：`README.md`。

## 1. 技术栈与目录

- 后端：FastAPI + SQLAlchemy + SQLite
- 前端：React + Vite + TypeScript
- 调度：APScheduler
- 插件：目录扫描 + 动态加载（当前内置 `fever`）

目录：

- `backend/`：后端代码
- `frontend/`：前端代码
- `docker-compose.single.yml`：单容器部署（后端托管前端静态文件）
- `docker-compose.yml`：前后端分离部署

## 2. 运行模型

### 2.1 应用启动

`backend/main.py` 启动流程：

1. `init_db()`
2. `_get_or_create_admin()` 创建/读取管理员
3. 读取插件启用配置并 `load_plugins(app)`
4. `mount_frontend_static(app)`（存在 `backend/frontend_dist` 时生效）
5. 非测试模式启动 scheduler

### 2.2 静态资源挂载

- `/api/cache/images`：图片缓存
- `/api/cache/favicons`：favicon 缓存
- `/assets` 与 `/`：前端静态资源（仅在构建产物存在时）

## 3. 后端 API（当前实现）

### 3.1 认证

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`

当前认证模型：

- Access Token（Bearer）
- Refresh Token（HttpOnly Cookie）

### 3.2 设置

- `GET /api/settings/general`
- `PUT /api/settings/general`
- `GET /api/settings/plugins`
- `PUT /api/settings/plugins`

### 3.3 分组与订阅

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

### 3.4 文章与搜索

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

### 3.5 其他接口

- `GET /api/filters`
- `POST /api/filters`
- `POST /api/opml/import`
- `GET /api/opml/export`
- `POST /api/debug/feeds/{feed_id}/refresh`
- `GET /api/debug/feeds/{feed_id}/logs`
- `GET /api/debug/feeds/{feed_id}/entries`
- `GET /api/health`
- `GET /api/fetch/logs`

## 4. Fever 插件（当前实现）

插件文件：`backend/plugins/fever/plugin.py`

### 4.1 路径与入口

- Fever 请求入口：
  - `POST /plugins/fever`
  - `POST /plugins/fever/`
- 推荐路径（插件设置接口返回）：
  - `/plugins/fever/?api`
- 插件设置接口：
  - `GET /plugins/fever/settings`
  - `POST /plugins/fever/settings/credentials/reset`

### 4.2 鉴权和基础响应

- 通过 `api_key` 鉴权（`md5(username:app_password)`）
- 基础字段：
  - `api_version`（当前为 3）
  - `auth`（0/1）
  - 登录成功时返回 `last_refreshed_on_time`

### 4.3 已实现读取动作

- `groups`
- `feeds`
- `favicons`
- `items`
- `links`
- `unread_item_ids`
- `saved_item_ids`

参数支持：

- `items`：`since_id`、`max_id`、`with_ids`（最多 50）
- `links`：`offset`、`range`、`page`

### 4.4 已实现写入动作

- `unread_recently_read=1`
- `mark=item`：
  - `as=read` / `unread`
  - `as=saved` / `starred` / `fav`
  - `as=unsaved` / `unstarred` / `unfav`
- `mark=feed&as=read&id=...&before=...`
- `mark=group&as=read&id=...&before=...`

返回：

- read/unread/feed/group：`unread_item_ids` + `updated_count`
- saved/unsaved：`saved_item_ids` + `updated_count`

### 4.5 当前限制

- Fever 路由仅实现 `POST`
- 未识别动作返回基础响应或 `error` 字段，不抛 500
- `feeds` 中 `is_spark` 固定为 `0`
- `mark=group` 时：
  - `id=0`：按所有 feed 处理
  - `id=-1`：当前为空集合

## 5. 配置项

配置入口：`backend/config.py`

认证与会话：

- `RSS_SECRET_KEY`
- `RSS_ADMIN_EMAIL`
- `RSS_ADMIN_PASSWORD`
- `RSS_AUTH_ACCESS_TOKEN_MINUTES`
- `RSS_AUTH_REFRESH_TOKEN_DAYS`
- `RSS_AUTH_COOKIE_SECURE`
- `RSS_AUTH_COOKIE_SAMESITE`
- `RSS_AUTH_COOKIE_DOMAIN`

数据库与插件：

- `RSS_DB_URL`
- `RSS_PLUGINS`

CORS：

- `RSS_CORS_ORIGINS`
- `RSS_CORS_ALLOW_ORIGIN_REGEX`
- `RSS_CORS_ALLOW_CREDENTIALS`

调度：

- `RSS_SCHEDULER_FETCH_INTERVAL_MIN`
- `RSS_SCHEDULER_CLEANUP_INTERVAL_MIN`
- `RSS_SCHEDULER_MAX_FEEDS_PER_TICK`

前端 API base 覆盖：

- `VITE_API_BASE_URL`
- `REACT_APP_API_BASE_URL`

`.env` 读取路径顺序：

1. 当前工作目录 `.env`
2. `backend/.env`
3. 仓库根目录 `.env`

## 6. 开发与测试

后端（Windows）：

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m pytest -q
```

前端（Windows）：

```bash
cd frontend
npm.cmd install
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## 7. Docker 说明

### 7.1 单容器

- Compose：`docker-compose.single.yml`
- 宿主机端口：`8001`
- 容器内端口：`8000`
- `Dockerfile.single` 将前端构建产物复制到 `backend/frontend_dist`

### 7.2 前后端分离

- Compose：`docker-compose.yml`
- 后端：`8000`
- 前端：`5173`（Vite dev server）
