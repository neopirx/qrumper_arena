// Visual representation of game entities: players, items, projectiles, jump pads, teleporters.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cloneWeapon, setLight } from './assets.js';
import { entityMaterial } from './entitymat.js';
import { addHoloShell, holoProjector } from './holo.js';
import { shared } from './shared.js';
import { ITEMS, WEAPONS } from '../sim/defs.js';
import { angleDiff, yawTo, DEG } from '../sim/vec.js';

const UPPER = new Set(['spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']);
const isUpperTrack = (name) => {
  const bone = name.split('.')[0];
  if (UPPER.has(bone)) return true;
  return /^(index|middle|pinky|ring|thumb)_/.test(bone);
};

function splitClip(clip, upper) {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => isUpperTrack(t.name) === upper && !(t.name.startsWith('root.') && t.name.endsWith('.position')));
  return c;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
function rotateBoneWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  _dq.setFromAxisAngle(axis, angle);
  // local delta = parent^-1 * delta * parent
  const inv = _pq.clone().invert();
  _dq.premultiply(inv).multiply(_pq);
  bone.quaternion.premultiply(_dq);
}

// ---------- retargeting: UAL mannequin (UE skeleton) -> Mixamo rig ----------
// [source bone, target bone (without the mixamorig prefix), source child used to aim the bone]
const RIG = [
  ['pelvis', 'Hips', null], ['spine_01', 'Spine', 'spine_02'], ['spine_02', 'Spine1', 'spine_03'], ['spine_03', 'Spine2', 'neck_01'],
  ['neck_01', 'Neck', 'Head'], ['Head', 'Head', null],
];
for (const [s, t] of [['l', 'Left'], ['r', 'Right']]) {
  RIG.push([`clavicle_${s}`, `${t}Shoulder`, `upperarm_${s}`], [`upperarm_${s}`, `${t}Arm`, `lowerarm_${s}`],
    [`lowerarm_${s}`, `${t}ForeArm`, `hand_${s}`], [`hand_${s}`, `${t}Hand`, `middle_01_${s}`],
    [`thigh_${s}`, `${t}UpLeg`, `calf_${s}`], [`calf_${s}`, `${t}Leg`, `foot_${s}`], [`foot_${s}`, `${t}Foot`, `ball_${s}`],
    [`ball_${s}`, `${t}ToeBase`, `ball_leaf_${s}`]);
  for (const [f, F] of [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky'], ['thumb', 'Thumb']]) {
    for (let i = 1; i <= 3; i++) RIG.push([`${f}_0${i}_${s}`, `${t}Hand${F}${i}`, i < 3 ? `${f}_0${i + 1}_${s}` : `${f}_04_leaf_${s}`]);
  }
}
function targetName(src) {
  const r = RIG.find((x) => x[0] === src);
  if (r) return r[1];
  let m = src.match(/^ball_leaf_([lr])$/);
  if (m) return `${m[1] === 'l' ? 'Left' : 'Right'}Toe_End`;
  m = src.match(/^(index|middle|ring|pinky|thumb)_04_leaf_([lr])$/);
  if (m) return `${m[2] === 'l' ? 'Left' : 'Right'}Hand${m[1][0].toUpperCase() + m[1].slice(1)}4`;
  return null;
}

// the UAL mannequin drives the characters in game
const UAL_MAP = { rig: RIG, tname: targetName, pelvis: 'pelvis', foot: 'foot_l', toe: 'ball_l' };
// a Mixamo clip skeleton (menu showcase clips) drives a Mixamo rig bone for bone
const stripMixamo = (n) => n.replace(/^mixamorig\d*:?/, '');
function mixamoMap(src) {
  const rig = [];
  src.traverse((o) => { if (o.isBone) { const c = o.children.find((x) => x.isBone); rig.push([stripMixamo(o.name), stripMixamo(o.name), c ? stripMixamo(c.name) : null]); } });
  return { rig, tname: (n) => n, pelvis: 'Hips', foot: 'LeftFoot', toe: 'LeftToeBase', strip: true };
}

// per-character pose touch-ups applied after retargeting: [bone, pitch in degrees, + = nod forward]
// (Piggor's head is modelled tilted back, so the shared clips leave him staring at the sky)
const POSE_FIX = { pig: [['Neck', 22], ['Head', 32]] };

const CHAR_HEIGHT = 60;   // game units, a touch taller than the 56u hull for chunky silhouettes
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();

class Retarget {
  constructor(model, src, tgtWrap, tgt, map = UAL_MAP) {
    this.model = model; this.src = src; this.tgt = tgt;
    const sb = {}, tb = {};
    src.traverse((o) => { if (o.isBone) sb[map.strip ? stripMixamo(o.name) : o.name] = o; });
    tgt.traverse((o) => { if (o.isBone) tb[o.name.replace(/^mixamorig:?/, '')] = o; });
    this.sb = sb; this.tb = tb;
    model.updateMatrixWorld(true);
    // face the target the same way as the source: compare foot -> toe directions
    const fwd = (a, b) => { const p = a.getWorldPosition(new THREE.Vector3()); const q = b.getWorldPosition(new THREE.Vector3()); return Math.atan2(q.x - p.x, q.z - p.z); };
    tgtWrap.rotation.y = fwd(sb[map.foot], sb[map.toe]) - fwd(tb.LeftFoot, tb.LeftToeBase);
    model.updateMatrixWorld(true);
    // per bone constant offset: tgtWorld = srcWorld * off, with off = srcRest^-1 * A^-1 * tgtRest
    // where A aims the source rest bone along the target rest bone (handles A-pose vs T-pose)
    this.bones = [];
    const driven = new Map();
    for (const [s, t, child] of map.rig) {
      const S = sb[s], T = tb[t];
      if (!S || !T) continue;
      const sRest = S.getWorldQuaternion(new THREE.Quaternion());
      const tRest = T.getWorldQuaternion(new THREE.Quaternion());
      let A = new THREE.Quaternion();
      const tc = child && tb[map.tname(child)];
      if (child && sb[child] && tc) {
        const ds = sb[child].getWorldPosition(new THREE.Vector3()).sub(S.getWorldPosition(new THREE.Vector3())).normalize();
        const dt = tc.getWorldPosition(new THREE.Vector3()).sub(T.getWorldPosition(new THREE.Vector3())).normalize();
        if (ds.lengthSq() > 0.5 && dt.lengthSq() > 0.5) A.setFromUnitVectors(ds, dt);
      }
      const off = sRest.clone().invert().multiply(A.clone().invert()).multiply(tRest);
      driven.set(T, { S, off });
    }
    // target bones in parent-first order
    tgt.traverse((o) => { if (o.isBone) this.bones.push({ T: o, d: driven.get(o) || null, wq: new THREE.Quaternion() }); });
    // hips translation, scaled by leg length
    this.sHip = sb[map.pelvis]; this.tHip = tb.Hips;
    this.sHipRest = model.worldToLocal(this.sHip.getWorldPosition(new THREE.Vector3()));
    this.tHipRest = model.worldToLocal(this.tHip.getWorldPosition(new THREE.Vector3()));
    this.hipScale = this.tHipRest.y / Math.max(1, this.sHipRest.y);
    this.parentOf = new Map(this.bones.map((b, i) => [b.T, i]));
  }

  apply() {
    const model = this.model;
    // source skeleton is already posed and its matrices updated
    for (const b of this.bones) {
      const T = b.T;
      const pi = this.parentOf.get(T.parent);
      const parentQ = pi != null ? this.bones[pi].wq : T.parent.getWorldQuaternion(_q2);
      if (b.d) {
        b.d.S.getWorldQuaternion(_q1).multiply(b.d.off);           // target world rotation
        b.wq.copy(_q1);
        T.quaternion.copy(parentQ).invert().multiply(_q1);          // to local
      } else {
        b.wq.copy(parentQ).multiply(T.quaternion);
      }
    }
    // hips: source pelvis offset from its rest, in model space, scaled to the target's proportions
    const sp = model.worldToLocal(this.sHip.getWorldPosition(_v1));
    _v2.copy(sp).sub(this.sHipRest).multiplyScalar(this.hipScale).add(this.tHipRest);
    model.localToWorld(_v2);
    this.tHip.parent.updateMatrixWorld(true);
    _m1.copy(this.tHip.parent.matrixWorld).invert();
    this.tHip.position.copy(_v2.applyMatrix4(_m1));
  }
}

export class PlayerModel {
  // showcase: the menu model, idling with a taunt now and then (Mixamo clips, no weapon)
  constructor(assets, color, scene, character = 'capi', showcase = false) {
    this.root = new THREE.Group();
    this.model = new THREE.Group();          // yawed as a whole
    this.root.add(this.model);
    // animation source: the UAL mannequin, posed every frame but never drawn
    const src = SkeletonUtils.clone(showcase ? assets.showcase.rig : assets.character);
    src.traverse((m) => { if (m.isMesh || m.isSkinnedMesh) m.visible = false; });
    this.model.add(src);
    this.src = src;
    // visible character
    const tpl = assets.characters[character] || Object.values(assets.characters)[0];
    const tgt = SkeletonUtils.clone(tpl);
    const box = new THREE.Box3().setFromObject(tpl);
    tgt.scale.multiplyScalar(CHAR_HEIGHT / Math.max(1, box.max.y - box.min.y));
    const tgtWrap = new THREE.Group();
    tgtWrap.add(tgt);
    this.model.add(tgtWrap);
    this.mats = [];
    const accent = new THREE.Color(color);
    tgt.traverse((m) => {
      if (m.isMesh || m.isSkinnedMesh) {
        m.frustumCulled = false;
        const old = [].concat(m.material)[0];
        // painted texture keeps its own shading; identity comes from a glowing player-colour rim
        // and a light wash of the colour, so the player reads at 60 m in fog, mid-turn
        const mat = entityMaterial({ map: old.map || null, color: new THREE.Color(1, 1, 1).lerp(accent, 0.22), rim: accent.clone().multiplyScalar(1.4), rimPow: 2.2, spec: 0.12 });
        m.material = mat;
        this.mats.push(mat);
      }
    });
    this.root.userData.mats = this.mats;
    this.bones = {};
    src.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.poseFix = POSE_FIX[character] || [];
    this.retarget = new Retarget(this.model, src, tgtWrap, tgt, showcase ? mixamoMap(src) : UAL_MAP);
    this.handBone = this.retarget.tb.RightHand;
    this.mixer = new THREE.AnimationMixer(src);
    this.scene = scene;
    if (showcase) { this.initShowcase(assets.showcase.clips); scene.add(this.root); return; }
    const clips = assets.clips;    const mk = (name, upper, loop = true) => {
      const a = this.mixer.clipAction(splitClip(clips[name], upper));
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    this.lower = {
      idle: mk('Idle_Loop', false), run: mk('Jog_Fwd_Loop', false), sprint: mk('Sprint_Loop', false),
      air: mk('Jump_Loop', false), crouch: mk('Crouch_Idle_Loop', false), crouchWalk: mk('Crouch_Fwd_Loop', false),
    };
    this.upper = { aim: mk('Pistol_Idle_Loop', true) };
    this.death = this.mixer.clipAction(clips['Death01']);
    this.death.setLoop(THREE.LoopOnce, 1); this.death.clampWhenFinished = true;
    for (const a of Object.values(this.lower)) { a.play(); a.weight = 0; }
    this.lower.idle.weight = 1;
    this.upper.aim.play();
    this.cur = 'idle';
    this.weaponId = null;
    this.weapon = null;
    this.dead = false;
    this.legYaw = 0;
    scene.add(this.root);
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.pitchSign = 1;
  }

  applyPoseFix() {
    if (!this.poseFix.length) return;
    this.root.updateMatrixWorld(true);
    const right = this._fixAxis || (this._fixAxis = new THREE.Vector3());
    right.set(1, 0, 0).applyQuaternion(this.model.getWorldQuaternion(this._fixQ || (this._fixQ = new THREE.Quaternion())));
    for (const [name, deg] of this.poseFix) {
      const bone = this.retarget.tb[name];
      if (!bone) continue;
      rotateBoneWorld(bone, right, deg * DEG);
      bone.updateMatrixWorld(true);
    }
  }

  initShowcase(clips) {
    const act = (clip, loop) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      return a;
    };
    this.idle = act(clips.idle, true);
    this.idle.play();
    this.taunts = clips.taunts.map((c) => act(c, false));
    this.taunt = null;
    this.tauntIn = 2.5 + Math.random() * 2;
    this.tauntNext = Math.floor(Math.random() * this.taunts.length);
  }

  // menu: idle, every 8-14 s blend into the next taunt and back
  updateShowcase(dt, yaw, light) {
    const FADE = 0.35;
    if (this.taunt) {
      if (this.taunt.time >= this.taunt.getClip().duration - FADE - 0.02) {
        this.idle.enabled = true; this.idle.setEffectiveTimeScale(1); this.idle.setEffectiveWeight(1); this.idle.time = 0;
        this.idle.crossFadeFrom(this.taunt, FADE, false);
        this.taunt = null;
        this.tauntIn = 8 + Math.random() * 6;
      }
    } else if ((this.tauntIn -= dt) <= 0) {
      this.taunt = this.taunts[this.tauntNext];
      this.tauntNext = (this.tauntNext + 1) % this.taunts.length;
      this.taunt.reset(); this.taunt.setEffectiveTimeScale(1); this.taunt.setEffectiveWeight(1); this.taunt.play();
      this.taunt.crossFadeFrom(this.idle, FADE, false);
    }
    this.root.position.set(0, 0, 0);
    this.model.rotation.y = yaw * DEG + Math.PI;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.retarget.apply();
    this.applyPoseFix();
    if (light) setLight(this.root, light, 1.15);
  }

  setWeapon(assets, id) {
    if (this.weaponId === id) return;
    if (this.weapon) this.scene.remove(this.weapon);
    this.weapon = cloneWeapon(assets, id);
    this.weapon.scale.setScalar(0.8);
    this.scene.add(this.weapon);
    this.weaponId = id;
  }

  setState(name) {
    if (this.cur === name) return;
    this.cur = name;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    for (const a of Object.values(this.lower)) a.weight = 0;
    this.upper.aim.weight = 0;
    this.death.reset(); this.death.weight = 1; this.death.play();
    if (this.weapon) this.weapon.visible = false;
  }

  revive() {
    this.dead = false;
    this.death.stop();
    this.upper.aim.weight = 1;
    if (this.weapon) this.weapon.visible = true;
  }

  update(dt, pos, yaw, pitch, vel, onGround, ducked, light) {
    this.root.position.set(pos[0], pos[1] - 24, pos[2]);
    const hs = Math.hypot(vel[0], vel[2]);
    if (!this.dead) {
      let state = 'idle';
      if (!onGround) state = 'air';
      else if (ducked) state = hs > 20 ? 'crouchWalk' : 'crouch';
      else if (hs > 450) state = 'sprint';
      else if (hs > 30) state = 'run';
      this.setState(state);
      // move-direction relative leg yaw (Q3 style torso/legs split)
      let legOff = 0, back = false;
      if (hs > 30 && onGround) {
        const mv = yawTo(vel[0], vel[2]);
        let rel = angleDiff(mv, yaw);
        if (Math.abs(rel) > 100) { back = true; rel = angleDiff(mv + 180, yaw); }
        legOff = Math.max(-70, Math.min(70, rel));
      }
      this.legYaw += (legOff - this.legYaw) * Math.min(1, dt * 10);
      const speedScale = Math.max(0.6, Math.min(1.6, hs / 300));
      for (const [k, a] of Object.entries(this.lower)) {
        const target = k === this.cur ? 1 : 0;
        a.weight += (target - a.weight) * Math.min(1, dt * 12);
        a.timeScale = (k === 'run' || k === 'sprint' || k === 'crouchWalk') ? speedScale * (back ? -1 : 1) : 1;
      }
      this.model.rotation.y = (yaw + this.legYaw) * DEG + Math.PI;
      this.mixer.update(dt);
      // twist the torso back toward the aim yaw and bend it with the aim pitch (world space)
      this.root.updateMatrixWorld(true);
      const right = this._v.set(Math.cos(yaw * DEG), 0, -Math.sin(yaw * DEG));
      for (const b of ['spine_01', 'spine_02', 'spine_03']) {
        const bone = this.bones[b];
        if (!bone) continue;
        rotateBoneWorld(bone, Y_AXIS, -this.legYaw * DEG / 3);
        rotateBoneWorld(bone, right, pitch * DEG / 3 * this.pitchSign);
        bone.updateMatrixWorld(true);
      }
    } else {
      this.model.rotation.y = yaw * DEG + Math.PI;
      this.mixer.update(dt);
    }
    this.root.updateMatrixWorld(true);
    this.retarget.apply();
    this.applyPoseFix();
    if (light) setLight(this.root, light, 1.15);
    // weapon: positioned at the right hand, pointing where the player aims
    if (this.weapon && !this.dead) {
      this.root.updateMatrixWorld(true);
      const hand = this.handBone || this.bones.hand_r;
      if (hand) hand.getWorldPosition(this._v);
      else this._v.set(pos[0], pos[1] + 10, pos[2]);
      this.weapon.position.copy(this._v);
      this.weapon.rotation.set(pitch * DEG, yaw * DEG, 0, 'YXZ');
      this.weapon.translateZ(-6); this.weapon.translateY(2);
      if (light) setLight(this.weapon, light);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.weapon) this.scene.remove(this.weapon);
    this.mixer.stopAllAction();
  }
}

// ---------- items ----------
// Pickups are colour-coded gameplay signals: saturated, partly fullbright, spinning above a
// chamfered plinth with an emissive ring. The most important ones carry a vertical beacon.
const GUNMETAL = 0x5a5f69;

function canvasTex(draw, w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let _tex = null;
function propTextures() {
  if (_tex) return _tex;
  _tex = {
    // chevrons: white core, transparent rim (the colour comes from the material)
    chevron: canvasTex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 2; i++) {
        const y = i * h / 2;
        g.fillStyle = 'rgba(255,255,255,1)';
        g.beginPath(); g.moveTo(w * 0.1, y + h * 0.4); g.lineTo(w * 0.5, y + h * 0.1); g.lineTo(w * 0.9, y + h * 0.4);
        g.lineTo(w * 0.9, y + h * 0.28); g.lineTo(w * 0.5, y); g.lineTo(w * 0.1, y + h * 0.28); g.fill();
      }
    }),
    hazard: canvasTex((g, w, h) => {
      g.fillStyle = '#16130f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e0aa18';
      for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 - h, h); g.lineTo(x - h, h); g.fill(); }
      for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(70,66,60,0.9)'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 2); }
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, 0, w, 2); g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(0, h - 3, w, 3);
    }, 128, 32),
    swirl: canvasTex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        const y = (i / 6) * h;
        const gr = g.createLinearGradient(0, y, 0, y + h / 6);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.save(); g.translate(0, y); g.transform(1, 0, -0.5, 1, 0, 0); g.fillRect(0, 0, w * 2, h / 12); g.restore();
      }
    }),
    beam: canvasTex((g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, 8, 128),
  };
  _tex.beam.wrapS = _tex.beam.wrapT = THREE.ClampToEdgeWrapping;
  return _tex;
}

const additive = (color, opacity = 1, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, ...extra });
function lit(g, ...mats) { g.userData.mats = (g.userData.mats || []).concat(mats); return g; }

function healthModel(def, type) {
  const g = new THREE.Group();
  const c = new THREE.Color(def.color);
  const big = type === 'mh' ? 1.4 : type === 'h5' ? 0.6 : 1;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(10 * big, 16, 12), additive(c, 0.4)));
  // fullbright core cross: white-hot centre, item colour around it
  const crossMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(c, 0.25), fog: false });
  const a = new THREE.Mesh(new THREE.BoxGeometry(10 * big, 3.2 * big, 3.2 * big), crossMat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(3.2 * big, 10 * big, 3.2 * big), crossMat);
  g.add(a, b);
  g.userData.spinInner = [a, b];
  return g;
}

function armorModel(def, type) {
  const g = new THREE.Group();
  const c = new THREE.Color(def.color);
  if (type === 'shard') {
    const m = entityMaterial({ color: c, emissive: c.clone().multiplyScalar(0.45), spec: 0.8 });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(6), m);
    mesh.scale.y = 1.6;
    g.add(mesh);
    return lit(g, m);
  }
  // painted armour plate: saturated colour over a gunmetal frame, chips reveal bare metal
  const mat = entityMaterial({ color: c, emissive: c.clone().multiplyScalar(0.28), spec: 0.6, side: THREE.DoubleSide, rim: c.clone().multiplyScalar(0.5) });
  const trim = entityMaterial({ color: 0x8a8d94, spec: 0.9, side: THREE.DoubleSide });
  const prof = [[7.5, -11], [8.5, -7], [10.5, -1], [11.5, 4], [10.5, 8], [7, 10.5], [5, 11]].map(([x, y]) => new THREE.Vector2(x, y));
  const front = new THREE.Mesh(new THREE.LatheGeometry(prof, 8, -Math.PI * 0.5, Math.PI), mat);
  front.rotation.y = Math.PI / 2;
  const back = new THREE.Mesh(new THREE.LatheGeometry(prof, 8, Math.PI * 0.5, Math.PI), trim);
  back.rotation.y = Math.PI / 2;
  back.scale.z = 0.7;
  g.add(front, back);
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(5.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    pad.position.set(sx * 9.5, 8.5, 0); pad.rotation.z = -sx * 0.6; g.add(pad);
  }
  const belt = new THREE.Mesh(new THREE.TorusGeometry(7.8, 1.3, 4, 8), trim); belt.rotation.x = Math.PI / 2; belt.position.y = -10; g.add(belt);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(2, 16, 2), trim); ridge.position.set(0, 0, -10.6); g.add(ridge);
  return lit(g, mat, trim);
}

function ammoModel(def) {
  const g = new THREE.Group();
  const w = WEAPONS[def.weapon];
  const boxMat = entityMaterial({ color: GUNMETAL, spec: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 12), boxMat);
  const band = new THREE.Mesh(new THREE.BoxGeometry(12.4, 3, 12.4), new THREE.MeshBasicMaterial({ color: w.color, fog: false }));
  g.add(box, band);
  return lit(g, boxMat);
}

// chamfered octagonal plinth with an emissive ring in the item's colour
function plinth(color, r = 17) {
  const g = new THREE.Group();
  const m = entityMaterial({ color: GUNMETAL, spec: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 3, 3, 8), m);
  base.position.y = 1.5; base.rotation.y = Math.PI / 8;
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r * 0.78, 8, 1), new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 8; ring.position.y = 3.1;
  g.add(base, ring);
  g.userData.ring = ring;
  return lit(g, m);
}

function beacon(color, height = 260) {
  const geo = new THREE.CylinderGeometry(5, 9, height, 8, 1, true);
  geo.translate(0, height / 2, 0);
  const t = propTextures().beam;
  return new THREE.Mesh(geo, additive(color, 0.55, { map: t }));
}

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const hexRgb = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
export class ItemView {
  constructor(assets, effects, item, scene) {
    const def = item.def;
    this.item = item;
    this.root = new THREE.Group();
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    this.litObjs = [];
    let glowColor = 0xffffff;
    let model;
    if (def.kind === 'weapon') {
      model = cloneWeapon(assets, def.weapon);
      model.scale.setScalar(1.1);
      glowColor = WEAPONS[def.weapon].color;
    } else if (def.kind === 'health') { model = healthModel(def, item.type); glowColor = def.color; }
    else if (def.kind === 'armor') { model = armorModel(def, item.type); glowColor = def.color; }
    else { model = ammoModel(def); glowColor = WEAPONS[def.weapon].color; }
    this.spin.add(model);
    if (model.userData.mats) this.litObjs.push(model);
    const big = item.type === 'mh' || item.type === 'ra' || item.type === 'ya';
    this.glow = effects.glowSprite(glowColor, big ? 70 : 40, big ? 0.4 : 0.22);
    this.glow.position.y = 2;
    this.root.add(this.glow);
    if (!item.dropped) {
      const small = def.kind === 'ammo' || item.type === 'h5' || item.type === 'shard';
      this.plinth = plinth(glowColor, small ? 12 : 18);
      this.plinth.position.y = -16;
      this.root.add(this.plinth);
      this.litObjs.push(this.plinth);
      if (item.type === 'mh' || item.type === 'ra') {
        this.beacon = beacon(glowColor);
        this.beacon.position.y = -14;
        this.root.add(this.beacon);
      }
    }
    this.root.position.set(item.pos[0], item.pos[1] + 16, item.pos[2]);
    this.phase = Math.random() * 6;
    // holographic projection (Graphics → Holographic items)
    this.fx = effects;
    this.glowColor = glowColor;
    if (effects.gfx?.holo !== false) {
      this.solid = [];
      model.traverse((o) => { if (o.isMesh) this.solid.push(o); });
      this.holoMats = addHoloShell(model, glowColor);
      for (const m of this.holoMats) m.uniforms.base.value = this.root.position.y - 16;
      if (!item.dropped) {
        const small = def.kind === 'ammo' || item.type === 'h5' || item.type === 'shard';
        this.projector = holoProjector(glowColor, small ? 8 : 12, 14);
        this.projector.position.y = -13;
        this.root.add(this.projector);
      }
    }
    this.wasActive = item.active;
    this.revealT = 1;
    scene.add(this.root);
    this.scene = scene;
  }
  update(t, dt, lightGrid) {
    const active = this.item.active;
    const holo = !!this.holoMats;
    if (active && !this.wasActive) this.revealT = 0;     // respawned: materialize bottom-up
    this.wasActive = active;
    this.revealT = Math.min(1, this.revealT + dt / 0.7);
    this.spin.visible = active || holo;
    this.glow.visible = active;
    if (holo) {
      // gone: only a dim, flickering ghost of the projection remains
      const ghost = !active;
      // the solid model is swapped out (not hidden: the shells are its children) while only the
      // projection shows: gone, or the first part of the materialize sweep
      const hide = ghost || this.revealT < 0.8;
      if (hide !== this.hidden) {
        this.hidden = hide;
        for (const o of this.solid) { if (hide) { o.userData.mat = o.material; o.material = HIDDEN; } else if (o.userData.mat) o.material = o.userData.mat; }
      }
      const flick = Math.sin(t * 37 + this.phase * 5) > 0.2 ? 1 : 0.55;
      const reveal = active ? this.revealT * this.revealT * 44 : 1e4;
      for (const m of this.holoMats) { m.uniforms.opacity.value = ghost ? 0.25 * flick : 0.65 + (1 - this.revealT) * 0.8; m.uniforms.reveal.value = reveal; }
      if (this.projector) {
        const u = this.projector.userData;
        u.coneMat.uniforms.opacity.value = active ? 0.5 + 0.06 * Math.sin(t * 9) : 0.1 * flick;
        u.haloMat.opacity = active ? 0.75 : 0.15;
        u.haloMat.map.offset.x = t * 0.12;
        u.halo.position.y = 14 + Math.sin(t * 2.5 + this.phase) * 3;
        // motes drifting up the beam
        if (active && Math.random() < dt * 4 * this.fx.q) {
          const a = Math.random() * 6.28, r = Math.random() * 8, p = this.root.position;
          this.fx.add.add({ pos: [p.x + Math.cos(a) * r, p.y - 12, p.z + Math.sin(a) * r], vel: [0, 14 + Math.random() * 10, 0], life: 1.2, size: 2.2, size1: 0.5, color: hexRgb(this.glowColor), alpha: 0.9, alpha1: 0, kind: 4 });
        }
      }
    }
    this.spin.rotation.y = t * 1.6 + this.phase;
    this.spin.position.y = Math.sin(t * 2.5 + this.phase) * 3;
    if (this.spin.children[0]?.userData.spinInner) for (const m of this.spin.children[0].userData.spinInner) m.rotation.y = -t * 3.2;
    if (lightGrid && this.litObjs.length) {
      const l = [0, 0, 0, 0, 0, 0];
      lightGrid.sample([this.root.position.x, this.root.position.y, this.root.position.z], l);
      l[0] += 0.25; l[1] += 0.25; l[2] += 0.25;      // pickups stay readable in dark corners
      for (const o of this.litObjs) setLight(o, l, 1.2);
    }
    if (this.plinth) this.plinth.userData.ring.visible = active || Math.sin(t * 6) > 0.6;
    if (this.beacon) this.beacon.material.opacity = active ? 0.45 + 0.1 * Math.sin(t * 3) : 0.06;
  }
  dispose() { this.scene.remove(this.root); }
}

// ---------- map furniture ----------
const PAD_COLOR = 0x46d8ff, TELE_COLOR = 0x6a5cff;

function scrollMat(tex, color, opacity, repeat = [1, 1]) {
  const t = tex.clone(); t.needsUpdate = true; t.repeat.set(...repeat);
  return additive(color, opacity, { map: t });
}

export function buildMapProps(map, effects, scene, col) {
  const group = new THREE.Group();
  const anim = [];
  const T = propTextures();
  const litObjs = [];
  const metal = () => { const m = entityMaterial({ color: GUNMETAL, spec: 0.5 }); return m; };
  for (const pad of map.jumppads) {
    const s = (pad.size || 64) / 2;
    const at = pad.at;
    const g = new THREE.Group();
    g.position.set(at[0], at[1], at[2]);
    // armoured octagonal housing with a hazard-striped rim (spec 5.3 functional set piece)
    const hm = metal();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(s + 2, s + 7, 6, 8), hm);
    housing.position.y = 3; housing.rotation.y = Math.PI / 8;
    const hz = new THREE.Mesh(new THREE.CylinderGeometry(s + 2.2, s + 2.2, 2.5, 8, 1, true), new THREE.MeshBasicMaterial({ map: T.hazard, fog: false }));
    hz.material.map = T.hazard.clone(); hz.material.map.needsUpdate = true; hz.material.map.repeat.set(4, 1);
    hz.position.y = 4.8; hz.rotation.y = Math.PI / 8;
    g.add(housing, hz);
    // energy floor: chevrons scrolling toward the launch direction ("speed reads as direction")
    const dir = [pad.target[0] - at[0], pad.target[2] - at[2]];
    const yaw = Math.atan2(dir[0], dir[1]);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(s * 0.92, 8), scrollMat(T.chevron, PAD_COLOR, 0.95, [1, 1]));
    floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI + yaw; floor.position.y = 6.3;
    const core = new THREE.Mesh(new THREE.CircleGeometry(s * 0.92, 8), additive(PAD_COLOR, 0.25));
    core.rotation.x = -Math.PI / 2; core.position.y = 6.2;
    g.add(core, floor);
    // updraft column
    const colGeo = new THREE.CylinderGeometry(s * 0.7, s * 0.85, 90, 8, 1, true); colGeo.translate(0, 45, 0);
    const updraft = new THREE.Mesh(colGeo, additive(PAD_COLOR, 0.22, { map: T.beam }));
    g.add(updraft);
    group.add(g);
    litObjs.push(lit(housing, hm));
    effects.light([at[0], at[1] + 20, at[2]], PAD_COLOR, 140, -1, { intensity: 0.5 });
    anim.push((t) => { floor.material.map.offset.y = -t * 1.6; updraft.material.opacity = 0.16 + 0.08 * Math.sin(t * 7); });
  }
  for (const tp of map.teleporters) {
    const at = tp.at;
    const g = new THREE.Group();
    g.position.set(at[0], at[1], at[2]);
    const hm = metal();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(30, 36, 6, 8), hm);
    base.position.y = 3; base.rotation.y = Math.PI / 8;
    g.add(base);
    litObjs.push(lit(base, hm));
    // three pylons with fullbright tips
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const pm = metal();
      const py = new THREE.Mesh(new THREE.BoxGeometry(6, 84, 6), pm);
      py.position.set(Math.cos(a) * 34, 42, Math.sin(a) * 34); py.rotation.y = -a;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(7, 8, 7), new THREE.MeshBasicMaterial({ color: 0xc8c0ff, fog: false }));
      tip.position.set(Math.cos(a) * 34, 86, Math.sin(a) * 34); tip.rotation.y = -a;
      g.add(py, tip);
      litObjs.push(lit(py, pm));
    }
    const swirl = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 76, 12, 1, true), scrollMat(T.swirl, TELE_COLOR, 0.8, [2, 1]));
    swirl.position.y = 40;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 76, 12, 1, true), scrollMat(T.swirl, 0xffffff, 0.35, [1, 1.5]));
    inner.position.y = 40;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(26, 8), additive(TELE_COLOR, 0.7));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 6.2;
    g.add(swirl, inner, disc);
    const halo = effects.glowSprite(TELE_COLOR, 120, 0.45);
    halo.position.y = 40; g.add(halo);
    group.add(g);
    anim.push((t) => { swirl.material.map.offset.set(t * 0.15, t * 0.6); inner.material.map.offset.set(-t * 0.25, t * 0.9); if (Math.random() < 0.3) effects.sparkle([at[0], at[1] + 6, at[2]], 0xa898ff, 1, 40); });
  }
  // light fixtures: mount a housing with a fullbright panel on the nearest wall / ceiling
  const fixtures = buildFixtures(map, col, effects, litObjs);
  group.add(fixtures.group);
  anim.push(fixtures.update);
  scene.add(group);
  return {
    group,
    update: (t) => { for (const f of anim) f(t); },
    light: (lightGrid) => {
      // static props: sample the light grid once
      const l = [0, 0, 0, 0, 0, 0], p = new THREE.Vector3();
      for (const o of litObjs) { o.getWorldPosition(p); lightGrid.sample([p.x, p.y + 8, p.z], l); setLight(o, l, 1.1); }
    },
  };
}

function buildFixtures(map, col, effects, litObjs) {
  const group = new THREE.Group();
  const flick = [];
  const housingGeo = new THREE.BoxGeometry(1, 1, 1);
  let idx = 0;
  for (const l of map.lights) {
    idx++;
    const p = [l[0], l[1], l[2]];
    const c = new THREE.Color(l[3]);
    const core = c.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
    // find the closest surface: up, then the four walls, then the floor (lamp post)
    let best = null;
    if (col) {
      const dirs = [[0, 1, 0, 96], [1, 0, 0, 64], [-1, 0, 0, 64], [0, 0, 1, 64], [0, 0, -1, 64]];
      for (const [dx, dy, dz, reach] of dirs) {
        const tr = col.trace(p, [p[0] + dx * reach, p[1] + dy * reach, p[2] + dz * reach], [0, 0, 0], [0, 0, 0], 1);
        if (tr.fraction < 1 && (!best || tr.fraction * reach < best.d)) best = { d: tr.fraction * reach, dir: [dx, dy, dz], pos: [...tr.endpos] };
      }
    }
    const fx = new THREE.Group();
    const hm = entityMaterial({ color: GUNMETAL, spec: 0.6 });
    const noFixture = l[6] && l[6].fixture === false;
    const panelMat = new THREE.MeshBasicMaterial({ color: core, fog: false });
    let postH = 0;
    if (!best && col && !noFixture) { const tr = col.trace(p, [p[0], p[1] - 140, p[2]], [0, 0, 0], [0, 0, 0], 1); if (tr.fraction < 1) postH = tr.fraction * 140; }
    if (noFixture) { /* free-floating source (machinery, portals): halo only */ }
    else if (best && best.dir[1] === 1) {
      // ceiling: hanging rod + wide lamp panel
      const drop = best.d;
      const rod = new THREE.Mesh(housingGeo, hm); rod.scale.set(2, drop, 2); rod.position.set(p[0], p[1] + drop / 2, p[2]);
      const shade = new THREE.Mesh(housingGeo, hm); shade.scale.set(28, 6, 14); shade.position.set(p[0], p[1] + 2, p[2]);
      const panel = new THREE.Mesh(housingGeo, panelMat); panel.scale.set(24, 1, 10); panel.position.set(p[0], p[1] - 1.2, p[2]);
      fx.add(rod, shade, panel);
      litObjs.push(lit(shade, hm));
    } else if (best) {
      // wall: bracket from the wall, caged lamp
      const d = best.dir, reach = best.d;
      const yaw = Math.atan2(d[0], d[2]);
      const arm = new THREE.Mesh(housingGeo, hm); arm.scale.set(4, 4, reach); arm.rotation.y = yaw;
      arm.position.set(p[0] + d[0] * reach / 2, p[1] + 6, p[2] + d[2] * reach / 2);
      const back = new THREE.Mesh(housingGeo, hm); back.scale.set(20, 26, 3); back.rotation.y = yaw;
      back.position.set(best.pos[0] - d[0] * 1.5, p[1] + 2, best.pos[2] - d[2] * 1.5);
      const cage = new THREE.Mesh(housingGeo, hm); cage.scale.set(12, 3, 12); cage.position.set(p[0], p[1] + 7, p[2]);
      const panel = new THREE.Mesh(housingGeo, panelMat); panel.scale.set(9, 10, 9); panel.position.set(p[0], p[1], p[2]);
      fx.add(arm, back, cage, panel);
      litObjs.push(lit(back, hm));
    } else if (postH > 0) {
      // free standing: lamp post down to the floor
      const h = postH;
      const post = new THREE.Mesh(housingGeo, hm); post.scale.set(5, h, 5); post.position.set(p[0], p[1] - h / 2, p[2]);
      const foot = new THREE.Mesh(housingGeo, hm); foot.scale.set(16, 6, 16); foot.position.set(p[0], p[1] - h + 3, p[2]);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(12, 6, 8, 8), hm); bowl.position.set(p[0], p[1] - 4, p[2]);
      const panel = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3, 8), panelMat); panel.position.set(p[0], p[1] + 0.5, p[2]);
      fx.add(post, foot, bowl, panel);
      litObjs.push(lit(foot, hm));
    }
    // emissive halo: "already bloomed" painted overbright, big and soft in the fog
    const halo = effects.glowSprite(c, 40 + l[4] * 0.1, 0.5);
    halo.position.set(p[0], p[1], p[2]);
    const hot = effects.glowSprite(core, 16, 0.9);
    hot.position.set(p[0], p[1], p[2]);
    fx.add(halo, hot);
    for (const m of fx.children) if (m.material?.isShaderMaterial) m.userData.mats = [m.material];
    group.add(fx);
    // a few fixtures flicker like worn-out tubes
    if (idx % 7 === 3) flick.push({ halo, hot, panelMat, base: core.clone(), seed: idx });
  }
  return {
    group,
    update: (t) => {
      for (const f of flick) {
        const on = Math.sin(t * 23 + f.seed) + Math.sin(t * 7.3 + f.seed * 3) > -1.3 ? 1 : 0.25;
        f.halo.material.opacity = 0.5 * on; f.hot.material.opacity = 0.9 * on;
        f.panelMat.color.copy(f.base).multiplyScalar(on);
      }
    },
  };
}

export function buildSky(map) {
  const sc = map.skyColor || { top: [0.2, 0.3, 0.5], horizon: [0.7, 0.6, 0.5] };
  const sun = map.sun ? new THREE.Vector3(...map.sun.dir).normalize() : new THREE.Vector3(0, 1, 0);
  const planet = map.look?.planet;   // optional big painted moon / planet: { dir, size, color }
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(...sc.top) }, horizon: { value: new THREE.Color(...sc.horizon) }, sunDir: { value: sun },
      sunCol: { value: new THREE.Color(...(map.look?.sunColor || [1.0, 0.85, 0.6])) },
      planetDir: { value: planet ? new THREE.Vector3(...planet.dir).normalize() : new THREE.Vector3(0, -1, 0) },
      planetSize: { value: planet ? planet.size : 0 }, planetCol: { value: new THREE.Color(...(planet?.color || [1, 1, 1])) },
      time: shared.time, fogColor: shared.fogColor,
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float time; uniform vec3 fogColor;
      uniform vec3 planetDir; uniform float planetSize; uniform vec3 planetCol;
      varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        // painted gradient with visible steps, like a hand-banded skybox
        float g = pow(y, 0.55);
        g = floor(g * 14.0) / 14.0 * 0.6 + g * 0.4;
        vec3 col = mix(horizon, top, g);
        // slowly rotating cloud deck: chunky, hard-edged puffs lit from the sun side
        float a = time * 0.004;
        vec2 dd = mat2(cos(a), -sin(a), sin(a), cos(a)) * d.xz;
        vec2 uv = dd / (d.y + 0.22) * 1.4;
        float c = fbm(uv + vec2(time * 0.006, 0.0));
        float cm = smoothstep(0.52, 0.58, c);
        float lit = clamp(dot(normalize(vec3(dd.x, 0.3, dd.y)), sunDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 cloud = mix(top * 0.55 + horizon * 0.2, mix(horizon, sunCol, 0.5) * 1.1, lit);
        col = mix(col, cloud, cm * 0.8 * smoothstep(0.02, 0.3, d.y));
        // planet / moon disc with a terminator and a hard rim
        if (planetSize > 0.0) {
          float pd = acos(clamp(dot(d, planetDir), -1.0, 1.0));
          if (pd < planetSize) {
            vec3 pn = normalize(d - planetDir * cos(pd));
            float sh = clamp(dot(pn, sunDir) * 2.0 + 0.4, 0.08, 1.0);
            float bands = 0.85 + 0.15 * sin((dot(d, vec3(0.0, 1.0, 0.0)) * 60.0) + fbm(d.xz * 9.0) * 4.0);
            col = mix(col, planetCol * sh * bands, smoothstep(planetSize, planetSize * 0.97, pd));
          }
          col += planetCol * 0.25 * smoothstep(planetSize * 1.5, planetSize, pd) * (1.0 - smoothstep(planetSize * 0.97, planetSize * 0.9, pd));
        }
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunCol * (step(0.9993, s) * 1.5 + pow(s, 64.0) * 0.6 + pow(s, 8.0) * 0.2);
        // horizon dissolves into the zone fog: a coloured silhouette wash, not a real distance
        col = mix(col, fogColor, 1.0 - smoothstep(-0.05, 0.28, d.y));
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
