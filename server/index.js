/**
 * 德州扑克记分 — 后端服务
 * 作用：使用 SQLite 持久化单账本数据，并托管前端静态页面。
 * 启动：在 server 目录执行 npm install && npm start
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

// 监听端口，可通过环境变量 PORT 覆盖（默认 3840）
const PORT = Number(process.env.PORT) || 3840;
// 监听地址：生产环境置于反代后建议 127.0.0.1；默认 0.0.0.0 便于局域网开发
const HOST = process.env.HOST || '0.0.0.0';
// 数据目录与 SQLite 文件路径
const DATA_ROOT = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_ROOT, 'gasstoplist.sqlite3');
// 前端静态页目录（与 server 同级的 web/），开发时与 API 同端口便于访问
const WEB_ROOT = path.resolve(__dirname, '..', 'web');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
// 登录 Cookie 与管理员密码配置；未配置时使用本地默认密码，便于快速体验。
const AUTH_COOKIE_NAME = 'gasstoplist_auth';
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_SECRET = process.env.AUTH_SECRET || 'gasstoplist-local-auth-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '15011501';

/** 确保数据目录存在 */
function ensureDataDir() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

/** 生成前后端通用的简短 ID */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 统一裁剪文本字段，避免空白值落库 */
function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** 解析请求头中的 Cookie 字符串 */
function parseCookies(cookieHeader) {
  const header = safeText(cookieHeader);
  if (!header) return {};
  return header.split(';').reduce((acc, item) => {
    const idx = item.indexOf('=');
    if (idx < 0) return acc;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

/** 对认证载荷做 HMAC 签名，避免客户端伪造角色 */
function signAuthPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
}

/** 生成角色登录态 Cookie 值 */
function buildAuthCookieValue(role) {
  const expiresAt = Date.now() + AUTH_TTL_MS;
  const payload = `${role}.${expiresAt}`;
  const signature = signAuthPayload(payload);
  return `${payload}.${signature}`;
}

/** 从请求中解析当前登录角色；校验失败时视为未登录 */
function readAuthSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[AUTH_COOKIE_NAME];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [role, expiresAtRaw, signature] = parts;
  if (!['guest', 'admin'].includes(role)) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const payload = `${role}.${expiresAt}`;
  const expected = signAuthPayload(payload);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  return { role, expiresAt };
}

/** 写入新的认证 Cookie；游客与管理员都走同一套会话结构 */
function setAuthCookie(res, role) {
  const cookieValue = encodeURIComponent(buildAuthCookieValue(role));
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${cookieValue}; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

/** 清空登录态 Cookie，用于退出登录 */
function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

/** 成员名称基础校验 */
function validateMemberName(name) {
  const trimmed = safeText(name);
  if (!trimmed) return '成员名称不能为空';
  if (trimmed.length > 20) return '成员名称不能超过 20 个字符';
  return '';
}

/** 记录数据基础校验 */
function validateRecordInput(record) {
  if (!record || typeof record !== 'object') return '记录格式无效';
  if (!safeText(record.memberId)) return '成员 ID 不能为空';
  if (!Number.isFinite(Number(record.score))) return '积分必须是数字';
  if (!safeText(record.time)) return '时间不能为空';
  if (Number.isNaN(Date.parse(record.time))) return '时间格式无效';
  return '';
}

ensureDataDir();

// SQLite 负责真正的数据持久化；前端只保留运行时内存缓存，不再落本地数据库。
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** 初始化表结构。单账本模式下无需工作区表。 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      score REAL NOT NULL,
      time TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_records_member_id ON records(member_id);
    CREATE INDEX IF NOT EXISTS idx_records_time ON records(time);
  `);
}

initSchema();

const selectUpdatedAtStmt = db.prepare(`SELECT value FROM app_meta WHERE key = 'updated_at'`);
const upsertUpdatedAtStmt = db.prepare(`
  INSERT INTO app_meta (key, value)
  VALUES ('updated_at', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const listMembersStmt = db.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM members
  ORDER BY created_at ASC, id ASC
`);
const listRecordsStmt = db.prepare(`
  SELECT id, member_id AS memberId, score, time, note, created_at AS createdAt
  FROM records
  ORDER BY datetime(time) DESC, created_at DESC, id DESC
`);
const insertMemberStmt = db.prepare(`
  INSERT INTO members (id, name, created_at)
  VALUES (@id, @name, @createdAt)
`);
const deleteMemberStmt = db.prepare(`DELETE FROM members WHERE id = ?`);
const countMemberRecordsStmt = db.prepare(`SELECT COUNT(1) AS count FROM records WHERE member_id = ?`);
const getMemberByNameStmt = db.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM members
  WHERE name = ?
`);
const getMemberByIdStmt = db.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM members
  WHERE id = ?
`);
const insertRecordStmt = db.prepare(`
  INSERT INTO records (id, member_id, score, time, note, created_at)
  VALUES (@id, @memberId, @score, @time, @note, @createdAt)
`);
const getRecordByIdStmt = db.prepare(`
  SELECT id, member_id AS memberId, score, time, note, created_at AS createdAt
  FROM records
  WHERE id = ?
`);
const updateRecordStmt = db.prepare(`
  UPDATE records
  SET member_id = @memberId,
      score = @score,
      time = @time,
      note = @note
  WHERE id = @id
`);
const deleteRecordStmt = db.prepare(`DELETE FROM records WHERE id = ?`);
const clearRecordsStmt = db.prepare(`DELETE FROM records`);
const clearMembersStmt = db.prepare(`DELETE FROM members`);

function getUpdatedAt() {
  const row = selectUpdatedAtStmt.get();
  return row ? Number(row.value) || 0 : 0;
}

function touchUpdatedAt() {
  const updatedAt = Date.now();
  upsertUpdatedAtStmt.run(String(updatedAt));
  return updatedAt;
}

function getStatePayload() {
  return {
    members: listMembersStmt.all(),
    records: listRecordsStmt.all(),
    updatedAt: getUpdatedAt(),
  };
}

const addMemberTx = db.transaction((name) => {
  const now = Date.now();
  const member = { id: genId(), name, createdAt: now };
  insertMemberStmt.run(member);
  const updatedAt = touchUpdatedAt();
  return { member, updatedAt };
});

const addRecordsTx = db.transaction((records) => {
  const now = Date.now();
  const created = records.map((record, index) => ({
    id: genId(),
    memberId: safeText(record.memberId),
    score: Number(record.score),
    time: safeText(record.time),
    note: safeText(record.note),
    createdAt: now + index,
  }));
  for (const record of created) {
    insertRecordStmt.run(record);
  }
  const updatedAt = touchUpdatedAt();
  return { records: created, updatedAt };
});

const clearAllTx = db.transaction(() => {
  clearRecordsStmt.run();
  clearMembersStmt.run();
  return { updatedAt: touchUpdatedAt() };
});

const app = express();
// 允许浏览器从不同端口或域名访问本 API（开发时便于直接调试）。
app.use(cors({ origin: true }));
// 解析 JSON 请求体，体积上限 20MB（对当前单账本模型足够）。
app.use(express.json({ limit: '20mb' }));
// 每次请求都尝试解析当前登录态，供后续鉴权中间件复用。
app.use((req, _res, next) => {
  req.auth = readAuthSession(req);
  next();
});

/** 需要登录后才能访问的接口 */
function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: '请先登录' });
  return next();
}

/** 只有管理员才能改数据 */
function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: '请先登录' });
  if (req.auth.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  return next();
}

/** 健康检查，用于确认服务已启动 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'gasstoplist', time: Date.now(), dbPath: DB_PATH });
});

/** 查询当前浏览器是否已登录，以及当前角色 */
app.get('/api/auth/me', (req, res) => {
  if (!req.auth) return res.json({ authenticated: false, role: null });
  return res.json({ authenticated: true, role: req.auth.role, expiresAt: req.auth.expiresAt });
});

/** 游客可直接登录；只发只读权限的会话 Cookie */
app.post('/api/auth/guest', (_req, res) => {
  setAuthCookie(res, 'guest');
  res.json({ ok: true, role: 'guest' });
});

/** 管理员登录：必须输入正确密码 */
app.post('/api/auth/admin', (req, res) => {
  const password = safeText(req.body?.password);
  if (!password) return res.status(400).json({ error: '请输入管理员密码' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: '管理员密码错误' });
  setAuthCookie(res, 'admin');
  return res.json({ ok: true, role: 'admin' });
});

/** 退出登录：清掉当前浏览器的登录态 */
app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** 获取当前默认账本的全部数据 */
app.get('/api/state', requireAuth, (_req, res) => {
  res.json(getStatePayload());
});

/** 新增成员 */
app.post('/api/members', requireAdmin, (req, res) => {
  const name = safeText(req.body?.name);
  const error = validateMemberName(name);
  if (error) return res.status(400).json({ error });
  try {
    const result = addMemberTx(name);
    return res.status(201).json(result);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      const existing = getMemberByNameStmt.get(name);
      return res.status(409).json({ error: '成员名称已存在', member: existing || null });
    }
    return res.status(500).json({ error: '新增成员失败' });
  }
});

/** 删除成员；有积分记录时不允许删 */
app.delete('/api/members/:id', requireAdmin, (req, res) => {
  const memberId = safeText(req.params.id);
  if (!memberId) return res.status(400).json({ error: '成员 ID 不能为空' });
  const member = getMemberByIdStmt.get(memberId);
  if (!member) return res.status(404).json({ error: '成员不存在' });
  const count = Number(countMemberRecordsStmt.get(memberId)?.count || 0);
  if (count > 0) {
    return res.status(409).json({ error: '该成员已有积分记录，无法删除' });
  }
  deleteMemberStmt.run(memberId);
  return res.json({ ok: true, updatedAt: touchUpdatedAt() });
});

/** 批量新增一局或多局积分记录 */
app.post('/api/records', requireAdmin, (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ error: '至少需要一条记录' });
  for (const record of records) {
    const error = validateRecordInput(record);
    if (error) return res.status(400).json({ error });
  }
  try {
    const result = addRecordsTx(records);
    return res.status(201).json(result);
  } catch (err) {
    if (String(err.message || '').includes('FOREIGN KEY')) {
      return res.status(400).json({ error: '记录中存在无效的成员 ID' });
    }
    return res.status(500).json({ error: '新增记录失败' });
  }
});

/** 更新单条积分记录 */
app.put('/api/records/:id', requireAdmin, (req, res) => {
  const recordId = safeText(req.params.id);
  if (!recordId) return res.status(400).json({ error: '记录 ID 不能为空' });
  const current = getRecordByIdStmt.get(recordId);
  if (!current) return res.status(404).json({ error: '记录不存在' });
  const next = {
    id: recordId,
    memberId: req.body?.memberId !== undefined ? safeText(req.body.memberId) : current.memberId,
    score: req.body?.score !== undefined ? Number(req.body.score) : current.score,
    time: req.body?.time !== undefined ? safeText(req.body.time) : current.time,
    note: req.body?.note !== undefined ? safeText(req.body.note) : current.note,
  };
  const error = validateRecordInput(next);
  if (error) return res.status(400).json({ error });
  try {
    updateRecordStmt.run(next);
    const updatedAt = touchUpdatedAt();
    return res.json({
      ok: true,
      updatedAt,
      record: {
        id: recordId,
        memberId: next.memberId,
        score: next.score,
        time: next.time,
        note: next.note,
        createdAt: current.createdAt,
      },
    });
  } catch (err) {
    if (String(err.message || '').includes('FOREIGN KEY')) {
      return res.status(400).json({ error: '成员 ID 无效' });
    }
    return res.status(500).json({ error: '更新记录失败' });
  }
});

/** 删除单条积分记录 */
app.delete('/api/records/:id', requireAdmin, (req, res) => {
  const recordId = safeText(req.params.id);
  if (!recordId) return res.status(400).json({ error: '记录 ID 不能为空' });
  const result = deleteRecordStmt.run(recordId);
  if (!result.changes) return res.status(404).json({ error: '记录不存在' });
  return res.json({ ok: true, updatedAt: touchUpdatedAt() });
});

/** 清空整个默认账本 */
app.delete('/api/state', requireAdmin, (_req, res) => {
  const result = clearAllTx();
  res.json({ ok: true, updatedAt: result.updatedAt });
});

/** 显式提供首页（避免个别环境下 express.static 对 / 未命中） */
function sendIndexHtml(res, next) {
  if (!fs.existsSync(INDEX_HTML)) return next();
  return res.sendFile(INDEX_HTML);
}

app.get('/', (_req, res, next) => sendIndexHtml(res, next));
app.get('/index.html', (_req, res, next) => sendIndexHtml(res, next));

// 兼容误输入的 /web/xxx（静态根在 /，相对路径资源才能加载）
app.use((req, res, next) => {
  if (req.path === '/web' || req.path.startsWith('/web/')) {
    const target = req.path === '/web' ? '/' : req.path.slice('/web'.length);
    return res.redirect(302, target || '/');
  }
  return next();
});

// 托管 web/ 下静态资源；浏览器请用 http://127.0.0.1:3840/ 或 /index.html
app.use(express.static(WEB_ROOT, { index: 'index.html' }));

/** 未匹配：仅 /api 下返回 JSON「未找到接口」，其它路径返回 HTML 提示 */
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: '未找到接口' });
  }
  return res
    .status(404)
    .type('html')
    .send(
      '<!DOCTYPE html><html lang="zh-CN"><meta charset="UTF-8"><title>404</title><p>页面不存在。</p><p><a href="/">返回记分首页</a></p></html>',
    );
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[GassTopList] 已启动 http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[GassTopList] SQLite 数据库 ${DB_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`[GassTopList] 静态目录 ${WEB_ROOT}（index 存在: ${fs.existsSync(INDEX_HTML)}）`);
});
