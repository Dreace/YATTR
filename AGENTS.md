# Flutter 代码编写规范

## 核心要求

1. 以暗猜接口为耻，以认真查阅为荣
2. 以模糊执行为耻，以寻求确认为荣
3. 以盲想业务为耻，以人类确认为荣
4. 以创造接口为耻，以复用现有为荣
5. 以跳过验证为耻，以主动测试为荣
6. 以破坏架构为耻，以遵循规范为荣
7. 以假装理解为耻，以诚实无知为菜
8. 以盲目修改为耻，以谨慎重构为荣

## Tooling & Shell Usage(For Codex only，只有 Codex 需要遵守，如果你不是 Codex 请忽略)

1. Prefer the bundled bash helpers (bash -lc) when invoking shell commands; always set the workdir parameter.
2. Use rg/rg --files for searches; fall back only if unavailable.
3. use sed for in-place file edits.
4. Use git & gh for version control operations.
5. Use jq for JSON processing.
6. Avoid PowerShell-specific commands. CRITICAL DO NOT USE PYTHON, PERL or OTHER SCRIPTS TO MANIPULATE FILES.

## 代码编写

编写 Flutter 代码时需要遵守以下原则：

1. **重要：完成一次任务后使用 `mcp-feedback-enhanced` 工具要求进行反馈，超时时间要设置为 24 小时对应的秒数**
2. 进行任务前始终需要思考清楚如何完成任务，思考每一步骤需要做什么，使用 sequentialthinking 工具进行思考
3. 使用 TODO list 工具管理任务
4. 编写的代码需要简洁明了，如果遇到不确定的 API 使用方法使用 context7 工具查询文档，或使用 g-search 工具搜索文档
5. 如果有不明确的点，向我提问（使用 `mcp-feedback-enhanced` 工具），一次性提出所有问题
6. 修改完成后，检查修改是否符合预期
7.  一次性完成给定的任务，不要中断，不要关心 token 消耗
8.  严禁修改未被要求修改的文件内容
9.  涉及数据库 Schema 变更时必须编写版本化迁移逻辑，禁止仅靠手工改表
10.  迁移逻辑必须支持跨多个版本自动升级（旧版本可直接升级到最新）
11.  启动时必须自动执行未完成迁移，迁移步骤需可重复执行（幂等）
12.  新增或修改迁移后必须补充对应测试（至少覆盖升级路径与关键数据回填）
13. 如果多个任务之间发现代码被手动修改则使用已经修改后的代码，禁止重复应用之前的修改
后端规范
14. 编写的代码遵守 Python3 规范
15. 使用项目中的虚拟环境执行测试
前端规范
16.  使用 TypeScript 编写代码，确保类型安全，所有变量和函数都要有明确的类型定义
17. 使用 ESLint 和 Prettier 格式化代码
