// Uniforms shared by every custom material: dynamic lights, zone fog and the map's colour grade.
// All custom shaders work in display (gamma) space like a 2001 renderer: textures are sampled
// raw, light values may exceed 1 ("overbright") and the result is hard-clamped, never tone mapped.
import * as THREE from 'three';

export const dynLights = {
  pos: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e5, 0, 1)),
  col: Array.from({ length: 8 }, () => new THREE.Vector3()),
  count: { value: 0 },
};

export const shared = {
  dlPos: { value: dynLights.pos },
  dlCol: { value: dynLights.col },
  dlCount: dynLights.count,
  fogColor: { value: new THREE.Color(0.1, 0.1, 0.1) },
  fogDensity: { value: 0.0003 },
  gradeSat: { value: 0.6 },                       // environment saturation ration
  gradeTint: { value: new THREE.Color(1, 1, 1) },  // multiplied into environment albedo
  time: { value: 0 },
};

// GLSL: the shared "stage" tone shaper. Lets lit values ride up to ~2x before clipping to a flat
// glow, crushes the darkest midtones a little, and never applies a filmic curve.
export const toneGLSL = /* glsl */`
vec3 stageTone(vec3 c) {
  c = clamp(c, 0.0, 1.0);                         // hard overbright clip: brights go flat white
  return mix(c, c * c * (3.0 - 2.0 * c), 0.55);   // S-curve: crushed darks, punchy highs
}
vec3 applyFog(vec3 c, float dist, vec3 fogColor, float fogDensity) {
  float f = 1.0 - exp(-fogDensity * dist);
  return mix(c, fogColor, f);
}
`;
