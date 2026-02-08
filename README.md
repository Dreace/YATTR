# YATTR · Yet Another Tiny Tiny RSS

[English](README.en.md)

**YATTR** 是一个**单用户、Web 优先**的 RSS 阅读器，定位为：

* 自部署
* 轻量
* 专注阅读体验
* 支持 Fever API（兼容主流 RSS 客户端）

本文档仅包含 **部署、登录与日常使用**。
开发与架构说明见：[docs/development.md](docs/development.md)

---

## 1. 快速开始（推荐）

### 1.1 创建 `.env`

在项目根目录创建 `.env`，至少包含以下配置：

```env
RSS_SECRET_KEY=change_me
RSS_ADMIN_EMAIL=your_email
RSS_ADMIN_PASSWORD=your_password
RSS_DB_URL=sqlite:///./data/rss.sqlite
```

说明：

* 当前为**单用户管理员模式**
* 不支持注册
* 已存在的用户不会被 `.env` 覆盖密码
* 生产运行时不允许使用默认值 `change_me`（`RSS_SECRET_KEY`、`RSS_ADMIN_PASSWORD`），否则后端会拒绝启动

---

### 1.2 单容器部署（最简单）

```bash
docker compose -f docker-compose.single.yml up --build
```

访问地址：

```
http://localhost:8001
```

---

## 2. 其他部署方式

### 2.1 前后端分离（Docker）

```bash
docker compose up --build
```

访问地址：

* 前端：[http://localhost:5173](http://localhost:5173)
* 后端：[http://localhost:8000](http://localhost:8000)

---

### 2.2 使用远程镜像

```bash
docker compose -f docker-compose.remote.yml up -d
```

适合不需要本地构建的情况。

---

### 2.3 本地运行（Windows）

#### 后端

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

#### 前端

1. 配置 `frontend/.env.local`

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

2. 启动前端

```bash
cd frontend
npm.cmd install
npm.cmd run dev
```

3. 访问

```
http://localhost:5173
```

---

## 3. 登录与首次使用

1. 访问 `/`，未登录会自动跳转 `/login`
2. 使用 `.env` 中的管理员账号登录
3. 建议首次操作顺序：

   * 左侧 **添加订阅** → 输入 RSS / Atom URL
   * （可选）设置中导入 OPML
   * 从「未读 / 全部」开始阅读

---

## 4. 日常使用

### 4.1 订阅管理

* 左侧支持 URL 校验后添加订阅
* 订阅右键菜单支持：

  * 编辑
  * 调试
  * 删除
* 可配置项包括：

  * 抓取间隔
  * 全文抽取
  * 保留策略
  * 图片缓存

---

### 4.2 阅读操作

**中栏**

* 筛选 / 排序 / 搜索 / 分页
* 批量操作：

  * 当前页全部已读
  * 全部已读
  * 标记选中项

**右栏（文章操作）**

* 已读 / 未读
* 收藏
* 稍后读
* 打开原文

**快捷键**

| 键位 | 功能    |
| -- | ----- |
| j  | 下一条   |
| k  | 上一条   |
| m  | 已读切换  |
| s  | 收藏切换  |
| t  | 稍后读切换 |
| o  | 打开原文  |

---

### 4.3 设置与调试

**设置面板**

* 全局抓取 / 清理策略
* 时间格式（数据库存 UTC 时间戳，界面按浏览器时区渲染）
* 语言切换（简体中文 / English / 跟随系统）
* 自动刷新（秒，`0` 为关闭）
* OPML 导入 / 导出
* 系统状态（`/api/health`）
* 插件管理
  * 默认不启用任何插件
  * 在设置页启用后可立即生效（无需重启）

**调试面板**

* 手动抓取单个订阅
* 查看抓取日志与错误
* 抓取结果预览

---

## 5. Fever 客户端支持

支持 Reeder、Fiery Feeds、ReadKit 等 Fever 客户端。

使用步骤：

1. 登录 Web
2. 在「设置 → 插件管理」中启用 `fever`
3. 打开 Fever 插件页面，获取：

   * `username`
   * `app_password`
   * `api_key`
   * `endpoint_url`
4. 在客户端填写对应信息

Fever API 入口：

```
/plugins/fever/?api
```

---

## 6. 常见问题

### 6.1 登录失败

* 检查 `.env` 中的邮箱与密码
* 已存在用户不会因修改 `.env` 自动更新密码

---

### 6.2 前端请求失败 / 跨域

* 确认 `VITE_API_BASE_URL` 指向正确后端
* 检查后端 CORS 配置（见 [docs/development.md](docs/development.md)）

---

### 6.3 单容器无法访问

* 对外端口是 **8001**
* 使用以下命令确认容器状态：

```bash
docker compose -f docker-compose.single.yml ps
```

---

## 7. GitHub Actions：Docker 自动构建

工作流文件：

```
.github/workflows/docker-publish.yml
```

### 触发条件

* push 到 `main`
* push `v*` 标签（如 `v1.0.0`）
* 手动触发

### 需要配置的 Secrets

路径：

```
Settings → Secrets and variables → Actions
```

* `DOCKERHUB_USERNAME`
* `DOCKERHUB_TOKEN`

可选 Variables：

* `DOCKERHUB_REPOSITORY`（默认使用 GitHub 仓库名）

### 镜像标签策略

* `latest`
* 分支名
* Git Tag（如 `v1.0.0`）
* `sha-<short_sha>`
