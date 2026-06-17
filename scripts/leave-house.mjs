// Headless test: monster drops the chase the instant the player leaves the house.
import puppeteer from 'puppeteer';

const CHROME = '.browser/chrome-linux64/chrome';
const URL = process.env.URL || 'http://localhost:4173/';

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
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality', 'low'));
await page.reload({ waitUntil: 'domcontentloaded' });

const ready = await page.waitForFunction(
  () => window.__GAME && window.__GAME.monster && window.__GAME.world && window.__GAME.state === 'menu',
  { timeout: 90000 },
).then(() => true).catch(() => false);

await page.evaluate(() => {
  const g = window.__GAME;
  g.state = 'playing';
  document.getElementById('start').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Drop the player + monster on a known interior ground-floor spot, force a chase.
const inside = await page.evaluate(() => {
  const g = window.__GAME, m = g.monster, p = g.player, c = g.world.collider;
  const ix = -40, iz = -125, fy = c.groundY(ix, iz, 1.7) ?? -0.2; // solidly inside the house
  p.position.set(ix, fy + 1.0, iz);
  m.pos.set(ix + 1.5, fy, iz); m.feetY = fy; // monster right next to the player, on the floor
  m.lastSeen.copy(p.position);
  m.state = 'chase';
  return {
    playerInside: m._playerInside(),
    monsterPos: { x: +m.pos.x.toFixed(1), z: +m.pos.z.toFixed(1) },
    state: m.state,
  };
});

await settle(600); // let a few frames run
const stayed = await page.evaluate(() => {
  const m = window.__GAME.monster;
  return { state: m.state, inside: m._playerInside() };
});

// 2) Now teleport the player OUTSIDE the house (the yard/road strip).
const left = await page.evaluate(() => {
  const g = window.__GAME, m = g.monster, p = g.player;
  m.state = 'chase';            // ensure we're chasing again before the test
  m.lastSeen.copy(p.position);
  p.position.set(-39, p.position.y, -100); // spawn-side yard, well outside INTERIOR
  return { playerInside: m._playerInside() };
});

// poll for the state to flip to 'wander' (allow for headless rAF throttling)
let flipped = false;
for (let i = 0; i < 40 && !flipped; i++) {
  await settle(50);
  flipped = await page.evaluate(() => window.__GAME.monster.state === 'wander');
}
const after = await page.evaluate(() => {
  const g = window.__GAME, m = g.monster;
  return { state: m.state, inside: m._playerInside(), chaseMusic: !!(g.sfx && g.sfx.chaseSrc) };
});

console.log('READY:', ready);
console.log('INSIDE (forced chase):', JSON.stringify(inside));
console.log('STAYED (still inside):', JSON.stringify(stayed));
console.log('LEFT (teleport outside):', JSON.stringify(left));
console.log('AFTER LEAVING:', JSON.stringify(after));
console.log('\n--- ERRORS (' + errors.length + ') ---');
errors.forEach((e) => console.log(e));

const pass = ready
  && inside.playerInside === true
  && stayed.state === 'chase'
  && left.playerInside === false
  && after.state === 'wander'
  && errors.length === 0;
console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');

await browser.close();
process.exit(pass ? 0 : 1);
