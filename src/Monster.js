import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MONSTER } from './config.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * The wandering DarkFox. The .blend shipped with no animation clips, so the
 * skeleton is driven *procedurally*: a speed-synced biped walk/run cycle
 * (legs, knees, arms, spine bob/sway, tail whip, head stabilise) plus idle
 * breathing. It roams a bounded interior region, steering around walls using
 * the level BVH ("teaching it the map").
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

    // ---- scale to target height ----
    this.model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = MONSTER.height / size.y;
    this.model.scale.setScalar(s);
    this.model.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(this.model);
    this.feetOffset = -box2.min.y;          // root.y + feetOffset puts feet on the ground
    this.halfWidth = Math.max(size.x, size.z) * s * 0.5;

    // ---- shadows / dark-friendly materials ----
    this.skinned = [];
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false; // skinned bounds get unreliable; never cull
        if (o.isSkinnedMesh) this.skinned.push(o);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) { m.metalness = Math.min(m.metalness ?? 0, 0.1); m.roughness = Math.max(m.roughness ?? 1, 0.6); }
      }
    });

    this._rig();

    // ---- wander state ---- (low ray → ground floor, not the upper floor)
    this.feetY = collider.groundY(MONSTER.home.x, MONSTER.home.z, 2.5) ?? -0.2;
    this.pos = new THREE.Vector3(MONSTER.home.x, this.feetY, MONSTER.home.z);
    this.heading = 0;                // face +Z initially (toward the door)
    this.speed = 0;
    this.phase = 0;
    this.t = 0;
    this.target = this.pos.clone();
    this.pauseLeft = 1.0;
    this._ray = new THREE.Raycaster();
    this._ray.firstHitOnly = true;
    this._tmp = new THREE.Vector3();

    // ---- hunting state ----
    this.state = 'wander';           // 'wander' | 'chase' | 'caught'
    this.lastSeen = new THREE.Vector3();
    this.loseTimer = 0;
    this.onCaught = null;            // callback fired once when it grabs the player
    this._avoidSide = 0;             // committed turn direction for wall-avoidance

    this._applyTransform();
  }

  // Collect deform bones + their rest rotations so we can pose relative to bind.
  // NOTE: three.js strips dots from glTF node names (DEF-thigh.L -> DEF-thighL).
  _rig() {
    const get = (n) => this.model.getObjectByName(n);
    const b = {
      thighL: get('DEF-thighL'), shinL: get('DEF-shinL'), footL: get('DEF-footL'),
      thighR: get('DEF-thighR'), shinR: get('DEF-shinR'), footR: get('DEF-footR'),
      uarmL: get('DEF-upper_armL'), forearmL: get('DEF-forearmL'),
      uarmR: get('DEF-upper_armR'), forearmR: get('DEF-forearmR'),
      spine: get('DEF-spine001'), chest: get('DEF-spine003'), head: get('DEF-spine006'),
    };
    this.tail = [];
    for (let i = 0; i <= 8; i++) {
      const t = get(i === 0 ? 'DEF-taill' : `DEF-taill${String(i).padStart(3, '0')}`);
      if (t) this.tail.push(t);
    }
    this.bones = b;
    this.rest = new Map();
    const store = (bone) => { if (bone) this.rest.set(bone, bone.quaternion.clone()); };
    Object.values(b).forEach(store);
    this.tail.forEach(store);
  }

  // bone.quaternion = rest * rotation(localAxis, angle)
  _rot(bone, axis, angle) {
    if (!bone) return;
    const rest = this.rest.get(bone);
    bone.quaternion.copy(rest).multiply(_q.setFromAxisAngle(axis, angle));
  }

  // Rotate a bone about a WORLD-space axis through its pivot, relative to rest.
  // Lets us swing limbs correctly regardless of each bone's roll (the arm bones
  // are rolled so a local-X rotation only twists them — invisible).
  _rotWorld(bone, worldAxis, angle) {
    if (!bone || !bone.parent) return;
    bone.parent.getWorldQuaternion(_pwq).invert();
    _v2.copy(worldAxis).applyQuaternion(_pwq); // world axis → bone's parent-local space
    const rest = this.rest.get(bone);
    bone.quaternion.copy(rest).premultiply(_q.setFromAxisAngle(_v2.normalize(), angle));
  }

  _applyTransform() {
    this.root.position.set(this.pos.x, this.pos.y + this.feetOffset + this._bob, this.pos.z);
    this.root.rotation.y = this.heading;
  }

  // ---------------- wandering ----------------
  _newTarget() {
    const r = MONSTER.roam;
    for (let i = 0; i < 10; i++) {
      const x = THREE.MathUtils.lerp(r.minX, r.maxX, Math.random());
      const z = THREE.MathUtils.lerp(r.minZ, r.maxZ, Math.random());
      const y = this.collider.groundY(x, z, this.feetY + MONSTER.floorScan);
      // keep targets on the ground floor (reject voids / big drops / the upper floor)
      if (y != null && y > this.feetY - 0.6 && y < this.feetY + 1.0) { this.target.set(x, y, z); return; }
    }
    this.target.set(MONSTER.home.x, this.feetY, MONSTER.home.z);
  }

  // Is there a wall within `dist` along heading `h`?
  _rayHit(h, dist) {
    const origin = this._tmp.set(this.pos.x, this.feetY + 1.0, this.pos.z);
    _v.set(Math.sin(h), 0, Math.cos(h));
    this._ray.set(origin, _v);
    this._ray.far = dist;
    return this._ray.intersectObject(this.collider.mesh, false).length > 0;
  }

  // Pick a heading toward `desired` that isn't blocked. Commits to a turn side
  // (hysteresis) so it goes *around* furniture instead of oscillating in place.
  _avoidSteer(desired, dist) {
    if (!this._rayHit(desired, dist)) { this._avoidSide = 0; return desired; }
    const side = this._avoidSide || (Math.random() < 0.5 ? 1 : -1);
    for (const mag of [0.5, 0.9, 1.3, 1.8, 2.4]) {
      if (!this._rayHit(desired + side * mag, dist)) { this._avoidSide = side; return desired + side * mag; }
      if (!this._rayHit(desired - side * mag, dist)) { this._avoidSide = -side; return desired - side * mag; }
    }
    this._avoidSide = side;
    return desired + side * 2.4; // boxed in — keep turning to escape
  }

  // Step toward heading, following the floor; refuse drops bigger than `dropTol`.
  _advance(dt, dropTol) {
    if (this.speed < 0.01) { this.pos.y = this.feetY; return false; }
    const adv = this.speed * dt;
    const nx = this.pos.x + Math.sin(this.heading) * adv;
    const nz = this.pos.z + Math.cos(this.heading) * adv;
    const fy = this.collider.groundY(nx, nz, this.feetY + MONSTER.floorScan);
    if (fy == null || fy < this.feetY - dropTol) { this.speed = 0; return false; } // void / big drop
    if (fy - this.feetY > 0.6) { this.speed = 0; return false; }                    // too tall to step up (table/wall)
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

  // Does it notice the player? Close range = sensed presence (no sightline needed,
  // so a chair/wall corner doesn't hide you when you're right there). Farther
  // away it must actually see you: clear line of sight AND within its vision cone.
  _canSee() {
    const p = this.player.position;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MONSTER.senseRange) return false;
    if (dist <= MONSTER.hearRange) return true;

    const from = this._tmp.set(this.pos.x, this.feetY + 1.9, this.pos.z);
    _v.set(p.x - from.x, p.y - from.y, p.z - from.z);
    const len = _v.length(); _v.normalize();
    this._ray.set(from, _v); this._ray.far = len - 0.4;
    if (this._ray.intersectObject(this.collider.mesh, false).length) return false;
    let d = Math.atan2(dx, dz) - this.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= MONSTER.senseFov;
  }

  update(dt) {
    this.t += dt;
    if (this.state === 'caught') { this.speed = 0; this._animate(dt); this._applyTransform(); return; }

    const see = this._canSee();
    if (see) { this.lastSeen.copy(this.player.position); this.loseTimer = 0; if (this.state !== 'chase') this.state = 'chase'; }
    else if (this.state === 'chase') { this.loseTimer += dt; if (this.loseTimer > MONSTER.loseTime) this.state = 'wander'; }

    if (this.state === 'chase') this._chase(dt, see);
    else this._wander(dt);

    this._animate(dt);
    this._applyTransform();
  }

  _chase(dt, see) {
    const dx = this.lastSeen.x - this.pos.x, dz = this.lastSeen.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const steer = this._avoidSteer(desired, MONSTER.avoidDist);
    const d = this._turnToward(steer, MONSTER.chaseTurnRate, dt);

    const want = Math.abs(d) > 1.0 ? MONSTER.runSpeed * 0.35 : MONSTER.runSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, dist < 0.8 ? 0 : want, 8, dt);
    this._advance(dt, 1.6); // relaxed drop tolerance so it can follow you down steps

    // grab the player? (state flips to 'caught', so this only fires once until reset)
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
    // route around walls toward the waypoint (wall-following via steer hysteresis)
    const steer = this._avoidSteer(Math.atan2(dx, dz), this.halfWidth + 1.0);
    const d = this._turnToward(steer, MONSTER.turnRate, dt);
    const want = Math.abs(d) > 1.0 ? MONSTER.walkSpeed * 0.4 : MONSTER.walkSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, want, 6, dt);
    if (this._advance(dt, 0.6)) { this._stuckT = 0; }
    else { this._stuckT = (this._stuckT || 0) + dt; if (this._stuckT > 0.7) { this._stuckT = 0; this._newTarget(); } }
  }

  /** Reset to calm wandering at home (after a respawn). */
  reset() {
    this.state = 'wander';
    this.feetY = this.collider.groundY(MONSTER.home.x, MONSTER.home.z, 2.5) ?? -0.2;
    this.pos.set(MONSTER.home.x, this.feetY, MONSTER.home.z);
    this.speed = 0; this.heading = 0; this.pauseLeft = 1.0; this.loseTimer = 0;
    this.target.copy(this.pos);
    this._applyTransform();
  }

  /** A snarling lunge for the jumpscare; `t` is seconds into the scare. */
  screamPose(t) {
    const a = 1 + Math.sin(t * 22) * 0.12; // trembling
    this._rot(this.bones.uarmL, X, -2.2 * a); this._rot(this.bones.uarmR, X, -2.2 * a); // arms thrown up
    this._rot(this.bones.forearmL, X, -1.1); this._rot(this.bones.forearmR, X, -1.1);
    this._rot(this.bones.spine, X, 0.25); this._rot(this.bones.chest, X, 0.3);
    this._rot(this.bones.head, X, 0.35 * a);
    for (let i = 0; i < this.tail.length; i++) this._rot(this.tail[i], Y, Math.sin(t * 18 + i) * 0.3);
    this._bob = Math.sin(t * 25) * 0.04;
  }

  // ---------------- procedural skeletal animation ----------------
  _animate(dt) {
    const sp = this.speed;
    const run = THREE.MathUtils.clamp(sp / MONSTER.runSpeed, 0, 1);       // 0..1 walk→run
    const moving = THREE.MathUtils.clamp(sp / MONSTER.walkSpeed, 0, 1);    // 0 idle .. 1 walking

    // stride frequency rises with speed; phase advances with distance for foot-sync
    this.phase += dt * (3.0 + run * 5.0) * (0.3 + moving);
    const p = this.phase;
    const A = 0.55 + run * 0.35;        // leg swing amplitude
    const K = 0.9 + run * 0.6;          // knee bend
    const arm = 0.6 + run * 0.6;        // arm swing amplitude
    // monster's right-axis in world space → swings limbs front/back
    const rax = _rax.set(Math.cos(this.heading), 0, -Math.sin(this.heading));

    // legs (swing about local X), opposite phase L/R
    this._rot(this.bones.thighL, X, Math.sin(p) * A * moving);
    this._rot(this.bones.thighR, X, Math.sin(p + Math.PI) * A * moving);
    // knees bend on the lift/back part of the stride
    this._rot(this.bones.shinL, X, -Math.max(0, Math.sin(p + 1.4)) * K * moving);
    this._rot(this.bones.shinR, X, -Math.max(0, Math.sin(p + Math.PI + 1.4)) * K * moving);
    this._rot(this.bones.footL, X, Math.sin(p + 0.7) * 0.25 * moving);
    this._rot(this.bones.footR, X, Math.sin(p + Math.PI + 0.7) * 0.25 * moving);

    // arms swing opposite the legs (about the world right-axis so it's visible)
    this._rotWorld(this.bones.uarmL, rax, Math.sin(p + Math.PI) * arm * moving);
    this._rotWorld(this.bones.uarmR, rax, Math.sin(p) * arm * moving);
    this._rotWorld(this.bones.forearmL, rax, -(0.25 + Math.max(0, Math.sin(p)) * 0.5) * moving);
    this._rotWorld(this.bones.forearmR, rax, -(0.25 + Math.max(0, Math.sin(p + Math.PI)) * 0.5) * moving);

    // torso: vertical bob (twice per stride) + lateral sway + breathing when idle
    const breathe = Math.sin(this.t * 1.6) * 0.02 * (1 - moving);
    this._bob = (Math.abs(Math.sin(p)) * 0.06 * moving) + breathe * 0.0;
    this._rot(this.bones.spine, Z, Math.sin(p) * 0.06 * moving + breathe);
    this._rot(this.bones.chest, X, -0.04 * moving + breathe * 0.5);

    // tail whip: travelling wave down the segments
    for (let i = 0; i < this.tail.length; i++) {
      const a = Math.sin(this.t * (2.5 + run * 2) - i * 0.7) * (0.12 + 0.06 * moving);
      this._rot(this.tail[i], Y, a);
    }

    // head: look toward the player a little, stabilise against bob
    if (this.bones.head && this.player) {
      const dx = this.player.position.x - this.pos.x;
      const dz = this.player.position.z - this.pos.z;
      const toPlayer = Math.atan2(dx, dz);
      let d = toPlayer - this.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this._rot(this.bones.head, Y, THREE.MathUtils.clamp(d, -0.9, 0.9) * 0.6);
    }
  }
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pwq = new THREE.Quaternion();
const _rax = new THREE.Vector3();
