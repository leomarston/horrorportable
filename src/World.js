import * as THREE from 'three';
import Collider from './Collisions.js';
import Atmosphere from './Atmosphere.js';
import { SPAWN, PLAYER, NON_SOLID_MATERIAL } from './config.js';

/**
 * Takes the loaded glTF, tunes its materials for the night/horror look and the
 * chosen quality tier, then builds the collider, atmosphere and spawn point.
 */
export default class World {
  constructor(engine, gltf, preset) {
    this.engine = engine;
    this.preset = preset;
    this.root = gltf.scene;

    this._processMaterials(engine, preset);
    engine.scene.add(this.root);

    this.collider = new Collider(this.root);

    const sp = this.collider.findSpawnY(SPAWN.x, SPAWN.z);
    this.spawnPoint = new THREE.Vector3(sp.x, sp.y + PLAYER.standSegment + PLAYER.radius * 2, sp.z);
    this.spawnYaw = SPAWN.yaw;
    this.spawnPitch = SPAWN.pitch;

    this.atmosphere = new Atmosphere(engine.scene, preset, this.collider, this.root);
  }

  _processMaterials(engine, preset) {
    const maxAniso = engine.renderer.capabilities.getMaxAnisotropy();
    const aniso = Math.min(preset.anisotropy, maxAniso);

    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const decal = NON_SOLID_MATERIAL.test(`${(o.material && o.material.name) || ''} ${o.name || ''}`);

      o.castShadow = preset.shadows && !decal;
      o.receiveShadow = preset.shadows;
      o.frustumCulled = true;

      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.dithering = true; // smooth the dark fog gradients
        if (m.map) m.map.anisotropy = aniso;

        // Make the lamp/light textures actually glow (and feed bloom).
        const isEmissive = !!m.emissiveMap || (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05);
        if (isEmissive) {
          if (m.emissiveMap && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) < 0.05) {
            m.emissive = new THREE.Color(0xffffff);
          }
          m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 1.6);
          m.toneMapped = true;
        }

        // Glass: keep real transmission only on High; otherwise cheap transparency.
        if (m.transmission && m.transmission > 0) {
          if (preset.transmission) {
            m.thickness = m.thickness || 0.4;
            m.ior = m.ior || 1.3;
            m.roughness = Math.min(m.roughness ?? 0.1, 0.15);
            m.transparent = true;
          } else {
            m.transmission = 0;
            m.transparent = true;
            m.opacity = 0.28;
            m.depthWrite = false;
            m.roughness = 0.2;
          }
        }

        m.needsUpdate = true;
      }
    });
  }

  update(dt, playerPos) {
    this.atmosphere.update(dt, playerPos);
  }
}
