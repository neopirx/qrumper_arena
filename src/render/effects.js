// Weapon VFX, decals and dynamic lights (visual spec section 7).
// Loud, palette-pure and technically simple, built from the era's vocabulary, just finished more
// carefully: atlas-textured camera-facing sprites (lumpy fire balls, hard-edged cauliflower smoke
// puffs, 4-point sparks, soft glows), camera-facing streak ribbons for tracers, rails and
// velocity-stretched sparks, shockwave rings, decals and short light punches.
// Every weapon owns one hue family (see WEAPONS[].color); dynamic lights are reserved for events.
import * as THREE from 'three';
import { dynLights, shared } from './shared.js';

const MAX_P = 6000;
const MAX_S = 1600;
// particle kinds; each maps to one or more cells of the 4x4 noise atlas (variants picked per particle)
// 0 is the plain procedural disc used by debris and droplets
export const PK = { DISC: 0, FIRE: 1, SMOKE: 2, SPARK: 3, GLOW: 4, MIST: 5, SPRAY: 6, DUST: 7 };
const CELLS = { 1: [4, 5, 6, 7], 2: [0, 1, 2, 3], 3: [8], 4: [9], 5: [10, 12, 13], 6: [11, 14], 7: [0, 1, 15] };
const QUALITY = { low: 0.35, medium: 0.65, high: 1 };

const particleVert = /* glsl */`
attribute float size;
attribute vec4 pcolor;
attribute vec2 pinfo;
attribute vec3 plit;
varying vec4 vColor;
varying vec2 vInfo;
varying vec3 vLit;
varying float vFog;
uniform float scale;
uniform float maxSize;
uniform float lit;
uniform vec4 dlPos[8];
uniform vec3 dlCol[8];
uniform int dlCount;
void main() {
  vColor = pcolor;
  vInfo = pinfo;
  // lit media (smoke, dust, mist) take the light grid sample at their spawn point plus the
  // dynamic lights (explosions light their own smoke, muzzle flashes light the gun smoke)
  vLit = plit;
  if (lit > 0.5) {
    for (int i = 0; i < 8; i++) {
      if (i >= dlCount) break;
      vec3 L = dlPos[i].xyz - position;
      float a = max(0.0, 1.0 - length(L) / (dlPos[i].w * 1.15));
      vLit += dlCol[i] * a * a * 1.6;
    }
  }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = -mv.z;
  gl_PointSize = min(size * scale / max(1.0, -mv.z), maxSize);
  gl_Position = projectionMatrix * mv;
}`;
// Additive (fire, sparks, glows): the noise cell's red channel is heat, mapped from the particle's
// colour up to white-hot. Lit media: alpha is density, red is self-shadowing toward the light, so
// a puff reads as a volume with a lit crown and a dark belly; soft edges, never a hard card.
const particleFrag = /* glsl */`
uniform sampler2D atlas;
varying vec4 vColor;
varying vec2 vInfo;
varying vec3 vLit;
varying float vFog;
uniform float additive;
uniform vec3 fogColor;
uniform float fogDensity;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float f = 1.0 - exp(-fogDensity * vFog);
  float cell = vInfo.x - 1.0;
  if (cell < -0.5) {
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    if (additive > 0.5) {
      vec3 c = mix(vec3(1.0), vColor.rgb, smoothstep(0.0, 0.45, r));
      float a = vColor.a * (1.0 - smoothstep(0.5, 1.0, r));
      gl_FragColor = vec4(c * a * (1.0 - f), 0.0);
    } else {
      float a = vColor.a * (1.0 - smoothstep(0.6, 1.0, r));
      vec3 c = vColor.rgb * vLit * (1.1 - 0.45 * r);
      gl_FragColor = vec4(mix(c, fogColor, f), a);
    }
    return;
  }
  float cs = cos(vInfo.y), sn = sin(vInfo.y);
  vec2 r = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
  vec2 cxy = vec2(mod(cell, 4.0), floor(cell / 4.0));
  vec4 t = texture2D(atlas, (cxy + 0.5 + clamp(r, -0.5, 0.5) * 0.985) * 0.25);
  if (additive > 0.5) {
    float heat = t.r;
    vec3 c = vColor.rgb * (0.25 + 1.0 * heat) + vec3(1.0, 0.92, 0.8) * pow(heat, 6.0) * 0.6;
    float a = t.a * vColor.a;
    // fire cells partly occlude what is behind them (premultiplied "over"), so a fireball shows
    // its folds instead of summing to a flat white disc; sparks and glows stay purely additive
    float occl = (cell > 3.5 && cell < 7.5) ? 0.8 : 0.0;
    gl_FragColor = vec4(c * a * (1.0 - f), a * occl);
  } else {
    float a = t.a * vColor.a;
    // fade out right in front of the lens so a puff never pastes a flat card over the screen
    a *= smoothstep(6.0, 40.0, vFog);
    if (a < 0.003) discard;
    vec3 c = vColor.rgb * vLit * (0.42 + 0.85 * t.r);
    gl_FragColor = vec4(mix(c, fogColor, f), a);
  }
}`;

// ---------- noise atlas: 4x4 cells of 128 px ----------
//  0-3  smoke puffs        4-7  fire balls        8 spark star     9 glow
//  10,12,13 mist (thin, wispy)   11,14 droplet spray   15 dust (flat, grainy)
function makeAtlas() {
  const C = 128, S = C * 4;
  const img = new Uint8ClampedArray(S * S * 4);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // tileable-free value noise with a per-cell permutation
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const grad = (h, x, y) => { const a = (h & 15) / 16 * Math.PI * 2; return Math.cos(a) * x + Math.sin(a) * y; };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u;
    const x2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
    return (x1 + (x2 - x1) * v) * 0.7 + 0.5;   // ~0..1
  }
  const fbm = (x, y, oct = 5, lac = 2.03, gain = 0.5) => { let s = 0, a = 0.5, w = 0; for (let o = 0; o < oct; o++) { s += noise(x, y) * a; w += a; x *= lac; y *= lac; a *= gain; } return s / w; };
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const put = (cell, fn) => {
    const cx = (cell % 4) * C, cy = Math.floor(cell / 4) * C;
    const ox = rnd() * 200, oy = rnd() * 200;
    const dens = new Float32Array(C * C), aux = new Float32Array(C * C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const u = (x + 0.5) / C - 0.5, v = (y + 0.5) / C - 0.5;
      const o = fn(u, v, ox, oy);
      dens[y * C + x] = o[0]; aux[y * C + x] = o[1] ?? o[0];
    }
    return { cx, cy, dens, aux };
  };
  const write = ({ cx, cy }, x, y, r, a) => { const i = ((cy + y) * S + cx + x) * 4; img[i] = img[i + 1] = img[i + 2] = Math.max(0, Math.min(255, r * 255)); img[i + 3] = Math.max(0, Math.min(255, a * 255)); };
  // smoke: domain-warped fBm billows inside a lumpy round envelope; shade = density toward the
  // light (up-left) subtracted from density here, i.e. a cheap one-step self shadow
  const smokeCell = (cell, freq, edge) => {
    const c = put(cell, (u, v, ox, oy) => {
      const wx = fbm(u * 3 + ox, v * 3 + oy, 3) - 0.5, wy = fbm(u * 3 + ox + 9, v * 3 + oy + 5, 3) - 0.5;
      const n = fbm((u + wx * 0.35) * freq + ox, (v + wy * 0.35) * freq + oy, 5);
      const ang = Math.atan2(v, u);
      const lump = fbm(Math.cos(ang) * 1.6 + ox, Math.sin(ang) * 1.6 + oy, 3);
      const r = Math.hypot(u, v) / (0.3 + 0.2 * lump);
      const env = 1 - ss(edge, 1, r);
      return [Math.max(0, env * (n * 1.6 - 0.28)) * env];
    });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const dd = c.dens[y * C + x];
      let occ = 0;
      for (let k = 1; k <= 4; k++) { const sx = x - k * 3, sy = y - k * 4; if (sx >= 0 && sy >= 0) occ += c.dens[sy * C + sx] * (1 - k * 0.18); }
      const shade = Math.max(0, Math.min(1, 0.95 - occ * 0.55 + dd * 0.12));
      write(c, x, y, shade, Math.min(1, dd * 1.25));
    }
  };
  for (let i = 0; i < 4; i++) smokeCell(i, 4.5 + i * 0.6, 0.35);
  // fire: turbulent ridged noise, hottest in the heart
  for (let i = 4; i < 8; i++) {
    const c = put(i, (u, v, ox, oy) => {
      const wx = fbm(u * 4 + ox, v * 4 + oy, 3) - 0.5;
      const n = 1 - Math.abs(fbm((u + wx * 0.4) * 6 + ox, v * 6 + oy, 4) * 2 - 1);
      const r = Math.hypot(u, v) / (0.36 + 0.12 * fbm(Math.atan2(v, u) * 1.2 + ox, oy, 2));
      const env = 1 - ss(0.25, 1, r);
      const heat = Math.max(0, env * (0.55 + 0.6 * n) - 0.12);
      return [heat * env, heat];
    });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) write(c, x, y, Math.min(1, c.aux[y * C + x] * 1.1), Math.min(1, c.dens[y * C + x] * 1.4));
  }
  // mist: thin, finely broken, faint — breaks up into wisps as it fades
  for (const cell of [10, 12, 13]) {
    const c = put(cell, (u, v, ox, oy) => {
      const wx = fbm(u * 2 + ox, v * 2 + oy, 3) - 0.5;
      const n = fbm((u + wx * 0.5) * 7 + ox, v * 7 + oy, 6, 2.1, 0.55);
      const r = Math.hypot(u, v) / 0.48;
      const env = 1 - ss(0.1, 1, r);
      return [Math.max(0, n * 1.7 - 0.62) * env * env];
    });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const dd = c.dens[y * C + x]; write(c, x, y, 0.7 + dd * 0.3, Math.min(1, dd * 1.6)); }
  }
  // droplet spray: many fine soft droplets, denser toward the middle
  for (const cell of [11, 14]) {
    const c = put(cell, () => [0]);
    for (let k = 0; k < 260; k++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.7) * C * 0.46, rr = 0.6 + rnd() * rnd() * 2.8;
      const px = C / 2 + Math.cos(a) * d, py = C / 2 + Math.sin(a) * d;
      for (let y = Math.max(0, Math.floor(py - rr - 1)); y < Math.min(C, py + rr + 1); y++) for (let x = Math.max(0, Math.floor(px - rr - 1)); x < Math.min(C, px + rr + 1); x++) {
        const q = 1 - ss(rr * 0.5, rr + 0.5, Math.hypot(x + 0.5 - px, y + 0.5 - py));
        c.dens[y * C + x] = Math.max(c.dens[y * C + x], q * (0.6 + 0.4 * (1 - d / (C * 0.5))));
      }
    }
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) write(c, x, y, 0.8, c.dens[y * C + x]);
  }
  // dust: flat, grainy, low-contrast
  {
    const c = put(15, (u, v, ox, oy) => {
      const n = fbm(u * 9 + ox, v * 9 + oy, 5);
      const grain = noise(u * 60 + ox, v * 60 + oy);
      const r = Math.hypot(u, v) / 0.47;
      return [Math.max(0, (n * 1.3 - 0.25) * (0.75 + grain * 0.4)) * (1 - ss(0.2, 1, r))];
    });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const dd = c.dens[y * C + x]; write(c, x, y, 0.75 + dd * 0.25, Math.min(1, dd * 1.1)); }
  }
  // spark: thin hot streak cross with a round core; glow: smooth falloff
  {
    const c = put(8, (u, v) => {
      const r = Math.hypot(u, v);
      const core = Math.exp(-r * r * 260);
      const ray = Math.max(Math.exp(-Math.abs(v) * 90) * (1 - ss(0, 0.5, Math.abs(u))), Math.exp(-Math.abs(u) * 90) * (1 - ss(0, 0.5, Math.abs(v)))) * 0.8;
      return [Math.min(1, core + ray)];
    });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const dd = c.dens[y * C + x]; write(c, x, y, dd, dd); }
  }
  {
    const c = put(9, (u, v) => { const r = Math.hypot(u, v) * 2; return [Math.max(0, Math.exp(-r * r * 4.5) - 0.011) + Math.exp(-r * r * 60) * 0.5]; });
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const dd = Math.min(1, c.dens[y * C + x]); write(c, x, y, Math.min(1, dd * 1.1), dd); }
  }
  const t = new THREE.DataTexture(img, S, S, THREE.RGBAFormat);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------- realistic muzzle flash textures (canvas, generated once) ----------
// burst: the flash seen down the barrel axis, an irregular ragged ball of flame with a few
// uneven tongues (no symmetric cartoon star). tongue: the flash from the side, a tapering
// turbulent plume, hottest at the muzzle (bottom of the texture).
function vnoise(seed) {
  const p = new Float32Array(256);
  let s = seed;
  for (let i = 0; i < 256; i++) { s = (s * 16807) % 2147483647; p[i] = s / 2147483647; }
  const at = (i) => p[((i % 256) + 256) % 256];
  return (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return at(i) + (at(i + 1) - at(i)) * u; };
}
function pixelTex(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const im = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.max(0, Math.min(1, fn((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5)));
    const i = (y * size + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = v * 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _flameTex = null;
export function flameTextures() {
  if (_flameTex) return _flameTex;
  const n1 = vnoise(91), n2 = vnoise(17), n3 = vnoise(55);
  const burst = pixelTex(128, (u, v) => {
    const r = Math.hypot(u, v) * 2, a = Math.atan2(v, u) / (Math.PI * 2) + 0.5;
    // uneven tongues: a few strong lobes plus fine ragged edges
    const lobe = Math.pow(n1(a * 5), 2.2) * 0.75 + n2(a * 23) * 0.25 + n3(a * 61) * 0.12;
    const reach = 0.22 + lobe * 0.78;
    const edge = 1 - Math.min(1, Math.max(0, (r - reach * 0.55) / (reach * 0.45)));
    const core = Math.exp(-r * r * 30);
    const streak = (0.6 + 0.4 * n3(a * 140 + r * 3)) * edge;
    return Math.max(core, streak * (1 - r * 0.6));
  });
  const tongue = pixelTex(128, (u, v) => {
    const y = 0.5 - v;                 // 0 at the muzzle (bottom) .. 1 at the tip
    const w = 0.42 * Math.pow(1 - y, 0.8) * (0.75 + 0.5 * n1(y * 9));
    const off = (n2(y * 6) - 0.5) * 0.12 * y;
    const d = Math.abs(u - off) / Math.max(0.001, w);
    const body = (1 - Math.min(1, d)) * (1 - Math.pow(y, 1.6));
    const rag = 0.65 + 0.35 * n3(y * 40 + u * 9);
    return Math.pow(body, 0.7) * rag * Math.min(1, (1 - y) * 4);
  });
  _flameTex = { burst, tongue };
  return _flameTex;
}

class ParticleSystem {
  // lit: the medium is shaded by the light grid and dynamic lights (smoke, dust, mist, blood)
  constructor(scene, additive, atlas, lit = !additive) {
    this.n = 0;
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 4);
    this.size = new Float32Array(MAX_P);
    this.info = new Float32Array(MAX_P * 2);
    this.lit = new Float32Array(MAX_P * 3).fill(1);
    this.p = [];
    this.lightGrid = null;
    this._s = [0, 0, 0, 0, 0, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pinfo', new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('plit', new THREE.BufferAttribute(this.lit, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.isLit = lit;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: particleVert, fragmentShader: particleFrag,
      uniforms: { scale: { value: 600 }, additive: { value: additive ? 1 : 0 }, lit: { value: lit ? 1 : 0 }, maxSize: { value: 1024 }, fogColor: shared.fogColor, fogDensity: shared.fogDensity, atlas: { value: atlas }, dlPos: shared.dlPos, dlCol: shared.dlCol, dlCount: shared.dlCount },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  // p: {pos:[3], vel:[3], life, size, size1, color:[r,g,b], color1, alpha, alpha1, grav, drag, kind, rot, spin, rise, fadeIn, turb}
  add(p) {
    if (this.p.length >= MAX_P) this.p.shift();
    p.t = 0;
    const cells = CELLS[p.kind];
    p.cell = cells ? cells[(Math.random() * cells.length) | 0] + 1 : 0;
    if (p.kind && p.rot == null) p.rot = Math.random() * 6.28;
    if (this.isLit) {
      if (this.lightGrid) {
        const s = this._s;
        this.lightGrid.sample(p.pos, s);
        p.lit = [Math.min(1.6, s[0] * 0.95 + 0.1), Math.min(1.6, s[1] * 0.95 + 0.1), Math.min(1.6, s[2] * 0.95 + 0.1)];
      } else p.lit = [1, 1, 1];
    }
    this.p.push(p);
    return p;
  }
  update(dt, time = 0) {
    let n = 0;
    const keep = [];
    for (const p of this.p) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      const k = p.t / p.life;
      if (p.grav) p.vel[1] -= p.grav * dt;
      if (p.rise) p.vel[1] += p.rise * dt;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vel[0] *= d; p.vel[1] *= d; p.vel[2] *= d; }
      // slow turbulent drift so lingering smoke curls instead of sliding in a straight line
      if (p.turb) { const ph = p.rot * 7 + time * 0.9; p.vel[0] += Math.sin(ph) * p.turb * dt; p.vel[2] += Math.cos(ph * 1.3) * p.turb * dt; }
      p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
      if (p.spin) p.rot += p.spin * dt * (1 - k * 0.7);
      this.pos[n * 3] = p.pos[0]; this.pos[n * 3 + 1] = p.pos[1]; this.pos[n * 3 + 2] = p.pos[2];
      let a = (p.alpha ?? 1) + ((p.alpha1 ?? 0) - (p.alpha ?? 1)) * (p.ease ? k * k : k);
      if (p.fadeIn) a *= Math.min(1, p.t / p.fadeIn);
      const c = p.color, c1 = p.color1 || c;
      const kc = p.colorEase ? Math.sqrt(k) : k;
      this.col[n * 4] = c[0] + (c1[0] - c[0]) * kc; this.col[n * 4 + 1] = c[1] + (c1[1] - c[1]) * kc; this.col[n * 4 + 2] = c[2] + (c1[2] - c[2]) * kc;
      this.col[n * 4 + 3] = a;
      const ks = p.sizeEase ? 1 - (1 - k) * (1 - k) * (1 - k) : k;
      this.size[n] = p.size + ((p.size1 ?? p.size) - p.size) * ks;
      this.info[n * 2] = p.cell; this.info[n * 2 + 1] = p.rot || 0;
      if (p.lit) { this.lit[n * 3] = p.lit[0]; this.lit[n * 3 + 1] = p.lit[1]; this.lit[n * 3 + 2] = p.lit[2]; }
      n++;
    }
    this.p = keep;
    this.n = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'pcolor', 'size', 'pinfo', 'plit']) this.geo.attributes[k].needsUpdate = true;
  }
}

// ---------- streaks: camera-facing ribbons between two points, batched in one draw ----------
const streakVert = /* glsl */`
attribute vec3 pA;
attribute vec3 pB;
attribute vec2 corner;     // x: 0 tail .. 1 head, y: -1 / +1 across
attribute vec4 scolor;
attribute vec3 sparam;     // width, tail alpha, white-hot core amount
varying vec4 vColor;
varying vec2 vUv;
varying vec2 vParam;
varying float vFog;
void main() {
  vec3 a = (modelViewMatrix * vec4(pA, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(pB, 1.0)).xyz;
  vec3 d = b - a;
  float len = length(d);
  vec3 dn = len > 0.0001 ? d / len : vec3(0.0, 1.0, 0.0);
  vec3 P = mix(a, b, corner.x);
  vec3 side = cross(dn, normalize(-P));
  float sl = length(side);
  side = sl > 0.0001 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = sparam.x;
  P += dn * (corner.x * 2.0 - 1.0) * w * 0.6;   // round-ish caps
  P += side * corner.y * w;
  vColor = scolor;
  vUv = corner;
  vParam = sparam.yz;
  vFog = -P.z;
  gl_Position = projectionMatrix * vec4(P, 1.0);
}`;
const streakFrag = /* glsl */`
varying vec4 vColor;
varying vec2 vUv;
varying vec2 vParam;
varying float vFog;
uniform float fogDensity;
uniform float normalBlend;
void main() {
  float s = abs(vUv.y);
  float body = 1.0 - smoothstep(0.25, 1.0, s);
  body *= body;
  float core = 1.0 - smoothstep(0.0, 0.32, s);
  float along = mix(vParam.x, 1.0, vUv.x);
  float a = body * along * vColor.a;
  vec3 c = mix(vColor.rgb, vec3(1.0), core * vParam.y);
  float f = 1.0 - exp(-fogDensity * vFog);
  // normal-blended variant (blood): painted colour with alpha, no white-hot core
  if (normalBlend > 0.5) { gl_FragColor = vec4(vColor.rgb * (1.0 - f * 0.6), body * along * vColor.a); return; }
  gl_FragColor = vec4(c * a * (1.0 - f * 0.8), 1.0);
}`;

class StreakSystem {
  constructor(scene, normal = false) {
    const nv = MAX_S * 4;
    this.pA = new Float32Array(nv * 3); this.pB = new Float32Array(nv * 3);
    this.corner = new Float32Array(nv * 2); this.col = new Float32Array(nv * 4); this.param = new Float32Array(nv * 3);
    const idx = new Uint16Array(MAX_S * 6);
    for (let i = 0; i < MAX_S; i++) {
      const v = i * 4;
      this.corner.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('pA', new THREE.BufferAttribute(this.pA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pB', new THREE.BufferAttribute(this.pB, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('corner', new THREE.BufferAttribute(this.corner, 2));
    g.setAttribute('scolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('sparam', new THREE.BufferAttribute(this.param, 3).setUsage(THREE.DynamicDrawUsage));
    // three needs a `position` attribute to draw; the shader ignores it
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: streakVert, fragmentShader: streakFrag,
      uniforms: { fogDensity: shared.fogDensity, normalBlend: { value: normal ? 1 : 0 } },
      transparent: true, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = normal ? 2 : 4;
    scene.add(this.mesh);
    this.s = [];
  }
  // s: {a, b} or {pos, vel, stretch}; width, width1, color, color1, alpha, alpha1, life, tail, hot, grav, drag, upd(s,k)
  add(s) {
    if (this.s.length >= MAX_S) this.s.shift();
    s.t = 0;
    this.s.push(s);
    return s;
  }
  update(dt) {
    let n = 0;
    const keep = [];
    for (const s of this.s) {
      s.t += dt;
      if (s.t >= s.life) continue;
      keep.push(s);
      const k = s.t / s.life;
      let a, b;
      if (s.vel) {
        if (s.grav) s.vel[1] -= s.grav * dt;
        if (s.drag) { const d = Math.max(0, 1 - s.drag * dt); s.vel[0] *= d; s.vel[1] *= d; s.vel[2] *= d; }
        s.pos[0] += s.vel[0] * dt; s.pos[1] += s.vel[1] * dt; s.pos[2] += s.vel[2] * dt;
        const st = s.stretch ?? 0.025;
        b = s.pos; a = [s.pos[0] - s.vel[0] * st, s.pos[1] - s.vel[1] * st, s.pos[2] - s.vel[2] * st];
      } else {
        if (s.upd) s.upd(s, k);
        a = s.a; b = s.b;
      }
      const w = s.width + ((s.width1 ?? s.width) - s.width) * k;
      const al = (s.alpha ?? 1) + ((s.alpha1 ?? 0) - (s.alpha ?? 1)) * (s.ease ? k * k : k);
      const c = s.color, c1 = s.color1 || c;
      const r = c[0] + (c1[0] - c[0]) * k, gg = c[1] + (c1[1] - c[1]) * k, bb = c[2] + (c1[2] - c[2]) * k;
      for (let v = 0; v < 4; v++) {
        const i = n * 4 + v;
        this.pA[i * 3] = a[0]; this.pA[i * 3 + 1] = a[1]; this.pA[i * 3 + 2] = a[2];
        this.pB[i * 3] = b[0]; this.pB[i * 3 + 1] = b[1]; this.pB[i * 3 + 2] = b[2];
        this.col[i * 4] = r; this.col[i * 4 + 1] = gg; this.col[i * 4 + 2] = bb; this.col[i * 4 + 3] = al;
        this.param[i * 3] = w; this.param[i * 3 + 1] = s.tail ?? 0; this.param[i * 3 + 2] = s.hot ?? 0.8;
      }
      n++;
    }
    this.s = keep;
    this.geo.setDrawRange(0, n * 6);
    for (const k of ['pA', 'pB', 'scolor', 'sparam']) this.geo.attributes[k].needsUpdate = true;
  }
}

function makeCanvasTex(draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const WHITE = [1, 1, 1];
const off = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];

// explosion palettes: rockets burn orange-red, grenades a toxic green-yellow (one hue family each)
const BLAST = {
  rocket: { core: 0xfff2c0, star: 0xffe0a0, fire: [1, 0.78, 0.32], fire1: [0.85, 0.16, 0.02], ring: 0xffa040, light: 0xff8a30, spark: [1, 0.85, 0.45], spark1: [1, 0.35, 0.05], ember: [1, 0.55, 0.15] },
  grenade: { core: 0xf4ffd0, star: 0xd8ffa0, fire: [0.85, 1, 0.4], fire1: [0.2, 0.55, 0.04], ring: 0x8cff4a, light: 0x7aff40, spark: [0.9, 1, 0.55], spark1: [0.35, 0.9, 0.1], ember: [0.6, 1, 0.25] },
};

export class Effects {
  constructor(scene, col, gfx = {}) {
    this.scene = scene;
    this.col = col;
    this.gfx = gfx;
    this.q = QUALITY[gfx.particles] ?? 1;
    this.atlas = makeAtlas();
    this.add = new ParticleSystem(scene, true, this.atlas);
    this.smoke = new ParticleSystem(scene, false, this.atlas);
    this._grid = null;
    this.streaks = new StreakSystem(scene);
    this.wet = new StreakSystem(scene, true);     // blood jets and droplet streaks (normal blend)
    this.lights = [];
    this.beams = [];
    this.decals = [];
    this.flashes = [];
    this.timers = [];
    this.time = 0;
    this.shake = 0;          // read and decayed by the session (camera shake)
    this.scorchTex = makeCanvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.45, 'rgba(12,8,4,0.85)'); gr.addColorStop(0.72, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      // radial burn streaks and a glassy fused ring
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
      for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, r0 = s * 0.16, r1 = s * (0.3 + Math.random() * 0.19); g.lineWidth = 1 + Math.random() * 2.5; g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * r0, s / 2 + Math.sin(a) * r0); g.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1); g.stroke(); }
      g.strokeStyle = 'rgba(60,40,24,0.35)'; g.lineWidth = 3; g.beginPath(); g.arc(s / 2, s / 2, s * 0.2, 0, 7); g.stroke();
    }, 128);
    this.holeTex = makeCanvasTex((g, s) => {
      g.clearRect(0, 0, s, s);
      g.fillStyle = 'rgba(30,26,22,0.55)'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.44, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * s * 0.45, s / 2 + Math.sin(a) * s * 0.45); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,1)'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.17, 0, 7); g.fill();
      g.fillStyle = 'rgba(210,200,180,0.45)'; g.beginPath(); g.arc(s / 2 - 3, s / 2 - 3, s * 0.07, 0, 7); g.fill();
    }, 32);
    this.splatTex = makeCanvasTex((g, s) => {   // energy splat, tinted per weapon (additive)
      g.clearRect(0, 0, s, s);
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.35);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 12; i++) { const a = i * 0.52 + Math.random() * 0.3, r = s * (0.25 + Math.random() * 0.2); g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * s * 0.1, s / 2 + Math.sin(a) * s * 0.1); g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); g.stroke(); }
    }, 64);
    this.glowTex = makeCanvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    // muzzle flash burst (also handed to the first-person weapon)
    this.starTex = flameTextures().burst;
    this.ringTex = makeCanvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.82, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, 128);
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  }

  // the light grid shades smoke / dust / mist where it is born
  set lightGrid(g) { this._grid = g; this.smoke.lightGrid = g; }
  get lightGrid() { return this._grid; }

  // particle count scaled by the effects quality
  n(k) { return Math.max(1, Math.round(k * this.q)); }
  hi() { return this.q >= 0.99; }

  // ---------- primitives ----------
  sprite(tex, color, size, opacity = 1) {
    const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    s.renderOrder = 4;
    return s;
  }
  glowSprite(color, size, opacity = 1) { return this.sprite(this.glowTex, color, size, opacity); }

  // short-lived sprite that scales s0 -> s1 and fades
  flash(pos, tex, color, s0, s1, life, opacity = 1, spin = 0) {
    const fl = this.sprite(tex, color, s0, opacity);
    fl.position.set(pos[0], pos[1], pos[2]);
    fl.material.rotation = Math.random() * 6.28;
    this.scene.add(fl);
    this.flashes.push({ obj: fl, t: 0, life, s0, s1, o: opacity, spin });
    return fl;
  }

  later(t, fn) { this.timers.push({ t, fn }); }

  light(pos, color, radius, life, opts = {}) {
    const l = { pos: [...pos], color: new THREE.Color(color), radius, life, t: 0, intensity: opts.intensity ?? 1, follow: opts.follow, ambient: life < 0 && !opts.follow };
    this.lights.push(l);
    return l;
  }

  decal(pos, normal, tex, size, life = 25, color = 0xffffff, additive = false) {
    if (!normal || this.gfx.decals === false) return;
    if (this.decals.length > 260) { const d = this.decals.shift(); this.scene.remove(d.mesh); d.mesh.material.dispose(); }
    const m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    const mesh = new THREE.Mesh(this.decalGeo, m);
    mesh.position.set(pos[0] + normal[0] * 0.5, pos[1] + normal[1] * 0.5, pos[2] + normal[2] * 0.5);
    mesh.lookAt(pos[0] + normal[0] * 10, pos[1] + normal[1] * 10, pos[2] + normal[2] * 10);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(size);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.decals.push({ mesh, t: 0, life, additive });
  }

  // flat ring expanding against the impact plane
  shockwave(pos, normal, color, r1, life, opacity = 0.9) {
    const n = normal || [0, 1, 0];
    const m = new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(this.decalGeo, m);
    mesh.position.set(pos[0] + n[0] * 3, pos[1] + n[1] * 3, pos[2] + n[2] * 3);
    mesh.lookAt(pos[0] + n[0] * 10, pos[1] + n[1] * 10, pos[2] + n[2] * 10);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.beams.push({ objs: [mesh], t: 0, life, upd: (k) => { mesh.scale.setScalar(8 + r1 * 2 * Math.sqrt(k)); m.opacity = (1 - k) * opacity; } });
  }

  // a cylinder beam segment between two points (additive); kept for props that want a solid beam
  beam(a, b, color, radius, opacity) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(this.beamGeo, m);
    mesh.position.set(a[0], a[1], a[2]);
    mesh.lookAt(b[0], b[1], b[2]);
    mesh.scale.set(radius, radius, Math.max(0.01, len));
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    return mesh;
  }

  // hot sparks flying off a surface, drawn as velocity-stretched streaks
  sparks(pos, normal, color, count, speed = 300, opts = {}) {
    const c = Array.isArray(color) ? color : rgb(color);
    const c1 = opts.color1 || lerp3(c, [c[0] * 0.8, c[1] * 0.3, c[2] * 0.1], 0.6);
    for (let i = 0; i < this.n(count); i++) {
      const v = rndDir(normal || [0, 1, 0], opts.bias ?? 0.3); const sp = speed * (0.5 + Math.random());
      this.streaks.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], stretch: opts.stretch ?? 0.022, life: (opts.life ?? 0.25) * (0.6 + Math.random() * 0.8), width: opts.width ?? 0.7, width1: 0.3, color: c, color1: c1, alpha: 1, alpha1: 0.2, grav: opts.grav ?? 800, drag: opts.drag ?? 1.5, tail: 0, hot: 0.9 });
    }
  }

  // ---------- smoke helpers ----------
  // one billow of lit smoke: grows fast then slowly, rises, curls, thins out over `life`
  puff(pos, vel, size0, size1, life, color, alpha, opts = {}) {
    return this.smoke.add({
      pos: [...pos], vel: [...vel], life: life * (0.8 + Math.random() * 0.4), size: size0, size1: size1 * (0.85 + Math.random() * 0.3),
      color, color1: opts.color1 || color, alpha, alpha1: 0, ease: opts.ease ?? true, fadeIn: opts.fadeIn ?? 0.06,
      drag: opts.drag ?? 2.2, rise: opts.rise ?? 14, turb: opts.turb ?? 18, kind: opts.kind ?? PK.SMOKE,
      spin: (Math.random() - 0.5) * (opts.spin ?? 0.6), sizeEase: true, grav: opts.grav,
    });
  }
  // dust thrown off a surface: low, flat, quickly settling
  dust(pos, n, count, spread, size, life, color = [0.5, 0.47, 0.43]) {
    for (let i = 0; i < this.n(count); i++) {
      const v = rndDir(n, 0.6); const sp = spread * (0.4 + Math.random() * 0.8);
      this.puff(off(pos, n, 3), [v[0] * sp, v[1] * sp * 0.6, v[2] * sp], size * 0.4, size * (1 + Math.random() * 0.6), life, color, 0.32, { kind: PK.DUST, drag: 4, rise: 4, turb: 8 });
    }
  }

  // ---------- weapon archetypes ----------
  // A. hitscan / launcher muzzle (third person): a short ragged flame burst along the barrel,
  // a hot core, a light punch, and lingering gun smoke for the heavy weapons
  muzzleFlash(pos, color = 0xffc060, radius = 160, dir = null, weapon = null) {
    const cc = rgb(color);
    const big = weapon === 'sg' || weapon === 'rl' || weapon === 'gl';
    const fireCol = weapon === 'rg' ? lerp3(cc, WHITE, 0.3) : lerp3([1, 0.72, 0.35], cc, 0.25);
    this.add.add({ pos: [...pos], vel: [0, 0, 0], life: 0.05, size: big ? 18 : 11, size1: big ? 24 : 14, color: lerp3(fireCol, WHITE, 0.5), alpha: 1, alpha1: 0, kind: PK.GLOW });
    if (dir && weapon !== 'rg') {
      // flame tongues: fire cells strung along the barrel axis, shrinking outward
      const nf = big ? 4 : 2;
      for (let i = 0; i < nf; i++) {
        const d = (i + 0.5) * (big ? 7 : 5);
        this.add.add({ pos: off(pos, dir, d), vel: [dir[0] * 120, dir[1] * 120, dir[2] * 120], life: 0.045 + Math.random() * 0.02, size: (big ? 20 : 12) * (1 - i / (nf + 1)), size1: (big ? 26 : 15) * (1 - i / (nf + 1)), color: fireCol, color1: [cc[0] * 0.8, cc[1] * 0.35, cc[2] * 0.15], alpha: 1, alpha1: 0, kind: PK.FIRE, spin: 6 });
      }
      if (weapon === 'sg' || weapon === 'mg') this.sparks(off(pos, dir, 4), dir, [1, 0.8, 0.45], weapon === 'sg' ? 5 : 1, 700, { life: 0.12, width: 0.4, bias: 4, grav: 300, stretch: 0.012 });
    }
    if (weapon !== 'mg') this.light(pos, color, radius, 0.07, { intensity: 1.3 });
    else if (Math.random() < 0.5) this.light(pos, color, radius * 0.7, 0.04, { intensity: 0.8 });
    if (dir) {
      // gun smoke: thin grey wisps that leave the barrel fast, stall and drift upward
      const ns = weapon === 'sg' ? 5 : big ? 4 : weapon === 'rg' ? 2 : (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < this.n(ns); i++) {
        const sp = 60 + Math.random() * 120;
        const v = rndDir(dir, 3);
        this.puff(off(pos, dir, 6), [v[0] * sp, v[1] * sp + 8, v[2] * sp], 4, big ? 26 : 16, big ? 1.6 : 1.0, weapon === 'rg' ? [0.62, 0.68, 0.72] : [0.6, 0.58, 0.55], big ? 0.3 : 0.2, { drag: 4, rise: 10, turb: 14, kind: PK.MIST });
      }
    }
  }

  // tracer: a thin hot streak flying from muzzle to impact (only some rounds are tracers)
  tracer(from, to, color) {
    if (!from) return;
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 80) return;
    const u = [d[0] / len, d[1] / len, d[2] / len];
    const seg = Math.min(90, len * 0.35);
    const speed = 9000;
    const life = Math.max(0.025, (len - seg) / speed);
    const c = lerp3(rgb(color), [1, 0.9, 0.7], 0.6);
    this.streaks.add({
      a: [...from], b: off(from, u, seg), life, width: 0.55, color: c, alpha: 0.9, alpha1: 0.8, tail: 0, hot: 0.8,
      upd: (s, k) => { const o = k * (len - seg); s.a = off(from, u, o); s.b = off(from, u, o + seg); },
    });
  }

  // impact: a short hot pop, ricochet sparks, a jet of pulverised material and a lingering dust
  // puff in the surface's light, chips, and a bullet hole
  bulletImpact(pos, normal, kind = 'mg', from = null) {
    const n = normal || [0, 1, 0];
    this.sparks(pos, n, [1, 0.82, 0.5], kind === 'sg' ? 2 : 4, kind === 'sg' ? 300 : 420, { life: 0.18, width: 0.45, color1: [1, 0.35, 0.05], stretch: 0.016 });
    this.add.add({ pos: off(pos, n, 1.5), vel: [0, 0, 0], life: 0.05, size: 7, size1: 4, color: [1, 0.8, 0.5], alpha: 0.9, alpha1: 0, kind: PK.GLOW });
    // the dust jet leaves along the surface normal, then billows and hangs
    const jet = rndDir(n, 2.5);
    this.puff(off(pos, n, 2), [jet[0] * 90, jet[1] * 90, jet[2] * 90], 3, kind === 'sg' ? 14 : 18, 1.1, [0.52, 0.49, 0.45], 0.45, { kind: PK.DUST, drag: 5, rise: 6, turb: 10 });
    if (this.hi()) this.puff(off(pos, n, 2), [n[0] * 25, n[1] * 25 + 6, n[2] * 25], 4, 22, 1.6, [0.5, 0.48, 0.45], 0.22, { kind: PK.MIST, drag: 3, rise: 8 });
    // chips of the wall, tumbling under gravity
    for (let i = 0; i < this.n(3); i++) {
      const v = rndDir(n, 0.5); const sp = 140 + Math.random() * 200;
      this.smoke.add({ pos: off(pos, n, 1), vel: [v[0] * sp, v[1] * sp + 60, v[2] * sp], life: 0.45 + Math.random() * 0.3, size: 0.8 + Math.random() * 0.9, size1: 0.7, color: [0.22, 0.2, 0.18], alpha: 1, alpha1: 1, grav: 1000 });
    }
    if (Math.random() < 0.85) this.decal(pos, normal, this.holeTex, 3 + Math.random() * 1.5, 18);
    if (from && (kind === 'mg' ? Math.random() < 0.45 : Math.random() < 0.25)) this.tracer(from, pos, kind === 'sg' ? 0xff9a26 : 0xffe68a);
  }

  // C. rocket / grenade explosion: a short white-hot flash, a turbulent fireball that rolls out
  // and burns down into a column of dark smoke lit from inside by the fading blast light, a dust
  // ring blown out along the surface, debris, sparks and embers, scorch, shake
  explosion(pos, normal, big = true, camPos = null, kind = 'rocket') {
    const P = BLAST[kind] || BLAST.rocket;
    const n = normal || [0, 1, 0];
    const p0 = off(pos, n, 8);
    const S = big ? 1 : 0.4;
    // 1. flash: a hot glow, a couple of frames
    this.add.add({ pos: [...p0], vel: [0, 0, 0], life: 0.06, size: 70 * S, size1: 110 * S, color: rgb(P.core), alpha: 0.7, alpha1: 0, kind: PK.GLOW });
    this.add.add({ pos: [...p0], vel: [0, 0, 0], life: 0.16, size: 120 * S, size1: 200 * S, color: lerp3(P.fire, [1, 0.5, 0.2], 0.5), alpha: 0.18, alpha1: 0, kind: PK.GLOW });
    // 2. fireball: turbulent fire cells expanding fast, decelerating, cooling through the palette
    for (let i = 0; i < this.n(big ? 22 : 7); i++) {
      const v = rndDir(n, 0.3); const sp = 90 + Math.random() * 260;
      const life = 0.32 + Math.random() * 0.3;
      this.add.add({ pos: off(p0, v, 4 + Math.random() * 10), vel: [v[0] * sp, v[1] * sp + 30, v[2] * sp], life, size: (22 + Math.random() * 14) * S, size1: (60 + Math.random() * 34) * S, color: P.fire, color1: P.fire1, alpha: 0.9, alpha1: 0, ease: false, drag: 6, rise: 60, kind: PK.FIRE, spin: (Math.random() - 0.5) * 3, sizeEase: true, colorEase: true });
    }
    // 3. smoke: the fireball's soot, born dark inside the flames and rolling up into a column;
    // it is lit by the blast's own light while the fire burns, then by the room
    const soot = kind === 'grenade' ? [0.3, 0.3, 0.27] : [0.24, 0.21, 0.19];
    for (let i = 0; i < this.n(big ? 18 : 5); i++) {
      this.later(0.04 + Math.random() * 0.16, () => {
        const v = rndDir(n, 0.45); const sp = 60 + Math.random() * 150;
        this.puff(off(p0, v, 10 + Math.random() * 20), [v[0] * sp, v[1] * sp + 40, v[2] * sp], (28 + Math.random() * 14) * S, (90 + Math.random() * 50) * S, 2.6 + Math.random() * 1.6, soot, 0.62, { color1: [0.34, 0.33, 0.33], drag: 2.4, rise: 26, turb: 26, spin: 0.5, fadeIn: 0.12 });
      });
    }
    // a thin grey veil that hangs longest
    if (big) for (let i = 0; i < this.n(6); i++) {
      this.later(0.3 + Math.random() * 0.3, () => {
        const v = rndDir(n, 1); const sp = 30 + Math.random() * 50;
        this.puff(off(p0, v, 30), [v[0] * sp, v[1] * sp + 20, v[2] * sp], 60, 170, 4 + Math.random() * 2, [0.42, 0.41, 0.4], 0.18, { kind: PK.MIST, drag: 1.5, rise: 10, turb: 20 });
      });
    }
    // 4. dust ring blown out flat along the surface
    if (big) {
      const t1 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const a1 = norm([n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]]);
      const a2 = [n[1] * a1[2] - n[2] * a1[1], n[2] * a1[0] - n[0] * a1[2], n[0] * a1[1] - n[1] * a1[0]];
      const m = this.n(14);
      for (let i = 0; i < m; i++) {
        const a = i / m * Math.PI * 2 + Math.random() * 0.3, sp = 260 + Math.random() * 160;
        const v = [a1[0] * Math.cos(a) + a2[0] * Math.sin(a), a1[1] * Math.cos(a) + a2[1] * Math.sin(a), a1[2] * Math.cos(a) + a2[2] * Math.sin(a)];
        this.puff(off(pos, n, 6), [v[0] * sp + n[0] * 20, v[1] * sp + n[1] * 20, v[2] * sp + n[2] * 20], 14, 60 + Math.random() * 30, 1.6 + Math.random() * 0.8, [0.46, 0.43, 0.39], 0.4, { kind: PK.DUST, drag: 3.6, rise: 6, turb: 12 });
      }
    }
    // 5. debris: dark chunks with aggressive gravity, plus burning sparks as streaks
    for (let i = 0; i < this.n(big ? 18 : 5); i++) {
      const v = rndDir(n, 0.25); const sp = 220 + Math.random() * 420;
      this.smoke.add({ pos: [...p0], vel: [v[0] * sp, v[1] * sp + 80, v[2] * sp], life: 0.7 + Math.random() * 0.7, size: 1.4 + Math.random() * 2.6, size1: 1.4, color: [0.14, 0.12, 0.1], alpha: 1, alpha1: 1, grav: 1100 });
    }
    this.sparks(p0, n, P.spark, big ? 26 : 8, 560, { color1: P.spark1, life: 0.7, width: 0.7, stretch: 0.028, bias: 0.15, grav: 650, drag: 1.1 });
    // 6. embers drifting up after the blast
    if (big) for (let i = 0; i < this.n(12); i++) {
      this.later(0.08 + Math.random() * 0.3, () => {
        const v = rndDir(n, 0.8); const sp = 40 + Math.random() * 90;
        this.add.add({ pos: off(p0, v, 24 * Math.random()), vel: [v[0] * sp, v[1] * sp + 40, v[2] * sp], life: 1 + Math.random() * 1.2, size: 1.6, size1: 0.5, color: P.ember, color1: [0.6, 0.1, 0.02], alpha: 1, alpha1: 0, drag: 1.5, rise: 30, turb: 60, kind: PK.GLOW });
      });
    }
    // 7. scorch + light punch (the light also lights the young smoke from inside)
    if (big) this.decal(pos, normal, this.scorchTex, 70 + Math.random() * 20, 25);
    const L = this.light(p0, P.light, big ? 420 : 170, big ? 0.7 : 0.3, { intensity: 2.2 });
    L.curve = 2;
    // 8. camera shake with radius falloff
    if (camPos && big) {
      const d = Math.hypot(pos[0] - camPos.x, pos[1] - camPos.y, pos[2] - camPos.z);
      this.shake = Math.min(1.5, this.shake + Math.max(0, 1 - d / 700) * 1.2 * (this.gfx.shake ?? 1));
    }
  }

  // grenade: a thin fuse smoke line and a faint green spark so the arc stays readable
  grenadeTrail(pos) {
    this.puff(pos, [0, 6, 0], 2.5, 12, 1.1, [0.55, 0.56, 0.53], 0.32, { kind: PK.MIST, drag: 1, rise: 6, turb: 10, fadeIn: 0.02 });
    if (this.hi() && Math.random() < 0.5) this.add.add({ pos: [...pos], vel: [0, 0, 0], life: 0.15, size: 3, size1: 1, color: [0.55, 1, 0.3], alpha: 0.8, alpha1: 0, kind: PK.GLOW });
  }

  blood(pos, amount = 6) {
    for (let i = 0; i < amount; i++) {
      const v = rndDir([0, 1, 0], 1); const sp = 40 + Math.random() * 160;
      this.smoke.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], life: 0.4 + Math.random() * 0.3, size: 2, size1: 1.6, color: [0.5, 0.03, 0.02], color1: [0.3, 0, 0], alpha: 1, alpha1: 0.6, grav: 700, drag: 1 });
    }
    this.puff(pos, [0, 10, 0], 6, 22, 0.5, [0.42, 0.03, 0.02], 0.35, { kind: PK.MIST, drag: 4, rise: -10, turb: 6 });
  }

  // A. rail: a thin white-hot core, a narrow electric halo, and an ionised vapour trail that
  // hangs in the air, drifts and slowly curls apart; a sparse spiral of charged motes
  rail(start, end, color, normal, hitWall) {
    const cc = rgb(color);
    const s = new THREE.Vector3(...start), e = new THREE.Vector3(...end);
    const dir = e.clone().sub(s);
    const len = dir.length();
    dir.normalize();
    this.streaks.add({ a: [...start], b: [...end], life: 0.35, width: 0.9, width1: 0.2, color: lerp3(cc, WHITE, 0.7), alpha: 1, alpha1: 0, tail: 1, hot: 1, ease: true });
    this.streaks.add({ a: [...start], b: [...end], life: 0.8, width: 2.2, width1: 4.5, color: cc, alpha: 0.45, alpha1: 0, tail: 1, hot: 0.1 });
    const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const r1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    const r2 = new THREE.Vector3().crossVectors(dir, r1).normalize();
    // vapour: lit grey-blue mist puffs along the beam, born thin, swelling as they drift
    const vstep = this.hi() ? 14 : 24;
    const vap = lerp3([0.6, 0.66, 0.7], cc, 0.2);
    for (let d = 10; d < Math.min(len, 3000); d += vstep) {
      const p = s.clone().addScaledVector(dir, d + Math.random() * vstep);
      const j = r1.clone().multiplyScalar((Math.random() - 0.5) * 6).add(r2.clone().multiplyScalar((Math.random() - 0.5) * 6));
      this.puff([p.x + j.x, p.y + j.y, p.z + j.z], [j.x * 3, 4 + j.y * 3, j.z * 3], 4, 16 + Math.random() * 8, 1.6 + Math.random() * 0.8, vap, 0.22, { kind: PK.MIST, drag: 1.5, rise: 5, turb: 12, fadeIn: 0.03 });
    }
    // sparse spiral of charged motes
    const step = this.hi() ? 6 : 10;
    for (let d = 8, i = 0; d < len; d += step, i++) {
      const a = i * 0.55;
      const o = r1.clone().multiplyScalar(Math.cos(a) * 3.5).add(r2.clone().multiplyScalar(Math.sin(a) * 3.5));
      const p = s.clone().addScaledVector(dir, d).add(o);
      this.add.add({ pos: [p.x, p.y, p.z], vel: [o.x * 2, o.y * 2 + 3, o.z * 2], life: 0.5 + Math.random() * 0.3, size: 1.8, size1: 3, color: lerp3(cc, WHITE, 0.3), color1: cc, alpha: 0.6, alpha1: 0, drag: 2.2, kind: PK.GLOW });
    }
    if (hitWall && normal) {
      this.decal(end, normal, this.splatTex, 14, 20, color, true);
      this.decal(end, normal, this.holeTex, 7, 20);
      this.add.add({ pos: off(end, normal, 2), vel: [0, 0, 0], life: 0.12, size: 30, size1: 40, color: lerp3(cc, WHITE, 0.5), alpha: 0.9, alpha1: 0, kind: PK.GLOW });
      this.light(end, color, 150, 0.35);
      this.sparks(end, normal, lerp3(cc, WHITE, 0.5), 12, 360, { color1: cc, life: 0.4, grav: 500, width: 0.5 });
      this.dust(end, normal, 3, 60, 18, 1.4);
      this.puff(off(end, normal, 4), [normal[0] * 20, normal[1] * 20 + 8, normal[2] * 20], 8, 30, 1.8, [0.5, 0.52, 0.55], 0.35, { drag: 2 });
    }
  }

  // rocket trail: a hot exhaust flame, and a dense white-grey smoke trail that hangs in the air
  // for a couple of seconds, expanding and curling as it drifts
  smokeTrail(pos, vel) {
    const j = () => (Math.random() - 0.5) * 2;
    this.puff([pos[0] + j(), pos[1] + j(), pos[2] + j()], [vel[0] * 0.03 + j() * 8, 6 + j() * 8, vel[2] * 0.03 + j() * 8], 4, 24, 2.2, [0.66, 0.64, 0.62], 0.34, { color1: [0.55, 0.55, 0.56], drag: 1.2, rise: 8, turb: 16, fadeIn: 0.03, kind: Math.random() < 0.5 ? PK.SMOKE : PK.MIST });
    this.add.add({ pos: [...pos], vel: [0, 0, 0], life: 0.08, size: 9, size1: 3, color: [1, 0.66, 0.24], color1: [1, 0.3, 0.05], alpha: 1, alpha1: 0, kind: PK.FIRE, spin: 8 });
    if (this.hi() && Math.random() < 0.25) this.add.add({ pos: [...pos], vel: [j() * 40, j() * 40, j() * 40], life: 0.35, size: 1.2, size1: 0.4, color: [1, 0.7, 0.3], alpha: 1, alpha1: 0, kind: PK.GLOW, grav: 200 });
  }

  sparkle(pos, color, n = 20, spread = 30) {
    const c = rgb(color);
    for (let i = 0; i < this.n(n); i++) {
      this.add.add({ pos: [pos[0] + (Math.random() - 0.5) * spread, pos[1] + Math.random() * spread * 1.5, pos[2] + (Math.random() - 0.5) * spread], vel: [0, 30 + Math.random() * 60, 0], life: 0.6 + Math.random() * 0.4, size: 5, size1: 1, color: c, alpha: 1, alpha1: 0, kind: Math.random() < 0.3 ? PK.SPARK : PK.GLOW, spin: 2 });
    }
  }

  update(dt, camPos) {
    this.time += dt;
    for (const tm of this.timers) { tm.t -= dt; if (tm.t <= 0) tm.fn(); }
    this.timers = this.timers.filter((tm) => tm.t > 0);
    this.add.update(dt, this.time);
    this.smoke.update(dt, this.time);
    this.streaks.update(dt);
    this.wet.update(dt);
    for (const f of this.flashes) {
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.obj.scale.setScalar(f.s0 + (f.s1 - f.s0) * k);
      f.obj.material.opacity = Math.max(0, 1 - k) * f.o;
      if (f.spin) f.obj.material.rotation += f.spin * dt;
      if (f.t >= f.life) { this.scene.remove(f.obj); f.obj.material.dispose(); }
    }
    this.flashes = this.flashes.filter((f) => f.t < f.life);
    for (const b of this.beams) {
      b.t += dt;
      const k = Math.min(1, b.t / b.life);
      if (b.upd) b.upd(k);
      if (b.t >= b.life) for (const o of b.objs) { this.scene.remove(o); o.material.dispose(); }
    }
    this.beams = this.beams.filter((b) => b.t < b.life);
    for (const d of this.decals) {
      d.t += dt;
      if (d.additive) d.mesh.material.opacity = Math.max(0, 1 - d.t / d.life);
      else if (d.t > d.life - 2) d.mesh.material.opacity = Math.max(0, (d.life - d.t) / 2);
      if (d.t >= d.life) { this.scene.remove(d.mesh); d.mesh.material.dispose(); }
    }
    this.decals = this.decals.filter((d) => d.t < d.life);
    for (const l of this.lights) l.t += dt;
    this.lights = this.lights.filter((l) => l.life < 0 || l.t < l.life);
    // pick the 8 most relevant dynamic lights (only the static ambient ones when they're off)
    const dyn = this.gfx.dynLights !== false;
    const cands = this.lights.filter((l) => dyn || l.ambient).map((l) => {
      const p = l.follow ? l.follow() : l.pos;
      if (l.follow && p) l.pos = p;
      let fade = l.life > 0 ? Math.max(0, 1 - l.t / l.life) : 1;
      if (l.curve) fade = Math.pow(fade, l.curve);
      const d = Math.hypot(l.pos[0] - camPos.x, l.pos[1] - camPos.y, l.pos[2] - camPos.z);
      return { l, fade, score: d - l.radius * 2 };
    }).sort((a, b) => a.score - b.score);
    let n = 0;
    for (const c of cands) {
      if (n >= 8) break;
      const { l, fade } = c;
      dynLights.pos[n].set(l.pos[0], l.pos[1], l.pos[2], l.radius);
      dynLights.col[n].set(l.color.r * fade * l.intensity, l.color.g * fade * l.intensity, l.color.b * fade * l.intensity);
      n++;
    }
    dynLights.count.value = n;
  }

  removeLight(l) { const i = this.lights.indexOf(l); if (i >= 0) this.lights.splice(i, 1); }
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function rndDir(n, bias) {
  for (;;) {
    const v = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
    const l = Math.hypot(...v);
    if (l > 1 || l < 0.01) continue;
    v[0] = v[0] / l + n[0] * (1 + bias); v[1] = v[1] / l + n[1] * (1 + bias); v[2] = v[2] / l + n[2] * (1 + bias);
    const l2 = Math.hypot(...v) || 1;
    return [v[0] / l2, v[1] / l2, v[2] / l2];
  }
}
