/**
 * NEXUS BLOCKS — PieceFactory Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests piece rotation, collision detection at edges, and factory behavior
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
    console.log('🧪 Running PieceFactory Unit Tests...\n');
    
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

const runner = new TestRunner();

// ── Piece Rotation Tests ───────────────────────────────────────────────────

runner.test('PieceFactory.rotate handles 90° clockwise rotation', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}]; // Horizontal line
  const rotated = PieceFactory.rotate(cells, 1);
  
  // Should become vertical line at (0,0)
  const expected = [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}];
  runner.assertDeepEqual(rotated, expected);
});

runner.test('PieceFactory.rotate handles 180° rotation', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}]; // Horizontal line
  const rotated = PieceFactory.rotate(cells, 2);
  
  // Should become horizontal line flipped
  const expected = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}];
  runner.assertDeepEqual(rotated, expected);
});

runner.test('PieceFactory.rotate handles 270° rotation', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}]; // Horizontal line
  const rotated = PieceFactory.rotate(cells, 3);
  
  // Should become vertical line at (0,0) but flipped
  const expected = [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}];
  runner.assertDeepEqual(rotated, expected);
});

runner.test('PieceFactory.rotate normalizes to (0,0) origin', () => {
  const cells = [{x:1,y:1}, {x:2,y:1}]; // Offset piece
  const rotated = PieceFactory.rotate(cells, 1);
  
  // After rotation, should be normalized back to (0,0)
  runner.assertEqual(rotated[0].x, 0);
  runner.assertEqual(rotated[0].y, 0);
});

runner.test('PieceFactory.rotate handles negative coordinates', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}]; // L shape
  const rotated = PieceFactory.rotate(cells, 1);
  
  // Should handle negative coords and normalize
  const minX = Math.min(...rotated.map(c => c.x));
  const minY = Math.min(...rotated.map(c => c.y));
  runner.assertEqual(minX, 0);
  runner.assertEqual(minY, 0);
});

// ── All 12 Pieces Rotation Tests ───────────────────────────────────────────

const PIECE_ROTATIONS = {
  'P01 Spark': [
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}], // 0°
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:-1}], // 90°
    [{x:1,y:0}, {x:1,y:1}, {x:0,y:1}], // 180°
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}]   // 270°
  ],
  'P02 Bolt': [
    [{x:0,y:0}, {x:1,y:1}, {x:1,y:2}],
    [{x:0,y:0}, {x:1,y:0}, {x:2,y:1}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}],
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:2}]
  ],
  'P03 Anvil': [
    [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:0}, {x:1,y:1}, {x:1,y:0}, {x:1,y:2}],
    [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:1}, {x:1,y:0}, {x:1,y:1}, {x:2,y:1}]
  ],
  'P04 Fang': [
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:1,y:2}],
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:1,y:2}],
    [{x:0,y:1}, {x:1,y:1}, {x:1,y:0}, {x:2,y:0}]
  ],
  'P05 Crown': [
    [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:0}, {x:0,y:2}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}],
    [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:0}, {x:0,y:2}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}]
  ],
  'P06 Helix': [
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:2,y:0}],
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}],
    [{x:0,y:2}, {x:1,y:2}, {x:1,y:1}, {x:2,y:1}, {x:2,y:2}]
  ],
  'P07 Bastion': [
    [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:1,y:2}],
    [{x:0,y:1}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:1}],
    [{x:1,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:1,y:2}],
    [{x:0,y:1}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:1}]
  ],
  'P08 Talon': [
    [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:2,y:1}],
    [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:1,y:0}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}],
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}]
  ],
  'P09 Monolith': [
    [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:0,y:3}, {x:0,y:4}],
    [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:3,y:0}, {x:4,y:0}],
    [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:0,y:3}, {x:0,y:4}],
    [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:3,y:0}, {x:4,y:0}]
  ],
  'P10 Arch': [
    [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:2,y:1}, {x:0,y:2}, {x:1,y:2}, {x:2,y:2}],
    [{x:0,y:0}, {x:0,y:2}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:0}, {x:2,y:2}],
    [{x:0,y:0}, {x:2,y:0}, {x:0,y:1}, {x:2,y:1}, {x:0,y:2}, {x:1,y:2}, {x:2,y:2}],
    [{x:0,y:0}, {x:0,y:2}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:0}, {x:2,y:2}]
  ],
  'P11 Wraith': [
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}, {x:2,y:3}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:2,y:0}, {x:3,y:0}],
    [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:1,y:2}, {x:2,y:2}, {x:2,y:3}],
    [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:2,y:0}, {x:3,y:0}]
  ],
  'P12 Nexus Core': [
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}],
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}],
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}],
    [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}]
  ]
};

// Test rotation for all pieces
for (const [pieceName, expectedRotations] of Object.entries(PIECE_ROTATIONS)) {
  const originalCells = expectedRotations[0];
  
  for (let rotation = 0; rotation < 4; rotation++) {
    runner.test(`${pieceName} rotation ${rotation * 90}°`, () => {
      const rotated = PieceFactory.rotate(originalCells, rotation);
      const expected = expectedRotations[rotation];
      
      runner.assertDeepEqual(rotated, expected);
    });
  }
}

// ── Edge Collision Tests ─────────────────────────────────────────────────

runner.test('All pieces can be placed at board edges without overflow', () => {
  const board = new Board(9, 9);
  
  for (const [pieceName, cells] of Object.entries(PIECE_ROTATIONS)) {
    const originalCells = cells[0];
    
    // Test all 4 rotations
    for (let rot = 0; rot < 4; rot++) {
      const rotated = PieceFactory.rotate(originalCells, rot);
      
      // Calculate max extents
      const maxX = Math.max(...rotated.map(c => c.x));
      const maxY = Math.max(...rotated.map(c => c.y));
      
      // Test placement at each edge
      const positions = [
        {x: 0, y: 0, name: 'top-left'},
        {x: 9 - maxX - 1, y: 0, name: 'top-right'},
        {x: 0, y: 9 - maxY - 1, name: 'bottom-left'},
        {x: 9 - maxX - 1, y: 9 - maxY - 1, name: 'bottom-right'}
      ];
      
      for (const pos of positions) {
        runner.assert(
          board.canPlace(rotated, pos.x, pos.y),
          `${pieceName} rot${rot} should fit at ${pos.name} (${pos.x},${pos.y})`
        );
      }
    }
  }
});

runner.test('Pieces fail placement just outside board edges', () => {
  const board = new Board(9, 9);
  const piece = PIECE_ROTATIONS['P01 Spark'][0]; // Simple L piece
  
  // Test just outside each edge
  runner.assert(!board.canPlace(piece, -1, 0), 'Should fail at x=-1');
  runner.assert(!board.canPlace(piece, 8, 0), 'Should fail at x=8 (overflow)');
  runner.assert(!board.canPlace(piece, 0, -1), 'Should fail at y=-1');
  runner.assert(!board.canPlace(piece, 0, 8), 'Should fail at y=8 (overflow)');
});

// ── All Rotations Test ─────────────────────────────────────────────────

runner.test('PieceFactory.allRotations returns unique rotations', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}]; // Horizontal line
  const rotations = PieceFactory.allRotations(cells);
  
  // Should return 2 unique rotations (horizontal and vertical)
  runner.assertEqual(rotations.length, 2);
  
  // Check they're different
  runner.assertDeepEqual(rotations[0], [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}]);
  runner.assertDeepEqual(rotations[1], [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}]);
});

runner.test('PieceFactory.allRotations handles symmetric pieces', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}]; // 2x2 square
  const rotations = PieceFactory.allRotations(cells);
  
  // Should return only 1 unique rotation (all rotations are identical)
  runner.assertEqual(rotations.length, 1);
});

// ── Bounding Box Tests ─────────────────────────────────────────────────

runner.test('PieceFactory.boundingBox calculates dimensions correctly', () => {
  const cells = [{x:1,y:2}, {x:3,y:4}, {x:0,y:0}];
  const bbox = PieceFactory.boundingBox(cells);
  
  runner.assertEqual(bbox.w, 4); // max x = 3, so width = 4
  runner.assertEqual(bbox.h, 5); // max y = 4, so height = 5
});

runner.test('PieceFactory.boundingBox handles single cell', () => {
  const cells = [{x:0,y:0}];
  const bbox = PieceFactory.boundingBox(cells);
  
  runner.assertEqual(bbox.w, 1);
  runner.assertEqual(bbox.h, 1);
});

// ── Factory Tests ─────────────────────────────────────────────────────────

runner.test('PieceFactory constructor with default options', () => {
  const factory = new PieceFactory();
  
  runner.assert(factory._seed > 0);
  runner.assertEqual(factory._diffTier, 2);
  runner.assert(factory._bag.length > 0);
  runner.assertEqual(factory._bagIndex, 0);
});

runner.test('PieceFactory.next() returns valid piece', () => {
  const factory = new PieceFactory();
  const piece = factory.next();
  
  runner.assert(typeof piece.id === 'string');
  runner.assert(typeof piece.name === 'string');
  runner.assert(Array.isArray(piece.cells));
  runner.assert(piece.cells.length > 0);
  runner.assert(piece.rotation === 0);
  runner.assert(piece.colorIndex >= 1 && piece.colorIndex <= 8);
  runner.assert(Array.isArray(piece.nexusFlags));
  runner.assertEqual(piece.nexusFlags.length, piece.cells.length);
});

runner.test('PieceFactory.nextBatch() returns multiple pieces', () => {
  const factory = new PieceFactory();
  const batch = factory.nextBatch(3);
  
  runner.assertEqual(batch.length, 3);
  runner.assert(batch[0].id !== batch[1].id || batch[1].id !== batch[2].id);
});

runner.test('PieceFactory.getHistory() returns recent pieces', () => {
  const factory = new PieceFactory();
  
  // Generate some pieces
  factory.next();
  factory.next();
  factory.next();
  
  const history = factory.getHistory(2);
  runner.assertEqual(history.length, 2);
  runner.assert(history[0] !== history[1]);
});

runner.test('PieceFactory.reseed() changes the sequence', () => {
  const factory1 = new PieceFactory({ seed: 12345 });
  const factory2 = new PieceFactory({ seed: 12345 });
  const factory3 = new PieceFactory({ seed: 67890 });
  
  const p1 = factory1.next();
  const p2 = factory2.next();
  const p3 = factory3.next();
  
  // Same seed should produce same piece
  runner.assertEqual(p1.id, p2.id);
  runner.assertEqual(p1.colorIndex, p2.colorIndex);
  
  // Different seed should produce different piece
  runner.assertNotEqual(p1.id, p3.id);
});

runner.test('PieceFactory.setDifficultyTier() filters pieces', () => {
  const factory = new PieceFactory();
  
  // Set to tier 0 (basic pieces only)
  factory.setDifficultyTier(0);
  factory._bagIndex = factory._bag.length; // Force refill
  
  const piece = factory.next();
  const def = PieceFactory.getDefinition(piece.id);
  runner.assertEqual(def.rarity, 'common');
});

runner.test('PieceFactory with enabledIds filter', () => {
  const factory = new PieceFactory({ enabledIds: ['P01', 'P02'] });
  
  const piece = factory.next();
  runner.assert(piece.id === 'P01' || piece.id === 'P02');
});

// ── Nexus Flag Assignment Tests ───────────────────────────────────────────

runner.test('Nexus Core piece gets all nexus flags', () => {
  const factory = new PieceFactory({ seed: 12345 });
  
  // Generate pieces until we get Nexus Core
  for (let i = 0; i < 50; i++) {
    const piece = factory.next();
    if (piece.id === 'P12') {
      runner.assert(piece.nexusFlags.every(flag => flag === true));
      return;
    }
  }
  
  runner.assert(false, 'Nexus Core not found in 50 pieces');
});

runner.test('Regular pieces respect nexusSlots count', () => {
  const factory = new PieceFactory({ seed: 12345 });
  
  // Find a piece with nexusSlots > 0
  for (let i = 0; i < 50; i++) {
    const piece = factory.next();
    if (piece.id !== 'P12') { // Skip Nexus Core
      const def = PieceFactory.getDefinition(piece.id);
      const flaggedCount = piece.nexusFlags.filter(f => f).length;
      runner.assert(flaggedCount <= def.nexusSlots);
      if (def.nexusSlots > 0) {
        runner.assert(flaggedCount > 0);
        return;
      }
    }
  }
  
  runner.assert(false, 'No piece with nexusSlots found in 50 pieces');
});

// ── Edge Case Tests ─────────────────────────────────────────────────

runner.test('PieceFactory.rotate handles empty array', () => {
  const rotated = PieceFactory.rotate([], 1);
  runner.assertDeepEqual(rotated, []);
});

runner.test('PieceFactory.rotate handles negative steps', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}];
  const rotated = PieceFactory.rotate(cells, -1);
  
  // -1 should be equivalent to 3 (270°)
  const expected = PieceFactory.rotate(cells, 3);
  runner.assertDeepEqual(rotated, expected);
});

runner.test('PieceFactory.rotate handles large step values', () => {
  const cells = [{x:0,y:0}, {x:1,y:0}];
  const rotated = PieceFactory.rotate(cells, 5); // 5 = 1 (mod 4)
  
  const expected = PieceFactory.rotate(cells, 1);
  runner.assertDeepEqual(rotated, expected);
});

runner.test('PieceFactory.getDefinition returns undefined for unknown piece', () => {
  const def = PieceFactory.getDefinition('P99');
  runner.assertEqual(def, undefined);
});

// Helper assertion for tests
runner.assertNotEqual = function(actual, expected, message) {
  if (actual === expected) {
    throw new Error(message || `Expected not ${expected}, got ${expected}`);
  }
};

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner };
} else {
  // Auto-run in browser
  window.pieceTestRunner = runner;
}