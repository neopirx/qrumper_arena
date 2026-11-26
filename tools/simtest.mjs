// Headless sim test: node tools/simtest.mjs [map] [seconds] [bots]
import { buildMap } from '../src/maps/builder.js';
import { Game, TICK } from '../src/sim/game.js';
import { buildNav } from '../src/sim/nav.js';
import { makeBot } from '../src/sim/bot.js';
import { BOT_NAMES } from '../src/sim/defs.js';
const name = process.argv[2] || 'bastion', secs = +(process.argv[3] || 120), nb = +(process.argv[4] || 6);
const def = (await import(`../src/maps/${name}.js`)).default;
const map = buildMap(def);
const game = new Game(map, { fraglimit: 999, timelimit: 99 });
let t0 = performance.now();
game.nav = buildNav(map, game.col);
const nav = game.nav;
const links = nav.nodes.reduce((a, n) => a + n.links.length, 0);
const types = {}; for (const n of nav.nodes) for (const l of n.links) types[l.type] = (types[l.type] || 0) + 1;
console.log(`nav: ${nav.nodes.length} nodes, ${links} links`, types, `${Math.round(performance.now() - t0)}ms`);
// connectivity from first spawn
const s0 = nav.nearest(def.spawns[0].at, game.col);
const dist = nav.distances(s0.i, 1e9);
const unreach = def.items.filter(it => { const n = nav.nearest(it.at, game.col); return !n || !isFinite(dist[n.i]); });
console.log('unreachable items:', unreach.map(i => i.t + '@' + i.at.join(',')));
const unreachSp = def.spawns.filter(s => { const n = nav.nearest(s.at, game.col); return !n || !isFinite(dist[n.i]); });
console.log('unreachable spawns:', unreachSp.map(s => s.at.join(',')));
for (let i = 0; i < nb; i++) game.addPlayer({ name: BOT_NAMES[i], bot: makeBot(1 + (i % 5)) });
const pickups = {}; const deaths = {}; let fires = 0;
t0 = performance.now();
const visited = new Set();
for (let i = 0; i < secs / TICK; i++) {
  game.tick();
  for (const e of game.events) {
    if (e.type === 'pickup') pickups[e.item] = (pickups[e.item] || 0) + 1;
    if (e.type === 'death') deaths[e.mod] = (deaths[e.mod] || 0) + 1;
    if (e.type === 'fire') fires++;
  }
  game.events.length = 0;
  if (i % 125 === 0) for (const p of game.players) visited.add(`${Math.round(p.ps.origin[0] / 128)},${Math.round(p.ps.origin[1] / 64)},${Math.round(p.ps.origin[2] / 128)}`);
}
const ms = performance.now() - t0;
console.log(`sim ${secs}s in ${Math.round(ms)}ms (${(ms / (secs / TICK)).toFixed(3)} ms/tick)`);
console.log('pickups', pickups); console.log('deaths', deaths, 'shots', fires, 'cells visited', visited.size);
for (const p of game.ranking()) console.log(p.name.padEnd(8), 'skill', p.bot.skill, 'frags', p.frags, 'deaths', p.deaths, 'hp', p.health, 'pos', p.ps.origin.map(Math.round).join(','));
