// Musical elements: which instrument groups are playing, when they ENTER, EXIT or CHANGE (a new pattern or sound),
// when a new PHRASE starts, and the stereo field (width = how much of a group is in the sides, pan = left/right).
// Fed by the AudioEngine every frame; events go out through engine.emit:
//   "element" { group, type: "enter" | "exit" | "change", width, pan }
//   "motif"   { group, vec }       - every 2 bars, the fingerprint of each playing group (for the memory)
//   "phrase"  { reasons }            - several things changed at once on a phrase boundary
//   "stereo"  { type: "widen" | "collapse", width }
//   "predrop" { width }             - the mix collapses to mono during a breakdown/build: the drop is coming
// state: engine.state.elements[group] = { on, level, width, pan, hit (attack right now) },  engine.state.stereo = { width, pan }

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ema = (prev, x, dt, tau) => prev + (x - prev) * (1 - Math.exp(-dt / tau));

// groups by frequency + character (kick/bass mostly mono, pads wide, hats often panned)
export const GROUPS = {
  kick: { lo: 40, hi: 120 },     // from the engine's kick detection
  bass: { lo: 50, hi: 250 },     // low end BETWEEN the kicks (rolling basslines sit on the offbeats)
  pads: { lo: 300, hi: 1200 },   // loud but sustained
  lead: { lo: 1200, hi: 5000 },  // loud and moving (melodies, vocals, stabs)
  hats: { lo: 5000, hi: 16000 }, // moving (hats, shakers, percussion, air)
};

export class ElementTracker {
  constructor(engine) {
    this.e = engine;
    const binHz = engine.ctx.sampleRate / engine.st.mid.fftSize;
    this.st = Object.fromEntries(Object.entries(engine.st).map(([k, a]) => [k, new Float32Array(a.frequencyBinCount)]));
    this.g = {};
    for (const [name, r] of Object.entries(GROUPS)) {
      this.g[name] = {
        bins: [Math.max(1, Math.floor(r.lo / binHz)), Math.ceil(r.hi / binHz)],
        bands: engine.nb.map((b, i) => ({ i, c: Math.sqrt(b.lo * b.hi) })).filter((b) => b.c >= r.lo && b.c < r.hi).map((b) => b.i),
      };
    }
    this.reset();
  }

  reset() {
    for (const g of Object.values(this.g)) {
      Object.assign(g, { p: 0, on: false, overFor: 0, underFor: 0, width: 0, pan: 0, offbeat: 0,
        hiRef: 0, loRef: 1, onMax: 0, offSum: 0, offN: 0, kscore: 1, lastBeat: -1,
        envF: 0, envS: 0, trans: 0, sustain: 0.5, noise: 0, tdPeak: -60, envMin: Infinity, envSum: 0, envN: 0, sBeat: -1,
        fp: null, steps: new Float32Array(16), cnt: new Float32Array(16), shape: null, prev: null, wasOn: false });
      g.shape = new Float32Array(g.bands.length);
    }
    this.width = 0; this.pan = 0; this.wHist = []; this.lastW = -1; this.lastStereo = -Infinity;
    this.lastBoundary = -1; this.recent = []; this.lastPhrase = -1;
    this.e.state.elements = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, { on: false, level: 0, width: 0, pan: 0,
      trans: 0, sustain: 0, noise: 0, hit: 0 }]));
    this.e.state.stereo = { width: 0, pan: 0 };
  }

  _power(arr, [a, b]) {
    let p = 0;
    for (let i = a; i <= Math.min(b, arr.length - 1); i++) p += Math.pow(10, (Number.isFinite(arr[i]) ? arr[i] : -160) / 10);
    return p;
  }

  update(t, dt) {
    const e = this.e, s = e.state;
    if (s.section === "silence") return;
    for (const [k, a] of Object.entries(e.st)) a.getFloatFrequencyData(this.st[k]);
    this.wave = this.wave || new Float32Array(e.td.kick.fftSize);
    const beat = s.bpm > 0 ? 60 / s.bpm : 0.5;
    const avg = (arr, idx) => (idx.length ? idx.reduce((x, i) => x + arr[i], 0) / idx.length : 0);
    const offbeat = s.beatPhase > 0.35 && s.beatPhase < 0.85;

    for (const [name, g] of Object.entries(this.g)) {
      // ---- stereo per group
      const mid = this._power(this.st.mid, g.bins), side = this._power(this.st.side, g.bins);
      const L = this._power(this.st.left, g.bins), R = this._power(this.st.right, g.bins);
      g.width = ema(g.width, side / (mid + side + 1e-12), dt, 0.5);
      g.pan = ema(g.pan, (R - L) / (R + L + 1e-12), dt, 0.5);
      // ---- time domain: this group's own band-filtered waveform
      e.td[name].getFloatTimeDomainData(this.wave);
      let sq = 0, pk = 0, zc = 0;
      for (let i = 0; i < this.wave.length; i++) {
        const v = this.wave[i]; sq += v * v; pk = Math.max(pk, Math.abs(v));
        if (i && (v >= 0) !== (this.wave[i - 1] >= 0)) zc++;
      }
      const rms = Math.sqrt(sq / this.wave.length);
      g.envF = ema(g.envF, rms, dt, 0.015);                       // follows every hit
      g.envS = ema(g.envS, rms, dt, 0.25);                        // the average level
      const hit = clamp((g.envF / (g.envS + 1e-9) - 1.15) / 1.5);  // a sharp attack right now
      g.trans = ema(g.trans, hit, dt, 1.0);                       // transient-ness: sharp hits vs soft swells
      g.noise = ema(g.noise, clamp(zc / this.wave.length * 6), dt, 0.5);   // noisiness (hats/shakers) vs tonal
      // sustain: does the sound hold between hits (pads, bass) or drop away (percussion)? measured per beat
      g.envMin = Math.min(g.envMin, g.envF); g.envSum += g.envF; g.envN++;
      if (s.beatCount !== g.sBeat) {
        if (g.envN) g.sustain = 0.6 * g.sustain + 0.4 * clamp(g.envMin / (g.envSum / g.envN + 1e-9));
        g.sBeat = s.beatCount; g.envMin = Infinity; g.envSum = 0; g.envN = 0;
      }
      const db = 20 * Math.log10(g.envS + 1e-9);
      g.tdPeak = Math.max(db, g.tdPeak - 0.1 * dt);
      const tdLevel = clamp((db - (g.tdPeak - 30)) / 30);         // time-domain level vs its recent peak
      // ---- presence: frequency domain (loud / moving bands) + time domain (level, attack, sustain, noise)
      let raw;
      const loud = 0.5 * avg(s.loud, g.bands) + 0.5 * tdLevel, mov = avg(s.moving, g.bands);
      if (name === "kick") {
        // a kick = a low-end hit ON the beat clearly stronger than the low end BETWEEN the beats (a rolling
        // bassline is busy between the beats too, a breakdown has no on-beat hit)
        if (s.bpm > 0) {
          const kf = hit + 0.5 * (e.kickFlux || 0), ph = s.beatPhase;   // filtered-waveform attacks
          if (ph < 0.12 || ph > 0.9) g.onMax = Math.max(g.onMax, kf);
          else if (ph > 0.3 && ph < 0.75) { g.offSum += kf; g.offN++; }
          if (s.beatCount !== g.lastBeat) {
            if (g.lastBeat >= 0) {
              const score = g.onMax / (g.offSum / Math.max(1, g.offN) + 1e-6);
              g.kscore = 0.55 * g.kscore + 0.45 * Math.min(10, score);
            }
            g.lastBeat = s.beatCount; g.onMax = 0; g.offSum = 0; g.offN = 0;
          }
          raw = clamp((g.kscore - 1.4) / 1.6);
        } else raw = s.kickOn ? clamp(s.punch) : 0;
      }
      else if (name === "bass") {                       // sample the low end between the kicks only
        if (offbeat || s.bpm === 0) g.offbeat = ema(g.offbeat, loud, dt, 0.25);
        raw = g.offbeat * (0.5 + 0.5 * g.sustain);               // basslines hold between the kicks
      } else if (name === "pads") raw = loud * (1 - 0.6 * mov) * (1 - 0.6 * g.trans) * (0.4 + 0.6 * g.sustain);   // soft, held
      else if (name === "lead") raw = loud * (0.3 + 0.7 * mov) * (0.6 + 0.4 * (1 - g.noise));   // moving, tonal
      else raw = (0.5 * mov + 0.5 * g.trans) * (0.4 + 0.6 * loud) * (0.5 + 0.5 * g.noise);   // sharp, noisy hits
      // judge each group against its OWN range in this track: 'fully there' and 'gone' levels learnt as it plays
      // (quick to adapt, slow to forget) - so entries and exits show even in a dense, compressed mix
      if (name !== "kick") {
        g.hiRef += (raw - g.hiRef) * Math.min(1, dt / (raw > g.hiRef ? 1.5 : 90));
        g.loRef += (raw - g.loRef) * Math.min(1, dt / (raw < g.loRef ? 1.5 : 90));
        raw = clamp((raw - g.loRef) / Math.max(0.08, g.hiRef - g.loRef));
      }
      g.p = ema(g.p, raw, dt, 0.3);
      // ---- enter / exit with hysteresis: clearly there for a beat, clearly gone for two
      g.overFor = g.p > 0.55 ? g.overFor + dt : 0;
      g.underFor = g.p < 0.3 ? g.underFor + dt : 0;
      if (!g.on && g.overFor > beat) { g.on = true; this._event(name, "enter", g, t); }
      else if (g.on && g.underFor > 2 * beat) { g.on = false; this._event(name, "exit", g, t); }
      // ---- 2-bar fingerprint: rhythm (16 steps of 8th notes) + spectral shape, for "change" detection
      if (s.bpm > 0) {
        const step = Math.floor(((s.beatCount % 8) + s.beatPhase) * 2) % 16;
        g.steps[step] += raw; g.cnt[step] += 1;
        g.bands.forEach((bi, j) => (g.shape[j] += s.loud[bi]));
      }
      const st = s.elements[name];
      st.on = g.on; st.level = g.p; st.width = g.width; st.pan = g.pan;
      st.trans = g.trans; st.sustain = g.sustain; st.noise = g.noise; st.hit = hit;
    }

    // ---- 2-bar boundary: compare each group's fingerprint with the previous 2 bars
    if (s.bpm > 0 && s.beatCount % 8 === 0 && s.beatCount !== this.lastBoundary) {
      this.lastBoundary = s.beatCount;
      for (const [name, g] of Object.entries(this.g)) {
        const rhythm = Array.from(g.steps, (v, i) => (g.cnt[i] ? v / g.cnt[i] : 0));
        const vec = normalise([...normalise(rhythm), ...normalise(Array.from(g.shape)).map((v) => v * 0.7)]);
        if (g.prev && g.on && g.wasOn && name !== "kick") {
          const dist = 1 - vec.reduce((a, v, i) => a + v * g.prev[i], 0);       // cosine distance
          if (dist > 0.18) this._event(name, "change", g, t, dist);
        }
        if (g.on && name !== "kick") e.emit("motif", { group: name, vec });   // for the motif memory
        g.prev = vec; g.wasOn = g.on;
        g.steps.fill(0); g.cnt.fill(0); g.shape.fill(0);
      }
      // ---- phrase: on an 8-bar boundary, when several elements entered/left/changed in the last 2 bars
      if (s.beatCount % 32 === 0) {
        const recent = this.recent.filter((r) => t - r.t < 4 * 2 * beat);
        if (recent.length >= 2 && s.beatCount !== this.lastPhrase) {
          this.lastPhrase = s.beatCount;
          e.emit("phrase", { reasons: recent.map((r) => `${r.group} ${r.type}`) });
        }
      }
    }

    // ---- global stereo field (200 Hz - 8 kHz) and its events
    const all = [Math.floor(200 / (e.ctx.sampleRate / e.st.mid.fftSize)), Math.ceil(8000 / (e.ctx.sampleRate / e.st.mid.fftSize))];
    const M = this._power(this.st.mid, all), S = this._power(this.st.side, all);
    const Lp = this._power(this.st.left, all), Rp = this._power(this.st.right, all);
    this.width = ema(this.width, S / (M + S + 1e-12), dt, 0.6);
    this.pan = ema(this.pan, (Rp - Lp) / (Rp + Lp + 1e-12), dt, 0.6);
    s.stereo.width = this.width; s.stereo.pan = this.pan;
    if (t - this.lastW >= 0.25) { this.lastW = t; this.wHist.push(this.width); if (this.wHist.length > 32) this.wHist.shift(); }
    if (this.wHist.length >= 32 && t - this.lastStereo > 8) {
      const ago8 = this.wHist[0], ago2 = this.wHist[this.wHist.length - 8];
      if (this.width - ago8 > 0.12 && this.width > 0.25) { this.lastStereo = t; e.emit("stereo", { type: "widen", width: this.width }); }
      else if (ago2 - this.width > 0.15) {
        this.lastStereo = t;
        e.emit("stereo", { type: "collapse", width: this.width });
        // the mix narrowing during a breakdown/build is a classic sign the drop is about to hit
        if (s.section === "breakdown" || s.section === "build") e.emit("predrop", { width: this.width });
      }
    }
  }

  _event(group, type, g, t, dist) {
    this.recent.push({ group, type, t });
    if (this.recent.length > 20) this.recent.shift();
    this.e.emit("element", { group, type, width: g.width, pan: g.pan, dist });
  }
}

function normalise(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
