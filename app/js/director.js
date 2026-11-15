// The director: shapes the whole night. Phases follow the clock of the party night (the timetable, from 19:00:
// e.g. one DJ per phase) and set how far the visuals may go; the night memory keeps variety
// across the whole night and rations the big effects; it all survives a reload (stored in the music memory file
// under "night"). Before 19:00 (setup, tests) it is "arrival"; O forces a phase for testing.

export const NIGHT_START = 19 * 60;   // minutes after midnight: the clock of the night counts from here
// from = minutes after NIGHT_START; journey = weight of the head journey (vs the brain) in a breakdown's mind moment
export const PHASES = [
  { name: "arrival", from: 0, trip: 0.5, full: 0, brain: 0.3, journey: 0.5, snippet: 0, scenes: { solo: 1.2, echoes: 1 }, trails: 0 },
  { name: "warm-up", from: 90, trip: 0.75, full: 0.35, brain: 0.5, journey: 0.7, snippet: 0.3, scenes: { solo: 1, echoes: 1.5, tunnel: 0.5 }, trails: 0 },
  { name: "immersion", from: 180, trip: 0.9, full: 0.6, brain: 0.55, journey: 1, snippet: 0.4, scenes: { echoes: 1.5, tunnel: 0.8, solo: 0.8 }, trails: 0.01 },
  { name: "peak", from: 300, trip: 1, full: 1, brain: 0.65, journey: 1.5, snippet: 0.5, scenes: { echoes: 1.5, tunnel: 1, solo: 0.7 }, trails: 0 },
  { name: "late night", from: 510, trip: 0.9, full: 0.6, brain: 0.8, journey: 1.2, snippet: 0.6, scenes: { solo: 1.4, echoes: 1.2, tunnel: 0.7 }, trails: 0.03 },
];

// the gradual reveal: what appears from which phase on (both windows); a first appearance is pushed (see pick's fresh)
export const UNLOCK = {
  brain: "warm-up", snippets: "warm-up", points: "immersion", journey: "immersion", drafting: "immersion",
  tesseract: "peak", draftElements: "peak", memories: "late night",
  spineStack: "immersion", torso: "warm-up",
  "scene:tunnel": "warm-up", "scene:mri": "warm-up", "scene:lightbox": "warm-up", "scene:scanner": "warm-up",
  "scene:swarm": "immersion", "scene:hyper": "peak", "scene:spine": "immersion",
};
const ORDER = PHASES.map((p) => p.name);
export function unlocked(phaseName, what) {
  const u = UNLOCK[what];
  return !u || ORDER.indexOf(phaseName) >= ORDER.indexOf(u);
}

const NIGHT_GAP = 10 * 3600e3;     // a start more than 10 h after the last save is a new night

export class Director {
  constructor(memory, phases = PHASES) {
    this.memory = memory;
    this.phases = phases;
    const d = memory.data;
    const fresh = !d.night || !d.saved || Date.now() - Date.parse(d.saved) > NIGHT_GAP;
    if (fresh) { d.night = { start: Date.now(), usage: {}, drops: [], fulls: [] }; memory.dirty = true; memory.save(); }
    this.night = d.night;
    this.override = null;          // force a phase for testing (O key)
    console.info(`director: ${fresh ? "new night" : "continuing tonight's history"}; phase by the clock: ${this.status()}`);
  }

  // minutes since 19:00 of tonight (from noon on it is tonight's 19:00, before noon last evening's); negative = not yet
  get minutes() {
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    return now >= 12 * 60 ? now - NIGHT_START : now + 24 * 60 - NIGHT_START;
  }

  get phase() {
    if (this.override !== null) return this.phases[this.override];
    let p = this.phases[0];
    for (const ph of this.phases) if (this.minutes >= ph.from) p = ph;
    return p;
  }

  // a fresh night (Shift+O): the night's usage history and drop counts are cleared (the phases follow the clock)
  newNight() {
    this.memory.data.night = this.night = { start: Date.now(), usage: {}, drops: [], fulls: [] };
    this.override = null;
    this.memory.dirty = true;
    this.memory.save();
  }

  cyclePhase() { this.override = this.override === null ? 0 : this.override + 1 < this.phases.length ? this.override + 1 : null; }

  // is this already part of the night (the gradual reveal)?
  has(what) { return unlocked(this.phase.name, what); }

  // how far the trip level may go in this phase
  get tripCap() { return this.phase.trip; }
  get trailBoost() { return this.phase.trails; }
  // chance that a breakdown becomes a brain moment (the show also keeps them at least 2.5 min apart)
  get brainChance() { return this.phase.brain ?? 0.5; }
  // chance that her trip up to the wall leaves a journey snippet in the cube (instead of the brain)
  get snippetChance() { return this.phase.snippet ?? 0.4; }
  // weights for a breakdown's mind moment: the brain scene or the head journey (more journeys later in the night)
  get mindWeights() { return { brain: 1, journey: this.phase.journey ?? 1 }; }

  // remember what was used, for variety across the night
  used(kind, name) {
    (this.night.usage[kind] ||= {})[name] = Date.now();
    this.memory.dirty = true;
  }

  // weighted random pick: weights from the phase (if given), recently used = much less likely (fades over ~15 min)
  // fresh: how much more likely something is that wasn't used yet tonight (a first appearance)
  pick(kind, options, weights = {}, exclude = [], fresh = 1) {
    const now = Date.now(), usage = this.night.usage[kind] || {};
    const cand = options.filter((o) => !exclude.includes(o) && (weights[o] ?? 1) > 0);
    if (!cand.length) return options[0];
    const w = cand.map((o) => (weights[o] ?? 1) * (usage[o] ? 1 : fresh) * (1 - 0.8 * Math.exp(-(now - (usage[o] || 0)) / 900e3)));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    this.used(kind, cand[i]);
    return cand[i];
  }

  // the scene for normal parts, from what this phase allows
  pickScene(exclude = []) {
    const sc = this.phase.scenes;
    return this.pick("scene", Object.keys(sc), sc, exclude);
  }

  // a drop happened: FULL or not? Rationed by the phase, and less often when the last drops came thick and fast
  dropGetsFull() {
    const now = Date.now();
    this.night.drops.push(now);
    this.night.drops = this.night.drops.filter((t) => now - t < 3600e3);
    this.night.fulls = this.night.fulls.filter((t) => now - t < 3600e3);
    const recentFulls = this.night.fulls.filter((t) => now - t < 10 * 60e3).length;   // FULLs in the last 10 min
    const chance = this.phase.full * Math.pow(0.6, recentFulls);
    const yes = Math.random() < chance;
    if (yes) this.night.fulls.push(now);
    this.memory.dirty = true;
    return yes;
  }

  status() {
    const m = this.minutes, i = this.phases.indexOf(this.phase), nx = this.phases[i + 1];
    const at = (x) => { const c = ((NIGHT_START + x) % 1440 + 1440) % 1440; return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(Math.floor(c % 60)).padStart(2, "0")}`; };
    return `${this.phase.name}${this.override !== null ? " (forced)" : ""}${m < 0 ? "  (before 19:00)" : ""}` +
      `${nx && this.override === null ? `  next: ${nx.name} at ${at(nx.from)}` : ""}` +
      `   drops/h ${this.night.drops.length}`;
  }
}
