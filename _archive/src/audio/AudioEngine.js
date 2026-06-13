/**
 * NEXUS BLOCKS — AudioEngine
 * Complete procedural Web Audio API engine. No audio files.
 */
'use strict';

class AudioEngine {
  static STORAGE_KEY = 'nexus_audio_settings';
  static UI_STORAGE_KEY = 'nexus_settings';

  static NOTE = Object.freeze({
    C2: 65.406, G2: 97.999, A2: 110.000, B2: 123.471,
    C3: 130.813, D3: 146.832, E3: 164.814, F3: 174.614, G3: 195.998,
    C4: 261.626, E4: 329.628, G4: 391.995, C5: 523.251,
  });

  constructor(bus = null, options = {}) {
    this.bus = bus;
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.reverb = null;
    this.reverbReturn = null;
    this.noiseBuffer = null;

    this.settings = this._loadSettings(options);
    this.score = 0;
    this.intensity = 0;
    this.tempo = 120;
    this.isMusicPlaying = false;
    this._schedulerId = null;
    this._lookAheadMs = 25;
    this._scheduleAheadSec = 0.12;
    this._nextStepTime = 0;
    this._stepIndex = 0;
    this._padIndex = 0;
    this._activePadNodes = [];
    this._unsubs = [];
    this._buttonHandler = null;
    this._lastGameOverAt = -Infinity;

    if (bus) this._bindEvents();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    this.ctx = new AudioContextCtor();
    this.masterGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.reverb = this.ctx.createConvolver();
    this.reverbReturn = this.ctx.createGain();

    this.reverb.buffer = this._createImpulseResponse(1.6, 2.6);
    this.reverbReturn.gain.value = 0.26;

    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.sfxGain);
    this.masterGain.connect(this.ctx.destination);

    this.noiseBuffer = this._createWhiteNoiseBuffer(1);
    this._applySettingsNow();
    this._bindButtonClicks();
  }

  unlock() {
    this.init();
  }

  destroy() {
    this.stopMusic(0);
    this._unsubs.forEach(unsub => unsub());
    this._unsubs = [];
    if (this._buttonHandler) {
      document.removeEventListener('click', this._buttonHandler, true);
      this._buttonHandler = null;
    }
    this.ctx?.close();
    this.ctx = null;
  }

  blockPlace() {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    this._routeSfx(gain, 0.12);

    osc.start(now);
    osc.stop(now + 0.09);
    this._vibrate(10);
  }

  lineClear() {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(gain);
    this._routeSfx(gain, 0.2);
    osc.start(now);
    osc.stop(now + 0.32);

    this._noiseBurst(now, 0.16, 2600, 0.18, 0.14);
    this._vibrate([50, 20, 50]);
  }

  combo(level = 1) {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;

    const now = this.ctx.currentTime;
    const sequence = [
      AudioEngine.NOTE.C4,
      AudioEngine.NOTE.E4,
      AudioEngine.NOTE.G4,
      AudioEngine.NOTE.C5,
    ];
    const root = sequence[Math.min(Math.max(level, 1), 4) - 1];
    const chord = [root, root * 1.25, root * 1.5];

    chord.forEach((freq, i) => {
      this._tone({
        freq,
        start: now + i * 0.025,
        duration: 0.22,
        type: 'sine',
        volume: 0.13 + level * 0.02,
        reverb: 0.18,
      });
    });

    if (level >= 3) {
      this._tone({
        freq: root * 2,
        start: now + 0.08,
        duration: 0.18,
        type: 'triangle',
        volume: 0.1,
        reverb: 0.24,
      });
    }

    this._vibrate([30, 10, 30, 10, 80]);
  }

  gameOver() {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;
    const guardNow = performance.now();
    if (guardNow - this._lastGameOverAt < 500) return;
    this._lastGameOverAt = guardNow;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.8);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.8);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    osc.connect(filter);
    filter.connect(gain);
    this._routeSfx(gain, 0.72);

    osc.start(now);
    osc.stop(now + 0.84);
    this.stopMusic(0.2);
    this._vibrate([100, 50, 200]);
  }

  levelUp() {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;

    const now = this.ctx.currentTime;
    const notes = [AudioEngine.NOTE.C4, AudioEngine.NOTE.E4, AudioEngine.NOTE.G4];
    notes.forEach((freq, i) => {
      this._tone({
        freq,
        start: now + i * 0.13,
        duration: 0.18,
        type: 'triangle',
        volume: 0.2,
        reverb: 0.28,
      });
    });
  }

  buttonClick() {
    this._ensureRunning();
    if (!this._canPlaySfx()) return;

    const now = this.ctx.currentTime;
    this._tone({
      freq: 1000,
      start: now,
      duration: 0.04,
      type: 'square',
      volume: 0.08,
      attack: 0.002,
      reverb: 0.04,
    });
  }

  startMusic() {
    if (!this.ctx || this.isMusicPlaying) return;

    this.isMusicPlaying = true;
    this._nextStepTime = this.ctx.currentTime + 0.05;
    this._stepIndex = 0;
    this._padIndex = 0;
    this._fadeGain(this.musicGain.gain, this.settings.music ? this.settings.musicVolume : 0, 0.2);
    this._schedulerId = window.setInterval(() => this._musicScheduler(), this._lookAheadMs);
  }

  stopMusic(crossfadeSec = 0.2) {
    if (!this.ctx || !this.isMusicPlaying) return;
    this.isMusicPlaying = false;
    if (this._schedulerId !== null) {
      clearInterval(this._schedulerId);
      this._schedulerId = null;
    }
    this._fadeGain(this.musicGain.gain, 0, crossfadeSec);
    const stopAt = this.ctx.currentTime + crossfadeSec + 0.05;
    this._activePadNodes.forEach(({ osc }) => {
      try { osc.stop(stopAt); } catch {}
    });
    this._activePadNodes = [];
  }

  muteMusic() {
    this.settings.music = false;
    this._saveSettings();
    if (this.ctx) this._fadeGain(this.musicGain.gain, 0, 0.2);
  }

  unmuteMusic() {
    this.settings.music = true;
    this._saveSettings();
    if (this.ctx) this._fadeGain(this.musicGain.gain, this.settings.musicVolume, 0.2);
  }

  muteSfx() {
    this.settings.sfx = false;
    this._saveSettings();
    if (this.ctx) this._fadeGain(this.sfxGain.gain, 0, 0.08);
  }

  unmuteSfx() {
    this.settings.sfx = true;
    this._saveSettings();
    if (this.ctx) this._fadeGain(this.sfxGain.gain, this.settings.sfxVolume, 0.08);
  }

  setMasterVolume(value) {
    this.settings.masterVolume = this._clamp01(value);
    this._saveSettings();
    if (this.ctx) this._fadeGain(this.masterGain.gain, this.settings.masterVolume, 0.05);
  }

  setMusicVolume(value) {
    this.settings.musicVolume = this._clamp01(value);
    this._saveSettings();
    if (this.ctx && this.settings.music) this._fadeGain(this.musicGain.gain, this.settings.musicVolume, 0.05);
  }

  setSfxVolume(value) {
    this.settings.sfxVolume = this._clamp01(value);
    this._saveSettings();
    if (this.ctx && this.settings.sfx) this._fadeGain(this.sfxGain.gain, this.settings.sfxVolume, 0.05);
  }

  setScore(score) {
    this.score = Math.max(0, Number(score) || 0);
    this.intensity = Math.min(this.score / 50000, 1);
    this.tempo = 120 + this.intensity * 40;
  }

  tick(_dt) {}

  playGameMusic() { this.startMusic(); }
  stopGameMusic() { this.stopMusic(); }
  playMenuMusic() { this.startMusic(); }
  stopMenuMusic() { this.stopMusic(); }
  pauseMusic() {
    if (this.ctx) this._fadeGain(this.musicGain.gain, 0, 0.2);
  }
  resumeMusic() {
    if (this.ctx) this._fadeGain(this.musicGain.gain, this.settings.music ? this.settings.musicVolume : 0, 0.2);
  }
  playPlacement() { this.blockPlace(); }
  playLineClear() { this.lineClear(); }
  playCombo({ multiplier = 1 } = {}) { this.combo(multiplier); }
  playGameOver() { this.gameOver(); }
  playGameOverSfx() { this.gameOver(); }
  playResultsMusic() { this.levelUp(); }
  stopResultsMusic() {}

  _bindEvents() {
    const on = (event, fn) => this._unsubs.push(this.bus.on(event, fn.bind(this)));
    on('piece:placed', this.blockPlace);
    on('line:cleared', this.lineClear);
    on('column:cleared', this.lineClear);
    on('combo:triggered', ({ multiplier = 1 } = {}) => this.combo(multiplier));
    on('game:over', this.gameOver);
    on('level:up', this.levelUp);
    on('mode:started', this.startMusic);
    on('game:state', this._onGameState);
    on('score:updated', ({ score = 0 } = {}) => this.setScore(score));
    on('settings:changed', this._onSettingChanged);
  }

  _onGameState({ to } = {}) {
    if (to === 'PLAYING') this.startMusic();
    if (to === 'PAUSED') this.pauseMusic();
    if (to === 'MENU' || to === 'RESULTS' || to === 'GAME_OVER') this.stopMusic();
  }

  _onSettingChanged({ key, value } = {}) {
    if (key === 'music') value ? this.unmuteMusic() : this.muteMusic();
    if (key === 'sfx') value ? this.unmuteSfx() : this.muteSfx();
    if (key === 'haptics') {
      this.settings.haptics = !!value;
      this._saveSettings();
    }
    if (key === 'masterVolume') this.setMasterVolume(Number(value));
    if (key === 'musicVolume') this.setMusicVolume(Number(value));
    if (key === 'sfxVolume') this.setSfxVolume(Number(value));
  }

  _bindButtonClicks() {
    if (this._buttonHandler) return;
    this._buttonHandler = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      this.buttonClick();
    };
    document.addEventListener('click', this._buttonHandler, true);
  }

  _musicScheduler() {
    if (!this.ctx || !this.isMusicPlaying) return;
    while (this._nextStepTime < this.ctx.currentTime + this._scheduleAheadSec) {
      this._scheduleMusicStep(this._stepIndex, this._nextStepTime);
      const secondsPerBeat = 60 / this.tempo;
      this._nextStepTime += secondsPerBeat / 4;
      this._stepIndex = (this._stepIndex + 1) % 64;
    }
  }

  _scheduleMusicStep(step, time) {
    if (step % 64 === 0) this._schedulePadChord(time);

    const quarterStep = step % 16;
    if (quarterStep === 0 || quarterStep === 4 || quarterStep === 8 || quarterStep === 12) {
      const bassPattern = [AudioEngine.NOTE.C2, AudioEngine.NOTE.G2, AudioEngine.NOTE.C2, AudioEngine.NOTE.G2];
      this._scheduleBassNote(bassPattern[quarterStep / 4], time, 0.22);
    }

    if (this.intensity > 0.35 && (step % 8 === 2 || step % 8 === 6)) {
      const note = step % 16 < 8 ? AudioEngine.NOTE.G2 : AudioEngine.NOTE.C3;
      this._scheduleBassNote(note, time, 0.1, 0.045);
    }

    if (this.intensity > 0.68 && step % 4 === 1) {
      const arp = [AudioEngine.NOTE.C4, AudioEngine.NOTE.E4, AudioEngine.NOTE.G4, AudioEngine.NOTE.C5];
      this._scheduleMusicTone(arp[(step >> 2) % arp.length], time, 0.08, 'sine', 0.025);
    }
  }

  _scheduleBassNote(freq, start, duration, volume = 0.075) {
    this._scheduleMusicTone(freq, start, duration, 'triangle', volume, 0.006, 0.03);
  }

  _scheduleMusicTone(freq, start, duration, type, volume, attack = 0.01, release = 0.04) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + this.intensity * 1600, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(start);
    osc.stop(start + duration + release + 0.02);
  }

  _schedulePadChord(start) {
    const chords = [
      [AudioEngine.NOTE.C3, AudioEngine.NOTE.E3, AudioEngine.NOTE.G3],
      [AudioEngine.NOTE.A2, AudioEngine.NOTE.C3, AudioEngine.NOTE.E3],
      [AudioEngine.NOTE.F3, AudioEngine.NOTE.A2, AudioEngine.NOTE.C3],
      [AudioEngine.NOTE.G2, AudioEngine.NOTE.B2, AudioEngine.NOTE.D3],
    ];
    const chord = chords[this._padIndex % chords.length];
    this._padIndex++;

    const bars = 4;
    const secondsPerBeat = 60 / this.tempo;
    const duration = bars * 4 * secondsPerBeat;
    const target = 0.025 + this.intensity * 0.02;

    chord.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      osc.detune.setValueAtTime((i - 1) * 6, start);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(700 + this.intensity * 1200, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(target, start + 0.8);
      gain.gain.setValueAtTime(target, start + Math.max(1, duration - 1));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      osc.start(start);
      osc.stop(start + duration + 0.1);
      this._activePadNodes.push({ osc, gain });
    });

    this._activePadNodes = this._activePadNodes.filter(({ osc }) => {
      try { return osc.context.currentTime < start + duration + 0.1; } catch { return false; }
    });
  }

  _tone({
    freq,
    start,
    duration,
    type = 'sine',
    volume = 0.15,
    attack = 0.008,
    reverb = 0,
  }) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    this._routeSfx(gain, reverb);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  _noiseBurst(start, duration, cutoffHz, volume, reverb = 0) {
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    src.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(cutoffHz, start);
    filter.Q.setValueAtTime(0.8, start);

    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);
    this._routeSfx(gain, reverb);
    src.start(start, Math.random() * 0.5, duration);
  }

  _routeSfx(node, reverbAmount = 0) {
    node.connect(this.sfxGain);
    if (reverbAmount > 0 && this.reverb) {
      const send = this.ctx.createGain();
      send.gain.value = reverbAmount;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  _createImpulseResponse(durationSec, decay) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  _createWhiteNoiseBuffer(durationSec) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _ensureRunning() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  _canPlaySfx() {
    return !!this.ctx && this.settings.sfx && this.settings.sfxVolume > 0;
  }

  _vibrate(pattern) {
    if (!this.settings.haptics || !navigator.vibrate) return;
    navigator.vibrate(pattern);
  }

  _fadeGain(param, target, seconds) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
    param.linearRampToValueAtTime(Math.max(0, target), now + seconds);
  }

  _applySettingsNow() {
    if (!this.ctx) return;
    this.masterGain.gain.value = this.settings.masterVolume;
    this.musicGain.gain.value = this.settings.music ? this.settings.musicVolume : 0;
    this.sfxGain.gain.value = this.settings.sfx ? this.settings.sfxVolume : 0;
  }

  _loadSettings(options) {
    const defaults = {
      masterVolume: 0.75,
      musicVolume: 0.42,
      sfxVolume: 0.85,
      music: true,
      sfx: true,
      haptics: true,
    };
    const stored = this._readLocal(AudioEngine.STORAGE_KEY, {});
    const uiStored = this._readLocal(AudioEngine.UI_STORAGE_KEY, {});
    return {
      ...defaults,
      music: uiStored.music ?? stored.music ?? defaults.music,
      sfx: uiStored.sfx ?? stored.sfx ?? defaults.sfx,
      haptics: uiStored.haptics ?? stored.haptics ?? defaults.haptics,
      masterVolume: Number(uiStored.masterVolume ?? stored.masterVolume ?? defaults.masterVolume),
      musicVolume: Number(uiStored.musicVolume ?? stored.musicVolume ?? defaults.musicVolume),
      sfxVolume: Number(uiStored.sfxVolume ?? stored.sfxVolume ?? defaults.sfxVolume),
      ...options,
    };
  }

  _saveSettings() {
    this.settings.masterVolume = this._clamp01(this.settings.masterVolume);
    this.settings.musicVolume = this._clamp01(this.settings.musicVolume);
    this.settings.sfxVolume = this._clamp01(this.settings.sfxVolume);
    try { localStorage.setItem(AudioEngine.STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
  }

  _readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  _clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }
}

if (typeof window !== 'undefined') window.AudioEngine = AudioEngine;
if (typeof module !== 'undefined') module.exports = { AudioEngine };
