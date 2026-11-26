// End-of-match podium: the top three on a lit stage. The winner stands on the tall centre plinth
// playing the victory clip, 2nd (left) and 3rd (right) play the two defeat clips. Drawn in its own
// scene with the main renderer once the scoreboard has had its moment.
import * as THREE from 'three';
import { PlayerModel } from './entities.js';

const PLINTHS = [
  { x: 0, h: 40, z: 0, label: '1', color: '#ffc840' },      // 1st: centre, tallest
  { x: 82, h: 26, z: 14, label: '2', color: '#d8dde6' },    // 2nd: screen left (the camera looks down +z)
  { x: -82, h: 14, z: 14, label: '3', color: '#e08a4a' },   // 3rd: screen right
];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// plinth face: brushed dark metal, a bevelled frame and the place numeral in its medal colour
function plinthFace(label, color, aspect) {
  return canvasTex(512, Math.round(512 * aspect), (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2c2f36'); gr.addColorStop(1, '#121318');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 1); }
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 3; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = color; g.fillRect(0, 0, w, 6);
    g.font = `400 ${Math.round(h * 0.62)}px Proxime, Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 30;
    g.fillStyle = color; g.fillText(label, w / 2, h / 2 + 12);
  });
}

function glowTex() {
  return canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}

// volumetric-looking light shaft: a cone fading out toward the floor and at its rim
function shaftMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, op: { value: 0.22 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float op; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { float rim = pow(abs(dot(vN, vV)), 1.6); float a = op * rim * smoothstep(0.0, 0.85, vUv.y); gl_FragColor = vec4(color * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export class Podium {
  // top: [{ name, color, character, frags }] in placing order (1 to 3 entries)
  constructor(assets, top) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080c);
    this.scene.fog = new THREE.FogExp2(0x07080c, 0.0016);
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 4000);
    this.t = 0;
    this.models = [];
    this.heads = [];
    const S = this.scene;
    // floor: a dark disc with concentric rings, a back wall with vertical light slots
    const floor = new THREE.Mesh(new THREE.CircleGeometry(520, 64), new THREE.MeshBasicMaterial({ map: canvasTex(512, 512, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, '#24262e'); gr.addColorStop(0.5, '#13141a'); gr.addColorStop(1, '#07080c');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      g.strokeStyle = 'rgba(255,200,80,0.10)';
      for (let r = 40; r < w / 2; r += 34) { g.lineWidth = r % 3 ? 1 : 2; g.beginPath(); g.arc(w / 2, w / 2, r, 0, 7); g.stroke(); }
    }) }));
    floor.rotation.x = -Math.PI / 2;
    S.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1400, 600), new THREE.MeshBasicMaterial({ map: canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#0b0c11'; g.fillRect(0, 0, w, h);
      for (let x = 16; x < w; x += 48) {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(255,190,80,0)'); gr.addColorStop(0.5, 'rgba(255,190,80,0.16)'); gr.addColorStop(1, 'rgba(255,190,80,0)');
        g.fillStyle = gr; g.fillRect(x, 0, 3, h);
      }
    }) }));
    wall.position.set(0, 220, 300);
    wall.rotation.y = Math.PI;
    S.add(wall);
    const glow = glowTex();
    this.motes = [];
    PLINTHS.forEach((pl, i) => {
      const face = plinthFace(pl.label, pl.color, pl.h / 70);
      const side = new THREE.MeshBasicMaterial({ color: 0x1a1c22 });
      const lid = new THREE.MeshBasicMaterial({ color: 0x2a2d35 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(70, pl.h, 56), [side, side, lid, side, side, new THREE.MeshBasicMaterial({ map: face })]);
      // the -z face (last material) looks at the camera
      box.position.set(pl.x, pl.h / 2, pl.z);
      S.add(box);
      // light edge along the top of the plinth in its medal colour
      const edge = new THREE.Mesh(new THREE.BoxGeometry(71, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: pl.color }));
      edge.position.set(pl.x, pl.h, pl.z - 28);
      S.add(edge);
      const p = top[i];
      // light shaft from above and a pool of light on the plinth
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(6, 46, 320, 32, 1, true), shaftMaterial(i === 0 ? 0xffd890 : 0xc8d4ff));
      cone.position.set(pl.x, pl.h + 160, pl.z);
      cone.material.uniforms.op.value = i === 0 ? 0.3 : 0.16;
      S.add(cone);
      const pool = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: p ? p.color : 0x444444, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      pool.scale.set(120, 40, 1);
      pool.position.set(pl.x, pl.h + 1, pl.z - 30);
      S.add(pool);
      if (!p) return;
      const m = new PlayerModel(assets, p.color, S, p.character, true);
      const clips = assets.showcase.clips;
      m.holdClip(i === 0 ? clips.victory : clips.defeats[(i - 1) % clips.defeats.length]);
      m.mixer.update(Math.random() * 0.5);
      this.models.push({ m, pos: [pl.x, pl.h, pl.z], yaw: i === 0 ? 0 : i === 1 ? 14 : -14, light: i === 0 ? [1.35, 1.25, 1.05, 0.2, 0.9, -0.4] : [1.05, 1.05, 1.12, 0.3, 0.85, -0.45] });
      this.heads.push({ place: i + 1, ...p, at: new THREE.Vector3(pl.x, pl.h + 72, pl.z) });
    });
    // gold motes rising around the winner
    const n = 160;
    const pos = new Float32Array(n * 3);
    this.moteData = [];
    for (let i = 0; i < n; i++) this.moteData.push({ a: Math.random() * 6.28, r: 20 + Math.random() * 90, y: Math.random() * 200, v: 10 + Math.random() * 30 });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motesGeo = mg;
    const pts = new THREE.Points(mg, new THREE.PointsMaterial({ map: glow, color: 0xffc860, size: 3.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    S.add(pts);
  }

  update(dt, aspect) {
    this.t += dt;
    const t = this.t;
    // slow push-in from wide with a gentle sway
    const k = 1 - Math.exp(-t * 0.6);
    const dist = 420 - 110 * k;
    const sway = Math.sin(t * 0.25) * 0.12;
    this.camera.position.set(Math.sin(sway) * dist, 70 + 26 * (1 - k), -Math.cos(sway) * dist);
    this.camera.lookAt(0, 52, 0);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1.5 ? 36 : 30;
    this.camera.updateProjectionMatrix();
    for (const x of this.models) x.m.updateShowcase(dt, x.yaw, x.light, x.pos);
    const P = this.motesGeo.attributes.position.array;
    this.moteData.forEach((d, i) => {
      d.y += d.v * dt; if (d.y > 220) d.y = 0;
      d.a += dt * 0.4;
      P[i * 3] = Math.cos(d.a) * d.r; P[i * 3 + 1] = 40 + d.y; P[i * 3 + 2] = Math.sin(d.a) * d.r;
    });
    this.motesGeo.attributes.position.needsUpdate = true;
  }

  // screen positions (0..1) of the name tags above each player's head
  labels() {
    return this.heads.map((h) => {
      const v = h.at.clone().project(this.camera);
      return { ...h, x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    });
  }

  dispose() {
    for (const x of this.models) x.m.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}
