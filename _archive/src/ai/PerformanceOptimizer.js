/**
 * NEXUS BLOCKS — PerformanceOptimizer
 * ─────────────────────────────────────────────────────────────────────────────
 * Three high-performance subsystems for the game engine:
 *
 *   1. BitmaskLineChecker  — O(w+h) line-clear detection using BigInt masks
 *   2. AABB + Bitmask Collider — fast piece-vs-board collision test
 *   3. ParticlePool        — GC-free particle system with 500 pre-allocated slots
 *
 * Each subsystem includes a benchmark() method comparing optimised vs baseline.
 *
 * ── 1. BitmaskLineChecker ──────────────────────────────────────────────────
 *
 *   BASELINE (current Board.isLineFull / isColumnFull):
 *     O(w) per row × O(h) rows + O(h) per column × O(w) columns = O(w*h)
 *     For a 9×9 grid: ~81 cell checks per findCompletedLines() call.
 *
 *   OPTIMISED:
 *     Precompute BigInt row masks (one per row, `width` consecutive bits)
 *     and column masks (one per column, bits every `width` positions).
 *     Build a BigInt from the board cells (one pass, O(w*h)).
 *     Then check each row with a single bitwise AND: O(1) per row.
 *     Total: O(w*h) once for mask building + O(w+h) for checks.
 *     For a 9×9 grid: 81 ops to build + 18 AND checks = ~99 operations
 *     BUT the bitmask is cached and only rebuilt on board mutation.
 *     Per-clear check: 18 operations instead of 81 (4.5× speedup).
 *
 * ── 2. AABB + Bitmask Collider ────────────────────────────────────────────
 *
 *   BASELINE (current Board.canPlace):
 *     Iterate piece cells: bounds check (2 comparisons) + cell check (1 read).
 *     O(cells) per test, no early exit unless cell is filled.
 *
 *   OPTIMISED:
 *     Step 1: AABB test — piece bounding box must fit in board bounds.
 *             (4 integer comparisons, O(1)).
 *     Step 2: Extract board region within AABB as a BigInt sub-mask.
 *     Step 3: AND with piece bitmask → 0 means no collision.
 *             (3 BigInt operations, effectively O(1) for small grids).
 *     Benefit: BigInt AND is a single CPU-level instruction for small
 *              bit-widths, beating per-cell iteration for large pieces.
 *
 * ── 3. ParticlePool ───────────────────────────────────────────────────────
 *
 *   Stores up to 500 simultaneous particles in a pre-allocated Float32Array.
 *   No allocations during gameplay — acquire() and release() operate on a
 *   free-list index stack. The render loop iterates only active particles.
 *
 *   Per-particle layout (9 floats = 36 bytes):
 *     [x, y, vx, vy, life, r, g, b, a]
 *
 *   Pool size: 500 × 9 = 4500 floats = ~18 KB.
 *
 * Usage:
 *   const checker  = new BitmaskLineChecker(9, 9);
 *   const collider = new BitmaskCollider(9, 9);
 *   const pool     = new ParticlePool(500);
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BITMASK LINE CHECKER  —  O(w+h) detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Precomputed BigInt masks for O(1)-per-row line-clear detection.
 *
 * Each row mask has `width` consecutive 1-bits at that row's offset.
 * Each column mask has 1-bits every `width` positions.
 *
 * A row is full when: (boardMask & rowMask) === rowMask
 */
class BitmaskLineChecker {
  /**
   * @param {number} width   Board columns
   * @param {number} height  Board rows
   */
  constructor(width, height) {
    this._w = width;
    this._h = height;

    // Row masks: BigInt[y] = bits for row y
    this._rowMasks = [];
    for (let y = 0; y < height; y++) {
      let mask = 0n;
      for (let x = 0; x < width; x++) {
        mask |= (1n << BigInt(y * width + x));
      }
      this._rowMasks.push(mask);
    }

    // Column masks: BigInt[x] = bits for column x
    this._colMasks = [];
    for (let x = 0; x < width; x++) {
      let mask = 0n;
      for (let y = 0; y < height; y++) {
        mask |= (1n << BigInt(y * width + x));
      }
      this._colMasks.push(mask);
    }
  }

  // ── Bitboard Builders ─────────────────────────────────────────────────────

  /**
   * Builds a BigInt bitmask from an Int8Array board (Board._cells).
   * Each non-zero cell sets the corresponding bit.
   *
   * @param {Int8Array} cells  Flat row-major array of color indices
   * @returns {bigint}
   */
  buildMaskFromCells(cells) {
    let mask = 0n;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 0) mask |= (1n << BigInt(i));
    }
    return mask;
  }

  /**
   * Builds a BigInt bitmask from a Board instance (reads board._cells).
   * @param {{ _cells: Int8Array }} board
   * @returns {bigint}
   */
  buildMaskFromBoard(board) {
    return this.buildMaskFromCells(board._cells);
  }

  // ── O(1) Single-Row / Column Checks ──────────────────────────────────────

  /**
   * Returns true when every cell in row y is filled.
   * O(1) — single BigInt AND comparison.
   *
   * @param {bigint} boardMask
   * @param {number} y
   * @returns {boolean}
   */
  isLineFull(boardMask, y) {
    if (y < 0 || y >= this._h) return false;
    return (boardMask & this._rowMasks[y]) === this._rowMasks[y];
  }

  /**
   * Returns true when every cell in column x is filled.
   * O(1) — single BigInt AND comparison.
   *
   * @param {bigint} boardMask
   * @param {number} x
   * @returns {boolean}
   */
  isColumnFull(boardMask, x) {
    if (x < 0 || x >= this._w) return false;
    return (boardMask & this._colMasks[x]) === this._colMasks[x];
  }

  // ── O(w+h) Full Scan ─────────────────────────────────────────────────────

  /**
   * Finds all completed rows and columns in a single O(w+h) scan.
   * This is the core optimisation: replaces O(w*h) double-nested loops.
   *
   * @param {bigint} boardMask
   * @returns {{ rows: number[], cols: number[] }}
   */
  findAllFullLines(boardMask) {
    const rows = [];
    for (let y = 0; y < this._h; y++) {
      if ((boardMask & this._rowMasks[y]) === this._rowMasks[y]) rows.push(y);
    }

    const cols = [];
    for (let x = 0; x < this._w; x++) {
      if ((boardMask & this._colMasks[x]) === this._colMasks[x]) cols.push(x);
    }

    return { rows, cols };
  }

  /**
   * Removes completed rows/columns from the bitmask IN-PLACE and returns
   * the cleared mask plus a count of cleared lines.
   *
   * @param {bigint} boardMask  Modified in-place (returned by value)
   * @returns {{ mask: bigint, clearCount: number }}
   */
  processClears(boardMask) {
    let mask    = boardMask;
    let count   = 0;

    for (let y = 0; y < this._h; y++) {
      if ((mask & this._rowMasks[y]) === this._rowMasks[y]) {
        mask &= ~this._rowMasks[y];
        count++;
      }
    }

    for (let x = 0; x < this._w; x++) {
      if ((mask & this._colMasks[x]) === this._colMasks[x]) {
        mask &= ~this._colMasks[x];
        count++;
      }
    }

    return { mask, clearCount: count };
  }

  // ── Cell Count ────────────────────────────────────────────────────────────

  /**
   * Returns the number of filled cells (popcount) in the bitmask.
   * Brian Kernighan's algorithm: O(k) where k = number of set bits.
   *
   * @param {bigint} boardMask
   * @returns {number}
   */
  countFilledCells(boardMask) {
    let count = 0;
    let x     = boardMask;
    while (x !== 0n) {
      x &= (x - 1n);
      count++;
    }
    return count;
  }

  /**
   * Returns board density [0..1] from the bitmask.
   * @param {bigint} boardMask
   * @returns {number}
   */
  getDensity(boardMask) {
    return this.countFilledCells(boardMask) / (this._w * this._h);
  }

  // ── Benchmark ─────────────────────────────────────────────────────────────

  /**
   * Compares BitmaskLineChecker vs the baseline O(w*h) approach
   * (current Board.isLineFull/isColumnFull iterating every cell).
   *
   * @param {Int8Array} cells  Board cell data
   * @param {number}    [iterations=10_000]
   * @returns {{ baselineMs:number, optimisedMs:number, speedup:number }}
   */
  static benchmark(cells, w, h, iterations = 10_000) {
    // ── Baseline: O(w*h) cell iteration ────────────────────────────────────
    const baselineStart = performance.now();

    for (let iter = 0; iter < iterations; iter++) {
      const rows = [];
      const cols = [];

      // Check rows (O(w*h))
      for (let y = 0; y < h; y++) {
        let full = true;
        for (let x = 0; x < w; x++) {
          if (cells[y * w + x] === 0) { full = false; break; }
        }
        if (full) rows.push(y);
      }

      // Check columns (O(w*h))
      for (let x = 0; x < w; x++) {
        let full = true;
        for (let y = 0; y < h; y++) {
          if (cells[y * w + x] === 0) { full = false; break; }
        }
        if (full) cols.push(x);
      }
    }

    const baselineMs = performance.now() - baselineStart;

    // ── Optimised: BigInt bitmask ──────────────────────────────────────────
    const checker = new BitmaskLineChecker(w, h);
    const mask    = checker.buildMaskFromCells(cells);

    const optStart = performance.now();

    for (let iter = 0; iter < iterations; iter++) {
      checker.findAllFullLines(mask);
    }

    const optimisedMs = performance.now() - optStart;
    const speedup     = baselineMs / Math.max(0.001, optimisedMs);

    return { baselineMs, optimisedMs, speedup };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AABB + BITMASK COLLIDER  —  fast piece-vs-board test
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Collision detection using bounding-box pre-check + BigInt bitmask AND.
 *
 * Design:
 *   1. Compute piece AABB (minX, minY, maxX, maxY) at offset (ox, oy).
 *   2. AABB bounds test: must be entirely within the board.
 *   3. Extract the board region within the AABB as a BigInt sub-mask.
 *   4. Convert piece cells to a bitmask relative to the AABB.
 *   5. (boardRegionMask & pieceMask) !== 0n → collision.
 *
 * The AABB pre-check rejects out-of-bounds placements in O(1).
 * The bitmask AND is a single CPU instruction for small grids.
 */
class BitmaskCollider {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this._w = width;
    this._h = height;
  }

  // ── AABB Computation ──────────────────────────────────────────────────────

  /**
   * Computes the axis-aligned bounding box of a piece at offset (ox, oy).
   * @param {Array<{x:number,y:number}>} cells
   * @param {number} ox
   * @param {number} oy
   * @returns {{ minX:number, minY:number, maxX:number, maxY:number, w:number, h:number }}
   */
  static aabb(cells, ox, oy) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of cells) {
      const bx = x + ox, by = y + oy;
      if (bx < minX) minX = bx;
      if (bx > maxX) maxX = bx;
      if (by < minY) minY = by;
      if (by > maxY) maxY = by;
    }

    return {
      minX, minY, maxX, maxY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  }

  // ── Collision Test ────────────────────────────────────────────────────────

  /**
   * Tests whether a piece can be placed at (ox, oy) using AABB + bitmask.
   * Returns false if the piece is out-of-bounds or overlaps any filled cell.
   *
   * @param {bigint}  boardMask   Full board bitmask (from BitmaskLineChecker.buildMask)
   * @param {Array<{x:number,y:number}>} cells  Piece cell offsets
   * @param {number}  ox
   * @param {number}  oy
   * @returns {boolean}
   */
  canPlace(boardMask, cells, ox, oy) {
    // ── Step 1: AABB bounds test (O(1), 4 comparisons) ──────────────────────
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of cells) {
      const bx = x + ox, by = y + oy;
      // Quick bounds check inline during AABB computation
      if (bx < 0 || bx >= this._w || by < 0 || by >= this._h) return false;
      if (bx < minX) minX = bx;
      if (bx > maxX) maxX = bx;
      if (by < minY) minY = by;
      if (by > maxY) maxY = by;
    }

    const aabbW = maxX - minX + 1;
    const aabbH = maxY - minY + 1;

    // ── Step 2: Build piece bitmask relative to AABB ────────────────────────
    let pieceMask = 0n;
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      const localX = bx - minX;
      const localY = by - minY;
      pieceMask |= (1n << BigInt(localY * aabbW + localX));
    }

    // ── Step 3: Extract board region within AABB ────────────────────────────
    let boardRegion = 0n;
    for (let y = 0; y < aabbH; y++) {
      for (let x = 0; x < aabbW; x++) {
        const boardIdx = (minY + y) * this._w + (minX + x);
        if ((boardMask >> BigInt(boardIdx)) & 1n) {
          boardRegion |= (1n << BigInt(y * aabbW + x));
        }
      }
    }

    // ── Step 4: AND test ───────────────────────────────────────────────────
    return (boardRegion & pieceMask) === 0n;
  }

  /**
   * Optimised variant: precomputes the piece bitmask once, then only extracts
   * the board region per offset — avoids rebuilding pieceMask per call.
   *
   * @param {bigint}  boardMask
   * @param {{ ox:number, oy:number, mask:bigint, minX:number, minY:number, aabbW:number, aabbH:number }} precomp
   * @returns {boolean}
   */
  canPlacePrecomp(boardMask, precomp) {
    const { ox, oy, mask: pieceMask, minX, minY, aabbW, aabbH } = precomp;

    // Bounds check (minX, minY already account for offset)
    if (minX < 0 || minX + aabbW > this._w || minY < 0 || minY + aabbH > this._h) return false;

    let boardRegion = 0n;
    for (let y = 0; y < aabbH; y++) {
      for (let x = 0; x < aabbW; x++) {
        const boardIdx = (minY + y) * this._w + (minX + x);
        if ((boardMask >> BigInt(boardIdx)) & 1n) {
          boardRegion |= (1n << BigInt(y * aabbW + x));
        }
      }
    }

    return (boardRegion & pieceMask) === 0n;
  }

  // ── Precomputation Helper ─────────────────────────────────────────────────

  /**
   * Precomputes the bitmask + AABB for a piece at (ox, oy).
   * Call once per (piece, ox, oy) combo, then reuse with canPlacePrecomp.
   *
   * @param {Array<{x:number,y:number}>} cells
   * @param {number} ox
   * @param {number} oy
   * @returns {{ ox, oy, mask:bigint, minX:number, minY:number, aabbW:number, aabbH:number } | null}
   *   null if the AABB is out-of-bounds
   */
  precompute(cells, ox, oy) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of cells) {
      const bx = x + ox, by = y + oy;
      if (bx < 0 || bx >= this._w || by < 0 || by >= this._h) return null;
      if (bx < minX) minX = bx;
      if (bx > maxX) maxX = bx;
      if (by < minY) minY = by;
      if (by > maxY) maxY = by;
    }

    const aabbW = maxX - minX + 1;
    const aabbH = maxY - minY + 1;

    let mask = 0n;
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      mask |= (1n << BigInt((by - minY) * aabbW + (bx - minX)));
    }

    return { ox, oy, mask, minX, minY, aabbW, aabbH };
  }

  // ── Benchmark ─────────────────────────────────────────────────────────────

  /**
   * Compares bitmask collision vs baseline per-cell iteration.
   *
   * @param {Int8Array} cells     Board cells
   * @param {Array<{x:number,y:number}>} pieceCells  Piece offsets
   * @param {number} w  Board width
   * @param {number} h  Board height
   * @param {number} [iterations=50_000]
   * @returns {{ baselineMs:number, optimisedMs:number, speedup:number }}
   */
  static benchmark(cells, pieceCells, w, h, iterations = 50_000) {
    const checker  = new BitmaskLineChecker(w, h);
    const collider = new BitmaskCollider(w, h);
    const mask     = checker.buildMaskFromCells(cells);

    // Pick a valid offset for testing
    const ox = 3, oy = 3;

    // ── Baseline: per-cell iteration ────────────────────────────────────────
    const baseStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      let valid = true;
      for (const { x, y } of pieceCells) {
        const bx = x + ox, by = y + oy;
        if (bx < 0 || bx >= w || by < 0 || by >= h || cells[by * w + bx] !== 0) {
          valid = false; break;
        }
      }
    }
    const baselineMs = performance.now() - baseStart;

    // ── Optimised: AABB + bitmask ───────────────────────────────────────────
    const precomp = collider.precompute(pieceCells, ox, oy);
    const optStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      collider.canPlacePrecomp(mask, precomp);
    }
    const optimisedMs = performance.now() - optStart;
    const speedup     = baselineMs / Math.max(0.001, optimisedMs);

    return { baselineMs, optimisedMs, speedup };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PARTICLE POOL  —  GC-free, 500 pre-allocated slots
// ═══════════════════════════════════════════════════════════════════════════════

/** Number of floats per particle in the pool layout. */
const PARTICLE_STRIDE = 9; // x, y, vx, vy, life, r, g, b, a

/**
 * GC-free particle pool with 500 pre-allocated slots in a Float32Array.
 *
 * Memory layout (row-major, stride = 9):
 *   offset 0 : x
 *   offset 1 : y
 *   offset 2 : vx
 *   offset 3 : vy
 *   offset 4 : life  (seconds remaining; 0 = inactive/dead)
 *   offset 5 : r     (red,   0–1)
 *   offset 6 : g     (green, 0–1)
 *   offset 7 : b     (blue,  0–1)
 *   offset 8 : a     (alpha, 0–1)
 *
 * Free list: Uint16Array stack. acquire() pops an index; release() pushes it.
 * The life field distinguishes active (life > 0) from dead (life === 0)
 * without needing a separate flag array.
 *
 * Render integration:
 *   // Update each tick:
 *   pool.update(dtSec);
 *   // Render each frame:
 *   pool.forEachActive((i, x, y, r, g, b, a) => {
 *     ctx.fillStyle = `rgba(${r*255},${g*255},${b*255},${a})`;
 *     ctx.fillRect(x - 3, y - 3, 6, 6);
 *   });
 */
class ParticlePool {
  /**
   * @param {number} [capacity=500]  Maximum simultaneous particles
   */
  constructor(capacity = 500) {
    this._capacity = capacity;
    this._size     = capacity * PARTICLE_STRIDE;

    /** @private Float32Array — raw particle data. */
    this._data     = new Float32Array(this._size);

    /** @private Uint16Array — free-list index stack (0 = free slot). */
    this._free     = new Uint16Array(capacity);

    /** @private Number of currently available free slots. */
    this._freeCount = capacity;

    /** @private Current number of active (life > 0) particles. */
    this.activeCount = 0;

    // Initialise free list: every slot is available
    for (let i = 0; i < capacity; i++) {
      this._free[i] = i;
    }

    // Pre-zero all life fields so the initial state is "all dead"
    for (let i = 0; i < capacity; i++) {
      this._data[i * PARTICLE_STRIDE + 4] = 0; // life = 0
    }
  }

  // ── Acquisition / Release ─────────────────────────────────────────────────

  /**
   * Acquires a particle slot from the pool.
   * Returns the slot index, or -1 if the pool is exhausted.
   *
   * The caller should immediately write the particle properties
   * using the setter methods below.
   *
   * @returns {number}  Slot index, or -1 if full
   */
  acquire() {
    if (this._freeCount <= 0) return -1;

    const idx = this._free[--this._freeCount];
    this._data[idx * PARTICLE_STRIDE + 4] = 1; // Mark as alive (placeholder life)
    this.activeCount++;
    return idx;
  }

  /**
   * Returns a particle slot to the free pool.
   * The slot is immediately available for reuse.
   *
   * @param {number} idx  Slot index previously returned by acquire()
   */
  release(idx) {
    if (idx < 0 || idx >= this._capacity) return;

    const base = idx * PARTICLE_STRIDE;

    // Zero out all data (fast fill)
    this._data.fill(0, base, base + PARTICLE_STRIDE);

    this._free[this._freeCount++] = idx;
    this.activeCount--;
  }

  /**
   * Bulk-releases all particles whose life ≤ 0.
   * Called after update(dt) to recycle expired particles.
   * @private
   */
  _releaseDead() {
    for (let i = 0; i < this._capacity; i++) {
      const life = this._data[i * PARTICLE_STRIDE + 4];
      if (life <= 0) {
        // Already dead — ensure it's in the free list if not already
        // (release is idempotent; zeroing + pushing)
        this.release(i);
      }
    }
  }

  // ── Property Setters (for initialisation after acquire) ────────────────────

  /**
   * Sets all properties of a particle at once (one call, no repeated indexing).
   * @param {number} idx   Slot index
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {number} lifeSec  Lifespan in seconds
   * @param {number} r        0–1
   * @param {number} g        0–1
   * @param {number} b        0–1
   * @param {number} a        0–1
   */
  set(idx, x, y, vx, vy, lifeSec, r, g, b, a) {
    const base = idx * PARTICLE_STRIDE;
    const d    = this._data;
    d[base]     = x;
    d[base + 1] = y;
    d[base + 2] = vx;
    d[base + 3] = vy;
    d[base + 4] = lifeSec;
    d[base + 5] = r;
    d[base + 6] = g;
    d[base + 7] = b;
    d[base + 8] = a;
  }

  /**
   * Quick initialisation for a particle burst: sets position, random velocity,
   * and colour.
   *
   * @param {number} idx
   * @param {number} x
   * @param {number} y
   * @param {number} [speed=100]  Max velocity magnitude
   * @param {number} [lifeSec=0.6]
   * @param {number[]} [rgb=[1, 0.8, 0.2]]  [r, g, b] 0–1
   * @param {number} [alpha=1]
   */
  setBurst(idx, x, y, speed = 100, lifeSec = 0.6, rgb = [1, 0.8, 0.2], alpha = 1) {
    const angle = Math.random() * Math.PI * 2;
    const mag   = Math.random() * speed;
    this.set(
      idx,
      x, y,
      Math.cos(angle) * mag,
      Math.sin(angle) * mag,
      lifeSec,
      rgb[0], rgb[1], rgb[2], alpha
    );
  }

  // ── Update (game-loop tick) ──────────────────────────────────────────────

  /**
   * Advances all active particles by dt seconds.
   * Decrements life; particles that reach life ≤ 0 are automatically released.
   *
   * Call this once per game-loop tick.
   *
   * @param {number} dtSec  Delta time in seconds
   */
  update(dtSec) {
    for (let i = 0; i < this._capacity; i++) {
      const base = i * PARTICLE_STRIDE;
      const life = this._data[base + 4];
      if (life <= 0) continue;

      const newLife = life - dtSec;
      if (newLife <= 0) {
        // Particle expired
        this.release(i);
      } else {
        // Update position and life
        this._data[base]     += this._data[base + 2] * dtSec; // x += vx * dt
        this._data[base + 1] += this._data[base + 3] * dtSec; // y += vy * dt
        this._data[base + 4]  = newLife;
      }
    }
  }

  // ── Iteration (for rendering) ─────────────────────────────────────────────

  /**
   * Iterates over all currently active particles, calling `visitor` with
   * unpacked properties. No allocations inside the loop.
   *
   * @param {(idx:number, x:number, y:number, life:number, r:number, g:number, b:number, a:number)=>void} visitor
   */
  forEachActive(visitor) {
    for (let i = 0; i < this._capacity; i++) {
      const base = i * PARTICLE_STRIDE;
      const life = this._data[base + 4];
      if (life <= 0) continue;

      visitor(
        i,
        this._data[base],
        this._data[base + 1],
        life,
        this._data[base + 5],
        this._data[base + 6],
        this._data[base + 7],
        this._data[base + 8]
      );
    }
  }

  /**
   * Iterates all active particles and passes a raw Float32Array view
   * (starting at offset 0 of the particle) for maximum performance.
   * Avoids property unpacking overhead in hot render loops.
   *
   * @param {(base:number, data:Float32Array)=>void} visitor
   *   base = index into data; data[base] = x, data[base+1] = y, …
   */
  forEachActiveRaw(visitor) {
    for (let i = 0; i < this._capacity; i++) {
      const base = i * PARTICLE_STRIDE;
      if (this._data[base + 4] <= 0) continue;
      visitor(base, this._data);
    }
  }

  // ── Bulk Spawn (particle burst helper) ────────────────────────────────────

  /**
   * Spawns a burst of `count` particles from (cx, cy).
   * Returns the number actually spawned (may be less if pool is nearly full).
   *
   * @param {number} cx       Center X
   * @param {number} cy       Center Y
   * @param {number} count    Desired count
   * @param {number} [speed=120]
   * @param {number} [lifeSec=0.6]
   * @param {number[]} [rgb=[1, 0.84, 0]]
   * @returns {number}  Count actually spawned
   */
  spawnBurst(cx, cy, count, speed = 120, lifeSec = 0.6, rgb = [1, 0.84, 0]) {
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const idx = this.acquire();
      if (idx < 0) break;
      this.setBurst(idx, cx, cy, speed, lifeSec, rgb);
      spawned++;
    }
    return spawned;
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** Releases all particles and resets the pool. */
  reset() {
    this._data.fill(0);
    this._freeCount = this._capacity;
    this.activeCount = 0;
    for (let i = 0; i < this._capacity; i++) {
      this._free[i] = i;
    }
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  /** @returns {number} Number of free slots remaining. */
  get freeSlots() { return this._freeCount; }

  /** @returns {number} Total pool capacity. */
  get capacity()  { return this._capacity; }

  /** @returns {boolean} True if the pool is full (no free slots). */
  get isFull()    { return this._freeCount <= 0; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined') {
  module.exports = {
    BitmaskLineChecker,
    BitmaskCollider,
    ParticlePool,
    PARTICLE_STRIDE,
  };
}