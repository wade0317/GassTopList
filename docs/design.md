# 设计文档（Design）

## 1. 总体架构

```
┌────────────────────────┐         ┌────────────────────────┐
│  浏览器 (web/)          │  HTTP   │  Node.js 后端 (server/)│
│  index.html / app.js    │ ──────► │  Express + SQLite      │
│  内存缓存（不落本地）    │         │  data/gasstoplist.sqlite3│
└────────────────────────┘         └────────────────────────┘
```

- **前端**：纯静态页面，无构建步骤；仅保留运行时内存缓存，数据读写全部走后端 API。
- **后端**：必须启动；负责托管页面并将默认账本持久化到 SQLite。
- **写入策略**：前端增删改直接调用后端接口，后端实时落库。
- **权限模型**：游客只读、管理员可写；登录态由后端签名 Cookie 维护。

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
└── server/                # 后端（必需）
    ├── index.js
    ├── package.json
    └── data/              # SQLite 数据文件目录，已 gitignore
```

## 3. 前端设计

### 3.1 模块分层（`web/app.js`）
- **Store**：前端内存缓存 + 后端 API 封装。初始化时读取 `/api/state`，后续写操作直接调用后端。
- **Auth**：负责游客 / 管理员登录、恢复登录态、退出登录与前端权限切换。
- **Render**：根据当前 Tab 渲染相应区块（录入、排行、图表、成员）。
- **Events**：表单提交、Tab 切换、筛选变更等事件绑定。

### 3.2 前端缓存模型
- `members`：当前成员数组，仅在页面运行期间保存在内存中
- `records`：当前积分记录数组，仅在页面运行期间保存在内存中
- `updatedAt`：最近一次后端落库时间戳

### 3.3 关键交互
- **同一局识别**：录入时同一时间戳的记录归为一局，由前端在排行/图表中聚合。
- **实时落库**：录入积分、成员变更、编辑删除记录后立即调用后端 API 并写入 SQLite。
- **交互收敛**：成员页不再展示同步模块，也不再展示导入导出模块；页面专注于记分与查看。
- **登录门禁**：未登录时先显示登录界面；游客进入后隐藏或禁用所有写操作，管理员进入后开放完整功能。

## 4. 后端设计（`server/index.js`）

### 4.1 技术栈
- Node.js + Express + cors
- SQLite（`better-sqlite3`）

### 4.2 关键实现
- **端口 / 监听地址**：默认 `0.0.0.0:3840`，可由 `PORT` / `HOST` 环境变量覆盖；置于反代后建议 `HOST=127.0.0.1`。
- **数据库文件**：`server/data/gasstoplist.sqlite3`。
- **数据表**：`members`、`records`、`app_meta`。
- **约束**：成员名唯一；记录通过外键绑定成员；删除有记录的成员时直接拒绝。
- **认证方式**：使用服务端签名的 HttpOnly Cookie 保存角色与过期时间；写接口统一要求管理员权限。
- **请求体大小**：上限 20 MB，足以容纳大量历史。
- **CORS**：`origin: true`（允许任意来源），便于本地开发；生产部署建议收敛白名单。
- **同端口静态页**：`npm start` 时由 Express 托管仓库根下 `web/`，推荐直接访问 `http://127.0.0.1:3840/`。

### 4.3 接口契约

| 方法 | 路径 | 请求体 | 成功响应 | 错误响应 |
|------|------|--------|----------|----------|
| GET | `/api/health` | — | `{ ok:true, service, time, dbPath }` | — |
| GET | `/api/auth/me` | — | `{ authenticated, role, expiresAt }` | — |
| POST | `/api/auth/guest` | — | `{ ok:true, role:'guest' }` | — |
| POST | `/api/auth/admin` | `{ password }` | `{ ok:true, role:'admin' }` | 400 / 401 |
| POST | `/api/auth/logout` | — | `{ ok:true }` | — |
| GET | `/api/state` | — | `{ members, records, updatedAt }` | — |
| POST | `/api/members` | `{ name }` | `{ member, updatedAt }` | 400 参数错误 / 409 名称重复 |
| DELETE | `/api/members/:id` | — | `{ ok:true, updatedAt }` | 404 不存在 / 409 有关联记录 |
| POST | `/api/records` | `{ records:[...] }` | `{ records, updatedAt }` | 400 参数错误 |
| PUT | `/api/records/:id` | `{ memberId?, score?, time?, note? }` | `{ ok:true, record, updatedAt }` | 400 / 404 |
| DELETE | `/api/records/:id` | — | `{ ok:true, updatedAt }` | 404 不存在 |
| DELETE | `/api/state` | — | `{ ok:true, updatedAt }` | — |

未匹配路径统一 404。

## 5. 部署形态

| 模式 | 部署方式 |
|------|----------|
| 本机使用 | `cd server && npm start` 后访问 `http://127.0.0.1:3840/` |
| 局域网共享 | 任意机器跑 `cd server && npm start`，其他设备访问 `http://<该机器IP>:3840/` |
| 公网部署 | 宿主 Nginx 托静态 + 反代 `/api/` 至 Docker 容器（Node 后端），Let's Encrypt HTTPS；详见 [`docs/deploy.md`](deploy.md)。上线前需修改管理员密码与认证密钥，建议继续加 Basic Auth / IP 白名单 |

## 6. 安全与隐私

- 服务端已提供基础登录与角色权限，但仍建议公网前加额外访问控制。
- 不收集任何用户标识；数据保存在用户自管服务器本机的 SQLite 文件中。

## 7. 已知限制 & 后续演进

- 当前仅支持单管理员密码 + 游客只读，不支持多管理员、多用户隔离。
- 单 SQLite 文件：适合轻量场景，更大规模时需迁 MySQL / PostgreSQL。
- 当前无离线能力；浏览器无法在后端不可用时继续记分。
