// Deterministic feel test. The head-bob / sway / roll / FOV logic lives in
// player._applyCamera, so we drive it directly with a set velocity (no
// locomotion/collision noise). Landing is tested with a clean vertical drop.
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

const res = await page.evaluate(() => {
  const g = window.__GAME, p = g.player, c = g.world.collider, cam = g.engine.camera;
  g.state = 'paused'; g.intro = null;
  const dt = 1/60;
  p.position.set(-45, (c.groundY(-45,-123,1.4)??-0.2)+1.1, -123); p.yaw=0; p.onGround=true;

  // drive only the camera-feel logic with a prescribed horizontal speed
  function feel(speed, strafeX, run, frames){
    p._bobGain=0; p._lean=0; p.bobT=0; cam.fov=p._baseFov; cam.updateProjectionMatrix();
    p.velocity.set(speed, 0, 0); p.onGround = speed>=0 ? true : true;
    p.input.move = { x: strafeX, y: speed>0?1:0 }; p.input.run = run; p.input.crouch=false;
    let yMin=1e9,yMax=-1e9,rMin=1e9,rMax=-1e9,fov=cam.fov;
    for(let i=0;i<frames;i++){
      if (speed===0){ p.velocity.set(0,0,0); }
      p._applyCamera(dt);
      yMin=Math.min(yMin,cam.position.y-p.position.y); yMax=Math.max(yMax,cam.position.y-p.position.y);
      rMin=Math.min(rMin,cam.rotation.z); rMax=Math.max(rMax,cam.rotation.z); fov=cam.fov;
    }
    return { yRange:+(yMax-yMin).toFixed(4), rollRange:+(rMax-rMin).toFixed(4), fov:+fov.toFixed(2) };
  }
  const walk   = feel(g.player.constructor ? 3.4 : 3.4, 0, false, 180);
  const running= feel(6.2, 0, true, 180);
  const strafe = feel(3.4, 1, false, 120);
  const still  = feel(0, 0, false, 120);
  const baseFov = p._baseFov;

  // landing: clean vertical drop, stepped at a fixed dt (paused loop → we drive it)
  g.input.keys.clear();
  p.position.set(-45, (c.groundY(-45,-123,1.4)??-0.2)+3.0, -123); p.velocity.set(0,0,0); p.onGround=false;
  let landDip=0, base=null;
  for(let i=0;i<150;i++){
    g.input.update(); p.update(dt);
    if(p.onGround){ if(base==null) base=p.position.y; landDip=Math.max(landDip, base - cam.position.y); }
  }

  return { walk, running, strafe, still, baseFov, landDip:+landDip.toFixed(4) };
});

console.log('READY:', ready);
console.log('WALK   :', JSON.stringify(res.walk));
console.log('RUN    :', JSON.stringify(res.running));
console.log('STRAFE :', JSON.stringify(res.strafe));
console.log('STILL  :', JSON.stringify(res.still));
console.log('baseFov:', res.baseFov, ' LAND dip:', res.landDip);
console.log('\n--- ERRORS ('+errors.length+') ---'); errors.forEach(e=>console.log(e));

const r = res;
const pass = ready
  && r.walk.yRange > 0.05
  && r.running.yRange > r.walk.yRange
  && r.running.fov > r.baseFov + 4
  && r.still.yRange < 0.005 && Math.abs(r.still.fov - r.baseFov) < 0.3
  && r.strafe.rollRange > 0.03
  && res.landDip > 0.05
  && errors.length === 0;
console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');
await browser.close();
process.exit(pass?0:1);
