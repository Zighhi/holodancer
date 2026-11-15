// A holographic dancer: a rigged character (Mixamo FBX or glTF) with a rim-glow material, a library of dance moves
// that crossfade into each other, every move locked to the beat.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Look presets. "hologram": for the Pepper's ghost, which only shows light - faint violet body, thin warm edge light,
// glowing trails on black. "projector": the D5 label art - dark silhouette, warm halo, lavender, ghost smears.
export const LOOKS = {
  hologram: { background: "#000000", body: "#000000", bodyGlow: "#30245a", rim: "#ffc94d", rimPower: 3.0,
    rimBase: 0.55, rimKick: 0.6, ambient: 0.0, bloom: 0.55, bloomThreshold: 0.12,
    trails: "glow", damp: 0.86, dampQuiet: 0.93 },
  projector: { background: "#a497c4", body: "#0a0910", bodyGlow: "#000000", rim: "#ffcf5a", rimPower: 3.2,
    rimBase: 0.45, rimKick: 0.5, ambient: 0.35, bloom: 0.35, bloomThreshold: 0.85,
    trails: "exposure", damp: 0.72, dampQuiet: 0.85 },
};

// Colour palettes the show cycles through: two-tone rim (head -> feet), body glow, and 3 accents for the layers
// (particles, shapes, mandala, whip = first accent). The first is the D5 look.
export const PALETTES = [
  { name: "D5 gold", rim: "#ffc94d", rim2: "#ff5fa2", glow: "#30245a", accents: ["#ff5fa2", "#4fd8ff", "#ffb347"] },
  { name: "ultraviolet", rim: "#c77dff", rim2: "#4fd8ff", glow: "#1d1a5e", accents: ["#4fd8ff", "#ff4fd8", "#9d7bff"] },
  { name: "ice & fire", rim: "#7fe7ff", rim2: "#ff7a3d", glow: "#10335a", accents: ["#ff7a3d", "#7fe7ff", "#ffe066"] },
  { name: "rose", rim: "#ff6fb5", rim2: "#ffd36b", glow: "#3d1240", accents: ["#ffd36b", "#b26bff", "#ff6fb5"] },
  { name: "acid", rim: "#b8ff4d", rim2: "#ff4fd8", glow: "#16351f", accents: ["#ff4fd8", "#4dffe1", "#fff04d"] },
  { name: "ember", rim: "#ff7a3d", rim2: "#ffd84d", glow: "#3a1408", accents: ["#ffd84d", "#ff3d6e", "#7a5cff"] },
  { name: "jungle", rim: "#4dffb0", rim2: "#ffe14d", glow: "#0e3326", accents: ["#ffe14d", "#ff6b4d", "#4dc3ff"] },
];

export function rimMaterial() {
  const uniforms = {
    uRimColor: { value: new THREE.Color("#ffc94d") },
    uRimColor2: { value: new THREE.Color("#ff5fa2") },
    uRimPower: { value: 3.0 },
    uRimStrength: { value: 0.5 },
    uHeadBone: { value: -1 },        // skeleton index of the head bone (-1 = none)
    uHeadMask: { value: 0 },         // rim fade on the back/top of the head (0 = off; for a hidden own hair mesh)
    uSlice: { value: 0 },            // 1 = only thin horizontal bands are drawn (MRI-style sections of her)
    uSliceFreq: { value: 38 },       // bands per metre
    uSliceOffset: { value: 0 },      // moves the bands (with the beat)
    uSliceWidth: { value: 0.22 },    // band width as a fraction of the spacing
  };
  const mat = new THREE.MeshPhongMaterial({ color: "#000000", shininess: 8, specular: "#1a1a1a" });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // vertex: how strongly this vertex belongs to the head bone (from the skin weights)
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float uHeadBone;\nvarying float vHead;\nvarying float vFace;\nvarying float vWorldY;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n        vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;")
      .replace("#include <skinbase_vertex>", `#include <skinbase_vertex>
        vHead = 0.0;
        vFace = smoothstep(-0.2, 0.5, normal.z);   // rest-pose normal pointing forward = face (kept lit)
        #ifdef USE_SKINNING
          vHead = skinWeight.x * step(abs(skinIndex.x - uHeadBone), 0.5) + skinWeight.y * step(abs(skinIndex.y - uHeadBone), 0.5)
                + skinWeight.z * step(abs(skinIndex.z - uHeadBone), 0.5) + skinWeight.w * step(abs(skinIndex.w - uHeadBone), 0.5);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {",
        "uniform vec3 uRimColor;\nuniform vec3 uRimColor2;\nuniform float uRimPower;\nuniform float uRimStrength;\n" +
        "uniform float uHeadMask;\nuniform float uSlice;\nuniform float uSliceFreq;\nuniform float uSliceOffset;\nuniform float uSliceWidth;\n" +
        "varying float vHead;\nvarying float vFace;\nvarying float vWorldY;\nvoid main() {")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uSlice > 0.5 && fract(vWorldY * uSliceFreq + uSliceOffset) > uSliceWidth) discard;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
        vec3 rimCol = mix(uRimColor2, uRimColor, smoothstep(-0.9, 0.9, -vViewPosition.y));   // two-tone, head to feet
        // fade the rim on the back/top of the head only (no outline of the old haircut), keep the face lit
        float headFade = 1.0 - uHeadMask * clamp(vHead, 0.0, 1.0) * (1.0 - vFace);
        totalEmissiveRadiance += rimCol * pow(clamp(1.0 - ndv, 0.0, 1.0), uRimPower) * uRimStrength * headFade;`);
  };
  mat.userData.uniforms = uniforms;
  return mat;
}

// The dance's own step period from the hips bobbing up and down (autocorrelation), and where the "down" falls.
function analyseClip(clip) {
  const track = clip.tracks.find((t) => /hips/i.test(t.name) && t.name.endsWith(".position"));
  if (!track) return { period: 0.6, offset: 0 };
  const rate = 60, n = Math.floor(clip.duration * rate);
  if (n < rate) return { period: 0.6, offset: 0 };
  const y = new Float32Array(n);
  const interp = track.createInterpolant();
  for (let i = 0; i < n; i++) y[i] = interp.evaluate(i / rate)[1];
  const w = rate, hp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w / 2); k < Math.min(n, i + w / 2); k++) { s += y[k]; c++; }
    hp[i] = y[i] - s / c;
  }
  let best = 0.6, bestScore = -Infinity;
  for (let lag = Math.round(0.33 * rate); lag <= Math.round(1.1 * rate); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += hp[i] * hp[i - lag];
    s /= n - lag;
    if (s > bestScore) { bestScore = s; best = lag / rate; }
  }
  let sx = 0, sy = 0;
  for (let p = 0; p + best <= clip.duration; p += best) {
    let minI = Math.floor(p * rate);
    for (let i = Math.floor(p * rate); i < Math.min(n, Math.floor((p + best) * rate)); i++) if (hp[i] < hp[minI]) minI = i;
    const ph = ((minI / rate) / best) % 1 * 2 * Math.PI;
    sx += Math.cos(ph); sy += Math.sin(ph);
  }
  return { period: best, offset: ((Math.atan2(sy, sx) / (2 * Math.PI)) + 1) % 1 * best };
}

// Where the skeleton's hips hang: rotation and scale of the hips bone's parent in the file's own scene. Mixamo exports
// differ (FBX: Y-up centimetres; some GLBs: Z-up root rotated and scaled 0.01), so moves are converted between frames.
function hipsFrame(scene) {
  scene.updateMatrixWorld(true);
  let hips = null;
  scene.traverse((o) => { if (!hips && /hips$/i.test(o.name)) hips = o; });
  if (!hips || !hips.parent) return null;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  hips.parent.matrixWorld.decompose(p, q, s);
  return { q, s: s.x };
}

// returns a function that rewrites a clip's hips position/rotation tracks from frame `from` into frame `to`
function convertHips(from, to) {
  if (!from || !to) return null;
  const qc = to.q.clone().invert().multiply(from.q);            // rotation from the move's frame into ours
  const sc = from.s / to.s;                                      // and the scale between them
  if (Math.abs(sc - 1) < 1e-4 && Math.abs(qc.w) > 0.99999) return null;   // same frame: nothing to do
  const v = new THREE.Vector3(), q = new THREE.Quaternion();
  return (clip) => clip.tracks.forEach((t) => {
    const prop = t.name.split(".").pop(), node = t.name.slice(0, -prop.length - 1);
    if (!/hips$/i.test(node)) return;
    const a = t.values;
    if (prop === "position") {
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i + 1], a[i + 2]).applyQuaternion(qc).multiplyScalar(sc);
        a[i] = v.x; a[i + 1] = v.y; a[i + 2] = v.z;
      }
    } else if (prop === "quaternion") {
      for (let i = 0; i < a.length; i += 4) {
        q.set(a[i], a[i + 1], a[i + 2], a[i + 3]).premultiply(qc);
        a[i] = q.x; a[i + 1] = q.y; a[i + 2] = q.z; a[i + 3] = q.w;
      }
    }
  });
}

// how energetic a move is: average rotation speed of all joints (radians per second)
function clipEnergy(clip) {
  let sum = 0, n = 0;
  for (const t of clip.tracks) {
    if (!t.name.endsWith(".quaternion") || t.times.length < 2) continue;
    const v = t.values, tm = t.times;
    for (let i = 1; i < tm.length; i++) {
      const d = Math.abs(v[i * 4] * v[i * 4 - 4] + v[i * 4 + 1] * v[i * 4 - 3] + v[i * 4 + 2] * v[i * 4 - 2] + v[i * 4 + 3] * v[i * 4 - 1]);
      sum += 2 * Math.acos(Math.min(1, d)) / Math.max(1e-3, tm[i] - tm[i - 1]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

const HIDE_OWN_HAIR = false;   // true: hide the character's own hair mesh (when a different hair replaces it)

// upper body = chest and above (Spine1/Spine2, neck, head, shoulders, arms, hands); the rest is lower body
const isUpperBone = (n) => /spine[12]|neck|head|shoulder|arm|hand/i.test(n);

// "mixamorig9:LeftArm" / "mixamorigLeftArm" / "mixamorig1_LeftArm" -> "leftarm"
const boneKey = (n) => n.replace(/^.*mixamorig\d*[:_]?/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();

const nameFromUrl = (url) => decodeURIComponent(url.split("/").pop().replace(/\.(fbx|glb|gltf)$/i, ""));

async function loadModel(url) {
  if (/\.fbx$/i.test(url)) {
    const obj = await new FBXLoader().loadAsync(url);
    return { scene: obj, animations: obj.animations, unitScale: 0.01 };     // Mixamo FBX is in centimetres
  }
  const gltf = await new GLTFLoader().loadAsync(url);
  return { scene: gltf.scene, animations: gltf.animations, unitScale: 1 };
}

export class Dancer {
  // characterUrl: rigged character (.fbx "with skin" or .glb); danceUrls: extra animation files (.fbx "without skin")
  static async load(characterUrl, danceUrls = []) {
    const model = await loadModel(characterUrl);
    const dancer = new Dancer(model);
    for (const url of danceUrls) {
      try {
        const m = await loadModel(url);
        m.scene.scale.multiplyScalar(m.unitScale);
        const conv = convertHips(hipsFrame(m.scene), dancer.hipsFrame);   // the move file's skeleton frame -> ours
        // the first animation in a file is named after the file (so moves.json can use the file name); any further
        // ones (files "with skin" can carry several) get the clip name added
        let n = 0;
        m.animations.forEach((clip) => {
          if (/t-?pose/i.test(clip.name)) return;
          if (conv) conv(clip);
          dancer.addClip(clip, n++ === 0 ? nameFromUrl(url) : `${nameFromUrl(url)} - ${clip.name}`);
        });
      } catch (err) { console.warn("could not load dance", url, err); }
    }
    // a character without its own animation (a Mixamo T-pose download) starts with a random move from the library
    if (!dancer.layers.length && dancer.moves.length) dancer.play(dancer.moves[0 | Math.random() * dancer.moves.length].name, 0);
    console.info(`dancer: ${dancer.moves.length} moves`, dancer.moves.map((m) => `${m.name} (${(60 / m.period).toFixed(0)} BPM)`));
    return dancer;
  }

  constructor(model) {
    this.root = new THREE.Group();
    model.scene.scale.multiplyScalar(model.unitScale);
    this.root.add(model.scene);
    this.model = model.scene;
    this.unitScale = model.unitScale;
    this.hipsFrame = hipsFrame(this.root);      // our skeleton's frame, for converting moves from other files
    this.history = [];         // recent poses { t, layers: [{ clip, time, weight }] } for the time echoes
    this.material = rimMaterial();
    model.scene.traverse((o) => {
      if (o.isMesh) {
        // her own (short) hair mesh stays: it gives the real haircut on top; the long physics hair grows from under it
        const matNames = [].concat(o.material).map((m) => m?.name || "").join(" ");
        if (HIDE_OWN_HAIR && (/hair/i.test(o.name) || /hair/i.test(matNames))) o.visible = false;
        o.material = this.material; o.frustumCulled = false; o.castShadow = false;
        // tell the rim shader which skeleton bone is the head (its outline is faded, the long hair takes over)
        if (o.isSkinnedMesh) {
          const hi = o.skeleton.bones.findIndex((b) => /head$/i.test(b.name));
          if (hi >= 0) this.material.userData.uniforms.uHeadBone.value = hi;
        }
      }
      if (o.isBone && /righthand$/i.test(o.name)) this.rightHand = o;
      if (o.isBone && /righthandmiddle1$/i.test(o.name)) this.rightFinger = o;
    });
    this.bones = new Map();                     // prefix-free bone key -> the character's real bone name
    model.scene.traverse((o) => { if (o.isBone || o.type === "Bone") this.bones.set(boneKey(o.name), o.name); });
    this.mixer = new THREE.AnimationMixer(model.scene);
    this.moves = [];
    model.animations.forEach((c) => this.addClip(c, c.name));
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.height = box.max.y - box.min.y || 1.7;
    this.layers = [];          // playing moves: { move, action, time, weight, target }
    this.halfTime = false;
    this.glowBase = new THREE.Color();   // body glow colour; shown x glowGain (set by the show)
    this.glowGain = 1;
    this.stepsPerBeat = 0;     // stutter: 0 = smooth, 1 = quarters, 2 = 8ths, 3 = triplets, 4 = 16ths, 0.25 = bar hold
    this.stepOffset = 0;       // 0.5 = steps land on the offbeat
    this.lastStep = -1;
    this.stepFlash = 0;        // 1 on each new stutter step, decays fast (for strobe flashes)
    this.stutterAmt = 0; this.lastRate = 4; this.releaseDur = 0.5;      // stutter amount + fade in/out time
    this.accents = { sway: 0, twist: 0, nod: 0 };   // musical accents on top of the moves (set by the show)
    this.accentBones = {};
    model.scene.traverse((o) => {
      if (!o.isBone) return;
      for (const [k, re] of Object.entries({ hips: /hips$/i, spine: /spine$/i, spine2: /spine2$/i, head: /head$/i })) {
        if (re.test(o.name) && !this.accentBones[k]) this.accentBones[k] = o;
      }
    });
    this.looping = 0;
    this.recent = [];
    this.comboChance = 0.4; this.badCombos = new Set(); this.noUpper = new Set(); this.wholeOnly = new Set();
    this.family = new Map(); this.compatible = new Set();
    if (this.moves.length) this.play(this.moves[0].name, 0);
  }

  addClip(clip, name) {
    if (/t-?pose|idle$/i.test(name) || clip.duration < 1) return;
    clip.name = name;
    // match bones by name without the Mixamo prefix (mixamorig:, mixamorig1:, mixamorig9: ...), so any Mixamo dance
    // drives any Mixamo character; tracks for bones she doesn't have are dropped
    let matched = 0;
    clip.tracks = clip.tracks.filter((t) => {
      const dot = t.name.lastIndexOf("."), bone = this.bones.get(boneKey(t.name.slice(0, dot)));
      if (!bone) return false;
      t.name = bone + t.name.slice(dot);
      matched++;
      return true;
    });
    if (matched < 10) { console.warn(`move "${name}": only ${matched} tracks match the character's bones - skipped`); return; }
    // keep dances in place: drop horizontal hip travel (keeps the vertical bounce)
    const hips = clip.tracks.find((t) => /hips/i.test(t.name) && t.name.endsWith(".position"));
    if (hips) {
      const v = hips.values, x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
    }
    this.moves.push({ name, clip, energy: clipEnergy(clip), ...analyseClip(clip) });
  }

  get current() { return this.layers.length ? this.layers[this.layers.length - 1].info : null; }

  // a move's lower body (hips, spine, legs) or upper body (chest, neck, head, shoulders, arms, hands) as its own clip
  part(move, which, alt = false) {
    if (which === "full") return alt ? (move.clipAlt ||= move.clip.clone()) : move.clip;
    const key = (which === "upper" ? "upperClip" : "lowerClip") + (alt ? "Alt" : "");
    if (!move[key]) {
      const tracks = move.clip.tracks.filter((t) => isUpperBone(t.name.slice(0, t.name.lastIndexOf("."))) === (which === "upper"));
      move[key] = new THREE.AnimationClip(`${move.name} [${which}]`, move.clip.duration, tracks);
    }
    return move[key];
  }

  // play a move, or a body-split combo: legs from `name`, torso/arms/head from `upperName`
  play(name, fade = 1.5, upperName = null) {
    const move = this.moves.find((m) => m.name === name);
    if (!move) return;
    const upper = upperName ? this.moves.find((m) => m.name === upperName && m !== move) : null;
    if (!this.playParts(move, upper || move, fade)) return;
    this.recent = [move.name, ...this.recent.filter((n) => n !== move.name)].slice(0, 3);
    const now = performance.now() / 1000;
    move.lastUsed = now;
    if (upper) upper.lastUsed = Math.max(upper.lastUsed || 0, now - 60);   // counts as half a use
  }

  // the moves currently driving the legs and the upper body
  get lowerMove() { const l = this.layers[this.layers.length - 1]; return l ? l.parts[0].move : null; }
  get upperMove() { const l = this.layers[this.layers.length - 1]; return l ? (l.parts[1] || l.parts[0]).move : null; }

  // Build a new layer: legs from lowerMove, upper body from upperMove (same move = whole body). A half that stays
  // the same CONTINUES exactly where it is, so changing only the arms (or only the legs) is seamless.
  playParts(lowerMove, upperMove, fade = 1.5, jump = false) {
    if (!this.comboOk(lowerMove, upperMove)) {                     // against the rules: find a fitting upper body
      upperMove = this.similar(lowerMove, [lowerMove], (m) => this.comboOk(lowerMove, m)) || lowerMove;
    }
    const cur = this.layers[this.layers.length - 1];
    if (!jump && cur && lowerMove === this.lowerMove && upperMove === this.upperMove) return false;
    const old0 = cur?.parts[0];
    const stepPhase = old0 ? (((old0.time - old0.move.offset) / old0.move.period) % 1 + 1) % 1 : 0;
    const f = Math.max(fade, 1e-3);
    const make = (m, which) => {
      let clip = this.part(m, which);
      if (jump) {                                                  // a jump: use whichever copy is not playing
        const busy = (c) => this.layers.some((l) => l.parts.some((pt) => pt.clip === c && (pt.weight > 0 || pt.target > 0)));
        if (busy(clip)) clip = this.part(m, which, true);
      } else {
        // the very same half is already playing: hand it over as it is (full weight, same time) - seamless
        const keep = cur?.parts.find((pt) => pt.clip === clip && pt.target > 0);
        if (keep) { cur.parts.splice(cur.parts.indexOf(keep), 1); keep.loop = null; return keep; }
      }
      const action = this.mixer.clipAction(clip);
      action.reset().play();
      action.setEffectiveWeight(fade > 0 ? 0 : 1);
      const base = { clip, action, weight: fade > 0 ? 0 : 1, target: 1, fade: f };
      const same = jump ? null : cur?.parts.find((pt) => pt.move === m);   // same move, other clip: continue its timing
      if (same) return { move: m, ...base, time: same.time, held: same.held, heldTarget: same.heldTarget };
      // otherwise: same point of the step as before (crossfade stays in time), at a RANDOM step in the clip -
      // long Mixamo clips contain several different steps, so a repeat looks different
      const startStep = Math.floor(Math.random() * Math.max(1, m.clip.duration / m.period - 1));
      return { move: m, ...base, time: m.offset + (startStep + stepPhase) * m.period };
    };
    const parts = lowerMove === upperMove ? [make(lowerMove, "full")] : [make(lowerMove, "lower"), make(upperMove, "upper")];
    const label = lowerMove === upperMove ? lowerMove.name : `${lowerMove.name} + ${upperMove.name} (arms)`;
    this.layers.forEach((l) => l.parts.forEach((pt) => { pt.target = 0; pt.fade = f; }));   // the rest fades out
    this.looping = 0;                                               // the new parts play straight on
    this.layers.push({ parts, info: { name: label, period: lowerMove.period, offset: lowerMove.offset, combo: lowerMove !== upperMove } });
    return true;
  }

  // may legs from `lo` be combined with the upper body of `up`? (rules from moves.json + a check of the motion)
  comboOk(lo, up) {
    if (!lo || !up || lo === up) return true;
    if (this.wholeOnly.has(lo.name) || this.wholeOnly.has(up.name) || this.noUpper.has(up.name)) return false;
    if (this.badCombos.has(`${lo.name}|${up.name}`)) return false;
    const fa = this.family.get(lo.name), fb = this.family.get(up.name);
    if (fa && fb && fa !== fb && !this.compatible.has(`${fa}|${fb}`)) return false;
    const tempo = Math.abs(Math.log2(lo.period / up.period));        // step tempos within ~1.3x of each other
    const tempoOk = Math.min(tempo, Math.abs(tempo - 1)) < 0.38;     // (or one is double/half the other)
    const es = this.moves.map((m) => m.energy), span = Math.max(...es) - Math.min(...es) || 1;
    return tempoOk && Math.abs(lo.energy - up.energy) / span < 0.45;
  }

  // a move with an energy close to `ref`, not one of `exclude`, a bit random (for arms-only / legs-only changes)
  similar(ref, exclude = [], ok = () => true) {
    const es = this.moves.map((m) => m.energy), span = Math.max(...es) - Math.min(...es) || 1;
    const c = this.moves.filter((m) => !exclude.includes(m) && ok(m))
      .map((m) => ({ m, d: Math.abs(m.energy - ref.energy) / span + 0.35 * Math.random() - (m.lastUsed ? 0 : 0.1) }))
      .sort((a, b) => a.d - b.d);
    return c.length ? c[0].m : null;
  }

  // jump to a different step inside the moves she is dancing (a quick crossfade, in time with the beat)
  jump(fade = 0.35) { if (this.lowerMove) this.playParts(this.lowerMove, this.upperMove, fade, true); }

  // loop a chunk of `steps` dance steps from where she is now (null = play straight on)
  setLoop(steps) {
    const l = this.layers[this.layers.length - 1];
    if (!l) return;
    for (const pt of l.parts) {
      const m = pt.move, k = Math.floor((pt.time - m.offset) / m.period);
      pt.loop = steps ? { start: m.offset + k * m.period, len: steps * m.period } : null;
    }
    this.looping = steps || 0;
  }

  // the melody changed: new arms/upper body, legs keep dancing
  changeUpper(fade = 1.2) {
    const lo = this.lowerMove, up = this.upperMove;
    if (!lo) return;
    const m = this.similar(up || lo, [lo, up], (x) => this.comboOk(lo, x));
    if (m) this.playParts(lo, m, fade);
    else { const w = this.similar(lo, [lo, up]); if (w) this.playParts(w, w, fade); }   // nothing fits: a whole new move
  }

  // the bass changed: new legs/hips, the upper body keeps dancing
  changeLower(fade = 1.2) {
    const lo = this.lowerMove, up = this.upperMove;
    if (!lo) return;
    const m = this.similar(lo, [lo, up], (x) => this.comboOk(x, up || lo));
    if (m) this.playParts(m, up || lo, fade);
    else { const w = this.similar(lo, [lo, up]); if (w) this.playParts(w, w, fade); }   // nothing fits: a whole new move
  }

  // the next move: only from the pool of the moment (breakdown/build/drop/peak/normal), never one of the last few.
  // Within the pool the audio picks: the move's motion energy should match how intense/full the music is, and its own
  // step tempo should fit the track's BPM (straight or half time); a little randomness keeps it unpredictable.
  next(fade = 1.5, moment = null, audio = null) {
    // every move is a candidate; the moment's pool is a strong preference, not a rule (~70% pool, ~30% surprises)
    const inPool = new Set(moment && this.pools?.[moment] ? this.pools[moment] : []);
    // this.avoid: moves someone else is dancing right now (the projector's dancer avoids the hologram's)
    const avoid = this.avoid || [];
    let fresh = this.moves.filter((m) => !this.recent.includes(m.name) && m !== this.current && !avoid.includes(m.name));
    if (!fresh.length) fresh = this.moves.filter((m) => m !== this.current && !avoid.includes(m.name));
    if (!fresh.length) fresh = this.moves.filter((m) => m !== this.current);
    if (!fresh.length) return;
    // score each candidate, then draw one at random weighted by score (good fits are likelier, every move gets turns)
    const now = performance.now() / 1000;
    const live = audio && audio.running && audio.bpm > 0;
    const es = this.moves.map((m) => m.energy), lo = Math.min(...es), hi = Math.max(...es);
    const want = live ? Math.min(1, 0.45 * audio.intensity + 0.35 * Math.min(1, audio.densityRel) + 0.2 * audio.onset) : 0.5;
    const score = (m) => {
      let sc = 0;
      if (live) {
        const e = hi > lo ? (m.energy - lo) / (hi - lo) : 0.5;
        const r = audio.bpm / (60 / m.period);                      // speed-up the move would need
        const tempoMiss = Math.min(Math.abs(Math.log2(r)), Math.abs(Math.log2(r / 2)));
        sc += -1.2 * Math.abs(e - want) - 0.6 * tempoMiss;
      }
      if (m.lastUsed) sc -= 2 * Math.exp(-(now - m.lastUsed) / 120);  // used recently: much less likely (fades ~2 min)
      if (inPool.has(m.name)) sc += 1.0;                             // fits the moment
      return sc;
    };
    const w = fresh.map((m) => Math.exp(score(m) / 0.4));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    const pick = fresh[i];
    // body-split: ~40 % of the time, the upper body comes from another move with a similar energy
    let upperName = null;
    if (Math.random() < this.comboChance && this.moves.length > 2) {
      const cands = this.moves.filter((m) => m !== pick && this.comboOk(pick, m))
        .map((m) => ({ m, d: Math.abs(m.energy - pick.energy) / (hi - lo || 1) + 0.3 * Math.random() }))
        .sort((a, b) => a.d - b.d);
      if (cands.length) upperName = cands[0 | Math.random() * Math.min(4, cands.length)].m.name;
    }
    this.play(pick.name, fade, upperName);
  }

  // moments -> move names, from moves.json; moves not listed anywhere are sorted in by energy (calm third ->
  // breakdown + normal, middle -> build + normal, wildest third -> drop + peak); "skip" removes moves
  setPools(cfg = {}) {
    this.addSegments(cfg.segments || {});                         // cut-out highlights become moves too
    const moments = ["breakdown", "build", "drop", "peak", "normal"];
    const base = (n) => n;
    const skip = new Set(cfg.skip || []);
    this.comboChance = cfg.comboChance ?? 0.4;                    // how often moves are body-split mixed
    this.badCombos = new Set((cfg.badCombos || []).map((c) => c.replace(/\s*\+\s*/, "|")));   // "A + B" pairs to avoid
    this.noUpper = new Set(cfg.noUpper || []);                    // moves whose arms/upper body are never mixed in
    this.wholeOnly = new Set(cfg.wholeOnly || []);                // moves that are never split at all
    this.family = new Map();                                      // move -> dance family
    for (const [fam, names] of Object.entries(cfg.families || {})) names.forEach((n) => this.family.set(n, fam));
    this.compatible = new Set((cfg.compatible || []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    this.moves = this.moves.filter((m) => !skip.has(base(m.name)));
    const known = new Set(this.moves.map((m) => base(m.name)));
    this.pools = {};
    for (const k of moments) {
      const names = new Set(cfg[k] || []);
      this.pools[k] = this.moves.filter((m) => names.has(base(m.name))).map((m) => m.name);
      [...names].filter((n) => !known.has(n) && !skip.has(n)).forEach((n) => console.warn(`moves.json: no move called "${n}"`));
    }
    const listed = new Set(moments.flatMap((k) => this.pools[k]));
    const auto = this.moves.filter((m) => !listed.has(m.name)).sort((a, b) => a.energy - b.energy);
    auto.forEach((m, i) => {
      const third = auto.length > 1 ? Math.floor(i / auto.length * 3) : 1;
      const into = [["breakdown", "normal"], ["build", "normal"], ["drop", "peak"]][third];
      into.forEach((k) => this.pools[k].push(m.name));
    });
    console.info("dancer pools", this.pools, auto.length ? `(${auto.length} sorted in automatically)` : "");
  }

  // segments: { "Twerk back squat": { "from": "Dancing Twerk", "start": 5.2, "end": 9.8 } } -> extra moves
  addSegments(segs) {
    for (const [name, sg] of Object.entries(segs)) {
      if (name.startsWith("_")) continue;
      const src = this.moves.find((m) => m.name === sg.from);
      if (!src) { console.warn(`segment "${name}": no move called "${sg.from}"`); continue; }
      const start = Math.max(0, sg.start), end = Math.min(src.clip.duration, sg.end);
      if (end - start < 1) { console.warn(`segment "${name}": shorter than 1 s`); continue; }
      const tracks = src.clip.tracks.map((t) => {
        const tr = t.clone();
        tr.trim(start, end);                                       // keep the keys in the range ...
        tr.shift(-start);                                          // ... and start them at 0
        return tr;
      });
      this.addClip(new THREE.AnimationClip(name, end - start, tracks), name);
      console.info(`segment "${name}": ${sg.from} ${start}-${end} s`);
    }
  }

  // the move and clip time on screen right now (for picking segment times with G)
  where() {
    const l = this.layers[this.layers.length - 1];
    return l ? l.parts.map((pt) => `${pt.move.name} @ ${pt.action.time.toFixed(2)} s`).join("  +  ") : "-";
  }

  setLook(look) {
    const u = this.material.userData.uniforms;
    this.material.color.set(look.body);
    this.glowBase.set(look.bodyGlow);
    u.uRimColor.value.set(look.rim);
    u.uRimColor2.value.set(look.rim);
    u.uRimPower.value = look.rimPower;
    this.look = look;
  }

  // blend the rim and body glow towards a palette (k = 0..1 per call, for smooth transitions)
  blendColors(palette, k, glowToo = true) {
    const u = this.material.userData.uniforms;
    u.uRimColor.value.lerp(new THREE.Color(palette.rim), k);
    u.uRimColor2.value.lerp(new THREE.Color(palette.rim2), k);
    if (glowToo) this.glowBase.lerp(new THREE.Color(palette.glow), k);
  }

  // dt in seconds; audio = AudioEngine.state (or null to free-run); extraRim for flashes
  update(dt, audio, extraRim = 0) {
    const u = this.material.userData.uniforms;
    const live = audio && audio.running && audio.bpm > 0;
    const div = this.halfTime ? 2 : 1;
    // stutter: hold the pose and only jump to the next one on the step grid (stepsPerBeat: 4 = 16ths, 3 = triplets,
    // 2 = 8ths, 1 = quarters, 0.25 = hold a bar; stepOffset 0.5 = jump on the offbeat).
    // It is an AMOUNT, not a switch: it fades in and out over releaseDur seconds (one beat). At 0 she moves
    // smoothly, at 0.5 she moves at half speed with half-size jumps, at 1 it is the full hold-and-jump.
    if (this.stepsPerBeat > 0) this.lastRate = this.stepsPerBeat;
    const want = this.stepsPerBeat > 0 ? 1 : 0;
    this.stutterAmt += Math.sign(want - this.stutterAmt) * Math.min(Math.abs(want - this.stutterAmt), dt / this.releaseDur);
    const amt = this.stutterAmt * this.stutterAmt * (3 - 2 * this.stutterAmt);     // eased
    let newStep = false;
    if (this.stutterAmt > 0) {
      const rate = this.stepsPerBeat > 0 ? this.stepsPerBeat : this.lastRate;      // keep the grid while fading out
      const pos = live ? (audio.beatCount + audio.beatPhase + this.stepOffset) * rate : performance.now() / 1000 * 8;
      const step = Math.floor(pos);
      newStep = step !== this.lastStep;
      if (newStep) { this.lastStep = step; this.stepFlash = amt; }
    }
    this.stepFlash = Math.max(0, this.stepFlash - dt * 8);
    for (const l of this.layers) {
      for (const pt of l.parts) {                  // each part keeps its own beat lock and its own weight
        pt.weight += Math.sign(pt.target - pt.weight) * Math.min(Math.abs(pt.target - pt.weight), dt / pt.fade);
        const m = pt.move;
        if (live) {
          pt.time += dt * m.period * audio.bpm / 60 / div;        // one dance step per beat (or two in half time)
          const beats = (audio.beatCount + audio.beatPhase) / div;
          let err = (beats - Math.floor(beats)) - ((((pt.time - m.offset) / m.period) % 1) + 1) % 1;
          if (err > 0.5) err -= 1;
          if (err < -0.5) err += 1;
          pt.time += err * m.period * Math.min(1, dt * 3);        // pull the step's "down" onto the beat
        } else {
          pt.time += dt;
        }
        if (pt.loop) {                                             // looping a chunk: wrap back by whole steps
          while (pt.time >= pt.loop.start + pt.loop.len) {
            pt.time -= pt.loop.len;
            if (pt.held !== undefined) { pt.held -= pt.loop.len; pt.heldTarget -= pt.loop.len; }
          }
        }
        // the time actually shown: a blend of the live time and the held (stepped) time by the stutter amount.
        // Each step glides over a few frames (soft step) instead of snapping.
        if (pt.held === undefined) pt.held = pt.heldTarget = pt.time;
        if (newStep || this.stutterAmt === 0) pt.heldTarget = pt.time;
        pt.held += (pt.heldTarget - pt.held) * Math.min(1, dt * 35);
        if (this.stutterAmt === 0) pt.held = pt.time;
        const shown = pt.time + (pt.held - pt.time) * amt;
        const d = pt.clip.duration;
        pt.action.time = ((shown % d) + d) % d;
        pt.action.setEffectiveWeight(pt.weight);
      }
    }
    for (const l of this.layers) {
      l.parts = l.parts.filter((pt) => {
        if (pt.target === 0 && pt.weight <= 0) { pt.action.stop(); return false; }
        return true;
      });
    }
    this.layers = this.layers.filter((l, i) => l.parts.length || i === this.layers.length - 1);
    this.mixer.update(0);
    this._accents(audio, live, amt);
    // remember the pose (as shown, so stutter holds are remembered too) for the echoes
    const now = performance.now() / 1000;
    this.history.push({ t: now, layers: this.layers.flatMap((l) => l.parts.map((pt) => ({ clip: pt.clip, time: pt.action.time, weight: pt.weight }))) });
    while (this.history.length > 2 && now - this.history[0].t > 2) this.history.shift();
    const L = this.look;
    u.uRimStrength.value = L.rimBase + (live ? L.rimKick * audio.kick + 0.25 * audio.onset : 0) + extraRim;
    u.uRimPower.value = L.rimPower * (live ? 1.25 - 0.5 * audio.bands.high : 1);   // hats widen the edge light
    this.material.emissive.copy(this.glowBase).multiplyScalar(this.glowGain);
  }

  // small musical movements on top of any move: hip sway (bass, once per 2 beats), torso twist (mids), head nods
  // (hats, every beat). Amounts (radians) come from this.accents, set per phrase by the show; they fade during stutter.
  _accents(audio, live, stutterAmt) {
    const A = this.accents, b = this.accentBones;
    if (!A || !b.hips) return;
    const beats = live ? audio.beatCount + audio.beatPhase : performance.now() / 1000 * 2;
    const bands = live ? audio.bands : { low: 0.5, mid: 0.5, high: 0.5 };
    const k = 1 - stutterAmt;
    const q = this._q || (this._q = new THREE.Quaternion()), ax = this._ax || (this._ax = new THREE.Vector3());
    const turn = (bone, x, y, z, ang) => { if (bone && ang) bone.quaternion.multiply(q.setFromAxisAngle(ax.set(x, y, z), ang)); };
    const sway = A.sway * (0.6 + 0.4 * bands.low) * Math.sin(Math.PI * beats) * k;
    const twist = A.twist * (0.6 + 0.4 * bands.mid) * Math.sin(Math.PI * beats / 2 + 1) * k;
    const nod = A.nod * (0.6 + 0.4 * bands.high) * (0.5 - 0.5 * Math.cos(2 * Math.PI * beats)) * k;
    turn(b.hips, 0, 0, 1, sway);
    turn(b.spine, 0, 0, 1, -0.6 * sway);                           // the upper body counters, so she stays upright
    turn(b.spine2, 0, 1, 0, twist);
    turn(b.head, 1, 0, 0, nod);
  }

  // world position of the right hand (for the whip); falls back to the hand height in front of the body
  handPosition(target = new THREE.Vector3()) {
    if (this.rightHand) return this.rightHand.getWorldPosition(target);
    return target.set(0.3, this.height * 0.55, 0.1);
  }

  // pose from `delay` seconds ago (nearest remembered frame)
  poseAgo(delay) {
    const want = performance.now() / 1000 - delay;
    let best = this.history[0];
    for (const h of this.history) if (Math.abs(h.t - want) < Math.abs(best.t - want)) best = h;
    return best;
  }
}

// A time echo: a glowing copy of the dancer that replays her pose from a moment ago (additive, see-through).
export class Echo {
  constructor(dancer, delay) {
    this.dancer = dancer;
    this.delay = delay;
    this.root = SkeletonUtils.clone(dancer.model);
    this.material = rimMaterial();
    Object.assign(this.material, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.material.color.set("#000000");
    this.material.userData.uniforms.uHeadBone.value = dancer.material.userData.uniforms.uHeadBone.value;
    this.root.traverse((o) => { if (o.isMesh) { o.material = this.material; o.frustumCulled = false; } });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map();
    this.level = 0;            // 0 = invisible, 1 = full echo
  }

  update(spread = 1) {
    this.root.visible = this.level > 0.01;
    if (!this.root.visible || !this.dancer.history.length) return;
    const pose = this.dancer.poseAgo(this.delay * spread);
    const used = new Set();
    for (const l of pose.layers) {
      let a = this.actions.get(l.clip);
      if (!a) { a = this.mixer.clipAction(l.clip); this.actions.set(l.clip, a); }
      if (!a.isRunning()) a.play();
      a.time = l.time;
      a.setEffectiveWeight(l.weight);
      used.add(l.clip);
    }
    for (const [clip, a] of this.actions) if (!used.has(clip)) a.stop();
    this.mixer.update(0);
  }

  // rim + body colours for this echo, and its brightness
  setColors(rim, rim2, glow, strength) {
    const u = this.material.userData.uniforms;
    u.uRimColor.value.copy(rim); u.uRimColor2.value.copy(rim2);
    u.uRimPower.value = 2.2;
    u.uRimStrength.value = 0.9 * strength;
    this.material.emissive.copy(glow).multiplyScalar(strength);
  }
}
