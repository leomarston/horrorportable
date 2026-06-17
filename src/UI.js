const $ = (id) => document.getElementById(id);

export default class UI {
  constructor() {
    this.el = {
      loading: $('loading'), barFill: $('bar-fill'), status: $('loading-status'),
      start: $('start'), enterBtn: $('enter-btn'), deviceHint: $('device-hint'),
      pause: $('pause'), resumeBtn: $('resume-btn'), settings: $('settings'),
      hud: $('hud'), hudHint: $('hud-hint'), stats: $('stats'), prompt: $('interact-prompt'),
      touch: $('touch'),
      bookCount: $('book-count'), bookGoal: $('book-goal'),
      win: $('win'), winAgain: $('win-again'),
      scare: $('scare'), scareFlash: $('scare-flash'), scareText: $('scare-text'),
      objTitle: $('obj-title'), introFade: $('intro-fade'),
    };
    this._promptText = null;
  }

  // ---- opening fade-from-black ----
  fadeShow() { this.el.introFade.style.display = 'block'; this.el.introFade.style.opacity = '1'; }
  fadeSet(o) { this.el.introFade.style.opacity = String(o); }
  fadeHide() { this.el.introFade.style.display = 'none'; }

  // ---- objective (top-right) ----
  setObjective(text) {
    const el = this.el.objTitle;
    el.innerHTML = `<span>${text}</span>`;
    el.classList.remove('hidden', 'done');
    el.style.transition = 'opacity .4s ease';
    el.style.transform = 'none';
    el.style.opacity = '1';
  }

  // big in the centre, fades in (call flyObjectiveToCorner after a hold)
  introTitle(text) {
    const el = this.el.objTitle;
    el.innerHTML = `<span>${text}</span>`;
    el.classList.remove('hidden', 'done');
    el.style.transition = 'none';
    el.style.transform = 'none';
    el.style.opacity = '0';
    const r = el.getBoundingClientRect();                 // home (top-right) rect
    const tx = window.innerWidth / 2 - (r.left + r.width / 2);
    const ty = window.innerHeight * 0.46 - (r.top + r.height / 2);
    void el.offsetWidth;                                  // reflow before transitioning
    el.style.transform = `translate(${tx}px, ${ty}px) scale(1.95)`;
    el.style.transition = 'opacity .55s ease';
    el.style.opacity = '1';
  }

  flyObjectiveToCorner() {
    const el = this.el.objTitle;
    el.style.transition = 'transform .9s cubic-bezier(.4,0,.2,1)';
    el.style.transform = 'none';                          // animate to its top-right home
  }

  completeObjective() { this.el.objTitle.classList.add('done'); }
  hideObjective() { this.el.objTitle.style.transition = 'opacity .6s ease'; this.el.objTitle.style.opacity = '0'; }

  showScare() {
    this.el.scare.classList.remove('hidden');
    this.el.scareText.classList.add('hidden');
    const f = this.el.scareFlash;           // replay the flash animation
    f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
  }
  showDeath() { this.el.scareText.classList.remove('hidden'); }
  hideScare() { this.el.scare.classList.add('hidden'); this.el.scareText.classList.add('hidden'); }

  setBooks(n, goal) {
    this.el.bookCount.textContent = n;
    this.el.bookGoal.textContent = goal;
  }

  showWin(onAgain) {
    this.el.win.classList.remove('hidden');
    this.el.winAgain.onclick = onAgain;
  }
  hideWin() { this.el.win.classList.add('hidden'); }


  setPrompt(text) {
    if (text === this._promptText) return;
    this._promptText = text;
    if (text) { this.el.prompt.innerHTML = `<b>E</b> &nbsp;${text}`; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }

  setProgress(p) {
    this.el.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }
  setStatus(s) { this.el.status.textContent = s; }

  showStart({ deviceHint, onEnter }) {
    this.el.loading.classList.add('hidden');
    this.el.start.classList.remove('hidden');
    this.el.deviceHint.textContent = deviceHint;
    this.el.enterBtn.onclick = onEnter;
  }

  enterGame() {
    this.el.start.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this.el.hudHint.style.opacity = '1';
    this._hintTimer = setTimeout(() => { this.el.hudHint.style.opacity = '0'; }, 6000);
  }

  showPause({ statsOn, onToggleStats, onResume }) {
    this.el.pause.classList.remove('hidden');
    this.el.resumeBtn.onclick = onResume;
    this.el.settings.innerHTML = '';

    const sRow = document.createElement('div');
    sRow.className = 'settings-row';
    sRow.innerHTML = '<span>Show FPS</span>';
    const sBtn = document.createElement('button');
    sBtn.className = 'qbtn' + (statsOn ? ' active' : '');
    sBtn.textContent = statsOn ? 'On' : 'Off';
    sBtn.onclick = () => { onToggleStats(); sBtn.classList.toggle('active'); sBtn.textContent = sBtn.classList.contains('active') ? 'On' : 'Off'; };
    sRow.appendChild(sBtn);
    this.el.settings.appendChild(sRow);
  }
  hidePause() { this.el.pause.classList.add('hidden'); }

  setStatsVisible(v) { this.el.stats.classList.toggle('hidden', !v); }
  setStats(text) { this.el.stats.textContent = text; }

  showTouch() { this.el.touch.classList.remove('hidden'); }
}
