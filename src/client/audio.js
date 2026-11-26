// Spatialized sound effects. Recorded samples from assets/audio replace the procedurally
// synthesized fallbacks as soon as they are decoded; anything without a sample stays synthesized.
const SR = 44100;

function buf(ctx, secs, fn) {
  const n = Math.floor(SR * secs);
  const b = ctx.createBuffer(1, n, SR);
  const d = b.getChannelData(0);
  const st = { lp: 0, lp2: 0, hp: 0, ph: 0, ph2: 0, ph3: 0 };
  for (let i = 0; i < n; i++) d[i] = fn(i / SR, i, st);
  // normalize
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / m;
  return b;
}
const noise = () => Math.random() * 2 - 1;
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const lp = (st, k, x, key = 'lp') => (st[key] += (x - st[key]) * k);

// buffer name -> file in assets/audio (an array picks one at random per play)
const SAMPLES = {
  mg: 'machine_gun_shot', sg: 'shotgun_shot', gl: 'nade_launcher_shot', rl: 'rocket_launcher_shot', rg: 'railgun_shot',
  explode: 'rocket_explosion', glExplode: 'nade_explosion',
  health: 'health_pickup', healthSmall: 'health_pickup02', mega: 'mega_health_pickup', armor: 'armor_pickup', megaArmor: 'mega_armor_pickup',
  shard: 'armor_shard_pickup',
  weapon: 'pick_up_weapon', switch: ['equip_weapon', 'equip_weapon02', 'equip_weapon03'], noammo: 'dry_fire',
  step: 'footstep', pain: ['grunt_dmg', 'grunt_dmg2'], jump: 'grunt_jump', land: 'jump_land', pad: 'jump_pad', tele: 'teleport',
  death: ['death_scream', 'death_scream02'], gib: 'gib_explode', flesh: 'FleshHit_BW.12166', bounce: 'nade_bounce',
  healthRespawn: 'health_respawn', weaponRespawn: 'weapon_respawn',
};
// announcer lines: assets/audio/announcer/<file>.mp3, played 2D one after another (an array picks one)
const ANNOUNCER = {
  welcome: 'welcome_to_qrumper', three: '3', two: '2', one: '1', go: 'go_go_go',
  double: 'double_kill', triple: 'triple_kill', quad: 'quad_kill', monster: 'monster_kill',
  dismembered: 'dismembered', mutilated: 'mutilited', precision: 'precision', revenge: 'revenge',
  telefrag: 'telefrag', deathstreak: 'died_3_times_in_a_row',
  win: 'you_win', lose: ['you_lose', 'you_lose_02'],
};
const MUSIC = { menu: 'music/qrump_theme.mp3' };
const ANNOUNCER_DB = -9;   // the voice sits a little above the mix
const TARGET_DB = -12;   // loudest 50 ms window of every sample is brought to about this level

// Loudness of the loudest 50 ms window (dBFS) and the offset of the first audible sample.
function analyse(b) {
  const d = b.getChannelData(0), win = Math.floor(b.sampleRate * 0.05);
  let peak = 0, acc = 0;
  for (let i = 0; i < d.length; i++) {
    acc += d[i] * d[i];
    if (i >= win) acc -= d[i - win] * d[i - win];
    if (acc > peak) peak = acc;
  }
  let lead = 0;
  const maxLead = Math.floor(b.sampleRate * 0.06);
  while (lead < maxLead && lead < d.length && Math.abs(d[lead]) < 0.006) lead++;
  return { db: 10 * Math.log10(Math.max(1e-9, peak / win)), lead: lead / b.sampleRate };
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.announcerVolume = 1;
    this.musicVolume = 0.5;
    this.music = null;
    this.buffers = {};
    this.lastPlay = {};
    this.choked = new Map();
    this.voices = {};        // announcer buffers
    this.queue = [];         // pending announcer lines
    this.speaking = null;    // { src, until }
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.generate();
    this.loadSamples();
  }

  async loadSamples() {
    const ctx = this.ctx;
    const one = async (file, target = TARGET_DB) => {
      const r = await fetch(`/audio/${/\.\w+$/.test(file) ? file : file + '.wav'}`);
      if (!r.ok) throw new Error(file + ': ' + r.status);
      const b = await ctx.decodeAudioData(await r.arrayBuffer());
      const a = analyse(b);
      b.gain = Math.min(2.5, Math.max(0.25, Math.pow(10, (target - a.db) / 20)));
      b.lead = a.lead;
      return b;
    };
    // announcer: no synthesized stand-ins, a line without a file is simply not spoken
    Promise.all(Object.entries(ANNOUNCER).map(async ([name, files]) => {
      try {
        const bufs = await Promise.all([].concat(files).map((f) => one(`announcer/${f}.mp3`, ANNOUNCER_DB)));
        this.voices[name] = bufs.length > 1 ? bufs : bufs[0];
      } catch (e) { console.warn('announcer line missing:', e.message); }
    }));
    await Promise.all(Object.entries(SAMPLES).map(async ([name, files]) => {
      try {
        const bufs = await Promise.all([].concat(files).map(one));
        this.buffers[name] = bufs.length > 1 ? bufs : bufs[0];
      } catch (e) { console.warn('sound sample failed, keeping the synthesized one:', e.message); }
    }));
  }

  // Queue an announcer line. Lines never overlap; `cut` interrupts whatever is being said (countdown),
  // and lines that waited too long are dropped so the voice never lags behind the action.
  announce(name, { cut = false, maxWait = 2.5 } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (cut) {
      this.queue.length = 0;
      if (this.speaking) { try { this.speaking.src.stop(); } catch (e) { /* done */ } this.speaking = null; }
    }
    if (this.queue.some((q) => q.name === name)) return;
    this.queue.push({ name, expire: now + maxWait });
    this.pumpAnnouncer();
  }

  clearAnnouncer() { this.announce('__none__', { cut: true }); this.queue.length = 0; }

  pumpAnnouncer() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.speaking && now < this.speaking.until) return;
    this.speaking = null;
    while (this.queue.length) {
      const q = this.queue.shift();
      let b = this.voices[q.name];
      if (Array.isArray(b)) b = b[Math.floor(Math.random() * b.length)];
      if (!b || now > q.expire) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const g = this.ctx.createGain();
      g.gain.value = (b.gain || 1) * this.announcerVolume;
      src.connect(g); g.connect(this.master);
      src.start(now, b.lead || 0);
      this.speaking = { src, until: now + b.duration - (b.lead || 0) - 0.05 };
      return;
    }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // ---- music: streamed through an <audio> element (long files, no need to decode up front).
  // Browsers only start audio after a user gesture, so playMusic() before that is remembered
  // and retried on the first click / key press.
  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.el.volume = this.music.fading ? this.music.el.volume : v;
    if (this.music && v <= 0) this.music.el.pause();
    else if (this.music && this.music.want && this.music.el.paused) this.music.el.play().catch(() => {});
  }
  playMusic(name) {
    const file = MUSIC[name];
    if (!file) return;
    if (this.music && this.music.name === name) {
      this.music.want = true; this.music.fading = false; clearInterval(this.music.fade);
      this.music.el.volume = this.musicVolume ?? 0.5;
      if (this.music.el.paused && this.musicVolume > 0) this.music.el.play().catch(() => this.retryMusic());
      return;
    }
    this.stopMusic(0);
    const el = new window.Audio(`/audio/${file}`);
    el.loop = true;
    el.volume = this.musicVolume ?? 0.5;
    this.music = { name, el, want: true, fading: false, fade: null };
    if (this.musicVolume > 0) el.play().catch(() => this.retryMusic());
  }
  retryMusic() {
    if (this._musicRetry) return;
    this._musicRetry = () => {
      window.removeEventListener('pointerdown', this._musicRetry, true);
      window.removeEventListener('keydown', this._musicRetry, true);
      this._musicRetry = null;
      if (this.music && this.music.want && this.musicVolume > 0) this.music.el.play().catch(() => {});
    };
    window.addEventListener('pointerdown', this._musicRetry, true);
    window.addEventListener('keydown', this._musicRetry, true);
  }
  // fade the current track out over `secs` and pause it (it resumes where it was on playMusic)
  stopMusic(secs = 1.2) {
    const m = this.music;
    if (!m) return;
    m.want = false;
    clearInterval(m.fade);
    if (secs <= 0) { m.el.pause(); return; }
    m.fading = true;
    const start = m.el.volume, t0 = performance.now();
    m.fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
      m.el.volume = start * (1 - k);
      if (k >= 1) { clearInterval(m.fade); m.fading = false; m.el.pause(); }
    }, 50);
  }

  generate() {
    const c = this.ctx, B = this.buffers;
    B.mg = buf(c, 0.12, (t, i, s) => { const n = lp(s, 0.35, noise()); return (n * 0.8 + Math.sin(t * 2 * Math.PI * 120) * 0.6 * Math.exp(-t * 60)) * env(t, 0.001, 0.025); });
    B.sg = buf(c, 0.5, (t, i, s) => { const n = lp(s, 0.18, noise()); return (n + Math.sin(t * 2 * Math.PI * (70 - t * 60)) * 0.9 * Math.exp(-t * 18)) * env(t, 0.002, 0.08); });
    B.rl = buf(c, 0.6, (t, i, s) => { const n = lp(s, 0.05 + t * 0.2, noise()); return (n * 1.2 + Math.sin(t * 2 * Math.PI * (90 + t * 60)) * 0.4) * env(t, 0.01, 0.18); });
    B.explode = buf(c, 1.6, (t, i, s) => { const n = lp(s, 0.06 * Math.exp(-t * 1.5) + 0.01, noise()); const sub = Math.sin(2 * Math.PI * (55 - t * 25) * t) * Math.exp(-t * 5); return (n * 2.2 + sub * 0.9) * env(t, 0.003, 0.35); });
    B.gl = buf(c, 0.3, (t, i, s) => { const n = lp(s, 0.2, noise()); return (n * 0.8 + Math.sin(t * 2 * Math.PI * (150 - t * 200)) * 0.7) * env(t, 0.002, 0.06); });
    B.bounce = buf(c, 0.12, (t, i, s) => { s.ph += 2 * Math.PI * 700 / SR; return (Math.sin(s.ph) * 0.6 + lp(s, 0.4, noise()) * 0.5) * env(t, 0.001, 0.02); });
    B.rg = buf(c, 1.1, (t, i, s) => {
      s.ph += 2 * Math.PI * (2200 * Math.exp(-t * 6) + 180) / SR;
      s.ph2 += 2 * Math.PI * 92 / SR;
      const zap = Math.sin(s.ph + Math.sin(s.ph2 * 7) * 2) * env(t, 0.001, 0.12);
      const hum = (Math.sin(s.ph2) + Math.sin(s.ph2 * 2.02) * 0.5) * env(t, 0.05, 0.4) * 0.5;
      return zap + hum + lp(s, 0.4, noise()) * env(t, 0.001, 0.02);
    });
    B.jump = buf(c, 0.2, (t, i, s) => { s.ph += 2 * Math.PI * (180 + t * 400) / SR; const v = Math.sin(s.ph) + Math.sin(s.ph * 2) * 0.5 + Math.sin(s.ph * 3) * 0.25; return lp(s, 0.25, v) * env(t, 0.01, 0.06); });
    B.land = buf(c, 0.15, (t, i, s) => lp(s, 0.08, noise()) * env(t, 0.001, 0.03));
    B.step = buf(c, 0.08, (t, i, s) => lp(s, 0.12, noise()) * env(t, 0.001, 0.012));
    B.pain = buf(c, 0.3, (t, i, s) => { s.ph += 2 * Math.PI * (220 - t * 200) / SR; const saw = ((s.ph / (2 * Math.PI)) % 1) * 2 - 1; return lp(s, 0.12, saw) * env(t, 0.01, 0.1); });
    B.death = buf(c, 0.9, (t, i, s) => { s.ph += 2 * Math.PI * (200 - t * 140) / SR; const saw = ((s.ph / (2 * Math.PI)) % 1) * 2 - 1; return lp(s, 0.1, saw + noise() * 0.2) * env(t, 0.02, 0.3); });
    B.gib = buf(c, 0.7, (t, i, s) => lp(s, 0.15, noise()) * env(t, 0.002, 0.15) * (1 + Math.sin(t * 90) * 0.5));
    B.health = buf(c, 0.4, (t, i, s) => { const f = t < 0.1 ? 660 : t < 0.2 ? 880 : 1100; s.ph += 2 * Math.PI * f / SR; return Math.sin(s.ph) * env(t % 0.1, 0.002, 0.08) * 0.8; });
    B.mega = buf(c, 1.0, (t) => (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t) + Math.sin(2 * Math.PI * 660 * t) + Math.sin(2 * Math.PI * 880 * t) * 0.5) * env(t, 0.01, 0.35));
    B.armor = buf(c, 0.45, (t, i, s) => { const m = Math.sin(2 * Math.PI * 1250 * t) * 0.5 + Math.sin(2 * Math.PI * 1873 * t) * 0.4 + Math.sin(2 * Math.PI * 3100 * t) * 0.2; return (m + lp(s, 0.5, noise()) * 0.4 * Math.exp(-t * 60)) * env(t, 0.001, 0.12); });
    B.shard = buf(c, 0.25, (t) => (Math.sin(2 * Math.PI * 2400 * t) * 0.6 + Math.sin(2 * Math.PI * 3600 * t) * 0.3) * env(t, 0.001, 0.06));
    B.weapon = buf(c, 0.35, (t, i, s) => { const clk = t < 0.03 ? noise() : (t > 0.14 && t < 0.17 ? noise() : 0); return lp(s, 0.5, clk) + Math.sin(2 * Math.PI * 300 * t) * env(t, 0.001, 0.05) * 0.3; });
    B.ammo = buf(c, 0.15, (t, i, s) => lp(s, 0.5, t < 0.02 || (t > 0.07 && t < 0.09) ? noise() : 0));
    B.hit = buf(c, 0.07, (t) => Math.sin(2 * Math.PI * 1800 * t) * env(t, 0.001, 0.018));
    B.kill = buf(c, 0.35, (t) => (Math.sin(2 * Math.PI * 1320 * t) + Math.sin(2 * Math.PI * 1980 * t) * 0.6) * env(t, 0.002, 0.1));
    B.pad = buf(c, 0.5, (t, i, s) => { s.ph += 2 * Math.PI * (90 + t * 500) / SR; return (Math.sin(s.ph) + lp(s, 0.1, noise()) * 0.6) * env(t, 0.005, 0.12); });
    B.tele = buf(c, 0.9, (t, i, s) => { s.ph += 2 * Math.PI * (300 + t * 1600) / SR; s.ph2 += 2 * Math.PI * (310 + t * 1500) / SR; return (Math.sin(s.ph) + Math.sin(s.ph2)) * env(t, 0.02, 0.25) * 0.5 + lp(s, 0.2, noise()) * 0.2 * env(t, 0.01, 0.3); });
    B.noammo = buf(c, 0.06, (t, i, s) => lp(s, 0.6, t < 0.01 ? noise() : 0));
    B.switch = buf(c, 0.12, (t, i, s) => lp(s, 0.4, t < 0.015 || (t > 0.06 && t < 0.075) ? noise() : 0) * 0.7);
    B.walljump = buf(c, 0.25, (t, i, s) => { s.ph += 2 * Math.PI * (140 + t * 500) / SR; return (Math.sin(s.ph) * 0.6 + lp(s, 0.2, noise()) * 0.5) * env(t, 0.003, 0.07); });
    B.rocketLoop = buf(c, 1.0, (t, i, s) => lp(s, 0.04, noise()) * (0.8 + 0.2 * Math.sin(t * 2 * Math.PI * 12)));
    B.glExplode = B.explode;
    B.megaArmor = B.armor;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const s = 1 / 64; // world units -> "meters"-ish for the panner
    if (L.positionX) {
      L.positionX.value = pos.x * s; L.positionY.value = pos.y * s; L.positionZ.value = pos.z * s;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(pos.x * s, pos.y * s, pos.z * s);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // play(name, pos|null (null = 2D), {volume, rate, loop})
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.buffers[name]) return null;
    let buffer = this.buffers[name];
    if (Array.isArray(buffer)) buffer = buffer[Math.floor(Math.random() * buffer.length)];
    const now = this.ctx.currentTime;
    // simple voice limiting for rapid-fire sounds
    const key = name + (pos ? Math.round(pos[0] / 64) + ',' + Math.round(pos[2] / 64) : '');
    if (!opts.loop && this.lastPlay[key] && now - this.lastPlay[key] < 0.02) return null;
    this.lastPlay[key] = now;
    // choke: a new shot cuts the previous one's tail (rapid-fire weapons with long samples)
    if (opts.choke) {
      const prev = this.choked.get(opts.choke);
      if (prev) { try { prev.gainNode.gain.setTargetAtTime(0, now, 0.03); prev.stop(now + 0.2); } catch (e) { /* already stopped */ } }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (opts.rate || 1) * (opts.noVary ? 1 : 0.95 + Math.random() * 0.1);
    src.loop = !!opts.loop;
    const g = this.ctx.createGain();
    g.gain.value = (opts.volume ?? 1) * (buffer.gain || 1);
    src.connect(g);
    let out = g;
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 3; p.maxDistance = 60; p.rolloffFactor = 1.1;
      const s = 1 / 64;
      if (p.positionX) { p.positionX.value = pos[0] * s; p.positionY.value = pos[1] * s; p.positionZ.value = pos[2] * s; }
      else p.setPosition(pos[0] * s, pos[1] * s, pos[2] * s);
      g.connect(p);
      out = p;
      src.panner = p;
    }
    out.connect(this.master);
    src.start(now, opts.loop ? 0 : buffer.lead || 0);
    src.gainNode = g;
    if (opts.choke) this.choked.set(opts.choke, src);
    return src;
  }

  move(src, pos) {
    if (!src || !src.panner) return;
    const s = 1 / 64, p = src.panner;
    if (p.positionX) { p.positionX.value = pos[0] * s; p.positionY.value = pos[1] * s; p.positionZ.value = pos[2] * s; }
    else p.setPosition(pos[0] * s, pos[1] * s, pos[2] * s);
  }
  stop(src) { try { src && src.stop(); } catch (e) { /* already stopped */ } }
}
