import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MONSTER, INTERIOR } from './config.js';
import Nav from './Nav.js';

/**
 * The Momo monster. Uses the model's own baked clips:
 *   - Walk  → wandering (and sped up = "running" while chasing)
 *   - Idle  → standing at a waypoint
 *   - Attack→ the jumpscare
 * Navigates with the level BVH (floor-following rays + fan wall-avoidance) so it
 * collides with the house instead of walking through it.
 */
export default class Monster {
  static async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(MONSTER.url);
  }

  constructor(scene, collider, gltf, player) {
    this.collider = collider;
    this.player = player;
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    scene.add(this.root);

    // ---- scale to target height, drop feet to the origin, centre in XZ ----
    this.model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3(); box.getSize(size);
    this.model.scale.setScalar(MONSTER.height / (size.y || 1));
    this.model.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(this.model);
    const c = new THREE.Vector3(); box2.getCenter(c);
    this.model.position.x -= c.x;
    this.model.position.z -= c.z;
    this.feetOffset = -box2.min.y;
    this.halfWidth = Math.max(size.x, size.z) * (MONSTER.height / (size.y || 1)) * 0.5 || 0.4;

    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) m.roughness = Math.max(m.roughness ?? 1, 0.55);
      }
    });

    // ---- animation ----
    this.mixer = new THREE.AnimationMixer(this.model);
    const byName = {};
    for (const clip of gltf.animations) byName[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    this.walk = byName.walk; this.idle = byName.idle || this.walk; this.attack = byName.attack;
    if (this.attack) { this.attack.setLoop(THREE.LoopOnce); this.attack.clampWhenFinished = true; }
    this._curr = null;
    this._play(this.idle, 0);

    // ---- wander / hunt state ----
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this._ray = new THREE.Raycaster(); this._ray.firstHitOnly = true; this._tmp = new THREE.Vector3();
    this.speed = 0; this.t = 0; this.pauseLeft = 1.0;
    this.state = 'wander'; this.lastSeen = new THREE.Vector3(); this.loseTimer = 0; this.onCaught = null; this._avoidSide = 0;
    this.relentless = false; // once true (gun taken), it never gives up the chase
    this.canCatch = true;    // when false (testing), it chases but can't grab/kill you
    this.jump = null; this._jumpCdUntil = 0;
    this.nav = new Nav(collider, MONSTER.roam, MONSTER.navCell); // for walkable-distance give-up
    this._pathT = 0;

    const sp = this._pickSpawn();              // random spot somewhere in the house
    this.feetY = sp.y; this.pos.copy(sp); this.target.copy(sp);
    this.heading = Math.random() * Math.PI * 2;

    this._applyTransform();
  }

  /** A random valid ground-floor spot inside the house. */
  _pickSpawn() {
    const r = MONSTER.roam;
    for (let i = 0; i < 40; i++) {
      const x = THREE.MathUtils.lerp(r.minX, r.maxX, Math.random());
      const z = THREE.MathUtils.lerp(r.minZ, r.maxZ, Math.random());
      const y = this.collider.groundY(x, z, 1.7);   // low ray → ground floor only
      if (y != null && y > -0.8 && y < 0.6) return new THREE.Vector3(x, y, z);
    }
    const y = this.collider.groundY(MONSTER.home.x, MONSTER.home.z, 1.7) ?? -0.2;
    return new THREE.Vector3(MONSTER.home.x, y, MONSTER.home.z);
  }

  _play(action, fade = 0.25) {
    if (!action || action === this._curr) return;
    action.enabled = true; action.setEffectiveWeight(1).reset();
    if (this._curr) action.crossFadeFrom(this._curr, fade, false);
    action.play();
    this._curr = action;
  }

  /** Drive the attack clip for the jumpscare. */
  attackPose() {
    if (!this.attack) return;
    this.attack.enabled = true; this.attack.setEffectiveWeight(1).reset();
    if (this._curr && this._curr !== this.attack) this.attack.crossFadeFrom(this._curr, 0.08, false);
    this.attack.play();
    this._curr = this.attack;
  }

  tickMixer(dt) { this.mixer.update(dt); }

  _applyTransform() {
    this.root.position.set(this.pos.x, this.pos.y + this.feetOffset, this.pos.z);
    this.root.rotation.y = this.heading + MONSTER.facingOffset;
  }

  // ---------------- navigation helpers ----------------
  _rayHit(h, dist) {
    const origin = this._tmp.set(this.pos.x, this.feetY + 1.0, this.pos.z);
    _v.set(Math.sin(h), 0, Math.cos(h));
    this._ray.set(origin, _v); this._ray.far = dist;
    return this._ray.intersectObject(this.collider.mesh, false).length > 0;
  }

  _avoidSteer(desired, dist) {
    if (!this._rayHit(desired, dist)) { this._avoidSide = 0; return desired; }
    const side = this._avoidSide || (Math.random() < 0.5 ? 1 : -1);
    for (const mag of [0.5, 0.9, 1.3, 1.8, 2.4]) {
      if (!this._rayHit(desired + side * mag, dist)) { this._avoidSide = side; return desired + side * mag; }
      if (!this._rayHit(desired - side * mag, dist)) { this._avoidSide = -side; return desired - side * mag; }
    }
    this._avoidSide = side;
    return desired + side * 2.4;
  }

  _advance(dt, dropTol) {
    if (this.speed < 0.01) { this.pos.y = this.feetY; return false; }
    const adv = this.speed * dt;
    // hard wall block — never move into solid geometry
    if (this._rayHit(this.heading, this.halfWidth + adv + 0.12)) { this.speed = 0; return false; }
    const nx = this.pos.x + Math.sin(this.heading) * adv;
    const nz = this.pos.z + Math.cos(this.heading) * adv;
    const r = MONSTER.roam;
    if (nx < r.minX || nx > r.maxX || nz < r.minZ || nz > r.maxZ) { this.speed = 0; return false; } // never leave the house
    const fy = this.collider.groundY(nx, nz, this.feetY + MONSTER.floorScan);
    if (fy == null || fy < this.feetY - dropTol) { this.speed = 0; return false; } // void / big drop
    if (fy - this.feetY > 0.6) { this.speed = 0; return false; }                    // too tall to step up
    if (Math.abs(fy - this.feetY) < 1.0) this.feetY = THREE.MathUtils.damp(this.feetY, fy, 12, dt);
    this.pos.set(nx, this.feetY, nz);
    return true;
  }

  /** Clear line of sight from the monster's eyes to the player (blocked by walls). */
  _losToPlayer() {
    const p = this.player.position;
    const from = _v2.set(this.pos.x, this.feetY + MONSTER.losHeight, this.pos.z);
    _v.set(p.x - from.x, p.y - 0.3 - from.y, p.z - from.z);
    const len = _v.length(); _v.normalize();
    this._ray.set(from, _v); this._ray.far = len - 0.3;
    return this._ray.intersectObject(this.collider.mesh, false).length === 0;
  }

  // ---- vault a low obstacle (e.g. a table) when blocked while moving ----
  _tryJump(heading) {
    if (this.t < this._jumpCdUntil || this.jump) return false;
    const jd = MONSTER.jumpDist;
    const lx = this.pos.x + Math.sin(heading) * jd;
    const lz = this.pos.z + Math.cos(heading) * jd;
    const r = MONSTER.roam;
    if (lx < r.minX || lx > r.maxX || lz < r.minZ || lz > r.maxZ) return false; // don't jump out of the house
    const landingY = this.collider.groundY(lx, lz, this.feetY + MONSTER.floorScan);
    if (landingY == null || landingY < this.feetY - 1.5 || landingY > this.feetY + 1.0) return false; // no/odd landing
    // must be a LOW obstacle: a ray at clear-height ahead must be unobstructed
    _v.set(Math.sin(heading), 0, Math.cos(heading));
    this._ray.set(_v2.set(this.pos.x, this.feetY + MONSTER.jumpClearH, this.pos.z), _v);
    this._ray.far = jd;
    if (this._ray.intersectObject(this.collider.mesh, false).length) return false; // tall wall → can't clear
    this.heading = heading;
    this.jump = { sx: this.pos.x, sz: this.pos.z, sy: this.feetY, ex: lx, ez: lz, ey: landingY,
      t: 0, dur: MONSTER.jumpDur, peak: MONSTER.jumpPeak + Math.max(0, landingY - this.feetY) };
    return true;
  }

  _updateJump(dt) {
    const j = this.jump; j.t += dt;
    const u = Math.min(1, j.t / j.dur);
    this.pos.x = THREE.MathUtils.lerp(j.sx, j.ex, u);
    this.pos.z = THREE.MathUtils.lerp(j.sz, j.ez, u);
    this.pos.y = THREE.MathUtils.lerp(j.sy, j.ey, u) + j.peak * 4 * u * (1 - u);
    if (u >= 1) { this.feetY = j.ey; this.pos.set(j.ex, j.ey, j.ez); this.jump = null; this._jumpCdUntil = this.t + MONSTER.jumpCooldown; }
  }

  _turnToward(targetHeading, rate, dt) {
    let d = targetHeading - this.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    return d;
  }

  _newTarget() {
    const r = MONSTER.roam;
    let bx = 0, by = 0, bz = 0, bestD = -1;
    for (let i = 0; i < 16; i++) {
      const x = THREE.MathUtils.lerp(r.minX, r.maxX, Math.random());
      const z = THREE.MathUtils.lerp(r.minZ, r.maxZ, Math.random());
      const y = this.collider.groundY(x, z, this.feetY + MONSTER.floorScan);
      if (y == null || y <= this.feetY - 0.6 || y >= this.feetY + 1.0) continue;
      // prefer points farther away so it actually crosses the house
      const d = (x - this.pos.x) ** 2 + (z - this.pos.z) ** 2;
      if (d > bestD) { bestD = d; bx = x; by = y; bz = z; }
    }
    if (bestD > 4) this.target.set(bx, by, bz);
    else this.target.set(MONSTER.home.x, this.feetY, MONSTER.home.z);
  }

  /** Is the player currently inside the house? (interior footprint + ground floor) */
  _playerInside() {
    const p = this.player.position;
    const i = INTERIOR;
    if (p.x < i.minX || p.x > i.maxX || p.z < i.minZ || p.z > i.maxZ) return false;
    const floor = this.collider.groundY(p.x, p.z, p.y + 0.3);
    return floor != null && floor > i.floorAbove;
  }

  _canSee() {
    const p = this.player.position;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MONSTER.senseRange) return false;
    if (!this._losToPlayer()) return false;          // never sense through walls
    if (dist <= MONSTER.hearRange) return true;       // close + visible
    let d = Math.atan2(dx, dz) - this.heading;        // else must be within the vision cone
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= MONSTER.senseFov;
  }

  // ---------------- per-frame ----------------
  update(dt) {
    this.t += dt;
    if (this.jump) {
      this._updateJump(dt);
      if (this.walk) { this.walk.timeScale = this.state === 'chase' ? MONSTER.runAnimSpeed : 1; this._play(this.walk, 0.1); }
      this.mixer.update(dt); this._applyTransform(); return;
    }
    if (this.state === 'caught' || this.state === 'dead') { this.speed = 0; this.mixer.update(dt); this._applyTransform(); return; }

    // The monster only hunts while you're inside the house: leave, and it drops the
    // chase — UNLESS it's gone relentless (after you take the gun), then it never stops.
    const inside = this._playerInside();
    const see = (inside || this.relentless) && this._canSee();
    if (see) {
      this.lastSeen.copy(this.player.position); this.loseTimer = 0;
      if (this.state !== 'chase') this.state = 'chase';
    } else if (this.state === 'chase' && !this.relentless) {
      if (!inside) {
        this.state = 'wander';                  // stepped outside → give up immediately
      } else {
        this.loseTimer += dt;
        // give up if the WALKABLE route to the player has grown too long (checked ~3x/s)
        this._pathT -= dt;
        if (this._pathT <= 0) {
          this._pathT = 0.35;
          const pd = this.nav.pathDist(this.pos.x, this.pos.z, this.player.position.x, this.player.position.z);
          if (pd > MONSTER.giveUpPathDist) this.state = 'wander';
        }
        if (this.state === 'chase' && this.loseTimer > MONSTER.loseTime) this.state = 'wander';
      }
    }

    if (this.state === 'chase') this._chase(dt); else this._wander(dt);

    this._locomotion();
    this.mixer.update(dt);
    this._applyTransform();
  }

  _locomotion() {
    if (this.state === 'chase' || this.speed > 0.15) {
      if (this.walk) this.walk.timeScale = this.state === 'chase' ? MONSTER.runAnimSpeed : 1.0;
      this._play(this.walk, 0.2);
    } else {
      this._play(this.idle, 0.3);
    }
  }

  _chase(dt) {
    const dx = this.lastSeen.x - this.pos.x, dz = this.lastSeen.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const steer = this._avoidSteer(Math.atan2(dx, dz), MONSTER.avoidDist);
    const d = this._turnToward(steer, MONSTER.chaseTurnRate, dt);
    const want = Math.abs(d) > 1.0 ? MONSTER.runSpeed * 0.35 : MONSTER.runSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, dist < 0.8 ? 0 : want, 8, dt);
    if (!this._advance(dt, 1.6)) this._tryJump(this.heading); // blocked → vault the obstacle

    // grab the player only with a clear line of sight (no grabbing through walls)
    const p = this.player.position;
    if (this.canCatch && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < MONSTER.catchDist && this._losToPlayer()) {
      this.state = 'caught'; this.speed = 0;
      if (this.onCaught) this.onCaught();
    }
  }

  _wander(dt) {
    const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (this.pauseLeft > 0) {
      this.pauseLeft -= dt;
      this.speed = THREE.MathUtils.damp(this.speed, 0, 6, dt);
      this._advance(dt, 0.6);
      return;
    }
    if (dist < MONSTER.arriveDist) {
      this.pauseLeft = THREE.MathUtils.lerp(MONSTER.pauseRange[0], MONSTER.pauseRange[1], Math.random());
      this._newTarget();
      return;
    }
    const steer = this._avoidSteer(Math.atan2(dx, dz), this.halfWidth + 1.0);
    const d = this._turnToward(steer, MONSTER.turnRate, dt);
    const want = Math.abs(d) > 1.0 ? MONSTER.walkSpeed * 0.4 : MONSTER.walkSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, want, 6, dt);
    if (this._advance(dt, 0.6)) this._stuckT = 0;
    else if (!this._tryJump(this.heading)) { this._stuckT = (this._stuckT || 0) + dt; if (this._stuckT > 0.7) { this._stuckT = 0; this._newTarget(); } }
  }

  /** Shot dead: stop, hide the body (the game spawns the explosion). */
  kill() {
    this.state = 'dead';
    this.speed = 0;
    this.model.visible = false;
  }

  reset() {
    this.state = 'wander';
    const sp = this._pickSpawn();              // reappear somewhere random in the house
    this.feetY = sp.y; this.pos.copy(sp); this.target.copy(sp);
    this.speed = 0; this.heading = Math.random() * Math.PI * 2; this.pauseLeft = 1.0; this.loseTimer = 0;
    this.jump = null;
    if (this.walk) this.walk.timeScale = 1.0;
    this._play(this.idle, 0.1);
    this._applyTransform();
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
