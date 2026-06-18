import './styles.css';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import Engine from './Engine.js';
import { loadWorld } from './AssetLoader.js';
import World from './World.js';
import Player from './Player.js';
import Doors from './Doors.js';
import Safe from './Safe.js';
import Gun from './Gun.js';
import Key from './Key.js';
import Monster from './Monster.js';
import Pickups from './Pickups.js';
import Flashlight from './Flashlight.js';
import Input from './Input.js';
import PostFX from './PostFX.js';
import UI from './UI.js';
import Sfx from './Sfx.js';
import { getPreset, isTouchDevice } from './Quality.js';
import { ASSET_URL, MONSTER, AUDIO, INTERIOR, INTRO, STAIRS, SAFE, NIGHTS, GUN, KEY, BACKYARD_SEAL, DEBUG } from './config.js';

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
      this._sealBackyard(); // wall off the open backyard doorway near the kitchen

      const safeGltf = await Safe.load();
      this.safe = new Safe(this.engine.scene, this.engine.camera, safeGltf);
      this.safe.place(SAFE.x, SAFE.y, SAFE.z, SAFE.yaw); // on the kitchen counter (for now)

      const gunGltf = await Gun.load();
      this.gun = new Gun(this.engine.scene, this.engine.camera, gunGltf);
      this.gunTaken = false;        // becomes true once the player takes it from the safe

      this.key = new Key(this.engine.scene); // Nulmire drops this when killed
      this.hasKey = false;

      this.ui.setStatus('something stirs inside…');
      const monsterGltf = await Monster.load();
      this.monster = new Monster(this.engine.scene, this.world.collider, monsterGltf, this.player);
      this.monster.onCaught = () => this._jumpscare();
      this.monster.canCatch = DEBUG.monsterCanKill; // testing: false → it can't kill you

      this.paperCount = 0;
      this.papersRevealed = false;   // papers + counter appear only once Objective 3 begins
      const paperGltf = await Pickups.loadPaper();
      this.pickups = new Pickups(this.engine.scene, this.world.collider, this.player, paperGltf, {
        onPaper: () => this._onPaper(),
      });

      // Missions (more objectives will be added as the game grows).
      this.objIndex = 0;
      this._objCompleting = false;
      this.intro = null;
      this.trapSprung = false;             // front door slams + locks at the stairs (once)
      // Objective 1 is NOT completed merely by entering — it completes when the
      // stairs trap springs (the door slams + locks). Hence check: () => false.
      this.objectives = [
        { label: 'Objective 1: Get in the house', check: () => false },
      ];
      this.currentObjective = this.objectives[0].label; // re-shown after a night transition

      // 3 nights: getting caught costs a night and you wake in the attic; lose all 3 → game over.
      this.night = 1;
      this.nightCardLock = false;
      this.atticSpawn = new THREE.Vector3(NIGHTS.attic.x, NIGHTS.attic.y, NIGHTS.attic.z);

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
    // cinematic opening: fade up from black (movement locked) → big centred
    // objective title → it flies to the top-left and stays there.
    this.intro = { phase: 'fade', t: 0 };
    this.ui.fadeShow();
    if (!this.touch) this.input.requestLock(); // best-effort mouse capture (ok if denied)
  }

  _updateIntro(dt) {
    const I = this.intro;
    I.t += dt;
    if (I.phase === 'fade') {
      this.ui.fadeSet(Math.max(0, 1 - I.t / INTRO.fade));
      if (I.t >= INTRO.fade) {
        this.ui.fadeHide();
        this.ui.introTitle(this.objectives[this.objIndex].label); // big in the centre
        I.phase = 'hold'; I.t = 0;
      }
    } else if (I.phase === 'hold') {
      if (I.t >= INTRO.hold) { this.ui.flyObjectiveToCorner(); I.phase = 'settle'; I.t = 0; }
    } else if (I.phase === 'settle') {
      if (I.t >= INTRO.fly) this.intro = null; // objective now rests top-left
    }
  }

  // Wall off the open pool side of the room (south + east edge — the pool is
  // L-shaped). Each panel reuses the house's tiled "Ladrillos" brick + a collider.
  _sealBackyard() {
    const cfg = BACKYARD_SEAL;
    let brick = null;
    this.world.root.traverse((o) => {
      if (brick || !o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const m = list.find((mm) => /ladr/i.test(mm?.name || ''));
      if (m) brick = m;
    });
    this._sealWalls = [];
    for (const s of cfg.panels) {
      const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
      geo.translate(s.x, s.y, s.z);              // bake to world space
      geo.boundsTree = new MeshBVH(geo);
      this.player.extraColliders.push({ geometry: geo, active: () => true });

      let mat;
      if (cfg.debug) {
        mat = new THREE.MeshBasicMaterial({ color: 0xff2266 });
      } else if (brick) {
        mat = brick.clone();
        const uTiles = Math.max(s.w, s.d) * cfg.tile, vTiles = s.h * cfg.tile; // long horizontal face
        for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap']) {
          if (mat[k]) { mat[k] = mat[k].clone(); mat[k].wrapS = mat[k].wrapT = THREE.RepeatWrapping; mat[k].repeat.set(uTiles, vTiles); mat[k].needsUpdate = true; }
        }
        mat.needsUpdate = true;
      } else {
        mat = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.96, metalness: 0 });
      }
      const wall = new THREE.Mesh(geo, mat);     // geo is already world-positioned
      wall.castShadow = false; wall.receiveShadow = true;
      this.engine.scene.add(wall);
      this._sealWalls.push(wall);
    }
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
        if (this.objIndex < this.objectives.length) {
          this.currentObjective = this.objectives[this.objIndex].label;
          this.ui.setObjective(this.currentObjective);
        } else {
          this.currentObjective = null;   // no active objective until the stairs trap sets one
          this.ui.hideObjective();
        }
      }, 2200);
    }
  }

  // ---- the stairs trap: first time the player nears the staircase, the front
  // door slams shut and locks, and a new objective appears ----
  _nearStairs() {
    const p = this.player.position;
    const dx = p.x - STAIRS.x, dz = p.z - STAIRS.z;
    return dx * dx + dz * dz <= STAIRS.triggerRadius * STAIRS.triggerRadius;
  }

  _springTrap() {
    this.trapSprung = true;
    this.doors.lockShut();                                       // slam + lock the way out
    this.sfx.play('door', { volume: AUDIO.doorVolume, rate: 0.82 }); // heavy slam
    // the trap is what completes "Get in the house" → tick it off, then reveal obj 2
    this.objIndex = 1;
    this.ui.completeObjective();
    this.currentObjective = 'Objective 2: You need the key, find the safe';
    if (this._obj2Timer) clearTimeout(this._obj2Timer);
    this._obj2Timer = setTimeout(() => {
      if (this.state !== 'gameover' && !this.nightCardLock) this.ui.setObjective(this.currentObjective);
    }, 2200);
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
    if (this.scareT > 3.4) this._loseNight();
  }

  // Caught → lose a night. If nights remain, wake in the attic with a bloody
  // "NIGHT n" card, then the current objective. Lose the 3rd night → game over.
  _loseNight() {
    if (this.night >= NIGHTS.total) { this._gameOver(); return; }
    this.night++;
    this.ui.hideScare();
    this.ui.hideObjective();
    this.engine.camera.rotation.z = 0;
    this.player.spawn(this.atticSpawn, NIGHTS.attic.yaw, NIGHTS.attic.pitch); // wake in the attic bedroom
    this.player._applyCamera(0);
    this.monster.reset();
    this.state = 'playing';
    this.nightCardLock = true;                 // hold the player still while the card shows
    this.ui.showNight(this.night, { fade: NIGHTS.cardFade, hold: NIGHTS.cardHold, out: NIGHTS.cardOut }, () => {
      this.nightCardLock = false;
      if (this.currentObjective) this.ui.setObjective(this.currentObjective); // the current objective again
    });
    if (!this.touch) this.input.requestLock();
  }

  _gameOver() {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this._chasing = false;
    this.sfx.stopChase();
    this.ui.hideScare();
    if (this.input.locked) this.input.exitLock();
    this.ui.showGameOver();
  }

  // ---------------- safe / papers ----------------
  // Trying the locked safe completes "find the safe" and starts Objective 3,
  // which is when the papers scatter and the counter appears.
  _onSafeLocked() {
    if (this.papersRevealed || !this.trapSprung) return; // only after Objective 2 is active
    this.papersRevealed = true;
    this.ui.completeObjective();                  // Objective 2 ✓
    this.pickups.spawn();                         // papers spawn randomly in the house
    this.ui.setBooks(this.paperCount, this.pickups.total);
    this.ui.showPaperCounter();                   // top-right counter now appears
    this.currentObjective = 'Objective 3: Collect all the papers to unlock the safe';
    if (this._obj3Timer) clearTimeout(this._obj3Timer);
    this._obj3Timer = setTimeout(() => {
      if (this.state !== 'gameover' && !this.nightCardLock) this.ui.setObjective(this.currentObjective);
    }, 2200);
  }

  _onPaper() {
    this.paperCount++;
    this.ui.setBooks(this.paperCount, this.pickups.total);
    this.sfx.blip(880);
    if (this.pickups.total > 0 && this.paperCount >= this.pickups.total) this._allPapersCollected();
  }

  // All papers gathered → the safe unlocks, Objective 3 is complete, and
  // Objective 4 (open the safe) appears.
  _allPapersCollected() {
    if (this._papersDone) return;
    this._papersDone = true;
    this.safe.unlock();
    this.ui.completeObjective();                  // Objective 3 ✓
    this.sfx.blip(1320);
    this.currentObjective = 'Objective 4: Open the safe';
    if (this._obj4Timer) clearTimeout(this._obj4Timer);
    this._obj4Timer = setTimeout(() => {
      if (this.state !== 'gameover' && !this.nightCardLock) this.ui.setObjective(this.currentObjective);
    }, 2200);
  }

  // Opening the unlocked safe completes Objective 4: the gun appears inside, the
  // safe freezes (no more interaction), Objective 5 begins and the monster turns
  // relentless. The player takes the gun with E.
  _onSafeOpened() {
    if (this._safeOpenedDone) return;
    this._safeOpenedDone = true;
    this.safe.frozen = true;                       // can't be closed now — take the gun
    this.ui.completeObjective();                   // Objective 4 ✓

    this._gunDisplay = this.gun.makeSafeInstance(); // the pistol lying flat at the open safe's mouth
    this._gunDisplay.position.set(GUN.safePos.x, GUN.safePos.y, GUN.safePos.z);
    this._gunDisplay.rotation.set(GUN.safeRot.x, GUN.safeRot.y, GUN.safeRot.z);
    this.engine.scene.add(this._gunDisplay);

    this.monster.relentless = true;                // it will never give up now
    this.currentObjective = 'Objective 5: Kill Nulmire';
    if (this._obj5Timer) clearTimeout(this._obj5Timer);
    this._obj5Timer = setTimeout(() => {
      if (this.state !== 'gameover' && this.state !== 'ending' && !this.nightCardLock) this.ui.setObjective(this.currentObjective);
    }, 2200);
  }

  _nearSafe() {
    const p = this.player.position;
    return Math.hypot(p.x - SAFE.x, p.z - SAFE.z) < GUN.takeDist;
  }

  _takeGun() {
    if (this.gunTaken) return;
    this.gunTaken = true;
    this.gun.equip();                              // first-person viewmodel on
    if (this._gunDisplay) { this.engine.scene.remove(this._gunDisplay); this._gunDisplay = null; }
    this.sfx.blip(620);
    this.ui.setPrompt(null);
  }

  // ---------------- shooting ----------------
  _fireGun() {
    this.gun.fire();                               // recoil + muzzle flash
    this.sfx.gun();
    if (this.monster.state === 'dead' || this.monster.state === 'caught') return;
    if (this._gunHitsMonster()) this._killMonster();
  }

  // Hitscan from the camera centre: project the monster onto the aim ray, hit if
  // close enough, in range and in front, with clear line of sight (no wall).
  _gunHitsMonster() {
    const cam = this.engine.camera;
    const fwd = this._sFwd || (this._sFwd = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const center = this._sCenter || (this._sCenter = new THREE.Vector3());
    center.copy(this.monster.root.position); center.y += MONSTER.height * 0.5;
    const toM = this._sTo || (this._sTo = new THREE.Vector3());
    toM.copy(center).sub(cam.position);
    const proj = toM.dot(fwd);
    if (proj < 0 || proj > GUN.range) return false;
    const closest = this._sClose || (this._sClose = new THREE.Vector3());
    closest.copy(cam.position).addScaledVector(fwd, proj);
    if (closest.distanceTo(center) > GUN.hitRadius) return false;
    const ray = this._shotRay || (this._shotRay = new THREE.Raycaster());
    ray.firstHitOnly = true; ray.set(cam.position, fwd); ray.far = proj - 0.3;
    if (ray.intersectObject(this.world.collider.mesh, false).length) return false; // blocked by a wall
    return true;
  }

  // Shot dead → explode + scream, drop the key, complete Objective 5 → "GET OUT".
  _killMonster() {
    if (this.monster.state === 'dead') return;
    const at = this.monster.root.position;
    this.monster.kill();
    this._chasing = false; this.sfx.stopChase();
    this.sfx.play('jumpscare', { volume: AUDIO.jumpscareVolume }); // dies screaming
    this._spawnExplosion(at);
    this.key.drop(at.x, this.monster.feetY, at.z);  // Nulmire drops the key
    this.ui.completeObjective();                    // Objective 5 ✓
    this.currentObjective = 'Objective 6: GET OUT';
    if (this._obj6Timer) clearTimeout(this._obj6Timer);
    this._obj6Timer = setTimeout(() => {
      if (this.state === 'playing' && !this.nightCardLock) this.ui.setObjective(this.currentObjective);
    }, 2200);
  }

  _onKeyCollected() {
    this.hasKey = true;
    this.sfx.blip(740);
  }

  // Unlock the front door with the key → the escape cinematic (slow darken).
  _unlockAndEscape() {
    if (this.state === 'ending') return;
    this.doors.unlock();
    this.sfx.play('door', { volume: AUDIO.doorVolume });
    this.ui.completeObjective();                    // Objective 6 ✓
    this.currentObjective = null;
    this.state = 'ending';
    this.ending = { t: 0 }; this._endShown = false;
    this.ui.fadeShow(); this.ui.fadeSet(0);
  }

  _spawnExplosion(pos) {
    const N = 120;
    const positions = new Float32Array(N * 3);
    this._exVel = [];
    for (let i = 0; i < N; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y + 0.9; positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.6 - 0.2, Math.random() * 2 - 1)
        .normalize().multiplyScalar(1.5 + Math.random() * 4.5);
      this._exVel.push(dir);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xff5a22, size: 0.14, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    this._explosion = new THREE.Points(geo, mat);
    this.engine.scene.add(this._explosion);
    this._explosionT = 0;
  }

  _updateExplosion(dt) {
    if (!this._explosion) return;
    this._explosionT += dt;
    const pos = this._explosion.geometry.attributes.position;
    for (let i = 0; i < this._exVel.length; i++) {
      const v = this._exVel[i];
      pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt);
      v.y -= 7 * dt;
    }
    pos.needsUpdate = true;
    this._explosion.material.opacity = Math.max(0, 1 - this._explosionT / 1.1);
    if (this._explosionT > 1.1) {
      this.engine.scene.remove(this._explosion);
      this._explosion.geometry.dispose(); this._explosion.material.dispose(); this._explosion = null;
    }
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
      fireBtn: document.getElementById('touch-fire'),
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
      // movement is locked during the opening fade-in and the night-transition card (look still works)
      if (this.nightCardLock || (this.intro && this.intro.phase === 'fade')) { this.input.move.x = 0; this.input.move.y = 0; this.input.consumeEdge('jump'); }
      this.player.update(dt);
      this.flashlight.update(dt, this.engine.camera);
      this.world.update(dt, this.player.position);
      this.monster.update(dt);
      this.pickups.update(dt);
      this.safe.update(dt);
      this.gun.update(dt);
      if (this.key.update(dt, this.player.position)) this._onKeyCollected(); // walk-over pickup
      this._updateExplosion(dt);

      this.sfx.setListener(this.engine.camera);
      this.sfx.startAmbience(AUDIO.ambienceVolume); // starts once the buffer is ready
      this._footsteps(dt);
      this._laughs(dt);
      this._chaseMusic();
      if (this.intro) this._updateIntro(dt);
      else this._checkObjectives();
      // spring the stairs trap the first time the player gets close (inside only)
      if (!this.trapSprung && !this.intro && this._isInsideHouse() && this._nearStairs()) this._springTrap();

      if (this.input.consumeEdge('interact')) {
        const door = this.doors.interact(this.engine.camera);
        if (door === 'toggled') this.sfx.play('door', { volume: AUDIO.doorVolume });
        else if (door === 'locked') {
          if (this.hasKey) this._unlockAndEscape();   // unlock the front door with the key → escape
          else this.sfx.play('door', { volume: AUDIO.doorVolume * 0.4, rate: 1.5 }); // futile rattle
        }
        else if (this._safeOpenedDone && !this.gunTaken && this._nearSafe()) {
          this._takeGun();                          // take the pistol from the open safe
        } else if (!this.safe.frozen && this.safe.targeted()) {
          const r = this.safe.interact();
          if (r === 'locked') {
            this.sfx.play('door', { volume: AUDIO.doorVolume * 0.5, rate: 1.35 }); // heavy, won't budge
            this._onSafeLocked();
          } else {
            this.sfx.play('door', { volume: AUDIO.doorVolume * 0.7, rate: r === 'opened' ? 0.95 : 1.15 });
            if (r === 'opened') this._onSafeOpened();
          }
        }
        this.pickups.tryInteract();
        if (this.key.collectIfNear(this.player.position)) this._onKeyCollected();
      }
      if (this.input.consumeEdge('fire') && this.gunTaken) this._fireGun();

      // prompts: door (unlock with the key when locked), then take-the-gun, then the safe
      let prompt = null;
      this.doors.update(dt, this.engine.camera, (txt) => { prompt = txt; });
      if (prompt === 'Locked' && this.hasKey) prompt = 'Unlock door';
      if (!prompt) {
        if (this._safeOpenedDone && !this.gunTaken && this._nearSafe()) prompt = 'Take the pistol';
        else if (!this.safe.frozen && this.safe.targeted()) prompt = this.safe.open ? 'Close safe' : 'Open safe';
      }
      this.ui.setPrompt(prompt);
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
    } else if (this.state === 'ending') {
      // Nulmire is dead: keep the world + gun + explosion alive while the screen
      // slowly darkens, then show the "YOU KILLED NULMIRE" card + main menu.
      this.world.update(dt, this.engine.camera.position);
      this.flashlight.update(dt, this.engine.camera);
      this.gun.update(dt);
      this._updateExplosion(dt);
      this.ending.t += dt;
      this.ui.fadeSet(Math.min(1, this.ending.t / 3.6));
      if (this.ending.t >= 3.6 && !this._endShown) { this._endShown = true; this.ui.showKilled(() => location.reload()); }
      this.input.consumeEdge('pause'); this.input.consumeEdge('interact'); this.input.consumeEdge('fire');
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
