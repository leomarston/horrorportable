import { QUALITY } from './config.js';

const $ = (id) => document.getElementById(id);

export default class UI {
  constructor() {
    this.el = {
      loading: $('loading'), barFill: $('bar-fill'), status: $('loading-status'),
      start: $('start'), enterBtn: $('enter-btn'), qualityButtons: $('quality-buttons'), deviceHint: $('device-hint'),
      pause: $('pause'), resumeBtn: $('resume-btn'), settings: $('settings'),
      hud: $('hud'), hudHint: $('hud-hint'), stats: $('stats'),
      touch: $('touch'),
    };
  }

  setProgress(p) {
    this.el.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }
  setStatus(s) { this.el.status.textContent = s; }

  showStart({ tier, deviceHint, onPickTier, onEnter }) {
    this.el.loading.classList.add('hidden');
    this.el.start.classList.remove('hidden');
    this.el.deviceHint.textContent = deviceHint;
    this._buildQuality(this.el.qualityButtons, tier, onPickTier);
    this.el.enterBtn.onclick = onEnter;
  }

  _buildQuality(container, tier, onPick) {
    container.innerHTML = '';
    for (const key of ['low', 'medium', 'high']) {
      const b = document.createElement('button');
      b.className = 'qbtn' + (key === tier ? ' active' : '');
      b.textContent = QUALITY[key].label;
      b.onclick = () => onPick(key);
      container.appendChild(b);
    }
  }

  enterGame() {
    this.el.start.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this.el.hudHint.style.opacity = '1';
    this._hintTimer = setTimeout(() => { this.el.hudHint.style.opacity = '0'; }, 6000);
  }

  showPause({ tier, statsOn, onPickTier, onToggleStats, onResume }) {
    this.el.pause.classList.remove('hidden');
    this.el.resumeBtn.onclick = onResume;
    this.el.settings.innerHTML = '';

    const qRow = document.createElement('div');
    qRow.className = 'settings-row';
    qRow.innerHTML = '<span>Quality (reloads)</span>';
    const qOpts = document.createElement('div');
    qOpts.className = 'opts';
    this._buildQuality(qOpts, tier, onPickTier);
    qRow.appendChild(qOpts);
    this.el.settings.appendChild(qRow);

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
