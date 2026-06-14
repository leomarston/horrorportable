import * as THREE from 'three';
import { PLAYER } from './config.js';

const LOOK_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

/**
 * First-person capsule controller. Movement is integrated with gravity and
 * resolved against the level BVH with a collide-and-slide capsule sweep
 * (the canonical three-mesh-bvh character approach), sub-stepped for stability.
 * The walkable footprint clamps the player so they can never leave the map.
 */
export default class Player {
  constructor(camera, collider, input) {
    this.camera = camera;
    this.collider = collider;
    this.input = input;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.hvel = new THREE.Vector3(); // horizontal-only working vector
    this.yaw = 0;
    this.pitch = 0;
    this.segLen = PLAYER.standSegment;
    this.onGround = false;
    this.bobT = 0;
    this.bob = 0;
    this.extraColliders = []; // dynamic BVHs (e.g. closed doors): { geometry, active() }
    this._trees = [];

    // scratch
    this._seg = new THREE.Line3();
    this._box = new THREE.Box3();
    this._triPoint = new THREE.Vector3();
    this._capPoint = new THREE.Vector3();
    this._newPos = new THREE.Vector3();
    this._rawDelta = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  spawn(pos, yaw = 0, pitch = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.onGround = false;
  }

  update(dt) {
    const input = this.input;

    // ---- look ----
    const look = input.consumeLook();
    this.yaw -= look.x * LOOK_SENS;
    this.pitch -= look.y * LOOK_SENS;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

    // ---- crouch height (keep feet planted) ----
    const targetSeg = input.crouch ? PLAYER.crouchSegment : PLAYER.standSegment;
    const newSeg = THREE.MathUtils.damp(this.segLen, targetSeg, 12, dt);
    if (this.onGround) this.position.y += newSeg - this.segLen;
    this.segLen = newSeg;

    // ---- desired horizontal velocity from input ----
    this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1); // yaw 0 → -Z
    this._right.set(-this._fwd.z, 0, this._fwd.x); // right = forward × up (so D = screen-right)
    let ix = input.move.x, iy = input.move.y;
    const ilen = Math.hypot(ix, iy);
    if (ilen > 1) { ix /= ilen; iy /= ilen; }

    const speed = input.crouch ? PLAYER.crouchSpeed : input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    this._dir.set(0, 0, 0)
      .addScaledVector(this._fwd, iy)
      .addScaledVector(this._right, ix);
    const moving = this._dir.lengthSq() > 1e-4;
    if (moving) this._dir.normalize();

    this.hvel.set(this.velocity.x, 0, this.velocity.z);
    if (moving) {
      const desired = this._dir.multiplyScalar(speed);
      const a = this.onGround ? PLAYER.accel : PLAYER.airAccel;
      const k = 1 - Math.exp(-a * dt);
      this.hvel.lerp(desired, k);
    } else {
      const d = Math.exp(-(this.onGround ? PLAYER.damping : 1.5) * dt);
      this.hvel.multiplyScalar(d);
    }
    this.velocity.x = this.hvel.x;
    this.velocity.z = this.hvel.z;

    // ---- jump ----
    if (this.onGround && input.consumeEdge('jump')) {
      this.velocity.y = PLAYER.jumpSpeed;
      this.onGround = false;
    } else {
      input.consumeEdge('jump');
    }

    // ---- integrate + collide (sub-stepped) ----
    const steps = PLAYER.stepSubdivisions;
    const sdt = dt / steps;
    let grounded = false;
    for (let s = 0; s < steps; s++) {
      this.velocity.y += PLAYER.gravity * sdt;
      this.position.addScaledVector(this.velocity, sdt);
      if (this._collide(sdt)) grounded = true;
    }
    this.onGround = grounded;

    // ---- map-edge clamp (controls the edges of the world) ----
    const w = this.collider.walkable;
    const r = PLAYER.radius + 0.05;
    if (this.position.x < w.minX + r) { this.position.x = w.minX + r; if (this.velocity.x < 0) this.velocity.x = 0; }
    if (this.position.x > w.maxX - r) { this.position.x = w.maxX - r; if (this.velocity.x > 0) this.velocity.x = 0; }
    if (this.position.z < w.minZ + r) { this.position.z = w.minZ + r; if (this.velocity.z < 0) this.velocity.z = 0; }
    if (this.position.z > w.maxZ - r) { this.position.z = w.maxZ - r; if (this.velocity.z > 0) this.velocity.z = 0; }

    // ---- safety respawn ----
    if (this.position.y < PLAYER.fallRespawnY) {
      const sp = this.collider.findSpawnY((w.minX + w.maxX) / 2, (w.minZ + w.maxZ) / 2);
      this.position.set(sp.x, sp.y + this.segLen + PLAYER.radius * 2, sp.z);
      this.velocity.set(0, 0, 0);
    }

    this._applyCamera(dt);
  }

  /** Resolve the capsule against the world BVH (+ any active extra colliders). */
  _collide(sdt) {
    const radius = PLAYER.radius;
    const seg = this._seg;
    seg.start.copy(this.position);
    seg.end.copy(this.position).y -= this.segLen;

    // world + active dynamic colliders (e.g. a closed door)
    this._trees.length = 0;
    this._trees.push(this.collider.geometry.boundsTree);
    for (const ec of this.extraColliders) if (ec.active()) this._trees.push(ec.geometry.boundsTree);

    const triPoint = this._triPoint, capPoint = this._capPoint, box = this._box;
    for (const tree of this._trees) {
      box.makeEmpty();
      box.expandByPoint(seg.start);
      box.expandByPoint(seg.end);
      box.min.addScalar(-radius);
      box.max.addScalar(radius);
      tree.shapecast({
        intersectsBounds: (b) => b.intersectsBox(box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(seg, triPoint, capPoint);
          if (dist < radius) {
            const depth = radius - dist;
            this._dir.copy(capPoint).sub(triPoint).normalize();
            seg.start.addScaledVector(this._dir, depth);
            seg.end.addScaledVector(this._dir, depth);
          }
        },
      });
    }

    this._newPos.copy(seg.start);
    this._rawDelta.subVectors(this._newPos, this.position);
    const grounded = this._rawDelta.y > Math.abs(this.velocity.y * sdt) * 0.25 + 1e-5;

    const offset = Math.max(0, this._rawDelta.length() - 1e-5);
    if (offset > 0) {
      this._normal.copy(this._rawDelta).normalize();
      this.position.addScaledVector(this._normal, offset);
      const into = this._normal.dot(this.velocity);
      if (into < 0) this.velocity.addScaledVector(this._normal, -into);
    }
    return grounded;
  }

  _applyCamera(dt) {
    // head-bob driven by horizontal speed while grounded
    const sh = Math.hypot(this.velocity.x, this.velocity.z);
    const target = PLAYER.walkSpeed;
    if (this.onGround && sh > 0.4) {
      this.bobT += dt * PLAYER.headBobSpeed * Math.min(1.4, sh / target);
      const amt = PLAYER.headBobAmount * Math.min(1, sh / target);
      this.bob = Math.sin(this.bobT) * amt;
    } else {
      this.bob = THREE.MathUtils.damp(this.bob, 0, 8, dt);
    }

    const cam = this.camera;
    cam.position.copy(this.position);
    cam.position.y += this.bob;
    cam.position.addScaledVector(this._right, Math.cos(this.bobT * 0.5) * this.bob * 0.6);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
