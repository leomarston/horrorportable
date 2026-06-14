import * as THREE from 'three';
import { ATMOSPHERE } from './config.js';

/**
 * Handheld flashlight: a spotlight that trails the camera with a little lag and
 * flicker so it reads as carried, not bolted on. Plus a faint warm fill so the
 * world isn't pure black when the light is off.
 */
export default class Flashlight {
  constructor(scene, preset) {
    const f = ATMOSPHERE.flashlight;
    this.on = f.startsOn;

    this.spot = new THREE.SpotLight(f.color, f.intensity, f.distance, f.angle, f.penumbra, f.decay);
    this.spot.visible = this.on;
    if (preset.flashlightShadow) {
      this.spot.castShadow = true;
      this.spot.shadow.mapSize.set(1024, 1024);
      this.spot.shadow.camera.near = 0.2;
      this.spot.shadow.camera.far = f.distance;
      this.spot.shadow.bias = -0.0004;
      this.spot.shadow.normalBias = 0.5;
    }
    scene.add(this.spot);
    scene.add(this.spot.target);

    // faint personal fill so dark corners read slightly even with light off
    this.fill = new THREE.PointLight(0xb9a98a, 1.4, 7, 1.6);
    scene.add(this.fill);

    this._pos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._init = false;
    this.t = 0;
  }

  toggle() {
    this.on = !this.on;
    this.spot.visible = this.on;
  }

  update(dt, camera) {
    this.t += dt;
    camera.getWorldDirection(this._fwd);
    this._right.crossVectors(this._fwd, camera.up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();

    // hold point: from the eye, a touch down and to the right (handheld)
    this._pos.copy(camera.position)
      .addScaledVector(this._right, 0.18)
      .addScaledVector(this._up, -0.16);
    this.spot.position.copy(this._pos);
    this.fill.position.copy(camera.position);

    // aim with a small sway + lag for a carried feel
    const swayX = Math.sin(this.t * 1.7) * 0.012 + Math.sin(this.t * 0.7) * 0.008;
    const swayY = Math.cos(this.t * 1.3) * 0.010;
    this._targetPos.copy(camera.position)
      .addScaledVector(this._fwd, 12)
      .addScaledVector(this._right, swayX * 12)
      .addScaledVector(this._up, swayY * 12);
    if (!this._init) { this._smoothTarget.copy(this._targetPos); this._init = true; }
    this._smoothTarget.lerp(this._targetPos, 1 - Math.exp(-14 * dt));
    this.spot.target.position.copy(this._smoothTarget);
    this.spot.target.updateMatrixWorld();

    // subtle flicker
    if (this.on) {
      const n = Math.sin(this.t * 31) * 0.5 + Math.sin(this.t * 11.3) * 0.5;
      this.spot.intensity = ATMOSPHERE.flashlight.intensity * (0.92 + 0.08 * (n * 0.5 + 0.5));
    }
  }
}
