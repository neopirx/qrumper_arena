// Player movement: a port of Quake 3 bg_pmove.c with Challenge ProMode (CPM) air/ground physics
// and plain Quake jumping (no CPM double jump, no jump buffering), plus an Unreal Tournament
// style wall dodge ("walljump") without the ground dodge/dash.
// World is Y-up; all units are Quake units, velocities in units/second.
import { dot, normalize, cross, angleVectors } from './vec.js';
import { MASK_PLAYER } from './collision.js';

export const PM = {
  // --- Quake 3 / CPMA constants ---
  speed: 320,
  gravity: 800,
  stopspeed: 100,
  friction: 8,             // CPM ground friction (VQ3: 6)
  accelerate: 15,          // CPM ground acceleration (VQ3: 10)
  airaccelerate: 1,
  airstopaccelerate: 2.5,  // CPM: accel when air-moving against velocity
  strafeaccelerate: 70,    // CPM: accel when pure side-strafing in air
  wishspeedStrafe: 30,     // CPM: wishspeed cap for pure air side-strafe
  aircontrol: 150,         // CPM: forward-only air steering
  jumpVelocity: 270,
  doubleJumpZ: 100,        // CPM: extra jump velocity within 400 ms of the previous jump (stair/double jump)
  doubleJumpTime: 400,
  duckScale: 0.25,
  stepSize: 18,
  overclip: 1.001,
  minWalkNormal: 0.7,
  // --- UT2004 style wall dodge, scaled from UT units (GroundSpeed 440) to Quake (320) ---
  wallDodgeSpeed: 1.5 * 320, // DodgeSpeedFactor * GroundSpeed
  wallDodgeZ: 220,
  wallDodgeReach: 20,        // how far from the collision hull the wall may be (UT: 32 UT units ≈ 23 here)
  wallDodgeMinAir: 0.08,     // seconds after leaving the ground before a wall kick is allowed
  wallDodgesPerAir: 1,
};

export const PLAYER_MINS = [-15, -24, -15];
export const PLAYER_MAXS = [15, 32, 15];
export const CROUCH_MAXS_Y = 16;
export const VIEWHEIGHT = 26;
export const CROUCH_VIEWHEIGHT = 12;

export function makePlayerState() {
  return {
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    pitch: 0, yaw: 0,
    mins: [...PLAYER_MINS], maxs: [...PLAYER_MAXS],
    viewheight: VIEWHEIGHT,
    ducked: false,
    onGround: false, groundNormal: [0, 1, 0], groundPlane: false,
    pmTime: 0, timeKnockback: false,   // PMF_TIME_KNOCKBACK
    jumpHeld: false,
    jumpTime: 0,          // CPM STAT_JUMPTIME: ms left in which a new jump is a double jump
    doubleJump: false,    // CPM double jump enabled (a match rule)
    lastPadTime: -1e9,    // cmd time (ms) of the last jump pad sound
    wallDodges: 0,
    airTime: 0,
    lastTap: { f: -1e9, b: -1e9, l: -1e9, r: -1e9 },
    prevMove: { f: 0, s: 0 },
    dead: false,
    events: [],
  };
}

// cmd: { forward:-1..1, side:-1..1 (right +), jump:bool, crouch:bool, pitch, yaw, time(ms) }
export function pmove(ps, cmd, dt, col) {
  const pm = new Pmove(ps, cmd, dt, col);
  pm.run();
}

const tmpF = [0, 0, 0], tmpR = [0, 0, 0];

class Pmove {
  constructor(ps, cmd, dt, col) {
    this.ps = ps; this.cmd = cmd; this.dt = dt; this.col = col;
  }

  trace(start, end) {
    return this.col.trace(start, end, this.ps.mins, this.ps.maxs, MASK_PLAYER);
  }

  run() {
    const ps = this.ps, cmd = this.cmd;
    if (ps.dead) { cmd.forward = cmd.side = 0; cmd.jump = false; cmd.crouch = false; }
    ps.pitch = cmd.pitch; ps.yaw = cmd.yaw;

    // PM_DropTimers: knockback and landing timers share pm_time and expire together
    if (ps.pmTime > 0) {
      ps.pmTime -= this.dt * 1000;
      if (ps.pmTime <= 0) { ps.pmTime = 0; ps.timeKnockback = false; }
    }
    if (ps.jumpTime > 0) ps.jumpTime = Math.max(0, ps.jumpTime - this.dt * 1000);

    this.prevVy = ps.velocity[1];
    this.checkDuck();
    this.groundTrace();
    this.detectDoubleTaps();

    if (this.walking) this.walkMove();
    else this.airMove();

    this.groundTrace();
    ps.onGround = this.walking;
    if (ps.onGround) { ps.wallDodges = 0; ps.airTime = 0; } else ps.airTime = (ps.airTime || 0) + this.dt;
    ps.jumpHeld = !!cmd.jump;
    // Q3 PmoveSingle ends with trap_SnapVector(velocity): velocity is rounded to whole units every
    // frame. At 125 Hz this is what gives Q3/CPMA its exact jump height and strafe-jump gain.
    const v = ps.velocity;
    v[0] = Math.round(v[0]); v[1] = Math.round(v[1]); v[2] = Math.round(v[2]);
  }

  detectDoubleTaps() {
    // UT style double-tap detection (used for the wall dodge while airborne)
    const ps = this.ps, cmd = this.cmd, t = cmd.time;
    const taps = [];
    const pf = ps.prevMove;
    if (cmd.forward > 0 && pf.f <= 0) taps.push('f');
    if (cmd.forward < 0 && pf.f >= 0) taps.push('b');
    if (cmd.side > 0 && pf.s <= 0) taps.push('r');
    if (cmd.side < 0 && pf.s >= 0) taps.push('l');
    this.doubleTap = null;
    for (const k of taps) {
      if (t - ps.lastTap[k] < 250) { this.doubleTap = k; ps.lastTap[k] = -1e9; }
      else ps.lastTap[k] = t;
    }
    pf.f = cmd.forward; pf.s = cmd.side;
  }

  checkDuck() {
    const ps = this.ps;
    ps.mins[0] = PLAYER_MINS[0]; ps.mins[2] = PLAYER_MINS[2];
    ps.maxs[0] = PLAYER_MAXS[0]; ps.maxs[2] = PLAYER_MAXS[2];
    ps.mins[1] = PLAYER_MINS[1];
    if (ps.dead) { ps.maxs[1] = -8; ps.viewheight = -16; return; }
    if (this.cmd.crouch) ps.ducked = true;
    else if (ps.ducked) {
      // stand up if possible
      ps.maxs[1] = PLAYER_MAXS[1];
      const tr = this.trace(ps.origin, ps.origin);
      if (!tr.allsolid) ps.ducked = false;
    }
    if (ps.ducked) { ps.maxs[1] = CROUCH_MAXS_Y; ps.viewheight = CROUCH_VIEWHEIGHT; }
    else { ps.maxs[1] = PLAYER_MAXS[1]; ps.viewheight = VIEWHEIGHT; }
  }

  groundTrace() {
    const ps = this.ps;
    const point = [ps.origin[0], ps.origin[1] - 0.25, ps.origin[2]];
    const tr = this.trace(ps.origin, point);
    if (tr.allsolid) {
      // try to nudge out of solid (PM_CorrectAllSolid)
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const p = [ps.origin[0] + i, ps.origin[1] + j, ps.origin[2] + k];
        const t2 = this.trace(p, p);
        if (!t2.allsolid) { ps.origin[0] = p[0]; ps.origin[1] = p[1]; ps.origin[2] = p[2]; return this.groundTrace(); }
      }
      this.walking = false; this.groundPlane = false; return;
    }
    if (tr.fraction === 1) { this.groundPlane = false; this.walking = false; return; }
    const n = tr.normal;
    // check if getting thrown off the ground
    if (ps.velocity[1] > 0 && dot(ps.velocity, n) > 10) { this.groundPlane = false; this.walking = false; return; }
    if (n[1] < PM.minWalkNormal) {
      // steep slope: treat as air but remember the plane
      this.groundPlane = true; this.walking = false;
      ps.groundNormal = [n[0], n[1], n[2]];
      return;
    }
    if (!ps.onGround && !this.landed) {
      this.crashLand();
      // Q3 PM_GroundTrace: a real fall (not walking down a slope) starts PMF_TIME_LAND, 250 ms of
      // pm_time during which PM_SlideMove keeps the pre-collision velocity
      if (this.prevVy < -200) ps.pmTime = 250;
    }
    this.groundPlane = true; this.walking = true;
    ps.groundNormal = [n[0], n[1], n[2]];
  }

  crashLand() {
    const ps = this.ps;
    this.landed = true;
    const vy = Math.min(ps.velocity[1], this.prevVy);
    const delta = vy * vy * 0.0001;
    if (ps.dead) return;
    if (delta > 60) ps.events.push({ type: 'fall', damage: 10 });
    else if (delta > 40) ps.events.push({ type: 'fall', damage: 5 });
    else if (delta > 2) ps.events.push({ type: 'land', hard: delta > 20, vy });
    // CPM: landing resets knockback timer only if it was a hard fall... keep Q3 behaviour
  }

  cmdWish(forward, right) {
    const cmd = this.cmd;
    let fm = cmd.forward, sm = cmd.side;
    const ps = this.ps;
    const wish = [forward[0] * fm + right[0] * sm, forward[1] * fm + right[1] * sm, forward[2] * fm + right[2] * sm];
    const mag = Math.hypot(fm, sm);
    const scale = mag > 0 ? PM.speed * Math.max(Math.abs(fm), Math.abs(sm)) / mag : 0;
    const wishdir = [0, 0, 0];
    let wishspeed = normalize(wishdir, wish);
    wishspeed *= scale;
    if (ps.ducked && wishspeed > PM.speed * PM.duckScale) wishspeed = PM.speed * PM.duckScale;
    return { wishdir, wishspeed };
  }

  checkJump() {
    const ps = this.ps, cmd = this.cmd;
    if (!cmd.jump || ps.dead) return false;
    // CPMA: holding jump auto-hops (no PMF_JUMP_HELD requirement)
    this.groundPlane = false; this.walking = false;
    // CPM ramp jumps: vertical speed from a ramp carries into the jump
    let vy = ps.velocity[1];
    if (vy < 0) vy = 0;
    // CPM double jump: jumping again within 400 ms of the last jump adds 100 (off unless the match enables it)
    if (ps.doubleJump && ps.jumpTime > 0 && vy >= 0) vy += PM.doubleJumpZ;
    ps.velocity[1] = vy + PM.jumpVelocity;
    ps.jumpTime = PM.doubleJumpTime;
    this.justJumped = true;
    ps.events.push({ type: 'jump' });
    return true;
  }

  friction() {
    const ps = this.ps, vel = ps.velocity;
    const vec = [vel[0], this.walking ? 0 : vel[1], vel[2]];
    const speed = Math.hypot(vec[0], vec[1], vec[2]);
    if (speed < 1) { vel[0] = 0; vel[2] = 0; return; }
    let drop = 0;
    if (this.walking && !ps.timeKnockback) {
      const control = speed < PM.stopspeed ? PM.stopspeed : speed;
      drop += control * PM.friction * this.dt;
    }
    let newspeed = speed - drop;
    if (newspeed < 0) newspeed = 0;
    newspeed /= speed;
    vel[0] *= newspeed; vel[1] *= newspeed; vel[2] *= newspeed;
  }

  accelerate(wishdir, wishspeed, accel) {
    const vel = this.ps.velocity;
    const currentspeed = dot(vel, wishdir);
    const addspeed = wishspeed - currentspeed;
    if (addspeed <= 0) return;
    let accelspeed = accel * this.dt * wishspeed;
    if (accelspeed > addspeed) accelspeed = addspeed;
    vel[0] += accelspeed * wishdir[0]; vel[1] += accelspeed * wishdir[1]; vel[2] += accelspeed * wishdir[2];
  }

  // CPM air control: steer velocity toward wishdir when only forward/back is held
  airControl(wishdir, wishspeed) {
    const ps = this.ps, cmd = this.cmd, vel = ps.velocity;
    if (cmd.side !== 0 || cmd.forward === 0 || wishspeed === 0) return;
    const zspeed = vel[1];
    vel[1] = 0;
    const speed = normalize(vel, vel);
    const d = dot(vel, wishdir);
    let k = 32 * PM.aircontrol * d * d * this.dt;
    if (d > 0) {
      vel[0] = vel[0] * speed + wishdir[0] * k;
      vel[2] = vel[2] * speed + wishdir[2] * k;
      normalize(vel, vel);
    }
    vel[0] *= speed; vel[2] *= speed;
    vel[1] = zspeed;
  }

  walkMove() {
    const ps = this.ps, cmd = this.cmd;
    if (this.checkJump()) { this.airMove(); return; }
    this.friction();
    angleVectors(0, ps.yaw, tmpF, tmpR);
    tmpF[1] = 0; tmpR[1] = 0;
    clipVelocity(tmpF, ps.groundNormal, tmpF, PM.overclip);
    clipVelocity(tmpR, ps.groundNormal, tmpR, PM.overclip);
    normalize(tmpF, tmpF); normalize(tmpR, tmpR);
    const { wishdir, wishspeed } = this.cmdWish(tmpF, tmpR);
    const accel = ps.timeKnockback ? PM.airaccelerate : PM.accelerate;
    this.accelerate(wishdir, wishspeed, accel);
    if (ps.timeKnockback) ps.velocity[1] -= PM.gravity * this.dt;
    const vel = ps.velocity;
    const vlen = Math.hypot(vel[0], vel[1], vel[2]);
    // slide along the ground plane without losing speed
    clipVelocity(vel, ps.groundNormal, vel, PM.overclip);
    normalize(vel, vel);
    vel[0] *= vlen; vel[1] *= vlen; vel[2] *= vlen;
    if (vel[0] === 0 && vel[2] === 0) return;
    this.stepSlideMove(false);
  }

  airMove() {
    const ps = this.ps, cmd = this.cmd;
    this.friction();
    this.checkWallDodge();
    angleVectors(0, ps.yaw, tmpF, tmpR);
    tmpF[1] = 0; tmpR[1] = 0;
    normalize(tmpF, tmpF); normalize(tmpR, tmpR);
    let { wishdir, wishspeed } = this.cmdWish(tmpF, tmpR);
    const wishspeed2 = wishspeed;
    let accel;
    if (dot(ps.velocity, wishdir) < 0) accel = PM.airstopaccelerate;
    else accel = PM.airaccelerate;
    if (cmd.forward === 0 && cmd.side !== 0) {
      if (wishspeed > PM.wishspeedStrafe) wishspeed = PM.wishspeedStrafe;
      accel = PM.strafeaccelerate;
    }
    this.accelerate(wishdir, wishspeed, accel);
    this.airControl(wishdir, wishspeed2);
    if (this.groundPlane) clipVelocity(ps.velocity, ps.groundNormal, ps.velocity, PM.overclip);
    this.stepSlideMove(true);
  }

  // Unreal Tournament wall dodge: while falling, dodge off a wall that is behind the dodge
  // direction. Triggered by double-tapping a direction (UT) or by pressing jump next to a wall.
  checkWallDodge() {
    const ps = this.ps, cmd = this.cmd;
    if (ps.dead || this.justJumped || ps.wallDodges >= PM.wallDodgesPerAir) return;
    if (ps.airTime < PM.wallDodgeMinAir) return;
    const jumpPressed = cmd.jump && !ps.jumpHeld;
    if (!this.doubleTap && !(jumpPressed && cmd.walljumpOnJump !== false)) return;

    const fwd = [0, 0, 0], right = [0, 0, 0];
    angleVectors(0, ps.yaw, fwd, right);
    // A kickable wall is a vertical surface right next to the hull at both knee and chest height:
    // stair risers, curbs, railings and the ledge you just stepped off don't count, and there is
    // no air jump without one (no double jump).
    const knee = [ps.origin[0], ps.origin[1] + ps.mins[1] + 20, ps.origin[2]];
    const chest = [ps.origin[0], ps.origin[1] + 8, ps.origin[2]];
    const reach = 15 + PM.wallDodgeReach;
    const hit = (from, d) => {
      const end = [from[0] - d[0] * reach, from[1], from[2] - d[2] * reach];
      const tr = this.col.trace(from, end, [-1, -1, -1], [1, 1, 1], MASK_PLAYER);
      return tr.fraction < 1 && Math.abs(tr.normal[1]) < 0.2 && (tr.normal[0] * d[0] + tr.normal[2] * d[2]) > 0.5 ? tr : null;
    };
    const probe = (d) => {
      const a = hit(knee, d);
      if (!a || !hit(chest, d)) return null;
      return a;
    };
    let dir = null;
    if (this.doubleTap) {
      const k = this.doubleTap;
      dir = k === 'f' ? fwd : k === 'b' ? [-fwd[0], 0, -fwd[2]] : k === 'r' ? right : [-right[0], 0, -right[2]];
      if (!probe(dir)) dir = null;
    }
    // A jump press while falling onto the floor is a bunny hop being timed, not a wall dodge:
    // let autohop take it on landing instead of kicking off a nearby wall.
    if (!dir && jumpPressed && cmd.walljumpOnJump !== false && !this.nearLanding()) {
      // pick the closest wall around us, kick away from it, biased by the move keys
      let best = null, bestFrac = 2;
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4;
        const d = [Math.cos(ang), 0, Math.sin(ang)];
        const tr = probe(d);
        if (tr && tr.fraction < bestFrac) { bestFrac = tr.fraction; best = [tr.normal[0], 0, tr.normal[2]]; normalize(best, best); }
      }
      if (best) {
        const wish = [fwd[0] * cmd.forward + right[0] * cmd.side, 0, fwd[2] * cmd.forward + right[2] * cmd.side];
        if (normalize(wish, wish) > 0) {
          const d = dot(wish, best);
          if (d < 0.3) { // pushing into/along the wall: drop the into-wall part and kick away
            wish[0] += best[0] * (1 - d); wish[2] += best[2] * (1 - d);
            normalize(wish, wish);
          }
          dir = wish;
        } else dir = best;
      }
    }
    if (!dir) return;

    const vel = ps.velocity;
    const crossDir = [-dir[2], 0, dir[0]];
    const keep = vel[0] * crossDir[0] + vel[2] * crossDir[2];
    const along = Math.max(PM.wallDodgeSpeed, vel[0] * dir[0] + vel[2] * dir[2]);
    vel[0] = dir[0] * along + crossDir[0] * keep;
    vel[2] = dir[2] * along + crossDir[2] * keep;
    vel[1] = Math.max(vel[1] * 0.25, 0) + PM.wallDodgeZ;
    ps.wallDodges++;
    ps.events.push({ type: 'walljump' });
  }

  // true when walkable ground is close below and we will reach it within ~150 ms
  nearLanding() {
    const ps = this.ps, vy = ps.velocity[1];
    const t = 0.15;
    const drop = Math.max(8, -(vy * t - 0.5 * PM.gravity * t * t));
    const end = [ps.origin[0], ps.origin[1] - drop, ps.origin[2]];
    const tr = this.trace(ps.origin, end);
    return tr.fraction < 1 && tr.normal[1] >= PM.minWalkNormal;
  }

  slideMove(gravity) {
    const ps = this.ps, vel = ps.velocity, org = ps.origin;
    const numbumps = 4;
    const planes = [];
    const primal = [vel[0], vel[1], vel[2]];
    let endVelocity = [0, 0, 0];
    if (gravity) {
      endVelocity = [vel[0], vel[1] - PM.gravity * this.dt, vel[2]];
      vel[1] = (vel[1] + endVelocity[1]) * 0.5;
      primal[1] = endVelocity[1];
      if (this.groundPlane) clipVelocity(vel, ps.groundNormal, vel, PM.overclip);
    }
    let timeLeft = this.dt;
    if (this.groundPlane) planes.push([...ps.groundNormal]);
    const nv = [0, 0, 0]; normalize(nv, vel); planes.push(nv);

    let bump;
    for (bump = 0; bump < numbumps; bump++) {
      const end = [org[0] + vel[0] * timeLeft, org[1] + vel[1] * timeLeft, org[2] + vel[2] * timeLeft];
      const tr = this.trace(org, end);
      if (tr.allsolid) { vel[1] = 0; return true; }
      if (tr.fraction > 0) { org[0] = tr.endpos[0]; org[1] = tr.endpos[1]; org[2] = tr.endpos[2]; }
      if (tr.fraction === 1) break;
      timeLeft -= timeLeft * tr.fraction;
      if (planes.length >= 5) { vel[0] = vel[1] = vel[2] = 0; return true; }
      const n = [tr.normal[0], tr.normal[1], tr.normal[2]];
      let i;
      for (i = 0; i < planes.length; i++) {
        if (dot(n, planes[i]) > 0.99) { vel[0] += n[0]; vel[1] += n[1]; vel[2] += n[2]; break; }
      }
      if (i < planes.length) continue;
      planes.push(n);

      for (i = 0; i < planes.length; i++) {
        const into = dot(vel, planes[i]);
        if (into >= 0.1) continue;
        const clipV = [0, 0, 0], endClipV = [0, 0, 0];
        clipVelocity(vel, planes[i], clipV, PM.overclip);
        clipVelocity(endVelocity, planes[i], endClipV, PM.overclip);
        let blocked = false;
        for (let j = 0; j < planes.length; j++) {
          if (j === i) continue;
          if (dot(clipV, planes[j]) >= 0.1) continue;
          clipVelocity(clipV, planes[j], clipV, PM.overclip);
          clipVelocity(endClipV, planes[j], endClipV, PM.overclip);
          if (dot(clipV, planes[i]) >= 0) continue;
          const dir = [0, 0, 0];
          cross(dir, planes[i], planes[j]); normalize(dir, dir);
          let d = dot(dir, vel);
          clipV[0] = dir[0] * d; clipV[1] = dir[1] * d; clipV[2] = dir[2] * d;
          d = dot(dir, endVelocity);
          endClipV[0] = dir[0] * d; endClipV[1] = dir[1] * d; endClipV[2] = dir[2] * d;
          for (let k = 0; k < planes.length; k++) {
            if (k === i || k === j) continue;
            if (dot(clipV, planes[k]) >= 0.1) continue;
            vel[0] = vel[1] = vel[2] = 0; blocked = true; break;
          }
          if (blocked) return true;
        }
        vel[0] = clipV[0]; vel[1] = clipV[1]; vel[2] = clipV[2];
        endVelocity = endClipV;
        break;
      }
    }
    if (gravity) { vel[0] = endVelocity[0]; vel[1] = endVelocity[1]; vel[2] = endVelocity[2]; }
    if (ps.pmTime > 0) { vel[0] = primal[0]; vel[1] = primal[1]; vel[2] = primal[2]; }
    return bump !== 0;
  }

  stepSlideMove(gravity) {
    const ps = this.ps, org = ps.origin, vel = ps.velocity;
    const startO = [...org], startV = [...vel];
    if (!this.slideMove(gravity)) return; // got exactly where we wanted on the first try

    const down = [startO[0], startO[1] - PM.stepSize, startO[2]];
    let tr = this.trace(startO, down);
    // never step up when you still have up velocity
    if (vel[1] > 0 && (tr.fraction === 1 || tr.normal[1] < 0.7)) return;

    const up = [startO[0], startO[1] + PM.stepSize, startO[2]];
    tr = this.trace(startO, up);
    if (tr.allsolid) return;
    const stepSize = tr.endpos[1] - startO[1];
    org[0] = tr.endpos[0]; org[1] = tr.endpos[1]; org[2] = tr.endpos[2];
    vel[0] = startV[0]; vel[1] = startV[1]; vel[2] = startV[2];
    this.slideMove(gravity);

    // push down the final amount
    const d2 = [org[0], org[1] - stepSize, org[2]];
    tr = this.trace(org, d2);
    if (!tr.allsolid) { org[0] = tr.endpos[0]; org[1] = tr.endpos[1]; org[2] = tr.endpos[2]; }
    if (tr.fraction < 1) clipVelocity(vel, tr.normal, vel, PM.overclip);
    // only real stair steps while walking (airborne step-ups are just normal ascent)
    if (!gravity && org[1] - startO[1] > 1) ps.events.push({ type: 'step', h: org[1] - startO[1] });
  }
}

export function clipVelocity(inV, normal, out, overbounce) {
  let backoff = dot(inV, normal);
  if (backoff < 0) backoff *= overbounce; else backoff /= overbounce;
  out[0] = inV[0] - normal[0] * backoff;
  out[1] = inV[1] - normal[1] * backoff;
  out[2] = inV[2] - normal[2] * backoff;
}

// Q3 G_Damage knockback: applied to velocity, plus a short no-friction window
export function applyKnockback(ps, dir, knockback) {
  if (knockback <= 0) return;
  const mass = 200, g_knockback = 1000;
  const s = g_knockback * knockback / mass;
  ps.velocity[0] += dir[0] * s; ps.velocity[1] += dir[1] * s; ps.velocity[2] += dir[2] * s;
  let t = knockback * 2;
  if (t < 50) t = 50; if (t > 200) t = 200;
  ps.pmTime = t; ps.timeKnockback = true;
}
