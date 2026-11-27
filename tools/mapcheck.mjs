// Map sanity check: node tools/mapcheck.mjs [map ...]
// - every spawn: hull not in solid, can walk away in at least a few directions
// - nav: floor regions that can't be reached from the spawns / can't get back (traps)
import { buildMap } from '../src/maps/builder.js';
import { CollisionWorld, MASK_PLAYER } from '../src/sim/collision.js';
import { pmove, makePlayerState, PLAYER_MINS, PLAYER_MAXS } from '../src/sim/pmove.js';
import { buildNav } from '../src/sim/nav.js';
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['bastion', 'cistern', 'skywalk', 'spire', 'vigil', 'orbit'];
let bad = 0;
for (const name of names) {
  const def = (await import(`../src/maps/${name}.js`)).default;
  const map = buildMap(def);
  const col = new CollisionWorld(map.brushes);
  console.log(`== ${name}`);
  def.spawns.forEach((s, si) => {
    const o = [s.at[0], s.at[1] + 25, s.at[2]];
    const tr = col.trace(o, o, PLAYER_MINS, PLAYER_MAXS, MASK_PLAYER);
    const free = [];
    for (let k = 0; k < 8; k++) {
      const ps = makePlayerState(); ps.origin = [...o];
      const yaw = k * 45;
      for (let t = 0; t < 0.6; t += 1 / 125) pmove(ps, { forward: 1, side: 0, jump: false, crouch: false, pitch: 0, yaw, time: t * 1000 }, 1 / 125, col), ps.events.length = 0;
      if (Math.hypot(ps.origin[0] - o[0], ps.origin[2] - o[2]) > 40) free.push(yaw);
    }
    if (tr.startsolid || free.length < 2) { bad++; console.log(`  spawn #${si} @${s.at} ${tr.startsolid ? 'IN SOLID' : ''} free dirs: [${free}]`); }
  });
  const nav = buildNav(map, col);
  const N = nav.nodes.length;
  const starts = def.spawns.map((s) => nav.nearest(s.at, col)).filter(Boolean).map((n) => n.i);
  const fwd = new Uint8Array(N), back = new Uint8Array(N);
  const rev = Array.from({ length: N }, () => []);
  for (const n of nav.nodes) for (const l of n.links) rev[l.to].push(n.i);
  const flood = (seen, adj) => { const st = [...starts]; for (const s of st) seen[s] = 1; while (st.length) { const c = st.pop(); for (const t of adj(c)) if (!seen[t]) { seen[t] = 1; st.push(t); } } };
  flood(fwd, (c) => nav.nodes[c].links.map((l) => l.to));
  flood(back, (c) => rev[c]);
  // group bad nodes by space
  const groups = new Map();
  for (const n of nav.nodes) {
    const kind = !fwd[n.i] ? 'unreachable' : !back[n.i] ? 'trap' : null;
    if (!kind) continue;
    let sp = -1;
    def.spaces.forEach((s, i) => { const b = s.b; if (n.p[0] >= b[0] && n.p[0] <= b[3] && n.p[1] >= b[1] - 1 && n.p[1] <= b[4] && n.p[2] >= b[2] && n.p[2] <= b[5]) sp = i; });
    const key = `${kind} space#${sp}${sp >= 0 && def.spaces[sp].name ? ' ' + def.spaces[sp].name : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n.p.map(Math.round).join(','));
  }
  for (const [k, v] of groups) console.log(`  ${k}: ${v.length} nodes  e.g. ${v.slice(0, 6).join(' | ')}`);
}
process.exit(bad ? 1 : 0);
