// audio.js — tiny WebAudio synth: UI blips, mission jingle, engine hum,
// crash thud. Everything is guarded: if audio is unavailable the game
// plays on silently.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.ready = false;
  }

  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.ready = true;
      // Engine hum: low sawtooth through a gain node, pitch follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start();
    } catch (e) {
      this.ready = false;
    }
  }

  tone(freq, dur, type, vol, when) {
    if (!this.ready) return;
    try {
      const t0 = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (e) {
      /* silent */
    }
  }

  blip() {
    this.tone(660, 0.09, 'sine', 0.1);
  }

  jingle() {
    this.tone(523, 0.14, 'triangle', 0.14, 0);
    this.tone(659, 0.14, 'triangle', 0.14, 0.13);
    this.tone(784, 0.22, 'triangle', 0.16, 0.26);
  }

  crash() {
    this.tone(70, 0.25, 'sawtooth', 0.2);
    this.tone(50, 0.3, 'square', 0.12, 0.02);
  }

  punch() {
    this.tone(120, 0.12, 'sine', 0.22);
    this.tone(90, 0.1, 'triangle', 0.15, 0.02);
  }

  shot() {
    this.tone(180, 0.1, 'square', 0.18);
    this.tone(60, 0.16, 'sawtooth', 0.2, 0.01);
  }

  dryFire() {
    this.tone(900, 0.05, 'square', 0.08);
  }

  reload() {
    this.tone(500, 0.06, 'square', 0.1, 0);
    this.tone(700, 0.06, 'square', 0.1, 0.12);
  }

  // speed01: 0..1. Call every frame while driving; 0 gain on foot.
  engine(speed01, driving) {
    if (!this.ready || !this.engineGain) return;
    try {
      const target = driving ? 0.05 + speed01 * 0.05 : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
      this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 90, this.ctx.currentTime, 0.1);
    } catch (e) {
      /* silent */
    }
  }
}
