// audio.js — every sound is generated in code with WebAudio: no audio files,
// no network. Gunshots fall off with distance; a quiet desert-wind loop keeps
// the game from ever being silent. All nodes are created on demand and
// released; nothing allocates in the hot loop beyond one short buffer per shot.

export class AudioBank {
  constructor() {
    this.ctx = null; this.master = null; this.ambient = null;
    this.enabled = false;
  }
  // Call from the first user gesture (the Play button). Browsers block audio
  // until the user interacts, so creating the context earlier is pointless.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
      this.startAmbient();
    } catch (e) { this.enabled = false; }
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // --- primitives ---------------------------------------------------------
  // A burst of filtered noise (the body of a gunshot / explosion).
  noiseBurst(t, dur, filterFreq, gainVal, type = 'lowpass') {
    if (!this.enabled) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  // A short pitched blip (hit markers, beeps, UI).
  blip(t, freq, dur, gainVal, type = 'sine', slideTo = 0) {
    if (!this.enabled) return;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // Distance falloff: full volume under 8 m, fading to ~8% at 60 m.
  falloff(dist) {
    if (dist <= 8) return 1;
    const v = 1 - (dist - 8) / 52;
    return Math.max(0.08, v * v);
  }

  // --- game sounds ----------------------------------------------------------
  shot(weaponId, dist, isEnemy) {
    if (!this.enabled) return;
    const t = this.now(), v = this.falloff(dist) * (isEnemy ? 0.8 : 1);
    if (weaponId === 'breacher') { this.noiseBurst(t, 0.22, 900, 0.9 * v); this.blip(t, 90, 0.12, 0.5 * v, 'square', 45); }
    else if (weaponId === 'longshot') { this.noiseBurst(t, 0.3, 2400, 0.85 * v, 'bandpass'); this.blip(t, 220, 0.18, 0.4 * v, 'sawtooth', 60); }
    else if (weaponId === 'p9') { this.noiseBurst(t, 0.1, 1800, 0.6 * v); this.blip(t, 180, 0.07, 0.35 * v, 'square', 90); }
    else { this.noiseBurst(t, 0.14, 1500, 0.75 * v); this.blip(t, 150, 0.09, 0.4 * v, 'sawtooth', 70); }
  }
  dryFire() { this.blip(this.now(), 1400, 0.04, 0.25, 'square'); }
  reload() {
    const t = this.now();
    this.blip(t, 900, 0.05, 0.3, 'square'); this.blip(t + 0.35, 700, 0.05, 0.3, 'square');
    this.blip(t + 0.7, 1100, 0.06, 0.35, 'square');
  }
  hit(head) {
    const t = this.now();
    this.blip(t, head ? 1500 : 1100, 0.07, 0.4, 'sine');
    if (head) this.blip(t + 0.07, 1900, 0.08, 0.35, 'sine');
  }
  kill() { const t = this.now(); this.blip(t, 660, 0.1, 0.4, 'sine'); this.blip(t + 0.1, 990, 0.14, 0.4, 'sine'); }
  hurt() { const t = this.now(); this.noiseBurst(t, 0.12, 500, 0.5); this.blip(t, 120, 0.15, 0.4, 'sawtooth', 60); }
  beep(final) { const t = this.now(); this.blip(t, final ? 1500 : 1100, 0.09, 0.45, 'sine'); }
  plant() { const t = this.now(); this.blip(t, 500, 0.1, 0.35, 'square'); this.blip(t + 0.15, 750, 0.12, 0.35, 'square'); }
  explosion(dist) {
    const t = this.now(), v = this.falloff(dist);
    this.noiseBurst(t, 1.1, 300, 1.0 * v); this.blip(t, 60, 0.9, 0.7 * v, 'sine', 30);
  }
  flashbang() { const t = this.now(); this.blip(t, 2400, 0.9, 0.3, 'sine', 2400); this.noiseBurst(t, 0.3, 5000, 0.4, 'highpass'); }
  buy() { const t = this.now(); this.blip(t, 880, 0.08, 0.35, 'sine'); this.blip(t + 0.09, 1320, 0.1, 0.35, 'sine'); }
  denied() { const t = this.now(); this.blip(t, 220, 0.12, 0.35, 'square'); }
  roundWin() {
    const t = this.now();
    [523, 659, 784, 1046].forEach((f, i) => this.blip(t + i * 0.12, f, 0.18, 0.35, 'triangle'));
  }
  roundLose() {
    const t = this.now();
    [392, 330, 262, 196].forEach((f, i) => this.blip(t + i * 0.13, f, 0.2, 0.32, 'triangle'));
  }
  // Quiet desert wind: looped filtered noise, slowly breathing. Never silent.
  startAmbient() {
    if (!this.enabled || this.ambient) return;
    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.ambient = src;
  }
}
