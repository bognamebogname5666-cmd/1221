/**
 * NEXUS BLOCKS — ScoreEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete scoring module supporting all three game modes and every multiplier
 * combination documented in the GDD.
 *
 * ── Scoring Model ─────────────────────────────────────────────────────────
 *
 *  BASE CLEAR SCORE
 *    Row / column cleared                per-mode table (see MODE_SCORES)
 *    2 lines simultaneously              × 2 multi-clear multiplier
 *    3 lines simultaneously              × 3
 *    4+ lines simultaneously             × 5
 *
 *  NEXUS LINK BONUS
 *    Each linked block destroyed         +150 pts (Classic) / +200 pts (Rush)
 *
 *  CHAIN REACTION MULTIPLIER  (Nexus cascades)
 *    Each chain step                     × 1.5 (additive: step 1 = 1.5×, step 2 = 3×, …)
 *
 *  GRAVITY CASCADE MULTIPLIER  (lines cleared after Gravity Shift)
 *    First cascade clear                 × 2 base
 *    Each additional cascade line        +1× (so 2 lines = 3×, 3 lines = 4×)
 *    Window: 2 seconds after a shift
 *
 *  STREAK BONUS  (consecutive placements that clear ≥1 line)
 *    +10% per streak level, cap at +100% (10-streak)
 *    Broken if a placement clears nothing
 *
 *  SPEED BONUS  (Time Rush only)
 *    Piece placed within 0.5 s           +25 pts flat
 *    Skip penalty                        −50 pts flat
 *
 *  PERFECT PLACEMENT  (multi-clear AND chain reaction on same placement)
 *    All multipliers stack multiplicatively
 *
 *  GRAVITY-SHIFT WINDOW
 *    Lines cleared within 2 s of a shift apply Gravity Cascade multiplier
 *
 * ── Persistence ───────────────────────────────────────────────────────────
 *   High scores saved to localStorage via StorageManager keyed by mode.
 *   XP accumulated across all modes, persisted separately.
 *
 * Usage:
 *   const engine = new ScoreEngine('classic_endless', eventBus, storage);
 *   engine.reset();
 *   engine.onPiecePlaced(750);              // speedMs = ms since piece appeared
 *   engine.onClears({ rows:[3,5], cols:[], nexusDestroyed: 2, isGravityCascade: false });
 *   engine.onNexusChain(3);                 // chain step 3 → 4.5× multiplier
 *   console.log(engine.getScore());
 */

'use strict';

// ── Mode Score Tables ──────────────────────────────────────────────────────────
// Base points for clearing N lines in one placement, keyed by mode ID.

const MODE_SCORES = Object.freeze({
  classic_endless : {
    singleLine       : 100,
    doubleLine       : 300,
    tripleLine       : 600,
    quadLine         : 1000,    // 4+ lines
    nexusLinkBonus   : 150,     // per linked block destroyed
    xpPerLineClear   : 10,
  },
  puzzle_challenge : {
    singleLine       : 80,
    doubleLine       : 240,
    tripleLine       : 480,
    quadLine         : 800,
    nexusLinkBonus   : 150,
    xpPerLineClear   : 10,
  },
  time_rush : {
    singleLine       : 120,
    doubleLine       : 360,
    tripleLine       : 750,
    quadLine         : 1200,
    nexusLinkBonus   : 200,
    speedBonus       : 25,      // placed within 0.5 s
    skipPenalty      : -50,
    xpPerLineClear   : 10,
  },
});

// Multi-clear score multipliers indexed by total lines cleared (capped at 4+)
const MULTI_CLEAR_MULTIPLIER = [0, 1, 2, 3, 5, 5]; // index 0 unused; [4+] = 5

// XP sources (from GDD progression section)
const XP_SOURCES = Object.freeze({
  lineClear          : 10,
  comboBonus         : 5,
  nexusLinkTrigger   : 15,
  gravityShiftClear  : 12,
  puzzleStarEarned   : 50,
  timeRushCompleted  : 30,
  dailyChallenge     : 100,
  firstGameOfDay     : 50,
});

// ── ScoreEngine Class ──────────────────────────────────────────────────────────

class ScoreEngine {
  /**
   * @param {string}         modeId   — one of 'classic_endless' | 'puzzle_challenge' | 'time_rush'
   * @param {EventBus}       [bus]    — optional event bus
   * @param {StorageManager} [storage] — optional persistence layer
   */
  constructor(modeId = 'classic_endless', bus = null, storage = null) {
    this._modeId  = modeId;
    this._bus     = bus;
    this._storage = storage;

    // Resolved score table for this mode (falls back to classic if unknown)
    this._table   = MODE_SCORES[modeId] ?? MODE_SCORES.classic_endless;

    // ── Runtime score state ─────────────────────────────────────────────────
    /** Current session score. */
    this._score   = 0;

    /** XP earned this session. */
    this._xp      = 0;

    // ── Streak tracker ──────────────────────────────────────────────────────
    /** Number of consecutive piece placements that cleared ≥1 line. */
    this._streak  = 0;

    // ── Gravity Shift window ────────────────────────────────────────────────
    /** Timestamp (ms) of the last gravity shift. 0 = no shift active. */
    this._gravityShiftTime = 0;

    /** Duration (ms) of the gravity cascade multiplier window. */
    this._gravityCascadeWindow = 2000;

    // ── Timing (Rush mode speed bonus) ─────────────────────────────────────
    /** Timestamp (ms) when the current piece appeared in Rush mode. */
    this._pieceAppearedAt = 0;

    // ── Accumulated stats for the session ───────────────────────────────────
    this._stats = {
      linesCleared     : 0,
      colsCleared      : 0,
      piecesPlaced     : 0,
      nexusDestroyed   : 0,
      maxCombo         : 0,
      maxStreak        : 0,
      perfectPlacements: 0,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Resets all session state. Call at the start of every new game.
   */
  reset() {
    this._score            = 0;
    this._xp               = 0;
    this._streak           = 0;
    this._gravityShiftTime = 0;
    this._pieceAppearedAt  = 0;
    this._stats = {
      linesCleared: 0, colsCleared: 0, piecesPlaced: 0,
      nexusDestroyed: 0, maxCombo: 0, maxStreak: 0, perfectPlacements: 0,
    };
    this._bus?.emit('score:updated', { score: 0, delta: 0, multiplier: 1 });
  }

  /**
   * Called each game-loop tick to update time-based mechanics
   * (Gravity Shift window expiry, etc.).
   * @param {number} dt — fixed timestep in ms
   */
  tick(dt) {
    // Nothing to do per-tick currently beyond the existing timer tracking
    // (gravity shift window checked inline in onClears).
    // Kept for future time-based score events (e.g., Rush mode bonus second timer).
  }

  // ── Scoring Events ─────────────────────────────────────────────────────────

  /**
   * Notify the engine that a piece was placed on the board.
   * Handles Rush mode speed bonus and resets the piece-appearance timer.
   *
   * @param {number} [nowMs=performance.now()]  Current timestamp
   */
  onPiecePlaced(nowMs = performance.now()) {
    this._stats.piecesPlaced++;

    if (this._modeId === 'time_rush' && this._pieceAppearedAt > 0) {
      const elapsed = nowMs - this._pieceAppearedAt;
      if (elapsed <= 500 && this._table.speedBonus) {
        this._addScore(this._table.speedBonus, 1, 'speed_bonus');
      }
    }

    // Reset for next piece
    this._pieceAppearedAt = nowMs;
  }

  /**
   * Notify the engine that the current piece was skipped (Rush mode only).
   */
  onPieceSkipped() {
    if (this._modeId !== 'time_rush') return;
    const penalty = this._table.skipPenalty ?? -50;
    this._addScore(penalty, 1, 'skip_penalty');
    this._bus?.emit('score:updated', { score: this._score, delta: penalty, multiplier: 1 });
  }

  /**
   * Core scoring event — called after processClears() resolves all line/column
   * clears for a single piece placement.
   *
   * @param {object} clearResult
   * @param {number[]} clearResult.rows              — cleared row indices
   * @param {number[]} clearResult.cols              — cleared column indices
   * @param {number}   clearResult.nexusDestroyed    — total linked blocks destroyed (direct + chain)
   * @param {boolean}  [clearResult.isGravityCascade=false] — true if this clear was triggered by a Gravity Shift
   * @param {number}   [nowMs=performance.now()]
   * @returns {{ delta: number, multiplier: number }}  — points awarded this placement
   */
  onClears(clearResult, nowMs = performance.now()) {
    const { rows = [], cols = [], nexusDestroyed = 0 } = clearResult;
    const totalLines = rows.length + cols.length;

    if (totalLines === 0 && nexusDestroyed === 0) {
      // No lines cleared — break streak
      this._breakStreak();
      return { delta: 0, multiplier: 1 };
    }

    // ── 1. Base score for line clears ──────────────────────────────────────
    const baseScore = this._calcBaseScore(totalLines);

    // ── 2. Multi-clear multiplier (simultaneous lines in one placement) ────
    const multiMult = MULTI_CLEAR_MULTIPLIER[Math.min(totalLines, 5)] ?? 5;

    // ── 3. Gravity Cascade multiplier ────────────────────────────────────
    let gravMult = 1;
    const inCascadeWindow = this._gravityShiftTime > 0 &&
      (nowMs - this._gravityShiftTime) <= this._gravityCascadeWindow;

    if (inCascadeWindow || clearResult.isGravityCascade) {
      // Base 2×, +1× per extra line
      gravMult = 2 + Math.max(0, totalLines - 1);
    }

    // ── 4. Streak multiplier ───────────────────────────────────────────────
    // +10% per streak level, capped at +100% (10-streak = ×2)
    const streakMult = 1 + Math.min(this._streak, 10) * 0.1;

    // ── 5. Combined multiplier ─────────────────────────────────────────────
    const combinedMult = multiMult * gravMult * streakMult;

    // ── 6. Final line-clear points ─────────────────────────────────────────
    let delta = Math.round(baseScore * combinedMult);

    // ── 7. Nexus Link bonus ────────────────────────────────────────────────
    if (nexusDestroyed > 0) {
      const nexusBonus = nexusDestroyed * (this._table.nexusLinkBonus ?? 150);
      delta += nexusBonus;
      this._stats.nexusDestroyed += nexusDestroyed;
      this._earnXP(nexusDestroyed * XP_SOURCES.nexusLinkTrigger);

      this._bus?.emit('combo:triggered', {
        type       : 'nexus_link',
        multiplier : combinedMult,
        nexusCount : nexusDestroyed,
      });
    }

    // ── 8. Gravity cascade XP ─────────────────────────────────────────────
    if (inCascadeWindow || clearResult.isGravityCascade) {
      this._earnXP(totalLines * XP_SOURCES.gravityShiftClear);
    }

    // ── 9. Update stats & streak ───────────────────────────────────────────
    this._stats.linesCleared += rows.length;
    this._stats.colsCleared  += cols.length;
    this._addScore(delta, combinedMult, 'line_clear');
    this._earnXP(totalLines * XP_SOURCES.lineClear);

    this._streak++;
    if (this._streak > this._stats.maxStreak) this._stats.maxStreak = this._streak;
    this._bus?.emit('streak:changed', { streak: this._streak });

    if (multiMult > 1) this._earnXP(XP_SOURCES.comboBonus);

    return { delta, multiplier: combinedMult };
  }

  /**
   * Called when a Nexus chain reaction occurs (propagation step).
   * Stacks additional multiplier on top of the existing clear.
   *
   * The GDD specifies: each chain step adds +1.5× to the total.
   *   step 1 = 1.5×, step 2 = 3.0×, step 3 = 4.5×, …
   *
   * Typically called by the board's 'nexus:chain' event handler in the
   * active game mode, then the mode calls onClears() for the resulting lines.
   *
   * @param {number} chainStep  1-based chain step index
   * @returns {number}  The chain multiplier (used by caller to scale bonus)
   */
  onNexusChain(chainStep) {
    const mult  = chainStep * 1.5;
    const bonus = Math.round(50 * mult); // flat bonus per chain step

    this._addScore(bonus, mult, 'nexus_chain');

    const maxChain = Math.max(this._stats.maxCombo, chainStep);
    this._stats.maxCombo = maxChain;

    this._bus?.emit('combo:triggered', {
      type      : 'chain_reaction',
      multiplier: mult,
      chainStep,
    });

    return mult;
  }

  /**
   * Records the timestamp of a Gravity Shift, starting the 2-second cascade window.
   * @param {number} [nowMs=performance.now()]
   */
  onGravityShift(nowMs = performance.now()) {
    this._gravityShiftTime = nowMs;
  }

  /**
   * Records when a new piece appears in the tray (for Rush mode speed bonus timing).
   * @param {number} [nowMs=performance.now()]
   */
  onPieceAppeared(nowMs = performance.now()) {
    this._pieceAppearedAt = nowMs;
  }

  /**
   * Awards XP for a puzzle star rating.
   * @param {1|2|3} stars
   */
  onPuzzleStarEarned(stars) {
    this._earnXP(XP_SOURCES.puzzleStarEarned * stars);
  }

  /**
   * Awards XP for completing a Time Rush round.
   */
  onTimeRushCompleted() {
    this._earnXP(XP_SOURCES.timeRushCompleted);
  }

  // ── Score Accessors ────────────────────────────────────────────────────────

  /** @returns {number} Current session score. */
  getScore() { return this._score; }

  /** @returns {number} XP earned this session. */
  getXP()    { return this._xp; }

  /** @returns {number} Current streak length. */
  getStreak() { return this._streak; }

  /** @returns {object} Copy of the session stats object. */
  getStats()  { return { ...this._stats }; }

  /**
   * Returns the stored all-time high score for the current mode.
   * @returns {number}
   */
  getHighScore() {
    return this._storage?.get(`highscore_${this._modeId}`) ?? 0;
  }

  /**
   * Saves the given score as the high score if it beats the stored value.
   * @param {number} score
   * @returns {boolean} true if a new high score was set
   */
  saveHighScore(score) {
    const prev = this.getHighScore();
    if (score > prev) {
      this._storage?.set(`highscore_${this._modeId}`, score);
      this._bus?.emit('score:newHighScore', { mode: this._modeId, score });
      return true;
    }
    return false;
  }

  /**
   * Returns a leaderboard snapshot: top 10 scores for this mode.
   * @returns {Array<{ score:number, date:string }>}
   */
  getLeaderboard() {
    return this._storage?.get(`leaderboard_${this._modeId}`) ?? [];
  }

  /**
   * Appends the current score to the local leaderboard (top 10, descending).
   */
  saveToLeaderboard() {
    const board  = this.getLeaderboard();
    const entry  = { score: this._score, date: new Date().toISOString() };

    board.push(entry);
    board.sort((a, b) => b.score - a.score);
    board.splice(10); // keep top 10

    this._storage?.set(`leaderboard_${this._modeId}`, board);
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Returns the base score for clearing N total lines in one placement,
   * using the active mode's score table.
   * @private
   */
  _calcBaseScore(totalLines) {
    const t = this._table;
    if (totalLines <= 0) return 0;
    if (totalLines === 1) return t.singleLine;
    if (totalLines === 2) return t.doubleLine;
    if (totalLines === 3) return t.tripleLine;
    return t.quadLine + (totalLines - 4) * Math.round(t.quadLine * 0.5);
  }

  /**
   * Adds `delta` points to the current score and emits a score:updated event.
   * @private
   * @param {number} delta
   * @param {number} multiplier
   * @param {string} source  — label for debugging
   */
  _addScore(delta, multiplier, source) {
    this._score = Math.max(0, this._score + delta);
    this._bus?.emit('score:updated', {
      score      : this._score,
      delta,
      multiplier,
      source,
    });
  }

  /**
   * Accumulates XP for this session.
   * @private
   * @param {number} amount
   */
  _earnXP(amount) {
    if (amount <= 0) return;
    this._xp += amount;
    this._bus?.emit('xp:earned', { xp: this._xp, delta: amount });
  }

  /**
   * Resets the streak counter to 0 and emits streak:changed.
   * @private
   */
  _breakStreak() {
    if (this._streak === 0) return;
    this._streak = 0;
    this._bus?.emit('streak:changed', { streak: 0 });
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { ScoreEngine, MODE_SCORES, XP_SOURCES };
