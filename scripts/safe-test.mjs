// Headless test: the safe loads, sits on the kitchen counter, and its door
// actually animates open + closed on interaction (a hinge bone pose changes).
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
  () => window.__GAME && window.__GAME.safe && window.__GAME.state === 'menu',
  { timeout: 90000 },
).then(() => true).catch(() => false);

await page.evaluate(() => {
  const g = window.__GAME; g.state = 'playing'; g.intro = null;
  document.getElementById('start').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// helper: read the hinge bone's quaternion (proof the skinned door moved)
const hingeQuat = () => page.evaluate(() => {
  const m = window.__GAME.safe.model;
  let b = null;
  m.traverse(o => { if (o.isBone && /Hinge/i.test(o.name)) b = o; });
  return b ? [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].map(n => +n.toFixed(4)) : null;
});

const placement = await page.evaluate(() => {
  const s = window.__GAME.safe;
  const box = new (window.__GAME.player.position.constructor)(); // dummy
  s.root.updateMatrixWorld(true);
  return {
    pos: [s.root.position.x, s.root.position.y, s.root.position.z].map(n => +n.toFixed(2)),
    open: s.open, duration: +s.duration.toFixed(2),
  };
});

const closedQ = await hingeQuat();

// open it (the safe starts locked until all papers are collected — unlock for this animation test)
await page.evaluate(() => { window.__GAME.safe.unlock(); window.__GAME.safe.interact(); });
await settle(900); // longer than the 1.46s clip? give it ~enough; poll below
let settled = false;
for (let i = 0; i < 200 && !settled; i++) { await settle(50); settled = await page.evaluate(() => window.__GAME.safe._dir === 0); }
const openState = await page.evaluate(() => ({ open: window.__GAME.safe.open, t: +window.__GAME.safe._t.toFixed(3), dir: window.__GAME.safe._dir }));
const openQ = await hingeQuat();

// close it
await page.evaluate(() => window.__GAME.safe.interact());
settled = false;
for (let i = 0; i < 200 && !settled; i++) { await settle(50); settled = await page.evaluate(() => window.__GAME.safe._dir === 0); }
const closeState = await page.evaluate(() => ({ open: window.__GAME.safe.open, t: +window.__GAME.safe._t.toFixed(3), dir: window.__GAME.safe._dir }));
const closeQ = await hingeQuat();

const dist = (a, b) => a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : -1;
const openMoved = dist(closedQ, openQ);     // should be > 0 (door swung)
const closedBack = dist(openQ, closeQ);     // should be > 0 (door swung back)
const returned = dist(closedQ, closeQ);     // should be ~0 (back to closed pose)

console.log('READY:', ready);
console.log('PLACEMENT:', JSON.stringify(placement));
console.log('hinge closed:', JSON.stringify(closedQ));
console.log('hinge open  :', JSON.stringify(openQ), 'state:', JSON.stringify(openState));
console.log('hinge closed2:', JSON.stringify(closeQ), 'state:', JSON.stringify(closeState));
console.log('openMoved:', openMoved.toFixed(4), ' closedBack:', closedBack.toFixed(4), ' returnedΔ:', returned.toFixed(4));
console.log('\n--- ERRORS (' + errors.length + ') ---');
errors.forEach((e) => console.log(e));

const pass = ready
  && placement.duration > 0.5
  && closedQ && openQ && closeQ
  && openState.open === true && openState.dir === 0
  && closeState.open === false && closeState.dir === 0
  && openMoved > 0.02            // the hinge bone visibly rotated when opening
  && returned < 0.01            // and returned to the closed pose
  && errors.length === 0;
console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');

await browser.close();
process.exit(pass ? 0 : 1);
