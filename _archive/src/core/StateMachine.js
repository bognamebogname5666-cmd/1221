/**
 * NEXUS BLOCKS — State Machine
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages top-level game state transitions using the enter/update/exit pattern.
 *
 * State graph:
 *
 *        ┌──────────────────────────────────────┐
 *        │                                      ▼
 *   [BOOT] ──► [MENU] ──► [PLAYING] ──► [PAUSED]
 *                │              │
 *                │              ▼
 *                │         [GAME_OVER] ──► [RESULTS] ──► [MENU]
 *                │              │
 *                └──────────────┘ (restart shortcut)
 *
 * Each state object implements three lifecycle hooks:
 *   enter(prevState, context)  — fired once when transitioning INTO this state
 *   update(dt, context)        — fired every game tick while this state is active
 *   exit(nextState, context)   — fired once when leaving this state
 *
 * `context` is the shared game context object (board, scoreEngine, loop, etc.)
 * injected by the caller so states can access everything they need without
 * being tightly coupled to a global singleton.
 */

'use strict';

/** Canonical state name constants — import and use instead of raw strings. */
const GameState = Object.freeze({
  BOOT      : 'BOOT',
  MENU      : 'MENU',
  PLAYING   : 'PLAYING',
  PAUSED    : 'PAUSED',
  GAME_OVER : 'GAME_OVER',
  RESULTS   : 'RESULTS',
});

/**
 * Valid transitions: which states a given state may transition to.
 * Enforced at runtime to catch programming errors early.
 *
 * @type {Map<string, Set<string>>}
 */
const VALID_TRANSITIONS = new Map([
  [GameState.BOOT,      new Set([GameState.MENU])],
  [GameState.MENU,      new Set([GameState.PLAYING])],
  [GameState.PLAYING,   new Set([GameState.PAUSED, GameState.GAME_OVER])],
  [GameState.PAUSED,    new Set([GameState.PLAYING, GameState.MENU])],
  [GameState.GAME_OVER, new Set([GameState.RESULTS, GameState.MENU])],
  [GameState.RESULTS,   new Set([GameState.MENU, GameState.PLAYING])],
]);

// ── Individual State Definitions ──────────────────────────────────────────────
// Each state is a plain object. The StateMachine injects `context` so states
// can access the board, scoreEngine, loop, visualManager, etc.

const BootState = {
  name: GameState.BOOT,

  enter(prev, ctx) {
    // Preload fonts, fire initial layout calculations
    ctx.screenManager?.showScreen('boot');
  },

  update(dt, ctx) {
    // Boot is transient — typically transitions immediately to MENU
    // after async asset loading completes (handled by the loader)
  },

  exit(next, ctx) {
    ctx.screenManager?.hideScreen('boot');
  },
};

const MenuState = {
  name: GameState.MENU,

  enter(prev, ctx) {
    // stop() (not pause()) so that a subsequent PlayingState.enter can call
    // loop.start() and get a clean reset rather than a no-op.
    ctx.loop?.stop();
    ctx.screenManager?.showScreen('menu');
    ctx.audioEngine?.playMenuMusic();
    ctx.bus?.emit('game:state', { from: prev, to: GameState.MENU });
  },

  update(dt, ctx) {
    // Menu animations are driven by CSS; no logic update needed here.
    // The idle background canvas is updated separately in render().
  },

  exit(next, ctx) {
    ctx.screenManager?.hideScreen('menu');
    ctx.audioEngine?.stopMenuMusic();
  },
};

const PlayingState = {
  name: GameState.PLAYING,

  enter(prev, ctx) {
    if (prev === GameState.PAUSED) {
      // Resume from pause — loop was already paused, just resume it
      ctx.loop?.resume();
      ctx.screenManager?.hideOverlay('pause');
      ctx.audioEngine?.resumeMusic();
    } else {
      // Fresh game start: initialise board, pieces, score
      ctx.board?.reset();
      ctx.scoreEngine?.reset();
      ctx._gameStartTime = performance.now();
      ctx._prevHighScore = null; // cleared; populated again in GameOverState
      ctx.activeMode?.start(ctx);
      ctx.loop?.start();
      ctx.screenManager?.showScreen('game');
      ctx.audioEngine?.playGameMusic();
    }
    ctx.bus?.emit('game:state', { from: prev, to: GameState.PLAYING });
  },

  /**
   * Core simulation tick.
   * Delegates to the active game mode so each mode (Classic, Rush, Puzzle)
   * can implement its own per-tick logic.
   *
   * @param {number}  dt   — fixed timestep in ms (always TICK_MS ≈ 16.67)
   * @param {object}  ctx  — shared game context
   */
  update(dt, ctx) {
    ctx.activeMode?.update(dt, ctx);
    ctx.scoreEngine?.tick(dt);
    ctx.audioEngine?.tick(dt);
  },

  exit(next, ctx) {
    if (next !== GameState.PAUSED) {
      // Full exit (game over, back to menu): stop the simulation
      ctx.loop?.stop();
      ctx.audioEngine?.stopGameMusic();
    } else {
      // Just pausing: freeze simulation but keep rAF alive for overlay anim
      ctx.loop?.pause();
      ctx.audioEngine?.pauseMusic();
    }
  },
};

const PausedState = {
  name: GameState.PAUSED,

  enter(prev, ctx) {
    ctx.screenManager?.showOverlay('pause');
    ctx.bus?.emit('game:state', { from: prev, to: GameState.PAUSED });
  },

  update(dt, ctx) {
    // Simulation is frozen — nothing to update.
    // The pause overlay renders itself via CSS animations.
  },

  exit(next, ctx) {
    ctx.screenManager?.hideOverlay('pause');
    ctx.bus?.emit('game:state', { from: GameState.PAUSED, to: next });
  },
};

const GameOverState = {
  name: GameState.GAME_OVER,

  enter(prev, ctx) {
    ctx.screenManager?.showOverlay('game-over');
    ctx.audioEngine?.playGameOverSfx();

    // Capture the PREVIOUS high score before persisting the new one so
    // ResultsState can correctly determine whether we beat it. Otherwise
    // saveHighScore() makes score === highScore and the "new record" badge
    // would always light up.
    const finalScore = ctx.scoreEngine?.getScore() ?? 0;
    ctx._prevHighScore = ctx.scoreEngine?.getHighScore() ?? 0;

    ctx.scoreEngine?.saveHighScore(finalScore);
    ctx.bus?.emit('game:over', { score: finalScore });
    ctx.bus?.emit('game:state', { from: prev, to: GameState.GAME_OVER });
  },

  update(dt, ctx) {
    // Board is frozen; game-over overlay handles its own animations.
  },

  exit(next, ctx) {
    ctx.screenManager?.hideOverlay('game-over');
  },
};

const ResultsState = {
  name: GameState.RESULTS,

  enter(prev, ctx) {
    const score      = ctx.scoreEngine?.getScore()     ?? 0;
    const highScore  = ctx.scoreEngine?.getHighScore() ?? 0;

    // Use the high score captured BEFORE this game's saveHighScore() call
    // (see GameOverState.enter). Fall back to the live value when arriving
    // here via a non-standard path.
    const prevHigh   = ctx._prevHighScore ?? highScore;

    // Only celebrate a record when the player actually beat their best AND
    // scored more than zero. Prevents "NEW RECORD!" on a 0-point first run.
    const isNewRecord = score > 0 && score > prevHigh;

    // Forward extra fields the results screen template knows how to render.
    const stats   = ctx.scoreEngine?.getStats?.() ?? {};
    const timeMs  = ctx._gameStartTime ? (performance.now() - ctx._gameStartTime) : 0;

    ctx.screenManager?.showScreen('results', {
      score,
      highScore,
      isNewRecord,
      lines     : (stats.linesCleared ?? 0) + (stats.colsCleared ?? 0),
      bestCombo : stats.maxCombo ?? 0,
      timeMs,
      level     : 1,
    });
    ctx.audioEngine?.playResultsMusic(isNewRecord);
    ctx.bus?.emit('game:state', { from: prev, to: GameState.RESULTS });
  },

  update(dt, ctx) {
    // Results screen is static; no simulation needed.
  },

  exit(next, ctx) {
    ctx.screenManager?.hideScreen('results');
    ctx.audioEngine?.stopResultsMusic();
  },
};

// ── State Machine Class ────────────────────────────────────────────────────────

class StateMachine {
  /**
   * @param {object}   context   — shared game context injected into every state
   * @param {EventBus} [context.bus]  — optional event bus for state-change events
   */
  constructor(context = {}) {
    this._ctx    = context;
    this._states = {
      [GameState.BOOT]      : BootState,
      [GameState.MENU]      : MenuState,
      [GameState.PLAYING]   : PlayingState,
      [GameState.PAUSED]    : PausedState,
      [GameState.GAME_OVER] : GameOverState,
      [GameState.RESULTS]   : ResultsState,
    };

    /** @type {string} The currently active state name. */
    this.current = null;

    /** @type {string[]} History of state names (most recent last). */
    this.history = [];
  }

  // ── API ────────────────────────────────────────────────────────────────────

  /**
   * Transitions to a new state.
   *
   * Flow:
   *   currentState.exit(nextStateName, ctx)
   *   nextState.enter(prevStateName, ctx)
   *   this.current = nextStateName
   *
   * @param {string} nextStateName — one of GameState.*
   * @throws {Error} if the transition is not permitted
   */
  transition(nextStateName) {
    if (nextStateName === this.current) return; // no-op

    // Validate the transition
    if (this.current !== null) {
      const allowed = VALID_TRANSITIONS.get(this.current);
      if (!allowed?.has(nextStateName)) {
        throw new Error(
          `StateMachine: invalid transition "${this.current}" → "${nextStateName}". ` +
          `Allowed: [${allowed ? [...allowed].join(', ') : 'none'}]`
        );
      }
    }

    const prevName = this.current;
    const prevState = prevName ? this._states[prevName] : null;
    const nextState = this._states[nextStateName];

    if (!nextState) {
      throw new Error(`StateMachine: unknown state "${nextStateName}"`);
    }

    // Call exit on the current state
    prevState?.exit(nextStateName, this._ctx);

    // Record history (keep last 10 entries)
    if (prevName) this.history.push(prevName);
    if (this.history.length > 10) this.history.shift();

    this.current = nextStateName;

    // Call enter on the new state
    nextState.enter(prevName, this._ctx);
  }

  /**
   * Calls update() on the active state.
   * Should be called from the game loop's update callback.
   *
   * @param {number} dt — fixed timestep in ms
   */
  update(dt) {
    if (!this.current) return;
    this._states[this.current]?.update(dt, this._ctx);
  }

  /**
   * Returns the active state object (for inspection/testing).
   * @returns {{ name: string, enter, update, exit } | null}
   */
  get activeState() {
    return this.current ? this._states[this.current] : null;
  }

  /**
   * Returns the name of the previous state (last entry in history).
   * @returns {string | null}
   */
  get previousState() {
    return this.history[this.history.length - 1] ?? null;
  }

  /**
   * Convenience check — returns true when the current state is the given name.
   * @param {string} stateName
   * @returns {boolean}
   */
  is(stateName) {
    return this.current === stateName;
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { StateMachine, GameState, VALID_TRANSITIONS };
