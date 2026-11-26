// Crosshairs drawn as inline SVG (crisp at any size), and the per-weapon settings lookup:
// every weapon can override the gun placement and the crosshair, otherwise the global values apply.
import { GUN_KEYS, PER_GUN_KEYS } from './settings.js';

export const CROSSHAIRS = [
  ['cross', 'Cross'], ['crossgap', 'Gap cross'], ['dot', 'Dot'], ['circle', 'Circle'], ['ringdot', 'Ring + dot'],
  ['x', 'Diagonal'], ['brackets', 'Brackets'], ['chevron', 'Chevron'], ['tri', 'Tri-point'], ['scope', 'Rail scope'], ['none', 'None'],
];
export const XHAIR_KEYS = ['crosshair', 'crosshairColor', 'crosshairSize'];

// effective settings for one weapon: the weapon's overrides on top of the global ones
export function gunFor(s, id) {
  const o = s.perWeapon && s.perWeapon[id] && s.perWeapon[id].gun;
  return o ? { ...s, ...o } : s;
}
export function xhairFor(s, id) {
  const o = s.perWeapon && s.perWeapon[id] && s.perWeapon[id].xhair;
  const src = o ? { ...s, ...o } : s;
  return { style: src.crosshair, color: src.crosshairColor, size: src.crosshairSize };
}
export { GUN_KEYS, PER_GUN_KEYS };

// SVG markup on a 32x32 grid; strokes get a thin dark outline so they read on any wall
export function crosshairSVG(style, color) {
  const sw = 2.2;
  const line = (d, w = sw) => `<path d="${d}" stroke="#000" stroke-opacity="0.65" stroke-width="${w + 1.6}" fill="none" stroke-linecap="butt"/><path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="butt"/>`;
  const disc = (r) => `<circle cx="16" cy="16" r="${r + 0.8}" fill="#000" fill-opacity="0.65"/><circle cx="16" cy="16" r="${r}" fill="${color}"/>`;
  const ring = (r, w = 1.8) => `<circle cx="16" cy="16" r="${r}" stroke="#000" stroke-opacity="0.6" stroke-width="${w + 1.6}" fill="none"/><circle cx="16" cy="16" r="${r}" stroke="${color}" stroke-width="${w}" fill="none"/>`;
  let body = '';
  switch (style) {
    case 'cross': body = line('M16 2V12M16 20V30M2 16H12M20 16H30'); break;
    case 'crossgap': body = line('M16 4V11M16 21V28M4 16H11M21 16H28', 1.8) + disc(1.2); break;
    case 'dot': body = disc(2.4); break;
    case 'circle': body = ring(10) + disc(1.2); break;
    case 'ringdot': body = ring(6, 1.6) + disc(1.6); break;
    case 'x': body = line('M6 6L12 12M26 6L20 12M6 26L12 20M26 26L20 20'); break;
    case 'brackets': body = line('M8 6H5V26H8M24 6H27V26H24', 2) + disc(1.4); break;
    case 'chevron': body = line('M8 22L16 14L24 22', 2.2) + disc(1.2); break;
    case 'tri': body = line('M16 3V10M5 24L11 20M27 24L21 20', 2) + disc(1.3); break;
    case 'scope': body = ring(12, 1.4) + line('M16 1V9M16 23V31M1 16H9M23 16H31', 1.4) + disc(1); break;
    default: return '';
  }
  return `<svg viewBox="0 0 32 32" width="100%" height="100%" shape-rendering="geometricPrecision">${body}</svg>`;
}

// draw into an element: el gets the SVG and its size
export function applyCrosshair(el, x, sizePx = x.size) {
  el.innerHTML = crosshairSVG(x.style, x.color);
  el.style.setProperty('--z', sizePx + 'px');
  el.className = 'hud-xhair';
}
