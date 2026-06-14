// Probe the GLB scene graph: node names, meshes, transforms, material names.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('_assetsrc/Abandoned_House/Models/Abandoned_House.glb');
const root = doc.getRoot();

const scenes = root.listScenes();
console.log('Scenes:', scenes.length);

let nodeCount = 0;
let meshNodeCount = 0;
const named = {};

function walk(node, depth) {
  nodeCount++;
  const mesh = node.getMesh();
  const name = node.getName() || '(unnamed)';
  named[name] = (named[name] || 0) + 1;
  if (mesh) {
    meshNodeCount++;
    if (depth <= 2 || /colis|colli|floor|piso|suelo|terr|road|wall|pared|muro|ground/i.test(name)) {
      const prims = mesh.listPrimitives();
      const mats = prims.map((p) => (p.getMaterial() ? p.getMaterial().getName() : 'none'));
      console.log(`${'  '.repeat(depth)}NODE "${name}" mesh="${mesh.getName()}" prims=${prims.length} mats=[${[...new Set(mats)].join(',')}]`);
    }
  }
  for (const child of node.listChildren()) walk(child, depth + 1);
}

for (const scene of scenes) {
  console.log(`\n=== Scene "${scene.getName()}" roots=${scene.listChildren().length} ===`);
  for (const r of scene.listChildren()) walk(r, 0);
}

console.log('\nTotal nodes:', nodeCount, ' mesh nodes:', meshNodeCount);
console.log('Materials:', root.listMaterials().length, ' Meshes:', root.listMeshes().length, ' Textures:', root.listTextures().length);

// Names that repeat a lot (likely prop instances)
const top = Object.entries(named).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\nMost common node names:');
for (const [n, c] of top) console.log(`  ${c.toString().padStart(4)}  ${n}`);

// Look for transmission (glass) and emissive (lamps) materials
let glass = 0, emissive = 0;
for (const m of root.listMaterials()) {
  if (m.getExtension('KHR_materials_transmission')) glass++;
  const e = m.getEmissiveFactor();
  if (m.getEmissiveTexture() || (e && (e[0] + e[1] + e[2]) > 0.01)) emissive++;
}
console.log(`\nGlass(transmission) materials: ${glass}, Emissive materials: ${emissive}`);
