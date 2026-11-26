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
// particle kinds (atlas cells); 0 is the plain procedural disc used by gore and debris
export const PK = { DISC: 0, FIRE: 1, SMOKE: 2, SPARK: 3, GLOW: 4 };
const QUALITY = { low: 0.35, medium: 0.65, high: 1 };

const particleVert = /* glsl */`
attribute float size;
attribute vec4 pcolor;
attribute vec2 pinfo;
varying vec4 vColor;
varying vec2 vInfo;
varying float vFog;
uniform float scale;
uniform float maxSize;
void main() {
  vColor = pcolor;
  vInfo = pinfo;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = -mv.z;
  gl_PointSize = min(size * scale / max(1.0, -mv.z), maxSize);
  gl_Position = projectionMatrix * mv;
}`;
// additive: white-hot core, colour body, transparent rim. smoke: hard-edged puff with painted
// top-left light (a discrete card, never a soft gas). Both respect the zone fog.
const particleFrag = /* glsl */`
uniform sampler2D atlas;
varying vec4 vColor;
varying vec2 vInfo;
varying float vFog;
uniform float additive;
uniform vec3 fogColor;
uniform float fogDensity;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float f = 1.0 - exp(-fogDensity * vFog);
  float kind = vInfo.x;
  if (kind < 0.5) {
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    if (additive > 0.5) {
      vec3 c = mix(vec3(1.0), vColor.rgb, smoothstep(0.0, 0.45, r));
      float a = vColor.a * (1.0 - smoothstep(0.7, 0.9, r)) * (1.0 - r * 0.35);
      gl_FragColor = vec4(c * a * (1.0 - f), 1.0);
    } else {
      float a = vColor.a * (1.0 - smoothstep(0.86, 0.96, r));
      vec3 c = vColor.rgb * (1.08 - 0.4 * r);
      c *= 1.0 + 0.25 * step(0.0, -d.y - d.x * 0.5) * (1.0 - r);
      gl_FragColor = vec4(mix(c, fogColor, f), a);
    }
    return;
  }
  float cs = cos(vInfo.y), sn = sin(vInfo.y);
  vec2 r = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
  if (abs(r.x) > 0.5 || abs(r.y) > 0.5) discard;
  float k = kind - 1.0;
  vec2 cell = vec2(mod(k, 2.0), floor(k / 2.0));
  vec4 t = texture2D(atlas, (cell + 0.5 + r * 0.97) * 0.5);
  if (additive > 0.5) {
    float hot = smoothstep(0.82, 1.0, t.r);
    vec3 c = mix(vColor.rgb, vec3(1.0), hot * 0.6);
    float a = t.a * vColor.a;
    gl_FragColor = vec4(c * a * (1.0 - f), 1.0);
  } else {
    float a = smoothstep(0.38, 0.62, t.a) * vColor.a;
    if (a < 0.01) discard;
    vec3 c = vColor.rgb * (0.55 + 0.6 * t.r);
    gl_FragColor = vec4(mix(c, fogColor, f), a);
  }
}`;

// procedural 2x2 atlas: fire ball, smoke puff, spark star, soft glow (grey ramps, tinted per particle)
function makeAtlas() {
  const S = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // fire: lumpy overlapping hot blobs, brightest at the heart
  g.save(); g.translate(H / 2, H / 2);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.28, dd = rnd() * H * 0.2, rr = H * (0.12 + rnd() * 0.16);
    const x = Math.cos(a) * dd, y = Math.sin(a) * dd;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(200,200,200,0.35)'); gr.addColorStop(1, 'rgba(120,120,120,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, H * 0.22);
  core.addColorStop(0, 'rgba(255,255,255,0.9)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.fillRect(-H / 2, -H / 2, H, H);
  g.restore();
  // smoke: cauliflower puff with hard edge, lit from the top left (r = shade, a = coverage)
  g.save(); g.translate(H + H / 2, H / 2);
  const lobes = [[0, 0, 0.27]];
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28 + rnd() * 0.5, dd = H * (0.15 + rnd() * 0.06); lobes.push([Math.cos(a) * dd, Math.sin(a) * dd, 0.12 + rnd() * 0.08]); }
  for (const [x, y, r] of lobes) {
    const rr = r * H;
    const gr = g.createRadialGradient(x - rr * 0.35, y - rr * 0.45, rr * 0.1, x, y, rr);
    gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.6, 'rgb(150,150,150)'); gr.addColorStop(1, 'rgb(70,70,70)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
  }
  g.restore();
  // spark: thin 4-point star with a round hot core
  g.save(); g.translate(H / 2, H + H / 2);
  for (const [len, w, a, rot] of [[0.5, 0.07, 1, 0], [0.3, 0.05, 0.7, Math.PI / 4]]) {
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate(i * Math.PI / 2 + rot);
      const gr = g.createLinearGradient(0, 0, H * len, 0);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -H * w); g.lineTo(H * len, 0); g.lineTo(0, H * w); g.fill(); g.restore();
    }
  }
  const sc = g.createRadialGradient(0, 0, 0, 0, 0, H * 0.18);
  sc.addColorStop(0, 'rgba(255,255,255,1)'); sc.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sc; g.fillRect(-H / 2, -H / 2, H, H);
  g.restore();
  // glow: smooth falloff with a small hot centre
  g.save(); g.translate(H + H / 2, H + H / 2);
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, H / 2);
  gl.addColorStop(0, 'rgba(255,255,255,1)'); gl.addColorStop(0.15, 'rgba(230,230,230,0.75)'); gl.addColorStop(0.45, 'rgba(160,160,160,0.25)'); gl.addColorStop(1, 'rgba(100,100,100,0)');
  g.fillStyle = gl; g.fillRect(-H / 2, -H / 2, H, H);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

class ParticleSystem {
  constructor(scene, additive, atlas) {
    this.n = 0;
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 4);
    this.size = new Float32Array(MAX_P);
    this.info = new Float32Array(MAX_P * 2);
    this.p = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pinfo', new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: particleVert, fragmentShader: particleFrag,
      uniforms: { scale: { value: 600 }, additive: { value: additive ? 1 : 0 }, maxSize: { value: 512 }, fogColor: shared.fogColor, fogDensity: shared.fogDensity, atlas: { value: atlas } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  // p: {pos:[3], vel:[3], life, size, size1, color:[r,g,b], color1, alpha, alpha1, grav, drag, kind, rot, spin, rise}
  add(p) {
    if (this.p.length >= MAX_P) this.p.shift();
    p.t = 0;
    if (p.kind && p.rot == null) p.rot = Math.random() * 6.28;
    this.p.push(p);
    return p;
  }
  update(dt) {
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
      p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
      if (p.spin) p.rot += p.spin * dt;
      this.pos[n * 3] = p.pos[0]; this.pos[n * 3 + 1] = p.pos[1]; this.pos[n * 3 + 2] = p.pos[2];
      // alpha follows a quick fade-in (fire) and a linear ramp
      let a = (p.alpha ?? 1) + ((p.alpha1 ?? 0) - (p.alpha ?? 1)) * (p.ease ? k * k : k);
      if (p.fadeIn) a *= Math.min(1, p.t / p.fadeIn);
      const c = p.color, c1 = p.color1 || c;
      const kc = p.colorEase ? Math.sqrt(k) : k;
      this.col[n * 4] = c[0] + (c1[0] - c[0]) * kc; this.col[n * 4 + 1] = c[1] + (c1[1] - c[1]) * kc; this.col[n * 4 + 2] = c[2] + (c1[2] - c[2]) * kc;
      this.col[n * 4 + 3] = a;
      const ks = p.sizeEase ? 1 - (1 - k) * (1 - k) : k;
      this.size[n] = p.size + ((p.size1 ?? p.size) - p.size) * ks;
      this.info[n * 2] = p.kind || 0; this.info[n * 2 + 1] = p.rot || 0;
      n++;
    }
    this.p = keep;
    this.n = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'pcolor', 'size', 'pinfo']) this.geo.attributes[k].needsUpdate = true;
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
    // stylized 4+4 point muzzle star
    this.starTex = makeCanvasTex((g, s) => {
      const c = s / 2;
      g.translate(c, c);
      for (const [len, w, a] of [[0.5, 0.1, 1], [0.34, 0.075, 0.8]]) {
        for (let i = 0; i < 4; i++) {
          g.save(); g.rotate(i * Math.PI / 2 + (a < 1 ? Math.PI / 4 : 0));
          const gr = g.createLinearGradient(0, 0, s * len, 0);
          gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.6, `rgba(255,255,255,${a * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.beginPath(); g.moveTo(0, -s * w); g.quadraticCurveTo(s * len * 0.3, -s * w * 0.3, s * len, 0); g.quadraticCurveTo(s * len * 0.3, s * w * 0.3, 0, s * w); g.fill(); g.restore();
        }
      }
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.24);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(-c, -c, s, s);
    }, 128);
    this.ringTex = makeCanvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.82, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, 128);
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  }

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

  // ---------- weapon archetypes ----------
  // A. hitscan muzzle (third person): star + glow, a short forward petal, brief light
  muzzleFlash(pos, color = 0xffc060, radius = 160, dir = null, weapon = null) {
    const c = new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.35);
    const big = weapon === 'sg' || weapon === 'rl' || weapon === 'gl';
    this.flash(pos, this.starTex, c, big ? 34 : 22, big ? 46 : 28, 0.05, 1);
    this.flash(pos, this.glowTex, color, big ? 40 : 26, big ? 56 : 34, 0.07, 0.6);
    if (dir && weapon !== 'rg') {
      const cc = rgb(color);
      this.streaks.add({ a: [...pos], b: off(pos, dir, big ? 30 : 20), life: 0.05, width: big ? 5 : 3.5, width1: 2, color: lerp3(cc, WHITE, 0.3), alpha: 1, alpha1: 0, tail: 0.2, hot: 1 });
    }
    if (weapon !== 'mg') this.light(pos, color, radius, 0.07, { intensity: 1.3 });
    else if (Math.random() < 0.5) this.light(pos, color, radius * 0.7, 0.04, { intensity: 0.8 });
    if (dir && (weapon === 'sg' || weapon === 'rl' || weapon === 'gl')) {
      for (let i = 0; i < this.n(weapon === 'sg' ? 4 : 3); i++) {
        const sp = 40 + Math.random() * 60;
        this.smoke.add({ pos: off(pos, dir, 8), vel: [dir[0] * sp, dir[1] * sp + 10, dir[2] * sp], life: 0.6, size: 6, size1: 18, color: [0.5, 0.47, 0.42], alpha: 0.55, alpha1: 0, drag: 3, kind: PK.SMOKE, spin: (Math.random() - 0.5) * 2, sizeEase: true });
      }
    }
  }

  // white-hot tracer streak flying from muzzle to impact, tapering to a transparent tail
  tracer(from, to, color) {
    if (!from) return;
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 60) return;
    const u = [d[0] / len, d[1] / len, d[2] / len];
    const seg = Math.min(140, len * 0.45);
    const speed = 7500;
    const life = Math.max(0.03, (len - seg) / speed);
    const c = lerp3(rgb(color), WHITE, 0.35);
    this.streaks.add({
      a: [...from], b: off(from, u, seg), life, width: 1.1, color: c, alpha: 1, alpha1: 0.85, tail: 0, hot: 0.9,
      upd: (s, k) => { const o = k * (len - seg); s.a = off(from, u, o); s.b = off(from, u, o + seg); },
    });
  }

  // impact: bright pop, stretched ricochet sparks, dust puff, hole decal
  bulletImpact(pos, normal, kind = 'mg', from = null) {
    const n = normal || [0, 1, 0];
    const c = rgb(kind === 'sg' ? 0xff9a26 : 0xffe68a);
    this.sparks(pos, n, c, kind === 'sg' ? 3 : 5, kind === 'sg' ? 260 : 340, { life: 0.22, width: 0.6 });
    this.add.add({ pos: off(pos, n, 2), vel: [0, 0, 0], life: 0.06, size: 12, size1: 7, color: c, alpha: 1, alpha1: 0, kind: PK.SPARK });
    this.add.add({ pos: off(pos, n, 1.5), vel: [0, 0, 0], life: 0.12, size: 9, size1: 14, color: lerp3(c, [1, 0.4, 0.1], 0.5), alpha: 0.6, alpha1: 0, kind: PK.GLOW });
    this.smoke.add({ pos: off(pos, n, 3), vel: [n[0] * 30, n[1] * 30 + 12, n[2] * 30], life: 0.7, size: 5, size1: 17, color: [0.46, 0.43, 0.39], alpha: 0.6, alpha1: 0, drag: 2.5, kind: PK.SMOKE, spin: (Math.random() - 0.5) * 2, sizeEase: true });
    // chips of the wall, hard-alpha
    if (this.hi()) for (let i = 0; i < 2; i++) {
      const v = rndDir(n, 0.4); const sp = 120 + Math.random() * 160;
      this.smoke.add({ pos: off(pos, n, 1), vel: [v[0] * sp, v[1] * sp + 40, v[2] * sp], life: 0.5, size: 1.4, size1: 1.2, color: [0.18, 0.16, 0.14], alpha: 1, alpha1: 1, grav: 900 });
    }
    if (Math.random() < 0.8) this.decal(pos, normal, this.holeTex, 4 + Math.random() * 2, 15);
    if (from && (kind === 'mg' || Math.random() < 0.6)) this.tracer(from, pos, kind === 'sg' ? 0xff9a26 : 0xffe68a);
  }

  // C. rocket / grenade explosion, layered in order (spec 7.3 C)
  explosion(pos, normal, big = true, camPos = null, kind = 'rocket') {
    const P = BLAST[kind] || BLAST.rocket;
    const n = normal || [0, 1, 0];
    const p0 = off(pos, n, 8);
    const S = big ? 1 : 0.4;
    // 1. white-hot core flash, 1-2 frames, and a spherical flash ring
    this.flash(p0, this.glowTex, P.core, 70 * S, 110 * S, 0.06, 0.9);
    this.flash(p0, this.starTex, P.star, 100 * S, 160 * S, 0.09, 0.9);
    this.flash(p0, this.ringTex, P.ring, 30 * S, 190 * S, 0.22, 0.55);
    // 2. fireball: lumpy fire sprites, spinning, burning down through the palette
    for (let i = 0; i < this.n(big ? 14 : 5); i++) {
      const v = rndDir(n, 0.35); const sp = 50 + Math.random() * 170;
      this.add.add({ pos: off(p0, v, 6), vel: [v[0] * sp, v[1] * sp + 20, v[2] * sp], life: 0.3 + Math.random() * 0.2, size: 30 * S, size1: (62 + Math.random() * 20) * S, color: P.fire, color1: P.fire1, alpha: 0.7, alpha1: 0, drag: 5, kind: PK.FIRE, spin: (Math.random() - 0.5) * 4, sizeEase: true, colorEase: true });
    }
    for (let i = 0; i < this.n(big ? 5 : 2); i++) {
      this.add.add({ pos: [...p0], vel: [0, 0, 0], life: 0.12, size: 45 * S, size1: 70 * S, color: lerp3(P.fire, WHITE, 0.3), alpha: 0.55, alpha1: 0, kind: PK.FIRE, spin: 3 });
    }
    // 3. dark oily smoke, staggered, drifting out and up
    for (let i = 0; i < this.n(big ? 10 : 3); i++) {
      this.later(0.05 + i * 0.03, () => {
        const v = rndDir(n, 0.6); const sp = 30 + Math.random() * 70;
        this.smoke.add({ pos: off(p0, v, 16), vel: [v[0] * sp, v[1] * sp + 30, v[2] * sp], life: 1.2 + Math.random() * 0.6, size: 30 * S, size1: 80 * S, color: [0.32, 0.27, 0.23], color1: [0.15, 0.14, 0.14], alpha: 0.95, alpha1: 0, ease: true, drag: 1.6, rise: 12, kind: PK.SMOKE, spin: (Math.random() - 0.5) * 0.8, sizeEase: true });
      });
    }
    // 4. shockwave flat against the surface
    if (big) this.shockwave(pos, n, P.ring, 130, 0.38);
    // 5. debris: dark chunks with aggressive gravity, plus burning sparks as streaks
    for (let i = 0; i < this.n(big ? 14 : 4); i++) {
      const v = rndDir(n, 0.25); const sp = 220 + Math.random() * 380;
      this.smoke.add({ pos: [...p0], vel: [v[0] * sp, v[1] * sp + 80, v[2] * sp], life: 0.6 + Math.random() * 0.6, size: 2 + Math.random() * 3, size1: 2, color: [0.12, 0.1, 0.08], alpha: 1, alpha1: 1, grav: 1100 });
    }
    this.sparks(p0, n, P.spark, big ? 22 : 7, 480, { color1: P.spark1, life: 0.55, width: 1, stretch: 0.03, bias: 0.1, grav: 700, drag: 1.2 });
    // 6. embers drifting up after the blast
    if (big) for (let i = 0; i < this.n(10); i++) {
      this.later(0.08 + Math.random() * 0.2, () => {
        const v = rndDir(n, 0.8); const sp = 40 + Math.random() * 90;
        this.add.add({ pos: off(p0, v, 20 * Math.random()), vel: [v[0] * sp, v[1] * sp + 40, v[2] * sp], life: 0.9 + Math.random() * 0.8, size: 2.5, size1: 0.8, color: P.ember, color1: [0.6, 0.1, 0.02], alpha: 1, alpha1: 0, drag: 1.5, rise: 30, kind: PK.GLOW });
      });
    }
    // 7. scorch + light punch
    if (big) this.decal(pos, normal, this.scorchTex, 70 + Math.random() * 20, 25);
    this.light(p0, P.light, big ? 400 : 160, big ? 0.5 : 0.25, { intensity: 2 });
    // 8. camera shake with radius falloff
    if (camPos && big) {
      const d = Math.hypot(pos[0] - camPos.x, pos[1] - camPos.y, pos[2] - camPos.z);
      this.shake = Math.min(1.5, this.shake + Math.max(0, 1 - d / 700) * 1.2 * (this.gfx.shake ?? 1));
    }
  }

  // grenade: grey wisps and a faint green spark so the arc stays readable
  grenadeTrail(pos) {
    this.smoke.add({ pos: [...pos], vel: [0, 10, 0], life: 0.55, size: 3, size1: 12, color: [0.44, 0.45, 0.42], color1: [0.22, 0.22, 0.2], alpha: 0.6, alpha1: 0, drag: 1, kind: PK.SMOKE, sizeEase: true, spin: 1 });
    if (this.hi() && Math.random() < 0.5) this.add.add({ pos: [...pos], vel: [0, 0, 0], life: 0.18, size: 4, size1: 1, color: [0.55, 1, 0.3], alpha: 0.8, alpha1: 0, kind: PK.GLOW });
  }

  blood(pos, amount = 6) {
    for (let i = 0; i < amount; i++) {
      const v = rndDir([0, 1, 0], 1); const sp = 40 + Math.random() * 160;
      this.smoke.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], life: 0.4 + Math.random() * 0.3, size: 5, size1: 10, color: [0.6, 0.03, 0.02], color1: [0.3, 0, 0], alpha: 1, alpha1: 0, grav: 500, drag: 2 });
    }
  }

  // A. rail: white-hot core ribbon, electric cyan halo, a tight spiral that unwinds and drifts,
  // lingering about a second (spec 7.3 A / 7.4 rail row)
  rail(start, end, color, normal, hitWall) {
    const cc = rgb(color);
    const s = new THREE.Vector3(...start), e = new THREE.Vector3(...end);
    const dir = e.clone().sub(s);
    const len = dir.length();
    dir.normalize();
    this.streaks.add({ a: [...start], b: [...end], life: 0.55, width: 1.3, width1: 0.4, color: lerp3(cc, WHITE, 0.6), alpha: 1, alpha1: 0, tail: 1, hot: 1 });
    this.streaks.add({ a: [...start], b: [...end], life: 1.0, width: 2.6, width1: 5, color: cc, alpha: 0.6, alpha1: 0, tail: 1, hot: 0.2 });
    const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const r1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    const r2 = new THREE.Vector3().crossVectors(dir, r1).normalize();
    const step = this.hi() ? 4 : 7;
    for (let d = 8, i = 0; d < len; d += step, i++) {
      const a = i * 0.42 * (step / 6);
      const o = r1.clone().multiplyScalar(Math.cos(a) * 4).add(r2.clone().multiplyScalar(Math.sin(a) * 4));
      const p = s.clone().addScaledVector(dir, d).add(o);
      this.add.add({ pos: [p.x, p.y, p.z], vel: [o.x * 3, o.y * 3 + 4, o.z * 3], life: 0.9 + Math.random() * 0.3, size: 2.8, size1: 6, color: lerp3(cc, WHITE, 0.25), color1: cc, alpha: 0.85, alpha1: 0, drag: 2.2, kind: PK.GLOW });
    }
    // muzzle ring at the start
    this.flash(off(start, [dir.x, dir.y, dir.z], 6), this.ringTex, color, 3, 12, 0.15, 0.7);
    if (hitWall && normal) {
      this.decal(end, normal, this.splatTex, 16, 20, color, true);
      this.decal(end, normal, this.holeTex, 8, 20);
      this.flash(off(end, normal, 3), this.starTex, lerp3(cc, WHITE, 0.4), 30, 40, 0.1, 1);
      this.shockwave(end, normal, color, 26, 0.3, 0.8);
      this.light(end, color, 150, 0.35);
      this.sparks(end, normal, lerp3(cc, WHITE, 0.4), 10, 300, { color1: cc, life: 0.35, grav: 500 });
      this.smoke.add({ pos: off(end, normal, 4), vel: [normal[0] * 20, normal[1] * 20 + 10, normal[2] * 20], life: 0.9, size: 8, size1: 24, color: [0.4, 0.45, 0.48], alpha: 0.5, alpha1: 0, drag: 2, kind: PK.SMOKE, sizeEase: true, spin: 0.5 });
    }
  }

  // rocket trail: oil-black puffs telegraph the trajectory, with a hot orange exhaust core
  smokeTrail(pos, vel) {
    const j = () => (Math.random() - 0.5) * 2.5;
    this.smoke.add({ pos: [pos[0] + j(), pos[1] + j(), pos[2] + j()], vel: [vel[0] * 0.02, 16, vel[2] * 0.02], life: 0.95, size: 6, size1: 26, color: [0.24, 0.21, 0.19], color1: [0.13, 0.13, 0.13], alpha: 0.8, alpha1: 0, drag: 1, kind: PK.SMOKE, spin: (Math.random() - 0.5) * 1.5, sizeEase: true });
    this.add.add({ pos: [...pos], vel: [0, 0, 0], life: 0.1, size: 10, size1: 3, color: [1, 0.66, 0.24], color1: [1, 0.3, 0.05], alpha: 1, alpha1: 0, kind: PK.FIRE });
    if (this.hi() && Math.random() < 0.3) this.add.add({ pos: [...pos], vel: [j() * 20, j() * 20, j() * 20], life: 0.4, size: 1.8, size1: 0.6, color: [1, 0.7, 0.3], alpha: 1, alpha1: 0, kind: PK.GLOW, grav: 200 });
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
    this.add.update(dt);
    this.smoke.update(dt);
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
      const fade = l.life > 0 ? Math.max(0, 1 - l.t / l.life) : 1;
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
