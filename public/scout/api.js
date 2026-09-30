// API client for TRC Scout. Talks to the existing /api/v1 endpoints with the JWT.
// All scouting writes go through the offline queue (db.js) and are flushed via
// pushSync(); these helpers are the network layer only.
import { db } from './db.js';

// Resize and re-encode an image File to a JPEG data URL, capping the longest
// edge at maxPx. Returns base64 so the caller can POST as JSON, bypassing
// PHP's multipart upload_max_filesize limit entirely.
function compressToDataUrl(file, maxPx = 1200, quality = 0.80) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      dataUrl ? resolve(dataUrl) : reject(new Error('Image compression failed'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file')); };
    img.src = url;
  });
}

const BASE = '/api/v1';

async function token() { return db.kvGet('token'); }

async function authedFetch(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const t = await token();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (t) headers['Authorization'] = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(BASE + path, { ...opts, headers });
  } catch (netErr) {
    // Network failure (offline). For reads, serve the last cached response so team
    // info / projections still work; otherwise signal offline to the caller.
    if (method === 'GET') { const cached = await db.apiCacheGet(path); if (cached) return cached; }
    throw new Error('Offline — no cached data yet for this view.');
  }
  if (res.status === 401) {
    // Token expired — clear session and signal the app without a page reload.
    // Throwing lets callers' finally blocks run (so _syncing resets, etc.).
    await db.kvDel('token'); await db.kvDel('member');
    window.dispatchEvent(new CustomEvent('scout:sessionexpired'));
    throw new Error('Session expired — please log in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  if (method === 'GET') db.apiCacheSet(path, data).catch(() => {});   // cache reads for offline use
  return data;
}

export const api = {
  online: () => navigator.onLine,
  compressToDataUrl,

  // OAuth2 password form (matches the backend /auth/token form endpoint).
  async login(username, password) {
    const body = new URLSearchParams({ username, password });
    const res = await fetch(`${BASE}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Login failed');
    await db.kvSet('token', data.access_token);
    const me = await authedFetch('/auth/me');
    await db.kvSet('member', me);
    return me;
  },

  me: () => authedFetch('/auth/me'),
  listEvents: (activeOnly = true) => authedFetch('/scouting/events' + (activeOnly ? '?active=1' : '')),
  listSeasons: () => authedFetch('/scouting/seasons'),
  createEvent: (season_id, event_code, training) => authedFetch('/scouting/events', { method: 'POST', body: JSON.stringify({ season_id, event_code, training }) }),
  patchEvent: (id, fields) => authedFetch(`/scouting/events/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  syncPreEvent: (id) => authedFetch(`/scouting/events/${id}/sync-preevent`, { method: 'POST' }),
  syncSchedule: (id) => authedFetch(`/scouting/events/${id}/sync-schedule`, { method: 'POST' }),
  syncLive: (id) => authedFetch(`/scouting/events/${id}/sync-live`, { method: 'POST' }),
  deleteEvent: (id) => authedFetch(`/scouting/events/${id}`, { method: 'DELETE' }),
  getBundle: (eventId) => authedFetch(`/scouting/events/${eventId}/bundle`),
  listPit: (eventId, teamNumber) => authedFetch(`/scouting/pit-reports?event_id=${eventId}` + (teamNumber != null ? `&team_number=${teamNumber}` : '')),
  setPriority: (eventId, team, flags) => authedFetch(`/scouting/events/${eventId}/teams/${team}/priority`, { method: 'PATCH', body: JSON.stringify(flags) }),
  saveWatchlist: (eventId, layout) => authedFetch(`/scouting/events/${eventId}/watchlist`, { method: 'POST', body: JSON.stringify(layout) }),
  listMatchRecords: (eventId, matchNum) => authedFetch(`/scouting/match-records?event_id=${eventId}` + (matchNum != null ? `&match_num=${matchNum}` : '')),
  teamSummaries: (eventId) => authedFetch(`/scouting/events/${eventId}/team-summaries`),
  matchPreview: (eventId, matchNum) => authedFetch(`/scouting/matches/preview?event_id=${eventId}&match_num=${matchNum}`),
  teamReport: (eventId, team) => authedFetch(`/scouting/events/${eventId}/team/${team}/report`),
  reconcile: (eventId) => authedFetch(`/scouting/events/${eventId}/reconcile`),
  livePerformance: (eventId) => authedFetch(`/scouting/events/${eventId}/live-performance`),
  liveRankings: (eventId) => authedFetch(`/scouting/events/${eventId}/live-rankings`),
  matchProjections: (eventId) => authedFetch(`/scouting/events/${eventId}/match-projections`),
  playoffBracket: (eventId) => authedFetch(`/scouting/events/${eventId}/playoff-bracket`),
  preEventTable: (eventId) => authedFetch(`/scouting/events/${eventId}/pre-event-table`),
  allianceModel: (eventId, team, mode) => authedFetch(`/scouting/events/${eventId}/alliance-model?team=${team}&mode=${mode}`),
  revealMatch: (eventId, matchNum, level) => authedFetch(`/scouting/events/${eventId}/matches/${matchNum}/reveal?level=${encodeURIComponent(level || 'Quals')}`, { method: 'POST' }),

  listRobotPhotos: (eventId, team) => authedFetch(`/scouting/events/${eventId}/teams/${team}/photos`),
  setProfilePhoto: (eventId, team, photoId) => authedFetch(`/scouting/events/${eventId}/teams/${team}/photos/${photoId}/profile`, { method: 'PATCH' }),
  deleteRobotPhoto: (eventId, team, photoId) => authedFetch(`/scouting/events/${eventId}/teams/${team}/photos/${photoId}`, { method: 'DELETE' }),
  async uploadRobotPhoto(eventId, team, fileOrDataUrl) {
    // Compress then send as base64 JSON — bypasses PHP's multipart file upload
    // system (upload_max_filesize) entirely; only post_max_size applies.
    // Accepts a File object (compresses it) or a pre-compressed dataUrl string
    // (used when uploading a photo that was queued while offline).
    const dataUrl = typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await compressToDataUrl(fileOrDataUrl, 1200, 0.80);
    const t = await token();
    const headers = { 'Content-Type': 'application/json' };
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`${BASE}/scouting/events/${eventId}/teams/${team}/photos`, {
      method: 'POST', headers, body: JSON.stringify({ image_data: dataUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Upload failed (${res.status})`);
    return data;
  },

  // Flush queued records. Returns the server's per-record results so the caller
  // can mark accepted ones synced. Idempotent server-side (upsert by client_uuid).
  pushSync: (records) => authedFetch('/scouting/sync', { method: 'POST', body: JSON.stringify({ records }) }),
};
