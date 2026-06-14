# Abandoned House — browser horror (movement + map)

A first-person 3D horror walk built in the browser with **Three.js**, using only the
**Abandoned House** asset pack. This milestone delivers the foundation: movement,
a fully traversable bounded map, collision, and a cinematic horror atmosphere.
Gameplay (enemies, objectives, sound) comes later.

> Looks aimed at a "made-in-Unity" feel; tuned to run smoothly on low-end machines.

## Run it

```bash
npm install
npm run dev        # local dev server
# or a production build:
npm run build && npm run preview
```

Open the printed URL, pick a quality tier, and click **ENTER THE HOUSE**.

### Controls
- **W A S D / arrows** — move · **Mouse** — look (click to capture)
- **Shift** — run · **Ctrl / C** — crouch · **Space** — step over low obstacles
- **F** — flashlight · **Esc** — pause / settings
- On touch devices: left stick to move, right half to look, on-screen RUN / LIGHT.

## What's implemented
- **First-person capsule controller** with gravity, crouch, jump, head-bob, and
  **collide-and-slide** against the level using a `three-mesh-bvh` BVH (sub-stepped
  for stability).
- **Traversable, bounded map.** The asset's ground is a road/yard plane with
  elevated buildings and gaps between them, so the collider adds an *invisible
  floor* at the dominant ground height: you can roam the whole footprint and never
  fall out of the world, while walls and raised floors still block/support you. A
  hard footprint clamp fences the outer edges.
- **Horror atmosphere:** exponential fog, gradient night sky with a moon disc,
  cold moonlight with player-following shadows, a handheld flashlight (sway +
  flicker), flickering lamp lights detected from the asset's emissive materials,
  drifting dust, and a cinematic post stack (bloom on emissives, vignette, film
  grain, chromatic aberration, FXAA, filmic tone mapping).
- **Performance:** the GLB is optimized at build time (see below); draw calls are
  ~76; runtime uses pixel-ratio caps, **adaptive resolution** (drops internal res
  to hold the FPS target), shadow/anisotropy/MSAA scaling, and three quality
  presets (Low / Medium / High) with auto-detection.

## Asset pipeline
The raw pack (`Abandoned_House.glb`, ~12.9 MB) is optimized into
`public/models/abandoned_house.glb` (~2.6 MB) by:

```bash
npm run assets:optimize
```

which joins meshes by material (725 → ~76 draw calls), welds/dedupes/prunes,
re-encodes textures to **WebP ≤ 512px**, and applies **meshopt** geometry
compression. (Re-running it requires the original extracted asset under
`_assetsrc/`, which is not committed.)

## Project layout
```
src/
  main.js         orchestration / game loop / state
  Engine.js       renderer, camera, resize, adaptive resolution
  AssetLoader.js  GLTFLoader + meshopt decoder
  World.js        material tuning (glass/emissive), spawn wiring
  Collisions.js   merged world-space BVH collider + invisible floor + footprint
  Player.js       capsule controller (movement, gravity, collide-and-slide)
  Flashlight.js   handheld spotlight (sway, flicker, fill light)
  Atmosphere.js   fog, sky/moon, lights, dust, lamp flicker
  PostFX.js       bloom + color grade + FXAA + output
  Input.js        keyboard / pointer-lock / touch
  Quality.js      tier detection + presets
  UI.js           loading / start / pause / settings / HUD
scripts/
  optimize-assets.mjs   build-time GLB optimizer
  probe-scene.mjs       inspects the source asset graph
  smoke.mjs / phys.mjs  headless render + physics verification
                        (optional: `npm i -D puppeteer` + a local Chrome)
```
