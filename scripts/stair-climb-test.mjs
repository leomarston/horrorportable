// Regression: Nulmire must climb the narrow staircase and reach the player instead of
// stalling a metre below (it used to veer off the side, fall, and loop). Covers the exact
// reported case — the player standing on the TOP STEP — plus deep-attic and mid-stairs.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--mute-audio'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality','low'));
await page.reload({ waitUntil: 'domcontentloaded' });
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.monster && window.__GAME.monster.nav, { timeout: 90000 }).then(()=>true).catch(()=>false);
const out = await page.evaluate(() => {
  const g = window.__GAME, m = g.monster, p = g.player, nav = m.nav; const dt = 1/60;
  g.state = 'paused'; g.intro = null;
  const nodeAt = (x,y,z) => { const n = nav.nearest(x,y,z); return { x:nav.X[n], y:nav.Y[n], z:nav.Z[n] }; };
  // start the monster at the foot of the stairs, relentless, and let it hunt a stationary
  // player at the given spot. It must climb (no fall) and catch them.
  const run = (px,py,pz) => {
    m.reset();                                     // full clean slate between cases
    const s = nodeAt(-29,-0.2,-126.6);
    m.pos.set(s.x,s.y,s.z); m.feetY = s.y; m.path = null; m.speed = 0; m._progPos.set(s.x,s.y,s.z);
    m.heading = -Math.PI / 2;                       // facing the stairs (−X), as it would mid-chase
    p.position.set(px,py,pz);
    m.state = 'chase'; m.relentless = true; m.canCatch = true; m.lastSeen.copy(p.position); m._repathT = 0;
    let caught = false, fell = false, prev = m.feetY, maxY = m.feetY;
    for (let i = 0; i < 900; i++) {
      m.update(dt);
      if (prev - m.feetY > 0.5) fell = true;       // a >0.5 sudden drop = fell off the side
      prev = m.feetY; maxY = Math.max(maxY, m.feetY);
      if (m.state === 'caught') { caught = true; break; }
    }
    return { caught, fell, maxY:+maxY.toFixed(2) };
  };
  const top = nodeAt(-34,3.1,-126.6);
  return {
    topStep:  run(top.x, top.y + 1.55, top.z),     // the user's exact scenario
    attic:    run(-32, 3.87 + 1.55, -121),         // deep in the attic room
    midStair: run(-33, 2.59 + 1.55, -126.6),       // partway up the flight
  };
});
console.log('player on TOP STEP :', JSON.stringify(out.topStep));
console.log('player in ATTIC    :', JSON.stringify(out.attic));
console.log('player MID-STAIR   :', JSON.stringify(out.midStair));
console.log('errors:', errs.length); errs.slice(0,3).forEach(e => console.log(' ', e));
const ok = (r) => r.caught && !r.fell;
const pass = ready && ok(out.topStep) && ok(out.attic) && ok(out.midStair) && errs.length === 0;
console.log('RESULT:', pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
