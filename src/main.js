import './styles.css';
import * as THREE from 'three';
import Engine from './Engine.js';
import { loadWorld } from './AssetLoader.js';
import World from './World.js';
import Player from './Player.js';
import Doors from './Doors.js';
import Pickups from './Pickups.js';
import Flashlight from './Flashlight.js';
import Input from './Input.js';
import PostFX from './PostFX.js';
import UI from './UI.js';
import { getPreset, isTouchDevice } from './Quality.js';
import { ASSET_URL } from './config.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class Game {
  constructor() {
    this.ui = new UI();
    this.canvas = document.getElementById('scene');
    this.preset = getPreset(); // always Low — no quality selector
    this.touch = isTouchDevice();
    this.state = 'loading';
    this.statsOn = false;
    this.clock = new THREE.Clock();
    this._statAcc = 0;
    if (typeof window !== 'undefined') window.__GAME = this; // debug/automation handle
    this.init();
  }

  async init() {
    try {
      this.engine = new Engine(this.canvas, this.preset);
      this.input = new Input(this.canvas);

      this.ui.setStatus('summoning the house…');
      const gltf = await loadWorld(ASSET_URL, (p) => this.ui.setProgress(p * 0.9));

      this.ui.setStatus('building the dark…');
      await nextFrame(); // let the bar paint before the heavy build

      this.world = new World(this.engine, gltf, this.preset);
      this.ui.setProgress(0.96);

      this.postfx = new PostFX(this.engine, this.preset);
      this.engine.setComposer(this.postfx.composer);

      this.flashlight = new Flashlight(this.engine.scene, this.preset);
      this.player = new Player(this.engine.camera, this.world.collider, this.input);
      this.player.spawn(this.world.spawnPoint, this.world.spawnYaw, this.world.spawnPitch);
      this.player._applyCamera(0);

      this.doors = new Doors(this.engine.scene, this.engine.camera);
      this.player.extraColliders = this.doors.colliders;

      this.bookCount = 0;
      this.pickups = new Pickups(this.engine.scene, this.world.collider, this.player, this.flashlight, {
        onBook: () => this._onBook(),
        onBattery: () => this._onBattery(),
      });
      this.ui.setBooks(0, this.pickups.bookTotal);

      // Pre-compile shaders so the first movements don't hitch.
      this.engine.renderer.compile(this.engine.scene, this.engine.camera);
      this.ui.setProgress(1);

      if (this.touch) this._setupTouch();
      this._setupPauseHooks();

      this.ui.showStart({
        deviceHint: this.touch
          ? 'Touch detected — on-screen controls enabled.'
          : 'Optimized to run smoothly on any device.',
        onEnter: () => this._enter(),
      });
      this.state = 'menu';
      this._loop();
    } catch (err) {
      console.error(err);
      this.ui.setStatus('Failed to load the house — see console.');
    }
  }

  _enter() {
    this.ui.enterGame();
    this.state = 'playing';              // play immediately — never gate on pointer-lock
    this._initAudio();                   // unlock WebAudio under this click gesture
    if (!this.touch) this.input.requestLock(); // best-effort mouse capture (ok if denied)
  }

  _initAudio() {
    if (this.audio) { if (this.audio.state === 'suspended') this.audio.resume(); return; }
    try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audio = null; }
  }

  // ---------------- pickups / win ----------------
  _onBook() {
    this.bookCount++;
    this.ui.setBooks(this.bookCount, this.pickups.bookTotal);
    this._blip(880);
    if (this.bookCount >= this.pickups.bookTotal) this._win();
  }

  _onBattery() { this._blip(420); }

  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    if (this.input.locked) this.input.exitLock();
    this.ui.showWin(() => location.reload());
  }

  _blip(freq) {
    const ac = this.audio; if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const now = ac.currentTime;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now + 0.2);
  }

  _setupTouch() {
    this.ui.showTouch();
    this.input.enableTouch({
      stick: document.getElementById('touch-move'),
      knob: document.querySelector('#touch-move .touch-knob'),
      look: document.getElementById('touch-look'),
      runBtn: document.getElementById('touch-run'),
      lightBtn: document.getElementById('touch-light'),
      useBtn: document.getElementById('touch-use'),
    });
  }

  _setupPauseHooks() {
    document.addEventListener('pointerlockchange', () => {
      if (this.state === 'loading' || this.state === 'menu') return;
      if (this.input.locked) { this.state = 'playing'; this.ui.hidePause(); }
      else if (this.state === 'playing') this._pause(); // lost lock while playing (Esc) → pause
    });
    // Click in-game to (re)capture the mouse, when pointer-lock is available.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.touch && !this.input.locked) this.input.requestLock();
    });
  }

  _pause() {
    if (this.touch) return;
    this.state = 'paused';
    this.ui.showPause({
      statsOn: this.statsOn,
      onToggleStats: () => { this.statsOn = !this.statsOn; this.ui.setStatsVisible(this.statsOn); },
      onResume: () => { this.ui.hidePause(); this.state = 'playing'; this.input.requestLock(); },
    });
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    let dt = this.clock.getDelta();
    if (dt > 0.05) dt = 0.05; // clamp big hitches (tab refocus etc.)

    if (this.state !== 'loading' && this.input.consumeEdge('flashlight')) this.flashlight.toggle();

    if (this.state === 'playing') {
      this.input.update();
      this.player.update(dt);
      this.flashlight.update(dt, this.engine.camera);
      this.world.update(dt, this.player.position);
      this.pickups.update(dt);
      this.ui.setBattery(this.flashlight.battery);
      if (this.input.consumeEdge('interact')) this.doors.interact(this.engine.camera);
      this.doors.update(dt, this.engine.camera, (txt) => this.ui.setPrompt(txt));
      if (this.input.consumeEdge('pause')) {
        if (this.input.locked) this.input.exitLock(); // pointerlockchange → pause
        else this._pause();                            // no lock: pause directly
      }
    } else if (this.world) {
      // keep the world breathing behind the menus
      this.flashlight.update(dt, this.engine.camera);
      this.world.update(dt, this.player ? this.player.position : this.engine.camera.position);
      this.ui.setPrompt(null);
      this.input.consumeEdge('pause');
      this.input.consumeEdge('interact');
    }

    if (this.postfx) this.postfx.tick(dt);
    this.engine.render(dt);
    this._updateStats(dt);
  }

  _updateStats(dt) {
    if (!this.statsOn) return;
    this._statAcc += dt;
    if (this._statAcc < 0.25) return;
    this._statAcc = 0;
    const info = this.engine.renderer.info;
    const fps = this.engine.lastFps ? this.engine.lastFps.toFixed(0) : (1 / dt).toFixed(0);
    const p = this.player.position;
    this.ui.setStats(
      `FPS  ${fps}\nres  ${this.engine.renderScale.toFixed(2)}x\ndraws ${info.render.calls}\ntris  ${info.render.triangles}\n` +
      `pos  ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${this.input.locked ? '(locked)' : '(drag-look)'}`
    );
  }
}

new Game();
