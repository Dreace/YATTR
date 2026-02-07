# 任务说明

## 重要

1. 每次开始任务前读取 AGENTS.md，完成后使用 #mcp-feedback-enhanced 的 interactive_feedback 工具进行简短反馈
2. 如果实际效果和你描述的不一致，你将被罚款，偏差越大罚款越重
3. 使用 TODO 跟进任务完成情况，最后一个任务为使用 #mcp-feedback-enhanced 的 interactive_feedback 工具进行简短反馈
4. 使用 Windows 下的 npm 命令执行测试用例，严禁在 WSL 环境中执行 npm 等 node 相关命令

## 新任务
1. 根据下面的要点重新实现 Fever API 兼容插件

## 1) 入口与请求约定

* **端点**：`POST https://your-domain/api/fever.php?api`（很多客户端会在 URL 上拼 action 参数）([FreshRSS][1])
* **Body 编码**：通常用 `multipart/form-data`（也有客户端用 `application/x-www-form-urlencoded`），核心字段是 `api_key`([FreshRSS][1])
* **响应格式**：JSON，至少包含：

  * `api_version`（常见为 3）
  * `auth`（0/1）([FreshRSS][1])

## 2) 鉴权（最容易踩坑）

* Fever 使用 **MD5(`"$username:$apiPassword"`)** 作为 `api_key`（不加盐，安全性差，务必 HTTPS + 独立“应用密码”）([FreshRSS][1])
* 未鉴权返回：

  * `{"api_version":3,"auth":0}`（有些实现会带 error 字段，但最基本要保证这两个字段稳定）([FreshRSS][1])
* 鉴权成功建议额外返回：

  * `last_refreshed_on_time`（Unix 时间戳；注意有客户端对类型较敏感，最好用数字或数字字符串一致）([FreshRSS][1])

## 3) “动作”路由规则（QueryString 决定做什么）

客户端一般通过 URL query 参数选择动作，例如：

* `?api&items` 拉取文章
* `?api&feeds` 拉取订阅源
* `?api&groups` 拉取分组/分类
* `?api&unread_item_ids` 拉取未读 ID 列表
* `?api&saved_item_ids` 拉取收藏 ID 列表
* `?api&mark=item&as=read&id=123` 标记单条已读
  这些都是兼容实现的“最低集合”。([FreshRSS][1])

实现建议：

* 允许 **同一请求同时带多个 action** 时按固定优先级处理（不同客户端行为不一，至少别 500）。
* 所有动作都先走鉴权（除了最基础的 `?api` 探活）。([FreshRSS][1])

## 4) 核心数据结构（客户端真正依赖的字段）

不同客户端“容错”不一致，建议字段尽量齐全、类型稳定：

### feeds

每个 feed 常用字段（命名以 Fever 生态常见为准）：

* `id`（int）
* `favicon_id`（int，用于后续 favicons）
* `title`
* `url`（feed URL）
* `site_url`（站点 URL）
* 可选：`is_spark`（不少实现固定 0）

### groups（分类/文件夹）

* `id`、`title`
* `feed_ids`：用逗号拼接的 feed id 列表（很多客户端按这个来构建目录树）

### items（文章）

典型字段：

* `id`（int，全局递增，强烈建议）
* `feed_id`
* `title`
* `author`（可空）
* `html`（正文 HTML；或 `content`，但建议按 Fever 兼容字段）
* `url`
* `is_saved`（0/1）
* `is_read`（0/1）
* `created_on_time`（Unix 时间戳）

> 兼容性关键：**id 单调递增** + **created_on_time** 正确，能显著减少客户端分页/增量同步问题。

## 5) items 拉取与增量同步（兼容性关键点）

常见参数（至少要支持）：

* `since_id=...`：增量拉取（从某个最大已知 id 之后继续要）([FreshRSS][1])
* `max_id=...`：向前翻页（取不大于某 id 的历史数据）([FreshRSS][1])

实现建议（避免客户端卡死/重复）：

* 单次返回 **固定上限**（很多实现按 50 条一页的思路做）([GitHub][2])
* 返回 items 时同时返回：

  * `total_items`（可选，但部分客户端会用）
  * `items` 数组本体

## 6) 未读/收藏 ID 列表接口（很多客户端会频繁调用）

* `?api&unread_item_ids`：返回 `unread_item_ids`（通常是逗号分隔字符串）
* `?api&saved_item_ids`：返回 `saved_item_ids`（同上）([FreshRSS][1])

实现建议：

* 这两个接口要快：走索引/缓存，否则移动端滚动会被打爆。
* ID 列表过长时可考虑按时间窗口或分段（但要确保主流客户端仍可用）。

## 7) 写操作：mark（读/未读/收藏/取消收藏）

最低要支持：

* `mark=item&as=read&id=...`
* `mark=item&as=unread&id=...`([FreshRSS][1])

强烈建议补齐（很多客户端会用）：

* `mark=item&as=saved&id=...`
* `mark=item&as=unsaved&id=...`
* `mark=feed&as=read&id=feed_id`
* `mark=group&as=read&id=group_id`([FreshRSS][1])

实现要点：

* `id` 可能是单个，也可能是逗号分隔多个（批量标记）。
* 并发幂等：重复 mark 不应报错。

## 8) favicon / favicons

FreshRSS 的兼容实现明确支持 favicon 获取。([FreshRSS][1])
建议做法：

* `feeds` 给出 `favicon_id`
* `?api&favicons`（或等价动作）返回 `{id, data}` 列表，`data` 多用 base64（不同实现略有差异，至少保证客户端能拿到图标）

## 9) 安全与兼容性策略

* **必须 HTTPS**（MD5 无盐极易被重放/撞库），并使用“应用专用密码”。([GitHub][3])
* **容错**：

  * 缺参/未知 action 返回 `{"api_version":3,"auth":1}` + 可选 `error`
  * 避免返回 500（客户端通常不会重试得很聪明）
* **类型稳定**：时间戳/ID 用 int 或数字字符串要统一（别一会儿字符串一会儿数字）。