/**
 * NEXUS BLOCKS — Board Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Vanilla JS test runner (no Jest) for Board.js core functionality
 */

'use strict';

// Simple test framework
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
    console.log('🧪 Running Board.js Unit Tests...\n');
    
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

// Mock EventBus for testing
class MockEventBus {
  constructor() {
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
  }
}

// Load Board class (in browser, it's already global)
// In Node.js, we'd require it here

const runner = new TestRunner();

// ── Test Data: All 12 piece shapes ─────────────────────────────────────────────

const PIECE_SHAPES = {
  'P01 Spark': [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}],
  'P02 Bolt': [{x:0,y:0}, {x:1,y:1}, {x:1,y:2}],
  'P03 Anvil': [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
  'P04 Fang': [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:1,y:2}],
  'P05 Crown': [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
  'P06 Helix': [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}],
  'P07 Bastion': [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:1,y:2}],
  'P08 Talon': [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:2,y:1}],
  'P09 Monolith': [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:0,y:3}, {x:0,y:4}],
  'P10 Arch': [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:2,y:1}, {x:0,y:2}, {x:1,y:2}, {x:2,y:2}],
  'P11 Wraith': [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}, {x:2,y:3}],
  'P12 Nexus Core': [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}]
};

// ── Unit Tests ───────────────────────────────────────────────────────────────

runner.test('Board constructor creates proper dimensions', () => {
  const board = new Board(9, 9);
  runner.assertEqual(board.width, 9);
  runner.assertEqual(board.height, 9);
  runner.assert(board._cells instanceof Int8Array);
  runner.assert(board._flags instanceof Uint8Array);
  runner.assertEqual(board._cells.length, 81);
});

runner.test('Board.getCell returns 0 for out-of-bounds', () => {
  const board = new Board(5, 5);
  runner.assertEqual(board.getCell(-1, 0), 0);
  runner.assertEqual(board.getCell(5, 0), 0);
  runner.assertEqual(board.getCell(0, -1), 0);
  runner.assertEqual(board.getCell(0, 5), 0);
});

runner.test('Board.setCell handles bounds correctly', () => {
  const board = new Board(5, 5);
  board.setCell(-1, 0, 1); // Should not crash
  board.setCell(5, 0, 1);  // Should not crash
  runner.assertEqual(board.getCell(0, 0), 0); // Should still be empty
});

runner.test('Board.canPlace detects boundary violations', () => {
  const board = new Board(9, 9);
  const piece = PIECE_SHAPES['P01 Spark'];
  
  // Valid placement
  runner.assert(board.canPlace(piece, 0, 0));
  
  // Out of bounds left
  runner.assert(!board.canPlace(piece, -1, 0));
  
  // Out of bounds right
  runner.assert(!board.canPlace(piece, 8, 0));
  
  // Out of bounds top
  runner.assert(!board.canPlace(piece, 0, -1));
  
  // Out of bounds bottom
  runner.assert(!board.canPlace(piece, 0, 8));
});

runner.test('Board.canPlace detects collisions with existing pieces', () => {
  const board = new Board(9, 9);
  const piece = PIECE_SHAPES['P01 Spark'];
  
  // Place a blocking piece
  board.setCell(1, 1, 1);
  
  // Should fail due to collision
  runner.assert(!board.canPlace(piece, 0, 0));
  
  // Should succeed at different position
  runner.assert(board.canPlace(piece, 2, 2));
});

runner.test('Board.placePiece places cells correctly', () => {
  const board = new Board(9, 9);
  const bus = new MockEventBus();
  const boardWithBus = new Board(9, 9, bus);
  const piece = PIECE_SHAPES['P01 Spark'];
  
  const placed = boardWithBus.placePiece(piece, 0, 0, 3);
  
  runner.assertEqual(placed.length, 3);
  runner.assertEqual(boardWithBus.getCell(0, 0), 3);
  runner.assertEqual(boardWithBus.getCell(0, 1), 3);
  runner.assertEqual(boardWithBus.getCell(1, 1), 3);
  runner.assertEqual(bus.events.length, 1);
  runner.assertEqual(bus.events[0].event, 'piece:placed');
});

runner.test('Board.isLineFull detects complete rows', () => {
  const board = new Board(5, 5);
  
  // Empty row
  runner.assert(!board.isLineFull(0));
  
  // Partial row
  board.setCell(0, 0, 1);
  board.setCell(2, 0, 1);
  runner.assert(!board.isLineFull(0));
  
  // Full row
  for (let x = 0; x < 5; x++) {
    board.setCell(x, 0, 1);
  }
  runner.assert(board.isLineFull(0));
});

runner.test('Board.isColumnFull detects complete columns', () => {
  const board = new Board(5, 5);
  
  // Empty column
  runner.assert(!board.isColumnFull(0));
  
  // Partial column
  board.setCell(0, 0, 1);
  board.setCell(0, 2, 1);
  runner.assert(!board.isColumnFull(0));
  
  // Full column
  for (let y = 0; y < 5; y++) {
    board.setCell(0, y, 1);
  }
  runner.assert(board.isColumnFull(0));
});

runner.test('Board.findCompletedLines finds all full lines', () => {
  const board = new Board(5, 5);
  
  // Fill row 0 and column 2
  for (let x = 0; x < 5; x++) board.setCell(x, 0, 1);
  for (let y = 0; y < 5; y++) board.setCell(2, y, 1);
  
  const result = board.findCompletedLines();
  runner.assertDeepEqual(result.rows, [0]);
  runner.assertDeepEqual(result.cols, [2]);
});

runner.test('Board.clearLine clears a row completely', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const boardWithBus = new Board(5, 5, bus);
  
  // Fill row 2
  for (let x = 0; x < 5; x++) {
    boardWithBus.setCell(x, 2, 1);
  }
  
  boardWithBus.clearLine(2);
  
  // Row should be empty
  for (let x = 0; x < 5; x++) {
    runner.assertEqual(boardWithBus.getCell(x, 2), 0);
  }
  
  // Other rows unaffected
  runner.assertEqual(boardWithBus.getCell(0, 0), 0);
  runner.assertEqual(boardWithBus.getCell(0, 4), 0);
  
  runner.assertEqual(bus.events.length, 1);
  runner.assertEqual(bus.events[0].event, 'line:cleared');
});

runner.test('Board.clearColumn clears a column completely', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const boardWithBus = new Board(5, 5, bus);
  
  // Fill column 3
  for (let y = 0; y < 5; y++) {
    boardWithBus.setCell(3, y, 1);
  }
  
  boardWithBus.clearColumn(3);
  
  // Column should be empty
  for (let y = 0; y < 5; y++) {
    runner.assertEqual(boardWithBus.getCell(3, y), 0);
  }
  
  runner.assertEqual(bus.events.length, 1);
  runner.assertEqual(bus.events[0].event, 'column:cleared');
});

runner.test('Board.processClears handles simultaneous clears', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const boardWithBus = new Board(5, 5, bus);
  
  // Fill row 1 and column 2
  for (let x = 0; x < 5; x++) boardWithBus.setCell(x, 1, 1);
  for (let y = 0; y < 5; y++) boardWithBus.setCell(2, y, 1);
  
  const result = boardWithBus.processClears();
  
  runner.assertDeepEqual(result.rows, [1]);
  runner.assertDeepEqual(result.cols, [2]);
  runner.assertEqual(result.nexusDestroyed, 0);
  
  // Should emit multiple events
  runner.assert(bus.events.length > 0);
});

// ── Collision Detection Tests for All 12 Pieces ───────────────────────────────

for (const [pieceName, cells] of Object.entries(PIECE_SHAPES)) {
  runner.test(`Collision detection: ${pieceName}`, () => {
    const board = new Board(9, 9);
    
    // Test at origin
    runner.assert(board.canPlace(cells, 0, 0), `${pieceName} should place at origin`);
    
    // Test at each edge
    const maxX = 9 - Math.max(...cells.map(c => c.x)) - 1;
    const maxY = 9 - Math.max(...cells.map(c => c.y)) - 1;
    
    runner.assert(board.canPlace(cells, maxX, 0), `${pieceName} should place at right edge`);
    runner.assert(board.canPlace(cells, 0, maxY), `${pieceName} should place at bottom edge`);
    runner.assert(board.canPlace(cells, maxX, maxY), `${pieceName} should place at bottom-right corner`);
    
    // Test just outside bounds
    runner.assert(!board.canPlace(cells, maxX + 1, 0), `${pieceName} should fail beyond right edge`);
    runner.assert(!board.canPlace(cells, 0, maxY + 1), `${pieceName} should fail beyond bottom edge`);
  });
}

// ── Flag System Tests ───────────────────────────────────────────────────────

runner.test('Board flag system works correctly', () => {
  const board = new Board(5, 5);
  
  // Set flags
  board.setFlag(0, 0, CellFlag.LINKED);
  board.setFlag(0, 0, CellFlag.FROZEN);
  
  runner.assert(board.getFlag(0, 0, CellFlag.LINKED));
  runner.assert(board.getFlag(0, 0, CellFlag.FROZEN));
  runner.assert(!board.getFlag(0, 0, CellFlag.CRACKED));
  
  // Clear flag
  board.setFlag(0, 0, CellFlag.LINKED, false);
  runner.assert(!board.getFlag(0, 0, CellFlag.LINKED));
  runner.assert(board.getFlag(0, 0, CellFlag.FROZEN));
});

// ── Gravity Tests ─────────────────────────────────────────────────────────────

runner.test('Board.applyGravity moves pieces down', () => {
  const board = new Board(5, 5);
  
  // Place a piece at top
  board.setCell(2, 0, 1);
  
  const moved = board.applyGravity('down');
  
  runner.assert(moved);
  runner.assertEqual(board.getCell(2, 0), 0);
  runner.assertEqual(board.getCell(2, 4), 1);
});

runner.test('Board.applyGravity respects frozen blocks', () => {
  const board = new Board(5, 5);
  
  // Place a frozen block
  board.setCell(2, 0, 1, CellFlag.FROZEN);
  board.setCell(2, 1, 1);
  
  const moved = board.applyGravity('down');
  
  runner.assert(moved);
  runner.assertEqual(board.getCell(2, 0), 1); // Frozen block stays
  runner.assertEqual(board.getCell(2, 1), 0);
  runner.assertEqual(board.getCell(2, 4), 1); // Other block moved
});

// ── Ghost Piece Tests ───────────────────────────────────────────────────────

runner.test('Board.calculateGhost finds furthest valid position', () => {
  const board = new Board(9, 9);
  const piece = PIECE_SHAPES['P01 Spark'];
  
  // Place a floor at bottom
  for (let x = 0; x < 9; x++) {
    board.setCell(x, 8, 1);
  }
  
  const ghost = board.calculateGhost(piece, 0, 0, 'down');
  
  runner.assert(ghost !== null);
  runner.assertEqual(ghost.ox, 0);
  runner.assertEqual(ghost.oy, 6); // Should stop just above the floor
});

runner.test('Board.calculateGhost returns null for invalid placement', () => {
  const board = new Board(9, 9);
  const piece = PIECE_SHAPES['P01 Spark'];
  
  // Place a blocking piece
  board.setCell(0, 0, 1);
  
  const ghost = board.calculateGhost(piece, 0, 0, 'down');
  
  runner.assertEqual(ghost, null);
});

// ── Nexus System Tests ─────────────────────────────────────────────────────

runner.test('Board.createNexusGroup links cells', () => {
  const board = new Board(5, 5);
  const positions = [{x:0,y:0}, {x:1,y:0}];
  
  const groupId = board.createNexusGroup(positions);
  
  runner.assert(groupId > 0);
  runner.assert(board.getFlag(0, 0, CellFlag.LINKED));
  runner.assert(board.getFlag(1, 0, CellFlag.LINKED));
  runner.assertEqual(board._nexusGroups[board._idx(0, 0)], groupId);
  runner.assertEqual(board._nexusGroups[board._idx(1, 0)], groupId);
});

// ── Edge Case Tests ─────────────────────────────────────────────────────────

runner.test('Board handles zero-sized board gracefully', () => {
  const board = new Board(0, 0);
  runner.assertEqual(board.width, 0);
  runner.assertEqual(board.height, 0);
  runner.assertEqual(board._cells.length, 0);
});

runner.test('Board handles negative dimensions gracefully', () => {
  const board = new Board(-1, -1);
  runner.assertEqual(board.width, -1);
  runner.assertEqual(board.height, -1);
});

runner.test('Board.reset clears all state', () => {
  const board = new Board(5, 5);
  const bus = new MockEventBus();
  const boardWithBus = new Board(5, 5, bus);
  
  // Add some pieces
  boardWithBus.setCell(0, 0, 1, CellFlag.LINKED);
  boardWithBus.setCell(1, 1, 2);
  boardWithBus.createNexusGroup([{x:0,y:0}]);
  
  boardWithBus.reset();
  
  // Everything should be cleared
  runner.assertEqual(boardWithBus.getCell(0, 0), 0);
  runner.assertEqual(boardWithBus.getCell(1, 1), 0);
  runner.assert(!boardWithBus.getFlag(0, 0, CellFlag.LINKED));
  runner.assertEqual(boardWithBus._nexusGroups[boardWithBus._idx(0, 0)], 0);
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.boardTestRunner = runner;
}