// Reproduces the "can't move" report: headless Chrome denies pointer-lock, so we
// click ENTER then drive real keyboard/mouse events and assert the player moves.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME && window.__GAME.world && window.__GAME.state === 'menu', { timeout: 90000 });

await page.click('#enter-btn');
await new Promise((r) => setTimeout(r, 300));
const afterEnter = await page.evaluate(() => ({ state: window.__GAME.state, locked: window.__GAME.input.locked }));

const startPos = await page.evaluate(() => window.__GAME.player.position.toArray().map((n) => +n.toFixed(2)));
const startYaw = await page.evaluate(() => +window.__GAME.player.yaw.toFixed(3));

// hold W (forward) for ~2.5 s
await page.keyboard.down('w');
await new Promise((r) => setTimeout(r, 2500));
const moveSnap = await page.evaluate(() => ({ move: window.__GAME.input.move, pos: window.__GAME.player.position.toArray().map((n) => +n.toFixed(2)) }));
await page.keyboard.up('w');

// after release, confirm it stops (no sticking)
await new Promise((r) => setTimeout(r, 700));
const afterRelease = await page.evaluate(() => ({ move: window.__GAME.input.move, vx: +window.__GAME.player.velocity.x.toFixed(2), vz: +window.__GAME.player.velocity.z.toFixed(2) }));
const restPos = afterRelease;
await new Promise((r) => setTimeout(r, 500));
const settled = await page.evaluate(() => window.__GAME.player.position.toArray().map((n) => +n.toFixed(2)));

// drag-look (no pointer lock): drag the mouse and expect yaw to change
await page.mouse.move(640, 360);
await page.mouse.down();
await page.mouse.move(820, 360, { steps: 8 });
await page.mouse.up();
const yawAfterDrag = await page.evaluate(() => +window.__GAME.player.yaw.toFixed(3));

const movedDist = Math.hypot(moveSnap.pos[0] - startPos[0], moveSnap.pos[2] - startPos[2]);

console.log('afterEnter:', JSON.stringify(afterEnter));
console.log('startPos:', JSON.stringify(startPos));
console.log('while holding W → move:', JSON.stringify(moveSnap.move), ' pos:', JSON.stringify(moveSnap.pos));
console.log('moved distance:', movedDist.toFixed(2));
console.log('after release → move:', JSON.stringify(afterRelease.move), ' vel(x,z):', restPos.vx, restPos.vz);
console.log('settled pos:', JSON.stringify(settled));
console.log('yaw start→afterDrag:', startYaw, '→', yawAfterDrag);
console.log('PAGE ERRORS:', errors.length, errors.join(' | '));

const ok = afterEnter.state === 'playing' && movedDist > 1 && afterRelease.move.x === 0 && afterRelease.move.y === 0 && Math.abs(yawAfterDrag - startYaw) > 0.05;
console.log('\nRESULT:', ok ? 'PASS ✅ movement + drag-look work without pointer lock' : 'FAIL ❌');
await browser.close();
process.exit(ok ? 0 : 1);
