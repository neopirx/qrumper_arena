// World textures, finished the way the visual spec asks (section 3): one diffuse that carries its
// own shading. At load time every colour map gets a "paint pass" driven by its normal map:
//   - ambient-occlusion pass: seams and recesses (concave curvature) are darkened,
//   - stage-light pass: faces tilted toward an imagined overhead light get a bright top-edge
//     highlight, faces tilted away get a shadow line,
//   - contrast is pushed; saturation is rationed later, per map, in the world shader.
// Also generates procedural trim-sheet textures (hazard chevrons, riveted trim, light panels).
import * as THREE from 'three';

const SIZE = 256;

function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = encodeURI(url);
  });
}

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

// rows arrive top-first (canvas order); textures want the image top at v=1, so flip them
function dataTex(src, w, h) {
  const data = new Uint8Array(w * h * 4);
  const row = w * 4;
  for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.flipY = false;
  filterTex(t);
  ALL.push(t);
  return t;
}

// Texture filtering (Graphics setting): 'aniso' (sharp at grazing angles), 'trilinear' (the era's
// default, distance blurs) or 'nearest' (crunchy software-renderer texels). Applies live.
const ALL = [];
let FILTER = 'aniso', MAX_ANISO = 8;
function filterTex(t) {
  t.minFilter = FILTER === 'nearest' ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
  t.magFilter = FILTER === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  t.anisotropy = FILTER === 'aniso' ? MAX_ANISO : 1;
  t.needsUpdate = true;
}
export function setTextureFilter(mode, renderer) {
  if (renderer) MAX_ANISO = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 1);
  if (mode === FILTER && !renderer) return;
  FILTER = mode;
  for (const t of ALL) filterTex(t);
}

// The paint pass. col/nrm are ImageData of equal size; returns RGBA bytes.
// Normal maps in this pack use the DirectX convention (green = image-down).
function paint(col, nrm) {
  const w = col.width, h = col.height, c = col.data;
  const out = new Uint8ClampedArray(c.length);
  if (!nrm || nrm.width !== w || nrm.height !== h) { out.set(c); return out; }
  const n = nrm.data;
  const nx = new Float32Array(w * h), ny = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { nx[i] = (n[i * 4] - 128) / 127; ny[i] = (128 - n[i * 4 + 1]) / 127; } // ny: +up
  // curvature (divergence of the normal's tilt): >0 on bumps, <0 in grooves
  const curv = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xr = (x + 1) % w, xl = (x - 1 + w) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
    curv[y * w + x] = (nx[y * w + xr] - nx[y * w + xl]) * 0.5 + (ny[yu * w + x] - ny[yd * w + x]) * 0.5;
  }
  // blur the cavity term a little so seams read as painted shadow bands, not pixel noise
  const cav = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += curv[((y + dy + h) % h) * w + ((x + dx + w) % w)];
    cav[y * w + x] = s / 25;
  }
  // stage light from above and slightly left
  const L = [-0.3, 0.75, 0.59];
  const flat = L[2];
  for (let i = 0; i < w * h; i++) {
    const tx = nx[i], ty = ny[i];
    const tz = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
    const lit = tx * L[0] + ty * L[1] + tz * L[2] - flat;           // -1..+0.4
    let k = 1 + lit * 1.5;                                          // edge highlight / shadow line
    k *= 1 - Math.min(0.6, Math.max(0, -cav[i]) * 2.6);            // AO in grooves
    k *= 1 + Math.min(0.25, Math.max(0, cav[i]) * 0.8);             // raised tops catch light
    for (let ch = 0; ch < 3; ch++) {
      let v = c[i * 4 + ch] / 255;
      v = (v - 0.5) * 1.18 + 0.5;                                   // export high-contrast
      out[i * 4 + ch] = Math.max(0, Math.min(255, v * k * 255));
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------- procedural trim sheets ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvas2d(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

function grime(g, s, r, n, alpha) {
  // drip streaks (drip direction is down) and blotches
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, len = 10 + r() * 60;
    const gr = g.createLinearGradient(x, y, x, y + len);
    gr.addColorStop(0, `rgba(10,8,6,${alpha})`); gr.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = gr; g.fillRect(x, y, 1 + r() * 3, len);
  }
}

function bevelBand(g, s, y0, y1) {
  // shadow line below, highlight on top: the "assembled panel" read
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y0, s, 2);
  g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, y1 - 2, s, 2);
}

const PROCS = {
  // yellow-black chevrons, half worn
  proc_hazard: (g, s) => {
    const r = rng(7);
    g.fillStyle = '#1a1714'; g.fillRect(0, 0, s, s);
    g.save();
    for (let i = -s; i < s * 2; i += 64) {
      g.fillStyle = '#d9a81c';
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 - s, s); g.lineTo(i - s, s); g.closePath(); g.fill();
    }
    g.restore();
    // chips revealing bare metal, concentrated near the edges where boots hit
    for (let i = 0; i < 260; i++) {
      const y = r() < 0.6 ? (r() < 0.5 ? r() * 30 : s - r() * 30) : r() * s;
      g.fillStyle = r() < 0.5 ? 'rgba(90,88,84,0.9)' : 'rgba(30,26,22,0.8)';
      g.fillRect(r() * s, y, 1 + r() * 5, 1 + r() * 3);
    }
    grime(g, s, r, 40, 0.5);
    bevelBand(g, s, 0, s);
  },
  // gunmetal trim strip with rivet rows and seams
  proc_trim: (g, s) => {
    const r = rng(11);
    g.fillStyle = '#3b3f46'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1600; i++) { const v = 50 + r() * 20; g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.5)`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1); }
    for (const [y0, y1] of [[0, 64], [64, 192], [192, 256]]) {
      bevelBand(g, s, y0, y1);
      for (let x = 12; x < s; x += 32) for (const y of [y0 + 9, y1 - 11]) {
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(x + 1, y + 1, 3.2, 0, 7); g.fill();
        g.fillStyle = '#7d828a'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x - 2, y - 2, 2, 1);
        g.fillStyle = 'rgba(20,14,8,0.35)'; g.fillRect(x - 1, y + 3, 2, 10 + r() * 10); // streak under bolt
      }
    }
    // vent louvres in the middle band
    for (let y = 92; y < 168; y += 10) { g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(40, y, 176, 4); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(40, y + 4, 176, 1); }
    grime(g, s, r, 30, 0.35);
  },
  // light panel: fullbright core with painted overbright halo (spec: emissive fixtures)
  proc_light: (g, s) => {
    g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, s, s);
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#303034'); gr.addColorStop(0.2, '#c8c8c8'); gr.addColorStop(0.35, '#ffffff');
    gr.addColorStop(0.65, '#ffffff'); gr.addColorStop(0.8, '#c8c8c8'); gr.addColorStop(1, '#303034');
    g.fillStyle = gr; g.fillRect(0, 24, s, s - 48);
    for (let x = 0; x < s; x += 64) { g.fillStyle = '#1c1c20'; g.fillRect(x, 0, 6, s); }
    bevelBand(g, s, 0, 24); bevelBand(g, s, s - 24, s);
  },
  // dark tech panel with operational pinlights (fullbright parts are handled by the light strip)
  proc_tech: (g, s) => {
    const r = rng(5);
    g.fillStyle = '#20252e'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1200; i++) { const v = 28 + r() * 18; g.fillStyle = `rgba(${v},${v + 4},${v + 12},0.6)`; g.fillRect(r() * s, r() * s, 1 + r() * 3, 1); }
    for (const [x0, y0, x1, y1] of [[0, 0, 128, 96], [128, 0, 256, 96], [0, 96, 256, 176], [0, 176, 96, 256], [96, 176, 256, 256]]) {
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0, y0, x1 - x0, 2); g.fillRect(x0, y0, 2, y1 - y0);
      g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x0, y1 - 2, x1 - x0, 2); g.fillRect(x1 - 2, y0, 2, y1 - y0);
    }
    for (let i = 0; i < 14; i++) { g.fillStyle = r() < 0.5 ? '#3cff6a' : '#ff9a2a'; g.fillRect(16 + r() * 220, 110 + r() * 50, 3, 3); }
    for (let y = 196; y < 248; y += 8) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(112, y, 128, 3); }
    grime(g, s, r, 25, 0.3);
  },
};

// Texture names: plain names are files in textures_01 (with normal maps), `g/<name>` the gothic
// pack in textures_02 (256 px, no normals) and `s/<name>` the Level Eleven sci-fi pack in
// textures_03 (64 px, no normals). `scale` is world units per repeat relative to TEX_UNITS.
const SCIFI = '/textures/textures_03/Level Eleven Games Sci-Fi Texture Pack v1/';
export function texSource(name) {
  if (name.startsWith('g/')) return { color: `/textures/textures_02/${name.slice(2)}.png`, normal: null, bump: 2.2 };
  if (name.startsWith('s/')) return { color: `${SCIFI}${name.slice(2)}.png`, normal: null, bump: 3.0 };
  return { color: `/textures/textures_01/Color Maps/${name}.png`, normal: `/textures/textures_01/Normal Maps/${name}_normal.png` };
}
export const texScale = (name) => (typeof name === 'string' && name.startsWith('s/') ? 0.5 : 1);

function upscale(img, min) {
  const k = Math.max(1, Math.round(min / Math.max(img.width, img.height)));
  const c = document.createElement('canvas');
  c.width = img.width * k; c.height = img.height * k;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);   // masked textures: holes go black
  g.drawImage(img, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}

// tangent-space normal map (DirectX convention like the main pack) from luminance as height
function heightNormal(col, strength = 2.5) {
  const w = col.width, h = col.height, c = col.data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (c[i * 4] * 0.3 + c[i * 4 + 1] * 0.59 + c[i * 4 + 2] * 0.11) / 255;
  // soften so the normals describe shapes (bevels, rivets, bricks), not pixel noise
  const B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) s += H[((y + d + h) % h) * w + ((x + e + w) % w)];
    B[y * w + x] = s / 9;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (B[y * w + (x + 1) % w] - B[y * w + (x - 1 + w) % w]) * strength;
    const dy = (B[((y + 1) % h) * w + x] - B[((y - 1 + h) % h) * w + x]) * strength;
    let nx = -dx, ny = dy, nz = 1;   // ny: +down in image space (DirectX green)
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = 128 + nx * 127; out[i + 1] = 128 + ny * 127; out[i + 2] = 128 + nz * 127; out[i + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

export class TextureBank {
  constructor() {
    this.cache = new Map();
    this.flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    this.flat.needsUpdate = true;
    this.white = dataTex(new Uint8Array(SIZE * SIZE * 4).fill(200), SIZE, SIZE);
  }

  // Resolves to { map, nmap } for a texture name.
  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const p = this._make(name);
    this.cache.set(name, p);
    return p;
  }

  async _make(name) {
    if (PROCS[name]) return { map: dataTex(new Uint8Array(canvas2d(PROCS[name])), SIZE, SIZE), nmap: this.flat };
    const src = texSource(name);
    const [ci, ni] = await Promise.all([loadImage(src.color), src.normal ? loadImage(src.normal) : null]);
    if (!ci) return { map: this.white, nmap: this.flat };
    // small pixel-art textures (the 64 px sci-fi pack) are blown up with nearest sampling so their
    // texels stay crisp under trilinear / anisotropic filtering
    const col = upscale(ci, SIZE);
    // packs without normal maps get one derived from the colour's luminance, so the paint pass
    // (seam AO, top-edge highlights) and the normal-mapped lighting still have something to bite on
    const nrm = ni ? pixels(ni) : heightNormal(col, src.bump);
    const map = dataTex(new Uint8Array(paint(col, nrm).buffer), col.width, col.height);
    let nmap = this.flat;
    if (ni) {
      nmap = dataTex(new Uint8Array(nrm.data.buffer), nrm.width, nrm.height);
    }
    return { map, nmap };
  }
}
