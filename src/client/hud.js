// HTML overlay HUD in the arena-shooter mould: health and armor bottom left and ammo bottom right
// as slanted plates with big numbers and bars (a "ghost" segment shows what a hit just took), the
// match bar top centre (your score, the clock, the leader or runner-up), the kill feed top right,
// damage numbers by the crosshair and a weapon bar that pops up on switch. The plates react: a hit
// shakes and flashes them, healing pulses them, every shot ticks the ammo count, and the clusters
// sway a little against mouse turns, jumps and landings. Numbers keep Q3's colour code:
// gold = normal, red = low, white = above 100, grey = empty.
import { WEAPONS, WEAPON_ORDER } from '../sim/defs.js';
import { INF_AMMO, modeName } from '../sim/game.js';
import { xhairFor, applyCrosshair } from './crosshair.js';
import { BADGES, levelInfo } from '../sim/xp.js';
// badges: seconds between two badges of the same frag, and how long a group stays up
const BADGE_GAP = 0.42, BADGE_TIME = 2.6;
import { yawTo, angleDiff } from '../sim/vec.js';

const ORD = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MOD_WEAPON = { mg: 'mg', sg: 'sg', gl: 'gl', gl_splash: 'gl', rl: 'rl', rl_splash: 'rl', rg: 'rg' };
const MOD_TEXT = { falling: 'cratered', void: 'fell out', telefrag: 'telefragged', slime: 'melted', lava: 'did a back flip into the lava' };
const WCOL = (id) => '#' + WEAPONS[id].color.toString(16).padStart(6, '0');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
// ammo count at which the number turns red and the "low ammo" warning shows (Q3 cg_lowAmmoWarning)
const LOW_AMMO = { mg: 20, sg: 3, gl: 3, rl: 3, rg: 3 };

const DIR_LIFE = 1.6;
// one damage arc: centred on the crosshair, rotated toward the source (rel > 0 = to the left)
function dirArc(d, rel) {
  const R = 118, span = (16 + Math.min(d.dmg, 100) * 0.2) * Math.PI / 180;
  const x = (R * Math.sin(span)).toFixed(1), y = (-R * Math.cos(span)).toFixed(1);
  const path = `M${-x} ${y} A${R} ${R} 0 0 1 ${x} ${y}`;
  const w = 5 + Math.min(d.dmg, 100) * 0.09;
  const op = Math.min(1, d.t / 0.6);
  const hot = Math.max(0, 1 - d.age / 0.18);   // fresh hit flashes brighter
  const core = `rgb(255,${Math.round(40 + 160 * hot)},${Math.round(20 + 140 * hot)})`;
  return `<svg class="dir" viewBox="-150 -150 300 300" style="transform:rotate(${(-rel).toFixed(1)}deg);opacity:${op.toFixed(3)}">`
    + `<path d="${path}" stroke="rgba(255,0,0,0.35)" stroke-width="${(w * 2.6).toFixed(1)}" fill="none" stroke-linecap="round" filter="url(#dirblur)"/>`
    + `<path d="${path}" stroke="rgba(0,0,0,0.55)" stroke-width="${(w + 3).toFixed(1)}" fill="none" stroke-linecap="round"/>`
    + `<path d="${path}" stroke="${core}" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round"/></svg>`;
}

const ICON_HEALTH = `<svg viewBox="0 0 32 32"><path d="M11 3h10v8h8v10h-8v8H11v-8H3V11h8z" fill="currentColor" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const ICON_ARMOR = `<svg viewBox="0 0 32 32"><path d="M16 2l12 4v9c0 8-5.4 12.8-12 15C9.4 27.8 4 23 4 15V6z" fill="currentColor" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 6l8 2.6V15c0 5.4-3.4 8.8-8 10.6z" fill="rgba(255,255,255,0.28)"/></svg>`;

export class Hud {
  constructor(root, settings, icons = {}) {
    this.root = root;
    this.settings = settings;
    this.icons = icons;
    root.innerHTML = `
      <div class="hud-lowhp" id="lowhp"></div>
      <div class="hud-damage" id="damage"></div>
      <div class="hud-flash" id="flash"></div>
      <svg width="0" height="0" style="position:absolute"><filter id="dirblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></svg>
      <div class="hud-dirs" id="dirs"></div>
      <div class="hud-xhair" id="xhair"></div>
      <div class="hud-hitmark" id="hitmark"></div>
      <div class="hud-scope" id="scope"></div>
      <div class="hud-scaled">
        <div class="hud-speed" id="speed"></div>
        <div class="hud-ammowarn" id="ammowarn"></div>
        <div class="hud-center" id="center"></div>
        <div class="hud-sub" id="sub"></div>
        <div class="hud-awards" id="awards"></div>
        <div class="hud-badges" id="badges"></div>
        <div class="hud-dmgnums" id="dmgnums"></div>
        <div class="hud-match" id="match">
          <div class="mb me" id="mbme"><b id="mbmes">0</b><small id="mbmen"></small><i class="prog"><i id="mbmep"></i></i></div>
          <div class="mt"><b id="timer"></b><small id="mtsub"></small></div>
          <div class="mb other" id="mbot"><b id="mbots">0</b><small id="mbotn"></small><i class="prog"><i id="mbotp"></i></i></div>
        </div>
        <div class="hud-right"><div class="hud-feed" id="feed"></div><div class="hud-xp" id="xp"></div></div>
        <div class="hud-fps" id="fps"></div>
        <div class="hud-pickup" id="pickup"></div>
        <div class="hud-wbar" id="weapons"></div>
        <div class="hud-vitals sway" id="vitals">
          <div class="vit hp" id="hpbox"><span class="ico">${ICON_HEALTH}</span><span class="val" id="hp">100</span><div class="vbar"><i class="ghost" id="hpghost"></i><i class="fill" id="hpfill"></i><i class="over" id="hpover"></i></div></div>
          <div class="vit ar" id="arbox"><span class="ico">${ICON_ARMOR}</span><span class="val" id="ar">0</span><div class="vbar"><i class="ghost" id="arghost"></i><i class="fill" id="arfill"></i><i class="over" id="arover"></i></div></div>
        </div>
        <div class="hud-ammo sway" id="ambox">
          <div class="am-top"><span class="val" id="am">100</span><span class="wicon" id="amicon"></span></div>
          <div class="vbar"><i class="fill" id="amfill"></i></div>
          <div class="am-name" id="amname"></div>
        </div>
        <div class="hud-death hidden" id="death"></div>
        <div class="hud-click hidden" id="click">Click to play</div>
      </div>
      <div class="hud-scores hidden" id="scores"></div>
      <div class="hud-results hidden" id="results"></div>
      <div class="hud-end hidden" id="end"></div>`;
    this.$ = (id) => root.querySelector('#' + id);
    this.feed = [];
    this.centerT = 0; this.subT = 0; this.pickupT = 0; this.hitT = 0; this.damageT = 0; this.wbarT = 0;
    this.dirs = [];
    this.awards = [];
    this.badges = [];
    this.xpLines = [];
    this.last = {};
    this.ghost = { hp: 100, ar: 0, hpT: 0, arT: 0 };
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this.applySettings();
  }

  applySettings() {
    const s = this.settings;
    applyCrosshair(this.$('xhair'), xhairFor(s, this.xhWeapon || 'mg'));
    this.root.style.setProperty('--hud', s.hudScale || 1);
    this.$('speed').style.display = s.speedometer ? '' : 'none';
    this.$('fps').style.display = s.showFps ? '' : 'none';
  }

  icon(id) { return this.icons[id] ? `<img src="${this.icons[id]}" alt="">` : `<b style="color:${WCOL(id)}">${id.toUpperCase()}</b>`; }

  center(text, secs = 2, cls = '') { const el = this.$('center'); el.innerHTML = text; el.className = 'hud-center show ' + cls; this.centerT = secs; }
  sub(text, secs = 2) { const el = this.$('sub'); el.innerHTML = text; el.classList.add('show'); this.subT = secs; }
  // full-screen tint blit (spec 6): pickup flash
  flash(color) { const el = this.$('flash'); el.style.transition = 'none'; el.style.background = color; el.style.opacity = 1; void el.offsetWidth; el.style.transition = 'opacity 0.35s'; el.style.opacity = 0; }
  pickup(def, type) {
    let ico;
    if (def.kind === 'weapon' || def.kind === 'ammo') ico = this.icon(def.weapon);
    else ico = `<span class="pico" style="color:${hex(def.color)}">${def.kind === 'health' ? ICON_HEALTH : ICON_ARMOR}</span>`;
    const el = this.$('pickup');
    el.innerHTML = `${ico}<span>${esc(def.name)}</span>`;
    el.classList.add('show');
    this.pickupT = 3;
  }
  // announcer award banner (Double Kill, Precision, ...): newest on top, each fades on its own
  award(text) {
    this.awards = this.awards.filter((a) => a.text !== text);
    this.awards.unshift({ text, t: 2.6, id: (this.awardId = (this.awardId || 0) + 1) });
    if (this.awards.length > 3) this.awards.length = 3;
  }
  // frag badge (icon from assets/icons/badges): badges earned together form a group that is
  // revealed one by one (each with its emblem sound) and sits side by side until it fades together
  badge(kind, xp) {
    if (!BADGES[kind]) return;
    const now = performance.now();
    if (now - (this.badgeAt || -1e9) > 250) this.badgeGroup = (this.badgeGroup || 0) + 1;
    this.badgeAt = now;
    (this.badgeQueue ||= []).push({ kind, xp, group: this.badgeGroup });
    if (this.badgeQueue.length > 8) this.badgeQueue.shift();
  }
  revealBadge() {
    const b = this.badgeQueue.shift();
    // a new group clears what's left of the previous one
    if (this.badges.length && this.badges[0].group !== b.group) this.badges = [];
    this.badges.push({ ...b, t: BADGE_TIME, id: (this.badgeId = (this.badgeId || 0) + 1) });
    for (const x of this.badges) x.t = Math.max(x.t, BADGE_TIME);   // the group stays up together
    if (this.badges.length > 5) this.badges.shift();
    this.renderBadges();
    if (this.onBadge) this.onBadge(b.kind);
  }
  renderBadges() {
    const el = this.$('badges');
    const have = new Set([...el.children].map((c) => +c.dataset.id));
    for (const b of this.badges) {
      if (have.has(b.id)) continue;
      const d = document.createElement('div');
      const B = BADGES[b.kind];
      d.className = 'badge';
      d.dataset.id = b.id;
      d.innerHTML = `${B.icon ? `<img src="/icons/badges/${B.icon}.png" alt="">` : '<i></i>'}<b>${esc(B.name)}</b>${b.xp ? `<small>+${b.xp} XP</small>` : ''}`;
      el.appendChild(d);
    }
    const ids = new Set(this.badges.map((b) => b.id));
    for (const c of [...el.children]) if (!ids.has(+c.dataset.id)) c.remove();
  }
  xpLine(amount, reason) {
    this.xpLines.push({ html: `<b>+${amount} XP</b> ${esc(reason)}`, t: 4 });
    if (this.xpLines.length > 4) this.xpLines.shift();
  }
  feedLine(html) { this.feed.push({ html, t: 5, life: 5, me: false }); if (this.feed.length > 5) this.feed.shift(); }
  // railgun zoom: darkened edges and a fine reticle ring
  setZoom(k) {
    const v = Math.round(k * 100) / 100;
    if (this.last.zoom === v) return;
    this.last.zoom = v;
    this.$('scope').style.opacity = v;
  }
  // end of match: XP earned, the level bar (with level-up), and the badges collected
  results(mine, profile, levelUp) {
    const el = this.$('results');
    const L = profile ? profile.levelInfo || levelInfo(profile.xp) : null;
    const badges = Object.entries(mine.badges || {}).filter(([k]) => BADGES[k] && BADGES[k].icon)
      .map(([k, n]) => `<span class="rb" title="${BADGES[k].name}"><img src="/icons/badges/${BADGES[k].icon}.png" alt="">${n > 1 ? `<i>×${n}</i>` : ''}</span>`).join('');
    el.innerHTML = `
      <div class="r-xp">+${mine.xp} <small>XP</small></div>
      <div class="r-line">${ORD(mine.place)} place · ${mine.kills} kill${mine.kills === 1 ? '' : 's'} · ${mine.deaths} death${mine.deaths === 1 ? '' : 's'}</div>
      ${badges ? `<div class="r-badges">${badges}</div>` : ''}
      ${L ? `<div class="r-level ${levelUp ? 'up' : ''}"><span class="lv">${L.level}</span><div class="bar"><div style="width:${Math.round(L.frac * 100)}%"></div></div><small>${L.into} / ${L.need} XP${levelUp ? ' · <b>LEVEL UP!</b>' : ''}</small></div>` : '<div class="r-line dim">Profile not saved (offline)</div>'}`;
    el.classList.remove('hidden');
  }

  // end of match overlay: the countdown to the next map with Quit / Next buttons, and (on the
  // podium) name tags above the top three
  endScreen(info) {
    const el = this.$('end');
    el.classList.remove('hidden');
    el.classList.toggle('podium', info.podium);
    if (!this.endBuilt) {
      this.endBuilt = true;
      el.innerHTML = `<div class="end-tags" id="endtags"></div><div class="end-title" id="endtitle"></div>
        <div class="end-bar"><div class="end-next"><small>Next map</small><b id="endmap"></b></div>
        <div class="end-count"><span id="endsec"></span><div class="end-prog"><i id="endprog"></i></div></div>
        <div class="end-btns"><button class="btn" id="endquit">Quit to menu</button>${info.onNext ? '<button class="btn primary" id="endgo">Next match</button>' : ''}</div></div>`;
      this.$('endquit').addEventListener('click', () => this.endInfo.onQuit());
      if (info.onNext) this.$('endgo').addEventListener('click', () => this.endInfo.onNext());
    }
    this.endInfo = info;
    this.set('endmap', 'text', info.next || '…');
    this.set('endsec', 'text', info.left != null ? `Starting in ${Math.ceil(info.left)}s` : 'Waiting for the server');
    if (info.left != null) this.$('endprog').style.width = (100 * (1 - info.left / info.total)).toFixed(1) + '%';
    this.set('endtitle', 'html', info.podium ? `<small>Match over</small>${info.winner ? esc(info.winner) + ' wins' : 'Final standings'}` : '');
    const tags = info.podium ? info.labels.map((l) => `<div class="end-tag p${l.place}${l.me ? ' me' : ''}" style="left:${(l.x * 100).toFixed(2)}%;top:${(l.y * 100).toFixed(2)}%;--pc:${hex(l.color)}"><i>${ORD(l.place)}</i><b>${esc(l.name)}</b><span>${l.frags} frag${l.frags === 1 ? '' : 's'}</span></div>`).join('') : '';
    this.$('endtags').innerHTML = tags;
  }

  showWeapons() { this.wbarT = 1.8; }
  hit(dmg) {
    const el = this.$('hitmark'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); this.hitT = 0.15; el.style.setProperty('--hs', dmg >= 80 ? 1.6 : dmg >= 40 ? 1.25 : 1);
    if (this.settings.dmgNumbers !== false) this.dmgNumber(dmg);
  }
  // damage numbers: hits landing close together (a shotgun blast, a stream of bullets, a combo)
  // add up into one number that pops again with each hit, then floats up and fades
  dmgNumber(dmg) {
    const now = performance.now(), d = this.dn;
    let el;
    if (d && now - d.at < 650 && d.el.isConnected) { d.v += dmg; d.at = now; el = d.el; } else {
      el = document.createElement('div');
      el.style.setProperty('--dx', (Math.random() * 24 - 12).toFixed(1));
      el.addEventListener('animationend', () => el.remove());
      this.$('dmgnums').appendChild(el);
      this.dn = { el, v: dmg, at: now };
      while (this.$('dmgnums').children.length > 4) this.$('dmgnums').firstChild.remove();
    }
    const v = Math.round(this.dn.v);
    el.textContent = v;
    el.className = v >= 100 ? 't4' : v >= 50 ? 't3' : v >= 25 ? 't2' : 't1';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }
  // restart a one-shot CSS animation class on an element
  kick(id, cls) { const el = this.$(id); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  width(id, frac) { const v = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; if (this.last[id + 'w'] !== v) { this.last[id + 'w'] = v; this.$(id).style.width = v; } }
  // incoming damage: a red edge flash scaled by the hit, plus an arc around the crosshair pointing
  // at where the shot came from. Arcs keep the world position, so they swing as you turn toward
  // the shooter; hits from the same spot merge into one thicker, wider arc.
  damage(amount, from) {
    this.damageT = Math.min(1, Math.max(this.damageT, 0.3) + amount / 45);
    if (!from) return;
    const d = this.dirs.find((d) => Math.hypot(d.p[0] - from[0], d.p[2] - from[2]) < 96);
    if (d) { d.p = [...from]; d.dmg = Math.min(120, d.dmg * Math.min(1, d.t / DIR_LIFE) + amount); d.t = DIR_LIFE; d.age = 0; }
    else this.dirs.push({ p: [...from], dmg: amount, t: DIR_LIFE, age: 0 });
    if (this.dirs.length > 6) this.dirs.shift();
  }
  clearDamage() { this.dirs = []; this.damageT = 0; this.$('dirs').innerHTML = ''; }
  obituary(killer, victim, mod, isMe) {
    const k = killer ? `<span style="color:${killer.colorCss}">${esc(killer.name)}</span>` : '';
    const v = `<span style="color:${victim.colorCss}">${esc(victim.name)}</span>`;
    const w = MOD_WEAPON[mod];
    const icon = w ? `<span class="mod">${this.icon(w)}</span>` : `<span class="modtxt">${MOD_TEXT[mod] || mod}</span>`;
    this.feed.push({ html: killer ? `${k} ${icon} ${v}` : `${v} ${icon}`, t: 6, life: 6, me: isMe });
    if (this.feed.length > 5) this.feed.shift();
  }

  setLocked(locked) { this.$('click').classList.toggle('hidden', locked); }

  // write only when changed: the HUD updates every frame
  set(id, prop, value) {
    const k = id + prop;
    if (this.last[k] === value) return;
    this.last[k] = value;
    const el = this.$(id);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'class') el.className = value;
  }

  update(dt, g, me, fps, speed) {
    this.root.classList.toggle('intermission', g.state === 'intermission');
    // per-weapon crosshair follows the weapon in hand
    const xw = me.switchTo || me.weapon;
    if (xw !== this.xhWeapon) { this.xhWeapon = xw; applyCrosshair(this.$('xhair'), xhairFor(this.settings, xw)); }
    // ---- health & armor: number, bar (0-100, then an overcharge layer to 200) and a ghost of
    // what was just lost that holds for a moment and then drains ----
    const hp = Math.max(0, me.health), ar = me.armor, G = this.ghost;
    const prevHp = this.last.hpv, prevAr = this.last.arv;
    if (prevHp != null && me.alive) {
      if (hp < prevHp) { this.kick('hpbox', 'hurt'); G.hpT = 0.45; } else if (hp > prevHp && prevHp > 0) this.kick('hpbox', 'gain');
      if (ar < prevAr) { this.kick('arbox', 'hurt'); G.arT = 0.45; } else if (ar > prevAr) this.kick('arbox', 'gain');
    }
    this.last.hpv = hp; this.last.arv = ar;
    G.hpT -= dt; G.arT -= dt;
    G.hp = hp >= G.hp ? hp : G.hpT > 0 ? G.hp : Math.max(hp, G.hp - dt * 160);
    G.ar = ar >= G.ar ? ar : G.arT > 0 ? G.ar : Math.max(ar, G.ar - dt * 160);
    this.set('hp', 'text', hp);
    this.set('hpbox', 'class', 'vit hp ' + (hp <= 25 ? 'low' : hp > 100 ? 'over' : ''));
    this.width('hpfill', hp / 100); this.width('hpover', (hp - 100) / 100); this.width('hpghost', G.hp / 100);
    this.set('ar', 'text', ar);
    this.set('arbox', 'class', 'vit ar ' + (ar <= 0 ? 'zero' : ar > 100 ? 'over red' : 'yellow'));
    this.width('arfill', ar / 100); this.width('arover', (ar - 100) / 100); this.width('arghost', G.ar / 100);
    // ---- ammo: ticks with every shot, swaps its icon on a switch ----
    const wid = me.weapon, ammo = me.ammo[wid] ?? 0, inf = ammo >= INF_AMMO;
    if (this.last.amw === wid && ammo < this.last.amv) this.kick('am', 'tick');
    if (this.last.amw !== wid) { this.set('amicon', 'html', this.icon(wid)); this.kick('amicon', 'swap'); this.set('amname', 'text', WEAPONS[wid].name); this.$('ambox').style.setProperty('--wc', WCOL(wid)); }
    this.last.amw = wid; this.last.amv = ammo;
    this.set('am', 'text', inf ? '∞' : ammo);
    this.set('ambox', 'class', 'hud-ammo sway ' + (ammo <= 0 ? 'low empty' : ammo <= LOW_AMMO[wid] ? 'low' : ''));
    this.width('amfill', inf ? 1 : ammo / WEAPONS[wid].maxAmmo);
    // ---- sway: the clusters lag against turns and vertical motion and bounce on landings ----
    const sw = this.sway, v = this.view, k = this.settings.camMotion ?? 1;
    if (v && k > 0) {
      const rate = (v.dyaw || 0) / Math.max(dt, 1e-3);
      const tx = Math.max(-12, Math.min(12, -rate * 0.02)) * k;
      const ty = (v.onGround ? 0 : Math.max(-9, Math.min(9, -(v.vy || 0) * 0.012))) * k;
      if (v.onGround && !this.wasGround && (this.lastVy || 0) < -250) sw.vy += Math.min(220, -this.lastVy * 0.3) * k;
      this.wasGround = v.onGround; this.lastVy = v.vy;
      const K = 140, C = 2 * Math.sqrt(K) * 0.55, h = Math.min(dt, 0.05);
      sw.vx += ((tx - sw.x) * K - sw.vx * C) * h; sw.x += sw.vx * h;
      sw.vy += ((ty - sw.y) * K - sw.vy * C) * h; sw.y += sw.vy * h;
    } else { sw.x = sw.y = 0; }
    const sx = sw.x.toFixed(1), sy = sw.y.toFixed(1);
    if (this.last.sx !== sx || this.last.sy !== sy) { this.last.sx = sx; this.last.sy = sy; this.root.style.setProperty('--sx', sx + 'px'); this.root.style.setProperty('--sy', sy + 'px'); }
    // low ammo warning under the crosshair
    this.set('ammowarn', 'text', !me.alive ? '' : ammo <= 0 ? 'OUT OF AMMO' : ammo <= LOW_AMMO[wid] ? 'LOW AMMO' : '');

    // ---- weapon bar: pops up on switch / weapon pickup ----
    this.wbarT -= dt;
    let wl = '';
    for (const id of WEAPON_ORDER) {
      if (!me.weapons[id]) continue;
      const cls = (id === (me.switchTo || wid) ? 'cur ' : '') + (me.ammo[id] <= 0 ? 'empty' : '');
      wl += `<div class="w ${cls}" style="--wc:${WCOL(id)}"><i>${WEAPONS[id].slot}</i>${this.icon(id)}<span>${me.ammo[id] >= INF_AMMO ? '∞' : me.ammo[id]}</span></div>`;
    }
    this.set('weapons', 'html', wl);
    this.set('weapons', 'class', 'hud-wbar' + ((this.wbarT > 0 || this.settings.weaponBarAlways) && me.alive ? ' show' : ''));

    // ---- match bar: you · the clock · the leader (or, when you lead, the runner-up) ----
    const tl = g.state === 'warmup' ? g.timelimit : g.timeLeft();
    const mm = Math.floor(tl / 60), ss = Math.floor(tl % 60);
    this.set('timer', 'text', g.timelimit > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '—');
    this.set('match', 'class', 'hud-match' + (g.timelimit > 0 && g.state === 'playing' && tl <= 60 ? ' late' : ''));
    const rank = g.ranking();
    const pos = rank.indexOf(me);
    const other = pos === 0 ? rank[1] : rank[0];
    const lead = other ? me.frags - other.frags : 0;
    this.set('mtsub', 'text', g.state === 'warmup' ? 'Warmup' : !other ? `Fraglimit ${g.fraglimit}` : lead > 0 ? `Leading +${lead}` : lead < 0 ? `Behind ${lead}` : 'Tied');
    if (this.last.myFrags !== undefined && me.frags > this.last.myFrags) this.kick('mbme', 'up');
    this.last.myFrags = me.frags;
    this.set('mbmes', 'text', me.frags);
    this.set('mbmen', 'text', `${ORD(pos + 1)} · ${me.name}`);
    this.set('mbme', 'class', 'mb me' + (pos === 0 && lead > 0 ? ' lead' : ''));
    if (this.last.mePc !== me.colorCss) { this.last.mePc = me.colorCss; this.$('mbme').style.setProperty('--pc', me.colorCss); }
    this.width('mbmep', g.fraglimit ? me.frags / g.fraglimit : 0);
    this.set('mbot', 'class', 'mb other' + (other ? '' : ' none'));
    if (other) {
      this.set('mbots', 'text', other.frags);
      this.set('mbotn', 'text', `${pos === 0 ? '2nd' : '1st'} · ${other.name}`);
      if (this.last.otPc !== other.colorCss) { this.last.otPc = other.colorCss; this.$('mbot').style.setProperty('--pc', other.colorCss); }
      this.width('mbotp', g.fraglimit ? other.frags / g.fraglimit : 0);
    }

    this.set('speed', 'text', Math.round(speed) + ' ups');
    if (this.settings.showFps) this.set('fps', 'text', fps + ' fps');

    // ---- timers ----
    this.centerT -= dt; if (this.centerT <= 0) this.$('center').classList.remove('show');
    this.subT -= dt; if (this.subT <= 0) this.$('sub').classList.remove('show');
    this.pickupT -= dt; if (this.pickupT <= 0) this.$('pickup').classList.remove('show');
    this.damageT = Math.max(0, this.damageT - dt * 1.5);
    this.$('damage').style.opacity = this.damageT;
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    this.set('feed', 'html', this.feed.map((f) => `<div class="${f.me ? 'me' : ''}${f.t > f.life - 0.3 ? ' new' : ''}">${f.html}</div>`).join(''));
    this.badgeGap = (this.badgeGap || 0) - dt;
    if (this.badgeQueue?.length && this.badgeGap <= 0) { this.revealBadge(); this.badgeGap = BADGE_GAP; }
    for (const b of this.badges) b.t -= dt;
    if (this.badges.some((b) => b.t <= 0)) { this.badges = this.badges.filter((b) => b.t > 0); this.renderBadges(); }
    for (const c of this.$('badges').children) { const b = this.badges.find((x) => x.id === +c.dataset.id); if (b) c.classList.toggle('out', b.t < 0.4); }
    for (const x of this.xpLines) x.t -= dt;
    this.xpLines = this.xpLines.filter((x) => x.t > 0);
    this.set('xp', 'html', this.xpLines.map((x) => `<div>${x.html}</div>`).join(''));
    for (const a of this.awards) a.t -= dt;
    this.awards = this.awards.filter((a) => a.t > 0);
    this.set('awards', 'html', this.awards.map((a) => `<div>${esc(a.text)}</div>`).join(''));
    const els = this.$('awards').children;
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('out', this.awards[i].t < 0.5);
    for (const d of this.dirs) { d.t -= dt; d.age += dt; }
    this.dirs = this.dirs.filter((d) => d.t > 0);
    this.$('dirs').innerHTML = !v || !me.alive ? '' : this.dirs.map((d) => dirArc(d, angleDiff(yawTo(d.p[0] - v.pos[0], d.p[2] - v.pos[2]), v.yaw))).join('');
    // low health: a slow red pulse at the screen edge
    const lhp = me.alive ? me.health : 100;
    const low = lhp <= 30 ? (0.35 + 0.35 * (1 - lhp / 30)) * (0.75 + 0.25 * Math.sin(performance.now() / 1000 * (lhp <= 15 ? 9 : 5.5))) : 0;
    this.$('lowhp').style.opacity = low.toFixed(3);

    // ---- death overlay ----
    const dEl = this.$('death');
    if (!me.alive && g.state !== 'intermission') {
      const wait = Math.max(0, g.time < me.respawnAt ? me.respawnAt - g.time : 0);
      dEl.classList.remove('hidden');
      this.set('death', 'html', `${this.deathMsg || 'You died'}<small>${wait > 0 ? 'Respawn in ' + wait.toFixed(1) : 'Click or press Jump to respawn'}</small>`);
    } else dEl.classList.add('hidden');
  }

  // scoreboard: score (frags, suicides count -1), total kills, deaths, level, ping. Rebuilt a few
  // times a second at most, not every frame.
  scores(show, g, me, online = false) {
    const el = this.$('scores');
    if (g.state !== 'intermission') this.$('results').classList.add('hidden');
    if (!show) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const now = performance.now();
    if (this.scoresAt && now - this.scoresAt < 200) return;
    this.scoresAt = now;
    const rank = g.ranking();
    const totalKills = rank.reduce((a, p) => a + (p.kills || 0), 0);
    const ping = (p) => p.bot ? `<span class="bot">BOT ${p.bot.skill}</span>` : online ? (p.ping >= 0 ? p.ping : '—') : '0';
    const rows = rank.map((p, i) => `<tr class="${p === me ? 'me' : ''}${p.alive === false ? ' dead' : ''}"><td class="rk">${i + 1}</td><td class="nm"><span class="swatch" style="background:${p.colorCss}"></span><span class="lvl">${p.level || 1}</span>${esc(p.name)}</td><td class="sc">${p.frags}</td><td>${p.kills || 0}</td><td>${p.deaths}</td><td class="pg">${ping(p)}</td></tr>`).join('');
    const over = g.state === 'intermission';
    const title = over
      ? `<h2>${g.winner ? esc(g.winner.name) + ' wins!' : 'Match over'}</h2><p class="hint">${online ? 'The next map starts automatically · hold <b>Tab</b> for the scores' : '<b>Enter</b> for the next match now · hold <b>Tab</b> for the scores'}</p>`
      : `<h2>${esc(g.map.name)} — ${modeName(g.mode, g.instagib)}</h2><p class="hint">Fraglimit ${g.fraglimit}${g.timelimit ? ' · Timelimit ' + g.timelimit / 60 + ' min' : ''}</p>`;
    el.innerHTML = `${title}<table><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Kills</th><th>Deaths</th><th>Ping</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td></td><td>${rank.length} players</td><td></td><td>${totalKills}</td><td></td><td></td></tr></tfoot></table>`;
  }
}
