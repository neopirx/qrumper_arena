// Loads and normalizes external assets: FBX weapon models, the player characters (Mixamo-rigged
// FBX) and the UAL mannequin whose animation clips drive them through a retargeter.
import * as THREE from 'three';
import { entityMaterial, cloneEntityMaterial, lightEntityMaterial } from './entitymat.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Per-model fix-ups: rotation (around Y) that points the muzzle toward -Z, and length in game units.
const WEAPON_MODELS = {
  shotgun: { file: 'shotgun', rotY: -Math.PI / 2, length: 34 },
  nade_launcher: { file: 'nade_launcher', rotY: Math.PI, length: 34 },
  rocket_launcher: { file: 'rocket_launcher', rotY: -Math.PI / 2, length: 38 },
  railgun: { file: 'railgun', rotY: -Math.PI / 2, length: 42 },
  machinegun: { file: 'machine_gun', rotY: Math.PI / 2, length: 34 },
};

// Player models (file in assets/characters, display name) live in sim/defs.js so the server knows them too.
import { CHARACTER_INFO, CHARACTERS } from '../sim/defs.js';
export { CHARACTER_INFO, CHARACTERS };

export class Assets {
  constructor() {
    this.weapons = {};   // name -> { object (template), muzzle: Vector3, length }
    this.character = null;   // UAL mannequin: animation source skeleton
    this.characters = {};    // name -> FBX template (Mixamo rig, T-pose)
    this.clips = {};
  }

  async load(onProgress = () => {}) {
    const fbx = new FBXLoader();
    const gltf = new GLTFLoader();
    const jobs = [];
    let done = 0;
    const total = Object.keys(WEAPON_MODELS).length + 2 + CHARACTERS.length + SHOWCASE_CLIPS.length;
    const tick = () => onProgress(++done / total);
    for (const [name, cfg] of Object.entries(WEAPON_MODELS)) {
      jobs.push(fbx.loadAsync(`/weapons/${cfg.file}.fbx`).then((obj) => { this.weapons[name] = normalizeWeapon(obj, cfg); tick(); }));
    }
    jobs.push(gltf.loadAsync('/animations/UAL1_Standard.glb').then((g) => { this.character = g.scene; for (const c of g.animations) this.clips[c.name] = c; tick(); }));
    for (const name of CHARACTERS) {
      jobs.push(fbx.loadAsync(`/characters/${CHARACTER_INFO[name].file}.fbx`).then((obj) => { this.characters[name] = obj; tick(); }));
    }
    // menu showcase: Mixamo idle + taunts, each FBX carries its own copy of the Mixamo skeleton
    const show = [];
    SHOWCASE_CLIPS.forEach((f, i) => jobs.push(fbx.loadAsync(`/animations/${encodeURIComponent(f)}.fbx`).then((obj) => { show[i] = obj; tick(); })));
    jobs.push(gltf.loadAsync('/animations/UAL2_Standard.glb').then((g) => { for (const c of g.animations) if (!this.clips[c.name]) this.clips[c.name] = c; tick(); }));
    await Promise.all(jobs);
    const clips = show.map((o) => anchorClip(o.animations[0]));
    const idle = clips[0], taunts = clips.slice(1, 1 + TAUNTS.length), [victory, defeat, defeat2] = clips.slice(1 + TAUNTS.length);
    // menu showcase: idle + taunts; end-of-match podium: victory for the winner, defeats for 2nd / 3rd
    this.showcase = { rig: show[0], clips: { idle, taunts, victory, defeats: [defeat, defeat2] } };
    // shared character scale: mannequin is 1.83m -> ~58 game units
    this.character.scale.setScalar(32);
    this.icons = renderWeaponIcons(this);
  }
}

const TAUNTS = ['taunt', 'taunt02', 'taunt03', 'taunt04'];
const SHOWCASE_CLIPS = ['Idle', ...TAUNTS, 'victory', 'defeat', 'defeat_02'];

// keep the clip on the spot: hips start over the origin (Taunt is authored half a metre back)
function anchorClip(clip) {
  const t = clip.tracks.find((x) => /Hips\.position$/.test(x.name));
  if (t) {
    const x0 = t.values[0], z0 = t.values[2];
    for (let i = 0; i < t.values.length; i += 3) { t.values[i] -= x0; t.values[i + 2] -= z0; }
  }
  return clip;
}

function normalizeWeapon(obj, cfg) {
  const inner = new THREE.Group();
  inner.add(obj);
  inner.rotation.y = cfg.rotY;
  const root = new THREE.Group();
  root.add(inner);
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = cfg.length / size.z;
  inner.scale.setScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  // origin at the grip area: centre in x, slightly above the bottom, ~60% toward the back
  inner.position.set(-c.x, -c.y, -c.z);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  obj.traverse((m) => {
    if (m.isMesh) {
      const old = Array.isArray(m.material) ? m.material[0] : m.material;
      // painted-shading weapons with a slight oiled sheen (single Blinn-Phong lobe)
      m.material = entityMaterial({ map: old.map || null, spec: 0.45 });
      m.castShadow = false;
    }
  });
  const muzzle = new THREE.Vector3(0, (box.max.y + box.min.y) / 2 + (box.max.y - box.min.y) * 0.15, box.min.z);
  return { object: root, muzzle, length: cfg.length, box };
}

export const WEAPON_MODEL_FOR = { mg: 'machinegun', sg: 'shotgun', gl: 'nade_launcher', rl: 'rocket_launcher', rg: 'railgun' };

// Clone a weapon template with per-instance materials (so each can be lit separately).
export function cloneWeapon(assets, id) {
  const tpl = assets.weapons[WEAPON_MODEL_FOR[id]];
  const obj = tpl.object.clone(true);
  const mats = [];
  obj.traverse((m) => {
    if (m.isMesh) { m.material = cloneEntityMaterial(m.material); mats.push(m.material); }
  });
  obj.userData.mats = mats;
  obj.userData.muzzle = tpl.muzzle.clone();
  return obj;
}

// Light every entity material of an object from a light grid sample ([r,g,b] or [r,g,b,dx,dy,dz]).
export function setLight(obj, sample, boost = 1) {
  for (const m of obj.userData.mats || []) lightEntityMaterial(m, sample, boost);
}

// Side-on renders of every weapon model (muzzle to the right) as data URLs, for the HUD.
function renderWeaponIcons(assets) {
  const W = 192, H = 72;
  const icons = {};
  let r;
  try { r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch { return icons; }
  r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  for (const [id, name] of Object.entries(WEAPON_MODEL_FOR)) {
    const tpl = assets.weapons[name];
    if (!tpl) continue;
    const obj = cloneWeapon(assets, id);
    setLight(obj, [1.25, 1.2, 1.15, 0.5, 0.8, 0.3], 1.15);
    scene.add(obj);
    const b = tpl.box, c = b.getCenter(new THREE.Vector3());
    const len = b.max.z - b.min.z, hgt = b.max.y - b.min.y;
    const half = Math.max(len / 2 * 1.04, hgt / 2 * 1.04 * W / H);
    cam.left = -half; cam.right = half; cam.top = half * H / W; cam.bottom = -half * H / W;
    cam.position.set(c.x + 200, c.y, c.z); cam.lookAt(c.x, c.y, c.z); cam.updateProjectionMatrix();
    r.render(scene, cam);
    icons[id] = r.domElement.toDataURL('image/png');
    scene.remove(obj);
  }
  r.dispose();
  r.forceContextLoss();
  return icons;
}
