// Duel design audit: node tools/mapaudit.mjs [map ...]
// Measures a map against the arena duel rules we design by:
//  - walk time between the major items (RA, MH, YA, RL, RG): target RA<->MH at 60-80 % of the 25 s
//    armour respawn, and every major at least two routes away from the others
//  - sightlines between the majors (fraction of standing spots around one that see the other):
//    each corner of the triangle should partly see one other, not fully see both
//  - dead ends: every space (room, passage) must lead to at least two other spaces
//  - spawns: 2-4 s from a weapon, no line of sight into a major item
// Times are nav-graph costs / 320 u/s (run speed, no strafe-jumping), so real play is faster.
import { buildMap } from '../src/maps/builder.js';
import { CollisionWorld, MASK_SHOT } from '../src/sim/collision.js';
import { buildNav } from '../src/sim/nav.js';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['bastion', 'cistern', 'skywalk', 'spire', 'vigil', 'orbit'];
const RUN = 320, EYE = 40;
const MAJOR = ['ra', 'mh', 'ya', 'rl', 'rg'];
const WEAPONS = new Set(['sg', 'gl', 'rl', 'rg']);
const ZERO = [0, 0, 0];

for (const name of names) {
  const def = (await import(`../src/maps/${name}.js`)).default;
  const map = buildMap(def);
  const col = new CollisionWorld(map.brushes);
  const nav = buildNav(map, col);
  const N = nav.nodes.length;
  console.log(`\n== ${name}  (${N} nav nodes)`);

  const los = (a, b) => col.trace(a, b, ZERO, ZERO, MASK_SHOT).fraction >= 1;
  const eye = (p) => [p[0], p[1] + EYE, p[2]];
  const majors = [];
  for (const t of MAJOR) for (const it of def.items.filter((i) => i.t === t)) majors.push({ t, at: it.at, node: nav.nearest(it.at, col) });
  const dist = new Map();
  for (const m of majors) if (m.node) dist.set(m, nav.distances(m.node.i, 1e9));

  // ---- walk times ----
  console.log('walk time (s) from row to column:');
  console.log('      ' + majors.map((m) => m.t.padStart(6)).join(''));
  for (const a of majors) {
    const d = dist.get(a);
    console.log(a.t.padEnd(6) + majors.map((b) => (d && b.node ? (d[b.node.i] / RUN).toFixed(1) : '--').padStart(6)).join(''));
  }
  // number of distinct routes RA<->MH: remove the nodes of the shortest path's middle and retry
  const ra = majors.find((m) => m.t === 'ra'), mh = majors.find((m) => m.t === 'mh');
  if (ra?.node && mh?.node) {
    const t = dist.get(ra)[mh.node.i] / RUN;
    const verdict = t < 0.6 * 25 * 0.55 ? 'short' : t > 0.8 * 25 ? 'long' : 'ok';
    console.log(`RA -> MH ${t.toFixed(1)} s (${verdict}; target ~8-15 s at run speed)`);
    let routes = 0; const banned = new Set();
    for (let k = 0; k < 4; k++) {
      const saved = nav.nodes.map((n) => n.links);
      for (const n of nav.nodes) n.links = n.links.filter((l) => !banned.has(l.to));
      const p = nav.path(ra.node.i, mh.node.i);
      for (const n of nav.nodes) n.links = saved[n.i];
      if (!p) break;
      routes++;
      const mid = p.slice(Math.floor(p.length * 0.3), Math.ceil(p.length * 0.7));
      for (const i of mid) for (const n of nav.nodes) if (Math.hypot(n.p[0] - nav.nodes[i].p[0], n.p[2] - nav.nodes[i].p[2]) < 96 && Math.abs(n.p[1] - nav.nodes[i].p[1]) < 64) banned.add(n.i);
    }
    console.log(`RA <-> MH distinct routes: ${routes}${routes >= 4 ? '+' : ''}`);
  }

  // ---- sightlines ----
  const around = (m) => nav.nodes.filter((n) => Math.hypot(n.p[0] - m.at[0], n.p[2] - m.at[2]) < 160 && Math.abs(n.p[1] - m.at[1]) < 48).map((n) => eye(n.p));
  const ring = new Map(majors.map((m) => [m, around(m).concat([eye(m.at)])]));
  console.log('sightlines (% of spots near row seeing spots near column):');
  for (const a of majors) {
    const row = majors.map((b) => {
      if (a === b) return '     -';
      const A = ring.get(a), B = ring.get(b);
      let hit = 0, tot = 0;
      for (const p of A) for (const q of B) { tot++; if (los(p, q)) hit++; }
      return `${Math.round(100 * hit / Math.max(1, tot))}%`.padStart(6);
    });
    console.log(a.t.padEnd(6) + row.join(''));
  }

  // ---- dead ends: spaces leading to fewer than two other spaces ----
  const spaceOf = (p) => { let s = -1; def.spaces.forEach((sp, i) => { const b = sp.b; if (p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] - 1 && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5]) s = i; }); return s; };
  const sp = nav.nodes.map((n) => spaceOf(n.p));
  const outs = def.spaces.map(() => new Set()), ins = def.spaces.map(() => new Set());
  for (const n of nav.nodes) for (const l of n.links) {
    const a = sp[n.i], b = sp[l.to];
    if (a >= 0 && b >= 0 && a !== b) { outs[a].add(b); ins[b].add(a); }
  }
  const label = (i) => `#${i}${def.spaces[i].name ? ' ' + def.spaces[i].name : ''} [${def.spaces[i].b.join(',')}]`;
  let dead = 0;
  def.spaces.forEach((_, i) => {
    if (!sp.includes(i)) return;   // no floor in it (windows, sky volumes)
    // a sunken part of a bigger room (a pit in a hall floor) belongs to that room
    const b = def.spaces[i].b;
    const nested = def.spaces.some((o, j) => j !== i && o.b[0] <= b[0] && o.b[2] <= b[2] && o.b[3] >= b[3] && o.b[5] >= b[5] && o.b[1] === b[4]);
    const all = new Set([...outs[i], ...ins[i]]);
    // one-way drops and windows are fine; a space you can't leave, or with a single neighbour, is not
    if (!nested && (all.size < 2 || !outs[i].size)) { dead++; console.log(`  dead end: ${label(i)}  out->${[...outs[i]]} in<-${[...ins[i]]}`); }
  });
  if (!dead) console.log('no dead ends');

  // ---- spawns ----
  const weaponNodes = def.items.filter((i) => WEAPONS.has(i.t)).map((i) => nav.nearest(i.at, col)).filter(Boolean);
  def.spawns.forEach((s, si) => {
    const n = nav.nearest(s.at, col);
    if (!n) { console.log(`  spawn #${si} has no nav node`); return; }
    const d = nav.distances(n.i, 1e9);
    const tw = Math.min(...weaponNodes.map((w) => d[w.i])) / RUN;
    const seen = majors.filter((m) => m.t === 'ra' || m.t === 'mh').filter((m) => los(eye(s.at), eye(m.at))).map((m) => m.t);
    const flags = [tw > 4 ? `weapon ${tw.toFixed(1)} s` : '', seen.length ? `sees ${seen}` : ''].filter(Boolean);
    if (flags.length) console.log(`  spawn #${si} @${s.at}: ${flags.join(', ')}`);
  });
}
