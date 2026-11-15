// Audio engine: live input (SSL 2 inputs 1/2) or a test file -> levels, bands, onset strength, tempo, beat phase,
// and trance sections (breakdown / build / drop). Call update() once per animation frame and read .state.
//
// Tempo/beat: an onset-strength curve (log spectral flux, kick range weighted) is resampled onto a fixed 60 Hz grid;
// its autocorrelation scored at 1-4 beat lags gives the tempo (robust against rolling basslines), and the beat phase
// is the grid offset that best matches the curve.
// Sections use DENSITY - how many of 24 frequency bands are "playing" (loud for that band AND moving), relative to
// the track's normal density: breakdowns thin out, builds add elements back, drops jump back to full.
// A "surge" (-> section "peak") is a sudden clear rise of intensity (loudness + density) without a breakdown.
// Events: beat, kick, tempo, section, drop, surge.

const BANDS = { low: [35, 150], lowmid: [150, 600], mid: [600, 2500], high: [2500, 12000] };
const NB = 24, NB_LO = 40, NB_HI = 16000;     // density bands, log-spaced
const KICK = [40, 120];
const HIGH = [2500, 12000];
const BPM_MIN = 110, BPM_MAX = 170;
const RATE = 60;                 // onset-strength grid (Hz)
const WINDOW = 8;                // seconds of onset strength used for tempo/phase

import { ElementTracker } from "./elements.js";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ema = (prev, x, dt, tau) => prev + (x - prev) * (1 - Math.exp(-dt / tau));
const wrap = (x) => x - Math.floor(x);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.listeners = {};
    this.state = {
      running: false, source: "none", level: 0,
      bands: { low: 0, lowmid: 0, mid: 0, high: 0 },
      onset: 0,                     // current onset strength (0..1) - good for continuous reactivity
      kick: 0,                      // 1 on a kick that lands on the beat grid, decays quickly
      bpm: 0, bpmConfidence: 0,
      beatPhase: 0, beatCount: 0,   // beatPhase 0..1 inside the beat; beatCount % 4 == 0 is the bar's "one"
      section: "silence", sectionTime: 0, sinceDrop: Infinity,
      punch: 0,                     // low-end punch relative to the track's full level (~1 kick playing, ~0 no kick)
      kickOn: true,                 // is the kick currently playing (with hysteresis)
      intensity: 0,                 // loudness + density (0..1), what "surge" watches
      density: 0,                   // fraction of the 24 bands that are playing (0..1)
      densityRel: 1,                // density relative to the track's normal density (~1 normal, low = thinned out)
      active: new Float32Array(NB), // per-band activity 0..1 (for display)
      loud: new Float32Array(NB),   // per band: loud for that band (0..1)
      moving: new Float32Array(NB), // per band: moving / changing (0..1)
      env: { short: 0, mid: 0 },
    };
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); }
  emit(event, data) { (this.listeners[event] || []).forEach((fn) => fn(data)); }

  static async listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  async startInput(deviceId) {
    await this._init();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2,
      },
    });
    this._stopSource();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);          // analysis only: never routed to the speakers
    this.source.connect(this.stereoIn);
    this.state.source = stream.getAudioTracks()[0]?.label || "input";
    this.state.running = true;
    this.reset();
  }

  // play a test file through an <audio> element (with its own controls for scrubbing)
  async startFile(file, audioEl) {
    await this._init();
    this._stopSource();
    if (!this.mediaSource) {                     // an element can only be wrapped once
      this.mediaEl = audioEl;
      this.mediaSource = this.ctx.createMediaElementSource(audioEl);
      audioEl.addEventListener("seeked", () => this.reset(true));
    }
    this.mediaSource.connect(this.analyser);
    this.mediaSource.connect(this.stereoIn);
    this.mediaSource.connect(this.ctx.destination);
    audioEl.src = URL.createObjectURL(file);
    await audioEl.play();
    this.state.source = file.name;
    this.state.running = true;
    this.reset();
  }

  async _init() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      const n = this.analyser.frequencyBinCount;
      this.spec = new Float32Array(n);
      this.logMag = new Float32Array(n);
      this.prevLog = new Float32Array(n);
      this.wave = new Float32Array(this.analyser.fftSize);
      this.binHz = this.ctx.sampleRate / this.analyser.fftSize;
      this.peakDb = { level: -30, low: -30, lowmid: -30, mid: -30, high: -30 };
      this.lowRef = 0;         // long-term low-end punch of the track (frozen during breakdowns)
      this.densRef = 0;        // long-term normal density of the track (frozen during breakdowns)
      this.nb = [];            // density bands: bin range + running state
      for (let k = 0; k < NB; k++) {
        const lo = NB_LO * Math.pow(NB_HI / NB_LO, k / NB), hi = NB_LO * Math.pow(NB_HI / NB_LO, (k + 1) / NB);
        this.nb.push({ lo, hi, eS: -120, peak: -120, fS: 0, fRef: 1e-6 });
      }
      // stereo: mid (L+R)/2, side (L-R)/2, left and right, each with its own analyser. A mono source is upmixed to
      // both channels first, so its side is exactly silent (width 0).
      this.stereoIn = new GainNode(this.ctx, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
      const split = this.ctx.createChannelSplitter(2);
      this.stereoIn.connect(split);
      const an = () => { const a = this.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0; return a; };
      this.st = { mid: an(), side: an(), left: an(), right: an() };
      const g = (v) => new GainNode(this.ctx, { gain: v });
      const mL = g(0.5), mR = g(0.5), sL = g(0.5), sR = g(-0.5);
      split.connect(mL, 0); split.connect(mR, 1); split.connect(sL, 0); split.connect(sR, 1);
      mL.connect(this.st.mid); mR.connect(this.st.mid); sL.connect(this.st.side); sR.connect(this.st.side);
      split.connect(this.st.left, 0); split.connect(this.st.right, 1);
      // time domain per instrument group: its own band-filtered waveform (for transients, sustain, noisiness)
      const filt = (type, f, q = 0.7) => new BiquadFilterNode(this.ctx, { type, frequency: f, Q: q });
      const chains = { kick: [filt("highpass", 35), filt("lowpass", 120)], bass: [filt("bandpass", 110, 0.8)],
        pads: [filt("bandpass", 600, 0.7)], lead: [filt("bandpass", 2500, 0.8)], hats: [filt("highpass", 6000)] };
      this.td = {};
      for (const [name, nodes] of Object.entries(chains)) {
        let prev = this.stereoIn;
        for (const nd of nodes) { prev.connect(nd); prev = nd; }
        const a = this.ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0;
        prev.connect(a);
        this.td[name] = a;
      }
      this.elements = new ElementTracker(this);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  // clear the short-term history (after a seek or a new source); keepRefs keeps the track's long-term references
  reset(keepRefs = false) {
    this.grid = [];            // onset strength on the fixed RATE grid
    this.gridT = null;
    this.prevOdf = 0; this.prevT = null;
    this.lastT = null;
    this.odfPeak = 1e-3;
    this.lastTempo = -1;
    this.pending = null;
    this.lf = { short: 0, mid: 0 };
    this.hf = { mid: 0, base: 0 };
    this.dens = { short: 0, mid: 0, hist: [], lastHist: -1, low: 1 };
    this.int = { short: 0, hist: [], lastHist: -1, lastSurge: -Infinity, surgeBase: 0 };
    this.sectionSince = this.ctx ? this.ctx.currentTime : 0;
    this.breakdownStart = null;
    this.prevLog?.fill(0);
    this.warm = 0;
    this.quietFor = 0;
    this.kickOffSince = this.sectionSince;
    this.state.kickOn = true;
    if (!keepRefs) {
      this.intHi = this.intLo = undefined;
      this.lowRef = 0; this.densRef = 0; this.state.bpm = 0; this.state.bpmConfidence = 0;
      for (const b of this.nb || []) { b.eS = -120; b.peak = -120; b.fS = 0; b.fRef = 1e-6; }
    }
    this.state.section = "normal";
    this.elements?.reset();
  }

  _stopSource() {
    this.source?.disconnect();
    this.mediaSource?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.mediaEl?.pause();
    this.stream = null;
    this.source = null;
  }

  _bandDb(lo, hi) {
    const a = Math.max(1, Math.floor(lo / this.binHz)), b = Math.min(this.spec.length - 1, Math.ceil(hi / this.binHz));
    let p = 0;
    for (let i = a; i <= b; i++) p += Math.pow(10, this.spec[i] / 10);
    return 10 * Math.log10(p / (b - a + 1) + 1e-12);
  }

  _norm(key, db, dt) {
    this.peakDb[key] = Math.max(db, this.peakDb[key] - 0.3 * dt);
    return clamp((db - (this.peakDb[key] - 36)) / 36);
  }

  _flux(lo, hi) {            // half-wave rectified log-magnitude flux in a band
    const a = Math.max(1, Math.floor(lo / this.binHz)), b = Math.min(this.spec.length - 1, Math.ceil(hi / this.binHz));
    let f = 0;
    for (let i = a; i <= b; i++) f += Math.max(0, this.logMag[i] - this.prevLog[i]);
    return f / (b - a + 1);
  }

  update() {
    const s = this.state;
    if (!this.ctx || !s.running) return s;
    const t = this.ctx.currentTime;
    const dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 1e-3, 0.1);
    this.lastT = t;

    this.analyser.getFloatFrequencyData(this.spec);
    for (let i = 0; i < this.spec.length; i++) {
      if (!Number.isFinite(this.spec[i])) this.spec[i] = -160;
      this.logMag[i] = Math.log1p(Math.pow(10, this.spec[i] / 20) * 1000);   // compressed magnitude
    }
    this.analyser.getFloatTimeDomainData(this.wave);
    let rms = 0;
    for (const v of this.wave) rms += v * v;
    const levelDb = 20 * Math.log10(Math.sqrt(rms / this.wave.length) + 1e-9);

    s.level = this._norm("level", levelDb, dt);
    for (const [k, [lo, hi]] of Object.entries(BANDS)) s.bands[k] = this._norm(k, this._bandDb(lo, hi), dt);

    // ---- onset strength: kick range weighted + full spectrum
    const lowFlux = this._flux(KICK[0], KICK[1]);
    const highFlux = this._flux(HIGH[0], HIGH[1]);
    const fullFlux = this._flux(30, 8000);
    this.kickFlux = lowFlux;                          // for the element tracker's rhythmic kick test
    this._density(dt);                               // needs prevLog, so before it is overwritten
    this.prevLog.set(this.logMag);
    const odf = 2 * lowFlux + fullFlux;
    this.odfPeak = Math.max(odf, this.odfPeak * Math.exp(-dt / 10));
    s.onset = clamp(odf / this.odfPeak);
    this._toGrid(t, odf);

    // ---- tempo (every 0.5 s) and beat phase
    if (t - this.lastTempo > 0.5 && this.grid.length > RATE * 4) { this.lastTempo = t; this._tempo(t); }
    if (s.bpm > 0) {
      s.beatPhase += dt * s.bpm / 60;
      while (s.beatPhase >= 1) {
        s.beatPhase -= 1;
        s.beatCount++;
        this.emit("beat", { count: s.beatCount, beatInBar: s.beatCount % 4 });
      }
    }

    // ---- kick flash: a strong low-end onset close to the predicted beat
    s.kick = Math.max(0, s.kick - dt * 6);
    const nearBeat = Math.min(s.beatPhase, 1 - s.beatPhase) < 0.12;
    if (lowFlux > 0 && this.lf.mid > 0 && lowFlux > 1.8 * this.lf.mid && (nearBeat || s.bpmConfidence < 0.3)
        && s.kick < 0.5) {
      s.kick = 1;
      this.emit("kick", { t });
    }

    // ---- sections
    s.env.short = ema(s.env.short, s.level, dt, 0.4);
    s.env.mid = ema(s.env.mid, s.level, dt, 4);
    this.lf.short = ema(this.lf.short, lowFlux, dt, 0.6);
    this.lf.mid = ema(this.lf.mid, lowFlux, dt, 2.5);
    this.hf.mid = ema(this.hf.mid, highFlux, dt, 2);
    this._sections(t, dt, levelDb);
    this.elements.update(t, dt);                       // elements entering / leaving / changing, stereo
    return s;
  }

  // how many bands are playing: loud for that band (within 14 dB of its recent peak) AND moving (flux)
  _density(dt) {
    const s = this.state;
    let sum = 0;
    for (let k = 0; k < NB; k++) {
      const b = this.nb[k];
      const db = this._bandDb(b.lo, b.hi);
      b.eS = ema(b.eS, db, dt, 0.3);
      b.peak = Math.max(b.eS, b.peak - 0.15 * dt);            // forgets ~1.5 dB per 10 s
      b.fS = ema(b.fS, this._flux(b.lo, b.hi), dt, 0.8);
      b.fRef = Math.max(b.fS, b.fRef * Math.exp(-dt / 30));
      const loud = clamp((b.eS - (b.peak - 18)) / 8);         // 0 at -18 dB, 1 at -10 dB below the peak
      const moving = clamp((b.fS / b.fRef - 0.15) / 0.25);
      const a = b.eS > -95 ? loud * moving : 0;
      s.active[k] = a;
      s.loud[k] = b.eS > -95 ? loud : 0;
      s.moving[k] = moving;
      sum += a;
    }
    s.density = sum / NB;
  }

  _toGrid(t, odf) {
    if (this.gridT === null) { this.gridT = t; this.prevT = t; this.prevOdf = odf; }
    while (this.gridT <= t) {                       // linear interpolation onto the fixed grid
      const u = (this.gridT - this.prevT) / Math.max(1e-6, t - this.prevT);
      this.grid.push(this.prevOdf + (odf - this.prevOdf) * clamp(u));
      this.gridT += 1 / RATE;
    }
    this.prevT = t; this.prevOdf = odf;
    const max = RATE * WINDOW;
    if (this.grid.length > max) this.grid.splice(0, this.grid.length - max);
  }

  _tempo(t) {
    const s = this.state, x = this.grid, n = x.length;
    const mean = x.reduce((a, b) => a + b, 0) / n;
    const y = x.map((v) => v - mean);
    const maxLag = Math.ceil(RATE * 4 * 60 / BPM_MIN) + 2;
    const acf = new Float32Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag && lag < n; lag++) {
      let sum = 0;
      for (let i = lag; i < n; i++) sum += y[i] * y[i - lag];
      acf[lag] = sum / (n - lag);
    }
    if (acf[0] <= 0) return;
    const at = (lag) => {                            // interpolated, normalised ACF
      const i = Math.floor(lag), f = lag - i;
      return i + 1 < acf.length ? (acf[i] * (1 - f) + acf[i + 1] * f) / acf[0] : 0;
    };
    let best = 0, bestScore = -Infinity, sum = 0, count = 0;
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.1) {
      const P = RATE * 60 / bpm;
      let score = at(P) + 0.8 * at(2 * P) + 0.6 * at(3 * P) + 0.8 * at(4 * P);
      if (s.bpm > 0) score += 0.15 * Math.exp(-0.5 * ((bpm - s.bpm) / 1.5) ** 2);   // prefer the current tempo
      sum += score; count++;
      if (score > bestScore) { bestScore = score; best = bpm; }
    }
    const conf = clamp((bestScore - sum / count) / 1.2);
    s.bpmConfidence += (conf - s.bpmConfidence) * 0.3;
    if (conf < 0.12) return;                        // too ambiguous (e.g. a beatless breakdown): keep going

    if (s.bpm === 0) { s.bpm = best; this.emit("tempo", { bpm: best }); }
    else if (Math.abs(best - s.bpm) < 2) { s.bpm += (best - s.bpm) * 0.25; this.pending = null; }
    else {                                           // a different tempo must persist for 6 s
      if (!this.pending || Math.abs(this.pending.bpm - best) > 1.5) this.pending = { bpm: best, since: t };
      else if (t - this.pending.since > 6) { s.bpm = best; this.pending = null; this.emit("tempo", { bpm: best }); }
    }
    this._phase();
  }

  _phase() {
    // find the beat-grid offset that best matches the onset curve over the last 16 beats
    const s = this.state, x = this.grid, n = x.length;
    const P = RATE * 60 / s.bpm;
    let bestPh = 0, best = -Infinity;
    for (let k = 0; k < 48; k++) {
      const ph = k / 48;                             // fraction of a beat since the last beat
      let sum = 0;
      for (let b = 0; b < 16; b++) {
        const pos = n - 1 - (ph + b) * P;
        if (pos < 1) break;
        const i = Math.floor(pos), f = pos - i;
        sum += x[i] * (1 - f) + x[i + 1] * f;
      }
      if (sum > best) { best = sum; bestPh = ph; }
    }
    let err = bestPh - s.beatPhase;
    if (err > 0.5) err -= 1;
    if (err < -0.5) err += 1;
    s.beatPhase = wrap(s.beatPhase + 0.35 * err);
  }

  _setSection(name, t) {
    const s = this.state;
    if (s.section === name) return;
    const prev = s.section;
    s.section = name;
    this.sectionSince = t;
    this.emit("section", { section: name, prev });
  }

  _sections(t, dt, levelDb) {
    const s = this.state;
    s.sectionTime = t - this.sectionSince;
    s.sinceDrop += dt;
    // silence with hysteresis: enter below -65 dB after 1.5 s, leave above -58 dB
    this.quietFor = levelDb < -65 ? (this.quietFor || 0) + dt : 0;
    if (s.section === "silence") {
      if (levelDb < -58) return;
      this._setSection("normal", t);
    } else if (this.quietFor > 1.5) { this._setSection("silence", t); return; }
    this.warm = (this.warm || 0) + dt;               // seconds of signal since the last reset

    // references follow the FULLEST recent parts of the track: rise fast, fall slowly (so a thin intro doesn't
    // become "normal"); frozen during breakdowns/builds
    const d = this.dens;
    d.short = ema(d.short, s.density, dt, 0.5);
    d.mid = ema(d.mid, s.density, dt, 2);
    const upper = (ref, x) => (x > ref ? ema(ref, x, dt, 4) : ema(ref, x, dt, 120));
    if (s.section === "normal" || s.section === "peak") {
      this.lowRef = this.lowRef === 0 ? this.lf.mid : upper(this.lowRef, this.lf.mid);
      this.densRef = this.densRef === 0 ? d.mid : upper(this.densRef, d.mid);
    }
    s.punch = this.lowRef > 0 ? clamp(this.lf.mid / this.lowRef, 0, 2) : 1;
    const punchShort = this.lowRef > 0 ? this.lf.short / this.lowRef : 1;
    s.densityRel = this.densRef > 0.02 ? clamp(d.mid / this.densRef, 0, 2) : 1;
    const densShort = this.densRef > 0.02 ? d.short / this.densRef : 1;
    // kick present: low-end punch near the track's full level (with hysteresis)
    if (s.kickOn && s.punch < 0.35) { this.kickOffSince = t; s.kickOn = false; }
    else if (!s.kickOn && s.punch > 0.55) s.kickOn = true;
    const kickOffFor = s.kickOn ? 0 : t - this.kickOffSince;
    if (this.warm < 20) { s.intensity = 0.5; return; }   // still learning the track

    // density history (4 Hz, last 8 s) for the build slope and the drop jump
    if (t - d.lastHist >= 0.25) {
      d.lastHist = t;
      d.hist.push(densShort);
      if (d.hist.length > 32) d.hist.shift();
    }
    const slope = () => {                              // linear fit, densityRel per second
      const h = d.hist, n = h.length;
      if (n < 12) return 0;
      const mx = (n - 1) / 2, my = h.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      h.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
      return num / den * 4;
    };

    // intensity = loudness + density; history at 4 Hz over the last 12 s for the surge baseline
    const it = this.int;
    it.short = ema(it.short, 0.5 * s.env.short + 0.5 * clamp(densShort), dt, 0.6);
    if (t - it.lastHist >= 0.25) {
      it.lastHist = t;
      it.hist.push(it.short);
      if (it.hist.length > 48) it.hist.shift();
    }
    // shown intensity: relative to this track's own range (quietest .. fullest so far), not to the loudest peak -
    // compressed modern tracks would otherwise always sit near the top
    this.intHi = this.intHi === undefined ? it.short : this.intHi + (it.short - this.intHi) * Math.min(1, dt / (it.short > this.intHi ? 2 : 120));
    this.intLo = this.intLo === undefined ? it.short : this.intLo + (it.short - this.intLo) * Math.min(1, dt / (it.short < this.intLo ? 2 : 120));
    s.intensity = clamp((it.short - this.intLo) / Math.max(0.12, this.intHi - this.intLo));
    const full = s.section === "normal" || s.section === "peak";

    if (full) {
      // breakdown: the kick has been out for ~3 s and the arrangement thinned, or it thinned a lot anyway
      const kickBreak = kickOffFor > 3 && s.densityRel < 0.9;
      if ((kickBreak || s.densityRel < 0.5) && s.sectionTime > 8 && this.densRef > 0.02) {
        this._setSection("breakdown", t);
        this.breakdownStart = t;
        this.bdIntensity = it.short;
        this.bdWidth = s.stereo?.width || 0;              // stereo width when the breakdown started
        d.low = s.densityRel;
        return;
      }
      // surge: with the kick playing, intensity clearly above its level 3-12 s ago
      if (it.hist.length >= 40) {
        const base = it.hist.slice(0, 36).reduce((a, b) => a + b, 0) / 36;
        if (s.section === "normal" && s.kickOn && it.short - base > 0.15 && it.short > 0.5
            && t - it.lastSurge > 16 && s.sinceDrop > 16) {
          it.lastSurge = t;
          it.surgeBase = base;
          this.emit("surge", { from: base, to: it.short });
          this._setSection("peak", t);
        } else if (s.section === "peak" && (it.short < it.surgeBase + 0.05 || s.sectionTime > 30)) {
          this._setSection("normal", t);
        }
      }
    } else if (s.section === "breakdown" || s.section === "build") {
      const inBd = t - this.breakdownStart;
      d.low = Math.min(d.low, s.densityRel);           // thinnest point of this breakdown
      // build: still no kick, but elements/intensity are being added back steadily
      if (s.section === "breakdown" && inBd > 6 &&
          ((slope() > 0.02 && s.densityRel > d.low + 0.15) || it.short > this.bdIntensity + 0.12 ||
           (s.stereo?.width || 0) > this.bdWidth + 0.08)) {          // risers and sweeps widen the mix
        this._setSection("build", t);
      }
      // drop: the kick is back with a (nearly) full arrangement
      if (inBd > 6 && punchShort > 0.6 && densShort > 0.7) {
        s.sinceDrop = 0;
        // drops land on the "one": realign the bar so this beat is beat 1
        s.beatCount -= s.beatCount % 4;
        this.emit("drop", { breakdownLength: inBd });
        this._setSection("normal", t);
      }
    }
  }
}
