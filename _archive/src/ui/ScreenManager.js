/**
 * NEXUS BLOCKS — ScreenManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages visibility of full-page screens and modal overlays.
 * Uses CSS `.screen.active` pattern from styles.css for fade transitions.
 *
 * Screens  : full-page views  (menu, game, results, boot)
 * Overlays : stacked modals   (pause, game-over, settings)
 */

'use strict';

class ScreenManager {
  constructor() {
    /** @type {Map<string, HTMLElement>} */
    this._screens  = new Map();
    /** @type {Map<string, HTMLElement>} */
    this._overlays = new Map();
    /** Currently visible screen name. */
    this._current  = null;
  }

  /**
   * Registers a screen element by name.
   * Assumes the element already exists in the DOM (created by index.html).
   * @param {string} name
   * @param {HTMLElement} el
   */
  register(name, el) {
    this._screens.set(name, el);
  }

  /**
   * Registers an overlay element by name.
   * @param {string} name
   * @param {HTMLElement} el
   */
  registerOverlay(name, el) {
    this._overlays.set(name, el);
  }

  showScreen(name, data) {
    // Hide current screen
    if (this._current && this._current !== name) {
      this._screens.get(this._current)?.classList.remove('active');
    }

    const el = this._screens.get(name);
    if (el) {
      el.classList.add('active');
      this._current = name;
      // Pass data to the screen via a custom event
      if (data) el.dispatchEvent(new CustomEvent('screen:show', { detail: data }));
    }
  }

  hideScreen(name) {
    this._screens.get(name)?.classList.remove('active');
    if (this._current === name) this._current = null;
  }

  showOverlay(name) {
    this._overlays.get(name)?.classList.add('active');
  }

  hideOverlay(name) {
    this._overlays.get(name)?.classList.remove('active');
  }
}

if (typeof module !== 'undefined') module.exports = { ScreenManager };
