// Menu previews drawn with one small WebGL renderer that moves between panels:
//  - profile: the chosen player model idling on a plinth (a taunt now and then), slowly turning (drag to spin it)
//  - weapon:  the first-person gun exactly as the game draws it, over a map shot, so the
//             position settings can be tuned by eye (click to test-fire)
import * as THREE from 'three';
import { PlayerModel } from '../render/entities.js';
import { ViewWeapon } from '../render/viewweapon.js';

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 4);
    const gr = g.createLinearGradient(-32, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-32, -3 + (i % 2), 64, 6 - (i % 2) * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Previews {
  constructor(assets, settings) {
    this.assets = assets;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.mode = null;
    this.raf = 0;
    this.last = 0;
    // drag to turn the model
    this.spin = 0; this.dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'weapon') { this.gun.fire(this.gun.current); return; }
      this.dragging = true; this.dragX = e.clientX; this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => { if (this.dragging) { this.spin += (e.clientX - this.dragX) * 0.6; this.dragX = e.clientX; } });
    this.canvas.addEventListener('pointerup', () => { this.dragging = false; });
  }

  // ---- profile ----
  showProfile(container) {
    if (!this.profile) {
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(28, 3 / 4, 1, 2000);
      cam.position.set(0, 44, -200);
      cam.lookAt(0, 31, 0);
      // a dark plinth with a ring in the player's colour
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(26, 29, 6, 40), new THREE.MeshBasicMaterial({ color: 0x17130f }));
      plinth.position.y = -3;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(27, 0.8, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.rotation.x = Math.PI / 2;
      scene.add(plinth, ring);
      this.profile = { scene, cam, ring, model: null, key: '' };
    }
    this.attach(container, 'profile');
    this.updateProfile();
  }

  // rebuild the model when the character or colour changes
  updateProfile() {
    const P = this.profile;
    if (!P) return;
    const key = this.settings.character + ':' + this.settings.color;
    if (P.key === key) return;
    P.key = key;
    if (P.model) P.model.dispose();
    P.model = new PlayerModel(this.assets, this.settings.color, P.scene, this.settings.character, true);
    P.ring.material.color.set(this.settings.color);
  }

  // ---- weapon ----
  showWeapon(container) {
    if (!this.gun) {
      this.gun = new ViewWeapon(this.assets, starTexture());
      this.gun.showNow('mg');
    }
    this.attach(container, 'weapon');
  }
  setGun(id) { if (this.gun) this.gun.showNow(id); }

  // ---- shared ----
  attach(container, mode) {
    this.mode = mode;
    container.prepend(this.canvas);
    this.container = container;
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
  }
  detach() {
    this.mode = null;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.canvas.remove();
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.container || !this.container.offsetParent) return;   // hidden panel: idle
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const r = this.renderer;
    // the menu may be zoomed: render at the size it is shown at
    const pr = Math.min(window.devicePixelRatio, 2) * (this.zoom ? this.zoom() : 1);
    if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
    const sz = r.getSize(new THREE.Vector2());
    if (sz.x !== w || sz.y !== h) r.setSize(w, h, false);
    if (this.mode === 'profile') {
      const P = this.profile;
      // slow turn, but swing round to face the camera for a taunt
      if (P.model.taunt && !this.dragging) this.spin += (Math.round(this.spin / 360) * 360 - this.spin) * Math.min(1, dt * 4);
      else if (!this.dragging) this.spin += dt * 22;
      P.cam.aspect = w / h; P.cam.updateProjectionMatrix();
      P.model.updateShowcase(dt, this.spin, [1.15, 1.1, 1.05, 0.35, 0.8, -0.6]);
      r.render(P.scene, P.cam);
    } else if (this.mode === 'weapon') {
      const g = this.gun;
      g.update(dt, 0, true, 0, 0, [0.95, 0.92, 0.88, -0.3, 0.8, 0.5], this.settings);
      g.camera.aspect = w / h; g.camera.updateProjectionMatrix();
      r.render(g.scene, g.camera);
    }
  };
}
