/**
 * Optimize the Colt M1911 gun GLB for the web.
 * - WebP textures (≤1024 — it's a close-up viewmodel) + meshopt compression.
 * - Skin/animation-safe: NO join or flatten. We keep the 'Fire' clip but never
 *   play it; the skinned mesh renders in its bind pose (the held pose).
 *
 * In : _assetsrc/gun/gun_raw.glb
 * Out: public/models/gun.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, dedup, prune, textureCompress, meshopt, TextureResizeFilter } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const SRC = '_assetsrc/gun/gun_raw.glb';
const OUT = 'public/models/gun.glb';
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SRC);
console.log('in :', mb(statSync(SRC).size), '| animations:', doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));

await doc.transform(
  metalRough(),
  dedup(),
  prune({ keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], resizeFilter: TextureResizeFilter.LANCZOS3, quality: 86 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync('public/models', { recursive: true });
await io.write(OUT, doc);
console.log('out:', mb(statSync(OUT).size), '| skins:', doc.getRoot().listSkins().length, '| ext:', doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', '));
