# 德州扑克记分工具

浏览器端记分、排行榜与图表；数据统一存放在后端 **SQLite** 数据库中。前端不再使用 `IndexedDB` 或 `localStorage` 持久化业务数据，必须通过后端读写。

## 快速开始

### 启动方式
```bash
cd server
npm install
npm start
```

启动后直接在浏览器打开：

- `http://127.0.0.1:3840/`

默认监听 `http://127.0.0.1:3840`，修改端口：
```bash
PORT=5000 npm start    # macOS / Linux
set PORT=5000 && npm start  # Windows cmd
```

## 项目结构

```
rank/
├── readme.md              # 项目入口（本文件）
├── CLAUDE.md              # Claude Code 项目级指引（AI 协作上下文）
├── .gitignore             # 根级忽略规则
├── docs/                  # 所有项目文档
│   ├── requirements.md    # 需求文档
│   ├── design.md          # 设计文档
│   ├── rules.md           # 项目规则
│   └── deploy.md          # Nginx + systemd 部署指南
├── deploy/                # 生产部署模板
│   ├── nginx/gass.bilicool.com.conf      # 宿主 Nginx 站点
│   └── docker/                            # Docker 化后端
│       ├── Dockerfile
│       └── docker-compose.yml
├── web/                   # 前端（纯静态，无构建）
│   ├── index.html         # 页面结构
│   ├── styles.css         # 样式
│   └── app.js             # 业务逻辑：Store / Render / ApiSync / Events
└── server/                # 后端（必需，Node.js + Express + SQLite）
    ├── index.js           # HTTP 入口、SQLite 读写、静态页托管
    ├── package.json       # 依赖：express、cors、better-sqlite3
    └── data/              # 运行时数据目录（SQLite 数据库文件）
```

## 项目文档索引

| 文档 | 内容 | 适合谁先读 |
|------|------|-----------|
| [`docs/requirements.md`](docs/requirements.md) | 功能 / 非功能需求、数据模型、验收标准 | 产品 / 新加入的开发 |
| [`docs/design.md`](docs/design.md) | 整体架构、前后端模块、接口契约、部署形态、已知限制 | 实现与改造前必读 |
| [`docs/rules.md`](docs/rules.md) | 目录约定、分支与 Commit 规范、代码与安全规范、AI 协作约定 | 每位提交者 |
| [`docs/deploy.md`](docs/deploy.md) | gass.bilicool.com 部署：宿主 Nginx + Docker 后端、HTTPS、备份、排障 | 运维 / 上线 |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code 会话级项目上下文（结构 / 约束 / 文档导航） | AI 协作场景 |

## 后端接口速览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/auth/me` | 查询当前登录角色 |
| POST | `/api/auth/guest` | 游客登录 |
| POST | `/api/auth/admin` | 管理员密码登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/state` | 读取默认账本全部数据 |
| POST | `/api/members` | 新增成员 |
| DELETE | `/api/members/:id` | 删除成员 |
| POST | `/api/records` | 批量新增积分记录 |
| PUT | `/api/records/:id` | 更新单条记录 |
| DELETE | `/api/records/:id` | 删除单条记录 |
| DELETE | `/api/state` | 清空整个账本 |

## 数据存储说明

- 成员页已隐藏同步模块与数据管理模块。
- 前端所有业务数据都直接读写后端 SQLite，不再保存到浏览器本地数据库。
- 当前为单账本模式，不再使用工作区 ID。
- 若后端未启动，页面无法正常读写数据。

## 登录与权限

- 首次进入会先看到登录界面。
- **游客登录**：可直接进入，只能查看排行榜、图表、历史记录和成员列表。
- **管理员登录**：输入密码后可录入积分、添加成员、编辑记录、删除记录。
- 默认管理员密码为 `15011501`，可通过环境变量 `ADMIN_PASSWORD` 覆盖。
- 登录态通过后端签名 Cookie 保存；刷新页面后会保留当前角色，直到退出或过期。

## 公网部署

线上：`https://gass.bilicool.com`，架构 = **宿主 Nginx 托静态前端 + Docker 跑后端**。详细步骤见 [`docs/deploy.md`](docs/deploy.md)，部署模板见 [`deploy/`](deploy/)。

## 注意

- 现在必须先启动后端再使用页面。
- SQLite 数据库文件位于 `server/data/gasstoplist.sqlite3`。
- 若公网部署，务必修改 `ADMIN_PASSWORD` 与 `AUTH_SECRET`，并建议继续加 Nginx 访问控制。
