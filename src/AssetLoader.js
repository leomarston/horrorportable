import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loads the optimized GLB (meshopt-compressed geometry + WebP textures).
 * WebP is decoded natively by the browser, so no extra transcoder is needed.
 */
export async function loadWorld(url, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(url, (evt) => {
    if (onProgress && evt.lengthComputable) {
      onProgress(evt.loaded / evt.total);
    } else if (onProgress) {
      // total unknown (e.g. gzip) — show indeterminate-ish progress
      onProgress(Math.min(0.95, (evt.loaded || 0) / (2.6 * 1024 * 1024)));
    }
  });

  return gltf;
}
