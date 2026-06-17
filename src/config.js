/**
 * Central tuning for the Abandoned House horror walk.
 *
 * SCALE NOTE: the asset is authored in its own units. Measured against door
 * height (~2.6 units ≈ a real 2 m door) → 1 unit ≈ 0.8 m. All player metrics
 * below are expressed directly in *asset units* using that anchor, so movement
 * feels human-scaled in this specific world.
 */

export const ASSET_URL = './models/abandoned_house.glb';

// The house's front door — a single isolated mesh using the "Puerta" material.
// It's kept out of the static collider and driven by the Doors system instead.
export const DOOR = {
  material: 'Puerta',
  openAngle: Math.PI * 0.5, // swings inward (−Z)
  damp: 9,                  // open/close animation rate
  range: 4.5,               // how close you must be to interact (units)
  blockBelow: 0.14,         // door blocks while |angle| is under this (≈ closed)
};

// Materials that must NOT collide (decorative billboards / decals you'd snag on).
export const NON_SOLID_MATERIAL = /telar|planta|pasto|grass|cesped|hierba|hoja|leaf|spider|web/i;

export const PLAYER = {
  // Sized to the asset: the house door opening is ~2.1u tall / ~1.0u wide, so the
  // capsule must be shorter/narrower than that to fit through doorways & overhangs.
  radius: 0.4,           // capsule radius (units)  → ~0.8u wide, clears the 1.0u door
  standSegment: 1.1,     // total height ≈ 1.9u (eye ≈ 1.5u above feet) → fits the 2.1u door
  crouchSegment: 0.5,    // crouched eye ≈ 0.9u above feet
  eyeFromTop: 0.0,       // camera sits at top sphere centre
  walkSpeed: 3.4,        // units/s (~2.6 m/s)
  runSpeed: 6.2,         // units/s (~4.8 m/s)
  crouchSpeed: 1.8,
  accel: 14,             // ground acceleration (units/s^2 of velocity blend)
  airAccel: 4,
  damping: 10,           // horizontal velocity damping when no input
  gravity: -23,          // units/s^2 (~-18 m/s^2, slightly punchy)
  jumpSpeed: 8.5,        // → ~1.2 m hop
  fallRespawnY: -40,     // if we somehow fall through the world, respawn
  headBobSpeed: 9.5,
  headBobAmount: 0.045,
  stepSubdivisions: 5,   // collision substeps per frame for stability
};

// Spawn: just outside the house in the yard, facing the building (−Z).
export const SPAWN = {
  x: -39,
  y: 30,     // start high; we raycast down to the ground on load
  z: -100,   // on the visible road/yard strip, facing the house
  yaw: 0,    // 0 → looking toward −Z (toward the house)
  pitch: -0.02,
};

export const CAMERA = {
  fov: 72,
  near: 0.08,
  far: 620,
};

// Atmosphere — cold, foggy, abandoned night.
export const ATMOSPHERE = {
  fogColor: 0x0b0f12,
  fogDensity: 0.018,
  skyTop: 0x0a0e14,
  skyBottom: 0x05070a,
  ambientColor: 0x2a3340,
  ambientIntensity: 0.16,
  hemiSky: 0x36506e,
  hemiGround: 0x0a0805,
  hemiIntensity: 0.22,
  moonColor: 0x9bb2d6,
  moonIntensity: 0.55,
  moonDir: { x: -0.45, y: 0.85, z: 0.3 },
  exposure: 1.02,
  flashlight: {
    color: 0xfff0d8,
    intensity: 60,
    distance: 95,
    angle: 0.52,
    penumbra: 0.55,
    decay: 1.1,
    startsOn: true,
    drainPerSec: 0.0083,   // full charge lasts ~2 min of use
    rechargeAmount: 0.5,   // a battery pickup restores this much
  },
  lampColor: 0xffb964,
  dustCount: 900,
};

// Collectibles. Gather all the books to win; batteries recharge your torch.
// Each entry's Y is approximate — items are snapped to the floor at load
// (the ray starts just above the given Y, so interior items skip the roof).
export const PICKUPS = {
  goal: 10,            // books needed to win
  hoverHeight: 0.7,    // how far above the floor an item floats (units)
  collectDist: 1.5,    // walk within this to collect (units)
  books: [
    { x: -51, y: -0.2, z: -124 }, { x: -47, y: -0.2, z: -124 }, { x: -43, y: -0.2, z: -123 },
    { x: -40, y: -0.2, z: -126 }, { x: -36, y: -0.2, z: -124 }, { x: -33, y: -0.2, z: -124 },
    { x: -30, y: -0.2, z: -124 }, { x: -50, y: -0.2, z: -128 }, { x: -44, y: -0.2, z: -129 },
    { x: -34, y: -0.2, z: -130 },
  ],
  batteries: [
    { x: -46, y: -0.2, z: -122 }, { x: -38, y: -0.2, z: -123 },
    { x: -31, y: -0.2, z: -128 }, { x: -53, y: -0.2, z: -126 },
  ],
};

/**
 * Quality presets. `resScale` multiplies devicePixelRatio (clamped). These are
 * the *ceilings*; the adaptive controller lowers internal resolution further
 * when the framerate drops, so weak machines stay smooth.
 */
export const QUALITY = {
  low: {
    label: 'Low',
    pixelRatioCap: 1.0,
    resScale: 0.75,
    shadows: false,
    shadowMapSize: 0,
    flashlightShadow: false,
    bloom: false,
    grade: 'lite',          // vignette + grain only
    transmission: false,    // glass → cheap transparent
    dust: 0.35,
    lampLights: 2,
    anisotropy: 1,
  },
  medium: {
    label: 'Medium',
    pixelRatioCap: 1.5,
    resScale: 1.0,
    shadows: true,
    shadowMapSize: 1024,
    flashlightShadow: false,
    bloom: true,
    grade: 'full',
    transmission: false,
    dust: 0.7,
    lampLights: 4,
    anisotropy: 4,
  },
  high: {
    label: 'High',
    pixelRatioCap: 2.0,
    resScale: 1.0,
    shadows: true,
    shadowMapSize: 2048,
    flashlightShadow: true,
    bloom: true,
    grade: 'full',
    transmission: true,
    dust: 1.0,
    lampLights: 8,
    anisotropy: 8,
  },
};

export const ADAPTIVE = {
  targetFps: 50,
  minScale: 0.55,
  maxScaleBonus: 1.0, // never exceed the preset ceiling
  sampleSeconds: 1.0,
  step: 0.08,
};

// The Momo monster — uses its own baked Walk / Idle / Attack clips. Lives on the
// reachable ground floor; floor detection uses LOW rays (skips the upper floor).
export const MONSTER = {
  url: './models/momo.glb',
  height: 1.76,               // 80% size
  facingOffset: 0,            // model forward correction (rad)
  runAnimSpeed: 1.7,          // walk clip timeScale while chasing ("fast walking" = running)
  home: { x: -38, z: -125 },   // centre of its patrol, on the ground floor
  roam: { minX: -53, maxX: -28, minZ: -131, maxZ: -118 },
  floorScan: 1.4,             // ray starts this far above feet → skips the upper floor
  walkSpeed: 1.7,             // units/s (wandering)
  runSpeed: 3.7,             // units/s (chasing) — beatable: outrun by sprinting
  turnRate: 2.4,             // rad/s (wandering)
  chaseTurnRate: 4.2,        // rad/s (hunting)
  arriveDist: 1.0,
  pauseRange: [1.0, 3.0],

  // --- hunting the player (tuned to be escapable) ---
  senseRange: 13,
  senseFov: 1.9,             // vision half-cone (rad) ≈ 110°
  hearRange: 4.8,            // close-range sense — but still needs line of sight
  loseTime: 4,
  catchDist: 1.4,
  avoidDist: 2.4,
  losHeight: 1.35,           // eye height for line-of-sight rays (clears low furniture, blocked by walls)

  // --- vaulting low obstacles (e.g. a table) ---
  jumpDist: 2.5,             // how far ahead it lands
  jumpPeak: 0.85,            // arc height
  jumpDur: 0.55,             // seconds
  jumpClearH: 1.6,           // tallest obstacle top it can clear (above its feet)
  jumpCooldown: 1.2,         // min time between jumps
};

