/**
 * NEXUS BLOCKS — localStorage Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests save/load functionality and corrupted data recovery
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
    console.log('🧪 Running localStorage Integration Tests...\n');
    
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

// Mock localStorage with error simulation
class MockLocalStorage {
  constructor() {
    this.data = new Map();
    this.disabled = false;
    this.quotaExceeded = false;
    this.corruptedKeys = new Set();
  }

  getItem(key) {
    if (this.disabled) return null;
    if (this.corruptedKeys.has(key)) return 'invalid-json-{';
    return this.data.get(key) || null;
  }

  setItem(key, value) {
    if (this.disabled) throw new Error('localStorage disabled');
    if (this.quotaExceeded) throw new Error('QuotaExceededError');
    this.data.set(key, value);
    return true;
  }

  removeItem(key) {
    if (this.disabled) return;
    this.data.delete(key);
    this.corruptedKeys.delete(key);
  }

  clear() {
    this.data.clear();
    this.corruptedKeys.clear();
  }

  key(index) {
    const keys = Array.from(this.data.keys());
    return keys[index] || null;
  }

  get length() {
    return this.data.size;
  }

  // Test helpers
  disable() {
    this.disabled = true;
  }

  enable() {
    this.disabled = false;
  }

  simulateQuotaExceeded() {
    this.quotaExceeded = true;
  }

  simulateCorruption(key) {
    this.corruptedKeys.add(key);
  }
}

// Enhanced StorageManager with error handling
class TestStorageManager {
  constructor(prefix = 'nexus_blocks_') {
    this.prefix = prefix;
    this.fallbackData = new Map();
    this.lastError = null;
  }

  get(key) {
    const fullKey = this.prefix + key;
    
    try {
      const value = localStorage.getItem(fullKey);
      if (value === null) return this.fallbackData.get(key) || null;
      
      return JSON.parse(value);
    } catch (e) {
      this.lastError = e;
      // Fallback to memory storage
      return this.fallbackData.get(key) || null;
    }
  }

  set(key, value) {
    const fullKey = this.prefix + key;
    
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(fullKey, serialized);
      this.fallbackData.set(key, value); // Keep backup
      return true;
    } catch (e) {
      this.lastError = e;
      
      // Fallback to memory storage
      this.fallbackData.set(key, value);
      return false;
    }
  }

  remove(key) {
    const fullKey = this.prefix + key;
    
    try {
      localStorage.removeItem(fullKey);
    } catch (e) {
      this.lastError = e;
    }
    
    this.fallbackData.delete(key);
  }

  clear() {
    try {
      // Clear all nexus_blocks keys
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      this.lastError = e;
    }
    
    this.fallbackData.clear();
  }

  getLastError() {
    return this.lastError;
  }

  isUsingFallback() {
    return this.fallbackData.size > 0;
  }
}

const runner = new TestRunner();

// ── Basic Storage Tests ─────────────────────────────────────────────────

runner.test('Basic save and load functionality', () => {
  const storage = new TestStorageManager();
  
  // Save game data
  const gameData = {
    score: 1500,
    level: 5,
    pieces: 42,
    timestamp: Date.now()
  };
  
  runner.assert(storage.set('gamestate', gameData));
  
  // Load game data
  const loaded = storage.get('gamestate');
  runner.assertDeepEqual(loaded, gameData);
  
  // Verify it's in localStorage
  const raw = localStorage.getItem('nexus_blocks_gamestate');
  runner.assert(raw !== null);
  runner.assertDeepEqual(JSON.parse(raw), gameData);
});

runner.test('Multiple data types storage', () => {
  const storage = new TestStorageManager();
  
  // Test different data types
  const testData = {
    number: 42,
    string: 'test string',
    boolean: true,
    array: [1, 2, 3],
    object: { nested: { value: 'test' } },
    null: null,
    undefined: undefined
  };
  
  storage.set('types', testData);
  const loaded = storage.get('types');
  
  runner.assertEqual(loaded.number, 42);
  runner.assertEqual(loaded.string, 'test string');
  runner.assertEqual(loaded.boolean, true);
  runner.assertDeepEqual(loaded.array, [1, 2, 3]);
  runner.assertDeepEqual(loaded.object, { nested: { value: 'test' } });
  runner.assertEqual(loaded.null, null);
});

runner.test('High score persistence', () => {
  const storage = new TestStorageManager();
  
  // Save high scores for different modes
  const highScores = {
    classic_endless: 5000,
    puzzle_challenge: 3500,
    time_rush: 4200
  };
  
  for (const [mode, score] of Object.entries(highScores)) {
    storage.set(`highscore_${mode}`, score);
  }
  
  // Load and verify
  for (const [mode, expected] of Object.entries(highScores)) {
    const loaded = storage.get(`highscore_${mode}`);
    runner.assertEqual(loaded, expected);
  }
});

runner.test('Leaderboard storage', () => {
  const storage = new TestStorageManager();
  
  const leaderboard = [
    { score: 10000, date: '2024-01-01T00:00:00Z', name: 'Player1' },
    { score: 8500, date: '2024-01-02T00:00:00Z', name: 'Player2' },
    { score: 7200, date: '2024-01-03T00:00:00Z', name: 'Player3' }
  ];
  
  storage.set('leaderboard_classic', leaderboard);
  
  const loaded = storage.get('leaderboard_classic');
  runner.assertDeepEqual(loaded, leaderboard);
  runner.assertEqual(loaded.length, 3);
});

// ── Error Recovery Tests ─────────────────────────────────────────

runner.test('Recovery from localStorage disabled', () => {
  const storage = new TestStorageManager();
  
  // Disable localStorage
  localStorage.disable();
  
  // Try to save data
  const data = { test: 'data' };
  const result = storage.set('disabled_test', data);
  
  runner.assert(!result, 'Should return false when localStorage disabled');
  runner.assert(storage.getLastError() !== null, 'Should record error');
  
  // Data should be in fallback storage
  const loaded = storage.get('disabled_test');
  runner.assertDeepEqual(loaded, data);
  runner.assert(storage.isUsingFallback(), 'Should be using fallback storage');
  
  // Re-enable localStorage
  localStorage.enable();
  
  // Should still work from fallback
  const stillLoaded = storage.get('disabled_test');
  runner.assertDeepEqual(stillLoaded, data);
});

runner.test('Recovery from quota exceeded error', () => {
  const storage = new TestStorageManager();
  
  // Simulate quota exceeded
  localStorage.simulateQuotaExceeded();
  
  const data = { test: 'quota_data' };
  const result = storage.set('quota_test', data);
  
  runner.assert(!result, 'Should return false when quota exceeded');
  runner.assert(storage.getLastError() !== null, 'Should record error');
  
  // Should fallback to memory storage
  const loaded = storage.get('quota_test');
  runner.assertDeepEqual(loaded, data);
  
  // Reset quota
  localStorage.quotaExceeded = false;
});

runner.test('Recovery from corrupted JSON data', () => {
  const storage = new TestStorageManager();
  
  // Save valid data first
  const validData = { score: 1000, level: 5 };
  storage.set('corrupt_test', validData);
  
  // Simulate corruption
  localStorage.simulateCorruption('nexus_blocks_corrupt_test');
  
  // Try to load corrupted data
  const loaded = storage.get('corrupt_test');
  
  // Should return fallback data or null, not crash
  runner.assert(loaded === null || loaded === validData, 
    'Should handle corrupted data gracefully');
  runner.assert(storage.getLastError() !== null, 'Should record error');
});

runner.test('Graceful degradation with multiple errors', () => {
  const storage = new TestStorageManager();
  
  // Disable localStorage
  localStorage.disable();
  
  // Perform multiple operations
  storage.set('test1', { data: 1 });
  storage.set('test2', { data: 2 });
  storage.set('test3', { data: 3 });
  
  // All should work with fallback
  runner.assertEqual(storage.get('test1').data, 1);
  runner.assertEqual(storage.get('test2').data, 2);
  runner.assertEqual(storage.get('test3').data, 3);
  runner.assert(storage.isUsingFallback());
  
  // Re-enable and verify fallback still works
  localStorage.enable();
  runner.assertEqual(storage.get('test1').data, 1);
});

// ── Data Integrity Tests ─────────────────────────────────────────

runner.test('Data integrity across save/load cycles', () => {
  const storage = new TestStorageManager();
  
  const complexData = {
    playerStats: {
      gamesPlayed: 150,
      totalScore: 125000,
      averageScore: 833.33,
      bestCombo: 15,
      piecesPlaced: 2500
    },
    achievements: [
      { id: 'first_game', unlocked: true, date: '2024-01-01' },
      { id: 'score_1000', unlocked: true, date: '2024-01-02' },
      { id: 'combo_10', unlocked: false, date: null }
    ],
    settings: {
      soundVolume: 0.8,
      musicVolume: 0.6,
      animations: true,
      showGhost: true
    },
    lastPlayed: Date.now(),
    version: '1.0.0'
  };
  
  // Multiple save/load cycles
  for (let i = 0; i < 5; i++) {
    storage.set('integrity_test', complexData);
    const loaded = storage.get('integrity_test');
    runner.assertDeepEqual(loaded, complexData);
  }
});

runner.test('Partial data recovery', () => {
  const storage = new TestStorageManager();
  
  // Save multiple data sets
  storage.set('data1', { value: 1 });
  storage.set('data2', { value: 2 });
  storage.set('data3', { value: 3 });
  
  // Corrupt one entry
  localStorage.simulateCorruption('nexus_blocks_data2');
  
  // Should recover uncorrupted data
  runner.assertEqual(storage.get('data1').value, 1);
  runner.assertEqual(storage.get('data3').value, 3);
  
  // Should handle corrupted data gracefully
  const corrupted = storage.get('data2');
  runner.assert(corrupted === null || corrupted === undefined, 
    'Should return null for corrupted data');
});

runner.test('Large data storage', () => {
  const storage = new TestStorageManager();
  
  // Create large dataset (simulating extensive game history)
  const largeData = {
    history: Array.from({ length: 1000 }, (_, i) => ({
      gameId: i,
      score: Math.floor(Math.random() * 10000),
      date: new Date(Date.now() - i * 86400000).toISOString(),
      mode: ['classic', 'puzzle', 'rush'][i % 3],
      duration: Math.floor(Math.random() * 300000)
    })),
    statistics: {
      totalGames: 1000,
      averageScore: 4500,
      bestScore: 9900,
      totalTime: 250000000
    }
  };
  
  // Should handle large data
  const result = storage.set('large_data', largeData);
  runner.assert(result, 'Should save large data successfully');
  
  const loaded = storage.get('large_data');
  runner.assertEqual(loaded.history.length, 1000);
  runner.assertEqual(loaded.statistics.totalGames, 1000);
});

// ── Performance Tests ─────────────────────────────────────────

runner.test('Storage performance under load', () => {
  const storage = new TestStorageManager();
  
  const iterations = 100;
  const startTime = performance.now();
  
  // Perform many operations
  for (let i = 0; i < iterations; i++) {
    storage.set(`perf_test_${i}`, { index: i, data: 'test'.repeat(100) });
    storage.get(`perf_test_${i}`);
  }
  
  const endTime = performance.now();
  const avgTime = (endTime - startTime) / (iterations * 2);
  
  // Operations should be fast (< 5ms average)
  runner.assert(avgTime < 5, 
    `Average storage operation should be < 5ms, was ${avgTime.toFixed(2)}ms`);
});

runner.test('Memory usage with fallback storage', () => {
  const storage = new TestStorageManager();
  
  // Disable localStorage to force fallback
  localStorage.disable();
  
  const initialMemory = performance.memory?.usedJSHeapSize || 0;
  
  // Store many items in fallback
  for (let i = 0; i < 1000; i++) {
    storage.set(`fallback_${i}`, { 
      data: 'test data '.repeat(10),
      index: i,
      timestamp: Date.now()
    });
  }
  
  const finalMemory = performance.memory?.usedJSHeapSize || 0;
  const memoryIncrease = finalMemory - initialMemory;
  
  // Memory usage should be reasonable (< 50MB for 1000 items)
  runner.assert(memoryIncrease < 50 * 1024 * 1024, 
    `Memory increase should be < 50MB, was ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
  
  // Verify fallback is being used
  runner.assert(storage.isUsingFallback());
  
  localStorage.enable();
});

// ── Edge Case Tests ─────────────────────────────────────────

runner.test('Storage with special characters in keys/values', () => {
  const storage = new TestStorageManager();
  
  const specialData = {
    'key with spaces': { value: 'test' },
    'key-with-dashes': { value: 'test' },
    'key_with_underscores': { value: 'test' },
    'key.with.dots': { value: 'test' },
    'key/with/slashes': { value: 'test' },
    'key\\with\\backslashes': { value: 'test' },
    'key"with"quotes': { value: 'test' },
    'key\'with\'apostrophes': { value: 'test' },
    'key_with_unicode_测试': { value: 'test' },
    'key_with_emoji_🎮': { value: 'test' }
  };
  
  for (const [key, value] of Object.entries(specialData)) {
    storage.set(key, value);
    const loaded = storage.get(key);
    runner.assertDeepEqual(loaded, value, `Failed for key: ${key}`);
  }
});

runner.test('Storage with circular references (should be prevented)', () => {
  const storage = new TestStorageManager();
  
  const circularData = { name: 'test' };
  circularData.self = circularData; // Create circular reference
  
  // Should handle gracefully (JSON.stringify would fail)
  const result = storage.set('circular', circularData);
  
  // Either fails gracefully or handles it
  if (result) {
    const loaded = storage.get('circular');
    runner.assert(loaded !== circularData, 'Should not store circular reference');
  } else {
    runner.assert(storage.getLastError() !== null, 'Should record error');
  }
});

runner.test('Concurrent storage operations', () => {
  const storage = new TestStorageManager();
  
  // Simulate concurrent operations
  const promises = [];
  
  for (let i = 0; i < 50; i++) {
    promises.push(new Promise(resolve => {
      setTimeout(() => {
        storage.set(`concurrent_${i}`, { index: i });
        const loaded = storage.get(`concurrent_${i}`);
        resolve(loaded);
      }, Math.random() * 100);
    }));
  }
  
  return Promise.all(promises).then(results => {
    runner.assertEqual(results.length, 50);
    
    // Verify all data was stored correctly
    for (let i = 0; i < 50; i++) {
      runner.assertEqual(results[i].index, i);
    }
  });
});

// Helper function for deep equality
runner.assertDeepEqual = function(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { TestRunner, runner, MockLocalStorage, TestStorageManager };
} else {
  // Auto-run in browser
  window.localStorageTestRunner = runner;
  window.MockLocalStorage = MockLocalStorage;
  window.TestStorageManager = TestStorageManager;
}