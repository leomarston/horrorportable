// Full flow: open safe → gun appears + Obj5 + relentless + safe frozen → take gun
// → shoot Nulmire → kill (Obj5 done) → ending darkens → YOU KILLED NULMIRE card.
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
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.gun && window.__GAME.monster && window.__GAME.state==='menu', { timeout: 90000 }).then(()=>true).catch(()=>false);
await page.evaluate(() => { const g=window.__GAME; g.state='playing'; g.intro=null; g.ui.setObjective(g.objectives[0].label); document.getElementById('start').classList.add('hidden'); document.getElementById('loading').classList.add('hidden'); });
const settle = (ms)=>new Promise(r=>setTimeout(r,ms));
const objText = () => page.evaluate(() => document.getElementById('obj-title').textContent);

// drive through to the open safe
const opened = await page.evaluate(() => {
  const g=window.__GAME;
  g._springTrap(); g._onSafeLocked();
  const total=g.pickups.total; for(let i=0;i<total;i++) g._onPaper(); // unlock safe
  const r = g.safe.interact(); if (r==='opened') g._onSafeOpened();
  return { interact:r, frozen:g.safe.frozen, relentless:g.monster.relentless,
           gunInSafe: !!g._gunDisplay, currentObjective:g.currentObjective };
});
await settle(2400);
const obj5 = await objText();

// safe is now non-interactable
const refrozen = await page.evaluate(() => window.__GAME.safe.interact());

// take the gun (stand by the safe)
const took = await page.evaluate(() => {
  const g=window.__GAME, p=g.player, S={x:-34.25,z:-130.2};
  p.position.set(S.x+1, p.position.y, S.z); // within takeDist
  const near = g._nearSafe();
  g._takeGun();
  return { near, gunTaken:g.gunTaken, equipped:g.gun.equipped, displayGone: !g._gunDisplay };
});

// a shot that misses (monster behind us) must NOT kill
const miss = await page.evaluate(() => {
  const g=window.__GAME, cam=g.engine.camera;
  const fwd=new (g.player.position.constructor)(); cam.getWorldDirection(fwd);
  g.monster.root.position.copy(cam.position).addScaledVector(fwd, -4); // behind
  g.monster.state='wander';
  g._fireGun();
  return { state:g.monster.state, game:g.state };
});

// aim at the monster in front → kill
const hit = await page.evaluate(() => {
  const g=window.__GAME, cam=g.engine.camera, M=window.__GAME.monster;
  const fwd=new (g.player.position.constructor)(); cam.getWorldDirection(fwd);
  M.root.position.copy(cam.position).addScaledVector(fwd, 4);
  M.root.position.y = cam.position.y - 0.88;  // centre near aim height
  M.state='wander';
  g._fireGun();
  return { monsterState:M.state, modelVisible:M.model.visible, game:g.state,
           obj5done:document.getElementById('obj-title').classList.contains('done'),
           keyDropped:g.key.active };
});
await settle(2400);
const obj6 = await page.evaluate(() => document.getElementById('obj-title').textContent);

// door locked with no key yet → no escape
const noKey = await page.evaluate(() => { const d=window.__GAME.doors.doors[0]; d.locked=true; const r=d.locked; window.__GAME._fireGun; return { hasKey:window.__GAME.hasKey, game:window.__GAME.state }; });

// collect the key (walk onto it) → hasKey, then unlock the door → ending
const got = await page.evaluate(() => {
  const g=window.__GAME, p=g.player;
  p.position.set(g.key.mesh.position.x, p.position.y, g.key.mesh.position.z);
  const taken = g.key.update(0.016, p.position); if (taken) g._onKeyCollected();
  return { taken, hasKey:g.hasKey };
});
const escaped = await page.evaluate(() => {
  const g=window.__GAME, d=g.doors.doors[0];
  // simulate interacting with the locked door while holding the key
  d.locked = true;
  if (d.locked && g.hasKey) g._unlockAndEscape();
  return { game:g.state, doorLocked:d.locked, doorOpen:d.open };
});

// fast-forward the darken, expect the killed card
await page.evaluate(() => { if (window.__GAME.ending) window.__GAME.ending.t = 4.0; });
await settle(400);
const ended = await page.evaluate(() => ({
  fade: document.getElementById('intro-fade').style.opacity,
  killedShown: !document.getElementById('killed').classList.contains('hidden'),
  killedText: document.querySelector('#killed .killed-title')?.textContent || '',
}));

console.log('READY:', ready);
console.log('OPENED:', JSON.stringify(opened));
console.log('OBJ5:', JSON.stringify(obj5));
console.log('REFROZEN interact:', JSON.stringify(refrozen));
console.log('TOOK GUN:', JSON.stringify(took));
console.log('MISS:', JSON.stringify(miss));
console.log('HIT:', JSON.stringify(hit));
console.log('OBJ6:', JSON.stringify(obj6));
console.log('NO KEY:', JSON.stringify(noKey));
console.log('GOT KEY:', JSON.stringify(got));
console.log('ESCAPED:', JSON.stringify(escaped));
console.log('ENDED:', JSON.stringify(ended));
console.log('\n--- ERRORS ('+errors.length+') ---'); errors.forEach(e=>console.log(e));

const pass = ready
  && opened.interact==='opened' && opened.frozen===true && opened.relentless===true && opened.gunInSafe===true
  && /Objective 5: Kill Nulmire/.test(obj5)
  && refrozen==='frozen'
  && took.near===true && took.gunTaken===true && took.equipped===true && took.displayGone===true
  && miss.state==='wander' && miss.game==='playing'         // a miss doesn't kill
  && hit.monsterState==='dead' && hit.modelVisible===false && hit.game==='playing' && hit.obj5done===true && hit.keyDropped===true
  && /Objective 6: GET OUT/.test(obj6)
  && noKey.hasKey===false && noKey.game==='playing'         // no key → no escape
  && got.taken===true && got.hasKey===true
  && escaped.game==='ending' && escaped.doorLocked===false && escaped.doorOpen===true
  && ended.killedShown===true && /KILLED\s*NULMIRE/i.test(ended.killedText)
  && errors.length===0;
console.log('\nRESULT:', pass?'PASS':'FAIL');
await browser.close();
process.exit(pass?0:1);
