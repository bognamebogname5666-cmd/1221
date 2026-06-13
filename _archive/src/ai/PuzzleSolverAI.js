/**
 * NEXUS BLOCKS — PuzzleSolverAI (A* Bitboard Solver)
 * ─────────────────────────────────────────────────────────────────────────────
 * Given an initial board state and a set of available pieces, computes the
 * optimal (minimum-moves) sequence of piece placements using A* search
 * with BigInt bitboards for representation speed.
 *
 * ── Algorithm Overview ──────────────────────────────────────────────────────
 *
 *   STATE SPACE
 *     Each state encodes:
 *       bitboard   : BigInt — 1 bit per filled cell (row-major, LSB = (0,0))
 *       pieceIdx   : number — index into the remaining-piece queue
 *       gCost      : number — moves taken to reach this state
 *       parent     : *State — backtrack pointer for solution reconstruction
 *
 *   ACTIONS
 *     For the current piece (at pieceIdx), try every rotation at every
 *     board position where the piece fits without collision.
 *     Apply the piece → new bitboard → check for completed lines → clear them
 *     → push successor state.
 *
 *   HEURISTIC (admissible / optimistic)
 *     h(bitboard, pieceIdx) = ceil(popcount(bitboard) / minCells)
 *     where minCells = smallest piece size in the remaining queue.
 *     This is optimistic: each move can clear at most (width + height) cells,
 *     so the true cost is bounded below by this.
 *
 *   OPTIMISATIONS
 *     1. BigInt bitboard avoids array-of-arrays allocation.
 *     2. Piece masks precomputed for all (offset, rotation) combos at
 *        construction time (one-time cost, reused across states).
 *     3. Line-clear detection via row/column full-mask AND operations:
 *        if (rowMask & boardMask) === rowMask → row is full → clear it.
 *     4. Binary heap priority queue (O(log n) push/pop).
 *     5. Closed set using Map<bigint-string, gCost> for cycle prevention.
 *     6. Wall-clock timeout: aborts search at 100 ms, returns best partial.
 *     7. Transposition table: same bitboard + same pieceIdx = same state,
 *        skip if reached with higher gCost.
 *
 * Usage:
 *   const solver = new PuzzleSolverAI(width, height, pieceDefs);
 *   const result = solver.solve(initialBoard, availablePieceIds, targetClears);
 *   // result.moves → [{ pieceId, x, y, rotation }, ...]
 *   // result.success → boolean
 */

'use strict';

// ── Binary Heap (Min-Heap for A* Priority Queue) ─────────────────────────────

/**
 * Generic min-heap keyed by a numeric priority.
 * Internal storage is a flat array; push/pop are O(log n).
 * @template T
 */
class MinHeap {
  constructor() {
    /** @type {{ prio: number, value: T }[]} */
    this._heap = [];
  }

  /** Number of items in the heap. */
  get size() { return this._heap.length; }

  /**
   * Inserts a value with the given priority.
   * @param {T}      value
   * @param {number} priority  Lower values come out first.
   */
  push(value, priority) {
    this._heap.push({ prio: priority, value });
    this._siftUp(this._heap.length - 1);
  }

  /**
   * Removes and returns the value with the lowest priority.
   * Returns undefined when the heap is empty.
   * @returns {T | undefined}
   */
  pop() {
    if (this._heap.length === 0) return undefined;
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }
    return top.value;
  }

  /** @private */
  _siftUp(idx) {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this._heap[idx].prio >= this._heap[parent].prio) break;
      [this._heap[idx], this._heap[parent]] = [this._heap[parent], this._heap[idx]];
      idx = parent;
    }
  }

  /** @private */
  _siftDown(idx) {
    const len = this._heap.length;
    while (true) {
      let smallest = idx;
      const left  = (idx << 1) + 1;
      const right = left + 1;
      if (left  < len && this._heap[left].prio  < this._heap[smallest].prio) smallest = left;
      if (right < len && this._heap[right].prio < this._heap[smallest].prio) smallest = right;
      if (smallest === idx) break;
      [this._heap[idx], this._heap[smallest]] = [this._heap[smallest], this._heap[idx]];
      idx = smallest;
    }
  }
}

// ── A* Puzzle Solver ──────────────────────────────────────────────────────────

class PuzzleSolverAI {
  /**
   * @param {number}   width     Board width  (e.g. 9)
   * @param {number}   height    Board height (e.g. 9)
   * @param {object[]} pieceDefs Piece definitions (from PIECE_DEFS).
   *                             Each must have: id, cells[{x,y}], nexusSlots, allNexus
   */
  constructor(width, height, pieceDefs) {
    this._w     = width;
    this._h     = height;
    this._size  = width * height;
    this._defs  = pieceDefs;

    // Precomputed row masks: BigInt with `width` consecutive set bits at each row
    this._rowMasks  = this._buildRowMasks();

    // Precomputed column masks: BigInt with bits set at every `width`th position
    this._colMasks  = this._buildColMasks();

    // Precompute all piece bitmask placements for fast lookup
    // Map<pieceId, Array<{ ox, oy, rot, mask: BigInt }>>
    this._piecePlacements = this._precomputeAllPlacements();

    // ── Solver configuration (public, tunable) ──────────────────────────────
    /** Maximum wall-clock time for solve() in ms. */
    this.timeBudgetMs = 100;

    /** Maximum number of A* states to explore before aborting. */
    this.maxStates    = 500_000;

    /** When true, the solver ignores Nexus Link chain effects (faster, optimistic). */
    this.ignoreNexus  = true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Solves the puzzle: finds the optimal sequence of piece placements.
   *
   * @param {Int8Array|number[]|Board} boardState
   *   Initial board: can be an Int8Array (flat row-major, 0=empty),
   *   a 2D number[][], or a Board instance (reads board._cells).
   *
   * @param {string[]} pieceIds
   *   Ordered list of piece IDs the player MUST use (e.g. ['P01','P03','P04']).
   *   The solver places them in order; the goal is to place ALL pieces with
   *   the minimum number of line-clears after the final placement.
   *
   * @param {number} [targetClears=Infinity]
   *   If specified, stop searching once this many lines have been cleared.
   *
   * @returns {{
   *   success   : boolean,
   *   moves     : Array<{ pieceId:string, x:number, y:number, rotation:number }>,
   *   clears    : number,
   *   statesExplored : number,
   *   elapsedMs      : number,
   * }}
   */
  solve(boardState, pieceIds, targetClears = Infinity) {
    const startMs = performance.now();
    const deadlineMs = startMs + this.timeBudgetMs;

    // ── 1. Build the initial bitboard ───────────────────────────────────────
    const initialBB = this._boardToBitboard(boardState);

    // ── 2. Build the piece sequence (pieceId → lookup data) ─────────────────
    const pieces = pieceIds.map(id => {
      const def = this._defs.find(d => d.id === id);
      if (!def) throw new Error(`PuzzleSolverAI: unknown piece ID "${id}"`);
      return { id, placements: this._piecePlacements.get(id) ?? [] };
    });

    // ── 3. Heuristic data ───────────────────────────────────────────────────
    // Minimum cell count among remaining pieces for admissible heuristic
    const minCellsPerPiece = pieces.reduce((m, p) => {
      const def = this._defs.find(d => d.id === p.id);
      return def ? Math.min(m, def.cells.length) : m;
    }, Infinity);

    // ── 4. Initialise search structures ─────────────────────────────────────
    const heap = new MinHeap();

    // Transposition table: key = `${bitboard}|${pieceIdx}` → best gCost
    const closed = new Map();

    // Root state
    const root = {
      bb       : initialBB,
      pieceIdx : 0,
      g        : 0,
      clears   : 0,
      parent   : null,
      action   : null, // { pieceId, x, y, rotation }
    };

    const rootH = this._heuristic(initialBB, pieces.length - 0, minCellsPerPiece);
    heap.push(root, root.g + rootH);
    closed.set(this._stateKey(root), root.g);

    let statesExplored = 0;
    let bestResult     = null;
    let bestF          = Infinity;

    // ── 5. A* main loop ────────────────────────────────────────────────────
    while (heap.size > 0) {
      // Timeout check
      if (performance.now() >= deadlineMs) break;

      const state = heap.pop();
      statesExplored++;

      // Skip if a better path to this state was already found
      const key = this._stateKey(state);
      if (closed.get(key) < state.g) continue;

      // ── Goal check: all pieces placed ─────────────────────────────────────
      if (state.pieceIdx >= pieces.length) {
        const f = state.g + this._heuristic(state.bb, 0, minCellsPerPiece);
        if (f < bestF) {
          bestF      = f;
          bestResult = state;
        }
        // If perfect (empty board), stop immediately
        if (state.bb === 0n) break;
        continue;
      }

      // ── Target clears met ────────────────────────────────────────────────
      if (state.clears >= targetClears && targetClears < Infinity) {
        const f = state.g;
        if (f < bestF) {
          bestF      = f;
          bestResult = state;
        }
        continue;
      }

      // ── State limit check ───────────────────────────────────────────────
      if (statesExplored >= this.maxStates) break;

      // ── Expand: try all placements for the current piece ──────────────────
      const placements = pieces[state.pieceIdx].placements;
      const pieceId    = pieces[state.pieceIdx].id;

      for (const { ox, oy, rot, mask } of placements) {
        // Collision check: piece bitmask AND board bitmask must be 0
        if ((mask & state.bb) !== 0n) continue;

        // Place the piece
        const placedBB = state.bb | mask;

        // Process line clears (simulate in-place on the bitboard)
        const { bb: clearedBB, clearCount } = this._processClearsBB(placedBB);

        const newG      = state.g + 1;
        const newClears = state.clears + clearCount;

        // Skip if this placement didn't clear anything AND we're looking for clears
        // (still allow it — the goal is to place all pieces)

        const child = {
          bb       : clearedBB,
          pieceIdx : state.pieceIdx + 1,
          g        : newG,
          clears   : newClears,
          parent   : state,
          action   : { pieceId, x: ox, y: oy, rotation: rot },
        };

        const childKey = this._stateKey(child);

        // Transposition check
        if (closed.has(childKey) && closed.get(childKey) <= newG) continue;

        closed.set(childKey, newG);

        const remaining = pieces.length - child.pieceIdx;
        const h         = this._heuristic(clearedBB, remaining, minCellsPerPiece);
        const f         = newG + h;

        // Bound pruning: skip states that can't beat the current best
        if (bestResult && f >= bestF) continue;

        heap.push(child, f);
      }
    }

    // ── 6. Build result ─────────────────────────────────────────────────────
    const elapsed = performance.now() - startMs;
    const result = {
      success        : bestResult !== null,
      moves          : [],
      clears         : bestResult?.clears ?? 0,
      statesExplored,
      elapsedMs      : Math.round(elapsed),
    };

    if (bestResult) {
      // Walk back from bestResult to root, collecting actions
      let node = bestResult;
      const actions = [];
      while (node.parent) {
        if (node.action) actions.unshift(node.action);
        node = node.parent;
      }
      result.moves = actions;
    }

    return result;
  }

  // ── Bitboard Construction ──────────────────────────────────────────────────

  /**
   * Converts various board representations to a BigInt bitboard.
   * @param {Int8Array|number[]|number[][]|{_cells:Int8Array}} board
   * @returns {bigint}
   */
  _boardToBitboard(board) {
    let bb = 0n;

    // Handle Board instance (has ._cells Int8Array)
    if (board._cells && board._cells instanceof Int8Array) {
      const cells = board._cells;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== 0) bb |= (1n << BigInt(i));
      }
      return bb;
    }

    // Handle flat array (Int8Array or number[])
    if (board.length === this._size) {
      for (let i = 0; i < board.length; i++) {
        if (board[i] !== 0) bb |= (1n << BigInt(i));
      }
      return bb;
    }

    // Handle 2D array: board[y][x]
    if (Array.isArray(board) && board.length === this._h) {
      for (let y = 0; y < this._h; y++) {
        for (let x = 0; x < this._w; x++) {
          if (board[y][x] !== 0) {
            bb |= (1n << BigInt(y * this._w + x));
          }
        }
      }
      return bb;
    }

    throw new Error('PuzzleSolverAI: unrecognized board format');
  }

  // ── Precomputation ─────────────────────────────────────────────────────────

  /** Builds row masks: BigInt with `width` set bits starting at each row. */
  _buildRowMasks() {
    const masks = [];
    for (let y = 0; y < this._h; y++) {
      let mask = 0n;
      for (let x = 0; x < this._w; x++) {
        mask |= (1n << BigInt(y * this._w + x));
      }
      masks.push(mask);
    }
    return masks;
  }

  /** Builds column masks. */
  _buildColMasks() {
    const masks = [];
    for (let x = 0; x < this._w; x++) {
      let mask = 0n;
      for (let y = 0; y < this._h; y++) {
        mask |= (1n << BigInt(y * this._w + x));
      }
      masks.push(mask);
    }
    return masks;
  }

  /**
   * Precomputes every valid (offset, rotation, mask) for every piece.
   * This is a one-time O(n) cost at construction, making A* expansion
   * a simple iteration over precomputed masks.
   *
   * @returns {Map<string, Array<{ox:number,oy:number,rot:number,mask:bigint}>>}
   */
  _precomputeAllPlacements() {
    const map = new Map();

    for (const def of this._defs) {
      const placements = [];

      // Try all 4 rotations
      for (let rot = 0; rot < 4; rot++) {
        const rotCells = this._rotate(def.cells, rot);

        // Try all board offsets
        for (let oy = 0; oy < this._h; oy++) {
          for (let ox = 0; ox < this._w; ox++) {
            let mask   = 0n;
            let valid  = true;

            for (const { x, y } of rotCells) {
              const bx = x + ox, by = y + oy;
              if (bx < 0 || bx >= this._w || by < 0 || by >= this._h) {
                valid = false; break;
              }
              mask |= (1n << BigInt(by * this._w + bx));
            }

            if (valid) placements.push({ ox, oy, rot, mask });
          }
        }
      }

      map.set(def.id, placements);
    }

    return map;
  }

  /**
   * Rotates cell coordinates by `steps` × 90° clockwise.
   * Simplified in-place version for precomputation speed.
   */
  _rotate(cells, steps) {
    const n = ((steps % 4) + 4) % 4;
    let current = cells.map(c => ({ x: c.x, y: c.y }));

    for (let s = 0; s < n; s++) {
      current = current.map(({ x, y }) => ({ x: -y, y: x }));
      const minX = Math.min(...current.map(c => c.x));
      const minY = Math.min(...current.map(c => c.y));
      current = current.map(c => ({ x: c.x - minX, y: c.y - minY }));
    }

    return current;
  }

  // ── Line Clear Detection (bitboard-native) ─────────────────────────────────

  /**
   * Applies line clears on the bitboard.
   * Checks each row/column: if all bits in that mask are set on the board,
   * clears those bits and increments clearCount.
   *
   * @param {bigint} bb  Bitboard to clear
   * @returns {{ bb: bigint, clearCount: number }}
   */
  _processClearsBB(bb) {
    let cleared = bb;
    let count   = 0;

    // Check rows
    for (let y = 0; y < this._h; y++) {
      if ((cleared & this._rowMasks[y]) === this._rowMasks[y]) {
        cleared &= ~this._rowMasks[y];
        count++;
      }
    }

    // Check columns
    for (let x = 0; x < this._w; x++) {
      if ((cleared & this._colMasks[x]) === this._colMasks[x]) {
        cleared &= ~this._colMasks[x];
        count++;
      }
    }

    return { bb: cleared, clearCount: count };
  }

  // ── Heuristic Function ─────────────────────────────────────────────────────

  /**
   * Admissible heuristic: optimistic estimate of moves to clear the board.
   *
   * h(bitboard, remainingPieces) = ceil(popcount / maxCellsPerClear)
   *
   * maxCellsPerClear = (width + height) / piecesRemaining — conservative.
   * For simplicity: ceil(popcount / minCells) divided by (remaining+1) to
   * be admissible (each piece can only clear up to width cells in one placement).
   *
   * @param {bigint} bitboard
   * @param {number} piecesRemaining  Number of pieces still to place
   * @param {number} minCells  Minimum piece size
   * @returns {number}
   */
  _heuristic(bitboard, piecesRemaining, minCells) {
    if (bitboard === 0n) return 0;

    const pop = this._popcount(bitboard);
    if (piecesRemaining <= 0) return pop; // Can't clear further without pieces

    // Optimistic: each placement could clear an entire row (width cells)
    const maxPerPlacement = this._w; // max cells cleared per piece placement
    return Math.ceil(pop / maxPerPlacement);
  }

  /**
   * Fast BigInt popcount using Brian Kernighan's algorithm.
   * @param {bigint} n
   * @returns {number}
   */
  _popcount(n) {
    let count = 0;
    let x     = n;
    while (x !== 0n) {
      x &= (x - 1n); // Clear the lowest set bit
      count++;
    }
    return count;
  }

  // ── State Hashing ──────────────────────────────────────────────────────────

  /**
   * Returns a string key for the transposition table.
   * Key format: "${bitboard}|${pieceIdx}"
   * @param {{ bb: bigint, pieceIdx: number }} state
   * @returns {string}
   */
  _stateKey(state) {
    return `${state.bb}|${state.pieceIdx}`;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') module.exports = { PuzzleSolverAI, MinHeap };