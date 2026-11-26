// Quake 3 style brush collision: every solid is a convex brush (set of planes),
// boxes are swept against brushes by expanding planes by the box extents (CM_TraceThroughBrush).
import { dot } from './vec.js';

export const CONTENTS_SOLID = 1;
export const CONTENTS_PLAYERCLIP = 2;
export const MASK_PLAYER = CONTENTS_SOLID | CONTENTS_PLAYERCLIP;
export const MASK_SHOT = CONTENTS_SOLID;
const SURF_EPS = 0.125;

// Plane: n·p = d ; brush interior is where n·p - d <= 0 for all planes.
export function makeBrush(min, max, extraPlanes = [], props = {}) {
  const planes = [
    { n: [1, 0, 0], d: max[0] }, { n: [-1, 0, 0], d: -min[0] },
    { n: [0, 1, 0], d: max[1] }, { n: [0, -1, 0], d: -min[1] },
    { n: [0, 0, 1], d: max[2] }, { n: [0, 0, -1], d: -min[2] },
  ];
  for (const p of extraPlanes) planes.push(p);
  return { min: [...min], max: [...max], planes, contents: CONTENTS_SOLID, stamp: 0, ...props };
}

export function planeFromPoints(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]);
  n[0] /= l; n[1] /= l; n[2] /= l;
  return { n, d: dot(n, a) };
}

const CELL = 128;

export class CollisionWorld {
  constructor(brushes) {
    this.brushes = brushes;
    this.queryId = 1;
    let mn = [1e9, 1e9], mx = [-1e9, -1e9];
    for (const b of brushes) {
      mn[0] = Math.min(mn[0], b.min[0]); mn[1] = Math.min(mn[1], b.min[2]);
      mx[0] = Math.max(mx[0], b.max[0]); mx[1] = Math.max(mx[1], b.max[2]);
    }
    this.ox = Math.floor(mn[0] / CELL) - 1; this.oz = Math.floor(mn[1] / CELL) - 1;
    this.nx = Math.floor(mx[0] / CELL) - this.ox + 2; this.nz = Math.floor(mx[1] / CELL) - this.oz + 2;
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    for (const b of brushes) {
      const x0 = this.cx(b.min[0]), x1 = this.cx(b.max[0]), z0 = this.cz(b.min[2]), z1 = this.cz(b.max[2]);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.nx + x].push(b);
    }
    this._tr = { fraction: 1, endpos: [0, 0, 0], normal: [0, 0, 0], plane: null, brush: null, startsolid: false, allsolid: false };
  }
  cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor(x / CELL) - this.ox)); }
  cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor(z / CELL) - this.oz)); }

  // Gather candidate brushes overlapping an AABB; calls fn(brush).
  query(mn, mx, fn) {
    const id = ++this.queryId;
    const x0 = this.cx(mn[0]), x1 = this.cx(mx[0]), z0 = this.cz(mn[2]), z1 = this.cz(mx[2]);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const cell = this.cells[z * this.nx + x];
      for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (b.stamp === id) continue;
        b.stamp = id;
        if (b.min[0] > mx[0] || b.max[0] < mn[0] || b.min[1] > mx[1] || b.max[1] < mn[1] || b.min[2] > mx[2] || b.max[2] < mn[2]) continue;
        if (fn(b) === false) return;
      }
    }
  }

  // Sweep box [mins,maxs] from start to end. Returns a shared result object unless `out` is given.
  trace(start, end, mins, maxs, mask = MASK_PLAYER, out) {
    const tr = out || this._tr;
    tr.fraction = 1; tr.plane = null; tr.brush = null; tr.startsolid = false; tr.allsolid = false;
    tr.normal[0] = tr.normal[1] = tr.normal[2] = 0;
    const mn = [Math.min(start[0], end[0]) + mins[0] - 1, Math.min(start[1], end[1]) + mins[1] - 1, Math.min(start[2], end[2]) + mins[2] - 1];
    const mx = [Math.max(start[0], end[0]) + maxs[0] + 1, Math.max(start[1], end[1]) + maxs[1] + 1, Math.max(start[2], end[2]) + maxs[2] + 1];
    this.query(mn, mx, (b) => {
      if (!(b.contents & mask)) return;
      traceBrush(tr, b, start, end, mins, maxs);
      if (tr.allsolid) return false;
    });
    const f = tr.fraction;
    tr.endpos[0] = start[0] + (end[0] - start[0]) * f;
    tr.endpos[1] = start[1] + (end[1] - start[1]) * f;
    tr.endpos[2] = start[2] + (end[2] - start[2]) * f;
    if (tr.plane) { tr.normal[0] = tr.plane.n[0]; tr.normal[1] = tr.plane.n[1]; tr.normal[2] = tr.plane.n[2]; }
    return tr;
  }

  // Fast boolean line-of-sight test (ignores brushes the start point is inside).
  visible(a, b, mask = MASK_SHOT) {
    const tr = this.trace(a, b, ZERO, ZERO, mask, scratchTr);
    return tr.fraction >= 1 || (tr.startsolid && !tr.plane);
  }

  pointContents(p, mask = MASK_PLAYER) {
    let solid = false;
    this.query(p, p, (b) => {
      if (!(b.contents & mask)) return;
      for (const pl of b.planes) if (dot(pl.n, p) - pl.d > 0) return;
      solid = true; return false;
    });
    return solid;
  }
}

const ZERO = [0, 0, 0];
const scratchTr = { fraction: 1, endpos: [0, 0, 0], normal: [0, 0, 0], plane: null, brush: null, startsolid: false, allsolid: false };
export { ZERO };

function traceBrush(tr, brush, start, end, mins, maxs) {
  let enterFrac = -1, leaveFrac = 1, clipPlane = null;
  let getout = false, startout = false;
  const planes = brush.planes;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i], n = p.n;
    // box corner most "behind" the plane
    const ox = n[0] < 0 ? maxs[0] : mins[0];
    const oy = n[1] < 0 ? maxs[1] : mins[1];
    const oz = n[2] < 0 ? maxs[2] : mins[2];
    const dist = p.d - (ox * n[0] + oy * n[1] + oz * n[2]);
    const d1 = start[0] * n[0] + start[1] * n[1] + start[2] * n[2] - dist;
    const d2 = end[0] * n[0] + end[1] * n[1] + end[2] * n[2] - dist;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    if (d1 > 0 && (d2 >= SURF_EPS || d2 >= d1)) return; // completely in front of face
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) {
      let f = (d1 - SURF_EPS) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enterFrac) { enterFrac = f; clipPlane = p; }
    } else {
      let f = (d1 + SURF_EPS) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leaveFrac) leaveFrac = f;
    }
  }
  if (!startout) {
    tr.startsolid = true;
    if (!getout) { tr.allsolid = true; tr.fraction = 0; tr.brush = brush; }
    return;
  }
  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction) {
    if (enterFrac < 0) enterFrac = 0;
    tr.fraction = enterFrac;
    tr.plane = clipPlane;
    tr.brush = brush;
  }
}

// Ray vs axis-aligned box (for hitscan vs players). Returns entry fraction or -1.
export function rayBox(start, dir, maxDist, bmin, bmax) {
  let tmin = 0, tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (start[i] < bmin[i] || start[i] > bmax[i]) return -1;
    } else {
      let t1 = (bmin[i] - start[i]) / dir[i], t2 = (bmax[i] - start[i]) / dir[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// ---- Brush windings (polygons of each face) — used by renderer and nav generation ----
export function brushFaces(brush) {
  const faces = [];
  const planes = brush.planes;
  for (let i = 0; i < planes.length; i++) {
    let w = baseWinding(planes[i]);
    for (let j = 0; j < planes.length && w; j++) {
      if (i === j) continue;
      // keep the part behind plane j
      const pj = planes[j];
      if (dot(pj.n, planes[i].n) > 0.9999 && Math.abs(pj.d - planes[i].d) < 0.01) { if (j < i) { w = null; } continue; }
      w = clipWinding(w, pj.n, pj.d);
    }
    if (w && w.length >= 3 && windingArea(w) > 0.5) faces.push({ plane: planes[i], pts: w, brush });
  }
  return faces;
}

function baseWinding(p) {
  const n = p.n;
  let ax = 0, m = -1;
  for (let i = 0; i < 3; i++) if (Math.abs(n[i]) > m) { m = Math.abs(n[i]); ax = i; }
  let up = ax === 1 ? [0, 0, 1] : [0, 1, 0];
  const d = dot(up, n);
  up = [up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d];
  let l = Math.hypot(...up); up = up.map((x) => x / l);
  const org = [n[0] * p.d, n[1] * p.d, n[2] * p.d];
  const r = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const S = 65536;
  const pt = (a, b) => [org[0] + r[0] * a * S + up[0] * b * S, org[1] + r[1] * a * S + up[1] * b * S, org[2] + r[2] * a * S + up[2] * b * S];
  // counter-clockwise when viewed from the front (normal toward viewer)
  return [pt(-1, 1), pt(-1, -1), pt(1, -1), pt(1, 1)].reverse();
}

function clipWinding(w, n, d) {
  const out = [];
  const dists = w.map((p) => dot(n, p) - d);
  for (let i = 0; i < w.length; i++) {
    const p = w[i], dp = dists[i];
    const q = w[(i + 1) % w.length], dq = dists[(i + 1) % w.length];
    if (dp <= 0.01) out.push(p);
    if ((dp > 0.01 && dq < -0.01) || (dp < -0.01 && dq > 0.01)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  if (out.length < 3) return null;
  // snap to 1/8 unit to kill float noise
  for (const p of out) for (let k = 0; k < 3; k++) p[k] = Math.round(p[k] * 8) / 8;
  return out;
}

function windingArea(w) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i < w.length - 1; i++) {
    const a = w[0], b = w[i], c = w[i + 1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    ax += u[1] * v[2] - u[2] * v[1]; ay += u[2] * v[0] - u[0] * v[2]; az += u[0] * v[1] - u[1] * v[0];
  }
  return 0.5 * Math.hypot(ax, ay, az);
}
