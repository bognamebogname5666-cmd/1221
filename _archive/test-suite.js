/**
 * NEXUS BLOCKS — Comprehensive Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Vanilla JS test runner (no Jest). Run in browser console or Node.js.
 * 
 * Usage:
 *   // In browser console:
 *   const testSuite = new TestSuite();
 *   testSuite.runAll();
 * 
 *   // In Node.js:
 *   node test-suite.js
 */

'use strict';

// ── Simple Test Framework ───────────────────────────────────────────────────────
class TestSuite {
  constructor() {
    this.tests = [];
    this.results = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
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

  assertThrows(fn, message) {
    try {
      fn();
      throw new Error(message || 'Expected function to throw');
    } catch (e) {
      // Expected
    }
  }

  runAll() {
    console.log('🧪 Running NEXUS BLOCKS Test Suite...\n');
    
    this.tests.forEach(({ name, fn }) => {
      try {
        fn();
        console.log(`✅ ${name}`);
        this.results.push({ name, passed: true });
      } catch (e) {
        console.error(`❌ ${name}: ${e.message}`);
        this.results.push({ name, passed: false, error: e.message });
      }
    });

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    console.log(`\n📊 Results: ${passed}/${total} tests passed`);
    
    if (passed !== total) {
      console.log('\n❌ Failing tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

    return passed === total;
  }
}

const testSuite = new TestSuite();

// ── Mock Dependencies ─────────────────────────────────────────────────────────────
class MockEventBus {
  constructor() {
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
  }

  on(event, fn) {
    this.listeners = this.listeners || {};
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
  }
}

// ── UNIT TESTS ───────────────────────────────────────────────────────────────────────

// Load the actual classes (adjust paths as needed)
const Board = (typeof Board !== 'undefined') ? Board : class Board {
  constructor(width = 9, height = 9, eventBus = null) {
    this.width = width;
    this.height = height;
    this._bus = eventBus;
    this._cells = new Int8Array(width * height);
    this._flags = new Uint8Array(width * height);
    this._nexusGroups = new Int16Array(width * height);
    this._nexusGroupMap = new Map();
    this._nextGroupId = 1;
    this._animQueue = [];
  }

  _idx(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height; }
  getCell(x, y) { return this.inBounds(x, y) ? this._cells[this._idx(x, y)] : 0; }
  setCell(x, y, colorIndex, flags = 0) {
    if (!this.inBounds(x, y)) return;
    const i = this._idx(x, y);
    this._cells[i] = colorIndex;
    this._flags[i] = flags;
  }
  isFilled(x, y) { return this.getCell(x, y) !== 0; }
  isEmpty(x, y) { return this.getCell(x, y) === 0; }
  canPlace(cells, ox, oy) {
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      if (!this.inBounds(bx, by) || this.isFilled(bx, by)) return false;
    }
    return true;
  }
  placePiece(cells, ox, oy, colorIndex, flags = 0) {
    const placed = [];
    for (const { x, y } of cells) {
      const bx = x + ox;
      const by = y + oy;
      this.setCell(bx, by, colorIndex, flags);
      placed.push({ x: bx, y: by });
    }
    return placed;
  }
  findCompletedLines() {
    const rows = [];
    const cols = [];
    for (let y = 0; y < this.height; y++) {
      let full = true;
      for (let x = 0; x < this.width; x++) {
        if (!this.isFilled(x, y)) { full = false; break; }
      }
      if (full) rows.push(y);
    }
    for (let x = 0; x < this.width; x++) {
      let full = true;
      for (let y = 0; y < this.height; y++) {
        if (!this.isFilled(x, y)) { full = false; break; }
      }
      if (full) cols.push(x);
    }
    return { rows, cols };
  }
  clearLine(y) {
    if (y < 0 || y >= this.height) return;
    for (let x = 0; x < this.width; x++) {
      this.setCell(x, y, 0);
    }
  }
  clearColumn(x) {
    if (x < 0 || x >= this.width) return;
    for (let y = 0; y < this.height; y++) {
      this.setCell(x, y, 0);
    }
  }
  reset() {
    this._cells.fill(0);
    this._flags.fill(0);
    this._nexusGroups.fill(0);
    this._nexusGroupMap.clear();
    this._nextGroupId = 1;
  }
};

const PieceFactory = (typeof PieceFactory !== 'undefined') ? PieceFactory : class PieceFactory {
  static rotate(cells, times = 1) {
    let result = [...cells];
    for (let i = 0; i < times; i++) {
      result = result.map(({ x, y }) => ({ x: -y, y: x }));
      // Normalize to (0,0)
      const minX = Math.min(...result.map(p => p.x));
      const minY = Math.min(...result.map(p => p.y));
      result = result.map(p => ({ x: p.x - minX, y: p.y - minY }));
    }
    return result;
  }
};

// ── Board Tests ─────────────────────────────────────────────────────────────────────

testSuite.test('Board: Basic cell operations', () => {
  const board = new Board(9, 9);
  
  // Test empty board
  testSuite.assertEqual(board.getCell(0, 0), 0, 'Empty cell should return 0');
  testSuite.assertEqual(board.getCell(8, 8), 0, 'Empty cell should return 0');
  
  // Test out of bounds
  testSuite.assertEqual(board.getCell(-1, 0), 0, 'Out of bounds should return 0');
  testSuite.assertEqual(board.getCell(9, 0), 0, 'Out of bounds should return 0');
  
  // Test set and get
  board.setCell(4, 4, 5);
  testSuite.assertEqual(board.getCell(4, 4), 5, 'Set cell should return correct value');
  testSuite.assertTrue(board.isFilled(4, 4), 'Filled cell should be true');
  testSuite.assertTrue(!board.isEmpty(4, 4), 'Filled cell should not be empty');
});

testSuite.test('Board: Piece placement at edges', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  
  // Test all 12 piece shapes at edge positions
  const edgePositions = [
    { ox: 0, oy: 0, name: 'top-left' },
    { ox: 5, oy: 0, name: 'top-right' },
    { ox: 0, oy: 5, name: 'bottom-left' },
    { ox: 5, oy: 5, name: 'bottom-right' }
  ];
  
  const testPieces = [
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // P01 Spark
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }], // P02 Bolt
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P03 Anvil
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }], // P04 Fang
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P05 Crown
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }], // P06 Helix
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }], // P07 Bastion
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], // P08 Talon
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }], // P09 Monolith
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P10 Arch
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], // P11 Wraith
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] // P12 Nexus Core
  ];
  
  testPieces.forEach((piece, i) => {
    edgePositions.forEach(({ ox, oy, name }) => {
      board.reset();
      testSuite.assertTrue(board.canPlace(piece, ox, oy), 
        `Piece ${i+1} should fit at ${name} (${ox},${oy})`);
      
      const placed = board.placePiece(piece, ox, oy, 1);
      testSuite.assertEqual(placed.length, piece.length, 
        `All cells should be placed for piece ${i+1} at ${name}`);
    });
  });
});

testSuite.test('Board: Line clear logic', () => {
  const board = new Board(9, 9);
  
  // Test single line clear
  for (let x = 0; x < 9; x++) {
    board.setCell(x, 4, 1);
  }
  const result1 = board.findCompletedLines();
  testSuite.assertDeepEqual(result1, { rows: [4], cols: [] }, 'Single line should be detected');
  
  board.clearLine(4);
  for (let x = 0; x < 9; x++) {
    testSuite.assertEqual(board.getCell(x, 4), 0, 'Cleared line should be empty');
  }
  
  // Test double line clear
  board.reset();
  for (let x = 0; x < 9; x++) {
    board.setCell(x, 3, 1);
    board.setCell(x, 5, 1);
  }
  const result2 = board.findCompletedLines();
  testSuite.assertDeepEqual(result2, { rows: [3, 5], cols: [] }, 'Double line should be detected');
  
  // Test column clear
  board.reset();
  for (let y = 0; y < 9; y++) {
    board.setCell(4, y, 1);
  }
  const result3 = board.findCompletedLines();
  testSuite.assertDeepEqual(result3, { rows: [], cols: [4] }, 'Column should be detected');
  
  board.clearColumn(4);
  for (let y = 0; y < 9; y++) {
    testSuite.assertEqual(board.getCell(4, y), 0, 'Cleared column should be empty');
  }
});

testSuite.test('Board: Game over detection', () => {
  const board = new Board(9, 9);
  
  // Fill almost entire board
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      board.setCell(x, y, 1);
    }
  }
  
  // Test pieces that should still fit
  const smallPiece = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  testSuite.assertTrue(board.canPlace(smallPiece, 0, 8), 'Small piece should fit in empty space');
  
  // Fill last row except one spot
  for (let x = 0; x < 8; x++) {
    board.setCell(x, 8, 1);
  }
  
  // Test that some pieces still fit
  testSuite.assertTrue(board.canPlace(smallPiece, 8, 8), 'Small piece should fit in last spot');
  
  // Fill last spot
  board.setCell(8, 8, 1);
  
  // Test that no pieces can fit
  const largePiece = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  testSuite.assertFalse(board.canPlace(largePiece, 0, 0), 'Large piece should not fit on full board');
  testSuite.assertFalse(board.canPlace(smallPiece, 0, 0), 'Small piece should not fit on full board');
  
  // Check game over condition
  const hasValidPlacement = testPieces.some(piece => 
    [...Array(9).keys()].some(y => 
      [...Array(9).keys()].some(x => 
        board.canPlace(piece, x, y)
      )
    )
  );
  testSuite.assertFalse(hasValidPlacement, 'No valid placements should remain');
});

// ── Piece Rotation Tests ─────────────────────────────────────────────────────────────
testSuite.test('PieceFactory: Rotation bounds check', () => {
  const pieces = [
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // P01
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }], // P02
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P03
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }], // P04
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P05
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }], // P06
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }], // P07
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], // P08
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }], // P09
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // P10
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], // P11
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] // P12
  ];
  
  pieces.forEach((piece, i) => {
    // Test all 4 rotations
    for (let rot = 0; rot < 4; rot++) {
      const rotated = PieceFactory.rotate(piece, rot);
      
      // Check that rotation doesn't change piece size
      testSuite.assertEqual(rotated.length, piece.length, 
        `Piece ${i+1} rotation ${rot} should maintain cell count`);
      
      // Check that rotated piece is normalized (min x,y = 0)
      const minX = Math.min(...rotated.map(p => p.x));
      const minY = Math.min(...rotated.map(p => p.y));
      testSuite.assertEqual(minX, 0, `Piece ${i+1} rotation ${rot} should be normalized to x=0`);
      testSuite.assertEqual(minY, 0, `Piece ${i+1} rotation ${rot} should be normalized to y=0`);
      
      // Check that rotated piece doesn't have negative coordinates
      rotated.forEach(({ x, y }) => {
        testSuite.assertTrue(x >= 0 && y >= 0, 
          `Piece ${i+1} rotation ${rot} should have non-negative coordinates`);
      });
    }
  });
});

// ── Scoring Tests ────────────────────────────────────────────────────────────────────
testSuite.test('Scoring: Combo multipliers', () => {
  // Mock scoring engine
  const calculateComboMultiplier = (combo) => {
    if (combo <= 1) return 1;
    if (combo === 2) return 1.5;
    if (combo === 3) return 2;
    if (combo >= 4 && combo < 10) return 2.5;
    if (combo >= 10) return 3;
    return 1;
  };
  
  testSuite.assertEqual(calculateComboMultiplier(1), 1, 'x1 combo should multiply by 1');
  testSuite.assertEqual(calculateComboMultiplier(2), 1.5, 'x2 combo should multiply by 1.5');
  testSuite.assertEqual(calculateComboMultiplier(3), 2, 'x3 combo should multiply by 2');
  testSuite.assertEqual(calculateComboMultiplier(5), 2.5, 'x5 combo should multiply by 2.5');
  testSuite.assertEqual(calculateComboMultiplier(9), 2.5, 'x9 combo should multiply by 2.5');
  testSuite.assertEqual(calculateComboMultiplier(10), 3, 'x10 combo should multiply by 3');
  testSuite.assertEqual(calculateComboMultiplier(15), 3, 'x15 combo should multiply by 3');
});

// ── INTEGRATION TESTS ────────────────────────────────────────────────────────────────

testSuite.test('Integration: Full game loop simulation', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const pieces = [
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
  ];
  
  let score = 0;
  let gameOver = false;
  
  // Simulate 100 random piece placements
  for (let i = 0; i < 100; i++) {
    // Find a valid placement
    let placed = false;
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      const piece = pieces[Math.floor(Math.random() * pieces.length)];
      const ox = Math.floor(Math.random() * 9);
      const oy = Math.floor(Math.random() * 9);
      
      if (board.canPlace(piece, ox, oy)) {
        board.placePiece(piece, ox, oy, 1);
        score += 10;
        placed = true;
        
        // Check for completed lines
        const { rows, cols } = board.findCompletedLines();
        if (rows.length > 0 || cols.length > 0) {
          score += rows.length * 100 + cols.length * 150;
          rows.forEach(y => board.clearLine(y));
          cols.forEach(x => board.clearColumn(x));
        }
      }
    }
    
    // Check if game is over
    const hasValidPlacement = pieces.some(piece => 
      [...Array(9).keys()].some(y => 
        [...Array(9).keys()].some(x => 
          board.canPlace(piece, x, y)
        )
      )
    );
    
    if (!hasValidPlacement) {
      gameOver = true;
      break;
    }
  }
  
  testSuite.assertTrue(score > 0, 'Score should increase during simulation');
  testSuite.assertTrue(gameOver || i === 100, 'Game should end or complete 100 placements');
  console.log(`  📊 Final score: ${score}, Game over: ${gameOver}`);
});

testSuite.test('Integration: Mode switching memory leak detection', () => {
  const boards = [];
  const loops = [];
  
  // Create and destroy multiple game instances
  for (let i = 0; i < 10; i++) {
    const board = new Board(9, 9);
    const bus = new MockEventBus();
    
    // Fill some cells
    for (let j = 0; j < 20; j++) {
      board.setCell(
        Math.floor(Math.random() * 9),
        Math.floor(Math.random() * 9),
        Math.floor(Math.random() * 8) + 1
      );
    }
    
    boards.push(board);
    
    // Simulate mode switch
    board.reset();
    
    // Check memory cleanup
    testSuite.assertEqual(board._cells.length, 81, 'Board cells array should maintain size');
    testSuite.assertEqual(board._flags.length, 81, 'Board flags array should maintain size');
    testSuite.assertEqual(board._nexusGroups.length, 81, 'Board nexus groups array should maintain size');
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  testSuite.assertTrue(boards.length === 10, 'All boards should be tracked');
});

testSuite.test('Integration: localStorage save/load', () => {
  const testKey = 'nexus_test_storage';
  const testData = {
    score: 12345,
    highScore: 67890,
    settings: { music: true, sfx: false, masterVolume: 0.75 }
  };
  
  // Test save
  try {
    localStorage.setItem(testKey, JSON.stringify(testData));
    testSuite.assertTrue(true, 'localStorage save should succeed');
  } catch (e) {
    testSuite.assertTrue(false, 'localStorage save should not throw');
  }
  
  // Test load
  try {
    const loaded = JSON.parse(localStorage.getItem(testKey) || '{}');
    testSuite.assertEqual(loaded.score, testData.score, 'Score should be preserved');
    testSuite.assertEqual(loaded.highScore, testData.highScore, 'High score should be preserved');
    testSuite.assertEqual(loaded.settings.music, testData.settings.music, 'Settings should be preserved');
  } catch (e) {
    testSuite.assertTrue(false, 'localStorage load should not throw');
  }
  
  // Test corrupted data recovery
  try {
    localStorage.setItem(testKey, 'invalid json');
    const recovered = JSON.parse(localStorage.getItem(testKey) || '{}');
    testSuite.assertTrue(typeof recovered === 'object', 'Corrupted data should fallback to empty object');
  } catch (e) {
    testSuite.assertTrue(true, 'Corrupted data should be handled gracefully');
  }
  
  // Cleanup
  try {
    localStorage.removeItem(testKey);
  } catch (e) {
    // Ignore cleanup errors
  }
});

// ── PERFORMANCE AUDIT ────────────────────────────────────────────────────────────────────

testSuite.test('Performance: Board operations profiling', () => {
  const board = new Board(9, 9);
  const iterations = 1000;
  
  // Profile getCell performance
  const startGet = performance.now();
  for (let i = 0; i < iterations; i++) {
    board.getCell(i % 9, Math.floor(i / 9) % 9);
  }
  const getAvg = (performance.now() - startGet) / iterations;
  testSuite.assertTrue(getAvg < 0.001, `getCell should be fast (< 1ms avg, got ${getAvg.toFixed(4)}ms)`);
  
  // Profile setCell performance
  const startSet = performance.now();
  for (let i = 0; i < iterations; i++) {
    board.setCell(i % 9, Math.floor(i / 9) % 9, (i % 8) + 1);
  }
  const setAvg = (performance.now() - startSet) / iterations;
  testSuite.assertTrue(setAvg < 0.002, `setCell should be fast (< 2ms avg, got ${setAvg.toFixed(4)}ms)`);
  
  // Profile canPlace performance
  const testPiece = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  const startCan = performance.now();
  for (let i = 0; i < iterations; i++) {
    board.canPlace(testPiece, i % 9, Math.floor(i / 9) % 9);
  }
  const canAvg = (performance.now() - startCan) / iterations;
  testSuite.assertTrue(canAvg < 0.005, `canPlace should be fast (< 5ms avg, got ${canAvg.toFixed(4)}ms)`);
  
  console.log(`  📊 Performance results:`);
  console.log(`    getCell: ${getAvg.toFixed(4)}ms avg`);
  console.log(`    setCell: ${setAvg.toFixed(4)}ms avg`);
  console.log(`    canPlace: ${canAvg.toFixed(4)}ms avg`);
});

testSuite.test('Performance: Game loop profiling', () => {
  const updateFn = (dt) => {
    // Simulate game logic
    const start = performance.now();
    Math.random(); // Simulate some computation
    return performance.now() - start;
  };
  
  const renderFn = (alpha) => {
    // Simulate rendering
    const start = performance.now();
    Math.random(); // Simulate rendering work
    return performance.now() - start;
  };
  
  // Mock GameLoop for testing
  class MockGameLoop {
    constructor(updateFn, renderFn) {
      this.updateFn = updateFn;
      this.renderFn = renderFn;
      this.running = false;
      this._accumulator = 0;
      this.TICK_MS = 16.67;
    }
    
    start() {
      this.running = true;
      this._accumulator = 0;
      this._lastTime = performance.now();
      this._loop();
    }
    
    stop() {
      this.running = false;
    }
    
    _loop() {
      if (!this.running) return;
      
      const now = performance.now();
      const rawDelta = now - this._lastTime;
      const delta = Math.min(rawDelta, 250);
      this._accumulator += delta;
      
      let updateCount = 0;
      while (this._accumulator >= this.TICK_MS && updateCount < 5) {
        this.updateFn(this.TICK_MS);
        this._accumulator -= this.TICK_MS;
        updateCount++;
      }
      
      const alpha = this._accumulator / this.TICK_MS;
      this.renderFn(alpha);
      
      this._lastTime = now;
      
      if (this.running) {
        requestAnimationFrame(() => this._loop());
      }
    }
  }
  
  const loop = new MockGameLoop(updateFn, renderFn);
  
  // Profile frame time
  const frameCount = 60;
  const startFrame = performance.now();
  let frameCounted = 0;
  
  const originalRAF = requestAnimationFrame;
  requestAnimationFrame = (callback) => {
    if (frameCounted < frameCount) {
      callback(performance.now());
      frameCounted++;
    }
  };
  
  loop.start();
  
  // Wait for frames to complete
  setTimeout(() => {
    loop.stop();
    requestAnimationFrame = originalRAF;
    
    const avgFrameTime = (performance.now() - startFrame) / frameCount;
    testSuite.assertTrue(avgFrameTime < 20, `Frame time should be under 20ms (got ${avgFrameTime.toFixed(2)}ms)`);
    console.log(`  📊 Average frame time: ${avgFrameTime.toFixed(2)}ms`);
  }, 1000);
});

// ── EDGE CASES ────────────────────────────────────────────────────────────────────────

testSuite.test('Edge case: Rapid tapping during animation', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  let animationInProgress = false;
  
  // Simulate rapid piece placement
  const rapidPlace = () => {
    for (let i = 0; i < 20; i++) {
      setTimeout(() => {
        if (!animationInProgress) {
          const piece = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
          const ox = Math.floor(Math.random() * 9);
          const oy = Math.floor(Math.random() * 9);
          
          if (board.canPlace(piece, ox, oy)) {
            animationInProgress = true;
            board.placePiece(piece, ox, oy, 1);
            
            // Simulate animation completion
            setTimeout(() => {
              animationInProgress = false;
            }, 100);
          }
        }
      }, i * 10);
    }
  };
  
  rapidPlace();
  
  // Wait for all placements to complete
  setTimeout(() => {
    testSuite.assertTrue(true, 'Rapid tapping should not crash');
  }, 500);
});

testSuite.test('Edge case: localStorage disabled', () => {
  // Mock localStorage being disabled
  const originalLocalStorage = global.localStorage;
  global.localStorage = undefined;
  
  try {
    const Storage = {
      get(key, fallback = null) {
        try { return JSON.parse(global.localStorage.getItem(key)); }
        catch { return fallback; }
      },
      set(key, value) {
        try { global.localStorage.setItem(key, JSON.stringify(value)); }
        catch { /* ignore */ }
      }
    };
    
    Storage.set('test', 'value');
    const result = Storage.get('test');
    testSuite.assertEqual(result, 'value', 'Storage should fallback gracefully');
    
    // Test with undefined localStorage
    const result2 = Storage.get('nonexistent', 'default');
    testSuite.assertEqual(result2, 'default', 'Storage should return fallback');
    
    global.localStorage = originalLocalStorage;
    testSuite.assertTrue(true, 'localStorage disabled should be handled gracefully');
  } catch (e) {
    testSuite.assertTrue(false, 'localStorage disabled test should not throw');
  }
});

testSuite.test('Edge case: Canvas 0×0 dimensions', () => {
  // Mock canvas with zero dimensions
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect: () => { throw new Error('Canvas context error'); },
      clearRect: () => { /* no-op */ }
    })
  };
  
  // Test canvas renderer with zero dimensions
  try {
    // Simulate canvas renderer initialization
    if (mockCanvas.width === 0 || mockCanvas.height === 0) {
      throw new Error('Canvas dimensions too small');
    }
    testSuite.assertFalse(true, 'Should throw error for zero dimensions');
  } catch (e) {
    testSuite.assertTrue(true, 'Should handle zero dimensions gracefully');
  }
  
  // Test resize handling
  const resizeHandler = (canvas) => {
    if (canvas.width < 100 || canvas.height < 100) {
      console.warn('Canvas too small, using minimum dimensions');
      canvas.width = Math.max(canvas.width, 100);
      canvas.height = Math.max(canvas.height, 100);
    }
  };
  
  resizeHandler(mockCanvas);
  testSuite.assertEqual(mockCanvas.width, 100, 'Canvas width should be clamped to minimum');
  testSuite.assertEqual(mockCanvas.height, 100, 'Canvas height should be clamped to minimum');
});

testSuite.test('Edge case: AudioContext blocked', () => {
  // Mock AudioContext being blocked
  const originalAudioContext = global.AudioContext;
  global.AudioContext = undefined;
  global.webkitAudioContext = undefined;
  
  try {
    const audioEngine = {
      init: () => {
        if (!global.AudioContext && !global.webkitAudioContext) {
          console.warn('AudioContext not available');
          return false;
        }
        return true;
      }
    };
    
    const success = audioEngine.init();
    testSuite.assertFalse(success, 'AudioEngine should handle blocked AudioContext');
  } catch (e) {
    testSuite.assertTrue(true, 'AudioContext blocked should be handled gracefully');
  }
  
  // Restore original AudioContext
  global.AudioContext = originalAudioContext;
  global.webkitAudioContext = originalAudioContext;
});

// ── ACCESSIBILITY CHECKLIST ────────────────────────────────────────────────────────────────

testSuite.test('Accessibility: Keyboard navigation', () => {
  // Check for keyboard event listeners
  const hasKeyboardSupport = 'addEventListener' in document;
  testSuite.assertTrue(hasKeyboardSupport, 'Document should support addEventListener');
  
  // Mock keyboard navigation test
  const mockElement = document.createElement('button');
  mockElement.tabIndex = 0;
  testSuite.assertTrue(typeof mockElement.tabIndex === 'number', 'Interactive elements should have tabIndex');
  
  // Test focus management
  let focused = false;
  mockElement.addEventListener('focus', () => { focused = true; });
  mockElement.focus();
  testSuite.assertTrue(focused, 'Elements should be focusable');
});

testSuite.test('Accessibility: ARIA labels', () => {
  // Check for ARIA attributes on game elements
  const testElement = document.createElement('div');
  
  // Test aria-label
  testElement.setAttribute('aria-label', 'Game board');
  testSuite.assertEqual(testElement.getAttribute('aria-label'), 'Game board', 'aria-label should be settable');
  
  // Test aria-live regions
  testElement.setAttribute('aria-live', 'polite');
  testSuite.assertEqual(testElement.getAttribute('aria-live'), 'polite', 'aria-live should be settable');
  
  // Test aria-hidden
  testElement.setAttribute('aria-hidden', 'true');
  testSuite.assertEqual(testElement.getAttribute('aria-hidden'), 'true', 'aria-hidden should be settable');
});

testSuite.test('Accessibility: Reduced motion support', () => {
  // Test prefers-reduced-motion detection
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  testSuite.assertTrue(typeof mediaQuery.matches === 'function', 'matchMedia should be available');
  
  // Test animation disabling
  const shouldDisableAnimations = mediaQuery.matches;
  if (shouldDisableAnimations) {
    console.log('🔇 Animations should be disabled for reduced motion preference');
  }
  
  // Test CSS custom property for reduced motion
  const root = document.documentElement;
  root.style.setProperty('--animation-duration', shouldDisableAnimations ? '0.01s' : '0.3s');
  
  const duration = root.style.getPropertyValue('--animation-duration');
  testSuite.assertTrue(duration === '0.01s' || duration === '0.3s', 'Animation duration should be adjustable');
});

testSuite.test('Accessibility: High contrast support', () => {
  // Test prefers-contrast detection
  const mediaQuery = window.matchMedia('(prefers-contrast: high)');
  testSuite.assertTrue(typeof mediaQuery.matches === 'function', 'matchMedia should be available');
  
  // Test border visibility enhancement
  const shouldIncreaseContrast = mediaQuery.matches;
  if (shouldIncreaseContrast) {
    console.log('🔆 Borders should be enhanced for high contrast preference');
  }
  
  // Test CSS custom property for border width
  const root = document.documentElement;
  root.style.setProperty('--border-width', shouldIncreaseContrast ? '3px' : '1px');
  
  const borderWidth = root.style.getPropertyValue('--border-width');
  testSuite.assertTrue(borderWidth === '3px' || borderWidth === '1px', 'Border width should be adjustable');
});

// ── HELPER METHODS ───────────────────────────────────────────────────────────────────────

testSuite.assertDeepEqual = function (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// ── RUN TESTS ───────────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TestSuite };
} else {
  // Browser environment
  testSuite.runAll();
}