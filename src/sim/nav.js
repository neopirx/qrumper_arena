// Automatic navigation graph: sample walkable floor points on a grid, then link neighbours by
// actually simulating player movement (walk / jump / drop / jump pad / teleporter) between them.
import { brushFaces, CONTENTS_SOLID, MASK_PLAYER } from './collision.js';
import { pmove, makePlayerState, PLAYER_MINS, PLAYER_MAXS } from './pmove.js';
import { yawTo } from './vec.js';
import { launchVelocity } from './game.js';

const G = 48;

export function buildNav(map, col) {
  const nodes = [];
  const byKey = new Map();
  const cell = (x, z) => `${Math.round(x / G)},${Math.round(z / G)}`;
  const cells = new Map();

  const pads = map.jumppads.map((j) => ({ ...j, vel: launchVelocity(j) }));
  const teles = map.teleporters;

  const hazards = map.hazards || [];
  function addNode(x, y0, z) {
    // never stand in slime / lava
    for (const h of hazards) if (x > h.min[0] - 16 && x < h.max[0] + 16 && z > h.min[2] - 16 && z < h.max[2] + 16 && y0 > h.min[1] - 24 && y0 < h.max[1]) return;
    // allow lifting by up to a step height (narrow stair treads can't hold the player box)
    let y = null;
    for (const lift of [0, 6, 12, 18]) {
      const o = [x, y0 + lift + 24.25, z];
      const tr = col.trace(o, o, PLAYER_MINS, PLAYER_MAXS, MASK_PLAYER);
      if (tr.startsolid || tr.allsolid) continue;
      const down = col.trace(o, [x, o[1] - 20, z], PLAYER_MINS, PLAYER_MAXS, MASK_PLAYER);
      if (down.fraction >= 1 || down.normal[1] < 0.7) continue;
      y = down.endpos[1] - 24.25 + 0.125;
      break;
    }
    if (y === null) return;
    y = Math.round(y * 8) / 8;
    const key = `${Math.round(x / G)},${Math.round(z / G)},${Math.round(y / 12)}`;
    if (byKey.has(key)) return;
    const n = { i: nodes.length, p: [x, y, z], links: [], pad: null, tele: null };
    for (const pd of pads) if (inXZ(x, z, pd.min, pd.max) && Math.abs(y - pd.at[1]) < 8) n.pad = pd;
    for (const t of teles) if (inXZ(x, z, t.min, t.max) && Math.abs(y - t.at[1]) < 8) n.tele = t;
    nodes.push(n);
    byKey.set(key, n);
    const ck = cell(x, z);
    if (!cells.has(ck)) cells.set(ck, []);
    cells.get(ck).push(n);
  }

  for (const b of map.brushes) {
    if (!(b.contents & CONTENTS_SOLID)) continue;
    for (const f of brushFaces(b)) {
      const n = f.plane.n;
      if (n[1] < 0.7) continue;
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (const p of f.pts) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mnz = Math.min(mnz, p[2]); mxz = Math.max(mxz, p[2]); }
      for (let gx = Math.ceil(mnx / G) * G; gx <= mxx; gx += G) {
        for (let gz = Math.ceil(mnz / G) * G; gz <= mxz; gz += G) {
          // nudge samples away from the polygon edge a bit
          const px = clampIn(gx, mnx + 16, mxx - 16), pz = clampIn(gz, mnz + 16, mxz - 16);
          if (!pointInPolyXZ(f.pts, px, pz)) continue;
          const y = (f.plane.d - n[0] * px - n[2] * pz) / n[1];
          addNode(px, y, pz);
        }
      }
    }
  }
  // extra nodes at item / pad / teleporter locations so goals are reachable exactly
  for (const it of map.items) addNode(it.at[0], it.at[1], it.at[2]);
  for (const p of pads) addNode(p.at[0], p.at[1], p.at[2]);
  for (const t of teles) addNode(t.at[0], t.at[1], t.at[2]);

  const sim = new LinkSim(col, pads, teles);

  for (const a of nodes) {
    if (a.pad) {
      const land = sim.flight(a, a.pad.vel);
      const b = land && nearestNode(land, nodes, cells, col);
      if (b && b !== a) a.links.push({ to: b.i, cost: 200, type: 'pad' });
      continue;
    }
    if (a.tele) {
      const b = nearestNode([a.tele.dest[0], a.tele.dest[1], a.tele.dest[2]], nodes, cells, col);
      if (b) a.links.push({ to: b.i, cost: 32, type: 'tele' });
      continue;
    }
    const cx = Math.round(a.p[0] / G), cz = Math.round(a.p[2] / G);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const list = cells.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const b of list) {
        if (b === a) continue;
        const dy = b.p[1] - a.p[1];
        const hd = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
        if (hd > (dy < -18 ? G * 3.2 : G * 2.1)) continue;
        if (hd > G * 1.5 + 1 && Math.abs(dy) < 2) continue; // flat: nearer nodes already cover it
        if (dy > 64 || dy < -480) continue;
        let type = null;
        if (Math.abs(dy) <= 18 && sim.walk(a, b, false)) type = 'walk';
        else if (dy > 4 && sim.walk(a, b, true)) type = 'jump';
        else if (dy < -18 && sim.walk(a, b, false)) type = 'drop';
        if (type) a.links.push({ to: b.i, cost: Math.hypot(hd, dy * 0.5) + (type === 'jump' ? 24 : 0), type });
      }
    }
  }
  return new NavGraph(nodes, cells);
}

function clampIn(v, a, b) { return a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v)); }
function inXZ(x, z, mn, mx) { return x >= mn[0] && x <= mx[0] && z >= mn[2] && z <= mx[2]; }
function pointInPolyXZ(pts, x, z) {
  let sgn = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const c = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
    if (Math.abs(c) < 1e-6) continue;
    const s = c > 0 ? 1 : -1;
    if (sgn === 0) sgn = s; else if (s !== sgn) return false;
  }
  return true;
}

function nearestNode(p, nodes, cells, col, maxDist = 200) {
  const cx = Math.round(p[0] / G), cz = Math.round(p[2] / G);
  let best = null, bd = maxDist;
  for (let r = 0; r <= 3; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const list = cells.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const n of list) {
        const dy = n.p[1] - p[1];
        if (dy > 40 || dy < -80) continue;
        const d = Math.hypot(n.p[0] - p[0], dy * 2, n.p[2] - p[2]);
        if (d < bd) { bd = d; best = n; }
      }
    }
    if (best && r >= 1) break;
  }
  return best;
}

class LinkSim {
  constructor(col, pads, teles) { this.col = col; this.pads = pads; this.teles = teles; }
  walk(a, b, jump) {
    const ps = makePlayerState();
    ps.origin = [a.p[0], a.p[1] + 24.25, a.p[2]];
    ps.onGround = true;
    const dt = 1 / 60;
    const hd = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
    const maxT = 0.35 + hd / 250 + (b.p[1] < a.p[1] ? Math.sqrt(2 * (a.p[1] - b.p[1]) / 800) : 0);
    const cmd = { forward: 1, side: 0, jump: false, crouch: false, pitch: 0, yaw: 0, time: 0, walljumpOnJump: false };
    let wasAir = false;
    for (let t = 0; t < maxT; t += dt) {
      cmd.yaw = yawTo(b.p[0] - ps.origin[0], b.p[2] - ps.origin[2]);
      cmd.jump = jump && t < dt * 2;
      cmd.time = t * 1000;
      const hd2 = Math.hypot(b.p[0] - ps.origin[0], b.p[2] - ps.origin[2]);
      if (hd2 < 6) cmd.forward = 0;
      pmove(ps, cmd, dt, this.col);
      ps.events.length = 0;
      if (b.pad && inXZ(ps.origin[0], ps.origin[2], b.pad.min, b.pad.max) && ps.origin[1] - 24 < b.pad.max[1] + 2) return true;
      if (b.tele && inXZ(ps.origin[0], ps.origin[2], b.tele.min, b.tele.max) && ps.origin[1] - 24 < b.tele.max[1]) return true;
      // touching some other trigger on the way invalidates the link
      for (const p of this.pads) if (p !== b.pad && inXZ(ps.origin[0], ps.origin[2], p.min, p.max) && ps.origin[1] - 24 < p.max[1]) return false;
      const feet = ps.origin[1] - 24.25;
      const hdb = Math.hypot(b.p[0] - ps.origin[0], b.p[2] - ps.origin[2]);
      if (ps.onGround && Math.abs(feet - b.p[1]) < 3 && (hdb < 14 || (wasAir && hdb < 40))) return true;
      // descending (stairs): landing a step or two below the target, right next to it, is fine
      if (ps.onGround && wasAir && b.p[1] < a.p[1] && feet < b.p[1] && feet > b.p[1] - 34 && hdb < 40) return true;
      if (!ps.onGround) wasAir = true;
    }
    return false;
  }
  flight(a, vel) {
    const ps = makePlayerState();
    ps.origin = [a.p[0], a.p[1] + 24.25, a.p[2]];
    ps.velocity = [...vel];
    const dt = 1 / 60;
    const cmd = { forward: 0, side: 0, jump: false, crouch: false, pitch: 0, yaw: 0, time: 0 };
    for (let t = 0; t < 4; t += dt) {
      pmove(ps, cmd, dt, this.col);
      ps.events.length = 0;
      if (t > 0.1 && ps.onGround) return [ps.origin[0], ps.origin[1] - 24.25, ps.origin[2]];
    }
    return null;
  }
}

export class NavGraph {
  constructor(nodes, cells) {
    this.nodes = nodes; this.cells = cells;
    this.stamp = new Int32Array(nodes.length);
    this.g = new Float64Array(nodes.length);
    this.from = new Int32Array(nodes.length);
    this.query = 0;
  }
  nearest(p, col) { return nearestNode(p, this.nodes, this.cells, col); }

  // A* from node a to node b. Returns array of node indices (including both ends) or null.
  path(a, b) {
    if (a === b) return [a];
    const q = ++this.query;
    const nodes = this.nodes, g = this.g, from = this.from, stamp = this.stamp;
    const heap = new Heap();
    const goal = nodes[b].p;
    const h = (i) => { const p = nodes[i].p; return Math.hypot(p[0] - goal[0], p[1] - goal[1], p[2] - goal[2]) * 0.5; };
    stamp[a] = q; g[a] = 0; from[a] = -1;
    heap.push(a, h(a));
    const closed = new Set();
    while (heap.size) {
      const cur = heap.pop();
      if (cur === b) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const l of nodes[cur].links) {
        const ng = g[cur] + l.cost;
        if (stamp[l.to] !== q || ng < g[l.to]) {
          stamp[l.to] = q; g[l.to] = ng; from[l.to] = cur;
          heap.push(l.to, ng + h(l.to));
        }
      }
    }
    if (stamp[b] !== q) return null;
    const out = [];
    for (let c = b; c !== -1; c = from[c]) out.push(c);
    return out.reverse();
  }

  // Dijkstra distances from a node to all nodes (for item goal evaluation).
  distances(a, maxCost = 6000) {
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const heap = new Heap();
    dist[a] = 0; heap.push(a, 0);
    while (heap.size) {
      const cur = heap.popWithKey(), d = heap.lastKey;
      if (d > dist[cur]) continue;
      if (d > maxCost) break;
      for (const l of this.nodes[cur].links) {
        const nd = d + l.cost;
        if (nd < dist[l.to]) { dist[l.to] = nd; heap.push(l.to, nd); }
      }
    }
    return dist;
  }

  linkType(a, b) {
    for (const l of this.nodes[a].links) if (l.to === b) return l.type;
    return null;
  }
}

class Heap {
  constructor() { this.k = new Float64Array(1024); this.v = new Int32Array(1024); this.n = 0; }
  get size() { return this.n; }
  push(v, key) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p];
      i = p;
    }
    K[i] = key; V[i] = v;
  }
  popWithKey() {
    const K = this.k, V = this.v;
    const rv = V[0], rk = K[0];
    const n = --this.n;
    if (n > 0) {
      const lk = K[n], lv = V[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && K[r] < K[l] ? r : l;
        if (K[m] >= lk) break;
        K[i] = K[m]; V[i] = V[m];
        i = m;
      }
      K[i] = lk; V[i] = lv;
    }
    this.lastKey = rk;
    return rv;
  }
  pop() { return this.popWithKey(); }
}
