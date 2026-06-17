import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SAFE } from './config.js';

/**
 * An interactive animated safe. The model ships one skinned clip ("SafeOpen")
 * that swings the door, turns the handle and spins the knob. We scrub that clip
 * forward to open and backward to close, toggling on each interaction. The pose
 * is driven manually (set the action's time, apply with mixer.update(0)) so a
 * single clip cleanly plays both ways without LoopOnce/clamp edge cases.
 */
export default class Safe {
  static async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(SAFE.url);
  }

  constructor(scene, camera, gltf) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    scene.add(this.root);

    // ---- scale to target height, drop base to y=0, centre in XZ ----
    this.model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = SAFE.height / (size.y || 1);
    this.model.scale.setScalar(s);
    this.model.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(this.model);
    const c = new THREE.Vector3(); box2.getCenter(c);
    this.model.position.x -= c.x;
    this.model.position.z -= c.z;
    this.model.position.y -= box2.min.y;     // base sits on the surface
    this.halfExtent = Math.max(size.x, size.z) * s * 0.5;

    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
    });

    // ---- animation (scrubbed manually) ----
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = gltf.animations[0];
    this.duration = clip ? clip.duration : 0;
    this.action = clip ? this.mixer.clipAction(clip) : null;
    if (this.action) {
      this.action.setLoop(THREE.LoopRepeat);   // we clamp time ourselves
      this.action.play();
      this.action.paused = true;
      this.action.time = 0;                     // start fully closed
      this.mixer.update(0);
    }
    this.open = false;
    this.locked = true;   // won't open until all the papers are collected
    this._t = 0;          // current scrub time within the clip
    this._dir = 0;        // +1 opening, -1 closing, 0 settled

    this._ray = new THREE.Raycaster();
    this._ray.far = SAFE.range;
    this._fwd = new THREE.Vector3();
  }

  place(x, y, z, yaw = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
  }

  /** True if the player is looking at the safe within interaction range. */
  targeted() {
    this.camera.getWorldDirection(this._fwd);
    this._ray.set(this.camera.position, this._fwd);
    this._ray.far = SAFE.range;
    const hit = this._ray.intersectObject(this.model, true);
    return hit.length > 0 && hit[0].distance <= SAFE.range;
  }

  /** Try to open/close. Returns 'locked', 'opened' or 'closed'. */
  interact() {
    if (this.locked) return 'locked';
    this.open = !this.open;
    this._dir = this.open ? 1 : -1;
    return this.open ? 'opened' : 'closed';
  }

  unlock() { this.locked = false; }

  update(dt) {
    if (!this.action || this._dir === 0) return;
    this._t = THREE.MathUtils.clamp(this._t + this._dir * SAFE.openRate * dt, 0, this.duration);
    this.action.time = this._t;
    this.mixer.update(0);                       // apply the pose at _t
    if ((this._dir > 0 && this._t >= this.duration) || (this._dir < 0 && this._t <= 0)) this._dir = 0;
  }
}
