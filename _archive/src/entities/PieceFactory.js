/**
 * NEXUS BLOCKS — PieceFactory
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines all 12 original piece shapes, provides rotation, a 7-bag randomiser,
 * and ghost-piece calculation helpers.
 *
 * Piece shapes are defined as arrays of {x, y} offsets relative to their
 * bounding-box top-left corner. This matches the Board API (canPlace /
 * placePiece / calculateGhost) which also uses {x, y} coordinate arrays.
 *
 * ── Pieces (from GDD) ─────────────────────────────────────────────────────
 *   P01 Spark       3 cells  — L corner
 *   P02 Bolt        3 cells  — diagonal staircase
 *   P03 Anvil       4 cells  — T-shape
 *   P04 Fang        4 cells  — S/Z zigzag pair
 *   P05 Crown       5 cells  — three-pointed crown
 *   P06 Helix       5 cells  — spiral / S-extension
 *   P07 Bastion     5 cells  — plus / cross
 *   P08 Talon       4 cells  — hook (L with long arm)
 *   P09 Monolith    5 cells  — 1×5 vertical bar
 *   P10 Arch        5 cells  — U / horseshoe
 *   P11 Wraith      6 cells  — large Z-extension
 *   P12 Nexus Core  4 cells  — 2×2 square, all nexus connectors
 *
 * ── Rotation System ───────────────────────────────────────────────────────
 *   Pieces rotate in 90° increments (0 / 90 / 180 / 270).
 *   Rotation is computed via a 2D pivot transform:
 *     (x, y)  →  (−y, x)   for 90° clockwise
 *   After rotation the bounding box is normalised to (0, 0) so the top-left
 *   offset is always (0, 0), keeping placement logic consistent.
 *
 * ── Bag Randomiser ────────────────────────────────────────────────────────
 *   Uses a seeded PRNG (xorshift32) so Time Rush daily challenges are
 *   reproducible. Classic Endless uses a true random seed.
 *
 *   The "bag" system groups all 12 piece definitions into a single bag,
 *   shuffles the bag, then deals pieces in order before reshuffling.
 *   This prevents long droughts of any single shape.
 *
 * Usage:
 *   const factory = new PieceFactory({ seed: Date.now() });
 *   const piece   = factory.next();   // { id, name, cells, rotation, colorIndex }
 *   const rotated = PieceFactory.rotate(piece.cells, 1); // 1 = 90° CW
 *   const ghost   = board.calculateGhost(rotated, dragX, dragY);
 */

'use strict';

// ── Piece Definitions ─────────────────────────────────────────────────────────
// Each shape is expressed in its default (0°) rotation.
// nexusSlots > 0 means some cells will randomly receive LINKED flags
// when the piece is instantiated (see _assignNexusFlags).

const PIECE_DEFS = [
  {
    id         : 'P01',
    name       : 'Spark',
    rarity     : 'common',
    nexusSlots : 0,
    // ##
    //  #  (L corner)
    cells      : [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  },
  {
    id         : 'P02',
    name       : 'Bolt',
    rarity     : 'common',
    nexusSlots : 0,
    // #
    //  #
    //  #  (staircase right)
    cells      : [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  },
  {
    id         : 'P03',
    name       : 'Anvil',
    rarity     : 'common',
    nexusSlots : 1,
    //  #
    // ###  (T-shape)
    cells      : [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  },
  {
    id         : 'P04',
    name       : 'Fang',
    rarity     : 'common',
    nexusSlots : 1,
    // #
    // ##
    //  #  (S/Z pair)
    cells      : [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  },
  {
    id         : 'P05',
    name       : 'Crown',
    rarity     : 'uncommon',
    nexusSlots : 1,
    // # #
    // ###  (three-pointed crown)
    cells      : [
      { x: 0, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    ],
  },
  {
    id         : 'P06',
    name       : 'Helix',
    rarity     : 'uncommon',
    nexusSlots : 2,
    // ##
    //  #
    //  ##  (S-extension / spiral)
    cells      : [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 },
    ],
  },
  {
    id         : 'P07',
    name       : 'Bastion',
    rarity     : 'uncommon',
    nexusSlots : 1,
    //  #
    // ###
    //  #   (plus / cross)
    cells      : [
      { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
      { x: 1, y: 2 },
    ],
  },
  {
    id         : 'P08',
    name       : 'Talon',
    rarity     : 'common',
    nexusSlots : 1,
    // ###
    //   #  (hook)
    cells      : [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 },
    ],
  },
  {
    id         : 'P09',
    name       : 'Monolith',
    rarity     : 'rare',
    nexusSlots : 2,
    // #
    // #
    // #
    // #
    // #   (1×5 vertical bar)
    cells      : [
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 },
      { x: 0, y: 3 }, { x: 0, y: 4 },
    ],
  },
  {
    id         : 'P10',
    name       : 'Arch',
    rarity     : 'rare',
    nexusSlots : 2,
    // # #
    // # #
    // ###  (U / horseshoe — 5 filled cells in U outline)
    cells      : [
      { x: 0, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ],
  },
  {
    id         : 'P11',
    name       : 'Wraith',
    rarity     : 'rare',
    nexusSlots : 2,
    // ##
    //  #
    //  ##
    //   #  (large Z-extension)
    cells      : [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 },
      { x: 2, y: 3 },
    ],
  },
  {
    id         : 'P12',
    name       : 'Nexus Core',
    rarity     : 'rare',
    nexusSlots : 4,
    // ##
    // ##  (2×2 all-nexus square — ultimate chain catalyst)
    cells      : [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ],
    // All cells always get LINKED flags regardless of nexusSlots sampling
    allNexus   : true,
  },
];

// ── Seeded PRNG (xorshift32) ───────────────────────────────────────────────────
// Pure function — no state mutation, returns [value, nextSeed].

/**
 * One step of the xorshift32 PRNG.
 * Returns { value: [0,1), nextSeed }.
 * @param {number} seed  32-bit integer seed
 * @returns {{ value: number, nextSeed: number }}
 */
function xorshift32(seed) {
  let s = seed | 0;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return { value: (s >>> 0) / 0x100000000, nextSeed: s };
}

// ── PieceFactory Class ────────────────────────────────────────────────────────

class PieceFactory {
  /**
   * @param {object} [options]
   * @param {number}  [options.seed=Date.now()]
   *   Seed for the PRNG. Use a fixed seed for deterministic daily challenges.
   * @param {string[]} [options.enabledIds]
   *   Optional subset of piece IDs to include in the bag.
   *   Default: all 12 pieces.
   * @param {number}   [options.difficultyTier=0]
   *   0 = simple shapes only (P01-P04), 1 = adds medium, 2 = full pool.
   *   Used by Classic Endless' difficulty curve.
   */
  constructor(options = {}) {
    this._seed        = options.seed   ?? Date.now();
    this._diffTier    = options.difficultyTier ?? 2;
    this._enabledIds  = options.enabledIds ?? null;

    /** @private Current shuffle bag. Refilled when empty. */
    this._bag = [];

    /** @private Index into the current bag. */
    this._bagIndex = 0;

    /** @private History of the last N pieces for UI display. */
    this._history = [];

    // Pre-fill the first bag so the first call to next() is instant
    this._refillBag();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the next piece from the bag.
   * Automatically reshuffles and refills when the bag is exhausted.
   *
   * The returned object is a lightweight descriptor — cells are a fresh copy
   * so the caller may mutate them without affecting the factory definitions.
   *
   * @returns {{
   *   id         : string,
   *   name       : string,
   *   rarity     : string,
   *   cells      : Array<{x:number, y:number}>,
   *   rotation   : number,       // 0 | 90 | 180 | 270
   *   colorIndex : number,       // 1–8 maps to nexus_visuals.css piece palette
   *   nexusFlags : boolean[],    // per-cell LINKED flag (same length as cells)
   * }}
   */
  next() {
    if (this._bagIndex >= this._bag.length) this._refillBag();

    const def = this._bag[this._bagIndex++];
    const rot = 0; // Default rotation; caller may rotate with PieceFactory.rotate()

    const cells     = def.cells.map(c => ({ ...c })); // fresh copy
    const colorIndex = this._pickColor(def);
    const nexusFlags = this._assignNexusFlags(def, cells);

    const piece = { id: def.id, name: def.name, rarity: def.rarity, cells, rotation: rot, colorIndex, nexusFlags };
    this._history.unshift(piece);
    if (this._history.length > 20) this._history.pop();

    return piece;
  }

  /**
   * Returns an array of `count` pieces — used to pre-generate the tray of 3.
   * @param {number} [count=3]
   * @returns {Array}
   */
  nextBatch(count = 3) {
    return Array.from({ length: count }, () => this.next());
  }

  /**
   * Returns the last N pieces dealt (most recent first).
   * Useful for the preview tray UI.
   * @param {number} [n=6]
   * @returns {Array}
   */
  getHistory(n = 6) {
    return this._history.slice(0, n);
  }

  /**
   * Resets the factory with a new seed.
   * @param {number} [seed=Date.now()]
   */
  reseed(seed = Date.now()) {
    this._seed     = seed;
    this._bag      = [];
    this._bagIndex = 0;
    this._history  = [];
    this._refillBag();
  }

  /**
   * Upgrades the difficulty tier, expanding the active piece pool.
   * @param {number} tier  0 = basic, 1 = medium, 2 = full
   */
  setDifficultyTier(tier) {
    this._diffTier = Math.max(0, Math.min(2, tier));
    // Force a bag refill with the new pool next time next() is called
    this._bagIndex = this._bag.length;
  }

  // ── Static Utilities ───────────────────────────────────────────────────────

  /**
   * Rotates an array of {x, y} cell offsets by `steps` × 90° clockwise.
   *
   * Algorithm:
   *   One 90° CW step:  (x, y) → (−y, x)
   *   After rotation, normalise so the minimum x and y are both 0
   *   (shifts bounding box back to the top-left origin).
   *
   * @param {Array<{x:number, y:number}>} cells  Source cell offsets
   * @param {number} [steps=1]   Number of 90° CW steps (1–3)
   * @returns {Array<{x:number, y:number}>}  New rotated cell array
   */
  static rotate(cells, steps = 1) {
    const n = ((steps % 4) + 4) % 4; // normalise to 0-3
    let current = cells.map(c => ({ ...c }));

    for (let s = 0; s < n; s++) {
      // 90° CW: (x, y) → (−y, x)
      current = current.map(({ x, y }) => ({ x: -y, y: x }));

      // Normalise: shift so min(x) = 0, min(y) = 0
      const minX = Math.min(...current.map(c => c.x));
      const minY = Math.min(...current.map(c => c.y));
      current = current.map(c => ({ x: c.x - minX, y: c.y - minY }));
    }

    return current;
  }

  /**
   * Returns all 4 rotations (0°, 90°, 180°, 270°) for a cell array.
   * Deduplicates rotations that are identical (e.g. the 2×2 square).
   *
   * @param {Array<{x:number, y:number}>} cells
   * @returns {Array<Array<{x:number, y:number}>>}  Array of 1–4 unique rotations
   */
  static allRotations(cells) {
    const rotations = [];
    const seen      = new Set();

    for (let steps = 0; steps < 4; steps++) {
      const rotated = PieceFactory.rotate(cells, steps);
      const key     = rotated.map(c => `${c.x},${c.y}`).sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        rotations.push(rotated);
      }
    }

    return rotations;
  }

  /**
   * Returns the bounding box dimensions for a cell array.
   * @param {Array<{x:number, y:number}>} cells
   * @returns {{ w: number, h: number }}
   */
  static boundingBox(cells) {
    const maxX = Math.max(...cells.map(c => c.x));
    const maxY = Math.max(...cells.map(c => c.y));
    return { w: maxX + 1, h: maxY + 1 };
  }

  /**
   * Looks up a piece definition by its ID string.
   * @param {string} id  e.g. 'P07'
   * @returns {object | undefined}
   */
  static getDefinition(id) {
    return PIECE_DEFS.find(d => d.id === id);
  }

  /** Exposes the raw piece definitions array for external tooling. */
  static get DEFINITIONS() {
    return PIECE_DEFS;
  }

  // ── Private Methods ────────────────────────────────────────────────────────

  /**
   * Builds the filtered piece pool for the current difficulty tier,
   * shuffles it using the seeded PRNG, and replaces the internal bag.
   * @private
   */
  _refillBag() {
    // Build pool based on difficulty tier
    let pool;

    if (this._enabledIds) {
      pool = PIECE_DEFS.filter(d => this._enabledIds.includes(d.id));
    } else if (this._diffTier === 0) {
      // Basic: common pieces only (P01–P04, P08)
      pool = PIECE_DEFS.filter(d => d.rarity === 'common');
    } else if (this._diffTier === 1) {
      // Medium: common + uncommon
      pool = PIECE_DEFS.filter(d => d.rarity !== 'rare');
    } else {
      // Full: all 12 pieces
      pool = PIECE_DEFS.slice();
    }

    this._bag      = this._shuffle(pool);
    this._bagIndex = 0;
  }

  /**
   * Fisher-Yates shuffle using the seeded PRNG.
   * Updates this._seed as a side effect.
   * @private
   * @param {any[]} arr
   * @returns {any[]}  Shuffled copy (original untouched)
   */
  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const { value, nextSeed } = xorshift32(this._seed);
      this._seed = nextSeed;
      const j = Math.floor(value * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Picks a pseudo-random color index (1–8) for this piece instance.
   * Uses the seeded PRNG so color assignments are reproducible.
   * @private
   * @param {object} _def  Piece definition (unused currently, reserved for rarity weighting)
   * @returns {number}  1–8
   */
  _pickColor(_def) {
    const { value, nextSeed } = xorshift32(this._seed);
    this._seed = nextSeed;
    return (Math.floor(value * 8) % 8) + 1;
  }

  /**
   * Determines which cells of this piece instance receive the LINKED flag.
   * - allNexus pieces (P12 Nexus Core): every cell is flagged.
   * - Other pieces: `nexusSlots` cells are chosen randomly.
   *
   * @private
   * @param {object} def    Piece definition
   * @param {Array}  cells  Cell array (same length)
   * @returns {boolean[]}   Per-cell linked flags
   */
  _assignNexusFlags(def, cells) {
    const flags = new Array(cells.length).fill(false);

    if (def.allNexus) {
      flags.fill(true);
      return flags;
    }

    if (!def.nexusSlots || def.nexusSlots <= 0) return flags;

    // Pick `nexusSlots` unique random indices
    const indices = cells.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const { value, nextSeed } = xorshift32(this._seed);
      this._seed = nextSeed;
      const j = Math.floor(value * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let k = 0; k < Math.min(def.nexusSlots, indices.length); k++) {
      flags[indices[k]] = true;
    }

    return flags;
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { PieceFactory, PIECE_DEFS, xorshift32 };
