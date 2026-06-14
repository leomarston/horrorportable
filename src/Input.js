/**
 * Unified input: keyboard + pointer-lock mouse + touch (virtual stick & look).
 * Movement is exposed as a normalized vector; look deltas are accumulated and
 * consumed once per frame by the player.
 */
export default class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };       // x = strafe (+right), y = forward (+fwd)
    this._look = { x: 0, y: 0 };
    this.run = false;
    this.crouch = false;
    this._edges = { jump: false, flashlight: false, pause: false, interact: false };
    this.locked = false;
    this._dragging = false;

    this._touch = { active: false, moveId: null, lookId: null, ox: 0, oy: 0, lx: 0, ly: 0, runHeld: false };
    this._touchMove = { x: 0, y: 0 };

    this._bindKeyboard();
    this._bindMouse();
  }

  // ---------------- keyboard ----------------
  _bindKeyboard() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      this.keys.add(c);
      if (c === 'Space') this._edges.jump = true;
      if (c === 'KeyF') this._edges.flashlight = true;
      if (c === 'KeyE') this._edges.interact = true;
      if (c === 'Escape') this._edges.pause = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
    }, { passive: false });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  _readKeys() {
    const k = this.keys;
    const fwd = k.has('KeyW') || k.has('ArrowUp');
    const back = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    let mx = (right ? 1 : 0) - (left ? 1 : 0);
    let my = (fwd ? 1 : 0) - (back ? 1 : 0);
    this.run = k.has('ShiftLeft') || k.has('ShiftRight') || this._touch.runHeld;
    this.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    return { mx, my };
  }

  // ---------------- mouse ----------------
  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    // Look works either via pointer-lock OR click-drag (fallback when lock is
    // unavailable, e.g. inside an embedded/secured preview frame).
    this.canvas.addEventListener('mousedown', () => { this._dragging = true; });
    addEventListener('mouseup', () => { this._dragging = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked || this._dragging) {
        this._look.x += e.movementX || 0;
        this._look.y += e.movementY || 0;
      }
    });
  }

  requestLock() {
    if (!this.canvas.requestPointerLock) return;
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {}); // ignore denial (we don't depend on it)
  }
  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  // ---------------- touch ----------------
  enableTouch(els) {
    const { stick, knob, look, runBtn, lightBtn, useBtn } = els;
    const t = this._touch;
    const R = () => stick.clientWidth * 0.5;

    stick.addEventListener('pointerdown', (e) => {
      t.moveId = e.pointerId; t.ox = e.clientX; t.oy = e.clientY;
      try { stick.setPointerCapture(e.pointerId); } catch (_) { /* some browsers reject this */ }
    });
    stick.addEventListener('pointermove', (e) => {
      if (t.moveId !== e.pointerId) return;
      let dx = (e.clientX - t.ox) / R();
      let dy = (e.clientY - t.oy) / R();
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this._touchMove.x = dx; this._touchMove.y = -dy;
      knob.style.transform = `translate(${-50 + dx * 35}%, ${-50 + dy * 35}%)`;
    });
    const endStick = (e) => {
      if (t.moveId !== e.pointerId) return;
      t.moveId = null; this._touchMove.x = 0; this._touchMove.y = 0;
      knob.style.transform = 'translate(-50%,-50%)';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    look.addEventListener('pointerdown', (e) => { t.lookId = e.pointerId; t.lx = e.clientX; t.ly = e.clientY; });
    look.addEventListener('pointermove', (e) => {
      if (t.lookId !== e.pointerId) return;
      this._look.x += (e.clientX - t.lx) * 1.4;
      this._look.y += (e.clientY - t.ly) * 1.4;
      t.lx = e.clientX; t.ly = e.clientY;
    });
    const endLook = (e) => { if (t.lookId === e.pointerId) t.lookId = null; };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    runBtn.addEventListener('pointerdown', () => { t.runHeld = !t.runHeld; runBtn.classList.toggle('active', t.runHeld); });
    lightBtn.addEventListener('pointerdown', () => { this._edges.flashlight = true; });
    if (useBtn) useBtn.addEventListener('pointerdown', () => { this._edges.interact = true; });
  }

  // ---------------- frame API ----------------
  update() {
    const { mx, my } = this._readKeys();
    // Keyboard when pressed, otherwise the touch stick (and reset to zero when
    // neither is active so movement never sticks after release).
    if (mx !== 0 || my !== 0) { this.move.x = mx; this.move.y = my; }
    else { this.move.x = this._touchMove.x; this.move.y = this._touchMove.y; }
  }

  consumeLook() {
    const l = { x: this._look.x, y: this._look.y };
    this._look.x = 0; this._look.y = 0;
    return l;
  }

  consumeEdge(name) {
    if (this._edges[name]) { this._edges[name] = false; return true; }
    return false;
  }
}
