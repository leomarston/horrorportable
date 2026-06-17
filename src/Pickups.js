import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PICKUPS } from './config.js';

/**
 * Collectible papers. They're scattered randomly across the house ground floor
 * each game, lie flat on the floor, do NOT glow, and are collected by walking
 * over / touching them or pressing the interact key when close. Gather them all
 * to win.
 */
export default class Pickups {
  static async loadPaper() {
    const loader = new GLTFLoader();
    return loader.loadAsync(PICKUPS.paperUrl);
  }

  constructor(scene, collider, player, paperGltf, opts) {
    this.scene = scene;
    this.collider = collider;
    this.player = player;
    this.onPaper = opts.onPaper;
    this.items = [];
    this.spawned = false;

    this._proto = this._buildProto(paperGltf);
  }

  get total() { return this.items.length; }

  /** Scatter the papers across the house (called once, when Objective 3 begins). */
  spawn() {
    if (this.spawned) return;
    this.spawned = true;
    this._place();
  }

  // Scale, centre and matte-ify the paper once; clones share its geometry/material.
  _buildProto(gltf) {
    const inner = gltf.scene;
    inner.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = new THREE.Vector3(); box.getSize(size);
    inner.scale.setScalar(PICKUPS.paperSize / Math.max(size.x, size.z, 0.001));
    inner.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(inner);
    const c = new THREE.Vector3(); box2.getCenter(c);
    inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= box2.min.y; // centre XZ, bottom at 0
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) { m.roughness = 0.95; m.metalness = 0; if (m.emissive) m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 0; }
    });
    const proto = new THREE.Group();
    proto.add(inner);
    return proto;
  }

  _place() {
    const a = PICKUPS.paperArea;
    const placed = [];
    let tries = 0;
    while (placed.length < PICKUPS.paperCount && tries < 1000) {
      tries++;
      const x = THREE.MathUtils.lerp(a.minX, a.maxX, Math.random());
      const z = THREE.MathUtils.lerp(a.minZ, a.maxZ, Math.random());
      const y = this.collider.groundY(x, z, 1.7);          // low ray → ground floor only
      if (y == null || y < -0.8 || y > 0.6) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < PICKUPS.paperMinSep ** 2)) continue;
      placed.push({ x, y, z });
      const mesh = this._proto.clone();
      mesh.position.set(x, y + 0.02, z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(mesh);
      this.items.push({ mesh, collected: false });
    }
  }

  update() {
    const px = this.player.position.x, pz = this.player.position.z;
    for (const it of this.items) {
      if (it.collected) continue;
      if (Math.hypot(px - it.mesh.position.x, pz - it.mesh.position.z) < PICKUPS.touchDist) this._collect(it);
    }
  }

  /** Collect the nearest paper within interact range (the E key). Returns true if one was taken. */
  tryInteract() {
    const px = this.player.position.x, pz = this.player.position.z;
    let near = null, nd = PICKUPS.interactDist;
    for (const it of this.items) {
      if (it.collected) continue;
      const d = Math.hypot(px - it.mesh.position.x, pz - it.mesh.position.z);
      if (d < nd) { nd = d; near = it; }
    }
    if (near) { this._collect(near); return true; }
    return false;
  }

  _collect(it) {
    it.collected = true;
    this.scene.remove(it.mesh);   // clones share geometry/material — don't dispose
    this.onPaper();
  }
}
