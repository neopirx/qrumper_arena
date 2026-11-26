import { buildMap } from '../src/maps/builder.js';
import { Game } from '../src/sim/game.js';
import { buildNav } from '../src/sim/nav.js';
const name = process.argv[2] || 'bastion';
const def = (await import(`../src/maps/${name}.js`)).default;
const map = buildMap(def); const game = new Game(map); const nav = buildNav(map, game.col);
// strongly connected components (Kosaraju-ish via forward/backward reach from biggest)
const N = nav.nodes.length;
const rev = Array.from({ length: N }, () => []);
for (const n of nav.nodes) for (const l of n.links) rev[l.to].push(n.i);
function reach(start, adj) { const seen = new Uint8Array(N); const st = [start]; seen[start] = 1; while (st.length) { const c = st.pop(); for (const x of adj(c)) if (!seen[x]) { seen[x] = 1; st.push(x); } } return seen; }
const comp = new Int32Array(N).fill(-1); let nc = 0; const sizes = [];
for (let i = 0; i < N; i++) {
  if (comp[i] >= 0) continue;
  const f = reach(i, c => nav.nodes[c].links.map(l => l.to)), b = reach(i, c => rev[c]);
  let s = 0; for (let j = 0; j < N; j++) if (f[j] && b[j] && comp[j] < 0) { comp[j] = nc; s++; }
  sizes.push(s); nc++;
}
const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
console.log('components (size):', order.slice(0, 12).map(x => x[0]).join(' '));
for (const [s, c] of order.slice(0, 8)) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let j = 0; j < N; j++) if (comp[j] === c) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], nav.nodes[j].p[k]); mx[k] = Math.max(mx[k], nav.nodes[j].p[k]); }
  console.log(`comp size ${s}: x[${mn[0]},${mx[0]}] y[${mn[1]},${mx[1]}] z[${mn[2]},${mx[2]}]`);
}
if (process.argv[3]) {
  const p = JSON.parse(process.argv[3]);
  const n = nav.nearest(p, game.col);
  console.log('node', n.i, n.p, 'comp', comp[n.i], 'links', n.links.map(l => l.type + '->' + nav.nodes[l.to].p.map(Math.round)));
}
if (process.argv[4]) {
  const [x0, x1, z0, z1] = JSON.parse(process.argv[4]);
  for (const n of nav.nodes) if (n.p[0] >= x0 && n.p[0] <= x1 && n.p[2] >= z0 && n.p[2] <= z1)
    console.log(n.i, n.p.map(v => Math.round(v * 10) / 10).join(','), 'comp', comp[n.i], n.links.map(l => l.type[0] + nav.nodes[l.to].p.map(Math.round).join(',')).join(' '));
}
