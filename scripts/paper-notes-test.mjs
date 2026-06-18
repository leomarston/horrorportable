// 8 papers (not 10), and each one collected shows its diary line in order as a
// "Paper found" note; collecting all 8 unlocks the safe.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '.browser/chrome-linux64/chrome', headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--mute-audio'] });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('ah_quality','low'));
await page.reload({ waitUntil: 'domcontentloaded' });
const ready = await page.waitForFunction(() => window.__GAME && window.__GAME.pickups && window.__GAME.state==='menu', { timeout: 90000 }).then(()=>true).catch(()=>false);
const out = await page.evaluate(() => {
  const g=window.__GAME;
  g.state='playing'; g.intro=null; g._springTrap(); g._onSafeLocked(); // reveal + spawn papers
  const total=g.pickups.total, notes=[];
  for(let i=0;i<total;i++){
    g._onPaper();
    notes.push({ label:document.querySelector('#paper-note .paper-note-label').textContent,
                 text:document.getElementById('paper-note-text').textContent,
                 shown:!document.getElementById('paper-note').classList.contains('hidden') });
  }
  return { total, notes, goalText:document.getElementById('book-goal').textContent, safeUnlocked:g._papersDone };
});
const expected=['We moved to our new house, yey','My daughter is acting weird','There is hair everywhere on her body','I hear her laughing every night','She does not speak anymore','SHE ATE A CAT, I SAW IT','That thing is not my daughter','SHOOT IT, THIS IS A MONSTER'];
console.log('papers:', out.total, '| counter goal:', out.goalText, '| safe unlocked:', out.safeUnlocked);
out.notes.forEach((n,i)=>console.log(`  #${i+1}: ${n.text}`));
const pass = ready && out.total===8 && out.goalText==='8' && out.safeUnlocked===true && out.notes.length===8
  && out.notes.every((n,i)=> n.text===expected[i] && n.label==='Paper found' && n.shown) && errs.length===0;
console.log('errors:',errs.length); console.log('RESULT:', pass?'PASS':'FAIL');
await browser.close(); process.exit(pass?0:1);
