import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MONSTER } from './config.js';

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
    this.feetY = collider.groundY(MONSTER.home.x, MONSTER.home.z, 2.5) ?? -0.2;
    this.pos = new THREE.Vector3(MONSTER.home.x, this.feetY, MONSTER.home.z);
    this.heading = 0; this.speed = 0; this.t = 0;
    this.target = this.pos.clone(); this.pauseLeft = 1.0;
    this._ray = new THREE.Raycaster(); this._ray.firstHitOnly = true; this._tmp = new THREE.Vector3();
    this.state = 'wander'; this.lastSeen = new THREE.Vector3(); this.loseTimer = 0; this.onCaught = null; this._avoidSide = 0;

    this._applyTransform();
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
    const nx = this.pos.x + Math.sin(this.heading) * adv;
    const nz = this.pos.z + Math.cos(this.heading) * adv;
    const fy = this.collider.groundY(nx, nz, this.feetY + MONSTER.floorScan);
    if (fy == null || fy < this.feetY - dropTol) { this.speed = 0; return false; } // void / big drop
    if (fy - this.feetY > 0.6) { this.speed = 0; return false; }                    // too tall to step up
    if (Math.abs(fy - this.feetY) < 1.0) this.feetY = THREE.MathUtils.damp(this.feetY, fy, 12, dt);
    this.pos.set(nx, this.feetY, nz);
    return true;
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
    for (let i = 0; i < 10; i++) {
      const x = THREE.MathUtils.lerp(r.minX, r.maxX, Math.random());
      const z = THREE.MathUtils.lerp(r.minZ, r.maxZ, Math.random());
      const y = this.collider.groundY(x, z, this.feetY + MONSTER.floorScan);
      if (y != null && y > this.feetY - 0.6 && y < this.feetY + 1.0) { this.target.set(x, y, z); return; }
    }
    this.target.set(MONSTER.home.x, this.feetY, MONSTER.home.z);
  }

  _canSee() {
    const p = this.player.position;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MONSTER.senseRange) return false;
    if (dist <= MONSTER.hearRange) return true;
    const from = this._tmp.set(this.pos.x, this.feetY + 1.7, this.pos.z);
    _v.set(p.x - from.x, p.y - from.y, p.z - from.z);
    const len = _v.length(); _v.normalize();
    this._ray.set(from, _v); this._ray.far = len - 0.4;
    if (this._ray.intersectObject(this.collider.mesh, false).length) return false;
    let d = Math.atan2(dx, dz) - this.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= MONSTER.senseFov;
  }

  // ---------------- per-frame ----------------
  update(dt) {
    this.t += dt;
    if (this.state === 'caught') { this.speed = 0; this.mixer.update(dt); this._applyTransform(); return; }

    const see = this._canSee();
    if (see) { this.lastSeen.copy(this.player.position); this.loseTimer = 0; if (this.state !== 'chase') this.state = 'chase'; }
    else if (this.state === 'chase') { this.loseTimer += dt; if (this.loseTimer > MONSTER.loseTime) this.state = 'wander'; }

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
    this._advance(dt, 1.6);

    const p = this.player.position;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < MONSTER.catchDist) {
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
    else { this._stuckT = (this._stuckT || 0) + dt; if (this._stuckT > 0.7) { this._stuckT = 0; this._newTarget(); } }
  }

  reset() {
    this.state = 'wander';
    this.feetY = this.collider.groundY(MONSTER.home.x, MONSTER.home.z, 2.5) ?? -0.2;
    this.pos.set(MONSTER.home.x, this.feetY, MONSTER.home.z);
    this.speed = 0; this.heading = 0; this.pauseLeft = 1.0; this.loseTimer = 0;
    this.target.copy(this.pos);
    if (this.walk) this.walk.timeScale = 1.0;
    this._play(this.idle, 0.1);
    this._applyTransform();
  }
}

const _v = new THREE.Vector3();
