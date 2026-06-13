/**
 * NEXUS BLOCKS — HintSystem
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time placement advisor: given the current board and the 3 tray pieces,
 * suggests the optimal placement for each piece using a greedy heuristic that
 * balances line clears, hole avoidance, and board-density shaping.
 *
 * ── Heuristic Model ─────────────────────────────────────────────────────────
 *
 *   For each piece × rotation × (x, y) offset:
 *
 *     SCORE = CLEAR_BONUS * linesCleared
 *           − HOLE_PENALTY * holesCreated
 *           + DENSITY_REWARD * densityAfterPlacement
 *           + CONNECTIVITY_BONUS * adjacentFilledCells
 *           + EDGE_BONUS (if piece touches board edge — packs tightly)
 *           + CENTER_PENALTY (penalises placing in center — edges are better)
 *
 *   holesCreated = number of empty cells below filled cells per column.
 *   (A "hole" is an empty cell that can never be filled because all cells
 *    above it in the same column are already filled.)
 *
 *   The hint output includes:
 *     - A "best" suggestion for each piece
 *     - A "global best" — the single most impactful placement across all 3
 *     - A quality score 0..1 for UI confidence display
 *
 * Usage:
 *   const hint = new HintSystem();
 *   const suggestions = hint.evaluate(board, trayPieces);
 *   // suggestions: {
 *   //   bestGlobal: { pieceIndex, x, y, rotation, score },
 *   //   perPiece  : [{ pieceIndex, x, y, rotation, score }],  // 3 entries
 *   // }
 */

'use strict';

// ── Scoring Constants (tunable for balance) ──────────────────────────────────

const WEIGHTS = Object.freeze({
  CLEAR_ROW        : 120,    // Score for each row cleared
  CLEAR_COL        : 120,    // Score for each column cleared
  NEXUS_BONUS      : 200,    // Bonus for triggering nexus links
  HOLE_PENALTY     : -45,    // Penalty per hole created
  DENSITY_REWARD   : 3,      // Reward per filled cell (encourages compact play)
  ADJACENCY_BONUS  : 8,      // Bonus per adjacent filled cell
  EDGE_BONUS       : 15,     // Bonus when piece touches board edge
  CENTER_PENALTY   : -4,     // Penalty per cell in the center zone
  CORNER_PENALTY   : 5,      // Bonus when piece fills a corner
  ROW_POTENTIAL    : 25,     // Bonus for filling cells that bring a row close to completion
  COL_POTENTIAL    : 25,     // Same for columns
});

// ── HintSystem Class ──────────────────────────────────────────────────────────

class HintSystem {
  /**
   * @param {object} [options]
   * @param {object} [options.weights]  Override scoring weights
   */
  constructor(options = {}) {
    this._w = { ...WEIGHTS, ...options.weights };

    /**
     * When true, also considers piece rotation in the search.
     * Set false for a 2× speedup at the cost of fewer suggestions.
     */
    this.considerRotation = true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Evaluates all possible placements for the tray pieces and returns
   * ranked suggestions.
   *
   * @param {Board}  board        Board instance (has ._cells, .width, .height, .canPlace)
   * @param {object[]} trayPieces Array of 3 piece descriptors from PieceFactory:
   *                               { cells[{x,y}], colorIndex, nexusFlags[] }
   * @param {object} [options]
   * @param {number} [options.maxSuggestions=1]  Number of top suggestions per piece
   * @returns {{
   *   bestGlobal : { pieceIndex:number, x:number, y:number, rotation:number, score:number, quality:number } | null,
   *   perPiece   : Array<{ pieceIndex:number, x:number, y:number, rotation:number, score:number, quality:number } | null>,
   *   allRanked  : Array<{ pieceIndex:number, x:number, y:number, rotation:number, score:number }>,
   * }}
   */
  evaluate(board, trayPieces, options = {}) {
    const maxSuggestions = options.maxSuggestions ?? 1;

    /** @type {Array<{ pieceIndex:number, x:number, y:number, rotation:number, score:number }>} */
    const allRanked = [];

    // Per-piece best suggestions
    const perPieceBest = new Array(trayPieces.length).fill(null);

    for (let pi = 0; pi < trayPieces.length; pi++) {
      const piece = trayPieces[pi];
      if (!piece || !piece.cells) continue;

      const rotations = this.considerRotation
        ? [0, 1, 2, 3]
        : [0];

      let bestForPiece = null;
      let bestScore    = -Infinity;

      for (const rot of rotations) {
        const rotCells = this._rotateCells(piece.cells, rot);

        for (let oy = 0; oy < board.height; oy++) {
          for (let ox = 0; ox < board.width; ox++) {
            if (!board.canPlace(rotCells, ox, oy)) continue;

            const score = this._scorePlacement(board, rotCells, ox, oy, piece);
            const entry = { pieceIndex: pi, x: ox, y: oy, rotation: rot, score };

            allRanked.push(entry);

            if (score > bestScore) {
              bestScore    = score;
              bestForPiece = entry;
            }
          }
        }
      }

      perPieceBest[pi] = bestForPiece;
    }

    // Sort all ranked by score descending
    allRanked.sort((a, b) => b.score - a.score);

    // Compute quality scores (normalise to 0..1 against the top score)
    const maxScore = allRanked.length > 0 ? Math.max(0, allRanked[0].score) : 1;
    const quality = (s) => maxScore > 0 ? Math.max(0, Math.min(1, s / maxScore)) : 0;

    const bestGlobal = allRanked.length > 0
      ? { ...allRanked[0], quality: quality(allRanked[0].score) }
      : null;

    const perPiece = perPieceBest.map(b =>
      b ? { ...b, quality: quality(b.score) } : null
    );

    return { bestGlobal, perPiece, allRanked };
  }

  /**
   * Quick hint: returns only the single best placement across all pieces.
   * Optimised path — stops early when a "great" score is found.
   *
   * @param {Board} board
   * @param {object[]} trayPieces
   * @returns {{ pieceIndex:number, x:number, y:number, rotation:number, score:number } | null}
   */
  quickHint(board, trayPieces) {
    let best  = null;
    let bestS = -Infinity;

    // "Great" threshold: stop searching if we find this score
    const GREAT_SCORE = 250;

    for (let pi = 0; pi < trayPieces.length; pi++) {
      const piece = trayPieces[pi];
      if (!piece?.cells) continue;

      const rotCells = piece.cells;

      for (let oy = 0; oy < board.height; oy++) {
        for (let ox = 0; ox < board.width; ox++) {
          if (!board.canPlace(rotCells, ox, oy)) continue;

          const score = this._scorePlacement(board, rotCells, ox, oy, piece);
          if (score > bestS) {
            bestS = score;
            best  = { pieceIndex: pi, x: ox, y: oy, rotation: 0, score };
            if (score >= GREAT_SCORE) return best;
          }
        }
      }
    }

    return best;
  }

  // ── Private: Scoring Engine ────────────────────────────────────────────────

  /**
   * Computes a heuristic score for placing `rotCells` at (ox, oy) on the board.
   * Does NOT mutate the board — works on a snapshot.
   *
   * @param {Board}     board
   * @param {object[]}  rotCells    Piece cell offsets (already rotated)
   * @param {number}    ox
   * @param {number}    oy
   * @param {object}    piece       Piece descriptor (for colorIndex, nexusFlags)
   * @returns {number}
   */
  _scorePlacement(board, rotCells, ox, oy, piece) {
    const w = this._w;
    let score = 0;

    // ── 1. Build a local snapshot of affected cells ──────────────────────────
    // We only care about the cells the piece touches, plus rows/cols that
    // might become full. For efficiency, track which rows/cols are affected.

    const affectedRows = new Set();
    const affectedCols = new Set();
    const placedPositions = [];

    for (const { x, y } of rotCells) {
      const bx = x + ox;
      const by = y + oy;
      placedPositions.push({ x: bx, y: by });
      affectedRows.add(by);
      affectedCols.add(bx);
    }

    // ── 2. Line clear potential ─────────────────────────────────────────────
    for (const y of affectedRows) {
      let filled = 0;
      for (let x = 0; x < board.width; x++) {
        const isInPiece = placedPositions.some(p => p.x === x && p.y === y);
        if (isInPiece || board.isFilled(x, y)) filled++;
      }
      if (filled === board.width) {
        score += w.CLEAR_ROW;
      } else {
        // Partial completion reward
        score += Math.round(w.ROW_POTENTIAL * (filled / board.width));
      }
    }

    for (const x of affectedCols) {
      let filled = 0;
      for (let y = 0; y < board.height; y++) {
        const isInPiece = placedPositions.some(p => p.x === x && p.y === y);
        if (isInPiece || board.isFilled(x, y)) filled++;
      }
      if (filled === board.height) {
        score += w.CLEAR_COL;
      } else {
        score += Math.round(w.COL_POTENTIAL * (filled / board.height));
      }
    }

    // ── 3. Hole penalty ─────────────────────────────────────────────────────
    // A hole is created when a cell is filled directly above an existing empty
    // gap. Count per column after virtual placement.
    for (const x of affectedCols) {
      let seenFilled = false;
      let holes      = 0;
      for (let y = board.height - 1; y >= 0; y--) {
        const isInPiece = placedPositions.some(p => p.x === x && p.y === y);
        const isFilled  = isInPiece || board.isFilled(x, y);
        if (isFilled) {
          seenFilled = true;
        } else if (seenFilled) {
          holes++;
        }
      }
      score += holes * w.HOLE_PENALTY;
    }

    // ── 4. Density reward ──────────────────────────────────────────────────
    score += piece.cells.length * w.DENSITY_REWARD;

    // ── 5. Adjacency bonus ──────────────────────────────────────────────────
    // Count already-filled cells in the 8-neighbourhood of each placed cell
    const DIRS = [
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy:  0 },                     { dx: 1, dy:  0 },
      { dx: -1, dy:  1 }, { dx: 0, dy:  1 }, { dx: 1, dy:  1 },
    ];

    let adjacent = 0;
    const counted = new Set();
    for (const { x, y } of placedPositions) {
      for (const { dx, dy } of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue;
        const key = `${nx},${ny}`;
        if (counted.has(key)) continue; // Avoid double-counting
        if (board.isFilled(nx, ny)) {
          adjacent++;
          counted.add(key);
        }
      }
    }
    score += adjacent * w.ADJACENCY_BONUS;

    // ── 6. Edge bonus ──────────────────────────────────────────────────────
    for (const { x, y } of placedPositions) {
      if (x === 0 || x === board.width  - 1) score += w.EDGE_BONUS;
      if (y === 0 || y === board.height - 1) score += w.EDGE_BONUS;
    }

    // ── 7. Center penalty ──────────────────────────────────────────────────
    const cxMin = Math.floor(board.width  * 0.25);
    const cxMax = Math.ceil (board.width  * 0.75);
    const cyMin = Math.floor(board.height * 0.25);
    const cyMax = Math.ceil (board.height * 0.75);
    for (const { x, y } of placedPositions) {
      if (x >= cxMin && x <= cxMax && y >= cyMin && y <= cyMax) {
        score += w.CENTER_PENALTY;
      }
    }

    // ── 8. Nexus bonus ─────────────────────────────────────────────────────
    if (piece.nexusFlags?.some(Boolean)) {
      // Piece carries linked cells — bonus for potential chain reactions
      score += w.NEXUS_BONUS * 0.3; // Partial bonus (actual chain depends on adjacent links)
    }

    return score;
  }

  // ── Private: Rotation ──────────────────────────────────────────────────────

  /**
   * Rotates cell coordinates 90° CW × steps, normalised to origin.
   * @param {Array<{x:number,y:number}>} cells
   * @param {number} steps
   * @returns {Array<{x:number,y:number}>}
   */
  _rotateCells(cells, steps) {
    const n = ((steps % 4) + 4) % 4;
    let current = cells;

    for (let s = 0; s < n; s++) {
      current = current.map(({ x, y }) => ({ x: -y, y: x }));
      const minX = Math.min(...current.map(c => c.x));
      const minY = Math.min(...current.map(c => c.y));
      current = current.map(c => ({ x: c.x - minX, y: c.y - minY }));
    }

    return current;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') module.exports = { HintSystem, WEIGHTS };