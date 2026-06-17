import './styles.css';
import * as THREE from 'three';
import Engine from './Engine.js';
import { loadWorld } from './AssetLoader.js';
import World from './World.js';
import Player from './Player.js';
import Doors from './Doors.js';
import Monster from './Monster.js';
import Pickups from './Pickups.js';
import Flashlight from './Flashlight.js';
import Input from './Input.js';
import PostFX from './PostFX.js';
import UI from './UI.js';
import Sfx from './Sfx.js';
import { getPreset, isTouchDevice } from './Quality.js';
import { ASSET_URL, MONSTER, AUDIO, INTERIOR } from './config.js';

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
      this.sfx = new Sfx().init();
      this.sfx.loadAll();              // decode mp3s in the background

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
      this.monster.onCaught = () => this._jumpscare();

      this.paperCount = 0;
      const paperGltf = await Pickups.loadPaper();
      this.pickups = new Pickups(this.engine.scene, this.world.collider, this.player, paperGltf, {
        onPaper: () => this._onPaper(),
      });
      this.ui.setBooks(0, this.pickups.total);

      // Missions (more objectives will be added as the game grows).
      this.objIndex = 0;
      this._objCompleting = false;
      this.objectives = [
        { text: 'Get inside the house', check: () => this._isInsideHouse() },
      ];

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
    this.sfx.resume();                   // unlock WebAudio under this click gesture
    this.sfx.startAmbience(AUDIO.ambienceVolume);
    if (this.objIndex < this.objectives.length) this.ui.setObjective(this.objectives[this.objIndex].text);
    if (!this.touch) this.input.requestLock(); // best-effort mouse capture (ok if denied)
  }

  _isInsideHouse() {
    const p = this.player.position;
    const i = INTERIOR;
    if (p.x < i.minX || p.x > i.maxX || p.z < i.minZ || p.z > i.maxZ) return false;
    const floor = this.world.collider.groundY(p.x, p.z, p.y + 0.3);
    return floor != null && floor > i.floorAbove; // on the interior floor, not the yard
  }

  _checkObjectives() {
    if (this._objCompleting || this.objIndex >= this.objectives.length) return;
    if (this.objectives[this.objIndex].check()) {
      this._objCompleting = true;
      this.ui.completeObjective();
      setTimeout(() => {
        this._objCompleting = false;
        this.objIndex++;
        if (this.objIndex < this.objectives.length) this.ui.setObjective(this.objectives[this.objIndex].text);
        else this.ui.hideObjective();
      }, 2200);
    }
  }

  // ---------------- jumpscare ----------------
  _jumpscare() {
    if (this.state === 'scare') return;
    this.state = 'scare';
    this.scareT = 0;
    this._deathShown = false;
    this._chasing = false;
    this.sfx.stopChase();
    if (this.input.locked) this.input.exitLock();
    this.monster.attackPose();   // play the Attack clip
    this.ui.showScare();
    this.sfx.play('jumpscare', { volume: AUDIO.jumpscareVolume });
  }

  _scareFrame(dt) {
    const cam = this.engine.camera;
    const m = this.monster;
    const fwd = this._fwd || (this._fwd = new THREE.Vector3());
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    m.root.position.copy(cam.position).addScaledVector(fwd, 1.7);
    m.root.position.y = cam.position.y - 1.75;
    m.root.rotation.y = Math.atan2(-fwd.x, -fwd.z) + MONSTER.facingOffset;
    m.tickMixer(dt);             // advance the attack animation

    if (this.scareT < 1.0) {
      cam.position.x += (Math.random() - 0.5) * 0.06;
      cam.position.y += (Math.random() - 0.5) * 0.06;
      cam.rotation.z = (Math.random() - 0.5) * 0.08;
    } else {
      cam.rotation.z = 0;
    }
    this.flashlight.update(dt, cam);

    if (this.scareT > 1.2 && !this._deathShown) { this._deathShown = true; this.ui.showDeath(); }
    if (this.scareT > 3.4) this._respawn();
  }

  _respawn() {
    this.ui.hideScare();
    this.engine.camera.rotation.z = 0;
    this.player.spawn(this.world.spawnPoint, this.world.spawnYaw, this.world.spawnPitch);
    this.player._applyCamera(0);
    this.monster.reset();
    this.state = 'playing';
    if (!this.touch) this.input.requestLock();
  }

  // ---------------- pickups / win ----------------
  _onPaper() {
    this.paperCount++;
    this.ui.setBooks(this.paperCount, this.pickups.total);
    this.sfx.blip(880);
    if (this.paperCount >= this.pickups.total) this._win();
  }

  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    this._chasing = false;
    this.sfx.stopChase();
    if (this.input.locked) this.input.exitLock();
    this.ui.showWin(() => location.reload());
  }

  // a footstep sound every stride of horizontal movement on the ground
  _footsteps(dt) {
    const sh = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (this.player.onGround && sh > 0.6) {
      this._stepAccum = (this._stepAccum || 0) + sh * dt;
      if (this._stepAccum >= AUDIO.footstepStride) {
        this._stepAccum = 0;
        this.sfx.play('footstep', { volume: AUDIO.footstepVolume, rate: 0.92 + Math.random() * 0.16 });
      }
    } else {
      this._stepAccum = AUDIO.footstepStride; // so the first step plays as soon as you move
    }
  }

  // the monster laughs from its position at random intervals
  _laughs(dt) {
    this._laughCd = (this._laughCd ?? (AUDIO.laughEvery[0] * 0.6)) - dt;
    if (this._laughCd <= 0) {
      this.sfx.play('laugh', { volume: AUDIO.laughVolume, pos: this.monster.root.position });
      this._laughCd = AUDIO.laughEvery[0] + Math.random() * (AUDIO.laughEvery[1] - AUDIO.laughEvery[0]);
    }
  }

  // chase music loops while the monster is hunting; stops when it gives up
  _chaseMusic() {
    const chasing = this.monster.state === 'chase';
    if (chasing && !this._chasing) this.sfx.startChase(AUDIO.chaseVolume);
    else if (!chasing && this._chasing) this.sfx.stopChase();
    this._chasing = chasing;
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
      this.pickups.update(dt);

      this.sfx.setListener(this.engine.camera);
      this.sfx.startAmbience(AUDIO.ambienceVolume); // starts once the buffer is ready
      this._footsteps(dt);
      this._laughs(dt);
      this._chaseMusic();
      this._checkObjectives();

      if (this.input.consumeEdge('interact')) {
        if (this.doors.interact(this.engine.camera)) this.sfx.play('door', { volume: AUDIO.doorVolume });
        this.pickups.tryInteract();
      }
      this.doors.update(dt, this.engine.camera, (txt) => this.ui.setPrompt(txt));
      if (this.input.consumeEdge('pause')) {
        if (this.input.locked) this.input.exitLock(); // pointerlockchange → pause
        else this._pause();                            // no lock: pause directly
      }
    } else if (this.state === 'scare') {
      this.scareT += dt;
      this.world.update(dt, this.engine.camera.position);
      this._scareFrame(dt);
      this.input.consumeEdge('pause');
      this.input.consumeEdge('interact');
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
