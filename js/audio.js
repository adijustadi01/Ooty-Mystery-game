// Procedural ambience (no audio files): rain, wind, thunder and UI chimes via Web Audio.
export class Ambience {
  constructor() {
    this.ctx = null;
    this.bed = null;
    try { this.enabled = localStorage.getItem('ootyMysteries.sound') !== 'off'; } catch { this.enabled = true; }
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 3, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('ootyMysteries.sound', on ? 'on' : 'off'); } catch {}
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }

  start(weather) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    if (weather === 'rain') { filt.type = 'bandpass'; filt.frequency.value = 1400; filt.Q.value = 0.4; gain.gain.value = 0.22; }
    else { filt.type = 'lowpass'; filt.frequency.value = 380; gain.gain.value = 0.12; }
    src.connect(filt).connect(gain).connect(this.master);
    src.start();
    this.bed = { src, gain };
  }

  stop() {
    if (this.bed) { try { this.bed.src.stop(); } catch {} this.bed = null; }
  }

  thunder() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.4 + Math.random() * 1.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.4, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 3.3);
  }

  chime(kind = 'clue') {
    const ctx = this.ensure();
    if (!ctx) return;
    const notes = { clue: [660, 880], talk: [440], timeline: [523, 659, 784], win: [523, 659, 784, 1046], lose: [392, 311] }[kind] || [600];
    notes.forEach((n, i) => {
      const t = ctx.currentTime + i * 0.12;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = n;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.65);
    });
  }
}
