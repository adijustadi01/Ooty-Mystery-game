// First-person input: mouse + keyboard on desktop, virtual joystick + drag-to-look on touch screens.
export class Controls {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;               // { onInteract(point|null), onUnlock(), onKey(code) }
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.enabled = false;
    this.locked = false;
    this.lockFailed = false;
    this.lockErrors = 0;
    this.suppressUnlock = false;
    this.mouse = null;                // cursor position when pointer lock is unavailable
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.bindDesktop();
    this.bindTouch();
  }

  get usesCursor() { return !this.isTouch && (this.lockFailed || !this.canvas.requestPointerLock); }

  look(dx, dy, k) {
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy * k));
  }

  bindDesktop() {
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.hooks.onKey?.(e.code, e);
      if (this.enabled) this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      // a lock request can resolve after the game has already moved to a menu
      if (this.locked && !this.enabled) { this.unlock(); return; }
      if (!this.locked && this.enabled && !this.suppressUnlock) this.hooks.onUnlock?.();
      this.suppressUnlock = false;
      this.hooks.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockError());

    let down = null;
    this.canvas.addEventListener('mousedown', e => {
      if (this.isTouch || e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    addEventListener('mousemove', e => {
      if (this.isTouch) return;
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.enabled) return;
      // Chrome occasionally reports a huge bogus delta right after pointer lock engages; drop it.
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      if (this.locked) this.look(e.movementX, e.movementY, 0.0022);
      else if (down) {
        down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        this.look(e.movementX, e.movementY, 0.004);
      }
    });
    addEventListener('mouseup', e => {
      if (this.isTouch || !down) return;
      const wasClick = down.moved < 6;
      down = null;
      if (!this.enabled || !wasClick || e.target !== this.canvas) return;
      if (this.locked) this.hooks.onInteract(null);
      else if (this.usesCursor) this.hooks.onInteract({ x: e.clientX, y: e.clientY });
      else this.lock(true);
    });
  }

  // Pointer lock can be refused (sandboxed iframes, or briefly after Esc). Only give up and fall back
  // to drag-to-look after repeated refusals of a direct click.
  lock(fromClick = false) {
    if (this.isTouch || this.lockFailed || !this.canvas.requestPointerLock) return;
    this.lockFromClick = fromClick;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.lockError());
    } catch { this.lockError(); }
  }

  lockError() {
    if (this.lockFromClick && ++this.lockErrors >= 2) this.lockFailed = true;
    this.lockFromClick = false;
    this.hooks.onLockChange?.(false);
  }

  unlock() {
    if (document.pointerLockElement) {
      this.suppressUnlock = true;
      document.exitPointerLock();
    }
  }

  bindTouch() {
    const joyEl = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let joyId = null, joyCenter = null, lookId = null, last = null, start = null;
    const R = 50;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x}px, ${y}px)`; };

    joyEl.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const r = joyEl.getBoundingClientRect();
      joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { passive: false });

    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier;
      last = start = { x: t.clientX, y: t.clientY, time: performance.now() };
    }, { passive: false });

    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          let dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx *= R / len; dy *= R / len; }
          setKnob(dx, dy);
          this.joy.x = dx / R;
          this.joy.y = dy / R;
        } else if (t.identifier === lookId) {
          if (this.enabled) this.look(t.clientX - last.x, t.clientY - last.y, 0.006);
          last = { x: t.clientX, y: t.clientY };
        }
      }
      if (joyId !== null || lookId !== null) e.preventDefault();
    }, { passive: false });

    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyId = null; this.joy.x = this.joy.y = 0; setKnob(0, 0); }
        if (t.identifier === lookId) {
          lookId = null;
          const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
          if (this.enabled && moved < 12 && performance.now() - start.time < 350) this.hooks.onInteract({ x: t.clientX, y: t.clientY });
        }
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
  }

  // forward (+1) / strafe-right (+1) input
  move() {
    let f = 0, s = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    f -= this.joy.y;
    s += this.joy.x;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    return { f, s, run: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  reset() { this.keys.clear(); this.joy.x = this.joy.y = 0; }
}
