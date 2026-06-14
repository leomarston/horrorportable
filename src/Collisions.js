import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { NON_SOLID_MATERIAL, DOOR } from './config.js';

// Accelerate ray casts against any mesh that carries a boundsTree.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * Builds one merged, world-space collision mesh from the level's solid surfaces
 * and wraps it in a BVH. Vertices are baked through matrixWorld by hand so the
 * KHR_mesh_quantization (Int16) positions are dequantized correctly.
 *
 * The asset's ground is not contiguous — a road/yard plane at the bottom with
 * elevated buildings and voids between them. So we also lay an *invisible floor*
 * at the dominant ground height across the whole footprint: you can roam the
 * entire map and never fall out of the world, while real geometry (walls,
 * raised floors) still blocks and supports you on top.
 */
export default class Collider {
  constructor(root) {
    root.updateMatrixWorld(true);

    const chunks = [];
    let total = 0;
    const v = new THREE.Vector3();

    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const matName = (o.material && o.material.name) || '';
      if (matName === DOOR.material) return; // the openable door is handled by the Doors system
      const tag = `${matName} ${o.name || ''}`;
      if (NON_SOLID_MATERIAL.test(tag)) return; // skip cobwebs / grass / leaves

      const pos = o.geometry.attributes.position;
      const index = o.geometry.index;
      const m = o.matrixWorld;
      const n = index ? index.count : pos.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const vi = index ? index.getX(i) : i;
        v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m);
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      }
      chunks.push(arr);
      total += arr.length;
    });

    const real = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { real.set(c, off); off += c.length; }

    // Analyse the real geometry: footprint + ground levels.
    this._analyze(real);

    // Append the invisible safety floor just below the dominant ground level.
    const floorY = this.groundLevelY - 0.4;
    const w = this.walkable;
    const floor = new Float32Array([
      w.minX, floorY, w.minZ,  w.minX, floorY, w.maxZ,  w.maxX, floorY, w.maxZ,
      w.minX, floorY, w.minZ,  w.maxX, floorY, w.maxZ,  w.maxX, floorY, w.minZ,
    ]);
    this.floorY = floorY;

    const merged = new Float32Array(real.length + floor.length);
    merged.set(real, 0);
    merged.set(floor, real.length);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    geometry.boundsTree = new MeshBVH(geometry, { maxLeafTris: 8 });

    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.updateMatrixWorld(true); // identity → BVH local space == world space

    this.bbox = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 1e5;
    this._raycaster.firstHitOnly = true;
  }

  /** Footprint + ground levels from up-facing triangles near the bottom. */
  _analyze(pos3) {
    const triCount = pos3.length / 9;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const tri = (t, target, k) => target.set(pos3[t * 9 + k * 3], pos3[t * 9 + k * 3 + 1], pos3[t * 9 + k * 3 + 2]);

    this.bbox = new THREE.Box3();
    let groundMinY = Infinity;
    for (let t = 0; t < triCount; t++) {
      tri(t, a, 0); tri(t, b, 1); tri(t, c, 2);
      this.bbox.expandByPoint(a); this.bbox.expandByPoint(b); this.bbox.expandByPoint(c);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      if (n.lengthSq() < 1e-9) continue;
      if (n.normalize().y > 0.5) groundMinY = Math.min(groundMinY, (a.y + b.y + c.y) / 3);
    }
    if (!isFinite(groundMinY)) groundMinY = this.bbox.min.y;
    this.groundMinY = groundMinY;

    // Footprint AABB + dominant ground height, from the low ground band.
    // Weight the height histogram by triangle AREA so the big road/yard plane
    // wins over the many tiny up-facing triangles on props and steps.
    const band = groundMinY + 6;
    const hist = new Map();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let t = 0; t < triCount; t++) {
      tri(t, a, 0); tri(t, b, 1); tri(t, c, 2);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      const len = n.length();
      if (len < 1e-9) continue;
      const cy = (a.y + b.y + c.y) / 3;
      if (n.y / len > 0.5 && cy <= band) {
        minX = Math.min(minX, a.x, b.x, c.x); maxX = Math.max(maxX, a.x, b.x, c.x);
        minZ = Math.min(minZ, a.z, b.z, c.z); maxZ = Math.max(maxZ, a.z, b.z, c.z);
        const key = Math.round(cy);
        hist.set(key, (hist.get(key) || 0) + len * 0.5); // accumulate area
      }
    }
    if (!isFinite(minX)) { minX = this.bbox.min.x; maxX = this.bbox.max.x; minZ = this.bbox.min.z; maxZ = this.bbox.max.z; }
    this.walkable = { minX, maxX, minZ, maxZ };

    let mode = Math.round(groundMinY), best = -1;
    for (const [k, area] of hist) if (area > best) { best = area; mode = k; }
    this.groundLevelY = mode;
  }

  /** Cast straight down; returns world Y of the ground at (x,z), or null. */
  groundY(x, z, fromY = this.bbox.max.y + 50) {
    this._raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    const hits = this._raycaster.intersectObject(this.mesh, false);
    return hits.length ? hits[0].point.y : null;
  }

  /** Find a safe standing Y near a desired spawn (the invisible floor guarantees a hit). */
  findSpawnY(x, z) {
    const candidates = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]];
    for (const [dx, dz] of candidates) {
      const y = this.groundY(x + dx, z + dz);
      if (y != null) return { y, x: x + dx, z: z + dz };
    }
    return { y: this.floorY, x, z };
  }
}
