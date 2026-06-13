/**
 * NEXUS BLOCKS — DifficultyScaler
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive difficulty system that tracks player performance metrics across
 * multiple sessions and outputs a normalised difficulty score 0.0–1.0.
 *
 * This score drives three in-game parameters:
 *   1. Piece complexity    — pool of piece shapes available
 *   2. Spawn rate          — how quickly new pieces appear (Rush mode)
 *   3. Board pre-fill %    — how many cells start filled (Classic / Puzzle)
 *
 * ── Metric Tracking ─────────────────────────────────────────────────────────
 *
 *   TRACKED (per-game-session, then aggregated):
 *     linesPerMinute    — average lines cleared per minute
 *     comboRate         — combos triggered per minute
 *     survivalTime      — total seconds survived (Classic) or score (Rush)
 *     piecesPerMinute   — placement speed
 *     avgClearSize      — average number of lines cleared per placement
 *     streakFrequency   — how often streaks of 3+ occur
 *
 *   ALGORITHM:
 *     Each metric is normalised against a reference range and combined via
 *     a weighted sum. An exponential moving average (EMA) smooths across
 *     sessions to prevent wild swings. The final difficulty score is
 *     clamped to [0.0, 1.0] and persisted via localStorage.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   const scaler = new DifficultyScaler({ storage, modeId: 'classic_endless' });
 *
 *   // At end of each game session:
 *   scaler.onSessionEnd({
 *     linesCleared  : 15,
 *     combosTriggered: 4,
 *     survivalTimeMs : 180_000,
 *     piecesPlaced   : 22,
 *     avgClearSize   : 2.1,
 *     streakMax      : 5,
 *   });
 *
 *   // Query current difficulty:
 *   const diff = scaler.getDifficulty();          // 0.0–1.0
 *   const tier = scaler.getPieceTier();           // 0, 1, or 2
 *   const fill  = scaler.getPreFillPercent();     // 0–30%
 *   const rate  = scaler.getSpawnRateMs();        // ms between pieces
 */

'use strict';

// ── Reference Ranges (for metric normalisation) ──────────────────────────────
// These define "average player" baselines. Metrics above the range push
// difficulty up; below push it down.

const REFERENCE = Object.freeze({
  // linesPerMinute: below = easy, above = hard
  linesPerMinute : { min: 1,    max: 12 },
  // comboRate: combos per minute
  comboRate      : { min: 0,    max: 6 },
  // survivalTimeMs: longer = more skilled
  survivalTimeMs : { min: 30_000, max: 600_000 },
  // piecesPerMinute
  piecesPerMinute: { min: 1,    max: 10 },
  // avgClearSize
  avgClearSize   : { min: 1,    max: 4 },
  // streakFrequency: % of placements that extend a streak
  streakFrequency: { min: 0,    max: 0.7 },
});

// ── Metric Weights (sum to 1.0) ──────────────────────────────────────────────
// Which metrics matter most for difficulty estimation.

const METRIC_WEIGHTS = Object.freeze({
  linesPerMinute    : 0.25,
  comboRate         : 0.20,
  survivalTimeMs    : 0.20,
  piecesPerMinute   : 0.10,
  avgClearSize      : 0.15,
  streakFrequency   : 0.10,
});

// ── EMA smoothing factor (0..1). Higher = more responsive, lower = smoother. ─
const EMA_ALPHA = 0.3;

// ── Difficulty-to-Parameter Mappings ─────────────────────────────────────────

/**
 * Maps difficulty score 0..1 → piece complexity tier 0|1|2.
 * Tier 0 = common pieces only, Tier 1 = +uncommon, Tier 2 = full pool.
 */
const PIECE_TIER_THRESHOLDS = [0.0, 0.35, 0.7];

/**
 * Maps difficulty score 0..1 → board pre-fill percentage 0..30%.
 */
function diffToPreFill(diff) {
  return Math.round(diff * 30);
}

/**
 * Maps difficulty score 0..1 → piece spawn interval in ms (Rush mode).
 * Easy = 2000 ms between pieces; Hard = 800 ms.
 */
function diffToSpawnRateMs(diff) {
  return Math.round(2000 - diff * 1200);
}

// ── DifficultyScaler Class ────────────────────────────────────────────────────

class DifficultyScaler {
  /**
   * @param {object} [options]
   * @param {StorageManager} [options.storage]  Persistence layer (optional)
   * @param {string}  [options.modeId='classic_endless']  Which mode these metrics apply to
   */
  constructor(options = {}) {
    this._storage = options.storage ?? null;
    this._modeId  = options.modeId  ?? 'classic_endless';

    // Load persisted EMA state or initialise fresh
    const saved = this._load();
    this._ema = saved.ema ?? {
      linesPerMinute   : 3,
      comboRate        : 1,
      survivalTimeMs   : 120_000,
      piecesPerMinute  : 3,
      avgClearSize     : 1.5,
      streakFrequency  : 0.15,
    };

    /** Number of sessions tracked. */
    this._sessionCount = saved.sessionCount ?? 0;

    /** Current raw difficulty score (computed on update). */
    this._difficulty = saved.difficulty ?? 0.25;

    /** History of last 10 difficulty scores. */
    this._history = saved.history ?? [this._difficulty];
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Call at the end of each game session with the session's stats.
   * Updates internal EMA metrics and recomputes the difficulty score.
   *
   * @param {object} session
   * @param {number} session.linesCleared
   * @param {number} session.combosTriggered
   * @param {number} session.survivalTimeMs
   * @param {number} session.piecesPlaced
   * @param {number} [session.avgClearSize=1]
   * @param {number} [session.streakMax=0]
   */
  onSessionEnd(session) {
    const {
      linesCleared    = 0,
      combosTriggered = 0,
      survivalTimeMs  = 0,
      piecesPlaced    = 1,
      avgClearSize    = 1,
      streakMax       = 0,
    } = session;

    if (survivalTimeMs <= 0) return; // Invalid session

    const minutes = Math.max(0.01, survivalTimeMs / 60_000);

    const rawMetrics = {
      linesPerMinute    : linesCleared    / minutes,
      comboRate         : combosTriggered / minutes,
      survivalTimeMs    : survivalTimeMs,
      piecesPerMinute   : piecesPlaced    / minutes,
      avgClearSize      : avgClearSize,
      streakFrequency   : piecesPlaced > 0 ? Math.min(1, streakMax / piecesPlaced) : 0,
    };

    // ── Update EMA for each metric ─────────────────────────────────────────
    for (const key of Object.keys(this._ema)) {
      const raw = rawMetrics[key] ?? this._ema[key];
      this._ema[key] = this._ema[key] * (1 - EMA_ALPHA) + raw * EMA_ALPHA;
    }

    this._sessionCount++;

    // ── Recompute difficulty ──────────────────────────────────────────────
    this._difficulty = this._computeDifficulty(this._ema);

    // Record history
    this._history.push(this._difficulty);
    if (this._history.length > 10) this._history.shift();

    // Persist
    this._save();
  }

  /**
   * Returns the current difficulty score in [0.0, 1.0].
   * @returns {number}
   */
  getDifficulty() {
    return this._difficulty;
  }

  /**
   * Returns the recommended piece complexity tier (0, 1, or 2).
   * @returns {number}
   */
  getPieceTier() {
    let tier = 0;
    for (let i = 1; i < PIECE_TIER_THRESHOLDS.length; i++) {
      if (this._difficulty >= PIECE_TIER_THRESHOLDS[i]) tier = i;
    }
    return tier;
  }

  /**
   * Returns the recommended board pre-fill percentage (0–30).
   * @returns {number}
   */
  getPreFillPercent() {
    return diffToPreFill(this._difficulty);
  }

  /**
   * Returns the recommended piece spawn interval in ms (for Rush mode).
   * @returns {number}
   */
  getSpawnRateMs() {
    return diffToSpawnRateMs(this._difficulty);
  }

  /**
   * Returns a human-readable difficulty label.
   * @returns {string}
   */
  getLabel() {
    if (this._difficulty < 0.2)  return 'Relaxed';
    if (this._difficulty < 0.4)  return 'Balanced';
    if (this._difficulty < 0.6)  return 'Challenging';
    if (this._difficulty < 0.8)  return 'Intense';
    return 'Extreme';
  }

  /**
   * Returns the raw EMA metrics snapshot (for debugging / dashboards).
   * @returns {object}
   */
  getMetrics() {
    return { ...this._ema, sessionCount: this._sessionCount };
  }

  /**
   * Returns the difficulty trend: +1 = rising, −1 = falling, 0 = stable.
   * Compares the current score against the average of the last 3 entries.
   */
  getTrend() {
    if (this._history.length < 4) return 0;
    const recent = this._history.slice(-3);
    const avg    = recent.reduce((a, b) => a + b, 0) / recent.length;
    const diff   = this._difficulty - avg;
    if (diff > 0.02)  return 1;
    if (diff < -0.02) return -1;
    return 0;
  }

  /**
   * Resets all tracking to defaults.
   */
  reset() {
    this._ema = {
      linesPerMinute   : 3,
      comboRate        : 1,
      survivalTimeMs   : 120_000,
      piecesPerMinute  : 3,
      avgClearSize     : 1.5,
      streakFrequency  : 0.15,
    };
    this._sessionCount = 0;
    this._difficulty   = 0.25;
    this._history      = [0.25];
    this._save();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Normalises a raw metric value to [0, 1] using the reference range.
   * Values below ref.min → 0; above ref.max → 1.
   * @param {number} value
   * @param {{ min:number, max:number }} ref
   * @returns {number}
   */
  _normalise(value, ref) {
    if (value <= ref.min) return 0;
    if (value >= ref.max) return 1;
    return (value - ref.min) / (ref.max - ref.min);
  }

  /**
   * Computes the difficulty score from EMA metrics.
   * Each metric is normalised then weighted-summed.
   *
   * @param {object} metrics  EMA-smoothed metrics
   * @returns {number}  0.0–1.0
   */
  _computeDifficulty(metrics) {
    let score = 0;

    for (const [key, weight] of Object.entries(METRIC_WEIGHTS)) {
      const ref    = REFERENCE[key];
      const normal = ref ? this._normalise(metrics[key], ref) : 0.5;
      score       += normal * weight;
    }

    // Apply a sigmoid-ish curve to avoid mid-range stagnation
    // Gentle S-curve pushes middling scores toward clearer tiers
    const centered = score - 0.5;
    score          = 0.5 + Math.tanh(centered * 2.2) * 0.5;

    return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  _save() {
    if (!this._storage) return;
    const key = `diff_${this._modeId}`;
    this._storage.set(key, {
      ema           : this._ema,
      sessionCount  : this._sessionCount,
      difficulty    : this._difficulty,
      history       : this._history,
    });
  }

  _load() {
    if (!this._storage) return {};
    return this._storage.get(`diff_${this._modeId}`, {});
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') module.exports = {
  DifficultyScaler, REFERENCE, METRIC_WEIGHTS, EMA_ALPHA,
  diffToPreFill, diffToSpawnRateMs, PIECE_TIER_THRESHOLDS,
};