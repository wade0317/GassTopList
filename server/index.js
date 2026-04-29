/**
 * 德州扑克记分 — 后端服务
 * 作用：按「工作区 ID」将成员与积分记录持久化到服务器磁盘，供多台设备或备份使用。
 * 启动：在 server 目录执行 npm install && npm start
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// 监听端口，可通过环境变量 PORT 覆盖（默认 3840）
const PORT = Number(process.env.PORT) || 3840;
// 监听地址：生产环境置于反代后建议 127.0.0.1；默认 0.0.0.0 便于局域网开发
const HOST = process.env.HOST || '0.0.0.0';
// 数据文件根目录（与 index.js 同级的 data/workspaces）
const DATA_ROOT = path.join(__dirname, 'data', 'workspaces');

/** 校验工作区 ID，防止路径穿越与非法文件名 */
function isValidWorkspaceId(id) {
  if (typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id);
}

/** 确保数据目录存在 */
function ensureDataDir() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

/** 工作区对应的 JSON 文件绝对路径 */
function workspaceFilePath(workspaceId) {
  return path.join(DATA_ROOT, `${workspaceId}.json`);
}

/**
 * 读取某工作区的积分数据
 * @param {string} workspaceId 工作区 ID
 * @returns {{ members: any[], records: any[], updatedAt: number } | null}
 */
function readWorkspace(workspaceId) {
  const fp = workspaceFilePath(workspaceId);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf8');
  try {
    const data = JSON.parse(raw);
    return {
      members: Array.isArray(data.members) ? data.members : [],
      records: Array.isArray(data.records) ? data.records : [],
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    };
  } catch {
    return { members: [], records: [], updatedAt: 0 };
  }
}

/**
 * 写入工作区数据（整份覆盖）
 * @param {string} workspaceId 工作区 ID
 * @param {{ members: any[], records: any[] }} payload 成员与记录列表
 */
function writeWorkspace(workspaceId, payload) {
  ensureDataDir();
  const body = {
    members: Array.isArray(payload.members) ? payload.members : [],
    records: Array.isArray(payload.records) ? payload.records : [],
    updatedAt: Date.now(),
  };
  const fp = workspaceFilePath(workspaceId);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
  return body;
}

ensureDataDir();

const app = express();
// 允许浏览器从不同端口或域名访问本 API（开发时前端可能用 live-server）
app.use(cors({ origin: true }));
// 解析 JSON 请求体，体积上限 20MB（大量历史记录时足够）
app.use(express.json({ limit: '20mb' }));

/** 健康检查，用于确认服务已启动 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'gasstoplist', time: Date.now() });
});

/**
 * 获取指定工作区的全部数据
 * GET /api/workspaces/:workspaceId
 * 返回：{ members, records, updatedAt }；若不存在则 members/records 为空数组
 */
app.get('/api/workspaces/:workspaceId', (req, res) => {
  const { workspaceId } = req.params;
  if (!isValidWorkspaceId(workspaceId)) {
    return res.status(400).json({ error: '无效的工作区 ID' });
  }
  const data = readWorkspace(workspaceId);
  if (!data) {
    return res.json({ members: [], records: [], updatedAt: 0 });
  }
  return res.json(data);
});

/**
 * 覆盖保存指定工作区的数据（与前端 IndexedDB 结构一致）
 * PUT /api/workspaces/:workspaceId
 * 请求体：{ members: [...], records: [...] }
 */
app.put('/api/workspaces/:workspaceId', (req, res) => {
  const { workspaceId } = req.params;
  if (!isValidWorkspaceId(workspaceId)) {
    return res.status(400).json({ error: '无效的工作区 ID' });
  }
  const { members, records } = req.body || {};
  const saved = writeWorkspace(workspaceId, { members, records });
  return res.json({ ok: true, updatedAt: saved.updatedAt });
});

/** 404 */
app.use((_req, res) => {
  res.status(404).json({ error: '未找到接口' });
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[GassTopList] 已启动 http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[GassTopList] 数据目录 ${DATA_ROOT}`);
});
