// Per-zone atmosphere (spec 2.3): one saturated fog colour and density per arena zone, always a
// tint of the zone's key light. The fog follows the camera's zone with a short blend, and the
// sky's horizon washes into the same colour so the far plane reads as a coloured silhouette.
import * as THREE from 'three';
import { shared } from './shared.js';

export class Atmosphere {
  constructor(map) {
    const look = map.look || {};
    this.base = { color: new THREE.Color(...(look.fog || [0.2, 0.2, 0.22])), density: look.fogDensity ?? 0.0003 };
    this.zones = (look.zones || []).map((z) => ({
      min: [z.b[0], z.b[1], z.b[2]], max: [z.b[3], z.b[4], z.b[5]],
      color: new THREE.Color(...z.fog), density: z.density ?? this.base.density,
    }));
    shared.fogColor.value.copy(this.base.color);
    shared.fogDensity.value = this.base.density;
    shared.gradeSat.value = look.sat ?? 0.6;
    shared.gradeTint.value.setRGB(...(look.tint || [1, 1, 1]));
    this.zone = null;
  }

  zoneAt(p) {
    let z = null;
    for (const q of this.zones) {
      if (p.x >= q.min[0] && p.x <= q.max[0] && p.y >= q.min[1] && p.y <= q.max[1] && p.z >= q.min[2] && p.z <= q.max[2]) z = q;
    }
    return z || this.base;
  }

  // drifting dust motes in a box that wraps around the camera: catches the zone's light colour,
  // gives the air some depth (Graphics → Animated sky & dust)
  makeDust(scene, count = 700) {
    const R = 700;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * R * 2; pos[i * 3 + 1] = (Math.random() - 0.5) * R; pos[i * 3 + 2] = (Math.random() - 0.5) * R * 2; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { cam: { value: new THREE.Vector3() }, time: shared.time, fogColor: shared.fogColor, R: { value: R }, scale: { value: 600 } },
      vertexShader: `
        attribute float seed; uniform vec3 cam; uniform float time; uniform float R; uniform float scale;
        varying float vA; varying float vSeed;
        void main() {
          vec3 p = position + vec3(sin(time * 0.15 + seed * 40.0) * 30.0, time * (4.0 + seed * 6.0), cos(time * 0.12 + seed * 30.0) * 30.0);
          vec3 box = vec3(R * 2.0, R, R * 2.0);
          p = mod(p - cam + box * 0.5, box) - box * 0.5 + cam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(20.0, 80.0, d) * (1.0 - smoothstep(R * 0.5, R * 0.9, d));
          vSeed = seed;
          gl_PointSize = clamp((1.2 + seed * 1.6) * scale / max(d, 1.0), 1.0, 6.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 fogColor; varying float vA; varying float vSeed;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          vec3 c = mix(fogColor * 2.2 + 0.15, vec3(1.0, 0.95, 0.85), 0.35);
          gl_FragColor = vec4(c * (1.0 - r) * vA * (0.18 + 0.2 * vSeed), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(g, mat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 3;
    scene.add(this.dust);
    return this.dust;
  }

  update(dt, camPos, time) {
    if (this.dust) this.dust.material.uniforms.cam.value.copy(camPos);
    const z = this.zoneAt(camPos);
    const k = Math.min(1, dt * 2.5);
    shared.fogColor.value.lerp(z.color, k);
    shared.fogDensity.value += (z.density - shared.fogDensity.value) * k;
    shared.time.value = time;
  }
}
