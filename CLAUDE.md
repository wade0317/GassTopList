# CLAUDE.md

本文件为 Claude Code（及类似 AI 协作工具）在本仓库工作时的项目级上下文。**优先读这份文件**，再按需展开对应文档。

## 项目简介

**Gass龙虎榜**：纯静态前端 + 可选 Node.js 后端的轻量记分应用。前端默认用 IndexedDB；启用后端后按「工作区 ID」整包同步到服务器磁盘。

## 项目结构

```
rank/
├── readme.md              # 项目入口
├── CLAUDE.md              # 本文件
├── .gitignore
├── docs/                  # 所有项目文档（修改前后请同步更新）
│   ├── requirements.md    # 需求文档
│   ├── design.md          # 设计文档
│   ├── rules.md           # 项目规则
│   └── deploy.md          # 部署指南（Nginx + systemd + HTTPS）
├── deploy/                # 生产部署模板
│   ├── nginx/gass.bilicool.com.conf  # 宿主 Nginx
│   └── docker/                        # Docker 化后端
│       ├── Dockerfile
│       └── docker-compose.yml
├── web/                   # 前端，无构建步骤
│   ├── index.html
│   ├── styles.css
│   └── app.js             # Store(IndexedDB) / Render / ApiSync / Events
└── server/                # 后端（可选）
    ├── index.js           # Express HTTP 入口 + 文件持久化
    ├── package.json
    └── data/workspaces/   # 运行时数据，已 gitignore，禁止入库
```

## 项目文档索引

| 文档 | 何时读 |
|------|--------|
| [`docs/requirements.md`](docs/requirements.md) | 改动涉及新功能、字段、验收标准 |
| [`docs/design.md`](docs/design.md) | 修改架构、模块边界、接口、数据模型 |
| [`docs/rules.md`](docs/rules.md) | 提交前 / 命名 / 安全 / AI 协作规范 |
| [`docs/deploy.md`](docs/deploy.md) | 修改部署相关（Nginx / systemd / 上线流程） |
| [`readme.md`](readme.md) | 用户视角的安装与使用 |

> 改了代码 ⇒ 看是否需要联动改 `docs/`；新增字段或接口 ⇒ **必须**在 `docs/design.md` 同步。

## 技术栈与运行

- **前端**：原生 HTML/CSS/JS + IndexedDB + Chart.js（CDN）。**禁止**引入构建工具。
- **后端**：Node.js + Express + cors，文件存储；默认端口 3840。
- 启动后端：`cd server && npm install && npm start`
- 启动前端：浏览器直接打开 `web/index.html`，或任意静态服务器托管 `web/`

## 关键约束（动手前请确认）

- **工作区 ID 校验**：`/^[a-zA-Z0-9_-]{8,128}$/`，禁止任何未校验路径拼接（防路径穿越）。
- **写文件原子性**：先写 `*.tmp` 再 `rename`；不允许直接覆盖目标文件。
- **同步语义**：整包 PUT/GET，末次写入为准；当前不做增量与冲突合并。
- **前端数据访问**：必须经 `Store`，不要绕过缓存直接打 IndexedDB；与后端交互必须经 `ApiSync`。
- **DOM 安全**：用户输入渲染前需转义，禁止把未净化字符串放入 `innerHTML`。
- **运行时产物**：`server/data/`、`node_modules/`、`.DS_Store` 等不入库（已 gitignore）。

## 提交规范（摘要）

- 主分支 `main`；新工作走 `feat/* | fix/* | docs/* | refactor/*`。
- Conventional Commits：`<type>(<scope>): <subject>`，常用 type：`feat | fix | docs | refactor | chore | test | style | perf`。
- 一个 commit 聚焦一件事；禁止提交临时调试代码、密钥、本机绝对路径。
- AI 生成的成片代码须人工审阅后再提交，可保留 `Co-Authored-By` 标注。

完整规范见 [`docs/rules.md`](docs/rules.md)。

## 不要做的事

- 不要给后端加未经评审的鉴权方案（鉴权设计需先在 `docs/design.md` 立项）。
- 不要在前端散落处直接 `fetch`，必须经 `ApiSync`。
- 不要修改 IndexedDB / 接口数据结构却不更新 `docs/design.md` 的 schema。
- 不要提交 `.claude/settings.local.json`、`server/data/` 或任何运行时产物。
- 不要把工作区 ID、用户姓名等敏感信息出现在 commit / issue / 注释里。
