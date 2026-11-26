// Blood and gibs. Hits spray blood along the shot and splat it onto whatever surface is behind the
// victim; a kill that leaves the body far below zero health (Q3 GIB_HEALTH) bursts it into tumbling
// chunks that bounce off the world, trail blood and smear it where they land. Bodies that die in one
// piece bleed a pool onto the floor. Everything is painted and lit from the light grid like the rest
// of the world (no PBR wetness), so the gore stays inside the visual direction.
import * as THREE from 'three';
import { entityMaterial, lightEntityMaterial } from './entitymat.js';

const MAX_CHUNKS = 140;
const MAX_POOLS = 24;
const GRAV = 800;
const BLOOD = [[0.55, 0.03, 0.02], [0.42, 0.01, 0.01], [0.68, 0.06, 0.03]];

// Painted blood splat: a dense core, lobes and a ring of droplets, darker toward the rim.
function splatTexture(seed, streak = false) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  g.translate(s / 2, s / 2);
  const blob = (x, y, rad, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); };
  if (streak) g.scale(1, 0.45);
  // body
  for (let i = 0; i < 9; i++) { const a = rnd() * 6.28, d = rnd() * s * 0.12; blob(Math.cos(a) * d, Math.sin(a) * d, s * (0.1 + rnd() * 0.1), 'rgb(92,8,6)'); }
  // lobes reaching out
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 6.28, len = s * (0.18 + rnd() * 0.18);
    for (let k = 0; k < 5; k++) { const d = len * k / 5; blob(Math.cos(a) * d, Math.sin(a) * d, s * (0.07 - k * 0.011), 'rgb(104,10,7)'); }
  }
  // droplets
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, d = s * (0.22 + rnd() * 0.24); blob(Math.cos(a) * d, Math.sin(a) * d, s * (0.008 + rnd() * 0.022), 'rgb(86,6,4)'); }
  // wet highlight and dark core: two flat painted values, no gloss
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.45);
  gr.addColorStop(0, 'rgba(40,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(60,2,2,0.15)'); gr.addColorStop(1, 'rgba(20,0,0,0.5)');
  g.fillStyle = gr; g.fillRect(-s, -s, s * 2, s * 2);
  blob(-s * 0.04, -s * 0.05, s * 0.03, 'rgba(190,60,50,0.45)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function poolTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * 6.28 + Math.random() * 0.3, d = s * (0.12 + Math.random() * 0.14);
    g.fillStyle = 'rgb(70,4,3)'; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, s * (0.13 + Math.random() * 0.08), 0, 7); g.fill();
  }
  g.fillStyle = 'rgb(62,3,2)'; g.beginPath(); g.arc(0, 0, s * 0.26, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150,40,34,0.35)'; g.beginPath(); g.ellipse(-s * 0.08, -s * 0.1, s * 0.12, s * 0.04, -0.5, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// low-poly chunk shapes: lumps of meat, a bone, a rib plate
function lump(r, sx, sy, sz) { const g = new THREE.IcosahedronGeometry(r, 0); g.scale(sx, sy, sz); return g; }
const SHAPES = () => [
  { geo: lump(4.5, 1, 0.8, 1.2), col: 0x7a1410 }, { geo: lump(3.5, 1.3, 0.7, 1), col: 0x5c0c08 },
  { geo: lump(5.5, 1, 0.9, 0.8), col: 0x8c2a22 }, { geo: lump(2.8, 1, 1, 1), col: 0xa03a30 },
  { geo: new THREE.CylinderGeometry(1.3, 1.6, 13, 5).rotateZ(Math.PI / 2), col: 0xd8ccb0, bone: true },
  { geo: new THREE.BoxGeometry(9, 2, 7), col: 0x6a100c },
];

export class Gore {
  constructor(scene, col, effects) {
    this.scene = scene; this.col = col; this.fx = effects;
    this.enabled = true;
    this.splats = [0, 1, 2, 3].map((i) => splatTexture(i + 1));
    this.streaks = [0, 1].map((i) => splatTexture(i + 11, true));
    this.poolTex = poolTexture();
    this.shapes = SHAPES();
    this.chunks = [];
    this.pools = [];
    this.lightGrid = null;
    this._s = [0, 0, 0, 0, 0, 0];
  }

  // decal tinted by the light at that spot, so blood in a dark corner stays dark
  splat(pos, normal, size, streak = false, life = 30) {
    const tex = streak ? this.streaks[(Math.random() * this.streaks.length) | 0] : this.splats[(Math.random() * this.splats.length) | 0];
    this.fx.decal(pos, normal, tex, size, life, this.tint(pos, normal));
  }
  tint(pos, normal) {
    if (!this.lightGrid) return 0xffffff;
    const s = this._s, n = normal || [0, 1, 0];
    this.lightGrid.sample([pos[0] + n[0] * 8, pos[1] + n[1] * 8, pos[2] + n[2] * 8], s);
    const k = 1.15;
    return new THREE.Color(Math.min(1, s[0] * k + 0.08), Math.min(1, s[1] * k + 0.06), Math.min(1, s[2] * k + 0.06));
  }

  // trace from `from` along `dir` and splat the first surface within `reach`
  splatAlong(from, dir, reach, size) {
    const end = [from[0] + dir[0] * reach, from[1] + dir[1] * reach, from[2] + dir[2] * reach];
    const tr = this.col.trace(from, end, [0, 0, 0], [0, 0, 0], 1);
    if (tr.fraction >= 1 || tr.startsolid) return false;
    // glancing hits on walls streak; floors and head-on walls blot
    const streak = Math.abs(tr.normal[1]) < 0.5 && Math.abs(dir[0] * tr.normal[0] + dir[2] * tr.normal[2]) < 0.6;
    this.splat(tr.endpos, tr.normal, size * (0.75 + Math.random() * 0.5) * (1 + tr.fraction * 0.4), streak);
    return true;
  }

  // one wet droplet streak (normal-blended, stretched along its velocity, falls with gravity)
  drop(pos, v, sp, width = 1.4, life = 0.55) {
    const c = BLOOD[(Math.random() * 3) | 0];
    this.fx.wet.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], stretch: 0.028, life: life * (0.7 + Math.random() * 0.6), width, width1: width * 0.6, color: c, color1: [0.3, 0.01, 0.01], alpha: 1, alpha1: 0.75, grav: GRAV, drag: 0.6, tail: 0.1 });
  }
  // a round droplet / clot particle
  blob(pos, v, sp, size, life = 0.6) {
    this.fx.smoke.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], life: life * (0.7 + Math.random() * 0.6), size, size1: size * 0.7, color: BLOOD[(Math.random() * 3) | 0], color1: [0.26, 0, 0], alpha: 1, alpha1: 0.85, grav: GRAV });
  }
  // red mist: hard-edged painted puffs (the smoke card), never glowing
  mist(pos, v, sp, s0, s1, life, alpha = 0.8) {
    this.fx.smoke.add({ pos: [...pos], vel: [v[0] * sp, v[1] * sp, v[2] * sp], life, size: s0, size1: s1, color: [0.52, 0.04, 0.03], color1: [0.24, 0.01, 0.01], alpha, alpha1: 0, drag: 3.5, kind: 2, spin: (Math.random() - 0.5) * 2, sizeEase: true, ease: true });
  }

  // A hit: a jet out of the exit wound along the shot, a smaller spurt back out of the entry,
  // a puff of mist, and splatter on whatever is behind / under the victim.
  // `splatOnly`: the local player was hit, so no particles in front of the camera, only the splatter
  spray(pos, dir, damage = 10, splatOnly = false) {
    if (!this.enabled) return;
    const d = dir || [0, 1, 0];
    const fx = this.fx;
    if (splatOnly) { this.splatAlong(pos, rndDir(d, 2.5), 90 + damage * 1.6, 12 + Math.min(30, damage * 0.3)); return; }
    const heavy = Math.min(1, damage / 100);
    // exit jet: fast thin streaks bunched around the shot direction
    for (let i = 0; i < fx.n(6 + heavy * 22); i++) this.drop(pos, rndDir([d[0], d[1] + 0.15, d[2]], 1.6), 180 + Math.random() * (260 + heavy * 300), 1.1 + Math.random() * (0.8 + heavy * 1.6));
    // droplets and clots
    for (let i = 0; i < fx.n(5 + heavy * 20); i++) this.blob(pos, rndDir(d, 0.9), 60 + Math.random() * 240, 2 + Math.random() * (2 + heavy * 3));
    // entry spurt back toward the shooter
    const back = [-d[0], -d[1] + 0.3, -d[2]];
    for (let i = 0; i < fx.n(2 + heavy * 6); i++) this.drop(pos, rndDir(back, 1.2), 80 + Math.random() * 160, 1 + Math.random());
    // mist
    for (let i = 0; i < fx.n(1 + heavy * 4); i++) this.mist(pos, rndDir(d, 0.5), 20 + Math.random() * 60, 6 + damage * 0.08, 18 + damage * 0.22, 0.35 + Math.random() * 0.25, 0.7);
    // splatter: the wall behind the victim, sometimes the floor under it
    const reach = 90 + damage * 1.8;
    const tries = damage >= 60 ? 3 : damage >= 20 ? 2 : 1;
    for (let i = 0; i < tries; i++) this.splatAlong(pos, rndDir(d, 2.5), reach, 14 + Math.min(34, damage * 0.32));
    if (Math.random() < 0.35 + damage / 100) this.splatAlong(pos, [d[0] * 0.3 + (Math.random() - 0.5) * 0.4, -1, d[2] * 0.3 + (Math.random() - 0.5) * 0.4], 160, 12 + Math.min(20, damage * 0.22));
  }

  // The body bursts: a blood explosion (a shell of jets and droplets, a rolling red cloud, a wet
  // ring on the floor and splatter on every surface around), then a rain of droplets and a dozen
  // and a half tumbling chunks that bleed and smear where they land.
  gib(pos, vel, dir, color, camPos = null) {
    if (!this.enabled) return;
    const fx = this.fx;
    const d = dir || [0, 1, 0];
    const c0 = [pos[0], pos[1] + 6, pos[2]];
    const jitter = (r, ry = r) => [c0[0] + (Math.random() - 0.5) * r, c0[1] + (Math.random() - 0.5) * ry, c0[2] + (Math.random() - 0.5) * r];
    // shell: streaks in every direction, biased up and along the killing blow
    const bias = [d[0] * 0.4, 0.45, d[2] * 0.4];
    for (let i = 0; i < fx.n(90); i++) this.drop(jitter(16, 30), rndDir(bias, 0.15), 220 + Math.random() * 520, 1.6 + Math.random() * 2.6, 0.8);
    for (let i = 0; i < fx.n(110); i++) this.blob(jitter(20, 40), rndDir(bias, 0.25), 120 + Math.random() * 460, 2.5 + Math.random() * 5, 1.1);
    // rolling cloud: a dense core, then a looser outer layer a beat later
    // (flattened: the cloud rolls outward more than it rises)
    const flat = (v) => { v[1] *= 0.45; return v; };
    for (let i = 0; i < fx.n(16); i++) this.mist(jitter(30, 26), flat(rndDir([0, 0.2, 0], 0)), 70 + Math.random() * 150, 22 + Math.random() * 16, 70 + Math.random() * 50, 0.9 + Math.random() * 0.7, 0.92);
    fx.later(0.07, () => { for (let i = 0; i < fx.n(10); i++) this.mist(jitter(50, 30), flat(rndDir([0, 0.3, 0], 0)), 110 + Math.random() * 140, 30 + Math.random() * 20, 100 + Math.random() * 50, 1.1 + Math.random() * 0.6, 0.6); });
    fx.flash(c0, fx.glowTex, 0x8a0a06, 50, 120, 0.16, 0.6);
    fx.flash(c0, fx.glowTex, 0xff2010, 20, 60, 0.07, 0.5);
    // a quick red light so the burst reads in the dark
    if (fx.gfx.dynLights !== false) fx.light(c0, 0xa01008, 180, 0.18, { intensity: 0.8 });
    // the wet ring under the body and splatter all around (walls, ceiling, floor)
    this.splatAlong(c0, [0, -1, 0], 220, 80 + Math.random() * 30);
    for (let i = 0; i < 16; i++) this.splatAlong(c0, rndDir([0, -0.15, 0], 1.2), 260, 28 + Math.random() * 22);
    for (let i = 0; i < 3; i++) this.splatAlong(c0, rndDir([0, 1, 0], 0.6), 300, 30 + Math.random() * 20);
    // blood rain: what was thrown up comes back down over the next half second
    for (let k = 0; k < 3; k++) fx.later(0.2 + k * 0.15, () => {
      for (let i = 0; i < fx.n(18); i++) this.blob([c0[0] + (Math.random() - 0.5) * 120, c0[1] + 40 + Math.random() * 60, c0[2] + (Math.random() - 0.5) * 120], [0, -1, 0], 50 + Math.random() * 120, 1.8 + Math.random() * 2.5, 0.8);
    });
    // a jolt if it went off right next to us
    if (camPos) { const dist = Math.hypot(camPos.x - c0[0], camPos.y - c0[1], camPos.z - c0[2]); if (dist < 260) fx.shake = Math.max(fx.shake, 0.35 * (1 - dist / 260) * (fx.gfx.shake ?? 1)); }
    // chunks
    const accent = new THREE.Color(color ?? 0x888888);
    const count = 18;
    for (let i = 0; i < count; i++) {
      const sh = this.shapes[i % this.shapes.length];
      const armour = i < 2;   // two plates of the player's armour, in their colour
      const mat = entityMaterial({ color: armour ? accent.clone().multiplyScalar(0.8) : sh.col, spec: sh.bone ? 0.25 : armour ? 0.5 : 0.35 });
      const mesh = new THREE.Mesh(armour ? this.shapes[5].geo : sh.geo, mat);
      mesh.userData.mats = [mat];
      const sc = 1.1 + Math.random() * 0.8;
      mesh.scale.setScalar(sc);
      const v = rndDir([d[0] * 0.6, 0.8, d[2] * 0.6], 0.2); const sp = 180 + Math.random() * 400;
      const p = jitter(24, 40);
      // don't start chunks inside a wall
      const tr = this.col.trace(c0, p, [0, 0, 0], [0, 0, 0], 1);
      mesh.position.set(tr.endpos[0], tr.endpos[1], tr.endpos[2]);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(mesh);
      this.chunks.push({
        mesh, mat, t: 0, life: 10 + Math.random() * 5, rest: false, trailT: 0, lightT: 0, bounces: 0, radius: 3 * sc,
        vel: [v[0] * sp + vel[0] * 0.5, v[1] * sp + 140 + Math.max(0, vel[1] * 0.3), v[2] * sp + vel[2] * 0.5],
        spin: [(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22],
        bleeds: !sh.bone && !armour,
      });
    }
    while (this.chunks.length > MAX_CHUNKS) this.removeChunk(this.chunks[0]);
  }

  // A body that died in one piece bleeds a pool onto the floor beneath it.
  pool(pos) {
    if (!this.enabled) return;
    const tr = this.col.trace([pos[0], pos[1], pos[2]], [pos[0], pos[1] - 120, pos[2]], [0, 0, 0], [0, 0, 0], 1);
    if (tr.fraction >= 1 || tr.normal[1] < 0.7) return;
    const m = new THREE.MeshBasicMaterial({ map: this.poolTex, color: this.tint(tr.endpos, tr.normal), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
    const mesh = new THREE.Mesh(this.fx.decalGeo, m);
    mesh.position.set(tr.endpos[0], tr.endpos[1] + 0.4, tr.endpos[2]);
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
    mesh.scale.setScalar(4);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.pools.push({ mesh, t: 0, life: 28, size: 34 + Math.random() * 18 });
    while (this.pools.length > MAX_POOLS) { const p = this.pools.shift(); this.scene.remove(p.mesh); p.mesh.material.dispose(); }
  }

  removeChunk(c) {
    this.scene.remove(c.mesh); c.mat.dispose();
    const i = this.chunks.indexOf(c); if (i >= 0) this.chunks.splice(i, 1);
  }

  update(dt, lightGrid) {
    this.lightGrid = lightGrid;
    for (const c of [...this.chunks]) {
      c.t += dt;
      const m = c.mesh;
      if (c.t >= c.life) { this.removeChunk(c); continue; }
      // light from the grid a few times a second
      c.lightT -= dt;
      if (c.lightT <= 0 && lightGrid) { c.lightT = 0.15; lightGrid.sample([m.position.x, m.position.y + 6, m.position.z], this._s); lightEntityMaterial(c.mat, this._s, 1.1); }
      // the last second: sink into the floor
      if (c.life - c.t < 1.2) { m.position.y -= dt * 6; continue; }
      if (c.rest) continue;
      c.vel[1] -= GRAV * dt;
      const p = m.position;
      const from = [p.x, p.y, p.z];
      const to = [p.x + c.vel[0] * dt, p.y + c.vel[1] * dt, p.z + c.vel[2] * dt];
      const r = c.radius;
      const tr = this.col.trace(from, to, [-r, -r, -r], [r, r, r], 1);
      if (tr.startsolid) { c.rest = true; continue; }
      p.set(tr.endpos[0], tr.endpos[1], tr.endpos[2]);
      m.rotation.x += c.spin[0] * dt; m.rotation.y += c.spin[1] * dt; m.rotation.z += c.spin[2] * dt;
      if (tr.fraction < 1) {
        const n = tr.normal, vn = c.vel[0] * n[0] + c.vel[1] * n[1] + c.vel[2] * n[2];
        const speed = Math.hypot(...c.vel);
        // smear blood where meat hits hard
        if (c.bleeds && speed > 120 && c.bounces < 4) this.splat([tr.endpos[0] - n[0] * r, tr.endpos[1] - n[1] * r, tr.endpos[2] - n[2] * r], n, 10 + Math.random() * 10, speed > 300);
        c.bounces++;
        // wet, heavy bounce: most energy is lost, tangential motion drags
        for (let i = 0; i < 3; i++) c.vel[i] = (c.vel[i] - vn * n[i]) * 0.55 - vn * n[i] * 0.3;
        for (let i = 0; i < 3; i++) c.spin[i] *= 0.6;
        if (n[1] > 0.7 && Math.hypot(...c.vel) < 50) { c.rest = true; c.vel = [0, 0, 0]; }
      }
      // blood trail while flying
      c.trailT -= dt;
      if (c.bleeds && c.trailT <= 0 && c.t < 2.2) {
        c.trailT = 0.02;
        this.fx.smoke.add({ pos: [p.x, p.y, p.z], vel: [c.vel[0] * 0.05, c.vel[1] * 0.05, c.vel[2] * 0.05], life: 0.5 + Math.random() * 0.3, size: 2.8, size1: 1.4, color: BLOOD[(Math.random() * 3) | 0], color1: [0.3, 0, 0], alpha: 1, alpha1: 0.7, grav: GRAV * 0.8 });
        if (Math.random() < 0.35) this.drop([p.x, p.y, p.z], rndDir([0, -1, 0], 0.5), 30 + Math.random() * 60, 1.2, 0.5);
      }
    }
    for (const pl of this.pools) {
      pl.t += dt;
      const k = Math.min(1, pl.t / 2.5);
      pl.mesh.scale.setScalar(4 + (pl.size - 4) * (1 - (1 - k) * (1 - k)));
      if (pl.t > pl.life - 3) pl.mesh.material.opacity = Math.max(0, (pl.life - pl.t) / 3);
    }
    const keep = [];
    for (const pl of this.pools) { if (pl.t < pl.life) keep.push(pl); else { this.scene.remove(pl.mesh); pl.mesh.material.dispose(); } }
    this.pools = keep;
  }

  dispose() {
    for (const c of [...this.chunks]) this.removeChunk(c);
    for (const pl of this.pools) { this.scene.remove(pl.mesh); pl.mesh.material.dispose(); }
    this.pools = [];
  }
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
