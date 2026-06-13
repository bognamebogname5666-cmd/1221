/**
 * NEXUS BLOCKS — Time Rush Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * "60 Seconds of Chaos" — 8×8 grid, one piece at a time, 1.5-second auto-skip.
 *
 * Key rules (from GDD):
 *   • 60-second countdown.
 *   • Single piece shown at a time (no 3-piece tray).
 *   • Each piece has a 1.5 s auto-skip window; skip costs -50 pts.
 *   • Clearing any line adds +2 s to the timer (max 5 bonus seconds per game).
 *   • Speed bonus: placing within 0.5 s of receiving the piece = +25 pts.
 *   • Gravity Shift: available once, recharges after 3 line clears.
 *   • Board does NOT end the game when full — unplaceable pieces are skipped.
 */

'use strict';

const RUSH_GRID_SIZE    = 8;
const RUSH_DURATION_MS  = 60_000;
const AUTO_SKIP_MS      = 1_500;
const TIME_BONUS_PER_LINE = 2_000; // ms
const MAX_TIME_BONUS_MS = 5_000;   // cap

class RushMode {
  constructor() {
    this.id   = 'time_rush';
    this.name = 'Time Rush';

    this._remainingMs      = RUSH_DURATION_MS;
    this._timeBonusUsed    = 0;
    this._autoSkipMs       = 0;
    this._currentPiece     = null;
    this._pieceAppearedMs  = 0;
    this._gravityReady     = true;
    this._gravityLinesNeeded = 3;
    this._gravityLinesCount  = 0;
  }

  start(ctx) {
    const { board, factory, scoreEngine, bus } = ctx;

    board.reset();
    scoreEngine.reset();

    this._remainingMs     = RUSH_DURATION_MS;
    this._timeBonusUsed   = 0;
    this._autoSkipMs      = 0;
    this._gravityReady    = true;
    this._gravityLinesCount = 0;

    factory.reseed(Date.now()); // fresh random seed each game
    this._nextPiece(ctx);

    bus?.emit('mode:started', { mode: this.id, remainingMs: this._remainingMs });
  }

  update(dt, ctx) {
    // Countdown
    this._remainingMs -= dt;
    if (this._remainingMs <= 0) {
      this._remainingMs = 0;
      this.end(ctx);
      return;
    }

    ctx.bus?.emit('rush:timerUpdate', { remainingMs: this._remainingMs });

    // Auto-skip countdown
    this._autoSkipMs += dt;
    if (this._autoSkipMs >= AUTO_SKIP_MS) {
      this._skipPiece(ctx);
    }
  }

  end(ctx) {
    const score = ctx.scoreEngine?.getScore() ?? 0;
    ctx.scoreEngine?.onTimeRushCompleted();
    ctx.scoreEngine?.saveHighScore(score);
    ctx.scoreEngine?.saveToLeaderboard();
    ctx.bus?.emit('game:over', { mode: this.id, score });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  onPieceDrop(boardX, boardY, rotation, ctx) {
    const { board, factory, scoreEngine, visualManager, PieceFactory, bus } = ctx;
    if (!this._currentPiece) return false;

    const rotCells = PieceFactory.rotate(this._currentPiece.cells, rotation);
    if (!board.canPlace(rotCells, boardX, boardY)) return false;

    const placedCells = board.placePiece(rotCells, boardX, boardY, this._currentPiece.colorIndex);

    if (this._currentPiece.nexusFlags.some(Boolean)) {
      board.resolveNexusLinks(placedCells);
    }

    visualManager?.animatePiecePlacement(
      placedCells.map((c, i) => ({ x: c.x, y: c.y, isLinked: this._currentPiece.nexusFlags[i] ?? false })),
      this._currentPiece.colorIndex
    );

    scoreEngine.onPiecePlaced(performance.now());

    const result = board.processClears();
    if (result.rows.length > 0 || result.cols.length > 0) {
      for (const y of result.rows) visualManager?.animateLineClear(y);
      for (const x of result.cols) visualManager?.animateColumnClear(x);

      const totalLines = result.rows.length + result.cols.length;
      scoreEngine.onClears(result);

      // Time bonus: +2 s per line cleared, capped at 5 s total
      const canAdd = MAX_TIME_BONUS_MS - this._timeBonusUsed;
      const bonus  = Math.min(totalLines * TIME_BONUS_PER_LINE, canAdd);
      if (bonus > 0) {
        this._remainingMs    += bonus;
        this._timeBonusUsed  += bonus;
        bus?.emit('rush:timeBonus', { bonus });
      }

      // Gravity Shift recharge
      this._gravityLinesCount += totalLines;
      if (!this._gravityReady && this._gravityLinesCount >= this._gravityLinesNeeded) {
        this._gravityReady      = true;
        this._gravityLinesCount = 0;
        bus?.emit('gravityShift:charged');
      }
    } else {
      scoreEngine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
    }

    this._nextPiece(ctx);
    return true;
  }

  onGravityShiftActivate(direction, ctx) {
    if (!this._gravityReady) return false;

    const { board, scoreEngine } = ctx;
    this._gravityReady = false;
    this._gravityLinesCount = 0;

    board.applyGravity(direction);
    scoreEngine.onGravityShift();
    const result = board.processClears();
    if (result.rows.length + result.cols.length > 0) {
      scoreEngine.onClears({ ...result, isGravityCascade: true });
    }
    return true;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _nextPiece(ctx) {
    this._currentPiece    = ctx.factory.next();
    this._autoSkipMs      = 0;
    this._pieceAppearedMs = performance.now();
    ctx.scoreEngine?.onPieceAppeared(this._pieceAppearedMs);
    ctx.bus?.emit('rush:nextPiece', { piece: this._currentPiece });
  }

  _skipPiece(ctx) {
    ctx.scoreEngine?.onPieceSkipped();
    ctx.bus?.emit('rush:pieceSkipped', { piece: this._currentPiece });
    this._nextPiece(ctx);
  }
}

if (typeof module !== 'undefined') module.exports = { RushMode };
