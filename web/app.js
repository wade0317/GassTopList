/* ==============================
   Gass龙虎榜 - App Logic
   ============================== */

// ===== Store（仅内存缓存 + 后端 SQLite API） =====
// 页面若由后端托管，直接走同源 API；若是 file:// 打开，则回退到本机默认端口。
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3840' : '';

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

async function requestJSON(path, options = {}) {
  const res = await fetch(buildApiUrl(path), {
    credentials: 'include',
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (payload && typeof payload === 'object' && payload.error) {
      throw new Error(payload.error);
    }
    throw new Error(typeof payload === 'string' && payload ? payload : `请求失败 HTTP ${res.status}`);
  }
  return payload;
}

// ===== Auth（登录态与角色控制） =====
const Auth = {
  async fetchMe() {
    return requestJSON('/api/auth/me');
  },

  async loginAdmin(password) {
    return requestJSON('/api/auth/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  },

  async logout() {
    return requestJSON('/api/auth/logout', { method: 'POST' });
  },
};

const Store = {
  _cache: { members: [], records: [] },
  _updatedAt: 0,

  async init() {
    const payload = await requestJSON('/api/state');
    this._cache = {
      members: Array.isArray(payload.members) ? payload.members : [],
      records: Array.isArray(payload.records) ? payload.records : [],
    };
    this._updatedAt = Number(payload.updatedAt) || 0;
  },

  getMembers() {
    return [...this._cache.members];
  },

  getMemberName(id) {
    return this._cache.members.find(m => m.id === id)?.name || '未知成员';
  },

  async addMember(name) {
    const trimmed = name.trim();
    const existing = this._cache.members.find(m => m.name === trimmed);
    if (existing) return false;
    try {
      const payload = await requestJSON('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      this._cache.members.push(payload.member);
      this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
      return true;
    } catch (err) {
      if (err.message === '成员名称已存在') return false;
      throw err;
    }
  },

  async deleteMember(id) {
    try {
      const payload = await requestJSON(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this._cache.members = this._cache.members.filter(m => m.id !== id);
      this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
      return true;
    } catch (err) {
      if (err.message === '该成员已有积分记录，无法删除') return false;
      throw err;
    }
  },

  getRecords() {
    return [...this._cache.records];
  },

  getFilteredRecords({ startDate, endDate, memberId } = {}) {
    let records = this.getRecords();
    if (memberId) records = records.filter(r => r.memberId === memberId);
    if (startDate) records = records.filter(r => new Date(r.time) >= new Date(startDate));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      records = records.filter(r => new Date(r.time) <= end);
    }
    return records.sort((a, b) => new Date(b.time) - new Date(a.time));
  },

  async addRecords(records) {
    const payload = await requestJSON('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });
    const created = Array.isArray(payload.records) ? payload.records : [];
    this._cache.records.push(...created);
    this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
    return created;
  },

  async updateRecord(id, { memberId, score, time, note }) {
    const payload = await requestJSON(`/api/records/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, score, time, note }),
    });
    const nextRecord = payload.record;
    const idx = this._cache.records.findIndex(r => r.id === id);
    if (idx >= 0 && nextRecord) {
      this._cache.records[idx] = nextRecord;
    }
    this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
    return true;
  },

  async deleteRecord(id) {
    const payload = await requestJSON(`/api/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this._cache.records = this._cache.records.filter(r => r.id !== id);
    this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
    return true;
  },

  async clearAll() {
    const payload = await requestJSON('/api/state', { method: 'DELETE' });
    this._cache = { members: [], records: [] };
    this._updatedAt = Number(payload.updatedAt) || this._updatedAt;
  },
};

/** 现在所有写操作都已直接落到后端数据库，这里保留空函数以复用现有调用点。 */
function afterLocalPersist() {}

// ===== State =====
const state = {
  currentTab: 'entry',
  filter: 'all',
  customStart: '',
  customEnd: '',
  compareMode: false,
  editingId: null,
  confirmAction: null,
  chartMode: 'session',
  auth: null,
  appBound: false,
};

// ===== Utils =====
function localDateString(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function localTimeString(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineDateTime(dateVal, timeVal) {
  return new Date(`${dateVal}T${timeVal}`).toISOString();
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as first day
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return { start: monday.toISOString() };
}

function getMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: first.toISOString() };
}

function getDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return { start: d.toISOString() };
}

function getFilterRange(filter) {
  switch (filter) {
    case 'today': return { start: new Date().toISOString().slice(0, 10) + 'T00:00:00' };
    case 'week': return getWeekRange();
    case 'month': return getMonthRange();
    case '7d': return getDaysAgo(7);
    case '30d': return getDaysAgo(30);
    default: return {};
  }
}

function getFilterLabel(filter) {
  const labels = { all: '总榜', today: '今日', week: '本周', month: '本月', '7d': '近7天', '30d': '近30天' };
  return labels[filter] || filter;
}

function toast(message, type = 'success') {
  const container = document.querySelector('.toast-container') || (() => {
    const el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function getRankedScores(records, members) {
  const scores = {};
  members.forEach(m => scores[m.id] = 0);
  records.forEach(r => {
    if (scores[r.memberId] !== undefined) scores[r.memberId] += r.score;
  });
  const sorted = Object.entries(scores)
    .map(([memberId, score]) => ({ memberId, score, name: Store.getMemberName(memberId) }))
    .filter(s => s.name !== '未知成员')
    .sort((a, b) => b.score - a.score);
  // Assign ranks (handling ties)
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].score < sorted[i-1].score) rank = i + 1;
    sorted[i].rank = rank;
  }
  return sorted;
}

// ===== DOM =====
const $ = id => document.getElementById(id);

function isAdmin() {
  return state.auth?.role === 'admin';
}

function ensureAdminAction() {
  if (isAdmin()) return true;
  toast('请先输入管理员密码登录', 'error');
  return false;
}

/** 根据当前登录状态切换页面可编辑能力；登录后开放完整功能。 */
function applyRolePermissions() {
  document.body.classList.toggle('is-readonly', !isAdmin());

  const roleBadge = $('auth-role-badge');
  const logoutBtn = $('btn-logout');
  const loginScreen = $('login-screen');
  const app = $('app');
  const entryTip = $('entry-readonly-tip');
  const membersTip = $('members-readonly-tip');
  const memberAddCard = $('member-add-card');

  if (!state.auth) {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (app) app.style.display = 'none';
    if (roleBadge) roleBadge.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    return;
  }

  if (loginScreen) loginScreen.style.display = 'none';
  if (app) app.style.display = 'block';
  if (roleBadge) {
    roleBadge.style.display = 'inline-flex';
    roleBadge.textContent = '管理员';
  }
  if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  if (entryTip) entryTip.style.display = 'none';
  if (membersTip) membersTip.style.display = 'none';
  if (memberAddCard) memberAddCard.style.display = 'block';

  const entryForm = $('entry-form');
  if (entryForm) {
    entryForm.querySelectorAll('input, button').forEach(el => {
      el.disabled = !isAdmin();
    });
  }

  const editSubmitBtn = $('edit-form')?.querySelector('button[type="submit"]');
  if (editSubmitBtn) editSubmitBtn.disabled = !isAdmin();
}

/** 切换登录态后重新加载账本数据并刷新整个页面。 */
async function loadAppData() {
  await Store.init();
  $('entry-date').value = localDateString(new Date());
  $('entry-time').value = localTimeString(new Date());
  renderEntryMembers();
  renderHistory();
  renderLeaderboard();
  renderMembers();
  populateMemberSelects();
  renderChartMembers();
  renderChart();
  applyRolePermissions();
}

/** 读取当前登录态；未登录时仅显示登录界面。 */
async function restoreAuthState() {
  const auth = await Auth.fetchMe();
  state.auth = auth.authenticated ? { role: auth.role } : null;
  applyRolePermissions();
  if (state.auth) {
    await loadAppData();
  }
}

// ===== Navigation =====
function switchTab(tab) {
  if (state.currentTab !== tab) {
    state.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.page').forEach(el => {
      el.classList.toggle('active', el.id === `page-${tab}`);
    });
    if (tab === 'leaderboard') renderLeaderboard();
    if (tab === 'entry') renderHistory();
    if (tab === 'chart') { renderChartMembers(); renderChart(); }
    if (tab === 'members') renderMembers();
  }
}

// ===== Entry Page =====
function renderEntryMembers() {
  const container = $('entry-members');
  const members = Store.getMembers();
  if (!members.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:.875rem;">请先添加成员</span>';
    return;
  }
  container.innerHTML = members.map(m => `
    <div class="entry-member-row">
      <span class="entry-member-name">${m.name}</span>
      <input type="number" class="form-input entry-member-score" step="0.1" placeholder="积分（留空跳过）" ${isAdmin() ? '' : 'disabled'}>
    </div>
  `).join('');
}

async function handleEntrySubmit(e) {
  e.preventDefault();
  if (!ensureAdminAction()) return;
  const rows = [...document.querySelectorAll('.entry-member-row')];
  const entries = rows.filter(row => {
    const input = row.querySelector('.entry-member-score');
    return input.value !== '';
  }).map(row => {
    const nameEl = row.querySelector('.entry-member-name');
    const input = row.querySelector('.entry-member-score');
    const memberId = Store.getMembers().find(m => m.name === nameEl.textContent).id;
    return { memberId, score: parseFloat(input.value) };
  });

  if (!entries.length) { toast('请至少为一位成员输入积分', 'error'); return; }
  const dateVal = $('entry-date').value;
  const timeVal = $('entry-time').value;
  if (!dateVal || !timeVal) { toast('请选择时间', 'error'); return; }
  const time = combineDateTime(dateVal, timeVal);
  const note = $('entry-note').value.trim();

  const records = entries.map(e => ({ memberId: e.memberId, score: e.score, time, note }));
  await Store.addRecords(records);
  afterLocalPersist();
  toast(`已为 ${records.length} 位成员录入积分`);
  $('entry-form').reset();
  $('entry-date').value = localDateString(new Date());
  $('entry-time').value = localTimeString(new Date());
  renderEntryMembers();
  renderHistory();
}

function renderHistory() {
  const list = $('history-list');
  const filterMemberId = $('history-member-filter').value;
  const records = Store.getFilteredRecords({ memberId: filterMemberId || undefined });

  if (!records.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = records.map(r => {
    const name = Store.getMemberName(r.memberId);
    const scoreClass = r.score > 0 ? 'positive' : r.score < 0 ? 'negative' : '';
    const scoreDisplay = r.score > 0 ? `+${r.score}` : r.score;
    const noteHtml = r.note ? `<span> · ${r.note}</span>` : '';
    return `
      <div class="history-item" data-id="${r.id}">
        <div class="history-item-main">
          <div>
            <span class="history-item-name">${name}</span>
            <span class="history-item-score ${scoreClass}">${scoreDisplay}</span>
          </div>
          <div class="history-item-meta">${formatTime(r.time)}${noteHtml}</div>
        </div>
        <div class="history-item-actions">
          ${isAdmin()
            ? `
              <button class="btn-icon edit-record" data-id="${r.id}" title="编辑">✏️</button>
              <button class="btn-icon danger delete-record" data-id="${r.id}" title="删除">🗑</button>
            `
            : '<span class="readonly-actions-note">请先登录</span>'}
        </div>
      </div>
    `;
  }).join('');

  // Bind edit/delete events
  if (!isAdmin()) return;
  list.querySelectorAll('.edit-record').forEach(el => {
    el.addEventListener('click', () => openEditModal(el.dataset.id));
  });
  list.querySelectorAll('.delete-record').forEach(el => {
    el.addEventListener('click', () => confirmDeleteRecord(el.dataset.id));
  });
}

// ===== Leaderboard =====
function renderLeaderboard() {
  const members = Store.getMembers();
  const records = Store.getRecords();

  // Determine filter range
  let startDate, endDate;
  if (state.filter === 'custom' && state.customStart) {
    startDate = state.customStart;
    endDate = state.customEnd || undefined;
  } else {
    const range = getFilterRange(state.filter);
    startDate = range.start;
    endDate = range.end;
  }

  const filteredRecords = startDate
    ? records.filter(r => {
        const t = new Date(r.time).getTime();
        if (t < new Date(startDate).getTime()) return false;
        if (endDate && t > new Date(endDate).getTime()) return false;
        return true;
      })
    : records;

  const filteredScores = getRankedScores(filteredRecords, members);
  const totalScores = getRankedScores(records, members);

  const showCompare = state.compareMode && state.filter !== 'all';
  const tbody = $('rank-body');
  const emptyState = $('rank-empty');
  const totalHeader = $('total-col-header');
  totalHeader.style.display = showCompare ? '' : 'none';

  if (!filteredScores.length) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  // Build a map for total scores
  const totalMap = {};
  totalScores.forEach(s => totalMap[s.memberId] = s.score);

  const filterLabel = getFilterLabel(state.filter);

  tbody.innerHTML = filteredScores.map(s => {
    let rankClass = '';
    if (s.rank === 1) rankClass = 'rank-1';
    else if (s.rank === 2) rankClass = 'rank-2';
    else if (s.rank === 3) rankClass = 'rank-3';

    const scoreClass = s.score > 0 ? 'score-positive' : s.score < 0 ? 'score-negative' : 'score-zero';
    const scoreDisplay = s.score > 0 ? `+${s.score}` : s.score;

    let totalHtml = '';
    let totalDisplay = '';
    let totalClass = '';
    if (showCompare) {
      const ts = totalMap[s.memberId] || 0;
      totalDisplay = ts > 0 ? `+${ts}` : ts;
      totalClass = ts > 0 ? 'score-positive' : ts < 0 ? 'score-negative' : 'score-zero';
      totalHtml = `<td class="col-total ${totalClass}">${totalDisplay}</td>`;
    }

    return `
      <tr>
        <td class="col-rank"><span class="rank-num ${rankClass}">${s.rank}</span></td>
        <td class="col-name">${s.name}</td>
        <td class="col-score ${scoreClass}">${scoreDisplay}</td>
        ${totalHtml}
      </tr>
    `;
  }).join('');
}

// ===== Members Page =====
async function handleMemberAdd(e) {
  e.preventDefault();
  if (!ensureAdminAction()) return;
  const input = $('member-name');
  const name = input.value.trim();
  if (!name) return;
  if (await Store.addMember(name)) {
    afterLocalPersist();
    toast(`已添加成员「${name}」`);
    input.value = '';
    renderMembers();
    renderEntryMembers();
    renderChartMembers();
    populateMemberSelects();
  } else {
    toast(`成员「${name}」已存在`, 'error');
  }
}

function renderMembers() {
  const list = $('member-list');
  const members = Store.getMembers();
  const records = Store.getRecords();

  $('member-count').textContent = members.length;

  if (!members.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = members.map(m => {
    const recordCount = records.filter(r => r.memberId === m.id).length;
    return `
      <div class="member-item">
        <div>
          <span class="member-item-name">${m.name}</span>
          <span class="member-item-count">${recordCount} 条记录</span>
        </div>
        <div class="member-item-actions">
          ${isAdmin()
            ? `<button class="btn-icon danger delete-member" data-id="${m.id}" title="删除">🗑</button>`
            : '<span class="readonly-actions-note">请先登录</span>'}
        </div>
      </div>
    `;
  }).join('');

  if (!isAdmin()) return;
  list.querySelectorAll('.delete-member').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const success = await Store.deleteMember(id);
      if (!success) {
        toast('该成员已有积分记录，无法删除', 'error');
      } else {
        afterLocalPersist();
        toast('已删除成员');
        renderMembers();
        renderEntryMembers();
        renderChartMembers();
        populateMemberSelects();
        renderHistory();
      }
    });
  });
}

// ===== Modal: Edit Record =====
function openEditModal(recordId) {
  if (!ensureAdminAction()) return;
  const records = Store.getRecords();
  const record = records.find(r => r.id === recordId);
  if (!record) return;

  state.editingId = recordId;
  const modal = $('edit-modal');
  modal.style.display = 'flex';

  const members = Store.getMembers();
  const select = $('edit-member');
  select.innerHTML = members.map(m =>
    `<option value="${m.id}" ${m.id === record.memberId ? 'selected' : ''}>${m.name}</option>`
  ).join('');

  $('edit-score').value = record.score;
  $('edit-date').value = localDateString(record.time);
  $('edit-time').value = localTimeString(record.time);
  $('edit-note').value = record.note || '';
}

function closeEditModal() {
  $('edit-modal').style.display = 'none';
  state.editingId = null;
}

async function handleEditSubmit(e) {
  e.preventDefault();
  if (!ensureAdminAction()) return;
  if (!state.editingId) return;
  const dateVal = $('edit-date').value;
  const timeVal = $('edit-time').value;
  await Store.updateRecord(state.editingId, {
    memberId: $('edit-member').value,
    score: parseFloat($('edit-score').value),
    time: combineDateTime(dateVal, timeVal),
    note: $('edit-note').value.trim(),
  });
  afterLocalPersist();
  toast('记录已更新');
  closeEditModal();
  renderHistory();
  renderLeaderboard();
}

// ===== Modal: Confirm =====
function confirmDeleteRecord(recordId) {
  if (!ensureAdminAction()) return;
  state.confirmAction = async () => {
    await Store.deleteRecord(recordId);
    afterLocalPersist();
    toast('记录已删除');
    renderHistory();
    renderLeaderboard();
  };
  $('confirm-title').textContent = '删除记录';
  $('confirm-message').textContent = '确定要删除此条积分记录吗？';
  $('confirm-modal').style.display = 'flex';
}

function confirmClearAll() {
  if (!ensureAdminAction()) return;
  state.confirmAction = async () => {
    await Store.clearAll();
    afterLocalPersist();
    toast('所有数据已清除');
    renderMembers();
    renderEntryMembers();
    renderChartMembers();
    renderHistory();
    renderLeaderboard();
    populateMemberSelects();
  };
  $('confirm-title').textContent = '清空所有数据';
  $('confirm-message').textContent = '此操作将删除所有成员和积分记录，且无法恢复。确定继续吗？';
  $('confirm-modal').style.display = 'flex';
}

function closeConfirm() {
  $('confirm-modal').style.display = 'none';
  state.confirmAction = null;
}

// ===== Populate Member Selects =====
function populateMemberSelects() {
  const members = Store.getMembers();
  const selects = [$('history-member-filter')];
  selects.forEach(sel => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">全部成员</option>' +
      members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    sel.value = current;
  });
}

// ===== Export =====
function handleExport() {
  const csv = Store.exportCSV();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gasstoplist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV 已导出');
}

// ===== Backup / Restore =====
function handleExportBackup() {
  const data = Store.exportJSON();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('备份已导出');
}

function handleImportBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.members || !data.records) throw new Error('Invalid format');
      state.confirmAction = async () => {
        await Store.importJSON(data);
        afterLocalPersist();
        toast('数据已恢复');
        renderMembers();
        renderEntryMembers();
        renderChartMembers();
        renderHistory();
        renderLeaderboard();
        populateMemberSelects();
      };
      $('confirm-title').textContent = '导入备份';
      $('confirm-message').textContent =
        `将导入 ${data.members.length} 名成员和 ${data.records.length} 条记录，当前数据将被覆盖。确定继续吗？`;
      $('confirm-modal').style.display = 'flex';
    } catch {
      toast('备份文件格式无效', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ===== Chart =====
const CHART_COLORS = [
  '#4f46e5', '#22c55e', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#8b5cf6', '#f97316',
];

let chart = null;

function renderChartMembers() {
  const container = $('chart-members');
  const members = Store.getMembers();
  if (!members.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:.875rem;">暂无成员</span>';
    return;
  }
  const records = Store.getRecords();
  const totalByMember = {};
  records.forEach(r => { totalByMember[r.memberId] = (totalByMember[r.memberId] || 0) + r.score; });
  members.sort((a, b) => (totalByMember[b.id] || 0) - (totalByMember[a.id] || 0));
  container.innerHTML = members.map(m => `
    <label>
      <input type="checkbox" value="${m.id}" class="chart-member-cb">
      <span>${m.name}</span>
    </label>
  `).join('');

  container.querySelectorAll('.chart-member-cb').forEach(el => {
    el.addEventListener('change', renderChart);
  });
}

function renderChart() {
  const selected = [...document.querySelectorAll('.chart-member-cb:checked')].map(el => el.value);
  const chartCanvas = $('score-chart');
  const emptyEl = $('chart-empty');
  const summaryEl = $('chart-summary');

  if (!selected.length) {
    emptyEl.style.display = 'block';
    emptyEl.querySelector('p').textContent = '请选择至少一个成员';
    chartCanvas.style.display = 'none';
    summaryEl.style.display = 'none';
    return;
  }

  const mode = state.chartMode;
  const allRecords = Store.getRecords().filter(r => selected.includes(r.memberId));

  if (!allRecords.length) {
    emptyEl.style.display = 'block';
    emptyEl.querySelector('p').textContent = '所选成员暂无记录';
    chartCanvas.style.display = 'none';
    summaryEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  chartCanvas.style.display = 'block';
  summaryEl.style.display = 'flex';

  // Build datasets per member, sorted by total score desc
  const totalByMember = {};
  allRecords.forEach(r => { totalByMember[r.memberId] = (totalByMember[r.memberId] || 0) + r.score; });
  const sortedSelected = [...selected].sort((a, b) => (totalByMember[b] || 0) - (totalByMember[a] || 0));

  const datasets = sortedSelected.map((memberId, i) => {
    const memberRecords = allRecords
      .filter(r => r.memberId === memberId)
      .sort((a, b) => new Date(a.time) - new Date(b.time));

    let cum = 0;
    const data = memberRecords.map(r => {
      const x = new Date(r.time).getTime();
      if (mode === 'session') return { x, y: r.score };
      cum += r.score;
      return { x, y: Math.round(cum * 100) / 100 };
    });

    return {
      label: Store.getMemberName(memberId),
      data,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      fill: false,
      tension: 0.3,
      spanGaps: true,
    };
  });

  // Summary (combined across all selected members)
  let total = 0, gameScores = [], totalGames = new Set();
  selected.forEach(mid => {
    const memberRecords = allRecords.filter(r => r.memberId === mid);
    memberRecords.forEach(r => {
      total += r.score;
      gameScores.push(r.score);
      totalGames.add(r.time);
    });
  });
  const max = Math.max(...gameScores);
  const min = Math.min(...gameScores);

  summaryEl.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">综合积分</span>
      <span class="stat-value ${total > 0 ? 'score-positive' : total < 0 ? 'score-negative' : ''}">${total > 0 ? '+' : ''}${total}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">总对局</span>
      <span class="stat-value">${totalGames.size}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">总人次</span>
      <span class="stat-value">${gameScores.length}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">单次最高</span>
      <span class="stat-value score-positive">${max > 0 ? '+' : ''}${max}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">单次最低</span>
      <span class="stat-value ${min < 0 ? 'score-negative' : ''}">${min > 0 ? '+' : ''}${min}</span>
    </div>
  `;

  // Destroy previous chart
  if (chart) { chart.destroy(); }

  const ctx = chartCanvas.getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            boxWidth: 14,
            padding: 12,
            font: { size: 12 },
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed?.x;
              if (!x) return '';
              const d = new Date(x);
              return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
                ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
            },
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },
          ticks: {
            callback: (val) => {
              const d = new Date(val);
              return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
            },
            maxTicksLimit: 12,
            font: { size: 10 },
          },
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            callback: (val) => `${val > 0 ? '+' : ''}${val}`,
            font: { size: 11 },
          },
        },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

// ===== Init =====
async function init() {
  if (!state.appBound) {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(el => {
      el.addEventListener('click', () => switchTab(el.dataset.tab));
    });

    // Entry form
    $('entry-form').addEventListener('submit', handleEntrySubmit);

    // Member form
    $('member-form').addEventListener('submit', handleMemberAdd);

    // History filter
    $('history-member-filter').addEventListener('change', renderHistory);

    // Chart mode toggle
    document.querySelectorAll('.chart-mode-btn').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.chart-mode-btn').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
        state.chartMode = el.dataset.mode;
        renderChart();
      });
    });

    // Filter buttons (leaderboard)
    document.querySelectorAll('.filter-btn').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        el.classList.add('active');
        state.filter = el.dataset.filter;
        renderLeaderboard();
      });
    });

    // Custom date filter
    $('apply-date-filter').addEventListener('click', () => {
      const start = $('start-date').value;
      const end = $('end-date').value;
      if (!start) { toast('请选择起始日期', 'error'); return; }
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      state.filter = 'custom';
      state.customStart = start ? start + 'T00:00:00' : '';
      state.customEnd = end ? end + 'T23:59:59' : '';
      renderLeaderboard();
    });

    // Compare mode toggle
    $('compare-mode').addEventListener('change', (e) => {
      state.compareMode = e.target.checked;
      renderLeaderboard();
    });

    // Edit modal
    $('edit-form').addEventListener('submit', handleEditSubmit);
    $('edit-cancel').addEventListener('click', closeEditModal);
    $('edit-modal').addEventListener('click', (e) => {
      if (e.target === $('edit-modal')) closeEditModal();
    });

    // Confirm modal
    $('confirm-ok').addEventListener('click', async () => {
      if (state.confirmAction) await state.confirmAction();
      closeConfirm();
    });
    $('confirm-cancel').addEventListener('click', closeConfirm);
    $('confirm-modal').addEventListener('click', (e) => {
      if (e.target === $('confirm-modal')) closeConfirm();
    });

    // 登录相关：仅保留管理员密码登录；登录后可执行全部功能。
    $('admin-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('admin-password').value;
      try {
        const payload = await Auth.loginAdmin(password);
        state.auth = { role: payload.role };
        $('admin-password').value = '';
        await loadAppData();
        toast('登录成功');
      } catch (err) {
        toast(err.message || '密码登录失败', 'error');
      }
    });

    $('btn-logout').addEventListener('click', async () => {
      try {
        await Auth.logout();
      } finally {
        state.auth = null;
        state.editingId = null;
        state.confirmAction = null;
        closeEditModal();
        closeConfirm();
        applyRolePermissions();
        toast('已退出登录', 'info');
      }
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeEditModal();
        closeConfirm();
      }
      if (e.key === 'Enter' && $('confirm-modal').style.display === 'flex') {
        if (state.confirmAction) state.confirmAction();
        closeConfirm();
      }
    });

    state.appBound = true;
  }

  await restoreAuthState();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    console.error('[init] failed', err);
    toast(err.message || '初始化失败，请确认后端服务已启动', 'error');
  });
});
