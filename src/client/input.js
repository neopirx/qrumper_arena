// Keyboard / mouse input with pointer lock. Mouse uses Quake units: degrees = counts * sens * 0.022.
export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ShiftLeft'],
  attack: ['Mouse0'],
  zoom: ['Mouse2'],
  w1: ['Digit1'], w2: ['Digit2'], w3: ['Digit3'], w4: ['Digit4'], w5: ['Digit5'],
  lastweapon: ['KeyQ'],
  scores: ['Tab'],
};

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();     // edge-triggered since last poll
    this.yaw = 0; this.pitch = 0;
    this.sensScale = 1;           // < 1 while zoomed
    this.locked = false;
    this.wheel = 0;
    this.enabled = false;
    this.onUnlock = null;
    this._key = (e) => this.key(e, true);
    this._keyUp = (e) => this.key(e, false);
    this._mouse = (e) => this.mouse(e);
    this._mdown = (e) => { if (!this.enabled) return; if (!this.locked) { this.lock(); return; } this.press('Mouse' + e.button); e.preventDefault(); };
    this._mup = (e) => { this.down.delete('Mouse' + e.button); };
    this._wheel = (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } };
    this._plc = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.down.clear(); if (this.enabled && this.onUnlock) this.onUnlock(); }
    };
    document.addEventListener('keydown', this._key);
    document.addEventListener('keyup', this._keyUp);
    document.addEventListener('mousemove', this._mouse);
    canvas.addEventListener('mousedown', this._mdown);
    document.addEventListener('mouseup', this._mup);
    canvas.addEventListener('wheel', this._wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this._plc);
  }
  lock() {
    const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(() => this.canvas.requestPointerLock());
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  press(code) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); }
  key(e, isDown) {
    if (!this.enabled) return;
    if (e.code === 'Tab' || (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow')))) e.preventDefault();
    if (e.repeat) return;
    if (isDown) this.press(e.code); else this.down.delete(e.code);
  }
  mouse(e) {
    if (!this.locked || !this.enabled) return;
    const s = this.settings.sensitivity * 0.022 * this.sensScale;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s * (this.settings.invertMouse ? -1 : 1);
    if (this.pitch > 89) this.pitch = 89;
    if (this.pitch < -89) this.pitch = -89;
    this.yaw = ((this.yaw + 180) % 360 + 360) % 360 - 180;
  }
  is(action) { for (const c of DEFAULT_BINDS[action]) if (this.down.has(c)) return true; return false; }
  was(action) { for (const c of DEFAULT_BINDS[action]) if (this.pressed.has(c)) return true; return false; }
  endFrame() { this.pressed.clear(); this.wheel = 0; }
  dispose() {
    document.removeEventListener('keydown', this._key);
    document.removeEventListener('keyup', this._keyUp);
    document.removeEventListener('mousemove', this._mouse);
    this.canvas.removeEventListener('mousedown', this._mdown);
    document.removeEventListener('mouseup', this._mup);
    document.removeEventListener('pointerlockchange', this._plc);
  }
}
