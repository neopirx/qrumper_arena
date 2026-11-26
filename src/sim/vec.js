// Minimal vec3 helpers operating on plain arrays [x, y, z].
// World is Y-up, measured in Quake units (player is 56 units tall).
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const copy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
export const clone = (a) => [a[0], a[1], a[2]];
export const set = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
export const add = (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
export const sub = (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
export const scale = (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
export const ma = (o, a, s, b) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const len2 = (a) => Math.sqrt(a[0] * a[0] + a[2] * a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const cross = (o, a, b) => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
};
export const normalize = (o, a) => {
  const l = len(a);
  if (l > 0) { o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; } else { o[0] = o[1] = o[2] = 0; }
  return l;
};
export const lerp = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };

export const DEG = Math.PI / 180;

// View conventions (match three.js camera): yaw 0 looks toward -Z, positive yaw turns left,
// positive pitch looks up. Angles in degrees.
export function angleVectors(pitchDeg, yawDeg, fwd, right, up) {
  const p = pitchDeg * DEG, y = yawDeg * DEG;
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  if (fwd) set(fwd, -sy * cp, sp, -cy * cp);
  if (right) set(right, cy, 0, -sy);
  if (up) set(up, sy * sp, cp, cy * sp);
}

export function yawTo(dx, dz) { return Math.atan2(-dx, -dz) / DEG; }
export function angleDiff(a, b) { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

// Deterministic-ish RNG so sims can be reproduced later (netcode).
export function makeRng(seed = 1234567) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.crandom = () => 2 * r() - 1;
  return r;
}
