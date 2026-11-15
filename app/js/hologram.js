// The hologram show: the dancer plus psychedelic layers, all driven by the audio engine through a "trip" level.
// Keys: H look, M mirror, T half-time, N next move, W whip, C colours, K kaleidoscope, P trip level, S stutter, X scene, D fake drop,
//       B brain (auto / scene / head / off), J head journey (start / stop), Y scanner pass, E echo slices,
//       V send her to the other screen (cube <-> wall), Z a journey snippet (she goes up, the cube plays one stage),
//       Q unison (she is on both screens for 8 bars),
//       F fullscreen, U hide UI.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { AudioEngine } from "./audio.js";
import { Dancer, Echo, LOOKS, PALETTES } from "./dancer.js";
import { Whip } from "./whip.js";
import { Hair } from "./hair.js";
import { MusicMemory } from "./memory.js";
import { Director } from "./director.js";
import { FeedbackPass, PsyPass, Mandala, Orbiters } from "./psy.js";
import { Brain } from "./brain.js";
import { Head } from "./head.js";
import { Journey, SNIPPETS } from "./journey.js";
import { ShowLink, StatusReporter, listenRemote } from "./link.js";
import { Calibration } from "./calib.js";
import { glyphAtlas, DraftPass } from "./draft.js";
import { Tesseract } from "./tesseract.js";
import { loadSpine, SpineStack } from "./spine.js";

const $ = (id) => document.getElementById(id);
const engine = new AudioEngine();
// this window is the master: the projector window (projector.html) gets the music state and every event from here
const link = new ShowLink("master");
for (const name of ["drop", "section", "phrase", "surge", "predrop", "tempo"]) engine.on(name, (e) => link.emit(name, e));
engine.on("element", (e) => link.emit("element", { group: e.group, type: e.type }));
const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);

// ---------------------------------------------------------------- renderer + post-processing chain
// (no antialias: everything is drawn through the effect chain's own buffers, so it would only cost)
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.localClippingEnabled = true;            // the scanner cuts through her (clipping plane)
const FPS = +(new URLSearchParams(location.search).get("fps") || 60);   // the panel is 60 Hz
renderer.setPixelRatio(1);                              // the panel is 1080p: no more pixels than that
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 50);
const ambient = new THREE.AmbientLight("#7b6ea6", 0.3);
const backLight = new THREE.DirectionalLight("#ffe08a", 0.6);
backLight.position.set(0, 2.5, -3);
scene.add(ambient, backLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const feedback = new FeedbackPass();          // zoom/rotate/hue-shifted trails: the "tunnel"
composer.addPass(feedback);
const psy = new PsyPass();                    // kaleidoscope, liquid warp, RGB split, colour cycling, edge fade
composer.addPass(psy);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.2);
{ const set = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => set(w / 2, h / 2); }   // the glow at half size: ~4x cheaper
composer.addPass(bloom);
const holoDraft = new DraftPass(glyphAtlas());   // the drafting looks on her: now and then, or I (glyphs / dither / contours)
holoDraft.enabled = false;
holoDraft.uniforms.tElem.value = new THREE.DataTexture(new Uint8Array(4), 1, 1); holoDraft.uniforms.tElem.value.needsUpdate = true;
holoDraft.uniforms.uGrid.value = 0;                  // (no blueprint grid in the cube: it would light the whole sheet)
composer.addPass(holoDraft);
composer.addPass(new OutputPass());
const calib = new Calibration("holo", composer);   // R: flip / size / stretch / keystone for the acrylic sheet

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- the dancer (Mixamo files if present) + layers
let character = null, moves = [], pools = {};
try {
  const list = await (await fetch("api/dancers")).json();
  if (list.character) ({ character, moves, pools = {} } = list);
} catch { /* the server isn't answering: handled below */ }
if (!character) {
  document.body.insertAdjacentHTML("beforeend", '<p style="position:fixed;top:40%;width:100%;text-align:center;color:#f88;font:16px sans-serif">' +
    "No dancer: put the Mixamo character (.fbx) into app/assets/dancers and start serve.py</p>");
  throw new Error("no character in assets/dancers");
}
const dancer = await Dancer.load(character, moves);
dancer.setPools(pools);
const memory = new MusicMemory();
await memory.load();                           // motifs from earlier tonight (or earlier sessions)
const director = new Director(memory);         // phases of the night, variety, pacing (continues after a reload)
scene.add(dancer.root);
const H = dancer.height;
const whip = new Whip({ length: H * 0.75, radius: H * 0.0035 });
const hair = new Hair(dancer);                 // long glowing hair with physics
const mandala = new Mandala();
const echoes = [0.1, 0.2, 0.3, 0.4].map((d) => new Echo(dancer, d));   // time echoes, 0.1-0.4 s behind
const orbiters = new Orbiters(H);
scene.add(whip.mesh, hair.mesh, mandala.mesh, orbiters.group, ...echoes.map((e) => e.root));
// the brain, from the MRI (tools/volume -> assets/brain/brain.glb; the show runs without it if the file is missing)
let brain = null;
try { brain = await Brain.load(); scene.add(brain.root); } catch { console.info("no brain model (assets/brain/brain.glb)"); }
// the whole head + the MRI volume, for the journey face -> cut -> brain -> slices (tools/volume/make_head.py)
let head = null, journey = null;
if (brain) {
  try { head = await Head.load(); scene.add(head.root); journey = new Journey(head, brain); }
  catch (e) { console.info("no head model (assets/brain/head.glb):", e.message); }
}
const headBone = dancer.model.getObjectByName(dancer.bones.get("head") || "");
// ---- the scanner: a horizontal plane sweeps through her; below it she is gone (three.js clipping plane on her and
// her echoes) and a glowing sheet shows where it is. 'out' = she dissolves bottom-up, 'in' = she is rebuilt top-down
const scanPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 10);      // clip below y0: constant = -y0 (10 = off)
dancer.material.clippingPlanes = [scanPlane];
echoes.forEach((e) => (e.material.clippingPlanes = [scanPlane]));
const sheetMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color("#ffc94d") }, uColor2: { value: new THREE.Color("#4fd8ff") }, uLevel: { value: 0 }, uTime: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform vec3 uColor, uColor2; uniform float uLevel, uTime; varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float e = (r - 0.92) / 0.03, ring = exp(-e * e);
      float grid = smoothstep(0.92, 1.0, sin((vUv.x + vUv.y) * 160.0 + uTime * 6.0)) * 0.25;
      vec3 col = uColor * (0.25 * (1.0 - r) + ring * 1.2) + uColor2 * grid * (1.0 - r);
      gl_FragColor = vec4(col * uLevel * smoothstep(1.0, 0.85, r), 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.9, H * 0.9), sheetMat);
sheet.rotation.x = -Math.PI / 2;
sheet.renderOrder = 8;
sheet.visible = false;
scene.add(sheet);
let sweep = null, dancerGone = false, wasJourney = false, lastJourneyPhase = "-", bornT = -1e9;   // bornT: rebuilt from slices
// ---- where she is: one stage at a time. "holo" (the cube) -> "toWall" (she rises out of the cube onto the wall) ->
// "wall" (the brain takes her place in the cube) -> "toHolo" (she sinks back down into the cube) -> "holo"
let stage = "holo", stageT = 0, swapBrain = false;
// wallBrain: a breakdown brain moment shown on the wall (she keeps dancing in the cube); unison: on some drops she is on
// both screens for 8 bars (different moves) - the only time she is in two places
let wallBrain = false, unisonUntil = -1e9;
const hyperT = new Tesseract({ radius: 0.014, joint: 0.035 });   // the tesseract (a mind moment, Shift+I)
scene.add(hyperT.group);
// the spine (the spine MRI): the spine stack, a mind moment (Shift+S)
let spine = null, spineStack = null;
try {
  spine = await loadSpine();
  spineStack = new SpineStack(spine); scene.add(spineStack.group);
} catch (e) { console.info("no spine MRI (assets/spine):", e.message); }
// the kundalini's height: through a build it climbs from the base of the spine to the crown; otherwise every 8 bars
const riseOf = (s, t, live) => (live && s.section === "build" ? Math.min(1, s.sectionTime / 24)
  : (((live ? s.beatCount + s.beatPhase : t * 2) % 32) / 32));
function sendTo(where) {
  if (journey?.active || sweep || (where === "wall" && wallBrain)) return;
  const t = clock.elapsedTime;
  if (where === "wall" && stage === "holo") { stage = "toWall"; stageT = t; startSweep("out"); }
  else if (where === "holo" && stage === "wall") { stage = "toHolo"; stageT = t; swapBrain = false; startSweep("in"); }
}
const swapChance = () => (director.phase.name === "arrival" ? 0.5 : 1);   // fewer trips early in the night
// ---- while she is up on the wall, the cube shows the brain - or sometimes a journey snippet (one stage, 6-8 bars;
// after a drop mostly the slices); rationed: the night phase decides, at most one every 3 min, none near a journey
let lastSnippetAt = -1e9, lastSnippet = "", wantSnippet = null, afterDrop = -1e9, lastJourneyEnd = -1e9, wasSnip = false;
function pickSnippet(t) {
  if (!journey || t - lastSnippetAt < 180 || t - lastJourneyEnd < 180 || Math.random() >= director.snippetChance) return null;
  if (t - afterDrop < 4 && Math.random() < 0.6) return "slices";
  const opts = Object.keys(SNIPPETS).filter((n) => n !== lastSnippet);
  return opts[0 | Math.random() * opts.length];
}
function fillWall(t) {
  const name = wantSnippet || pickSnippet(t);
  wantSnippet = null;
  if (name && journey) { journey.startSnippet(name); lastSnippetAt = t; lastSnippet = name; swapBrain = false; note(`snippet ${name}`); }
  else swapBrain = true;                                           // the brain takes her place
}
const randomSnippet = () => { const o = Object.keys(SNIPPETS); return o[0 | Math.random() * o.length]; };
function startSweep(dir, then = null) {
  link.emit("rise", { kind: "beam", strength: 1 });            // the scanner: a beam of light up the wall
  const dur = 8 * 60 / (engine.state.bpm || 130);              // two bars
  if (dir === "in") dancerGone = false;
  sweep = { dir, t0: clock.elapsedTime, dur, then };
}

// Scenes: how much of each layer is on. The show blends between them.
const SCENES = {
  solo: { halo: 0, shapes: 0, echoes: 0, tunnel: 0, damp: 0.95, kaleido: false },     // just her + long smears
  echoes: { halo: 0.25, shapes: 0, echoes: 1, tunnel: 0.15, damp: 0.82, kaleido: false },
  tunnel: { halo: 0, shapes: 0, echoes: 0.4, tunnel: 1, damp: 0.88, kaleido: false },   // halo/shapes -> projector
  full: { halo: 0.5, shapes: 0, echoes: 0.7, tunnel: 0.7, damp: 0.86, kaleido: true },   // lighter: no shapes
};
const mix = { halo: 0, shapes: 0, echoes: 0, tunnel: 0, damp: 0.9 };
let sceneMode = "auto", normalScene = "solo";
let echoSpread = 0.4, echoPump = 0, echoCount = 4;
const bands = { low: 0.4, lowmid: 0.4, mid: 0.4, high: 0.4 };   // smoothed audio bands     // echo spacing (beats), kick pump, how many

// ---------------------------------------------------------------- state, keys
let lookName = "hologram", mirror = false, halfTimeMode = "auto", whipOn = false, palette = 0, hairOn = true;
// brain: "scene" = the brain takes her place (breakdowns, chosen by the director; the build scans and x-rays it, the
// drop throws her back in); "head" = it glows inside her head for a few bars when a melody comes in
let echoSliceMode = "auto", echoSliceUntil = -1, echoSliceOn = 0;   // E: her echoes as MRI-style section bands
let brainPts = 0, mindKind = "brain";                       // the mind moment: the brain, or the tesseract
let hDraft = { on: false, mode: 2, mask: 0, until: 0, band: 0, half: 0.15 }, hDraftForce = null;
const _hc = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];                                             // the brain as a point cloud (1) or solid (0); the wall follows
let brainMode = "auto", brainWanted = false, brainHeadUntil = -1, lastBrainAt = -1e9, brainLvl = 0, brainHead = 0;
// ?test=hyper | glyphs | dither | contours: try the tesseract or a drafting look on its own
const HTEST = new URLSearchParams(location.search).get("test");
if (HTEST === "hyper") { mindKind = "hyper"; brainMode = "scene"; }
if (HTEST === "spine") { mindKind = "spineStack"; brainMode = "scene"; }
if (["glyphs", "dither", "contours"].includes(HTEST)) hDraftForce = ["glyphs", "dither", "contours"].indexOf(HTEST);
let kaleidoMode = "auto", tripMode = "auto", stutterMode = "auto";   // auto | on/high | off/low
// stutter patterns for the 2-bar bursts: steps per beat, beat by beat (4 = 16ths, 3 = triplets, 2 = 8ths,
// 1 = quarters, 0.5 = hold 2 beats, 0.25 = hold the bar); offset 0.5 = steps land on the offbeat
const STUTTERS = {
  "wind-down": { beats: [4, 4, 4, 4, 2, 2, 1, 1] },
  "wind-up": { beats: [1, 1, 2, 2, 4, 4, 4, 4] },
  triplets: { beats: [3, 3, 3, 3, 3, 3, 3, 3] },
  freeze: { beats: [0.25, 0.25, 0.25, 0.25, 4, 4, 2, 1] },
  "slow frames": { beats: [0.5, 0.5, 0.5, 0.5, 1, 1, 2, 2] },
  offbeat: { beats: [2, 2, 2, 2, 2, 2, 2, 2], offset: 0.5 },
  strobe: { beats: [4, 4, 4, 4, 4, 4, 4, 4], strobe: true },
};
const BUILD_STUTTERS = { straight: [1, 2, 4], triplet: [1, 3, 6] };   // builds wind up through these
let burstStart = -100, burstName = "wind-down", buildScheme = "straight";
whip.mesh.visible = whipOn;
function applyLook() {
  const L = LOOKS[lookName];
  scene.background = new THREE.Color(L.background);
  ambient.intensity = L.ambient;
  bloom.threshold = L.bloomThreshold;
  feedback.mode = L.trails;
  psy.uniforms.vignette.value = lookName === "hologram" ? 1 : 0.35;
  $("vignette").classList.toggle("hidden", lookName !== "projector");
  dancer.setLook(L);
}
applyLook();
addEventListener("keydown", (e) => {
  if (calib.handleKey(e)) return;                              // R: calibration (it takes all keys while open)
  const k = e.key.toLowerCase();
  if (k === "h") { lookName = lookName === "projector" ? "hologram" : "projector"; applyLook(); }
  if (k === "m") { mirror = !mirror; renderer.domElement.style.transform = mirror ? "scaleX(-1)" : ""; }
  if (k === "t") halfTimeMode = { auto: "on", on: "off", off: "auto" }[halfTimeMode];
  if (k === "n") changeMove();
  if (k === "a") {                                            // A: try each accent style on its own, then auto
    accentForce = accentForce === null ? 0 : accentForce + 1 < ACCENTS.length ? accentForce + 1 : null;
    if (accentForce !== null) accentStyle = ACCENTS[accentForce];
  }
  if (e.key === "O") director.newNight();                    // Shift+O: a fresh night
  else if (k === "o") director.cyclePhase();                 // try the phases of the night
  if (k === "g") { grabbed = dancer.where(); console.info("G:", grabbed); }   // note clip times for segments
  const testPool = { 1: "breakdown", 2: "build", 3: "drop", 4: "peak", 5: "normal" }[k];   // 1-5: try a pool
  if (testPool) changeMove(1, testPool);
  if (k === "w") { whipOn = !whipOn; whip.mesh.visible = whipOn; }
  if (k === "l") hairOn = !hairOn;
  if (k === "j" && journey) journey.active ? journey.stop() : journey.start(engine.state.running && engine.state.bpm > 0);
  if (k === "v") sendTo(stage === "holo" ? "wall" : "holo");
  if (k === "q" && stage === "holo") unisonUntil = clock.elapsedTime + 8 * 240 / (engine.state.bpm || 130);
  if (k === "z" && journey && !journey.active) {                 // Z: a snippet now (she goes up first if she is here)
    if (stage === "holo") { wantSnippet = randomSnippet(); sendTo("wall"); }
    else if (stage === "wall") { swapBrain = false; journey.startSnippet(randomSnippet()); lastSnippetAt = clock.elapsedTime; }
  }
  if (k === "y" && !sweep) startSweep(dancerGone ? "in" : "out", dancerGone ? null : "in");   // a scanner pass through her
  if (k === "e") echoSliceMode = { auto: "on", on: "off", off: "auto" }[echoSliceMode];
  if (e.shiftKey && e.key === "S") {                         // Shift+S: the spine stack
    mindKind = mindKind === "spineStack" ? "brain" : "spineStack"; brainMode = mindKind === "spineStack" ? "scene" : "auto"; return;
  }
  if (e.key === "B") brainPts = 1 - brainPts;               // Shift+B: the brain solid <-> point cloud
  if (e.key === "I") { mindKind = mindKind === "hyper" ? "brain" : "hyper"; brainMode = mindKind === "hyper" ? "scene" : "auto"; }   // Shift+I: tesseract
  else if (k === "i") hDraftForce = hDraftForce === null ? 0 : hDraftForce < 2 ? hDraftForce + 1 : null;   // I: drafting looks
  else if (k === "b") brainMode = { auto: "scene", scene: "head", head: "off", off: "auto" }[brainMode];
  if (k === "[") hair.brightness *= 0.8;                     // hair dimmer / brighter, live
  if (k === "]") hair.brightness *= 1.25;
  if (k === "c") nextPalette();
  if (k === "k") kaleidoMode = { auto: "on", on: "off", off: "auto" }[kaleidoMode];
  if (k === "p") tripMode = { auto: "high", high: "low", low: "auto" }[tripMode];
  if (k === "s") stutterMode = { auto: "on", on: "off", off: "auto" }[stutterMode];
  if (k === "x") sceneMode = { auto: "solo", solo: "echoes", echoes: "tunnel", tunnel: "full", full: "auto" }[sceneMode];
  if (k === "d") onDrop();
  if (k === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (k === "u") { $("ui").classList.toggle("hidden"); $("info").classList.toggle("hidden"); }
});

// ---------------------------------------------------------------- moments
const clock = new THREE.Clock();
let flash = 0, camAngle = 0, camAngleTarget = 0, camDist = 1, camDistTarget = 1;
let lastMoveChange = 0, lastPaletteChange = 0, kaleidoUntil = 0, spin = 1, trip = 0.4, swayT = 0;
// which pool of moves fits the music right now
function momentNow() {
  const sec = engine.state.section;
  return sec === "breakdown" || sec === "silence" ? "breakdown" : sec === "build" ? "build" : sec === "peak" ? "peak" : "normal";
}
let lastMoveMoment = "normal", lastMoveIntensity = 0;
let grabbed = "";                                     // last G press (move @ clip time)
let nextPhraseAt = 64;                                 // beat count of the next phrase change
function changeMove(fade = 1.5, moment = momentNow()) {
  dancer.next(fade, moment, engine.state);                  // the audio picks the best fit inside the pool
  link.emit("rise", { kind: "ring", strength: 0.8 });        // the wall above answers: a ring rises from the cube
  lastMoveChange = clock.elapsedTime;
  lastMoveMoment = moment;
  lastMoveIntensity = engine.state.intensity;
}
function nextPalette() {
  // the director picks, avoiding palettes used recently tonight
  const name = director.pick("palette", PALETTES.map((p) => p.name), {}, [PALETTES[palette].name]);
  palette = PALETTES.findIndex((p) => p.name === name);
  lastPaletteChange = clock.elapsedTime;
}
let lastDropAt = -1e9, dropFull = false;
function onDrop() {
  lastDropAt = clock.elapsedTime;
  dropFull = director.dropGetsFull();                        // FULL is rationed by the phase and recent drops
  flash = 1;
  camAngleTarget = (Math.random() * 2 - 1) * 0.6;
  camDistTarget = 0.85 + Math.random() * 0.3;
  changeMove(0.6, "drop");
  nextPalette();
  spin = -spin;                                              // everything turns the other way
  psy.uniforms.segments.value = [4, 6, 8, 10, 12][0 | Math.random() * 5];
  mandala.uniforms.segs.value = [6, 8, 10, 12, 16][0 | Math.random() * 5];
  kaleidoUntil = clock.elapsedTime + 16;                     // kaleidoscope for ~16 s after a drop
  if (whipOn) whip.crack(1.5);
}
engine.on("drop", onDrop);
// ---- musical elements -> the show: bass drives her legs, the melody her arms, hats the echoes, pads the trails,
// new phrases the scene/colours, the stereo field the space
let lastPartChange = 0, lastPhraseChange = 0, hatsOn = 0.5, padsOn = 0;
const recentEvents = [];                                      // { t, text } - everything from the last seconds
const note = (text) => { recentEvents.push({ t: clock.elapsedTime, text }); if (recentEvents.length > 30) recentEvents.shift(); };
engine.on("section", (e) => note(e.section));
engine.on("drop", () => note("DROP"));
engine.on("surge", () => note("surge"));
engine.on("phrase", () => note("new phrase"));
engine.on("predrop", () => note("pre-drop"));
engine.on("stereo", (e) => note(`stereo ${e.type}`));
let space = 0.4, predropUntil = -1, hold = 0;                  // stereo 'space' feel; the pre-drop breath hold
engine.on("element", (ev) => {
  const now = clock.elapsedTime, k = ev.group, ty = ev.type;
  note(`${k} ${ty}`);
  if (k === "kick" && ty === "enter" && engine.state.section !== "breakdown" && now - lastMoveChange > 6) changeMove(1.2, "normal");
});
// ---- variety inside the moves: every 4 bars a phrase decision - jump to another step of the clip, loop a short
// chunk, or keep going; a new style of musical accents (hip sway / torso twist / head nods); sometimes half time
const ACCENTS = [
  { name: "sway", sway: 0.24, twist: 0.05, nod: 0.03 },            // radians: 0.24 = ~14 degrees
  { name: "twist", sway: 0.05, twist: 0.22, nod: 0.03 },
  { name: "nods", sway: 0.03, twist: 0.03, nod: 0.18 },
  { name: "all", sway: 0.16, twist: 0.14, nod: 0.12 },
  { name: "none", sway: 0, twist: 0, nod: 0 },
];
let accentStyle = ACCENTS[0], phraseHalf = false, phraseAction = "-", accentForce = null;   // A key: force a style
engine.on("beat", (b) => {
  if (b.count % 16 !== 0 || clock.elapsedTime - lastMoveChange < 6) return;
  if (dancer.looping) { dancer.setLoop(null); phraseAction = "loop released"; }
  else {
    const r = Math.random();
    if (r < 0.4) { dancer.jump(0.35); phraseAction = "jump"; }
    else if (r < 0.65) { const n = [2, 4, 8][0 | Math.random() * 3]; dancer.setLoop(n); phraseAction = `loop ${n} steps`; }
    else phraseAction = "straight";
  }
  if (b.count % 32 === 0 && accentForce === null) {
    const name = director.pick("accents", ACCENTS.map((x) => x.name), {}, [accentStyle.name]);   // varied over the night
    accentStyle = ACCENTS.find((x) => x.name === name) || ACCENTS[0];
    phraseHalf = Math.random() < 0.3;                            // some phrases in half time
  }
});

engine.on("predrop", () => { predropUntil = clock.elapsedTime + 4 * 60 / (engine.state.bpm || 130); });
engine.on("drop", () => { predropUntil = -1; });             // the drop releases the held breath
// ---- motif memory: every 2 bars each playing group's fingerprint is matched against what the show has heard before.
// When a group switches to a different motif, a KNOWN motif gets the same reaction as last time (lead -> her arm move,
// bass -> her leg move, pads -> the colours); a NEW motif gets something fresh, which is then remembered.
const activeMotif = {};
engine.on("motif", ({ group, vec }) => {
  if (!["lead", "bass", "pads"].includes(group)) return;
  const { motif, isNew } = memory.observe(group, vec);
  if (activeMotif[group] === motif.id) return;                 // the same motif keeps playing
  activeMotif[group] = motif.id;
  const now = clock.elapsedTime, a = motif.assoc || {};
  note(`${group} motif #${motif.id} ${isNew ? "new" : "recognised"}`);
  if (now - lastMoveChange < 3) return;                        // a full move change just happened
  if (group === "lead" || group === "bass") {
    const lo = dancer.lowerMove, up = dancer.upperMove;
    const known = a.move && dancer.moves.find((m) => m.name === a.move);
    if (group === "lead") {
      if (known && known !== up) dancer.playParts(lo, known, 1.0); else if (!known) dancer.changeUpper(1.0);
      memory.remember(motif, { move: dancer.upperMove?.name });
      psy.uniforms.hue.value += 0.5;                            // the melody shifts the colours a little
      flash = Math.max(flash, 0.2);
    } else {
      if (known && known !== lo) dancer.playParts(known, up, 1.2); else if (!known) dancer.changeLower(1.2);
      memory.remember(motif, { move: dancer.lowerMove?.name });
    }
    lastPartChange = now;
  } else if (group === "pads") {
    if (a.palette !== undefined && a.palette !== palette && a.palette < PALETTES.length) { palette = a.palette; lastPaletteChange = now; }
    else if (a.palette === undefined && isNew && now - lastPaletteChange > 20) nextPalette();
    memory.remember(motif, { palette });
  }
});

engine.on("phrase", () => {
  if (clock.elapsedTime - lastPhraseChange < 20) return;
  lastPhraseChange = clock.elapsedTime;
  normalScene = director.pickScene([normalScene]);
  nextPalette();
  if (brain && brain.level > 0.3 && director.has("points") && Math.random() < 0.35) brainPts = 1 - brainPts;   // solid <-> points
  if (!hDraft.on && !journey?.active && director.has("drafting") && Math.random() < 0.15) {   // a drafting look on her
    const d = Math.random();
    Object.assign(hDraft, { on: true, mode: d < 0.2 ? 0 : d < 0.6 ? 1 : 2, mask: 0,
      until: (engine.state.beatCount || 0) + (Math.random() < 0.5 ? 16 : 32), band: (Math.random() - 0.5) * 0.4, half: 0.1 + 0.1 * Math.random() });
  }
});

// ---- the brain moments
engine.on("section", (e) => {
  const now = clock.elapsedTime;
  if (e.section === "breakdown" && director.has("brain") && !brainWanted && !journey?.active && now - lastBrainAt > 150 && Math.random() < director.brainChance) {
    lastBrainAt = now;                                          // a mind moment: the brain scene or the head journey
    brainPts = director.has("points") && Math.random() < 0.5 ? 1 : 0;   // solid or the point cloud (it may switch on phrases)
    const minds = ["brain", ...(journey && director.has("journey") ? ["journey"] : []), ...(director.has("tesseract") ? ["hyper"] : []),
      ...(spineStack && director.has("spineStack") ? ["spineStack"] : [])];
    const kind = director.pick("mind", minds, { ...director.mindWeights, hyper: 0.8, spineStack: 0.7 }, [], 4);   // a first one: much more likely
    mindKind = ["hyper", "spineStack"].includes(kind) ? kind : "brain";
    if (kind === "journey") { journey.start(true); note("journey"); }
    else if (mindKind !== "brain") { brainWanted = true; note({ hyper: "tesseract", spineStack: "the spine" }[kind]); }
    else if (stage === "holo" && Math.random() < 0.5) { wallBrain = true; note("brain (on the wall)"); }   // she stays here
    else { brainWanted = true; note("brain"); }
  }
  if (e.section === "build") journey?.build();                 // the build takes the journey into the brain
  if (brainWanted && (e.section === "normal" || e.section === "peak")) brainWanted = false;   // no drop came: leave quietly
  if (e.section === "normal" || e.section === "peak") wallBrain = false;
});
engine.on("drop", () => {
  // drops move her: up onto the wall sometimes, back down into the cube often
  afterDrop = clock.elapsedTime;
  if (!journey?.active) {
    const r = Math.random();
    wallBrain = false;
    if (stage === "holo" && r < 0.4 * swapChance()) sendTo("wall");
    else if (stage === "wall" && r < 0.6) sendTo("holo");
    else if (stage === "holo" && director.phase.name !== "arrival" && Math.random() < 0.3) {   // unison: on both screens
      unisonUntil = clock.elapsedTime + 8 * 240 / (engine.state.bpm || 130); note("unison");
    }
  }
  journey?.drop();                                             // the slices fly apart, she comes back
  if (!brainWanted || !brain) return;
  brainWanted = false;                                         // the drop throws her back in, the brain bursts out
  for (let i = 0; i < 10; i++) brain.spark();
  brain.burst();
  hyperT.hit(1);
});
engine.on("element", (ev) => {
  if (ev.group === "lead" && ev.type === "enter" && !brainWanted && Math.random() < 0.35)
    brainHeadUntil = clock.elapsedTime + 8 * 240 / (engine.state.bpm || 130);              // 8 bars inside her head
});
engine.on("beat", () => {                                     // late in a build: a spark on every beat (tension)
  if (brain && brain.level > 0.05 && engine.state.section === "build" && engine.state.sectionTime > 8) brain.spark();
});
engine.on("phrase", () => {
  // a new phrase can move her too, after at least 16 bars on one stage
  const bars = (clock.elapsedTime - stageT) * (engine.state.bpm || 130) / 240;
  if (!journey?.active && bars >= 16 && (stage === "holo" || stage === "wall") &&
      Math.random() < 0.45 * (stage === "holo" ? swapChance() : 1)) sendTo(stage === "holo" ? "wall" : "holo");
  brain?.pulse("phrase");
  if (Math.random() < 0.25) echoSliceUntil = clock.elapsedTime + 16 * 240 / (engine.state.bpm || 130);   // 16 bars
});            // a new phrase: one signal crosses the whole brain
engine.on("motif", ({ group }) => { if (group === "lead" && Math.random() < 0.5) brain?.pulse("phrase", 0.7); });
// rising-edge triggers for the brain's pulses: fires once when v goes over 'on', re-arms under 'off', min gap in s
const trig = {};
function edge(name, v, on, off, gap, t) {
  const st = (trig[name] ||= { up: false, t: -1 });
  if (!st.up && v > on && t - st.t > gap) { st.up = true; st.t = t; return true; }
  if (v < off) st.up = false;
  return false;
}

engine.on("tempo", () => { if (clock.elapsedTime - lastMoveChange > 4) changeMove(1.5); });   // new track
engine.on("section", (e) => {
  if (e.section === "breakdown") changeMove(2.5, "breakdown");   // melt into a slow move
  if (e.section === "build") changeMove(1.5, "build");
  if (e.section === "build") buildScheme = Math.random() < 0.5 ? "straight" : "triplet";
});
engine.on("surge", () => {
  flash = 0.5; camDistTarget = 0.85; changeMove(1.2, "peak");
  kaleidoUntil = Math.max(kaleidoUntil, clock.elapsedTime + 8);
  if (whipOn) whip.crack(0.8);
});
engine.on("beat", (b) => {
  // a new phrase every 8 or 16 bars (random), not too soon after the last change
  if (b.count % 32 === 0 && b.count >= nextPhraseAt && clock.elapsedTime - lastMoveChange > 10) {
    changeMove(2);
    nextPhraseAt = b.count + (Math.random() < 0.5 ? 32 : 64);
  }
  // every 8 bars: if the energy shifted clearly since the last change, pick a move that fits again
  if (b.count % 32 === 0 && clock.elapsedTime - lastMoveChange > 8 &&
      Math.abs(engine.state.intensity - lastMoveIntensity) > 0.2) changeMove(1.5);
  if (b.count % 64 === 0) {                                  // and a fresh scene for the normal parts
    normalScene = director.pickScene([normalScene]);            // what this phase of the night allows
  }
  if (b.count % 128 === 0 && clock.elapsedTime - lastPaletteChange > 40) nextPalette(); // new colours every 32 bars
  // now and then a 2-bar stutter burst in full parts, starting on a bar
  const st = engine.state.section;
  if (b.count % 4 === 0 && b.count >= burstStart + 16 && (st === "normal" || st === "peak") &&
      Math.random() < 0.03 + 0.08 * engine.state.intensity) {
    burstStart = b.count;
    link.emit("rise", { kind: "double", strength: 1 });
    const names = Object.keys(STUTTERS).filter((n) => n !== burstName);
    burstName = names[0 | Math.random() * names.length];
  }
});

// ---------------------------------------------------------------- audio controls
async function fillDevices() {
  const inputs = await AudioEngine.listInputs();
  const sel = $("device"), keep = sel.value;
  sel.innerHTML = '<option value="">default input</option>' +
    inputs.map((d) => `<option value="${d.deviceId}">${d.label || "input"}</option>`).join("");
  sel.value = keep || inputs.find((d) => /ssl|solid state|usb audio codec|behringer|ufo/i.test(d.label))?.deviceId || "";
}
$("start").onclick = async () => { await engine.startInput($("device").value); fillDevices(); };
$("file").onchange = async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  $("player").style.display = "block";
  await engine.startFile(f, $("player"));
};
fillDevices();
// ?autostart (the launcher): find the interface (SSL 2 / UFO202) and start listening without any clicks. The device
// names only show after a first permission, so ask once (start-show.ps1 lets Chromium allow it without a prompt).
if (new URLSearchParams(location.search).has("autostart")) (async () => {
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((tr) => tr.stop()); } catch { /* no access */ }
  await fillDevices();
  const sel = $("device"), iface = (o) => /ssl|solid state|usb audio codec|behringer|ufo/i.test(o.textContent);
  // the interface's own entry, not Chromium's "Default - ..." / "Communications - ..." (those follow Windows' default)
  const opt = [...sel.options].find((o) => iface(o) && !/^(default|communications) -/i.test(o.textContent)) ||
              [...sel.options].find(iface);
  if (opt) { sel.value = opt.value; await engine.startInput(opt.value); fillDevices(); console.info("autostart:", opt.textContent); }
  else console.warn("autostart: no SSL 2 / UFO202 found - pick the input by hand");
})();

// ---------------------------------------------------------------- run
const hand = new THREE.Vector3();
let fpsShown = 60, perfU = 0, perfR = 0;
const prof = { audio: 0, dancer: 0, hair: 0, mind: 0, echoes: 0 };   // ms per frame, smoothed (info line)
const tick = (key, t0) => { prof[key] = prof[key] * 0.9 + (performance.now() - t0) * 0.1; };
const frame = () => {
  const pf0 = performance.now();                                  // timing: update vs render (info line)
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  fpsShown = smooth(fpsShown, 1 / Math.max(dt, 1e-3), 2, dt);   // frames per second (info line)
  let pt = performance.now();
  const s = engine.update();
  tick("audio", pt);
  const live = s.running && s.bpm > 0;
  const quiet = s.section === "breakdown" || s.section === "build";
  const L = LOOKS[lookName], P = PALETTES[palette];
  const kick = live ? s.kick : 0;

  // ---- trip level: dreamy in breakdowns, rising through builds, full on drops and peaks
  let tripTarget = 0.45;
  if (live) {
    tripTarget = { silence: 0.2, normal: 0.45 + 0.35 * s.intensity, peak: 1, breakdown: 0.3,
      build: 0.3 + Math.min(0.6, s.sectionTime / 40) }[s.section] ?? 0.5;
    if (s.sinceDrop < 10) tripTarget = 1;
  }
  tripTarget = Math.min(tripTarget, director.tripCap);        // the phase of the night limits it
  if (tripMode === "high") tripTarget = 1;
  if (tripMode === "low") tripTarget = 0.2;
  trip = smooth(trip, tripTarget, tripTarget > trip ? 2 : 0.3, dt);

  // ---- audio bands (smoothed so nothing flickers). What each one drives:
  //   kick    -> rim flash, echo pump, tunnel zoom pulse, RGB split, camera bob
  //   low     -> liquid warp, tunnel zoom
  //   lowmid  -> smear trail length (pads, bass body = longer trails)
  //   mid     -> body glow brightness, colour-cycling speed of trails and picture (leads, vocals)
  //   high    -> echo spacing + shimmer, rim edge width, RGB split
  //   density -> number of echoes;  intensity -> trip level, bloom, camera sway, how often stutters happen
  for (const b of Object.keys(bands)) bands[b] = smooth(bands[b], live ? s.bands[b] : 0.4, 6, dt);

  // ---- scene: what is on the hologram right now (blended smoothly)
  let sceneName = sceneMode;
  if (sceneMode === "auto") {
    const barsSinceDrop = (t - lastDropAt) * (live ? s.bpm : 130) / 240;   // real or fake (D) drops
    sceneName = barsSinceDrop < 4 ? (dropFull ? "full" : "tunnel") : !live ? normalScene   // first 4 bars after a drop
      : s.section === "peak" ? "echoes"
      : barsSinceDrop < 16 ? "tunnel"
      : s.section === "breakdown" || s.section === "silence" ? "solo"
      : s.section === "build" ? "echoes" : normalScene;
  }
  const SC = SCENES[sceneName];
  for (const key of Object.keys(mix)) mix[key] = smooth(mix[key], SC[key], key === "damp" ? 0.8 : 0.4, dt);   // (scene changes: ~3 s)

  // ---- dancer
  const cur = dancer.current;
  dancer.halfTime = halfTimeMode === "on" ||
    (halfTimeMode === "auto" && (quiet || phraseHalf || (live && cur && s.bpm > (60 / cur.period) * 1.3)));
  for (const key of ["sway", "twist", "nod"]) dancer.accents[key] = smooth(dancer.accents[key], accentStyle[key], 1, dt);
  flash = Math.max(0, flash - dt * 1.5);
  // stutter: builds step on 8ths, then 16ths as the tension rises; plus the random 2-bar bursts
  let steps = 0, offset = 0, strobe = false, stepLabel = "";
  if (stutterMode === "on") steps = 4;
  else if (stutterMode === "auto" && live) {
    // builds wind UP through their scheme as the build goes on (the drop releases it)
    if (s.section === "build") {
      const sc = BUILD_STUTTERS[buildScheme];
      steps = s.sectionTime < 6 ? sc[0] : s.sectionTime < 14 ? sc[1] : sc[2];
      stepLabel = `build ${buildScheme}`;
    } else if (s.beatCount - burstStart < 8) {
      const pat = STUTTERS[burstName];
      steps = pat.beats[s.beatCount - burstStart];
      offset = pat.offset || 0;
      strobe = !!pat.strobe;
      stepLabel = burstName;
    }
  }
  hold = smooth(hold, t < predropUntil ? 1 : 0, t < predropUntil ? 4 : 2, dt);
  if (t < predropUntil) { steps = 0.25; stepLabel = "pre-drop hold"; }   // freeze: holding the breath
  dancer.stepsPerBeat = steps;
  dancer.stepOffset = offset;
  dancer.releaseDur = live ? 60 / s.bpm : 0.5;            // fade the stutter out over one beat
  pt = performance.now();
  dancer.update(dt, s, 1.2 * flash + (strobe ? 1.6 * dancer.stepFlash : 0));
  tick("dancer", pt);
  const k = Math.min(1, dt * 0.8);                                      // colours drift to the current palette
  dancer.blendColors(P, k, lookName === "hologram");
  dancer.glowGain = (0.6 + 0.9 * bands.mid) * (1 - 0.4 * hold);   // leads/vocals light her body; dims in the pre-drop
  whip.color.lerp(new THREE.Color(P.accents[0]), k);
  if (whipOn) whip.update(dt, dancer.handPosition(hand));
  dancer.root.updateMatrixWorld(true);                       // hair follows this frame's pose, not the last one
  const du = dancer.material.userData.uniforms;                // the hair copies her own look
  hair.setColors(dancer.material.emissive, du.uRimColor.value, du.uRimStrength.value);
  pt = performance.now();
  hair.update(dt, camera, { kick, energy: live ? s.intensity : 0.4, highs: bands.high });
  tick("hair", pt);
  pt = performance.now();

  // ---- brain (and the head journey, which then owns head + brain)
  const el = s.elements || {};
  if (journey) {
    if (journey.active) brainWanted = false;
    journey.update(dt, t, { bpm: live ? s.bpm : 130, section: live ? s.section : "", kick, camera,
      hats: live ? el.hats?.level || 0 : 0.5, stutter: dancer.stepsPerBeat || 0,   // the head stutters with her
      steps: live ? (el.hats?.on ? 2 : 1) * (s.section === "build" ? 2 : 1) : 2,    // the cut scrolls on 4ths/8ths/16ths
      bass: live ? (el.bass?.level || 0) * (el.bass?.on ? 1 : 0.4) : 0.4 + 0.3 * Math.sin(t * 2.7),
      anchor: new THREE.Vector3(0, H * 0.52, 0), height: H * 0.8 });
    if (journey.active) head.setColors(P, k);
    // the scanner takes her away when the journey starts and brings her back on its way out
    const snipNow = !!journey.snip;
    if (journey.active && !wasJourney && !snipNow) { if (stage === "holo") startSweep("out"); stage = "holo"; swapBrain = false; }
    if (journey.phase === "out" && lastJourneyPhase !== "out" && dancerGone) { startSweep("in"); bornT = t; }
    if (!journey.active && wasJourney && !wasSnip && dancerGone && sweep?.dir !== "in") { startSweep("in"); bornT = t; }
    if (!journey.active && wasJourney && !wasSnip) { echoSliceUntil = t + 32 * 240 / (live ? s.bpm : 130); lastJourneyEnd = t; }
    if (!journey.active && wasJourney && wasSnip && stage === "wall") sendTo("holo");   // the snippet is over: she comes back
    wasJourney = journey.active; wasSnip = snipNow; lastJourneyPhase = journey.phase;
  }
  // ---- scanner sweep
  let scanY = -10;
  if (sweep) {
    const q = Math.min(1, (t - sweep.t0) / sweep.dur), e2 = q * q * (3 - 2 * q);
    scanY = sweep.dir === "out" ? -0.05 + e2 * H * 1.13 : H * 1.08 - e2 * H * 1.13;
    if (q >= 1) {
      if (sweep.dir === "out") dancerGone = true;
      if (sweep.dir === "out" && stage === "toWall") { stage = "wall"; stageT = t; fillWall(t); }   // brain or a snippet
      if (sweep.dir === "in" && stage === "toHolo") { stage = "holo"; stageT = t; }
      const then = sweep.then;
      sweep = null; scanY = -10;
      if (then) startSweep(then);
    }
  }
  scanPlane.constant = -scanY;
  if (stage === "wall" && (t - stageT) * (live ? s.bpm : 130) / 240 > 32) sendTo("holo");   // at most 32 bars up there
  // born from the slices: after the journey she is rebuilt from thin horizontal bands that thicken until she is solid
  const du0 = dancer.material.userData.uniforms, bornQ = (t - bornT) / (12 * 60 / (live ? s.bpm : 130));
  if (bornQ >= 0 && bornQ < 1) {
    du0.uSlice.value = 1;
    du0.uSliceWidth.value = 0.06 + 0.94 * bornQ * bornQ * (3 - 2 * bornQ);
    du0.uSliceOffset.value = (live ? s.beatCount + s.beatPhase : t * 2) * 0.5;
  } else du0.uSlice.value = 0;
  sheet.visible = !!sweep;
  sheet.position.set(0, Math.max(0, scanY), 0);
  sheetMat.uniforms.uLevel.value = sweep ? Math.min(1, (t - sweep.t0) * 4, (sweep.t0 + sweep.dur - t) * 4) : 0;
  sheetMat.uniforms.uTime.value = t;
  sheetMat.uniforms.uColor.value.set(P.rim);
  sheetMat.uniforms.uColor2.value.set(P.accents[1]);
  const jCover = journey ? journey.cover : 0;
  if (brain) {
    const jOn = journey?.active || jCover > 0.01;
    const sceneOn = !jOn && (brainMode === "scene" || (brainMode === "auto" && (brainWanted || swapBrain)));
    const headOn = !jOn && (brainMode === "head" || (brainMode === "auto" && t < brainHeadUntil && !sceneOn));
    brainLvl = smooth(brainLvl, sceneOn ? 1 : 0, sceneOn ? 0.5 : 1.5, dt);    // slow in, quick out (the drop)
    brainHead = smooth(brainHead, headOn && brainLvl < 0.05 ? 1 : 0, 1, dt);
    dancer.root.visible = brainLvl < 0.7 && !dancerGone;         // her place is taken: hide her, her hair, echoes
    const building = live && s.section === "build" && brainWanted;
    if (jOn) { /* placed by the journey */ }
    else if (brainLvl > 0.01) {                                       // the brain big, where she stands
      brain.root.position.set(0, H * 0.55, H * 0.15 * (1 - brainLvl));
      brain.root.quaternion.identity();
      brain.root.scale.setScalar((H * 0.62) / brain.size.y);
      brain.spinSpeed = spin * (0.1 + 0.25 * trip);
    } else if (headBone) {                                       // or real size inside her head
      headBone.getWorldPosition(brain.root.position);
      headBone.getWorldQuaternion(brain.root.quaternion);
      brain.root.scale.setScalar(0.9 * H / 1.7);
      brain.root.translateY(0.085 * H / 1.7);
      brain.spinner.rotation.set(0, 0, 0);
      brain.spinSpeed = 0;
    }
    brain.setColors(P, k);
    // each element pulses from its own place: kick = brainstem, bass = the ears, lead = the frontal lobe, hats = sparks
    const beat = live ? 60 / s.bpm : 0.5;
    if (live && brain.level > 0.02) {
      if (edge("kick", kick, 0.55, 0.25, beat * 0.4, t)) brain.pulse("kick", 0.5 + 0.6 * kick);
      const inCube = brainLvl > 0.5 || journey?.active;           // the brain firing in the cube rises into the wall
      if (el.bass?.on && edge("bass", el.bass.hit, 0.5, 0.2, beat * 0.45, t)) {
        brain.pulse("bass", 0.5 + 0.5 * el.bass.level);
        if (inCube) link.emit("rise", { kind: "small", strength: 0.5 });
      }
      if (el.lead?.on && edge("lead", el.lead.hit, 0.5, 0.2, beat, t)) {
        brain.pulse("lead", 0.5 + 0.5 * el.lead.level);
        if (inCube) link.emit("rise", { kind: "small", strength: 0.6 });
      }
      if (el.hats?.on && edge("hats", el.hats.hit, 0.45, 0.2, beat * 0.2, t)) brain.spark();
    }
    brain.update(dt, t, {
      level: jOn ? journey.brainLevel : Math.max(mindKind === "hyper" || mindKind === "spineStack" ? 0 : brainLvl, 0.7 * brainHead), kick, mid: bands.mid,
      inHead: !jOn && brainLvl <= 0.01, fixed: jOn,
      points: !jOn && brainLvl > 0.01 ? brainPts : 0, px: renderer.domElement.height,
      bass: live ? (el.bass?.level || 0) * (el.bass?.on ? 1 : 0.4) : 0,
      pads: live ? padsOn * (el.pads?.level || 0) : 0.3, hats: live ? el.hats?.level || 0 : 0,
      xray: building ? Math.min(0.85, s.sectionTime / 30) : 0.15 * hold,          // the build opens it up
      sweep: building ? (s.sectionTime * s.bpm / 240 / 2) % 1 : -1,                  // a scan every 2 bars
    });
  }
  // the tesseract: a mind moment instead of the brain, big where she stands
  if (brainMode === "auto" && !brainWanted && brainLvl < 0.01) mindKind = "brain";
  const hyperLvl = mindKind === "hyper" && !journey?.active ? brainLvl : 0;
  hyperT.group.position.set(0, H * 0.55, 0);
  hyperT.group.scale.setScalar(H * 0.24 * (1 + 0.04 * kick));
  hyperT.setColors(P, k);
  hyperT.update(dt, { level: hyperLvl, bps: live ? s.bpm / 60 : 2, kick });
  // the spine stack: the 17 sagittal slices, turned so we see them at an angle; one pulled out per beat
  if (spineStack) {
    const sl = mindKind === "spineStack" && !journey?.active ? brainLvl : 0;
    spineStack.group.position.set(0, H * 0.5, 0);
    spineStack.group.scale.setScalar((H * 0.95) / spineStack.height);
    spineStack.group.rotation.set(0.04, -0.6 + 0.15 * Math.sin(t * 0.3), 0);
    spineStack.setColors(P, k);
    spineStack.update({ level: sl, explode: 1 + 2 * bands.low, hot: Math.floor(live ? s.beatCount + s.beatPhase : t * 2) % spineStack.n,
      lift: 1, rise: riseOf(s, t, live), riseAmt: live && s.section === "build" ? 1 : 0.3 });
  }
  hair.mesh.visible = hairOn && dancer.root.visible && !sweep;   // (the hair can't be clipped: hidden during a sweep)

  tick("mind", pt);                                               // journey + brain + scanner
  // ---- layers
  mandala.uniforms.time.value = t * (0.5 + trip);
  mandala.uniforms.energy.value = live ? s.intensity : 0.4;
  mandala.uniforms.kick.value = kick;
  mandala.setColors(P, k);
  mandala.uniforms.bright.value = (0.15 + 0.35 * trip) * mix.halo;
  mandala.mesh.visible = mix.halo > 0.01;
  orbiters.setColors(P, k);
  orbiters.update(t, { trip, beatPhase: live ? s.beatPhase : (t * 2) % 1, kick });
  orbiters.materials.forEach((m) => (m.opacity *= mix.shapes));
  orbiters.group.visible = mix.shapes > 0.01;
  // ---- time echoes, played by the music:
  //  spacing in musical time (16ths with strong hi-hats, up to 8ths when the top end is calm), snapping in on
  //  every kick and fanning back out; 1-4 of them depending on how many elements are playing; shimmer on the highs
  const highs = live ? s.bands.high : 0.5;
  echoSpread = smooth(echoSpread, 0.5 - 0.25 * Math.min(1, highs * 1.4), 2, dt);   // beats between echoes
  echoPump = Math.max(echoPump - dt * 4, 0.55 * kick);
  const beatSec = live ? 60 / s.bpm : 0.45;
  const gap = beatSec * echoSpread * (1 - echoPump);
  echoSliceOn = echoSliceMode === "on" || (echoSliceMode === "auto" && t < echoSliceUntil) ? 1 : 0;
  echoCount = smooth(echoCount, live ? 1 + 3 * Math.min(1, s.density * 2.2) : 4, 1, dt);
  const shimmer = live ? 0.7 + 0.6 * s.bands.high * (0.6 + 0.4 * s.onset) : 1;
  hatsOn = smooth(hatsOn, live ? (s.elements?.hats.on ? 1 : 0) : 0.5, 1.5, dt);   // hats in: echoes; hats out: fewer
  padsOn = smooth(padsOn, live && s.elements?.pads.on ? 1 : 0, 1, dt);
  pt = performance.now();
  echoes.forEach((e, i) => {
    const visible = Math.min(1, Math.max(0, echoCount - i));                 // later echoes fade in/out smoothly
    e.level = mix.echoes * visible * (0.35 + 0.65 * hatsOn) * (1 - brainLvl) * (dancerGone ? 0 : 1);
    const eu = e.material.userData.uniforms;                      // echo slices: bands that drift down with the beat
    eu.uSlice.value = echoSliceOn > 0.5 ? 1 : 0;
    eu.uSliceOffset.value = (live ? s.beatCount + s.beatPhase : t * 2) * 0.5 + i * 0.25;
    e.delay = gap * (i + 1);
    e.setColors(new THREE.Color(P.accents[i % 3]), new THREE.Color(P.accents[(i + 1) % 3]), new THREE.Color(P.glow),
      e.level * (1 - i * 0.18) * (0.6 + 0.4 * trip) * shimmer);
    e.update(1);
  });

  tick("echoes", pt);
  // ---- post: feedback tunnel, kaleidoscope, warp, RGB split, colour cycling
  const fu = feedback.uniforms;
  fu.zoom.value = 1.0005 + mix.tunnel * (0.006 * trip + 0.004 * bands.low * trip + 0.006 * kick * trip);
  fu.rot.value = spin * 0.003 * trip * mix.tunnel;
  fu.hue.value = (0.015 + 0.06 * bands.mid) * trip;            // trails turn into rainbow smears, faster with mids
  space = smooth(space, live ? Math.min(1, Math.max(0, ((s.stereo?.width || 0) - 0.05) / 0.3)) : 0.4, 1, dt);
  fu.damp.value = Math.min(0.97, mix.damp + 0.05 * (bands.lowmid - 0.4) + 0.025 * padsOn + director.trailBoost
    + 0.04 * (space - 0.5)) - 0.12 * hold;                    // wide = airy trails; the pre-drop cuts them short
  // kaleidoscope: a projector effect; on the hologram only when forced with K
  const kOn = kaleidoMode === "on" || (kaleidoMode === "auto" && lookName === "projector" && t < kaleidoUntil);
  const pu = psy.uniforms;
  pu.kaleido.value = smooth(pu.kaleido.value, kOn ? 1 : 0, 1.5, dt);
  pu.krot.value += spin * dt * 0.15 * trip;
  pu.time.value = t;
  pu.warp.value = trip * (0.15 + 0.8 * bands.low);
  pu.aberr.value = 0.003 + 0.03 * kick * trip + 0.006 * bands.high * trip + 0.02 * flash + (journey ? 0.035 * journey.glitch : 0);
  pu.hue.value += dt * (0.03 + 0.15 * bands.mid) * trip;
  bloom.strength = (L.bloom * (0.7 + 0.4 * trip + 0.3 * (live ? s.level : 0.5)) + 0.4 * flash) * (1 - 0.35 * hold);
  bloom.radius = 0.3 + 0.45 * space;                          // wide = soft, wide glow; mono = crisp outline

  // ---- camera: slow sway around the front, swings on drops
  swayT += dt * (0.08 + 0.12 * (live ? s.intensity : 0.3));      // sways faster when it's intense
  const jc = journey ? journey.cover : 0;                         // the journey: less sway, the camera flies in
  camAngle = smooth(camAngle, (camAngleTarget + 0.25 * Math.sin(swayT)) * (1 - 0.85 * jc), 0.8, dt);
  camDist = smooth(camDist, camDistTarget, 0.5, dt);
  camDistTarget = smooth(camDistTarget, 1, 0.05, dt);
  const dist = (H * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camDist * (1 + ((journey?.camZoom ?? 1) - 1) * jc);
  camera.position.set(Math.sin(camAngle) * dist, H * (0.55 - 0.006 * kick), Math.cos(camAngle) * dist);
  camera.lookAt(0, H * 0.5, 0);
  mandala.follow(camera);

  // trails per frame -> per time: the same look at 60 Hz (the panel) and 144 Hz (the laptop screen)
  { const f60 = Math.min(3, dt * 60);
    fu.damp.value = Math.pow(Math.min(0.995, fu.damp.value), f60); fu.zoom.value = Math.pow(fu.zoom.value, f60);
    fu.rot.value *= f60; fu.hue.value *= f60; }
  // ---- drafting looks on her (now and then; I forces): the whole cube or a band across her
  if (hDraft.on && (s.beatCount || 0) >= hDraft.until) hDraft.on = false;
  const HD = holoDraft.uniforms, hdOn = hDraftForce !== null || (hDraft.on && !journey?.active);
  if (HD.uAmt.value < 0.02 || hDraftForce !== null) HD.uMode.value = hDraftForce ?? hDraft.mode;
  HD.uAmt.value = smooth(HD.uAmt.value, hdOn ? 1 : 0, 2, dt);
  holoDraft.enabled = HD.uAmt.value > 0.005;
  HD.uTime.value = t; HD.uHats.value = live && el.hats?.on ? el.hats.level : 0;
  holoDraft.setColors(_hc[0].set(P.glow), _hc[1].set(P.rim), _hc[2].set(P.accents[0]), _hc[3].set(P.accents[1]));
  const pf1 = performance.now();
  composer.render();
  const pf2 = performance.now();
  perfU = perfU * 0.9 + (pf1 - pf0) * 0.1; perfR = perfR * 0.9 + (pf2 - pf1) * 0.1;
  // ---- to the projector window: this frame's music + show state (small, plain data)
  const els = {};
  for (const [g, e] of Object.entries(s.elements || {})) els[g] = { on: e.on, level: e.level, hit: e.hit };
  link.send({
    running: s.running, bpm: s.bpm, beatCount: s.beatCount, beatPhase: s.beatPhase, section: s.section,
    sectionTime: s.sectionTime, sinceDrop: Number.isFinite(s.sinceDrop) ? s.sinceDrop : 999, intensity: s.intensity,
    level: s.level, kick, density: s.density, onset: s.onset, densityRel: s.densityRel, bands: { ...s.bands }, elements: els, palette, trip, scene: sceneName,
    mind: journey?.active && !journey.snip ? "journey" : wallBrain ? "brainWall" : brainLvl > 0.5 ? mindKind : null, brainPts,
    phase: director.phase.name,                                    // the night's phase: the wall's gradual reveal follows it
    journey: journey?.active ? journey.progress : null, unison: t < unisonUntil && stage === "holo", hold,
    echo: { level: mix.echoes, spread: echoSpread, count: echoCount },   // the wall's echoes follow these
    flash,                                                         // flashes hit both screens together
    dancerGone, hue: psy.uniforms.hue.value,                  // the colour drift: both screens the same
    // her pose as shown (clip name, time, weight per layer) + her accents: the projector dances the same
    pose: dancer.root.visible ? (dancer.history[dancer.history.length - 1]?.layers || []).map((l) => [l.clip.name, l.time, l.weight]) : null,
    accents: { ...dancer.accents },
    journeySnap: journey?.snapshot ?? null, stutter: dancer.stepsPerBeat || 0,   // the projector follows the journey
    stage,                                                         // where she is: the projector shows her on "wall"
  });
  $("info").textContent =
    `${fpsShown.toFixed(0)} fps (upd ${perfU.toFixed(1)} ms = audio ${prof.audio.toFixed(1)} dancer ${prof.dancer.toFixed(1)} ` +
    `hair ${prof.hair.toFixed(1)} mind ${prof.mind.toFixed(1)} echoes ${prof.echoes.toFixed(1)}; render ${perfR.toFixed(1)} ms)   night: ${director.status()}
` +
    `scene ${sceneName} (${sceneMode})   look ${lookName}${mirror ? " (mirrored)" : ""}   trip ${(trip * 100).toFixed(0)} % (${tripMode})   ` +
    `kaleidoscope ${kaleidoMode}${pu.kaleido.value > 0.5 ? " (on)" : ""}   ` +
    `stutter ${stutterMode}${stepLabel ? ` (${stepLabel})` : steps ? " (16ths)" : ""}   colours ${P.name}   ` +
    `echoes ${echoCount.toFixed(1)} x 1/${Math.round(4 / echoSpread)} notes\n` +
    `now: ${dancer.where()}${grabbed ? `   G: ${grabbed}` : ""}   phrase: ${phraseAction}   accents: ${accentStyle.name}${accentForce !== null ? " (forced, A)" : ""}\n` +
    `move: ${cur ? cur.name : "-"} [${lastMoveMoment}] (${dancer.moves.length} in library)   half-time ${dancer.halfTime ? "on" : "off"}` +
    ` (${halfTimeMode})   whip ${whipOn ? "on" : "off"}   ` +
    `hair ${hairOn ? `${(hair.brightness * 100).toFixed(0)} %` : "off"}   brain ${brain ? `${brainMode}${brainLvl > 0.5 ? " (scene)" : brainHead > 0.5 ? " (head)" : ""}` : "none"}   ` +
    `journey ${journey ? journey.progress : "none"}   she is on: ${stage}   scanner ${sweep ? sweep.dir : dancerGone ? "she is gone" : "-"}   ` +
    `echo slices ${echoSliceMode}${echoSliceOn ? " (on)" : ""}   ` +
    `character: ${character.split("/").pop()}\n` +
    (s.running ? `music ${s.bpm ? s.bpm.toFixed(1) : "--"} BPM  section ${s.section}  intensity ${(s.intensity * 100).toFixed(0)} %` +
      `   playing: ${Object.entries(s.elements || {}).filter(([, e]) => e.on).map(([n]) => n).join(" ") || "-"}` +
      `   stereo ${((s.stereo?.width || 0) * 100).toFixed(0)} %
` +
      `recent: ${recentEvents.filter((r) => t - r.t < 4).map((r) => r.text).join("  ·  ") || "-"}`
               : "no audio: pick a file or start the input (P forces the trip level, D fakes a drop)");
  reporter.tick($("info").textContent);                          // to the dashboard: a small picture + the info line
};

// the dashboard (dashboard.html): it sees this window (a thumbnail + the info line) and sends keys to it
link.on("cmd", async ({ to, action, deviceId, file }) => {        // the dashboard picks the audio input or a test file
  if (to !== "hologram") return;
  if (action === "file" && file) {                                 // a test track: played (and heard) from this window
    $("player").style.display = "block";
    try { await engine.startFile(file, $("player")); } catch (err) { console.warn("test file:", err); }
    return;
  }
  if (action === "playpause") { const p = $("player"); if (p.src) p.paused ? p.play() : p.pause(); return; }
  if (action !== "audio") return;
  const sel = $("device");
  if (![...sel.options].some((o) => o.value === deviceId)) sel.add(new Option("(from the dashboard)", deviceId));
  sel.value = deviceId;
  $("start").click();
});
const reporter = new StatusReporter(link, "hologram", renderer.domElement);
listenRemote(link, "hologram");

// ---------------------------------------------------------------- keep running when the browser pauses this window
// Zen pauses the animation timer of a window that isn't focused (to save power). Then a plain timer draws the frames
// instead (a frame every ~16 ms when no animation frame came for 100 ms).
// A frame cap: no more frames than FPS (the panel shows 60, Miracast to the projector hardly more than 30), so a
// 144 Hz laptop screen doesn't double the work. Trails and motion are per time, so they look the same at any rate.
let lastFrameAt = performance.now(), lastRafAt = performance.now(), inFrame = false, nextAt = 0;
const FRAME_MS = 1000 / FPS;
function runFrame() {
  if (inFrame) return;
  const now = performance.now();
  if (now < nextAt - 1.5) return;                     // too early for the next frame
  nextAt = Math.max(nextAt + FRAME_MS, now - FRAME_MS * 0.5);
  inFrame = true;
  try { frame(); } finally { inFrame = false; lastFrameAt = performance.now(); }
}
renderer.setAnimationLoop(() => { lastRafAt = performance.now(); runFrame(); });
setInterval(() => {                                   // the browser stopped sending frames: draw them from here
  const now = performance.now();
  if (now - lastRafAt > 100 && now - lastFrameAt > 14) runFrame();
}, 16);
