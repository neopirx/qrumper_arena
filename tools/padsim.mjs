// Simulate every jump pad of a map and print where it lands: node tools/padsim.mjs <map>
import { buildMap } from '../src/maps/builder.js';
import { Game, launchVelocity } from '../src/sim/game.js';
import { pmove, makePlayerState } from '../src/sim/pmove.js';
const def = (await import(`../src/maps/${process.argv[2]}.js`)).default;
const map = buildMap(def); const game = new Game(map);
for (const j of map.jumppads) {
  const v = launchVelocity(j);
  const ps = makePlayerState(); ps.origin = [j.at[0], j.at[1] + 24.25, j.at[2]]; ps.velocity = [...v];
  let land = null, t = 0, maxY = -1e9;
  for (; t < 5; t += 1 / 60) { pmove(ps, { forward: 0, side: 0, jump: false, crouch: false, pitch: 0, yaw: 0, time: t * 1000 }, 1 / 60, game.col); ps.events.length = 0; maxY = Math.max(maxY, ps.origin[1]); if (t > 0.1 && ps.onGround) { land = ps.origin.map(Math.round); break; } }
  console.log(JSON.stringify(j.at), '->', JSON.stringify(j.target), 'v', v.map(Math.round).join(','), 'land', JSON.stringify(land), 't', t.toFixed(2), 'apex', Math.round(maxY));
}
