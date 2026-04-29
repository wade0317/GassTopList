# 项目规则（Project Rules）

本文件约定本仓库的协作规范，所有提交者请遵守。

## 1. 目录与文件

- **所有文档**统一放在 `docs/` 下，命名小写英文：`requirements.md`、`design.md`、`rules.md` 等。根目录仅保留 `readme.md` 作为入口。
- **前端代码**放 `web/`；**后端代码**放 `server/`；**运行时产物**（如 `server/data/`、`node_modules/`、`.DS_Store`）禁止入库。
- 新增模块或大功能时，先在 `docs/` 更新需求/设计，再写代码。

## 2. 分支与提交

- 主分支：`main`，保持随时可运行。
- 新工作开分支：`feat/xxx`、`fix/xxx`、`docs/xxx`、`refactor/xxx`。
- Commit message 遵循 **Conventional Commits**：
  ```
  <type>(<scope>): <subject>

  [可选正文：解释 why]
  ```
  常用 type：`feat | fix | docs | refactor | chore | test | style | perf`。
- 一次提交聚焦一件事，避免「大杂烩」commit。
- 禁止把临时调试代码、密钥、个人路径等提交进库。

## 3. 代码规范

### 3.1 通用
- 文件使用 UTF-8、LF 换行；缩进 2 空格。
- 命名：变量 `camelCase`、常量 `UPPER_SNAKE_CASE`、文件名小写中划线或 camelCase（与所在目录现状保持一致）。
- 注释只写 **why**（约束、坑、非显而易见的前提），不写 what；显然的代码不加注释。
- 删除即删除，不留 `// 旧实现` / `// TODO 以后再说` 的死代码。

### 3.2 前端（`web/`）
- 暂不引入构建工具，保持「打开即用」。新增依赖优先用 CDN 引入。
- DOM 操作集中在事件层；数据读写一律走 `Store`，不要绕过缓存直接读 IndexedDB。
- 与后端交互一律走 `ApiSync`，不要在散落的事件处理器里直接 `fetch`。
- 任何用户输入显示到 DOM 前需做转义；`innerHTML` 禁用未净化字符串。

### 3.3 后端（`server/`）
- 对外路径必须校验工作区 ID（参考 `isValidWorkspaceId`），严禁拼接未校验路径。
- 写文件用「写 tmp + rename」原子方式，不允许直接覆盖目标文件。
- 接口返回 JSON，错误码遵循 HTTP 语义（400 入参错误、404 未找到、500 服务异常）。
- 不在仓库中硬编码端口/路径以外的配置；新增配置走环境变量。

## 4. 安全与隐私

- 不在代码、注释、commit message、issue 中出现真实工作区 ID、用户姓名、Token 等敏感信息。
- 后端默认 **无鉴权**，公网部署必须自加反向代理 / HTTPS / 鉴权；PR 描述里需注明部署形态。
- 涉及破坏性操作（清空、覆盖远端、删除成员等）前端必须二次确认。

## 5. 同步与数据兼容

- IndexedDB / 后端 JSON 字段如需变更，必须在 `docs/design.md` 更新 schema，并提供迁移逻辑或兼容读取。
- 整包同步当前为「末次写入为准」。引入冲突解决前，禁止在多端同时开启自动上传后又互相覆盖。

## 6. 评审与合并

- 每个 PR 至少自检：
  - [ ] 本地能启动（前端能打开、后端 `npm start` 正常）
  - [ ] 涉及接口/数据结构改动已同步更新 `docs/`
  - [ ] 没有引入新的 lint / console error
  - [ ] 不包含敏感信息与无关文件
- 评审关注：可读性、错误处理、隐私安全、文档同步。

## 7. AI 协作（Claude Code 等）

- 仅提交 `.claude/launch.json` 等团队共享配置；`.claude/settings.local.json` 由 `.gitignore` 排除。
- 由 AI 生成的成片代码须人工审阅后提交；commit message 中可保留 `Co-Authored-By` 标注。
- 让 AI 修改文档时，需同时检查 `docs/` 中是否有对应变更需要同步。

如需修改本规则，提交 PR 并在描述中说明动机；通过后再执行。
