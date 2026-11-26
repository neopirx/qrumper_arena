// WebSocket endpoint (/ws) for lobbies and matches. Attached to whatever HTTP server serves the
// game: Vite's in `npm run dev` / `npm run preview`, or server/index.js in production.
import { WebSocketServer } from 'ws';
import { Lobby } from './rooms.js';
import { getProfile, cleanName } from './profiles.js';
import { levelInfo } from '../src/sim/xp.js';
import { CHARACTERS, PLAYER_COLORS } from '../src/sim/defs.js';

const lobby = new Lobby();
let nextClient = 1;
const attached = new WeakSet();

export function attachMultiplayer(httpServer) {
  if (!httpServer || attached.has(httpServer)) return;
  attached.add(httpServer);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  httpServer.on('upgrade', (req, socket, head) => {
    // only ours: Vite's HMR socket shares this server and handles its own upgrades
    if ((req.url || '').split('?')[0] !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
  });
  console.log('[qrumper] multiplayer endpoint ready at /ws');
}

function onConnection(ws, req) {
  const client = {
    cid: nextClient++, ws, name: 'Player', character: CHARACTERS[0], color: PLAYER_COLORS[0], level: 1, profileId: null,
    room: null, player: null, ready: false, hello: false, msgs: 0,
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    sendRaw(s) { if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(s); },
  };
  lobby.connect(client);
  // crude flood guard: a client normally sends ~60-150 messages a second
  const flood = setInterval(() => { if (client.msgs > 1500) ws.close(1008, 'flood'); client.msgs = 0; }, 5000);
  ws.on('message', (data) => {
    client.msgs++;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(client, m); } catch (e) { console.error('[net] message error', m.t, e); }
  });
  ws.on('close', () => { clearInterval(flood); lobby.disconnect(client); });
  ws.on('error', () => {});
}

function handle(c, m) {
  if (m.t === 'hello') {
    // the profile (if the id is known) is the source of truth for name / model / level
    const p = getProfile(m.profileId);
    c.profileId = p ? p.id : null;
    c.name = cleanName(p ? p.name : m.name);
    c.character = CHARACTERS.includes(p ? p.character : m.character) ? (p ? p.character : m.character) : CHARACTERS[0];
    c.color = PLAYER_COLORS.includes(+(p ? p.color : m.color)) ? +(p ? p.color : m.color) : PLAYER_COLORS[0];
    c.level = p ? levelInfo(p.xp).level : 1;
    c.hello = true;
    c.send({ t: 'welcome', cid: c.cid, rooms: lobby.list() });
    if (c.room) c.room.pushState();
    return;
  }
  if (!c.hello) return;
  const room = c.room;
  switch (m.t) {
    case 'list': c.send({ t: 'rooms', rooms: lobby.list() }); break;
    case 'create': lobby.create(c, m.name); break;
    case 'join': lobby.join(c, m.id); break;
    case 'leave': if (room) { room.leave(c); c.send({ t: 'rooms', rooms: lobby.list() }); } break;
    case 'rules': if (room) room.setRules(c, m.rules); break;
    case 'start': if (room) room.start(c); break;
    case 'ready': if (room) room.ready(c); break;
    case 'c': if (room) room.commands(c, m.c); break;
    case 'chat': if (room && typeof m.text === 'string' && m.text.trim()) room.say(c, m.text.trim()); break;
    case 'pong': if (c.player && Number.isFinite(+m.s)) c.player.ping = Math.max(0, Math.round(performance.now() - m.s)); break;
  }
}
