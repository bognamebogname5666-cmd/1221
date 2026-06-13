/**
 * NEXUS BLOCKS — CanvasRenderer
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure Canvas 2D rendering engine for the game board, blocks, particles,
 * and visual effects.  Replaces the DOM-based board rendering with a
 * high-performance canvas pipeline targeting 60 fps on mid-range mobile.
 *
 * Dependencies (loaded before this file):
 *   • Board.js        — board.getCell(x,y) → colorIndex (0=empty, 1–8)
 *   • EventBus.js     — bus.on() / bus.emit() for event-driven rendering
 *   • AnimationUtils  — Easing functions + Tween class
 *   • MathUtils       — lerp, clamp, randomFloat, etc.
 *   • styles.css      — defines --color-primary (#6600FF) and --color-bg (#0A0A0F)
 *   • nexus_visuals.css — defines --piece-N-base/light/shadow colour tokens
 *
 * This file does NOT redeclare --color-primary or --color-bg.
 * It reads piece colours from CSS custom properties at init time and caches
 * them as RGB arrays for fast canvas drawing.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 *
 *   CanvasRenderer
 *   ├── BlockRenderer        — draws individual blocks (rounded rect + glow)
 *   ├── GridRenderer         — dot grid, hover highlight, danger zone
 *   ├── ParticleSystem       — object-pool (500), 4 particle types
 *   ├── VisualFX             — screen shake, flash overlay, NEXUS logo
 *   └── AnimationTimeline    — queue-based, parallel + sequential, tweens
 *
 * ── Public API ─────────────────────────────────────────────────────────────
 *
 *   const renderer = new CanvasRenderer(canvas, board, bus);
 *   renderer.init();
 *   renderer.resize();
 *   renderer.update(dt);      // tick particles, timeline, shake
 *   renderer.render(alpha);   // draw everything
 *   renderer.emitLineClear(y);
 *   renderer.emitCombo(multiplier);
 *   renderer.emitGameOver();
 *   renderer.setGhost(cells, ox, oy, colorIndex);
 *   renderer.clearGhost();
 *   renderer.setHoverCell(x, y);
 *   renderer.clearHover();
 *   renderer.setDangerRows(rows[]);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════════════════
   0 · COLOUR CACHE  — reads CSS custom properties once, stores as RGB
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Parses a CSS colour string (#RRGGBB or rgb(...)) into [r, g, b].
 * Returns [128, 128, 128] on failure.
 * @param {string} raw
 * @returns {number[]}
 */
function parseCSSColour(raw) {
  const s = (raw ?? '').trim();
  // #RRGGBB
  if (s.startsWith('#') && s.length >= 7) {
    return [
      parseInt(s.slice(1, 3), 16),
      parseInt(s.slice(3, 5), 16),
      parseInt(s.slice(5, 7), 16),
    ];
  }
  // rgb(r, g, b)
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

/**
 * Reads the 8 piece colour triplets (base / light / shadow) from the
 * computed style on :root.  Returns an array indexed 1–8 (0 unused).
 * Each entry: { base: [r,g,b], light: [r,g,b], shadow: [r,g,b] }
 */
function readPieceColoursFromCSS() {
  const style = getComputedStyle(document.documentElement);
  const out = [null]; // index 0 = unused
  for (let i = 1; i <= 8; i++) {
    out.push({
      base  : parseCSSColour(style.getPropertyValue(`--piece-${i}-base`).trim()),
      light : parseCSSColour(style.getPropertyValue(`--piece-${i}-light`).trim()),
      shadow: parseCSSColour(style.getPropertyValue(`--piece-${i}-shadow`).trim()),
    });
  }
  return out;
}

/** Reads --color-primary and --color-bg as RGB arrays (for canvas use). */
function readBrandColoursFromCSS() {
  const style = getComputedStyle(document.documentElement);
  return {
    primary: parseCSSColour(style.getPropertyValue('--color-primary').trim()),
    bg     : parseCSSColour(style.getPropertyValue('--color-bg').trim()),
    secondary: parseCSSColour(style.getPropertyValue('--color-secondary').trim() || '#00F0FF'),
    combo  : parseCSSColour(style.getPropertyValue('--accent-combo').trim() || '#FFD700'),
    danger : parseCSSColour(style.getPropertyValue('--accent-danger').trim() || '#FF2A6D'),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   1 · BLOCK RENDERER
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Draws a single block (rounded rect with inner highlight + outer shadow)
 * onto the given Canvas 2D context.
 *
 * Quantum Glass aesthetic — mirrors the CSS .block style from nexus_visuals.css:
 *   • Radial gradient: light → base → shadow (top-left to bottom-right)
 *   • Semi-transparent white border
 *   • Inner specular highlight blob (top-left)
 *   • Canvas shadowBlur for outer glow
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x       — pixel x of the cell's top-left
 * @param {number} y       — pixel y of the cell's top-left
 * @param {number} size    — cell size in pixels (includes padding)
 * @param {object} colours — { base:[r,g,b], light:[r,g,b], shadow:[r,g,b] }
 * @param {number} [alpha=1]      — overall opacity
 * @param {number} [flashWhite=0] — 0..1 blend toward white (lock animation)
 */
function drawBlock(ctx, x, y, size, colours, alpha = 1, flashWhite = 0) {
  const pad = 1;                       // 1px gap between cells
  const bx = x + pad;
  const by = y + pad;
  const bs = size - pad * 2;
  const r  = Math.max(1, bs * 0.12);   // corner radius ≈ 4px at 36px cell

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── Outer shadow (canvas shadow API) ────────────────────────────────────
  if (flashWhite < 0.5) {
    ctx.shadowColor   = `rgba(${colours.shadow[0]},${colours.shadow[1]},${colours.shadow[2]},0.55)`;
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
  }

  // ── Radial gradient fill (light → base → shadow) ────────────────────────
  const cx = bx + bs * 0.35;  // gradient centre offset toward top-left
  const cy = by + bs * 0.35;
  const grad = ctx.createRadialGradient(cx, cy, 0, bx + bs / 2, by + bs / 2, bs * 0.85);

  if (flashWhite > 0) {
    // Blend toward white for the lock-flash animation
    const w = flashWhite;
    const bl = (arr) => arr.map(c => Math.round(c + (255 - c) * w));
    grad.addColorStop(0,   `rgb(${bl(colours.light).join(',')})`);
    grad.addColorStop(0.55,`rgb(${bl(colours.base).join(',')})`);
    grad.addColorStop(1,   `rgb(${bl(colours.shadow).join(',')})`);
  } else {
    grad.addColorStop(0,   `rgb(${colours.light.join(',')})`);
    grad.addColorStop(0.55,`rgb(${colours.base.join(',')})`);
    grad.addColorStop(1,   `rgb(${colours.shadow.join(',')})`);
  }

  // Rounded rect path
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bs - r, by);
  ctx.arcTo(bx + bs, by, bx + bs, by + r, r);
  ctx.lineTo(bx + bs, by + bs - r);
  ctx.arcTo(bx + bs, by + bs, bx + bs - r, by + bs, r);
  ctx.lineTo(bx + r, by + bs);
  ctx.arcTo(bx, by + bs, bx, by + bs - r, r);
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.fill();

  // Reset shadow before drawing border & highlight
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;

  // ── Border (semi-transparent white) ─────────────────────────────────────
  ctx.strokeStyle = `rgba(255,255,255,${0.35 + flashWhite * 0.4})`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  // ── Inner specular highlight (top-left blob) ─────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bs - r, by);
  ctx.arcTo(bx + bs, by, bx + bs, by + r, r);
  ctx.lineTo(bx + bs, by + bs - r);
  ctx.arcTo(bx + bs, by + bs, bx + bs - r, by + bs, r);
  ctx.lineTo(bx + r, by + bs);
  ctx.arcTo(bx, by + bs, bx, by + bs - r, r);
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();
  ctx.clip();

  const hlX = bx + bs * 0.12;
  const hlY = by + bs * 0.12;
  const hlR = bs * 0.28;
  const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, hlR);
  hlGrad.addColorStop(0, `rgba(255,255,255,${0.7 + flashWhite * 0.3})`);
  hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hlGrad;
  ctx.fillRect(bx, by, bs, bs);
  ctx.restore();

  ctx.restore();
}

/**
 * Draws a ghost piece — same shape but 25% opacity, dashed outline only.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {object} colours
 */
function drawGhostBlock(ctx, x, y, size, colours) {
  const pad = 1;
  const bx  = x + pad;
  const by  = y + pad;
  const bs  = size - pad * 2;
  const r   = Math.max(1, bs * 0.12);

  ctx.save();
  ctx.globalAlpha = 0.25;

  // Dashed outline
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = `rgb(${colours.base.join(',')})`;
  ctx.lineWidth   = 1.5;

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bs - r, by);
  ctx.arcTo(bx + bs, by, bx + bs, by + r, r);
  ctx.lineTo(bx + bs, by + bs - r);
  ctx.arcTo(bx + bs, by + bs, bx + bs - r, by + bs, r);
  ctx.lineTo(bx + r, by + bs);
  ctx.arcTo(bx, by + bs, bx, by + bs - r, r);
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();

  ctx.stroke();
  ctx.setLineDash([]);

  // Very faint fill
  ctx.fillStyle = `rgba(${colours.base.join(',')},0.08)`;
  ctx.fill();

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════════
   2 · GRID RENDERER
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Draws the background dot grid, hover highlight, and danger zone.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout  — { ox, oy, cellSize, cols, rows }
 * @param {object} opts    — { hoverCell:{x,y}|null, dangerRows:Set<number>, time:number }
 * @param {number[]} bgColor — [r,g,b] of --color-bg
 */
function drawGrid(ctx, layout, opts, bgColor) {
  const { ox, oy, cellSize, cols, rows } = layout;
  const { hoverCell, dangerRows, time }   = opts;

  // ── Board background ────────────────────────────────────────────────────
  const bw = cols * cellSize;
  const bh = rows * cellSize;
  ctx.fillStyle = `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`;
  ctx.fillRect(ox, oy, bw, bh);

  // ── Dot grid (1px dots at cell centres) ──────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = ox + c * cellSize + cellSize / 2;
      const cy = oy + r * cellSize + cellSize / 2;
      ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
    }
  }

  // ── Danger zone: rows near top pulse red at 0.5 opacity ─────────────────
  if (dangerRows && dangerRows.size > 0) {
    const pulse = 0.25 + 0.25 * Math.sin(time * 4);  // 0..0.5
    ctx.fillStyle = `rgba(255,0,85,${pulse})`;
    for (const row of dangerRows) {
      if (row < 0 || row >= rows) continue;
      ctx.fillRect(ox, oy + row * cellSize, bw, cellSize);
    }
  }

  // ── Hover highlight (puzzle mode) ───────────────────────────────────────
  if (hoverCell) {
    const hx = ox + hoverCell.x * cellSize;
    const hy = oy + hoverCell.y * cellSize;
    ctx.fillStyle = 'rgba(0,240,255,0.12)';
    ctx.fillRect(hx, hy, cellSize, cellSize);
    ctx.strokeStyle = 'rgba(0,240,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx + 0.5, hy + 0.5, cellSize - 1, cellSize - 1);
  }

  // ── Board border ────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, bw - 1, bh - 1);
}

/* ══════════════════════════════════════════════════════════════════════════════
   3 · PARTICLE SYSTEM  — object pool of 500
══════════════════════════════════════════════════════════════════════════════ */

/** Particle type constants */
const ParticleType = Object.freeze({
  SPARK : 0,
  STAR  : 1,
  RING  : 2,
  TRAIL : 3,
});

/**
 * Single particle instance.  Pooled — not garbage-collected between uses.
 * "alive" flag determines whether it's currently being simulated.
 */
class Particle {
  constructor() {
    this.alive    = false;
    this.x        = 0;
    this.y        = 0;
    this.vx       = 0;
    this.vy       = 0;
    this.life     = 0;
    this.maxLife  = 1;
    this.color    = [255, 255, 255];
    this.size     = 2;
    this.type     = ParticleType.SPARK;
    this._drag    = 0.98;
    this._gravity = 0;
  }

  /**
   * Resets and activates this particle.
   * @returns {Particle} this (for chaining)
   */
  spawn(x, y, vx, vy, life, color, size, type, drag = 0.98, gravity = 0) {
    this.alive    = true;
    this.x        = x;
    this.y        = y;
    this.vx       = vx;
    this.vy       = vy;
    this.life     = life;
    this.maxLife  = life;
    this.color    = color;
    this.size     = size;
    this.type     = type;
    this._drag    = drag;
    this._gravity = gravity;
    return this;
  }

  /** Advances simulation by dt milliseconds. */
  update(dt) {
    if (!this.alive) return;
    const sec = dt / 1000;
    this.vx *= this._drag;
    this.vy *= this._drag;
    this.vy += this._gravity * sec;
    this.x  += this.vx * sec;
    this.y  += this.vy * sec;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  /** Returns normalised age 0..1 (0 = just born, 1 = dead). */
  get age() {
    return 1 - (this.life / this.maxLife);
  }

  /** Returns opacity based on remaining life. */
  get opacity() {
    return Math.max(0, this.life / this.maxLife);
  }
}

/**
 * High-performance particle system with a fixed object pool.
 * Avoids GC pressure by reusing Particle instances.
 */
class ParticleSystem {
  /**
   * @param {number} [poolSize=500]  Maximum simultaneous particles
   */
  constructor(poolSize = 500) {
    /** @private */ this._pool = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) {
      this._pool[i] = new Particle();
    }
    /** @private */ this._cursor = 0;  // ring-buffer cursor for O(1) allocation
    /** Active count (read-only, for stats) */
    this.activeCount = 0;
  }

  /**
   * Allocates a single particle from the pool.  O(1) — scans from cursor.
   * @returns {Particle|null}  null if the pool is fully saturated
   */
  _alloc() {
    const len = this._pool.length;
    for (let i = 0; i < len; i++) {
      const idx = (this._cursor + i) % len;
      if (!this._pool[idx].alive) {
        this._cursor = (idx + 1) % len;
        return this._pool[idx];
      }
    }
    return null; // pool exhausted — drop the particle
  }

  /**
   * Spawns a single particle with the given parameters.
   * @returns {Particle|null}
   */
  spawn(x, y, vx, vy, life, color, size, type, drag, gravity) {
    const p = this._alloc();
    if (!p) return null;
    return p.spawn(x, y, vx, vy, life, color, size, type, drag, gravity);
  }

  /**
   * Emits SPARK particles for a line clear — 30 per cell in the cleared row.
   *
   * @param {number} rowY    — pixel Y of the cleared row
   * @param {number} rowLeft — pixel X of the row's left edge
   * @param {number} cellSize
   * @param {number} cols    — number of columns
   * @param {number[][]} colours — array of [r,g,b] per cell (or a single colour)
   */
  emitLineClear(rowY, rowLeft, cellSize, cols, colours) {
    const count = 30;
    for (let c = 0; c < cols; c++) {
      const cx = rowLeft + c * cellSize + cellSize / 2;
      const cy = rowY + cellSize / 2;
      const col = Array.isArray(colours[0]) ? (colours[c] ?? colours[0]) : colours;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 200;
        this.spawn(
          cx, cy,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 40,
          300 + Math.random() * 400,         // life ms
          col,
          1.5 + Math.random() * 3,           // size
          ParticleType.SPARK,
          0.96,                               // drag
          120,                                // gravity px/s²
        );
      }
    }
  }

  /**
   * Emits a STAR burst for combo x3+ — 20 particles, radial spread.
   *
   * @param {number} cx  — centre X (pixels)
   * @param {number} cy  — centre Y (pixels)
   * @param {number[][]} colour — [r,g,b]
   * @param {number} [count=20]
   */
  emitComboStar(cx, cy, colour, count = 20) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
      const speed = 80 + Math.random() * 160;
      this.spawn(
        cx, cy,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        500 + Math.random() * 500,
        colour,
        2 + Math.random() * 4,
        ParticleType.STAR,
        0.94,
        30,
      );
    }
  }

  /**
   * Emits a RING ripple from the board centre expanding outward (game over).
   *
   * @param {number} cx
   * @param {number} cy
   * @param {number[][]} colour
   * @param {number} [count=40]
   */
  emitGameOverRing(cx, cy, colour, count = 40) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i;
      const speed = 30 + Math.random() * 60;
      this.spawn(
        cx, cy,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        800 + Math.random() * 600,
        colour,
        3 + Math.random() * 5,
        ParticleType.RING,
        0.99,   // very low drag — ring expands
        0,      // no gravity
      );
    }
  }

  /**
   * Emits TRAIL particles behind a moving piece (optional, for Rush mode).
   *
   * @param {number} x
   * @param {number} y
   * @param {number[][]} colour
   */
  emitTrail(x, y, colour) {
    this.spawn(
      x + Math.random() * 8 - 4,
      y + Math.random() * 8 - 4,
      (Math.random() - 0.5) * 20,
      -10 - Math.random() * 30,
      200 + Math.random() * 200,
      colour,
      1 + Math.random() * 2,
      ParticleType.TRAIL,
      0.95,
      20,
    );
  }

  /**
   * Updates all alive particles.
   * @param {number} dt  — milliseconds
   */
  update(dt) {
    let count = 0;
    for (let i = 0; i < this._pool.length; i++) {
      const p = this._pool[i];
      if (!p.alive) continue;
      p.update(dt);
      if (p.alive) count++;
    }
    this.activeCount = count;
  }

  /**
   * Renders all alive particles.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    for (let i = 0; i < this._pool.length; i++) {
      const p = this._pool[i];
      if (!p.alive) continue;

      const alpha = p.opacity;
      const [r, g, b] = p.color;
      const age = p.age;

      ctx.save();
      ctx.globalAlpha = alpha;

      switch (p.type) {
        case ParticleType.SPARK: {
          // Small bright dot with glow
          const sz = p.size * (1 - age * 0.5);
          ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
          ctx.shadowBlur  = sz * 2;
          ctx.fillStyle   = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, sz), 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        case ParticleType.STAR: {
          // 4-pointed star shape, rotates with age
          const sz = p.size * (1 - age * 0.3);
          const rot = age * Math.PI * 2;
          ctx.translate(p.x, p.y);
          ctx.rotate(rot);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
          ctx.shadowBlur  = sz * 3;
          ctx.beginPath();
          for (let j = 0; j < 4; j++) {
            const a  = (Math.PI / 2) * j;
            const ox = Math.cos(a) * sz;
            const oy = Math.sin(a) * sz;
            const ia = a + Math.PI / 4;
            const ix = Math.cos(ia) * sz * 0.35;
            const iy = Math.sin(ia) * sz * 0.35;
            if (j === 0) ctx.moveTo(ox, oy);
            else ctx.lineTo(ox, oy);
            ctx.lineTo(ix, iy);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }

        case ParticleType.RING: {
          // Expanding ring (stroke only)
          const radius = (1 - alpha) * 60 + 4;
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth   = Math.max(0.5, 2 * alpha);
          ctx.shadowColor = `rgba(${r},${g},${b},0.5)`;
          ctx.shadowBlur  = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        case ParticleType.TRAIL: {
          // Fading dot, no glow (cheap)
          const sz = p.size * alpha;
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.7})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, sz), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }

      ctx.restore();
    }
  }

  /** Kills all particles instantly. */
  clear() {
    for (let i = 0; i < this._pool.length; i++) {
      this._pool[i].alive = false;
    }
    this.activeCount = 0;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   4 · VISUAL FX  — screen shake, flash overlay, NEXUS logo
══════════════════════════════════════════════════════════════════════════════ */

class VisualFX {
  constructor() {
    // ── Screen shake ──────────────────────────────────────────────────────
    this._shakeOffsetX   = 0;
    this._shakeOffsetY   = 0;
    this._shakeRemaining = 0;
    this._shakeIntensity = 4;    // ±4px
    this._shakeDuration  = 200;  // ms

    // ── Flash overlay ─────────────────────────────────────────────────────
    this._flashAlpha     = 0;
    this._flashDecay     = 0;    // alpha per ms

    // ── Locked-cell flash queue ───────────────────────────────────────────
    // Array of { x, y, colorIndex, startTime, duration }
    this._lockFlashes   = [];
  }

  /**
   * Triggers a screen shake (±4px for 200ms).
   * @param {number} [intensity=4]
   * @param {number} [duration=200]
   */
  shake(intensity = 4, duration = 200) {
    this._shakeIntensity = intensity;
    this._shakeDuration  = duration;
    this._shakeRemaining = duration;
  }

  /**
   * Triggers a white flash overlay that decays over the given duration.
   * @param {number} [alpha=0.3]    — peak opacity
   * @param {number} [duration=150]  — ms to fully fade
   */
  flash(alpha = 0.3, duration = 150) {
    this._flashAlpha = alpha;
    this._flashDecay = alpha / duration;  // alpha per ms
  }

  /**
   * Queues a locked-cell flash animation (white flash then back, 2 frames ≈ 33ms).
   * @param {number} x       — grid column
   * @param {number} y       — grid row
   * @param {number} colorIndex
   */
  queueLockFlash(x, y, colorIndex) {
    this._lockFlashes.push({ x, y, colorIndex, elapsed: 0, duration: 66 });
  }

  /**
   * Updates FX state.
   * @param {number} dt  — ms
   */
  update(dt) {
    // Shake
    if (this._shakeRemaining > 0) {
      this._shakeRemaining -= dt;
      const t = Math.max(0, this._shakeRemaining / this._shakeDuration);
      const amp = this._shakeIntensity * t;
      this._shakeOffsetX = (Math.random() * 2 - 1) * amp;
      this._shakeOffsetY = (Math.random() * 2 - 1) * amp;
    } else {
      this._shakeOffsetX = 0;
      this._shakeOffsetY = 0;
    }

    // Flash
    if (this._flashAlpha > 0) {
      this._flashAlpha -= this._flashDecay * dt;
      if (this._flashAlpha < 0) this._flashAlpha = 0;
    }

    // Lock flashes
    for (let i = this._lockFlashes.length - 1; i >= 0; i--) {
      this._lockFlashes[i].elapsed += dt;
      if (this._lockFlashes[i].elapsed >= this._lockFlashes[i].duration) {
        this._lockFlashes.splice(i, 1);
      }
    }
  }

  /**
   * Returns the current shake translation { x, y } for canvas transform.
   * @returns {{ x: number, y: number }}
   */
  get shakeOffset() {
    return { x: this._shakeOffsetX, y: this._shakeOffsetY };
  }

  /**
   * Draws the flash overlay (if active).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w  — canvas width
   * @param {number} h  — canvas height
   */
  drawFlash(ctx, w, h) {
    if (this._flashAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this._flashAlpha;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * Returns the flash-white blend value (0..1) for a cell currently
   * undergoing a lock-flash animation, or 0 if none.
   *
   * @param {number} x  — grid column
   * @param {number} y  — grid row
   * @returns {number}   0 = no flash, 0..1 = white blend factor
   */
  getLockFlashValue(x, y) {
    for (const f of this._lockFlashes) {
      if (f.x === x && f.y === y) {
        const t = f.elapsed / f.duration;
        // Quick flash to white then back: 0→1 in first half, 1→0 in second half
        return t < 0.5 ? t * 2 : (1 - t) * 2;
      }
    }
    return 0;
  }

  /**
   * Draws the "NEXUS" logo text with canvas fillText + custom glow (shadowBlur).
   * Used on the game-over canvas overlay or as a watermark.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx  — centre X
   * @param {number} cy  — centre Y
   * @param {number[][]} primaryColour — [r,g,b] of --color-primary
   * @param {number[][]} secondaryColour — [r,g,b] of --color-secondary
   */
  drawNexusLogo(ctx, cx, cy, primaryColour, secondaryColour) {
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // "NEXUS" — large, with primary glow
    ctx.font         = 'bold 48px Outfit, sans-serif';
    ctx.shadowColor  = `rgba(${primaryColour[0]},${primaryColour[1]},${primaryColour[2]},0.7)`;
    ctx.shadowBlur   = 24;
    ctx.fillStyle    = `rgb(${secondaryColour[0]},${secondaryColour[1]},${secondaryColour[2]})`;
    ctx.fillText('NEXUS', cx, cy - 14);

    // "BLOCKS" — smaller, with secondary glow
    ctx.font         = 'bold 22px Outfit, sans-serif';
    ctx.shadowColor  = `rgba(${secondaryColour[0]},${secondaryColour[1]},${secondaryColour[2]},0.5)`;
    ctx.shadowBlur   = 16;
    ctx.fillStyle    = `rgb(${primaryColour[0]},${primaryColour[1]},${primaryColour[2]})`;
    ctx.letterSpacing = '8px';  // may not be supported everywhere
    ctx.fillText('B L O C K S', cx, cy + 22);

    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   5 · ANIMATION TIMELINE  — queue-based, parallel + sequential, tweens
══════════════════════════════════════════════════════════════════════════════ */

/**
 * A single animation entry in the timeline.
 * Wraps a Tween with metadata for sequencing.
 *
 * @typedef {object} AnimEntry
 * @property {string}   id         — unique identifier (for cancellation)
 * @property {Tween}    tween      — the underlying Tween
 * @property {Function} setter     — called each frame with tween.value
 * @property {string}   [group]    — optional group for parallel/sequential control
 * @property {boolean}  sequential — if true, starts after the previous entry in the same group finishes
 * @property {boolean}  started    — has this entry been started yet
 */

class AnimationTimeline {
  constructor() {
    /** @private @type {AnimEntry[]} */
    this._entries = [];
    /** @private @type {Map<string, number>} — group → last end time (ms) for sequential chaining */
    this._groupEnd = new Map();
    /** @private @type {number} — global elapsed ms */
    this._elapsed = 0;
  }

  /**
   * Adds an animation to the timeline.
   *
   * @param {object} opts
   * @param {string}   opts.id          — unique ID (for later removal)
   * @param {number}   opts.from        — start value
   * @param {number}   opts.to          — end value
   * @param {number}   opts.durationMs  — duration
   * @param {Function} opts.setter      — called with the current value each frame
   * @param {Function} [opts.easing]    — easing function (default: linear)
   * @param {string}   [opts.group]     — group name for parallel/sequential control
   * @param {boolean}  [opts.sequential=false] — if true, starts after previous entry in group finishes
   * @param {Function} [opts.onComplete]
   * @returns {AnimationTimeline} this (for chaining)
   */
  add(opts) {
    const {
      id, from, to, durationMs, setter,
      easing   = Easing.linear,
      group    = null,
      sequential = false,
      onComplete = null,
    } = opts;

    // Calculate start delay for sequential animations
    let delayMs = 0;
    if (sequential && group && this._groupEnd.has(group)) {
      delayMs = Math.max(0, this._groupEnd.get(group) - this._elapsed);
    }

    const totalMs = delayMs + durationMs;

    const tween = new Tween({
      from,
      to,
      durationMs,
      easing,
      onComplete,
    });

    const entry = {
      id,
      tween,
      setter,
      group,
      sequential,
      started: false,
      delayMs,
      _startAt: this._elapsed + delayMs,
    };

    this._entries.push(entry);

    // Track group end time for sequential chaining
    if (group) {
      const currentEnd = this._groupEnd.get(group) ?? 0;
      const newEnd = this._elapsed + totalMs;
      this._groupEnd.set(group, Math.max(currentEnd, newEnd));
    }

    return this;
  }

  /**
   * Convenience: adds multiple animations that run in parallel.
   * All entries share the same group; sequential is false.
   *
   * @param {AnimEntry[]} entries  — array of add() opts objects
   * @param {string} [group]       — optional group name
   * @returns {AnimationTimeline} this
   */
  parallel(entries, group) {
    for (const e of entries) {
      this.add({ ...e, group: group ?? e.group, sequential: false });
    }
    return this;
  }

  /**
   * Convenience: adds multiple animations that run sequentially.
   * Each entry starts after the previous one in the group finishes.
   *
   * @param {AnimEntry[]} entries
   * @param {string} group — required group name
   * @returns {AnimationTimeline} this
   */
  sequential(entries, group) {
    for (const e of entries) {
      this.add({ ...e, group, sequential: true });
    }
    return this;
  }

  /**
   * Removes an animation by ID.
   * @param {string} id
   */
  remove(id) {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx !== -1) this._entries.splice(idx, 1);
  }

  /**
   * Removes all animations in a group.
   * @param {string} group
   */
  removeGroup(group) {
    this._entries = this._entries.filter(e => e.group !== group);
    this._groupEnd.delete(group);
  }

  /**
   * Removes all animations.
   */
  clear() {
    this._entries.length = 0;
    this._groupEnd.clear();
  }

  /**
   * Advances the timeline by dt milliseconds.
   * @param {number} dt — ms
   */
  update(dt) {
    this._elapsed += dt;

    for (let i = this._entries.length - 1; i >= 0; i--) {
      const entry = this._entries[i];

      // Not yet time to start?
      if (this._elapsed < entry._startAt) continue;

      // Start the tween on the first eligible frame
      if (!entry.started) {
        entry.started = true;
        entry.tween.start();
      }

      entry.tween.update(dt);
      entry.setter(entry.tween.value);

      // Remove completed entries
      if (entry.tween.isDone) {
        this._entries.splice(i, 1);
      }
    }
  }

  /** Returns the number of active entries. */
  get size() {
    return this._entries.length;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   6 · CANVAS RENDERER  — main orchestrator
══════════════════════════════════════════════════════════════════════════════ */

class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas   — the game-board canvas element
   * @param {Board}             board    — Board instance (getCell, setCell, clearLine)
   * @param {EventBus}          [bus]    — optional event bus for auto-wiring
   */
  constructor(canvas, board, bus = null) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.board  = board;
    this._bus   = bus;

    // ── Sub-systems ──────────────────────────────────────────────────────
    this.particles  = new ParticleSystem(500);
    this.fx         = new VisualFX();
    this.timeline   = new AnimationTimeline();

    // ── Colour cache ─────────────────────────────────────────────────────
    this._pieceColours = null;   // filled by init()
    this._brandColours = null;

    // ── Layout ───────────────────────────────────────────────────────────
    this._cellSize = 36;
    this._ox       = 0;         // board origin X (pixels)
    this._oy       = 0;         // board origin Y (pixels)
    this._cols     = board.width;
    this._rows     = board.height;

    // ── Ghost piece state ────────────────────────────────────────────────
    this._ghostCells     = null;  // [{x,y}]
    this._ghostOx        = 0;
    this._ghostOy        = 0;
    this._ghostColorIdx  = 0;

    // ── Hover cell (puzzle mode) ─────────────────────────────────────────
    this._hoverCell = null;       // {x,y} | null

    // ── Danger rows ──────────────────────────────────────────────────────
    this._dangerRows = new Set();

    // ── Time accumulator ─────────────────────────────────────────────────
    this._time = 0;

    // ── Line-clear animation queue ───────────────────────────────────────
    // Array of { y, startTime, duration, colours[] }
    this._clearAnims = [];

    // ── Event bus subscriptions ──────────────────────────────────────────
    this._unsubs = [];
  }

  /* ── Initialisation ────────────────────────────────────────────────────── */

  /**
   * Reads CSS colours, sets up event listeners, and performs first resize.
   * Must be called after DOM is ready and CSS is loaded.
   */
  init() {
    this._pieceColours = readPieceColoursFromCSS();
    this._brandColours = readBrandColoursFromCSS();
    this.resize();
    this._bindBus();
  }

  /**
   * Recalculates layout to fill the canvas.  Call on window resize.
   */
  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;

    // Canvas pixel dimensions (crisp on HiDPI)
    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width  = rect.width  + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute cell size to fit the board square within the available space
    const maxW = rect.width  - 8;   // 4px padding each side
    const maxH = rect.height - 8;
    this._cellSize = Math.floor(Math.min(maxW / this._cols, maxH / this._rows));
    this._cellSize = Math.max(12, this._cellSize);   // lower bound

    // Centre the board
    const bw = this._cols * this._cellSize;
    const bh = this._rows * this._cellSize;
    this._ox = Math.floor((rect.width  - bw) / 2);
    this._oy = Math.floor((rect.height - bh) / 2);
  }

  /* ── Event Bus Wiring ───────────────────────────────────────────────────── */

  _bindBus() {
    if (!this._bus) return;

    const on = (evt, fn) => {
      this._unsubs.push(this._bus.on(evt, fn.bind(this)));
    };

    on('line:cleared',     this._onLineCleared);
    on('column:cleared',   this._onColumnCleared);
    on('combo:triggered',  this._onComboTriggered);
    on('game:over',        this._onGameOver);
    on('piece:placed',     this._onPiecePlaced);
    on('board:reset',      this._onBoardReset);
  }

  /** Line cleared — emit SPARK particles + flash + shake */
  _onLineCleared({ y }) {
    const rowY    = this._oy + y * this._cellSize;
    const rowLeft = this._ox;

    // Collect colours from the board before clearLine wiped them
    // (NexusVisualManager calls clearLine AFTER the animation, but
    //  the Board already emitted the event with cells gone.
    //  We use the piece colour for the row instead.)
    const colours = this._brandColours.secondary;
    this.particles.emitLineClear(rowY, rowLeft, this._cellSize, this._cols, colours);

    // Queue a clear animation (row flashes then dissolves)
    this._clearAnims.push({
      type: 'row',
      index: y,
      elapsed: 0,
      duration: 400,
    });

    this.fx.flash(0.15, 120);
  }

  /** Column cleared — same as row but vertical */
  _onColumnCleared({ x }) {
    const colLeft = this._ox + x * this._cellSize;
    const colTop  = this._oy;

    const colours = this._brandColours.secondary;
    // Reuse line-clear emit but with vertical layout
    for (let r = 0; r < this._rows; r++) {
      const cx = colLeft + this._cellSize / 2;
      const cy = colTop  + r * this._cellSize + this._cellSize / 2;
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 120;
        this.particles.spawn(
          cx, cy,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 20,
          250 + Math.random() * 300,
          colours,
          1.5 + Math.random() * 2.5,
          ParticleType.SPARK,
          0.96, 80,
        );
      }
    }

    this._clearAnims.push({
      type: 'col',
      index: x,
      elapsed: 0,
      duration: 400,
    });

    this.fx.flash(0.10, 100);
  }

  /** Combo x3+ — emit STAR burst + screen shake */
  _onComboTriggered({ multiplier }) {
    if (multiplier >= 3) {
      const bw = this._cols * this._cellSize;
      const bh = this._rows * this._cellSize;
      const cx = this._ox + bw / 2;
      const cy = this._oy + bh / 2;
      this.particles.emitComboStar(cx, cy, this._brandColours.combo, 20);
      this.fx.shake(4, 200);
    }
  }

  /** Game over — emit RING ripple */
  _onGameOver() {
    const bw = this._cols * this._cellSize;
    const bh = this._rows * this._cellSize;
    const cx = this._ox + bw / 2;
    const cy = this._oy + bh / 2;
    this.particles.emitGameOverRing(cx, cy, this._brandColours.danger, 40);
  }

  /** Piece placed — queue lock-flash for each cell */
  _onPiecePlaced({ cells, colorIndex }) {
    for (const { x, y } of cells) {
      this.fx.queueLockFlash(x, y, colorIndex);
    }
  }

  /** Board reset — kill all particles and clear animations */
  _onBoardReset() {
    this.particles.clear();
    this._clearAnims.length = 0;
    this.fx._lockFlashes.length = 0;
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */

  /**
   * Sets the ghost piece to render.
   * @param {Array<{x:number,y:number}>} cells  — piece cell offsets
   * @param {number} ox       — board column offset
   * @param {number} oy       — board row offset
   * @param {number} colorIdx — 1–8
   */
  setGhost(cells, ox, oy, colorIdx) {
    this._ghostCells    = cells;
    this._ghostOx       = ox;
    this._ghostOy       = oy;
    this._ghostColorIdx = colorIdx;
  }

  /** Removes the ghost piece. */
  clearGhost() {
    this._ghostCells = null;
  }

  /**
   * Sets the hover cell highlight (puzzle mode).
   * @param {number} x  — grid column
   * @param {number} y  — grid row
   */
  setHoverCell(x, y) {
    this._hoverCell = { x, y };
  }

  /** Removes the hover highlight. */
  clearHover() {
    this._hoverCell = null;
  }

  /**
   * Sets which rows are in the "danger zone" (near top).
   * @param {number[]} rows
   */
  setDangerRows(rows) {
    this._dangerRows = new Set(rows);
  }

  /**
   * Manually triggers a line-clear particle burst + FX.
   * Useful when the renderer is not bus-wired.
   */
  emitLineClear(y) {
    this._onLineCleared({ y });
  }

  /**
   * Manually triggers a combo star burst + shake.
   */
  emitCombo(multiplier) {
    this._onComboTriggered({ multiplier });
  }

  /**
   * Manually triggers a game-over ring.
   */
  emitGameOver() {
    this._onGameOver();
  }

  /* ── Update / Render ─────────────────────────────────────────────────────── */

  /**
   * Advances all sub-systems by dt milliseconds.
   * Call this from the game loop's update() callback.
   *
   * @param {number} dt  — fixed timestep in ms
   */
  update(dt) {
    this._time += dt / 1000;

    this.particles.update(dt);
    this.fx.update(dt);
    this.timeline.update(dt);

    // Advance clear animations
    for (let i = this._clearAnims.length - 1; i >= 0; i--) {
      this._clearAnims[i].elapsed += dt;
      if (this._clearAnims[i].elapsed >= this._clearAnims[i].duration) {
        this._clearAnims.splice(i, 1);
      }
    }
  }

  /**
   * Renders the entire game board frame.
   * Call this from the game loop's render() callback.
   *
   * @param {number} _alpha  — interpolation factor [0..1] (unused for board;
   *                            particles use their own time-based alpha)
   */
  render(_alpha) {
    const ctx = this.ctx;
    const cs  = this._cellSize;
    const layout = {
      ox: this._ox,
      oy: this._oy,
      cellSize: cs,
      cols: this._cols,
      rows: this._rows,
    };

    // ── Clear canvas ──────────────────────────────────────────────────────
    const dpr = window.devicePixelRatio || 1;
    const cw  = this.canvas.width  / dpr;
    const ch  = this.canvas.height / dpr;
    ctx.clearRect(0, 0, cw, ch);

    // ── Apply screen shake ────────────────────────────────────────────────
    const shake = this.fx.shakeOffset;
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // ── Grid background ───────────────────────────────────────────────────
    drawGrid(ctx, layout, {
      hoverCell:   this._hoverCell,
      dangerRows:  this._dangerRows,
      time:        this._time,
    }, this._brandColours.bg);

    // ── Ghost piece ───────────────────────────────────────────────────────
    if (this._ghostCells) {
      const gColours = this._pieceColours[this._ghostColorIdx];
      if (gColours) {
        for (const { x, y } of this._ghostCells) {
          const bx = this._ghostOx + x;
          const by = this._ghostOy + y;
          if (bx >= 0 && bx < this._cols && by >= 0 && by < this._rows) {
            drawGhostBlock(ctx,
              this._ox + bx * cs,
              this._oy + by * cs,
              cs, gColours);
          }
        }
      }
    }

    // ── Board cells ────────────────────────────────────────────────────────
    // Build a set of cells currently in clear animations for dissolve effect
    const clearingCells = new Set();
    for (const anim of this._clearAnims) {
      if (anim.type === 'row') {
        for (let c = 0; c < this._cols; c++) clearingCells.add(`${c},${anim.index}`);
      } else {
        for (let r = 0; r < this._rows; r++) clearingCells.add(`${anim.index},${r}`);
      }
    }

    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        const colorIdx = this.board.getCell(c, r);
        if (colorIdx === 0) continue;

        const key = `${c},${r}`;
        const px  = this._ox + c * cs;
        const py  = this._oy + r * cs;

        // Is this cell being cleared?
        if (clearingCells.has(key)) {
          // Find the matching animation for dissolve progress
          let progress = 0;
          for (const anim of this._clearAnims) {
            const match = (anim.type === 'row' && anim.index === r) ||
                          (anim.type === 'col' && anim.index === c);
            if (match) {
              progress = Math.min(1, anim.elapsed / anim.duration);
              break;
            }
          }
          // Dissolve: flash white at start, then scale down + fade out
          const flashW  = progress < 0.2 ? progress / 0.2 : 0;
          const dissolve = progress >= 0.2 ? (progress - 0.2) / 0.8 : 0;
          const alpha   = 1 - dissolve;
          const scaleX  = 1 + dissolve * 0.5;
          const scaleY  = Math.max(0.05, 1 - dissolve * 0.9);

          ctx.save();
          ctx.translate(px + cs / 2, py + cs / 2);
          ctx.scale(scaleX, scaleY);
          ctx.translate(-(px + cs / 2), -(py + cs / 2));

          const colours = this._pieceColours[colorIdx];
          if (colours) drawBlock(ctx, px, py, cs, colours, alpha, flashW);

          ctx.restore();
        } else {
          // Normal cell — check for lock flash
          const flashW = this.fx.getLockFlashValue(c, r);
          const colours = this._pieceColours[colorIdx];
          if (colours) drawBlock(ctx, px, py, cs, colours, 1, flashW);
        }
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────
    this.particles.render(ctx);

    // ── Flash overlay ─────────────────────────────────────────────────────
    this.fx.drawFlash(ctx, cw, ch);

    ctx.restore(); // undo shake translate
  }

  /* ── Cleanup ─────────────────────────────────────────────────────────────── */

  /**
   * Removes all event bus subscriptions and clears resources.
   */
  destroy() {
    this._unsubs.forEach(u => u());
    this._unsubs.length = 0;
    this.particles.clear();
    this.timeline.clear();
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════════════════════ */

// Browser-global (primary usage pattern in this project)
if (typeof window !== 'undefined') {
  window.CanvasRenderer   = CanvasRenderer;
  window.ParticleSystem   = ParticleSystem;
  window.Particle         = Particle;
  window.ParticleType    = ParticleType;
  window.VisualFX        = VisualFX;
  window.AnimationTimeline = AnimationTimeline;
  window.drawBlock       = drawBlock;
  window.drawGhostBlock  = drawGhostBlock;
  window.drawGrid        = drawGrid;
}

// CommonJS (for unit tests / Node)
if (typeof module !== 'undefined') {
  module.exports = {
    CanvasRenderer,
    ParticleSystem,
    Particle,
    ParticleType,
    VisualFX,
    AnimationTimeline,
    drawBlock,
    drawGhostBlock,
    drawGrid,
  };
}
