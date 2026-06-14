import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Cinematic color grade: chromatic aberration, desaturation + cold tint,
// gentle contrast, vignette and animated film grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.05 },
    uAberration: { value: 1.0 },
    uSaturation: { value: 0.84 },
    uContrast: { value: 1.05 },
    uTint: { value: new THREE.Color(0.86, 0.92, 1.0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uResolution;
    uniform float uVignette; uniform float uGrain; uniform float uAberration;
    uniform float uSaturation; uniform float uContrast; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float d = dot(c,c);
      vec2 off = c * uAberration * 0.0018 * (0.35 + d*2.2);
      float r = texture2D(tDiffuse, uv + off).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(r,g,b);
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSaturation);
      col *= uTint;
      col = (col - 0.5) * uContrast + 0.5;
      float vig = smoothstep(0.95, 0.20, d * uVignette * 2.0);
      col *= mix(0.32, 1.0, vig);
      float grain = hash(uv * uResolution + fract(uTime) * vec2(91.7,113.3)) - 0.5;
      col += grain * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export default class PostFX {
  constructor(engine, preset) {
    this.engine = engine;
    const renderer = engine.renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    const msaa = preset.flashlightShadow ? 4 : 0; // MSAA only on the High tier
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa });
    this.composer = new EffectComposer(renderer, rt);

    this.composer.addPass(new RenderPass(engine.scene, engine.camera));

    if (preset.bloom) {
      const strength = preset.flashlightShadow ? 0.55 : 0.42;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), strength, 0.6, 0.85);
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(GradeShader);
    if (preset.grade === 'lite') {
      this.grade.uniforms.uAberration.value = 0.0;
      this.grade.uniforms.uSaturation.value = 0.9;
      this.grade.uniforms.uGrain.value = 0.04;
    }
    this.composer.addPass(this.grade);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.composer.addPass(new OutputPass());

    this._size = new THREE.Vector2();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }
  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
  }

  tick(dt) {
    this.grade.uniforms.uTime.value += dt;
    // FXAA + grain need the live drawing-buffer size (changes with adaptive
    // resolution); these are cheap uniform writes. Bloom is resized by the
    // composer on size/pixel-ratio changes, so we don't touch it here.
    const renderer = this.engine.renderer;
    renderer.getDrawingBufferSize(this._size);
    this.grade.uniforms.uResolution.value.copy(this._size);
    this.fxaa.material.uniforms.resolution.value.set(1 / this._size.x, 1 / this._size.y);
  }
}
