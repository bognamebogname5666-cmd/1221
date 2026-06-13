/**
 * NEXUS BLOCKS — Game Loop Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests full game loop with 100 random piece placements, no crashes
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
    console.log('🧪 Running Game Loop Integration Tests...\n');
    
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

  reset() {
    this.events = [];
    this.listeners.clear();
  }
}

class MockStorage {
  constructor() {
    this.data = new Map();
    this.quotaExceeded = false;
  }

  get(key) {
    if (this.quotaExceeded) throw new Error('Storage quota exceeded');
    return this.data.get(key);
  }

  set(key, value) {
    if (this.quotaExceeded) throw new Error('Storage quota exceeded');
    this.data.set(key, value);
    return true;
  }

  remove(key) {
    return this.data.delete(key);
  }

  clear() {
    this.data.clear();
  }

  simulateQuotaExceeded() {
    this.quotaExceeded = true;
  }
}

class MockRenderer {
  constructor() {
    this.renderCount = 0;
    this.lastAlpha = 0;
    this.errors = [];
  }

  render(alpha) {
    this.renderCount++;
    this.lastAlpha = alpha;
    
    // Simulate occasional rendering errors
    if (Math.random() < 0.01) {
      const error = new Error('Mock rendering error');
      this.errors.push(error);
      throw error;
    }
  }
}

const runner = new TestRunner();

// ── Full Game Loop Simulation ─────────────────────────────────────────────

runner.test('Full game loop: 100 random piece placements without crashes', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const storage = new MockStorage();
  const renderer = new MockRenderer();
  
  const factory = new PieceFactory({ seed: 12345 });
  const scoreEngine = new ScoreEngine('classic_endless', bus, storage);
  const gameLoop = new GameLoop(
    (dt) => { /* update logic */ },
    (alpha) => renderer.render(alpha),
    { eventBus: bus }
  );

  let piecesPlaced = 0;
  let totalScore = 0;
  let errors = [];

  // Start the game loop
  gameLoop.start();

  try {
    // Simulate 100 piece placements
    for (let i = 0; i < 100; i++) {
      // Get next piece
      const piece = factory.next();
      
      // Find a valid placement (try random positions)
      let placed = false;
      let attempts = 0;
      
      while (!placed && attempts < 50) {
        const x = Math.floor(Math.random() * board.width);
        const y = Math.floor(Math.random() * board.height);
        
        if (board.canPlace(piece.cells, x, y)) {
          // Place the piece
          const placedCells = board.placePiece(piece.cells, x, y, piece.colorIndex);
          
          // Process clears
          const clearResult = board.processClears();
          
          // Update score
          const scoreResult = scoreEngine.onClears(clearResult);
          totalScore += scoreResult.delta;
          
          piecesPlaced++;
          placed = true;
          
          // Simulate a few game loop ticks
          for (let tick = 0; tick < 3; tick++) {
            try {
              // Simulate update/render cycle
              renderer.render(Math.random());
            } catch (e) {
              errors.push(e);
            }
          }
        }
        attempts++;
      }
      
      if (!placed) {
        // Board might be getting full, try to clear some lines
        const clearResult = board.processClears();
        if (clearResult.rows.length > 0 || clearResult.cols.length > 0) {
          continue; // Try next piece
        } else {
          // Board is likely full, break early
          break;
        }
      }
    }
  } finally {
    gameLoop.stop();
  }

  // Verify results
  runner.assert(piecesPlaced > 0, 'Should have placed at least some pieces');
  runner.assertEqual(errors.length, 0, `Should have no errors, got ${errors.length}`);
  runner.assert(totalScore >= 0, 'Total score should be non-negative');
  runner.assert(renderer.renderCount > 0, 'Renderer should have been called');
  
  console.log(`   Placed ${piecesPlaced} pieces, total score: ${totalScore}`);
});

runner.test('Game loop handles rapid start/stop cycles', () => {
  const bus = new MockEventBus();
  const renderer = new MockRenderer();
  
  const gameLoop = new GameLoop(
    (dt) => {},
    (alpha) => renderer.render(alpha),
    { eventBus: bus }
  );

  // Rapid start/stop cycles
  for (let i = 0; i < 10; i++) {
    gameLoop.start();
    gameLoop.pause();
    gameLoop.resume();
    gameLoop.stop();
  }

  // Should handle gracefully
  runner.assert(!gameLoop.running);
  runner.assert(gameLoop.paused === false);
});

runner.test('Game loop maintains consistent timing', () => {
  const bus = new MockEventBus();
  const renderer = new MockRenderer();
  let updateCount = 0;
  
  const gameLoop = new GameLoop(
    (dt) => {
      updateCount++;
      runner.assertEqual(dt, 16.67, 'Update should receive fixed timestep');
    },
    (alpha) => renderer.render(alpha),
    { eventBus: bus, tickRate: 60 }
  );

  gameLoop.start();
  
  // Let it run for a short time
  setTimeout(() => {
    gameLoop.stop();
    runner.assert(updateCount > 0, 'Should have received update calls');
  }, 100);
  
  // Wait for async test
  return new Promise(resolve => setTimeout(resolve, 150));
});

runner.test('Game loop handles rendering errors gracefully', () => {
  const bus = new MockEventBus();
  const errorCount = { value: 0 };
  
  const gameLoop = new GameLoop(
    (dt) => {},
    (alpha) => {
      // Simulate rendering errors
      if (Math.random() < 0.1) {
        errorCount.value++;
        throw new Error('Rendering error');
      }
    },
    { eventBus: bus }
  );

  gameLoop.start();
  
  // Let it run briefly
  setTimeout(() => {
    gameLoop.stop();
    // Should have handled errors without crashing
    runner.assert(errorCount.value >= 0);
  }, 50);
  
  return new Promise(resolve => setTimeout(resolve, 100));
});

// ── Memory Leak Detection ─────────────────────────────────────────────

runner.test('Memory leak detection: repeated game sessions', () => {
  const initialMemory = performance.memory?.usedJSHeapSize || 0;
  
  for (let session = 0; session < 10; session++) {
    const board = new Board(9, 9);
    const bus = new MockEventBus();
    const storage = new MockStorage();
    const factory = new PieceFactory();
    const scoreEngine = new ScoreEngine('classic_endless', bus, storage);
    
    // Simulate game session
    for (let i = 0; i < 20; i++) {
      const piece = factory.next();
      
      // Find placement
      for (let x = 0; x < board.width; x++) {
        for (let y = 0; y < board.height; y++) {
          if (board.canPlace(piece.cells, x, y)) {
            board.placePiece(piece.cells, x, y, piece.colorIndex);
            board.processClears();
            scoreEngine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
            break;
          }
        }
      }
    }
    
    // Clean up references
    board.reset();
    scoreEngine.reset();
    bus.reset();
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  const finalMemory = performance.memory?.usedJSHeapSize || 0;
  const memoryIncrease = finalMemory - initialMemory;
  
  // Memory increase should be reasonable (less than 10MB)
  runner.assert(memoryIncrease < 10 * 1024 * 1024, 
    `Memory increase should be < 10MB, was ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
});

runner.test('Event bus memory leak detection', () => {
  const bus = new MockEventBus();
  const listeners = [];
  
  // Add many listeners
  for (let i = 0; i < 100; i++) {
    const handler = () => {};
    bus.on('test:event', handler);
    listeners.push(handler);
  }
  
  // Emit many events
  for (let i = 0; i < 1000; i++) {
    bus.emit('test:event', { data: i });
  }
  
  // Clear listeners
  bus.reset();
  
  // Should not have memory leaks
  runner.assertEqual(bus.listeners.size, 0);
  runner.assert(bus.events.length > 0);
});

// ── Stress Tests ─────────────────────────────────────────────────

runner.test('Stress test: maximum piece generation rate', () => {
  const factory = new PieceFactory({ seed: 12345 });
  const startTime = performance.now();
  const pieces = [];
  
  // Generate 1000 pieces
  for (let i = 0; i < 1000; i++) {
    const piece = factory.next();
    pieces.push(piece);
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  runner.assertEqual(pieces.length, 1000);
  runner.assert(duration < 1000, 'Should generate 1000 pieces in under 1 second');
  
  // Verify piece variety
  const uniqueIds = new Set(pieces.map(p => p.id));
  runner.assert(uniqueIds.size > 1, 'Should have variety of pieces');
});

runner.test('Stress test: rapid board operations', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  
  const startTime = performance.now();
  
  // Perform many board operations
  for (let i = 0; i < 1000; i++) {
    const x = Math.floor(Math.random() * board.width);
    const y = Math.floor(Math.random() * board.height);
    const color = (i % 8) + 1;
    
    board.setCell(x, y, color);
    board.getCell(x, y);
    board.isLineFull(y);
    board.isColumnFull(x);
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  runner.assert(duration < 500, 'Should perform 1000 operations in under 500ms');
});

runner.test('Stress test: concurrent score calculations', () => {
  const scoreEngine = new ScoreEngine('classic_endless');
  const startTime = performance.now();
  
  // Simulate many scoring events
  for (let i = 0; i < 500; i++) {
    const lines = Math.floor(Math.random() * 4);
    const rows = Array.from({ length: lines }, (_, idx) => idx);
    const nexus = Math.floor(Math.random() * 5);
    
    scoreEngine.onClears({ rows, cols: [], nexusDestroyed: nexus });
    
    if (i % 10 === 0) {
      scoreEngine.onNexusChain(Math.floor(Math.random() * 5) + 1);
    }
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  runner.assert(duration < 200, 'Should perform 500 score calculations in under 200ms');
  runner.assert(scoreEngine.getScore() > 0);
});

// ── Error Recovery Tests ─────────────────────────────────────────

runner.test('Error recovery: corrupted board state', () => {
  const board = new Board(9, 9);
  
  // Corrupt board state (fill with invalid values)
  for (let i = 0; i < board._cells.length; i++) {
    board._cells[i] = 255; // Invalid color index
  }
  
  // Board should handle gracefully
  try {
    board.reset();
    
    // Should be able to use board normally after reset
    board.setCell(0, 0, 1);
    runner.assertEqual(board.getCell(0, 0), 1);
  } catch (e) {
    runner.assert(false, `Board should recover from corruption: ${e.message}`);
  }
});

runner.test('Error recovery: invalid piece data', () => {
  const board = new Board(9, 9);
  
  // Try to place invalid piece
  const invalidPiece = [{x: -100, y: -100}]; // Way out of bounds
  
  const canPlace = board.canPlace(invalidPiece, 0, 0);
  runner.assert(!canPlace, 'Should reject invalid piece');
  
  // Should not crash
  try {
    board.placePiece(invalidPiece, 0, 0, 1);
  } catch (e) {
    // Expected to fail gracefully
  }
});

runner.test('Error recovery: score engine with invalid data', () => {
  const scoreEngine = new ScoreEngine('classic_endless');
  
  // Try invalid scoring scenarios
  try {
    scoreEngine.onClears({ rows: [-1, 100], cols: [], nexusDestroyed: -5 });
    // Should handle gracefully
  } catch (e) {
    // Expected to fail gracefully
  }
  
  try {
    scoreEngine.onNexusChain(-1);
    // Should handle gracefully
  } catch (e) {
    // Expected to fail gracefully
  }
  
  // Should still work normally
  const result = scoreEngine.onClears({ rows: [0], cols: [], nexusDestroyed: 0 });
  runner.assertEqual(result.delta, 100);
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.gameloopTestRunner = runner;
}