import * as THREE from 'three';
import { CAMERA, ATMOSPHERE, ADAPTIVE } from './config.js';

/**
 * Owns the renderer, scene and camera, the resize handling and the adaptive
 * resolution controller that keeps the framerate stable on weak hardware.
 */
export default class Engine {
  constructor(canvas, preset) {
    this.preset = preset;
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // FXAA happens in post; cheaper and composer-friendly
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = ATMOSPHERE.exposure;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = preset.shadows;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';

    this.pixelCap = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    this.renderScale = preset.resScale;
    this.maxScale = preset.resScale * ADAPTIVE.maxScaleBonus;

    this.composer = null;

    // adaptive sampling
    this._acc = 0;
    this._frames = 0;

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  setComposer(composer) {
    this.composer = composer;
    this._applyPixelRatio();
    this.resize();
  }

  _applyPixelRatio() {
    const r = this.pixelCap * this.renderScale;
    this.renderer.setPixelRatio(r);
    if (this.composer) this.composer.setPixelRatio(r);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this._applyPixelRatio();
  }

  /** Lower internal resolution when we miss the FPS target; raise it back when we have headroom. */
  _adapt(dt) {
    this._acc += dt;
    this._frames++;
    if (this._acc < ADAPTIVE.sampleSeconds) return;
    const fps = this._frames / this._acc;
    this._acc = 0;
    this._frames = 0;

    let changed = false;
    if (fps < ADAPTIVE.targetFps - 4 && this.renderScale > ADAPTIVE.minScale) {
      this.renderScale = Math.max(ADAPTIVE.minScale, this.renderScale - ADAPTIVE.step);
      changed = true;
    } else if (fps > ADAPTIVE.targetFps + 10 && this.renderScale < this.maxScale) {
      this.renderScale = Math.min(this.maxScale, this.renderScale + ADAPTIVE.step);
      changed = true;
    }
    if (changed) this._applyPixelRatio();
    this.lastFps = fps;
  }

  render(dt) {
    this._adapt(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
