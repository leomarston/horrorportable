// Headless render + movement smoke-test using software WebGL.
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';

const CHROME = '.browser/chrome-linux64/chrome';
const URL = process.env.URL || 'http://localhost:4173/';
const TIER = process.env.TIER || 'medium';
const OUT = process.env.OUT || 'smoke';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=1280,720',
    '--hide-scrollbars', '--mute-audio',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

const errors = [];
const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`));

// pin quality tier first
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('ah_quality', t), TIER);
await page.reload({ waitUntil: 'domcontentloaded' });

// wait for world + collider to be built
const ready = await page.waitForFunction(
  () => window.__GAME && window.__GAME.world && window.__GAME.world.collider && window.__GAME.state === 'menu',
  { timeout: 90000 }
).then(() => true).catch(() => false);

const info = await page.evaluate(() => {
  const g = window.__GAME;
  if (!g || !g.world) return null;
  const w = g.world.collider.walkable;
  const sp = g.world.spawnPoint;
  return {
    tier: g.tier,
    spawn: { x: +sp.x.toFixed(1), y: +sp.y.toFixed(1), z: +sp.z.toFixed(1) },
    walkable: { minX: +w.minX.toFixed(1), maxX: +w.maxX.toFixed(1), minZ: +w.minZ.toFixed(1), maxZ: +w.maxZ.toFixed(1) },
    groundMinY: +g.world.collider.groundMinY.toFixed(2),
    drawCalls: g.engine.renderer.info.render.calls,
  };
});

console.log('READY:', ready);
console.log('INFO:', JSON.stringify(info, null, 2));

// force into play (pointer lock isn't available headless) and let it settle
await page.evaluate(() => {
  const g = window.__GAME;
  g.state = 'playing';
  document.getElementById('start').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
await settle(2500);
await page.screenshot({ path: `${OUT}-1-spawn.png` });

// walk forward toward the house for a couple seconds
const startPos = await page.evaluate(() => {
  const p = window.__GAME.player; p.input.move = { x: 0, y: 1 };
  return { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2) };
});
await settle(3500);
const afterFwd = await page.evaluate(() => {
  const p = window.__GAME.player; p.input.move = { x: 0, y: 0 };
  return { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), onGround: p.onGround };
});
await page.screenshot({ path: `${OUT}-2-forward.png` });

// turn to look around, then a quick strafe to confirm collide-and-slide doesn't explode
await page.evaluate(() => { window.__GAME.player.yaw += 0.9; });
await settle(800);
await page.screenshot({ path: `${OUT}-3-look.png` });

// push hard toward a map edge to verify the clamp holds
await page.evaluate(() => { const p = window.__GAME.player; p.yaw = 0; p.input.move = { x: 1, y: 1 }; });
await settle(4000);
const edge = await page.evaluate(() => {
  const p = window.__GAME.player, w = p.collider.walkable;
  return {
    pos: { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) },
    bounds: { minX: +w.minX.toFixed(1), maxX: +w.maxX.toFixed(1), minZ: +w.minZ.toFixed(1), maxZ: +w.maxZ.toFixed(1) },
    insideX: p.position.x >= w.minX && p.position.x <= w.maxX,
    insideZ: p.position.z >= w.minZ && p.position.z <= w.maxZ,
    onGround: p.onGround,
  };
});
await page.screenshot({ path: `${OUT}-4-edge.png` });

console.log('START POS:', JSON.stringify(startPos));
console.log('AFTER FORWARD:', JSON.stringify(afterFwd));
console.log('EDGE TEST:', JSON.stringify(edge, null, 2));
console.log('\n--- ERRORS (' + errors.length + ') ---');
errors.forEach((e) => console.log(e));
console.log('\n--- last logs ---');
logs.slice(-12).forEach((l) => console.log(l));

await browser.close();
if (!ready) process.exit(2);
