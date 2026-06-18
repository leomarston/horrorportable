/**
 * Central tuning for the Abandoned House horror walk.
 *
 * SCALE NOTE: the asset is authored in its own units. Measured against door
 * height (~2.6 units ≈ a real 2 m door) → 1 unit ≈ 0.8 m. All player metrics
 * below are expressed directly in *asset units* using that anchor, so movement
 * feels human-scaled in this specific world.
 */

export const ASSET_URL = './models/abandoned_house.glb';

// Testing toggles. monsterCanKill:false → Nulmire still chases but can't grab
// you (no jumpscare / no losing a night). Set back to true to restore the game.
export const DEBUG = { monsterCanKill: false };

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
  stepSubdivisions: 5,   // collision substeps per frame for stability

  // --- first-person "gait" feel (grounds the camera so it doesn't feel like flying) ---
  bobStepFreq: 0.95,     // strides per second per unit of walk speed (scales with how fast you move)
  bobVertWalk: 0.06,     // vertical head travel while walking (units)
  bobVertRun: 0.105,     // vertical head travel while running
  bobLatWalk: 0.045,     // side-to-side sway while walking
  bobLatRun: 0.075,      // side-to-side sway while running
  bobRoll: 0.018,        // camera roll coupled to the sway (rad)
  strafeRoll: 0.035,     // lean into strafing left/right (rad)
  bobSmooth: 16,         // how quickly the bob eases in/out
  runFovKick: 7,         // extra vertical FOV (deg) while sprinting → sense of speed
  fovDamp: 7,            // FOV ease rate
  landDipMax: 0.17,      // deepest camera dip on a hard landing (units)
  landImpactScale: 0.02, // landing dip per unit of impact speed
  landRecover: 8.5,      // how fast the knees straighten after a landing
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
  },
  lampColor: 0xffb964,
  dustCount: 900,
};

// Collectibles. Gather all the papers to win; batteries recharge your torch.
// Papers are scattered RANDOMLY across the house ground floor each game, lie
// flat on the floor, and do NOT glow. Collect by E, walking over, or touching.
export const PICKUPS = {
  goal: 10,                  // papers needed to win
  paperUrl: './models/paper.glb',
  paperSize: 0.42,           // sheet size in units
  paperCount: 10,
  paperArea: { minX: -53, maxX: -28, minZ: -131, maxZ: -118 }, // house ground-floor interior
  paperMinSep: 2.2,          // minimum spacing between papers (units)
  touchDist: 1.05,           // auto-collect: walk over / almost touching
  interactDist: 2.4,         // press E to collect a nearby paper
};

// Region used to detect "inside the house" — the house footprint; a point counts
// as inside only when its floor is the interior ground floor (above floorAbove,
// i.e. not the yard at ~-1.3).
export const INTERIOR = { minX: -56, maxX: -22, minZ: -137, maxZ: -116, floorAbove: -0.8 };

// The interior staircase (ascends to the upper floor along the east side of the
// main room). When the player first comes within `triggerRadius` (XZ units) of
// the stair foot, the front door slams shut and locks — trapping them inside.
export const STAIRS = { x: -31, z: -126.5, triggerRadius: 4.5 };

// Opening cinematic timings (seconds): fade up from black, hold the centred
// objective title, then fly it to the corner.
export const INTRO = { fade: 2.5, hold: 1.9, fly: 0.95 };

// You get 3 nights to beat the game. Getting caught costs a night; you wake on
// the next night in the attic (upper floor). Lose all 3 nights → game over.
// `attic` is the eye-position spawn (floor 3.87 + standing height); facing the
// bedroom doorway toward the rest of the upper floor.
export const NIGHTS = {
  total: 3,
  attic: { x: -32, y: 5.77, z: -121, yaw: Math.PI * 0.5, pitch: -0.02 }, // inside the attic bedroom (faces the bed)
  cardFade: 0.6,  // night-card fade-in (s)
  cardHold: 1.9,  // night-card hold (s)
  cardOut: 0.8,   // night-card fade-out (s)
};

// The interactive animated safe. Uses its baked "SafeOpen" clip, scrubbed
// forward to open and backward to close. Once opened it freezes (no more
// interaction) so you can't accidentally close it instead of taking the gun.
export const SAFE = {
  url: './models/safe.glb',
  height: 0.6,                 // target height in units (a small tabletop safe)
  x: -34.25, y: 0.98, z: -130.2, // sitting on the kitchen counter top
  yaw: -Math.PI / 2,           // face the door toward the player's approach side
  range: 3.2,                  // how close you must look at it to interact (units)
  openRate: 1.0,               // animation playback speed (×)
};

// The Colt M1911 — sits inside the safe once opened; taken with E to equip as a
// first-person viewmodel you can fire. Skinned 'Fire' clip is kept but unused.
export const GUN = {
  url: './models/gun.glb',
  viewScale: 0.008,            // held viewmodel scale (asset is ~46u long)
  viewPos: { x: 0.15, y: -0.2, z: -0.32 },    // local to camera: right, down, forward(-Z)
  viewRot: { x: 0, y: -Math.PI / 2, z: 0 },   // muzzle (model -X) → -Z (forward)
  safeScale: 0.011,            // gun lying in the open safe
  safePos: { x: -34.85, y: 1.0, z: -130.2 },    // on the counter just in front of the open door
  safeRot: { x: Math.PI / 2, y: 0, z: 0 },      // laid flat on the counter, side profile up
  recoilKick: 0.05,            // backward kick distance (units)
  recoilRise: 0.16,            // muzzle-up rotation on fire (rad)
  recoilRecover: 9,            // recovery rate
  range: 70,                   // hitscan range (units)
  hitRadius: 1.1,              // monster hit sphere radius (units)
  flashTime: 0.045,            // muzzle-flash duration (s)
  takeDist: 3.4,               // how close you must be to the safe to take the gun
};

// The key Nulmire drops when killed — collect it, then unlock the front door.
export const KEY = { collectDist: 1.2, interactDist: 2.6 };

// Sound effects + music (loaded into Web Audio buffers at boot).
export const AUDIO = {
  jumpscare: './audio/jumpscare.mp3',
  footstep: './audio/footstep.mp3',
  door: './audio/door.mp3',
  laugh: './audio/laugh.mp3',
  ambience: './audio/ambience.mp3',
  chase: './audio/chase.mp3',
  footstepVolume: 0.22,
  footstepStride: 1.9,       // one footstep sound per ~2 steps (less frequent)
  laughEvery: [30, 70],      // random seconds between the monster's laughs (rare)
  laughVolume: 0.7,
  doorVolume: 0.7,
  jumpscareVolume: 1.0,
  ambienceVolume: 0.32,      // looping background music
  chaseVolume: 0.55,         // looping chase music (starts on chase, stops on give-up)
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
  giveUpPathDist: 16,        // gives up if the WALKABLE path to you grows beyond this (units)
  navCell: 1.2,              // nav-grid cell size for path-distance checks

  // --- vaulting low obstacles (e.g. a table) ---
  jumpDist: 2.5,             // how far ahead it lands
  jumpPeak: 0.85,            // arc height
  jumpDur: 0.55,             // seconds
  jumpClearH: 1.6,           // tallest obstacle top it can clear (above its feet)
  jumpCooldown: 1.2,         // min time between jumps
};

