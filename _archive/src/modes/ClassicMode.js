/**
 * NEXUS BLOCKS — Classic Endless Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * "Survive the Grid" — place pieces to clear rows and columns on a 9×9 board.
 * The game ends when none of the 3 tray pieces can be placed anywhere.
 *
 * Mode lifecycle (called by StateMachine via PlayingState):
 *   mode.start(ctx)       — initialise tray, start timers
 *   mode.update(dt, ctx)  — handle Gravity Shift charge timer; check game-over
 *   mode.end(ctx)         — persist score, emit game:over
 *
 * Input events (wired in HUD.js / ScreenManager.js):
 *   mode.onPieceDrop(pieceIndex, boardX, boardY, rotation)
 *   mode.onGravityShiftActivate(direction)
 *   mode.onPowerupActivate(powerupId, targetX?, targetY?)
 */

'use strict';

const CLASSIC_GRID_SIZE     = 9;
const GRAVITY_CHARGE_TIME   = 45_000; // ms — GDD: charges every 45 s in Classic

class ClassicMode {
  constructor() {
    this.id   = 'classic_endless';
    this.name = 'Classic Endless';

    /** @type {{ piece: object, rotation: number }[]} Current 3-piece tray. */
    this._tray             = [];

    /** ms since last Gravity Shift was used (or since game start). */
    this._gravityChargeMs  = 0;

    /** true when the Gravity Shift ability is ready to use. */
    this.gravityReady      = false;

    /** Difficulty tier (expands over time per GDD difficulty curve). */
    this._diffTier         = 0;

    /** Score threshold for next difficulty upgrade. */
    this._nextDiffThreshold = 2000;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * @param {object} ctx  Shared game context from StateMachine
   */
  start(ctx) {
    const { board, factory, scoreEngine, bus } = ctx;

    board.reset();
    scoreEngine.reset();

    // Upgrade difficulty based on score (Classic starts at tier 0)
    factory.setDifficultyTier(0);
    this._diffTier          = 0;
    this._nextDiffThreshold = 2000;
    this._gravityChargeMs   = 0;
    this.gravityReady       = false;

    this._drawTray(factory);

    bus?.emit('mode:started', { mode: this.id, tray: this._tray });
    // Emit tray:updated explicitly so HUD draws the NEXT pieces on game start
    // (previously only emitted after a piece was dropped, leaving the panel
    // empty during the very first frame the player sees).
    bus?.emit('tray:updated', { tray: this._tray });
  }

  /**
   * @param {number} dt   Fixed timestep (ms)
   * @param {object} ctx
   */
  update(dt, ctx) {
    const { scoreEngine } = ctx;

    // ── Gravity Shift charge timer ──────────────────────────────────────────
    if (!this.gravityReady) {
      this._gravityChargeMs += dt;
      if (this._gravityChargeMs >= GRAVITY_CHARGE_TIME) {
        this.gravityReady   = true;
        this._gravityChargeMs = 0;
        ctx.bus?.emit('gravityShift:charged');
      }
    }

    // ── Difficulty curve ────────────────────────────────────────────────────
    const score = scoreEngine.getScore();
    if (score >= this._nextDiffThreshold && this._diffTier < 2) {
      this._diffTier++;
      ctx.factory?.setDifficultyTier(this._diffTier);
      this._nextDiffThreshold += 2000 * (this._diffTier + 1);
      ctx.bus?.emit('mode:difficultyUp', { tier: this._diffTier });
    }
  }

  end(ctx) {
    const score = ctx.scoreEngine?.getScore() ?? 0;
    ctx.scoreEngine?.saveHighScore(score);
    ctx.scoreEngine?.saveToLeaderboard();
    ctx.bus?.emit('game:over', { mode: this.id, score });
  }

  // ── Game Actions ───────────────────────────────────────────────────────────

  /**
   * Attempts to place tray[trayIndex] on the board at (boardX, boardY).
   * Returns false if the placement is invalid.
   *
   * @param {number} trayIndex  0, 1, or 2
   * @param {number} boardX
   * @param {number} boardY
   * @param {number} rotation   0 | 1 | 2 | 3  (× 90° CW steps)
   * @param {object} ctx
   * @returns {boolean}
   */
  onPieceDrop(trayIndex, boardX, boardY, rotation, ctx) {
    const { board, factory, scoreEngine, visualManager, bus } = ctx;
    const entry = this._tray[trayIndex];
    if (!entry) return false;

    // Rotate cells to the requested orientation
    const { PieceFactory } = ctx;
    const rotCells = PieceFactory.rotate(entry.piece.cells, rotation);

    if (!board.canPlace(rotCells, boardX, boardY)) return false;

    // Place the piece
    const placedCells = board.placePiece(
      rotCells, boardX, boardY,
      entry.piece.colorIndex,
      this._buildCellFlags(entry.piece, rotation)
    );

    // Resolve Nexus Links on newly placed LINKED cells
    if (entry.piece.nexusFlags.some(Boolean)) {
      board.resolveNexusLinks(placedCells);
    }

    // Animate via NexusVisualManager
    visualManager?.animatePiecePlacement(
      placedCells.map((c, i) => ({
        x: c.x, y: c.y,
        isLinked: entry.piece.nexusFlags[i] ?? false
      })),
      entry.piece.colorIndex
    );

    // Score the placement
    scoreEngine.onPiecePlaced(performance.now());

    // Process line/column clears
    const result = board.processClears();
    if (result.rows.length > 0 || result.cols.length > 0) {
      // Animate each cleared row via NexusVisualManager
      for (const y of result.rows) visualManager?.animateLineClear(y);
      for (const x of result.cols) visualManager?.animateColumnClear(x);

      scoreEngine.onClears(result);
    } else {
      scoreEngine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
    }

    // Remove from tray
    this._tray[trayIndex] = null;

    // If all 3 tray pieces placed, refill the tray
    if (this._tray.every(t => t === null)) {
      this._drawTray(factory);
    }

    // Game-over check: a piece counts as placeable if ANY of its 4 rotations
    // fits somewhere. Previously only rotation 0 was checked, which could
    // wrongly trigger end-of-game on otherwise-playable boards.
    const remainingAllRotations = [];
    for (const entry of this._tray) {
      if (!entry) continue;
      for (const rot of PieceFactory.allRotations(entry.piece.cells)) {
        remainingAllRotations.push(rot);
      }
    }
    if (remainingAllRotations.length > 0 &&
        !board.hasAnyValidPlacement(remainingAllRotations)) {
      this.end(ctx);
    }

    bus?.emit('tray:updated', { tray: this._tray });
    return true;
  }

  /**
   * Activates the Gravity Shift ability if charged.
   * @param {'down'|'up'|'left'|'right'} direction
   * @param {object} ctx
   * @returns {boolean}
   */
  onGravityShiftActivate(direction, ctx) {
    if (!this.gravityReady) return false;

    const { board, scoreEngine } = ctx;
    this.gravityReady       = false;
    this._gravityChargeMs   = 0;

    const moved = board.applyGravity(direction);
    if (moved) {
      scoreEngine.onGravityShift();
      const result = board.processClears();
      if (result.rows.length > 0 || result.cols.length > 0) {
        scoreEngine.onClears({ ...result, isGravityCascade: true });
      }
      ctx.bus?.emit('gravityShift:activated', { direction, linesCleared: result.rows.length + result.cols.length });
    }

    return true;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _drawTray(factory) {
    this._tray = factory.nextBatch(3).map(piece => ({ piece, rotation: 0 }));
  }

  /**
   * Builds the CellFlag bitfield for each cell in a piece being placed,
   * based on its nexusFlags array.
   * Returns a single combined flag value for all cells in the piece.
   * (Individual per-cell flags are handled by Board.placePiece / resolveNexusLinks.)
   */
  _buildCellFlags(piece, rotation) {
    // The flags will be set per-cell in resolveNexusLinks; here we just
    // pass 0 as the initial placement flag. The LINKED flag is set by resolveNexusLinks.
    return 0;
  }
}

if (typeof module !== 'undefined') module.exports = { ClassicMode };
