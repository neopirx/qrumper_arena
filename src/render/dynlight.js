// Dynamic lighting (Graphics → Lighting: Dynamic). On top of the baked lightmaps:
//  - real-time sun shadows: players, rockets, grenades, gibs and pickups cast shadows onto the
//    world wherever the sun reaches. Two depth maps from the sun around the camera: the world
//    alone, and everything; the world shader darkens texels where only the second occludes.
//  - per-pixel lamps: the eight map lights nearest to the camera drive bump relief and
//    highlights in the world shader, so surfaces react to where the lamps really are as you move;
//    some of them flicker (tubes stutter, candles and fires breathe), and the light around them
//    follows.
import * as THREE from 'three';
import { shared } from './shared.js';

const SIZE = 2048, HALF = 1000;

function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export class DynamicLighting {
  constructor(renderer, map, world, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.world = world;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true });
      rt.depthTexture = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType);
      rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
      return rt;
    };
    this.rtAll = mk();
    this.rtWorld = mk();
    this.depthMat = new THREE.MeshDepthMaterial();
    this.depthMat.side = THREE.DoubleSide;
    // a depth-only copy of the world (shares the geometry)
    this.worldScene = new THREE.Scene();
    world.group.traverse((o) => { if (o.isMesh) { const m = new THREE.Mesh(o.geometry, this.depthMat); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); this.worldScene.add(m); } });
    this.cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 6000);
    const sun = map.sun;
    this.sunDir = new THREE.Vector3(...(sun ? sun.dir : [0.3, 1, 0.2])).normalize();
    // how much the sun matters here: strong outdoor suns cast dark shadows, moonlight softer ones
    this.sunK = sun ? Math.min(0.85, 0.35 + (sun.intensity || 1) * 0.4) : 0;
    shared.sunL.value.copy(this.sunDir);
    // lamps: every map light with its own flicker character
    this.lamps = (map.lights || []).map((l, i) => {
      const c = new THREE.Color(l[3]);
      const warm = c.r > c.b * 1.4 && c.r > 0.7;
      const r = hash(i + 1);
      // warm lights near the floor are candles / fires (gentle breathing); a few cold ones are
      // worn-out tubes that stutter; the rest stay steady
      const kind = warm && l[1] < 140 ? 'flame' : warm && r < 0.35 ? 'flame' : r < 0.18 ? 'tube' : 'steady';
      return { p: [l[0], l[1], l[2]], color: c, radius: l[4], k: l[5] ?? 1, kind, seed: r * 100 };
    });
    this.nonCasters = [];
    this.scanT = 0;
    this.enable(true);
  }

  enable(on) {
    shared.dynOn.value = on ? 1 : 0;
    shared.sunK.value = on ? this.sunK : 0;
    shared.shAll.value = on ? this.rtAll.depthTexture : null;
    shared.shWorld.value = on ? this.rtWorld.depthTexture : null;
    if (!on) shared.lampCount.value = 0;
  }

  flicker(l, t) {
    if (l.kind === 'flame') return (Math.sin(t * 7.3 + l.seed) * 0.5 + Math.sin(t * 13.1 + l.seed * 2) * 0.3 + Math.sin(t * 23.7 + l.seed * 3) * 0.2) * 0.22;
    if (l.kind === 'tube') {
      const ph = (t * 0.6 + l.seed) % 7;
      if (ph < 0.5) return (Math.sin(t * 60 + l.seed) > 0.2 ? -0.85 : -0.2);
      return 0;
    }
    return 0;
  }

  // objects that must not cast: sprites, particles, sky, transparent and non-depth-writing stuff
  scan() {
    this.nonCasters.length = 0;
    this.scene.traverse((o) => {
      if (o === this.world.group) return;
      const m = o.material;
      if (o.isSprite || o.isPoints || o.isLine || (m && (Array.isArray(m) ? m.some((x) => x.transparent || !x.depthWrite) : (m.transparent || !m.depthWrite || m.side === THREE.BackSide)))) this.nonCasters.push(o);
    });
  }

  update(camera, time, dt) {
    const R = this.renderer;
    // nearest lamps to the camera, with their flicker this frame
    const cp = camera.position;
    const near = this.lamps.map((l) => ({ l, d: Math.hypot(l.p[0] - cp.x, l.p[1] - cp.y, l.p[2] - cp.z) - l.radius })).sort((a, b) => a.d - b.d).slice(0, 8);
    near.forEach(({ l }, i) => {
      shared.lampPos.value[i].set(l.p[0], l.p[1], l.p[2], l.radius * 1.1);
      const s = l.k * 0.55;
      shared.lampCol.value[i].set(l.color.r * s, l.color.g * s, l.color.b * s);
      shared.lampFl.value[i] = this.flicker(l, time);
    });
    shared.lampCount.value = near.length;
    if (!this.sunK) return;
    // sun shadow camera centred a little ahead of the view, snapped to texels (no shimmering)
    const fwd = camera.getWorldDirection(_v).setY(0).normalize().multiplyScalar(HALF * 0.35);
    const c = _c.copy(cp).add(fwd);
    this.cam.position.copy(c).addScaledVector(this.sunDir, 2500);
    this.cam.lookAt(c);
    this.cam.updateMatrixWorld();
    const texel = (HALF * 2) / SIZE;
    _q.copy(this.cam.quaternion).invert();
    _v.copy(this.cam.position).applyQuaternion(_q);
    _v.x = Math.round(_v.x / texel) * texel; _v.y = Math.round(_v.y / texel) * texel;
    this.cam.position.copy(_v.applyQuaternion(this.cam.quaternion));
    this.cam.updateMatrixWorld();
    shared.shMat.value.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    if ((this.scanT -= dt) <= 0) { this.scanT = 0.5; this.scan(); }
    const prevTarget = R.getRenderTarget(), prevOverride = this.scene.overrideMaterial, prevBg = this.scene.background;
    const vis = this.nonCasters.map((o) => o.visible);
    for (const o of this.nonCasters) o.visible = false;
    this.scene.overrideMaterial = this.depthMat;
    this.scene.background = null;
    R.setRenderTarget(this.rtAll); R.clear(); R.render(this.scene, this.cam);
    R.setRenderTarget(this.rtWorld); R.clear(); R.render(this.worldScene, this.cam);
    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBg;
    this.nonCasters.forEach((o, i) => { o.visible = vis[i]; });
    R.setRenderTarget(prevTarget);
  }

  dispose() {
    this.enable(false);
    this.rtAll.dispose(); this.rtWorld.dispose(); this.depthMat.dispose();
  }
}
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
