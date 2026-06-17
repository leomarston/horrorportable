// Headless test for Objective 3: the safe won't open until all papers are
// collected. Trying the locked safe completes Obj 2, reveals Obj 3, shows the
// paper counter and spawns papers. Collecting them all unlocks the safe.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--mute-audio'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality','low'));
await page.reload({ waitUntil: 'domcontentloaded' });
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.safe && window.__GAME.state==='menu', { timeout: 90000 }).then(()=>true).catch(()=>false);
await page.evaluate(() => { const g=window.__GAME; g.state='playing'; g.intro=null; g.ui.setObjective(g.objectives[0].label); document.getElementById('start').classList.add('hidden'); document.getElementById('loading').classList.add('hidden'); });
const settle = (ms)=>new Promise(r=>setTimeout(r,ms));
const counterHidden = () => page.evaluate(() => document.getElementById('book-counter').classList.contains('hidden'));
const objText = () => page.evaluate(() => document.getElementById('obj-title').textContent);
const objDone = () => page.evaluate(() => document.getElementById('obj-title').classList.contains('done'));

// before the trap: safe locked, won't open, no papers, counter hidden
const start = await page.evaluate(() => {
  const g=window.__GAME;
  const r = g.safe.interact();            // try it before obj2 even exists
  return { result:r, open:g.safe.open, total:g.pickups.total, revealed:g.papersRevealed };
});
const startHidden = await counterHidden();

// spring the trap → Objective 2 active
await page.evaluate(() => window.__GAME._springTrap());
await settle(2400);
const obj2 = await objText();

// now try the (still locked) safe via the integration path
const tryLocked = await page.evaluate(() => {
  const g=window.__GAME;
  const r = g.safe.interact();            // 'locked' — won't open
  g._onSafeLocked();                       // the loop calls this on a 'locked' result
  return { result:r, open:g.safe.open, total:g.pickups.total, revealed:g.papersRevealed };
});
const afterTryHidden = await counterHidden();
const afterTryDone = await objDone();      // obj2 should be ticked
await settle(2500);
const obj3 = await objText();

// collect all the papers → safe unlocks, obj3 done
const collected = await page.evaluate(() => {
  const g=window.__GAME; const total=g.pickups.total;
  for (let i=0;i<total;i++) g._onPaper();
  return { count:g.paperCount, total, locked:g.safe.locked };
});
const obj3Done = await objDone();
await settle(2500);
const obj4 = await objText();

// opening the unlocked safe completes obj4
const opens = await page.evaluate(() => {
  const g=window.__GAME; const r=g.safe.interact(); if (r==='opened') g._onSafeOpened();
  return { result:r, dir:g.safe._dir, done:document.getElementById('obj-title').classList.contains('done') };
});

console.log('READY:', ready);
console.log('START (pre-trap try):', JSON.stringify(start), 'counterHidden:', startHidden);
console.log('OBJ2:', JSON.stringify(obj2));
console.log('TRY LOCKED:', JSON.stringify(tryLocked), 'counterHidden:', afterTryHidden, 'obj2done:', afterTryDone);
console.log('OBJ3:', JSON.stringify(obj3));
console.log('COLLECTED:', JSON.stringify(collected), 'obj3done:', obj3Done);
console.log('OBJ4:', JSON.stringify(obj4));
console.log('OPENS:', JSON.stringify(opens));
console.log('\n--- ERRORS ('+errors.length+') ---'); errors.forEach(e=>console.log(e));

const pass = ready
  && start.result==='locked' && start.open===false && start.total===0 && start.revealed===false && startHidden===true
  && /find the safe/i.test(obj2)
  && tryLocked.result==='locked' && tryLocked.open===false && tryLocked.total===10 && tryLocked.revealed===true
  && afterTryHidden===false && afterTryDone===true
  && /Objective 3: Collect all the papers to unlock the safe/.test(obj3)
  && collected.count===10 && collected.locked===false
  && obj3Done===true
  && /Objective 4: Open the safe/.test(obj4)
  && opens.result==='opened' && opens.dir===1 && opens.done===true
  && errors.length===0;
console.log('\nRESULT:', pass?'PASS':'FAIL');
await browser.close();
process.exit(pass?0:1);
