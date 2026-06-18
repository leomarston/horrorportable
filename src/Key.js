import * as THREE from 'three';
import { KEY } from './config.js';

/**
 * The key Nulmire drops when killed. A small procedural brass key that hovers,
 * spins and glows (so you can find it in the dark), collected by walking over it
 * or pressing E nearby. Used to unlock the front door and escape.
 */
export default class Key {
  constructor(scene) {
    this.scene = scene;
    this.mesh = this._build();
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.active = false;     // dropped & collectable
    this.collected = false;
    this._t = 0;
    this._baseY = 0;
  }

  _build() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe0ad3e, metalness: 0.85, roughness: 0.35,
      emissive: 0x7a5410, emissiveIntensity: 0.9,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 8, 18), mat);
    ring.rotation.y = Math.PI / 2; g.add(ring);                       // bow (head)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 10), mat);
    shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.2; g.add(shaft); // shaft
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.06, 0.02), mat); t1.position.set(0.32, -0.045, 0); g.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.085, 0.02), mat); t2.position.set(0.27, -0.055, 0); g.add(t2);
    this.light = new THREE.PointLight(0xffc864, 0, 2.4, 2); g.add(this.light); // findable glow
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    return g;
  }

  drop(x, y, z) {
    this._baseY = y + 0.3;
    this.mesh.position.set(x, this._baseY, z);
    this.mesh.visible = true;
    this.active = true;
    this.light.intensity = 6;
  }

  /** Spin/bob and auto-collect on walk-over. Returns true the frame it's taken. */
  update(dt, playerPos) {
    if (!this.active || this.collected) return false;
    this._t += dt;
    this.mesh.rotation.y += dt * 1.5;
    this.mesh.position.y = this._baseY + Math.sin(this._t * 2.2) * 0.05;
    if (this._dist(playerPos) < KEY.collectDist) { this._collect(); return true; }
    return false;
  }

  /** E-collect when close. Returns true if taken. */
  collectIfNear(playerPos) {
    if (!this.active || this.collected) return false;
    if (this._dist(playerPos) < KEY.interactDist) { this._collect(); return true; }
    return false;
  }

  _dist(p) { return Math.hypot(p.x - this.mesh.position.x, p.z - this.mesh.position.z); }
  _collect() { this.collected = true; this.active = false; this.mesh.visible = false; this.light.intensity = 0; }
}
