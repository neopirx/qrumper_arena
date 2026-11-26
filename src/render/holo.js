// Holographic pickup look: an additive shell over the item with a fresnel rim, scanlines rolling
// up the model, a faint interference flicker and a "materialize" sweep when the item respawns.
// The plinth projects it: a scanlined light cone from the emitter ring up to the item, a slowly
// counter-rotating dashed halo and motes drifting up the beam. While the item is gone, only a
// dim flickering ghost of it remains (the projector idling), so respawn spots stay readable.
import * as THREE from 'three';
import { shared } from './shared.js';

const holoVert = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
varying float vFog;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const holoFrag = /* glsl */`
uniform vec3 color;
uniform float time;
uniform float opacity;
uniform float reveal;     // world-space height the materialize sweep has reached
uniform float base;       // world-space bottom of the item
uniform float fogDensity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
varying float vFog;
float hash(float x) { return fract(sin(x * 91.17) * 43758.55); }
void main() {
  float h = vW.y - base;
  if (h > reveal) discard;
  vec3 N = normalize(vN), V = normalize(vV);
  float fres = pow(1.0 - abs(dot(N, V)), 2.2);
  // fine scanlines rolling upward plus one bright sweep band every couple of seconds
  float lines = 0.55 + 0.45 * step(0.5, fract(vW.y * 0.55 - time * 2.2));
  float sweep = smoothstep(0.0, 1.0, 1.0 - abs(fract(time * 0.45) * 40.0 - h) / 3.0);
  float flick = 0.88 + 0.12 * hash(floor(time * 24.0));
  float edge = 1.0 - smoothstep(0.0, 2.5, reveal - h);       // hot line at the materialize front
  float a = (0.10 + fres * 1.1) * lines * flick + sweep * 0.5 + edge * 1.5;
  vec3 c = mix(color, vec3(1.0), clamp(fres * 0.35 + sweep * 0.4 + edge * 0.8, 0.0, 1.0));
  float f = 1.0 - exp(-fogDensity * vFog);
  gl_FragColor = vec4(c * a * opacity * (1.0 - f), 1.0);
}`;

export function holoMaterial(color) {
  return new THREE.ShaderMaterial({
    vertexShader: holoVert, fragmentShader: holoFrag,
    uniforms: { color: { value: new THREE.Color(color) }, time: shared.time, opacity: { value: 1 }, reveal: { value: 1e4 }, base: { value: 0 }, fogDensity: shared.fogDensity },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}

// projector cone: scanlines and a vertical fade, scrolling upward
const coneFrag = /* glsl */`
uniform vec3 color;
uniform float time;
uniform float opacity;
varying vec2 vUv;
void main() {
  float lines = 0.6 + 0.4 * step(0.5, fract(vUv.y * 18.0 - time * 3.0));
  float rays = 0.65 + 0.35 * sin(vUv.x * 6.2831 * 8.0 + time * 1.5);
  float fade = pow(1.0 - vUv.y, 1.6);
  gl_FragColor = vec4(color * fade * lines * rays * opacity, 1.0);
}`;
const coneVert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function dashTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 16);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.55)';
    g.fillRect(i * 16 + 2, i % 4 === 0 ? 3 : 6, i % 4 === 0 ? 10 : 6, i % 4 === 0 ? 10 : 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _dash = null;

// add the holographic shell to every mesh of `model` (sharing geometry); returns the materials
export function addHoloShell(model, color) {
  const mats = [];
  const meshes = [];
  // additive glow parts (health spheres) already read as light: no shell on those
  model.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && !o.userData.holo && o.material?.blending !== THREE.AdditiveBlending) meshes.push(o); });
  for (const o of meshes) {
    const m = holoMaterial(color);
    const shell = new THREE.Mesh(o.geometry, m);
    shell.userData.holo = true;
    shell.scale.setScalar(1.04);
    shell.renderOrder = 5;
    o.add(shell);
    mats.push(m);
  }
  return mats;
}

// emitter: cone from the plinth ring up to the item, plus a halo ring around the item
export function holoProjector(color, radius, height) {
  const g = new THREE.Group();
  const coneMat = new THREE.ShaderMaterial({
    vertexShader: coneVert, fragmentShader: coneFrag,
    uniforms: { color: { value: new THREE.Color(color) }, time: shared.time, opacity: { value: 0.5 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const geo = new THREE.CylinderGeometry(radius * 1.25, radius * 0.55, height, 16, 1, true);
  geo.translate(0, height / 2, 0);
  const cone = new THREE.Mesh(geo, coneMat);
  cone.renderOrder = 4;
  g.add(cone);
  _dash ||= dashTexture();
  const haloMat = new THREE.MeshBasicMaterial({ map: _dash.clone(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.8 });
  haloMat.map.needsUpdate = true;
  haloMat.map.repeat.set(3, 1);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.3, radius * 1.3, 2.2, 32, 1, true), haloMat);
  halo.position.y = height;
  halo.renderOrder = 4;
  g.add(halo);
  g.userData = { coneMat, haloMat, halo };
  return g;
}
