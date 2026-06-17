import * as THREE from 'three';
import { AUDIO } from './config.js';

/**
 * Tiny Web Audio helper: decodes the mp3s into buffers, plays overlapping
 * one-shots (optionally 3D-panned from a world position), and loops the
 * ambience. The listener follows the camera so the monster's laugh comes from
 * its direction.
 */
export default class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ambienceSrc = null;
    this._fwd = new THREE.Vector3();
  }

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { this.ctx = null; }
    return this;
  }

  // Fire-and-forget: each buffer becomes playable as soon as it decodes.
  loadAll() {
    if (!this.ctx) return;
    for (const name of ['jumpscare', 'footstep', 'door', 'laugh', 'ambience', 'chase']) {
      fetch(AUDIO[name])
        .then((r) => r.arrayBuffer())
        .then((a) => this.ctx.decodeAudioData(a))
        .then((b) => { this.buffers[name] = b; })
        .catch((e) => console.warn('sfx load failed:', name, e.message));
    }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    camera.getWorldDirection(this._fwd);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = this._fwd.x; l.forwardY.value = this._fwd.y; l.forwardZ.value = this._fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, 0, 1, 0);
    }
  }

  play(name, { volume = 1, rate = 1, pos = null } = {}) {
    const b = this.buffers[name];
    if (!b || !this.ctx) return;
    this.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = b; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume;
    src.connect(g);
    if (pos) {
      const pan = this.ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
      pan.refDistance = 3; pan.maxDistance = 45; pan.rolloffFactor = 1.1;
      if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; }
      else pan.setPosition(pos.x, pos.y, pos.z);
      g.connect(pan); pan.connect(this.ctx.destination);
    } else {
      g.connect(this.ctx.destination);
    }
    src.start();
  }

  // Short synthesised confirm blip for pickups (no asset needed).
  blip(freq) {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g); g.connect(this.ctx.destination); o.start(now); o.stop(now + 0.2);
  }

  startAmbience(volume) {
    if (!this.ctx || !this.buffers.ambience || this.ambienceSrc) return;
    this.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.ambience; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = volume;
    src.connect(g); g.connect(this.ctx.destination);
    src.start();
    this.ambienceSrc = src;
  }

  startChase(volume) {
    if (!this.ctx || !this.buffers.chase || this.chaseSrc) return;
    this.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.chase; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = volume;
    src.connect(g); g.connect(this.ctx.destination);
    src.start();
    this.chaseSrc = { src, g };
  }

  stopChase() {
    if (!this.chaseSrc) return;
    const { src, g } = this.chaseSrc; this.chaseSrc = null;
    try {
      const now = this.ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      src.stop(now + 0.35);
    } catch (e) { /* already stopped */ }
  }
}
