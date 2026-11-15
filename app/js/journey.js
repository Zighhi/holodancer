// The head journey (~5 minutes at 130 BPM): from the face into the brain and through its MRI slices. Progressive:
// every phase builds up inside itself. In the show (a breakdown's mind moment) the drop ends it: a burst, straight to
// "out", she comes back; the next breakdown's journey carries on from where it was cut off. By hand (J) a drop moves it on.
//   face   (16 bars) - the head fades in (the shaded "uncanny" skin); scanner bands start passing over it, showing the
//                      MRI tissue under the skin behind them, more often as it goes on
//   cut    (16 bars) - a cut plane facing the camera steps into the head: once a bar, then twice, then every beat
//   scan   (32 bars) - the cut scrolls back and forth, wider and wider; the head turns to a new view every few bars;
//                      the camera moves in towards the section
//   ortho  (32 bars) - the skin dissolves to a ghost outline; three planes (sagittal, axial, coronal) arrive one by one
//                      and step on with the music; later only the brain's sections remain
//   peel   (16 bars) - the face comes back whole, then peels: skin, skull layer, brain; we zoom into the brain
//   slices (48 bars) - the brain as ~20 MRI slices: sagittal, coronal, axial (16 bars each); each grows from the middle
//                      out, then one slice per beat is pulled out of the stack in full colour (in order, like flipping
//                      through films) while the rest dims; bass pushes them apart, kicks snap;
//                      a ghost of the head (rim only) stays around the stack all the time
//   out    (4 bars)  - the stack flies apart while the whole face forms again, then dissolves; the show rebuilds the
//                      dancer from slices
// The head moves at random on its bar grid: it turns to a new view (front, 3/4, profile, from above...) in about a
// beat, or spins for a while (random direction and speed, a half turn or several), or just holds still. The show's
// stutter holds/steps the motion, short glitches hit random bars, and faint face echoes trail behind it while it moves.
// Snippets: one stage on its own for a few bars (startSnippet), e.g. while she is up on the wall.
import * as THREE from "three";

const PHASES = [
  { name: "face", beats: 64 },
  { name: "cut", beats: 64 },
  { name: "scan", beats: 128 },
  { name: "ortho", beats: 128 },
  { name: "peel", beats: 64 },
  { name: "slices", beats: 192 },
  { name: "out", beats: 16 },
];
export const SNIPPETS = { face: 24, cut: 32, ortho: 32, slices: 32 };   // stage -> length in beats when played alone
const AXES = [0, 2, 1];                   // slice stacks in turn: sagittal (x), coronal (z), axial (y)
const AXIS_VIEW = [                       // how the head is turned so each stack faces the crowd at an angle
  { yaw: -1.15, pitch: 0.1 }, { yaw: 0.45, pitch: 0.1 }, { yaw: 0.3, pitch: 0.95 },
];
const VIEWS = [                           // the head's views: it turns from one to another on the bar
  { yaw: 0, pitch: -0.05 }, { yaw: 0.65, pitch: 0 }, { yaw: -0.65, pitch: 0 }, { yaw: Math.PI / 2, pitch: 0 },
  { yaw: -Math.PI / 2, pitch: 0 }, { yaw: 0.3, pitch: 0.75 }, { yaw: 2.4, pitch: 0.1 }, { yaw: -2.4, pitch: 0.1 },
];
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const ramp = (x, from, len) => ease((x - from) / len);                // 0 before 'from', 1 after from+len
const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1);            // 0 -> 1 -> 0 ping-pong, period 2
const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Journey {
  constructor(head, brain) {
    this.head = head;
    this.brain = brain;
    head.setBrainSize(brain.size);
    this.active = false;
    this.cover = 0;                       // 0..1: how much the journey owns the stage
    this.synced = null;                   // follower: the leader's { i, beats }
    this.snip = null;                     // a snippet: { name, beats, axis }
    this.v = {};
    this.i = 0; this.beats = 0;
    this.qHist = [];                      // recent head turns, for the face echoes
    this.reset();
  }

  reset() {
    Object.assign(this.v, { skin: 0, ghost: 0, shell: 0, cap: 0, brainOnly: 0, depth: 0.2, brain: 0, ortho: 0,
      orthoMask: [0, 0, 0], slices: 0, reveal: 0, explode: 0.1, zoom: 0, bass: 0, flash: 0, burst: 0, band: 1, bandAmt: 0,
      cam: 1, echo: 0 });
    this.yaw = 0; this.pitch = 0; this.step = -1; this.orthoCount = [0, 0, 0]; this.orthoFlash = [0, 0, 0];
    this.view = 0; this.viewBar = -1; this.ending = -1; this.spinRate = 0;   // spinRate: turns per beat (0 = not spinning)
    this.shownYaw = 0; this.shownPitch = 0; this.stIdx = -1; this.bar = -1; this.glitchUntil = -1; this.glitch = 0;
    this.qHist.length = 0;
  }

  get phase() { return this.active ? (this.snip ? `${this.snip.name} (snippet)` : PHASES[this.i].name) : "-"; }
  get progress() {
    if (!this.active) return "-";
    const len = this.snip ? this.snip.beats : PHASES[this.i].beats;
    return `${this.phase} ${Math.min(100, Math.round(100 * this.beats / len))} %`;
  }
  // for the projector: only the full journey (snippets stay on the hologram)
  get snapshot() {
    return this.active && !this.snip
      ? { i: this.i, beats: this.beats, phase: PHASES[this.i].name, len: PHASES[this.i].beats, axis: this.axis ?? 0 } : null;
  }
  get camZoom() { return this.v.cam; }                               // camera distance factor (1 = normal)
  get brainLevel() { return this.active ? this.v.brain : 0; }

  // auto (a breakdown's mind moment): it carries on where the last one was cut off by a drop
  start(auto = true) {
    const from = auto && this.resume != null ? this.resume : 0;
    Object.assign(this, { active: true, auto, i: from, beats: 0, snip: null, step: -1 });
    this.resume = null;
    this.reset();
    if (PHASES[this.i].name === "slices") this.v.zoom = 1;
  }

  // one stage on its own for a few bars, then it fades out (1 bar)
  startSnippet(name, beats = SNIPPETS[name]) {
    this.start(false);
    this.i = PHASES.findIndex((p) => p.name === name);
    this.snip = { name, beats, axis: AXES[0 | Math.random() * 3] };
    this.view = 0 | Math.random() * VIEWS.length;
    if (name === "slices") this.v.zoom = 1;
  }
  // end a snippet early (a soft fade)
  endSnippet() { if (this.snip && this.ending < 0) this.ending = this.beats; }

  // follower (the projector): mirror the leader's timeline; null = the leader's journey is over
  follow(snap) {
    if (!snap) { this.active = false; this.synced = null; return; }
    if (!this.active) this.start(false);
    this.synced = snap;
  }

  next() {
    if (this.i + 1 < PHASES.length) { this.i++; this.beats = 0; this.step = -1; }
    else { this.active = false; if (this.auto) this.resume = null; }   // (the whole way: the next one starts at the face)
    if (this.active && PHASES[this.i].name === "slices") this.yaw = wrap(this.yaw);
  }
  goto(name) { this.i = PHASES.findIndex((p) => p.name === name); this.beats = 0; this.step = -1; }
  build() { if (this.active) this.v.flash = 1; }
  // a drop: a burst. An auto journey (from a breakdown) ends here - straight to "out", she comes back - and remembers
  // the phase it was in, for the next breakdown. By hand (J): on to the next phase, if this one has had a quarter of its time.
  drop() {
    if (!this.active) return;
    this.v.burst = 1; this.v.flash = 1;
    if (this.snip || PHASES[this.i].name === "out") return;
    if (this.auto) {
      const more = this.beats / PHASES[this.i].beats > 0.75 ? 1 : 0;      // (nearly done with this phase: the next one)
      const nx = this.i + more;
      this.resume = PHASES[nx].name === "out" ? null : nx;
      this.goto("out");
    } else if (this.beats / PHASES[this.i].beats > 0.25) this.next();
  }
  stop() { this.active = false; this.snip = null; }

  // m: { bpm, section, kick, bass, hats, steps (musical steps per beat), stutter (the show's stepsPerBeat, 0 = none),
  //      camera, anchor (world pos), height, yawOffset }
  update(dt, t, m) {
    const v = this.v, head = this.head, brain = this.brain, u = head.uniforms;
    this.cover = smooth(this.cover, this.active ? 1 : 0, this.active ? 1.2 : 2, dt);
    if (!this.active) {
      u.uLevel.value = u.uShell.value = u.uCapLevel.value = u.uOrthoLevel.value = u.uSliceLevel.value = u.uBandAmt.value = 0;
      head.echoes.forEach((e) => (e.visible = false));
      brain.uniforms.uClip.value.w = 10;
      v.cam = smooth(v.cam, 1, 2, dt);
      head.update(dt, t, m);
      return;
    }
    // ---- timeline (in beats): own, the leader's, or a snippet's
    const bps = (m.bpm || 130) / 60;
    if (this.synced) {
      if (this.synced.i !== this.i) { this.i = this.synced.i; this.step = -1; }
      this.beats = this.synced.beats;
    } else {
      this.beats += dt * bps;
      if (this.snip) {
        if (this.ending < 0 && this.beats >= this.snip.beats) this.ending = this.beats;
        if (this.ending >= 0 && this.beats - this.ending > 4) { this.stop(); return; }
      } else if (this.beats >= PHASES[this.i].beats) { this.next(); if (!this.active) return; }
    }
    const name = PHASES[this.i].name, snip = !!this.snip;
    const len = snip ? this.snip.beats : PHASES[this.i].beats, b = this.beats, p = Math.min(1, b / len);
    const fading = this.ending >= 0;
    v.bass = smooth(v.bass, m.bass || 0, 4, dt);
    const mSteps = m.steps || 2;
    v.flash = Math.max(0, v.flash - dt * 5);
    v.burst = Math.max(0, v.burst - dt * 1.2);

    // ---- bars: glitches now and then; the head's view changes on its own bar grid
    const bar = Math.floor(b / 4);
    const newBar = bar !== this.bar;
    if (newBar) {
      this.bar = bar;
      if ((name === "scan" || name === "ortho" || name === "slices") && Math.random() < 0.22) this.glitchUntil = t + 0.25 / bps;
    }
    this.glitch = t < this.glitchUntil ? 1 : 0;
    // the head's motion, chosen at random every few bars: turn to a new view, spin for a while, or hold
    const turnTo = (everyBars) => {
      if (newBar && bar % everyBars === 0 && bar !== this.viewBar) {
        this.viewBar = bar;
        const r = Math.random();
        if (r < 0.5) {                                                 // a new view (never the same one)
          this.spinRate = 0;
          let n = this.view;
          while (n === this.view) n = 0 | Math.random() * VIEWS.length;
          this.view = n;
        } else if (r < 0.85) {                                         // a spin: slow drift .. fast whirl, either way
          this.spinRate = (Math.random() < 0.5 ? -1 : 1) * (0.03 + 0.2 * Math.random() ** 2);
        } else this.spinRate = 0;                                      // hold still where it is
        if (!this.spinRate && r >= 0.85) this.view = -1;
      }
      return this.view >= 0 ? VIEWS[this.view] : null;
    };

    // ---- targets per phase
    let skin = 0, ghost = 0, shell = 0, cap = 0, brainOnly = 0, depth = 0.2, brainLvl = 0, ortho = 0, slices = 0;
    let reveal = 1, explode = 0.1, zoom = 0, axis = this.axis ?? 0, bandAmt = 0, band = 1, cam = 1, lift = 0;
    let view = { yaw: 0, pitch: -0.05 }, moving = false;
    const stepAt = (rate) => {                                            // musical steps: index + flash on a new one
      const idx = Math.floor(b * rate);
      if (idx !== this.step) { this.step = idx; v.flash = Math.max(v.flash, 0.8); return [idx, true]; }
      return [idx, false];
    };
    if (name === "face") {
      skin = snip ? ramp(b, 0, 4) : ramp(p, 0, 0.25); brainLvl = 1;
      // scanner bands passing over the face, more often as it goes on
      const start = snip ? 4 : 16, every = snip ? 8 : (b < 40 ? 16 : 8);
      if (b >= start) {
        const q = ((b - start) % every) / 8;
        if (q < 1) { bandAmt = Math.sin(Math.PI * q) ** 0.5; band = 0.1 - 0.27 * q; }
      }
      view = snip ? turnTo(4) : p < 0.5 ? VIEWS[0] : turnTo(4);
    } else if (name === "cut") {
      skin = 1; cap = 1; brainLvl = 1;
      const N = (p < 0.4 ? 8 : p < 0.75 ? 16 : 32) * mSteps / 2 * (snip ? 0.5 : 1);   // steps over the whole way: bar -> beat
      const [idx] = stepAt(N / len);
      depth = 0.13 - 0.13 * Math.min(1, (idx + 1) / N);
      cam = 1 - 0.15 * ease(p);
      view = snip ? turnTo(4) : VIEWS[0];
    } else if (name === "scan") {
      skin = 1; cap = 1; brainLvl = 1;
      const [idx] = stepAt(p < 0.5 ? 1 : mSteps);                          // on the beat, later on 8ths / 16ths
      const amp = 0.02 + 0.08 * ease(p * 1.4);                             // wider and wider
      depth = 0.015 + amp * (tri(idx / 16) * 2 - 1);
      view = turnTo(p < 0.5 ? 4 : 2);                                      // a new view every 4 bars, later every 2
      cam = 0.85 - 0.3 * ease(p);                                          // the camera moves in on the section
    } else if (name === "ortho") {
      skin = 1; ghost = snip ? ramp(b, 0, 4) : ramp(p, 0, 0.1); ortho = 1;
      brainOnly = p > 0.75 ? 1 : 0;
      const mask = [1, p > 0.19 ? 1 : 0, p > 0.38 ? 1 : 0];                // the planes arrive one by one
      mask.forEach((x, k) => (v.orthoMask[k] = smooth(v.orthoMask[k], x, 1, dt)));
      const [idx, fresh] = stepAt(p < 0.5 && !snip ? 0.25 : 1);           // a plane steps once a bar, later every beat
      if (fresh) {
        const live = mask.map((x, k) => (x ? k : -1)).filter((k) => k >= 0);
        const k = live[idx % live.length];
        this.orthoCount[k]++; this.orthoFlash[k] = 1;
      }
      view = turnTo(4); if (view) view = { yaw: view.yaw, pitch: Math.max(view.pitch, 0.3) };   // a little from above: all 3 planes
      cam = 0.75;
    } else if (name === "peel") {
      // the whole face again (the ghost fills back in), then skin -> skull -> brain
      skin = p < 0.28 ? 1 : 0; ghost = 0; shell = p > 0.06 && p < 0.69 ? 1 : 0;
      brainLvl = p > 0.47 ? 1 : 0; brainOnly = 1;
      zoom = ramp(p, 0.62, 0.38);
      view = turnTo(8);
      cam = 0.8 + 0.2 * ease(p);
    } else if (name === "slices") {
      const k = snip ? AXES.indexOf(this.snip.axis) : Math.floor(b / 64) % 3, q = snip ? p : (b % 64) / 64;
      axis = AXES[k];
      brainOnly = 1; zoom = 1;
      skin = 1; ghost = 1;                                                 // a ghost of the head around the stack
      brainLvl = snip ? 0 : b < 8 ? 1 - b / 8 : 0;                         // the brain dissolves into its slices
      slices = q > 0.97 && !snip ? (1 - q) / 0.03 : 1;                    // a short dip when the stack turns
      reveal = ramp(q, 0, 0.25);                                           // grows from the middle outwards
      explode = 0.05 + 0.3 * q + 0.45 * v.bass;                            // opening up more and more
      view = { yaw: AXIS_VIEW[k].yaw + 0.15 * Math.sin(t * 0.3), pitch: AXIS_VIEW[k].pitch };
      lift = ramp(q, 0.45, 0.08) * (q > 0.95 ? 0 : 1);                     // second half: a slice out per beat
      cam = 1 - 0.12 * ramp(q, 0.45, 0.5);                                 // (only a slight drift in)
    } else if (name === "out") {
      // the stack flies apart while the whole face forms again (back at head size), then it dissolves
      brainOnly = 1; zoom = 0;
      slices = 1 - ease(p); explode = 0.35 + 3.5 * ease(p);
      skin = p < 0.55 ? ease(p / 0.3) : 1 - ease((p - 0.55) / 0.45); ghost = 0;
      view = VIEWS[0];
      cam = 0.5 + 0.5 * ease(p);
    }
    if (fading) { skin = shell = cap = ortho = slices = brainLvl = 0; cam = 1; explode += 1.5 * ease((b - this.ending) / 4); }
    this.axis = axis;
    explode += 0.6 * v.burst;

    // ---- smooth everything (slowly; cut steps snap quickly, kicks snap the stack)
    v.skin = smooth(v.skin, skin, name === "peel" || fading ? 1.5 : 0.8, dt);
    v.ghost = smooth(v.ghost, ghost, 0.8, dt);
    v.shell = smooth(v.shell, shell, 1.2, dt);
    v.cap = smooth(v.cap, cap, fading ? 2 : 1, dt);
    v.brainOnly = smooth(v.brainOnly, brainOnly, 0.8, dt);
    v.depth = smooth(v.depth, depth, name === "face" || name === "ortho" ? 1 : 18, dt);
    v.brain = smooth(v.brain, brainLvl, fading ? 2 : 0.8, dt);
    v.ortho = smooth(v.ortho, ortho, fading ? 2 : 0.8, dt);
    v.slices = name === "out" ? slices : smooth(v.slices, slices, 1.5, dt);
    v.reveal = smooth(v.reveal, reveal, 2, dt);
    v.explode = name === "out" ? explode : smooth(v.explode, explode * (1 - 0.4 * (m.kick || 0)), 5, dt);
    v.zoom = smooth(v.zoom, zoom, 0.6, dt);
    v.cam = smooth(v.cam, cam, 0.7, dt);
    v.lift = smooth(v.lift ?? 0, lift, 2, dt);
    v.bandAmt = bandAmt; v.band = band;
    // the motion: spinning (until the next choice), turning quickly to the new view (about a beat), or holding still
    // (the turnTo phases); slices / out set their own view; a slight breathing sway on top
    const prevYaw = this.yaw, prevPitch = this.pitch;
    const randomPhase = name === "face" || name === "cut" || name === "scan" || name === "ortho" || name === "peel";
    if (!randomPhase) this.spinRate = 0;
    if (this.spinRate && !fading) this.yaw += dt * bps * this.spinRate * 2 * Math.PI;
    else if (view) {
      this.yaw += wrap(view.yaw + 0.04 * Math.sin(t * 0.5) - this.yaw) * Math.min(1, dt * bps * 3);
      this.pitch = smooth(this.pitch, view.pitch + 0.02 * Math.sin(t * 0.37), bps * 3, dt);
    }
    const turnSpeed = (Math.abs(wrap(this.yaw - prevYaw)) + Math.abs(this.pitch - prevPitch)) / Math.max(dt, 1e-3);
    for (let k = 0; k < 3; k++) this.orthoFlash[k] = Math.max(0, this.orthoFlash[k] - dt * 2);
    // the show's stutter: the turn only moves on the stutter steps (a freeze holds it)
    const stut = m.stutter || 0;
    if (stut > 0) {
      const si = Math.floor(b * stut);
      if (si !== this.stIdx) { this.stIdx = si; this.shownYaw = this.yaw; this.shownPitch = this.pitch; }
    } else { this.shownYaw = this.yaw; this.shownPitch = this.pitch; }

    // ---- place head and brain together: same position, scale and turn (the brain sits inside the head)
    const sHead = m.height / head.size.y, sBrain = (m.height * 0.82) / brain.size.y;
    const s = sHead + (sBrain - sHead) * v.zoom;
    const jitter = this.glitch ? (Math.random() - 0.5) * 0.03 * s : 0;
    head.root.position.copy(m.anchor).add(new THREE.Vector3(jitter, 0.033 * s * (1 - v.zoom), 0));   // head centre, not brain centre
    head.root.scale.setScalar(s);
    head.spinner.rotation.set(this.shownPitch, this.shownYaw + (m.yawOffset || 0), 0, "YXZ");
    brain.root.position.copy(head.root.position);
    brain.root.quaternion.identity();
    brain.root.scale.setScalar(s);
    brain.spinner.quaternion.copy(head.spinner.quaternion);
    brain.spinner.scale.setScalar(1);

    // ---- face echoes: the head as it was 0.12 / 0.24 / 0.36 s ago, only while it turns (and on stutters)
    this.qHist.push({ t, q: head.spinner.quaternion.clone() });
    while (this.qHist.length > 2 && t - this.qHist[0].t > 0.6) this.qHist.shift();
    v.echo = smooth(v.echo, Math.min(1, turnSpeed * 0.6 + (stut > 0 ? 0.4 : 0)) * v.skin * (1 - v.ghost), 4, dt);
    for (let i = 0; i < 3; i++) {
      const want = t - 0.12 * (i + 1);
      let best = this.qHist[0];
      for (const h of this.qHist) if (Math.abs(h.t - want) < Math.abs(best.t - want)) best = h;
      head.setEcho(i, best.q, v.echo * 0.5 * (1 - i * 0.25), [u.uA0, u.uA1, u.uA2][i].value);
    }

    // ---- uniforms
    u.uLevel.value = v.skin;
    u.uGhost.value = v.ghost;
    u.uShell.value = v.shell;
    u.uCapLevel.value = v.cap;
    u.uBrainOnly.value = v.brainOnly;
    u.uOrthoLevel.value = v.ortho;
    u.uOrthoMask.value.set(...v.orthoMask);
    u.uSliceLevel.value = v.slices;
    u.uSliceReveal.value = v.reveal;
    u.uExplode.value = v.explode + (this.glitch ? 0.15 : 0);
    u.uAxis.value = axis;
    const scanBars = name === "slices" && !snip && b < 64 ? 8 : 4;         // the active slice: slow first, then faster
    u.uScan.value = (b % scanBars) / scanBars;
    u.uLift.value = v.lift;
    if (v.lift > 0.01) {                                                   // pulled out: one slice per beat, in order
      const n = u.uSlices.value, i = (Math.floor(b) + ease(Math.min(1, (b % 1) * 3))) % n;   // glides in a third of a beat
      u.uScan.value = (i + 0.5) / n;
    }
    u.uStepFlash.value = Math.max(v.flash, v.burst);
    u.uBand.value = v.band;
    u.uBandAmt.value = v.bandAmt;
    const box = brain.size, oc = this.orthoCount;                          // the ortho planes ping-pong inside the brain
    u.uOrtho.value.set(box.x * 0.4 * (tri(oc[0] / 6) * 2 - 1), box.y * 0.4 * (tri(oc[1] / 6 + 0.5) * 2 - 1),
      box.z * 0.4 * (tri(oc[2] / 6 + 1) * 2 - 1));
    u.uOrthoFlash.value.set(...this.orthoFlash);
    head.root.updateMatrixWorld(true);
    const clip = head.setCut(m.camera, v.depth);
    brain.uniforms.uClip.value.copy(clip);
    head.update(dt, t, m);
  }
}
