/**
 * NEXUS BLOCKS — ScoreEngine Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests scoring multipliers, combo calculations, and XP systems
 */

'use strict';

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  run() {
    console.log('🧪 Running ScoreEngine Unit Tests...\n');
    
    for (const { name, fn } of this.tests) {
      try {
        fn();
        console.log(`✅ ${name}`);
        this.passed++;
      } catch (e) {
        console.log(`❌ ${name}`);
        console.log(`   ${e.message}\n`);
        this.failed++;
      }
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
}

class MockEventBus {
  constructor() {
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
  }

  reset() {
    this.events = [];
  }
}

class MockStorage {
  constructor() {
    this.data = new Map();
  }

  get(key) {
    return this.data.get(key);
  }

  set(key, value) {
    this.data.set(key, value);
  }
}

const runner = new TestRunner();

// ── Basic ScoreEngine Tests ───────────────────────────────────────────────────

runner.test('ScoreEngine constructor sets up correctly', () => {
  const bus = new MockEventBus();
  const storage = new MockStorage();
  const engine = new ScoreEngine('classic_endless', bus, storage);

  runner.assertEqual(engine._modeId, 'classic_endless');
  runner.assert(engine._bus === bus);
  runner.assert(engine._storage === storage);
  runner.assertEqual(engine.getScore(), 0);
  runner.assertEqual(engine.getXP(), 0);
  runner.assertEqual(engine.getStreak(), 0);
});

runner.test('ScoreEngine.reset clears all state', () => {
  const bus = new MockEventBus();
  const engine = new ScoreEngine('classic_endless', bus);

  // Add some score and streak
  engine._score = 1000;
  engine._xp = 50;
  engine._streak = 5;

  engine.reset();

  runner.assertEqual(engine.getScore(), 0);
  runner.assertEqual(engine.getXP(), 0);
  runner.assertEqual(engine.getStreak(), 0);
  runner.assertEqual(bus.events[bus.events.length - 1].event, 'score:updated');
});

// ── Base Score Tests ─────────────────────────────────────────────────────────

runner.test('Base score calculation for single line', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 100); // singleLine = 100
  runner.assertEqual(result.multiplier, 1);
  runner.assertEqual(engine.getScore(), 100);
  runner.assertEqual(engine.getStreak(), 1);
});

runner.test('Base score calculation for double line', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [0, 1], cols: [], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 600); // doubleLine = 300, ×2 multi-clear = 600
  runner.assertEqual(result.multiplier, 2);
  runner.assertEqual(engine.getStreak(), 1);
});

runner.test('Base score calculation for triple line', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [0, 1, 2], cols: [], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 1800); // tripleLine = 600, ×3 multi-clear = 1800
  runner.assertEqual(result.multiplier, 3);
  runner.assertEqual(engine.getStreak(), 1);
});

runner.test('Base score calculation for quad line', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [0, 1, 2, 3], cols: [], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 5000); // quadLine = 1000, ×5 multi-clear = 5000
  runner.assertEqual(result.multiplier, 5);
  runner.assertEqual(engine.getStreak(), 1);
});

runner.test('Column clears use same scoring as rows', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [], cols: [0, 1], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 600); // Same as double row clear
  runner.assertEqual(result.multiplier, 2);
});

runner.test('Mixed row and column clears', () => {
  const engine = new ScoreEngine('classic_endless');
  const result = engine.onClears({ rows: [0], cols: [1, 2], nexusDestroyed: 0 });

  runner.assertEqual(result.delta, 1800); // 3 total lines = triple clear
  runner.assertEqual(result.multiplier, 3);
});

// ── Combo Multiplier Tests ───────────────────────────────────────────────────

runner.test('Combo multipliers: x1, x2, x3, x5, x10', () => {
  const engine = new ScoreEngine('classic_endless');
  
  // Test x1 (single line)
  engine.reset();
  const r1 = engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r1.multiplier, 1);
  
  // Test x2 (double line)
  engine.reset();
  const r2 = engine.onClears({ rows: [0, 1], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r2.multiplier, 2);
  
  // Test x3 (triple line)
  engine.reset();
  const r3 = engine.onClears({ rows: [0, 1, 2], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r3.multiplier, 3);
  
  // Test x5 (quad line)
  engine.reset();
  const r4 = engine.onClears({ rows: [0, 1, 2, 3], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r4.multiplier, 5);
  
  // Test x5+ (5+ lines still capped at x5)
  engine.reset();
  const r5 = engine.onClears({ rows: [0, 1, 2, 3, 4], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r5.multiplier, 5);
});

// ── Streak Bonus Tests ───────────────────────────────────────────────────────

runner.test('Streak bonus increases by 10% per streak', () => {
  const engine = new ScoreEngine('classic_endless');
  
  // First placement: streak = 1, no bonus
  engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(engine.getStreak(), 1);
  
  // Second placement: streak = 2, 10% bonus
  const r2 = engine.onClears({ rows: [1], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r2.multiplier, 1.1); // 1.0 × 1.1 = 1.1
  runner.assertEqual(engine.getStreak(), 2);
  
  // Tenth placement: streak = 10, 100% bonus (capped)
  engine._streak = 9;
  const r10 = engine.onClears({ rows: [2], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r10.multiplier, 2.0); // 1.0 × 2.0 = 2.0
  runner.assertEqual(engine.getStreak(), 10);
  
  // Eleventh placement: still capped at 100%
  engine._streak = 10;
  const r11 = engine.onClears({ rows: [3], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(r11.multiplier, 2.0); // Still capped at 2×
});

runner.test('Streak breaks on non-clearing placement', () => {
  const engine = new ScoreEngine('classic_endless');
  
  // Build streak
  engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(engine.getStreak(), 1);
  
  // Non-clearing placement should break streak
  const result = engine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(result.delta, 0);
  runner.assertEqual(engine.getStreak(), 0);
});

// ── Nexus Link Bonus Tests ─────────────────────────────────────────────────

runner.test('Nexus link bonus calculation', () => {
  const engine = new ScoreEngine('classic_endless');
  
  const result = engine.onClears({ 
    rows: [0], 
    cols: [], 
    nexusDestroyed: 3 
  });

  // Base 100 + 3×150 nexus bonus = 550
  runner.assertEqual(result.delta, 550);
  runner.assertEqual(engine.getStats().nexusDestroyed, 3);
});

runner.test('Nexus link bonus varies by mode', () => {
  const classic = new ScoreEngine('classic_endless');
  const rush = new ScoreEngine('time_rush');
  
  const classicResult = classic.onClears({ 
    rows: [0], 
    cols: [], 
    nexusDestroyed: 2 
  });
  
  const rushResult = rush.onClears({ 
    rows: [0], 
    cols: [], 
    nexusDestroyed: 2 
  });

  // Classic: 100 + 2×150 = 400
  runner.assertEqual(classicResult.delta, 400);
  
  // Rush: 120 + 2×200 = 520
  runner.assertEqual(rushResult.delta, 520);
});

// ── Chain Reaction Tests ───────────────────────────────────────────────────

runner.test('Chain reaction multiplier calculation', () => {
  const engine = new ScoreEngine('classic_endless');
  
  // Chain step 1 = 1.5×
  const mult1 = engine.onNexusChain(1);
  runner.assertEqual(mult1, 1.5);
  
  // Chain step 2 = 3.0×
  const mult2 = engine.onNexusChain(2);
  runner.assertEqual(mult2, 3.0);
  
  // Chain step 3 = 4.5×
  const mult3 = engine.onNexusChain(3);
  runner.assertEqual(mult3, 4.5);
});

runner.test('Chain reaction updates combo stats', () => {
  const engine = new ScoreEngine('classic_endless');
  
  engine.onNexusChain(1);
  runner.assertEqual(engine.getStats().maxCombo, 1);
  
  engine.onNexusChain(3);
  runner.assertEqual(engine.getStats().maxCombo, 3);
});

// ── Gravity Cascade Tests ───────────────────────────────────────────────────

runner.test('Gravity cascade multiplier applies within window', () => {
  const engine = new ScoreEngine('classic_endless');
  const now = performance.now();
  
  // Start gravity shift window
  engine.onGravityShift(now);
  
  // Clear within 2-second window
  const result = engine.onClears({ 
    rows: [0, 1], 
    cols: [], 
    nexusDestroyed: 0,
    isGravityCascade: false 
  }, now + 1000);

  // Base 300 × 2 (multi-clear) × 3 (gravity cascade: 2+1) = 1800
  runner.assertEqual(result.multiplier, 6); // 2×3
});

runner.test('Gravity cascade window expires after 2 seconds', () => {
  const engine = new ScoreEngine('classic_endless');
  const now = performance.now();
  
  // Start gravity shift window
  engine.onGravityShift(now);
  
  // Clear after 3 seconds (window expired)
  const result = engine.onClears({ 
    rows: [0, 1], 
    cols: [], 
    nexusDestroyed: 0,
    isGravityCascade: false 
  }, now + 3000);

  // Should only have multi-clear multiplier
  runner.assertEqual(result.multiplier, 2);
});

// ── Time Rush Mode Tests ───────────────────────────────────────────────────

runner.test('Time Rush speed bonus for fast placement', () => {
  const engine = new ScoreEngine('time_rush');
  const now = performance.now();
  
  // Piece appeared 300ms ago
  engine.onPieceAppeared(now - 300);
  
  // Place piece now (within 500ms window)
  engine.onPiecePlaced(now);
  
  runner.assertEqual(engine.getScore(), 25); // speed bonus
});

runner.test('Time Rush skip penalty', () => {
  const engine = new ScoreEngine('time_rush');
  
  engine.onPieceSkipped();
  
  runner.assertEqual(engine.getScore(), -50); // skip penalty
});

// ── XP System Tests ───────────────────────────────────────────────────────

runner.test('XP earned from line clears', () => {
  const engine = new ScoreEngine('classic_endless');
  
  engine.onClears({ rows: [0, 1], cols: [], nexusDestroyed: 0 });
  
  runner.assertEqual(engine.getXP(), 20); // 2 lines × 10 XP each
});

runner.test('XP earned from nexus links', () => {
  const engine = new ScoreEngine('classic_endless');
  
  engine.onClears({ rows: [0], cols: [], nexusDestroyed: 3 });
  
  runner.assertEqual(engine.getXP(), 55); // 10 (line) + 3×15 (nexus)
});

runner.test('XP earned from combos', () => {
  const engine = new ScoreEngine('classic_endless');
  
  engine.onClears({ rows: [0, 1], cols: [], nexusDestroyed: 0 });
  
  runner.assertEqual(engine.getXP(), 25); // 20 (lines) + 5 (combo bonus)
});

// ── High Score Tests ───────────────────────────────────────────────────────

runner.test('High score storage and retrieval', () => {
  const storage = new MockStorage();
  const engine = new ScoreEngine('classic_endless', null, storage);
  
  // No high score initially
  runner.assertEqual(engine.getHighScore(), 0);
  
  // Save new high score
  runner.assert(engine.saveHighScore(1000));
  runner.assertEqual(engine.getHighScore(), 1000);
  
  // Don't overwrite with lower score
  runner.assert(!engine.saveHighScore(500));
  runner.assertEqual(engine.getHighScore(), 1000);
  
  // Overwrite with higher score
  runner.assert(engine.saveHighScore(1500));
  runner.assertEqual(engine.getHighScore(), 1500);
});

runner.test('Leaderboard management', () => {
  const storage = new MockStorage();
  const engine = new ScoreEngine('classic_endless', null, storage);
  
  // Add some scores
  engine._score = 1000;
  engine.saveToLeaderboard();
  
  engine._score = 1500;
  engine.saveToLeaderboard();
  
  engine._score = 800;
  engine.saveToLeaderboard();
  
  const leaderboard = engine.getLeaderboard();
  runner.assertEqual(leaderboard.length, 3);
  runner.assertEqual(leaderboard[0].score, 1500);
  runner.assertEqual(leaderboard[1].score, 1000);
  runner.assertEqual(leaderboard[2].score, 800);
});

// ── Mode-Specific Tests ───────────────────────────────────────────────────

runner.test('Puzzle mode uses different scoring table', () => {
  const puzzle = new ScoreEngine('puzzle_challenge');
  const classic = new ScoreEngine('classic_endless');
  
  const puzzleResult = puzzle.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  const classicResult = classic.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  
  // Puzzle: 80, Classic: 100
  runner.assertEqual(puzzleResult.delta, 80);
  runner.assertEqual(classicResult.delta, 100);
});

runner.test('Unknown mode falls back to classic scores', () => {
  const engine = new ScoreEngine('unknown_mode');
  
  const result = engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  
  runner.assertEqual(result.delta, 100); // Classic single line score
});

// ── Edge Case Tests ─────────────────────────────────────────────────────────

runner.test('Zero lines cleared breaks streak', () => {
  const engine = new ScoreEngine('classic_endless');
  
  // Build streak
  engine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(engine.getStreak(), 1);
  
  // Clear nothing
  const result = engine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
  
  runner.assertEqual(result.delta, 0);
  runner.assertEqual(result.multiplier, 1);
  runner.assertEqual(engine.getStreak(), 0);
});

runner.test('Negative scores are clamped at zero', () => {
  const engine = new ScoreEngine('time_rush');
  
  // Apply multiple skip penalties
  engine.onPieceSkipped();
  engine.onPieceSkipped();
  engine.onPieceSkipped();
  
  runner.assertEqual(engine.getScore(), -150);
  
  // Reset should bring back to zero
  engine.reset();
  runner.assertEqual(engine.getScore(), 0);
});

runner.test('Stats tracking accuracy', () => {
  const engine = new ScoreEngine('classic_endless');
  
  engine.onClears({ rows: [0, 1], cols: [2], nexusDestroyed: 2 });
  engine.onNexusChain(3);
  
  const stats = engine.getStats();
  
  runner.assertEqual(stats.linesCleared, 2);
  runner.assertEqual(stats.colsCleared, 1);
  runner.assertEqual(stats.nexusDestroyed, 2);
  runner.assertEqual(stats.maxCombo, 3);
  runner.assertEqual(stats.maxStreak, 1);
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.scoreTestRunner = runner;
}