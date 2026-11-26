// Map construction: rooms ("spaces") are carved out of a solid world block (box CSG subtraction),
// then detail brushes (pillars, platforms, stairs, ramps) are added. Structural faces take their
// texture from the space they face, so a room definition fully describes its look.
//
// Trim-sheet style (visual spec 5.1): a space can list horizontal wall bands, and structural
// solids are split at those heights so each band gets its own texture:
//   trim:  { h, tex }            band above the floor (skirting, hazard strip)
//   crown: { h, tex }            band below the ceiling
//   strip: { y, h, color, tex }  fullbright light strip at height y above the floor
// Detail boxes are chamfered (vertical edges, and top edges unless `flat`), with the bevel faces
// in `bevelTex` (default: riveted metal trim) so every edge catches the light.
import { makeBrush, CONTENTS_PLAYERCLIP, CONTENTS_SOLID } from '../sim/collision.js';

const boxOverlap = (a, b) => a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];

function subtractBox(a, c) {
  if (!boxOverlap(a, c)) return [a];
  const out = [];
  let mn = [...a.min], mx = [...a.max];
  for (let ax = 0; ax < 3; ax++) {
    if (c.min[ax] > mn[ax]) {
      const pmx = [...mx]; pmx[ax] = c.min[ax];
      out.push({ min: [...mn], max: pmx });
      mn[ax] = c.min[ax];
    }
    if (c.max[ax] < mx[ax]) {
      const pmn = [...mn]; pmn[ax] = c.max[ax];
      out.push({ min: pmn, max: [...mx] });
      mx[ax] = c.max[ax];
    }
  }
  return out;
}

const B = (b) => ({ min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] });

export function buildMap(def) {
  const W = B(def.world);
  let solids = [W];
  for (const sp of def.spaces) {
    const c = B(sp.b);
    const next = [];
    for (const s of solids) for (const r of subtractBox(s, c)) next.push(r);
    solids = next;
  }
  const spaces = def.spaces.map((sp) => ({ ...B(sp.b), floor: sp.floor || def.defaults.floor, wall: sp.wall || def.defaults.wall, ceil: sp.ceil || def.defaults.ceil, sky: !!sp.sky, trim: sp.trim, crown: sp.crown, strip: [].concat(sp.strip || []) }));

  // split structural solids at the band heights of the spaces they bound
  for (const sp of def.spaces) {
    const levels = [];
    const y0 = sp.b[1], y1 = sp.b[4];
    if (sp.trim) levels.push(y0 + sp.trim.h);
    if (sp.crown) levels.push(y1 - sp.crown.h);
    for (const st of [].concat(sp.strip || [])) levels.push(y0 + st.y, y0 + st.y + st.h);
    if (!levels.length) continue;
    const near = { min: [sp.b[0] - 1, y0, sp.b[2] - 1], max: [sp.b[3] + 1, y1, sp.b[5] + 1] };
    for (const y of levels) {
      const next = [];
      for (const so of solids) {
        if (y > so.min[1] + 0.5 && y < so.max[1] - 0.5 && boxOverlap(so, near)) {
          next.push({ min: [...so.min], max: [so.max[0], y, so.max[2]] }, { min: [so.min[0], y, so.min[2]], max: [...so.max] });
        } else next.push(so);
      }
      solids = next;
    }
  }

  const brushes = [];
  for (const s of solids) brushes.push(makeBrush(s.min, s.max, [], { structural: true }));

  for (const d of def.solids || []) {
    for (const b of expandDetail(d)) brushes.push(b);
  }

  // Invisible player clip over the whole map at the world ceiling (keeps players in sky areas)
  const top = W.max[1];
  brushes.push(makeBrush([W.min[0], top, W.min[2]], [W.max[0], top + 64, W.max[2]], [], { contents: CONTENTS_PLAYERCLIP, invisible: true }));
  for (const c of def.clips || []) brushes.push(makeBrush([c[0], c[1], c[2]], [c[3], c[4], c[5]], [], { contents: CONTENTS_PLAYERCLIP, invisible: true }));

  // Resolve structural face textures from the space they face.
  function texFor(point, n) {
    let found = null;
    for (const sp of spaces) {
      if (point[0] >= sp.min[0] && point[0] <= sp.max[0] && point[1] >= sp.min[1] && point[1] <= sp.max[1] && point[2] >= sp.min[2] && point[2] <= sp.max[2]) found = sp;
    }
    const sp = found || { floor: def.defaults.floor, wall: def.defaults.wall, ceil: def.defaults.ceil };
    if (n[1] > 0.7) return sp.floor;
    if (n[1] < -0.7) return sp.ceil;
    const h = point[1] - sp.min[1];
    for (const st of sp.strip || []) if (h > st.y && h < st.y + st.h) return { tex: st.tex || 'proc_light', emit: st.color ?? 0xffffff };
    if (sp.trim && h < sp.trim.h) return sp.trim.tex;
    if (sp.crown && sp.max[1] - point[1] < sp.crown.h) return sp.crown.tex;
    return sp.wall;
  }

  return {
    def,
    name: def.name,
    brushes,
    spaces,
    texFor,
    bounds: W,
    lights: def.lights || [],
    items: def.items || [],
    spawns: def.spawns || [],
    jumppads: (def.jumppads || []).map((j) => ({ ...j, min: [j.at[0] - (j.size || 64) / 2, j.at[1], j.at[2] - (j.size || 64) / 2], max: [j.at[0] + (j.size || 64) / 2, j.at[1] + 12, j.at[2] + (j.size || 64) / 2] })),
    teleporters: (def.teleporters || []).map((t) => ({ ...t, min: [t.at[0] - 24, t.at[1], t.at[2] - 24], max: [t.at[0] + 24, t.at[1] + 72, t.at[2] + 24] })),
    // damaging volumes (slime / lava): { b: [x0,y0,z0,x1,y1,z1], dmg per second, mod }
    hazards: (def.hazards || []).map((h) => ({ min: [h.b[0], h.b[1], h.b[2]], max: [h.b[3], h.b[4], h.b[5]], dmg: h.dmg ?? 20, mod: h.mod || 'slime' })),
    sun: def.sun,
    ambient: def.ambient ?? 0.12,
    skyColor: def.skyColor,
    look: def.look,
  };
}

// 45 degree chamfer planes on the vertical edges and (unless d.flat) the top edges of a box.
// Size scales with the box so thin bridges get small bevels; huge slabs keep crisp corners.
function chamfers(mn, mx, d) {
  const sx = mx[0] - mn[0], sy = mx[1] - mn[1], sz = mx[2] - mn[2];
  const c = d.bevel ?? Math.min(6, Math.max(2, Math.min(sx, sy, sz) / 6));
  if (Math.min(sx, sz) < 4 * c) return [];
  const r = Math.SQRT1_2, out = [];
  if (Math.max(sx, sz) <= 640) {
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const px = ax > 0 ? mx[0] - c : mn[0] + c, pz = az > 0 ? mx[2] : mn[2];
      out.push({ n: [ax * r, 0, az * r], d: (ax * px + az * pz) * r });
    }
  }
  if (!d.flat && sy >= 3 * c) {
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [ax * r, r, az * r];
      const p = [ax > 0 ? mx[0] - c : ax < 0 ? mn[0] + c : 0, mx[1], az > 0 ? mx[2] - c : az < 0 ? mn[2] + c : 0];
      out.push({ n, d: n[0] * p[0] + n[1] * p[1] + n[2] * p[2] });
    }
  }
  return out;
}

// ---- detail brush helpers ----
// box:   { box:[x0,y0,z0,x1,y1,z1], tex }
// ramp:  { ramp:[x0,y0,z0,x1,y1,z1], up:'+x'|'-x'|'+z'|'-z', tex }  (top rises toward `up`)
// stairs:{ stairs:[x0,y0,z0,x1,y1,z1], up:'+x'..., tex, step }       (yields boxes)
function expandDetail(d) {
  const tex = d.tex;
  if (d.box) {
    const b = d.box;
    const mn = [b[0], b[1], b[2]], mx = [b[3], b[4], b[5]];
    const props = { tex, detail: true, scaleTex: d.scale, emit: d.emit, bevelTex: d.bevelTex || 'proc_trim' };
    return [makeBrush(mn, mx, d.bevel === false || d.emit != null ? [] : chamfers(mn, mx, d), props)];
  }
  if (d.ramp) {
    const b = d.ramp;
    const mn = [b[0], b[1], b[2]], mx = [b[3], b[4], b[5]];
    const a = d.up[1] === 'x' ? 0 : 2, s = d.up[0] === '+' ? 1 : -1;
    const h = mx[1] - mn[1], L = mx[a] - mn[a];
    const n = [0, L, 0]; n[a] = -s * h;
    const l = Math.hypot(n[0], n[1], n[2]);
    n[0] /= l; n[1] /= l; n[2] /= l;
    const low = s > 0 ? mn[a] : mx[a];
    const p = [0, mn[1], 0]; p[a] = low;
    const dd = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
    return [makeBrush(mn, mx, [{ n, d: dd }], { tex, detail: true, scaleTex: d.scale })];
  }
  if (d.stairs) {
    const b = d.stairs;
    const mn = [b[0], b[1], b[2]], mx = [b[3], b[4], b[5]];
    const a = d.up[1] === 'x' ? 0 : 2, s = d.up[0] === '+' ? 1 : -1;
    const H = mx[1] - mn[1];
    const n = Math.ceil(H / (d.step || 16));
    const L = mx[a] - mn[a];
    const out = [];
    for (let i = 0; i < n; i++) {
      const smn = [...mn], smx = [...mx];
      smx[1] = mn[1] + H * (i + 1) / n;
      if (s > 0) { smn[a] = mn[a] + L * i / n; smx[a] = mn[a] + L * (i + 1) / n; }
      else { smx[a] = mx[a] - L * i / n; smn[a] = mx[a] - L * (i + 1) / n; }
      out.push(makeBrush(smn, smx, [], { tex, detail: true, scaleTex: d.scale }));
    }
    return out;
  }
  // wedge: a box cut along its xz diagonal, keeping the corner named by `keep` ('+x+z', '-x+z',
  // '+x-z', '-x-z'). Fills room corners at 45° so halls read as octagons, not boxes.
  if (d.wedge) {
    const b = d.wedge;
    const mn = [b[0], b[1], b[2]], mx = [b[3], b[4], b[5]];
    const sx = d.keep[0] === '+' ? 1 : -1, sz = d.keep[2] === '+' ? 1 : -1;
    // plane through the two corners adjacent to the kept one; outward normal points away from it
    const r = Math.SQRT1_2, n = [-sx * r, 0, -sz * r];
    const p = [sx > 0 ? mn[0] : mx[0], 0, sz > 0 ? mx[2] : mn[2]];
    return [makeBrush(mn, mx, [{ n, d: n[0] * p[0] + n[2] * p[2] }], { tex, detail: true, scaleTex: d.scale })];
  }
  // cut: a box trimmed by arbitrary planes, each [nx, ny, nz, px, py, pz] = outward normal and a
  // point on the plane (the side the normal points to is removed). Sloped ceilings, angled sills.
  if (d.cut) {
    const b = d.cut;
    const planes = d.planes.map(([nx, ny, nz, px, py, pz]) => { const l = Math.hypot(nx, ny, nz); const n = [nx / l, ny / l, nz / l]; return { n, d: n[0] * px + n[1] * py + n[2] * pz }; });
    return [makeBrush([b[0], b[1], b[2]], [b[3], b[4], b[5]], planes, { tex, detail: true, scaleTex: d.scale, emit: d.emit })];
  }
  // arch: door frame in a wall plane. `arch: [x0, y0, z0, x1, y1, z1]` is the opening; along
  // `axis` ('x' = the door is crossed along x) it gets two jambs and a lintel with 45° haunches.
  if (d.arch) {
    const [x0, y0, z0, x1, y1, z1] = d.arch;
    const t = d.thick ?? 16, j = d.jamb ?? 16, hh = d.haunch ?? 24;
    const out = [];
    const props = { tex, detail: true, bevelTex: d.bevelTex || 'proc_trim' };
    if (d.axis === 'x') {
      out.push(makeBrush([x0 - t, y0, z0 - j], [x1 + t, y1, z0], [], props));
      out.push(makeBrush([x0 - t, y0, z1], [x1 + t, y1, z1 + j], [], props));
      out.push(makeBrush([x0 - t, y1 - 16, z0 - j], [x1 + t, y1 + 16, z1 + j], [], props));
      const r = Math.SQRT1_2;
      out.push(makeBrush([x0 - t + 2, y1 - hh, z0], [x1 + t - 2, y1, z0 + hh], [{ n: [0, -r, r], d: (-(y1 - hh) + z0) * r }], props));
      out.push(makeBrush([x0 - t + 2, y1 - hh, z1 - hh], [x1 + t - 2, y1, z1], [{ n: [0, -r, -r], d: (-(y1 - hh) - z1) * r }], props));
    } else {
      out.push(makeBrush([x0 - j, y0, z0 - t], [x0, y1, z1 + t], [], props));
      out.push(makeBrush([x1, y0, z0 - t], [x1 + j, y1, z1 + t], [], props));
      out.push(makeBrush([x0 - j, y1 - 16, z0 - t], [x1 + j, y1 + 16, z1 + t], [], props));
      const r = Math.SQRT1_2;
      out.push(makeBrush([x0, y1 - hh, z0 - t + 2], [x0 + hh, y1, z1 + t - 2], [{ n: [r, -r, 0], d: (x0 - (y1 - hh)) * r }], props));
      out.push(makeBrush([x1 - hh, y1 - hh, z0 - t + 2], [x1, y1, z1 + t - 2], [{ n: [-r, -r, 0], d: (-x1 - (y1 - hh)) * r }], props));
    }
    return out;
  }
  if (d.clip) {
    const b = d.clip;
    return [makeBrush([b[0], b[1], b[2]], [b[3], b[4], b[5]], [], { contents: CONTENTS_PLAYERCLIP, invisible: true })];
  }
  return [];
}
export { CONTENTS_SOLID };
