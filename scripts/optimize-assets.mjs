/**
 * Build-time asset optimizer for the Abandoned House GLB.
 *
 * Goals (so the game "runs on any system"):
 *   - Collapse ~725 draw calls down to ~one-per-material via join().
 *   - Weld/dedup/prune to drop redundant vertices and unused data.
 *   - Re-encode every texture to WebP capped at 512px (big download win).
 *   - meshopt-compress geometry (tiny, worker-free decode at runtime).
 *
 * Input : _assetsrc/Abandoned_House/Models/Abandoned_House.glb
 * Output: public/models/abandoned_house.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, join, weld, prune, textureCompress, meshopt, TextureResizeFilter,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const SRC = '_assetsrc/Abandoned_House/Models/Abandoned_House.glb';
const OUT = 'public/models/abandoned_house.glb';

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

console.log('Reading', SRC, '(' + mb(statSync(SRC).size) + ')');
const doc = await io.read(SRC);
const root = doc.getRoot();

const stat = (label) => {
  let prims = 0, verts = 0, tris = 0;
  for (const m of root.listMeshes())
    for (const p of m.listPrimitives()) {
      prims++;
      const pos = p.getAttribute('POSITION');
      if (pos) verts += pos.getCount();
      const idx = p.getIndices();
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
  console.log(
    `  [${label}] meshes=${root.listMeshes().length} primitives=${prims} verts=${verts} tris=${Math.round(tris)} ` +
    `materials=${root.listMaterials().length} textures=${root.listTextures().length}`
  );
};
stat('before');

// ---- geometry cleanup & draw-call reduction ----
console.log('Cleaning geometry (dedup/flatten/join/weld/prune)...');
await doc.transform(
  dedup(),
  flatten(),
  join({ keepNamed: false }),
  weld(),
  prune({ keepLeaves: false, keepAttributes: false }),
);
stat('after geom');

// ---- texture compression: WebP, capped at 512px ----
console.log('Compressing textures -> WebP <=512px (sharp)...');
await doc.transform(
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [512, 512],
    resizeFilter: TextureResizeFilter.LANCZOS3,
    quality: 85,
    effort: 5,
  }),
);

// ---- geometry compression: meshopt (worker-free runtime decode) ----
console.log('Applying meshopt compression...');
await doc.transform(
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
stat('final');

// keep material names so the runtime can flag non-solid decals (cobwebs/grass)
mkdirSync('public/models', { recursive: true });
await io.write(OUT, doc);

console.log('\nWrote', OUT, '(' + mb(statSync(OUT).size) + ')');
console.log('Source was', mb(statSync(SRC).size), '-> output', mb(statSync(OUT).size));
