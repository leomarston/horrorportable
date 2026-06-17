// Headless test: nearing the stairs the first time slams + locks the front door
// and switches the objective to "Find a way out".
import puppeteer from 'puppeteer';

const CHROME = '.browser/chrome-linux64/chrome';
const URL = process.env.URL || 'http://localhost:4173/';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--window-size=1280,720','--mute-audio'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => errors.push(`REQ FAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality', 'low'));
await page.reload({ waitUntil: 'domcontentloaded' });
const ready = await page.waitForFunction(
  () => window.__GAME && window.__GAME.doors && window.__GAME.state === 'menu',
  { timeout: 90000 },
).then(() => true).catch(() => false);

await page.evaluate(() => {
  const g = window.__GAME;
  g.state = 'playing';
  g.intro = null; // skip the cinematic so the trap can arm
  document.getElementById('start').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// open the front door first, so we can prove the trap closes + locks it.
const before = await page.evaluate(() => {
  const g = window.__GAME, d = g.doors.doors[0];
  g.ui.setObjective(g.objectives[0].label); // show Objective 1 (as the intro would)
  d.open = true; d.target = Math.PI * 0.5;
  return {
    locked: d.locked, open: d.open,
    trapSprung: g.trapSprung,
    objText: document.getElementById('obj-title')?.textContent || '',
  };
});

// stand the player away from the stairs (in the yard) → trap must NOT spring.
await page.evaluate(() => {
  const g = window.__GAME, p = g.player;
  p.position.set(-39, p.position.y, -100); // outside
});
await settle(300);
const away = await page.evaluate(() => ({ trapSprung: window.__GAME.trapSprung }));

// now walk the player onto the stair foot → trap springs.
const stair = await page.evaluate(() => {
  const g = window.__GAME, p = g.player, c = g.world.collider;
  const gy = c.groundY(-31, -126.5, 1.4) ?? -0.2;
  p.position.set(-31, gy + 1.4, -126.5);
  return { inside: g._isInsideHouse(), near: g._nearStairs() };
});

// poll for the door to finish slamming shut (angle → ~0) and lock
let closed = false;
for (let i = 0; i < 60 && !closed; i++) {
  await settle(50);
  closed = await page.evaluate(() => {
    const d = window.__GAME.doors.doors[0];
    return d.locked && Math.abs(d.angle) < 0.12;
  });
}

const after = await page.evaluate(() => {
  const g = window.__GAME, d = g.doors.doors[0];
  const ot = document.getElementById('obj-title');
  return {
    trapSprung: g.trapSprung,
    locked: d.locked, open: d.open, angle: +d.angle.toFixed(3),
    colliderActive: g.doors.colliders[0].active(),
    obj1Done: ot ? ot.classList.contains('done') : false, // trap ticks off Objective 1
    nextObjective: g.currentObjective,
  };
});

// confirm interacting with the locked door does NOT reopen it.
const reopen = await page.evaluate(() => {
  const g = window.__GAME;
  // aim the camera at the door and interact
  const d = g.doors.doors[0];
  g.engine.camera.position.copy(d.mesh.getWorldPosition(new (g.player.position.constructor)()));
  const res = g.doors.interact(g.engine.camera); // may be false if not aimed; also test direct
  return { interactResult: res, stillLocked: d.locked, stillClosedTarget: d.target };
});

console.log('READY:', ready);
console.log('BEFORE (door forced open):', JSON.stringify(before));
console.log('AWAY FROM STAIRS:', JSON.stringify(away));
console.log('AT STAIRS:', JSON.stringify(stair));
console.log('AFTER (trap):', JSON.stringify(after));
console.log('RE-OPEN attempt:', JSON.stringify(reopen));
console.log('\n--- ERRORS (' + errors.length + ') ---');
errors.forEach((e) => console.log(e));

const pass = ready
  && before.trapSprung === false
  && away.trapSprung === false            // not near stairs → no trap
  && stair.inside === true && stair.near === true
  && after.trapSprung === true
  && after.locked === true
  && after.open === false
  && Math.abs(after.angle) < 0.12         // slammed shut
  && after.colliderActive === true        // blocks the player again
  && after.obj1Done === true              // trap completes Objective 1
  && /find the safe/i.test(after.nextObjective)  // and queues Objective 2
  && reopen.stillLocked === true
  && reopen.stillClosedTarget === 0
  && errors.length === 0;
console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');

await browser.close();
process.exit(pass ? 0 : 1);
