/**
 * tools/gen-icons.js — dependency-free PNG icon generator for Nexus Blocks.
 *
 * Renders an original brand mark (deep-space rounded tile + 2×2 cluster of
 * glossy coloured blocks) at every size the manifest/HTML reference, plus
 * maskable variants and an OG share image. Pure Node: a tiny PNG encoder on
 * top of the built-in `zlib`. No npm packages.
 *
 *   node tools/gen-icons.js      (run from the project root)
 */
'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');

/* ── PNG encoder ──────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                            // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                // 8-bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
                        chunk('IEND', Buffer.alloc(0))]);
}

/* ── tiny rasteriser (supersampled for anti-aliasing) ─────────────────────── */

const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const lerp = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h) {
  return { w, h, px: new Uint8ClampedArray(w * h * 4) };
}
function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h || a <= 0) return;
  const i = (y * cv.w + x) * 4, ia = 1 - a;
  cv.px[i]   = cv.px[i]   * ia + r * a;
  cv.px[i+1] = cv.px[i+1] * ia + g * a;
  cv.px[i+2] = cv.px[i+2] * ia + b * a;
  cv.px[i+3] = Math.max(cv.px[i+3], a * 255);
}
// rounded-rect signed test: inside => true
function inRR(px, py, x, y, w, h, r) {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  if (dx === 0 && dy === 0) {
    // corner check
    const cx = Math.min(Math.max(px, x + r), x + w - r);
    const cy = Math.min(Math.max(py, y + r), y + h - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r ||
           (px >= x + r && px <= x + w - r) || (py >= y + r && py <= y + h - r);
  }
  return false;
}

/** Vertical-gradient rounded rect with optional top gloss. */
function fillBlock(cv, x, y, w, h, r, topHex, midHex, botHex, gloss) {
  const [tr,tg,tb] = hex(topHex), [mr,mg,mb] = hex(midHex), [br,bg,bb] = hex(botHex);
  for (let py = Math.floor(y); py < y + h; py++) {
    const f = (py - y) / h;
    let cr, cg, cb;
    if (f < 0.5) { const t = f / 0.5; cr = lerp(tr,mr,t); cg = lerp(tg,mg,t); cb = lerp(tb,mb,t); }
    else { const t = (f - 0.5) / 0.5; cr = lerp(mr,br,t); cg = lerp(mg,bg,t); cb = lerp(mb,bb,t); }
    for (let px = Math.floor(x); px < x + w; px++) {
      if (inRR(px + 0.5, py + 0.5, x, y, w, h, r)) blend(cv, px, py, cr, cg, cb, 1);
    }
  }
  if (gloss) {
    const gx = x + w * 0.16, gy = y + h * 0.12, gw = w * 0.68, gh = h * 0.22, gr = r * 0.6;
    for (let py = Math.floor(gy); py < gy + gh; py++)
      for (let px = Math.floor(gx); px < gx + gw; px++)
        if (inRR(px + 0.5, py + 0.5, gx, gy, gw, gh, gr)) blend(cv, px, py, 255, 255, 255, 0.28);
  }
}

// 2×2 cluster colours (TL, TR, BL, BR) with light/base/shadow triplets.
const BLOCKS = [
  ['#D966FF','#B900FF','#5E0080'],   // violet
  ['#6AEEF6','#05D9E8','#006B73'],   // cyan
  ['#6BFFB7','#01FF89','#008044'],   // emerald
  ['#FFE066','#FFC600','#8A6B00'],   // amber
];

/** Render the brand mark into a w×h canvas (square unless OG). */
function renderMark(w, h, { maskable = false } = {}) {
  const SS = (Math.max(w, h) >= 512) ? 2 : 3;
  const cv = makeCanvas(w * SS, h * SS);
  const W = cv.w, H = cv.h;

  // background
  const bgR = maskable ? 0 : W * 0.22;
  const [t0,t1,t2] = hex('#161630'), [b0,b1,b2] = hex('#0A0A0F');
  for (let py = 0; py < H; py++) {
    const f = py / H, cr = lerp(t0,b0,f), cg = lerp(t1,b1,f), cb = lerp(t2,b2,f);
    for (let px = 0; px < W; px++)
      if (maskable || inRR(px + 0.5, py + 0.5, 0, 0, W, H, bgR)) blend(cv, px, py, cr, cg, cb, 1);
  }

  // 2×2 cluster, centred
  const frac = maskable ? 0.46 : 0.58;            // smaller in maskable safe zone
  const span = Math.min(W, H) * frac;
  const gap  = span * 0.07;
  const bs   = (span - gap) / 2;
  const ox = (W - span) / 2, oy = (H - span) / 2;
  const r  = bs * 0.24;
  const pos = [[0,0],[1,0],[0,1],[1,1]];
  pos.forEach(([gx,gy], i) => {
    const [lt,md,sh] = BLOCKS[i];
    fillBlock(cv, ox + gx * (bs + gap), oy + gy * (bs + gap), bs, bs, r, lt, md, sh, true);
  });

  // downsample SS→1 (box average)
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r2=0,g2=0,b2=0,a2=0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const i = ((y*SS+sy) * W + (x*SS+sx)) * 4;
      r2 += cv.px[i]; g2 += cv.px[i+1]; b2 += cv.px[i+2]; a2 += cv.px[i+3];
    }
    const n = SS*SS, o = (y*w+x)*4;
    out[o]=r2/n; out[o+1]=g2/n; out[o+2]=b2/n; out[o+3]=a2/n;
  }
  return out;
}

function write(name, w, h, opts) {
  const rgba = renderMark(w, h, opts);
  fs.writeFileSync(path.join(OUT, name), encodePNG(w, h, rgba));
  console.log('  ✓', name, `${w}×${h}`);
}

/* ── generate everything the app references ───────────────────────────────── */

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
console.log('Generating icons →', OUT);

[16,32,48,72,96,128,144,152,180,192,512].forEach(s => write(`icon-${s}.png`, s, s));
write('maskable-192.png', 192, 192, { maskable: true });
write('maskable-512.png', 512, 512, { maskable: true });
write('og-image.png', 1200, 630);

console.log('Done.');
