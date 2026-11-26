// World geometry + baked lighting (Quake 3 style lightmaps with "deluxemap" light directions so
// the texture normal maps respond to the baked lights), plus a light grid for lighting models.
import * as THREE from 'three';
import { brushFaces, CONTENTS_SOLID, MASK_SHOT } from '../sim/collision.js';
import { dot } from '../sim/vec.js';
import { dynLights, shared, toneGLSL } from './shared.js';
import { texScale } from './textures.js';
export { dynLights } from './shared.js';
export { TextureBank } from './textures.js';

const LM_TEXEL = 12;      // world units per lightmap texel
const LM_RANGE = 4;       // lightmap stores 0..4: lit surfaces may blow out to flat white
const TEX_UNITS = 128;    // world units per texture repeat (256px textures => Q3 scale 0.5)
const GRID = 64;          // light grid spacing

const worldVert = /* glsl */`
attribute vec2 lmuv;
attribute vec4 tang;
attribute vec3 edge;
varying vec3 vEdge;
varying vec2 vUv;
varying vec2 vLm;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying float vFog;
void main() {
  vUv = uv; vLm = lmuv; vPos = position; vN = normal; vEdge = edge;
  vT = tang.xyz; vB = cross(normal, tang.xyz) * tang.w;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const worldFrag = /* glsl */`
uniform sampler2D map;
uniform sampler2D nmap;
uniform sampler2D lmap;
uniform sampler2D dmap;
uniform vec4 dlPos[8];
uniform vec3 dlCol[8];
uniform int dlCount;
uniform float nmStrength;
uniform float brightness;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float gradeSat;
uniform vec3 gradeTint;
uniform vec3 emit;
uniform float fullbright;
uniform float time;
uniform float specAmt;
uniform float scrollV;
uniform float dynOn;
uniform sampler2D shAll;
uniform sampler2D shWorld;
uniform mat4 shMat;
uniform vec3 sunL;
uniform float sunK;
uniform vec4 lampPos[8];
uniform vec3 lampCol[8];
uniform float lampFl[8];
uniform int lampCount;
varying vec2 vUv;
varying vec2 vLm;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying float vFog;
varying vec3 vEdge;
${toneGLSL}
float hash1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
void main() {
  vec2 uv = vUv + vec2(0.0, time * scrollV);   // flowing liquids (blood falls) scroll down
  vec3 alb = texture2D(map, uv).rgb;
  vec3 n0 = normalize(vN);
  if (fullbright > 0.5) {
    // emissive: ignores all lighting and rides past the clamp (flat glowing white core)
    float pulse = 0.92 + 0.08 * sin(time * 3.0 + vPos.x * 0.01 + vPos.z * 0.013);
    vec3 c = min(alb * emit * 2.4 * pulse, vec3(1.0));
    gl_FragColor = vec4(mix(c, fogColor, (1.0 - exp(-fogDensity * vFog)) * 0.6), 1.0);
    return;
  }
  // saturation is rationed: environment neutrals stay quiet so gameplay colours pop
  float lum = dot(alb, vec3(0.3, 0.55, 0.15));
  alb = mix(vec3(lum), alb, gradeSat) * gradeTint;
  float wall = 1.0 - abs(n0.y);
  // grime wash at floor-wall joins, streaked (drip direction is down)
  float join = 1.0 - smoothstep(0.0, 30.0, vEdge.x);
  float streak = hash1(floor((vPos.x + vPos.z) * 0.18));
  alb *= 1.0 - wall * join * join * (0.35 + 0.35 * streak);
  // painted bevel: raised detail edges catch the stage light, structural top corners go dark
  float top = 1.0 - smoothstep(0.0, 4.0, vEdge.y);
  alb *= 1.0 + vEdge.z * wall * top * 0.9;
  alb *= 1.0 - (1.0 - vEdge.z) * wall * (1.0 - smoothstep(0.0, 24.0, vEdge.y)) * 0.4;

  vec3 tn = texture2D(nmap, uv).xyz * 2.0 - 1.0;
  tn.y = -tn.y;                       // DirectX-style normal maps
  tn.xy *= nmStrength;
  vec3 N = normalize(normalize(vT) * tn.x + normalize(vB) * tn.y + n0 * tn.z);
  vec3 lm = texture2D(lmap, vLm).rgb * ${LM_RANGE.toFixed(1)};
  vec3 ld = texture2D(dmap, vLm).xyz * 2.0 - 1.0;
  float dl = length(ld);
  ld = dl > 0.001 ? ld / dl : n0;
  float ng = max(dot(n0, ld), 0.25);
  float nn = max(dot(N, ld), 0.0);
  float relief = mix(1.0, nn / ng, clamp(dl, 0.0, 1.0) * 0.85);
  vec3 light = lm * clamp(relief, 0.25, 1.8);
  // painted sheen: a tight highlight of the baked light direction on the normal-mapped surface,
  // stronger on bright (metal) texels, like the era's shiny-metal shader stages
  vec3 V = normalize(cameraPosition - vPos);
  float sheen = pow(max(dot(N, normalize(ld + V)), 0.0), 26.0) * clamp(dl, 0.0, 1.0) * (0.15 + lum * 0.9);
  light += lm * sheen * specAmt;
  if (dynOn > 0.5) {
    // real-time sun shadows of moving things (players, rockets, gibs): a texel is shadowed when
    // something in the all-objects depth map sits in front of it but the world alone doesn't
    vec3 sc = (shMat * vec4(vPos + n0 * 2.0, 1.0)).xyz * 0.5 + 0.5;
    if (sunK > 0.0 && sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      float sh = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(k == 1 ? 1.0 : k == 3 ? -1.0 : 0.0, k == 0 ? 1.0 : k == 2 ? -1.0 : 0.0) * 0.0006 + vec2(0.0003);
        float a = texture2D(shAll, sc.xy + o).r, w = texture2D(shWorld, sc.xy + o).r;
        sh += step(a, sc.z - 0.0006) * step(sc.z - 0.0006, w);
      }
      float facing = clamp(dot(n0, sunL) * 3.0, 0.0, 1.0);
      light *= 1.0 - sh * 0.25 * facing * sunK;
    }
    // per-pixel lamps: the bump relief and highlights follow the real lamp positions, and the
    // flickering ones breathe the light around them
    for (int i = 0; i < 8; i++) {
      if (i >= lampCount) break;
      vec3 L = lampPos[i].xyz - vPos;
      float d = length(L);
      float a = max(0.0, 1.0 - d / lampPos[i].w);
      a *= a;
      vec3 Ln = L / max(d, 0.001);
      float ndl = max(dot(N, Ln), 0.0);
      float rel = ndl - max(dot(n0, Ln), 0.0);
      float hl = pow(max(dot(N, normalize(Ln + V)), 0.0), 42.0) * (0.15 + lum);
      light += lampCol[i] * a * (rel * 1.3 + hl * specAmt * 1.4 + ndl * lampFl[i]);
    }
  }
  for (int i = 0; i < 8; i++) {
    if (i >= dlCount) break;
    vec3 L = dlPos[i].xyz - vPos;
    float d = length(L);
    float a = max(0.0, 1.0 - d / dlPos[i].w);
    light += dlCol[i] * a * a * max(dot(N, L / max(d, 0.001)), 0.0) * 2.0;
  }
  vec3 col = stageTone(alb * light * brightness);
  gl_FragColor = vec4(applyFog(col, vFog, fogColor, fogDensity), 1.0);
}`;

// ---------- polygon helpers ----------
function splitPoly(poly, n, d) {
  const front = [], back = [];
  const ds = poly.map((p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = ds[i], dq = ds[(i + 1) % poly.length];
    if (dp >= -0.01) front.push(p);
    if (dp <= 0.01) back.push(p);
    if ((dp > 0.01 && dq < -0.01) || (dp < -0.01 && dq > 0.01)) {
      const t = dp / (dp - dq);
      const m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      front.push(m); back.push(m);
    }
  }
  return [front.length >= 3 ? front : null, back.length >= 3 ? back : null];
}

function polyArea(w) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i < w.length - 1; i++) {
    const a = w[0], b = w[i], c = w[i + 1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    ax += u[1] * v[2] - u[2] * v[1]; ay += u[2] * v[0] - u[0] * v[2]; az += u[0] * v[1] - u[1] * v[0];
  }
  return 0.5 * Math.hypot(ax, ay, az);
}

// Remove parts of a face covered by other solid brushes in front of it.
function clipFaceByBrushes(face, col) {
  const n = face.plane.n;
  const off = 0.5;
  let frags = [face.pts.map((p) => [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off])];
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of frags[0]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  const others = [];
  col.query(mn, mx, (b) => { if (b !== face.brush && (b.contents & CONTENTS_SOLID) && !b.invisible) others.push(b); });
  for (const b of others) {
    const next = [];
    for (const frag of frags) {
      let rest = frag;
      const outs = [];
      for (const pl of b.planes) {
        const [f, bk] = splitPoly(rest, pl.n, pl.d);
        if (f) outs.push(f);
        rest = bk;
        if (!rest) break;
      }
      if (!rest) next.push(frag);                 // never inside the brush: keep whole
      else for (const o of outs) next.push(o);      // drop the covered part
    }
    frags = next;
    if (!frags.length) break;
  }
  return frags
    .map((f) => f.map((p) => [p[0] - n[0] * off, p[1] - n[1] * off, p[2] - n[2] * off]))
    .filter((f) => polyArea(f) > 1);
}

function axesFor(n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  // returns [uAxisIndex, vAxisIndex, dropAxis, uSign]
  if (ay >= ax && ay >= az) return [0, 2, 1, 1];
  if (ax >= az) return [2, 1, 0, n[0] > 0 ? -1 : 1];
  return [0, 1, 2, n[2] > 0 ? 1 : -1];
}

// ---------- shelf packer ----------
class Packer {
  constructor(w) { this.w = w; this.x = 0; this.y = 0; this.rowH = 0; }
  add(w, h) {
    if (this.x + w > this.w) { this.x = 0; this.y += this.rowH; this.rowH = 0; }
    const r = { x: this.x, y: this.y };
    this.x += w; this.rowH = Math.max(this.rowH, h);
    return r;
  }
  get height() { return this.y + this.rowH; }
}

function hexToRgb(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }

export class Lighting {
  constructor(map, col) {
    this.map = map; this.col = col;
    // radius is stretched a little: the quadratic falloff below is darker at mid range than the
    // old linear one, which is the point (pools of light, crushed gaps) but needs more reach
    this.lights = map.lights.map((l) => ({ p: [l[0], l[1], l[2]], c: hexToRgb(l[3]), r: l[4] * 1.35, i: l[5] ?? 1 }));
    const s = map.sun;
    if (s) {
      const l = Math.hypot(...s.dir);
      this.sun = { dir: s.dir.map((x) => x / l), c: s.color.map((x) => x * s.intensity), sky: s.sky };
    }
    this.ambient = map.ambient;
    this.ambientColor = map.look?.ambient || [1.0, 0.95, 0.9];
    // fixed hemisphere sample directions for AO / sky light
    this.hemi = [];
    for (let i = 0; i < 10; i++) {
      const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 10);
      this.hemi.push([Math.cos(a) * r, Math.sqrt(1 - r * r), Math.sin(a) * r]);
    }
    this.tr = { fraction: 1, endpos: [0, 0, 0], normal: [0, 0, 0] };
  }

  visible(a, b) {
    const tr = this.col.trace(a, b, Z3, Z3, MASK_SHOT, this.tr);
    return tr.fraction >= 1;
  }

  // Light arriving at point p with surface normal n. Writes rgb into out[0..2], direction into out[3..5].
  sample(p, n, out, isGrid = false) {
    let r = 0, g = 0, b = 0, dx = 0, dy = 0, dz = 0;
    const o = [p[0] + n[0] * 1.0, p[1] + n[1] * 1.0, p[2] + n[2] * 1.0];
    for (const L of this.lights) {
      const lx = L.p[0] - p[0], ly = L.p[1] - p[1], lz = L.p[2] - p[2];
      const d = Math.hypot(lx, ly, lz);
      if (d >= L.r) continue;
      let ndl = isGrid ? 0.8 : (lx * n[0] + ly * n[1] + lz * n[2]) / (d || 1);
      if (ndl <= 0) continue;
      if (!this.visible(o, L.p)) continue;
      // hard quadratic falloff (1/d^2, softened at the core) windowed to zero at the radius
      const rr = L.r * L.r, q = 1 - (d * d) / rr;
      const k = L.i * ndl * 2.4 * (rr / 9) / (d * d + rr / 100) * q * q;
      r += L.c[0] * k; g += L.c[1] * k; b += L.c[2] * k;
      const w = k / (d || 1);
      dx += lx * w; dy += ly * w; dz += lz * w;
    }
    // AO / sky visibility using a cosine distributed hemisphere around n
    let ao = 0, sky = 0;
    const t1 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tx = cross3(t1, n); norm3(tx);
    const tz = cross3(n, tx);
    for (const h of this.hemi) {
      const dir = [tx[0] * h[0] + n[0] * h[1] + tz[0] * h[2], tx[1] * h[0] + n[1] * h[1] + tz[1] * h[2], tx[2] * h[0] + n[2] * h[1] + tz[2] * h[2]];
      if (isGrid) { dir[0] = h[0]; dir[1] = h[1]; dir[2] = h[2]; }
      const near = [o[0] + dir[0] * 72, o[1] + dir[1] * 72, o[2] + dir[2] * 72];
      const tr = this.col.trace(o, near, Z3, Z3, MASK_SHOT, this.tr);
      if (tr.fraction >= 1) {
        ao += 1;
        if (this.sun && dir[1] > 0.05) {
          const far = [o[0] + dir[0] * 4000, o[1] + dir[1] * 4000, o[2] + dir[2] * 4000];
          if (this.visible(near, far)) sky += 1;
        }
      } else ao += tr.fraction * 0.6;
    }
    ao /= this.hemi.length; sky /= this.hemi.length;
    const amb = this.ambient * 1.6 * (0.35 + 0.65 * ao);
    const ac = this.ambientColor;
    r += amb * ac[0]; g += amb * ac[1]; b += amb * ac[2];
    if (this.sun) {
      const s = this.sun;
      const sk = sky * 0.55;
      r += s.sky[0] * sk; g += s.sky[1] * sk; b += s.sky[2] * sk;
      dy += sk * 0.5;
      const ndl = isGrid ? 0.8 : dot(n, s.dir);
      if (ndl > 0) {
        const far = [o[0] + s.dir[0] * 4000, o[1] + s.dir[1] * 4000, o[2] + s.dir[2] * 4000];
        if (this.visible(o, far)) {
          r += s.c[0] * ndl; g += s.c[1] * ndl; b += s.c[2] * ndl;
          dx += s.dir[0] * ndl; dy += s.dir[1] * ndl; dz += s.dir[2] * ndl;
        }
      }
    }
    // a little ambient term along the normal so directionality fades in dim, diffuse areas
    const lum = r * 0.3 + g * 0.5 + b * 0.2;
    dx += n[0] * amb * 0.5; dy += n[1] * amb * 0.5; dz += n[2] * amb * 0.5;
    const dl = Math.hypot(dx, dy, dz);
    const tot = lum + amb * 0.5 + 1e-6;
    out[0] = r; out[1] = g; out[2] = b;
    out[3] = dl > 0 ? dx / dl * Math.min(1, dl / tot) : 0;
    out[4] = dl > 0 ? dy / dl * Math.min(1, dl / tot) : 0;
    out[5] = dl > 0 ? dz / dl * Math.min(1, dl / tot) : 0;
  }
}
const Z3 = [0, 0, 0];
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; return a; }

// ---------- world build ----------
export async function buildWorld(map, col, bank, onProgress = () => {}) {
  const W = map.bounds;
  const faces = [];
  for (const brush of map.brushes) {
    if (brush.invisible) continue;
    for (const f of brushFaces(brush)) {
      const n = f.plane.n;
      // cull faces of structural brushes on the outside of the world
      const c = centroid(f.pts);
      const q = [c[0] + n[0] * 2, c[1] + n[1] * 2, c[2] + n[2] * 2];
      if (q[0] < W.min[0] || q[0] > W.max[0] || q[1] < W.min[1] || q[1] > W.max[1] || q[2] < W.min[2] || q[2] > W.max[2]) continue;
      for (const frag of clipFaceByBrushes(f, col)) {
        // orient counter-clockwise relative to the plane normal
        const pn = polyNormal(frag);
        if (dot(pn, n) < 0) frag.reverse();
        const cc = centroid(frag);
        let tex, emit = brush.emit;
        const axial = Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])) > 0.99;
        if (brush.structural) {
          tex = map.texFor([cc[0] + n[0] * 4, cc[1] + n[1] * 4, cc[2] + n[2] * 4], n);
          if (typeof tex === 'object') { emit = tex.emit; tex = tex.tex; }
        } else if (!axial && brush.bevelTex && !brush.isRamp) tex = brush.bevelTex;
        else if (typeof brush.tex === 'object') tex = n[1] > 0.7 ? brush.tex.top : n[1] < -0.7 ? (brush.tex.bottom || brush.tex.side) : brush.tex.side;
        else tex = brush.tex;
        faces.push({ pts: frag, n, tex, scale: brush.scaleTex || 1, detail: !brush.structural && axial, emit });
      }
    }
  }
  onProgress(0.05, 'geometry');

  // lightmap allocation
  const packer = new Packer(1024);
  for (const f of faces) {
    const [ua, va, drop] = axesFor(f.n);
    let mnS = 1e9, mnT = 1e9, mxS = -1e9, mxT = -1e9;
    for (const p of f.pts) { mnS = Math.min(mnS, p[ua]); mxS = Math.max(mxS, p[ua]); mnT = Math.min(mnT, p[va]); mxT = Math.max(mxT, p[va]); }
    mnS = Math.floor(mnS / LM_TEXEL) * LM_TEXEL; mnT = Math.floor(mnT / LM_TEXEL) * LM_TEXEL;
    const nx = Math.ceil((mxS - mnS) / LM_TEXEL) + 1, ny = Math.ceil((mxT - mnT) / LM_TEXEL) + 1;
    const r = packer.add(nx + 2, ny + 2);
    f.lm = { ua, va, drop, mnS, mnT, nx, ny, x: r.x, y: r.y };
  }
  const LW = packer.w, LH = Math.max(4, nextPow2(packer.height));
  const lmData = new Uint8Array(LW * LH * 4);
  const dmData = new Uint8Array(LW * LH * 4);
  for (let i = 0; i < LW * LH; i++) { dmData[i * 4] = 128; dmData[i * 4 + 1] = 255; dmData[i * 4 + 2] = 128; dmData[i * 4 + 3] = 255; lmData[i * 4 + 3] = 255; }

  const lighting = new Lighting(map, col);
  const out = new Float32Array(6);
  let lastYield = performance.now();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi], L = f.lm, n = f.n, pl = f.n;
    const d = dot(n, f.pts[0]);
    const poly2 = f.pts.map((p) => [p[L.ua], p[L.va]]);
    const rgb = new Float32Array((L.nx) * (L.ny) * 6);
    for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      let s = L.mnS + i * LM_TEXEL, t = L.mnT + j * LM_TEXEL;
      [s, t] = clampToPoly(poly2, s, t);
      const p = [0, 0, 0];
      p[L.ua] = s; p[L.va] = t;
      p[L.drop] = (d - pl[L.ua] * s - pl[L.va] * t) / pl[L.drop];
      lighting.sample(p, n, out);
      rgb.set(out, (j * L.nx + i) * 6);
    }
    // write with a 1 texel border (clamped copy)
    for (let j = -1; j <= L.ny; j++) for (let i = -1; i <= L.nx; i++) {
      const si = Math.max(0, Math.min(L.nx - 1, i)), sj = Math.max(0, Math.min(L.ny - 1, j));
      const k = (sj * L.nx + si) * 6;
      const o = ((L.y + j + 1) * LW + (L.x + i + 1)) * 4;
      const sc = 255 / LM_RANGE;
      lmData[o] = Math.min(255, rgb[k] * sc); lmData[o + 1] = Math.min(255, rgb[k + 1] * sc); lmData[o + 2] = Math.min(255, rgb[k + 2] * sc);
      dmData[o] = (rgb[k + 3] * 0.5 + 0.5) * 255; dmData[o + 1] = (rgb[k + 4] * 0.5 + 0.5) * 255; dmData[o + 2] = (rgb[k + 5] * 0.5 + 0.5) * 255;
    }
    if (performance.now() - lastYield > 30) {
      onProgress(0.05 + 0.75 * fi / faces.length, 'lighting');
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  const lmTex = new THREE.DataTexture(lmData, LW, LH, THREE.RGBAFormat);
  lmTex.magFilter = lmTex.minFilter = THREE.LinearFilter; lmTex.needsUpdate = true;
  const dmTex = new THREE.DataTexture(dmData, LW, LH, THREE.RGBAFormat);
  dmTex.magFilter = dmTex.minFilter = THREE.LinearFilter; dmTex.needsUpdate = true;

  // light grid for models
  const lightGrid = await buildLightGrid(map, col, lighting, (p) => onProgress(0.8 + 0.15 * p, 'light grid'));

  // geometry per texture
  const byTex = new Map();
  for (const f of faces) {
    const key = f.emit != null ? `${f.tex}|${f.emit}` : f.tex;
    if (!byTex.has(key)) byTex.set(key, []);
    byTex.get(key).push(f);
  }
  const group = new THREE.Group();
  const materials = [];
  const uniformsShared = {
    ...shared,
    lmap: { value: lmTex }, dmap: { value: dmTex },
    nmStrength: { value: 0.6 }, brightness: { value: map.look?.brightness ?? 1.0 },
  };
  for (const [key, list] of byTex) {
    const tex = list[0].tex, emit = list[0].emit;
    const pos = [], nor = [], uv = [], lmuv = [], tang = [], idx = [], edge = [];
    for (const f of list) {
      const L = f.lm, n = f.n;
      const [ua, va, , usign] = axesFor(n);
      const base = pos.length / 3;
      // tangent frame matching the planar texture projection
      const aU = [0, 0, 0]; aU[ua] = usign;
      const aV = [0, 0, 0]; aV[va] = 1;
      const T = projOnPlane(aU, n), Bv = projOnPlane(aV, n);
      const w = dot(cross3(n, T), Bv) >= 0 ? 1 : -1;
      const sc = f.scale * TEX_UNITS * texScale(f.tex);
      let y0 = 1e9, y1 = -1e9;
      for (const p of f.pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      for (const p of f.pts) {
        edge.push(p[1] - y0, y1 - p[1], f.detail ? 1 : 0);
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        uv.push(usign * p[ua] / sc, p[va] / sc);
        const lx = L.x + 1 + (p[ua] - L.mnS) / LM_TEXEL + 0.5, ly = L.y + 1 + (p[va] - L.mnT) / LM_TEXEL + 0.5;
        lmuv.push(lx / LW, ly / LH);
        tang.push(T[0], T[1], T[2], w);
      }
      for (let i = 1; i < f.pts.length - 1; i++) idx.push(base, base + i, base + i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('lmuv', new THREE.Float32BufferAttribute(lmuv, 2));
    g.setAttribute('tang', new THREE.Float32BufferAttribute(tang, 4));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const { map: cm, nmap: nm } = await bank.get(tex);
    const ec = emit != null ? new THREE.Color(emit) : new THREE.Color(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: worldVert, fragmentShader: worldFrag,
      uniforms: { ...uniformsShared, map: { value: cm }, nmap: { value: nm }, emit: { value: ec }, fullbright: { value: emit != null ? 1 : 0 }, specAmt: { value: /metal|steel|plate|grate|pipe|tech|trim|panel|floor|blood/i.test(tex) ? 0.6 : 0.3 }, scrollV: { value: /bloodfall/.test(tex) ? 0.55 : /str_blood\b|str_blood$/.test(tex) ? 0.02 : 0 } },
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  onProgress(1, 'done');
  return { group, lightGrid, lighting, uniforms: uniformsShared, lmTex, dmTex, faceCount: faces.length };
}

function projOnPlane(a, n) { const d = dot(a, n); return norm3([a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d]); }
function centroid(pts) { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((x) => x / pts.length); }
function polyNormal(w) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i < w.length - 1; i++) {
    const a = w[0], b = w[i], c = w[i + 1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    ax += u[1] * v[2] - u[2] * v[1]; ay += u[2] * v[0] - u[0] * v[2]; az += u[0] * v[1] - u[1] * v[0];
  }
  return [ax, ay, az];
}
function nextPow2(x) { let p = 1; while (p < x) p <<= 1; return p; }

// Keep lightmap sample points on the polygon (inset slightly), avoiding samples inside walls.
function clampToPoly(poly, s, t) {
  const inset = 1.5;
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area >= 0 ? 1 : -1;
  let inside = true;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey) || 1;
    const side = sgn * (ex * (t - a[1]) - ey * (s - a[0])) / el;
    if (side < inset) { inside = false; break; }
  }
  if (inside) return [s, t];
  // project onto the inset polygon: move toward centroid until inside (cheap, robust for convex)
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let lo = 0, hi = 1;
  for (let it = 0; it < 12; it++) {
    const m = (lo + hi) / 2;
    const ps = s + (cx - s) * m, pt = t + (cy - t) * m;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      if (sgn * (ex * (pt - a[1]) - ey * (ps - a[0])) / el < Math.min(inset, 0.25 * el)) ok = false;
    }
    if (ok) hi = m; else lo = m;
  }
  return [s + (cx - s) * hi, t + (cy - t) * hi];
}

async function buildLightGrid(map, col, lighting, onProgress) {
  const W = map.bounds;
  const ox = W.min[0], oy = W.min[1], oz = W.min[2];
  const nx = Math.ceil((W.max[0] - ox) / GRID) + 1, ny = Math.ceil((W.max[1] - oy) / GRID) + 1, nz = Math.ceil((W.max[2] - oz) / GRID) + 1;
  const C = 6;
  const data = new Float32Array(nx * ny * nz * C);
  const out = new Float32Array(6);
  const up = [0, 1, 0];
  let last = performance.now();
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const p = [ox + x * GRID, oy + y * GRID, oz + z * GRID];
      const i = ((z * ny + y) * nx + x) * C;
      if (col.pointContents(p, CONTENTS_SOLID)) { data[i] = -1; continue; }
      lighting.sample(p, up, out, true);
      for (let k = 0; k < C; k++) data[i + k] = out[k];
    }
    if (performance.now() - last > 30) { onProgress(z / nz); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
  }
  // fill solid cells from neighbours so trilinear sampling near walls is sane
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < nx * ny * nz; i++) {
      if (data[i * C] >= 0) continue;
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      const acc = [0, 0, 0, 0, 0, 0]; let c = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Zz = z + dz;
        if (X < 0 || Y < 0 || Zz < 0 || X >= nx || Y >= ny || Zz >= nz) continue;
        const j = ((Zz * ny + Y) * nx + X) * C;
        if (data[j] < 0) continue;
        for (let k = 0; k < C; k++) acc[k] += data[j + k];
        c++;
      }
      if (c) for (let k = 0; k < C; k++) data[i * C + k] = acc[k] / c;
    }
  }
  for (let i = 0; i < data.length; i += C) if (data[i] < 0) { data[i] = data[i + 1] = data[i + 2] = 0.2; data[i + 3] = data[i + 4] = data[i + 5] = 0; }
  return {
    // out[0..2] = light colour; out[3..5] (if present) = dominant light direction scaled by
    // how directional the light is there (0 = pure ambient). Used like Q3's light grid.
    sample(p, out) {
      const fx = Math.max(0, Math.min(nx - 1.001, (p[0] - ox) / GRID));
      const fy = Math.max(0, Math.min(ny - 1.001, (p[1] - oy) / GRID));
      const fz = Math.max(0, Math.min(nz - 1.001, (p[2] - oz) / GRID));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const m = Math.min(out.length, C);
      for (let k = 0; k < m; k++) out[k] = 0;
      for (let k = 0; k < 8; k++) {
        const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        const j = (((z0 + dz) * ny + (y0 + dy)) * nx + (x0 + dx)) * C;
        for (let q = 0; q < m; q++) out[q] += data[j + q] * w;
      }
      return out;
    },
  };
}
