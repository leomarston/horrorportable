import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { DOOR } from './config.js';

/**
 * Interactive door(s). The house door is a single isolated mesh (material
 * "Puerta"). We hang it on a hinge pivot so it can swing, build a separate
 * collision BVH for its *closed* pose (so it blocks only while shut), and let
 * the player open/close it by looking at it and pressing the interact key.
 */
export default class Doors {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.doors = [];
    this.colliders = []; // consumed by the Player as extra collide-and-slide targets
    this._ray = new THREE.Raycaster();
    this._ray.far = DOOR.range + 2;
    this._dir = new THREE.Vector3();

    this._setup(scene);
  }

  _setup(scene) {
    scene.updateMatrixWorld(true);
    let mesh = null;
    scene.traverse((o) => { if (o.isMesh && o.material && o.material.name === DOOR.material) mesh = o; });
    if (!mesh) return;

    // Closed-pose collision geometry (baked + dequantized to world space).
    const closedGeom = this._bakeWorld(mesh);
    closedGeom.boundsTree = new MeshBVH(closedGeom);

    // Hinge on one vertical edge; attach the door so it keeps its world pose.
    const box = new THREE.Box3().setFromObject(mesh);
    const pivot = new THREE.Object3D();
    pivot.position.set(box.min.x, box.min.y, (box.min.z + box.max.z) / 2);
    scene.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(mesh);

    if (mesh.material) { mesh.material.side = THREE.DoubleSide; mesh.material.needsUpdate = true; }

    const door = { mesh, pivot, angle: 0, target: 0, open: false };
    this.doors.push(door);
    this.colliders.push({ geometry: closedGeom, active: () => Math.abs(door.angle) < DOOR.blockBelow });
  }

  _bakeWorld(mesh) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const m = mesh.matrixWorld;
    const n = index ? index.count : pos.count;
    const arr = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const vi = index ? index.getX(i) : i;
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /** Door the player is currently looking at within range, or null. */
  targeted(camera) {
    if (!this.doors.length) return null;
    camera.getWorldDirection(this._dir);
    this._ray.set(camera.position, this._dir);
    for (const d of this.doors) {
      const hit = this._ray.intersectObject(d.mesh, false);
      if (hit.length && hit[0].distance <= DOOR.range) return d;
    }
    return null;
  }

  interact(camera) {
    const d = this.targeted(camera);
    if (!d) return false;
    d.open = !d.open;
    d.target = d.open ? DOOR.openAngle : 0;
    return true;
  }

  update(dt, camera, onPrompt) {
    for (const d of this.doors) {
      if (Math.abs(d.angle - d.target) > 1e-3) {
        d.angle = THREE.MathUtils.damp(d.angle, d.target, DOOR.damp, dt);
        d.pivot.rotation.y = d.angle;
      }
    }
    if (onPrompt) {
      const d = this.targeted(camera);
      onPrompt(d ? (d.open ? 'Close door' : 'Open door') : null);
    }
  }
}
