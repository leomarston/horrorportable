// Headless test: trap completes Objective 1 + reveals Objective 2 ("You need the
// key, find the safe"); 3 nights — caught loses a night and wakes in the attic
// with a bloody NIGHT card + the current objective; lose all 3 → game over.
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
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.player && window.__GAME.state==='menu', { timeout: 90000 }).then(()=>true).catch(()=>false);
await page.evaluate(() => { const g=window.__GAME; g.state='playing'; g.intro=null; document.getElementById('start').classList.add('hidden'); document.getElementById('loading').classList.add('hidden'); g.ui.setObjective(g.objectives[0].label); });
const settle = (ms)=>new Promise(r=>setTimeout(r,ms));
const obj = () => page.evaluate(() => ({ text:document.getElementById('obj-title').textContent, done:document.getElementById('obj-title').classList.contains('done'), shown:!document.getElementById('obj-title').classList.contains('hidden') }));

// ---- 1) trap completes obj1 → obj2 appears ----
const beforeTrap = await obj();
await page.evaluate(() => window.__GAME._springTrap());
const atTrap = await obj();          // obj1 should be marked done now
await settle(2500);                  // wait past the 2.2s reveal
const afterTrap = await obj();       // obj2 text should show

// ---- 2) caught (deterministic): scareT past threshold → lose a night ----
const caught = await page.evaluate(() => {
  const g=window.__GAME; g._jumpscare(); g.scareT = 3.5; g._scareFrame(0.05); // → _loseNight
  const p=g.player;
  return { night:g.night, state:g.state, lock:g.nightCardLock,
    atAttic: Math.hypot(p.position.x-(-32), p.position.z-(-121))<3 && p.position.y>4,
    cardVisible: !document.getElementById('night-card').classList.contains('hidden'),
    nightText: document.getElementById('night-text').textContent };
});

// ---- 3) after the card, the current objective (obj2) is re-shown ----
await settle(3600);
const afterCard = await page.evaluate(() => ({ lock:window.__GAME.nightCardLock,
  text:document.getElementById('obj-title').textContent,
  shown:!document.getElementById('obj-title').classList.contains('hidden'),
  cardHidden: document.getElementById('night-card').classList.contains('hidden') }));

// ---- 4) burn remaining nights → game over on the 3rd loss ----
const n3 = await page.evaluate(() => { window.__GAME._loseNight(); return { night:window.__GAME.night, text:document.getElementById('night-text').textContent }; });
const over = await page.evaluate(() => { window.__GAME._loseNight(); return { night:window.__GAME.night, state:window.__GAME.state, gameoverVisible:!document.getElementById('gameover').classList.contains('hidden') }; });

console.log('READY:', ready);
console.log('beforeTrap obj:', JSON.stringify(beforeTrap));
console.log('atTrap     obj:', JSON.stringify(atTrap));
console.log('afterTrap  obj:', JSON.stringify(afterTrap));
console.log('CAUGHT:', JSON.stringify(caught));
console.log('AFTER CARD:', JSON.stringify(afterCard));
console.log('NIGHT3:', JSON.stringify(n3), ' GAME OVER:', JSON.stringify(over));
console.log('\n--- ERRORS ('+errors.length+') ---'); errors.forEach(e=>console.log(e));

const pass = ready
  && /Get in the house/.test(beforeTrap.text) && !beforeTrap.done
  && atTrap.done===true
  && /You need the key, find the safe/.test(afterTrap.text) && afterTrap.shown && !afterTrap.done
  && caught.night===2 && caught.state==='playing' && caught.atAttic===true
  && caught.cardVisible===true && /NIGHT 2/.test(caught.nightText) && caught.lock===true
  && afterCard.lock===false && /You need the key, find the safe/.test(afterCard.text) && afterCard.shown && afterCard.cardHidden
  && n3.night===3 && /NIGHT 3/.test(n3.text)
  && over.state==='gameover' && over.gameoverVisible===true
  && errors.length===0;
console.log('\nRESULT:', pass?'PASS':'FAIL');
await browser.close();
process.exit(pass?0:1);
