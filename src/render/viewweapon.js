// First-person weapon: rendered in its own pass so it never clips into walls.
// The player's gun settings (side / height / depth / size / tilt / hand) are applied on top of
// the per-model base placement, so the settings preview and the game draw the gun identically.
import * as THREE from 'three';
import { cloneWeapon, setLight, WEAPON_MODEL_FOR } from './assets.js';
import { WEAPONS, WEAPON_ORDER } from '../sim/defs.js';
import { gunFor } from '../client/crosshair.js';
import { flameTextures } from './effects.js';

// base [x, y, z] of the weapon centre in view space for the right hand, and its on-screen length
const OFFSETS = {
  mg: [8.5, -8.5, -30, 21],
  sg: [8.5, -8.75, -30, 23],
  gl: [8.5, -9, -30, 22],
  rl: [9, -9.5, -30, 24],
  rg: [8.5, -8.75, -31, 25],
};
// recoil per shot: horizontal only. How far the gun slams straight back (z) and twists (roll / yaw,
// random side); the barrel never lifts or climbs. `k` is the spring stiffness: light guns snap
// back, heavy ones shove the hand and settle slowly
const RECOIL = {
  mg: { z: 1.0, roll: 0.03, yaw: 0.012, k: 520 },
  sg: { z: 4.8, roll: 0.09, yaw: 0.03, k: 170 },
  gl: { z: 3.5, roll: 0.06, yaw: 0.02, k: 190 },
  rl: { z: 5.5, roll: 0.07, yaw: 0.03, k: 120 },
  rg: { z: 6.0, roll: 0.12, yaw: 0.04, k: 140 },
};
// damped spring (per axis): pulls x toward target; zeta < 1 overshoots a little, which reads as mass
class Spring {
  constructor(k, zeta = 0.65) { this.x = 0; this.v = 0; this.set(k, zeta); }
  set(k, zeta = 0.65) { this.k = k; this.d = 2 * Math.sqrt(k) * zeta; }
  // an impulse that peaks at roughly `amount`
  punch(amount) { this.v += amount * Math.sqrt(this.k) * 1.9; }
  step(dt, target = 0) {
    // fixed sub-steps: stable at any frame rate, even for the stiff machinegun spring
    let t = Math.min(dt, 0.1);
    while (t > 0) {
      const h = Math.min(t, 1 / 240);
      this.v += (this.k * (target - this.x) - this.d * this.v) * h;
      this.x += this.v * h;
      t -= h;
    }
    return this.x;
  }
}
const springs = (k, zeta) => ({ x: new Spring(k, zeta), y: new Spring(k, zeta), z: new Spring(k, zeta) });

export class ViewWeapon {
  constructor(assets, starTex) {
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 200);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const d = new THREE.DirectionalLight(0xffffff, 0.9);
    d.position.set(-0.4, 1, 0.6);
    this.scene.add(d);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.models = {};
    for (const id of WEAPON_ORDER) {
      const m = cloneWeapon(assets, id);
      const len = assets.weapons[WEAPON_MODEL_FOR[id]].length;
      m.userData.baseScale = OFFSETS[id][3] / len;
      m.visible = false;
      this.holder.add(m);
      this.models[id] = m;
    }
    // muzzle flash: star + soft glow facing the camera, and two crossed flame petals pointing
    // down the barrel (the era's "flash model"), all additive in the weapon's hue
    const flashMat = new THREE.SpriteMaterial({ map: starTex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.setScalar(10);
    this.flash.visible = false;
    this.holder.add(this.flash);
    this.flashGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    this.flashGlow.visible = false;
    this.holder.add(this.flashGlow);
    const petalMat = new THREE.MeshBasicMaterial({ map: petalTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide });
    const pg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2);   // extends along -z
    this.petals = new THREE.Group();
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(pg, petalMat); m.rotation.z = i * Math.PI / 3; this.petals.add(m); }
    this.petals.visible = false;
    this.petalMat = petalMat;
    this.holder.add(this.petals);
    this.current = null;
    this.switchT = 1;
    this.pending = null;
    this.flashT = 0;
    // motion: `pos` / `rot` carry sway, movement lag, landings and flinches; `recoilPos` /
    // `recoilRot` carry the shots, with per-weapon stiffness
    this.pos = springs(90, 0.55);
    this.rot = springs(110, 0.5);
    this.recoilPos = springs(300, 0.6);
    this.recoilRot = springs(300, 0.55);
    this.walk = 0;          // distance walked on the ground (drives the bob when the session doesn't)
    this.bobAmt = 0;        // smoothed bob strength
    this.time = 0;
    this.wasGround = true;
  }

  setWeapon(id) {
    if (this.current === id || this.pending === id) return;
    if (!this.current) { this.current = id; this.models[id].visible = true; this.switchT = 0; return; }
    this.pending = id;
  }

  // respawn: drop whatever was held (it stays visible otherwise) and raise the spawn weapon
  reset(id) {
    for (const m of Object.values(this.models)) m.visible = false;
    this.current = null; this.pending = null; this.flashT = 0;
    for (const g of [this.pos, this.rot, this.recoilPos, this.recoilRot]) for (const a of 'xyz') { g[a].x = 0; g[a].v = 0; }
    if (id) this.setWeapon(id);
  }

  // switch instantly, without the lower/raise animation (settings preview)
  showNow(id) {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id;
    this.current = id; this.pending = null; this.switchT = 1;
  }

  fire(id) {
    const r = RECOIL[id] || RECOIL.mg;
    const P = this.recoilPos, R = this.recoilRot, sgn = Math.random() < 0.5 ? -1 : 1;
    for (const g of [P, R]) for (const a of 'xyz') g[a].set(r.k, 0.6);
    // keep sustained fire bounded: the machinegun shakes, it doesn't slide off the screen
    const room = (cur, max) => Math.max(0.25, 1 - Math.abs(cur) / max);
    P.z.punch(r.z * room(P.z.x, r.z * 2.5));
    P.x.punch(sgn * r.z * 0.08);
    R.z.punch(sgn * r.roll * (0.6 + Math.random() * 0.4));
    R.y.punch((Math.random() - 0.5) * 2 * r.yaw);
    this.flashT = id === 'rg' ? 0.09 : id === 'mg' ? 0.045 : 0.06;
    this.flashLife = this.flashT;
    this.flashId = id;
    // muzzle star in the weapon's hue, pushed toward white-hot
    this.flash.material.color.set(WEAPONS[id].color).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.flashGlow.material.color.set(WEAPONS[id].color);
    this.petalMat.color.set(WEAPONS[id].color).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.petalRot = Math.random() * Math.PI;
  }

  // landing: the gun keeps falling for a moment, the muzzle dips, then it bounces back up
  land(strength) {
    strength = Math.min(1.5, strength);
    this.pos.y.punch(-2.2 * strength);
    this.rot.x.punch(-0.09 * strength);
    this.rot.z.punch((Math.random() - 0.5) * 0.06 * strength);
  }
  // take-off: the legs push, the gun lags down
  jump() {
    this.pos.y.punch(-1.1);
    this.rot.x.punch(-0.05);
  }
  // hit: knocked to one side (side: -1 left, 1 right), harder for bigger hits
  hurt(damage, side) {
    const k = Math.min(1.5, damage / 40);
    this.pos.x.punch(-side * 1.4 * k);
    this.pos.y.punch(-0.9 * k);
    this.rot.z.punch(side * 0.12 * k);
    this.rot.x.punch(0.05 * k);
  }

  // motion (optional, from the session): view-space velocity { side, fwd, up }, `walk` distance
  // (shared with the camera bob and footsteps so the gun lands on every step) and `ducked`
  update(dt, speed, onGround, yawDelta, pitchDelta, light, settings, motion = null) {
    this.time += dt;
    // switching: drop the old weapon, raise the new one
    if (this.pending) {
      this.switchT -= dt * 7;
      if (this.switchT <= 0) {
        this.models[this.current].visible = false;
        this.current = this.pending; this.pending = null;
        this.models[this.current].visible = true;
        this.switchT = 0;
      }
    } else this.switchT = Math.min(1, this.switchT + dt * 4.5);
    if (!this.current) return;
    settings = gunFor(settings, this.current);   // per-weapon placement overrides
    const m = this.models[this.current];
    const off = OFFSETS[this.current];
    // hand: right / left mirrors the model, center puts it under the crosshair
    const hand = settings.gunHand || 'right';
    const side = hand === 'left' ? -1 : 1;
    const baseX = hand === 'center' ? 0 : off[0] * side;
    const size = settings.gunSize ?? 1;
    m.scale.set(m.userData.baseScale * size * side, m.userData.baseScale * size, m.userData.baseScale * size);

    // bob: a figure-of-eight tied to the footsteps: lowest (with a hard bottom) as each foot lands,
    // swinging toward the foot that carries the weight
    if (motion?.walk != null) this.walk = motion.walk;
    else if (onGround) this.walk += speed * dt;
    const wantBob = settings.bob && onGround ? Math.min(speed, 420) / 320 : 0;
    this.bobAmt += (wantBob - this.bobAmt) * Math.min(1, dt * (wantBob > this.bobAmt ? 6 : 4));
    const ph = Math.PI * this.walk / 90;
    const b = this.bobAmt;
    const bx = Math.cos(ph) * 0.55 * b;
    const by = -(1 - Math.abs(Math.sin(ph))) * 0.55 * b + 0.15 * b;
    const bRoll = Math.cos(ph) * 0.025 * b, bPitch = -(1 - Math.abs(Math.sin(ph))) * 0.02 * b;
    // breathing while standing still
    const idle = settings.bob ? Math.max(0, 1 - b) : 0;
    const ix = Math.sin(this.time * 0.9) * 0.18 * idle, iy = Math.sin(this.time * 1.8) * 0.12 * idle;
    const iRoll = Math.sin(this.time * 0.7 + 1) * 0.008 * idle;

    // look sway: turning drags the gun behind the view (an impulse per degree turned, so it
    // doesn't depend on frame rate); the springs swing it back with a little overshoot
    const yd = Math.max(-12, Math.min(12, yawDelta)), pd = Math.max(-12, Math.min(12, pitchDelta));
    this.pos.x.v += yd * 0.6; this.pos.y.v -= pd * 0.5;
    this.rot.y.v -= yd * 0.03; this.rot.x.v -= pd * 0.03; this.rot.z.v += yd * 0.022;

    // movement lag: strafing leans the gun and leaves it behind, running forward pulls it in,
    // rising sinks it and falling lets it float up
    const vs = motion?.side || 0, vf = motion?.fwd || 0, vu = onGround ? 0 : motion?.up || 0;
    const clamp = (v, a) => Math.max(-a, Math.min(a, v));
    const duck = motion?.ducked ? 1 : 0;
    const tx = clamp(-vs * 0.0035, 1.4);
    const ty = clamp(-vu * 0.003, 1.6) - duck * 0.8;
    const tz = clamp(vf * 0.003, 1.2);
    const trz = clamp(-vs * 0.00018, 0.08) + duck * 0.05 * side;
    const trx = clamp(-vu * 0.00012, 0.06);
    const px = clamp(this.pos.x.step(dt, tx), 3), py = clamp(this.pos.y.step(dt, ty), 4), pz = this.pos.z.step(dt, tz);
    const rx = clamp(this.rot.x.step(dt, trx), 0.2), ry = clamp(this.rot.y.step(dt, 0), 0.15), rz = clamp(this.rot.z.step(dt, trz), 0.2);
    const P = this.recoilPos, R = this.recoilRot;
    const kx = P.x.step(dt), ky = P.y.step(dt), kz = P.z.step(dt);
    const kp = R.x.step(dt), kyaw = R.y.step(dt), kr = R.z.step(dt);

    // switching: the old gun drops and turns away, the new one swings up and settles past its rest
    const sw = this.pending ? easeIn(this.switchT) : easeOutBack(this.switchT);
    const drop = (1 - sw) * 11;
    const zBase = off[2] - (settings.gunZ || 0);
    const k = zBase / off[2];
    const x = baseX * k + (settings.gunX || 0) + bx + ix + px + kx + drop * 0.15 * side;
    const y = off[1] * k + (settings.gunY || 0) + by + iy - drop + py + ky;
    const z = zBase + pz + kz;
    m.position.set(x, y, z);
    // tilt: positive turns the muzzle in toward the crosshair
    const tilt = (settings.gunTilt || 0) * Math.PI / 180;
    const sideK = hand === 'center' ? 1 : side;
    m.rotation.set(
      kp + rx + bPitch - drop * 0.05,
      (-0.04 + tilt) * (hand === 'center' ? 0 : side) + ry + kyaw * sideK,
      (kr + rz + bRoll + iRoll) * sideK + drop * 0.035 * sideK,
    );
    this.flashT -= dt;
    const showFlash = this.flashT > 0 && !this.pending;
    this.flash.visible = this.flashGlow.visible = showFlash;
    this.petals.visible = showFlash && this.flashId !== 'rg';
    if (showFlash) {
      // muzzle in view space: follow the model's own transform so size / tilt / hand are respected
      m.updateMatrix();
      const mz = _mz.copy(m.userData.muzzle).applyMatrix4(m.matrix);
      const k = Math.max(0, this.flashT / (this.flashLife || 0.05));
      const big = this.flashId === 'sg' || this.flashId === 'rl' || this.flashId === 'gl' ? 1.35 : 1;
      this.flash.position.set(mz.x, mz.y, mz.z - 2);
      this.flash.scale.setScalar((12 + Math.random() * 8) * size * big);
      this.flash.material.rotation = Math.random() * 6;
      this.flash.material.opacity = 0.6 + 0.4 * k;
      this.flashGlow.position.copy(this.flash.position);
      this.flashGlow.scale.setScalar(22 * size * big * (0.8 + 0.2 * k));
      this.flashGlow.material.opacity = 0.55 * k;
      // petals point along the barrel: the gun's forward axis in view space
      _fw.set(0, 0, -1).applyEuler(m.rotation);
      this.petals.position.set(mz.x, mz.y, mz.z - 1);
      this.petals.quaternion.setFromUnitVectors(_zf, _fw);
      this.petals.rotateZ(this.petalRot || 0);
      const len = (9 + Math.random() * 5) * size * big, wid = (5 + Math.random() * 2) * size * big;
      this.petals.scale.set(wid, wid, len);
      this.petalMat.opacity = k;
    }
    // light: grid sample with its direction already in view space; floor it so the gun stays bold
    if (light) setLight(m, [light[0] + 0.2, light[1] + 0.2, light[2] + 0.2, light[3] || 0, light[4] || 0, light[5] || 0], 1.05);
  }

  render(renderer, aspect, visible) {
    if (!visible || !this.current) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
const _mz = new THREE.Vector3(), _fw = new THREE.Vector3(), _zf = new THREE.Vector3(0, 0, -1);
let _glow = null, _petal = null;
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture() {
  return _glow ||= canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}
// flame petal: hot at the muzzle (bottom of the texture), tapering into ragged tongues
function petalTexture() { return flameTextures().tongue; }
const easeIn = (t) => t * t;
// a raise that slightly overshoots its rest position before settling
const easeOutBack = (t) => { const c = 1.4; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
