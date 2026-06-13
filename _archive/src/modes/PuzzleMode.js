/**
 * NEXUS BLOCKS — Puzzle Challenge Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * "Think. Solve. Master." — pre-designed boards with a fixed piece set.
 * Clear all target cells using the fewest placements possible.
 *
 * Key rules (from GDD):
 *   • Board starts with a pre-set configuration.
 *   • Player receives a fixed, ordered piece set (no randomness).
 *   • Goal: clear all highlighted target cells.
 *   • Star rating: 3★ = min moves, 2★ = min+1, 1★ = min+2.
 *   • Hint Tokens can reveal the optimal next placement.
 *
 * Puzzle data format (loaded from a puzzle pack JSON):
 * {
 *   id          : 'puzzle_001',
 *   chapter     : 1,
 *   gridSize    : 9,
 *   minMoves    : 4,
 *   targetCells : [{x, y}, ...],      // cells the player must clear
 *   presetCells : [{x, y, colorIndex, flags?}, ...],  // pre-filled board
 *   pieces      : ['P01', 'P03', ...], // ordered piece IDs
 *   allowGravityShift: false,
 * }
 */

'use strict';

// In the browser Board.js is loaded before this file, so CellFlag is already
// a global. In Node.js (e.g. unit tests) we require it explicitly.
// Using an IIFE avoids a TDZ self-reference in the destructuring pattern.
const _CellFlag = (function () {
  if (typeof module !== 'undefined') {
    return require('../entities/Board.js').CellFlag;
  }
  // eslint-disable-next-line no-undef
  return (typeof CellFlag !== 'undefined') ? CellFlag : { SPECIAL: 0b1000 };
}());

class PuzzleMode {
  constructor() {
    this.id   = 'puzzle_challenge';
    this.name = 'Puzzle Challenge';

    this._puzzle         = null; // current puzzle definition
    this._pieceQueue     = [];   // ordered piece descriptors
    this._pieceIndex     = 0;    // next piece to place
    this._movesUsed      = 0;
    this._targetCleared  = 0;
    this._targetTotal    = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * @param {object} ctx
   * @param {object} puzzleData  Puzzle definition (see format above)
   */
  start(ctx, puzzleData) {
    const { board, scoreEngine, bus } = ctx;

    // PlayingState.enter() calls start(ctx) without puzzleData, which used to
    // throw on `puzzleData.targetCells.length` and corrupt the state-machine.
    // Fall back to a neutral default so the mode boots cleanly; a real puzzle
    // can be loaded later via loadPuzzle().
    puzzleData = puzzleData ?? this._defaultPuzzle();

    this._puzzle        = puzzleData;
    this._movesUsed     = 0;
    this._targetCleared = 0;
    this._targetTotal   = puzzleData.targetCells?.length ?? 0;
    this._pieceIndex    = 0;

    // Build the ordered piece queue from the factory by IDs
    this._pieceQueue = puzzleData.pieces.map(id => {
      const def = ctx.PieceFactory.getDefinition(id);
      return { piece: { ...def, cells: def.cells.map(c => ({ ...c })), colorIndex: 1, nexusFlags: [] }, rotation: 0 };
    });

    board.reset();
    scoreEngine.reset();

    // Load the preset board state
    for (const cell of (puzzleData.presetCells ?? [])) {
      board.setCell(cell.x, cell.y, cell.colorIndex, cell.flags ?? 0);
    }

    // Mark target cells with SPECIAL flag for visual highlighting
    for (const { x, y } of (puzzleData.targetCells ?? [])) {
      board.setFlag(x, y, _CellFlag.SPECIAL, true);
    }

    bus?.emit('mode:started', {
      mode           : this.id,
      puzzle         : puzzleData,
      currentPiece   : this._pieceQueue[0]?.piece ?? null,
    });
  }

  update(dt, ctx) {
    // Puzzle mode has no real-time logic — purely event-driven.
  }

  end(ctx, success) {
    const stars = this._calcStars();
    ctx.scoreEngine?.onPuzzleStarEarned(stars);
    ctx.bus?.emit('puzzle:completed', {
      puzzleId    : this._puzzle?.id,
      stars,
      movesUsed   : this._movesUsed,
      minMoves    : this._puzzle?.minMoves,
      success,
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  onPieceDrop(boardX, boardY, rotation, ctx) {
    const { board, PieceFactory, bus } = ctx;
    const entry = this._pieceQueue[this._pieceIndex];
    if (!entry) return false;

    const rotCells = PieceFactory.rotate(entry.piece.cells, rotation);
    if (!board.canPlace(rotCells, boardX, boardY)) return false;

    const placedCells = board.placePiece(rotCells, boardX, boardY, entry.piece.colorIndex);
    this._movesUsed++;
    this._pieceIndex++;

    ctx.visualManager?.animatePiecePlacement(
      placedCells.map(c => ({ x: c.x, y: c.y, isLinked: false })),
      entry.piece.colorIndex
    );

    const result = board.processClears();

    // Count how many target cells were in the cleared lines
    if (result.rows.length > 0 || result.cols.length > 0) {
      const clearedSet = new Set();
      for (const y of result.rows) {
        for (let x = 0; x < board.width; x++) clearedSet.add(`${x},${y}`);
      }
      for (const x of result.cols) {
        for (let y = 0; y < board.height; y++) clearedSet.add(`${x},${y}`);
      }
      for (const { x, y } of this._puzzle.targetCells) {
        if (clearedSet.has(`${x},${y}`)) this._targetCleared++;
      }
    }

    bus?.emit('puzzle:move', {
      movesUsed    : this._movesUsed,
      targetCleared: this._targetCleared,
      targetTotal  : this._targetTotal,
      nextPiece    : this._pieceQueue[this._pieceIndex]?.piece ?? null,
    });

    // Win check
    if (this._targetCleared >= this._targetTotal) {
      this.end(ctx, true);
      return true;
    }

    // Out of pieces without clearing all targets
    if (this._pieceIndex >= this._pieceQueue.length) {
      this.end(ctx, false);
    }

    return true;
  }

  /**
   * Activates a hint: emits the optimal next placement for the current piece.
   * In the real implementation this would query a solver; here it emits a
   * placeholder event that the UI can handle.
   */
  onHintRequested(ctx) {
    ctx.bus?.emit('puzzle:hint', {
      pieceIndex : this._pieceIndex,
      piece      : this._pieceQueue[this._pieceIndex]?.piece,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Calculates star rating from the number of moves used.
   * 3★ = minMoves, 2★ = minMoves+1, 1★ = minMoves+2, 0★ = failure.
   */
  _calcStars() {
    const min  = this._puzzle?.minMoves ?? 0;
    const diff = this._movesUsed - min;
    if (diff <= 0) return 3;
    if (diff === 1) return 2;
    if (diff === 2) return 1;
    return 0;
  }

  /**
   * Neutral fallback puzzle so PuzzleMode.start(ctx) without arguments
   * doesn't crash. Empty board, no targets, a handful of common pieces.
   * Real puzzles should be loaded via start(ctx, puzzleData).
   * @private
   */
  _defaultPuzzle() {
    return {
      id          : 'puzzle_default',
      gridSize    : 9,
      minMoves    : 0,
      targetCells : [],
      presetCells : [],
      pieces      : ['P01', 'P02', 'P03', 'P04', 'P08'],
      allowGravityShift: false,
    };
  }
}

if (typeof module !== 'undefined') module.exports = { PuzzleMode };
