/**
 * NEXUS BLOCKS — SynthEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedural audio engine built entirely on the Web Audio API.
 * No audio files — every sound is synthesised from oscillators and noise.
 *
 * Subscribes to EventBus events and plays corresponding sounds.
 *
 * ── Sound Palette ───────────────────────────────────────────────────────────
 *   Piece placement   : short percussive "thud" (filtered noise + sine)
 *   Line clear        : rising arpeggio sweep (sine oscillator)
 *   Nexus link        : electric crackle (modulated sawtooth)
 *   Chain reaction    : cascading tones, pitch rises per step
 *   Combo             : brief triumphant chord
 *   Gravity shift     : whoosh (sine sweep + gain envelope)
 *   Game over         : descending minor chord
 *   Game music        : ambient pad drone (multiple detuned oscillators)
 */

'use strict';

class SynthEngine {
  /**
   * @param {EventBus} [bus]
   */
  constructor(bus = null) {
    this._bus     = bus;
    this._ctx     = null;   // AudioContext — created on first user gesture
    this._master  = null;   // Master GainNode
    this._music   = null;   // Music oscillator(s) currently playing
    this._muted   = false;
    this._volume  = 0.7;

    this._unsubs  = [];
    if (bus) this._bindEvents();
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  /**
   * Creates the AudioContext on the first user interaction.
   * Must be called from a user-gesture event handler.
   */
  init() {
    if (this._ctx) return;

    this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._volume;
    this._master.connect(this._ctx.destination);
  }

  // ── Volume ────────────────────────────────────────────────────────────────

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._master) this._master.gain.value = this._muted ? 0 : this._volume;
  }

  mute()   { this._muted = true;  if (this._master) this._master.gain.value = 0; }
  unmute() { this._muted = false; if (this._master) this._master.gain.value = this._volume; }

  tick(_dt) {
    // Reserved for future beat-sync logic
  }

  // ── Event Bindings ────────────────────────────────────────────────────────

  _bindEvents() {
    const on = (ev, fn) => this._unsubs.push(this._bus.on(ev, fn.bind(this)));
    on('piece:placed',         this.playPlacement);
    on('line:cleared',         this.playLineClear);
    on('column:cleared',       this.playLineClear);
    on('nexus:chain',          this.playNexusChain);
    on('combo:triggered',      this.playCombo);
    on('gravity:applied',      this.playGravityShift);
    on('game:over',            this.playGameOver);
    on('mode:started',         () => this.playGameMusic());
    on('loop:stopped',         () => this.stopGameMusic());
  }

  // ── Sound Primitives ──────────────────────────────────────────────────────

  /**
   * Plays a brief sine tone at the given frequency with an ADSR envelope.
   * @param {number} freq       Hz
   * @param {number} duration   seconds
   * @param {number} [volume=0.2]
   * @param {'sine'|'square'|'sawtooth'|'triangle'} [type='sine']
   */
  _tone(freq, duration, volume = 0.2, type = 'sine') {
    if (!this._ctx || this._muted) return;

    const osc  = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    const now  = this._ctx.currentTime;

    osc.type     = type;
    osc.frequency.setValueAtTime(freq, now);

    // Simple ADSR: short attack, brief sustain, quick release
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this._master);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /**
   * Plays a short filtered-noise burst (percussive thud).
   * @param {number} durationSec
   * @param {number} cutoffHz
   * @param {number} [volume=0.3]
   */
  _noise(durationSec, cutoffHz = 800, volume = 0.3) {
    if (!this._ctx || this._muted) return;

    const bufferSize = Math.floor(this._ctx.sampleRate * durationSec);
    const buffer     = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data       = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src    = this._ctx.createBufferSource();
    src.buffer   = buffer;

    const filter = this._ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = cutoffHz;

    const gain   = this._ctx.createGain();
    const now    = this._ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._master);

    src.start(now);
  }

  // ── Sound Effects ─────────────────────────────────────────────────────────

  playPlacement() {
    this._noise(0.08, 500, 0.2);
    this._tone(180, 0.05, 0.1, 'sine');
  }

  playLineClear() {
    // Rising arpeggio: four quick notes
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.15, 0.25, 'sine'), i * 60);
    });
  }

  playNexusChain({ chainLength = 1 } = {}) {
    // Electric crackle — frequency rises with chain length
    const baseFreq = 300 + chainLength * 200;
    this._tone(baseFreq, 0.3, 0.3, 'sawtooth');
    this._noise(0.2, 2000, 0.15);
  }

  playCombo({ multiplier = 1 } = {}) {
    // Triumphant chord — complexity scales with multiplier
    const root  = 440 * Math.pow(2, (multiplier - 1) / 12);
    this._tone(root,        0.4, 0.2, 'sine');
    this._tone(root * 1.25, 0.4, 0.15, 'sine');
    this._tone(root * 1.5,  0.4, 0.12, 'sine');
  }

  playGravityShift() {
    if (!this._ctx || this._muted) return;
    const osc  = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    const now  = this._ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.linearRampToValueAtTime(440, now + 0.5);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(this._master);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  playGameOver() {
    // Descending minor chord — D, F, A descending
    const notes = [293, 246, 196];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.6, 0.2, 'triangle'), i * 200);
    });
  }

  /**
   * Starts ambient background music: detuned oscillator pad drone.
   */
  playGameMusic() {
    if (!this._ctx || this._music) return;

    const freqs   = [55, 110, 165, 220];  // A1, A2, E3, A3
    this._music   = freqs.map(f => {
      const osc  = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f + (Math.random() - 0.5) * 2; // slight detune
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(this._master);
      osc.start();
      return { osc, gain };
    });
  }

  stopGameMusic() {
    if (!this._music) return;
    this._music.forEach(({ osc }) => { try { osc.stop(); } catch {} });
    this._music = null;
  }

  playMenuMusic()    { /* TODO: gentle ambient loop */ }
  stopMenuMusic()    { this.stopGameMusic(); }
  pauseMusic()       { if (this._ctx) this._ctx.suspend(); }
  resumeMusic()      { if (this._ctx) this._ctx.resume(); }
  playResultsMusic() { this._tone(880, 1.5, 0.2, 'sine'); }
  stopResultsMusic() {}
  playGameOverSfx()  { this.playGameOver(); }

  destroy() {
    this.stopGameMusic();
    this._unsubs.forEach(u => u());
    this._ctx?.close();
  }
}

if (typeof module !== 'undefined') module.exports = { SynthEngine };
