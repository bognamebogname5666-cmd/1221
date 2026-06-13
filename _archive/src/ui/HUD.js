/**
 * NEXUS BLOCKS — HUD
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the in-game heads-up display: score, timer, streak, combo pop-ups,
 * tray pieces, and ability charge meters.
 *
 * Subscribes to EventBus events and updates the DOM reactively.
 * Does NOT manipulate game state — pure display layer.
 *
 * DOM structure expected (created by ScreenManager.showScreen('game')):
 *   #hud
 *     .hud-score          — current score
 *     .hud-high-score     — personal best
 *     .hud-streak         — streak counter
 *     .hud-timer          — Rush mode countdown (hidden in Classic/Puzzle)
 *     .hud-tray           — 3 piece preview slots
 *     .hud-gravity-charge — gravity ability progress bar
 *     .hud-combo-popup    — floating combo text (animated)
 */

'use strict';

class HUD {
  /**
   * @param {EventBus} bus
   * @param {object}   [options]
   * @param {string}   [options.rootSelector='#hud']
   */
  constructor(bus, options = {}) {
    this._bus  = bus;
    this._root = document.querySelector(options.rootSelector ?? '#hud');

    /** @private Active combo popup tween handles. */
    this._comboPopupTimeout = null;

    this._unsubs = [];
    this._bindEvents();
  }

  // ── DOM Cache ──────────────────────────────────────────────────────────────

  _q(selector) {
    return this._root?.querySelector(selector) ?? null;
  }

  // ── Event Bindings ────────────────────────────────────────────────────────

  _bindEvents() {
    const on = (event, fn) => {
      this._unsubs.push(this._bus.on(event, fn.bind(this)));
    };

    on('score:updated',      this._onScoreUpdated);
    on('streak:changed',     this._onStreakChanged);
    on('combo:triggered',    this._onComboTriggered);
    on('rush:timerUpdate',   this._onTimerUpdate);
    on('tray:updated',       this._onTrayUpdated);
    on('rush:nextPiece',     this._onRushNextPiece);
    on('gravityShift:charged', this._onGravityCharged);
    on('game:state',         this._onStateChange);
  }

  // ── Event Handlers ────────────────────────────────────────────────────────

  _onScoreUpdated({ score, delta }) {
    const el = this._q('.hud-score');
    if (!el) return;
    el.textContent = score.toLocaleString('en-US');

    // Flash the score element on each increment
    el.classList.remove('hud-score--flash');
    void el.offsetWidth;
    el.classList.add('hud-score--flash');
    setTimeout(() => el.classList.remove('hud-score--flash'), 300);
  }

  _onStreakChanged({ streak }) {
    const el = this._q('.hud-streak');
    if (!el) return;
    el.textContent = streak > 1 ? `🔥 ${streak}×` : '';
    el.dataset.streak = streak;
    // CSS can apply flame intensity via data-streak attribute
  }

  _onComboTriggered({ type, multiplier, chainStep }) {
    const el = this._q('.hud-combo-popup');
    if (!el) return;

    const labels = {
      multi_clear    : `${multiplier}× MULTI`,
      nexus_link     : `NEXUS LINK!`,
      chain_reaction : `CHAIN ×${chainStep}`,
      nexus_chain    : `⚡ CHAIN ×${chainStep}`,
      speed_bonus    : `SPEED!`,
    };

    el.textContent = labels[type] ?? `×${multiplier}`;
    el.classList.remove('hud-combo--visible');
    void el.offsetWidth;
    el.classList.add('hud-combo--visible');

    clearTimeout(this._comboPopupTimeout);
    this._comboPopupTimeout = setTimeout(() => {
      el.classList.remove('hud-combo--visible');
    }, 1200);
  }

  _onTimerUpdate({ remainingMs }) {
    const el = this._q('.hud-timer');
    if (!el) return;

    const seconds = Math.ceil(remainingMs / 1000);
    el.textContent = String(seconds).padStart(2, '0');
    el.classList.toggle('hud-timer--warning', seconds <= 10);
    el.classList.toggle('hud-timer--critical', seconds <= 5);
  }

  _onTrayUpdated({ tray }) {
    // The .hud-tray element lives OUTSIDE #hud (it's a sibling under
    // .game-area-wrap), so this._q() — which scopes to #hud — used to return
    // null and silently drop every update. Query the whole document instead.
    const el = document.querySelector('.hud-tray');
    if (!el || !tray) return;

    // .hud-tray has a header element as its first child plus 3 slot divs.
    // Resolve slots by class rather than positional index so the header
    // doesn't get treated as slot[0].
    const slots = el.querySelectorAll('.hud-tray__slot');

    tray.forEach((entry, i) => {
      const slot = slots[i];
      if (!slot) return;
      if (!entry) {
        slot.innerHTML = '';
        slot.classList.add('hud-tray__slot--empty');
      } else {
        // Render a mini canvas preview of the piece
        this._renderPiecePreview(slot, entry.piece);
        slot.classList.remove('hud-tray__slot--empty');
      }
    });
  }

  _onRushNextPiece({ piece }) {
    // Same reasoning as _onTrayUpdated — query the document, not just #hud.
    const el = document.querySelector('.hud-rush-piece') ?? this._q('.hud-rush-piece');
    if (!el) return;
    this._renderPiecePreview(el, piece);
  }

  _onGravityCharged() {
    const el = this._q('.hud-gravity-charge');
    if (!el) return;
    el.classList.add('hud-gravity--ready');
  }

  _onStateChange({ to }) {
    // Show/hide HUD sections based on active state
    if (this._root) {
      this._root.classList.toggle('hud--playing', to === 'PLAYING');
    }
  }

  // ── Piece Preview Renderer ────────────────────────────────────────────────

  /**
   * Renders a tiny pixel-art preview of a piece into a container element
   * using an inline <canvas>.
   * @param {HTMLElement} container
   * @param {object}      piece
   */
  _renderPiecePreview(container, piece) {
    const CELL = 10; // pixels per mini-cell

    let canvas = container.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      container.appendChild(canvas);
    }

    const { PieceFactory } = window; // available from global scope
    const bb     = PieceFactory ? PieceFactory.boundingBox(piece.cells) : { w: 3, h: 3 };
    canvas.width  = bb.w * CELL;
    canvas.height = bb.h * CELL;

    const ctx  = canvas.getContext('2d');
    const style = getComputedStyle(document.documentElement);
    const base  = style.getPropertyValue(`--piece-${piece.colorIndex}-base`).trim() || '#888';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const { x, y } of piece.cells) {
      ctx.fillStyle   = base;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  /**
   * Removes all event bus subscriptions. Call when tearing down the game screen.
   */
  destroy() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }
}

if (typeof module !== 'undefined') module.exports = { HUD };
