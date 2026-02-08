# Yet Another Tiny Tiny RSS (YATTR)

YATTR（Yet Another Tiny Tiny RSS）是一个单用户、桌面优先的 RSS 阅读器。

本文档面向使用者，只保留部署、登录和日常使用说明。  
开发相关内容请看：`docs/development.md`。

## 1. 快速开始

### 1.1 准备 `.env`

在项目根目录创建 `.env`，至少包含：

```env
RSS_SECRET_KEY=change_me
RSS_ADMIN_EMAIL=your_email
RSS_ADMIN_PASSWORD=your_password
RSS_DB_URL=sqlite:///./data/rss.sqlite
```

### 1.2 推荐部署（单容器）

```bash
docker compose -f docker-compose.single.yml up --build
```

启动后访问：`http://localhost:8001`

## 2. 其他部署方式

### 2.1 前后端分离（Docker）

```bash
docker compose up --build
```

访问地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`

### 2.2 使用远程镜像（Docker）

```bash
docker compose -f docker-compose.remote.yml up -d
```

### 2.3 本地运行

后端（Windows）：

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

前端（Windows）：

1. 在 `frontend/.env.local` 中配置：
```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```
2. 启动前端：
```bash
cd frontend
npm.cmd install
npm.cmd run dev
```
3. 访问：`http://localhost:5173`

## 3. 登录与首次使用

1. 打开网页后进入登录页（未登录访问 `/` 会自动跳转 `/login`）。
2. 使用 `.env` 中配置的管理员账号登录。
3. 首次使用建议按顺序操作：
   - 先在左侧“添加订阅”输入 RSS/Atom URL，点击“验证并添加”
   - 在设置中导入 OPML（可选）
   - 选择“未读/全部”等区域开始阅读

说明：

- 当前是单用户管理员模式，不提供注册。
- 若数据库中已有同邮箱账号，不会自动覆盖已有密码。

## 4. 日常使用

### 4.1 订阅管理

- 左侧“添加订阅”支持 URL 校验后添加。
- 订阅源右键菜单支持：
  - 编辑订阅
  - 调试
  - 删除订阅
- 编辑订阅可调整抓取间隔、全文抽取、保留策略、图片缓存等选项。

### 4.2 阅读操作

- 中栏支持筛选、排序、搜索、分页。
- 支持批量动作：
  - 当前页标记已读
  - 一键全部已读
  - 标记选中已读
- 右栏可对当前文章执行：
  - 已读/未读
  - 收藏/取消
  - 稍后读/取消
  - 打开原文

快捷键：

- `j`：下一条
- `k`：上一条
- `m`：已读/未读切换
- `s`：收藏切换
- `t`：稍后读切换
- `o`：打开原文

### 4.3 设置与调试

设置面板支持：

- 全局抓取和清理策略
- 自动刷新间隔（秒，`0` 为关闭）
- OPML 导入/导出
- 插件管理

调试面板支持：

- 手动触发单个订阅源抓取
- 查看抓取日志和错误
- 查看抓取内容预览

## 5. Fever 客户端使用

如果你用 Reeder、Fiery Feeds、ReadKit 等 Fever 客户端：

1. 先登录 Web 界面。
2. 在插件设置中启用 `fever` 插件。
3. 打开插件提供的 Fever 设置页，获取：
   - `username`
   - `app_password`
   - `api_key`
   - `endpoint_url`
4. 在客户端中填写对应信息。

当前 Fever 入口路径为：`/plugins/fever/?api`

## 6. 常见问题

### 6.1 登录失败

- 确认 `.env` 中的 `RSS_ADMIN_EMAIL` 和 `RSS_ADMIN_PASSWORD` 是否正确。
- 如果数据库已创建过该用户，修改 `.env` 不会直接改数据库中的历史密码。

### 6.2 前端请求失败或跨域问题

- 本地开发请确认 `frontend/.env.local` 的 `VITE_API_BASE_URL` 指向正确后端地址。
- 检查后端 CORS 配置是否允许当前前端地址（详见 `docs/development.md`）。

### 6.3 Docker 单容器访问不到页面

- 单容器默认对外端口是 `8001`，不是 `8000`。
- 用 `docker compose -f docker-compose.single.yml ps` 确认容器是否正常运行。

## 7. GitHub Actions 自动构建 Docker 镜像

仓库已包含工作流：`.github/workflows/docker-publish.yml`。  
触发条件：

- push 到 `main`
- push `v*` 标签（例如 `v1.0.0`）
- 手动触发（`workflow_dispatch`）

首次使用前请在 GitHub 仓库配置以下项目：

1. `Settings` -> `Secrets and variables` -> `Actions` -> `Secrets`
   - `DOCKERHUB_USERNAME`：Docker Hub 用户名
   - `DOCKERHUB_TOKEN`：Docker Hub Access Token
2. （可选）`Variables`
   - `DOCKERHUB_REPOSITORY`：镜像仓库名，不填则默认使用当前 GitHub 仓库名

镜像会按以下策略打标签：

- `latest`（默认分支）
- 分支名
- Git 标签（如 `v1.0.0`）
- `sha-<short_sha>`
