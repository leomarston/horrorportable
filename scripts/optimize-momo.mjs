/**
 * Optimize the Momo monster GLB for the web.
 * - metalRough(): convert KHR_materials_pbrSpecularGlossiness → metallic-roughness
 *   (three.js dropped specular-glossiness support, so this is required to load).
 * - WebP textures (≤512) + meshopt geometry/animation compression.
 * - Skin/animation-safe: NO join or flatten.
 *
 * In : _assetsrc/monster/momo_raw.glb
 * Out: public/models/momo.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, dedup, prune, textureCompress, meshopt, TextureResizeFilter } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const SRC = '_assetsrc/monster/momo_raw.glb';
const OUT = 'public/models/momo.glb';
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SRC);
console.log('in :', mb(statSync(SRC).size), '| animations:', doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));

await doc.transform(
  metalRough(),
  dedup(),
  prune({ keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], resizeFilter: TextureResizeFilter.LANCZOS3, quality: 88 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync('public/models', { recursive: true });
await io.write(OUT, doc);
console.log('out:', mb(statSync(OUT).size), '| extensionsUsed:', doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', '));
