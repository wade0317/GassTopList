/* ==============================
   德州扑克记分工具 - App Logic
   ============================== */

// ===== Store (IndexedDB + memory cache) =====
const Store = {
  _db: null,
  _cache: { members: [], records: [] },

  async init() {
    return new Promise((resolve) => {
      const req = indexedDB.open('PokerScores', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('members')) {
          db.createObjectStore('members', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'id' });
          store.createIndex('memberId', 'memberId', { unique: false });
          store.createIndex('time', 'time', { unique: false });
        }
      };
      req.onsuccess = async (e) => {
        this._db = e.target.result;
        this._cache.members = await this._getAll('members');
        this._cache.records = await this._getAll('records');
        // Fallback: migrate from localStorage if empty
        if (!this._cache.members.length && !this._cache.records.length) {
          try {
            const old = localStorage.getItem('poker-scores-data');
            if (old) {
              const data = JSON.parse(old);
              if (data.members?.length || data.records?.length) {
                await this._import(data);
                localStorage.removeItem('poker-scores-data');
                console.log('Migrated from localStorage to IndexedDB');
              }
            }
          } catch { /* ignore */ }
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  },

  _getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  _put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  _delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async _import(data) {
    this._cache = { members: data.members || [], records: data.records || [] };
    const tx = this._db.transaction(['members', 'records'], 'readwrite');
    tx.objectStore('members').clear();
    tx.objectStore('records').clear();
    for (const m of this._cache.members) tx.objectStore('members').put(m);
    for (const r of this._cache.records) tx.objectStore('records').put(r);
    await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
  },

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  // Members — sync reads from cache
  getMembers() {
    return [...this._cache.members];
  },

  getMemberName(id) {
    return this._cache.members.find(m => m.id === id)?.name || '未知成员';
  },

  async addMember(name) {
    if (this._cache.members.some(m => m.name === name)) return false;
    const member = { id: this._genId(), name: name.trim(), createdAt: Date.now() };
    this._cache.members.push(member);
    await this._put('members', member);
    return true;
  },

  async deleteMember(id) {
    if (this._cache.records.some(r => r.memberId === id)) return false;
    this._cache.members = this._cache.members.filter(m => m.id !== id);
    await this._delete('members', id);
    return true;
  },

  // Records — sync reads from cache
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
    const now = Date.now();
    const newRecords = records.map(r => ({
      id: this._genId(),
      memberId: r.memberId,
      score: Number(r.score),
      time: r.time || new Date().toISOString(),
      note: r.note || '',
      createdAt: now,
    }));
    for (const rec of newRecords) {
      this._cache.records.push(rec);
      await this._put('records', rec);
    }
    return newRecords;
  },

  async updateRecord(id, { memberId, score, time, note }) {
    const record = this._cache.records.find(r => r.id === id);
    if (!record) return false;
    if (memberId !== undefined) record.memberId = memberId;
    if (score !== undefined) record.score = Number(score);
    if (time !== undefined) record.time = time;
    if (note !== undefined) record.note = note;
    await this._put('records', record);
    return true;
  },

  async deleteRecord(id) {
    this._cache.records = this._cache.records.filter(r => r.id !== id);
    await this._delete('records', id);
    return true;
  },

  async clearAll() {
    this._cache = { members: [], records: [] };
    const tx = this._db.transaction(['members', 'records'], 'readwrite');
    tx.objectStore('members').clear();
    tx.objectStore('records').clear();
    await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
  },

  // Export / Backup
  exportCSV() {
    const memberMap = {};
    this._cache.members.forEach(m => memberMap[m.id] = m.name);
    const header = '成员,积分,时间,备注';
    const rows = [...this._cache.records]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .map(r => {
        const name = memberMap[r.memberId] || '未知成员';
        const time = new Date(r.time).toLocaleString('zh-CN', { hour12: false });
        const note = r.note ? `"${r.note.replace(/"/g, '""')}"` : '';
        return `${name},${r.score},"${time}",${note}`;
      });
    return '﻿' + [header, ...rows].join('\n');
  },

  exportJSON() {
    return { members: this._cache.members, records: this._cache.records };
  },

  async importJSON(data) {
    await this._import(data);
  },
};

// ===== 云端同步：与后端 server 模块通信，持久化用户积分数据 =====
/** localStorage 中保存的后端根地址，例如 http://127.0.0.1:3840 */
const LS_API_BASE = 'poker-api-base';
/** 工作区 ID：同一份数据在不同浏览器输入相同 ID 可共用（须与服务器文件对应） */
const LS_WORKSPACE_ID = 'poker-workspace-id';
/** 是否在每次本地数据变更后自动 PUT 到服务器 */
const LS_SYNC_AUTO = 'poker-sync-auto';

const ApiSync = {
  /** 防抖定时器句柄，避免连续录入时频繁请求 */
  _pushTimer: null,

  /** 读取或生成工作区 ID（首次访问自动生成并写入本地） */
  getWorkspaceId() {
    let id = localStorage.getItem(LS_WORKSPACE_ID);
    if (id && /^[a-zA-Z0-9_-]{8,128}$/.test(id)) return id;
    id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(LS_WORKSPACE_ID, id);
    return id;
  },

  /** 去掉末尾斜杠，便于拼接 /api/... */
  normalizeBase(url) {
    const s = (url || '').trim();
    if (!s) return '';
    return s.replace(/\/+$/, '');
  },

  /** 从本地存储读取 API 根地址 */
  getApiBase() {
    return this.normalizeBase(localStorage.getItem(LS_API_BASE) || 'http://127.0.0.1:3840');
  },

  /** 保存 API 根地址到本地存储 */
  saveApiBase(url) {
    const n = this.normalizeBase(url);
    if (n) localStorage.setItem(LS_API_BASE, n);
  },

  /** 是否开启「变更后自动上传」 */
  isAutoSync() {
    return localStorage.getItem(LS_SYNC_AUTO) === '1';
  },

  setAutoSync(on) {
    localStorage.setItem(LS_SYNC_AUTO, on ? '1' : '0');
  },

  /** 若开启自动同步，则在短延迟后把当前 IndexedDB 镜像推到服务器 */
  schedulePush() {
    if (!this.isAutoSync()) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.pushToServer().catch((err) => {
        console.error('[ApiSync] push failed', err);
        toast(err.message || '上传失败', 'error');
      });
    }, 800);
  },

  /**
   * 立即将本地成员与记录整包上传到服务器（覆盖服务器该工作区数据）
   * @returns {Promise<{ updatedAt: number }>}
   */
  async pushToServer() {
    const base = this.getApiBase();
    if (!base) throw new Error('请先填写服务器地址');
    const wid = this.getWorkspaceId();
    const res = await fetch(`${base}/api/workspaces/${encodeURIComponent(wid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Store.exportJSON()),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `上传失败 HTTP ${res.status}`);
    }
    const j = await res.json();
    return { updatedAt: j.updatedAt };
  },

  /**
   * 从服务器拉取当前工作区的成员与记录（不写入本地，仅返回 JSON）
   */
  async fetchRemotePayload() {
    const base = this.getApiBase();
    if (!base) throw new Error('请先填写服务器地址');
    const wid = this.getWorkspaceId();
    const res = await fetch(`${base}/api/workspaces/${encodeURIComponent(wid)}`);
    if (!res.ok) throw new Error(`拉取失败 HTTP ${res.status}`);
    return res.json();
  },

  /** 测试后端是否可达（健康检查） */
  async testConnection() {
    const base = this.getApiBase();
    if (!base) throw new Error('请先填写服务器地址');
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) throw new Error(`连接失败 HTTP ${res.status}`);
    return res.json();
  },

  /** 把「服务器地址」「工作区 ID」等控件与本地状态对齐 */
  refreshSettingsUI() {
    const baseEl = $('api-base-url');
    const wsEl = $('workspace-id-display');
    const autoEl = $('sync-auto');
    if (baseEl) baseEl.value = localStorage.getItem(LS_API_BASE) || 'http://127.0.0.1:3840';
    if (wsEl) wsEl.value = this.getWorkspaceId();
    if (autoEl) autoEl.checked = this.isAutoSync();
  },
};

/** 任意本地持久化成功后调用：在自动同步开启时排队上传 */
function afterLocalPersist() {
  ApiSync.schedulePush();
}

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
      <input type="number" class="form-input entry-member-score" step="0.1" placeholder="积分（留空跳过）">
    </div>
  `).join('');
}

async function handleEntrySubmit(e) {
  e.preventDefault();
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
          <button class="btn-icon edit-record" data-id="${r.id}" title="编辑">✏️</button>
          <button class="btn-icon danger delete-record" data-id="${r.id}" title="删除">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind edit/delete events
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
          <button class="btn-icon danger delete-member" data-id="${m.id}" title="删除">🗑</button>
        </div>
      </div>
    `;
  }).join('');

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

  // Build datasets per member
  const datasets = selected.map((memberId, i) => {
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
  await Store.init();

  // 云端同步：把输入框与本地保存的服务器地址、工作区 ID 对齐
  ApiSync.refreshSettingsUI();

  // Set default time
  $('entry-date').value = localDateString(new Date());
  $('entry-time').value = localTimeString(new Date());

  // Render initial data
  renderEntryMembers();
  renderHistory();
  renderLeaderboard();
  renderMembers();
  populateMemberSelects();
  renderChartMembers();
  renderChart();

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
    // Deselect preset filters
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

  // Export
  $('export-csv').addEventListener('click', handleExport);

  // Backup / Restore
  $('export-backup').addEventListener('click', handleExportBackup);
  $('import-backup').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', handleImportBackup);

  // Clear all
  $('clear-all').addEventListener('click', confirmClearAll);

  // 云端同步：保存服务器地址、开关自动上传、测试连接、拉取 / 推送
  const apiBaseInput = $('api-base-url');
  if (apiBaseInput) {
    apiBaseInput.addEventListener('change', () => {
      ApiSync.saveApiBase(apiBaseInput.value);
      ApiSync.refreshSettingsUI();
    });
  }
  const syncAuto = $('sync-auto');
  if (syncAuto) {
    syncAuto.addEventListener('change', () => {
      ApiSync.setAutoSync(syncAuto.checked);
      if (syncAuto.checked) {
        ApiSync.pushToServer().then(() => toast('已开启自动同步并上传当前数据')).catch((err) => {
          toast(err.message || '上传失败', 'error');
          syncAuto.checked = false;
          ApiSync.setAutoSync(false);
        });
      }
    });
  }
  const btnTest = $('btn-test-api');
  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      if (apiBaseInput) ApiSync.saveApiBase(apiBaseInput.value);
      try {
        await ApiSync.testConnection();
        toast('服务器连接正常');
      } catch (err) {
        toast(err.message || '连接失败', 'error');
      }
    });
  }
  const btnPush = $('btn-push-server');
  if (btnPush) {
    btnPush.addEventListener('click', async () => {
      if (apiBaseInput) ApiSync.saveApiBase(apiBaseInput.value);
      try {
        await ApiSync.pushToServer();
        toast('已上传到服务器');
      } catch (err) {
        toast(err.message || '上传失败', 'error');
      }
    });
  }
  const btnPull = $('btn-pull-server');
  if (btnPull) {
    btnPull.addEventListener('click', async () => {
      if (apiBaseInput) ApiSync.saveApiBase(apiBaseInput.value);
      try {
        const remote = await ApiSync.fetchRemotePayload();
        const m = (remote.members || []).length;
        const r = (remote.records || []).length;
        state.confirmAction = async () => {
          await Store.importJSON({ members: remote.members || [], records: remote.records || [] });
          afterLocalPersist();
          toast('已从服务器恢复');
          renderMembers();
          renderEntryMembers();
          renderChartMembers();
          renderHistory();
          renderLeaderboard();
          populateMemberSelects();
        };
        $('confirm-title').textContent = '从服务器拉取';
        $('confirm-message').textContent =
          `将导入服务器上的 ${m} 名成员与 ${r} 条记录，并覆盖当前本地数据。确定继续吗？`;
        $('confirm-modal').style.display = 'flex';
      } catch (err) {
        toast(err.message || '拉取失败', 'error');
      }
    });
  }
  const btnCopyWs = $('btn-copy-workspace');
  if (btnCopyWs) {
    btnCopyWs.addEventListener('click', async () => {
      const wid = ApiSync.getWorkspaceId();
      try {
        await navigator.clipboard.writeText(wid);
        toast('工作区 ID 已复制');
      } catch {
        toast('复制失败，请手动选择复制', 'error');
      }
    });
  }

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
}

document.addEventListener('DOMContentLoaded', init);
