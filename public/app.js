// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const _baseSeg = window.location.pathname.split('/')[1];
const API_BASE = _baseSeg ? '/' + _baseSeg : '';

// ═══════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════
const THEMES = {
  void: {
    label: 'Void',
    '--bg':'#0d0d14', '--surface':'#13131e', '--border':'#1e1e30', '--border2':'#2a2a42',
    '--text':'#eae8f6', '--muted':'#7a7898', '--sub':'#9390b0',
    '--gold':'#a78bfa', '--red':'#f87171', '--green':'#86efac', '--blue':'#7dd3fc',
    '--table-head':'#0f0f18', '--row-hover':'#17172a', '--secret-bg':'#09090f', '--btn-gold-text':'#0d0d14', '--note-color':'#3e3c58',
  },
  dusk: {
    label: 'Dusk',
    '--bg':'#111118', '--surface':'#1c1c28', '--border':'#272738', '--border2':'#333350',
    '--text':'#ece9f8', '--muted':'#8e8aac', '--sub':'#a8a4c4',
    '--gold':'#b49dfc', '--red':'#fc8080', '--green':'#93f2b8', '--blue':'#8adafc',
    '--table-head':'#0e0e1a', '--row-hover':'#1f1f30', '--secret-bg':'#0a0a12', '--btn-gold-text':'#111118', '--note-color':'#44425e',
  },
  ash: {
    label: 'Ash',
    '--bg':'#0f0f0f', '--surface':'#141414', '--border':'#1e1e1e', '--border2':'#252525',
    '--text':'#f0ede6', '--muted':'#706e6b', '--sub':'#8a8784',
    '--gold':'#e8c547', '--red':'#e87c7c', '--green':'#b8d47e', '--blue':'#7eb8d4',
    '--table-head':'#0b0b0b', '--row-hover':'#181818', '--secret-bg':'#080808', '--btn-gold-text':'#0f0f0f', '--note-color':'#605e58',
  },
  light: {
    label: 'Light',
    '--bg':'#f1f2f5', '--surface':'#f8f9fb', '--border':'#dde0e8', '--border2':'#c4c8d4',
    '--text':'#1a1d26', '--muted':'#6b7280', '--sub':'#4b5563',
    '--gold':'#5548c8', '--red':'#b83232', '--green':'#1a6b40', '--blue':'#2a5fa8',
    '--table-head':'#e8eaef', '--row-hover':'#edeef2', '--secret-bg':'#e4e6ec', '--btn-gold-text':'#ffffff', '--note-color':'#8b92a0',
  },
};

let currentTheme = 'void';

function tagColor(map, mapLight, key) {
  const m = currentTheme === 'light' ? mapLight : map;
  return m[key] || (currentTheme === 'light' ? '#555' : '#888');
}

function tagStyle(color) {
  if (currentTheme === 'light') {
    return `background:${color}18;color:${color};border:1px solid ${color}55`;
  }
  return `background:${color}18;color:${color};border:1px solid ${color}28`;
}

function applyTheme(name) {
  const t = THEMES[name] || THEMES.void;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) {
    if (k !== 'label') root.setProperty(k, v);
  }
  currentTheme = name;
  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === name);
  });
  if (typeof renderAll === 'function' && appGames) renderAll();
}

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let accessToken = null;
let csrfToken = null;
let appGames = null;
let appProfile = null;
let activeCat = 'queue';
let modeFilter = null;
let riskFilter = null;
let mfaToken = null;
let pendingItems = [];
let pendingPollTimer = null;
let profileEditing = false;
let historyVisible = false;
let editingNote = null;
let globalSearchQuery = '';

applyTheme(localStorage.getItem('theme') || 'void');

applyTheme(localStorage.getItem('theme') || 'void');

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════
async function api(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (csrfToken && method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(API_BASE + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  if (!res.ok && res.headers.get('content-type')?.includes('application/json') === false) {
    return { error: `Server error ${res.status}` };
  }
  return res.json();
}

async function fetchCsrfToken() {
  try {
    const data = await api('GET', '/api/auth/csrf', null, false);
    if (data.csrfToken) csrfToken = data.csrfToken;
  } catch {}
}

async function refreshAccessToken() {
  try {
    const data = await api('POST', '/api/auth/refresh', null, false);
    if (data.accessToken) { accessToken = data.accessToken; return true; }
  } catch {}
  return false;
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
  try {
    // Check if configured
    const status = await api('GET', '/api/setup/status', null, false);
    if (!status.configured) { showScreen('setup'); await initSetup(); return; }

    // Fetch CSRF token (sets cookie + returns token for X-CSRF-Token header)
    await fetchCsrfToken();

    // Try refresh token
    const ok = await refreshAccessToken();
    if (ok) { await loadApp(); return; }

    showScreen('login');
  } catch(e) {
    console.error('Boot error:', e);
    showScreen('login');
  }
}

// ═══════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════
function showScreen(name) {
  ['loading','setup','login','main'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.remove('hidden');
}
function hideErr(id) { document.getElementById(id).classList.add('hidden'); }

// ═══════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════
async function initSetup() {
  const data = await api('GET', '/api/setup/secret', null, false);
  document.getElementById('setup-secret-display').textContent = data.formatted || '';
  if (data.qrDataUrl) document.getElementById('setup-qr').src = data.qrDataUrl;
}

function showSetupStep1() {
  document.getElementById('setup-step1').classList.remove('hidden');
  document.getElementById('setup-step2').classList.add('hidden');
}

async function setupStep1() {
  hideErr('setup-error1');
  const username = document.getElementById('setup-username').value.trim();
  const password = document.getElementById('setup-password').value;
  const confirm  = document.getElementById('setup-confirm').value;
  if (!username) return showErr('setup-error1', 'Username required');
  if (password.length < 6) return showErr('setup-error1', 'Password must be at least 6 characters');
  if (password !== confirm) return showErr('setup-error1', 'Passwords do not match');
  document.getElementById('setup-step1').classList.add('hidden');
  document.getElementById('setup-step2').classList.remove('hidden');
}

async function setupComplete() {
  hideErr('setup-error2');
  const username  = document.getElementById('setup-username').value.trim();
  const password  = document.getElementById('setup-password').value;
  const totpCode  = document.getElementById('setup-totp').value.trim();
  const data = await api('POST', '/api/setup', { username, password, totpCode }, false);
  if (data.error) return showErr('setup-error2', data.error);
  // Show recovery codes before proceeding — they're only shown once
  document.getElementById('setup-step2').classList.add('hidden');
  document.getElementById('setup-step3').classList.remove('hidden');
  const codesEl = document.getElementById('setup-recovery-codes');
  codesEl.innerHTML = (data.recoveryCodes || []).map(c => `<div class="recovery-code">${esc(c)}</div>`).join('');
}

// ═══════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════
function showLoginStep1() {
  document.getElementById('login-step1').classList.remove('hidden');
  document.getElementById('login-step2').classList.add('hidden');
  document.getElementById('login-totp-mode').classList.remove('hidden');
  document.getElementById('login-recovery-mode').classList.add('hidden');
  hideErr('login-error2');
  hideErr('login-error3');
}

async function loginStep1() {
  hideErr('login-error1');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const data = await api('POST', '/api/auth/login', { username, password }, false);
  if (data.error) return showErr('login-error1', data.error);
  mfaToken = data.mfaToken;
  document.getElementById('login-step1').classList.add('hidden');
  document.getElementById('login-step2').classList.remove('hidden');
  document.getElementById('login-totp').focus();
}

async function loginStep2() {
  hideErr('login-error2');
  const code = document.getElementById('login-totp').value.trim();
  const data = await api('POST', '/api/auth/mfa', { mfaToken, code }, false);
  if (data.error) return showErr('login-error2', data.error);
  accessToken = data.accessToken;
  if (data.csrfToken) csrfToken = data.csrfToken;
  await loadApp();
}

function toggleRecoveryMode(e) {
  e.preventDefault();
  const totp = document.getElementById('login-totp-mode');
  const rec  = document.getElementById('login-recovery-mode');
  const isTotp = !totp.classList.contains('hidden');
  totp.classList.toggle('hidden', isTotp);
  rec.classList.toggle('hidden', !isTotp);
  hideErr('login-error2');
  hideErr('login-error3');
}

async function loginRecovery() {
  hideErr('login-error3');
  const code = document.getElementById('login-recovery').value.trim();
  const data = await api('POST', '/api/auth/recovery', { mfaToken, code }, false);
  if (data.error) return showErr('login-error3', data.error);
  accessToken = data.accessToken;
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (data.remaining !== undefined && data.remaining <= 2) {
    showToast(`Warning: only ${data.remaining} recovery code${data.remaining === 1 ? '' : 's'} remaining. Regenerate in Settings.`);
  }
  await loadApp();
}

// Enter key on login fields
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (!document.getElementById('screen-login').classList.contains('hidden')) {
    if (!document.getElementById('login-step1').classList.contains('hidden')) loginStep1();
    else if (!document.getElementById('login-recovery-mode').classList.contains('hidden')) loginRecovery();
    else loginStep2();
  }
});

// ═══════════════════════════════════════════════════════════
// LOAD APP DATA
// ═══════════════════════════════════════════════════════════
async function loadApp() {
  const data = await api('GET', '/api/data');
  appGames   = data.games   || getInitialGames();
  appProfile = data.profile || getDefaultProfile();
  if (!data.games || !data.profile) {
    await api('POST', '/api/data', { games: appGames, profile: appProfile });
  }
  showScreen('main');
  renderAll();
  await loadPending();
  pendingPollTimer = setInterval(loadPending, 30000);
}

async function saveData() {
  await api('POST', '/api/data', { games: appGames, profile: appProfile });
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'pending') renderPendingTab();
  if (tab === 'settings') {
    const saved = localStorage.getItem('theme') || 'void';
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === saved));
    loadRecoveryCodeCount();
  }
}

function switchCat(cat) {
  activeCat = cat; modeFilter = null; riskFilter = null; editingNote = null;
  // Default sort: played → date played; everything else → rank
  sortBy = (cat === 'played') ? 'playedDate' : 'rank';
  const sortEl = document.getElementById('game-sort');
  if (sortEl) sortEl.value = sortBy;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderFilters();
  renderGames();
}

function onSortChange(val) { sortBy = val; renderGames(); }

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
const MODES = {
  atmospheric:'#7dd3fc', narrative:'#f9a8d4', detective:'#86efac',
  tactical:'#c4b5fd', immersive:'#a78bfa', action:'#f87171',
  strategy:'#93c5fd', puzzle:'#fde68a', rpg:'#f0abfc'
};
const MODES_LIGHT = {
  atmospheric:'#1565a8', narrative:'#a0237a', detective:'#1a6b40',
  tactical:'#5032b0', immersive:'#5c38a8', action:'#b02020',
  strategy:'#2a509c', puzzle:'#7a5800', rpg:'#8a1a90'
};
const RISK_COLORS = { low:'#86efac', medium:'#fbbf24', high:'#f87171' };
const RISK_COLORS_LIGHT = { low:'#1a6b40', medium:'#7a5800', high:'#b02020' };
const TYPE_COLORS = { game_move:'#7dd3fc', profile_update:'#f9a8d4', new_game:'#86efac', reorder:'#c4b5fd', game_edit:'#fde68a' };
const TYPE_COLORS_LIGHT = { game_move:'#1565a8', profile_update:'#a0237a', new_game:'#1a6b40', reorder:'#5032b0', game_edit:'#7a5800' };
const CAT_LABELS  = { inbox:'Inbox', queue:'Play Queue', caveats:'With Caveats', decompression:'Decompression', yourCall:'Your Call', played:'Played' };
let sortBy = 'rank';

function renderAll() {
  updateMeta();
  renderFilters();
  renderGames();
  renderProfile();
}

function updateMeta() {
  const total   = Object.values(appGames).reduce((a,c) => a + c.length, 0);
  const played  = (appGames.played||[]).length;
  document.getElementById('top-meta').textContent = `${total} games · ${played} played`;
  Object.keys(CAT_LABELS).forEach(c => {
    const el = document.getElementById(`cnt-${c}`);
    if (el) el.textContent = `(${(appGames[c]||[]).length})`;
  });
  const qh = (appGames.queue||[]).reduce((a,g) => {
    const n = parseFloat((g.hours||'').replace(/[~+∞]/g,'').split('–')[0]);
    return a + (isNaN(n) ? 0 : n);
  }, 0);
  document.getElementById('queue-hours-meta').textContent = `~${Math.round(qh)}h in queue`;
}

function renderFilters() {
  const showMode = activeCat !== 'played';
  const showRisk = activeCat === 'caveats';
  const mf = document.getElementById('mode-filters');
  const rf = document.getElementById('risk-filters');

  mf.innerHTML = showMode ? `<label>Mode:</label> ` + Object.entries(MODES).map(([k]) => {
    const c = tagColor(MODES, MODES_LIGHT, k);
    return `<button class="filter-btn${modeFilter===k?' active':''}" style="${modeFilter===k?`background:${c};border-color:${c};color:${currentTheme==='light'?'#fff':'#0d0d14'}`:''}" onclick="toggleMode('${k}')">${k}</button>`;
  }).join('') : '';

  rf.innerHTML = showRisk ? `<label>Risk:</label> ` + ['low','medium','high'].map(r => {
    const c = tagColor(RISK_COLORS, RISK_COLORS_LIGHT, r);
    return `<button class="filter-btn${riskFilter===r?' active':''}" style="${riskFilter===r?`background:${c};border-color:${c};color:${currentTheme==='light'?'#fff':'#0d0d14'}`:''}" onclick="toggleRisk('${r}')">${r}</button>`;
  }).join('') : '';
}

function toggleMode(k) { modeFilter = modeFilter===k ? null : k; renderFilters(); renderGames(); }
function toggleRisk(r) { riskFilter = riskFilter===r ? null : r; renderFilters(); renderGames(); }

const CAT_COLORS = { inbox:'#c4b5fd', queue:'#7eb8d4', caveats:'#e8c547', decompression:'#b8d47e', yourCall:'#e8a87c', played:'#a8a8a8' };

function parseHours(h) {
  const n = parseFloat((h||'').replace(/[~+∞]/g,'').split(/[–-]/)[0]);
  return isNaN(n) ? null : n;
}

function sortGames(list, mode) {
  const arr = [...list];
  if (mode === 'hours') {
    arr.sort((a,b) => (parseHours(a.hours) ?? Infinity) - (parseHours(b.hours) ?? Infinity));
  } else if (mode === 'title') {
    arr.sort((a,b) => a.title.localeCompare(b.title));
  } else if (mode === 'playedDate') {
    arr.sort((a,b) => {
      const da = a.playedDate ? new Date(a.playedDate).getTime() : 0;
      const db = b.playedDate ? new Date(b.playedDate).getTime() : 0;
      return db - da; // newest first
    });
  } else {
    arr.sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }
  return arr;
}

function renderGames() {
  const search = (document.getElementById('game-search')?.value||'').toLowerCase();
  const sorted = sortGames(appGames[activeCat]||[], sortBy);
  const list = sorted.filter(g => {
    if (search && !g.title.toLowerCase().includes(search) && !(g.note||'').toLowerCase().includes(search)) return false;
    if (modeFilter && g.mode !== modeFilter) return false;
    if (riskFilter && g.risk !== riskFilter) return false;
    return true;
  });

  // Inbox uses a simpler layout — no rank, no move-to dropdown, only edit/delete.
  // Played hides "✓ Played" button.
  const isInbox = activeCat === 'inbox';

  // Persistent banner explaining what Inbox is for — shown above the table whenever
  // the user is on this tab so a returning user isn't left guessing.
  const inboxHintEl = document.getElementById('inbox-hint');
  if (isInbox) {
    const count = (appGames.inbox || []).length;
    const hintHtml = count === 0
      ? `<strong>Inbox</strong> — a holding pen for games you've added but haven't triaged yet. Use <strong>+ Add Game</strong> to drop one here, then ask Claude (Settings → Connect Claude) to sort them into the right category on your next conversation.`
      : `<strong>${count} game${count === 1 ? '' : 's'} waiting for triage.</strong> Open Claude (Settings → Connect Claude) and ask it to sort your inbox — it will read these games and queue moves for you to approve in the Pending tab. You can also delete anything you added by mistake.`;
    if (inboxHintEl) {
      inboxHintEl.innerHTML = hintHtml;
    } else {
      const banner = document.createElement('div');
      banner.id = 'inbox-hint';
      banner.className = 'inbox-hint';
      banner.innerHTML = hintHtml;
      document.getElementById('game-table').before(banner);
    }
  } else if (inboxHintEl) {
    inboxHintEl.remove();
  }

  const cols = isInbox
    ? '1fr 54px 100px 1.6fr 110px'
    : '54px 1fr 54px 100px 1.6fr 110px';
  const headers = isInbox
    ? ['Game','Hours','Mode','Notes','']
    : ['#','Game','Hours','Mode','Notes',''];

  const table = document.getElementById('game-table');
  if (list.length === 0) {
    table.innerHTML = `<div class="empty-state">${isInbox ? 'Nothing here yet.' : 'No games match'}</div>`;
    return;
  }

  const cats = Object.keys(CAT_LABELS);

  table.innerHTML = `
    <div class="table-header" style="grid-template-columns:${cols}">
      ${headers.map(h => `<span>${h}</span>`).join('')}
    </div>
    ${list.map((g,i) => {
      const modeColor = tagColor(MODES, MODES_LIGHT, g.mode);
      const riskColor = g.risk ? tagColor(RISK_COLORS, RISK_COLORS_LIGHT, g.risk) : '';
      const isEditing = editingNote && editingNote.id === g.id && editingNote.cat === activeCat;
      const noteHtml = isEditing
        ? `<div class="note-edit-wrap">
             <textarea class="note-textarea" id="note-edit-ta" onkeydown="noteKeydown(event,'${g.id}','${activeCat}')">${esc(g.note||'')}</textarea>
             <div style="display:flex;gap:5px;">
               <button class="action-btn action-played" onclick="saveNote('${g.id}','${activeCat}')">Save</button>
               <button class="action-btn" style="color:var(--muted);border-color:var(--border2);" onclick="cancelNote()">Cancel</button>
             </div>
           </div>`
        : `<div class="game-note game-note-editable" onclick="startEditNote('${g.id}','${activeCat}')" title="Click to edit">${g.note ? esc(g.note) : '<span style="opacity:0.25;font-style:normal;">add note…</span>'}</div>`;
      const rankCol = isInbox ? '' : `
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:1px;">
          <div class="game-rank${i<5?' top':''}">${String(i+1).padStart(2,'0')}</div>
          ${sortBy === 'rank'
            ? `<input type="number" class="rank-input" min="1" value="${i+1}" title="Set rank — press Enter" onkeydown="if(event.key==='Enter'){setRank('${g.id}','${activeCat}',parseInt(this.value,10))}">`
            : ''}
        </div>`;
      const linkHtml = g.url ? ` <a class="game-link" href="${esc(g.url)}" target="_blank" rel="noopener" title="${esc(g.url)}">↗</a>` : '';
      const moveSelect = isInbox ? '' : `<select onchange="moveGame('${g.id}','${activeCat}',this.value);this.value='${activeCat}'">
              ${cats.filter(c => c !== 'played' && c !== 'inbox').map(c => `<option value="${c}"${c===activeCat?' selected':''}>${CAT_LABELS[c]}</option>`).join('')}
            </select>`;
      const playedBtn = (activeCat !== 'played' && !isInbox)
        ? `<button class="action-btn action-played" onclick="markPlayed('${g.id}','${activeCat}')">✓ Played</button>`
        : '';
      return `
        <div class="game-row" style="grid-template-columns:${cols}">
          ${rankCol}
          <div>
            <div class="game-title">${esc(g.title)}${linkHtml}</div>
            ${g.playedDate ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;">Played ${g.playedDate}</div>` : ''}
          </div>
          <div class="game-hours">${g.hours||'?'}h</div>
          <div>
            ${g.mode ? `<div><span class="tag" style="${tagStyle(modeColor)}">${g.mode}</span></div>` : ''}
            ${g.risk ? `<div><span class="tag" style="${tagStyle(riskColor)}">${g.risk} risk</span></div>` : ''}
            ${g.platform ? `<span class="tag-platform">${esc(g.platform)}</span>` : ''}
            ${g.input ? `<span class="tag-platform">${esc(g.input)}</span>` : ''}
            ${g.imageUrl ? `<img class="game-thumb" src="${esc(g.imageUrl)}" alt="" loading="lazy">` : ''}
          </div>
          ${noteHtml}
          <div class="game-actions" style="display:flex;flex-direction:column;align-items:stretch;gap:4px;">
            ${playedBtn}
            ${moveSelect}
            <div style="display:flex;gap:4px;">
              <button class="row-edit-btn" style="flex:1;" onclick="openEditGame('${g.id}','${activeCat}')">Edit</button>
              <button class="row-delete-btn" onclick="deleteGameConfirm('${g.id}','${activeCat}')" title="Delete">✕</button>
            </div>
          </div>
        </div>`;
    }).join('')}`;

  if (editingNote) {
    const ta = document.getElementById('note-edit-ta');
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  }

  // Legend
  const legend = document.getElementById('game-legend');
  legend.innerHTML = Object.keys(MODES).map(k => {
    const c = tagColor(MODES, MODES_LIGHT, k);
    return `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div><span class="legend-label">${k}</span></div>`;
  }).join('') + (activeCat==='caveats' ? Object.keys(RISK_COLORS).map(r => {
    const c = tagColor(RISK_COLORS, RISK_COLORS_LIGHT, r);
    return `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div><span class="legend-label">${r} risk</span></div>`;
  }).join('') : '');
}

// ── Global search ────────────────────────────────────────────
function onGlobalSearch(val) {
  globalSearchQuery = val.trim().toLowerCase();
  const clearBtn = document.getElementById('global-clear-btn');
  const normalView = document.getElementById('normal-games-view');
  const resultsHeader = document.getElementById('global-results-header');
  if (!globalSearchQuery) {
    clearBtn.style.display = 'none';
    normalView.classList.remove('hidden');
    resultsHeader.classList.add('hidden');
    document.getElementById('game-legend').innerHTML = '';
    renderGames();
    return;
  }
  clearBtn.style.display = '';
  normalView.classList.add('hidden');
  resultsHeader.classList.remove('hidden');
  renderGlobalResults();
}

function clearGlobalSearch() {
  document.getElementById('global-search').value = '';
  onGlobalSearch('');
}

function renderGlobalResults() {
  const q = globalSearchQuery;
  const results = [];
  Object.entries(appGames).forEach(([cat, games]) => {
    (games||[]).forEach(g => {
      if (g.title.toLowerCase().includes(q) || (g.note||'').toLowerCase().includes(q))
        results.push({...g, _cat: cat});
    });
  });

  document.getElementById('global-results-label').textContent =
    `${results.length} result${results.length===1?'':'s'} across all categories`;
  document.getElementById('game-legend').innerHTML = '';

  const table = document.getElementById('game-table');
  if (results.length === 0) {
    table.innerHTML = `<div class="empty-state">No games found for "${esc(q)}"</div>`; return;
  }

  const cols = '1fr 54px 120px 1.6fr';
  table.innerHTML = `
    <div class="table-header" style="grid-template-columns:${cols}">
      ${['Game','Hours','Category','Notes'].map(h=>`<span>${h}</span>`).join('')}
    </div>
    ${results.map(g => {
      const cc = CAT_COLORS[g._cat] || '#888';
      const catLabel = CAT_LABELS[g._cat] || g._cat;
      const modeColor = MODES[g.mode] || '#888';
      return `
        <div class="game-row" style="grid-template-columns:${cols};cursor:pointer;" onclick="jumpToGame('${g._cat}')">
          <div>
            <div class="game-title">${esc(g.title)}</div>
            ${g.mode ? `<span class="tag" style="background:${modeColor}18;color:${modeColor};border:1px solid ${modeColor}28;margin-top:3px;">${g.mode}</span>` : ''}
          </div>
          <div class="game-hours">${g.hours||'?'}h</div>
          <div><span class="cat-badge" style="background:${cc}18;color:${cc};border:1px solid ${cc}28">${catLabel}</span></div>
          <div class="game-note">${g.note ? esc(g.note) : ''}</div>
        </div>`;
    }).join('')}`;
}

function jumpToGame(cat) {
  clearGlobalSearch();
  switchCat(cat);
}

// ── Note editing ─────────────────────────────────────────────
function startEditNote(id, cat) {
  editingNote = {id, cat};
  renderGames();
}

async function saveNote(id, cat) {
  const ta = document.getElementById('note-edit-ta');
  if (!ta) return;
  const note = ta.value;
  editingNote = null;
  const data = await api('PATCH', `/api/games/${id}`, { note });
  if (!data.error) appGames[cat] = (appGames[cat]||[]).map(g => g.id === id ? {...g, note} : g);
  renderGames();
}

function cancelNote() {
  editingNote = null;
  renderGames();
}

function noteKeydown(e, id, cat) {
  if (e.key === 'Escape') { e.preventDefault(); cancelNote(); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(id, cat); }
}

// ── Reorder ───────────────────────────────────────────────────
function moveRank(id, cat, dir) {
  const sorted = [...(appGames[cat]||[])].sort((a,b) => (a.rank??Infinity)-(b.rank??Infinity));
  const idx = sorted.findIndex(g => g.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;
  const r1 = sorted[idx].rank ?? idx + 1;
  const r2 = sorted[swapIdx].rank ?? swapIdx + 1;
  appGames[cat] = appGames[cat].map(g => {
    if (g.id === sorted[idx].id) return {...g, rank: r2};
    if (g.id === sorted[swapIdx].id) return {...g, rank: r1};
    return g;
  });
  saveData();
  renderGames();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function nextRank(cat) {
  return ((appGames[cat]||[]).reduce((m,g) => Math.max(m, g.rank||0), 0)) + 1;
}

function snapshotGames() {
  return JSON.parse(JSON.stringify(appGames));
}

async function moveGame(id, fromCat, toCat) {
  if (fromCat === toCat) return;
  const game = (appGames[fromCat]||[]).find(g => g.id === id);
  if (!game) return;
  const before = snapshotGames();
  const data = await api('POST', `/api/games/${id}/move`, { category: toCat });
  if (data.error) { showToast(`Error: ${data.error}`); return; }
  appGames[fromCat] = appGames[fromCat].filter(g => g.id !== id);
  appGames[toCat] = [...(appGames[toCat]||[]), data.game];
  updateMeta(); renderGames();
  showToast(`Moved “${game.title}” to ${CAT_LABELS[toCat]||toCat}`, () => restoreGames(before));
}

async function markPlayed(id, fromCat) {
  const game = (appGames[fromCat]||[]).find(g => g.id === id);
  if (!game) return;
  const before = snapshotGames();
  const data = await api('POST', `/api/games/${id}/played`);
  if (data.error) { showToast(`Error: ${data.error}`); return; }
  appGames[fromCat] = appGames[fromCat].filter(g => g.id !== id);
  appGames.played = [...(appGames.played||[]), data.game];
  updateMeta(); renderGames();
  showToast(`Marked “${game.title}” as played`, () => restoreGames(before));
}

function restoreGames(prev) {
  appGames = prev;
  saveData(); updateMeta(); renderGames();
}

// ── Set rank by typing a number ──────────────────────────────
function setRank(id, cat, newRank) {
  if (!Number.isFinite(newRank) || newRank < 1) return;
  const list = [...(appGames[cat]||[])].sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const idx = list.findIndex(g => g.id === id);
  if (idx === -1) return;
  const before = snapshotGames();
  const target = Math.min(newRank, list.length);
  if (target === idx + 1) return; // no change
  const [moved] = list.splice(idx, 1);
  list.splice(target - 1, 0, moved);
  list.forEach((g, i) => { g.rank = i + 1; });
  appGames[cat] = list;
  saveData(); renderGames();
  showToast(`Moved “${moved.title}” to rank ${target}`, () => restoreGames(before));
}

// ── Add / Edit / Delete games ────────────────────────────────
function openAddGame() {
  openGameModal({
    title: 'Add Game',
    sub: 'New games go to Inbox. Claude will sort them on your next conversation.',
    initial: {},
    onSubmit: async (fields) => {
      if (!fields.title.trim()) return false;
      const data = await api('POST', '/api/games', fields);
      if (data.error) { showToast(`Error: ${data.error}`); return false; }
      appGames.inbox = [...(appGames.inbox||[]), data.game];
      updateMeta(); renderGames();
      showToast(`Added “${data.game.title}” to Inbox`);
      return true;
    }
  });
}

function openEditGame(id, cat) {
  const game = (appGames[cat]||[]).find(g => g.id === id);
  if (!game) return;
  openGameModal({
    title: 'Edit Game',
    sub: `Editing fields on “${game.title}”`,
    initial: game,
    onSubmit: async (fields) => {
      if (!fields.title.trim()) return false;
      const before = snapshotGames();
      const data = await api('PATCH', `/api/games/${id}`, fields);
      if (data.error) { showToast(`Error: ${data.error}`); return false; }
      appGames[cat] = appGames[cat].map(g => g.id === id ? { ...g, ...data.game } : g);
      renderGames();
      showToast(`Saved changes to “${data.game.title}”`, () => restoreGames(before));
      return true;
    }
  });
}

function deleteGameConfirm(id, cat) {
  const game = (appGames[cat]||[]).find(g => g.id === id);
  if (!game) return;
  openModal(`
    <div class="modal-title">Delete game</div>
    <div class="modal-sub">This permanently removes <strong>${esc(game.title)}</strong> from your library. You can undo from the toast.</div>
    <div class="modal-row">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirm-delete-btn">Delete</button>
    </div>`, () => {
    document.getElementById('confirm-delete-btn').onclick = async () => {
      const before = snapshotGames();
      const data = await api('DELETE', `/api/games/${id}`);
      if (data.error) { showToast(`Error: ${data.error}`); closeModal(); return; }
      appGames[cat] = appGames[cat].filter(g => g.id !== id);
      closeModal();
      updateMeta(); renderGames();
      showToast(`Deleted “${game.title}”`, () => restoreGames(before));
    };
  });
}

function openGameModal({ title, sub, initial, onSubmit }) {
  const modeOptions    = ['', ...Object.keys(MODES)];
  const riskOptions    = ['', 'low', 'medium', 'high'];
  const platformOptions = ['', 'pc', 'ps5'];
  const inputOptions   = ['', 'kbm', 'ps5-controller', 'xbox-controller'];
  const sel = (id, opts, val) => `<select id="${id}" style="width:100%;padding:9px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:6px;">${opts.map(o => `<option value="${o}"${val===o?' selected':''}>${o||'(none)'}</option>`).join('')}</select>`;
  const html = `
    <div class="modal-title">${esc(title)}</div>
    <div class="modal-sub">${esc(sub)}</div>
    <div class="field"><label>Title</label><input id="gm-title" value="${esc(initial.title||'')}" placeholder="Game title"></div>
    <div style="display:flex;gap:10px;">
      <div class="field" style="flex:1;"><label>Mode</label>${sel('gm-mode', modeOptions, initial.mode||'')}</div>
      <div class="field" style="flex:1;"><label>Risk</label>${sel('gm-risk', riskOptions, initial.risk||'')}</div>
      <div class="field" style="width:90px;"><label>Hours</label><input id="gm-hours" value="${esc(initial.hours||'')}" placeholder="10"></div>
    </div>
    <div style="display:flex;gap:10px;">
      <div class="field" style="flex:1;"><label>Platform</label>${sel('gm-platform', platformOptions, initial.platform||'')}</div>
      <div class="field" style="flex:1;"><label>Input</label>${sel('gm-input', inputOptions, initial.input||'')}</div>
    </div>
    <div class="field"><label>Store URL (Steam, or PlayStation Store)</label><input id="gm-url" value="${esc(initial.url||'')}" placeholder="https://store.steampowered.com/app/…"></div>
    <div class="field"><label>Cover Image URL (optional)</label><input id="gm-image" value="${esc(initial.imageUrl||'')}" placeholder="https://…"></div>
    <div class="field"><label>Note</label><textarea id="gm-note" style="min-height:60px;">${esc(initial.note||'')}</textarea></div>
    <div class="modal-row">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gold" id="gm-save">Save</button>
    </div>`;
  openModal(html, () => {
    document.getElementById('gm-save').onclick = async () => {
      const btn = document.getElementById('gm-save');
      btn.disabled = true;
      const fields = {
        title:    document.getElementById('gm-title').value,
        mode:     document.getElementById('gm-mode').value || undefined,
        risk:     document.getElementById('gm-risk').value || undefined,
        hours:    document.getElementById('gm-hours').value || undefined,
        platform: document.getElementById('gm-platform').value || undefined,
        input:    document.getElementById('gm-input').value || undefined,
        url:      document.getElementById('gm-url').value.trim() || undefined,
        imageUrl: document.getElementById('gm-image').value.trim() || undefined,
        note:     document.getElementById('gm-note').value || undefined,
      };
      const ok = await onSubmit(fields);
      if (ok !== false) closeModal();
      else btn.disabled = false;
    };
  });
}

// ── Modal & toast plumbing ───────────────────────────────────
function openModal(html, afterMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
  if (afterMount) afterMount();
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

let toastSeq = 0;
function showToast(msg, undoFn) {
  const id = ++toastSeq;
  const wrap = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.id = id;
  el.innerHTML = `<span>${esc(msg)}</span>${undoFn ? `<button>Undo</button>` : ''}`;
  if (undoFn) el.querySelector('button').onclick = () => { undoFn(); el.remove(); };
  wrap.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
}

// ── Backup & Restore ─────────────────────────────────────────
async function downloadExport() {
  const res = await fetch(`${API_BASE}/api/export`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { showToast('Export failed'); return; }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  const fname = m ? m[1] : 'gamebacklog.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { return showImportMsg('error', 'Not valid JSON'); }
  if (!parsed.games) return showImportMsg('error', 'File is missing a "games" field');
  if (!confirm('This will replace ALL current games and profile data with the contents of this file. Continue?')) return;
  try {
    await api('POST', '/api/import', { games: parsed.games, profile: parsed.profile });
    appGames = parsed.games;
    if (parsed.profile != null) appProfile = parsed.profile;
    showImportMsg('success', 'Import complete.');
    renderAll();
  } catch (e) {
    showImportMsg('error', e.message || 'Import failed');
  }
}

function showImportMsg(kind, text) {
  const el = document.getElementById('import-msg');
  el.className = kind === 'error' ? 'error-msg' : 'success-msg';
  el.textContent = text;
}

// ═══════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════
function renderProfile() {
  const el = document.getElementById('profile-content');
  if (profileEditing) {
    document.getElementById('profile-btns').innerHTML = `
      <button class="btn btn-gold" onclick="saveProfile()">Save</button>
      <button class="btn btn-ghost" onclick="cancelEditProfile()">Cancel</button>`;
    el.innerHTML = `<textarea class="profile-textarea" id="profile-textarea">${esc(appProfile)}</textarea>`;
    return;
  }
  document.getElementById('profile-btns').innerHTML = `<button class="btn btn-ghost" onclick="editProfile()">Edit Profile</button>`;
  const lines = (appProfile||'').split('\n');
  el.innerHTML = `<div class="profile-view">${lines.map(line => {
    if (/^[A-Z][A-Z\s]+$/.test(line.trim()) && line.trim().length > 2)
      return `<div class="profile-section">${esc(line)}</div>`;
    if (!line.trim()) return `<div style="height:8px"></div>`;
    return `<div class="profile-body">${esc(line)}</div>`;
  }).join('')}</div>`;
}

function editProfile() { profileEditing = true; renderProfile(); }
function cancelEditProfile() { profileEditing = false; renderProfile(); }
async function saveProfile() {
  appProfile = document.getElementById('profile-textarea').value;
  profileEditing = false;
  await saveData();
  renderProfile();
}

// ═══════════════════════════════════════════════════════════
// PENDING
// ═══════════════════════════════════════════════════════════
const TYPE_LABELS = { game_move: 'Game Move', profile_update: 'Profile Update', new_game: 'New Game', reorder: 'Reorder', game_edit: 'Game Edit' };

function pendingDesc(item) {
  if (item.type === 'game_move') {
    const { title, fromCategory, toCategory } = item.data;
    return `Move <strong>${esc(title)}</strong> from <em>${CAT_LABELS[fromCategory]||fromCategory}</em> to <em>${CAT_LABELS[toCategory]||toCategory}</em>`;
  }
  if (item.type === 'profile_update') {
    return `Update profile section: <strong>${esc(item.data.section)}</strong>`;
  }
  if (item.type === 'new_game') {
    return `Add <strong>${esc(item.data.title)}</strong> to <em>${CAT_LABELS[item.data.category]||item.data.category}</em>`;
  }
  if (item.type === 'game_edit') {
    const { title, changes } = item.data;
    const parts = Object.entries(changes).map(([k, v]) => `${k}: <em>${esc(String(v))}</em>`);
    return `Edit <strong>${esc(title)}</strong> — ${parts.join(', ')}`;
  }
  if (item.type === 'reorder') {
    const { category, rankedTitles } = item.data;
    return `Reorder <em>${CAT_LABELS[category]||category}</em> (${rankedTitles?.length ?? 0} games)`;
  }
  return esc(item.type);
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function loadPending() {
  if (!accessToken) return;
  try {
    const items = await api('GET', '/api/pending');
    pendingItems = Array.isArray(items) ? items : [];
    renderPendingBadge();
    if (document.getElementById('tab-pending').classList.contains('active')) renderPendingTab();
  } catch {}
}

function renderPendingBadge() {
  const badge = document.getElementById('pending-badge');
  if (badge) {
    if (pendingItems.length > 0) { badge.textContent = pendingItems.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
  const approveAllBtn = document.getElementById('approve-all-btn');
  if (approveAllBtn) approveAllBtn.style.display = pendingItems.length >= 1 ? '' : 'none';
}

function renderPendingTab() {
  const list = document.getElementById('pending-list');
  if (!list) return;
  if (pendingItems.length === 0) {
    list.innerHTML = `<div class="empty-pending">No pending suggestions. Connect Claude via Settings and ask it to evaluate your library.</div>`;
    return;
  }
  list.innerHTML = pendingItems.map(item => {
    const color = tagColor(TYPE_COLORS, TYPE_COLORS_LIGHT, item.type);
    const detailHtml = item.type === 'new_game' && item.data.note
      ? `<div style="font-size:13px;color:var(--muted);margin-bottom:8px;line-height:1.65;">${esc(item.data.note)}</div>`
      : item.type === 'profile_update' && item.data.change
      ? `<div style="font-size:13px;color:var(--muted);margin-bottom:8px;line-height:1.65;">${esc(item.data.change)}</div>`
      : '';
    return `<div class="pending-card">
      <div><span class="pending-type-badge" style="${tagStyle(color)}">${TYPE_LABELS[item.type]||item.type}</span></div>
      <div class="pending-desc">${pendingDesc(item)}</div>
      ${detailHtml}
      <div class="pending-reason">"${esc(item.reason)}"</div>
      <div class="pending-meta">Suggested ${fmtDate(item.createdAt)}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-gold btn-sm" onclick="approvePending('${item.id}')">Approve</button>
        <button class="btn btn-danger btn-sm" onclick="rejectPending('${item.id}')">Reject</button>
      </div>
    </div>`;
  }).join('');
}

async function approveAll() {
  const btn = document.getElementById('approve-all-btn');
  btn.disabled = true;
  btn.textContent = 'Approving...';
  await api('POST', '/api/pending/approve-all');
  pendingItems = [];
  const data = await api('GET', '/api/data');
  if (data.games)   { appGames = data.games;   updateMeta(); }
  if (data.profile) { appProfile = data.profile; renderProfile(); }
  await loadPending();
  btn.disabled = false;
  btn.textContent = 'Approve All';
}

async function approvePending(id) {
  const res = await api('POST', `/api/pending/${id}/approve`);
  pendingItems = Array.isArray(res) ? res : [];
  // Reload games/profile since they may have changed
  const data = await api('GET', '/api/data');
  if (data.games)   { appGames = data.games;   updateMeta(); }
  if (data.profile) { appProfile = data.profile; renderProfile(); }
  renderPendingBadge();
  renderPendingTab();
}

async function rejectPending(id) {
  const res = await api('POST', `/api/pending/${id}/reject`);
  pendingItems = Array.isArray(res) ? res : [];
  renderPendingBadge();
  renderPendingTab();
}

async function toggleHistory() {
  historyVisible = !historyVisible;
  const el = document.getElementById('pending-history');
  if (!historyVisible) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  try {
    const all = await api('GET', '/api/pending/history');
    const done = (all || []).filter(p => p.status !== 'pending');
    if (done.length === 0) { el.innerHTML = `<div style="font-size:13px;color:var(--muted);font-style:italic;">No history yet.</div>`; return; }
    el.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--gold);margin-bottom:12px;">History</div>` +
      done.map(item => {
        const statusColor = item.status === 'approved' ? 'var(--green)' : 'var(--red)';
        return `<div class="history-card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <span style="font-size:13px;color:var(--sub);">${pendingDesc(item)}</span>
            <span class="history-status" style="color:${statusColor};font-size:12px;">${item.status}</span>
          </div>
          <div style="font-size:12px;color:var(--muted);">${fmtDate(item.createdAt)}</div>
        </div>`;
      }).join('');
  } catch { el.innerHTML = `<div style="color:var(--red);font-size:11px;">Failed to load history.</div>`; }
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
async function changePassword() {
  const current = document.getElementById('s-current-pw').value;
  const newPw   = document.getElementById('s-new-pw').value;
  const confirm = document.getElementById('s-confirm-pw').value;
  const msg = document.getElementById('s-pw-msg');
  msg.classList.remove('hidden','error-msg','success-msg');
  if (newPw.length < 6) { msg.textContent='New password must be at least 6 characters'; msg.classList.add('error-msg'); return; }
  if (newPw !== confirm) { msg.textContent='Passwords do not match'; msg.classList.add('error-msg'); return; }
  const data = await api('POST', '/api/auth/change-password', { currentPassword: current, newPassword: newPw });
  if (data.error) { msg.textContent = data.error; msg.classList.add('error-msg'); return; }
  document.getElementById('s-current-pw').value='';
  document.getElementById('s-new-pw').value='';
  document.getElementById('s-confirm-pw').value='';
  // Password change regenerates recovery codes — show them
  if (data.recoveryCodes?.length) {
    showRecoveryCodesModal(data.recoveryCodes, 'Password changed. Your recovery codes were regenerated. Save these before logging out.');
  } else {
    msg.textContent = 'Password changed. You will be logged out.'; msg.classList.add('success-msg');
    setTimeout(logout, 2000);
  }
}

async function loadRecoveryCodeCount() {
  try {
    const data = await api('GET', '/api/auth/recovery-codes/count');
    const el = document.getElementById('recovery-count-desc');
    if (el) {
      const n = data.remaining ?? 0;
      el.textContent = n === 0
        ? 'No recovery codes set up. Regenerate to create a fresh set.'
        : `${n} code${n === 1 ? '' : 's'} remaining. Regenerate to invalidate all existing codes and create a new set.`;
    }
    document.getElementById('recovery-codes-display')?.classList.add('hidden');
  } catch {}
}

async function regenRecoveryCodes() {
  const data = await api('POST', '/api/auth/recovery-codes/regenerate');
  if (data.error) { showToast(`Error: ${data.error}`); return; }
  showRecoveryCodesModal(data.recoveryCodes, 'New recovery codes generated. Save these — old codes are now invalid.');
  loadRecoveryCodeCount();
}

function showRecoveryCodesModal(codes, message) {
  openModal(`
    <div class="modal-title">Recovery Codes</div>
    <div class="modal-sub">${esc(message)}</div>
    <div class="recovery-codes" style="margin:12px 0;">
      ${codes.map(c => `<div class="recovery-code">${esc(c)}</div>`).join('')}
    </div>
    <div style="font-size:12px;color:var(--red);margin-bottom:16px;">These won't be shown again. Each code works once.</div>
    <div class="modal-row">
      <button class="btn btn-gold" onclick="closeModal();logout()">Saved — Log Out</button>
      <button class="btn btn-ghost" onclick="closeModal()">I've saved them</button>
    </div>`);
}

async function logout() {
  await api('POST', '/api/auth/logout');
  accessToken = null; appGames = null; appProfile = null;
  pendingItems = []; historyVisible = false;
  if (pendingPollTimer) { clearInterval(pendingPollTimer); pendingPollTimer = null; }
  showScreen('login');
  document.getElementById('login-step1').classList.remove('hidden');
  document.getElementById('login-step2').classList.add('hidden');
  document.getElementById('login-username').value='';
  document.getElementById('login-password').value='';
}

// ═══════════════════════════════════════════════════════════
// INITIAL GAME DATA + PROFILE (loaded from server on first boot)
// ═══════════════════════════════════════════════════════════
function getInitialGames() {
  return {
    inbox: [],
    queue: [
      {id:'q1', title:'Clair Obscur: Expedition 33', hours:'30', mode:'rpg', note:'Buy today. Each year the Paintress paints a number and everyone of that age dies — singular, urgent, devastating from minute one. GOTY 2025. Omori-tier OST, ~30h that don\'t overstay, switchable difficulty at any time.'},
      {id:'q2', title:'Limbo', hours:'3', mode:'atmospheric', note:'Predecessor to Inside — same studio, wordless atmospheric design. Natural companion piece. Space away from DARQ to avoid register saturation.'},
      {id:'q3', title:'South of the Circle', hours:'3', mode:'narrative', note:'Cambridge academic stranded in Cold War Antarctica, relationship unraveling through memory. BAFTA-winning, cinematic, zero friction. Play in one sitting.'},
      {id:'q4', title:'Adios', hours:'2', mode:'narrative', note:'A pig farmer\'s last day before breaking from the mob. Beautifully written, perfectly paced, emotionally lingers. ~$7.'},
      {id:'q5', title:'Control: Ultimate Edition', hours:'12', mode:'immersive', note:'Jesse Faden enters the Bureau of Control to find her brother. Lynchian atmosphere, paranormal mundanity, story delivered through found documents like Prey. SOMA\'s existential register.'},
      {id:'q6', title:'Pragmata', hours:'~15', mode:'atmospheric', note:'April 2026, 97% positive on Steam. Lunar station taken over by rogue AI — SOMA register with Capcom\'s production quality. Singular mission, android companion.'},
      {id:'q7', title:'The Big Con', hours:'3–4', mode:'narrative', note:'90s con artist adventure, charming and funny, story-driven, zero friction.'},
      {id:'q8', title:'Happy Game', hours:'2', mode:'atmospheric', note:'Cheerful surface turns progressively disturbing. Same studio DNA as Limbo/Inside. Don\'t stack with Limbo.'},
      {id:'q9', title:'Nobody Wants to Die', hours:'4–5', mode:'detective', note:'Noir detective in retrofuturistic city, reconstruct crime scenes via time manipulation. Short, cinematic, contained.'},
      {id:'q10', title:'Fear the Spotlight', hours:'3', mode:'atmospheric', note:'Short atmospheric horror, no combat, coherent lo-fi art direction. Low-friction palette cleanser.'},
      {id:'q11', title:'DARQ', hours:'3–4', mode:'atmospheric', note:'Kafkaesque puzzle platformer in a lucid nightmare. Strong visual atmosphere. Don\'t stack directly after Limbo.'},
      {id:'q12', title:'Scorn', hours:'5–6', mode:'atmospheric', note:'Pure H.R. Giger biomechanical atmosphere. No UI, no text — Inside\'s register but more viscerally disturbing. Fully committed art direction.'},
      {id:'q13', title:'The Darkside Detective', hours:'4', mode:'detective', note:'Point-and-click comedy horror, episodic and self-contained. X-Files tone, session-perfect. Play before sequel.'},
      {id:'q14', title:'Darkside Detective: A Fumble in the Dark', hours:'5', mode:'detective', note:'Sequel — same quality, new cases. Play second.'},
      {id:'q15', title:'Sorry We\'re Closed', hours:'8', mode:'atmospheric', note:'Stylish survival horror, atmospheric dread not jump scares — fits SOMA/Amnesia register.'},
      {id:'q16', title:'The Beast Inside', hours:'8', mode:'atmospheric', note:'Dual timeline horror — 1860s haunted house and Cold War spy mystery intertwined. Story-driven, atmospheric.'},
      {id:'q17', title:'The Silent Age', hours:'5', mode:'detective', note:'Point-and-click about a janitor who discovers time travel. Short, atmospheric, story-driven, no friction.'},
      {id:'q18', title:'Industria', hours:'4', mode:'narrative', note:'Short linear FPS, Cold War East Germany atmosphere, completely bounded. No systems, no obligation.'},
      {id:'q19', title:'The Spirit and the Mouse', hours:'5', mode:'narrative', note:'Warm, gentle, beautiful aesthetic. Play as a mouse helping a village spirit. Zero friction.'},
      {id:'q20', title:'Orwell: Keeping an Eye on You', hours:'5', mode:'detective', note:'Government surveillance analyst piecing together digital lives. Morally uncomfortable, rewards analytical side.'},
      {id:'q21', title:'Bendy and the Ink Machine', hours:'5', mode:'atmospheric', note:'1930s cartoon studio turned horror. Committed coherent art direction — intentional not lazy retro.'},
      {id:'q22', title:'Dredge', hours:'10', mode:'atmospheric', note:'Fisherman in a Lovecraftian archipelago. Cozy surface, slowly horrifying underneath. Focused story with a real conclusion.'},
      {id:'q23', title:'Night in the Woods', hours:'7', mode:'narrative', note:'Your profile\'s single tightest fit among smaller games. Aimlessness and unspoken pain, strong OST, no fail states.'},
      {id:'q24', title:'Death\'s Door', hours:'8–10', mode:'atmospheric', note:'Crow reaper collecting souls, extraordinary atmosphere, melancholic tone that earns it. Short, focused, never overstays.'},
      {id:'q25', title:'Star Wars Jedi: Fallen Order', hours:'15', mode:'action', note:'Strongest story in a SW game in years. Cal Kestis post-Order 66, Force combat with learnable patterns like Sekiro.'},
      {id:'q26', title:'ENDER LILIES: Quietus of the Knights', hours:'15', mode:'atmospheric', note:'Hollow Knight adjacent — dark fantasy metroidvania, melancholic atmosphere, exceptional art and music.'},
      {id:'q27', title:'Eternal Threads', hours:'9', mode:'detective', note:'Six people died in a house fire. Manipulate time to change the events. Bounded, morally weighted, no combat.'},
      {id:'q28', title:'Tales of the Neon Sea', hours:'9', mode:'detective', note:'Pixel art detective noir, cyberpunk city, point-and-click. Story-driven, low mechanical demand.'},
      {id:'q29', title:'Maid of Sker', hours:'6–7', mode:'atmospheric', note:'Welsh folklore horror, no combat — hide and survive. Short enough not to overstay. Amnesia-adjacent.'},
      {id:'q30', title:'Blood West', hours:'12', mode:'immersive', note:'Immersive sim stealth shooter, supernatural Wild West. Save anywhere, rewards planning. Confirmed genre fit.'},
      {id:'q31', title:'Mutant Year Zero: Road to Eden', hours:'15', mode:'tactical', note:'Small squad, singular mission, manual saves, ambush planning rewards strategic mind.'},
      {id:'q32', title:'Dishonored: Definitive Edition', hours:'12', mode:'immersive', note:'Singular revenge mission, extraordinary world-building, save anywhere. Dunwall is one of gaming\'s best settings.'},
      {id:'q33', title:'Wolfenstein: The New Order', hours:'12', mode:'narrative', note:'Alternate history WW2, linear, emotionally driven protagonist. Deceptively strong story for an FPS.'},
      {id:'q34', title:'Deus Ex: Mankind Divided', hours:'17', mode:'immersive', note:'Cyberpunk conspiracy thriller, stealth rewards planning, manual saves. Same immersive sim DNA as Prey and Dishonored.'},
      {id:'q35', title:'Marvel\'s Guardians of the Galaxy', hours:'18', mode:'narrative', note:'Linear, singular mission, exceptional character writing, outstanding licensed soundtrack. OST carries emotional weight like Omori\'s did.'},
      {id:'q36', title:'Disco Elysium', hours:'25–30', mode:'detective', note:'Already in library — install it. Singular detective with amnesia, extraordinary world-building, almost no fail states. Essential.'},
    ],
    caveats: [
      {id:'c1', title:'Returnal', hours:'30+', mode:'action', risk:'low', note:'Upgraded from hard skip. Skill ceiling high enough (beat Sekiro faster than average). The loop IS the story — Selene can\'t die permanently and the narrative is about why. Edge of Tomorrow framing.'},
      {id:'c2', title:'Ghostrunner 2', hours:'8', mode:'action', risk:'low', note:'Confirmed register via GR1. Same kinetic atmosphere, more refined. Play when you want kinetic action.'},
      {id:'c3', title:'In Sound Mind', hours:'9', mode:'atmospheric', risk:'low', note:'Good atmosphere and story but horror means unsettling session endings. Pick your evenings deliberately.'},
      {id:'c4', title:'Dishonored 2', hours:'13', mode:'immersive', risk:'low', note:'Play after Dishonored 1. Emily and Corvo, two distinct playstyles, equally excellent world-building. Clockwork Mansion level alone is worth it.'},
      {id:'c5', title:'Dishonored: Death of the Outsider', hours:'8', mode:'immersive', risk:'low', note:'Play after Dishonored 1 and 2. Standalone expansion assumes familiarity with world and characters.'},
      {id:'c6', title:'Paradise Killer', hours:'10', mode:'detective', risk:'low', note:'Open island murder mystery, extraordinary writing. Nothing silently fails but open world may pull completionist instincts.'},
      {id:'c7', title:'Black Book', hours:'13', mode:'narrative', risk:'low', note:'Card-based RPG, Slavic folklore, strong atmosphere. Card mechanics add planning depth without optimization hell.'},
      {id:'c8', title:'Gamedec: Definitive Edition', hours:'13', mode:'detective', risk:'low', note:'Cyberpunk detective RPG, no combat, choice-driven. Similar DNA to Disco Elysium but less brilliant.'},
      {id:'c9', title:'Dead Space Remake', hours:'11', mode:'atmospheric', risk:'low', note:'Only if you want to revisit DS1 with better production. Already played original so no story surprises.'},
      {id:'c10', title:'Keylocker', hours:'15', mode:'narrative', risk:'low', note:'Cyberpunk turn-based RPG with rhythm elements. Story-driven, strong aesthetic, Omori-adjacent. Rhythm mechanic may or may not click.'},
      {id:'c11', title:'Journey to the Savage Planet', hours:'8', mode:'narrative', risk:'low', note:'First-person exploration/comedy on an alien planet. Light story, comedic tone. Fine palette cleanser.'},
      {id:'c12', title:'Call of Juarez: Bound in Blood', hours:'7', mode:'narrative', risk:'low', note:'Western FPS, two brothers story. Older and rougher now. Low priority given queue depth.'},
      {id:'c13', title:'The Evil Within 2', hours:'15', mode:'atmospheric', risk:'medium', note:'TEW2 is genuinely better than the first — stronger story, more confident tone. Semi-open town section creates optional content gravity. Main story focus only.'},
      {id:'c14', title:'Middle-earth: Shadow of Mordor', hours:'12', mode:'action', risk:'medium', note:'Nemesis system generates emergent personal stories like Rimworld\'s first five pawns. Play before Shadow of War.'},
      {id:'c15', title:'Middle-earth: Shadow of War', hours:'20', mode:'action', risk:'medium', note:'Bigger than Mordor in every way including obligation potential. Play Mordor first.'},
      {id:'c16', title:'Moonscars', hours:'15', mode:'atmospheric', risk:'medium', note:'Dark gothic soulslike metroidvania. Clay golem searching for her creator, strong atmosphere. Hollow Knight confirmed tolerance but Moonscars is harder.'},
      {id:'c17', title:'Code Vein', hours:'30', mode:'action', risk:'medium', note:'Soulslike but story prominent — companion lost-memory questlines about identity and grief. Blood Code flexibility helps. Checkpoint system, no save-anywhere.'},
      {id:'c18', title:'Hades', hours:'22', mode:'action', risk:'medium', note:'Upgraded given Dead Cells and GoW Valhalla DLC. Story drip-fed like Valhalla — each run narratively motivated. Dead Cells tolerance suggests you can handle it.'},
      {id:'c19', title:'Vampyr', hours:'25', mode:'narrative', risk:'medium', note:'Strong 1918 London atmosphere. District health system will create silent-obligation anxiety — decide upfront to ignore optimising it.'},
      {id:'c20', title:'Deathloop', hours:'20', mode:'immersive', risk:'medium', note:'Same studio as Dishonored but more action-oriented. Loop structure means replaying maps. Play after Dishonored 1.'},
      {id:'c21', title:'Ghostwire: Tokyo', hours:'13', mode:'narrative', risk:'medium', note:'Stunning atmosphere, focused main story. Open world stuffed with collectibles will create obligation fog. Main story only.'},
      {id:'c22', title:'Death Stranding', hours:'40', mode:'narrative', risk:'medium', note:'Singular mission, unique atmosphere, Kojima at his most ambitious. Side deliveries create obligation pressure — treat as optional from the start.'},
      {id:'c23', title:'Black Myth: Wukong', hours:'30', mode:'action', risk:'high', note:'Setting extraordinary — Journey to the West, stunning visuals. But story execution thin and won\'t carry you through hard parts like Sekiro\'s did. No difficulty settings.'},
      {id:'c24', title:'Baldur\'s Gate 3', hours:'60', mode:'rpg', risk:'high', note:'Already own it. Main story only — no completionism or Witcher 3 problem returns. Go in with strict blinders.'},
      {id:'c25', title:'Nioh: Complete Edition', hours:'55–60', mode:'action', risk:'high', note:'Richer lore than initially credited but no save-anywhere — death means lost progress structurally. Only revisit for combat for its own sake.'},
    ],
    decompression: [
      {id:'d1', title:'The Sims 4', hours:'∞', note:'Build mode only. Free base game. Interior design sandbox.'},
      {id:'d2', title:'Shapez', hours:'∞', note:'Factorio confirmed factory-building enjoyment. Zero pressure or threat. Meditative.'},
      {id:'d3', title:'Farming Simulator 22', hours:'∞', note:'Pure sandbox, no goals, no story. Only in complete decompression mood.'},
      {id:'d4', title:'Art of Rally', hours:'∞', note:'Gorgeous minimalist rallying. Pure decompression, no story.'},
      {id:'d5', title:'theHunter: Call of the Wild', hours:'∞', note:'Beautiful, peaceful, zero story. Pure quiet when you need it.'},
      {id:'d6', title:'Cat Quest', hours:'9', note:'Warm, low friction, pun-based cat humor.'},
      {id:'d7', title:'Cat Quest 2', hours:'9', note:'Same as Cat Quest 1 but with a co-op option.'},
      {id:'d8', title:'Maneater', hours:'10', note:'You\'re a shark eating things in a mockumentary wrapper.'},
      {id:'d9', title:'Midnight Fight Express', hours:'5', note:'Beat-em-up, kinetic and stylish, no story. Decompression only.'},
      {id:'d10', title:'Sail Forth', hours:'8', note:'Peaceful sailing, light narrative. Atmosphere pick only.'},
      {id:'d11', title:'Turnip Boy Commits Tax Evasion', hours:'2', note:'Charming, self-aware, zero depth. Palette cleanser only.'},
      {id:'d12', title:'LEGO Lord of the Rings', hours:'10', note:'Casual, session-friendly. More motivated if LOTR IP speaks to you.'},
      {id:'d13', title:'LEGO Star Wars 3', hours:'8', note:'Pure casual. Older and simpler than Skywalker Saga.'},
      {id:'d14', title:'Star Wars: Bounty Hunter', hours:'6', note:'Jango Fett story. Shallow but scratches the SW itch low-commitment.'},
      {id:'d15', title:'PC Building Simulator 2', hours:'∞', note:'Already played 5h52m. Hardware knowledge makes it satisfying. Return when you want a chill loop.'},
    ],
    yourCall: [
      {id:'y1', title:'Clone Drone in the Danger Zone', hours:'8', note:'Robot gladiator roguelike. Mechanic-first, thin story. Dead Cells tolerance suggests it might be fine as short sessions.'},
      {id:'y2', title:'Havendock', hours:'∞', note:'Survival base building. Parallel systems silently demanding attention. High risk of obligation spiral.'},
      {id:'y3', title:'Battle of Polytopia', hours:'∞', note:'Simplified 4X. Given GalCiv was a hard skip and Stellaris burned you out, this direction is closed.'},
      {id:'y4', title:'Eastern Exorcist', hours:'15', note:'Beautiful hand-drawn art, Chinese mythology. Soulslike difficulty with thin story — art direction may pull you in regardless.'},
      {id:'y5', title:'Golden Light', hours:'6', note:'Horror roguelike, random generation, no authored story. Opposite of your authored-mission preference.'},
      {id:'y6', title:'Loop Hero', hours:'15', note:'Roguelike auto-battler, thin story wrapper. Loop structure means accepting repetitive runs.'},
      {id:'y7', title:'Severed Steel', hours:'5', note:'Stylish fast FPS, low story. Mechanic-first entirely.'},
      {id:'y8', title:'Blade of Darkness', hours:'10', note:'2001. Too dated visually, no story to compensate. Hard skip.'},
      {id:'y9', title:'Chasm: The Rift', hours:'4', note:'1997. Hard skip entirely.'},
      {id:'y10', title:'Quake 4', hours:'8', note:'Dated FPS, thin story. Nothing here for your profile.'},
      {id:'y11', title:'Colt Canyon', hours:'4', note:'Roguelite pixel western, thin story.'},
      {id:'y12', title:'Shogun Showdown', hours:'5', note:'Roguelite turn-based, minimal story.'},
      {id:'y13', title:'Showgunners', hours:'8', note:'Tactical combat in a game show, thin story.'},
      {id:'y14', title:'Riot: Civil Unrest', hours:'∞', note:'Simulation of riot management. Parallel systems, no narrative.'},
      {id:'y15', title:'The Textorcist', hours:'4', note:'You type exorcisms while dodging bullets. Niche mechanic. Skip unless concept genuinely amuses you.'},
      {id:'y16', title:'Five Nights at Freddy\'s: Into the Pit', hours:'4', note:'Jump scare survival horror. Neither register nor structure fits.'},
      {id:'y17', title:'Return to Ash', hours:'2', note:'Very short visual novel, minimal interactivity. Low risk to try given length.'},
      {id:'y18', title:'Arcade Paradise', hours:'12', note:'You manage an arcade by doing laundry. Charming concept, repetitive loop, minimal story.'},
      {id:'y19', title:'Redout 2', hours:'∞', note:'Pure racing, no story.'},
      {id:'y20', title:'Turmoil', hours:'5', note:'Oil drilling management sim. Thin even as decompression.'},
      {id:'y21', title:'Kill Knight', hours:'3', note:'Arcade top-down shooter, mechanical-first. Short enough to try.'},
    ],
    played: []
  };
}

function getDefaultProfile() {
  return `CORE IDENTITY
You prioritize story and atmosphere above all else, followed by strategic planning depth, then mechanical mastery, with chill exploration last. You respond to games that feel deliberately crafted with something to say. Every game you love feels authored and intentional; every game you bounce from feels bloated, hollow, or mechanically arbitrary.

WHAT CAPTURES YOU
Singular, purposeful protagonist missions — not open sandboxes, not "go do quests," but one thing that matters and won't let you look away. Sekiro (save the boy, fix the immortality curse), Hollow Knight, Ghost of Tsushima, Aliens: The Dark Descent, SOMA — all of these gave you a clear authored mission with emotional stakes. You respond to small groups of characters you care about deeply rather than large, replaceable armies.

EMOTIONAL REGISTER
You gravitate toward games that are quietly devastating beneath a deceptive surface — Omori looks like a cute RPG then methodically dismantles you. SOMA looks like survival horror then forces you to confront what consciousness is. You like existential dread over jump scares, grief and identity as themes. The OST matters: Omori's, Night in the Woods', Clair Obscur's — music carrying emotional weight is a significant factor.

DIFFICULTY AND DEATH
You have a higher skill ceiling than your anxiety profile initially suggests. You beat Sekiro faster than average. You loved Dead Cells, GoW Ragnarök, Ghostrunner 1. The real filter isn't difficulty — it's ambiguity around whether you should have lost. In Rimworld, when a pawn dies you can't tell if it was avoidable or RNG or a mistake from hours ago. That uncertainty triggers save-scumming. In Dead Cells, the contract is explicit: death is the designed state. In Sekiro, boss patterns are learnable — death always teaches something specific. You're fine with hard games when: (1) death feels fair and legible, (2) the scope of loss is bounded, (3) the game's contract around failure is clear from the start.

SAVE SYSTEM
You strongly prefer save-anywhere, but checkpoint systems are acceptable when generous. What matters is not losing large swaths of progress to ambiguous failure. This is about maintaining authorship over outcomes, not avoiding difficulty.

OPEN WORLD TOLERANCE
You have obligation fatigue — not scope fatigue. Skyrim works because it never makes you feel behind. Witcher 3 fails because it buries you in nested quest chains that make you feel wrong for skipping. Elden Ring fails because it's too much to do with no authored priority. The rule: optional content that creates completionist guilt = bad. Optional content that feels like genuine discovery = fine.

ROGUELIKE TOLERANCE
Moderate-to-good. Dead Cells (pure loop, legible deaths, fast respawn) and GoW Valhalla DLC (familiar combat, narrative justification for each run) confirmed tolerance. You'll likely enjoy Hades. You struggle when: (1) runs are very long and death is ambiguous, (2) the loop generates parallel obligation anxiety.

STRATEGY / 4X
High ceiling when systems generate stories. Stellaris: 100+ hours. Shogun II: 200+ hours. You burned out of Warhammer II at 44h because Lizardmen felt disposable. Tyrion (High Elf) worked — elite precious units feel meaningful. GalCiv III is a hard skip — drier than Stellaris with a fraction of the narrative richness.

GRAPHICS AND ART
You need coherent intentional art direction. Not fine with games that look like technical limitations. Fine with: pixel art when deliberately aesthetic (Omori), lo-fi horror when coherently committed, minimalist stylized art (Inside, Limbo, Hollow Knight). Not fine with: new games pretending to be old, visual incoherence, mismatched abstract mess.

SESSION LENGTH
Medium sessions (1–2 hours) typical. Some longer sessions possible for the right game. Games should be easily pauseable without guilt.

GENRE HISTORY (CONFIRMED FITS)
Immersive sim (Prey, Dishonored, Deus Ex), Atmospheric horror quiet/existential (SOMA, Amnesia), Atmospheric horror action (Dead Space 1+2, Callisto Protocol), Narrative adventure (Night in the Woods, Omori, Hollow Knight), Soulslike when story warrants it (Sekiro, Ghostrunner), Tactical small-squad (Aliens: Dark Descent), Metroidvania (Hollow Knight).

GENRE HARD LIMITS
Large army management, Live service multiplayer, Pure reflex arcade with no story, Open world collectathons with map markers everywhere, Extreme open-ended 4X with no narrative hook.

KEY REFERENCE GAMES
Loved: Sekiro, Hollow Knight, Ghost of Tsushima, Skyrim, SOMA, Amnesia, Dead Space 1+2, Aliens: The Dark Descent, Omori, Stellaris (100h), Shogun II (200h), RDR2, GTA V, Dying Light 1+2, Ghostrunner 1, GoW Ragnarok + Valhalla DLC, Dead Cells, Factorio
Bounced: Witcher 3 (25h, obligation fog), Elden Ring (10h, too much to do), GalCiv III (parallel optimization), late Rimworld (ambiguous losses at scale)
Decent/OK: Callisto Protocol (strong start, shallow end), Nioh (mechanically punishing without story payoff)`;
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
boot();
