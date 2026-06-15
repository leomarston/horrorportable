import * as THREE from 'three';
import { PICKUPS } from './config.js';

const BOOK_COLORS = [0x7a2b2b, 0x2b3f7a, 0x2b6b43, 0x6b5a2b, 0x4b2b6b, 0x2b6b6b];

/**
 * Collectible books (gather them all to win) and batteries (recharge the torch).
 * Items are simple procedural meshes that float, spin and carry an additive
 * glow sprite so they read clearly in the dark without spending extra lights.
 * Collection is by proximity (walk into them).
 */
export default class Pickups {
  constructor(scene, collider, player, flashlight, opts) {
    this.scene = scene;
    this.collider = collider;
    this.player = player;
    this.flashlight = flashlight;
    this.onBook = opts.onBook;
    this.onBattery = opts.onBattery;
    this.t = 0;
    this.items = [];
    this.glowTex = this._glowTexture();

    PICKUPS.books.forEach((p, i) => this._add('book', p, i));
    PICKUPS.batteries.forEach((p, i) => this._add('battery', p, i));
  }

  get bookTotal() { return PICKUPS.books.length; }

  _glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  _glow(color, scale) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6, transparent: true,
    }));
    s.scale.setScalar(scale);
    return s;
  }

  _book(i) {
    const g = new THREE.Group();
    const c = BOOK_COLORS[i % BOOK_COLORS.length];
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.44, 0.11),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, emissive: c, emissiveIntensity: 0.3 })
    );
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(0.27, 0.40, 0.095),
      new THREE.MeshStandardMaterial({ color: 0xe6dcb8, roughness: 0.9, emissive: 0x3a3018, emissiveIntensity: 0.4 })
    );
    pages.position.x = 0.025;
    g.add(cover, pages);
    g.add(this._glow(0xffcf8a, 1.0));
    g.rotation.set(0.15, 0, 0.12);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  _battery() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.28, 14),
      new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.5, metalness: 0.3, emissive: 0x103a16, emissiveIntensity: 0.5 })
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0xcacaca, metalness: 0.8, roughness: 0.3 })
    );
    cap.position.y = 0.16;
    g.add(body, cap);
    g.add(this._glow(0x88ffa0, 0.85));
    g.rotation.z = 0.35;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  _add(type, p, i) {
    const fy = this.collider.groundY(p.x, p.z, p.y + 2.0) ?? p.y;
    const baseY = fy + PICKUPS.hoverHeight;
    const mesh = type === 'book' ? this._book(i) : this._battery();
    mesh.position.set(p.x, baseY, p.z);
    this.scene.add(mesh);
    this.items.push({ type, mesh, baseY, phase: i * 1.3, collected: false });
  }

  update(dt) {
    this.t += dt;
    const px = this.player.position.x, pz = this.player.position.z;
    for (const it of this.items) {
      if (it.collected) continue;
      it.mesh.rotation.y += dt * 1.3;
      it.mesh.position.y = it.baseY + Math.sin(this.t * 2 + it.phase) * 0.09;
      if (Math.hypot(px - it.mesh.position.x, pz - it.mesh.position.z) < PICKUPS.collectDist) this._collect(it);
    }
  }

  _collect(it) {
    it.collected = true;
    this.scene.remove(it.mesh);
    it.mesh.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
      if (o.isSprite) o.material.dispose();
    });
    if (it.type === 'book') this.onBook();
    else { this.flashlight.recharge(this.flashlight._cfg.rechargeAmount); this.onBattery(); }
  }
}
