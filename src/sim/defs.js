// Weapon and item definitions (Quake 3 / CPMA FFA values).
export const WEAPONS = {
  mg: { id: 'mg', slot: 1, name: 'Machinegun', rate: 100, damage: 7, spread: 200, hitscan: true, maxAmmo: 200, startAmmo: 100, pickupAmmo: 50, color: 0xffe68a },
  sg: { id: 'sg', slot: 2, name: 'Shotgun', rate: 1000, damage: 10, pellets: 11, spread: 700, hitscan: true, maxAmmo: 50, pickupAmmo: 10, color: 0xff9a26, model: 'shotgun' },
  gl: { id: 'gl', slot: 3, name: 'Grenade Launcher', rate: 800, damage: 100, splash: 100, radius: 150, speed: 700, projectile: 'grenade', fuse: 2.5, maxAmmo: 50, pickupAmmo: 10, color: 0x5cff3a, model: 'nade_launcher' },
  rl: { id: 'rl', slot: 4, name: 'Rocket Launcher', rate: 800, damage: 100, splash: 100, radius: 120, speed: 1000, projectile: 'rocket', maxAmmo: 50, pickupAmmo: 10, color: 0xff4a1a, model: 'rocket_launcher' },
  rg: { id: 'rg', slot: 5, name: 'Railgun', rate: 1500, damage: 100, rail: true, maxAmmo: 50, pickupAmmo: 10, color: 0x30e8ff, model: 'railgun' },
};
export const WEAPON_ORDER = ['mg', 'sg', 'gl', 'rl', 'rg'];

export const ITEMS = {
  h5: { kind: 'health', amount: 5, max: 200, respawn: 35, name: '+5 Health', color: 0x40ff40 },
  h25: { kind: 'health', amount: 25, max: 100, respawn: 35, name: '+25 Health', color: 0xffd040 },
  h50: { kind: 'health', amount: 50, max: 100, respawn: 35, name: '+50 Health', color: 0xff9020 },
  mh: { kind: 'health', amount: 100, max: 200, respawn: 35, name: 'Mega Health', color: 0x4080ff },
  shard: { kind: 'armor', amount: 5, max: 200, respawn: 25, name: 'Armor Shard', color: 0x40ff40 },
  ya: { kind: 'armor', amount: 50, max: 200, respawn: 25, name: 'Yellow Armor', color: 0xffd020 },
  ra: { kind: 'armor', amount: 100, max: 200, respawn: 25, name: 'Red Armor', color: 0xff2020 },
  sg: { kind: 'weapon', weapon: 'sg', respawn: 5, name: 'Shotgun' },
  gl: { kind: 'weapon', weapon: 'gl', respawn: 5, name: 'Grenade Launcher' },
  rl: { kind: 'weapon', weapon: 'rl', respawn: 5, name: 'Rocket Launcher' },
  rg: { kind: 'weapon', weapon: 'rg', respawn: 5, name: 'Railgun' },
  am_mg: { kind: 'ammo', weapon: 'mg', amount: 50, respawn: 40, name: 'Bullets' },
  am_sg: { kind: 'ammo', weapon: 'sg', amount: 10, respawn: 40, name: 'Shells' },
  am_rl: { kind: 'ammo', weapon: 'rl', amount: 5, respawn: 40, name: 'Rockets' },
  am_gl: { kind: 'ammo', weapon: 'gl', amount: 5, respawn: 40, name: 'Grenades' },
  am_rg: { kind: 'ammo', weapon: 'rg', amount: 10, respawn: 40, name: 'Slugs' },
};

export const PLAYER_COLORS = [0x3d8bff, 0xff4040, 0x40d060, 0xffc020, 0xc050ff, 0x30e0e0, 0xff8030, 0xf0f0f0, 0xff60b0, 0x90a0b0];
export const BOT_NAMES = ['Vex', 'Mortis', 'Kestrel', 'Halcyon', 'Grimm', 'Sable', 'Rook', 'Nyx', 'Talon', 'Wraith', 'Cinder', 'Orrin'];

// Player models: file in assets/characters (Mixamo-rigged FBX) and the name shown in menus.
// Keys stay stable (they are stored in profiles); names are what players see.
export const CHARACTER_INFO = {
  capi: { file: 'capi', name: 'Cappi', blurb: 'Unbothered. Unhurried. Unkillable, allegedly.' },
  froggy: { file: 'froggy', name: 'Froggy', blurb: 'Lives for the air time between bunny hops.' },
  pig: { file: 'pig_solider', name: 'Piggor', blurb: 'Standard-issue helmet, non-standard appetite.' },
};
export const CHARACTERS = Object.keys(CHARACTER_INFO);
