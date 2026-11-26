// Movement sanity tests: strafe jumping gain, Quake jump height (no double jump), rocket jump, walljump.
import { buildMap } from '../src/maps/builder.js';
import { CollisionWorld } from '../src/sim/collision.js';
import { pmove, makePlayerState, applyKnockback } from '../src/sim/pmove.js';
import { yawTo } from '../src/sim/vec.js';
// a big flat test hall, so the measurements don't depend on a real map's layout
const def = { name: 'test', world: [-4000, -64, -4000, 4000, 640, 4000], defaults: { floor: 'a', wall: 'a', ceil: 'a' }, spaces: [{ b: [-3900, 0, -3900, 3900, 600, 3900] }] };
const col = new CollisionWorld(buildMap(def).brushes);
const DT = 1 / 125;
const cmd = (o) => ({ forward: 0, side: 0, jump: false, crouch: false, pitch: 0, yaw: 0, time: 0, ...o });
function fresh(o = [0, 24.125, 2000]) { const ps = makePlayerState(); ps.origin = [...o]; return ps; }
const hs = (ps) => Math.hypot(ps.velocity[0], ps.velocity[2]);

// 1. plain run speed
let ps = fresh(); for (let i = 0; i < 125; i++) pmove(ps, cmd({ forward: 1, yaw: 0, time: i * 8 }), DT, col);
console.log('run speed', hs(ps).toFixed(1), '(expect 320)');
// 2. strafe jumping: W+A with yaw turning at the optimal angle
ps = fresh([0, 24.125, 0]);
let yaw = 0; let maxH = 0;
for (let i = 0; i < 125 * 3; i++) {
  const sp = hs(ps);
  const velYaw = sp > 1 ? yawTo(ps.velocity[0], ps.velocity[2]) : 0;
  const opt = sp > 320 ? Math.acos(Math.min(1, (320 - 320 * DT) / sp)) * 180 / Math.PI : 0;
  // strafe left: wishdir is 45° left of view yaw
  yaw = sp > 50 ? velYaw + opt - 45 + 1 : 0;
  pmove(ps, cmd({ forward: 1, side: i < 30 ? 0 : -1, jump: i > 30, yaw, time: i * 8 }), DT, col);
  maxH = Math.max(maxH, hs(ps));
}
console.log('strafe jump speed after 3s', hs(ps).toFixed(0), 'max', maxH.toFixed(0), '(CPMA: ~550-650 after a few jumps)');
// 3. jump height, and a quick re-jump must not get a double-jump bonus
ps = fresh(); let y0 = ps.origin[1], top = 0;
pmove(ps, cmd({ jump: true }), DT, col);
for (let i = 0; i < 100; i++) { pmove(ps, cmd({ time: i * 8 }), DT, col); top = Math.max(top, ps.origin[1] - y0); }
console.log('jump height', top.toFixed(1), '(expect ~48.5: Q3 at 125 Hz with velocity snapping)');
// jump, land, jump again right away (would be a CPM double jump)
function rejump(doubleJump) {
  const ps = fresh(); ps.doubleJump = doubleJump; let top = 0, landedAt = -1;
  for (let i = 0; i < 300; i++) {
    const wantJump = (i === 0) || (landedAt >= 0 && i === landedAt + 5);
    const was = ps.onGround;
    pmove(ps, cmd({ jump: wantJump, time: i * 8 }), DT, col);
    if (!was && ps.onGround && landedAt < 0 && i > 2) landedAt = i;
    if (landedAt >= 0) top = Math.max(top, ps.origin[1] - y0);
    ps.events.length = 0;
  }
  return top;
}
console.log('quick re-jump height', rejump(false).toFixed(1), '(expect ~48.5: same as a single jump, double jump off)');
// CPM double jump: a jump within 400 ms of the previous one (stairs, ledges) gets +100
{ const ps = fresh(); ps.doubleJump = true; ps.jumpTime = 200; let top = 0;
  pmove(ps, cmd({ jump: true }), DT, col);
  for (let i = 0; i < 150; i++) { pmove(ps, cmd({ time: i * 8 }), DT, col); top = Math.max(top, ps.origin[1] - y0); }
  console.log('CPM double jump height', top.toFixed(1), '(expect ~ 90: 370 u/s; only when the match enables it)'); }
// 4. rocket jump: jump + rocket at feet (100 splash at ~ distance 0 => full knockback, dir up)
ps = fresh(); top = 0;
pmove(ps, cmd({ jump: true }), DT, col);
applyKnockback(ps, [0, 1, 0], 100);
for (let i = 0; i < 250; i++) { pmove(ps, cmd({ time: i * 8 }), DT, col); top = Math.max(top, ps.origin[1] - y0); }
console.log('rocket jump height', top.toFixed(0), '(Q3/CPMA: ~ 230-260)');
// 5. walljump: run at the west wall (x=-3900), jump, press jump again near wall
ps = fresh([-3732, 24.125, 300]); top = 0; let wj = false; let vAfter = null;
for (let i = 0; i < 250; i++) {
  const nearWall = ps.origin[0] < -3862;
  const j = i === 30 || (nearWall && !ps.onGround && i > 31 && !wj && i % 2 === 0);
  pmove(ps, cmd({ forward: 1, yaw: 90, jump: j, time: i * 8 }), DT, col);
  if (ps.events.some(e => e.type === 'walljump')) { wj = true; vAfter = [...ps.velocity]; }
  ps.events.length = 0;
}
console.log('walljump triggered', wj, 'velocity after', vAfter && vAfter.map(v => v.toFixed(0)).join(','), '(expect +x ~480, y ~220)');

// 6. no air jump without a wall: jump in the open, tap jump repeatedly in the air
ps = fresh(); let air = 0;
for (let i = 0; i < 120; i++) {
  pmove(ps, cmd({ forward: 1, yaw: 0, jump: i === 0 || (i > 10 && i % 3 === 0 && !ps.onGround), time: i * 8 }), DT, col);
  if (ps.events.some(e => e.type === 'walljump')) air++;
  ps.events.length = 0;
}
console.log('air jumps in the open', air, '(expect 0)');
