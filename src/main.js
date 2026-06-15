import './styles.css';
import * as THREE from 'three';
import Engine from './Engine.js';
import { loadWorld } from './AssetLoader.js';
import World from './World.js';
import Player from './Player.js';
import Doors from './Doors.js';
import Monster from './Monster.js';
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

      this.ui.setStatus('something stirs inside…');
      const monsterGltf = await Monster.load();
      this.monster = new Monster(this.engine.scene, this.world.collider, monsterGltf, this.player);

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
    if (!this.touch) this.input.requestLock(); // best-effort mouse capture (ok if denied)
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
      this.monster.update(dt);
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
