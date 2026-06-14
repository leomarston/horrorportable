import puppeteer from 'puppeteer';
const CHROME = '.browser/chrome-linux64/chrome';
const URL = 'http://localhost:4173/';
const args = ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1280,720'];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args });

// ---------- 1) DESKTOP KEYBOARD ----------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME && window.__GAME.world && window.__GAME.state==='menu', { timeout: 90000 });
  await page.click('#enter-btn');
  await new Promise(r=>setTimeout(r,300));
  const start = await page.evaluate(()=>window.__GAME.player.position.toArray().map(n=>+n.toFixed(2)));
  await page.screenshot({ path: '/tmp/move-A.png' });
  await page.keyboard.down('w');
  await new Promise(r=>setTimeout(r,6000));
  const end = await page.evaluate(()=>window.__GAME.player.position.toArray().map(n=>+n.toFixed(2)));
  await page.keyboard.up('w');
  await page.screenshot({ path: '/tmp/move-B.png' });
  const dist = Math.hypot(end[0]-start[0], end[2]-start[2]);
  console.log('KEYBOARD: start', JSON.stringify(start), '→ end', JSON.stringify(end), ' dist', dist.toFixed(2), dist>2 ? 'PASS ✅' : 'FAIL ❌');
  await page.close();
}

// ---------- 2) TOUCH STICK (mobile) ----------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME && window.__GAME.world && window.__GAME.state==='menu', { timeout: 90000 });
  const isTouch = await page.evaluate(()=>window.__GAME.touch);
  await page.click('#enter-btn');
  await new Promise(r=>setTimeout(r,300));
  const touchVisible = await page.evaluate(()=>!document.getElementById('touch').classList.contains('hidden'));
  const res = await page.evaluate(()=>{
    const g = window.__GAME, p = g.player;
    const stick = document.getElementById('touch-move');
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const fire = (type, x, y) => stick.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    fire('pointerdown', cx, cy);
    fire('pointermove', cx, cy - r.height*0.5); // push up = forward
    const touchMove = { ...g.input._touchMove };
    const start = p.position.clone();
    for (let i=0;i<240;i++){ g.input.update(); p.update(1/60); }
    const dist = Math.hypot(p.position.x-start.x, p.position.z-start.z);
    return { touchMove, dist:+dist.toFixed(2), state:g.state };
  });
  console.log('TOUCH: detected', isTouch, ' uiVisible', touchVisible, ' stick→', JSON.stringify(res.touchMove), ' dist', res.dist, res.dist>2 ? 'PASS ✅' : 'FAIL ❌');
  await page.close();
}
await browser.close();
