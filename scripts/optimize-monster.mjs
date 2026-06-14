/**
 * Optimize the exported DarkFox GLB for the web. Skin/morph-safe: NO join or
 * flatten (those would break the rig). Just dedup/prune, WebP textures (≤512),
 * and meshopt geometry compression.
 *
 * In : _assetsrc/monster/darkfox_raw.glb
 * Out: public/models/darkfox.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, TextureResizeFilter } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const SRC = '_assetsrc/monster/darkfox_raw.glb';
const OUT = 'public/models/darkfox.glb';
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SRC);
console.log('in :', mb(statSync(SRC).size));

await doc.transform(
  dedup(),
  prune({ keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], resizeFilter: TextureResizeFilter.LANCZOS3, quality: 88 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync('public/models', { recursive: true });
await io.write(OUT, doc);
console.log('out:', mb(statSync(OUT).size));
