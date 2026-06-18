// The monster knows the whole house: wanders all rooms, and chases the player
// up AND down the stairs between floors.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--mute-audio'] });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality','low'));
await page.reload({ waitUntil: 'domcontentloaded' });
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.monster && window.__GAME.monster.nav, { timeout: 90000 }).then(()=>true).catch(()=>false);
const out = await page.evaluate(() => {
  const g=window.__GAME, m=g.monster, p=g.player; g.state='paused'; g.intro=null; const dt=1/60;
  const nav=m.nav;
  // nav graph: ground floor + attic are one reachable component
  const conn = nav.main.reduce((a,b)=>a+b,0);
  // A) wander coverage over 90s, accumulate cells + whether it ever goes upstairs
  p.position.set(-200,5,-200); m.state='wander'; m.relentless=false; m.path=null; m.pauseLeft=0;
  const cells=new Set(); let up=false;
  for(let i=0;i<5400;i++){ m.update(dt); cells.add(Math.round(m.pos.x)+','+Math.round(m.pos.z)); if(m.feetY>2.5) up=true; }
  // B) chase UP
  function at(x,y,z){ const n=nav.nearest(x,y,z); m.pos.set(nav.X[n],nav.Y[n],nav.Z[n]); m.feetY=nav.Y[n]; m.path=null; m.speed=0; }
  at(-45,-0.2,-123); p.position.set(-32,5.27,-121); m.state='chase'; m.relentless=true; m.lastSeen.copy(p.position); m._repathT=0;
  let upOk=false; for(let i=0;i<1800;i++){ m.update(dt); if(m.feetY>3.0 && Math.hypot(m.pos.x+32,m.pos.z+121)<3){upOk=true;break;} }
  // C) chase DOWN
  at(-32,3.9,-121); p.position.set(-45,1.5,-123); m.state='chase'; m.relentless=true; m.lastSeen.copy(p.position); m._repathT=0;
  let downOk=false; for(let i=0;i<1800;i++){ m.update(dt); if(m.feetY<0.4 && Math.hypot(m.pos.x+45,m.pos.z+123)<3){downOk=true;break;} }
  return { conn, cells:cells.size, wanderUpstairs:up, upOk, downOk };
});
console.log('reachable nav nodes (ground+attic):', out.conn);
console.log('wander cells covered (90s):', out.cells, '| reached upstairs:', out.wanderUpstairs);
console.log('chase UP stairs:', out.upOk, '| chase DOWN stairs:', out.downOk);
console.log('errors:', errs.length); errs.slice(0,3).forEach(e=>console.log(' ',e));
const pass = ready && out.conn>2000 && out.cells>40 && out.wanderUpstairs && out.upOk && out.downOk && errs.length===0;
console.log('RESULT:', pass?'PASS':'FAIL');
await browser.close(); process.exit(pass?0:1);
