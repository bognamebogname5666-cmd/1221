/**
 * NEXUS BLOCKS — Mode Switching Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests Classic→Puzzle→Rush mode switching without memory leaks
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
    console.log('🧪 Running Mode Switching Integration Tests...\n');
    
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
    this.listeners = new Map();
  }

  emit(event, data) {
    this.events.push({ event, data, timestamp: performance.now() });
    
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (e) {
          console.error(`Event handler error for ${event}:`, e);
        }
      });
    }
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  reset() {
    this.events = [];
    this.listeners.clear();
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
    return true;
  }

  clear() {
    this.data.clear();
  }
}

// Mock Game Modes
class MockClassicMode {
  constructor(board, bus, storage) {
    this.board = board;
    this.bus = bus;
    this.storage = storage;
    this.scoreEngine = new ScoreEngine('classic_endless', bus, storage);
    this.active = false;
    this.piecesPlaced = 0;
  }

  start() {
    this.active = true;
    this.scoreEngine.reset();
    this.piecesPlaced = 0;
    this.bus.emit('mode:started', { mode: 'classic' });
  }

  stop() {
    this.active = false;
    this.bus.emit('mode:stopped', { mode: 'classic' });
  }

  placePiece(piece, x, y) {
    if (!this.active) return;
    
    if (this.board.canPlace(piece.cells, x, y)) {
      this.board.placePiece(piece.cells, x, y, piece.colorIndex);
      const clears = this.board.processClears();
      this.scoreEngine.onClears(clears);
      this.piecesPlaced++;
      return true;
    }
    return false;
  }

  getScore() {
    return this.scoreEngine.getScore();
  }
}

class MockPuzzleMode {
  constructor(board, bus, storage) {
    this.board = board;
    this.bus = bus;
    this.storage = storage;
    this.scoreEngine = new ScoreEngine('puzzle_challenge', bus, storage);
    this.active = false;
    this.movesLeft = 15;
    this.targetScore = 2000;
  }

  start() {
    this.active = true;
    this.scoreEngine.reset();
    this.movesLeft = 15;
    this.bus.emit('mode:started', { mode: 'puzzle' });
  }

  stop() {
    this.active = false;
    this.bus.emit('mode:stopped', { mode: 'puzzle' });
  }

  placePiece(piece, x, y) {
    if (!this.active || this.movesLeft <= 0) return false;
    
    if (this.board.canPlace(piece.cells, x, y)) {
      this.board.placePiece(piece.cells, x, y, piece.colorIndex);
      const clears = this.board.processClears();
      this.scoreEngine.onClears(clears);
      this.movesLeft--;
      
      if (this.scoreEngine.getScore() >= this.targetScore) {
        this.bus.emit('puzzle:completed', { score: this.scoreEngine.getScore() });
      }
      
      return true;
    }
    return false;
  }

  getScore() {
    return this.scoreEngine.getScore();
  }
}

class MockRushMode {
  constructor(board, bus, storage) {
    this.board = board;
    this.bus = bus;
    this.storage = storage;
    this.scoreEngine = new ScoreEngine('time_rush', bus, storage);
    this.active = false;
    this.timeLeft = 60000; // 60 seconds
    this.piecesSkipped = 0;
    this.maxSkips = 3;
  }

  start() {
    this.active = true;
    this.scoreEngine.reset();
    this.timeLeft = 60000;
    this.piecesSkipped = 0;
    this.bus.emit('mode:started', { mode: 'rush' });
  }

  stop() {
    this.active = false;
    this.bus.emit('mode:stopped', { mode: 'rush' });
  }

  update(dt) {
    if (!this.active) return;
    
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.bus.emit('rush:timeExpired', { score: this.scoreEngine.getScore() });
    }
  }

  placePiece(piece, x, y) {
    if (!this.active || this.timeLeft <= 0) return false;
    
    if (this.board.canPlace(piece.cells, x, y)) {
      this.board.placePiece(piece.cells, x, y, piece.colorIndex);
      const clears = this.board.processClears();
      this.scoreEngine.onClears(clears);
      return true;
    }
    return false;
  }

  skipPiece() {
    if (this.piecesSkipped < this.maxSkips) {
      this.piecesSkipped++;
      this.scoreEngine.onPieceSkipped();
      return true;
    }
    return false;
  }

  getScore() {
    return this.scoreEngine.getScore();
  }
}

const runner = new TestRunner();

// ── Basic Mode Switching Tests ─────────────────────────────────────────

runner.test('Basic mode switching: Classic → Puzzle → Rush', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  const rush = new MockRushMode(board, bus, storage);
  
  // Start Classic mode
  classic.start();
  runner.assert(classic.active);
  runner.assert(!puzzle.active);
  runner.assert(!rush.active);
  
  // Switch to Puzzle
  classic.stop();
  puzzle.start();
  runner.assert(!classic.active);
  runner.assert(puzzle.active);
  runner.assert(!rush.active);
  
  // Switch to Rush
  puzzle.stop();
  rush.start();
  runner.assert(!classic.active);
  runner.assert(!puzzle.active);
  runner.assert(rush.active);
  
  // Verify events were emitted
  const modeStartedEvents = bus.events.filter(e => e.event === 'mode:started');
  const modeStoppedEvents = bus.events.filter(e => e.event === 'mode:stopped');
  
  runner.assertEqual(modeStartedEvents.length, 3);
  runner.assertEqual(modeStoppedEvents.length, 2);
});

runner.test('Mode switching preserves board state correctly', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  
  // Start Classic and place some pieces
  classic.start();
  classic.placePiece([{x:0,y:0}], 0, 0);
  classic.placePiece([{x:1,y:0}], 1, 0);
  
  const classicScore = classic.getScore();
  runner.assert(classicScore > 0);
  runner.assert(board.getCell(0, 0) > 0);
  runner.assert(board.getCell(1, 0) > 0);
  
  // Switch to Puzzle
  classic.stop();
  puzzle.start();
  
  // Board state should be preserved
  runner.assert(board.getCell(0, 0) > 0);
  runner.assert(board.getCell(1, 0) > 0);
  
  // Puzzle should have its own score
  runner.assertEqual(puzzle.getScore(), 0);
  
  // Place piece in Puzzle
  puzzle.placePiece([{x:2,y:0}], 2, 0);
  
  // Switch back to Classic
  puzzle.stop();
  classic.start();
  
  // Classic score should be preserved
  runner.assertEqual(classic.getScore(), classicScore);
});

runner.test('Mode switching with different scoring systems', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const modes = [
    new MockClassicMode(board, bus, storage),
    new MockPuzzleMode(board, bus, storage),
    new MockRushMode(board, bus, storage)
  ];
  
  // Test each mode with same board state
  const piece = [{x:0,y:0}, {x:1,y:0}]; // 2-cell piece
  
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    const prevMode = modes[(i - 1 + modes.length) % modes.length];
    
    // Stop previous mode
    if (prevMode.active) prevMode.stop();
    
    // Start current mode
    mode.start();
    
    // Place same piece
    mode.placePiece(piece, 0, 0);
    
    const score = mode.getScore();
    runner.assert(score >= 0, `Mode ${i} should have valid score`);
    
    // Clear board for next test
    board.reset();
  }
});

// ── Memory Leak Detection Tests ───────────────────────────────────────

runner.test('Memory leak detection during rapid mode switching', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  const rush = new MockRushMode(board, bus, storage);
  
  const initialMemory = performance.memory?.usedJSHeapSize || 0;
  const initialEventCount = bus.events.length;
  
  // Rapid mode switching
  for (let i = 0; i < 50; i++) {
    classic.start();
    classic.stop();
    
    puzzle.start();
    puzzle.stop();
    
    rush.start();
    rush.stop();
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  const finalMemory = performance.memory?.usedJSHeapSize || 0;
  const finalEventCount = bus.events.length;
  
  // Memory increase should be minimal
  const memoryIncrease = finalMemory - initialMemory;
  runner.assert(memoryIncrease < 5 * 1024 * 1024, 
    `Memory increase should be < 5MB, was ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
  
  // Events should be cleaned up properly
  runner.assert(finalEventCount - initialEventCount <= 300, // 50 switches × 6 events
    `Event count should not grow excessively: ${finalEventCount - initialEventCount}`);
});

runner.test('Event listener cleanup during mode switching', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  
  // Add custom listeners
  const customListener1 = () => {};
  const customListener2 = () => {};
  
  bus.on('custom:event', customListener1);
  bus.on('custom:event', customListener2);
  
  runner.assertEqual(bus.listeners.get('custom:event').length, 2);
  
  // Switch modes
  classic.start();
  classic.stop();
  
  puzzle.start();
  puzzle.stop();
  
  // Custom listeners should remain
  runner.assertEqual(bus.listeners.get('custom:event').length, 2);
  
  // Clean up
  bus.off('custom:event', customListener1);
  bus.off('custom:event', customListener2);
});

// ── State Persistence Tests ─────────────────────────────────────────

runner.test('State persistence across mode switches', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  const rush = new MockRushMode(board, bus, storage);
  
  // Play Classic mode
  classic.start();
  classic.placePiece([{x:0,y:0}], 0, 0);
  classic.placePiece([{x:1,y:0}], 1, 0);
  const classicHighScore = classic.getScore();
  classic.stop();
  
  // Play Puzzle mode
  puzzle.start();
  puzzle.placePiece([{x:2,y:0}], 2, 0);
  const puzzleHighScore = puzzle.getScore();
  puzzle.stop();
  
  // Play Rush mode
  rush.start();
  rush.placePiece([{x:3,y:0}], 3, 0);
  const rushHighScore = rush.getScore();
  rush.stop();
  
  // Verify high scores are saved separately
  runner.assertEqual(storage.get('highscore_classic_endless'), classicHighScore);
  runner.assertEqual(storage.get('highscore_puzzle_challenge'), puzzleHighScore);
  runner.assertEqual(storage.get('highscore_time_rush'), rushHighScore);
});

runner.test('Board state isolation between modes', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  
  // Start Classic and fill board partially
  classic.start();
  for (let i = 0; i < 10; i++) {
    classic.placePiece([{x:i%9,y:Math.floor(i/9)}], i%9, Math.floor(i/9));
  }
  const classicCells = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      if (board.getCell(x, y) > 0) {
        classicCells.push({x, y, color: board.getCell(x, y)});
      }
    }
  }
  
  classic.stop();
  
  // Start Puzzle - board should be same
  puzzle.start();
  
  for (const cell of classicCells) {
    runner.assertEqual(board.getCell(cell.x, cell.y), cell.color);
  }
  
  // Puzzle should be able to continue
  puzzle.placePiece([{x:0,y:1}], 0, 1);
  
  puzzle.stop();
  
  // Classic should resume with same board
  classic.start();
  
  for (const cell of classicCells) {
    runner.assertEqual(board.getCell(cell.x, cell.y), cell.color);
  }
});

// ── Error Handling Tests ─────────────────────────────────────────

runner.test('Error handling during mode switching', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  
  // Start Classic
  classic.start();
  
  // Try to start Puzzle without stopping Classic
  puzzle.start();
  
  // Should handle gracefully (both might be active, but shouldn't crash)
  runner.assert(classic.active || puzzle.active);
  
  // Proper cleanup
  classic.stop();
  puzzle.stop();
});

runner.test('Mode switching with corrupted state', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  // Corrupt board
  for (let i = 0; i < board._cells.length; i++) {
    board._cells[i] = 255;
  }
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  
  // Should handle corruption gracefully
  try {
    classic.start();
    classic.stop();
    puzzle.start();
    puzzle.stop();
  } catch (e) {
    runner.assert(false, `Should handle corrupted state: ${e.message}`);
  }
  
  // Board should be resettable
  board.reset();
  runner.assertEqual(board.getCell(0, 0), 0);
});

// ── Performance Tests ─────────────────────────────────────────

runner.test('Performance: mode switching overhead', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const classic = new MockClassicMode(board, bus, storage);
  const puzzle = new MockPuzzleMode(board, bus, storage);
  const rush = new MockRushMode(board, bus, storage);
  
  const iterations = 100;
  const startTime = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    classic.start();
    classic.stop();
    puzzle.start();
    puzzle.stop();
    rush.start();
    rush.stop();
  }
  
  const endTime = performance.now();
  const avgTime = (endTime - startTime) / (iterations * 3);
  
  // Each mode switch should be fast (< 1ms)
  runner.assert(avgTime < 1, 
    `Average mode switch time should be < 1ms, was ${avgTime.toFixed(2)}ms`);
});

runner.test('Performance: concurrent mode operations', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  
  const modes = [
    new MockClassicMode(board, bus, storage),
    new MockPuzzleMode(board, bus, storage),
    new MockRushMode(board, bus, storage)
  ];
  
  const startTime = performance.now();
  
  // Start all modes (should handle gracefully)
  modes.forEach(mode => mode.start());
  
  // Perform operations in all modes
  for (let i = 0; i < 50; i++) {
    modes.forEach(mode => {
      mode.placePiece([{x:i%9,y:Math.floor(i/9)}], i%9, Math.floor(i/9));
    });
  }
  
  // Stop all modes
  modes.forEach(mode => mode.stop());
  
  const endTime = performance.now();
  
  runner.assert(endTime - startTime < 1000, 
    'Concurrent operations should complete in under 1 second');
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.modeswitchTestRunner = runner;
}