// Player profiles kept in one JSON file (data/profiles.json, or $QRUMPER_DATA/profiles.json).
// A profile id is a random 128-bit token the browser keeps in localStorage; knowing it is what
// lets you use the profile, so ids are never sent to other players.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CHARACTERS, PLAYER_COLORS } from '../src/sim/defs.js';
import { applyResult, levelInfo } from '../src/sim/xp.js';

const DIR = path.resolve(process.env.QRUMPER_DATA || path.join(process.cwd(), 'data'));
const FILE = path.join(DIR, 'profiles.json');
let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('[profiles] could not read', FILE, e.message); }

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
      fs.renameSync(tmp, FILE);   // atomic replace: a crash mid-write never truncates the store
    } catch (e) { console.error('[profiles] save failed:', e.message); }
  }, 300);
}

export const validId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
export function cleanName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

// what the owner sees (and the client caches); level is derived
export function view(p) {
  if (!p) return null;
  return { ...p, levelInfo: levelInfo(p.xp) };
}

export function getProfile(id) { return validId(id) ? db[id] || null : null; }

// create (no / unknown id) or update name, character and colour
export function upsertProfile(data = {}) {
  let p = getProfile(data.id);
  if (!p) {
    const id = crypto.randomBytes(16).toString('hex');
    p = db[id] = { id, name: 'Player', character: CHARACTERS[0], color: PLAYER_COLORS[0], xp: 0, kills: 0, deaths: 0, matches: 0, wins: 0, badges: {}, created: Date.now() };
  }
  if (data.name != null) p.name = cleanName(data.name);
  if (CHARACTERS.includes(data.character)) p.character = data.character;
  if (PLAYER_COLORS.includes(+data.color)) p.color = +data.color;
  p.updated = Date.now();
  save();
  return p;
}

export function recordResult(id, result) {
  const p = getProfile(id);
  if (!p) return null;
  const r = applyResult(p, result);
  p.updated = Date.now();
  save();
  return { profile: p, ...r };
}

// ---- HTTP API (connect-style middleware: works in Vite dev/preview and the production server) ----
//   GET  /api/profile/:id           -> profile
//   POST /api/profile               {id?, name, character, color} -> profile (created when id is new)
//   POST /api/profile/:id/result    {xp, kills, deaths, badges, won} -> { profile, levelUp } (offline matches)
export function apiMiddleware(req, res, next) {
  const url = (req.url || '').split('?')[0];
  if (!url.startsWith('/api/')) return next();
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = () => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 16384) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } });
  });
  (async () => {
    if (url === '/api/health') return send(200, { ok: true });
    let m;
    if (req.method === 'GET' && (m = url.match(/^\/api\/profile\/([a-f0-9]{32})$/))) {
      const p = getProfile(m[1]);
      return p ? send(200, view(p)) : send(404, { error: 'not found' });
    }
    if (req.method === 'POST' && url === '/api/profile') {
      const d = await body();
      if (!d) return send(400, { error: 'bad json' });
      return send(200, view(upsertProfile(d)));
    }
    if (req.method === 'POST' && (m = url.match(/^\/api\/profile\/([a-f0-9]{32})\/result$/))) {
      const d = await body();
      if (!d) return send(400, { error: 'bad json' });
      // offline (bot) matches are reported by the client; cap them so a bad client can't go wild
      const r = recordResult(m[1], { ...d, xp: Math.min(+d.xp || 0, 6000) });
      return r ? send(200, { profile: view(r.profile), levelUp: r.levelUp, level: r.level }) : send(404, { error: 'not found' });
    }
    send(404, { error: 'no such endpoint' });
  })().catch((e) => { console.error('[api]', e); send(500, { error: 'server error' }); });
}
