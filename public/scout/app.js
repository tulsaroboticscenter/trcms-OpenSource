// TRC Scout — offline-first FTC scouting PWA. Vanilla ES modules, no build step.
const APP_VER = 'v71';
import { db } from './db.js';
import { api } from './api.js';

// ─────────── tiny DOM helpers ───────────
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ─────────── photo lightbox ───────────
const _lb = document.createElement('div');
_lb.className = 'lb-overlay';
_lb.innerHTML = '<img />';
document.body.appendChild(_lb);
const _lbImg = _lb.querySelector('img');
const closeLb = () => { _lb.classList.remove('lb-open'); _lbImg.src = ''; };
_lb.addEventListener('click', (e) => { if (!_lbImg.contains(e.target)) closeLb(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });
document.addEventListener('click', (e) => {
  const img = e.target.closest('.rp-lightbox');
  if (!img) return;
  _lbImg.src = img.src || img.currentSrc;
  _lb.classList.add('lb-open');
});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const state = { member: null, bundle: null, route: 'home', subPage: null, deviceId: null };

// ─────────── boot ───────────
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/scout/sw.js').catch(() => {});
  state.deviceId = await db.kvGet('deviceId');
  if (!state.deviceId) { state.deviceId = uuid(); await db.kvSet('deviceId', state.deviceId); }
  state.member = await db.kvGet('member');
  const eventId = await db.kvGet('eventId');
  if (eventId) state.bundle = await db.bundleGet(eventId);

  window.addEventListener('online', () => { updateNet(); autoSync(); }); window.addEventListener('offline', updateNet);
  // When any API call gets a 401, navigate to login without a page reload.
  window.addEventListener('scout:sessionexpired', () => render('login'));
  updateNet(); refreshSyncBadge();
  $$('#nav button').forEach((b) => b.onclick = () => go(b.dataset.route));

  const token = await db.kvGet('token');
  if (!token || !state.member) return render('login');
  if (!state.bundle) return render('events');

  autoSync();                          // flush anything queued from a previous offline session
  setInterval(autoSync, 45000);        // and keep checking while the app is open
  startLiveAutoSync();                 // pull live scores/rankings every 60 s during active events
  go('home');
}

function updateNet() {
  const s = document.getElementById('netStatus');
  const on = navigator.onLine;
  s.textContent = on ? 'Online' : 'Offline'; s.className = 'status ' + (on ? 'online' : 'offline');
}

async function refreshSyncBadge() {
  const pending = await db.queuePending();
  const b = document.getElementById('syncBadge');
  if (pending.length) { b.hidden = false; b.textContent = String(pending.length); } else { b.hidden = true; }
}

// ─────────── Strength of Schedule cache ───────────
// Computed from match projection data (already cached in IndexedDB by authedFetch).
// _sosCache is populated by computeSoS() and read synchronously by reportHtml().
let _sosCache = null;   // { opr: { teamNum: score }, rank: { teamNum: rank } }

async function computeSoS() {
  if (_sosCache) return _sosCache;
  try {
    const r = await api.matchProjections(state.bundle?.event?.id);
    if (!r?.items?.length) return null;
    const opr = {}, rank = {};
    // Mirror the server: only Quals matches count toward standings & SoS.
    // Within each Quals match, a surrogate team earns no credit — skip adding
    // that match to their SoS total, and also exclude their OPR from what the
    // opposing alliance contributes to non-surrogates' opponent sum.
    for (const m of r.items) {
      if (m.tournament_level !== 'Quals') continue;
      const red = m.red.teams || [], blue = m.blue.teams || [];
      const redSum  = red.reduce((s, t)  => s + (t.opr || 0), 0);
      const blueSum = blue.reduce((s, t) => s + (t.opr || 0), 0);
      // Non-surrogates get the full opposing alliance OPR (including any surrogate on that side).
      // Surrogate teams are skipped entirely — that match doesn't count toward their SoS.
      for (const t of red)  { if (!t.surrogate) opr[t.team_number] = (opr[t.team_number] || 0) + blueSum; }
      for (const t of blue) { if (!t.surrogate) opr[t.team_number] = (opr[t.team_number] || 0) + redSum; }
    }
    Object.keys(opr).sort((a, b) => opr[b] - opr[a]).forEach((team, i) => { rank[team] = i + 1; });
    _sosCache = { opr, rank, total: Object.keys(opr).length };
    return _sosCache;
  } catch { return null; }
}

// Auto-upload queued scouting records whenever the device is online. Runs on boot,
// when connectivity returns, on a timer, and right after each save. Idempotent on the
// server (upsert by client_uuid), so retries are safe.
let _syncing = false;
let _navGen = 0;  // incremented on every navigation; async renders abort if stale
async function autoSync() {
  if (_syncing || !navigator.onLine) return;
  if (!(await db.kvGet('token'))) return;   // not logged in — don't trigger a 401 loop
  const pending = await db.queuePending();
  if (!pending.length) return;
  _syncing = true;
  try {
    const photos = pending.filter((r) => r.kind === 'photo');
    const scouts = pending.filter((r) => r.kind !== 'photo');

    // Upload queued photos individually (compress step is skipped — already a dataUrl).
    for (const p of photos) {
      try {
        await api.uploadRobotPhoto(p.event_id, p.team_number, p.image_data);
        await db.queueMarkSynced(p.client_uuid);
      } catch { /* transient — will retry on next sync */ }
    }

    // Flush scouting records in bulk.
    if (scouts.length) {
      const recs = scouts.map(({ synced, queued_at, synced_at, ...r }) => r);
      const res = await api.pushSync(recs);
      for (const r of (res.results || [])) if (r.status === 'ok' && r.client_uuid) await db.queueMarkSynced(r.client_uuid);
    }

    await refreshSyncBadge();
    if (state.route === 'sync') renderSync();   // refresh the Sync view if it's open
  } catch (e) { /* offline or transient — will retry on the next tick */ }
  finally { _syncing = false; }
}

// ─────────── live data auto-sync ───────────
// Returns true while the event is in progress (today is within start/end dates AND is_active).
function eventIsLive() {
  const ev = state.bundle?.event;
  if (!ev || !ev.is_active) return false;
  const today = new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'
  if (ev.start_date && ev.start_date > today) return false;
  if (ev.end_date   && ev.end_date   < today) return false;
  return true;
}

let _liveTimer = null;

// Pull fresh schedule + live stats from FTCScout every 60 s during an active event.
// Silently refreshes the Live Rankings view if it is currently open.
// Cancels itself (and clears the interval) once the event ends.
async function liveAutoSync() {
  if (!navigator.onLine || !state.bundle) return;
  if (!(await db.kvGet('token'))) return;
  if (!eventIsLive()) {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
    return;
  }
  try {
    const eid = state.bundle.event.id;
    await api.syncSchedule(eid);
    await api.syncLive(eid);
    // Re-render live views that are currently displayed.
    if (state.subPage === 'liveRankings') {
      renderLiveRankings();
    } else if (state.subPage === 'playoffBracket') {
      await renderPlayoffBracket(true);
    } else if (state.subPage === 'matchProjections') {
      // Save search query so the re-render can restore it.
      const savedQ = document.getElementById('mpSearch')?.value || '';
      await renderMatchProjections();
      if (savedQ) {
        const inp = document.getElementById('mpSearch');
        if (inp) { inp.value = savedQ; inp.dispatchEvent(new Event('input')); }
      }
    }
  } catch { /* transient network error — will retry on next tick */ }
}

function startLiveAutoSync() {
  if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
  if (!eventIsLive()) return;
  liveAutoSync();                              // run immediately on load
  _liveTimer = setInterval(liveAutoSync, 60000);
}

function go(route) {
  _navGen++;
  state.route = route;
  state.subPage = null;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.route === route));
  render(route);
}

function render(route) {
  if (view._vvCleanup) { view._vvCleanup(); delete view._vvCleanup; }
  nav.hidden = !(state.member && state.bundle);
  ({ login: renderLogin, events: renderEvents, home: renderHome, teams: renderTeams, watch: renderWatchlist, match: renderMatch, pit: renderPit, sync: renderSync }[route] || renderHome)();
}

// ─────────── login ───────────
function renderLogin() {
  nav.hidden = true;
  view.innerHTML = `
    <div style="min-height:20vh"></div>
    <h2>Sign in</h2>
    <div class="card">
      <label>Username</label><input id="u" autocapitalize="off" autocomplete="username" />
      <label>Password</label><input id="p" type="password" autocomplete="current-password" />
      <div style="height:14px"></div>
      <button id="go">Sign in</button>
      <p class="muted" style="margin-top:10px">Sign in once while online; the app then works offline.</p>
    </div>
    <div style="min-height:40vh"></div>`;

  // iOS PWA: keyboard opening scrolls the window instead of resizing the viewport,
  // which pushes inputs off the top of the screen. Use visualViewport to nudge the
  // form up by exactly the keyboard height so the window never needs to scroll.
  if (window.visualViewport) {
    const onVV = () => {
      const vv = window.visualViewport;
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      view.style.transform = kb > 50 ? `translateY(-${Math.round(kb * 0.4)}px)` : '';
    };
    window.visualViewport.addEventListener('resize', onVV);
    window.visualViewport.addEventListener('scroll', onVV);
    view._vvCleanup = () => {
      window.visualViewport.removeEventListener('resize', onVV);
      window.visualViewport.removeEventListener('scroll', onVV);
      view.style.transform = '';
    };
  }

  $('#go').onclick = async () => {
    try {
      $('#go').disabled = true;
      state.member = await api.login($('#u').value.trim(), $('#p').value);
      render('events');
    } catch (e) { toast(e.message); $('#go').disabled = false; }
  };
}

// ─────────── event selection + bundle download ───────────
// Does the signed-in member have scouting.manage? (gates the event setup admin UI)
function canManageScouting() {
  const lvl = state.member?.permissions?.['scouting.manage'];
  return !!lvl && lvl !== 'none';
}

// Manager-only: import (set up) and maintain scouting events.
async function renderManageEvents() {
  nav.hidden = true;
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Events</button>
    <h2 style="margin-top:10px">Manage events</h2>
    <div class="card">
      <div class="phase-title">Import an event</div>
      <label>Season</label><select id="seasonSel"><option value="">…</option></select>
      <label>Event code (from ftcscout / ftc-events)</label><input id="evCode" placeholder="e.g. FPEMICRFT" autocapitalize="characters" />
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="evTraining" /> Training mode (replay a finished event)</label>
      <div style="height:10px"></div><button id="importBtn">Import from ftcscout</button>
      <p class="muted" style="font-size:12px;margin-top:8px">Pulls the roster + pre-event projections. Use the per-event buttons below to sync the schedule (once posted) and live results during the event.</p>
    </div>
    <div class="phase-title">Existing events</div>
    <div id="evList"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => render('events');

  try { const { items } = await api.listSeasons(); $('#seasonSel').innerHTML = (items || []).map((s) => `<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('') || '<option value="">no seasons configured</option>'; }
  catch (e) { toast(e.message); }

  const loadList = async () => {
    const box = $('#evList');
    try {
      const { items } = await api.listEvents(false);
      if (!items.length) { box.innerHTML = '<p class="muted">No events yet.</p>'; return; }
      box.innerHTML = items.map((e) => `<div class="card">
        <div class="row spread"><strong>${esc(e.name)}</strong>${e.is_training ? '<span class="pill" style="color:var(--accent)">training</span>' : ''}</div>
        <div class="muted" style="font-size:12px">${esc(e.event_code)} · ${e.counts?.teams ?? '?'} teams · ${e.counts?.matches ?? 0} matches</div>
        <div class="row" style="gap:8px;align-items:center;margin-top:8px">
          <label style="margin:0;font-size:13px;white-space:nowrap">Our team #</label>
          <input data-our-team data-id="${e.id}" data-type="int" inputmode="numeric" value="${e.our_team_number ?? ''}" style="width:90px;margin:0" placeholder="—" />
          <button class="secondary" style="width:auto;font-size:12px;padding:4px 10px" data-act="our-team" data-id="${e.id}">Save</button>
        </div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="secondary" style="width:auto" data-act="pre" data-id="${e.id}">Sync projections</button>
          <button class="secondary" style="width:auto" data-act="sched" data-id="${e.id}">Sync schedule</button>
          <button class="secondary" style="width:auto" data-act="live" data-id="${e.id}">Sync live</button>
          <button class="ghost" style="width:auto" data-act="del" data-id="${e.id}" data-code="${esc(e.event_code)}">Delete</button>
        </div></div>`).join('');
      $$('#evList button').forEach((b) => b.onclick = async () => {
        const id = b.dataset.id, act = b.dataset.act;
        if (act === 'del' && !confirm(`Delete ${b.dataset.code} and wipe ALL its scouting data? This cannot be undone.`)) return;
        const old = b.textContent; b.disabled = true; b.textContent = '…';
        try {
          if (act === 'our-team') {
            const inp = box.querySelector(`input[data-our-team][data-id="${id}"]`);
            const v = inp?.value.trim() ? parseInt(inp.value.trim(), 10) : null;
            await api.patchEvent(id, { our_team_number: v });
            // Update the live bundle so Alliance Picker sees the change without a reload.
            if (state.bundle && String(state.bundle.event.id) === String(id)) {
              state.bundle.event.our_team_number = v;
              await db.bundlePut(state.bundle);
            }
            toast(v ? `Our team set to ${v}` : 'Our team cleared');
            b.disabled = false; b.textContent = old; return;
          }
          if (act === 'pre') { const r = await api.syncPreEvent(id); toast(`Projections: ${r.synced_teams} teams`); }
          else if (act === 'sched') { const r = await api.syncSchedule(id); toast(`Schedule: ${r.matches} matches`); }
          else if (act === 'live') { const r = await api.syncLive(id); toast(`Live: ${r.teams} teams`); }
          else if (act === 'del') { await api.deleteEvent(id); toast('Event deleted'); }
          // Re-download the bundle so in-memory state reflects the sync result immediately.
          if (act !== 'del' && state.bundle && String(state.bundle.event.id) === String(id)) {
            try { await downloadBundle(id); } catch {}
          }
          loadList();
        } catch (e) { toast(e.message); b.disabled = false; b.textContent = old; }
      });
    } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
  };
  loadList();

  $('#importBtn').onclick = async () => {
    const sid = parseInt($('#seasonSel').value, 10);
    const code = $('#evCode').value.trim().toUpperCase();
    if (!sid || !code) return toast('Pick a season and enter an event code');
    $('#importBtn').disabled = true;
    try {
      const r = await api.createEvent(sid, code, $('#evTraining').checked);
      toast(`Imported ${r.event_code}: ${r.synced_teams} teams, ${r.synced_projections} projections`);
      $('#evCode').value = ''; $('#evTraining').checked = false;
      loadList();
    } catch (e) { toast(e.message); }
    $('#importBtn').disabled = false;
  };
}

async function renderEvents() {
  nav.hidden = true;
  const mgr = canManageScouting();
  const manageBtn = mgr ? '<button class="ghost" id="manageBtn" style="margin-bottom:12px">⚙ Set up / manage events</button>' : '';
  view.innerHTML = `<h2>Choose event</h2><div class="card"><p class="muted">Loading events…</p></div>`;
  if (!api.online()) { view.innerHTML = `<h2>Choose event</h2><div class="card"><p>You're offline and no event is loaded. Connect to the internet once to download an event, then you can scout offline.</p></div>`; return; }
  try {
    const { items } = await api.listEvents();
    if (!items.length) {
      view.innerHTML = `<h2>Choose event</h2>${manageBtn}<div class="card"><p>No active events yet.${mgr ? ' Set one up below.' : ' Ask an admin to register one.'}</p></div>`;
      if (mgr) $('#manageBtn').onclick = () => renderManageEvents();
      return;
    }
    view.innerHTML = `<h2>Choose event</h2>${manageBtn}<p class="muted">Downloads the roster, projections & schedule for offline use.</p><div id="evs"></div>`;
    if (mgr) $('#manageBtn').onclick = () => renderManageEvents();
    const wrap = $('#evs');
    items.forEach((e) => {
      const d = document.createElement('div');
      d.className = 'list-item';
      d.innerHTML = `<div><strong>${esc(e.name)}</strong>${e.is_training ? ' <span class="pill" style="color:var(--accent)">training</span>' : ''}<br><span class="muted">${esc(e.event_code)} · ${esc(e.city || '')} ${esc(e.state || '')}</span></div><span class="pill">${e.counts?.teams ?? '—'} teams</span>`;
      d.onclick = () => downloadBundle(e.id);
      wrap.appendChild(d);
    });
  } catch (e) { view.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
}

async function downloadBundle(eventId) {
  try {
    toast('Downloading event…');
    const bundle = await api.getBundle(eventId);
    await db.bundlePut(bundle);
    await db.kvSet('eventId', bundle.event.id);
    state.bundle = await db.bundleGet(bundle.event.id);
    _sosCache = null;   // invalidate SoS cache for the new event
    toast(`Loaded ${bundle.teams.length} teams`);
    go('home');
  } catch (e) { toast(e.message); }
}

const teamName = (n) => {
  const t = (state.bundle?.teams || []).find((x) => Number(x.team_number) === Number(n));
  return t ? t.team_name : null;
};

// ─────────── home ───────────
async function renderHome() {
  const gen = _navGen;
  const ev = state.bundle.event;
  const pending = await db.queuePending();
  if (_navGen !== gen) return;  // user navigated away while we were awaiting
  view.innerHTML = `
    <h2>${esc(ev.name)}</h2>
    <p class="muted">${esc(ev.event_code)} · ${esc(ev.city || '')} ${esc(ev.state || '')} · ${state.bundle.teams.length} teams · ${state.bundle.matches?.length ?? 0} matches · ${APP_VER}</p>
    <div class="card row spread"><div>Signed in as <strong>${esc(state.member?.first_name || state.member?.username || 'scout')}</strong></div><button class="ghost" style="width:auto" id="switch">Change event</button></div>
    <button id="m">Scout a Match</button><div style="height:10px"></div>
    <button class="secondary" id="p">Pit Scout a Team</button><div style="height:10px"></div>
    <button class="ghost" id="ptbtn">Pre-event details table</button><div style="height:10px"></div>
    <button class="ghost" id="projbtn">Match projections</button><div style="height:10px"></div>
    <button class="ghost" id="playoffbtn">Playoff Bracket</button><div style="height:10px"></div>
    <button class="ghost" id="rankbtn">Live Rankings</button><div style="height:10px"></div>
    <button class="ghost" id="mov">Movers (live vs projection)</button><div style="height:10px"></div>
    <button class="ghost" id="allibtn">Alliance picker</button><div style="height:10px"></div>
    <button class="ghost" id="wlbtn">Watchlist</button><div style="height:10px"></div>
    <button class="ghost" id="s">Sync (${pending.length} pending)</button>`;
  $('#m').onclick = () => go('match'); $('#p').onclick = () => go('pit'); $('#s').onclick = () => go('sync');
  $('#switch').onclick = () => render('events');
  $('#wlbtn').onclick = () => go('watch');
  $('#rankbtn').onclick = () => renderLiveRankings();
  $('#mov').onclick = () => renderMovers();
  $('#allibtn').onclick = () => renderAlliance();

  // Pre-fetch data-heavy views in the background so they're available offline.
  // authedFetch() caches every GET response into IndexedDB automatically.
  if (api.online()) {
    const eid = ev.id;
    Promise.allSettled([
      api.matchProjections(eid),
      api.teamSummaries(eid),
      api.preEventTable(eid),
      api.listPit(eid),
      api.livePerformance(eid),
      api.liveRankings(eid),
      api.playoffBracket(eid),
    ]).catch(() => {});
  }
  $('#projbtn').onclick = () => renderMatchProjections();
  $('#playoffbtn').onclick = () => renderPlayoffBracket();
  $('#ptbtn').onclick = () => renderPreEventTable();
}

// ─────────── pre-event details table (sortable, ranked by npOPR) ───────────
async function renderPreEventTable() {
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Home</button>
    <h2 style="margin-top:10px">Pre-event details</h2><div class="muted">Tap a column to sort · ranked by npOPR</div>
    <div id="pt" style="margin-top:10px"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => go('home');
  const box = $('#pt');
  try {
    const r = await api.preEventTable(state.bundle.event.id);
    if (!r.count) { box.innerHTML = '<div class="card"><p class="muted">No projections cached yet — register/sync the event first.</p></div>'; return; }
    const basis = r.projection_basis === 'event_opr' ? `<p class="muted" style="font-size:12px">Based on this event's OPR (finished event — no pre-event projection).</p>` : '';
    let sortKey = 'opr_rank', asc = true;
    const draw = () => {
      const items = r.items.slice().sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        if (typeof x === 'string') return asc ? x.localeCompare(y) : y.localeCompare(x);
        return asc ? x - y : y - x;
      });
      box.innerHTML = basis + `<div style="overflow-x:auto"><table class="dt"><thead><tr>${r.columns.map((c) =>
        `<th data-k="${c.key}" class="${c.num ? 'r' : ''}${c.key === sortKey ? ' s' : ''}">${esc(c.label)}${c.key === sortKey ? (asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${
        items.map((it) => `<tr>${r.columns.map((c) => `<td class="${c.num ? 'r' : ''}">${it[c.key] == null ? '—' : esc(it[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $$('#pt th').forEach((th) => th.onclick = () => {
        const k = th.dataset.k;
        if (k === sortKey) asc = !asc;
        else { sortKey = k; asc = ['opr_rank', 'team_number', 'team_name'].includes(k); }
        draw();
      });
    };
    draw();
  } catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
}

// ─────────── live rankings ───────────
async function renderLiveRankings() {
  state.subPage = 'liveRankings';
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Home</button>
    <h2 style="margin-top:10px">Live Rankings</h2>
    <div id="lr" style="margin-top:12px"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => go('home');
  const box = $('#lr');
  try {
    const eid = state.bundle.event.id;
    const [r, perf, proj] = await Promise.all([
      api.liveRankings(eid),
      api.livePerformance(eid).catch(() => ({ items: [] })),
      api.matchProjections(eid).catch(() => ({ items: [] })),
    ]);
    if (!r.count) { box.innerHTML = '<div class="card"><p class="muted">No teams yet — sync the event first.</p></div>'; return; }
    if (!r.has_live) {
      box.innerHTML = '<div class="card"><p class="muted">No live stats yet — sync live data first (event manager).</p></div>';
      return;
    }

    // Per-team TRC npOPR (fallback live/pre OPR) — basis for each match's projected alliance OPR.
    const npopr = {};
    for (const t of (perf.items || [])) npopr[t.team_number] = t.trc_npopr ?? t.live_opr ?? t.pre_opr ?? null;

    // Per-team match list: actual alliance score vs. projected alliance OPR (sum of npOPR). (#70)
    const teamMatches = {};
    const addMatch = (teamObjs, m, allianceKey) => {
      const actual    = m.actual ? (allianceKey === 'red' ? m.actual.red_score : m.actual.blue_score) : null;
      const oppActual = m.actual ? (allianceKey === 'red' ? m.actual.blue_score : m.actual.red_score) : null;
      const projSum = (teamObjs || []).reduce((s, t) => s + (npopr[t.team_number] || 0), 0);
      const lvl = m.tournament_level || 'Quals';
      const label = (lvl === 'Quals' ? 'Q' : (lvl + ' ')) + (m.match_num ?? '');
      for (const t of (teamObjs || [])) {
        (teamMatches[t.team_number] = teamMatches[t.team_number] || []).push({
          label, n: m.match_num ?? 0, actual, oppActual,
          proj: projSum ? Math.round(projSum) : null,
          win: (actual != null && oppActual != null) ? (actual > oppActual ? 'W' : actual < oppActual ? 'L' : 'T') : null,
        });
      }
    };
    for (const m of (proj.items || [])) { addMatch(m.red?.teams, m, 'red'); addMatch(m.blue?.teams, m, 'blue'); }
    for (const k of Object.keys(teamMatches)) teamMatches[k].sort((a, b) => a.n - b.n);

    const detailHtml = (team) => {
      const ms = teamMatches[team] || [];
      if (!ms.length) return `<div class="muted" style="font-size:12px;padding:10px">No match results yet for team ${team}.</div>`;
      const rows = ms.map((x) => {
        const rc = x.win === 'W' ? '#22c55e' : x.win === 'L' ? 'var(--red)' : 'var(--text)';
        return `<tr>
          <td>${esc(x.label)}</td>
          <td class="r" style="color:${rc};font-weight:${x.win === 'W' ? '700' : '400'}">${x.actual != null ? x.actual : '—'}${x.oppActual != null ? ` <span class="muted" style="font-size:11px">vs ${x.oppActual}</span>` : ''}</td>
          <td class="r">${x.proj != null ? x.proj : '—'}</td>
        </tr>`;
      }).join('');
      return `<div style="padding:6px 4px 10px">
        <div class="muted" style="font-size:11px;margin-bottom:4px">Per match: alliance score · projected OPR (sum of TRC npOPR)</div>
        <table class="dt" style="width:100%"><thead><tr><th>Match</th><th class="r">Score</th><th class="r">Proj OPR</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    };

    const ourTeam = state.bundle?.event?.our_team_number;
    const cols = [
      { key: 'rank',       label: 'Rank',     num: true },
      { key: 'team_number',label: 'Team',     num: true },
      { key: 'team_name',  label: 'Name',     num: false },
      { key: 'wlt',        label: 'W-L-T',   num: false },
      { key: 'rp',         label: 'RP',       num: true, title: 'Ranking Points from FTCScout (requires Sync Live)' },
      { key: 'qual_gp',    label: 'GP',       num: true },
      { key: 'match_pts',  label: 'Match Pts',num: true, title: 'Total match points scored across all played quals' },
      { key: 'opr',        label: 'OPR',      num: true },
    ];
    let sortKey = 'rank', sortAsc = true;

    const draw = () => {
      const sorted = r.rows.slice().sort((a, b) => {
        let x = sortKey === 'wlt' ? (a.wins * 2 + a.ties) : a[sortKey];
        let y = sortKey === 'wlt' ? (b.wins * 2 + b.ties) : b[sortKey];
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        if (typeof x === 'string') return sortAsc ? x.localeCompare(y) : y.localeCompare(x);
        return sortAsc ? x - y : y - x;
      });
      const thead = cols.map((c) =>
        `<th data-k="${c.key}" class="${c.num ? 'r' : ''}${c.key === sortKey ? ' s' : ''}"${c.title ? ` title="${c.title}"` : ''}>${esc(c.label)}${c.key === sortKey ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>`
      ).join('');
      const tbody = sorted.map((row) => {
        const isUs = ourTeam && Number(row.team_number) === Number(ourTeam);
        const wlt = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;
        return `<tr class="lrrow" data-team="${row.team_number}" style="cursor:pointer${isUs ? ';background:var(--accent)20;font-weight:700' : ''}">
          <td class="r">${row.rank ?? '—'}</td>
          <td class="r" style="${isUs ? 'color:var(--accent)' : ''}">${row.team_number} <span class="muted" style="font-size:10px">▾</span></td>
          <td>${esc((row.team_name || '').slice(0, 16))}</td>
          <td>${wlt}</td>
          <td class="r">${row.rp ?? '—'}</td>
          <td class="r">${row.qual_gp ?? '—'}</td>
          <td class="r">${row.match_pts || '—'}</td>
          <td class="r">${row.opr ?? '—'}</td>
        </tr>
        <tr class="lrdetail" data-for="${row.team_number}" style="display:none"><td colspan="${cols.length}" style="background:var(--bg2,#0001)">${detailHtml(row.team_number)}</td></tr>`;
      }).join('');
      box.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">Tap a column to sort · tap a team for its match scores · ${r.count} teams${ourTeam ? ' · your team highlighted' : ''}</div>
        <div style="overflow-x:auto"><table class="dt"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
      box.querySelectorAll('thead th').forEach((th) => th.onclick = () => {
        const k = th.dataset.k;
        if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k !== 'team_name'; }
        draw();
      });
      box.querySelectorAll('tbody tr.lrrow').forEach((tr) => tr.onclick = () => {
        const d = box.querySelector(`tr.lrdetail[data-for="${tr.dataset.team}"]`);
        if (d) d.style.display = d.style.display === 'none' ? '' : 'none';
      });
    };
    draw();
  } catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
}

// ─────────── match projections (alliance OPR cards + accuracy + projected standings) ───────────
function allianceBlock(label, a, color) {
  const teams = a.teams.map((t) => {
    const usesLive = t.proj_basis === 'live';
    const oprParts = [];
    if (usesLive) {
      oprParts.push(`<strong style="color:var(--accent)">Live: ${t.live_opr}</strong>`);
      if (t.opr != null) oprParts.push(`Pre: ${t.opr}`);
    } else {
      oprParts.push(`Pre: ${t.opr ?? '—'}`);
      if (t.live_opr != null) oprParts.push(`Live: ${t.live_opr}`);
    }
    if (t.trc_npopr != null) oprParts.push(`TRC: ${t.trc_npopr}`);
    return `<div class="muted" style="font-size:12px">${t.rank ? '#' + t.rank + ' ' : ''}<strong style="color:var(--text)">${t.team_number}</strong> ${esc((t.team_name || '').slice(0, 14))}${t.surrogate ? ' <em style="opacity:.75">(sur)</em>' : ''}<br><span style="font-size:11px;opacity:.8">${oprParts.join(' · ')}</span></div>`;
  }).join('');
  return `<div class="row spread"><span style="color:var(--${color});font-weight:700">${label}</span><strong style="color:var(--${color})">${a.proj}</strong></div>${teams}`;
}

async function renderMatchProjections() {
  state.subPage = 'matchProjections';
  view.innerHTML = `<div class="row spread" style="margin-bottom:4px">
      <button class="ghost" id="back" style="width:auto">← Home</button>
      <div class="row" style="gap:6px">
        <button class="ghost" id="mpUpsets" style="width:auto;font-size:13px">⚡ Upsets</button>
        <button class="ghost" id="mpToggleQuals" style="width:auto;font-size:13px">▼ Quals</button>
        <button class="ghost" id="jumpPlayoffs" style="display:none;width:auto;font-size:13px">↓ Playoffs</button>
        <button class="ghost" id="jumpStandings" style="width:auto;font-size:13px">↓ Standings</button>
      </div>
    </div>
    <h2 style="margin-top:10px">Match projections</h2>
    <div id="mp" style="margin-top:12px"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => go('home');
  $('#jumpStandings').onclick = () => document.getElementById('projStandings')?.scrollIntoView({ behavior: 'smooth' });
  $('#jumpPlayoffs').onclick = () => document.getElementById('mpPlayoffsSection')?.scrollIntoView({ behavior: 'smooth' });
  const box = $('#mp');
  try {
    const r = await api.matchProjections(state.bundle.event.id);
    if (!r.count) { box.innerHTML = '<div class="card"><p class="muted">No matches yet — sync the schedule first.</p></div>'; return; }

    // Split into qual and playoff items.
    const qualItems    = r.items.filter((m) => m.tournament_level === 'Quals');
    const playoffItems = r.items.filter((m) => m.tournament_level !== 'Quals');
    const hasPlayoffs  = playoffItems.length > 0;

    // Show the Playoffs jump button only when playoff matches exist.
    if (hasPlayoffs) $('#jumpPlayoffs').style.display = '';

    // Accuracy stats are Quals-only (playoff projections use the same OPR basis but
    // are tracked separately so the accuracy card doesn't mix apples and oranges).
    const basis = r.projection_basis === 'event_opr' ? `<div class="muted" style="font-size:12px;margin-top:8px">Based on this event's OPR (finished event). Upsets = results OPR didn't predict.</div>` : '';
    const buildAccHdr = (items, count, label) => {
      const decided = items.filter((m) => m.correct !== null);
      const correct = decided.filter((m) => m.correct === true).length;
      const total   = decided.length;
      const pct     = total ? Math.round(100 * correct / total) : null;
      if (!total) return basis ? `<div class="card">${basis}</div>` : '';
      const upsets    = total - correct;
      const upsetPct  = Math.round((upsets / total) * 100);
      const remaining = count - total;
      return `<div class="card">
        <strong>${esc(label)}</strong>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;text-align:center">
          <div style="background:var(--bg2);border-radius:8px;padding:10px 6px">
            <div style="font-size:22px;font-weight:800;color:var(--good)">${correct}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">Correct</div>
            <div style="font-size:13px;font-weight:600;color:var(--good)">${pct}%</div>
          </div>
          <div style="background:var(--bg2);border-radius:8px;padding:10px 6px">
            <div style="font-size:22px;font-weight:800;color:var(--warn)">${upsets}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">Upsets</div>
            <div style="font-size:13px;font-weight:600;color:var(--warn)">${upsetPct}%</div>
          </div>
          <div style="background:var(--bg2);border-radius:8px;padding:10px 6px">
            <div style="font-size:22px;font-weight:800">${remaining}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">Remaining</div>
            <div style="font-size:13px;font-weight:600;color:var(--muted)">${total}/${count} played</div>
          </div>
        </div>${basis}
      </div>`;
    };
    const accHdr = buildAccHdr(qualItems, qualItems.length, hasPlayoffs ? 'Qualifier prediction accuracy' : 'Prediction accuracy');

    const matchCard = (m) => {
      const w = m.projected_winner;
      const wc = w === 'Red' ? 'red' : w === 'Blue' ? 'blue' : 'muted';
      const a = m.actual;
      const score = a ? `<div style="text-align:right;min-width:80px">
          <div style="font-size:18px;${a.winner === 'Red' ? 'font-weight:800;color:var(--red)' : ''}">${a.red_score}</div>
          <div class="muted" style="font-size:11px">${a.red_diff > 0 ? '+' : ''}${a.red_diff} vs proj</div>
          <div style="font-size:18px;margin-top:8px;${a.winner === 'Blue' ? 'font-weight:800;color:var(--blue)' : ''}">${a.blue_score}</div>
          <div class="muted" style="font-size:11px">${a.blue_diff > 0 ? '+' : ''}${a.blue_diff} vs proj</div>
        </div>` : '<div style="text-align:right;min-width:80px" class="muted">—</div>';
      const badge = m.correct === true ? '<span class="pill" style="color:var(--good)">✓</span>' : m.correct === false ? '<span class="pill" style="color:var(--bad)">✗ upset</span>' : '';
      return `<div class="card"${m.correct === false ? ' style="border-color:var(--warn)"' : ''}>
        <div class="row spread"><strong>${esc(m.tournament_level)} ${m.match_num}</strong>${badge}</div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:6px">
          <div>
            ${allianceBlock('Red', m.red, 'red')}
            <div style="text-align:center;font-weight:700;color:var(--${wc});margin:5px 0">${w === 'Even' ? 'Even projected' : w + ' projected'}</div>
            ${allianceBlock('Blue', m.blue, 'blue')}
          </div>
          ${score}
        </div>
      </div>`;
    };

    // Populate the shared SoS cache (used by team scouting reports too).
    const sos = await computeSoS();
    const sosOpr  = sos?.opr  || {};
    const sosRank = sos?.rank || {};

    const gpSet = [...new Set(r.standings.map((s) => s.games_played))];
    const gpNote = gpSet.length === 1 ? ` · ${gpSet[0]} matches each` : ` · matches per team vary (see GP)`;

    // Augment each standing row with SoS values so the sort closure can compare them.
    const rows = r.standings.map((s) => ({
      ...s,
      sos_opr:  sosOpr[s.team_number] ?? null,
      sos_rank: sosRank[s.team_number] ?? null,
      win_pct:  Math.round(s.win_rate * 100),
    }));

    const stCols = [
      { key: 'proj_rank',    label: 'Rank',     num: true },
      { key: 'team_number',  label: 'Team',     num: true },
      { key: 'team_name',    label: 'Name',     num: false },
      { key: 'games_played', label: 'GP',       num: true },
      { key: 'proj_wins',    label: 'W-L-T',    num: true },
      { key: 'win_pct',      label: 'Win%',     num: true },
      { key: 'avg_proj_score', label: 'Avg proj', num: true },
      { key: 'sos_rank',     label: 'SoS Rank', num: true, title: 'Strength of Schedule rank (1=hardest)' },
      { key: 'sos_opr',      label: 'Opp OPR',  num: true, title: 'Sum of all opponents\' OPR across non-surrogate matches' },
    ];

    const matchHasTeam = (m, q) => !q || [...(m.red.teams || []), ...(m.blue.teams || [])].some((t) => String(t.team_number).includes(q));

    // Playoff accuracy card (built fresh each draw since results arrive during event).
    const playoffAccHdr = () => hasPlayoffs ? buildAccHdr(playoffItems, playoffItems.length, 'Playoff prediction accuracy') : '';

    box.innerHTML = accHdr
      + `<div class="card"><div class="row" style="gap:8px"><input id="mpSearch" placeholder="Filter matches by team #" inputmode="numeric" autocapitalize="off" style="flex:1" /><button id="mpClear" class="secondary" style="width:auto">Clear</button></div></div>`
      + `<p class="muted" id="mpCount"></p>`
      + `<div id="mpList"></div>`
      + `<div class="row spread" style="margin-top:16px;align-items:center">
          <div class="phase-title" id="projStandings" style="margin:0">Projected standings${r.standings.length ? gpNote : ''}</div>
          <button class="ghost" id="jumpTop" style="width:auto;font-size:13px">↑ Top</button>
        </div>`
      + `<div class="muted" style="font-size:12px;margin:4px 0 6px">Tap a column to sort</div>`
      + `<div style="overflow-x:auto"><table class="dt" id="stTable"><thead><tr></tr></thead><tbody></tbody></table></div>`;

    let stKey = 'proj_rank', stAsc = true;
    const drawStandings = () => {
      const sorted = rows.slice().sort((a, b) => {
        const x = a[stKey], y = b[stKey];
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        if (typeof x === 'string') return stAsc ? x.localeCompare(y) : y.localeCompare(x);
        return stAsc ? x - y : y - x;
      });
      const tbl = document.getElementById('stTable');
      tbl.querySelector('thead tr').innerHTML = stCols.map((c) =>
        `<th data-k="${c.key}" class="${c.num ? 'r' : ''}${c.key === stKey ? ' s' : ''}"${c.title ? ` title="${c.title}"` : ''}>${esc(c.label)}${c.key === stKey ? (stAsc ? ' ▲' : ' ▼') : ''}</th>`
      ).join('');
      tbl.querySelector('tbody').innerHTML = sorted.map((s) =>
        `<tr><td class="r">${s.proj_rank}</td><td class="r">${s.team_number}</td><td>${esc((s.team_name || '').slice(0, 20))}</td><td class="r">${s.games_played}</td><td class="r">${s.proj_wins}-${s.proj_losses}${s.proj_ties ? '-' + s.proj_ties : ''}</td><td class="r">${s.win_pct}%</td><td class="r">${s.avg_proj_score}</td><td class="r">${s.sos_rank ?? '—'}</td><td class="r">${s.sos_opr != null ? Math.round(s.sos_opr) : '—'}</td></tr>`
      ).join('');
      tbl.querySelectorAll('thead th').forEach((th) => th.onclick = () => {
        const k = th.dataset.k;
        if (k === stKey) stAsc = !stAsc; else { stKey = k; stAsc = ['team_name'].includes(k); }
        drawStandings();
      });
    };
    drawStandings();
    document.getElementById('jumpTop')?.addEventListener('click', () => view.scrollIntoView({ behavior: 'smooth' }));

    let _upsetsOnly    = false;
    let _qualsCollapsed = false;
    const upsetsBtn    = $('#mpUpsets');
    const toggleBtn    = $('#mpToggleQuals');
    const uCount       = qualItems.filter((m) => m.correct === false).length;

    const drawList = (q = '') => {
      q = q.trim();
      const shownQuals    = qualItems.filter((m) => matchHasTeam(m, q) && (!_upsetsOnly || m.correct === false));
      const shownPlayoffs = playoffItems.filter((m) => matchHasTeam(m, q));

      // Upsets button label/style.
      if (upsetsBtn) {
        upsetsBtn.textContent = _upsetsOnly ? '⚡ All' : '⚡ Upsets';
        upsetsBtn.style.background = _upsetsOnly ? 'var(--warn)' : '';
        upsetsBtn.style.color      = _upsetsOnly ? '#06283d' : '';
        upsetsBtn.style.border     = _upsetsOnly ? '1.5px solid var(--warn)' : '';
      }

      // Count line (quals-based).
      $('#mpCount').innerHTML = _upsetsOnly
        ? `${shownQuals.length} upset${shownQuals.length !== 1 ? 's' : ''}${q ? ` with team ${esc(q)}` : ''}`
        : (q ? `${shownQuals.length + shownPlayoffs.length} match${shownQuals.length + shownPlayoffs.length !== 1 ? 'es' : ''} with team ${esc(q)}`
             : `${qualItems.length} qual${hasPlayoffs ? ` · ${playoffItems.length} playoff` : ''} matches${uCount ? ` · ${uCount} qual upset${uCount > 1 ? 's' : ''}` : ''}`);

      // Quals section — always show the header + collapse button.
      let html = `<div class="row spread" style="margin-bottom:8px;align-items:center">
          <div class="phase-title" style="margin:0">Qualifier Matches</div>
          <button class="ghost" id="mpCollapseQuals" style="width:auto;font-size:12px">${_qualsCollapsed ? '▶ Show' : '▼ Hide'}</button>
        </div>`;
      if (!_qualsCollapsed) {
        html += shownQuals.length
          ? shownQuals.map(matchCard).join('')
          : `<div class="card"><p class="muted">${_upsetsOnly ? 'No upsets yet.' : 'No matches for that team.'}</p></div>`;
      }

      // Playoffs section (always visible when present; upsets filter does not apply).
      if (hasPlayoffs) {
        html += `<div id="mpPlayoffsSection" style="margin-top:${_qualsCollapsed ? 0 : 20}px">`;
        html += `<div class="row spread" style="margin-bottom:8px;align-items:center">
          <div class="phase-title" style="margin:0">Playoff Matches</div>
        </div>`;
        html += playoffAccHdr();
        html += shownPlayoffs.length
          ? shownPlayoffs.map(matchCard).join('')
          : `<div class="card"><p class="muted">${q ? 'No playoff matches for that team.' : 'No playoff matches yet — sync the schedule.'}</p></div>`;
        html += `</div>`;
      }

      $('#mpList').innerHTML = html;

      // Wire the inline collapse button (re-created on each draw).
      document.getElementById('mpCollapseQuals')?.addEventListener('click', () => {
        _qualsCollapsed = !_qualsCollapsed;
        if (toggleBtn) {
          toggleBtn.textContent = _qualsCollapsed ? '▶ Quals' : '▼ Quals';
          toggleBtn.style.background = _qualsCollapsed ? 'var(--panel2)' : '';
        }
        drawList($('#mpSearch').value);
      });
    };

    drawList();
    // Header toggle button also collapses quals.
    if (toggleBtn) toggleBtn.onclick = () => {
      _qualsCollapsed = !_qualsCollapsed;
      toggleBtn.textContent = _qualsCollapsed ? '▶ Quals' : '▼ Quals';
      toggleBtn.style.background = _qualsCollapsed ? 'var(--panel2)' : '';
      drawList($('#mpSearch').value);
    };
    $('#mpSearch').oninput = () => drawList($('#mpSearch').value);
    $('#mpClear').onclick = () => { $('#mpSearch').value = ''; drawList(); };
    if (upsetsBtn) upsetsBtn.onclick = () => { _upsetsOnly = !_upsetsOnly; drawList($('#mpSearch').value); };
  } catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
}

// ─────────── playoff bracket (double elimination) ───────────
// isRefresh = true when called from liveAutoSync: skip the loading flash and
// preserve user lineup selections; only reset slots that became real matches.
async function renderPlayoffBracket(isRefresh = false) {
  state.subPage = 'playoffBracket';
  if (!isRefresh) {
    state.playoffOprMode = state.playoffOprMode ?? 'live';
    state.playoffData    = null;
    state.playoffLineups = {};
    view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Home</button>
      <h2 style="margin-top:10px">Playoff Bracket</h2>
      <p class="muted" style="font-size:12px;margin:2px 0 10px">Double elimination · lose once → lower bracket · lose twice → out</p>
      <div id="pb"><p class="muted">Loading…</p></div>`;
    $('#back').onclick = () => go('home');
  }
  const box = $('#pb');
  if (!box) return;   // navigated away
  try {
    const r = await api.playoffBracket(state.bundle.event.id);
    state.playoffData = r;
    drawPlayoffBracket(r, box);
  } catch (e) {
    if (!isRefresh) box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`;
  }
}

function drawPlayoffBracket(r, box) {
  if (!r.alliances?.length) {
    box.innerHTML = `<div class="card"><p class="muted">No playoff data yet — sync Live Stats, then check back once alliance selection is done.</p></div>`;
    return;
  }

  // Build allById lookup
  const allById = {};
  for (const a of r.alliances) allById[a.id] = a;

  // Initialize lineups from server data only on first load for each slot.
  // User overrides (including on played matches) persist across refreshes.
  (r.matches || []).forEach((m, i) => {
    if (!state.playoffLineups[i]) {
      state.playoffLineups[i] = {
        red:  new Set(m.red_playing  || []),
        blue: new Set(m.blue_playing || []),
      };
    }
  });

  const statusLabel = (s) => ({
    upper:      ['Upper Bracket', 'accent'],
    lower:      ['Lower Bracket', 'warn'],
    eliminated: ['Eliminated',    'bad'],
    champion:   ['Champion',      'good'],
  }[s] ?? [s, 'muted']);

  // ── Alliance status card ────────────────────────────────────
  const allianceCard = (a) => {
    const [statusText, statusColor] = statusLabel(a.status);
    const hc = { champion: 'good', upper: 'accent', lower: 'warn', eliminated: 'line' }[a.status] ?? 'line';
    const teams = (a.teams || []).map((t) => {
      const opr = t.live_opr != null
        ? `<strong style="color:var(--accent)">${t.live_opr}</strong><span class="muted" style="font-size:10px"> live</span>`
        : (t.pre_opr != null ? `${t.pre_opr}<span class="muted" style="font-size:10px"> pre</span>` : '—');
      return `<div style="font-size:12px;margin-top:3px">${t.rank ? `<span class="muted">#${t.rank}</span> ` : ''}<strong>${t.team_number}</strong> ${esc((t.team_name || '').slice(0, 18))} · ${opr}</div>`;
    }).join('');
    return `<div style="padding:10px;border-radius:8px;border:1.5px solid var(--${hc});margin-bottom:8px;opacity:${a.status === 'eliminated' ? '.55' : '1'}">
      <div class="row spread" style="margin-bottom:4px">
        <strong>${esc(a.id)}</strong>
        <span style="font-size:11px;color:var(--${statusColor});font-weight:700">${esc(statusText)}</span>
      </div>
      <div style="font-size:12px;color:var(--muted)">W ${a.wins} · L ${a.losses} · Proj ${a.proj}</div>
      ${teams}
    </div>`;
  };

  // ── Team chips inside a match row ───────────────────────────
  // playing = Set of team nums currently in the lineup for this side
  // canSwap = this is a projected match AND alliance has a bench player
  const teamChips = (alliance, side, playing, canSwap, midx) => {
    if (!alliance) return '<span class="muted">?</span>';
    return (alliance.teams || []).map((t) => {
      const isPlaying = playing.has(t.team_number);
      const opr = teamOprValue(t) || '—';
      const bg  = isPlaying
        ? (side === 'red' ? 'var(--red)' : 'var(--blue)')
        : 'var(--line)';
      const fg  = isPlaying ? '#fff' : 'var(--muted)';
      const cur = canSwap ? 'cursor:pointer;' : '';
      return `<span class="pb-team" data-midx="${midx}" data-side="${side}" data-team="${t.team_number}"
        style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:12px;
               font-size:11px;font-weight:${isPlaying ? '700' : '400'};margin:2px;
               background:${bg};color:${fg};${cur}">
        ${t.team_number}
        <span style="opacity:.8;font-size:10px">${opr}</span>
        ${canSwap && !isPlaying ? '<span style="font-size:9px;margin-left:1px">↑</span>' : ''}
      </span>`;
    }).join('');
  };

  // ── OPR selector for this team in current mode ──────────────
  const teamOprValue = (t) => state.playoffOprMode === 'live'
    ? (t.live_opr ?? t.pre_opr ?? 0)
    : (t.trc_npopr ?? t.pre_opr ?? 0);

  // ── Compute projected score from current lineup ─────────────
  const calcProj = (alliance, playing) => {
    if (!alliance) return 0;
    const sum = (alliance.teams || [])
      .filter((t) => playing.has(t.team_number))
      .reduce((s, t) => s + teamOprValue(t), 0);
    return Math.round(sum * 10) / 10;
  };

  // ── Match row ───────────────────────────────────────────────
  const matchRow = (m, midx) => {
    const ra = allById[m.red_alliance_id];
    const ba = allById[m.blue_alliance_id];
    const lineup = state.playoffLineups[midx];
    // canSwap: allow lineup selection on any match with a 3-member alliance,
    // whether played or projected. For played matches the score is already set;
    // for projected matches the OPR projection recalculates.
    const canSwap = true;

    // For projected matches use lineup-based proj; for played use server value
    const redProj  = m.played ? m.red_proj  : calcProj(ra, lineup.red);
    const blueProj = m.played ? m.blue_proj : calcProj(ba, lineup.blue);
    const projDiff = redProj - blueProj;
    const pw = m.played ? m.proj_winner
             : (Math.abs(projDiff) < 1 ? 'Even' : (projDiff > 0 ? 'Red' : 'Blue'));
    const spread = Math.round(Math.abs(projDiff) * 10) / 10;

    const aw = m.actual_winner;
    const badge = m.correct === true  ? '<span style="color:var(--good);font-size:11px"> ✓</span>'
                : m.correct === false ? '<span style="color:var(--bad);font-size:11px"> ✗</span>' : '';

    const rScore = m.played
      ? `<span style="font-weight:${aw==='Red'?'800':'400'};color:${aw==='Red'?'var(--red)':'var(--text)'}">${m.red_score}</span>`
      : `<span class="muted" style="font-size:13px">${redProj}</span>`;
    const bScore = m.played
      ? `<span style="font-weight:${aw==='Blue'?'800':'400'};color:${aw==='Blue'?'var(--blue)':'var(--text)'}">${m.blue_score}</span>`
      : `<span class="muted" style="font-size:13px">${blueProj}</span>`;

    const sub = m.played
      ? `<span class="muted" style="font-size:10px">${m.red_diff > 0 ? '+' : ''}${m.red_diff} / ${m.blue_diff > 0 ? '+' : ''}${m.blue_diff} vs proj${badge}</span>`
      : `<span class="muted" style="font-size:10px">${esc(pw)} proj · spread ${spread}</span>`;

    const vsLabel = `${esc(ra?.id ?? '?')} vs. ${esc(ba?.id ?? '?')}`;
    const statusTag = m.is_projected
      ? `<em style="opacity:.6;font-size:10px">(projected)</em>`
      : `<span style="color:var(--good);font-size:10px;font-weight:600">(final)</span>`;
    const roundPart = m.round_label
      ? esc(m.round_label)
      : (m.match_num ? `M${m.match_num}` : 'Playoffs');
    const matchLabel = `<span style="font-size:12px;font-weight:700;color:${m.is_projected ? 'var(--warn)' : 'var(--text)'}">${roundPart} — ${vsLabel}</span> ${statusTag}`;

    // canSwap is true whenever this is a projected match AND the alliance has a bench player
    // (i.e. at least one member not in the current lineup — means roster has > 2 members)
    const hasBench = (alli, lup) => (alli?.teams || []).some((t) => !lup.has(t.team_number));
    const redChips  = teamChips(ra, 'red',  lineup.red,  canSwap && hasBench(ra, lineup.red),  midx);
    const blueChips = teamChips(ba, 'blue', lineup.blue, canSwap && hasBench(ba, lineup.blue), midx);

    return `<div style="padding:10px 0;border-top:1px solid var(--line);${m.is_projected ? 'opacity:.85' : ''}">
      <div class="row spread" style="margin-bottom:6px">
        <div>${matchLabel}</div>
        <div style="font-size:17px;font-weight:700">
          <span style="color:var(--red)">${rScore}</span><span class="muted" style="font-weight:400"> – </span><span style="color:var(--blue)">${bScore}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--red);margin-bottom:3px;text-transform:uppercase">Red · ${esc(ra?.id ?? '?')}</div>
          <div>${redChips}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--blue);margin-bottom:3px;text-transform:uppercase">Blue · ${esc(ba?.id ?? '?')}</div>
          <div>${blueChips}</div>
        </div>
      </div>
      <div style="margin-top:5px">${sub}</div>
    </div>`;
  };

  // ── Build HTML ──────────────────────────────────────────────
  const updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isLive = state.playoffOprMode === 'live';
  let html = `
    <div class="row spread" style="align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
      <p class="muted" style="font-size:11px;margin:0">Updated ${updatedAt} · auto-refreshes every 60s</p>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="color:${isLive ? 'var(--muted)' : 'var(--accent)'};font-weight:${isLive ? '400' : '700'}">TRC npOPR</span>
        <label style="position:relative;display:inline-block;width:42px;height:22px;cursor:pointer">
          <input type="checkbox" id="pb-opr-toggle" ${isLive ? 'checked' : ''} style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${isLive ? 'var(--accent)' : 'var(--line)'};border-radius:11px;transition:.2s">
            <span style="position:absolute;top:3px;left:${isLive ? '23px' : '3px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s"></span>
          </span>
        </label>
        <span style="color:${isLive ? 'var(--accent)' : 'var(--muted)'};font-weight:${isLive ? '700' : '400'}">Live OPR</span>
      </div>
    </div>`;

  if (r.source === 'rankings') {
    html += `<div class="card" style="border-color:var(--warn)"><p class="muted" style="margin:0;font-size:13px">Alliance selection hasn't happened yet — showing projected first-round matchups from qual standings. Picks are unknown.</p></div>`;
  }

  if (r.champion) {
    const ch = r.champion;
    html += `<div class="card" style="border-color:var(--good);background:rgba(34,197,94,.06);margin-bottom:14px">
      <div style="font-size:18px;font-weight:800;color:var(--good)">Champion: ${esc(ch.id)}</div>
      <div style="font-size:13px;margin-top:4px">${(ch.teams || []).map((t) => t.team_number).join(' & ')}</div>
      <div class="muted" style="font-size:12px;margin-top:2px">${ch.wins}W – ${ch.losses}L · Proj ${ch.proj}</div>
    </div>`;
  }

  html += `<div class="phase-title" style="margin-top:0">Alliances (${r.alliance_count} total)</div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">`;
  for (const a of r.alliances) html += allianceCard(a);
  html += `</div>`;

  if (r.matches?.length) {
    html += `<div class="phase-title">Match Results &amp; Projections</div>`;
    html += `<div class="card">`;
    html += r.matches.map((m, i) => matchRow(m, i)).join('');
    html += `</div>`;
  }

  box.innerHTML = html;

  // ── OPR mode toggle ─────────────────────────────────────────
  document.getElementById('pb-opr-toggle')?.addEventListener('change', (e) => {
    state.playoffOprMode = e.target.checked ? 'live' : 'pre';
    drawPlayoffBracket(r, box);
  });

  // ── Lineup swap via event delegation ───────────────────────
  box.onclick = (e) => {
    const chip = e.target.closest('.pb-team');
    if (!chip) return;
    const midx  = +chip.dataset.midx;
    const side  = chip.dataset.side;
    const team  = +chip.dataset.team;
    const m     = r.matches?.[midx];
    if (!m) return;

    const alliance = allById[side === 'red' ? m.red_alliance_id : m.blue_alliance_id];
    if (!alliance || alliance.teams.length < 3) return;  // nothing to swap

    const lineup  = state.playoffLineups[midx];
    const teamOpr = (tn) => (alliance.teams).find((t) => t.team_number === tn)?.proj_opr ?? 0;

    if (lineup[side].has(team)) {
      // Tapped a playing member — bench them, sub in the benched player
      const bench = alliance.teams.find((t) => !lineup[side].has(t.team_number));
      if (!bench) return;
      lineup[side].delete(team);
      lineup[side].add(bench.team_number);
    } else {
      // Tapped a bench player — sub them in, bench the lowest-OPR playing member
      const playing = [...lineup[side]].sort((a, b) => teamOpr(a) - teamOpr(b));
      lineup[side].delete(playing[0]);
      lineup[side].add(team);
    }
    drawPlayoffBracket(r, box);
  };
}

// ─────────── alliance picker (partner recommendations) ───────────
function renderAlliance() {
  const MODES = [
    { key: 'npopr',     label: 'npOPR' },
    { key: 'trc_npopr', label: 'TRC npOPR' },
    { key: 'far',       label: 'Far' },
    { key: 'goal_side', label: 'Goal Side' },
    { key: 'utility',   label: 'Utility' },
  ];
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Home</button>
    <h2 style="margin-top:10px">Alliance picker</h2>
    <div class="card">
      <label>Your team #</label><input id="ourTeam" data-type="int" inputmode="numeric" value="${state.bundle?.event?.our_team_number || state.allianceTeam || ''}" />
      <label>Rank by</label>${seg('mode', MODES, { value: state.allianceMode || 'npopr' })}
      <div style="height:10px"></div><button id="run">Rank partners</button>
    </div>
    <div id="alli"></div>`;
  $('#back').onclick = () => go('home');
  wireSegs(view);
  $('#run').onclick = async () => {
    const team = parseInt($('#ourTeam').value, 10);
    if (!team) return toast('Enter your team #');
    const mode = $$('.seg[data-key="mode"] .opt.on')[0]?.dataset.val || 'npopr';
    state.allianceTeam = team; state.allianceMode = mode;
    const box = $('#alli'); box.innerHTML = '<p class="muted">Computing…</p>';
    if (!api.online()) { box.innerHTML = '<div class="card"><p class="muted">Offline — alliance ranking requires a server connection.</p></div>'; return; }
    try { renderAllianceItems(box, await api.allianceModel(state.bundle.event.id, team, mode), state.bundle.event.id); }
    catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
  };
}

function renderAllianceItems(box, r, eventId) {
  box.innerHTML = '';
  if (!r.items.length) { box.innerHTML = '<div class="card"><p class="muted">No candidates found — sync pre-event data or scout some matches first.</p></div>'; return; }

  const modeMeta = {
    npopr:     { label: 'npOPR',        color: 'var(--accent)',  detail: (t) => `FTC Scout · ${t.source}` },
    trc_npopr: { label: 'TRC npOPR',    color: 'var(--good)',    detail: (t) => `${t.risk.matches_scouted}m scouted` },
    far:       { label: 'Far avg',       color: 'var(--accent2)', detail: (t) => `scores/match from far zone (auto + teleop)` },
    goal_side: { label: 'Goal Side avg', color: 'var(--accent2)', detail: (t) => `scores/match from near side (auto + teleop)` },
    utility:   { label: 'Utility',       color: 'var(--warn)',    detail: (t) => t.far != null && t.goal_side != null ? `Goal ${fmt(t.goal_side)} · Far ${fmt(t.far)}` : '' },
  };
  const scoreKey = { npopr: 'np', trc_npopr: 'trc_npopr', far: 'far', goal_side: 'goal_side', utility: 'utility' };
  const m = modeMeta[r.mode] || modeMeta.npopr;
  const sk = scoreKey[r.mode] || 'np';
  const modeDescriptions = {
    npopr:     'Ranked by FTC Scout npOPR (live scoring data). Best overall partners.',
    trc_npopr: 'Ranked by TRC scouted score: auto + leave bonus + teleop + park, no penalties.',
    far:       'Ranked by average artifacts scored from the far zone (auto + teleop). Best far shooters.',
    goal_side: 'Ranked by average artifacts scored from the near/goal side (auto + teleop). Best close scorers.',
    utility:   'Ranked by utility score = 2 × min(close avg, far avg). Only robots that score meaningfully from both zones rank high here.',
  };

  const desc = document.createElement('div');
  desc.className = 'card';
  desc.style.cssText = 'font-size:13px;color:var(--muted)';
  desc.textContent = modeDescriptions[r.mode] || '';
  box.appendChild(desc);

  // Build Scout / Watch toggle buttons for a team, wired to togglePriority.
  const makePriBtns = (teamNum) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px';

    const btns = {};
    const refreshAll = () => Object.values(btns).forEach((fn) => fn());

    const mkBtn = (label, key) => {
      const btn = document.createElement('button');
      const refresh = () => {
        const on = !!(state.bundle.teams || []).find((x) => Number(x.team_number) === Number(teamNum))?.[key];
        btn.textContent = (key === 'match_priority' ? (on ? '⭐' : '☆') : (on ? '★' : '☆')) + ' ' + label;
        btn.style.cssText = `width:auto;font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--line);background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#06283d' : 'var(--muted)'};cursor:pointer;white-space:nowrap;min-height:0`;
      };
      btns[key] = refresh;
      refresh();
      btn.onclick = async (e) => {
        e.stopPropagation();
        const cur = !!(state.bundle.teams || []).find((x) => Number(x.team_number) === Number(teamNum))?.[key];
        await togglePriority(teamNum, key, !cur);
        refreshAll(); // both buttons may have changed state
      };
      return btn;
    };

    row.appendChild(mkBtn('Scout', 'match_priority'));
    row.appendChild(mkBtn('Watch', 'watchlist'));
    return row;
  };

  const dnsTeams = new Set((state.bundle.teams || []).filter((x) => x.did_not_show).map((x) => x.team_number));
  r.items.filter((t) => !dnsTeams.has(t.team_number)).slice(0, 20).forEach((t, i) => {
    const score = t[sk];
    const risk  = t.risk.major_failure_rate;
    const warn  = risk != null && risk >= 0.3;

    // ── card shell (click header to expand/collapse) ──
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';

    // header row: rank + name | score pill
    const hdr = document.createElement('div');
    hdr.className = 'row spread';
    hdr.innerHTML =
      `<strong>${i + 1}. ${t.team_number} <span class="muted" style="font-weight:400">${esc((t.team_name || '').slice(0, 22))}</span></strong>`;

    // right side: primary score pill + secondary stats stacked below it
    const right = document.createElement('div');
    right.style.cssText = 'text-align:right;min-width:0';
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.style.color = m.color;
    pill.textContent = `${score != null ? fmt(score) : '—'} ${m.label}`;
    right.appendChild(pill);
    // npOPR + TRC npOPR secondary stats (shown for non-npopr modes; skip the one already shown as primary)
    const statLines = [];
    if (r.mode !== 'npopr'     && t.np        != null) statLines.push(`npOPR ${fmt(t.np)} (${t.source || '?'})`);
    if (r.mode !== 'trc_npopr' && t.trc_npopr != null) statLines.push(`TRC npOPR ${fmt(t.trc_npopr)}`);
    if (statLines.length) {
      const sec = document.createElement('div');
      sec.style.cssText = 'font-size:11px;color:var(--muted);margin-top:3px';
      sec.textContent = statLines.join(' · ');
      right.appendChild(sec);
    }
    hdr.appendChild(right);
    card.appendChild(hdr);

    // zone detail line (mode-specific)
    const detailTxt = m.detail(t);
    if (detailTxt) {
      const dl = document.createElement('div');
      dl.className = 'muted';
      dl.style.cssText = 'font-size:12px;margin-top:4px';
      dl.textContent = detailTxt;
      card.appendChild(dl);
    }

    // auto zone breakdown (all TRC modes)
    if (r.mode !== 'npopr' && (t.auto_goal != null || t.auto_far != null)) {
      const al = document.createElement('div');
      al.className = 'muted';
      al.style.cssText = 'font-size:12px;margin-top:2px';
      al.textContent = `Auto Goal ${fmt(t.auto_goal ?? 0)} · Auto Far ${fmt(t.auto_far ?? 0)}`;
      card.appendChild(al);
    }

    // Scout / Watch priority buttons
    card.appendChild(makePriBtns(t.team_number));

    // failure warning
    if (warn) {
      const wl = document.createElement('div');
      wl.style.cssText = 'font-size:12px;margin-top:4px;color:var(--warn)';
      wl.textContent = `⚠ major failure ${Math.round(risk * 100)}% of ${t.risk.matches_scouted} scouted matches`;
      card.appendChild(wl);
    }

    // ── expandable scouting report ──
    const expander = document.createElement('div');
    expander.style.display = 'none';
    card.appendChild(expander);

    card.onclick = async (e) => {
      // Collapse when clicking anywhere outside the expanded report content
      // (header, detail lines, card background) — but not when interacting
      // with something inside the report itself.
      if (expander.style.display !== 'none') {
        if (!expander.contains(e.target)) {
          expander.style.display = 'none';
          card.style.cursor = 'pointer';
        }
        return;
      }
      expander.style.display = 'block';
      card.style.cursor = 'default';
      expander.innerHTML = '<p class="muted" style="margin-top:10px">Loading report…</p>';
      try {
        const rpt = await mergeLocalMessages(await mergeLocalPit(await api.teamReport(eventId, t.team_number), t.team_number), t.team_number);
        expander.innerHTML = '<div style="border-top:1px solid var(--line);margin:10px 0"></div>' + reportHtml(rpt);
        wireMhRows(expander);
      } catch (err) {
        expander.innerHTML = `<p class="muted" style="margin-top:10px">${esc(err.message)}</p>`;
      }
    };

    box.appendChild(card);
  });
}

// ─────────── live performance (replaces movers) ───────────
async function renderMovers() {
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Home</button>
    <h2 style="margin-top:10px">Live Performance</h2>
    <div id="lp" style="margin-top:12px"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => go('home');
  const box = $('#lp');
  try {
    const [perf, proj] = await Promise.all([
      api.livePerformance(state.bundle.event.id),
      api.matchProjections(state.bundle.event.id),
    ]);
    if (!perf.count) { box.innerHTML = '<div class="card"><p class="muted">No teams loaded yet.</p></div>'; return; }

    // Strip DNS teams from live performance data.
    const isDns = (tn) => (state.bundle.teams || []).some((x) => Number(x.team_number) === Number(tn) && x.did_not_show);
    perf.items = perf.items.filter((t) => !isDns(t.team_number));
    perf.count = perf.items.length;

    // Build per-team match score history from played Quals results.
    const mHist = {};
    for (const m of (proj.items || [])) {
      if (m.tournament_level !== 'Quals' || !m.actual) continue;
      for (const t of (m.red.teams  || [])) { (mHist[t.team_number] = mHist[t.team_number] || []).push({ n: m.match_num, s: m.actual.red_score  }); }
      for (const t of (m.blue.teams || [])) { (mHist[t.team_number] = mHist[t.team_number] || []).push({ n: m.match_num, s: m.actual.blue_score }); }
    }
    for (const k of Object.keys(mHist)) mHist[k].sort((a, b) => a.n - b.n);

    // Top / bottom 5 by live OPR (teams with live data, sorted server-side).
    const withLive = perf.items.filter((t) => t.has_live && t.live_opr != null);
    const top5 = withLive.slice(0, Math.min(5, withLive.length)).map((t) => t.team_number);
    const bot5 = withLive.slice(Math.max(0, withLive.length - 5)).map((t) => t.team_number).reverse();

    const TOP_C = ['#22c55e', '#06b6d4', '#3b82f6', '#84cc16', '#10b981'];
    const BOT_C = ['#ef4444', '#f97316', '#f59e0b', '#ec4899', '#a855f7'];

    // SVG line chart: per-team alliance score over Quals match number.
    const makeChart = (teams, colors, title) => {
      const allNums = [...new Set(teams.flatMap((t) => (mHist[t] || []).map((p) => p.n)))].sort((a, b) => a - b);
      if (!allNums.length) return `<div class="card"><div class="phase-title">${esc(title)}</div><p class="muted" style="margin:0">No match results yet.</p></div>`;
      let yLo = Infinity, yHi = -Infinity;
      teams.forEach((t) => (mHist[t] || []).forEach((p) => { if (p.s < yLo) yLo = p.s; if (p.s > yHi) yHi = p.s; }));
      const pad = Math.max(8, Math.round((yHi - yLo) * 0.12));
      yLo = Math.max(0, yLo - pad); yHi = yHi + pad;
      if (yLo >= yHi) { yLo = 0; yHi = 100; }
      const W = 660, H = 230, ml = 40, mr = 12, mt = 14, mb = 28, legH = 24;
      const pw = W - ml - mr, ph = H - mt - mb - legH;
      const xS = (n) => allNums.length < 2 ? ml + pw / 2 : ml + (allNums.indexOf(n) / (allNums.length - 1)) * pw;
      const yS = (v) => mt + ph - Math.max(0, Math.min(1, (v - yLo) / (yHi - yLo))) * ph;
      let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">`;
      // Grid + y-axis
      for (let i = 0; i <= 4; i++) {
        const v = yLo + (yHi - yLo) * i / 4, y = yS(v);
        s += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#2d3f55" stroke-width="1"/>`;
        s += `<text x="${ml - 4}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(v)}</text>`;
      }
      s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#475569" stroke-width="1"/>`;
      s += `<line x1="${ml}" y1="${mt + ph}" x2="${W - mr}" y2="${mt + ph}" stroke="#475569" stroke-width="1"/>`;
      // X-axis labels (skip every other if dense)
      const step = allNums.length > 12 ? 2 : 1;
      allNums.forEach((n, i) => { if (i % step === 0) s += `<text x="${xS(n)}" y="${mt + ph + 13}" text-anchor="middle" fill="#64748b" font-size="10">Q${n}</text>`; });
      // Lines + dots per team
      teams.forEach((team, i) => {
        const pts = mHist[team] || []; if (!pts.length) return;
        const color = colors[i];
        if (pts.length > 1) s += `<polyline points="${pts.map((p) => `${xS(p.n)},${yS(p.s)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
        pts.forEach((p) => {
          s += `<circle cx="${xS(p.n)}" cy="${yS(p.s)}" r="4" fill="${color}" stroke="#1e293b" stroke-width="1.5" pointer-events="none"/>`;
          // Larger transparent hitbox — easier to tap on mobile; carries data for tooltip
          s += `<circle class="dot-hit" cx="${xS(p.n)}" cy="${yS(p.s)}" r="11" fill="transparent" pointer-events="all" style="cursor:pointer" data-team="${team}" data-n="${p.n}" data-s="${p.s}" data-color="${color}"/>`;
        });
      });
      // Legend row
      const legY = H - legH + 10, slotW = pw / Math.max(teams.length, 1);
      teams.forEach((team, i) => {
        const x = ml + i * slotW;
        s += `<rect x="${x}" y="${legY - 5}" width="16" height="3" fill="${colors[i]}" rx="1.5"/>`;
        s += `<text x="${x + 20}" y="${legY}" fill="${colors[i]}" font-size="11" font-weight="700">${team}</text>`;
      });
      s += `</svg>`;
      return `<div class="card"><div class="phase-title">${esc(title)}</div>${s}</div>`;
    };

    // Sortable table state
    const tblCols = [
      { key: 'live_rank',   label: 'Rank',     num: true },
      { key: 'team_number', label: 'Team',     num: true },
      { key: 'team_name',   label: 'Name',     num: false },
      { key: 'gp',          label: 'GP',       num: true },
      { key: 'pre_opr',     label: 'Pre OPR',  num: true },
      { key: 'live_opr',    label: 'Live OPR',    num: true },
      { key: 'delta',       label: 'Δ OPR',       num: true },
      { key: 'trc_npopr',  label: 'TRC npOPR',   num: true },
    ];
    let minGp = 0, stKey = 'live_opr', stAsc = false;

    const deltaHtml = (d) => {
      if (d == null) return '<span class="muted">—</span>';
      const c = d > 5 ? 'var(--good)' : d < -5 ? 'var(--bad)' : 'var(--muted)';
      return `<span style="color:${c};font-weight:700">${d > 0 ? '+' : ''}${d}</span>`;
    };
    const trendHtml = (t) => {
      if (!t.has_live || t.gp == null || t.gp < 3 || t.delta == null) return '<span class="muted">—</span>';
      if (t.delta > 8)  return '<span style="color:var(--good);font-size:16px">▲</span>';
      if (t.delta < -8) return '<span style="color:var(--bad);font-size:16px">▼</span>';
      return '<span style="color:var(--muted);font-size:16px">→</span>';
    };

    box.innerHTML =
      (withLive.length >= 2 ? makeChart(top5, TOP_C, `Top ${top5.length} by Live OPR — Alliance Score per Match`) : '') +
      (withLive.length >= 2 ? makeChart(bot5, BOT_C, `Bottom ${bot5.length} by Live OPR — Alliance Score per Match`) : '') +
      `<div class="card" style="margin-top:4px">
        <div class="row spread" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <span class="muted" style="font-size:13px">${perf.has_live} of ${perf.count} teams have live data</span>
          <div class="row" style="gap:6px;align-items:center">
            <span class="muted" style="font-size:12px">Min GP</span>
            <button id="mgp0" class="secondary" style="width:auto;padding:5px 10px;font-size:12px">All</button>
            <button id="mgp2" class="secondary" style="width:auto;padding:5px 10px;font-size:12px">2+</button>
            <button id="mgp4" class="secondary" style="width:auto;padding:5px 10px;font-size:12px">4+</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">Tap a column to sort · Δ OPR = live − pre · Trend needs 3+ matches</div>
        <div style="overflow-x:auto"><table class="dt" id="lpTbl"><thead><tr></tr></thead><tbody></tbody></table></div>
      </div>`;

    const drawTable = () => {
      const rows = perf.items
        .filter((t) => minGp === 0 ? true : (t.gp ?? 0) >= minGp)
        .slice().sort((a, b) => {
          const x = a[stKey], y = b[stKey];
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          if (typeof x === 'string') return stAsc ? x.localeCompare(y) : y.localeCompare(x);
          return stAsc ? x - y : y - x;
        });
      const tbl = document.getElementById('lpTbl');
      tbl.querySelector('thead tr').innerHTML =
        tblCols.map((c) => `<th data-k="${c.key}" class="${c.num ? 'r' : ''}${c.key === stKey ? ' s' : ''}">${esc(c.label)}${c.key === stKey ? (stAsc ? ' ▲' : ' ▼') : ''}</th>`).join('') +
        '<th>Trend</th>';
      tbl.querySelector('tbody').innerHTML = rows.map((t) =>
        `<tr style="${!t.has_live ? 'opacity:.5' : ''}">
          <td class="r">${t.live_rank ?? '<span class="muted">—</span>'}</td>
          <td class="r"><strong>${t.team_number}</strong></td>
          <td>${esc((t.team_name || '').slice(0, 18))}</td>
          <td class="r">${t.gp ?? '<span class="muted">—</span>'}</td>
          <td class="r">${t.pre_opr != null ? t.pre_opr : '<span class="muted">—</span>'}</td>
          <td class="r">${t.live_opr != null ? `<strong>${t.live_opr}</strong>` : '<span class="muted">—</span>'}</td>
          <td class="r">${deltaHtml(t.delta)}</td>
          <td class="r">${t.trc_npopr != null ? t.trc_npopr : '<span class="muted">—</span>'}</td>
          <td style="text-align:center">${trendHtml(t)}</td>
        </tr>`
      ).join('');
      tbl.querySelectorAll('thead th[data-k]').forEach((th) => th.onclick = () => {
        const k = th.dataset.k;
        if (k === stKey) stAsc = !stAsc; else { stKey = k; stAsc = k === 'team_name'; }
        drawTable();
      });
    };
    drawTable();

    // Min GP filter buttons
    [[0,'mgp0'],[2,'mgp2'],[4,'mgp4']].forEach(([v, id]) => {
      const btn = document.getElementById(id);
      const refresh = () => { minGp = v; drawTable(); [[0,'mgp0'],[2,'mgp2'],[4,'mgp4']].forEach(([, bid]) => { const b = document.getElementById(bid); if (b) b.style.background = bid === id ? 'var(--accent2)' : ''; if (b) b.style.color = bid === id ? '#06283d' : ''; }); };
      btn.onclick = refresh;
    });
    document.getElementById('mgp0').click();   // set initial active state

    // ── Chart dot tooltips ──
    const teamInfoMap = {};
    perf.items.forEach((t) => { teamInfoMap[t.team_number] = t; });

    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;display:none;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px;pointer-events:none;z-index:200;box-shadow:0 4px 20px rgba(0,0,0,.5);min-width:170px;max-width:220px';
    view.appendChild(tip);

    box.querySelectorAll('svg').forEach((svg) => {
      svg.addEventListener('click', (e) => {
        const dot = e.target.classList.contains('dot-hit') ? e.target : null;
        if (!dot) { tip.style.display = 'none'; return; }
        e.stopPropagation();
        const team  = Number(dot.dataset.team);
        const matchN = dot.dataset.n;
        const score  = dot.dataset.s;
        const color  = dot.dataset.color;
        const info   = teamInfoMap[team] || {};
        const name   = (info.team_name || '').slice(0, 20);
        tip.innerHTML =
          `<div style="color:${color};font-weight:700;font-size:14px">${team}${name ? ` <span style="font-weight:400;font-size:12px;color:var(--muted)">${esc(name)}</span>` : ''}</div>` +
          `<div style="margin-top:5px">Q${matchN} · Alliance score <strong>${score}</strong></div>` +
          (info.live_rank != null ? `<div style="font-size:12px;color:var(--muted)">Rank #${info.live_rank} · ${info.gp ?? 0} GP</div>` : '') +
          `<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--line)">` +
          (info.live_opr  != null ? `<div>Live OPR <strong>${fmt(info.live_opr)}</strong>${info.delta != null ? ` <span style="color:${info.delta > 5 ? 'var(--good)' : info.delta < -5 ? 'var(--bad)' : 'var(--muted)'}">(${info.delta > 0 ? '+' : ''}${fmt(info.delta)})</span>` : ''}</div>` : '') +
          (info.trc_npopr != null ? `<div>TRC npOPR <strong>${fmt(info.trc_npopr)}</strong></div>` : '') +
          `</div>`;
        // Position above the dot, clamped to viewport
        tip.style.display = 'block';
        const svgRect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const cx = parseFloat(dot.getAttribute('cx'));
        const cy = parseFloat(dot.getAttribute('cy'));
        const dotX = svgRect.left + (cx / vb.width)  * svgRect.width;
        const dotY = svgRect.top  + (cy / vb.height) * svgRect.height;
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let tx = dotX - tw / 2;
        let ty = dotY - th - 16;
        if (ty < 8) ty = dotY + 20;
        tx = Math.max(8, Math.min(window.innerWidth - tw - 8, tx));
        tip.style.left = tx + 'px';
        tip.style.top  = ty + 'px';
      });
    });
    // Tap anywhere outside a dot to dismiss
    document.addEventListener('click', (e) => {
      if (!e.target.classList.contains('dot-hit')) tip.style.display = 'none';
    });

  } catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; }
}

// ─────────── teams: lookup + drive-team report ───────────
function renderTeams() {
  const teams = (state.bundle.teams || []).slice();
  const pre = {}; (state.bundle.preevent_stats || []).forEach((p) => { pre[p.team_number] = p.np_opr; });
  teams.sort((a, b) => a.team_number - b.team_number);   // numerical order
  view.innerHTML = `<h2>Teams</h2>
    <input id="teamSearch" placeholder="Search team # or name" autocapitalize="off" />
    <div id="teamList" style="margin-top:10px"></div>`;
  const list = $('#teamList');
  const draw = (filter = '') => {
    const f = filter.toLowerCase();
    list.innerHTML = '';
    teams.filter((t) => !t.did_not_show && (!f || String(t.team_number).includes(f) || (t.team_name || '').toLowerCase().includes(f))).forEach((t) => {
      const np = pre[t.team_number];
      const d = document.createElement('div'); d.className = 'list-item';
      d.innerHTML = `<div><strong>${t.team_number}</strong> <span class="muted">${esc((t.team_name || '').slice(0, 24))}</span></div>
        <div class="row" style="gap:6px;flex-shrink:0">
          ${np != null ? `<span class="pill">${Math.round(np)} npOPR</span>` : ''}
          <button class="pri-star ${t.match_priority ? 'on' : ''}" style="width:auto;font-size:12px;padding:4px 7px;border-radius:6px;border:1px solid var(--line);background:${t.match_priority ? 'var(--accent)' : 'transparent'};color:${t.match_priority ? '#06283d' : 'var(--muted)'};cursor:pointer;white-space:nowrap;min-height:0">${t.match_priority ? '⭐' : '☆'} Scout</button>
          <button class="wl-btn ${t.watchlist ? 'on' : ''}" style="width:auto;font-size:12px;padding:4px 7px;border-radius:6px;border:1px solid var(--line);background:${t.watchlist ? 'var(--accent)' : 'transparent'};color:${t.watchlist ? '#06283d' : 'var(--muted)'};cursor:pointer;white-space:nowrap;min-height:0">${t.watchlist ? '★' : '☆'} Watch</button>
        </div>`;
      const priBtn = d.querySelector('.pri-star');
      const star   = d.querySelector('.wl-btn');
      const refreshBtns = () => {
        const mp = !!t.match_priority, wl = !!t.watchlist;
        priBtn.classList.toggle('on', mp);
        priBtn.innerHTML = (mp ? '⭐' : '☆') + ' Scout';
        priBtn.style.background = mp ? 'var(--accent)' : 'transparent';
        priBtn.style.color      = mp ? '#06283d' : 'var(--muted)';
        star.classList.toggle('on', wl);
        star.innerHTML = (wl ? '★' : '☆') + ' Watch';
        star.style.background = wl ? 'var(--accent)' : 'transparent';
        star.style.color      = wl ? '#06283d' : 'var(--muted)';
      };
      priBtn.onclick = async (e) => {
        e.stopPropagation();
        await togglePriority(t.team_number, 'match_priority', !t.match_priority);
        refreshBtns();
      };
      star.onclick = async (e) => {
        e.stopPropagation();
        await togglePriority(t.team_number, 'watchlist', !t.watchlist);
        refreshBtns();
      };
      d.onclick = () => renderTeamReport(t.team_number);
      list.appendChild(d);
    });
  };
  draw();
  $('#teamSearch').oninput = () => draw($('#teamSearch').value);
}

async function renderTeamReport(team) {
  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Teams</button>
    <h2 style="margin-top:10px">Team ${team}</h2><div class="muted">${esc(teamName(team) || '')}</div>
    <div id="rpt"><p class="muted">Loading…</p></div>`;
  $('#back').onclick = () => renderTeams();
  const rpt = $('#rpt');
  // Uses the last cached report when offline; if none, falls back to the bundle's projection.
  await computeSoS();
  try {
    rpt.innerHTML = reportHtml(await mergeLocalMessages(await mergeLocalPit(await api.teamReport(state.bundle.event.id, team), team), team));
  } catch (e) {
    const pb = (state.bundle.preevent_stats || []).find((p) => p.team_number === team);
    const stub = { team_number: team, team_name: teamName(team), pre_event: pb ? { np_opr: pb.np_opr, opr: pb.stats?.opr || {}, avg: pb.stats?.avg || null } : null, live: null, match: null, pit: { report_count: 0, consolidated: {}, reports: [] }, observations: [], messages: [] };
    rpt.innerHTML = reportHtml(await mergeLocalMessages(await mergeLocalPit(stub, team), team)) + '<p class="muted" style="font-size:12px">Offline — server pit/match details will load when reconnected.</p>';
  }
  wireMhRows(rpt);
}

// ─────────── watchlist: alliance-partner shortlist (Far vs Goal columns) ───────────
// Teams tagged on the Teams page show here. Drag (by the grip) to sort each team into
// the Far Partner / Goal Partner column and order by preference (top = best). The
// layout is persisted locally and pushed to the cloud so every scouter shares it.
function renderWatchlist() {
  const watched = (state.bundle.teams || []).filter((t) => t.watchlist);
  view.innerHTML = `<h2>Watchlist</h2>
    <p class="muted">Drag the grip <span style="color:var(--text)">⠿</span> to move teams between columns and reorder by preference (top = best). Tap a team card to see its full scouting report below. Saved to the cloud for everyone.</p>
    <div id="wlWrap"></div>
    <div id="wlReport"></div>`;
  const wrap = $('#wlWrap');
  if (!watched.length) {
    wrap.innerHTML = `<div class="card"><p class="muted">No teams on the watchlist yet. Open the <strong>Teams</strong> tab and tap ☆ next to a team to add it.</p></div>`;
    return;
  }
  // group by column, ordered by saved rank (un-ranked fall to the end by team #)
  const byCol = { '': [], far: [], goal: [], utility: [] };
  watched.forEach((t) => { const c = (t.watch_column === 'far' || t.watch_column === 'goal' || t.watch_column === 'utility') ? t.watch_column : ''; byCol[c].push(t); });
  Object.values(byCol).forEach((arr) => arr.sort((a, b) => {
    const ra = a.watch_rank, rb = b.watch_rank;
    if (ra == null && rb == null) return a.team_number - b.team_number;
    if (ra == null) return 1; if (rb == null) return -1; return ra - rb;
  }));

  const card = (t) => `<div class="wl-card" data-team="${t.team_number}">
      <span class="wl-grip" title="Drag to move / reorder">⠿</span>
      <div class="wl-meta"><strong>${t.team_number}</strong> <span class="muted">${esc((t.team_name || '').slice(0, 18))}</span></div>
      <button class="wl-x" data-team="${t.team_number}" title="Remove from watchlist">✕</button>
    </div>`;
  const zone = (colKey, title, hint) => `<div class="wl-zone" data-col="${colKey}">
      <div class="wl-zone-h">${title}${hint ? ` <span class="muted" style="font-weight:400;font-size:12px">${hint}</span>` : ''}</div>
      <div class="wl-list" data-col="${colKey}">${byCol[colKey].map(card).join('')}</div>
    </div>`;
  wrap.innerHTML = `
    ${zone('', 'Unassigned', '— drag into a column')}
    <div class="wl-cols">
      ${zone('far', 'Far Partner')}
      ${zone('goal', 'Goal Partner')}
      ${zone('utility', 'Utility Partner')}
    </div>`;

  // read the current DOM order into a {unassigned,far,goal} layout
  const readLayout = () => {
    const grab = (col) => [...wrap.querySelectorAll(`.wl-list[data-col="${col}"] .wl-card`)].map((c) => Number(c.dataset.team));
    return { unassigned: grab(''), far: grab('far'), goal: grab('goal'), utility: grab('utility') };
  };
  // persist: update the local bundle (offline) + push to the cloud (shared)
  const persist = async () => {
    const layout = readLayout();
    const apply = (nums, col) => nums.forEach((tn, i) => { const t = state.bundle.teams.find((x) => Number(x.team_number) === tn); if (t) { t.watchlist = true; t.watch_column = col; t.watch_rank = i; } });
    apply(layout.unassigned, null); apply(layout.far, 'far'); apply(layout.goal, 'goal'); apply(layout.utility || [], 'utility');
    await db.bundlePut(state.bundle);
    if (api.online()) { try { await api.saveWatchlist(state.bundle.event.id, layout); } catch (e) { toast(e.message); } }
    else toast('Saved on this device — connect to share it');
  };

  // remove from watchlist
  $$('.wl-x', wrap).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    await togglePriority(Number(b.dataset.team), 'watchlist', false);
    renderWatchlist();
  });

  wireWatchlistDnD(wrap, persist);

  // tap a card body (not the grip or ✕) to load that team's full scouting report below
  $$('.wl-card', wrap).forEach((card) => card.addEventListener('click', async (e) => {
    if (e.target.closest('.wl-grip') || e.target.closest('.wl-x')) return;
    closeLb();
    const team = Number(card.dataset.team);
    $$('.wl-card', wrap).forEach((c) => c.classList.remove('wl-selected'));
    card.classList.add('wl-selected');
    const rptEl = $('#wlReport');
    rptEl.innerHTML = `<h3 style="margin-bottom:6px">Team ${team} — ${esc(teamName(team) || '')}</h3><p class="muted">Loading…</p>`;
    rptEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await computeSoS();
    try {
      rptEl.innerHTML = `<h3 style="margin-bottom:6px">Team ${team} — ${esc(teamName(team) || '')}</h3>` +
        reportHtml(await mergeLocalMessages(await mergeLocalPit(await api.teamReport(state.bundle.event.id, team), team), team));
    } catch (e2) {
      const pb = (state.bundle.preevent_stats || []).find((p) => p.team_number === team);
      const stub = { team_number: team, team_name: teamName(team), pre_event: pb ? { np_opr: pb.np_opr, opr: pb.stats?.opr || {}, avg: pb.stats?.avg || null } : null, live: null, match: null, pit: { report_count: 0, consolidated: {}, reports: [] }, observations: [], messages: [] };
      rptEl.innerHTML = `<h3 style="margin-bottom:6px">Team ${team} — ${esc(teamName(team) || '')}</h3>` +
        reportHtml(await mergeLocalMessages(await mergeLocalPit(stub, team), team)) +
        '<p class="muted" style="font-size:12px">Offline — server details will load when reconnected.</p>';
    }
    wireMhRows(rptEl);
  }));
}

// Pointer-based drag-and-drop (works with mouse AND touch — native HTML5 DnD doesn't
// fire on touch). Drag a card by its grip: a floating clone follows the pointer while
// the real (dimmed) card is reordered live into the column under the pointer. The real
// card is never hidden (display:none would break the gesture), only dimmed.
// The move/up listeners live on `window` for the duration of the drag — NOT on the grip
// — so they keep firing even after the pointer leaves the grip (e.g. jumping to a far
// column). Relying on the grip + setPointerCapture was the bug that let you reorder
// within a box but not drag across to another one. Drop targets are whole .wl-zones
// (header/padding included), so empty columns are easy to hit. onDrop() persists.
function wireWatchlistDnD(root, onDrop) {
  let drag = null;
  const onMove = (e) => {
    if (!drag) return;
    drag.clone.style.left = (e.clientX - drag.dx) + 'px';
    drag.clone.style.top = (e.clientY - drag.dy) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY);   // clone is pointer-events:none, so it's skipped
    const zone = el && el.closest('.wl-zone'); if (!zone) return;
    const list = zone.querySelector('.wl-list'); if (!list) return;
    const others = [...list.querySelectorAll('.wl-card')].filter((c) => c !== drag.cardEl);
    let before = null;
    for (const c of others) { const cr = c.getBoundingClientRect(); if (e.clientY < cr.top + cr.height / 2) { before = c; break; } }
    if (before) list.insertBefore(drag.cardEl, before); else list.appendChild(drag.cardEl);   // live reorder
    e.preventDefault();
  };
  const onUp = () => {
    if (!drag) return;
    drag.cardEl.classList.remove('wl-ghost'); drag.clone.remove();
    document.body.classList.remove('wl-dragging');
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    onDrop();
  };
  $$('.wl-grip', root).forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      const cardEl = grip.closest('.wl-card'); if (!cardEl) return;
      const r = cardEl.getBoundingClientRect();
      const clone = cardEl.cloneNode(true); clone.classList.add('wl-drag');
      clone.style.width = r.width + 'px'; clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
      document.body.appendChild(clone);
      cardEl.classList.add('wl-ghost');                 // dim in place — acts as its own placeholder
      document.body.classList.add('wl-dragging');        // suppress text selection / touch scroll during the drag
      drag = { cardEl, clone, dx: e.clientX - r.left, dy: e.clientY - r.top };
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });
  });
}

// Merge this device's not-yet-uploaded pit reports into a team report, so your own
// scouting shows on the Team page even before it syncs (matches the Pit list).
async function mergeLocalPit(r, team) {
  const local = (await db.queuePending()).filter((x) => x.kind === 'pit' && x.event_id === state.bundle.event.id && Number(x.team_number) === Number(team));
  r.pit = r.pit || { report_count: 0, consolidated: {}, reports: [] };
  const have = new Set((r.pit.reports || []).map((p) => p.client_uuid));
  const add = local.filter((p) => !have.has(p.client_uuid)).map((p) => ({ client_uuid: p.client_uuid, scouter_name: (p.scouter_name || 'you') + ' (unsynced)', robot_nickname: p.robot_nickname, payload: p.payload, is_ignored: false, created_at: p.client_ts || p.queued_at }));
  if (!add.length) return r;
  r.pit.reports = [...(r.pit.reports || []), ...add];
  r.pit.report_count = (r.pit.report_count || 0) + add.length;
  // recompute the consolidated field-value tally across all (non-ignored) reports
  const tally = {};
  for (const rep of r.pit.reports) {
    if (rep.is_ignored) continue;
    for (const [k, v] of Object.entries(rep.payload || {})) {
      if (k === 'message') continue;   // free-text color note — shown in Messages, not as a pit field
      const vs = Array.isArray(v) ? v.join(', ') : String(v);
      if (vs === '') continue;
      (tally[k] = tally[k] || {})[vs] = (tally[k][vs] || 0) + 1;
    }
  }
  r.pit.consolidated = {};
  for (const [k, vals] of Object.entries(tally)) r.pit.consolidated[k] = Object.entries(vals).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  return r;
}

// Merge this device's not-yet-uploaded scouter messages (pit + match) into a team
// report's Messages section, so your own color notes show before they sync.
async function mergeLocalMessages(r, team) {
  r.messages = r.messages || [];
  const have = new Set(r.messages.map((m) => m.client_uuid).filter(Boolean));
  const pending = await db.queuePending();
  const add = [];
  pending.filter((x) => x.kind === 'pit' && x.event_id === state.bundle.event.id && Number(x.team_number) === Number(team))
    .forEach((x) => { const t = (x.payload && x.payload.message || '').trim(); if (t && !have.has(x.client_uuid)) add.push({ source: 'Pit Scouting', match_num: null, scouter: ((x.scouter_name || 'you') + ' (unsynced)'), text: t, client_uuid: x.client_uuid }); });
  pending.filter((x) => x.kind === 'match' && x.event_id === state.bundle.event.id && Number(x.scouted_team_number) === Number(team))
    .forEach((x) => { const t = (x.payload && x.payload.message || '').trim(); if (t && !have.has(x.client_uuid)) add.push({ source: 'Match ' + Number(x.match_num), match_num: Number(x.match_num), scouter: ((x.scouter_name || 'you') + ' (unsynced)'), text: t, client_uuid: x.client_uuid }); });
  if (!add.length) return r;
  r.messages = [...r.messages, ...add].sort((a, b) => (a.match_num ?? -1) - (b.match_num ?? -1));
  return r;
}

const fmt = (x, d = 1) => (x == null ? '—' : (typeof x === 'number' ? x.toFixed(d) : x));
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const distLine = (label, dist) => (!dist || !Object.keys(dist).length) ? '' :
  `<div class="row spread"><span>${label}</span><strong>${Object.entries(dist).map(([k, v]) => esc(k) + ':' + v).join(', ')}</strong></div>`;

function reportHtml(r) {
  const opr = r.pre_event?.opr || {};
  const profilePhoto = (r.photos || []).find((p) => p.is_profile);
  const sos = _sosCache;
  const sosOppOpr = sos?.opr?.[r.team_number];
  const sosRk     = sos?.rank?.[r.team_number];
  const sosTotal  = sos?.total;
  let h = profilePhoto ? `<img src="${esc(profilePhoto.url)}" class="rp-profile-banner rp-lightbox" alt="Robot photo for team ${r.team_number}" style="cursor:pointer" />` : '';
  h += `<div class="card"><div class="phase-title">Projection vs Live</div>
    <div class="row spread"><span>Pre-event npOPR</span><strong>${fmt(r.pre_event?.np_opr)}</strong></div>`;
  if (r.live) {
    const d = r.live.delta;
    const color = d == null ? 'text' : d > 5 ? 'good' : d < -5 ? 'bad' : 'text';
    const tag = d == null ? '' : d > 5 ? '▲ riser' : d < -5 ? '▼ struggling' : 'on track';
    h += `<div class="row spread"><span>Live OPR (rank ${r.live.rank ?? '—'})</span><strong>${fmt(r.live.opr_total)}</strong></div>
      <div class="row spread"><span>Delta</span><strong style="color:var(--${color})">${d == null ? '—' : (d > 0 ? '+' : '') + d} ${tag}</strong></div>`;
  }
  if (sosOppOpr != null) {
    h += `<div class="row spread"><span>SoS rank</span><strong>${sosRk}${sosTotal ? ' / ' + sosTotal : ''}</strong></div>
      <div class="row spread"><span>Opponent OPR</span><strong>${Math.round(sosOppOpr)}</strong></div>`;
  }
  h += `</div>`;
  if (r.pre_event) h += `<div class="card"><div class="phase-title">Pre-event breakdown (OPR est.)</div>
    <div class="row spread"><span>Auto pts</span><strong>${fmt(opr.autoPoints)}</strong></div>
    <div class="row spread"><span>Teleop pts</span><strong>${fmt(opr.dcPoints)}</strong></div>
    <div class="row spread"><span>Penalties drawn</span><strong>${fmt(opr.penaltyPointsByOpp)}</strong></div>
    <div class="row spread"><span>Penalties given</span><strong>${fmt(opr.penaltyPointsCommitted)}</strong></div>
    <p class="muted" style="margin:6px 0 0;font-size:12px">OPR is relative to the field; negatives = fewer than average.</p></div>`;
  if (r.match) {
    const m = r.match;
    // ── TRC point projections ──────────────────────────────────────────────
    const autoPts   = (m.auto_avg_made   || 0) * 3;
    const telepPts  = (m.teleop_avg_made || 0) * 3;
    const leavePts  = (1 - (m.did_not_move_rate || 0)) * 3;
    let   parkPts   = 0;
    if (m.park_distribution && m.records) {
      Object.entries(m.park_distribution).forEach(([k, v]) => {
        const kl = k.toLowerCase();
        // no_park_scoring_foul = fouled while trying to park, chose to score instead; counts as full park credit
        const p  = (kl.includes('full') || kl.includes('foul')) ? 10 : kl.includes('partial') ? 5 : 0;
        parkPts += (v / m.records) * p;
      });
    }
    const majPenPts = (m.avg_major_penalties || 0) * 15;
    const minPenPts = (m.avg_minor_penalties || 0) * 5;
    const trcOpr    = autoPts + leavePts + telepPts + parkPts - majPenPts - minPenPts;
    // ──────────────────────────────────────────────────────────────────────
    h += `<div class="card"><div class="phase-title">Match scouting — ${m.records} match${m.records > 1 ? 'es' : ''}</div>
      <div class="muted" style="font-size:11px;margin:-2px 0 8px">Made = avg per match (weighted by scouting confidence) · Accuracy = makes ÷ attempts across all ${m.records} match${m.records > 1 ? 'es' : ''} · Penalties = avg/match · Didn't move/failure = % of matches</div>
      <div class="row spread"><span>Auto avg made / accuracy</span><strong>${fmt(m.auto_avg_made)} · ${pct(m.auto_accuracy)} · ${fmt(autoPts)} pts</strong></div>
      <div class="row spread" style="font-size:12px;color:var(--muted)"><span style="padding-left:12px">↳ Close made / acc</span><span>${fmt(m.auto_close_made)} · ${pct(m.auto_close_accuracy)}</span></div>
      <div class="row spread" style="font-size:12px;color:var(--muted)"><span style="padding-left:12px">↳ Far made / acc</span><span>${fmt(m.auto_far_made)} · ${pct(m.auto_far_accuracy)}</span></div>
      <div class="row spread"><span>Teleop avg made / accuracy</span><strong>${fmt(m.teleop_avg_made)} · ${pct(m.teleop_accuracy)} · ${fmt(telepPts)} pts</strong></div>
      <div class="row spread" style="font-size:12px;color:var(--muted)"><span style="padding-left:12px">↳ Close made / acc</span><span>${fmt(m.teleop_close_made)} · ${pct(m.teleop_close_accuracy)}</span></div>
      <div class="row spread" style="font-size:12px;color:var(--muted)"><span style="padding-left:12px">↳ Far made / acc</span><span>${fmt(m.teleop_far_made)} · ${pct(m.teleop_far_accuracy)}</span></div>
      <div class="row spread"><span>Avg penalties maj/min</span><strong>${fmt(m.avg_major_penalties)} / ${fmt(m.avg_minor_penalties)}</strong></div>
      <div class="row spread"><span>Didn't move / failure</span><strong>${pct(m.did_not_move_rate)} / ${pct(m.major_failure_rate)}</strong></div>
      ${distLine('Leave bonus', { 'avg': fmt(leavePts) + ' pts' })}
      ${distLine('Endgame', m.park_distribution)}${distLine('Penalties', m.penalty_distribution)}
      <div style="border-top:1px solid var(--line);margin:8px 0"></div>
      <div class="row spread"><span><strong>TRC OPR</strong> <span class="muted" style="font-size:11px">(auto + leave + teleop + park − penalties)</span></span><strong style="color:var(--accent);font-size:16px">${fmt(trcOpr)}</strong></div>
      <div class="row spread" style="font-size:11px;color:var(--muted)">
        <span>Auto ${fmt(autoPts)} + Leave ${fmt(leavePts)} + Teleop ${fmt(telepPts)} + Park ${fmt(parkPts)} − Pen ${fmt(majPenPts + minPenPts)}</span>
      </div>
      <div class="row spread" style="margin-top:4px"><span><strong>TRC npOPR</strong> <span class="muted" style="font-size:11px">(without penalties)</span></span><strong style="color:var(--accent);font-size:16px">${fmt(autoPts + leavePts + telepPts + parkPts)}</strong></div>
      </div>`;
  } else h += `<div class="card"><div class="phase-title">Match scouting</div><p class="muted">No match data yet.</p></div>`;
  if (r.match_history && r.match_history.length) {
    const lvlPrefix = (row) => row.tournament_level && row.tournament_level !== 'Quals' ? 'P' : 'Q';
    const confColor = { low: 'var(--muted)', medium: 'var(--text)', high: 'var(--good)', very_high: 'var(--good)' };
    const mhId = 'mh_' + r.team_number;
    h += `<div class="card"><div class="phase-title">Match-by-match breakdown</div>
      <div class="mh-scroll"><table class="dt mh-tbl" id="${mhId}">
        <thead><tr>
          <th>M#</th><th>Score</th><th>Ally</th><th>Partners</th>
          <th class="r">Auto</th><th class="r">Teleop</th>
          <th class="r">Pen M/m</th><th>Park</th>
          <th>Scouter</th>
        </tr></thead>
        <tbody>${r.match_history.map((mh, idx) => {
          const allyClr = mh.alliance === 'Red' ? 'var(--bad)' : mh.alliance === 'Blue' ? 'var(--accent)' : 'var(--text)';
          const noShow = !mh.showed_up;
          const autoCell = noShow ? '<em class="muted">no-show</em>' : `${mh.auto_made}${mh.auto_att ? ' <span class="muted">('+pct(mh.auto_acc)+')</span>' : ''}`;
          const teloCell = noShow ? '' : `${mh.teleop_made}${mh.teleop_att ? ' <span class="muted">('+pct(mh.teleop_acc)+')</span>' : ''}`;
          const penCell  = (mh.major_penalties || mh.minor_penalties) ? `${mh.major_penalties}/${mh.minor_penalties}` : '—';
          // Score: show Red–Blue with the team's alliance score bolded
          let scoreCell = '—';
          if (mh.has_been_played && mh.red_score != null && mh.blue_score != null) {
            const rs = mh.red_score, bs = mh.blue_score;
            const won = mh.alliance === 'Red' ? rs > bs : mh.alliance === 'Blue' ? bs > rs : null;
            const winClr = won === true ? 'var(--good)' : won === false ? 'var(--bad)' : 'var(--text)';
            if (mh.alliance === 'Red') {
              scoreCell = `<span style="color:var(--bad);font-weight:700">${rs}</span><span class="muted">–</span>${bs}`;
            } else if (mh.alliance === 'Blue') {
              scoreCell = `${rs}<span class="muted">–</span><span style="color:var(--accent);font-weight:700">${bs}</span>`;
            } else {
              scoreCell = `${rs}–${bs}`;
            }
            if (won != null) scoreCell += `<span style="font-size:10px;color:${winClr};display:block">${won ? 'W' : 'L'}</span>`;
          }
          // Expandable scout report details
          const detId = `${mhId}_d${idx}`;
          const flags = [
            mh.did_not_move  ? '⚠ no-move'   : '',
            mh.major_failure ? '⚠ failure'   : '',
            !mh.whole_match  ? '(partial)'   : '',
          ].filter(Boolean).join(' ');
          const detailRows = [
            mh.message ? `<tr><td colspan="9" style="font-size:12px;padding-left:20px;color:var(--text);white-space:normal;word-break:break-word">💬 ${esc(mh.message)}</td></tr>` : '',
            flags      ? `<tr><td colspan="9" style="font-size:12px;padding-left:20px;color:var(--warn);white-space:normal">${esc(flags)}</td></tr>` : '',
            `<tr><td colspan="9" style="font-size:11px;padding-left:20px;color:var(--muted);white-space:normal">` +
              `Confidence: ${esc(mh.confidence || '—')} · Scouted by: ${esc(mh.scouter_name || '?')} · ` +
              `Auto close/far: ${mh.auto_close_made}/${mh.auto_far_made} · Teleop close/far: ${mh.teleop_close_made}/${mh.teleop_far_made}` +
            `</td></tr>`,
          ].filter(Boolean).join('');
          return `<tr class="mh-row" data-det="${detId}" style="cursor:pointer">
            <td><strong>${lvlPrefix(mh)}${mh.match_num}</strong> <span style="font-size:10px;color:var(--muted)">▶</span></td>
            <td style="font-size:12px;white-space:nowrap">${scoreCell}</td>
            <td style="color:${allyClr};font-weight:700">${esc(mh.alliance ? mh.alliance[0] : '?')}</td>
            <td style="font-size:12px">${mh.partners.length ? mh.partners.map(String).map(esc).join(', ') : '<span class="muted">—</span>'}</td>
            <td class="r">${autoCell}</td>
            <td class="r">${teloCell}</td>
            <td class="r">${penCell}</td>
            <td style="font-size:12px">${mh.park ? esc(mh.park.replace(/_/g, ' ')) : '—'}</td>
            <td style="font-size:11px;color:${confColor[mh.confidence] || 'var(--text)'}">${esc(mh.scouter_name || '?')}</td>
          </tr>
          <tr id="${detId}" hidden class="mh-detail">${detailRows}</tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:11px;margin-top:6px">Tap a row to expand the full scout report · Auto/Teleop = made (accuracy) · Pen = major/minor · W/L = win/loss</p>
    </div>`;
  }
  const allPhotos = r.photos || [];
  if (r.pit && r.pit.report_count) {
    const c = r.pit.consolidated, keys = Object.keys(c);
    h += `<div class="card"><div class="phase-title">Pit — ${r.pit.report_count} report${r.pit.report_count > 1 ? 's' : ''}</div>`;
    const humanVal = (v) => v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
    h += keys.length ? keys.map((k) => {
      const vals = c[k], disagree = vals.length > 1;
      return `<div class="row spread"><span>${esc(k)}</span><strong style="${disagree ? 'color:var(--warn)' : ''}">${vals.map((v) => esc(humanVal(v.value)) + (v.count > 1 ? ` (${v.count})` : '')).join(' / ')}</strong></div>`;
    }).join('') : '<p class="muted">No structured pit fields.</p>';
    if (allPhotos.length) h += `<div class="rp-grid rp-grid-sm">${allPhotos.map((p) => `<div class="rp-thumb${p.is_profile ? ' rp-profile' : ''}"><img class="rp-lightbox" src="${esc(p.url)}" alt="Robot photo" />${p.is_profile ? '<span class="rp-star">★</span>' : ''}</div>`).join('')}</div>`;
    h += `</div>`;
  } else h += `<div class="card"><div class="phase-title">Pit</div><p class="muted">Not pit-scouted yet.</p></div>`;
  if (r.observations && r.observations.length) {
    h += `<div class="card"><div class="phase-title">Observations</div>`;
    h += r.observations.map((o) => `<div style="margin-bottom:10px"><div>${esc(o.observation)}</div><div class="muted" style="font-size:12px">${(o.tags || []).map((t) => '#' + esc(t)).join(' ')}${o.match_num ? ' · M' + o.match_num : ''}${o.scouter_name ? ' · ' + esc(o.scouter_name) : ''}</div></div>`).join('');
    h += `</div>`;
  }
  if (r.messages && r.messages.length) {
    h += `<div class="card"><div class="phase-title">Messages from Scouters</div>`;
    h += r.messages.map((m) => `<div style="margin-bottom:8px"><strong>${esc(m.source)} (${esc(m.scouter)}):</strong> ${esc(m.text)}</div>`).join('');
    h += `</div>`;
  }
  return h;
}

// ─────────── shared: segmented control (enum / bool / multiselect) ───────────
function seg(key, options, { multi = false, value = null } = {}) {
  const opts = options.map((o) => {
    const val = typeof o === 'string' ? o : o.key ?? o;
    const lbl = typeof o === 'string' ? o : (o.label ?? o.key ?? o);
    const on = multi ? (Array.isArray(value) && value.includes(val)) : value === val;
    return `<div class="opt${on ? ' on' : ''}" data-val="${esc(val)}">${esc(lbl)}</div>`;
  }).join('');
  return `<div class="seg" data-key="${esc(key)}" data-multi="${multi ? 1 : 0}">${opts}</div>`;
}

// Wire all segmented controls within root (toggle .on; respect single vs multi).
function wireSegs(root) {
  $$('.seg', root).forEach((s) => {
    const multi = s.dataset.multi === '1';
    $$('.opt', s).forEach((o) => o.onclick = () => {
      if (multi) o.classList.toggle('on');
      else { $$('.opt', s).forEach((x) => x.classList.toggle('on', x === o)); }
      applyShowIf(root);
    });
  });
}

// Attach click-to-expand handlers on match-history rows after reportHtml() is injected.
function wireMhRows(root) {
  (root || document).querySelectorAll('.mh-row').forEach((row) => {
    row.addEventListener('click', () => {
      const det = document.getElementById(row.dataset.det);
      if (!det) return;
      const open = !det.hidden;
      det.hidden = open;
      const arrow = row.querySelector('span[style*="10px"]');
      if (arrow) arrow.textContent = open ? '▶' : '▼';
    });
  });
}

// Read every [data-key] control under root into a plain object.
function readForm(root) {
  const out = {};
  $$('.seg', root).forEach((s) => {
    const key = s.dataset.key, multi = s.dataset.multi === '1';
    const chosen = $$('.opt.on', s).map((o) => o.dataset.val);
    out[key] = multi ? chosen : (chosen[0] ?? null);
  });
  $$('[data-key][data-type]', root).forEach((el) => {
    const key = el.dataset.key, type = el.dataset.type;
    let v = el.value;
    if (v === '') { out[key] = null; return; }
    if (type === 'int') v = parseInt(v, 10);
    else if (type === 'decimal') v = parseFloat(v);
    out[key] = v;
  });
  return out;
}

// Conditional fields: [data-showif="boolKey"] visible only when that seg is "on".
function applyShowIf(root) {
  $$('[data-showif]', root).forEach((wrap) => {
    const ctrl = $(`.seg[data-key="${wrap.dataset.showif}"]`, root);
    const on = ctrl && $$('.opt.on', ctrl).some((o) => ['true', 'yes', '1'].includes(o.dataset.val));
    wrap.style.display = on ? '' : 'none';
  });
}

// Render one config-driven field (used by the pit form + match setup/endgame).
function fieldHtml(f, value = null) {
  const wrap = (inner) => `<div class="field"${f.showIf ? ` data-showif="${esc(f.showIf)}"` : ''}><label>${esc(f.label)}</label>${inner}</div>`;
  switch (f.type) {
    case 'bool': return wrap(seg(f.key, [{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }], { value: value == null ? null : (value ? 'true' : 'false') }));
    case 'enum': return wrap(seg(f.key, f.options, { value }));
    case 'multiselect': return wrap(seg(f.key, f.options, { multi: true, value: value || [] }));
    case 'int': return wrap(`<input data-key="${esc(f.key)}" data-type="int" inputmode="numeric" value="${value ?? ''}" />`);
    case 'decimal': return wrap(`<input data-key="${esc(f.key)}" data-type="decimal" inputmode="decimal" value="${value ?? ''}" />`);
    default: return wrap(`<input data-key="${esc(f.key)}" data-type="text" value="${esc(value ?? '')}" />`);
  }
}

// ─────────── match scouting ───────────
function renderMatch() {
  const cfg = state.bundle.season.config.matchForm;
  const matches = state.bundle.matches || [];
  const training = !!state.bundle.event.is_training;
  const isPri = (tn) => (state.bundle.teams || []).some((x) => Number(x.team_number) === Number(tn) && x.match_priority);
  const isDns = (tn) => (state.bundle.teams || []).some((x) => Number(x.team_number) === Number(tn) && x.did_not_show);
  // Build view with DOM methods to avoid innerHTML/querySelector timing issues.
  view.innerHTML = '';
  const _h2 = document.createElement('h2'); _h2.textContent = 'Match scouting'; view.appendChild(_h2);
  if (training) {
    const _tb = document.createElement('div'); _tb.className = 'card'; _tb.style.borderColor = 'var(--accent)';
    _tb.innerHTML = '<strong>Training mode</strong> — scout the match, then tap “Score Match” to reveal the real result.';
    view.appendChild(_tb);
  }
  const _card = document.createElement('div'); _card.className = 'card'; view.appendChild(_card);
  const _teamPick = document.createElement('div'); _teamPick.id = 'teamPick';
  const _scoutForm = document.createElement('div'); _scoutForm.id = 'scoutForm';

  if (matches.length) {
    const _lbl = document.createElement('label'); _lbl.textContent = 'Match'; _card.appendChild(_lbl);
    const _fi = document.createElement('input'); _fi.id = 'matchFilter'; _fi.placeholder = 'Filter by match # or team #';
    _fi.setAttribute('autocapitalize', 'off'); _fi.style.marginBottom = '6px'; _card.appendChild(_fi);
    const listEl = document.createElement('div');
    listEl.style.cssText = 'max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:8px';
    _card.appendChild(listEl);
    view.appendChild(_card);
    const _pickCard = document.createElement('div'); _pickCard.className = 'card'; _pickCard.style.display = 'none';
    _pickCard.appendChild(_teamPick); view.appendChild(_pickCard); view.appendChild(_scoutForm);

    let selectedVal = state.nextMatchSel || null;
    // Scouted-team set for bold styling — loaded in background so rows appear immediately.
    const localScouted = new Set();
    const isScouted = (mn, tn) => tn != null && localScouted.has(`${mn}|${tn}`);

    const teamSpan = (mn, tn, color) => {
      if (!tn) return `<span style=”opacity:.4”>?</span>`;
      if (isDns(tn)) return `<span style=”opacity:.35;text-decoration:line-through”>DNS</span>`;
      const bold = isScouted(mn, tn);
      const pri = isPri(tn) ? '★' : '';
      return `<span style=”color:var(--${color});${bold ? 'font-weight:800' : 'font-weight:400'}”>${pri}${tn}</span>`;
    };

    const populateRows = (filter = '') => {
      const f = filter.toLowerCase();
      listEl.innerHTML = '';
      let anyVisible = false;
      matches.forEach((m, idx) => {
        if (f && !String(m.match_num).includes(f) && ![m.red1, m.red2, m.blue1, m.blue2].some((t) => t && String(t).includes(f))) return;
        anyVisible = true;
        const sel = idx === selectedVal;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--line);font-size:13px;' + (sel ? 'background:var(--accent);color:#06283d' : '');
        row.innerHTML = `<span style=”min-width:68px;font-weight:600;flex-shrink:0;${sel ? '' : 'color:var(--text)'}”>${esc(m.tournament_level)} ${m.match_num}</span>
          <span style=”flex:1;display:flex;gap:6px”>${teamSpan(m.match_num, m.red1, 'red')} <span style=”opacity:.4”>·</span> ${teamSpan(m.match_num, m.red2, 'red')}</span>
          <span style=”flex:1;display:flex;gap:6px”>${teamSpan(m.match_num, m.blue1, 'blue')} <span style=”opacity:.4”>·</span> ${teamSpan(m.match_num, m.blue2, 'blue')}</span>`;
        row._matchIdx = idx;
        row.onclick = () => selectMatch(idx);
        listEl.appendChild(row);
      });
      if (!anyVisible) { const d = document.createElement('div'); d.style.cssText = 'padding:12px;color:var(--muted);font-size:13px'; d.textContent = 'No matches found'; listEl.appendChild(d); }
    };

    const selectMatch = async (idx) => {
      selectedVal = idx;
      populateRows(_fi.value);
      const row = Array.from(listEl.children).find((el) => el._matchIdx === idx);
      if (row) row.scrollIntoView({ block: 'nearest' });

      if (idx == null) { _teamPick.innerHTML = ''; _pickCard.style.display = 'none'; _scoutForm.innerHTML = ''; return; }
      const m = matches[idx];
      if (!m) { toast('no match at idx=' + idx + ' matches[0]=' + (matches[0] ? matches[0].match_num : 'undef'), 10000); return; }
      const num = m.match_num; const lvl = m.tournament_level;
      // Who has scouted each robot in this match: local queue + server records.
      const scoutedBy = {};
      const add = (tn, name) => { (scoutedBy[tn] = scoutedBy[tn] || []).push(name); };
      (await db.queuePending()).filter((r) => r.kind === 'match' && r.event_id === state.bundle.event.id && Number(r.match_num) === Number(num)).forEach((r) => add(r.scouted_team_number, (r.scouter_name || state.member?.first_name || 'you') + ' (you)'));
      if (api.online()) { try { ((await api.listMatchRecords(state.bundle.event.id, num)).items || []).forEach((r) => add(r.scouted_team_number, r.scouter_name || '?')); } catch {} }
      // Per-team scouting summary.
      const sumMap = {};
      try { ((await api.teamSummaries(state.bundle.event.id)).items || []).forEach((s) => { sumMap[s.team_number] = s; }); } catch {}
      _teamPick.innerHTML = '';
      const _lbl2 = document.createElement('label'); _lbl2.textContent = 'Which robot are you scouting?'; _teamPick.appendChild(_lbl2);
      const _grid = document.createElement('div'); _grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px'; _teamPick.appendChild(_grid);
      const _redCol = document.createElement('div'); _redCol.style.cssText = 'display:flex;flex-direction:column;gap:8px'; _grid.appendChild(_redCol);
      const _blueCol = document.createElement('div'); _blueCol.style.cssText = 'display:flex;flex-direction:column;gap:8px'; _grid.appendChild(_blueCol);
      const allPicks = [];
      const makePick = (al, tn) => {
        if (!tn || isDns(tn)) return;
        const c = al === 'Red' ? 'red' : 'blue';
        const col = al === 'Red' ? _redCol : _blueCol;
        const who = scoutedBy[tn] ? [...new Set(scoutedBy[tn])].join(', ') : null;
        const s = sumMap[tn];
        const btn = document.createElement('div');
        btn.style.cssText = `border:2px solid var(--${c});border-radius:10px;padding:12px;text-align:center;cursor:pointer;color:var(--${c});font-weight:600`;
        btn.innerHTML = (isPri(tn) ? '⭐ ' : '') + tn
          + ` <span style=”font-weight:400;opacity:.8”>${esc((teamName(tn) || '').slice(0, 14))}</span>`
          + (s && s.records ? `<div style=”font-size:11px;font-weight:400;margin-top:2px;opacity:.85”>Auto ${fmt(s.auto_avg_made)} · Teleop ${fmt(s.teleop_avg_made)} <span style=”opacity:.7”>(${s.records}m)</span></div>` : '')
          + (who ? `<div style=”font-size:11px;color:var(--good);font-weight:600;margin-top:3px”>&#10003; ${esc(who.slice(0, 24))}</div>` : '');
        btn.onclick = async () => {
          allPicks.forEach((x) => { const xc = x._al === 'Red' ? 'red' : 'blue'; x.style.background = x === btn ? `var(--${xc})` : 'transparent'; x.style.color = x === btn ? '#06283d' : `var(--${xc})`; });
          const existing = await findMyMatchRecord(num, lvl, tn);
          buildScoutForm(cfg, num, lvl, tn, al, existing);
        };
        btn._al = al;
        allPicks.push(btn);
        col.appendChild(btn);
      };
      makePick('Red', m.red1); makePick('Red', m.red2);
      makePick('Blue', m.blue1); makePick('Blue', m.blue2);
      _pickCard.style.display = '';
      _pickCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (training) {
        const revealBtn = document.createElement('button');
        revealBtn.className = 'secondary'; revealBtn.style.marginTop = '10px';
        revealBtn.textContent = 'Score Match ' + num;
        const revealOut = document.createElement('div');
        revealOut.className = 'muted'; revealOut.style.marginTop = '8px';
        _teamPick.appendChild(revealBtn); _teamPick.appendChild(revealOut);
        revealBtn.onclick = async () => {
          if (!api.online()) return toast('Reveal needs the server');
          try {
            const r = await api.revealMatch(state.bundle.event.id, num, lvl);
            revealOut.innerHTML = `Actual: <span class=”pill red”>Red ${r.red_score ?? '?'}</span> <span class=”pill blue”>Blue ${r.blue_score ?? '?'}</span>`;
          } catch (e) { toast(e.message); }
        };
      }
    };

    populateRows();

    // Load scouted set in background and refresh bold styling once ready.
    db.queuePending().then((pending) => {
      pending.filter((r) => r.kind === 'match' && r.event_id === state.bundle.event.id)
             .forEach((r) => localScouted.add(`${r.match_num}|${r.scouted_team_number}`));
      if (localScouted.size) populateRows(_fi.value);
    }).catch(() => {});

    _fi.oninput = (e) => populateRows(e.target.value);

    const autoSel = state.nextMatchSel || null;
    state.nextMatchSel = null;
    if (autoSel) {
      const pipe = autoSel.indexOf('|');
      const autoNum = Number(autoSel.slice(0, pipe));
      const autoLvl = autoSel.slice(pipe + 1);
      const autoIdx = matches.findIndex((x) => x.match_num === autoNum && x.tournament_level === autoLvl);
      if (autoIdx >= 0) selectMatch(autoIdx);
    }
  } else {
    const _noSched = document.createElement('p'); _noSched.className = 'muted';
    _noSched.textContent = `No schedule loaded (bundle has ${state.bundle.matches === undefined ? 'undefined' : state.bundle.matches === null ? 'null' : state.bundle.matches.length + ' matches'}).`;
    _card.appendChild(_noSched);
    const _reloadBtn = document.createElement('button'); _reloadBtn.className = 'secondary'; _reloadBtn.textContent = 'Re-download bundle'; _reloadBtn.style.marginBottom = '10px';
    _reloadBtn.onclick = () => downloadBundle(state.bundle.event.id);
    _card.appendChild(_reloadBtn);
    const _lblMn = document.createElement('label'); _lblMn.textContent = 'Match #'; _card.appendChild(_lblMn);
    const _matchNum = document.createElement('input'); _matchNum.id = 'matchNum'; _matchNum.setAttribute('data-type', 'int'); _matchNum.setAttribute('inputmode', 'numeric'); _card.appendChild(_matchNum);
    _card.appendChild(_teamPick); view.appendChild(_card); view.appendChild(_scoutForm);
    _teamPick.innerHTML = `<label>Team # to scout</label><input id=”teamNum” data-type=”int” inputmode=”numeric” /><div class=”row” style=”margin-top:10px”><div class=”opt seg-alliance” data-al=”Red” style=”flex:1;text-align:center;padding:12px;border:1px solid var(--line);border-radius:10px”>Red</div><div class=”opt seg-alliance” data-al=”Blue” style=”flex:1;text-align:center;padding:12px;border:1px solid var(--line);border-radius:10px”>Blue</div></div><button class=”secondary” id=”startManual” style=”margin-top:10px”>Start scouting</button>`;
    let al = null; $$('.seg-alliance').forEach((o) => o.onclick = () => { al = o.dataset.al; $$('.seg-alliance').forEach((x) => x.classList.toggle('on', x === o)); });
    $('#startManual').onclick = async () => {
      const tn = parseInt($('#teamNum').value, 10); const mn = parseInt(_matchNum.value, 10);
      if (!tn || !mn) return toast('Enter match # and team #');
      buildScoutForm(cfg, mn, 'Quals', tn, al, await findMyMatchRecord(mn, 'Quals', tn));
    };
  }
}

// counts holder for the tap grids; keyed phase.button
function tapGrid(phase, cfg, counts) {
  const g = cfg.scoringGrid;
  const cell = (b) => {
    const k = `${phase}.${b.key}`; counts[k] = counts[k] || 0;
    const kind = b.key.toLowerCase().includes('miss') ? 'miss' : 'make';
    return `<div class="tap ${kind}" data-inc="${k}"><div class="minus" data-dec="${k}">−</div><div class="count" id="c_${phase}_${b.key}">0</div><div class="lbl">${esc(b.label)}</div></div>`;
  };
  // order: top-right, top-left, bottom-right, bottom-left → grid rows
  const byCorner = (c) => g.buttons.find((b) => b.corner === c);
  const order = [byCorner('top-left'), byCorner('top-right'), byCorner('bottom-left'), byCorner('bottom-right')].filter(Boolean);
  return `<div class="grid4">${order.map(cell).join('')}</div>
    <div class="counter center-btn">
      <button class="secondary" style="width:48px;height:48px;padding:0;font-size:22px" data-dec="${phase}.${g.center.key}">−</button>
      <div class="val" style="font-size:16px">${esc(g.center.label)} · <span id="c_${phase}_${g.center.key}">0</span></div>
      <button class="secondary" style="width:48px;height:48px;padding:0;font-size:22px" data-inc="${phase}.${g.center.key}">+</button>
    </div>`;
}

function counterRow(phase, key, label, counts) {
  const k = `${phase}.${key}`; counts[k] = counts[k] || 0;
  return `<label>${esc(label)}</label><div class="counter"><button class="secondary" data-dec="${k}">−</button><div class="val" id="c_${phase}_${key}">0</div><button class="secondary" data-inc="${k}">+</button></div>`;
}

// Find this device's saved record for a match+team (synced or not), so re-opening
// the form loads the prior entry for editing.
async function findMyMatchRecord(matchNum, level, team) {
  const all = await db.queueAll();
  return all
    .filter((r) => r.kind === 'match' && r.event_id === state.bundle.event.id && Number(r.match_num) === Number(matchNum) && (r.tournament_level || 'Quals') === level && Number(r.scouted_team_number) === Number(team))
    .sort((a, b) => (b.queued_at || '').localeCompare(a.queued_at || ''))[0] || null;
}

function buildScoutForm(cfg, matchNum, level, team, alliance, existing) {
  const counts = {};
  const exP = (existing && existing.payload) || {};
  const pv = (a, b) => (b === undefined ? exP[a] : (exP[a] || {})[b]);                 // existing payload value
  const boolStr = (v, dflt) => (v === undefined || v === null ? dflt : (v ? 'true' : 'false'));
  // pre-fill tap/counter values from the existing record
  ['auto', 'teleop'].forEach((ph) => Object.entries(exP[ph] || {}).forEach(([k, v]) => { if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v))) counts[`${ph}.${k}`] = Number(v); }));

  const f = document.createElement('div');
  const phaseBlock = (name, pc) => {
    let h = `<div class="phase-title">${name}</div>`;
    if (pc.grid) h += tapGrid(name, cfg, counts);
    (pc.counters || []).forEach((c) => {
      const lbl = { gateOpens: 'Gate opens', majorPenalties: 'Major penalties', minorPenalties: 'Minor penalties' }[c] || c;
      if (c !== 'gateOpens') h += counterRow(name, c, lbl, counts); // gateOpens lives in the grid center
    });
    if (pc.movement) h += `<label>${esc(pc.movement.label || 'Movement')}</label>${seg(`${name}.movement`, pc.movement.options, { value: pv(name, 'movement') ?? null })}`;
    if ((pc.flags || []).length) h += `<div class="row" style="gap:8px;margin-top:10px">${pc.flags.map((fl) => `<div style="flex:1">${seg(`${name}.${fl}`, [{ key: 'true', label: fl.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }], { value: pv(name, fl) ?? null })}</div>`).join('')}</div>`;
    if (pc.majorFailure) h += `<label>Major robot failure</label>${seg(`${name}.majorFailure`, pc.majorFailure.options, { value: pv(name, 'majorFailure') ?? null })}`;
    if (pc.failureResponse) h += `<label>If failed, how did it respond?</label>${seg(`${name}.failureResponse`, pc.failureResponse.options, { value: pv(name, 'failureResponse') ?? null })}`;
    if (pc.notes) h += `<label>${name} notes</label><textarea data-key="${name}.notes" data-type="text">${esc(pv(name, 'notes') || '')}</textarea>`;
    return h;
  };

  f.innerHTML = `
    <div class="card">
      <div class="row spread"><strong>${esc(level)} ${matchNum} · ${(state.bundle?.teams || []).some((x) => Number(x.team_number) === Number(team) && x.match_priority) ? '★ ' : ''}Team ${team}</strong><span class="pill ${alliance ? alliance.toLowerCase() : ''}">${esc(alliance || '—')}</span></div>
      <div class="muted">${esc(teamName(team) || '')}${existing ? ' · editing your saved record' : ''}</div>
      <label>Showed up?</label>${seg('showed_up', [{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }], { value: boolStr(existing && existing.showed_up, 'true') })}
      <label>Starting position</label>${seg('setup.startingPosition', cfg.setup.startingPosition.options, { value: pv('setup', 'startingPosition') ?? null })}
      <label>Preloads</label>${seg('setup.preloads', cfg.setup.preloads.options, { value: pv('setup', 'preloads') ?? cfg.setup.preloads.default })}
    </div>
    <div class="card" style="border:2px solid #3b82f6;box-shadow:0 0 0 1px #3b82f620">${phaseBlock('auto', cfg.phases.auto)}</div>
    <div class="card" style="border:2px solid #f59e0b;box-shadow:0 0 0 1px #f59e0b20">${phaseBlock('teleop', cfg.phases.teleop)}</div>
    <div class="card">
      <div class="phase-title">Endgame</div>
      <label>Park</label>${seg('endgame.park', cfg.phases.endgame.park.options, { value: pv('endgame', 'park') ?? null })}
      <label>Penalty (to opponent)</label>${seg('endgame.penalty', cfg.phases.endgame.penalty.options, { value: pv('endgame', 'penalty') ?? cfg.phases.endgame.penalty.default })}
    </div>
    <div class="card">
      <label>Did you watch the whole match?</label>${seg('whole_match', [{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }], { value: boolStr(existing && existing.whole_match, 'true') })}
      <label>Scouting confidence</label>${seg('confidence', cfg.confidence, { value: (existing && existing.confidence) ?? null })}
      <label>Message from scouter (optional)</label><textarea data-key="message" data-type="text" placeholder="Color for the drive team / lead — what to watch for, anything notable">${esc(exP.message || '')}</textarea>
    </div>
    <button id="saveMatch">${existing ? 'Update match record' : 'Save match record'}</button><div style="height:10px"></div>
    <button class="ghost" id="cancelMatch">Cancel</button>`;
  $('#scoutForm').replaceChildren(f);

  // wire tap/counter increment & decrement
  const setC = (k) => { const [p, key] = k.split('.'); const el = document.getElementById(`c_${p}_${key}`); if (el) el.textContent = String(counts[k]); };
  $$('[data-inc]', f).forEach((el) => el.addEventListener('click', (e) => { if (e.target.classList.contains('minus')) return; const k = el.dataset.inc; counts[k] = (counts[k] || 0) + 1; setC(k); }));
  $$('[data-dec]', f).forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const k = el.dataset.dec; counts[k] = Math.max(0, (counts[k] || 0) - 1); setC(k); }));
  Object.keys(counts).forEach(setC);   // reflect pre-filled tap/counter values
  wireSegs(f);

  $('#cancelMatch').onclick = () => go('home');
  $('#saveMatch').onclick = async () => {
    const form = readForm(f);
    // assemble nested payload from dotted keys + tap counts
    const payload = {};
    const put = (dotted, val) => { const [a, b] = dotted.split('.'); if (b === undefined) { payload[a] = val; } else { (payload[a] = payload[a] || {})[b] = val; } };
    Object.entries(form).forEach(([k, v]) => { if (k.includes('.')) put(k, v); });
    Object.entries(counts).forEach(([k, v]) => put(k, v));
    payload.message = form.message ? form.message : null;   // scouter color note
    const rec = {
      // reuse the existing uuid so a re-save UPDATES the record (idempotent upsert) instead of duplicating
      kind: 'match', client_uuid: (existing && existing.client_uuid) || uuid(), event_id: state.bundle.event.id,
      match_num: matchNum, tournament_level: level, scouted_team_number: team, alliance,
      showed_up: form.showed_up !== 'false', whole_match: form.whole_match !== 'false',
      confidence: form.confidence || null, scouter_name: state.member?.first_name || null,
      payload, device_id: state.deviceId, client_ts: new Date().toISOString(),
    };
    await db.queueAdd(rec); await refreshSyncBadge(); autoSync();
    toast(existing ? 'Updated ✓' : 'Saved offline ✓');
    // After saving, return to match scouting and auto-select the next match in sequence.
    const sameLvl = (state.bundle.matches || []).filter((x) => x.tournament_level === level).sort((a, b) => a.match_num - b.match_num);
    const nextM = sameLvl.find((x) => x.match_num > matchNum);
    state.nextMatchSel = nextM ? `${nextM.match_num}|${nextM.tournament_level}` : null;
    go('match');
  };
}

// ─────────── pit scouting (rendered from config pitForm) ───────────
// Set a team's pre-event scouting priority: update local bundle (persisted for offline)
// then push to the server when online so it's shared across devices.
async function togglePriority(team, key, value) {
  // Enforce: watchlist ⊆ match_priority.
  // Turning watchlist ON  → also turn match_priority ON.
  // Turning match_priority OFF → also turn watchlist OFF.
  const flags = { [key]: value };
  if (key === 'watchlist'      &&  value) flags.match_priority = true;
  if (key === 'match_priority' && !value) flags.watchlist      = false;
  const t = (state.bundle.teams || []).find((x) => Number(x.team_number) === Number(team));
  if (t) { Object.assign(t, flags); if (!t.watchlist) { t.watch_column = null; t.watch_rank = null; } }
  await db.bundlePut(state.bundle);
  if (api.online()) { try { await api.setPriority(state.bundle.event.id, team, flags); } catch (e) { toast(e.message); } }
  else toast('Saved on this device — connect to share it');
}

// Reusable team list with a priority checkbox (used for match-priority planning).
function priorityPlanner(mount, flagKey) {
  const teams = (state.bundle.teams || []).slice().sort((a, b) => a.team_number - b.team_number);
  mount.innerHTML = `<input id="prioSearch" placeholder="Search team # or name" autocapitalize="off" style="margin-bottom:8px" /><div id="prioList"></div>`;
  const list = mount.querySelector('#prioList');
  const draw = (f = '') => {
    f = f.toLowerCase(); list.innerHTML = '';
    teams.filter((t) => !f || String(t.team_number).includes(f) || (t.team_name || '').toLowerCase().includes(f)).forEach((t) => {
      const row = document.createElement('label'); row.className = 'list-item'; row.style.cursor = 'pointer';
      row.innerHTML = `<div class="row" style="gap:10px;align-items:center"><input type="checkbox" class="prio" ${t[flagKey] ? 'checked' : ''} /><div><strong>${t.team_number}</strong> <span class="muted">${esc((t.team_name || '').slice(0, 24))}</span></div></div>`;
      row.querySelector('input').onchange = (e) => togglePriority(t.team_number, flagKey, e.target.checked);
      list.appendChild(row);
    });
  };
  draw();
  mount.querySelector('#prioSearch').oninput = (e) => draw(e.target.value);
}

// Pit scouting (#60): team-listing first — every team with who has pit-scouted it.
async function renderPit() {
  const teams = (state.bundle.teams || []).slice().sort((a, b) => a.team_number - b.team_number);
  view.innerHTML = `<h2>Pit scouting</h2>
    <input id="pitSearch" placeholder="Search team # or name" autocapitalize="off" />
    <p class="muted" id="pitCount" style="margin:8px 0">Loading…</p>
    <div id="pitTeams"></div>`;
  // Who scouted whom: locally-queued (this device) + server reports.
  const scouted = {};
  const add = (tn, label) => { (scouted[tn] = scouted[tn] || []).push(label); };
  (await db.queuePending()).filter((r) => r.kind === 'pit').forEach((r) => add(r.team_number, (r.scouter_name || 'you') + ' (unsynced)'));
  if (api.online()) { try { (await api.listPit(state.bundle.event.id)).items.forEach((r) => add(r.team_number, r.scouter_name || '?')); } catch {} }
  $('#pitCount').textContent = `${Object.keys(scouted).length} of ${teams.length} teams pit-scouted`;
  const list = $('#pitTeams');
  const draw = (f = '') => {
    f = f.toLowerCase(); list.innerHTML = '';
    teams.filter((t) => !f || String(t.team_number).includes(f) || (t.team_name || '').toLowerCase().includes(f)).forEach((t) => {
      const who = scouted[t.team_number];
      const d = document.createElement('div'); d.className = 'list-item';
      d.innerHTML = `<div><strong>${t.team_number}</strong> ${t.match_priority ? '⭐ ' : ''}<span class="muted">${esc((t.team_name || '').slice(0, 20))}</span></div>` +
        (who ? `<span class="pill" style="color:var(--good)">${esc(who.join(', ').slice(0, 22))}</span>` : `<span class="pill">scout →</span>`);
      d.onclick = () => renderPitForm(t.team_number);
      list.appendChild(d);
    });
  };
  draw();
  $('#pitSearch').oninput = () => draw($('#pitSearch').value);
}

async function renderPitForm(team) {
  const groups = state.bundle.season.config.pitForm || [];

  // Load the most recent pit record for this team to pre-populate the form.
  // Prefer the local unsynced queue (most recent by client_ts), then fall back
  // to the server so that synced data from another device is also restored.
  let existing = null;
  try {
    const localRecs = (await db.queuePending()).filter((r) => r.kind === 'pit' && Number(r.team_number) === Number(team) && r.event_id === state.bundle.event.id);
    if (localRecs.length) {
      existing = localRecs.sort((a, b) => (b.client_ts || '').localeCompare(a.client_ts || ''))[0];
    } else if (api.online()) {
      const res = await api.listPit(state.bundle.event.id, team);
      const items = (res.items || []);
      if (items.length) {
        // Sort descending by updated_at to pick the freshest server record.
        items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        const srv = items[0];
        existing = { client_uuid: srv.client_uuid, robot_nickname: srv.robot_nickname, scouter_name: srv.scouter_name, payload: srv.payload || {} };
      }
    }
  } catch { /* leave existing null — blank form is fine */ }

  const prevPayload = existing?.payload || {};

  const isDns = !!(state.bundle.teams || []).find((x) => Number(x.team_number) === Number(team))?.did_not_show;

  view.innerHTML = `<button class="ghost" id="back" style="width:auto">← Pit list</button>
    <h2 style="margin-top:10px">Pit: Team ${team}</h2><div class="muted">${esc(teamName(team) || '')}</div>
    <div class="card" style="border:${isDns ? '2px solid var(--bad)' : '1px solid var(--line)'}">
      <div class="row spread" style="margin-bottom:10px">
        <strong>Did Not Show</strong>
        ${seg('dns', [{ key: 'false', label: 'Present' }, { key: 'true', label: 'DNS' }], { value: isDns ? 'true' : 'false' })}
      </div>
      <label>Robot nickname (optional)</label><input id="pitNick" data-type="text" value="${esc(existing?.robot_nickname || '')}" />
      <label>Scouter name(s)</label><input id="pitScouter" data-type="text" value="${esc(existing?.scouter_name || state.member?.first_name || '')}" />
    </div>
    <div id="pitFields"></div>
    <div class="card"><label>Message from scouter (optional)</label><textarea id="pitMessage" placeholder="Color for the drive team / lead — what they said, anything notable">${esc(prevPayload.message || '')}</textarea></div>`;
  wireSegs(view);   // wire DNS seg in the top card
  const fieldsWrap = document.createElement('div');
  fieldsWrap.innerHTML = groups.map((g) => `<div class="card"><div class="phase-title">${esc(g.group)}</div>${g.fields.map((f) => fieldHtml(f, prevPayload[f.key] ?? null)).join('')}</div>`).join('');
  $('#pitFields').replaceChildren(fieldsWrap);
  wireSegs(fieldsWrap); applyShowIf(fieldsWrap);

  // Reuse the existing client_uuid so the server upserts (updates) the record
  // rather than inserting a duplicate.
  let saveUuid = existing?.client_uuid || null;

  // savePit onclick is wired after the button is created below (after photosSection)
  const _doSavePit = async () => {
    const dns = $$('.seg[data-key="dns"] .opt.on')[0]?.dataset.val === 'true';
    const payload = readForm(fieldsWrap);
    payload.message = $('#pitMessage').value || null;   // scouter color note
    payload.did_not_show = dns;
    const rec = {
      kind: 'pit', client_uuid: saveUuid || uuid(), event_id: state.bundle.event.id, team_number: team,
      robot_nickname: $('#pitNick').value || null, scouter_name: $('#pitScouter').value || null,
      payload, device_id: state.deviceId, client_ts: new Date().toISOString(),
    };
    saveUuid = rec.client_uuid;
    // Sync DNS flag to the bundle team object so filters update immediately.
    await togglePriority(team, 'did_not_show', dns);
    await db.queueAdd(rec); await refreshSyncBadge(); autoSync();
    toast('Pit report saved offline ✓'); go('pit');
  };

  // Robot photos section — upload requires network; shown always so scouters can
  // take photos at any point during/after pit scouting, not just after saving.
  const photosSection = document.createElement('div');
  photosSection.className = 'card';
  photosSection.innerHTML = `<div class="phase-title">Robot Photos</div><div id="rpGrid" class="rp-grid"></div>`;
  view.appendChild(photosSection);

  const saveBtn = document.createElement('button');
  saveBtn.id = 'savePit'; saveBtn.textContent = 'Save pit report'; saveBtn.onclick = _doSavePit;
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'cancelPit'; cancelBtn.className = 'ghost'; cancelBtn.textContent = 'Cancel';
  const spacer = document.createElement('div'); spacer.style.height = '10px';
  view.appendChild(saveBtn); view.appendChild(spacer); view.appendChild(cancelBtn);
  $('#back').onclick = () => go('pit');
  cancelBtn.onclick = () => go('pit');

  const rpGrid = photosSection.querySelector('#rpGrid');

  let _migrationPending = false;

  // Show an error message in the grid without destroying existing photos or the add button.
  const showGridMsg = (msg, isErr = false) => {
    let el = rpGrid.querySelector('.rp-msg');
    if (!el) { el = document.createElement('p'); el.className = 'rp-msg'; el.style.cssText = 'font-size:13px;grid-column:1/-1;margin:4px 0'; rpGrid.prepend(el); }
    el.style.color = isErr ? 'var(--bad)' : 'var(--muted)';
    el.textContent = msg;
  };
  const clearGridMsg = () => { rpGrid.querySelector('.rp-msg')?.remove(); };

  // Replaces the full grid — only used for fatal states (offline, migration pending).
  const setGridError = (msg) => {
    rpGrid.innerHTML = `<p class="muted" style="font-size:13px;grid-column:1/-1">${esc(msg)}</p>`;
  };

  const renderPhotoGrid = (photos, pendingPhotos = []) => {
    rpGrid.innerHTML = '';
    // Show locally-queued photos first with a pending badge so the user knows they exist.
    pendingPhotos.forEach((p) => {
      const thumb = document.createElement('div');
      thumb.className = 'rp-thumb';
      thumb.style.opacity = '0.75';
      thumb.innerHTML = `<img src="${esc(p.image_data)}" alt="Robot photo (pending upload)" class="rp-lightbox" />
        <span class="rp-star" style="background:var(--warn);color:#000">⏳</span>`;
      rpGrid.appendChild(thumb);
    });
    photos.forEach((p) => {
      const thumb = document.createElement('div');
      thumb.className = 'rp-thumb' + (p.is_profile ? ' rp-profile' : '');
      thumb.innerHTML = `<img src="${esc(p.url)}" alt="Robot photo" />${p.is_profile ? '<span class="rp-star">★ Profile</span>' : '<span class="rp-hint" style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-size:9px;color:#fff;background:rgba(0,0,0,.4)">tap = profile</span>'}<button class="rp-del" data-id="${p.id}" title="Delete photo">✕</button>`;
      if (!p.is_profile) thumb.addEventListener('click', async (e) => {
        if (e.target.closest('.rp-del')) return;
        try { await api.setProfilePhoto(state.bundle.event.id, team, p.id); toast('Set as profile photo ✓'); loadPhotos(); } catch (err) { toast(err.message); }
      });
      thumb.querySelector('.rp-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this photo?')) return;
        try { await api.deleteRobotPhoto(state.bundle.event.id, team, p.id); toast('Deleted'); loadPhotos(); } catch (err) { toast(err.message); }
      });
      rpGrid.appendChild(thumb);
    });

    // Add button — no `capture` attribute so iOS shows camera + library picker
    const addBtn = document.createElement('label');
    addBtn.className = 'rp-add'; addBtn.title = 'Take or upload a photo';
    addBtn.innerHTML = `<span style="font-size:22px;line-height:1">📷</span><input type="file" accept="image/*" />`;
    addBtn.querySelector('input').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (_migrationPending) { showGridMsg('Robot photos not available yet — contact an admin.'); return; }
      clearGridMsg();
      addBtn.querySelector('input').value = '';   // allow re-selecting same file

      if (!api.online()) {
        // Offline: compress and stash in the queue; it will upload on next sync.
        const spinner = document.createElement('div');
        spinner.className = 'rp-add'; spinner.style.cssText = 'grid-column:1/-1;pointer-events:none';
        spinner.textContent = 'Saving…'; rpGrid.appendChild(spinner);
        try {
          const dataUrl = await api.compressToDataUrl(file, 1200, 0.80);
          await db.queueAdd({ kind: 'photo', client_uuid: crypto.randomUUID(), event_id: state.bundle.event.id, team_number: team, image_data: dataUrl, client_ts: new Date().toISOString() });
          await refreshSyncBadge();
          toast('Photo saved — will upload when online ✓');
          await loadPhotos();
        } catch (err) { spinner.remove(); showGridMsg('Could not save photo: ' + err.message, true); }
        return;
      }

      const spinner = document.createElement('div');
      spinner.className = 'rp-add'; spinner.style.cssText = 'grid-column:1/-1;pointer-events:none';
      spinner.textContent = 'Uploading…'; rpGrid.appendChild(spinner);
      try {
        await api.uploadRobotPhoto(state.bundle.event.id, team, file);
        await loadPhotos();
        toast('Photo saved ✓');
      } catch (err) {
        spinner.remove();
        showGridMsg('Upload failed: ' + err.message, true);
      }
    });
    rpGrid.appendChild(addBtn);
  };

  const loadPhotos = async () => {
    // Always load locally-queued photos so they show even when offline.
    const localPhotos = (await db.queuePending())
      .filter((r) => r.kind === 'photo' && r.event_id === state.bundle.event.id && Number(r.team_number) === Number(team));

    if (!api.online()) {
      renderPhotoGrid([], localPhotos);
      if (!localPhotos.length) showGridMsg('Connect to WiFi to view server photos. Photos taken now will upload when you reconnect.');
      return;
    }
    try {
      const res = await api.listRobotPhotos(state.bundle.event.id, team);
      if (res.migration_pending) {
        _migrationPending = true;
        setGridError('Robot photos not available yet — run database migration 0026 on the server.');
        return;
      }
      _migrationPending = false;
      renderPhotoGrid(res.photos, localPhotos);
    } catch (err) { renderPhotoGrid([], localPhotos); showGridMsg(err.message, true); }
  };
  loadPhotos();
}

// ─────────── sync ───────────
async function renderSync() {
  const pending = await db.queuePending();
  const all = await db.queueAll();
  view.innerHTML = `<h2>Sync</h2>
    <div class="card row spread"><div><strong>${pending.length}</strong> pending<br><span class="muted">${all.length - pending.length} already synced</span></div>
      <button style="width:auto" id="push" ${pending.length && api.online() ? '' : 'disabled'}>Upload now</button></div>
    ${!api.online() ? '<div class="card"><p class="muted">You\'re offline. Records are saved on this device and will upload when you reconnect.</p></div>' : ''}
    <div id="qlist"></div>`;
  const list = $('#qlist');
  all.slice().reverse().forEach((r) => {
    const who = r.kind === 'photo'
      ? `Photo · Team ${r.team_number}`
      : r.kind === 'pit' ? `Pit · Team ${r.team_number}`
      : r.kind === 'match' ? `Match ${r.match_num} · Team ${r.scouted_team_number}`
      : `Obs · Team ${r.team_number}`;
    const d = document.createElement('div'); d.className = 'list-item';
    d.innerHTML = `<span>${esc(who)}</span><span class="pill ${r.synced ? '' : 'red'}">${r.synced ? 'synced' : 'pending'}</span>`;
    list.appendChild(d);
  });
  $('#push').onclick = async () => {
    $('#push').disabled = true;
    try {
      const pendingNow = await db.queuePending();
      const photos = pendingNow.filter((r) => r.kind === 'photo');
      const scouts = pendingNow.filter((r) => r.kind !== 'photo');
      let uploaded = 0, failed = 0;
      for (const p of photos) {
        try { await api.uploadRobotPhoto(p.event_id, p.team_number, p.image_data); await db.queueMarkSynced(p.client_uuid); uploaded++; }
        catch { failed++; }
      }
      if (scouts.length) {
        const recs = scouts.map(({ synced, queued_at, synced_at, ...r }) => r);
        const res = await api.pushSync(recs);
        for (const r of res.results) if (r.status === 'ok' && r.client_uuid) await db.queueMarkSynced(r.client_uuid);
        toast(`Uploaded ${res.accepted}/${res.received} records` + (photos.length ? `, ${uploaded} photo${uploaded !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}` : ''));
      } else {
        toast(`${uploaded} photo${uploaded !== 1 ? 's' : ''} uploaded${failed ? `, ${failed} failed` : ' ✓'}`);
      }
    } catch (e) { toast(e.message); }
    await refreshSyncBadge(); renderSync();
  };
}

boot();
