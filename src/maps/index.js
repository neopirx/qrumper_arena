import bastion from './bastion.js';
import spire from './spire.js';
import skywalk from './skywalk.js';
import orbit from './orbit.js';
import vigil from './vigil.js';
import cistern from './cistern.js';

export const MAPS = {
  bastion: { def: bastion, players: '2–6 players', tagline: 'Duel · five-level foundry, slime trench' },
  cistern: { def: cistern, players: '2–4 players', tagline: 'Duel · waterworks loops, rocket pit, RA and MH apart' },
  skywalk: { def: skywalk, players: '2–4 players', tagline: 'Duel · walkways and jumps over the void' },
  spire: { def: spire, players: '4–10 players', tagline: 'FFA · spiral tower, lava forge, loop' },
  vigil: { def: vigil, players: '2–8 players', tagline: 'FFA · gothic cathedral, crypt, blood-pool apse' },
  orbit: { def: orbit, players: '2–10 players', tagline: 'FFA · station decks over a gas giant, jump pads' },
};

// map rotation after a match: the next map in this list (same mode and rules)
export function nextMap(key) {
  const keys = Object.keys(MAPS);
  return keys[(keys.indexOf(key) + 1) % keys.length];
}
