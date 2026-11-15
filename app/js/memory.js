// Musical memory: a library of motifs (2-bar fingerprints of each instrument group) and what the show did with each
// one, so a returning lead or bassline gets the same move / colours again - repeating motifs, repeating images.
// Saved through the local server (POST /api/memory) and loaded on start, so a reload or crash keeps the memory.

const MATCH = 0.88;          // cosine similarity above which a fingerprint counts as a known motif
const MAX_PER_GROUP = 150;

export class MusicMemory {
  constructor() {
    this.data = { motifs: {}, saved: null };   // motifs[group] = [{ id, vec, assoc, hits, first, last }]
    this.nextId = 1;
    this.dirty = false;
  }

  async load() {
    try {
      const r = await fetch("api/memory");
      if (r.ok) {
        const d = await r.json();
        if (d && d.motifs) {
          this.data = d;
          this.nextId = 1 + Math.max(0, ...Object.values(d.motifs).flat().map((m) => m.id));
        }
      }
    } catch { /* no memory yet */ }
    const n = Object.values(this.data.motifs).reduce((a, l) => a + l.length, 0);
    console.info(`memory: ${n} motifs loaded`);
    setInterval(() => this.save(), 30000);    // keep it on disk while the show runs
    addEventListener("beforeunload", () => this.save(true));
  }

  save(beacon = false) {
    if (!this.dirty) return;
    this.data.saved = new Date().toISOString();
    const body = JSON.stringify(this.data);
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("api/memory", body);
    else fetch("api/memory", { method: "POST", body, headers: { "Content-Type": "application/json" } }).catch(() => {});
    this.dirty = false;
  }

  // a fingerprint was heard: returns { motif, isNew } (the known motif it matches, or a new one)
  observe(group, vec) {
    const list = (this.data.motifs[group] ||= []);
    let best = null, bestSim = -1;
    for (const m of list) {
      if (m.vec.length !== vec.length) continue;
      let dot = 0;
      for (let i = 0; i < vec.length; i++) dot += vec[i] * m.vec[i];
      if (dot > bestSim) { bestSim = dot; best = m; }
    }
    const now = Date.now();
    this.dirty = true;
    if (best && bestSim >= MATCH) {
      best.hits++; best.last = now;
      // let the stored fingerprint drift a little towards the latest version of the motif
      for (let i = 0; i < vec.length; i++) best.vec[i] = 0.9 * best.vec[i] + 0.1 * vec[i];
      return { motif: best, isNew: false, sim: bestSim };
    }
    const motif = { id: this.nextId++, vec: Array.from(vec, (v) => Math.round(v * 1e4) / 1e4), assoc: null, hits: 1, first: now, last: now };
    list.push(motif);
    if (list.length > MAX_PER_GROUP) {                    // forget the least useful old motifs
      list.sort((a, b) => b.hits * 1e12 + b.last - (a.hits * 1e12 + a.last));
      list.length = MAX_PER_GROUP;
    }
    return { motif, isNew: true, sim: bestSim };
  }

  remember(motif, assoc) { motif.assoc = { ...(motif.assoc || {}), ...assoc }; this.dirty = true; }
}
