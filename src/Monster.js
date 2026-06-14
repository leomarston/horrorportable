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

  // bone.quaternion = rest * rotation(axis, angle)
  _rot(bone, axis, angle) {
    if (!bone) return;
    const rest = this.rest.get(bone);
    bone.quaternion.copy(rest).multiply(_q.setFromAxisAngle(axis, angle));
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

  _wallAhead(dist) {
    const origin = this._tmp.set(this.pos.x, this.feetY + 1.0, this.pos.z);
    const dir = _v.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this._ray.set(origin, dir);
    this._ray.far = dist;
    const hit = this._ray.intersectObject(this.collider.mesh, false);
    return hit.length > 0;
  }

  update(dt) {
    this.t += dt;

    // decide where to go
    const toT = _v.set(this.target.x - this.pos.x, 0, this.target.z - this.pos.z);
    const distToT = toT.length();
    let desiredSpeed = 0;

    if (this.pauseLeft > 0) {
      this.pauseLeft -= dt;                       // idling at a waypoint
    } else if (distToT < MONSTER.arriveDist) {
      this.pauseLeft = THREE.MathUtils.lerp(MONSTER.pauseRange[0], MONSTER.pauseRange[1], Math.random());
      this._newTarget();
    } else {
      // steer heading toward the target (shortest angular direction)
      const want = Math.atan2(toT.x, toT.z);
      let d = want - this.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const step = Math.sign(d) * Math.min(Math.abs(d), MONSTER.turnRate * dt);
      this.heading += step;
      // only advance when roughly facing the target and nothing is in the way
      const aligned = Math.abs(d) < 0.6;
      if (aligned && this._wallAhead(this.halfWidth + 0.8)) {
        this.heading += (Math.random() < 0.5 ? 1 : -1) * 1.2; // bounce off the wall
        this._newTarget();
      } else if (aligned) {
        desiredSpeed = MONSTER.walkSpeed;
      }
    }

    this.speed = THREE.MathUtils.damp(this.speed, desiredSpeed, 6, dt);

    // move forward along heading, following the ground floor; never step off a
    // ledge into the void (treat a big drop / missing floor as a wall)
    if (this.speed > 0.01) {
      const adv = this.speed * dt;
      const nx = this.pos.x + Math.sin(this.heading) * adv;
      const nz = this.pos.z + Math.cos(this.heading) * adv;
      const fy = this.collider.groundY(nx, nz, this.feetY + MONSTER.floorScan);
      if (fy == null || fy < this.feetY - 0.6) {
        this.speed = 0; this.pauseLeft = 0.25; this._newTarget(); // edge ahead → stop & re-route
      } else {
        if (Math.abs(fy - this.feetY) < 1.0) this.feetY = THREE.MathUtils.damp(this.feetY, fy, 12, dt);
        this.pos.set(nx, this.feetY, nz);
      }
    } else {
      this.pos.y = this.feetY;
    }

    this._animate(dt);
    this._applyTransform();
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
    const arm = 0.4 + run * 0.5;

    // legs (swing about local X), opposite phase L/R
    this._rot(this.bones.thighL, X, Math.sin(p) * A * moving);
    this._rot(this.bones.thighR, X, Math.sin(p + Math.PI) * A * moving);
    // knees bend on the lift/back part of the stride
    this._rot(this.bones.shinL, X, -Math.max(0, Math.sin(p + 1.4)) * K * moving);
    this._rot(this.bones.shinR, X, -Math.max(0, Math.sin(p + Math.PI + 1.4)) * K * moving);
    this._rot(this.bones.footL, X, Math.sin(p + 0.7) * 0.25 * moving);
    this._rot(this.bones.footR, X, Math.sin(p + Math.PI + 0.7) * 0.25 * moving);

    // arms swing opposite the legs
    this._rot(this.bones.uarmL, X, Math.sin(p + Math.PI) * arm * moving);
    this._rot(this.bones.uarmR, X, Math.sin(p) * arm * moving);
    this._rot(this.bones.forearmL, X, -(0.3 + Math.max(0, Math.sin(p)) * 0.4) * moving);
    this._rot(this.bones.forearmR, X, -(0.3 + Math.max(0, Math.sin(p + Math.PI)) * 0.4) * moving);

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
