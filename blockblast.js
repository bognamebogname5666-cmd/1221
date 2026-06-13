/**
 * NEXUS BLOCKS — blockblast.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-contained Block-Blast-style core. One canvas (#game-canvas) draws the
 * 8×8 board on top and a 3-piece tray below. Pure pointer-event drag & drop,
 * line/column clears, combos, scoring, game-over detection and best-score
 * persistence. No external module dependencies.
 *
 * Public surface: window.NexusGame = { start, pause, resume, restart, toMenu }
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

(function () {

/* ════════════════════════════════════════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════════════════════════════════════ */

const SIZE        = 8;                 // board is SIZE × SIZE
const TRAY_SLOTS  = 3;                 // pieces offered at once
const BEST_KEY    = 'nexus_best_score';
const MUTE_KEY    = 'nexus_muted';

/** Mutable game state. */
const G = {
  grid    : [],          // SIZE*SIZE, 0 = empty, 1..8 = colour index
  tray    : [],          // length 3, each {cells,w,h,color} or null
  score   : 0,
  best    : 0,
  streak  : 0,           // consecutive placements that cleared ≥1 line
  lines   : 0,           // total lines cleared this game
  bestCombo: 0,
  startTime: 0,
  running : false,
  paused  : false,
  over    : false,
};

/* ════════════════════════════════════════════════════════════════════════════
   PIECE LIBRARY  — Block-Blast-style polyominoes (fixed orientations, no rotate)
   Base shapes are rotated at load to produce their distinct orientations.
═══════════════════════════════════════════════════════════════════════════ */

/** Normalise a cell list so its bounding box starts at (0,0). */
function normalize(cells) {
  const minX = Math.min(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y));
  return cells.map(c => ({ x: c.x - minX, y: c.y - minY }));
}

/** Rotate a cell list 90° clockwise. */
function rotate(cells) {
  return normalize(cells.map(c => ({ x: -c.y, y: c.x })));
}

/** Produce `count` distinct orientations of a base shape. */
function orient(base, count) {
  const out = [];
  let cur = normalize(base);
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const key = cur.map(c => `${c.x},${c.y}`).sort().join('|');
    if (!seen.has(key)) { seen.add(key); out.push(cur); }
    cur = rotate(cur);
  }
  return out;
}

const C = (x, y) => ({ x, y });

// Base shapes paired with how many rotations to include.
const BASES = [
  [[C(0,0)], 1],                                                   // 1×1
  [[C(0,0),C(1,0)], 2],                                            // domino
  [[C(0,0),C(1,0),C(2,0)], 2],                                     // line-3
  [[C(0,0),C(1,0),C(2,0),C(3,0)], 2],                              // line-4
  [[C(0,0),C(1,0),C(2,0),C(3,0),C(4,0)], 2],                       // line-5
  [[C(0,0),C(1,0),C(0,1),C(1,1)], 1],                              // 2×2
  [[C(0,0),C(1,0),C(2,0),C(0,1),C(1,1),C(2,1),C(0,2),C(1,2),C(2,2)], 1], // 3×3
  [[C(0,0),C(1,0),C(0,1),C(1,1),C(0,2),C(1,2)], 2],                // 2×3 rect
  [[C(0,0),C(0,1),C(1,1)], 4],                                     // L-tromino
  [[C(0,0),C(1,0),C(2,0),C(1,1)], 4],                              // T-tetromino
  [[C(1,0),C(2,0),C(0,1),C(1,1)], 2],                              // S
  [[C(0,0),C(1,0),C(1,1),C(2,1)], 2],                              // Z
  [[C(0,0),C(0,1),C(0,2),C(1,2)], 4],                              // L-tetromino
  [[C(1,0),C(1,1),C(1,2),C(0,2)], 4],                              // J-tetromino
  [[C(1,0),C(0,1),C(1,1),C(2,1),C(1,2)], 1],                       // plus
  [[C(0,0),C(0,1),C(0,2),C(1,2),C(2,2)], 4],                       // big-L (corner)
];

/** Flat list of every distinct orientation: each {cells,w,h}. */
const SHAPES = [];
for (const [base, n] of BASES) {
  for (const cells of orient(base, n)) {
    const w = Math.max(...cells.map(c => c.x)) + 1;
    const h = Math.max(...cells.map(c => c.y)) + 1;
    SHAPES.push({ cells, w, h });
  }
}

/** Deterministic-free RNG helpers (Math.random is fine for endless play). */
function randInt(n) { return Math.floor(Math.random() * n); }

/** Build a fresh tray piece: random shape + random colour 1..8. */
function makePiece() {
  const s = SHAPES[randInt(SHAPES.length)];
  return { cells: s.cells, w: s.w, h: s.h, color: 1 + randInt(8) };
}

/* ════════════════════════════════════════════════════════════════════════════
   BOARD LOGIC
═══════════════════════════════════════════════════════════════════════════ */

function idx(x, y) { return y * SIZE + x; }

function resetGrid() { G.grid = new Array(SIZE * SIZE).fill(0); }

/** Can `piece` be placed with its top-left at board (ox, oy)? */
function canPlace(piece, ox, oy) {
  for (const c of piece.cells) {
    const x = ox + c.x, y = oy + c.y;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
    if (G.grid[idx(x, y)] !== 0) return false;
  }
  return true;
}

/** Is there ANY position on the board where `piece` fits? */
function fitsAnywhere(piece) {
  for (let oy = 0; oy <= SIZE - piece.h; oy++)
    for (let ox = 0; ox <= SIZE - piece.w; ox++)
      if (canPlace(piece, ox, oy)) return true;
  return false;
}

/** Which rows + cols would be full if `piece` were placed at (ox,oy)? */
function previewClears(piece, ox, oy) {
  const filled = new Set(piece.cells.map(c => idx(ox + c.x, oy + c.y)));
  const isFilled = (x, y) => G.grid[idx(x, y)] !== 0 || filled.has(idx(x, y));
  const rows = [], cols = [];
  for (let y = 0; y < SIZE; y++) {
    let full = true;
    for (let x = 0; x < SIZE; x++) if (!isFilled(x, y)) { full = false; break; }
    if (full) rows.push(y);
  }
  for (let x = 0; x < SIZE; x++) {
    let full = true;
    for (let y = 0; y < SIZE; y++) if (!isFilled(x, y)) { full = false; break; }
    if (full) cols.push(x);
  }
  return { rows, cols };
}

/* ════════════════════════════════════════════════════════════════════════════
   CANVAS & LAYOUT
═══════════════════════════════════════════════════════════════════════════ */

let canvas, ctx, dpr = 1;
const view = { w: 0, h: 0, cell: 0, bx: 0, by: 0, gap: 0, boardPx: 0, pad: 0,
               trayTop: 0, trayY: 0, trayCell: 0, slotW: 0 };
const colours = []; // [null, {base,light,shadow}, ...] index 1..8

function readColours() {
  const cs = getComputedStyle(document.documentElement);
  colours.length = 0; colours.push(null);
  const fallback = ['#FF2A6D','#05D9E8','#FFC600','#01FF89','#B900FF','#0055FF','#FF7700','#E0E0E0'];
  for (let i = 1; i <= 8; i++) {
    const base   = (cs.getPropertyValue(`--piece-${i}-base`).trim())   || fallback[i-1];
    const light  = (cs.getPropertyValue(`--piece-${i}-light`).trim())  || base;
    const shadow = (cs.getPropertyValue(`--piece-${i}-shadow`).trim()) || base;
    colours.push({ base, light, shadow });
  }
}

function layout() {
  const rect = canvas.getBoundingClientRect();
  view.w = rect.width; view.h = rect.height;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Reserve bottom area for the tray (~24% of height), board is square on top.
  const pad      = Math.max(8, view.w * 0.035);
  const trayH    = view.h * 0.24;
  const boardMax = Math.min(view.w - pad * 2, view.h - trayH - pad * 2);
  view.cell = Math.floor(boardMax / SIZE);
  const boardPx = view.cell * SIZE;
  view.boardPx = boardPx;
  view.pad = pad;
  view.bx = Math.round((view.w - boardPx) / 2);
  view.by = Math.round(pad + (view.h - trayH - pad - boardPx) / 2);
  view.gap = Math.max(2, Math.round(view.cell * 0.07));

  // Tray: 3 slots across the width below the board.
  view.trayTop  = view.by + boardPx + pad * 0.9;
  view.trayY    = view.trayTop;
  view.slotW    = view.w / TRAY_SLOTS;
  view.trayCell = Math.floor(view.cell * 0.56);
}

/* ════════════════════════════════════════════════════════════════════════════
   RENDERING
═══════════════════════════════════════════════════════════════════════════ */

// Transient visual effects
const fx = {
  pops    : [],   // {x,y,t} placed-cell pop
  flashes : [],   // {cells:[{x,y}], t} clearing cells
  particles: [],  // {x,y,vx,vy,life,max,color,size}
  shake   : 0,
};

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y,     x + w, y + h, r);
  g.arcTo(x + w, y + h, x,     y + h, r);
  g.arcTo(x,     y + h, x,     y,     r);
  g.arcTo(x,     y,     x + w, y,     r);
  g.closePath();
}

/** Draw a single filled block (rounded, bevelled, glossy, optional glow). */
function drawBlock(px, py, size, colorIdx, alpha = 1, scale = 1, glow = 0) {
  const col = colours[colorIdx] || colours[1];
  const inset = view.gap;
  let s = size - inset;
  let x = px + inset / 2, y = py + inset / 2;
  if (scale !== 1) {
    const d = (s * (1 - scale)) / 2;
    x += d; y += d; s *= scale;
  }
  const r = Math.max(3, s * 0.22);
  ctx.globalAlpha = alpha;

  // soft drop shadow / coloured glow underneath
  if (glow > 0) {
    ctx.save();
    ctx.shadowColor = col.base;
    ctx.shadowBlur = glow;
    roundRect(ctx, x, y, s, s, r);
    ctx.fillStyle = col.base;
    ctx.fill();
    ctx.restore();
  }

  // body — diagonal gradient light→base→shadow
  roundRect(ctx, x, y, s, s, r);
  const grad = ctx.createLinearGradient(x, y, x + s * 0.4, y + s);
  grad.addColorStop(0, col.light);
  grad.addColorStop(0.5, col.base);
  grad.addColorStop(1, col.shadow);
  ctx.fillStyle = grad;
  ctx.fill();

  // inner bevel: bright top-left edge
  ctx.lineWidth = Math.max(1, s * 0.06);
  roundRect(ctx, x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth, r * 0.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();

  // top gloss highlight
  roundRect(ctx, x + s * 0.16, y + s * 0.12, s * 0.68, s * 0.24, r * 0.6);
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fill();

  ctx.globalAlpha = 1;
}

/** Rounded panel with fill + subtle inner shadow + border. */
function drawPanel(x, y, w, h, r, fill, border) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) {
    ctx.lineWidth = 1.5;
    roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r - 0.75);
    ctx.strokeStyle = border;
    ctx.stroke();
  }
}

/** Dark rounded backing panel behind the 8×8 board. */
function drawBoardPanel() {
  const m = view.gap;
  drawPanel(view.bx - m, view.by - m, view.boardPx + m * 2, view.boardPx + m * 2,
            Math.max(8, view.cell * 0.28), 'rgba(8,8,14,0.55)', 'rgba(255,255,255,0.06)');
}

/** Rounded "well" behind each empty tray slot. */
function drawTrayWells() {
  const wellH = view.h - view.trayTop - view.pad * 0.5;
  const r = Math.max(8, view.cell * 0.22);
  for (let i = 0; i < TRAY_SLOTS; i++) {
    const occupied = G.tray[i] && !(drag.piece && drag.slot === i);
    const m = view.slotW * 0.10;
    const x = view.slotW * i + m, y = view.trayTop, w = view.slotW - m * 2, h = wellH;
    drawPanel(x, y, w, h, r,
              occupied ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.025)',
              'rgba(255,255,255,0.05)');
  }
}

function drawBoard() {
  // board frame / empty cells
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = view.bx + x * view.cell, py = view.by + y * view.cell;
      const v = G.grid[idx(x, y)];
      if (v === 0) {
        roundRect(ctx, px + view.gap / 2, py + view.gap / 2,
                  view.cell - view.gap, view.cell - view.gap, Math.max(3, view.cell * 0.16));
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        ctx.fill();
      } else {
        drawBlock(px, py, view.cell, v);
      }
    }
  }
}

function drawClearFlashes() {
  for (const f of fx.flashes) {
    const a = 1 - f.t;                     // 1 → 0
    const grow = 1 + f.t * 0.6;            // expands as it fades
    const cs = view.cell;
    for (const c of f.cells) {
      const s = (cs - view.gap) * grow;
      const px = view.bx + c.x * cs + cs / 2 - s / 2;
      const py = view.by + c.y * cs + cs / 2 - s / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = cs * 0.5 * a;
      roundRect(ctx, px, py, s, s, Math.max(3, cs * 0.22));
      ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawPops() {
  for (const p of fx.pops) {
    const scale = 1 + 0.35 * Math.sin(Math.min(p.t, 1) * Math.PI);
    drawBlock(view.bx + p.x * view.cell, view.by + p.y * view.cell, view.cell, p.color, 1, scale);
  }
}

function drawParticles() {
  for (const p of fx.particles) {
    const a = p.life / p.max;
    const col = colours[p.color] || colours[1];
    ctx.globalAlpha = a;
    ctx.fillStyle = col.light;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Render one tray piece centred inside slot `i` (skips the dragged one). */
function drawTrayPiece(piece, i) {
  if (!piece) return;
  const cs = view.trayCell;
  const cx = view.slotW * i + view.slotW / 2;
  const cy = view.trayY + (view.h - view.trayY) / 2;
  const ox = cx - (piece.w * cs) / 2;
  const oy = cy - (piece.h * cs) / 2;
  for (const c of piece.cells) drawBlock(ox + c.x * cs, oy + c.y * cs, cs, piece.color);
}

function drawGhostAndDrag() {
  if (!drag.piece) return;
  const p = drag.piece;
  const cs = view.cell;

  // candidate board origin under the (lifted) pointer
  const leftPx = drag.x - p.w * cs / 2;
  const topPx  = drag.y - p.h * cs - cs * 0.4;
  const cox = Math.round((leftPx - view.bx) / cs);
  const coy = Math.round((topPx  - view.by) / cs);
  const valid   = canPlace(p, cox, coy);
  const inBoard = cox >= 0 && coy >= 0 && cox + p.w <= SIZE && coy + p.h <= SIZE;

  if (valid) {
    const { rows, cols } = previewClears(p, cox, coy);
    // highlight lines that would clear (drawn under the ghost)
    if (rows.length + cols.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (const y of rows) { roundRect(ctx, view.bx, view.by + y * cs, cs * SIZE, cs, 6); ctx.fill(); }
      for (const x of cols) { roundRect(ctx, view.bx + x * cs, view.by, cs, cs * SIZE, 6); ctx.fill(); }
    }
    // snapped ghost with coloured glow
    for (const c of p.cells)
      drawBlock(view.bx + (cox + c.x) * cs, view.by + (coy + c.y) * cs, cs, p.color, 1, 1, cs * 0.45);
  } else if (inBoard) {
    // over the board but blocked → red-tinted preview at the snapped cells
    for (const c of p.cells) {
      const px = view.bx + (cox + c.x) * cs, py = view.by + (coy + c.y) * cs;
      roundRect(ctx, px + view.gap / 2, py + view.gap / 2, cs - view.gap, cs - view.gap, Math.max(3, cs * 0.22));
      ctx.fillStyle = 'rgba(255,40,90,0.40)';
      ctx.fill();
    }
  } else {
    // free-floating above the finger — full size, slightly translucent
    for (const c of p.cells)
      drawBlock(leftPx + c.x * cs, topPx + c.y * cs, cs, p.color, 0.85);
  }
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.save();
  if (fx.shake > 0) {
    const s = fx.shake;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
  drawBoardPanel();
  drawBoard();
  drawClearFlashes();
  drawPops();
  drawTrayWells();
  // tray (skip the slot currently being dragged)
  for (let i = 0; i < TRAY_SLOTS; i++) if (!(drag.piece && drag.slot === i)) drawTrayPiece(G.tray[i], i);
  drawGhostAndDrag();
  drawParticles();
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════════
   ANIMATION LOOP
═══════════════════════════════════════════════════════════════════════════ */

let lastT = 0, rafId = 0;
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000) || 0;
  lastT = now;
  drawBg(dt);                 // ambient background animates on every screen
  if (G.paused) return;

  // advance fx
  fx.pops    = fx.pops.filter(p => (p.t += dt * 2.2) < 1);
  fx.flashes = fx.flashes.filter(f => (f.t += dt * 3) < 1);
  fx.shake   = Math.max(0, fx.shake - dt * 40);
  for (const p of fx.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 600 * dt; p.vx *= 0.98; p.life -= dt;
  }
  fx.particles = fx.particles.filter(p => p.life > 0);

  render();
}

function spawnParticles(cells) {
  if (fx.particles.length > 600) return;   // perf guard
  for (const c of cells) {
    const cx = view.bx + (c.x + 0.5) * view.cell;
    const cy = view.by + (c.y + 0.5) * view.cell;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      fx.particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60,
        life: 0.5 + Math.random() * 0.4, max: 0.9,
        color: c.color || 1, size: view.cell * 0.16,
      });
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   INPUT — pointer drag & drop (the piece that was missing entirely)
═══════════════════════════════════════════════════════════════════════════ */

const drag = { active: false, piece: null, slot: -1, x: 0, y: 0, snap: null, pointerId: null };

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Which tray slot (if any) is under (x,y)? Returns index or -1. */
function trayHit(x, y) {
  if (y < view.trayY) return -1;
  const i = Math.floor(x / view.slotW);
  return (i >= 0 && i < TRAY_SLOTS && G.tray[i]) ? i : -1;
}

/** Update drag.snap from the current pointer (lifted, centred on the piece). */
function updateSnap() {
  const p = drag.piece;
  const cs = view.cell;
  // top-left of the floating piece, lifted above the finger
  const leftPx = drag.x - p.w * cs / 2;
  const topPx  = drag.y - p.h * cs - cs * 0.4;
  const ox = Math.round((leftPx - view.bx) / cs);
  const oy = Math.round((topPx  - view.by) / cs);
  drag.snap = canPlace(p, ox, oy) ? { ox, oy } : null;
}

function onPointerDown(e) {
  if (!G.running || G.paused || G.over) return;
  const { x, y } = pointerPos(e);
  const slot = trayHit(x, y);
  if (slot < 0) return;
  drag.active = true; drag.slot = slot; drag.piece = G.tray[slot];
  drag.x = x; drag.y = y; drag.pointerId = e.pointerId;
  updateSnap();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drag.active) return;
  const { x, y } = pointerPos(e);
  drag.x = x; drag.y = y;
  updateSnap();
  e.preventDefault();
}

function onPointerUp(e) {
  if (!drag.active) return;
  const placed = drag.snap ? placePiece(drag.slot, drag.snap.ox, drag.snap.oy) : false;
  if (!placed) buzz(false);
  drag.active = false; drag.piece = null; drag.slot = -1; drag.snap = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}

/* ════════════════════════════════════════════════════════════════════════════
   PLACEMENT, CLEARS, SCORING
═══════════════════════════════════════════════════════════════════════════ */

function placePiece(slot, ox, oy) {
  const p = G.tray[slot];
  if (!p || !canPlace(p, ox, oy)) return false;

  // write cells + pop fx
  for (const c of p.cells) {
    const x = ox + c.x, y = oy + c.y;
    G.grid[idx(x, y)] = p.color;
    fx.pops.push({ x, y, color: p.color, t: 0 });
  }
  G.tray[slot] = null;
  addScore(p.cells.length);
  buzz(true);

  // resolve clears
  const cleared = resolveClears();
  if (cleared.lineCount > 0) {
    G.streak += 1;
    const combo = G.streak;
    G.bestCombo = Math.max(G.bestCombo, Math.max(combo, cleared.lineCount));
    const linePts = cleared.lineCount * (cleared.lineCount + 1) / 2 * 10;
    addScore(linePts * Math.max(1, combo));
    G.lines += cleared.lineCount;
    if (combo >= 2 || cleared.lineCount >= 2) showCombo(Math.max(combo, cleared.lineCount));
    fx.shake = Math.min(14, 4 + cleared.lineCount * 3);
  } else {
    G.streak = 0;
  }

  // refill tray when empty
  if (G.tray.every(t => t === null)) refillTray();

  syncHud();
  checkGameOver();
  return true;
}

/** Clear any full rows/cols already present on the grid. */
function resolveClears() {
  const fullRows = [], fullCols = [];
  for (let y = 0; y < SIZE; y++) {
    let full = true;
    for (let x = 0; x < SIZE; x++) if (G.grid[idx(x, y)] === 0) { full = false; break; }
    if (full) fullRows.push(y);
  }
  for (let x = 0; x < SIZE; x++) {
    let full = true;
    for (let y = 0; y < SIZE; y++) if (G.grid[idx(x, y)] === 0) { full = false; break; }
    if (full) fullCols.push(x);
  }
  const cells = [];
  const mark = (x, y) => cells.push({ x, y, color: G.grid[idx(x, y)] });
  for (const y of fullRows) for (let x = 0; x < SIZE; x++) mark(x, y);
  for (const x of fullCols) for (let y = 0; y < SIZE; y++) if (!fullRows.includes(y)) mark(x, y);

  for (const c of cells) G.grid[idx(c.x, c.y)] = 0;
  if (cells.length) {
    fx.flashes.push({ cells: cells.map(c => ({ x: c.x, y: c.y })), t: 0 });
    spawnParticles(cells);
  }
  return { lineCount: fullRows.length + fullCols.length, cells };
}

function addScore(n) {
  G.score += Math.round(n);
  if (G.score > G.best) { G.best = G.score; save(BEST_KEY, G.best); }
}

function refillTray() {
  // Generate a trio; prefer one where ≥1 piece fits the current board.
  for (let attempt = 0; attempt < 12; attempt++) {
    const trio = [makePiece(), makePiece(), makePiece()];
    if (attempt === 11 || trio.some(p => fitsAnywhere(p))) {
      G.tray = trio; return;
    }
  }
}

function checkGameOver() {
  const remaining = G.tray.filter(Boolean);
  if (remaining.length === 0) return;            // tray just refilled handles itself
  if (!remaining.some(p => fitsAnywhere(p))) gameOver();
}

/* ════════════════════════════════════════════════════════════════════════════
   HUD / SCREENS / AUDIO
═══════════════════════════════════════════════════════════════════════════ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let _shownScore = 0;
function syncHud() {
  const sc = $('.hud-score');
  if (sc) {
    sc.textContent = G.score.toLocaleString('en-US');
    if (G.score > _shownScore) {              // re-trigger the bounce keyframe
      sc.style.animation = 'none'; void sc.offsetWidth;
      sc.style.animation = 'scoreBounce .4s var(--ease-spring, ease)';
    }
  }
  _shownScore = G.score;
  const hs = $('.hud-high-score'); if (hs) hs.textContent = G.best.toLocaleString('en-US');
}

function showCombo(n) {
  const el = $('#hud-combo-popup');
  if (!el) return;
  el.textContent = `Combo ×${n}`;
  el.dataset.tier = Math.min(Math.max(1, n), 5);
  el.classList.remove('hud-combo--visible'); void el.offsetWidth; el.classList.add('hud-combo--visible');
}

function showScreen(id) {
  $$('#app .screen').forEach(s => s.classList.toggle('active', s.id === id));
}
function showOverlay(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('active', on);
}

function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function load(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }

function buzz(ok) {
  if (load(MUTE_KEY, false)) return;
  if (navigator.vibrate) { try { navigator.vibrate(ok ? 12 : 30); } catch {} }
  beep(ok);
}

// Tiny WebAudio blip — no asset files needed.
let ac = null;
function beep(ok) {
  if (load(MUTE_KEY, false)) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 520 : 160;
    o.type = ok ? 'triangle' : 'sawtooth';
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ac.destination);
    const t = ac.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (ok ? 0.12 : 0.18));
    o.start(t); o.stop(t + 0.2);
  } catch {}
}

/* ════════════════════════════════════════════════════════════════════════════
   GAME FLOW
═══════════════════════════════════════════════════════════════════════════ */

function start() {
  G.best = load(BEST_KEY, 0);
  resetGrid();
  refillTray();
  G.score = 0; G.streak = 0; G.lines = 0; G.bestCombo = 0; _shownScore = 0;
  G.running = true; G.paused = false; G.over = false;
  G.startTime = performance.now();
  showScreen('screen-game');
  showOverlay('overlay-pause', false);
  showOverlay('overlay-game-over', false);
  // size canvas once the game screen is actually visible
  requestAnimationFrame(() => requestAnimationFrame(() => { layout(); syncHud(); }));
}

function pause()  { if (G.running && !G.over) { G.paused = true;  showOverlay('overlay-pause', true); } }
function resume() { if (G.running && !G.over) { G.paused = false; showOverlay('overlay-pause', false); } }
function restart(){ showOverlay('overlay-pause', false); showOverlay('overlay-game-over', false); start(); }
function toMenu() {
  G.running = false; G.paused = false;
  showOverlay('overlay-pause', false);
  showOverlay('overlay-game-over', false);
  showScreen('screen-menu');
  refreshMenu();
}

function gameOver() {
  if (G.over) return;
  G.over = true; G.running = false;
  const go = $('#go-score'); if (go) go.textContent = G.score.toLocaleString('en-US');
  showOverlay('overlay-game-over', true);
}

function showResults() {
  showOverlay('overlay-game-over', false);
  const isRecord = G.score >= G.best && G.score > 0;
  const set = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
  set('#res-score', G.score.toLocaleString('en-US'));
  set('#res-high-score', G.best.toLocaleString('en-US'));
  set('#res-lines', String(G.lines));
  const bc = $('#res-best-combo'); if (bc) bc.innerHTML = `${G.bestCombo}&times;`;
  const ms = performance.now() - G.startTime;
  const s = Math.floor(ms / 1000);
  set('#res-time', `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);
  const rec = $('#res-new-record'); if (rec) rec.hidden = !isRecord;
  showScreen('screen-results');
}

/* ════════════════════════════════════════════════════════════════════════════
   AMBIENT BACKGROUND & MENU FX  (restores life lost with the old inline script)
═══════════════════════════════════════════════════════════════════════════ */

let bgCanvas, bgCtx, bgW = 0, bgH = 0, bgT = 0;

// Slow-drifting brand-coloured glow orbs.
const ORBS = [
  { hex: '#6600FF', ax: 0.24, ay: 0.20, sx: 0.7, sy: 0.5, ph: 0.0, r: 0.55 },
  { hex: '#00F0FF', ax: 0.72, ay: 0.30, sx: 0.5, sy: 0.6, ph: 1.7, r: 0.45 },
  { hex: '#01FF89', ax: 0.50, ay: 0.82, sx: 0.4, sy: 0.4, ph: 3.1, r: 0.50 },
];

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function resizeBg() {
  if (!bgCanvas) return;
  bgW = bgCanvas.width  = Math.round(window.innerWidth);
  bgH = bgCanvas.height = Math.round(window.innerHeight);
}

function drawBg(dt) {
  if (!bgCtx) return;
  bgT += dt;
  bgCtx.clearRect(0, 0, bgW, bgH);
  bgCtx.globalCompositeOperation = 'lighter';
  for (const o of ORBS) {
    const cx = bgW * (o.ax + 0.06 * Math.sin(bgT * o.sx + o.ph));
    const cy = bgH * (o.ay + 0.06 * Math.cos(bgT * o.sy + o.ph));
    const rad = Math.max(bgW, bgH) * o.r;
    const g = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, hexA(o.hex, 0.16));
    g.addColorStop(1, hexA(o.hex, 0));
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, bgW, bgH);
  }
  bgCtx.globalCompositeOperation = 'source-over';
}

function initBackground() {
  bgCanvas = document.getElementById('bg-canvas');
  if (!bgCanvas) return;
  bgCtx = bgCanvas.getContext('2d');
  window.addEventListener('resize', resizeBg);
  resizeBg();
}

/** Floating drifting dots in the menu particle field. */
function initMenuDots() {
  const field = document.querySelector('.menu-particles');
  if (!field || field.dataset.populated) return;
  field.dataset.populated = '1';
  if (!document.getElementById('nx-dot-kf')) {
    const s = document.createElement('style');
    s.id = 'nx-dot-kf';
    s.textContent = '@keyframes nxDrift{0%,100%{transform:translate(0,0) scale(1);opacity:.5}25%{transform:translate(10px,-22px) scale(1.3);opacity:1}50%{transform:translate(-7px,-38px) scale(.7);opacity:.3}75%{transform:translate(15px,-14px) scale(1.1);opacity:.8}}';
    document.head.appendChild(s);
  }
  const cols = ['rgba(0,240,255,.55)','rgba(102,0,255,.5)','rgba(1,255,137,.45)','rgba(255,198,0,.4)','rgba(255,42,109,.4)'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 28; i++) {
    const d = document.createElement('span');
    const size = 1.5 + Math.random() * 3.5;
    Object.assign(d.style, {
      position: 'absolute', left: `${Math.random()*100}%`, top: `${Math.random()*100}%`,
      width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: cols[i % cols.length], pointerEvents: 'none',
      animation: `nxDrift ${7 + Math.random()*14}s ${-(Math.random()*12)}s ease-in-out infinite`,
    });
    frag.appendChild(d);
  }
  field.appendChild(frag);
}

/** rAF count-up tween. */
function tweenCount(el, to, ms) {
  if (!el) return;
  const start = performance.now();
  (function step(now) {
    const t = Math.min((now - start) / ms, 1);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = Math.round(to * e).toLocaleString('en-US');
    if (t < 1) requestAnimationFrame(step);
  })(start);
}

function refreshMenu() {
  G.best = load(BEST_KEY, 0);
  tweenCount($('#best-score-counter'), G.best, Math.min(1400, G.best / 2 + 500));
  const c = $('#hs-classic'); if (c) c.textContent = G.best.toLocaleString('en-US');
}

/* ════════════════════════════════════════════════════════════════════════════
   BOOTSTRAP / WIRING
═══════════════════════════════════════════════════════════════════════════ */

function wireButtons() {
  // Menu: single Play button OR legacy mode buttons all start classic.
  const startBtns = [...$$('#btn-play, .menu-mode-btn')];
  startBtns.forEach(b => b.addEventListener('click', () => { ensureAudio(); start(); }));

  $('#btn-pause')?.addEventListener('click', () => (G.paused ? resume() : pause()));
  $('#btn-resume')?.addEventListener('click', resume);
  $('#btn-restart')?.addEventListener('click', restart);
  $('#btn-menu-from-pause')?.addEventListener('click', toMenu);
  $('#btn-see-results')?.addEventListener('click', showResults);
  $('#btn-play-again')?.addEventListener('click', () => start());
  $('#btn-menu-from-results')?.addEventListener('click', toMenu);

  document.addEventListener('keydown', e => {
    if (!G.running) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { G.paused ? resume() : pause(); }
  });

  wireSettings();
}

function wireSettings() {
  const panel    = $('#settings-panel');
  const backdrop = $('#settings-backdrop');
  const open  = () => { panel?.classList.add('open'); backdrop?.classList.add('open'); panel?.removeAttribute('aria-hidden'); };
  const close = () => { panel?.classList.remove('open'); backdrop?.classList.remove('open'); panel?.setAttribute('aria-hidden', 'true'); };
  $('#btn-settings-open')?.addEventListener('click', open);
  $('#btn-settings-close')?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  const sfx = $('#setting-sfx');
  if (sfx) {
    sfx.checked = !load(MUTE_KEY, false);          // checked = sound ON
    sfx.addEventListener('change', () => { save(MUTE_KEY, !sfx.checked); if (sfx.checked) ensureAudio(); });
  }
}

function ensureAudio() {
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {}
}

function init() {
  canvas = document.getElementById('game-canvas');
  if (!canvas) { console.warn('[NexusGame] #game-canvas not found'); return; }
  ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';   // let us own touch gestures
  readColours();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => { if (G.running) layout(); });

  initBackground();
  initMenuDots();
  wireButtons();
  refreshMenu();

  // Boot splash → menu (matches existing #screen-boot markup if present).
  if (document.getElementById('screen-boot')?.classList.contains('active')) {
    setTimeout(() => showScreen('screen-menu'), 700);
  }

  lastT = performance.now();
  rafId = requestAnimationFrame(loop);
}

window.NexusGame = { start, pause, resume, restart, toMenu };

// Test-only export (inert in the browser, where `module` is undefined).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { G, SHAPES, view, resetGrid, idx, canPlace, fitsAnywhere, previewClears, resolveClears, makePiece, refillTray };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
