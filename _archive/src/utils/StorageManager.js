/**
 * NEXUS BLOCKS — StorageManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around localStorage that:
 *   • Serialises / deserialises JSON automatically.
 *   • Namespaces all keys under a game-specific prefix to avoid collisions
 *     with other apps on the same origin.
 *   • Handles storage-quota errors gracefully (logs a warning, returns null).
 *   • Provides a simple in-memory fallback when localStorage is unavailable
 *     (e.g., private browsing on some browsers, or server-side unit tests).
 *
 * Usage:
 *   const storage = new StorageManager('nexus_blocks');
 *   storage.set('highscore_classic_endless', 42000);
 *   storage.get('highscore_classic_endless'); // → 42000
 *   storage.remove('highscore_classic_endless');
 *   storage.clear();  // removes ALL nexus_blocks.* keys
 */

'use strict';

class StorageManager {
  /**
   * @param {string} [namespace='nexus_blocks']
   *   All keys are stored as `${namespace}.${key}` in localStorage.
   */
  constructor(namespace = 'nexus_blocks') {
    this._ns      = namespace;
    this._memFallback = null; // populated if localStorage is unavailable

    // Detect localStorage availability once at construction time
    try {
      const probe = `__nexus_probe__`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      this._ls = localStorage;
    } catch {
      console.warn('[StorageManager] localStorage unavailable — using in-memory fallback.');
      this._ls          = null;
      this._memFallback = new Map();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Reads a value by key.
   * Returns `defaultValue` when the key doesn't exist.
   *
   * @param {string} key
   * @param {*}      [defaultValue=null]
   * @returns {*}
   */
  get(key, defaultValue = null) {
    const fullKey = this._key(key);

    if (this._ls) {
      const raw = this._ls.getItem(fullKey);
      if (raw === null) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch {
        console.warn(`[StorageManager] Corrupt value for key "${key}" — returning default.`);
        return defaultValue;
      }
    }

    // In-memory fallback
    return this._memFallback.has(fullKey)
      ? this._memFallback.get(fullKey)
      : defaultValue;
  }

  /**
   * Writes a value (JSON-serialisable) under key.
   * Returns true on success, false on quota error.
   *
   * @param {string} key
   * @param {*}      value
   * @returns {boolean}
   */
  set(key, value) {
    const fullKey = this._key(key);

    if (this._ls) {
      try {
        this._ls.setItem(fullKey, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn(`[StorageManager] set("${key}") failed:`, e.message);
        return false;
      }
    }

    this._memFallback.set(fullKey, value);
    return true;
  }

  /**
   * Removes the value stored under key.
   * @param {string} key
   */
  remove(key) {
    const fullKey = this._key(key);
    this._ls ? this._ls.removeItem(fullKey) : this._memFallback.delete(fullKey);
  }

  /**
   * Returns true when the key exists in storage.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const fullKey = this._key(key);
    if (this._ls) return this._ls.getItem(fullKey) !== null;
    return this._memFallback.has(fullKey);
  }

  /**
   * Removes ALL keys under this namespace.
   */
  clear() {
    if (this._ls) {
      const prefix  = this._ns + '.';
      const toDelete = [];
      for (let i = 0; i < this._ls.length; i++) {
        const k = this._ls.key(i);
        if (k && k.startsWith(prefix)) toDelete.push(k);
      }
      toDelete.forEach(k => this._ls.removeItem(k));
    } else {
      const prefix = this._ns + '.';
      for (const k of this._memFallback.keys()) {
        if (k.startsWith(prefix)) this._memFallback.delete(k);
      }
    }
  }

  /**
   * Returns all key-value pairs under this namespace as a plain object.
   * Useful for debugging or exporting a save file.
   * @returns {object}
   */
  dump() {
    const result = {};
    const prefix = this._ns + '.';

    if (this._ls) {
      for (let i = 0; i < this._ls.length; i++) {
        const k = this._ls.key(i);
        if (k && k.startsWith(prefix)) {
          const shortKey = k.slice(prefix.length);
          result[shortKey] = this.get(shortKey);
        }
      }
    } else {
      for (const [k, v] of this._memFallback.entries()) {
        if (k.startsWith(prefix)) {
          result[k.slice(prefix.length)] = v;
        }
      }
    }

    return result;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Adds the namespace prefix to a storage key.
   * @private
   */
  _key(key) {
    return `${this._ns}.${key}`;
  }
}

if (typeof module !== 'undefined') module.exports = { StorageManager };
