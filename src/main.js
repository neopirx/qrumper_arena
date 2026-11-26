import * as THREE from 'three';
import { Assets } from './render/assets.js';
import { TextureBank } from './render/world.js';
import { setTextureFilter } from './render/textures.js';
import { Audio } from './client/audio.js';
import { Session } from './client/session.js';
import { loadSettings, saveSettings, DEFAULTS, GUN_KEYS, PER_GUN_KEYS, GRAPHICS_DEFAULTS, GRAPHICS_PRESETS } from './client/settings.js';
import { CROSSHAIRS, XHAIR_KEYS, xhairFor, crosshairSVG, applyCrosshair } from './client/crosshair.js';
import { Previews } from './client/previews.js';
import { CHARACTER_INFO, CHARACTERS } from './render/assets.js';
import { WEAPONS, WEAPON_ORDER, PLAYER_COLORS } from './sim/defs.js';
import { MAPS } from './maps/index.js';
import { ProfileStore } from './client/profile.js';
import { Connection } from './client/net.js';
import { BADGES, levelInfo } from './sim/xp.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.graphics.antialias !== false, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(3, Math.min(window.devicePixelRatio, 2) * (settings.graphics.renderScale || 1));
renderer.setPixelRatio(pixelRatio());
setTextureFilter(settings.graphics.texFilter, renderer);
renderer.outputColorSpace = THREE.SRGBColorSpace;
function resize() { renderer.setSize(window.innerWidth, window.innerHeight, false); }
window.addEventListener('resize', resize);
resize();

const audio = new Audio();
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.musicVolume);
const textures = new TextureBank(renderer);
const assets = new Assets();
let assetsReady = null;
let session = null;
let settingsReturn = 'p-main';
const profile = new ProfileStore();
const hex6 = (c) => '#' + (+c).toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, secs = 3.5) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), secs * 1000);
}

// ---------------- menu ----------------
let previews = null;   // created once the models are loaded
let panel = 'p-main', tab = 't-game';
function show(id) {
  panel = id;
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('hidden', p.id !== id);
  for (const b of $('mainnav').children) b.classList.toggle('sel', b.dataset.go === id || (id === 'p-lobby' && b.dataset.go === 'p-mp'));
  if (id === 'p-mp') mpEnter();
  if (id === 'p-main' || id === 'p-profile') syncHome();
  syncPreview();
}
const previewMode = () => (panel === 'p-profile' || panel === 'p-main') ? 'profile' : panel === 'p-settings' && tab === 't-weapon' ? 'weapon' : null;
// attach the shared preview renderer to whichever panel needs it
async function syncPreview() {
  const want = previewMode();
  if (!want || session) { if (previews) previews.detach(); return; }
  await assetsReady;
  if (!previews) {
    previews = new Previews(assets, settings);
    previews.zoom = menuZoom;
    // weapon buttons show the gun's own icon once the models are in
    for (const b of gunPick.children) if (assets.icons[b.dataset.w]) b.innerHTML = `<img src="${assets.icons[b.dataset.w]}" alt="${WEAPONS[b.dataset.w].name}">`;
  }
  if (previewMode() !== want || session) return;   // the player moved on while models were loading
  if (want === 'profile') previews.showProfile($(panel === 'p-main' ? 'home-stage' : 'profile-stage'));
  else { fitGunPreview(); previews.showWeapon($('gun-preview')); }
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  audio.init();
  if (b.dataset.go === 'p-settings') settingsReturn = session ? 'p-pause' : 'p-main';
  // in a room, "Multiplayer" means the lobby
  show(b.dataset.go === 'p-mp' && mp.room ? 'p-lobby' : b.dataset.go);
}));

const changed = () => { saveSettings(settings); if (session) { session.hud.xhWeapon = null; session.hud.applySettings(); session.me.autoSwitch = settings.autoSwitch; session.gore.enabled = settings.gore; } };

// ---- menu size: the menus are laid out for ~1100x800 CSS px; on big (or high-res, unscaled)
// screens they are zoomed to fit, or to the fixed size chosen in the settings
function menuZoom() {
  if (settings.menuScale >= 0.5) return settings.menuScale;
  return Math.max(1, Math.min(2.5, Math.min(window.innerWidth / 1150, window.innerHeight / 820)));
}
function applyMenuScale() {
  const z = menuZoom();
  $('menu-wrap').style.zoom = z;
  $('loading').querySelector('.load-inner').style.zoom = z;
  // the panel's height limit is in unzoomed px, so the zoomed panel still fits the window
  document.documentElement.style.setProperty('--menu-vh', (window.innerHeight / z) + 'px');
  document.documentElement.style.setProperty('--menu-vw', (window.innerWidth / z) + 'px');
  if (outputs.menuScale) outputs.menuScale();
}
window.addEventListener('resize', applyMenuScale);

const SKILLS = ['', 'Recruit', 'Regular', 'Veteran', 'Elite', 'Nightmare'];
const signed = (v, d = 2) => (+v > 0 ? '+' : '') + (+v).toFixed(d);
const fmt = {
  bots: (v) => v, skill: (v) => `${v} · ${SKILLS[v]}`, fraglimit: (v) => v, timelimit: (v) => (+v ? v + ' min' : 'none'),
  sensitivity: (v) => (+v).toFixed(1), fov: (v) => v + '°', volume: (v) => Math.round(v * 100) + '%', musicVolume: (v) => (+v ? Math.round(v * 100) + '%' : 'off'), crosshairSize: (v) => v + 'px',
  camMotion: (v) => (+v ? Math.round(v * 100) + '%' : 'off'), zoomFov: (v) => v + '°', zoomOther: (v) => (+v ? '−' + Math.round(v * 100) + '%' : 'off'), zoomSens: (v) => Math.round(v * 100) + '%',
  hudScale: (v) => Math.round(v * 100) + '%', menuScale: (v) => (+v < 0.5 ? 'auto · ' + Math.round(menuZoom() * 100) + '%' : Math.round(v * 100) + '%'),
  gunX: (v) => signed(v), gunY: (v) => signed(v), gunZ: (v) => signed(v), gunSize: (v) => Math.round(v * 100) + '%', gunTilt: (v) => signed(v, 1) + '°',
};
const outputs = {};
// the weapon picked in the Weapons tab; placement / crosshair edits go to its overrides when
// "custom for this weapon" is ticked, else to the shared values
let selGun = 'mg';
const GUN_SCOPED = new Set(PER_GUN_KEYS), XH_SCOPED = new Set(XHAIR_KEYS);
const pw = (id) => (settings.perWeapon[id] ||= {});
function target(key) {
  const o = settings.perWeapon[selGun];
  if (GUN_SCOPED.has(key) && o && o.gun) return o.gun;
  if (XH_SCOPED.has(key) && o && o.xhair) return o.xhair;
  return settings;
}
for (const id of Object.keys(fmt)) {
  const el = $(id);
  const out = $(id + '-v');
  outputs[id] = () => { el.value = target(id)[id]; out.textContent = fmt[id](el.value); };
  el.addEventListener('input', () => {
    target(id)[id] = +el.value;
    out.textContent = fmt[id](el.value);
    if (id === 'volume') audio.setVolume(settings.volume);
    if (id === 'musicVolume') { audio.setMusicVolume(settings.musicVolume); if (!session) audio.playMusic('menu'); }
    if (id === 'menuScale') applyMenuScale();
    if (id === 'crosshairSize') previewCrosshair();
    changed();
  });
}
for (const id of Object.keys(outputs)) outputs[id]();
applyMenuScale();
const CHECKS = ['invertMouse', 'speedometer', 'walljumpOnJump', 'autoSwitch', 'gunVisible', 'bob', 'hitSounds', 'showFps', 'weaponBarAlways', 'gore', 'announcer', 'zoomToggle', 'doubleJump'];
const syncChecks = () => { for (const id of CHECKS) $(id).checked = !!target(id)[id]; };
for (const id of CHECKS) {
  const el = $(id);
  el.addEventListener('change', () => { target(id)[id] = el.checked; changed(); });
}
syncChecks();
// crosshair picker: one button per style, drawn with the real crosshair
const xhGrid = $('xh-grid');
for (const [key, label] of CROSSHAIRS) {
  const b = document.createElement('button');
  b.dataset.v = key; b.title = label;
  b.addEventListener('click', () => { target('crosshair').crosshair = key; changed(); syncXhair(); });
  xhGrid.appendChild(b);
}
function syncXhair() {
  const x = xhairFor(settings, selGun);
  for (const b of xhGrid.children) {
    b.classList.toggle('sel', b.dataset.v === x.style);
    b.innerHTML = b.dataset.v === 'none' ? '<span>none</span>' : crosshairSVG(b.dataset.v, x.color);
  }
  $('crosshairColor').value = x.color;
  previewCrosshair();
}
$('crosshairColor').addEventListener('input', () => { target('crosshairColor').crosshairColor = $('crosshairColor').value; changed(); syncXhair(); });
// per-weapon scope toggles: ticking copies the current shared values as the weapon's starting point
$('gunCustom').addEventListener('change', () => {
  if ($('gunCustom').checked) { const g = {}; for (const k of PER_GUN_KEYS) g[k] = settings[k]; pw(selGun).gun = g; } else delete pw(selGun).gun;
  changed(); syncScope();
});
$('xhCustom').addEventListener('change', () => {
  if ($('xhCustom').checked) { const g = {}; for (const k of XHAIR_KEYS) g[k] = settings[k]; pw(selGun).xhair = g; } else delete pw(selGun).xhair;
  changed(); syncScope();
});
function syncScope() {
  const o = settings.perWeapon[selGun] || {}, name = WEAPONS[selGun].name;
  for (const el of document.querySelectorAll('.wname')) el.textContent = name;
  $('gunCustom').checked = !!o.gun; $('xhCustom').checked = !!o.xhair;
  $('gunScopeNote').textContent = o.gun ? `Only the ${name} uses this placement` : 'Editing the placement shared by all weapons';
  $('xhScopeNote').textContent = o.xhair ? `Only the ${name} uses this crosshair` : 'Editing the crosshair shared by all weapons';
  for (const k of [...PER_GUN_KEYS, ...XHAIR_KEYS]) if (outputs[k]) outputs[k]();
  syncChecks(); syncHand(); syncXhair();
  for (const b of gunPick.children) b.classList.toggle('custom', !!(settings.perWeapon[b.dataset.w]?.gun || settings.perWeapon[b.dataset.w]?.xhair));
}
$('settings-back').addEventListener('click', () => show(settingsReturn));

// ---- graphics: a preset fills every option; touching an option makes the preset "custom"
const G = settings.graphics;
const GFX_FMT = { renderScale: (v) => Math.round(v * 100) + '%', shake: (v) => Math.round(v * 100) + '%' };
const GFX_SELECT = ['texFilter', 'particles'], GFX_CHECK = ['bloom', 'dynLights', 'holo', 'decals', 'sky', 'antialias'];
const startAA = G.antialias;
function applyGraphics() {
  renderer.setPixelRatio(pixelRatio());
  resize();
  setTextureFilter(G.texFilter);
  if (session) session.applyGraphics();
  $('gfx-note').textContent = G.antialias !== startAA ? 'Anti-aliasing changes take effect after reloading the page.' : 'Holographic items and effect detail apply from the next match; the rest applies right away.';
}
function syncGraphics() {
  for (const b of $('gfxPreset').children) b.classList.toggle('sel', b.dataset.v === G.preset);
  for (const k of Object.keys(GFX_FMT)) { $('gfx-' + k).value = G[k]; $('gfx-' + k + '-v').textContent = GFX_FMT[k](G[k]); }
  for (const k of GFX_SELECT) $('gfx-' + k).value = G[k];
  for (const k of GFX_CHECK) $('gfx-' + k).checked = !!G[k];
}
const gfxChanged = () => { G.preset = 'custom'; syncGraphics(); applyGraphics(); saveSettings(settings); };
for (const k of Object.keys(GFX_FMT)) $('gfx-' + k).addEventListener('input', (e) => { G[k] = +e.target.value; gfxChanged(); });
for (const k of GFX_SELECT) $('gfx-' + k).addEventListener('change', (e) => { G[k] = e.target.value; gfxChanged(); });
for (const k of GFX_CHECK) $('gfx-' + k).addEventListener('change', (e) => { G[k] = e.target.checked; gfxChanged(); });
$('gfxPreset').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  G.preset = b.dataset.v;
  if (GRAPHICS_PRESETS[G.preset]) Object.assign(G, GRAPHICS_PRESETS[G.preset]);
  syncGraphics(); applyGraphics(); saveSettings(settings);
});
syncGraphics();

// settings tabs
const tabs = $('settings-tabs');
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.tab;
  for (const x of tabs.children) x.classList.toggle('sel', x === b);
  for (const t of document.querySelectorAll('#p-settings .tab')) t.classList.toggle('hidden', t.id !== tab);
  if (tab === 't-weapon') requestAnimationFrame(previewCrosshair);
  syncPreview();
});

// ---- weapon placement: live preview ----
const gunPick = $('gun-pick');
for (const id of WEAPON_ORDER) {
  const b = document.createElement('button');
  b.textContent = id.toUpperCase();
  b.title = WEAPONS[id].name;
  b.dataset.w = id;
  b.style.setProperty('--wc', '#' + WEAPONS[id].color.toString(16).padStart(6, '0'));
  b.classList.toggle('sel', id === 'mg');
  b.addEventListener('click', () => {
    selGun = id;
    for (const x of gunPick.children) x.classList.toggle('sel', x === b);
    if (previews) previews.setGun(id);
    syncScope();
  });
  gunPick.appendChild(b);
}
const hand = $('gunHand');
function syncHand() { for (const b of hand.children) b.classList.toggle('sel', b.dataset.v === target('gunHand').gunHand); }
hand.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; target('gunHand').gunHand = b.dataset.v; syncHand(); changed(); });
$('gun-reset').addEventListener('click', () => {
  const t = target('gunX');
  for (const k of GUN_KEYS) t[k] = t === settings ? DEFAULTS[k] : settings[k];
  syncScope(); changed();
});
// the preview has the screen's aspect ratio and a shot of the selected map behind it
function fitGunPreview() {
  const el = $('gun-preview');
  el.style.aspectRatio = `${window.innerWidth} / ${window.innerHeight}`;
  el.style.backgroundImage = `url('/thumbs/${settings.map}.jpg')`;
  previewCrosshair();
}
function previewCrosshair() {
  const x = xhairFor(settings, selGun), w = $('gun-preview').clientWidth || 600;
  applyCrosshair($('preview-xhair'), x, Math.max(6, x.size * w / window.innerWidth));
}
window.addEventListener('resize', () => { if (tab === 't-weapon') fitGunPreview(); });
syncScope();

// ---- profile (name / fighter / colour live in the profile store, mirrored in settings) ----
$('name').value = settings.name;
let saveT = 0;
const saveProfile = () => { clearTimeout(saveT); saveT = setTimeout(() => profile.save({ name: settings.name, character: settings.character, color: settings.color }), 500); };
$('name').addEventListener('input', () => { settings.name = $('name').value.trim() || 'Player'; saveSettings(settings); updateWho(); if (!$('menu').classList.contains('setup')) saveProfile(); });
const charsEl = $('chars');
for (const [key, c] of Object.entries(CHARACTER_INFO)) {
  const b = document.createElement('button');
  b.className = 'char';
  b.dataset.c = key;
  b.innerHTML = `<b>${c.name}</b><span>${c.blurb}</span>`;
  b.addEventListener('click', () => { settings.character = key; saveSettings(settings); syncProfile(); if (!$('menu').classList.contains('setup')) saveProfile(); });
  charsEl.appendChild(b);
}
const swatches = $('swatches');
for (const c of PLAYER_COLORS) {
  const b = document.createElement('button');
  b.style.background = '#' + c.toString(16).padStart(6, '0');
  b.dataset.c = c;
  b.title = 'Player colour';
  b.addEventListener('click', () => { settings.color = c; saveSettings(settings); syncProfile(); if (!$('menu').classList.contains('setup')) saveProfile(); });
  swatches.appendChild(b);
}
function updateWho() {
  const who = $('profile-who');
  who.textContent = settings.name;
  who.style.color = '#' + settings.color.toString(16).padStart(6, '0');
}
function syncProfile() {
  if (!CHARACTER_INFO[settings.character]) settings.character = CHARACTERS[0];
  for (const b of charsEl.children) b.classList.toggle('sel', b.dataset.c === settings.character);
  for (const b of swatches.children) b.classList.toggle('sel', +b.dataset.c === settings.color);
  updateWho();
  syncHome();
  if (previews) previews.updateProfile();
}
syncProfile();

// top bar chip, home stats, fighter name behind the showcase, career box
function syncHome() {
  const d = profile.data || {};
  const L = levelInfo(d.xp || 0);
  $('chip-lv').textContent = L.level;
  $('chip-name').textContent = settings.name;
  $('chip-sub').textContent = `Level ${L.level} · ${L.into} / ${L.need} XP`;
  $('chip-xp').style.width = Math.round(L.frac * 100) + '%';
  const info = CHARACTER_INFO[settings.character] || CHARACTER_INFO[CHARACTERS[0]];
  $('champ-name').textContent = info.name;
  $('champ-name').style.setProperty('--n', info.name.length);   // font sized so the name fits the stage
  $('champ-blurb').textContent = info.blurb;
  const kd = d.deaths ? (d.kills / d.deaths).toFixed(2) : (d.kills || 0).toFixed(2);
  $('home-stats').innerHTML = [['Level', L.level], ['Kills', d.kills || 0], ['Wins', d.wins || 0], ['K/D', kd]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const badges = Object.entries(d.badges || {}).filter(([k, n]) => n && BADGES[k]?.icon).map(([k, n]) => `<span class="rb" title="${BADGES[k].name}: ${n}"><img src="/icons/badges/${BADGES[k].icon}.png" alt=""><i>${n}</i></span>`).join('');
  $('career').innerHTML = `<div><b>${L.level}</b><span>Level</span></div><div><b>${d.xp || 0}</b><span>Total XP</span></div><div><b>${d.matches || 0}</b><span>Matches</span></div>
    <div><b>${d.kills || 0}</b><span>Kills</span></div><div><b>${d.deaths || 0}</b><span>Deaths</span></div><div><b>${d.wins || 0}</b><span>Wins</span></div>
    ${badges ? `<div class="badges">${badges}</div>` : ''}`;
}
profile.onChange((d) => {
  if (d.name && d.name !== settings.name && document.activeElement !== $('name')) { settings.name = d.name; $('name').value = d.name; }
  if (d.character && CHARACTER_INFO[d.character]) settings.character = d.character;
  if (d.color != null) settings.color = d.color;
  saveSettings(settings);
  syncProfile();
});
$('setup-done').addEventListener('click', async () => {
  const n = $('name').value.trim();
  if (!n) { $('name').focus(); toast('Pick a name first'); return; }
  settings.name = n; saveSettings(settings);
  await profile.save({ name: settings.name, character: settings.character, color: settings.color });
  $('menu').classList.remove('setup');
  $('profile-title').textContent = 'Fighter';
  show('p-main');
});
// background: a blurred shot of the selected map
const syncBg = () => { $('bg-map').style.backgroundImage = `url('/thumbs/${settings.map}.jpg')`; };
syncBg();

// map cards
const mapsEl = $('maps');
for (const [key, m] of Object.entries(MAPS)) {
  const card = document.createElement('button');
  card.className = 'map-card' + (settings.map === key ? ' sel' : '');
  card.dataset.map = key;
  card.innerHTML = `<div class="map-thumb ${key}"></div><b>${m.def.name}</b><span>${m.tagline}</span><small>${m.players}</small>`;
  card.addEventListener('click', () => {
    settings.map = key; saveSettings(settings); fitGunPreview(); syncBg();
    for (const c of mapsEl.children) c.classList.toggle('sel', c.dataset.map === key);
  });
  mapsEl.appendChild(card);
}

$('start').addEventListener('click', () => startMatch());
$('resume').addEventListener('click', () => { $('menu').classList.add('hidden'); session.resume(); });
$('pause-settings').addEventListener('click', () => { settingsReturn = 'p-pause'; show('p-settings'); });
$('restart').addEventListener('click', () => startMatch());
$('quit').addEventListener('click', () => {
  if (session && session.net) { mp.conn.send({ t: 'leave' }); mp.room = null; endSession(); show('p-mp'); }
  else { endSession(); show('p-main'); }
  audio.playMusic('menu');
});

document.addEventListener('keydown', (e) => {
  if (!session || session.net) return;
  if (e.code === 'Enter' && session.game.state === 'intermission' && !session.paused) startMatch();
});

function endSession() {
  if (session) { session.dispose(); session = null; }
  document.body.classList.remove('ingame');
  $('menu').classList.remove('hidden', 'online');
  $('loading').classList.add('hidden');
}

// one loader for both kinds of match. net: { conn, start } from the server
async function startMatch(net = null) {
  audio.init();
  audio.stopMusic(1.5);
  endSession();
  $('menu').classList.add('hidden');
  $('menu').classList.toggle('online', !!net);
  if (previews) previews.detach();
  $('loading').classList.remove('hidden');
  const mapKey = net ? net.start.map : settings.map;
  const def = MAPS[mapKey].def;
  $('load-map').innerHTML = `<b>${def.name}</b><span>${def.description}</span>`;
  const prog = (p, msg) => { $('load-bar').style.width = Math.round(p * 100) + '%'; $('load-msg').textContent = msg; };
  const token = (startMatch.token = (startMatch.token || 0) + 1);
  try {
    if (!assetsReady) assetsReady = assets.load((p) => prog(p * 0.1, 'Loading models'));
    await assetsReady;
    const r = net ? net.start.rules : settings;
    const s = new Session({
      renderer, assets, audio, textures, settings, net,
      hudRoot: $('hud'),
      opts: { map: mapKey, bots: r.bots, skill: r.skill, fraglimit: r.fraglimit, timelimit: r.timelimit, doubleJump: !!r.doubleJump, level: profile.level.level },
      onPause: () => { show('p-pause'); $('menu').classList.remove('hidden'); },
      onMatchEnd: (mine) => profile.reportMatch(mine),
    });
    s.onProfile = (p) => profile.setFromServer(p);
    await s.load(prog);
    if (token !== startMatch.token) { s.dispose(); return; }   // left / restarted while loading
    session = s;
    window.__session = s; // debugging hook
    $('loading').classList.add('hidden');
    document.body.classList.add('ingame');
    s.start();
  } catch (err) {
    console.error(err);
    $('load-msg').textContent = 'Failed to load: ' + err.message;
  }
}

// ---------------- multiplayer: room browser, lobby ----------------
const mp = { conn: null, room: null, cid: null, rooms: [] };
const SKILL_SHORT = ['', 'Recruit', 'Regular', 'Veteran', 'Elite', 'Nightmare'];
function mpStatus(text, cls = '') { const el = $('mp-status'); el.textContent = text; el.className = 'mp-status ' + cls; }
async function mpEnter() {
  if (mp.conn && mp.conn.open) { mp.conn.send({ t: 'list' }); return; }
  mpStatus('Connecting to the game server…');
  renderRooms();
  const conn = new Connection();
  mp.conn = conn;
  conn.on('welcome', (m) => { mp.cid = m.cid; mp.rooms = m.rooms; mpStatus('Connected', 'ok'); renderRooms(); });
  conn.on('rooms', (m) => { mp.rooms = m.rooms; renderRooms(); });
  conn.on('room', (m) => onRoom(m));
  conn.on('chat', (m) => { if (mp.room) { mp.room.chat.push(m.line); renderChat(); } });
  conn.on('error', (m) => toast(m.msg));
  // the roster can change while the map loads (late joiners): the session reads the latest one
  conn.on('start', (m) => { mp.roster = m.roster; startMatch({ conn, start: m, roster: () => mp.roster }); });
  conn.on('roster', (m) => { mp.roster = m.players; });
  conn.on('ping', (m) => conn.send({ t: 'pong', s: m.s }));
  conn.on('close', () => {
    mp.conn = null;
    const wasIn = !!mp.room;
    mp.room = null;
    mpStatus('Disconnected from the game server', 'bad');
    if (session && session.net) { endSession(); audio.playMusic('menu'); show('p-mp'); toast('Connection to the server was lost'); }
    else if (wasIn || panel === 'p-lobby') { show('p-mp'); toast('Connection to the server was lost'); }
  });
  try {
    await conn.connect();
    conn.send({ t: 'hello', profileId: profile.id, name: settings.name, character: settings.character, color: settings.color });
  } catch (e) {
    mp.conn = null;
    mpStatus('Could not reach the game server. Multiplayer needs the game to be served by `npm run dev`, `npm run preview` or `npm start`.', 'bad');
  }
}
function renderRooms() {
  const el = $('rooms');
  if (!mp.rooms.length) { el.innerHTML = `<div class="empty">${mp.conn && mp.conn.open ? 'No rooms yet. Create one and invite your friends.' : '—'}</div>`; return; }
  el.innerHTML = mp.rooms.map((r) => `<div class="room"><div class="thumb" style="background-image:url('/thumbs/${r.map}.jpg')"></div>
    <div><b>${esc(r.name)}</b><small>${esc(MAPS[r.map]?.def.name || r.map)} · host ${esc(r.owner)}</small></div>
    <div><span class="st ${r.state}">${r.state === 'lobby' ? 'in lobby' : 'in match'}</span> <span class="cnt">${r.players}/${r.max}</span></div>
    <button class="btn small primary" data-join="${esc(r.id)}" ${r.players >= r.max ? 'disabled' : ''}>Join</button></div>`).join('');
}
$('rooms').addEventListener('click', (e) => { const b = e.target.closest('[data-join]'); if (b && mp.conn) mp.conn.send({ t: 'join', id: b.dataset.join }); });
$('rooms-refresh').addEventListener('click', () => mpEnter());
$('room-create').addEventListener('click', () => { if (!mp.conn || !mp.conn.open) return mpEnter(); mp.conn.send({ t: 'create', name: $('room-name').value || `${settings.name}'s room` }); });
$('room-name').addEventListener('keydown', (e) => { if (e.code === 'Enter') $('room-create').click(); });

// lobby: rules are edited by the owner and pushed to everyone
const LR = { fraglimit: (v) => v, timelimit: (v) => (+v ? v + ' min' : 'none'), bots: (v) => v, skill: (v) => SKILL_SHORT[v], maxPlayers: (v) => v };
for (const k of Object.keys(LR)) {
  const el = $('lr-' + k);
  el.addEventListener('input', () => { $('lr-' + k + '-v').textContent = LR[k](el.value); });
  el.addEventListener('change', () => sendRules({ [k]: +el.value }));
}
$('lr-doubleJump').addEventListener('change', () => sendRules({ doubleJump: $('lr-doubleJump').checked }));
for (const [key, m] of Object.entries(MAPS)) {
  const card = document.createElement('button');
  card.className = 'map-card';
  card.dataset.map = key;
  card.innerHTML = `<div class="map-thumb ${key}"></div><b>${m.def.name}</b><span>${m.tagline}</span><small>${m.players}</small>`;
  card.addEventListener('click', () => sendRules({ map: key }));
  $('lobby-maps').appendChild(card);
}
function sendRules(change) { if (mp.room && mp.room.owner === mp.cid) mp.conn.send({ t: 'rules', rules: { ...mp.room.rules, ...change } }); }
function onRoom(m) {
  const first = !mp.room;
  mp.room = m;
  renderLobby();
  // the match ended and the room is back in its lobby: leave the game for the lobby
  if (m.state === 'lobby' && session && session.net) { endSession(); audio.playMusic('menu'); show('p-lobby'); return; }
  if (first || (!session && panel !== 'p-lobby' && panel !== 'p-settings')) show('p-lobby');
}
function renderLobby() {
  const r = mp.room;
  if (!r) return;
  const own = r.owner === mp.cid;
  $('lobby-name').textContent = r.name;
  $('lobby-state').textContent = r.state === 'lobby' ? 'Lobby' : r.state === 'loading' ? 'Loading match' : 'Match in progress';
  $('lobby-members').innerHTML = r.members.map((p) => `<li style="--pc:${hex6(p.color)}"><span class="lv">${p.level}</span>
    <span><b>${esc(p.name)}</b><br><small>${esc(CHARACTER_INFO[p.character]?.name || '')}${p.inGame ? ' · in match' : ''}</small></span>${p.cid === r.owner ? '<span class="own">Host</span>' : ''}</li>`).join('');
  for (const k of Object.keys(LR)) { const el = $('lr-' + k); el.value = r.rules[k]; el.disabled = !own || r.state !== 'lobby'; $('lr-' + k + '-v').textContent = LR[k](r.rules[k]); }
  $('lr-doubleJump').checked = !!r.rules.doubleJump; $('lr-doubleJump').disabled = !own || r.state !== 'lobby';
  for (const c of $('lobby-maps').children) { c.classList.toggle('sel', c.dataset.map === r.rules.map); c.disabled = !own || r.state !== 'lobby'; }
  $('lobby-rules').classList.toggle('locked', !own);
  $('lobby-note').textContent = own ? 'You are the host: set the rules, then start the match for everyone in the room.' : 'Only the host can change the rules and start the match.';
  const start = $('lobby-start');
  start.textContent = r.state === 'lobby' ? 'Start match' : 'Join match';
  start.disabled = r.state === 'lobby' ? !own : true;
  start.classList.toggle('hidden', !own && r.state === 'lobby');
  renderChat();
}
function renderChat() {
  const log = $('chat-log');
  log.innerHTML = (mp.room?.chat || []).map((l) => l.from ? `<div><b style="color:${hex6(l.color)}">${esc(l.from)}</b>${esc(l.text)}</div>` : `<div class="sys">${esc(l.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}
$('chat-in').addEventListener('keydown', (e) => {
  if (e.code !== 'Enter') return;
  const t = $('chat-in').value.trim();
  if (t && mp.conn) mp.conn.send({ t: 'chat', text: t });
  $('chat-in').value = '';
});
$('lobby-start').addEventListener('click', () => { if (mp.room && mp.room.state === 'lobby') mp.conn.send({ t: 'start' }); });
$('lobby-leave').addEventListener('click', () => { if (mp.conn) mp.conn.send({ t: 'leave' }); mp.room = null; show('p-mp'); });

// ---------------- boot ----------------
// start loading models in the background while the player browses the menu
assetsReady = assets.load(() => {});
const autostart = new URLSearchParams(location.search).get('autostart');
profile.init().then(() => {
  // first visit: create a fighter before anything else
  if (!profile.exists && !autostart) {
    $('menu').classList.add('setup');
    $('profile-title').textContent = 'Create your fighter';
    if (settings.name === 'Player') $('name').value = '';
    show('p-profile');
    setTimeout(() => $('name').focus(), 50);
  }
  syncHome();
});
show('p-main');
if (!autostart) audio.playMusic('menu');

// dev hook: ?autostart=<map>&bots=N&skill=N
const qs = new URLSearchParams(location.search);
if (qs.get('autostart')) {
  settings.map = qs.get('autostart');
  if (qs.get('bots')) settings.bots = +qs.get('bots');
  if (qs.get('skill')) settings.skill = +qs.get('skill');
  startMatch();
}
