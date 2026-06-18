import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MONSTER, INTERIOR, NAV } from './config.js';
import NavGrid from './NavGrid.js';

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
    this.nav = new NavGrid(collider, NAV.bounds, NAV); // whole-house multi-level pathfinding
    this.navR = MONSTER.navRadius;
    this.path = null; this._wp = 0; this._repathT = 0; this._pathT = 0; this._stuckT = 0;
    this.wanderDest = null;                     // current patrol destination (a room)

    const sp = this._pickSpawn();              // random ground-floor room
    this.feetY = sp.y; this.pos.copy(sp); this.target.copy(sp);
    this.heading = Math.random() * Math.PI * 2;

    this._applyTransform();
  }

  /** A random ground-floor room to start in (spatially spread, not node-weighted). */
  _pickSpawn() {
    for (let i = 0; i < 40; i++) {
      const p = this.nav.randomArea();
      if (p.y < 0.6) return p;                  // ground floor for the initial spawn
    }
    return this.nav.randomArea();
  }

  // ---- nav path following ----
  _repath(gx, gy, gz) {
    this.path = this.nav.findPath(this.pos.x, this.feetY, this.pos.z, gx, gy, gz);
    this._wp = (this.path && this.path.length > 1) ? 1 : 0;  // skip the start cell
    if (!this.path || this.path.length <= 1) this.path = null;
  }

  /** Follow the nav path waypoint by waypoint (the path itself routes around
   * tables/walls and threads the stairs; turning smooths the dense waypoints). */
  _followPath(dt, speed, turnRate, dropTol) {
    if (!this.path || this._wp >= this.path.length) return true;
    while (this._wp < this.path.length) {                 // consume reached waypoints
      const wp = this.path[this._wp];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < MONSTER.waypointDist) this._wp++;
      else break;
    }
    if (this._wp >= this.path.length) { this.path = null; return true; }
    const wp = this.path[this._wp];
    const steer = this._avoidSteer(Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z), this.navR + 0.4);
    const d = this._turnToward(steer, turnRate, dt);
    const want = Math.abs(d) > 1.2 ? speed * 0.45 : speed;
    this.speed = THREE.MathUtils.damp(this.speed, want, 8, dt);
    if (this._advance(dt, dropTol)) this._stuckT = 0;
    else if (!this._tryJump(this.heading)) {
      this._stuckT += dt;
      if (this._stuckT > 0.35) {            // stuck on this waypoint → skip to the next one
        this._stuckT = 0; this._wp++;
        if (this._wp >= this.path.length) { this.path = null; return true; }
      }
    }
    return false;
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
  _rayHit(h, dist, oy = 1.0) {
    const origin = this._tmp.set(this.pos.x, this.feetY + oy, this.pos.z);
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
    // hard wall block — never move into solid geometry (stair risers are below this)
    if (this._rayHit(this.heading, this.navR + adv + 0.1, 1.0)) { this.speed = 0; return false; }
    const nx = this.pos.x + Math.sin(this.heading) * adv;
    const nz = this.pos.z + Math.cos(this.heading) * adv;
    const fy = this.collider.groundY(nx, nz, this.feetY + MONSTER.floorScan);
    if (fy == null || fy < this.feetY - dropTol) { this.speed = 0; return false; }   // void / big drop
    if (fy < INTERIOR.floorAbove - 0.5) { this.speed = 0; return false; }            // never drop out to the yard
    if (fy - this.feetY > MONSTER.stepUp) { this.speed = 0; return false; }          // too tall to step up
    // snap the feet up onto each stair step (no lag), ease down for a smooth descent
    if (fy > this.feetY) this.feetY = Math.min(fy, this.feetY + adv + 0.5);
    else if (Math.abs(fy - this.feetY) < 1.5) this.feetY = THREE.MathUtils.damp(this.feetY, fy, 14, dt);
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
    const landingY = this.collider.groundY(lx, lz, this.feetY + MONSTER.floorScan);
    if (landingY != null && landingY < INTERIOR.floorAbove - 0.5) return false; // don't vault out to the yard
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
    const wasChase = this.state === 'chase';
    if (see) {
      this.lastSeen.copy(this.player.position); this.loseTimer = 0;
      if (this.state !== 'chase') { this.state = 'chase'; this.path = null; this._repathT = 0; }
    } else if (this.state === 'chase' && !this.relentless) {
      if (!inside) {
        this.state = 'wander';                  // stepped outside → give up immediately
      } else {
        this.loseTimer += dt;
        // give up if the WALKABLE route to the player has grown too long (checked ~3x/s)
        this._pathT -= dt;
        if (this._pathT <= 0) {
          this._pathT = 0.35;
          const pp = this.player.position;
          const pd = this.nav.pathDist(this.pos.x, this.feetY, this.pos.z, pp.x, pp.y, pp.z);
          if (pd > MONSTER.giveUpPathDist) this.state = 'wander';
        }
        if (this.state === 'chase' && this.loseTimer > MONSTER.loseTime) this.state = 'wander';
      }
    }
    // gave up → drop the chase path and resume the patrol trip it was on (wanderDest persists)
    if (wasChase && this.state === 'wander') this.path = null;

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

  // Always pursue via the nav (so it routes around tables/walls and up & down the
  // stairs); the path's look-ahead makes the approach a straight sprint when clear.
  _chase(dt) {
    const p = this.player.position;
    const distP = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (distP > MONSTER.catchDist * 0.8) {
      const g = this.relentless ? p : this.lastSeen; // relentless hunts you live; else last seen
      this._repathT -= dt;
      if (this._repathT <= 0 || !this.path) { this._repathT = distP < 5 ? 0.15 : MONSTER.repathChase; this._repath(g.x, g.y, g.z); }
      if (this._followPath(dt, MONSTER.runSpeed, MONSTER.chaseTurnRate, MONSTER.dropTol)) this._repathT = 0;
    } else {
      this.path = null;                       // right on top of you → just face you
      this._turnToward(Math.atan2(p.x - this.pos.x, p.z - this.pos.z), MONSTER.chaseTurnRate, dt);
      this.speed = THREE.MathUtils.damp(this.speed, 0, 8, dt);
    }
    if (this.canCatch && distP < MONSTER.catchDist && this._losToPlayer()) {
      this.state = 'caught'; this.speed = 0;
      if (this.onCaught) this.onCaught();
    }
  }

  // Patrol the house: pick a far-off room, walk there, pause, pick a new one. A chase
  // interrupts this but `wanderDest` persists, so afterwards it resumes the same trip.
  _wander(dt) {
    if (this.pauseLeft > 0) {
      this.pauseLeft -= dt;
      this.speed = THREE.MathUtils.damp(this.speed, 0, 6, dt);
      this._advance(dt, 0.6);
      return;
    }
    if (!this.path) {
      if (!this.wanderDest) {
        let pick = null;                      // a different room: a random area that's a decent walk away
        for (let i = 0; i < 12; i++) { const a = this.nav.randomArea(); if ((a.x - this.pos.x) ** 2 + (a.z - this.pos.z) ** 2 > 49) { pick = a; break; } }
        this.wanderDest = pick || this.nav.randomArea();
      }
      this._repath(this.wanderDest.x, this.wanderDest.y, this.wanderDest.z);
      if (!this.path) { this.wanderDest = null; this.pauseLeft = 0.3; return; }
    }
    if (this._followPath(dt, MONSTER.walkSpeed, MONSTER.turnRate, 1.0)) {
      this.wanderDest = null;                 // arrived → choose a new room next time
      this.pauseLeft = THREE.MathUtils.lerp(MONSTER.pauseRange[0], MONSTER.pauseRange[1], Math.random());
    }
  }

  /** Shot dead: stop, hide the body (the game spawns the explosion). */
  kill() {
    this.state = 'dead';
    this.speed = 0;
    this.model.visible = false;
  }

  reset() {
    this.state = 'wander';
    const sp = this._pickSpawn();              // reappear somewhere reachable in the house
    this.feetY = sp.y; this.pos.copy(sp); this.target.copy(sp);
    this.speed = 0; this.heading = Math.random() * Math.PI * 2; this.pauseLeft = 1.0; this.loseTimer = 0;
    this.jump = null; this.path = null; this._wp = 0; this._repathT = 0; this._stuckT = 0; this.wanderDest = null;
    if (this.walk) this.walk.timeScale = 1.0;
    this._play(this.idle, 0.1);
    this._applyTransform();
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
