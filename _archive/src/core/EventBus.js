/**
 * NEXUS BLOCKS — EventBus
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight synchronous publish/subscribe event bus.
 * Acts as the communication backbone between all game systems so modules
 * remain decoupled from each other.
 *
 * Typical usage:
 *   const bus = new EventBus();
 *
 *   // Subscribe (returns an unsubscribe function):
 *   const unsub = bus.on('line:cleared', ({ y }) => console.log('Row', y, 'cleared'));
 *
 *   // Subscribe once:
 *   bus.once('board:reset', () => resetUI());
 *
 *   // Publish:
 *   bus.emit('line:cleared', { y: 4, nexusCells: [] });
 *
 *   // Unsubscribe:
 *   unsub();
 *
 * ── Standard game events emitted across the codebase ──────────────────────
 *   'piece:placed'        { cells, colorIndex }
 *   'line:cleared'        { y, nexusCells }
 *   'column:cleared'      { x, nexusCells }
 *   'clears:processed'    { rows, cols, nexusDestroyed }
 *   'nexus:chain'         { groupId, cells, chainStep }
 *   'gravity:applied'     { direction }
 *   'board:reset'
 *   'score:updated'       { score, delta, multiplier }
 *   'combo:triggered'     { type, multiplier, chainStep }
 *   'streak:changed'      { streak }
 *   'game:state'          { from, to }
 *   'game:over'           { score, reason }
 *   'powerup:activated'   { id, name }
 */

'use strict';

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    // Debug mode: logs every emit to the console (enable in dev only)
    this._debug = false;
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * Subscribes a callback to an event.
   *
   * @param   {string}   event     — event name
   * @param   {Function} callback  — handler function(data)
   * @returns {Function}           — call to unsubscribe
   */
  on(event, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(`EventBus.on: callback must be a function (event: "${event}")`);
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // Return an unsubscribe function so callers can store and invoke it later
    return () => this.off(event, callback);
  }

  /**
   * Subscribes a callback that fires exactly once, then auto-unsubscribes.
   *
   * @param   {string}   event
   * @param   {Function} callback
   * @returns {Function} — call to cancel the one-time subscription early
   */
  once(event, callback) {
    const wrapper = (data) => {
      callback(data);
      this.off(event, wrapper);
    };
    // Tag the wrapper so it can be identified if needed
    wrapper._original = callback;
    return this.on(event, wrapper);
  }

  /**
   * Removes a specific callback from an event.
   *
   * @param {string}   event
   * @param {Function} callback
   */
  off(event, callback) {
    const set = this._listeners.get(event);
    if (!set) return;
    // Also handle once() wrappers that wrap this callback
    for (const fn of set) {
      if (fn === callback || fn._original === callback) {
        set.delete(fn);
        break;
      }
    }
    if (set.size === 0) this._listeners.delete(event);
  }

  /**
   * Publishes an event, synchronously calling all registered callbacks.
   *
   * @param {string} event
   * @param {*}      [data]  — payload passed to each callback
   */
  emit(event, data) {
    if (this._debug) {
      console.log(`[EventBus] ${event}`, data ?? '');
    }

    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;

    // Snapshot the set before iterating so that callbacks that call off()
    // or on() during emission don't cause mutation during iteration.
    for (const fn of Array.from(set)) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] Error in listener for "${event}":`, err);
      }
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /**
   * Returns the number of listeners registered for the given event.
   * @param   {string} event
   * @returns {number}
   */
  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  /**
   * Removes all listeners for a specific event, or all events if omitted.
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Enables/disables verbose console logging for every emit call.
   * Useful during development — turn off before shipping.
   * @param {boolean} on
   */
  setDebug(on) {
    this._debug = !!on;
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { EventBus };
