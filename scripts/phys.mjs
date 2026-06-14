// Deterministic physics test: step the controller at a fixed dt (no rendering)
// to verify traversal, wall collision and the map-edge clamp independent of FPS.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME && window.__GAME.world && window.__GAME.state === 'menu', { timeout: 90000 }).catch(() => {});

const result = await page.evaluate(() => {
  const g = window.__GAME;
  const p = g.player;
  const dt = 1 / 60;
  const out = {};

  const run = (label, move, steps, resetTo) => {
    if (resetTo) { p.spawn(resetTo.clone ? resetTo : g.world.spawnPoint, g.world.spawnYaw, 0); }
    p.input.move = move;
    let minY = Infinity, maxY = -Infinity;
    const start = p.position.clone();
    for (let i = 0; i < steps; i++) {
      p.update(dt);
      minY = Math.min(minY, p.position.y); maxY = Math.max(maxY, p.position.y);
    }
    p.input.move = { x: 0, y: 0 };
    return {
      start: { x: +start.x.toFixed(2), z: +start.z.toFixed(2) },
      end: { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2) },
      horizDist: +Math.hypot(p.position.x - start.x, p.position.z - start.z).toFixed(2),
      yRange: +(maxY - minY).toFixed(2),
      onGround: p.onGround,
    };
  };

  // 1) walk into the yard (+Z) for 4 s — should traverse a real distance, stay grounded
  p.spawn(g.world.spawnPoint, g.world.spawnYaw, 0);
  out.intoYard = run('yard', { x: 0, y: -1 }, 240);

  // 2) from spawn, walk toward the house (−Z) into a wall — should be blocked, not pass through
  out.intoHouse = run('house', { x: 0, y: 1 }, 240, g.world.spawnPoint);

  // 3) push hard toward the +X map edge for 30 s — must clamp inside maxX
  p.spawn(g.world.spawnPoint, g.world.spawnYaw, 0);
  p.input.move = { x: 0, y: 0 };
  // aim east: yaw so forward = +X
  p.yaw = -Math.PI / 2;
  let edgeMax = -Infinity;
  for (let i = 0; i < 1800; i++) { p.input.move = { x: 0, y: 1 }; p.update(1 / 60); edgeMax = Math.max(edgeMax, p.position.x); }
  out.edge = {
    finalX: +p.position.x.toFixed(2),
    maxXReached: +edgeMax.toFixed(2),
    boundMaxX: +g.world.collider.walkable.maxX.toFixed(2),
    clampedInside: p.position.x <= g.world.collider.walkable.maxX,
  };

  out.walkable = {
    minX: +g.world.collider.walkable.minX.toFixed(1), maxX: +g.world.collider.walkable.maxX.toFixed(1),
    minZ: +g.world.collider.walkable.minZ.toFixed(1), maxZ: +g.world.collider.walkable.maxZ.toFixed(1),
  };
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
