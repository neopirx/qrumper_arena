// Material for dynamic entities (players, weapons, items): per-vertex lighting sampled from the
// baked light grid (ambient + one directed light, like Q3), a single Blinn-Phong lobe, dynamic
// lights, an optional rim in an accent colour, zone fog and the same overbright clamp as the world.
// "Cheap and slightly wrong-looking" on purpose (spec 2.1).
import * as THREE from 'three';
import { shared, toneGLSL } from './shared.js';

const vert = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
uniform vec3 uAmb;
uniform vec3 uDirCol;
uniform vec3 uDir;
uniform vec4 dlPos[8];
uniform vec3 dlCol[8];
uniform int dlCount;
uniform float uSpec;
uniform vec3 uRim;
uniform float uRimPow;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vSpec;
varying float vFogDist;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 N = normalize(mat3(modelMatrix) * objectNormal);
  vec3 V = normalize(cameraPosition - wp.xyz);
  float ndl = max(dot(N, uDir), 0.0);
  vec3 light = uAmb + uDirCol * ndl;
  vec3 H = normalize(uDir + V);
  vec3 spec = uDirCol * pow(max(dot(N, H), 0.0), 24.0) * uSpec * step(0.0001, ndl);
  for (int i = 0; i < 8; i++) {
    if (i >= dlCount) break;
    vec3 L = dlPos[i].xyz - wp.xyz;
    float d = length(L);
    float a = max(0.0, 1.0 - d / dlPos[i].w);
    light += dlCol[i] * a * a * (0.35 + 0.65 * max(dot(N, L / max(d, 0.001)), 0.0)) * 2.0;
  }
  float rim = pow(1.0 - max(dot(N, V), 0.0), uRimPow);
  vSpec = spec + uRim * rim;
  vLight = light;
  vUv = uv;
  vec4 mv = viewMatrix * wp;
  vFogDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */`
uniform sampler2D map;
uniform float hasMap;
uniform vec3 color;
uniform vec3 emissive;
uniform float opacity;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vSpec;
varying float vFogDist;
${toneGLSL}
void main() {
  vec3 alb = color;
  if (hasMap > 0.5) alb *= texture2D(map, vUv).rgb;
  vec3 c = stageTone(alb * vLight + vSpec) + emissive;
  gl_FragColor = vec4(applyFog(min(c, vec3(1.0)), vFogDist, fogColor, fogDensity), opacity);
}`;

// opts: { map, color, emissive, spec, rim, rimPow, side, transparent, opacity }
export function entityMaterial(opts = {}) {
  const map = opts.map || null;
  if (map) map.colorSpace = THREE.NoColorSpace; // sample raw: we shade in display space
  const m = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      dlPos: shared.dlPos, dlCol: shared.dlCol, dlCount: shared.dlCount,
      fogColor: shared.fogColor, fogDensity: shared.fogDensity,
      map: { value: map }, hasMap: { value: map ? 1 : 0 },
      color: { value: new THREE.Color(opts.color ?? 0xffffff) },
      emissive: { value: new THREE.Color(opts.emissive ?? 0x000000) },
      opacity: { value: opts.opacity ?? 1 },
      uAmb: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
      uDirCol: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
      uDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uSpec: { value: opts.spec ?? 0.15 },
      uRim: { value: new THREE.Color(opts.rim ?? 0x000000) },
      uRimPow: { value: opts.rimPow ?? 2.5 },
    },
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
  });
  m.userData.entity = true;
  m.userData.opts = opts;
  return m;
}

// Copy that keeps the shared (fog / dynamic light) uniforms shared.
export function cloneEntityMaterial(m) {
  const c = entityMaterial(m.userData.opts);
  c.uniforms.color.value.copy(m.uniforms.color.value);
  c.uniforms.emissive.value.copy(m.uniforms.emissive.value);
  c.uniforms.uRim.value.copy(m.uniforms.uRim.value);
  return c;
}

const _d = new THREE.Vector3();
// Light an entity material from a light grid sample: [r,g,b] or [r,g,b, dx,dy,dz].
export function lightEntityMaterial(m, s, boost = 1) {
  const u = m.uniforms;
  if (!u || !u.uAmb) return;
  const dl = s.length >= 6 ? Math.min(1, Math.hypot(s[3], s[4], s[5])) : 0;
  const mx = Math.max(s[0], s[1], s[2], 1e-3), cap = mx > 1.3 ? 1.3 / mx : 1;
  boost *= cap;
  // split the sample into a flat ambient and one directed light (Q3 lightgrid style),
  // keeping total brightness about equal to the sample
  const amb = (0.5 - 0.25 * dl) * boost, dir = (0.35 + 0.75 * dl) * boost;
  u.uAmb.value.set(s[0] * amb + 0.05, s[1] * amb + 0.05, s[2] * amb + 0.05);
  u.uDirCol.value.set(s[0] * dir, s[1] * dir, s[2] * dir);
  if (dl > 0.05) u.uDir.value.copy(_d.set(s[3], s[4], s[5]).normalize());
  else u.uDir.value.set(0.25, 0.9, 0.35).normalize();
}
