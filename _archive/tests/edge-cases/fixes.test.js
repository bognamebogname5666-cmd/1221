/**
 * NEXUS BLOCKS — Edge Case Fixes
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests and fixes for rapid tap, localStorage disabled, canvas 0×0, AudioContext blocked
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
    console.log('🧪 Running Edge Case Fixes Tests...\n');
    
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
}

// Edge Case Fix Implementations

class RobustGameLoop extends GameLoop {
  constructor(updateFn, renderFn, options = {}) {
    super(updateFn, renderFn, options);
    this._lastTapTime = 0;
    this._tapDebounceMs = options.tapDebounceMs || 100;
    this._rapidTapProtection = options.rapidTapProtection !== false;
  }

  start() {
    if (this.running) return;
    
    // Prevent rapid restart
    const now = performance.now();
    if (this._rapidTapProtection && (now - this._lastTapTime) < this._tapDebounceMs) {
      console.warn('Rapid tap detected - ignoring start request');
      return;
    }
    
    this._lastTapTime = now;
    super.start();
  }

  stop() {
    const now = performance.now();
    this._lastTapTime = now;
    super.stop();
  }
}

class RobustStorageManager {
  constructor(prefix = 'nexus_blocks_') {
    this.prefix = prefix;
    this.fallbackData = new Map();
    this.isLocalStorageAvailable = this.checkLocalStorageAvailability();
  }

  checkLocalStorageAvailability() {
    try {
      const testKey = '__localStorage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      console.warn('localStorage not available:', e.message);
      return false;
    }
  }

  get(key) {
    if (!this.isLocalStorageAvailable) {
      return this.fallbackData.get(key) || null;
    }

    try {
      const fullKey = this.prefix + key;
      const value = localStorage.getItem(fullKey);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      console.warn('Storage get error:', e.message);
      return this.fallbackData.get(key) || null;
    }
  }

  set(key, value) {
    if (!this.isLocalStorageAvailable) {
      this.fallbackData.set(key, value);
      return true;
    }

    try {
      const fullKey = this.prefix + key;
      const serialized = JSON.stringify(value);
      localStorage.setItem(fullKey, serialized);
      this.fallbackData.set(key, value); // Backup
      return true;
    } catch (e) {
      console.warn('Storage set error:', e.message);
      this.fallbackData.set(key, value);
      return false;
    }
  }
}

class RobustAudioEngine {
  constructor(eventBus) {
    this.bus = eventBus;
    this.audioContext = null;
    this.isAudioAvailable = false;
    this.userInteractionRequired = false;
    this.pendingSounds = [];
    
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      if (this.audioContext.state === 'suspended') {
        this.userInteractionRequired = true;
        console.log('AudioContext suspended - user interaction required');
      } else {
        this.isAudioAvailable = true;
      }
    } catch (e) {
      console.warn('AudioContext not available:', e.message);
      this.isAudioAvailable = false;
    }
  }

  async resumeAudioContext() {
    if (this.audioContext && this.userInteractionRequired) {
      try {
        await this.audioContext.resume();
        this.isAudioAvailable = true;
        this.userInteractionRequired = false;
        
        // Play pending sounds
        this.pendingSounds.forEach(sound => this.playSound(sound));
        this.pendingSounds = [];
        
        console.log('AudioContext resumed successfully');
      } catch (e) {
        console.warn('Failed to resume AudioContext:', e.message);
      }
    }
  }

  playSound(soundType) {
    if (!this.isAudioAvailable) {
      if (this.userInteractionRequired) {
        this.pendingSounds.push(soundType);
      }
      return false;
    }

    try {
      // Placeholder for actual sound playing
      console.log(`Playing sound: ${soundType}`);
      return true;
    } catch (e) {
      console.warn('Sound play error:', e.message);
      return false;
    }
  }
}

class RobustCanvasRenderer {
  constructor(canvas, board, eventBus) {
    this.canvas = canvas;
    this.board = board;
    this.bus = eventBus;
    this.ctx = null;
    this.isValid = this.validateCanvas();
    
    if (this.isValid) {
      this.ctx = canvas.getContext('2d');
      this.setupCanvas();
    }
  }

  validateCanvas() {
    if (!this.canvas) {
      console.warn('Canvas element not found');
      return false;
    }

    const width = this.canvas.width || 0;
    const height = this.canvas.height || 0;
    
    if (width === 0 || height === 0) {
      console.warn('Canvas has zero dimensions - may be hidden');
      return false;
    }

    if (width < 100 || height < 100) {
      console.warn('Canvas dimensions too small:', width, 'x', height);
      return false;
    }

    return true;
  }

  setupCanvas() {
    if (!this.ctx) return;

    try {
      // Set canvas size
      this.canvas.width = this.canvas.offsetWidth || 400;
      this.canvas.height = this.canvas.offsetHeight || 400;
      
      // Configure context
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.font = '16px Arial';
      
      return true;
    } catch (e) {
      console.warn('Canvas setup error:', e.message);
      return false;
    }
  }

  render(alpha) {
    if (!this.isValid || !this.ctx) {
      return false;
    }

    try {
      // Clear canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Draw board
      this.drawBoard(alpha);
      
      return true;
    } catch (e) {
      console.warn('Canvas render error:', e.message);
      return false;
    }
  }

  drawBoard(alpha) {
    if (!this.ctx) return;

    const cellSize = 40;
    const offsetX = 50;
    const offsetY = 50;

    // Draw grid
    this.ctx.strokeStyle = '#ccc';
    this.ctx.lineWidth = 1;
    
    for (let x = 0; x <= this.board.width; x++) {
      this.ctx.beginPath();
      this.ctx.moveTo(offsetX + x * cellSize, offsetY);
      this.ctx.lineTo(offsetX + x * cellSize, offsetY + this.board.height * cellSize);
      this.ctx.stroke();
    }
    
    for (let y = 0; y <= this.board.height; y++) {
      this.ctx.beginPath();
      this.ctx.moveTo(offsetX, offsetY + y * cellSize);
      this.ctx.lineTo(offsetX + this.board.width * cellSize, offsetY + y * cellSize);
      this.ctx.stroke();
    }

    // Draw pieces
    for (let x = 0; x < this.board.width; x++) {
      for (let y = 0; y < this.board.height; y++) {
        const colorIndex = this.board.getCell(x, y);
        if (colorIndex > 0) {
          const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#a29bfe', '#fd79a8'];
          this.ctx.fillStyle = colors[colorIndex - 1];
          this.ctx.fillRect(
            offsetX + x * cellSize + 2,
            offsetY + y * cellSize + 2,
            cellSize - 4,
            cellSize - 4
          );
        }
      }
    }
  }
}

const runner = new TestRunner();

// ── Rapid Tap Protection Tests ─────────────────────────────────────

runner.test('Rapid tap protection on game loop', () => {
  const updateFn = () => {};
  const renderFn = () => {};
  const gameLoop = new RobustGameLoop(updateFn, renderFn, { 
    tapDebounceMs: 100, 
    rapidTapProtection: true 
  });

  // Rapid start attempts
  gameLoop.start();
  gameLoop.start(); // Should be ignored
  gameLoop.start(); // Should be ignored
  
  runner.assert(gameLoop.running, 'Should be running after first start');
  
  // Wait for debounce
  setTimeout(() => {
    gameLoop.start(); // Should work now
    runner.assert(gameLoop.running, 'Should still be running');
    
    gameLoop.stop();
  }, 150);
  
  return new Promise(resolve => setTimeout(resolve, 200));
});

runner.test('Rapid tap protection can be disabled', () => {
  const updateFn = () => {};
  const renderFn = () => {};
  const gameLoop = new RobustGameLoop(updateFn, renderFn, { 
    rapidTapProtection: false 
  });

  gameLoop.start();
  gameLoop.start(); // Should work
  gameLoop.start(); // Should work
  
  runner.assert(gameLoop.running, 'Should be running');
  
  gameLoop.stop();
});

// ── localStorage Disabled Tests ─────────────────────────────────

runner.test('Storage manager handles localStorage disabled', () => {
  // Temporarily disable localStorage
  const originalLocalStorage = window.localStorage;
  window.localStorage = undefined;
  
  const storage = new RobustStorageManager();
  
  runner.assert(!storage.isLocalStorageAvailable, 'Should detect localStorage unavailable');
  
  // Should fallback to memory storage
  storage.set('test', { value: 'data' });
  const loaded = storage.get('test');
  runner.assertEqual(loaded.value, 'data');
  
  // Restore localStorage
  window.localStorage = originalLocalStorage;
});

runner.test('Storage manager handles quota exceeded', () => {
  const storage = new RobustStorageManager();
  
  // Mock quota exceeded error
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  
  const result = storage.set('quota_test', { data: 'test' });
  runner.assert(!result, 'Should return false on quota exceeded');
  
  // Should still have fallback data
  const loaded = storage.get('quota_test');
  runner.assertEqual(loaded.data, 'test');
  
  // Restore
  localStorage.setItem = originalSetItem;
});

// ── Canvas 0×0 Tests ─────────────────────────────────────────

runner.test('Canvas renderer handles zero dimensions', () => {
  const mockCanvas = {
    width: 0,
    height: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    getContext: () => null
  };

  const board = new Board(9, 9);
  const renderer = new RobustCanvasRenderer(mockCanvas, board, new MockEventBus());
  
  runner.assert(!renderer.isValid, 'Should detect invalid canvas');
  runner.assertEqual(renderer.ctx, null, 'Should not create context');
});

runner.test('Canvas renderer handles missing canvas', () => {
  const board = new Board(9, 9);
  const renderer = new RobustCanvasRenderer(null, board, new MockEventBus());
  
  runner.assert(!renderer.isValid, 'Should handle missing canvas');
});

runner.test('Canvas renderer handles small dimensions', () => {
  const mockCanvas = {
    width: 50,
    height: 50,
    offsetWidth: 50,
    offsetHeight: 50,
    getContext: (type) => ({
      clearRect: () => {},
      strokeStyle: '',
      lineWidth: 0,
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillStyle: '',
      fillRect: () => {},
      font: '',
      imageSmoothingEnabled: true
    })
  };

  const board = new Board(9, 9);
  const renderer = new RobustCanvasRenderer(mockCanvas, board, new MockEventBus());
  
  runner.assert(!renderer.isValid, 'Should reject too-small canvas');
});

runner.test('Canvas renderer recovers from display:none', () => {
  let canvasSize = 0;
  const mockCanvas = {
    get width() { return canvasSize; },
    get height() { return canvasSize; },
    get offsetWidth() { return canvasSize; },
    get offsetHeight() { return canvasSize; },
    getContext: (type) => ({
      clearRect: () => {},
      strokeStyle: '',
      lineWidth: 0,
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillStyle: '',
      fillRect: () => {},
      font: '',
      imageSmoothingEnabled: true
    })
  };

  const board = new Board(9, 9);
  const renderer = new RobustCanvasRenderer(mockCanvas, board, new MockEventBus());
  
  // Initially hidden
  runner.assert(!renderer.isValid, 'Should detect hidden canvas');
  
  // Canvas becomes visible
  canvasSize = 400;
  const renderer2 = new RobustCanvasRenderer(mockCanvas, board, new MockEventBus());
  runner.assert(renderer2.isValid, 'Should detect visible canvas');
});

// ── AudioContext Blocked Tests ─────────────────────────────────

runner.test('Audio engine handles blocked AudioContext', () => {
  // Mock suspended AudioContext
  const mockAudioContext = {
    state: 'suspended',
    resume: () => Promise.resolve()
  };
  
  const originalAudioContext = window.AudioContext;
  window.AudioContext = () => mockAudioContext;
  
  const audioEngine = new RobustAudioEngine(new MockEventBus());
  
  runner.assert(audioEngine.userInteractionRequired, 'Should detect user interaction required');
  runner.assert(!audioEngine.isAudioAvailable, 'Should not be initially available');
  
  // Test sound queuing
  const result = audioEngine.playSound('test');
  runner.assert(!result, 'Should queue sound when not available');
  runner.assertEqual(audioEngine.pendingSounds.length, 1);
  
  // Test resume
  audioEngine.resumeAudioContext().then(() => {
    runner.assert(audioEngine.isAudioAvailable, 'Should be available after resume');
    runner.assertEqual(audioEngine.pendingSounds.length, 0);
  });
  
  // Restore
  window.AudioContext = originalAudioContext;
  
  return new Promise(resolve => setTimeout(resolve, 100));
});

runner.test('Audio engine handles missing AudioContext', () => {
  const originalAudioContext = window.AudioContext;
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  
  const audioEngine = new RobustAudioEngine(new MockEventBus());
  
  runner.assert(!audioEngine.isAudioAvailable, 'Should handle missing AudioContext');
  runner.assert(!audioEngine.userInteractionRequired, 'Should not require user interaction');
  
  const result = audioEngine.playSound('test');
  runner.assert(!result, 'Should handle sound play gracefully');
  
  // Restore
  window.AudioContext = originalAudioContext;
});

// ── Combined Edge Case Tests ─────────────────────────────────

runner.test('Multiple edge cases combined', () => {
  // Disable localStorage
  const originalLocalStorage = window.localStorage;
  window.localStorage = undefined;
  
  // Create components with edge cases
  const storage = new RobustStorageManager();
  const audioEngine = new RobustAudioEngine(new MockEventBus());
  
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: () => null
  };
  
  const board = new Board(9, 9);
  const renderer = new RobustCanvasRenderer(mockCanvas, board, new MockEventBus());
  
  // All should handle gracefully
  runner.assert(!storage.isLocalStorageAvailable);
  runner.assert(!renderer.isValid);
  
  // Storage should still work with fallback
  storage.set('test', { value: 'combined_test' });
  const loaded = storage.get('test');
  runner.assertEqual(loaded.value, 'combined_test');
  
  // Restore
  window.localStorage = originalLocalStorage;
});

runner.test('Graceful degradation with all failures', () => {
  // Simulate complete failure environment
  const originalLocalStorage = window.localStorage;
  const originalAudioContext = window.AudioContext;
  
  window.localStorage = undefined;
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  
  const storage = new RobustStorageManager();
  const audioEngine = new RobustAudioEngine(new MockEventBus());
  
  // Should not crash
  storage.set('test', { value: 'graceful' });
  audioEngine.playSound('test');
  
  runner.assertEqual(storage.get('test').value, 'graceful');
  
  // Restore
  window.localStorage = originalLocalStorage;
  window.AudioContext = originalAudioContext;
});

// Export for use in browser or Node.js
if (typeof module !== 'undefined') {
  module.exports = { 
    TestRunner, 
    runner, 
    RobustGameLoop, 
    RobustStorageManager, 
    RobustAudioEngine, 
    RobustCanvasRenderer 
  };
} else {
  // Auto-run in browser
  window.edgeCaseTestRunner = runner;
  window.RobustGameLoop = RobustGameLoop;
  window.RobustStorageManager = RobustStorageManager;
  window.RobustAudioEngine = RobustAudioEngine;
  window.RobustCanvasRenderer = RobustCanvasRenderer;
}