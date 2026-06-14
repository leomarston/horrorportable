// Find door-like meshes in the source asset and locate them in world space.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('_assetsrc/Abandoned_House/Models/Abandoned_House.glb');
const root = doc.getRoot();

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function apply(m, v) { const x = v[0], y = v[1], z = v[2]; return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]; }
const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

const HOUSE = { x: -39, z: -127 };
const matches = [];

function walk(node, parent) {
  const world = mul(parent, node.getMatrix());
  const mesh = node.getMesh();
  const name = node.getName() || '';
  if (mesh && /puerta|door|gate|porton|porton|entrada|reja|porta/i.test(name)) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const mats = new Set();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'); if (!pos) continue;
      if (p.getMaterial()) mats.add(p.getMaterial().getName());
      const el = [0, 0, 0]; const step = Math.max(1, Math.floor(pos.getCount() / 60));
      for (let i = 0; i < pos.getCount(); i += step) { pos.getElement(i, el); const w = apply(world, el); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); } }
    }
    const c = [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2];
    const size = [max[0]-min[0], max[1]-min[1], max[2]-min[2]];
    const distHouse = Math.hypot(c[0]-HOUSE.x, c[2]-HOUSE.z);
    matches.push({ name, center: c.map(n=>+n.toFixed(1)), size: size.map(n=>+n.toFixed(1)), mats: [...mats], distHouse: +distHouse.toFixed(1) });
  }
  for (const ch of node.listChildren()) walk(ch, world);
}
for (const s of root.listScenes()) for (const r of s.listChildren()) walk(r, I);

matches.sort((a, b) => a.distHouse - b.distHouse);
console.log('Door-like meshes (', matches.length, '), sorted by distance to house center (-39,-127):\n');
for (const m of matches) console.log(`${m.name.padEnd(16)} center=[${m.center.join(',')}] size=[${m.size.join(',')}] dist=${m.distHouse} mats=[${m.mats.join(',')}]`);
