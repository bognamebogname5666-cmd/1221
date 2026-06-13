/**
 * NEXUS BLOCKS — Board Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the 2D grid state for the entire game.
 *
 * Design goals:
 *   • Typed arrays (Int8Array / Uint8Array) for cache-friendly cell access —
 *     avoids the cost of JS object/array-of-arrays heap allocations.
 *   • Clean public interface compatible with NexusVisualManager.js:
 *       board.width                   — grid columns
 *       board.height                  — grid rows
 *       board.getCell(x, y)           — color index (0 = empty)
 *       board.setCell(x, y, index)    — fill/clear a cell
 *       board.clearLine(y)            — clear a full row
 *   • Extended engine methods for all game mechanics:
 *       board.clearColumn(x)
 *       board.canPlace(cells, ox, oy)
 *       board.placePiece(cells, ox, oy, colorIndex, flags?)
 *       board.findCompletedLines()    → { rows, cols }
 *       board.processClears()         → { rows, cols, nexusDestroyed }
 *       board.applyGravity(direction) → boolean (any block moved)
 *       board.calculateGhost(cells, ox, oy, dir?) → { ox, oy } | null
 *       board.createNexusGroup(positions) → groupId
 *       board.resolveNexusLinks(placedCells)
 *       board.hasAnyValidPlacement(pieceCellSets) → boolean
 *       board.getDensity()            → [0..1]
 *       board.reset()
 *       board.serialize() / board.deserialize(data)
 *       board.toString()              — ASCII debug dump
 *
 * Cell value conventions:
 *   0         = empty cell
 *   1 – 8     = filled cell with piece color index (matches nexus_visuals.css)
 *
 * Cell flags (stored in a separate Uint8Array per cell):
 *   LINKED    0b0001  — cell belongs to a Nexus Link group
 *   FROZEN    0b0010  — cell cannot be destroyed (immune to clears)
 *   CRACKED   0b0100  — cell requires two hits to destroy
 *   SPECIAL   0b1000  — power-up / mission-critical cell
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Bit-flags for per-cell metadata stored in Board._flags.
 * Use Board.getFlag / Board.setFlag rather than reading the array directly.
 */
const CellFlag = Object.freeze({
  LINKED  : 0b0001,
  FROZEN  : 0b0010,
  CRACKED : 0b0100,
  SPECIAL : 0b1000,
});

/**
 * Gravity directions for the GRAVITY SHIFT mechanic.
 * Pass one of these to board.applyGravity().
 */
const GravityDir = Object.freeze({
  DOWN  : 'down',
  UP    : 'up',
  LEFT  : 'left',
  RIGHT : 'right',
});

// ── Board Class ───────────────────────────────────────────────────────────────

class Board {
  /**
   * @param {number}   width    Number of columns. Default 9 (Classic mode).
   * @param {number}   height   Number of rows.    Default 9 (Classic mode).
   * @param {EventBus} [eventBus]  Optional event bus; if omitted, events are silent.
   */
  constructor(width = 9, height = 9, eventBus = null) {
    this.width  = width;
    this.height = height;

    /** @private */ this._bus = eventBus;

    // ── Typed storage arrays ────────────────────────────────────────────────
    // Using Int8Array — values 0-8 fit in a signed byte, saving memory.
    /** Color index per cell. 0 = empty, 1-8 = piece palette. */
    this._cells = new Int8Array(width * height);

    /** CellFlag bitfield per cell. */
    this._flags = new Uint8Array(width * height);

    /**
     * Nexus group ID per cell. 0 = no group.
     * Stored as Int16Array supporting up to 32 767 distinct link groups
     * per game session without overflow.
     */
    this._nexusGroups = new Int16Array(width * height);

    /**
     * Tracks which cell indices belong to each nexus group.
     * Map<groupId (number), Set<cellIndex (number)>>
     */
    this._nexusGroupMap  = new Map();

    /** Auto-incrementing counter for new nexus group IDs. */
    this._nextGroupId    = 1;

    /**
     * Animation event queue consumed by the renderer each frame.
     * Entries: { type: string, ...payload }
     * @type {Array<{type:string}>}
     */
    this._animQueue = [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Converts (x, y) grid coordinates to a flat typed-array index.
   * Row-major layout: index = y * width + x.
   *
   * @param {number} x  Column (0 = leftmost)
   * @param {number} y  Row    (0 = topmost)
   * @returns {number}
   */
  _idx(x, y) {
    return y * this.width + x;
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────

  /**
   * Returns true when (x, y) is within the grid bounds.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  // ── Core Cell Interface (public API consumed by NexusVisualManager) ────────

  /**
   * Returns the color index stored at cell (x, y).
   * Returns 0 for out-of-bounds coordinates (treated as "empty").
   *
   * @param {number} x
   * @param {number} y
   * @returns {number}  0 = empty, 1–8 = piece color
   */
  getCell(x, y) {
    if (!this.inBounds(x, y)) return 0;
    return this._cells[this._idx(x, y)];
  }

  /**
   * Writes a color index to cell (x, y).
   * Passing colorIndex = 0 empties the cell and removes it from any nexus group.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} colorIndex  0 = empty, 1–8 = piece color
   * @param {number} [flags=0]   Initial CellFlag bitfield for this cell
   */
  setCell(x, y, colorIndex, flags = 0) {
    if (!this.inBounds(x, y)) return;
    const i = this._idx(x, y);

    this._cells[i] = colorIndex;
    this._flags[i] = flags;

    // If erasing a cell, clean up its nexus group membership
    if (colorIndex === 0) this._removeFromNexusGroup(i);
  }

  /**
   * Returns true when the cell at (x, y) is occupied (non-zero color).
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isFilled(x, y) {
    return this.getCell(x, y) !== 0;
  }

  /**
   * Returns true when the cell at (x, y) is empty.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isEmpty(x, y) {
    return this.getCell(x, y) === 0;
  }

  // ── Cell Flag Accessors ────────────────────────────────────────────────────

  /**
   * Tests whether a specific CellFlag bit is set on cell (x, y).
   * @param {number}  x
   * @param {number}  y
   * @param {number}  flag  — one of CellFlag.*
   * @returns {boolean}
   */
  getFlag(x, y, flag) {
    if (!this.inBounds(x, y)) return false;
    return (this._flags[this._idx(x, y)] & flag) !== 0;
  }

  /**
   * Sets or clears a CellFlag bit on cell (x, y).
   * @param {number}  x
   * @param {number}  y
   * @param {number}  flag  — one of CellFlag.*
   * @param {boolean} [on=true]
   */
  setFlag(x, y, flag, on = true) {
    if (!this.inBounds(x, y)) return;
    const i = this._idx(x, y);
    this._flags[i] = on
      ? (this._flags[i] |  flag)
      : (this._flags[i] & ~flag);
  }

  // ── Piece Placement ────────────────────────────────────────────────────────

  /**
   * Tests whether a piece (relative cell offsets) can be placed at board
   * position (ox, oy) without going out-of-bounds or overlapping filled cells.
   *
   * @param {Array<{x:number, y:number}>} cells   Piece cell offsets
   * @param {number} ox  Board column offset
   * @param {number} oy  Board row offset
   * @returns {boolean}
   */
  canPlace(cells, ox, oy) {
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      if (!this.inBounds(bx, by)) return false;
      if (this.isFilled(bx, by))  return false;
    }
    return true;
  }

  /**
   * Places a piece onto the board.
   * Does NOT validate placement first — call canPlace() before this.
   *
   * @param {Array<{x:number, y:number}>} cells  Piece cell offsets
   * @param {number} ox                           Board column offset
   * @param {number} oy                           Board row offset
   * @param {number} colorIndex                   1–8 piece color
   * @param {number} [flags=0]                    CellFlag bitfield
   * @returns {Array<{x:number, y:number}>}       Absolute board positions placed
   */
  placePiece(cells, ox, oy, colorIndex, flags = 0) {
    const placed = [];
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      this.setCell(bx, by, colorIndex, flags);
      placed.push({ x: bx, y: by });
    }
    this._bus?.emit('piece:placed', { cells: placed, colorIndex });
    return placed;
  }

  // ── Line / Column Inspection ───────────────────────────────────────────────

  /**
   * Returns true when every cell in row y is filled.
   * @param {number} y
   * @returns {boolean}
   */
  isLineFull(y) {
    if (y < 0 || y >= this.height) return false;
    for (let x = 0; x < this.width; x++) {
      if (this._cells[this._idx(x, y)] === 0) return false;
    }
    return true;
  }

  /**
   * Returns true when every cell in column x is filled.
   * @param {number} x
   * @returns {boolean}
   */
  isColumnFull(x) {
    if (x < 0 || x >= this.width) return false;
    for (let y = 0; y < this.height; y++) {
      if (this._cells[this._idx(x, y)] === 0) return false;
    }
    return true;
  }

  /**
   * Scans the board and returns the indices of all completed rows and columns.
   * Does not modify the board.
   *
   * @returns {{ rows: number[], cols: number[] }}
   */
  findCompletedLines() {
    const rows = [];
    const cols = [];
    for (let y = 0; y < this.height; y++) {
      if (this.isLineFull(y)) rows.push(y);
    }
    for (let x = 0; x < this.width; x++) {
      if (this.isColumnFull(x)) cols.push(x);
    }
    return { rows, cols };
  }

  // ── Line Clear (public interface consumed by NexusVisualManager) ───────────

  /**
   * Clears a horizontal row (y-index): sets all cells in the row to 0.
   *
   * In NEXUS BLOCKS (block-puzzle style), cleared lines are erased in-place —
   * unlike Tetris there is no downward shift of rows above the cleared line.
   * The Gravity Shift mechanic is handled separately via applyGravity().
   *
   * Emits 'line:cleared' event.
   * Pushes a { type: 'clearLine', y } entry to the animation queue.
   *
   * NexusVisualManager calls this method as the final step of
   * animateLineClear(), AFTER the CSS animation has finished.
   *
   * @param {number} y  Row index to clear (0 = top row)
   */
  clearLine(y) {
    if (y < 0 || y >= this.height) return;

    const nexusCells = this._collectNexusCellsInRow(y);

    for (let x = 0; x < this.width; x++) {
      const i = this._idx(x, y);
      this._cells[i] = 0;
      this._flags[i] = 0;
      this._removeFromNexusGroup(i);
    }

    this._animQueue.push({ type: 'clearLine', y });
    this._bus?.emit('line:cleared', { y, nexusCells });
  }

  /**
   * Clears a vertical column (x-index): sets all cells in the column to 0.
   *
   * Emits 'column:cleared' event.
   * Pushes a { type: 'clearColumn', x } entry to the animation queue.
   *
   * @param {number} x  Column index to clear (0 = leftmost)
   */
  clearColumn(x) {
    if (x < 0 || x >= this.width) return;

    const nexusCells = this._collectNexusCellsInCol(x);

    for (let y = 0; y < this.height; y++) {
      const i = this._idx(x, y);
      this._cells[i] = 0;
      this._flags[i] = 0;
      this._removeFromNexusGroup(i);
    }

    this._animQueue.push({ type: 'clearColumn', x });
    this._bus?.emit('column:cleared', { x, nexusCells });
  }

  /**
   * One-shot method: finds all completed lines, expands nexus chain reactions,
   * clears everything, and returns a detailed result for the scoring engine.
   *
   * Call this after every piece placement.
   *
   * @returns {{ rows: number[], cols: number[], nexusDestroyed: number }}
   */
  processClears() {
    const { rows, cols } = this.findCompletedLines();
    if (rows.length === 0 && cols.length === 0) {
      return { rows: [], cols: [], nexusDestroyed: 0 };
    }

    // ── 1. Collect nexus cells directly inside cleared lines ────────────────
    const triggeredNexusIndices = new Set();

    for (const y of rows) {
      for (const i of this._collectNexusCellsInRow(y)) {
        triggeredNexusIndices.add(i);
      }
    }
    for (const x of cols) {
      for (const i of this._collectNexusCellsInCol(x)) {
        triggeredNexusIndices.add(i);
      }
    }

    // ── 2. Expand chain reaction: find all OTHER cells in the same groups ───
    const chainCells = this._expandNexusChain(triggeredNexusIndices);

    // Total nexus-linked blocks destroyed = direct + chain
    const nexusDestroyed = triggeredNexusIndices.size + chainCells.length;

    if (chainCells.length > 0) {
      this._bus?.emit('nexus:chain', { chainCells, chainLength: chainCells.length });
    }

    // ── 3. Perform the clears ───────────────────────────────────────────────
    for (const y of rows)    this.clearLine(y);
    for (const x of cols)    this.clearColumn(x);

    // Destroy chain-reaction cells not caught by the line clears
    for (const i of chainCells) {
      if (this._cells[i] !== 0) {
        this._cells[i] = 0;
        this._flags[i] = 0;
        this._removeFromNexusGroup(i);
      }
    }

    this._bus?.emit('clears:processed', { rows, cols, nexusDestroyed });
    return { rows, cols, nexusDestroyed };
  }

  // ── Gravity Shift ──────────────────────────────────────────────────────────

  /**
   * Applies gravity in the given direction — all non-frozen, floating blocks
   * slide until they hit a wall or a filled cell.
   *
   * This is the implementation of the GRAVITY SHIFT unique mechanic.
   * After calling this, run processClears() again to detect new completions.
   *
   * @param {string}  [direction=GravityDir.DOWN]  One of GravityDir.*
   * @returns {boolean}  true if at least one block moved
   */
  applyGravity(direction = GravityDir.DOWN) {
    let moved = false;
    switch (direction) {
      case GravityDir.DOWN  : moved = this._gravityDown();  break;
      case GravityDir.UP    : moved = this._gravityUp();    break;
      case GravityDir.LEFT  : moved = this._gravityLeft();  break;
      case GravityDir.RIGHT : moved = this._gravityRight(); break;
    }

    if (moved) {
      this._animQueue.push({ type: 'gravityShift', direction });
      this._bus?.emit('gravity:applied', { direction });
    }
    return moved;
  }

  /** Pull every non-frozen block toward the bottom of the grid. */
  _gravityDown() {
    let moved = false;
    for (let x = 0; x < this.width; x++) {
      // Scan upward from the second-to-last row
      for (let y = this.height - 2; y >= 0; y--) {
        if (this._cells[this._idx(x, y)] === 0)                      continue;
        if (this._flags[this._idx(x, y)] & CellFlag.FROZEN)          continue;
        // Find how far this block can drop
        let dropY = y;
        while (dropY + 1 < this.height && this._cells[this._idx(x, dropY + 1)] === 0) {
          dropY++;
        }
        if (dropY !== y) { this._moveCell(x, y, x, dropY); moved = true; }
      }
    }
    return moved;
  }

  /** Pull every non-frozen block toward the top of the grid. */
  _gravityUp() {
    let moved = false;
    for (let x = 0; x < this.width; x++) {
      for (let y = 1; y < this.height; y++) {
        if (this._cells[this._idx(x, y)] === 0)             continue;
        if (this._flags[this._idx(x, y)] & CellFlag.FROZEN) continue;
        let dropY = y;
        while (dropY - 1 >= 0 && this._cells[this._idx(x, dropY - 1)] === 0) {
          dropY--;
        }
        if (dropY !== y) { this._moveCell(x, y, x, dropY); moved = true; }
      }
    }
    return moved;
  }

  /** Pull every non-frozen block toward the left edge of the grid. */
  _gravityLeft() {
    let moved = false;
    for (let y = 0; y < this.height; y++) {
      for (let x = 1; x < this.width; x++) {
        if (this._cells[this._idx(x, y)] === 0)             continue;
        if (this._flags[this._idx(x, y)] & CellFlag.FROZEN) continue;
        let dropX = x;
        while (dropX - 1 >= 0 && this._cells[this._idx(dropX - 1, y)] === 0) {
          dropX--;
        }
        if (dropX !== x) { this._moveCell(x, y, dropX, y); moved = true; }
      }
    }
    return moved;
  }

  /** Pull every non-frozen block toward the right edge of the grid. */
  _gravityRight() {
    let moved = false;
    for (let y = 0; y < this.height; y++) {
      for (let x = this.width - 2; x >= 0; x--) {
        if (this._cells[this._idx(x, y)] === 0)             continue;
        if (this._flags[this._idx(x, y)] & CellFlag.FROZEN) continue;
        let dropX = x;
        while (dropX + 1 < this.width && this._cells[this._idx(dropX + 1, y)] === 0) {
          dropX++;
        }
        if (dropX !== x) { this._moveCell(x, y, dropX, y); moved = true; }
      }
    }
    return moved;
  }

  /**
   * Moves a single filled cell from (x1,y1) to (x2,y2), copying its
   * color, flags, and nexus group membership.
   * @private
   */
  _moveCell(x1, y1, x2, y2) {
    const from = this._idx(x1, y1);
    const to   = this._idx(x2, y2);

    this._cells[to] = this._cells[from];
    this._flags[to] = this._flags[from];

    // Re-map nexus group membership from old index to new index
    const gid = this._nexusGroups[from];
    this._nexusGroups[to]   = gid;
    this._nexusGroups[from] = 0;

    if (gid && this._nexusGroupMap.has(gid)) {
      const group = this._nexusGroupMap.get(gid);
      group.delete(from);
      group.add(to);
    }

    // Clear the source cell
    this._cells[from] = 0;
    this._flags[from] = 0;
  }

  // ── Ghost Piece ────────────────────────────────────────────────────────────

  /**
   * Calculates the "ghost" position — the furthest valid offset for a piece
   * travelling in the given gravity direction from its current position (ox, oy).
   *
   * Used to draw the placement preview indicator during drag interactions.
   * Returns null when the piece cannot be placed at (ox, oy) at all.
   *
   * @param {Array<{x:number, y:number}>} cells  Piece cell offsets
   * @param {number} ox                           Current column offset
   * @param {number} oy                           Current row offset
   * @param {string} [dir=GravityDir.DOWN]
   * @returns {{ ox: number, oy: number } | null}
   */
  calculateGhost(cells, ox, oy, dir = GravityDir.DOWN) {
    if (!this.canPlace(cells, ox, oy)) return null;

    const dx = dir === GravityDir.RIGHT ? 1 : dir === GravityDir.LEFT  ? -1 : 0;
    const dy = dir === GravityDir.DOWN  ? 1 : dir === GravityDir.UP    ? -1 : 0;

    let gx = ox, gy = oy;
    while (this.canPlace(cells, gx + dx, gy + dy)) {
      gx += dx;
      gy += dy;
    }
    return { ox: gx, oy: gy };
  }

  // ── Nexus Link System ──────────────────────────────────────────────────────

  /**
   * Creates a new Nexus Link group containing the given cell positions.
   * All cells in the group are chain-linked: clearing any one will destroy all.
   * Also sets the LINKED flag on each cell.
   *
   * @param {Array<{x:number, y:number}>} positions
   * @returns {number}  The assigned group ID
   */
  createNexusGroup(positions) {
    const groupId = this._nextGroupId++;
    const indices = new Set();

    for (const { x, y } of positions) {
      if (!this.inBounds(x, y)) continue;
      const i = this._idx(x, y);
      this._nexusGroups[i] = groupId;
      this._flags[i]      |= CellFlag.LINKED;
      indices.add(i);
    }

    this._nexusGroupMap.set(groupId, indices);
    return groupId;
  }

  /**
   * Scans the newly placed cells and auto-merges adjacent nexus connectors
   * (in all 8 directions including diagonals, per GDD specification) into
   * shared link groups.
   *
   * Call this after placePiece() whenever the piece carries the LINKED flag.
   *
   * @param {Array<{x:number, y:number}>} placedCells  Absolute board positions
   */
  resolveNexusLinks(placedCells) {
    const DIRS = [
      { dx: -1, dy:  0 }, { dx: 1, dy:  0 },
      { dx:  0, dy: -1 }, { dx: 0, dy:  1 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy:  1 }, { dx: 1, dy:  1 },
    ];

    for (const { x, y } of placedCells) {
      const ci = this._idx(x, y);
      if (!(this._flags[ci] & CellFlag.LINKED)) continue;

      for (const { dx, dy } of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this._idx(nx, ny);
        if (!(this._flags[ni] & CellFlag.LINKED)) continue;
        this._mergeNexusGroups(ci, ni);
      }
    }
  }

  /**
   * Merges the nexus groups of the two cell indices into a single group.
   * If either cell has no group, it is assigned to the other's group.
   * If neither has a group, a new group is created for both.
   * @private
   */
  _mergeNexusGroups(i1, i2) {
    const g1 = this._nexusGroups[i1];
    const g2 = this._nexusGroups[i2];

    if (g1 !== 0 && g1 === g2) return; // Already in the same group

    if (g1 === 0 && g2 === 0) {
      const gid = this._nextGroupId++;
      this._nexusGroupMap.set(gid, new Set([i1, i2]));
      this._nexusGroups[i1] = gid;
      this._nexusGroups[i2] = gid;
      return;
    }

    if (g1 === 0) {
      this._nexusGroupMap.get(g2).add(i1);
      this._nexusGroups[i1] = g2;
      return;
    }

    if (g2 === 0) {
      this._nexusGroupMap.get(g1).add(i2);
      this._nexusGroups[i2] = g1;
      return;
    }

    // Both have groups: absorb g2 into g1
    const set1 = this._nexusGroupMap.get(g1);
    for (const idx of this._nexusGroupMap.get(g2)) {
      this._nexusGroups[idx] = g1;
      set1.add(idx);
    }
    this._nexusGroupMap.delete(g2);
  }

  /**
   * Removes a cell index from its nexus group.
   * Deletes the group if it becomes empty.
   * @private
   */
  _removeFromNexusGroup(i) {
    const gid = this._nexusGroups[i];
    if (gid === 0) return;
    const group = this._nexusGroupMap.get(gid);
    if (group) {
      group.delete(i);
      if (group.size === 0) this._nexusGroupMap.delete(gid);
    }
    this._nexusGroups[i] = 0;
  }

  /**
   * Returns a Set of cell indices in row y that belong to any nexus group.
   * @private
   */
  _collectNexusCellsInRow(y) {
    const found = new Set();
    for (let x = 0; x < this.width; x++) {
      const i = this._idx(x, y);
      if (this._nexusGroups[i] !== 0) found.add(i);
    }
    return found;
  }

  /**
   * Returns a Set of cell indices in column x that belong to any nexus group.
   * @private
   */
  _collectNexusCellsInCol(x) {
    const found = new Set();
    for (let y = 0; y < this.height; y++) {
      const i = this._idx(x, y);
      if (this._nexusGroups[i] !== 0) found.add(i);
    }
    return found;
  }

  /**
   * Given a set of "triggered" nexus cell indices (cells about to be cleared),
   * finds all OTHER cells belonging to the same groups — the chain-reaction
   * targets that will be destroyed even though they're not in any cleared line.
   *
   * @param  {Set<number>} triggeredIndices
   * @returns {number[]}  Array of additional cell indices to destroy
   */
  _expandNexusChain(triggeredIndices) {
    const chainTargets    = [];
    const processedGroups = new Set();

    for (const i of triggeredIndices) {
      const gid = this._nexusGroups[i];
      if (gid === 0 || processedGroups.has(gid)) continue;
      processedGroups.add(gid);

      const group = this._nexusGroupMap.get(gid);
      if (!group) continue;

      for (const ci of group) {
        if (!triggeredIndices.has(ci)) chainTargets.push(ci);
      }
    }

    return chainTargets;
  }

  // ── Game-Over Detection ────────────────────────────────────────────────────

  /**
   * Returns true when at least one piece from the provided set can be placed
   * somewhere on the current board.
   *
   * Called by the active game mode after each placement to check for
   * "no valid move" game-over condition.
   *
   * @param {Array<Array<{x:number, y:number}>>} pieceCellSets
   * @returns {boolean}
   */
  hasAnyValidPlacement(pieceCellSets) {
    for (const cells of pieceCellSets) {
      for (let oy = 0; oy < this.height; oy++) {
        for (let ox = 0; ox < this.width; ox++) {
          if (this.canPlace(cells, ox, oy)) return true;
        }
      }
    }
    return false;
  }

  // ── Board Statistics ───────────────────────────────────────────────────────

  /**
   * Returns the number of filled cells on the board.
   * @returns {number}
   */
  getCellCount() {
    let n = 0;
    for (let i = 0; i < this._cells.length; i++) {
      if (this._cells[i] !== 0) n++;
    }
    return n;
  }

  /**
   * Returns how full the board is as a ratio in [0, 1].
   * 1.0 means entirely full.
   * @returns {number}
   */
  getDensity() {
    return this.getCellCount() / (this.width * this.height);
  }

  // ── Animation Queue ────────────────────────────────────────────────────────

  /**
   * Drains and returns all queued animation events accumulated since the
   * last call. Should be polled by the renderer every frame.
   *
   * @returns {Array<{type:string, [key:string]:any}>}
   */
  drainAnimQueue() {
    const q = this._animQueue;
    this._animQueue = [];
    return q;
  }

  // ── Serialisation / Persistence ───────────────────────────────────────────

  /**
   * Serialises the current board state to a plain JSON-safe object.
   * Use this for save-game / pause-and-resume persistence.
   *
   * @returns {{ width:number, height:number, cells:number[], flags:number[], nexusGroups:number[] }}
   */
  serialize() {
    return {
      width       : this.width,
      height      : this.height,
      cells       : Array.from(this._cells),
      flags       : Array.from(this._flags),
      nexusGroups : Array.from(this._nexusGroups),
    };
  }

  /**
   * Restores board state from a serialised snapshot produced by serialize().
   * @param {{ width, height, cells, flags, nexusGroups }} data
   */
  deserialize(data) {
    if (data.width !== this.width || data.height !== this.height) {
      throw new Error(
        `Board.deserialize: size mismatch. ` +
        `Expected ${this.width}×${this.height}, got ${data.width}×${data.height}.`
      );
    }

    this._cells.set(data.cells);
    this._flags.set(data.flags);
    this._nexusGroups.set(data.nexusGroups);

    // Rebuild the nexusGroupMap from the flat nexusGroups array
    this._nexusGroupMap.clear();
    for (let i = 0; i < this._nexusGroups.length; i++) {
      const gid = this._nexusGroups[i];
      if (gid === 0) continue;
      if (!this._nexusGroupMap.has(gid)) this._nexusGroupMap.set(gid, new Set());
      this._nexusGroupMap.get(gid).add(i);
    }

    // Make sure _nextGroupId is above any existing group ID
    let maxId = 0;
    for (const gid of this._nexusGroupMap.keys()) {
      if (gid > maxId) maxId = gid;
    }
    this._nextGroupId = maxId + 1;
  }

  /**
   * Resets the board to a completely empty state.
   * Emits 'board:reset' on the event bus.
   */
  reset() {
    this._cells.fill(0);
    this._flags.fill(0);
    this._nexusGroups.fill(0);
    this._nexusGroupMap.clear();
    this._animQueue  = [];
    this._nextGroupId = 1;
    this._bus?.emit('board:reset');
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  /**
   * Returns a formatted ASCII grid for console debugging.
   * Empty cells = '.', filled cells = their 1-digit color index.
   *
   * @returns {string}
   */
  toString() {
    const lines = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        const v = this._cells[this._idx(x, y)];
        row.push(v === 0 ? '.' : String(v));
      }
      lines.push(row.join(' '));
    }
    return lines.join('\n');
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { Board, CellFlag, GravityDir };
