# 德州扑克记分工具

浏览器端记分、排行榜与图表；数据默认存在本机 **IndexedDB**。可选启动 **后端服务**，按「工作区 ID」把成员与积分记录存到服务器磁盘，便于备份或多设备共用。

## 快速开始

### 前端
1. 用浏览器打开 `web/index.html`（或用任意静态服务器托管 `web/` 目录）。
2. 在 **成员管理** 添加成员，在 **记分录入** 按局录入积分。
3. **数据管理** 可导出 CSV / JSON 备份或从备份恢复。

### 后端（可选）
```bash
cd server
npm install
npm start
```
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
│   └── rules.md           # 项目规则
├── web/                   # 前端（纯静态，无构建）
│   ├── index.html         # 页面结构
│   ├── styles.css         # 样式
│   └── app.js             # 业务逻辑：Store / Render / ApiSync / Events
└── server/                # 后端（可选，Node.js + Express）
    ├── index.js           # HTTP 入口与文件持久化
    ├── package.json       # 依赖：express、cors
    └── data/workspaces/   # 运行时数据，已 gitignore
```

## 项目文档索引

| 文档 | 内容 | 适合谁先读 |
|------|------|-----------|
| [`docs/requirements.md`](docs/requirements.md) | 功能 / 非功能需求、数据模型、验收标准 | 产品 / 新加入的开发 |
| [`docs/design.md`](docs/design.md) | 整体架构、前后端模块、接口契约、部署形态、已知限制 | 实现与改造前必读 |
| [`docs/rules.md`](docs/rules.md) | 目录约定、分支与 Commit 规范、代码与安全规范、AI 协作约定 | 每位提交者 |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code 会话级项目上下文（结构 / 约束 / 文档导航） | AI 协作场景 |

## 后端接口速览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/workspaces/:id` | 读整包，无文件返回空 |
| PUT | `/api/workspaces/:id` | 整包覆盖保存 |

工作区 ID 规则：`a-zA-Z0-9_-`，长度 8–128。

## 注意

- 工作区 ID 等同弱口令，勿公开分享；公网部署请自加反向代理、HTTPS、鉴权。
- 当前同步为整包覆盖、末次写入为准；详见 `docs/design.md` 的「已知限制」。
