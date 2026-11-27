const KEY = 'qrumper.settings.v1';
export const DEFAULTS = {
  // profile
  name: 'Player',
  character: 'capi',     // key of CHARACTER_INFO in render/assets.js
  color: 0x3d8bff,       // one of PLAYER_COLORS
  // controls
  sensitivity: 3,
  invertMouse: false,
  walljumpOnJump: true,
  autoSwitch: true,
  zoomFov: 40,           // railgun zoom: horizontal FOV (4:3) while right mouse is held
  zoomOther: 0.15,       // other weapons zoom in by this fraction of the FOV
  zoomSens: 1,           // mouse speed while zoomed, relative to matching the zoom (1 = same feel)
  zoomToggle: false,     // right mouse toggles zoom instead of holding it
  camMotion: 1,          // camera motion on jump / land / shots / hits (0 = off)
  viewBob: true,         // head bob while walking (part of camera motion)
  speedFov: true,        // the view widens slightly at bunnyhop speeds
  // view
  fov: 100,              // Quake-style horizontal FOV at 4:3
  volume: 0.7,
  musicVolume: 0.45,     // menu music, 0 = off
  crosshair: 'cross',    // see CROSSHAIRS in client/crosshair.js
  crosshairColor: '#7dff6a',
  crosshairSize: 24,
  // weapon placement (cg_gun* style, added on top of each model's base placement)
  gunVisible: true,
  bob: true,
  gunHand: 'right',      // right | left | center
  gunX: 3.75,            // + moves right on screen
  gunY: -5,              // + moves up
  gunZ: -12.5,           // - pulls the gun toward the camera, + pushes it away
  gunSize: 0.88,
  gunTilt: 0,            // degrees, + turns the muzzle in toward the crosshair
  // per-weapon overrides: { mg: { gun: { gunX, ... , gunVisible }, xhair: { crosshair, crosshairColor, crosshairSize } } }
  perWeapon: {},         // filled from DEFAULT_GUNS on first load
  viewmodelV: 2,
  // HUD
  hudScale: 1,
  speedometer: true,
  weaponBarAlways: false,
  dmgNumbers: true,      // damage you deal pops up by the crosshair
  showFps: false,
  hitSounds: true,
  gore: true,            // blood, gibs and blood decals
  announcer: true,       // announcer voice (countdown, awards)
  menuScale: 0,          // 0 = fit to the screen, else a fixed zoom for menus and settings
  // match
  bots: 5,
  doubleJump: false,     // CPM double jump in practice matches
  mode: 'ffa',           // practice mode: ffa | duel (one bot)
  instagib: false,       // railgun only, one hit kills, no pickups
  roomName: '',
  skill: 3,
  map: 'bastion',
  fraglimit: 20,
  timelimit: 10,
};
export const GUN_KEYS = ['gunHand', 'gunX', 'gunY', 'gunZ', 'gunSize', 'gunTilt'];
export const PER_GUN_KEYS = [...GUN_KEYS, 'gunVisible'];
// the default viewmodel: the shared placement above, plus these weapons sitting on their own
const gun = (gunX, gunY, gunZ, gunSize) => ({ gunHand: 'right', gunX, gunY, gunZ, gunSize, gunTilt: 0, gunVisible: true });
export const DEFAULT_GUNS = {
  sg: gun(3.75, -5, -22, 1.04),
  rl: gun(3.75, -4, -22, 0.9),
  rg: gun(3.75, -5, -12.25, 0.94),
};
const OLD_GUN = { gunHand: 'right', gunX: 0, gunY: 0, gunZ: 0, gunSize: 1, gunTilt: 0 };
// graphics: `preset` picks all the others; touching one switches the preset to 'custom'
export const GRAPHICS_DEFAULTS = {
  preset: 'high',
  renderScale: 1,        // resolution scale (x device pixel ratio, capped at 2)
  antialias: true,       // MSAA (needs a renderer restart: applied on reload)
  texFilter: 'aniso',    // aniso | trilinear | nearest (crunchy, software-Quake look)
  particles: 'high',     // low | medium | high: particle counts and secondary effects
  dynLights: true,       // muzzle / rocket / explosion lights
  bloom: true,           // soft glow around fullbright lights and effects
  holo: true,            // holographic item shader (scanlines, fresnel, projector beam)
  shake: 1,              // explosion camera shake
  decals: true,          // scorch marks and bullet holes
  sky: true,             // animated sky layers and drifting dust
  lighting: 'baked',     // baked (lightmaps only) | dynamic (real-time sun shadows, per-pixel lamps, flicker)
};
export const GRAPHICS_PRESETS = {
  low: { renderScale: 0.75, antialias: false, texFilter: 'trilinear', particles: 'low', dynLights: false, bloom: false, holo: false, decals: false, sky: false },
  medium: { renderScale: 1, antialias: true, texFilter: 'trilinear', particles: 'medium', dynLights: true, bloom: false, holo: true, decals: true, sky: true },
  high: { renderScale: 1, antialias: true, texFilter: 'aniso', particles: 'high', dynLights: true, bloom: true, holo: true, decals: true, sky: true },
  ultra: { renderScale: 1.5, antialias: true, texFilter: 'aniso', particles: 'high', dynLights: true, bloom: true, holo: true, decals: true, sky: true },
};
export function loadSettings() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { stored = {}; }
  const s = { ...DEFAULTS, ...stored };
  s.perWeapon = JSON.parse(JSON.stringify(s.perWeapon || {}));
  // settings saved before the current default viewmodel: anyone who never moved the gun gets the
  // new placement; a gun someone positioned themselves is left alone
  if (stored.viewmodelV !== DEFAULTS.viewmodelV) {
    const untouched = GUN_KEYS.every((k) => stored[k] === undefined || stored[k] === OLD_GUN[k]) && !Object.values(s.perWeapon).some((o) => o && o.gun);
    if (untouched) {
      for (const k of GUN_KEYS) s[k] = DEFAULTS[k];
      for (const [id, g] of Object.entries(DEFAULT_GUNS)) (s.perWeapon[id] ||= {}).gun = { ...g };
    }
    s.viewmodelV = DEFAULTS.viewmodelV;
  }
  s.graphics = { ...GRAPHICS_DEFAULTS, ...(s.graphics || {}) };
  if (!['cross', 'crossgap', 'dot', 'circle', 'ringdot', 'x', 'brackets', 'chevron', 'tri', 'scope', 'none'].includes(s.crosshair)) s.crosshair = 'cross';
  return s;
}
export function saveSettings(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
