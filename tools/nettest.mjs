// Headless multiplayer test: starts the real server (rooms, snapshots, lag compensation) on a
// random port and connects Node clients that run the browser's prediction code (NetMatch).
//   node tools/nettest.mjs [seconds] [map]
// Checks that rooms work, that a late joiner gets in, and that client prediction agrees with the
// server (prediction corrections should be ~0 when nothing pushes you around).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.QRUMPER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'qrumper-nettest-'));
const { attachMultiplayer } = await import('../server/net.js');
const { Connection } = await import('../src/client/net.js');
const { NetMatch } = await import('../src/client/netmatch.js');
const { Game, TICK } = await import('../src/sim/game.js');
const { buildMap } = await import('../src/maps/builder.js');
const { MAPS } = await import('../src/maps/index.js');

const SECS = +(process.argv[2] || 12), MAP = process.argv[3] || 'skywalk', BOTS = +(process.argv[4] ?? 2);
const server = http.createServer((q, r) => { r.statusCode = 404; r.end(); });
attachMultiplayer(server);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/ws`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (conn, t) => new Promise((r) => { const off = conn.on(t, (m) => { off(); r(m); }); });

async function client(name) {
  const conn = new Connection(url);
  await conn.connect();
  conn.send({ t: 'hello', name, character: 'froggy', color: 0x40d060 });
  await once(conn, 'welcome');
  return { conn, name, stats: { snaps: 0, corrections: [], events: {}, maxQueue: 0 } };
}

// a client that loads the match and plays: runs forward, strafe-jumps in circles, shoots
function play(c, start) {
  const game = new Game(buildMap(MAPS[start.map].def), { fraglimit: start.rules.fraglimit, timelimit: start.rules.timelimit, warmup: start.warmup, doubleJump: start.rules.doubleJump });
  const nm = new NetMatch(c.conn, game, start.you);
  for (const r of start.roster) { const p = game.addPlayer({ id: r.id, name: r.name, color: r.color, spawn: false }); p.bot = r.bot ? { skill: r.bot } : null; }
  c.conn.on('roster', (m) => { for (const r of m.players) if (!game.players.some((p) => p.id === r.id)) game.addPlayer({ id: r.id, name: r.name, color: r.color, spawn: false }); });
  const me = game.players.find((p) => p.id === start.you);
  nm.setMe(me);
  c.nm = nm; c.game = game; c.me = me;
  c.conn.send({ t: 'ready' });
  let t = 0, acc = 0, last = performance.now(), i = 0;
  c.timer = setInterval(() => {
    const now = performance.now(); acc += (now - last) / 1000; last = now;
    while (acc >= TICK) {
      acc -= TICK; i++; t += TICK;
      const cmd = { forward: 1, side: (i >> 7) & 1 ? 1 : -1, jump: (i % 90) < 60, crouch: false, attack: i % 50 < 5, yaw: (i * 0.4) % 360 - 180, pitch: 0, weapon: i % 400 === 0 ? 'mg' : null, walljumpOnJump: true };
      for (const e of nm.predict(cmd)) c.stats.events[e.type] = (c.stats.events[e.type] || 0) + 1;
    }
    nm.flush();
    const evs = nm.receive();
    if (nm.correction != null) { if (game.state === 'playing' && me.alive) c.stats.corrections.push(nm.correction); nm.correction = null; }
    for (const e of evs) c.stats.events['srv:' + e.type] = (c.stats.events['srv:' + e.type] || 0) + 1;
    nm.interpolate();
  }, 7);
  c.conn.on('s', () => c.stats.snaps++);
}

const A = await client('Alice');
A.conn.send({ t: 'create', name: 'test room' });
const room = await once(A.conn, 'room');
console.log('room', room.id, room.name, 'owner', room.owner === undefined ? '?' : 'ok', 'members', room.members.length);
A.conn.send({ t: 'rules', rules: { map: MAP, bots: BOTS, skill: 2, fraglimit: 50, timelimit: 1 } });
const B = await client('Bob');
B.conn.send({ t: 'list' });
const list = await once(B.conn, 'rooms');
console.log('rooms seen by Bob:', list.rooms.map((r) => `${r.name} (${r.players}/${r.max}, ${r.map}, ${r.state})`).join(', '));
B.conn.send({ t: 'join', id: room.id });
await once(B.conn, 'room');
const startA = once(A.conn, 'start'), startB = once(B.conn, 'start');
A.conn.send({ t: 'start' });
const [sa, sb] = await Promise.all([startA, startB]);
console.log('start received: map', sa.map, 'roster', sa.roster.map((r) => r.name + (r.bot ? '(bot)' : '')).join(', '));
play(A, sa); play(B, sb);
// a third player joins mid-match
await wait(SECS * 400);
const C = await client('Cara');
C.conn.send({ t: 'join', id: room.id });
const sc = await once(C.conn, 'start');
console.log('late joiner got start, roster size', sc.roster.length);
play(C, sc);
await wait(SECS * 600);

for (const c of [A, B, C]) {
  clearInterval(c.timer);
  const cor = c.stats.corrections;
  const big = cor.filter((x) => x > 0.5 && x < 80).length;
  const mean = cor.length ? cor.reduce((a, b) => a + b, 0) / cor.length : 0;
  const me = c.game.players.find((p) => p.id === c.me.id);
  console.log(`${c.name}: ${c.stats.snaps} snapshots, ${cor.length} reconciles, mean correction ${mean.toFixed(3)}u, ${big} over 0.5u (excl. respawns), max ${Math.max(0, ...cor.filter((x) => x < 80)).toFixed(2)}u, pending ${c.nm.pending.length}, frags ${me.frags} kills ${me.kills} deaths ${me.deaths}`);
  console.log('   events', JSON.stringify(c.stats.events));
}
const others = A.game.players.filter((p) => p.id !== A.me.id).map((p) => `${p.name}@${p.ps.origin.map((v) => Math.round(v)).join(',')}`);
console.log('Alice sees', others.join('  '));
for (const c of [A, B, C]) c.conn.close();
server.close();
setTimeout(() => process.exit(0), 200);
