/**
 * NEXUS BLOCKS — ui.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure UI layer.  Loaded AFTER the inline bootstrap in index.html, so
 * window.bus / window.board / window.sm are already available.
 *
 * Responsibilities:
 *   • Settings panel — open / close / persist to localStorage
 *   • Best-score counter animation on the main menu
 *   • Animated particle dots in the menu background
 *   • XP bar & level label updater (hooks into bus 'xp:updated' / 'level:up')
 *   • Combo popup tier-colouring (augments HUD.js)
 *   • Level-up flash overlay on board and HUD
 *   • Share Score button (navigator.share with clipboard fallback)
 *   • Keyboard shortcut: Escape or P → pause / resume
 *
 * Exposes:  window.NexusUI  (object with named sub-modules)
 * Uses:     Board.getCell / setCell / clearLine  (via window.board)
 *           EventBus (via window.bus)
 *           CSS custom properties from styles.css & nexus_visuals.css
 *           game.css animation classes
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

(function () {

/* ══════════════════════════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════════════════════════ */

/** localStorage wrapper — silently ignores private-browsing errors. */
const Storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

/** requestAnimationFrame count-up tween. Returns a cancel function. */
function tweenCount(fromVal, toVal, durationMs, setter) {
  const start = performance.now();
  let raf;
  function step(now) {
    const t    = Math.min((now - start) / durationMs, 1);
    const ease = 1 - Math.pow(1 - t, 4);          // ease-out quartic
    setter(Math.round(fromVal + (toVal - fromVal) * ease));
    if (t < 1) raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/* ══════════════════════════════════════════════════════════════════════════════
   1 · SETTINGS PANEL
══════════════════════════════════════════════════════════════════════════════ */

const SettingsPanel = (() => {
  const panel    = document.getElementById('settings-panel');
  const backdrop = document.getElementById('settings-backdrop');
  const openBtn  = document.getElementById('btn-settings-open');
  const closeBtn = document.getElementById('btn-settings-close');

  if (!panel) return { get: () => ({}) };

  // ── Defaults ──────────────────────────────────────────────────────────────
  const DEFAULTS = {
    sfx: true,
    music: true,
    haptics: true,
    masterVolume: 0.75,
    musicVolume: 0.42,
    sfxVolume: 0.85,
    ghost: true,
    particles: true,
    das: 150,
    boardSize: 9,
  };
  let cfg = { ...DEFAULTS, ...Storage.get('nexus_settings', {}) };

  function save() { Storage.set('nexus_settings', cfg); }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function open() {
    panel.classList.add('open');
    backdrop.classList.add('open');
    panel.removeAttribute('aria-hidden');
    openBtn?.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    openBtn?.setAttribute('aria-expanded', 'false');
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });

  // ── Sync toggles from config ───────────────────────────────────────────────
  function bindToggle(id, key) {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;
    checkbox.checked = !!cfg[key];
    // The parent label wraps the toggle-track, so change fires on the input
    checkbox.addEventListener('change', () => {
      cfg[key] = checkbox.checked;
      save();
      window.bus?.emit('settings:changed', { key, value: cfg[key] });
    });
  }

  function bindRange(id, key) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = cfg[key];
    input.addEventListener('input', () => {
      cfg[key] = Number(input.value);
      save();
      window.bus?.emit('settings:changed', { key, value: cfg[key] });
    });
  }

  bindToggle('setting-sfx',       'sfx');
  bindToggle('setting-music',     'music');
  bindToggle('setting-haptics',   'haptics');
  bindToggle('setting-ghost',     'ghost');
  bindToggle('setting-particles', 'particles');
  bindRange ('setting-master-volume', 'masterVolume');
  bindRange ('setting-music-volume',  'musicVolume');
  bindRange ('setting-sfx-volume',    'sfxVolume');
  bindRange ('setting-das',       'das');

  const boardSel = document.getElementById('setting-board-size');
  if (boardSel) {
    boardSel.value = cfg.boardSize;
    boardSel.addEventListener('change', () => {
      cfg.boardSize = Number(boardSel.value);
      save();
      window.bus?.emit('settings:changed', { key: 'boardSize', value: cfg.boardSize });
    });
  }

  return { open, close, get: () => ({ ...cfg }) };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   2 · BEST-SCORE COUNTER  (main menu)
══════════════════════════════════════════════════════════════════════════════ */

const BestScore = (() => {
  const el = document.getElementById('best-score-counter');
  let cancelPrev = null;

  function load() {
    const best = Storage.get('nexus_best_score', 0);
    animateTo(best);
  }

  function animateTo(target) {
    if (!el) return;
    cancelPrev?.();
    cancelPrev = tweenCount(0, target, Math.min(1400, target / 2 + 600), v => {
      el.textContent = v.toLocaleString('en-US');
    });
  }

  function maybeUpdate(score, mode = 'classic') {
    const key  = `nexus_best_score_${mode}`;
    const best = Storage.get(key, 0);
    const globalBest = Storage.get('nexus_best_score', 0);
    let newRecord = false;
    if (score > best) {
      Storage.set(key, score);
      newRecord = true;
    }
    if (score > globalBest) {
      Storage.set('nexus_best_score', score);
    }
    return newRecord;
  }

  // Animate on menu show
  document.getElementById('screen-menu')?.addEventListener('screen:show', load);

  // Also run on first load if menu is already active
  if (document.getElementById('screen-menu')?.classList.contains('active')) {
    // slight delay so CSS transitions have applied
    setTimeout(load, 200);
  }

  return { load, animateTo, maybeUpdate };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   3 · MENU PARTICLE DOTS  (CSS-animated, JS-generated)
══════════════════════════════════════════════════════════════════════════════ */

(function initParticles() {
  const field = document.querySelector('.menu-particles');
  if (!field) return;

  // Inject keyframes once
  const styleId = 'nexus-particle-kf';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      @keyframes pDrift {
        0%,100% { transform: translate(0,0)            scale(1);    opacity:.55; }
        25%      { transform: translate(10px,-22px)     scale(1.35); opacity:1;   }
        50%      { transform: translate(-7px,-38px)     scale(.75);  opacity:.35; }
        75%      { transform: translate(16px,-14px)     scale(1.15); opacity:.85; }
      }
    `;
    document.head.appendChild(s);
  }

  const COLORS = [
    'rgba(0,240,255,.55)',
    'rgba(102,0,255,.45)',
    'rgba(1,255,137,.42)',
    'rgba(255,198,0,.40)',
    'rgba(255,0,85,.38)',
  ];

  const COUNT = 32;
  const frag  = document.createDocumentFragment();

  for (let i = 0; i < COUNT; i++) {
    const dot    = document.createElement('span');
    const size   = 1.5 + Math.random() * 3.5;
    const dur    = 7 + Math.random() * 14;
    const delay  = -(Math.random() * 12);
    const color  = COLORS[Math.floor(Math.random() * COLORS.length)];

    Object.assign(dot.style, {
      position:     'absolute',
      left:         `${Math.random() * 100}%`,
      top:          `${Math.random() * 100}%`,
      width:        `${size}px`,
      height:       `${size}px`,
      borderRadius: '50%',
      background:   color,
      animation:    `pDrift ${dur}s ${delay}s ease-in-out infinite`,
      pointerEvents:'none',
    });

    frag.appendChild(dot);
  }

  field.appendChild(frag);
})();

/* ══════════════════════════════════════════════════════════════════════════════
   4 · XP BAR  &  LEVEL LABEL
══════════════════════════════════════════════════════════════════════════════ */

const XPBar = (() => {
  const fill       = document.getElementById('xp-bar-fill');
  const barEl      = document.getElementById('hud-xp-bar');
  const levelLabel = document.getElementById('hud-level-label');
  const xpText     = document.getElementById('hud-xp-text');

  function set(current, max, level) {
    const pct = Math.min((current / Math.max(max, 1)) * 100, 100);
    if (fill)  fill.style.width = pct.toFixed(1) + '%';
    if (barEl) barEl.setAttribute('aria-valuenow', Math.round(pct));
    if (levelLabel) levelLabel.textContent = `LV.${level}`;
    if (xpText)     xpText.textContent     = `${current} XP`;
  }

  return { set };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   5 · LEVEL-UP FLASH
══════════════════════════════════════════════════════════════════════════════ */

const LevelUp = (() => {
  const hud      = document.getElementById('hud');
  const boardWrap= document.getElementById('game-board-wrap');

  function trigger() {
    // HUD gleam
    if (hud) {
      hud.classList.remove('levelup-flash');
      void hud.offsetWidth;
      hud.classList.add('levelup-flash');
      setTimeout(() => hud.classList.remove('levelup-flash'), 820);
    }
    // Board overlay
    if (boardWrap) {
      boardWrap.classList.remove('levelup');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('levelup');
      setTimeout(() => boardWrap.classList.remove('levelup'), 820);
    }
  }

  return { trigger };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   6 · COMBO POPUP TIER COLOURING  (augments HUD.js)
   HUD.js sets the text; we set the data-tier attribute for CSS colour.
══════════════════════════════════════════════════════════════════════════════ */

(function patchComboBus() {
  // Wait one tick for window.bus to be available (set in bootstrap inline script)
  setTimeout(() => {
    const bus = window.bus;
    if (!bus) return;

    const popup = document.getElementById('hud-combo-popup');
    if (!popup) return;

    bus.on('combo:triggered', ({ multiplier }) => {
      // Tier 1–5 maps to CSS --combo-t1 … --combo-t5
      const tier = Math.min(Math.max(1, multiplier - 1), 5);
      popup.dataset.tier = tier;
    });

    // XP updates
    bus.on('xp:updated', ({ current, max, level }) => {
      XPBar.set(current, max, level);
    });

    // Level up
    bus.on('level:up', ({ level }) => {
      LevelUp.trigger();
      XPBar.set(0, level * 100, level);  // reset bar for new level (approximate)
    });

    // Update best score when game ends
    bus.on('game:over', ({ score, mode }) => {
      const isNew = BestScore.maybeUpdate(score, mode ?? 'classic');
      BestScore.load(); // refresh counter display for when menu is shown
      // Expose to results screen handler
      window._nexusLastResult = { ...(window._nexusLastResult ?? {}), isNewRecord: isNew };
    });

  }, 0);
})();

/* ══════════════════════════════════════════════════════════════════════════════
   7 · SHARE SCORE BUTTON
══════════════════════════════════════════════════════════════════════════════ */

(function initShare() {
  const btn = document.getElementById('btn-share');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const scoreEl = document.getElementById('res-score');
    const score   = scoreEl?.textContent ?? '0';
    const shareData = {
      title: 'NEXUS BLOCKS',
      text:  `I scored ${score} in NEXUS BLOCKS! Can you beat me? 🎮`,
      url:   location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        // User cancelled — no action needed
      }
    } else {
      // Clipboard fallback
      const text = `${shareData.text} — ${shareData.url}`;
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2200);
      } catch {
        // Final fallback: select a temp textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2200);
      }
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   8 · KEYBOARD SHORTCUTS (Pause: P / Escape)
   Adds to the existing btn-pause click handler without replacing it.
══════════════════════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  const gameActive = document.getElementById('screen-game')?.classList.contains('active');
  if (!gameActive) return;

  // Ignore when typing in an input / textarea / select
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;

  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault();
    document.getElementById('btn-pause')?.click();
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   9 · MENU ENTRANCE ANIMATION  (stagger mode buttons)
══════════════════════════════════════════════════════════════════════════════ */

(function staggerMenuButtons() {
  // Inject per-button entrance delay
  document.querySelectorAll('.menu-mode-btn').forEach((btn, i) => {
    btn.style.animationDelay   = `${0.08 + i * 0.09}s`;
    btn.style.animationName    = 'btnReveal';
    btn.style.animationDuration= '380ms';
    btn.style.animationFillMode= 'both';
    btn.style.animationTimingFunction = 'cubic-bezier(.16,1,.3,1)';
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   10 · HIGH-SCORE DISPLAY IN MENU  (Classic / Rush per-mode bests)
══════════════════════════════════════════════════════════════════════════════ */

(function updateMenuHighScores() {
  function refresh() {
    const classic = Storage.get('nexus_best_score_classic_endless', 0);
    const rush    = Storage.get('nexus_best_score_time_rush', 0);
    const elC = document.getElementById('hs-classic');
    const elR = document.getElementById('hs-rush');
    if (elC) elC.textContent = classic.toLocaleString('en-US');
    if (elR) elR.textContent = rush.toLocaleString('en-US');
  }
  refresh();
  // Refresh each time the menu becomes active
  document.getElementById('screen-menu')?.addEventListener('screen:show', refresh);
})();

/* ══════════════════════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════════════════════ */

window.NexusUI = {
  SettingsPanel,
  BestScore,
  XPBar,
  LevelUp,
};

})(); // IIFE
