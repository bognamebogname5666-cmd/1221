/**
 * NEXUS BLOCKS — Performance Audit
 * ─────────────────────────────────────────────────────────────────────────────
 * Profiles render loop with performance.mark() and identifies >2ms operations
 */

'use strict';

class PerformanceAuditor {
  constructor() {
    this.measurements = new Map();
    this.thresholds = {
      critical: 16.67, // 60 FPS frame budget
      warning: 8.33,  // 120 FPS frame budget
      target: 2.0      // Target operation time
    };
    this.issues = [];
  }

  mark(name) {
    performance.mark(`${name}-start`);
    return {
      end: () => this.measure(name)
    };
  }

  measure(name) {
    try {
      performance.mark(`${name}-end`);
      performance.measure(name, `${name}-start`, `${name}-end`);
      
      const entries = performance.getEntriesByName(name, 'measure');
      if (entries.length > 0) {
        const duration = entries[entries.length - 1].duration;
        this.recordMeasurement(name, duration);
        
        // Clean up marks
        performance.clearMarks(`${name}-start`);
        performance.clearMarks(`${name}-end`);
        performance.clearMeasures(name);
        
        return duration;
      }
    } catch (e) {
      console.warn(`Performance measurement failed for ${name}:`, e);
    }
    return 0;
  }

  recordMeasurement(name, duration) {
    if (!this.measurements.has(name)) {
      this.measurements.set(name, []);
    }
    
    const measurements = this.measurements.get(name);
    measurements.push(duration);
    
    // Keep only last 100 measurements
    if (measurements.length > 100) {
      measurements.shift();
    }
    
    // Check thresholds
    if (duration > this.thresholds.critical) {
      this.issues.push({
        type: 'critical',
        operation: name,
        duration,
        threshold: this.thresholds.critical
      });
    } else if (duration > this.thresholds.warning) {
      this.issues.push({
        type: 'warning',
        operation: name,
        duration,
        threshold: this.thresholds.warning
      });
    } else if (duration > this.thresholds.target) {
      this.issues.push({
        type: 'concern',
        operation: name,
        duration,
        threshold: this.thresholds.target
      });
    }
  }

  getStats(name) {
    const measurements = this.measurements.get(name) || [];
    if (measurements.length === 0) return null;
    
    const sorted = [...measurements].sort((a, b) => a - b);
    const sum = measurements.reduce((a, b) => a + b, 0);
    
    return {
      count: measurements.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / measurements.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  getAllIssues() {
    return [...this.issues];
  }

  clear() {
    this.measurements.clear();
    this.issues = [];
    performance.clearMarks();
    performance.clearMeasures();
  }
}

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
    console.log('🧪 Running Performance Audit Tests...\n');
    
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

  assertLessThan(actual, threshold, message) {
    if (actual >= threshold) {
      throw new Error(message || `Expected < ${threshold}, got ${actual}`);
    }
  }
}

const runner = new TestRunner();
const auditor = new PerformanceAuditor();

// ── Board Performance Tests ─────────────────────────────────────────

runner.test('Board.setCell performance', () => {
  const board = new Board(20, 20); // Large board for stress testing
  
  // Test single cell operation
  const mark = auditor.mark('board.setCell');
  for (let i = 0; i < 1000; i++) {
    board.setCell(i % 20, Math.floor(i / 20), (i % 8) + 1);
  }
  mark.end();
  
  const stats = auditor.getStats('board.setCell');
  runner.assert(stats !== null);
  runner.assertLessThan(stats.avg, 0.01, 'setCell average should be < 0.01ms');
  runner.assertLessThan(stats.p95, 0.05, 'setCell p95 should be < 0.05ms');
});

runner.test('Board.getCell performance', () => {
  const board = new Board(20, 20);
  
  // Pre-fill board
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 20; y++) {
      board.setCell(x, y, (x + y) % 8 + 1);
    }
  }
  
  const mark = auditor.mark('board.getCell');
  for (let i = 0; i < 10000; i++) {
    board.getCell(i % 20, Math.floor(i / 20));
  }
  mark.end();
  
  const stats = auditor.getStats('board.getCell');
  runner.assertLessThan(stats.avg, 0.001, 'getCell average should be < 0.001ms');
  runner.assertLessThan(stats.p95, 0.005, 'getCell p95 should be < 0.005ms');
});

runner.test('Board.canPlace performance', () => {
  const board = new Board(20, 20);
  const piece = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:3,y:0}]; // 4-cell piece
  
  const mark = auditor.mark('board.canPlace');
  for (let i = 0; i < 5000; i++) {
    board.canPlace(piece, i % 16, Math.floor(i / 16) % 16);
  }
  mark.end();
  
  const stats = auditor.getStats('board.canPlace');
  runner.assertLessThan(stats.avg, 0.01, 'canPlace average should be < 0.01ms');
  runner.assertLessThan(stats.p95, 0.05, 'canPlace p95 should be < 0.05ms');
});

runner.test('Board.processClears performance', () => {
  const board = new Board(20, 20);
  
  // Create a board with many potential clears
  for (let y = 0; y < 20; y += 2) {
    for (let x = 0; x < 20; x++) {
      board.setCell(x, y, 1);
    }
  }
  
  const mark = auditor.mark('board.processClears');
  for (let i = 0; i < 100; i++) {
    board.processClears();
  }
  mark.end();
  
  const stats = auditor.getStats('board.processClears');
  runner.assertLessThan(stats.avg, 1.0, 'processClears average should be < 1ms');
  runner.assertLessThan(stats.p95, 2.0, 'processClears p95 should be < 2ms');
});

runner.test('Board.applyGravity performance', () => {
  const board = new Board(20, 20);
  
  // Create scattered pieces
  for (let i = 0; i < 100; i++) {
    board.setCell(
      Math.floor(Math.random() * 20),
      Math.floor(Math.random() * 20),
      1
    );
  }
  
  const mark = auditor.mark('board.applyGravity');
  for (let i = 0; i < 100; i++) {
    board.applyGravity('down');
  }
  mark.end();
  
  const stats = auditor.getStats('board.applyGravity');
  runner.assertLessThan(stats.avg, 2.0, 'applyGravity average should be < 2ms');
  runner.assertLessThan(stats.p95, 5.0, 'applyGravity p95 should be < 5ms');
});

// ── PieceFactory Performance Tests ─────────────────────────────────

runner.test('PieceFactory.next performance', () => {
  const factory = new PieceFactory({ seed: 12345 });
  
  const mark = auditor.mark('factory.next');
  for (let i = 0; i < 1000; i++) {
    factory.next();
  }
  mark.end();
  
  const stats = auditor.getStats('factory.next');
  runner.assertLessThan(stats.avg, 0.1, 'next average should be < 0.1ms');
  runner.assertLessThan(stats.p95, 0.5, 'next p95 should be < 0.5ms');
});

runner.test('PieceFactory.rotate performance', () => {
  const piece = [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:3,y:0}, {x:4,y:0}];
  
  const mark = auditor.mark('factory.rotate');
  for (let i = 0; i < 10000; i++) {
    PieceFactory.rotate(piece, i % 4);
  }
  mark.end();
  
  const stats = auditor.getStats('factory.rotate');
  runner.assertLessThan(stats.avg, 0.01, 'rotate average should be < 0.01ms');
  runner.assertLessThan(stats.p95, 0.05, 'rotate p95 should be < 0.05ms');
});

// ── ScoreEngine Performance Tests ─────────────────────────────────

runner.test('ScoreEngine.onClears performance', () => {
  const engine = new ScoreEngine('classic_endless');
  
  const mark = auditor.mark('score.onClears');
  for (let i = 0; i < 1000; i++) {
    engine.onClears({
      rows: [i % 5],
      cols: [],
      nexusDestroyed: Math.floor(Math.random() * 5)
    });
  }
  mark.end();
  
  const stats = auditor.getStats('score.onClears');
  runner.assertLessThan(stats.avg, 0.1, 'onClears average should be < 0.1ms');
  runner.assertLessThan(stats.p95, 0.5, 'onClears p95 should be < 0.5ms');
});

// ── GameLoop Performance Tests ─────────────────────────────────

runner.test('GameLoop update cycle performance', () => {
  let updateCount = 0;
  const gameLoop = new GameLoop(
    (dt) => {
      const mark = auditor.mark('gameloop.update');
      updateCount++;
      // Simulate game logic
      Math.random() * 1000;
      mark.end();
    },
    (alpha) => {
      const mark = auditor.mark('gameloop.render');
      // Simulate rendering
      Math.random() * 1000;
      mark.end();
    }
  );
  
  gameLoop.start();
  
  // Run for a short time
  setTimeout(() => {
    gameLoop.stop();
    
    const updateStats = auditor.getStats('gameloop.update');
    const renderStats = auditor.getStats('gameloop.render');
    
    runner.assert(updateCount > 0, 'Should have received update calls');
    
    if (updateStats) {
      runner.assertLessThan(updateStats.avg, 1.0, 'Update average should be < 1ms');
      runner.assertLessThan(updateStats.p95, 2.0, 'Update p95 should be < 2ms');
    }
    
    if (renderStats) {
      runner.assertLessThan(renderStats.avg, 2.0, 'Render average should be < 2ms');
      runner.assertLessThan(renderStats.p95, 5.0, 'Render p95 should be < 5ms');
    }
  }, 200);
  
  return new Promise(resolve => setTimeout(resolve, 250));
});

// ── Complex Operation Performance Tests ─────────────────────────

runner.test('Complex game simulation performance', () => {
  const board = new Board(9, 9);
  const factory = new PieceFactory({ seed: 12345 });
  const engine = new ScoreEngine('classic_endless');
  
  const mark = auditor.mark('complex.simulation');
  
  // Simulate 50 piece placements
  for (let i = 0; i < 50; i++) {
    const piece = factory.next();
    
    // Find valid placement
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        if (board.canPlace(piece.cells, x, y)) {
          board.placePiece(piece.cells, x, y, piece.colorIndex);
          const clears = board.processClears();
          engine.onClears(clears);
          break;
        }
      }
    }
  }
  
  mark.end();
  
  const stats = auditor.getStats('complex.simulation');
  runner.assertLessThan(stats.avg, 50.0, 'Complex simulation should be < 50ms total');
  runner.assertLessThan(stats.avg / 50, 2.0, 'Per-piece average should be < 2ms');
});

runner.test('Memory allocation performance', () => {
  const mark = auditor.mark('memory.allocation');
  
  // Create and destroy many objects
  for (let i = 0; i < 1000; i++) {
    const board = new Board(9, 9);
    const factory = new PieceFactory();
    const engine = new ScoreEngine();
    
    // Use objects briefly
    board.setCell(0, 0, 1);
    factory.next();
    engine.onClears({ rows: [], cols: [], nexusDestroyed: 0 });
    
    // Objects go out of scope here
  }
  
  mark.end();
  
  const stats = auditor.getStats('memory.allocation');
  runner.assertLessThan(stats.avg, 100.0, 'Memory allocation should be < 100ms');
});

// ── Critical Path Analysis ───────────────────────────────────────

runner.test('Critical path: frame-to-frame performance', () => {
  const board = new Board(9, 9);
  const factory = new PieceFactory();
  const engine = new ScoreEngine();
  
  const frameMark = auditor.mark('frame.total');
  
  // Simulate one complete frame of work
  const updateMark = auditor.mark('frame.update');
  
  // Update phase
  const piece = factory.next();
  board.placePiece(piece.cells, 0, 0, piece.colorIndex);
  const clears = board.processClears();
  engine.onClears(clears);
  
  updateMark.end();
  
  const renderMark = auditor.mark('frame.render');
  
  // Render phase (simulated)
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      board.getCell(x, y);
    }
  }
  
  renderMark.end();
  
  frameMark.end();
  
  const frameStats = auditor.getStats('frame.total');
  const updateStats = auditor.getStats('frame.update');
  const renderStats = auditor.getStats('frame.render');
  
  // Entire frame should be under 16.67ms (60 FPS)
  if (frameStats) {
    runner.assertLessThan(frameStats.avg, 16.67, 'Total frame time should be < 16.67ms');
  }
  
  if (updateStats) {
    runner.assertLessThan(updateStats.avg, 5.0, 'Update phase should be < 5ms');
  }
  
  if (renderStats) {
    runner.assertLessThan(renderStats.avg, 10.0, 'Render phase should be < 10ms');
  }
});

// ── Performance Issue Detection ─────────────────────────────────

runner.test('Detect performance issues', () => {
  // Simulate slow operation
  const mark = auditor.mark('slow.operation');
  
  // Artificially slow operation
  const start = performance.now();
  while (performance.now() - start < 5) {
    // Busy wait for 5ms
  }
  
  mark.end();
  
  const issues = auditor.getAllIssues();
  const slowIssues = issues.filter(i => i.operation === 'slow.operation');
  
  runner.assert(slowIssues.length > 0, 'Should detect slow operation');
  runner.assert(slowIssues.some(i => i.type === 'critical'), 'Should mark as critical');
});

// ── Optimization Suggestions ─────────────────────────────────

runner.test('Generate optimization suggestions', () => {
  // Run performance tests to collect data
  auditor.clear();
  
  const board = new Board(20, 20);
  
  // Test various operations
  for (let i = 0; i < 100; i++) {
    const mark = auditor.mark('test.operation');
    
    // Simulate different workloads
    if (i % 3 === 0) {
      // Heavy operation
      for (let j = 0; j < 1000; j++) {
        board.setCell(j % 20, Math.floor(j / 20), 1);
      }
    } else if (i % 3 === 1) {
      // Medium operation
      for (let j = 0; j < 100; j++) {
        board.getCell(j % 20, Math.floor(j / 20));
      }
    } else {
      // Light operation
      board.canPlace([{x:0,y:0}], 0, 0);
    }
    
    mark.end();
  }
  
  const issues = auditor.getAllIssues();
  const suggestions = generateOptimizationSuggestions(issues);
  
  runner.assert(suggestions.length > 0, 'Should generate optimization suggestions');
  console.log('   Optimization suggestions:', suggestions);
});

function generateOptimizationSuggestions(issues) {
  const suggestions = [];
  const operationCounts = {};
  
  // Count issues by operation
  issues.forEach(issue => {
    if (!operationCounts[issue.operation]) {
      operationCounts[issue.operation] = 0;
    }
    operationCounts[issue.operation]++;
  });
  
  // Generate suggestions based on issue patterns
  Object.entries(operationCounts).forEach(([operation, count]) => {
    if (count > 5) {
      suggestions.push({
        operation,
        priority: 'high',
        issue: 'Frequent slow operations',
        suggestion: `Consider optimizing ${operation} - it's causing performance issues frequently`
      });
    }
  });
  
  // Add specific suggestions based on operation names
  if (operationCounts['board.applyGravity'] > 0) {
    suggestions.push({
      operation: 'board.applyGravity',
      priority: 'medium',
      issue: 'Gravity calculations are expensive',
      suggestion: 'Consider caching gravity results or using incremental updates'
    });
  }
  
  if (operationCounts['board.processClears'] > 0) {
    suggestions.push({
      operation: 'board.processClears',
      priority: 'medium',
      issue: 'Line clearing is expensive',
      suggestion: 'Optimize clear detection with dirty flagging or spatial indexing'
    });
  }
  
  return suggestions;
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { PerformanceAuditor, TestRunner, runner, auditor, generateOptimizationSuggestions };
} else {
  // Auto-run in browser
  window.performanceTestRunner = runner;
  window.auditor = auditor;
  window.PerformanceAuditor = PerformanceAuditor;
}