# 设计文档（Design）

## 1. 总体架构

```
┌────────────────────────┐         ┌────────────────────────┐
│  浏览器 (web/)          │  HTTP   │  Node.js 后端 (server/)│
│  index.html / app.js    │ ──────► │  Express + 文件存储    │
│  IndexedDB (本地默认)   │         │  data/workspaces/*.json│
└────────────────────────┘         └────────────────────────┘
```

- **前端**：纯静态页面，无构建步骤；本地数据存 IndexedDB；可选启用云端同步。
- **后端**：可选启动；按「工作区 ID」整包存取，单文件 JSON。
- **同步策略**：整包 PUT/GET，末次写入为准（不做增量与冲突合并）。

## 2. 目录结构

```
rank/
├── readme.md              # 项目入口说明
├── docs/                  # 所有项目文档
│   ├── requirements.md    # 需求
│   ├── design.md          # 设计（本文件）
│   └── rules.md           # 项目规则
├── web/                   # 前端
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── server/                # 后端（可选）
    ├── index.js
    ├── package.json
    └── data/workspaces/   # 运行时数据，已 gitignore
```

## 3. 前端设计

### 3.1 模块分层（`web/app.js`）
- **Store**：IndexedDB 封装 + 内存缓存。提供同步读、异步写。包含从旧 `localStorage` 数据迁移的 fallback。
- **Render**：根据当前 Tab 渲染相应区块（录入、排行、图表、成员）。
- **ApiSync**：与后端交互（测试连接、PUT/GET、自动上传防抖）。
- **Events**：表单提交、Tab 切换、筛选变更等事件绑定。

### 3.2 IndexedDB Schema
- 数据库名：`PokerScores`，版本 1
- Object Stores：
  - `members`：keyPath `id`
  - `records`：keyPath `id`，索引 `memberId`、`time`

### 3.3 关键交互
- **同一局识别**：录入时同一时间戳的记录归为一局，由前端在排行/图表中聚合。
- **自动同步**：勾选「自动上传」后，写操作完成 ≈800ms 防抖后调用 PUT；首次勾选立即触发一次。
- **冲突保护**：从服务器拉取前弹确认；清空本地前提示导出备份。

## 4. 后端设计（`server/index.js`）

### 4.1 技术栈
- Node.js + Express + cors
- JSON 文件持久化（无数据库）

### 4.2 关键实现
- **端口**：默认 3840，环境变量 `PORT` 可覆盖。
- **数据目录**：`server/data/workspaces/{workspaceId}.json`。
- **工作区 ID 校验**：`/^[a-zA-Z0-9_-]{8,128}$/`，阻止路径穿越。
- **写入原子性**：先写 `*.tmp`，再 `rename` 覆盖，避免中途损坏。
- **请求体大小**：上限 20 MB，足以容纳大量历史。
- **CORS**：`origin: true`（允许任意来源），便于本地开发；生产部署建议收敛白名单。

### 4.3 接口契约

| 方法 | 路径 | 请求体 | 成功响应 | 错误响应 |
|------|------|--------|----------|----------|
| GET | `/api/health` | — | `{ ok:true, service, time }` | — |
| GET | `/api/workspaces/:id` | — | `{ members, records, updatedAt }` | 400 无效 ID |
| PUT | `/api/workspaces/:id` | `{ members, records }` | `{ ok:true, updatedAt }` | 400 无效 ID |

未匹配路径统一 404。

## 5. 部署形态

| 模式 | 部署方式 |
|------|----------|
| 仅本地 | 浏览器直接打开 `web/index.html` |
| 局域网共享 | 任意机器跑 `cd server && npm start`，前端填写其 IP:端口 |
| 公网部署 | 反向代理 + HTTPS（鉴权目前未内置，建议配合 Basic Auth / IP 白名单） |

## 6. 安全与隐私

- 工作区 ID 等同弱口令——只要泄露任何人可读写。
- 服务端不做鉴权；公网暴露前必须自行加防护。
- 不收集任何用户标识；前端默认数据不离开本机。

## 7. 已知限制 & 后续演进

- 整包覆盖式同步：多端并发写时，末次写入会覆盖他端变更。
- 无登录与权限：需要按用户隔离时需引入鉴权层。
- 文件存储：单工作区 JSON 文件，量级很大时需迁 SQLite/PG。
- 可选演进：增量同步 + 版本号、Docker 一键启动、PWA 离线缓存。
