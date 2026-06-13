/**
 * NEXUS BLOCKS — Game Over Detection Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests game over conditions for all game modes
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
    console.log('🧪 Running Game Over Detection Unit Tests...\n');
    
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
}

class MockEventBus {
  constructor() {
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
  }
}

const runner = new TestRunner();

// Mock game modes for testing
class MockClassicMode {
  constructor(board, bus) {
    this.board = board;
    this.bus = bus;
    this.gameOver = false;
  }

  start() {
    this.gameOver = false;
  }

  checkGameOver() {
    // Classic mode: game over when no valid placement exists
    const factory = new PieceFactory();
    const allPieces = PieceFactory.DEFINITIONS;
    
    for (const def of allPieces) {
      for (let rot = 0; rot < 4; rot++) {
        const rotated = PieceFactory.rotate(def.cells, rot);
        
        // Try all positions
        for (let x = 0; x <= this.board.width - rotated[0].x - 1; x++) {
          for (let y = 0; y <= this.board.height - rotated[0].y - 1; y++) {
            if (this.board.canPlace(rotated, x, y)) {
              return false; // Found valid placement
            }
          }
        }
      }
    }
    
    this.gameOver = true;
    this.bus.emit('game:over', { mode: 'classic' });
    return true;
  }
}

class MockPuzzleMode {
  constructor(board, bus) {
    this.board = board;
    this.bus = bus;
    this.gameOver = false;
    this.movesLeft = 10;
    this.targetScore = 1000;
  }

  start() {
    this.gameOver = false;
    this.movesLeft = 10;
  }

  checkGameOver(score) {
    // Puzzle mode: game over when moves exhausted or target reached
    if (this.movesLeft <= 0) {
      this.gameOver = true;
      this.bus.emit('game:over', { mode: 'puzzle', reason: 'moves_exhausted' });
      return true;
    }
    
    if (score >= this.targetScore) {
      this.gameOver = true;
      this.bus.emit('game:over', { mode: 'puzzle', reason: 'target_reached' });
      return true;
    }
    
    return false;
  }

  onMove() {
    this.movesLeft--;
  }
}

class MockRushMode {
  constructor(board, bus) {
    this.board = board;
    this.bus = bus;
    this.gameOver = false;
    this.timeLeft = 60000; // 60 seconds
    this.piecesSkipped = 0;
    this.maxSkips = 3;
  }

  start() {
    this.gameOver = false;
    this.timeLeft = 60000;
    this.piecesSkipped = 0;
  }

  checkGameOver() {
    // Rush mode: game over when time expires or too many skips
    if (this.timeLeft <= 0) {
      this.gameOver = true;
      this.bus.emit('game:over', { mode: 'rush', reason: 'time_expired' });
      return true;
    }
    
    if (this.piecesSkipped >= this.maxSkips) {
      this.gameOver = true;
      this.bus.emit('game:over', { mode: 'rush', reason: 'skip_limit' });
      return true;
    }
    
    return false;
  }

  update(dt) {
    this.timeLeft -= dt;
  }

  skipPiece() {
    this.piecesSkipped++;
  }
}

// ── Classic Mode Game Over Tests ───────────────────────────────────────────

runner.test('Classic mode detects game over when board is full', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockClassicMode(board, bus);
  
  // Fill entire board except one cell
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      if (x !== 2 || y !== 2) { // Leave center empty
        board.setCell(x, y, 1);
      }
    }
  }
  
  // Should still have valid placement for single cell pieces
  runner.assert(!mode.checkGameOver());
  
  // Fill the last cell
  board.setCell(2, 2, 1);
  
  // Now should detect game over
  runner.assert(mode.checkGameOver());
  runner.assert(mode.gameOver);
  runner.assertEqual(bus.events[bus.events.length - 1].event, 'game:over');
});

runner.test('Classic mode finds valid placement in partially filled board', () => {
  const board = new Board(5, 5);
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Fill some cells but leave space
  board.setCell(0, 0, 1);
  board.setCell(1, 0, 1);
  board.setCell(0, 1, 1);
  
  runner.assert(!mode.checkGameOver());
  runner.assert(!mode.gameOver);
});

runner.test('Classic mode handles edge pieces correctly', () => {
  const board = new Board(3, 3);
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Fill board in a way that only edge pieces fit
  board.setCell(1, 1, 1); // Center blocked
  
  // Should still find placement for edge pieces
  runner.assert(!mode.checkGameOver());
  
  // Fill more to block edge pieces
  board.setCell(0, 0, 1);
  board.setCell(0, 1, 1);
  board.setCell(1, 0, 1);
  
  runner.assert(!mode.checkGameOver()); // Still should have placement
  
  // Fill almost everything
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      board.setCell(x, y, 1);
    }
  }
  
  runner.assert(mode.checkGameOver());
});

// ── Puzzle Mode Game Over Tests ───────────────────────────────────────────

runner.test('Puzzle mode game over when moves exhausted', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockPuzzleMode(board, bus);
  
  mode.start();
  
  // Use all moves
  for (let i = 0; i < 10; i++) {
    mode.onMove();
    runner.assert(!mode.checkGameOver(0));
  }
  
  // One more move should trigger game over
  mode.onMove();
  runner.assert(mode.checkGameOver(0));
  runner.assert(mode.gameOver);
  runner.assertEqual(bus.events[bus.events.length - 1].event, 'game:over');
  runner.assertEqual(bus.events[bus.events.length - 1].data.reason, 'moves_exhausted');
});

runner.test('Puzzle mode game over when target score reached', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockPuzzleMode(board, bus);
  
  mode.start();
  
  // Reach target score
  runner.assert(mode.checkGameOver(1000));
  runner.assert(mode.gameOver);
  runner.assertEqual(bus.events[bus.events.length - 1].data.reason, 'target_reached');
});

runner.test('Puzzle mode continues with moves and score remaining', () => {
  const board = new Board(5, 5);
  const mode = new MockPuzzleMode(board, new MockEventBus());
  
  mode.start();
  
  // Use some moves but not all
  mode.onMove();
  mode.onMove();
  
  runner.assert(!mode.checkGameOver(500));
  runner.assert(!mode.gameOver);
});

// ── Rush Mode Game Over Tests ───────────────────────────────────────────

runner.test('Rush mode game over when time expires', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockRushMode(board, bus);
  
  mode.start();
  
  // Simulate time passing
  mode.update(30000);  // 30 seconds
  runner.assert(!mode.checkGameOver());
  
  mode.update(30000);  // Another 30 seconds (total 60)
  runner.assert(mode.checkGameOver());
  runner.assert(mode.gameOver);
  runner.assertEqual(bus.events[bus.events.length - 1].data.reason, 'time_expired');
});

runner.test('Rush mode game over when skip limit reached', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockRushMode(board, bus);
  
  mode.start();
  
  // Skip pieces up to limit
  for (let i = 0; i < 3; i++) {
    mode.skipPiece();
    runner.assert(!mode.checkGameOver());
  }
  
  // One more skip should trigger game over
  mode.skipPiece();
  runner.assert(mode.checkGameOver());
  runner.assert(mode.gameOver);
  runner.assertEqual(bus.events[bus.events.length - 1].data.reason, 'skip_limit');
});

runner.test('Rush mode continues with time and skips remaining', () => {
  const board = new Board(5, 5);
  const mode = new MockRushMode(board, new MockEventBus());
  
  mode.start();
  
  // Use some time and skips
  mode.update(10000);
  mode.skipPiece();
  
  runner.assert(!mode.checkGameOver());
  runner.assert(!mode.gameOver);
});

// ── Edge Case Tests ─────────────────────────────────────────────────

runner.test('Game over detection on empty board', () => {
  const board = new Board(5, 5);
  const classicMode = new MockClassicMode(board, new MockEventBus());
  const puzzleMode = new MockPuzzleMode(board, new MockEventBus());
  const rushMode = new MockRushMode(board, new MockEventBus());
  
  classicMode.start();
  puzzleMode.start();
  rushMode.start();
  
  // Empty board should not trigger game over
  runner.assert(!classicMode.checkGameOver());
  runner.assert(!puzzleMode.checkGameOver(0));
  runner.assert(!rushMode.checkGameOver());
});

runner.test('Game over detection on minimal board', () => {
  const board = new Board(2, 2);
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Fill entire 2x2 board
  board.setCell(0, 0, 1);
  board.setCell(0, 1, 1);
  board.setCell(1, 0, 1);
  board.setCell(1, 1, 1);
  
  runner.assert(mode.checkGameOver());
});

runner.test('Game over with frozen blocks blocking placement', () => {
  const board = new Board(3, 3);
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Place frozen blocks in a pattern that blocks all pieces
  board.setCell(0, 0, 1, CellFlag.FROZEN);
  board.setCell(1, 0, 1, CellFlag.FROZEN);
  board.setCell(0, 1, 1, CellFlag.FROZEN);
  board.setCell(1, 1, 1, CellFlag.FROZEN);
  
  // Fill remaining cells
  board.setCell(2, 0, 1);
  board.setCell(0, 2, 1);
  board.setCell(1, 2, 1);
  board.setCell(2, 1, 1);
  board.setCell(2, 2, 1);
  
  runner.assert(mode.checkGameOver());
});

runner.test('Game over detection performance with large board', () => {
  const board = new Board(20, 20); // Large board
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Partially fill to test performance
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      board.setCell(x, y, 1);
    }
  }
  
  const startTime = performance.now();
  const result = mode.checkGameOver();
  const endTime = performance.now();
  
  // Should complete quickly (under 100ms for performance test)
  runner.assert(endTime - startTime < 100);
  runner.assert(!result); // Should still have placement
});

// ── Integration Tests ─────────────────────────────────────────────────

runner.test('Game over event includes proper context', () => {
  const board = new Board(3, 3);
  const bus = new MockEventBus();
  const mode = new MockClassicMode(board, bus);
  
  // Fill board
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      board.setCell(x, y, 1);
    }
  }
  
  mode.checkGameOver();
  
  const event = bus.events[bus.events.length - 1];
  runner.assertEqual(event.event, 'game:over');
  runner.assert(event.data.mode === 'classic');
  runner.assert(typeof event.data.timestamp === 'number');
});

runner.test('Multiple game over conditions in Rush mode', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const mode = new MockRushMode(board, bus);
  
  mode.start();
  
  // Use up skips
  for (let i = 0; i < 3; i++) {
    mode.skipPiece();
  }
  
  // Use up time
  mode.update(60000);
  
  // Should trigger game over (time expires first in this implementation)
  runner.assert(mode.checkGameOver());
  runner.assertEqual(bus.events[bus.events.length - 1].data.reason, 'time_expired');
});

runner.test('Game over state persists after detection', () => {
  const board = new Board(2, 2);
  const mode = new MockClassicMode(board, new MockEventBus());
  
  // Fill board
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      board.setCell(x, y, 1);
    }
  }
  
  mode.checkGameOver();
  runner.assert(mode.gameOver);
  
  // Should remain in game over state
  runner.assert(mode.checkGameOver());
  runner.assert(mode.gameOver);
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.gameoverTestRunner = runner;
}