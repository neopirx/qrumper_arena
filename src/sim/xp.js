// Experience and levels. Pure data + math so the server, the offline game and the menus agree.
// XP is earned per frag, per badge (multi kills, precision, ...) and for finishing a match.

export const XP = {
  kill: 100,
  match: 250,          // finishing a match (still connected at intermission)
  place: [500, 250, 125],   // 1st / 2nd / 3rd place bonus
  awards: {
    double: 50, triple: 100, quad: 175, monster: 300,
    precision: 75, headshot: 75, bounced: 75, gib: 50, telefrag: 100, revenge: 50,
    midair: 75, void: 75, lava: 75, slime: 75, firstblood: 50, shutdown: 100, comeback: 50, pointblank: 50,
  },
};

// Badges shown on frags. `icon` is a file in assets/icons/badges (null = text only).
export const BADGES = {
  kill: { name: 'Kill', icon: 'kill' },
  double: { name: 'Double Kill', icon: 'double' },
  triple: { name: 'Triple Kill', icon: 'triple' },
  quad: { name: 'Quad Kill', icon: 'quad' },
  monster: { name: 'Monster Kill', icon: 'monster' },
  precision: { name: 'Precision', icon: 'precision' },
  telefrag: { name: 'Telefrag', icon: 'telefrag' },
  bounced: { name: 'Bounced', icon: 'bounced' },
  gib: { name: 'Gibbed', icon: 'gib' },
  headshot: { name: 'Headshot', icon: 'headshot' },
  revenge: { name: 'Revenge', icon: null },
  midair: { name: 'Midair', icon: 'midair' },
  void: { name: 'Void', icon: 'void' },
  lava: { name: 'Lava', icon: 'lava' },
  slime: { name: 'Slimed', icon: 'lava' },
  firstblood: { name: 'First Blood', icon: 'firstblood' },
  shutdown: { name: 'Shutdown', icon: 'shutdown' },
  comeback: { name: 'Comeback', icon: 'comeback' },
  pointblank: { name: 'Point Blank', icon: 'pointblank' },
};

// XP needed to go from `level` to `level + 1`
export function xpNeed(level) { return 1000 + (level - 1) * 250; }

export function levelInfo(xp = 0) {
  let level = 1, rest = Math.max(0, Math.floor(xp)), need = xpNeed(1);
  while (rest >= need && level < 999) { rest -= need; level++; need = xpNeed(level); }
  return { level, into: rest, need, total: Math.floor(xp), frac: rest / need };
}

// Fold one match result into a stored profile (server file store and offline fallback share this).
// result: { xp, kills, deaths, badges: { kill: n, ... }, place, won }
export function applyResult(profile, r) {
  const before = levelInfo(profile.xp || 0).level;
  profile.xp = (profile.xp || 0) + Math.max(0, Math.min(50000, Math.floor(r.xp || 0)));
  profile.kills = (profile.kills || 0) + Math.max(0, r.kills | 0);
  profile.deaths = (profile.deaths || 0) + Math.max(0, r.deaths | 0);
  profile.matches = (profile.matches || 0) + 1;
  if (r.won) profile.wins = (profile.wins || 0) + 1;
  profile.badges ||= {};
  for (const [k, n] of Object.entries(r.badges || {})) if (BADGES[k]) profile.badges[k] = (profile.badges[k] || 0) + Math.max(0, n | 0);
  const after = levelInfo(profile.xp).level;
  return { levelUp: after > before, level: after };
}
