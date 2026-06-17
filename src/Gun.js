import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GUN } from './config.js';

/**
 * The Colt M1911. Two uses of the same model:
 *   - a static display lying in the open safe (makeSafeInstance),
 *   - a first-person viewmodel that follows the camera once equipped, with a
 *     recoil kick + muzzle flash on fire.
 * The model is skinned (a 'Fire' clip exists) but we never play it — it renders
 * in its bind pose. Hitscan is done from the camera centre by the game.
 */
export default class Gun {
  static async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(GUN.url);
  }

  constructor(scene, camera, gltf) {
    this.scene = scene;
    this.camera = camera;
    this._proto = gltf.scene;

    // centre the geometry on the model origin so offsets are predictable
    this._proto.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this._proto);
    const c = new THREE.Vector3(); box.getCenter(c);
    this._proto.position.sub(c);
    this._proto.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
    });

    // ---- first-person viewmodel: holder(camera) → pivot(recoil) → model ----
    this.holder = new THREE.Group();
    this.pivot = new THREE.Group();
    this.model = this._instance();
    this.model.scale.setScalar(GUN.viewScale);
    this.model.rotation.set(GUN.viewRot.x, GUN.viewRot.y, GUN.viewRot.z);
    this.pivot.add(this.model);
    this.holder.add(this.pivot);
    scene.add(this.holder);
    this.holder.visible = false;
    this.equipped = false;

    // muzzle flash: a brief warm light + an additive billboard at the barrel tip
    this.flash = new THREE.PointLight(0xffcf8a, 0, 3.0, 2);
    this.flash.position.set(GUN.viewPos.x * 0.5, GUN.viewPos.y + 0.02, GUN.viewPos.z - 0.22);
    this.holder.add(this.flash);
    const flashTex = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending }));
    flashTex.scale.setScalar(0.16);
    flashTex.position.copy(this.flash.position);
    this.holder.add(flashTex);
    this.flashSprite = flashTex;

    this._recoil = 0;
    this._flashT = 0;
  }

  /** A fresh skinned clone wrapped so its centre sits at the wrapper origin. */
  _instance() {
    const wrap = new THREE.Group();
    wrap.add(cloneSkinned(this._proto));
    return wrap;
  }

  /** A display copy to lie in the open safe (caller positions/adds it). */
  makeSafeInstance() {
    const g = this._instance();
    g.scale.setScalar(GUN.safeScale);
    g.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = true; });
    return g;
  }

  equip() { this.equipped = true; this.holder.visible = true; }

  /** Kick the recoil + muzzle flash. (Hit detection is the game's job.) */
  fire() {
    this._recoil = 1;
    this._flashT = GUN.flashTime;
  }

  update(dt) {
    if (!this.equipped) return;
    // follow the camera exactly, then place the gun in view space
    this.holder.position.copy(this.camera.position);
    this.holder.quaternion.copy(this.camera.quaternion);

    this.pivot.position.set(
      GUN.viewPos.x,
      GUN.viewPos.y + this._recoil * 0.025,                 // slight rise
      GUN.viewPos.z + this._recoil * GUN.recoilKick,        // kick back toward camera
    );
    this.pivot.rotation.set(this._recoil * GUN.recoilRise, 0, 0); // muzzle pitches up
    this._recoil = THREE.MathUtils.damp(this._recoil, 0, GUN.recoilRecover, dt);

    this._flashT = Math.max(0, this._flashT - dt);
    const on = this._flashT > 0;
    this.flash.intensity = on ? 40 : 0;
    this.flashSprite.material.opacity = on ? 0.9 : 0;
    if (on) this.flashSprite.scale.setScalar(0.13 + Math.random() * 0.06);
  }
}
