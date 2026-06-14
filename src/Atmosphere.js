import * as THREE from 'three';
import { ATMOSPHERE, CAMERA } from './config.js';

const LAMP_RE = /foco|lampara|lamp|luz|bombilla|emisor|candil|vela|light/i;

export default class Atmosphere {
  constructor(scene, preset, collider, root) {
    this.scene = scene;
    this.preset = preset;
    this.t = 0;

    this._fogAndSky(scene);
    this._lights(scene, collider);
    this._dust(scene, preset);
    this._lampLights(scene, root, collider, preset);
  }

  _fogAndSky(scene) {
    scene.fog = new THREE.FogExp2(ATMOSPHERE.fogColor, ATMOSPHERE.fogDensity);
    scene.background = new THREE.Color(ATMOSPHERE.fogColor);

    const geo = new THREE.SphereGeometry(CAMERA.far * 0.92, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(ATMOSPHERE.skyTop) },
        bottom: { value: new THREE.Color(ATMOSPHERE.skyBottom) },
        moonColor: { value: new THREE.Color(ATMOSPHERE.moonColor) },
        moonDir: { value: new THREE.Vector3(ATMOSPHERE.moonDir.x, ATMOSPHERE.moonDir.y, ATMOSPHERE.moonDir.z).normalize() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 top; uniform vec3 bottom; uniform vec3 moonColor; uniform vec3 moonDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(h, 0.6));
          float m = max(dot(normalize(vDir), normalize(moonDir)), 0.0);
          col += moonColor * pow(m, 220.0) * 1.6;      // moon disc
          col += moonColor * pow(m, 6.0) * 0.05;        // soft halo
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  _lights(scene, collider) {
    const a = ATMOSPHERE;
    this.ambient = new THREE.AmbientLight(a.ambientColor, a.ambientIntensity);
    scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(a.hemiSky, a.hemiGround, a.hemiIntensity);
    scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(a.moonColor, a.moonIntensity);
    this.moonDir = new THREE.Vector3(a.moonDir.x, a.moonDir.y, a.moonDir.z).normalize();
    scene.add(this.moon);
    scene.add(this.moon.target);

    if (this.preset.shadows) {
      this.moon.castShadow = true;
      const s = this.preset.shadowMapSize;
      this.moon.shadow.mapSize.set(s, s);
      const H = 55; // half-extent of the shadowed area around the player (units)
      const cam = this.moon.shadow.camera;
      cam.left = -H; cam.right = H; cam.top = H; cam.bottom = -H;
      cam.near = 1; cam.far = 420;
      cam.updateProjectionMatrix();
      this.moon.shadow.bias = -0.0004;
      this.moon.shadow.normalBias = 0.7;
    }
  }

  _dust(scene, preset) {
    const count = Math.floor(ATMOSPHERE.dustCount * preset.dust);
    this.dustRange = 26;
    const R = this.dustRange;
    const pos = new Float32Array(count * 3);
    this.dustVel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * R;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * R;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * R;
      this.dustVel[i] = 0.15 + Math.random() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xb9c2c8,
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.dust = new THREE.Points(g, m);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  _lampLights(scene, root, collider, preset) {
    const max = preset.lampLights;
    this.lamps = [];
    if (max <= 0) return;

    const found = [];
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mat = o.material;
      const emissive = (mat.emissiveIntensity > 0 && mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.05) || !!mat.emissiveMap;
      const named = LAMP_RE.test(`${mat.name || ''} ${o.name || ''}`);
      if (!emissive && !named) return;
      box.setFromObject(o);
      if (!box.isEmpty()) {
        box.getCenter(center);
        found.push(center.clone());
      }
    });

    // Bias toward lamps near the house/spawn so we light where the player goes.
    const focus = new THREE.Vector3(
      (collider.walkable.minX + collider.walkable.maxX) / 2,
      collider.groundMinY + 3,
      (collider.walkable.minZ + collider.walkable.maxZ) / 2
    );
    found.sort((p, q) => p.distanceToSquared(focus) - q.distanceToSquared(focus));

    for (let i = 0; i < Math.min(max, found.length); i++) {
      const p = found[i];
      const light = new THREE.PointLight(ATMOSPHERE.lampColor, 8, 26, 1.4);
      light.position.copy(p);
      scene.add(light);
      this.lamps.push({ light, base: 8, phase: Math.random() * 100, flicker: Math.random() < 0.55 });
    }
  }

  update(dt, playerPos) {
    this.t += dt;

    if (this.sky) this.sky.position.copy(playerPos);

    // Moonlight follows the player so shadows stay crisp where it matters.
    this.moon.position.copy(playerPos).addScaledVector(this.moonDir, 200);
    this.moon.target.position.copy(playerPos);
    this.moon.target.updateMatrixWorld();

    // Dust box recenters on the player and drifts slowly upward.
    if (this.dust) {
      const arr = this.dust.geometry.attributes.position.array;
      const R = this.dustRange;
      for (let i = 0; i < this.dustVel.length; i++) {
        arr[i * 3 + 1] += this.dustVel[i] * dt;
        if (arr[i * 3 + 1] > R) arr[i * 3 + 1] = -R;
        arr[i * 3] += Math.sin(this.t * 0.3 + i) * dt * 0.05;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.dust.position.copy(playerPos);
    }

    // Lamp flicker.
    for (const l of this.lamps) {
      if (!l.flicker) continue;
      const n = Math.sin(this.t * 13.0 + l.phase) * 0.5 + Math.sin(this.t * 29.0 + l.phase * 2.0) * 0.5;
      l.light.intensity = l.base * (0.65 + 0.35 * (n * 0.5 + 0.5));
    }
  }
}
