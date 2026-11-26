// First-person weapon: rendered in its own pass so it never clips into walls.
// The player's gun settings (side / height / depth / size / tilt / hand) are applied on top of
// the per-model base placement, so the settings preview and the game draw the gun identically.
import * as THREE from 'three';
import { cloneWeapon, setLight, WEAPON_MODEL_FOR } from './assets.js';
import { WEAPONS, WEAPON_ORDER } from '../sim/defs.js';
import { gunFor } from '../client/crosshair.js';

// base [x, y, z] of the weapon centre in view space for the right hand, and its on-screen length
const OFFSETS = {
  mg: [8.5, -8.5, -30, 21],
  sg: [8.5, -8.75, -30, 23],
  gl: [8.5, -9, -30, 22],
  rl: [9, -9.5, -30, 24],
  rg: [8.5, -8.75, -31, 25],
};
const KICK = { mg: 0.25, sg: 1.2, gl: 1.0, rl: 1.2, rg: 1.5 };

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
    this.kick = 0;
    this.bobT = 0;
    this.swayX = 0; this.swayY = 0;
    this.flashT = 0;
    this.landDip = 0;
  }

  setWeapon(id) {
    if (this.current === id || this.pending === id) return;
    if (!this.current) { this.current = id; this.models[id].visible = true; this.switchT = 0; return; }
    this.pending = id;
  }

  // respawn: drop whatever was held (it stays visible otherwise) and raise the spawn weapon
  reset(id) {
    for (const m of Object.values(this.models)) m.visible = false;
    this.current = null; this.pending = null; this.kick = 0; this.flashT = 0;
    if (id) this.setWeapon(id);
  }

  // switch instantly, without the lower/raise animation (settings preview)
  showNow(id) {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id;
    this.current = id; this.pending = null; this.switchT = 1;
  }

  fire(id) {
    this.kick = Math.min(2, this.kick + (KICK[id] ?? 0.5));
    this.flashT = id === 'rg' ? 0.09 : id === 'mg' ? 0.045 : 0.06;
    this.flashLife = this.flashT;
    this.flashId = id;
    // muzzle star in the weapon's hue, pushed toward white-hot
    this.flash.material.color.set(WEAPONS[id].color).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.flashGlow.material.color.set(WEAPONS[id].color);
    this.petalMat.color.set(WEAPONS[id].color).lerp(new THREE.Color(1, 1, 1), 0.25);
    this.petalRot = Math.random() * Math.PI;
  }

  land(strength) { this.landDip = Math.min(1.5, this.landDip + strength); }

  update(dt, speed, onGround, yawDelta, pitchDelta, light, settings) {
    // switching: drop the old weapon, raise the new one
    if (this.pending) {
      this.switchT -= dt * 9;
      if (this.switchT <= 0) {
        this.models[this.current].visible = false;
        this.current = this.pending; this.pending = null;
        this.models[this.current].visible = true;
        this.switchT = 0;
      }
    } else this.switchT = Math.min(1, this.switchT + dt * 7);
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

    if (settings.bob && onGround) this.bobT += dt * Math.min(speed, 450) / 320 * 9;
    const bobAmt = settings.bob ? Math.min(speed, 400) / 400 : 0;
    const bx = Math.sin(this.bobT) * 0.5 * bobAmt, by = -Math.abs(Math.cos(this.bobT)) * 0.4 * bobAmt;
    this.swayX += (-yawDelta * 0.04 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (pitchDelta * 0.04 - this.swayY) * Math.min(1, dt * 8);
    this.swayX = Math.max(-1.5, Math.min(1.5, this.swayX));
    this.swayY = Math.max(-1.5, Math.min(1.5, this.swayY));
    this.kick = Math.max(0, this.kick - dt * 8);
    this.landDip = Math.max(0, this.landDip - dt * 5);
    const drop = (1 - easeOut(this.switchT)) * 10;
    // depth slides the gun along the line of sight: its base screen position stays put, so pulling
    // it close makes it bigger instead of sinking it out of the bottom of the view
    const zBase = off[2] - (settings.gunZ || 0);
    const k = zBase / off[2];
    const x = baseX * k + (settings.gunX || 0) + bx - this.swayX;
    const y = off[1] * k + (settings.gunY || 0) + by - drop - this.swayY - this.landDip;
    const z = zBase + this.kick * 1.6;
    m.position.set(x, y, z);
    // tilt: positive turns the muzzle in toward the crosshair
    const tilt = (settings.gunTilt || 0) * Math.PI / 180;
    m.rotation.set(this.kick * 0.06 + drop * 0.04, (-0.04 + tilt) * (hand === 'center' ? 0 : side), 0);
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
function petalTexture() {
  return _petal ||= canvasTex(64, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) {
      const x = s / 2 + (i - 2) * s * 0.09, top = s * (0.05 + Math.random() * 0.3);
      const gr = g.createLinearGradient(0, s, 0, top);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - s * 0.12, s); g.quadraticCurveTo(x - s * 0.06, s * 0.5, x, top); g.quadraticCurveTo(x + s * 0.06, s * 0.5, x + s * 0.12, s); g.fill();
    }
  });
}
const easeOut = (t) => 1 - (1 - t) * (1 - t);
