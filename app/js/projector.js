// The projector (HY300, on the wall ~1 m above the hologram): continuous visuals that never stop, driven by the
// hologram window's music state over the show link (it has no audio of its own). Runs alone at a fake tempo until
// the hologram window is open. It complements the hologram instead of copying it, and uses the whole wall.
//   scenes     - seven looks, crossfading on new phrases (or every 16 bars), chosen by the section, never twice in a row:
//                tunnel, mandala, MRI kaleidoscope, flow, scanner (an MRI gantry seen head-on, a sweep reading the
//                brain once a bar; their centre wanders over the wall),
//                waves (oscilloscope lanes across the wall), lightbox (a grid of the brain's MRI slices, like films),
//                halo (the hologram's own background: the fractal mandala + the orbiting wireframe shapes)
//   journey    - while the hologram plays the head journey, the wall is the lightbox: the slice that matches the
//                journey's moment lights up, in the plane the hologram's slice stack shows
//   satellites - 2-4 smaller rings at off-centre spots, pulsing on the kick, moving on each phrase
//   dancer     - her, only while she is up here (the hologram decides: she rises out of the cube onto the wall and sinks
//                back down); on the left or right third, drifting; dark silhouette + gold rim, echoes behind
//   brain      - the 3D brain, in the right third, during the hologram's breakdown brain moments
//   head       - the whole head, big on one side, while the cube is inside it (the journey's peel and slices): it turns
//                to random views / spins / holds, scanner bands pass over it
//   hits       - a small zoom punch on the kick, a rotation step on each bar
//   the cube   - what happens in the cube rises into the wall from its bottom centre (the cube is right below): rings
//                when she changes move or a stutter burst starts, small rings when the brain fires there, a beam when
//                the scanner sweeps; the wall follows the cube's scene (echoes, tunnel, full, solo) and its flashes
//   FX         - builds zoom in and flicker on 8ths at the end; the pre-drop freezes and darkens the wall; the drop
//                flashes inverted; the background freezes/steps with the hologram's stutter; glitch bands on random
//                bars and some hats; instrument layers (hats shimmer, lead sweeps, pads fog, bass breathing); per
//                phrase a look: 2-/4-way mirror x video echoes / time bands x CRT; soft bar flashes at peaks
//   post       - trails (feedback) + kaleidoscope/warp/RGB split (psy) + bloom; the kaleidoscope belongs here
// Keys: F fullscreen, U hide info, K kaleidoscope (auto / on / off), M mirror (rear projection), I idle (test alone),
//       S next scene, L next look, V dancer (auto / on / off), R calibration (picture + where the cube is)
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import { FeedbackPass, PsyPass, Mandala, Orbiters } from "./psy.js";
import { Dancer, Echo, LOOKS, PALETTES } from "./dancer.js";
import { WallParticles } from "./particles.js";
import { glyphAtlas, Readout, DraftPass, DRAFTS, MASKS } from "./draft.js";
import { Tesseract } from "./tesseract.js";
import { unlocked } from "./director.js";
import { loadSpine, KundaliniWall } from "./spine.js";
import { Brain } from "./brain.js";
import { Hair } from "./hair.js";
import { Head } from "./head.js";
import { ShowLink, StatusReporter, listenRemote } from "./link.js";
import { Calibration } from "./calib.js";

const $ = (id) => document.getElementById(id);
const smooth = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, dt * rate);
const link = new ShowLink("projector");
const clock = new THREE.Clock();

// ---------------------------------------------------------------- renderer (the HY300 is 1280x720: no need for more)
// It renders at 720 lines (?res=full: the window's own size) and the browser scales it up; ?fps=30 for a lighter wall
const Q = new URLSearchParams(location.search);
const RES = Q.get("res") === "full" ? 1e9 : +(Q.get("res") || 720), FPS = +(Q.get("fps") || 60);
const pixelRatio = () => Math.min(1, RES / innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });   // (AA: wasted here)
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 10);
camera.position.set(0, 0, 0.62);
scene.add(new THREE.AmbientLight("#7b6ea6", 0.35));
const key = new THREE.DirectionalLight("#ffe08a", 0.5);
key.position.set(0, 2, -2);
scene.add(key);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const feedback = new FeedbackPass();
composer.addPass(feedback);
const psy = new PsyPass();
psy.uniforms.vignette.value = 0.45;
composer.addPass(psy);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.15);
{ const set = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => set(w / 2, h / 2); }   // the glow at half size: ~4x cheaper
composer.addPass(bloom);
// ---------------------------------------------------------------- wall FX: one pass after the bloom
// mirror (2-/4-way), glitch bands, instrument layers (hats scanline shimmer, lead colour sweeps, pads fog, bass
// breathing), video echoes / time bands (from a ring of past frames), CRT, build flicker, pre-drop darkness, drop
// inversion, bar flashes at peaks
class WallFX extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, uTime: { value: 0 }, uMirror: { value: 0 }, uMirrorAmt: { value: 0 }, uEcho: { value: 0 }, uBands: { value: 0 },
      uCrt: { value: 0 }, uH1: { value: null }, uH2: { value: null }, uH3: { value: null },
      uE1: { value: new THREE.Color() }, uE2: { value: new THREE.Color() }, uE3: { value: new THREE.Color() },
      uGlitch: { value: 0 }, uGlitchSeed: { value: 0 }, uInvert: { value: 0 }, uHats: { value: 0 }, uLead: { value: 0 },
      uPads: { value: 0 }, uBass: { value: 0 }, uFlicker: { value: 1 }, uDark: { value: 0 }, uBarFlash: { value: 0 },
      uAspect: { value: innerWidth / innerHeight }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
      uDraft: { value: 0 }, uDraftMode: { value: 0 }, uGlyph: { value: null }, uGlyphN: { value: 1 },
      uText: { value: null }, uTextAmt: { value: 0 },
      uMemTex: { value: null }, uMemRect: { value: new THREE.Vector4(0, 0, 0.125, 1 / 6) }, uMemAmt: { value: 0 },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, uH1, uH2, uH3, uGlyph, uText;
        uniform float uDraft, uDraftMode, uGlyphN, uTextAmt;
        uniform sampler2D uMemTex;
        uniform vec4 uMemRect;
        uniform float uMemAmt;
        uniform vec3 uE1, uE2, uE3;
        uniform float uTime, uMirror, uMirrorAmt, uEcho, uBands, uCrt, uGlitch, uGlitchSeed, uInvert, uHats, uLead, uPads, uBass, uFlicker,
                      uDark, uBarFlash, uAspect;
        uniform vec2 uRes;
        uniform vec3 uC0, uC1, uC2, uC3;
        varying vec2 vUv;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
        }
        float gauss(float x, float w) { float e = x / w; return exp(-e * e); }
        float luma(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
        void main() {
          vec2 uv = vUv, um = vUv;                                 // um: the mirrored picture (cross-faded in by uMirrorAmt)
          if (uMirror > 0.5) um.x = 0.5 - abs(um.x - 0.5);          // 2-way: the left half, mirrored
          if (uMirror > 1.5) um.y = 0.5 - abs(um.y - 0.5);          // 4-way
          uv = 0.5 + (uv - 0.5) * (1.0 - 0.025 * uBass);            // the bass: the picture breathes
          um = 0.5 + (um - 0.5) * (1.0 - 0.025 * uBass);
          float split = 0.0;
          if (uGlitch > 0.01) {                                    // glitch bands: rows shifted sideways + RGB split
            float h = h1(floor(uv.y * 28.0) + uGlitchSeed * 31.7);
            if (h > 0.55) { uv.x += (h - 0.775) * 0.25 * uGlitch; split = 0.006 * uGlitch; }
          }
          vec3 col = vec3(texture2D(tDiffuse, uv + vec2(split, 0.0)).r, texture2D(tDiffuse, uv).g,
                          texture2D(tDiffuse, uv - vec2(split, 0.0)).b);
          if (uMirrorAmt > 0.01) {
            um.x += uv.x - (0.5 + (vUv.x - 0.5) * (1.0 - 0.025 * uBass));   // (the same glitch shift)
            col = mix(col, vec3(texture2D(tDiffuse, um + vec2(split, 0.0)).r, texture2D(tDiffuse, um).g,
                                texture2D(tDiffuse, um - vec2(split, 0.0)).b), uMirrorAmt);
          }
          // time bands: horizontal bands, each showing a different moment of the past (slit scan)
          if (uBands > 0.01) {                                     // 3 soft bands: now, a moment ago, two moments ago
            float b = fract(uv.y * 3.0 + 0.08 * sin(uv.x * 4.0 + uTime * 0.4) + uTime * 0.02) * 3.0;
            float w0 = 1.0 - smoothstep(0.85, 1.15, b) + smoothstep(2.85, 3.0, b);
            float w1 = smoothstep(0.85, 1.15, b) * (1.0 - smoothstep(1.85, 2.15, b));
            float w2 = smoothstep(1.85, 2.15, b) * (1.0 - smoothstep(2.85, 3.0, b));
            vec3 past = (col * w0 + texture2D(uH1, uv).rgb * w1 + texture2D(uH2, uv).rgb * w2) / (w0 + w1 + w2 + 1e-4);
            col = mix(col, past, uBands * 0.55);
          }
          // video echoes: three moments of the past over the picture, tinted, a little bigger each time
          if (uEcho > 0.01) {
            vec2 c = uv - 0.5;
            vec3 e = texture2D(uH1, 0.5 + c / 1.03).rgb * uE1 * 0.6 + texture2D(uH2, 0.5 + c / 1.06).rgb * uE2 * 0.45
                   + texture2D(uH3, 0.5 + c / 1.09).rgb * uE3 * 0.32;
            col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - clamp(e * 0.9 * uEcho, 0.0, 1.0));   // screen blend: never white-out
          }
          // a memory of the night: a ghost of an earlier moment over the wall, slowly drifting closer
          if (uMemAmt > 0.01) {
            vec2 mq = clamp(0.5 + (vUv - 0.5) * (0.94 - 0.05 * uMemAmt), 0.002, 0.998);
            vec3 mc = texture2D(uMemTex, uMemRect.xy + mq * uMemRect.zw).rgb;
            col = 1.0 - (1.0 - col) * (1.0 - clamp(mc * 0.5 * uMemAmt, 0.0, 1.0));
          }
          // instruments: hats = fine scanlines + sparkle, lead = colour sweep, pads = colour fog
          float scan = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708);
          float sparkle = step(0.985, h2(vec2(floor(vUv.y * uRes.y * 0.5), floor(uTime * 24.0))));
          col *= 1.0 - 0.18 * uHats * (1.0 - scan);
          col += uC3 * sparkle * uHats * 0.25;
          col += uC2 * gauss(fract(vUv.x * 0.7 + vUv.y * 0.35 - uTime * 0.3) - 0.5, 0.07) * uLead * 0.3;
          col += mix(uC0, uC3, n2(vUv * vec2(uAspect, 1.0) * 2.5 + uTime * 0.05)) * uPads * 0.14;
          // the MRI readout (text column + markers), drawn in a canvas
          if (uTextAmt > 0.01) {
            vec4 tx = texture2D(uText, vUv);
            col = col * (1.0 - 0.5 * tx.a * uTextAmt) + tx.rgb * tx.a * uTextAmt * 1.1;
          }
          // CRT: scanlines, grain, a soft vignette
          if (uCrt > 0.01) {
            float sl = 0.88 + 0.12 * sin(vUv.y * uRes.y * 3.14159);
            float gr = (h2(vUv * uRes + uTime * 60.0) - 0.5) * 0.06;
            vec2 v = vUv - 0.5;
            col = mix(col, col * sl + gr * 0.3, uCrt) * mix(1.0, 1.0 - dot(v, v) * 0.9, uCrt);
          }
          col *= uFlicker * (1.0 - 0.7 * uDark);                  // build flicker, pre-drop darkness
          col += uC1 * uBarFlash * 0.12;                           // peaks: a soft flash on each bar
          col = mix(col, max(vec3(0.0), vec3(1.0) - col) * uC1 * 0.3, uInvert * 0.8);   // the drop: inverted, dark
          gl_FragColor = vec4(col * 0.85, 1.0);                     // (the whole wall a little darker)
        }`,
    }));
    // the past: a ring of half-size frames (for the echoes and the time bands); delays in frames, set by the show
    this.hist = Array.from({ length: 24 }, () => new THREE.WebGLRenderTarget(innerWidth / 2, innerHeight / 2,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    this.head = 0;
    this.delays = [4, 8, 12];
    this.keep = 1;                                // always record (so a look never starts with stale frames)
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms, n = this.hist.length;
    const now = performance.now();
    if ((u.uEcho.value > 0.01 || u.uBands.value > 0.01 || this.keep > 0) && now - (this.lastRec ?? 0) >= 1000 / 30 - 2) {
      this.lastRec = now;
      this.copy.material.uniforms.tDiffuse.value = readBuffer.texture;      // remember this frame
      renderer.setRenderTarget(this.hist[this.head]);
      this.copy.render(renderer);
      [u.uH1, u.uH2, u.uH3].forEach((h, i) => (h.value = this.hist[(this.head - this.delays[i] + n * 2) % n].texture));
      this.head = (this.head + 1) % n;
    }
    u.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  setSize(w, h) {
    this.uniforms.uAspect.value = w / h; this.uniforms.uRes.value.set(w, h);
    this.hist.forEach((rt) => rt.setSize(w / 2, h / 2));
  }
}
const glyphs = glyphAtlas();
const draft = new DraftPass(glyphs);           // the drafting looks: the whole wall, a window on an element, a band, a half
composer.addPass(draft);
const DU = draft.uniforms;
DU.tElem.value = new THREE.DataTexture(new Uint8Array(4), 1, 1); DU.tElem.value.needsUpdate = true;   // (until the layer is used)
const wallfx = new WallFX();
composer.addPass(wallfx);
const readout = new Readout();
wallfx.uniforms.uMemTex.value = null;   // (set once the atlas exists, below)
wallfx.uniforms.uText.value = readout.tex;
addEventListener("resize", () => { readout.resize(); });

composer.addPass(new OutputPass());
const calib = new Calibration("wall", composer, { cube: true });   // R: the wall picture + where the cube is
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio()); composer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  pu.uAspect.value = innerWidth / innerHeight;
});
// half the visible width at the picture plane (z = 0), for placing things on the thirds
const halfWidth = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;

// ---------------------------------------------------------------- assets: the MRI volume, the brain, her
let vol = null, brain = null, dancer = null;
try {
  const [meta, bin] = await Promise.all([fetch("assets/brain/head_volume.json").then((r) => r.json()),
    fetch("assets/brain/head_volume.bin").then((r) => r.arrayBuffer())]);
  const tex = new THREE.Data3DTexture(new Uint8Array(bin), ...meta.dims);
  Object.assign(tex, { format: THREE.RGFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter, unpackAlignment: 1, needsUpdate: true });
  vol = { tex, meta };
} catch (e) { console.info("no MRI volume:", e.message); }
try { brain = await Brain.load(); scene.add(brain.root); } catch (e) { console.info("no brain model:", e.message); }
let head = null;
try { head = await Head.load(); scene.add(head.root); } catch (e) { console.info("no head model:", e.message); }
// the head's own motion here: a new view, a spin or a hold every 4 bars (like on the hologram)
const HVIEWS = [0, 0.65, -0.65, Math.PI / 2, -Math.PI / 2, 2.4, -2.4];
const hd = { lvl: 0, yaw: 0, pitch: -0.05, view: 0, spin: 0, bar: -1, side: -1, qHist: [] };

// her: the same character, moves and look as in the cube (hologram glow, physics hair, echoes). She lives in her own
// layer at real size with her own camera (the hair physics works in real metres), drawn over the background and
// before the effects; she dances her own moves once she is up here
const dancerPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 10);
const dancerScene = new THREE.Scene();
const dancerCam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 50);
const dLight = new THREE.DirectionalLight("#ffe08a", 0.6);
dLight.position.set(0, 2.5, -3);
dancerScene.add(dLight);
let echoes = [], hair = null, DH = 1.7, herPass = null;
// her mandala halo, as in the cube: behind her, centred on her, added to the wall's picture (not covering it)
const halo = new Mandala();
Object.assign(halo.mesh.material, { transparent: true, blending: THREE.AdditiveBlending });
dancerScene.add(halo.mesh);
let haloLvl = 0;
try {
  const list = await (await fetch("api/dancers")).json();
  if (list.character) {
    dancer = await Dancer.load(list.character, list.moves || []);
    dancer.setLook(LOOKS.hologram);
    dancer.material.clippingPlanes = [dancerPlane];
    dancer.setPools(list.pools || {});
    DH = dancer.height;
    dancerScene.add(dancer.root);
    hair = new Hair(dancer);
    dancerScene.add(hair.mesh);
    echoes = [0.1, 0.2, 0.3, 0.4].map((d) => {
      const e = new Echo(dancer, d);
      e.material.clippingPlanes = [dancerPlane];
      dancerScene.add(e.root);
      return e;
    });
    herPass = new RenderPass(dancerScene, dancerCam);
    herPass.clear = false; herPass.clearDepth = true;               // over the background, before the effects
    composer.insertPass(herPass, 1);
  }
} catch (e) { console.info("no dancer:", e.message); }
const dancerDist = () => (DH * 0.62) / Math.tan(THREE.MathUtils.degToRad(16));
addEventListener("resize", () => { dancerCam.aspect = innerWidth / innerHeight; dancerCam.updateProjectionMatrix(); });

const ACCENTS = [{ sway: 0.24, twist: 0.05, nod: 0.03 }, { sway: 0.05, twist: 0.22, nod: 0.03 },
  { sway: 0.03, twist: 0.03, nod: 0.18 }, { sway: 0.16, twist: 0.14, nod: 0.12 }];
let lastOwnChange = -1e9, side = 1, dancerX = 0, riseFromCube = false;
const holoNames = (pose) => (pose || []).map(([n]) => n.replace(/ \[(lower|upper)\]$/, ""));
function ownMove(fade, moment, audio) {
  if (!dancer) return;
  dancer.next(fade, moment, audio);
  Object.assign(dancer.accents, ACCENTS[0 | Math.random() * ACCENTS.length]);
  lastOwnChange = clock.elapsedTime;
}
const momentOf = (sec) => (sec === "breakdown" || sec === "silence" ? "breakdown" : sec === "build" ? "build" : sec === "peak" ? "peak" : "normal");

// ---------------------------------------------------------------- the background: seven scenes in one shader
const SCENES = ["tunnel", "mandala", "mri", "flow", "scanner", "waves", "lightbox", "halo", "swarm", "hyper", "spine"];
const NSAT = 4;
const portal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uBeat: { value: 0 }, uKick: { value: 0 }, uLow: { value: 0.4 }, uMid: { value: 0.4 },
    uHigh: { value: 0.4 }, uSpeed: { value: 1 }, uSeg: { value: 8 }, uFlash: { value: 0 }, uRings: { value: 0.6 },
    uMri: { value: 0 }, uSlice: { value: 0.5 }, uBright: { value: 1 }, uAspect: { value: innerWidth / innerHeight },
    uHole: { value: 0.08 }, uModeA: { value: 0 }, uModeB: { value: 0 }, uModeMix: { value: 0 }, uRot: { value: 0 }, uTrans: { value: 0 }, uTransSeed: { value: 0 },
    uZoom: { value: 1 }, uFill: { value: 0 }, uCenter: { value: new THREE.Vector2() },
    uLbAxis: { value: 1 }, uLbActive: { value: 0 }, uLbScroll: { value: 0 },
    uSat: { value: Array.from({ length: NSAT }, () => new THREE.Vector4(0, 0, 0.05, 0)) },
    uRise: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 1, 0, 0)) }, uCubeY: { value: -0.52 }, uSatSeed: { value: 0 }, uGlyph: { value: null }, uGlyphN: { value: 1 },
    uMemTex: { value: null }, uMemN: { value: 0 }, uMemShift: { value: 0 }, uMemLb: { value: 0 },
    uTorso: { value: null }, uTorsoOn: { value: 0 },
    uC0: { value: new THREE.Color("#30245a") }, uC1: { value: new THREE.Color("#ffc94d") }, uC2: { value: new THREE.Color("#ff5fa2") },
    uC3: { value: new THREE.Color("#4fd8ff") }, uC4: { value: new THREE.Color("#ffb347") },
    uVol: { value: vol?.tex ?? null }, uHasVol: { value: vol ? 1 : 0 },
    uBMin: { value: new THREE.Vector3(0.1, 0.25, 0.1) }, uBSize: { value: new THREE.Vector3(0.8, 0.6, 0.75) },
  },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }",
  fragmentShader: /* glsl */ `
    uniform float uTrans, uTransSeed;    // how the scenes change: 0 through the portal, 1 dissolve, 2 scan, 3 spiral iris
    uniform float uTime, uBeat, uKick, uLow, uMid, uHigh, uSpeed, uSeg, uFlash, uRings, uMri, uSlice, uBright,
                  uAspect, uHole, uHasVol, uModeA, uModeB, uModeMix, uRot, uZoom, uFill, uLbAxis, uLbActive, uLbScroll;
    uniform vec2 uCenter;
    uniform vec4 uSat[${NSAT}];
    uniform vec4 uRise[8];             // from the cube below: x, age 0..1, strength, kind (0 ring, 1 beam)
    uniform float uCubeY;              // the cube's height on the wall (calibration)
    uniform float uSatSeed;            // which figures the satellites show (new on each phrase)
    uniform sampler2D uGlyph;          // the glyphs (the data streams out of the cube)
    uniform float uGlyphN;
    uniform sampler2D uMemTex;         // memories of the night (atlas 8 x 6), shown as films in the lightbox
    uniform float uMemN, uMemShift, uMemLb;
    uniform sampler3D uTorso;          // the torso (coronal T2, hips up): every third film in the lightbox
    uniform float uTorsoOn;
    uniform vec3 uC0, uC1, uC2, uC3, uC4, uBMin, uBSize;
    uniform highp sampler3D uVol;
    varying vec2 vUv;
    const float TAU = 6.2831853;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.03) + 0.15 * noise(p * 4.1); }
    float grid(float x, float w) { float d = abs(fract(x + 0.5) - 0.5); return 1.0 - smoothstep(0.0, fwidth(x) * w, d); }
    float gauss(float x, float w) { float e = x / w; return exp(-e * e); }       // (never pow of a negative)
    float folded(float a) { float seg = TAU / uSeg; return abs(mod(a, seg) - 0.5 * seg); }

    // the brain at a point of the MRI texture (brain only): tissue colour + anatomy edges
    vec3 mriTex(vec3 q, out float inside) {
      inside = 0.0;
      if (uHasVol < 0.5) return vec3(0.0);
      vec3 tc = uBMin + uBSize * q;
      if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return vec3(0.0);
      vec2 s = texture(uVol, tc).rg;
      inside = step(0.75, s.g) * smoothstep(0.05, 0.2, s.r);
      float e = 0.006;
      float gx = texture(uVol, tc + vec3(e, 0, 0)).r - texture(uVol, tc - vec3(e, 0, 0)).r;
      float gy = texture(uVol, tc + vec3(0, e, 0)).r - texture(uVol, tc - vec3(0, e, 0)).r;
      float gz = texture(uVol, tc + vec3(0, 0, e)).r - texture(uVol, tc - vec3(0, 0, e)).r;
      float edge = smoothstep(0.08, 0.3, length(vec3(gx, gy, gz)));
      return (mix(uC0 * 1.5, uC3, smoothstep(0.35, 0.6, s.r)) + uC2 * smoothstep(0.62, 0.85, s.r)) * (0.55 + 0.45 * uKick)
             + uC1 * edge * 0.8;
    }
    // a point of a plane through the brain: axis 0 = sagittal, 1 = axial, 2 = coronal; t = where along the axis
    vec3 mriPlane(vec2 m, float axis, float t, out float inside) {
      vec3 q = axis < 0.5 ? vec3(t, 0.5 + m.y, 0.5 + m.x) : axis < 1.5 ? vec3(0.5 + m.x, t, 0.5 - m.y) : vec3(0.5 + m.x, 0.5 + m.y, t);
      return mriTex(q, inside);
    }

    vec3 tunnel(vec2 p) {                        // flying through a tube of lines; rings rush at you on the beat
      float r = length(p) + 1e-4, a = atan(p.y, p.x);
      float u = a / TAU * uSeg * 2.0;
      float v = 0.32 / r + uBeat * 0.5 * uSpeed;
      float fog = smoothstep(0.03, 0.45, r);
      float ring = grid(v, 2.0) * (0.35 + 1.1 * uKick * gauss(fract(v) - 0.5, 0.5));
      float beatRing = gauss(fract(v - uBeat * 0.5 * uSpeed + 0.5) - 0.5, 0.04);
      vec3 col = uC3 * grid(u, 1.4) * 0.35 + uC1 * ring * uRings + uC2 * beatRing * 0.25;
      col += mix(uC2, uC3, 0.5 + 0.5 * sin(v * 0.7)) * uFill * 0.35 * smoothstep(0.4, 0.9, fbm(vec3(u * 0.3, v * 0.5, uTime * 0.2)));
      return col * fog;
    }
    vec3 mandala(vec2 p) {                       // petals breathing open and closed with the bar
      float r = length(p), a = atan(p.y, p.x);
      float open = 0.5 - 0.5 * cos(fract(uBeat / 4.0) * TAU);
      float R = 0.2 + (0.07 + 0.05 * open) * cos(a * uSeg + uTime * 0.15) + 0.03 * uLow;
      float lines = grid((r - R) * 22.0 - uBeat * 0.5, 1.5) * smoothstep(0.75, 0.15, r);
      float petal = smoothstep(0.02, 0.0, r - R) * uFill;
      return mix(uC2, uC4, 0.5 + 0.5 * cos(a * uSeg)) * lines * (0.45 + 0.6 * uKick) + uC3 * petal * 0.3
             + uC1 * gauss(r - R, 0.006) * (0.6 + uKick);
    }
    vec3 mriScene(vec2 p) {                      // the brain's slices as a kaleidoscope
      float r = length(p), fa = folded(atan(p.y, p.x) + uTime * 0.05), inside;
      vec3 c = mriPlane(vec2(cos(fa), sin(fa)) * r * 0.85, 1.0, uSlice, inside);
      return c * inside * 0.42 + uC1 * grid(r * 10.0 - uBeat * 0.25, 1.2) * 0.12 * (1.0 - inside);
    }
    vec3 flow(vec2 p) {                          // liquid contour lines
      float r = length(p) + 1e-4, fa = folded(atan(p.y, p.x) + uTime * 0.02);
      float f = fbm(vec3(fa * 2.2, log(r) * 1.4 + uBeat * 0.125 * uSpeed, uTime * 0.05) + uLow * 0.6);
      float k = f * 8.0 - uTime * 0.2 * uSpeed;
      return mix(uC2, uC3, f) * grid(k, 1.5) * (0.45 + 0.5 * uMid) + mix(uC0, uC2, f) * uFill * 0.4 * smoothstep(0.5, 0.75, f);
    }
    vec3 scanner(vec2 p) {                       // an MRI scanner seen head-on: gantry rings, a sweep once a bar,
      float r = length(p), a = atan(p.y, p.x);   // the brain's slice appearing behind the sweep
      float R0 = 0.28;
      float sweepA = mod(uBeat * TAU / 4.0, TAU);
      float d = mod(sweepA - a + 2.0 * TAU, TAU);                         // how far behind the sweep (radians)
      float trail = exp(-d * 1.4);
      vec3 col = vec3(0.0);
      for (int k = 0; k < 3; k++) {                                       // the gantry: rings with ticks, turning
        float fk = float(k), rk = (R0 + 0.035 + fk * 0.032) * (1.0 + 0.025 * uKick);
        float dir = k == 1 ? -1.0 : 1.0;
        float ticks = grid((a + dir * uTime * (0.12 + 0.05 * fk)) / TAU * (36.0 + 12.0 * fk), 1.2) * gauss(r - rk, 0.009);
        col += uC3 * gauss(r - rk, 0.0022) * 0.55 + uC1 * ticks * 0.35;
      }
      col += uC1 * gauss(d, 0.018) * step(r, R0 + 0.13) * (0.7 + uKick);   // the sweep line
      if (r < R0) {                                                       // inside the bore: the brain, read by the sweep
        float inside;
        vec3 m = mriPlane(p / (2.0 * R0), 1.0, uSlice, inside);
        col += m * inside * (0.12 + 0.9 * trail) + uC2 * trail * 0.04;
      }
      col += uC0 * 1.5 * grid(r * 12.0 - uBeat * 0.5, 1.2) * 0.25 * smoothstep(R0 + 0.15, R0 + 0.45, r);   // drifting circles
      return col;
    }
    vec3 waves(vec2 p) {                         // oscilloscope lanes across the wall: lows at the bottom, highs on top
      vec3 col = vec3(0.0);
      float xs = p.x / uAspect + 0.5;                                    // 0..1 across the wall
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float y0 = -0.36 + fi * 0.144;
        float band = i < 2 ? uLow : i < 4 ? uMid : uHigh;
        float x = p.x * (3.0 + fi * 1.3) - uTime * (0.5 + 0.2 * fi) * uSpeed;
        float w = 0.6 * sin(x * 2.0 + fi) + 0.35 * sin(x * 5.3 - fi * 1.7) * uMid + 0.5 * (noise(vec3(x * 2.5, fi * 3.1, uTime * 0.7)) - 0.5);
        float spike = gauss(xs - fract(uBeat * 0.25 + fi * 0.13), 0.02) * uKick;   // the kick runs along each lane
        float y = y0 + (0.015 + 0.05 * band) * w + spike * 0.07;
        col += mix(uC2, uC3, fi / 5.0) * gauss(p.y - y, 0.0022 + 0.002 * uKick) * (0.6 + 0.6 * band);
        col += uC1 * gauss(p.y - y0, 0.0008) * 0.12;                          // the lane's base line
      }
      return col;
    }
    vec3 lightbox(vec2 p) {                      // the brain's slices as films on a light board, scrolling sideways
      float cols = 6.0, rows = 3.0, n = cols * rows;
      vec2 size = vec2(uAspect * 0.94, 0.86);
      vec2 q = (p + size * 0.5) / size;
      if (q.y < 0.0 || q.y > 1.0) return vec3(0.0);
      q.x += uLbScroll;
      vec2 cell = floor(q * vec2(cols, rows)), f = fract(q * vec2(cols, rows));
      float j = mod(cell.x, cols) + (rows - 1.0 - cell.y) * cols;          // reading order
      vec2 cs = size / vec2(cols, rows);
      vec2 m = (f - 0.5) * cs / min(cs.x, cs.y) * 1.05;
      float inside;
      vec3 c = mriPlane(m, uLbAxis, 0.08 + 0.84 * (j + 0.5) / n, inside);
      float d = abs(j - uLbActive);
      float act = 1.0 - smoothstep(0.0, 1.5, min(d, n - d));
      float frame = max(grid(q.x * cols, 1.2), grid(q.y * rows, 1.2));
      float scan = gauss(f.y - fract(uBeat), 0.01) * act;
      if (uTorsoOn > 0.5 && mod(j, 3.0) > 1.5) {                       // every third film: the torso, a slice moving through
        vec2 tq = vec2(0.5 + (f.x - 0.5) * (cs.x / cs.y) * 1.35, f.y);
        float tv = texture(uTorso, vec3(clamp(tq, 0.001, 0.999), 0.2 + 0.6 * fract(j * 0.37 + uLbScroll * 3.0))).r;
        c = vec3(tv) * mix(uC2, vec3(1.0), 0.45) * 0.75 * step(0.0, tq.x) * step(tq.x, 1.0); inside = 1.0;
      }
      if (uMemLb > 0.01 && mod(j, 2.0) > 0.5 && uMemN > 0.5) {        // every other film: a memory of the night
        float k = mod(floor(j / 2.0) + uMemShift, uMemN);
        vec2 sl = vec2(mod(k, 8.0), floor(k / 8.0));
        vec3 mc = texture2D(uMemTex, (sl + clamp(f, 0.002, 0.998)) / vec2(8.0, 6.0)).rgb;
        c = mix(c * inside, mc * 0.8, uMemLb); inside = 1.0;
      }
      return c * inside * (0.3 + 0.9 * act) + uC1 * frame * (0.12 + 0.5 * act) + uC4 * scan * 0.8;
    }
    vec3 sceneAt(float m, vec2 p, vec2 pc) {     // pc: centred on the wandering centre (radial scenes)
      if (m < 0.5) return tunnel(pc);
      if (m < 1.5) return mandala(pc);
      if (m < 2.5) return mriScene(pc);
      if (m < 3.5) return flow(pc);
      if (m < 4.5) return scanner(pc);
      if (m < 5.5) return waves(p);
      if (m < 6.5) return lightbox(p);
      return vec3(0.0);                          // halo, swarm: drawn as 3D layers (the mandala + shapes, the particles)
    }
    float holeFor(float m) { return m < 1.5 || (m > 2.5 && m < 3.5) ? 1.0 : 0.0; }   // tunnel, mandala, flow have the portal
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float c = cos(uRot), s = sin(uRot);
      vec2 pc = mat2(c, -s, s, c) * (p - uCenter) * uZoom;               // the kick punch + the bar's rotation step
      vec2 pz = p * uZoom;
      // the scene change: not a crossfade - the new scene comes through the portal, dissolves in, is scanned in or
      // spirals in; a glowing edge where they meet
      float tm = uModeMix, w = 0.0, edge = 0.0;
      // the zoom of "through the portal" (only in that kind; 1 otherwise), then the two scenes - sceneAt only twice
      // (each call is the whole scene shader: more calls make the shader compile for ages on Windows)
      float por = uTrans < 0.5 && uModeB != uModeA ? 1.0 : 0.0;
      float za = mix(1.0, 1.0 / (1.0 + 1.1 * tm * tm), por), zb = mix(1.0, 1.0 + 1.4 * (1.0 - tm) * (1.0 - tm), por);   // (gentle)
      vec3 sA = sceneAt(uModeA, pz * za, pc * za);
      vec3 sB = uModeB != uModeA ? sceneAt(uModeB, pz * zb, pc * zb) : sA;
      if (uModeB != uModeA && tm > 0.0) {
        float rr = length(pc);
        if (uTrans < 0.5) {                        // through the portal: the old scene rushes past, the new grows out
          float R = tm * 1.45;
          w = 1.0 - smoothstep(R - 0.3, R, rr);
          edge = gauss(rr - R + 0.06, 0.03 + 0.01 * uKick) * 0.6;
        } else if (uTrans < 1.5) {                 // dissolve: organic shapes eat through, a glowing rim
          float n = fbm(vec3(p * 2.2, uTransSeed)) * 0.9 + 0.05, th = tm * 1.1 - 0.05;
          w = smoothstep(n - 0.12, n + 0.12, th);
          edge = gauss(th - n, 0.05) * 0.5;
        } else if (uTrans < 2.5) {                 // MRI scan: a bright line sweeps up, the new scene behind it
          float y = mix(-0.75, 0.75, tm);
          w = 1.0 - smoothstep(y - 0.18, y + 0.04, p.y);
          edge = gauss(p.y - y, 0.005) * 0.9 + 0.2 * gauss(p.y - y + 0.06, 0.06);
        } else {                                   // spiral iris from the centre
          float a = atan(pc.y, pc.x) / TAU + 0.5;
          float sp = fract(a + rr * 1.8 + uTransSeed) * 0.35 + rr * 0.9, th = tm * 1.45;
          w = smoothstep(sp - 0.12, sp + 0.12, th);
          edge = gauss(th - sp, 0.04) * 0.5;
        }
      }
      w = mix(w, tm, 0.25);                        // (a little of a plain blend everywhere: no hard regions)
      edge *= smoothstep(0.0, 0.15, tm) * smoothstep(1.0, 0.85, tm);
      vec3 col = uC0 * 0.1 + mix(sA, sB, w) + mix(uC1, vec3(1.0), 0.2) * edge * 0.6;
      float r = length(pc);
      // breakdowns: the brain's slices fold over the radial scenes
      if (uMri > 0.01) {
        float inside, fa = folded(atan(pc.y, pc.x) + uTime * 0.02);
        vec3 m = mriPlane(vec2(cos(fa), sin(fa)) * r * 1.15, 1.0, uSlice, inside);
        col = mix(col, m * 0.6, inside * uMri * mix(holeFor(uModeA), holeFor(uModeB), w));
      }
      // the portal at the (wandering) centre: a dark hole with a glowing lip, pulsing on kicks
      float holeAmt = mix(holeFor(uModeA), holeFor(uModeB), w);
      col *= mix(1.0, smoothstep(uHole * 0.6, uHole, r), holeAmt);
      col += uC1 * gauss(r - uHole, 0.006 + 0.01 * uKick) * (0.5 + 1.2 * uKick) * holeAmt + uC4 * uFlash * exp(-r * 3.0);
      // satellites: drafting figures at off-centre spots (after GEOMETRIC): a circle chain, a marker (corner
      // brackets + crosshair), the seed of life, nested polygons; a new mix of figures on each phrase
      for (int i = 0; i < ${NSAT}; i++) {
        vec4 st = uSat[i];
        if (st.w < 0.01) continue;
        vec2 d = p - st.xy;
        float R = st.z * (1.0 + 0.06 * uKick), lw = 0.0016 + 0.001 * uKick;
        float kind = mod(float(i) + uSatSeed, 4.0), rot = uTime * 0.05 * (float(i) - 1.5) + uBeat * 0.02;
        vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * d;
        float l = 0.0, l2 = 0.0;
        if (kind < 1.0) {                       // circle chain: tangent circles shrinking along a turning path
          vec2 c = vec2(0.0); float r = R * 0.55, a = 0.0;
          for (int j = 0; j < 6; j++) {
            l += gauss(length(q - c) - r, lw) * (1.0 - float(j) * 0.12);
            l2 += gauss(length(q - c), lw * 1.5);
            float rn = r * 0.72; a += 0.9 + 0.25 * sin(uBeat * 0.125);
            c += vec2(cos(a), sin(a)) * (r + rn); r = rn;
          }
        } else if (kind < 2.0) {               // a marker: corner brackets, a crosshair, a dot circle
          vec2 aq = abs(q);
          float box = gauss(max(aq.x, aq.y) - R * 0.8, lw) * step(R * 0.5, min(aq.x, aq.y));
          float crs = (gauss(q.y, lw) * step(aq.x, R * 0.35) + gauss(q.x, lw) * step(aq.y, R * 0.35)) * step(R * 0.08, max(aq.x, aq.y));
          float ang = atan(q.y, q.x);
          float dots = gauss(length(q) - R * 0.55, lw * 1.5) * step(0.7, fract(ang / TAU * 32.0));
          l = box + crs; l2 = dots;
        } else if (kind < 3.0) {               // seed of life: 7 circles + the outer circle
          float r = R * 0.33;
          l = gauss(length(q) - r, lw) + gauss(length(q) - 2.0 * r, lw) * 0.6;
          for (int j = 0; j < 6; j++) {
            float a = float(j) * TAU / 6.0;
            l += gauss(length(q - vec2(cos(a), sin(a)) * r) - r, lw);
          }
        } else {                                // nested polygons: hexagon, triangle, square, turning on the beat
          float ang = atan(q.y, q.x), dl = length(q);
          for (int j = 0; j < 3; j++) {
            float n = j == 0 ? 6.0 : j == 1 ? 3.0 : 4.0, seg = TAU / n, a = ang + float(j) * uBeat * 0.0625;
            float pq = cos(floor(0.5 + a / seg) * seg - a) * dl;
            l += gauss(pq - R * (0.8 - 0.2 * float(j)), lw);
          }
          l2 = gauss(dl - R * 0.05, lw * 2.0);
        }
        col += (uC1 * l * (0.45 + 0.6 * uKick) + uC2 * l2 * 0.6) * st.w;
      }
      // what rises from the cube: an MRI scan line sweeping up the wall (tick marks, a bracket over the cube at the
      // start); beams: a column of glyphs climbing out of the cube like a data stream
      for (int i = 0; i < 8; i++) {
        vec4 R = uRise[i];
        if (R.y >= 1.0 || R.z < 0.01) continue;
        float fade = 1.0 - R.y;
        if (R.w < 0.5) {
          float ly = uCubeY + 0.04 + R.y * 1.05, dx = p.x - R.x;
          float line = gauss(p.y - ly, 0.0016) * (0.25 + 0.75 * exp(-dx * dx * 6.0));
          float ticks = gauss(p.y - ly - 0.008, 0.004) * step(0.85, fract(p.x * 40.0)) * exp(-dx * dx * 3.0);
          float below = ly - p.y;
          float glow = step(0.0, below) * exp(-below * 18.0) * exp(-dx * dx * 8.0) * 0.2;   // a faint afterglow under it
          vec2 bq = abs(p - vec2(R.x, uCubeY + 0.05));
          float br = gauss(max(bq.x, bq.y) - 0.045, 0.0015) * step(0.03, min(bq.x, bq.y)) * (1.0 - smoothstep(0.0, 0.3, R.y));
          col += (mix(uC1, uC3, R.y) * (line + ticks * 0.6 + glow) + uC1 * br) * fade * R.z * 0.9;
        } else {
          float cs = 0.026;
          vec2 g = (p - vec2(R.x, uCubeY)) / cs;
          float cx = floor(g.x + 0.5);
          if (abs(cx) < 1.5) {
            float hd = R.y * 1.25 / cs, ry = floor(g.y), tail = (hd - ry) / 12.0;
            if (ry >= 0.0 && ry <= hd && tail < 1.0) {
              vec2 cf = vec2(fract(g.x + 0.5), fract(g.y));
              float gi = floor(fract(sin(dot(vec2(ry, cx + floor(uTime * 9.0)), vec2(12.9898, 78.233))) * 43758.5453) * uGlyphN * 0.6 + uGlyphN * 0.35);
              float gm = texture2D(uGlyph, vec2((min(gi, uGlyphN - 1.0) + cf.x) / uGlyphN, cf.y)).r;
              float top = ry > hd - 1.0 ? 1.0 : 0.0;
              col += mix(uC1, vec3(1.0), 0.4 * top) * gm * (1.0 - tail) * (abs(cx) < 0.5 ? 1.0 : 0.45) * (1.0 + 0.8 * top) * fade * R.z;
            }
          }
        }
      }
      gl_FragColor = vec4(col * uBright, 1.0);
    }`,
  depthTest: false, depthWrite: false,
}));
portal.frustumCulled = false;
portal.renderOrder = -1;
scene.add(portal);
const pu = portal.material.uniforms;
pu.uGlyph.value = glyphs.tex; pu.uGlyphN.value = glyphs.n;
if (vol && brain) {   // where the brain sits in the volume texture (the brain is centred on the frame's origin)
  const mn = new THREE.Vector3(...vol.meta.min), sz = new THREE.Vector3(...vol.meta.size);
  pu.uBMin.value.copy(brain.size).multiplyScalar(-0.5).sub(mn).divide(sz);
  pu.uBSize.value.copy(brain.size).divide(sz);
}

// the hologram's background, for the "halo" scene: the fractal mandala over the whole wall + the wireframe shapes
const wallHalo = new Mandala();
Object.assign(wallHalo.mesh.material, { transparent: true, blending: THREE.AdditiveBlending });
scene.add(wallHalo.mesh);
const orbit = new Orbiters(0.3);
scene.add(orbit.group);
// particles: the flowing swarm (its own scene, "swarm", and a light layer in builds and peaks) + sparks from the cube
const parts = new WallParticles();
scene.add(parts.group);
// the tesseract: its own scene ("hyper"), turning through 4D
const hyper = new Tesseract({ radius: 0.006, joint: 0.016 });
scene.add(hyper.group);
// the spine (the spine MRI): the kundalini scene ("spine") and the torso as films in the lightbox
let spine = null, kund = null, kundBurst = 0;
try { spine = await loadSpine(); kund = new KundaliniWall(spine); scene.add(kund.mesh); }
catch (e) { console.info("no spine MRI (assets/spine):", e.message); }
if (spine) pu.uTorso.value = spine.cor.tex;
// memories of the night: snapshots of the strong moments in an atlas (8 x 6 slots of 320 x 180); the first 8 (the
// night's firsts) always stay. Late at night they come back: films in the lightbox, a ghost over the wall now and then.
const MEM_N = 48, MW = 320, MH = 180;
const memAtlas = new THREE.WebGLRenderTarget(MW * 8, MH * 6, { depthBuffer: false });
pu.uMemTex.value = memAtlas.texture; wallfx.uniforms.uMemTex.value = memAtlas.texture;
const memList = [], memPending = [];
let memLastAt = -1e9, memEcho = { on: false, slot: 0, until: 0 }, memShift = 0;
const memWatch = { hyper: false, brain: false, her: false, form: false, jphase: "", lastAuto: 0 };
function remember(kind, delay = 0) { memPending.push({ at: clock.elapsedTime + delay, kind }); }
function capture(kind) {
  const t = clock.elapsedTime;
  if (t - memLastAt < 20) return;                                   // (not two of the same moment)
  memLastAt = t;
  const slot = memList.length < MEM_N ? memList.length : 8 + (0 | Math.random() * (MEM_N - 8));
  if (memList.length >= MEM_N) memList.splice(memList.findIndex((m) => m.slot === slot), 1);
  const src = wallfx.hist[(wallfx.head - 1 + wallfx.hist.length) % wallfx.hist.length].texture;   // the wall, before its FX
  memAtlas.viewport.set((slot % 8) * MW, Math.floor(slot / 8) * MH, MW, MH);
  renderer.setRenderTarget(memAtlas);
  wallfx.copy.material.uniforms.tDiffuse.value = src; wallfx.copy.render(renderer);
  memAtlas.viewport.set(0, 0, MW * 8, MH * 6);
  renderer.setRenderTarget(null);
  const d = new Date();
  memList.push({ slot, kind, hhmm: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` });
  memList.sort((a, b) => a.slot - b.slot);
}

// the elements' layer (for the drafting looks on the elements only): layer 2 = the brain, the head, the tesseract
const bufSize = () => renderer.getDrawingBufferSize(new THREE.Vector2());
const elemRT = new THREE.WebGLRenderTarget(bufSize().x, bufSize().y, { type: THREE.HalfFloatType });
addEventListener("resize", () => { const b = bufSize(); elemRT.setSize(b.x, b.y); });
for (const o of [brain?.root, head?.root, hyper.group]) o?.traverse((x) => x.layers.enable(2));

// ---------------------------------------------------------------- scenes: which look, chosen by the section
let mode = 3, modeNext = 3, modeMix = 0, lastSceneChange = -1e9, centerAmt = 0.5;   // (starts on "flow": open from the first minute)
// the night's phase, from the hologram (alone: everything open); what is part of the night yet (the gradual reveal)
let wallPhase = "peak";
const has = (what) => unlocked(wallPhase, what);
// the wall's memory of its scenes (saved in this browser): recently shown = less likely, never shown tonight = more
const WALLMEM = "portal-wall-memory";
let wallMem = { saved: 0, used: {}, count: {} };
try { const d = JSON.parse(localStorage.getItem(WALLMEM) || "null"); if (d && Date.now() - d.saved < 10 * 3600e3) wallMem = d; } catch { /* fresh */ }
function wallUsed(kind) {
  wallMem.used[kind] = Date.now(); wallMem.count[kind] = (wallMem.count[kind] || 0) + 1; wallMem.saved = Date.now();
  try { localStorage.setItem(WALLMEM, JSON.stringify(wallMem)); } catch { /* not saved */ }
}
function wallWeight(kind) {
  const last = wallMem.used[kind];
  if (!last) return 3;                                              // not shown yet tonight: its turn
  return (1 - 0.85 * Math.exp(-(Date.now() - last) / 600e3)) / (1 + 0.04 * (wallMem.count[kind] || 0));
}
const SECTION_SCENES = {
  // (waves and scanner: the least liked - only now and then)
  breakdown: { mri: 2, flow: 2, lightbox: 2, scanner: 0.3, halo: 2, swarm: 2, hyper: 1.5, spine: 1 }, silence: { flow: 1, lightbox: 1, halo: 1, swarm: 1.5, hyper: 1, spine: 0.5 },
  build: { tunnel: 3, flow: 1.5, halo: 1, waves: 0.3, swarm: 1, hyper: 1, spine: 2.5 }, peak: { tunnel: 2, mandala: 2, halo: 1.5, waves: 0.3, swarm: 1, hyper: 1.2, spine: 0.6 },
  normal: { tunnel: 1, mandala: 1.2, mri: 1, flow: 1.2, lightbox: 0.6, halo: 1.5, scanner: 0.3, swarm: 1.2, hyper: 1.2, spine: 0.8 },
};
// scenes that need optional data (a medical volume, a spine scan) only play when it was loaded
const sceneReady = (n) => (n === "mri" || n === "scanner" || n === "lightbox" ? !!vol : n === "spine" ? !!kund : true);
let mixBeats = 12;                                                  // how long a scene change takes (beats)
function nextScene(sec, force = null, beats = 12) {
  mixBeats = beats;
  const tr = Math.random();                                         // how this change happens
  pu.uTrans.value = tr < 0.35 ? 0 : tr < 0.65 ? 1 : tr < 0.8 ? 2 : 3; pu.uTransSeed.value = Math.random() * 50;
  const w = { ...(SECTION_SCENES[sec] || SECTION_SCENES.normal) };
  if (has("memories") && memList.length >= 4) w.lightbox = (w.lightbox || 0.5) * 2.5;   // late night: the films of the night
  const opts = Object.keys(w).filter((n) => SCENES.indexOf(n) !== mode && has("scene:" + n) && sceneReady(n));
  if (force && (!has("scene:" + force) || !sceneReady(force))) force = null;   // not part of the night yet / no data
  let pick = force && SCENES.indexOf(force) !== mode ? force : null;
  if (!pick && force) return;                                     // already there
  if (!pick && !opts.length) return;
  if (!pick) {
    const ww = opts.map((n) => w[n] * wallWeight("scene:" + n));
    let r = Math.random() * ww.reduce((a, b) => a + b, 0), i = 0;
    while (i < opts.length - 1 && (r -= ww[i]) > 0) i++;
    pick = opts[i];
  }
  wallUsed("scene:" + pick);
  modeNext = SCENES.indexOf(pick);
  modeMix = 0;
  lastSceneChange = clock.elapsedTime;
  centerAmt = Math.random() < 0.3 ? 0 : 0.4 + 0.6 * Math.random();  // how far the centre wanders in this scene
}

// satellites: off-centre spots (never in the middle), new places on phrases
const sats = Array.from({ length: NSAT }, () => ({ x: 0, y: 0, r: 0.05, vx: 0, vy: 0, on: 0, want: 0 }));
function placeSatellites(count) {
  const hw = 0.5 * innerWidth / innerHeight;
  pu.uSatSeed.value = 0 | Math.random() * 4;
  sats.forEach((st, i) => {
    st.want = i < count ? 1 : 0;
    if (!st.want) return;
    const sgn = i % 2 ? 1 : -1;
    st.x = sgn * hw * (0.35 + 0.5 * Math.random()); st.y = (Math.random() - 0.5) * 0.7;
    st.r = 0.03 + 0.06 * Math.random();
    st.vx = (Math.random() - 0.5) * 0.01; st.vy = (Math.random() - 0.5) * 0.008;
  });
}
placeSatellites(2);
// ?test=swarm | forms | hyper | glyphs | dither | contours | element | text | memories: one thing on its own (no hologram)
const TEST = new URLSearchParams(location.search).get("test");

// ---------------------------------------------------------------- state + events from the hologram window
let idle = false, kaleidoMode = "auto", mirror = false, dancerMode = "auto";
let flash = 0, kaleidoUntil = 0, spin = 1, mriBase = 0.1, lastBeat = -1, rot = 0, rotTarget = 0, fill = 0;
let section = "normal", dancerShown = 0, dancerScan = null, dancerWant = false, journeyOn = false;
const center = new THREE.Vector2();
const lv = { speed: 1, rings: 0.6, mri: 0, brain: 0, bright: 1, low: 0.4, mid: 0.4, high: 0.4 };
let fxDraftT = 0, fxDraftMode = 0, draftForce = null, region = "CORTEX", textAmt = 0;   // drafting looks (G), the readout
let fxMirror = 0, fxEchoT = 0, fxBandsT = 0, fxCrtT = 0, fps = 60, glitchUntil = -1, glitchSeed = 0, invert = 0, leadFlash = 0, fxBar = -1;
let lookBar = 0;                                                    // the bar of the last look change
let frozen = null, lastBgBeat = 0, lastBgTime = 0;
// the wall is plain most of the time; now and then (a third of the phrases, most drops) a look for 4 or 8 bars
let lookUntil = -1;
function plainLook() { fxMirror = 0; fxEchoT = 0; fxBandsT = 0; fxCrtT = 0; fxDraftT = 0; lookUntil = -1; }
const lookKey = () => `${fxMirror}${fxEchoT}${fxBandsT}${fxCrtT}${fxDraftT}`;
let fxDraftMask = 0, maskForce = null;   // the drafting look on the whole wall (0) or only on the elements (1) (Shift+G)
function pickLook(sec, drop = false, force = false) {
  lookBar = fxBar;
  if (!force && Math.random() > (drop ? 0.7 : 0.35)) return;
  const was = lookKey();
  for (let i = 0; i < 12 && (lookKey() === was || lookKey() === "00000"); i++) pickOne(sec, drop);   // a real, new look
  lookUntil = fxBar + (Math.random() < 0.5 ? 4 : 8);
}
function pickOne(sec, drop) {
  const r = Math.random();
  fxMirror = drop ? (r < 0.4 ? 2 : r < 0.7 ? 1 : 0) : r < 0.55 ? 0 : r < 0.82 ? 1 : 2;
  const q = Math.random();
  fxEchoT = q < (drop ? 0.6 : 0.4) ? 1 : 0;                         // video echoes (more often after drops)
  fxBandsT = !fxEchoT && q < 0.62 ? 1 : 0;                           // or time bands
  fxCrtT = Math.random() < 0.25 ? 1 : 0;                             // CRT on top, sometimes
  fxDraftT = has("drafting") && Math.random() < (drop ? 0.15 : 0.25) ? 1 : 0;   // a drafting look: glyphs, dither or contours
  if (fxDraftT) {
    const d = Math.random(); fxDraftMode = d < 0.2 ? 0 : d < 0.6 ? 1 : 2; fxBandsT = 0; fxMirror = Math.min(fxMirror, 1);
    fxDraftMask = has("draftElements") && Math.random() < 0.55 ? 1 : 0;                       // on the elements (if any are up) or the whole wall
    if (fxDraftMask) { fxMirror = 0; if (fxDraftMode === 0) fxDraftMode = Math.random() < 0.5 ? 1 : 2; }   // (elements: dither / contours)
  }
}
link.on("drop", () => {
  flash = 1; spin = -spin; kaleidoUntil = clock.elapsedTime + 16;
  invert = 1; pickLook("peak", true);
  parts.shockwave(center);
  hyper.hit(1);
  kundBurst = 1;                                                  // the kundalini bursts out of the crown
  if (link.connected || TEST) remember("drop", 2.5);
  pu.uSeg.value = [6, 8, 10, 12][0 | Math.random() * 4];
  psy.uniforms.segments.value = [4, 6, 8, 10, 12][0 | Math.random() * 5];
  if (!journeyOn) { nextScene("peak", Math.random() < 0.5 ? "tunnel" : "mandala", 6); centerAmt = 0; }   // drops: back to the middle
  placeSatellites(3 + (Math.random() < 0.5 ? 1 : 0));
  if (brain) { for (let i = 0; i < 10; i++) brain.spark(); if (lv.brain > 0.05) brain.burst(); }
  halo.uniforms.segs.value = [6, 8, 10, 12, 16][0 | Math.random() * 5];
  wallHalo.uniforms.segs.value = halo.uniforms.segs.value;
  ownMove(0.6, "drop", link.state);
});
// rises from the cube: the oldest slot is reused
const rises = Array.from({ length: 8 }, () => ({ x: 0, age: 1, s: 0, kind: 0, dur: 1 }));
function rise(kind, strength, x = calib.s.cubeX + (Math.random() - 0.5) * 0.1) {
  if (kind === "small") return;                                   // (the frequent small ones: too busy on the wall)
  const r = rises.reduce((a, b) => (b.age > a.age ? b : a));
  Object.assign(r, { x, age: 0, s: strength, kind: kind === "beam" ? 1 : 0, dur: kind === "beam" ? 0.9 : kind === "small" ? 0.8 : 1.4 });
}
link.on("rise", (e) => {
  if (e.kind === "double") { rise("ring", e.strength); setTimeout(() => rise("ring", e.strength * 0.7), 120); }
  else rise(e.kind, e.strength * (e.kind === "small" ? 0.6 : 1));
});
let holoScene = "";
link.on("surge", () => { flash = Math.max(flash, 0.5); kaleidoUntil = Math.max(kaleidoUntil, clock.elapsedTime + 8); });
link.on("phrase", () => {
  mriBase = Math.random() < 0.3 ? 0.5 : 0.1;
  pickLook(section);
  if (!journeyOn && clock.elapsedTime - lastSceneChange > 12) nextScene(section);
  placeSatellites(section === "breakdown" ? 1 : 2 + (Math.random() < 0.5 ? 1 : 0));
  parts.form(lastBeat);
  memShift += 9;                                                  // the lightbox: the next memories
  if (!memEcho.on && has("memories") && memList.length >= 3 && !journeyOn && Math.random() < 0.35) {
    const slot = Math.floor(Math.random() ** 1.5 * memList.length);   // (older ones a bit more often)
    memEcho = { on: true, slot, until: lastBeat + 32 };           // 8 bars
  }                                           // the swarm gathers into a figure (in its scene)
  brain?.pulse("phrase");
  if (clock.elapsedTime - lastOwnChange > 6) ownMove(2, momentOf(section), link.state);
});
link.on("section", (e) => {
  if (!journeyOn && (e.section === "breakdown" || e.section === "build")) nextScene(e.section);
  if (e.section === "breakdown" || e.section === "build" || e.section === "peak") ownMove(e.section === "breakdown" ? 2.5 : 1.5, momentOf(e.section), link.state);
});
addEventListener("keydown", (e) => {
  if (calib.handleKey(e)) return;                              // R: calibration (it takes all keys while open)
  const k = e.key.toLowerCase();
  if (k === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (k === "u") $("info").classList.toggle("hidden");
  if (k === "k") kaleidoMode = { auto: "on", on: "off", off: "auto" }[kaleidoMode];
  if (k === "m") { mirror = !mirror; renderer.domElement.style.transform = mirror ? "scaleX(-1)" : ""; }
  if (k === "i") idle = !idle;
  if (k === "s") {                                             // every scene in turn, each with a random transition
    modeNext = (mode + 1) % SCENES.length; modeMix = 0; lastSceneChange = clock.elapsedTime; mixBeats = 12;
    pu.uTrans.value = 0 | Math.random() * 4; pu.uTransSeed.value = Math.random() * 50;
  }   // every scene in turn
  if (k === "l") pickLook(section, false, true);
  if (k === "v") dancerMode = { auto: "on", on: "off", off: "auto" }[dancerMode];
  if (e.key === "G") maskForce = maskForce === null ? 1 : maskForce === 1 ? 0 : null;   // Shift+G: elements / whole wall / auto
  else if (k === "g") draftForce = draftForce === null ? 0 : draftForce + 1 < DRAFTS.length ? draftForce + 1 : null;   // drafting looks
});

// brain pulses: rising edges, as on the hologram
const trig = {};
let perfU = 0, perfR = 0;
function edge(name, v, on, off, gap, t) {
  const st = (trig[name] ||= { up: false, t: -1 });
  if (!st.up && v > on && t - st.t > gap) { st.up = true; st.t = t; return true; }
  if (v < off) st.up = false;
  return false;
}

// a point in the 3D scene -> wall units (height 1, centred)
function wallOf(v, cam) { const q = v.clone().project(cam); return { x: q.x * innerWidth / innerHeight * 0.5, y: q.y * 0.5 }; }

// ---------------------------------------------------------------- run
const frame = () => {
  const pf0 = performance.now();                                  // timing: update vs render (info line)
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  const connected = link.connected && !idle;
  $("wait").classList.toggle("hidden", connected);
  // the music: from the hologram window, or a fake 124 BPM groove when alone
  const fb = t * 124 / 60;
  const fake = { running: true, bpm: 124, beatCount: Math.floor(fb), beatPhase: fb % 1, section: "normal", sectionTime: t,
    intensity: 0.55, level: 0.5, kick: Math.exp(-(fb % 1) * 7), palette: Math.floor(t / 40) % PALETTES.length,
    bands: { low: 0.5, lowmid: 0.4, mid: 0.4 + 0.2 * Math.sin(t * 0.7), high: 0.4 }, elements: {}, trip: 0.6, mind: null, stage: "holo" };
  const s = connected ? link.state : fake;
  const live = s.running && s.bpm > 0;
  wallPhase = TEST === "memories" ? "late night" : connected && s.phase ? s.phase : "peak";
  const beat = live ? s.beatCount + s.beatPhase : t * 2;
  const bps = live ? s.bpm / 60 : 2;
  const P = PALETTES[s.palette ?? 0] || PALETTES[0];
  const kick = live ? s.kick : 0;
  section = s.section;
  const J = s.journeySnap || null;
  journeyOn = !!J;
  for (const b of ["low", "mid", "high"]) lv[b] = smooth(lv[b], live ? s.bands[b] : 0.4, 5, dt);

  // ---- what the section asks for
  const st = s.sectionTime || 0, trip = s.trip ?? 0.6, inten = s.intensity ?? 0.5, els0 = s.elements || {};
  const W = wallfx.uniforms;
  const target = {
    speed: { breakdown: 0.35, silence: 0.2, build: 0.6 + Math.min(0.9, st / 25), peak: 1.4, normal: 0.7 + 0.5 * inten }[section] ?? 0.8,
    rings: { breakdown: 0.25, silence: 0.1, build: 0.4 + Math.min(0.6, st / 30), peak: 1 }[section] ?? 0.7,
    bright: (section === "silence" ? 0.5 : 0.85 + 0.25 * inten) * (J && (J.phase === "peel" || J.phase === "slices") ? 0.6 : 1),
    mri: section === "breakdown" ? 0.6 : mriBase,
    brain: s.mind === "brainWall" ? 1 : 0,                         // only when the hologram puts the brain up here
  };
  if ((s.sinceDrop ?? 99) < 8) { target.speed = 1.6; target.rings = 1; }
  for (const k of ["speed", "rings", "bright", "mri", "brain"]) lv[k] = smooth(lv[k], target[k], k === "brain" ? 0.6 : 1, dt);
  fill = smooth(fill, section === "peak" || (s.sinceDrop ?? 99) < 16 ? 1 : inten > 0.75 ? 0.5 : 0, 1, dt);
  flash = Math.max(0, flash - dt * 1.2);
  // the cube's scene: the wall follows it (echoes -> echo look, tunnel -> tunnel, full -> mirror 4 + echoes, solo -> plain)
  if (connected && s.scene && s.scene !== holoScene) {
    holoScene = s.scene;
    if (!journeyOn) {
      if (holoScene === "echoes") { fxEchoT = 1; fxBandsT = 0; lookUntil = fxBar + 8; lookBar = fxBar; }
      else if (holoScene === "tunnel") nextScene(section, "tunnel");
      else if (holoScene === "full") { fxMirror = 2; fxEchoT = 1; fxBandsT = 0; lookUntil = fxBar + 4; lookBar = fxBar; kaleidoUntil = t + 8; }
      else if (holoScene === "solo" && lookUntil >= 0) plainLook();
    }
  }
  if (connected) flash = Math.max(flash, (s.flash || 0) * 0.8);       // the cube's flashes hit the wall too
  rises.forEach((r, i) => { r.age = Math.min(1, r.age + dt / r.dur); pu.uRise.value[i].set(r.x, r.age, r.s, r.kind); });
  pu.uCubeY.value = calib.s.cubeY;
  // the journey: the wall becomes the lightbox
  if (journeyOn && SCENES[modeNext] !== "lightbox") nextScene(section, "lightbox");
  // the beat: a rotation step on each bar; a new scene every 16 bars if no phrase came
  if (Math.floor(beat) !== lastBeat) {
    lastBeat = Math.floor(beat);
    if (lastBeat % 4 === 0 && section !== "breakdown" && section !== "silence") rotTarget += spin * Math.PI / pu.uSeg.value;
    if (!journeyOn && lastBeat % 64 === 0 && t - lastSceneChange > 20) nextScene(section);
    if (!connected && lastBeat % 32 === 0) link.handlers.phrase?.forEach((f) => f({}));
  }
  rot = smooth(rot, rotTarget, 8, dt);
  if (modeNext !== mode) {                                          // scene crossfade over ~2 beats
    modeMix = Math.min(1, modeMix + dt * bps / mixBeats);            // (3 bars; drops: 1.5 bars)
    if (modeMix >= 1) { mode = modeNext; modeMix = 0; }
  }
  // the wandering centre (Lissajous over the wall), satellites drifting
  const hw = 0.5 * innerWidth / innerHeight;
  center.lerp(new THREE.Vector2(hw * 0.45 * Math.sin(t * 0.09) * centerAmt, 0.18 * Math.sin(t * 0.13 + 1) * centerAmt), Math.min(1, dt * 0.8));
  sats.forEach((sat, i) => {
    sat.on = smooth(sat.on, sat.want * (section === "silence" ? 0 : 1), 1.5, dt);
    sat.x += sat.vx * dt; sat.y += sat.vy * dt;
    if (Math.abs(sat.x) > hw * 0.95) sat.vx = -sat.vx;
    if (Math.abs(sat.y) > 0.42) sat.vy = -sat.vy;
    pu.uSat.value[i].set(sat.x, sat.y, sat.r, sat.on * (0.6 + 0.4 * inten));
  });

  // ---- the background
  const k = Math.min(1, dt * 0.8);                                 // same blend speed as the hologram
  pu.uC0.value.lerp(new THREE.Color(P.glow), k); pu.uC1.value.lerp(new THREE.Color(P.rim), k);
  pu.uC2.value.lerp(new THREE.Color(P.accents[0]), k); pu.uC3.value.lerp(new THREE.Color(P.accents[1]), k);
  pu.uC4.value.lerp(new THREE.Color(P.accents[2]), k);
  const holdNow = connected ? s.hold || 0 : 0, stq = s.stutter || 0;
  if (holdNow > 0.5 && !frozen) frozen = { beat: lastBgBeat, time: lastBgTime };   // the pre-drop: the wall holds its breath
  if (holdNow <= 0.5) frozen = null;
  const bgBeat = frozen ? frozen.beat : stq > 0 ? Math.floor(beat * stq) / stq : beat;          // the stutter steps it
  const bgTime = frozen ? frozen.time : stq > 0 ? Math.floor(t * bps * stq) / (bps * stq) : t;
  lastBgBeat = bgBeat; lastBgTime = bgTime;
  pu.uTime.value = bgTime; pu.uBeat.value = bgBeat; pu.uKick.value = kick;
  pu.uLow.value = lv.low; pu.uMid.value = lv.mid; pu.uHigh.value = lv.high;
  pu.uSpeed.value = lv.speed; pu.uRings.value = lv.rings; pu.uBright.value = lv.bright;
  pu.uMri.value = lv.mri; pu.uFlash.value = flash; pu.uFill.value = fill;
  pu.uModeA.value = mode; pu.uModeB.value = modeNext; pu.uModeMix.value = modeMix * modeMix * (3 - 2 * modeMix);   // eased
  pu.uRot.value = rot;
  pu.uCenter.value.copy(center);
  pu.uZoom.value = (1 - 0.035 * kick * (section === "breakdown" ? 0.3 : 1))   // the kick punch (light)
    * (section === "build" ? 1 - 0.22 * Math.min(1, st / 30) : 1);              // builds zoom in
  pu.uSlice.value = 0.15 + 0.7 * (0.5 - 0.5 * Math.cos(beat * Math.PI / 32));   // through the brain and back: 16 bars
  pu.uHole.value = 0.07 + 0.02 * lv.low;
  // lightbox: during the journey the tile of the journey's moment lights up, in the plane of the hologram's stack
  const nTiles = 18;
  if (J) {
    pu.uLbAxis.value = J.phase === "slices" ? J.axis : 1;            // same numbering as the head's slice stack
    pu.uLbActive.value = J.phase === "cut" || J.phase === "scan" ? Math.floor((J.beats / J.len) * nTiles) % nTiles : Math.floor(beat) % nTiles;
  } else {
    pu.uLbAxis.value = 1;
    pu.uLbActive.value = Math.floor(beat) % nTiles;
  }
  pu.uLbScroll.value = t * 0.008;

  // ---- the "halo" scene: the hologram's mandala across the wall (its centre wandering) + the orbiting shapes
  const iHalo = SCENES.indexOf("halo");
  const haloAmt = (mode === iHalo ? 1 - (modeNext !== mode ? modeMix : 0) : 0) + (modeNext === iHalo && modeNext !== mode ? modeMix : 0);
  wallHalo.mesh.visible = haloAmt > 0.01;
  orbit.group.visible = haloAmt > 0.01;
  if (haloAmt > 0.01) {
    const hd2 = 2, hh2 = 2 * (camera.position.z + hd2) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    wallHalo.mesh.scale.set(hh2 * 1.7, hh2, 1);
    wallHalo.mesh.position.set(center.x * hh2, center.y * hh2, -hd2);
    wallHalo.mesh.quaternion.copy(camera.quaternion);
    const wu = wallHalo.uniforms;
    wu.time.value = bgTime * (0.5 + trip); wu.energy.value = inten; wu.kick.value = kick;
    wu.bright.value = (0.25 + 0.4 * trip) * haloAmt;
    wallHalo.setColors(P, k);
    orbit.group.position.set(center.x * 0.62, -0.165, -0.1);
    orbit.setColors(P, k);
    orbit.update(bgTime, { trip, beatPhase: live ? s.beatPhase : (t * 2) % 1, kick });
    orbit.materials.forEach((m) => (m.opacity *= haloAmt));
  }

  // ---- her, only while she is up here: rising out of the cube, sinking back down
  if (dancer) {
    if (Math.floor(beat) % 64 === 0 && t - lastOwnChange > 20) ownMove(2, momentOf(section), s);   // every 16 bars
    const unison = connected && !!s.unison;
    const up = connected && (s.stage === "toWall" || s.stage === "wall" || unison);
    dancer.avoid = unison ? holoNames(s.pose) : [];                           // in unison: never the hologram's move
    if (unison && dancerShown && holoNames(s.pose).some((n) => (dancer.current?.name || "").includes(n)) && t - lastOwnChange > 2)
      ownMove(1.2, momentOf(section), s);
    const want = dancerMode === "on" ? true : dancerMode === "off" ? false : up;
    if (want !== dancerWant && !dancerScan) {
      dancerWant = want;
      dancerScan = { dir: want ? "rise" : "sink", t0: t, dur: 8 / bps };       // two bars, like the hologram's scanner
      if (want) {
        riseFromCube = true;
        side = -side;                                                           // left third, then right third, ...
        const m = holoNames(s.pose)[0];                                         // she arrives still dancing her move
        if (unison) ownMove(0.3, momentOf(section), s);                          // (in unison: a different one)
        else if (m && dancer.moves.some((x) => x.name === m)) { dancer.play(m, 0.2); lastOwnChange = t; }
      }
    }
    // the clipping plane: she shows below the line; rising = the line moves up from her feet, sinking = down from her head
    if (dancerScan) {
      const q = Math.min(1, (t - dancerScan.t0) / dancerScan.dur), e = q * q * (3 - 2 * q);
      dancerPlane.normal.set(0, -1, 0);
      dancerPlane.constant = dancerScan.dir === "rise" ? -0.05 + e * DH * 1.13 : DH * 1.08 - e * DH * 1.13;
      if (q >= 1) { dancerShown = dancerScan.dir === "rise" ? 1 : 0; dancerScan = null; }
    }
    if (!dancerScan) { dancerPlane.normal.set(0, 1, 0); dancerPlane.constant = 10; }
    const visible = !!(dancerShown || dancerScan);
    dancer.root.visible = visible;
    // her camera: like the hologram's, fixed; she stands on a third, drifting a little
    const dd = dancerDist();
    dancerCam.position.set(0, DH * 0.55, dd);
    dancerCam.lookAt(0, DH * 0.5, 0);
    const dHalfW = Math.tan(THREE.MathUtils.degToRad(16)) * dd * dancerCam.aspect;
    if (riseFromCube) { dancerX = calib.s.cubeX / (0.5 * dancerCam.aspect) * dHalfW; riseFromCube = false; }   // from above the cube
    dancerX = smooth(dancerX, side * Math.min(dHalfW * 0.45, DH * 1.2) + 0.08 * Math.sin(t * 0.15), 0.6, dt);
    dancer.root.position.set(dancerX, 0, 0);
    // the halo: a plane behind her (3 m back), placed so its centre is on her, sized like in the cube
    haloLvl = smooth(haloLvl, visible ? 1 : 0, 1.5, dt);
    halo.mesh.visible = haloLvl > 0.01;
    if (halo.mesh.visible) {
      const back = 3, hh = 2 * (dd + back) * Math.tan(THREE.MathUtils.degToRad(16));
      halo.mesh.scale.set(hh * 1.7, hh, 1);
      halo.mesh.position.set(dancerX * (dd + back) / dd, DH * 0.5, -back);
      halo.mesh.quaternion.copy(dancerCam.quaternion);
      const hu = halo.uniforms;
      hu.time.value = t * (0.5 + trip); hu.energy.value = inten; hu.kick.value = kick;
      hu.bright.value = (0.15 + 0.35 * trip) * haloLvl;
      halo.setColors(P, k);
    }
    if (visible) {
      dancer.stepsPerBeat = s.stutter || 0;                            // the same stutters as the hologram
      dancer.releaseDur = live ? 60 / s.bpm : 0.5;
      dancer.halfTime = !!(live && dancer.current && s.bpm > (60 / dancer.current.period) * 1.3);
      dancer.update(dt, { ...s, onset: s.onset ?? 0.3, densityRel: s.densityRel ?? 1 }, flash);
    }
    dancer.blendColors(P, k, true);                                    // the hologram look: glow + two-tone rim
    dancer.glowGain = 0.6 + 0.9 * lv.mid;                              // leads/vocals light her body, as in the cube
    // her hair: physics like in the cube (it can't be clipped, so it waits until she is fully there)
    if (hair) {
      hair.mesh.visible = visible && !dancerScan;
      dancer.root.updateMatrixWorld(true);
      const du = dancer.material.userData.uniforms;
      hair.setColors(dancer.material.emissive, du.uRimColor.value, du.uRimStrength.value);
      hair.update(dt, dancerCam, { kick, energy: inten, highs: lv.high });
    }
    // her echoes, as strong as in the cube (same spacing and amount), right on her (no sideways clones)
    const ec = s.echo || { level: 0.7, spread: 0.4, count: 3 };
    const shimmer = live ? 0.7 + 0.6 * lv.high : 1;
    echoes.forEach((e, i) => {
      e.root.position.copy(dancer.root.position);
      const there = Math.min(1, Math.max(0, ec.count - i));
      e.level = visible ? Math.max(0.5, ec.level) * there : 0;
      e.delay = (live ? 60 / s.bpm : 0.5) * ec.spread * (i + 1);
      e.setColors(new THREE.Color(P.accents[i % 3]), new THREE.Color(P.accents[(i + 1) % 3]), new THREE.Color(P.glow),
        e.level * (1 - i * 0.18) * (0.6 + 0.4 * trip) * shimmer);
      e.update(1);
    });
  }

  // ---- the head, big on one side, while the cube is inside it (the journey's peel, slices and out)
  if (head) {
    const on = !!J && (J.phase === "slices" || J.phase === "out");             // when the cube no longer shows the head
    if (on && hd.lvl < 0.01) hd.side = -hd.side;                               // a new side each time it appears
    hd.lvl = smooth(hd.lvl, on ? 1 : 0, 0.8, dt);
    const u = head.uniforms;
    if (hd.lvl > 0.002) {
      const bar = Math.floor(beat / 4);
      if (bar !== hd.bar && bar % 4 === 0) {
        hd.bar = bar;
        const r = Math.random();
        if (r < 0.5) { hd.spin = 0; hd.view = (hd.view + 1 + (0 | Math.random() * (HVIEWS.length - 1))) % HVIEWS.length; }
        else if (r < 0.85) hd.spin = (Math.random() < 0.5 ? -1 : 1) * (0.03 + 0.2 * Math.random() ** 2);
        else { hd.spin = 0; hd.view = -1; }
      }
      const prev = hd.yaw;
      if (hd.spin) hd.yaw += dt * bps * hd.spin * 2 * Math.PI;
      else if (hd.view >= 0) hd.yaw += Math.atan2(Math.sin(HVIEWS[hd.view] - hd.yaw), Math.cos(HVIEWS[hd.view] - hd.yaw)) * Math.min(1, dt * bps * 3);
      head.spinner.rotation.set(hd.pitch + 0.02 * Math.sin(t * 0.37), hd.yaw + 0.04 * Math.sin(t * 0.5), 0, "YXZ");
      const sc = 0.3 / head.size.y;
      head.root.scale.setScalar(sc);
      head.root.position.set(hd.side * halfWidth() * 0.5, 0.033 * sc - 0.01, 0.02);
      // scanner bands over the face every 2 bars
      const q = (beat % 8) / 4;
      u.uBand.value = 0.1 - 0.27 * Math.min(1, q); u.uBandAmt.value = q < 1 ? Math.sin(Math.PI * q) ** 0.5 : 0;
      // echoes while it moves
      hd.qHist.push({ t, q: head.spinner.quaternion.clone() });
      while (hd.qHist.length > 2 && t - hd.qHist[0].t > 0.6) hd.qHist.shift();
      const speed = Math.abs(Math.atan2(Math.sin(hd.yaw - prev), Math.cos(hd.yaw - prev))) / Math.max(dt, 1e-3);
      for (let i = 0; i < 3; i++) {
        const want = t - 0.12 * (i + 1);
        let best = hd.qHist[0];
        for (const h of hd.qHist) if (Math.abs(h.t - want) < Math.abs(best.t - want)) best = h;
        head.setEcho(i, best.q, Math.min(1, speed * 0.6) * hd.lvl * 0.5 * (1 - i * 0.25), [u.uA0, u.uA1, u.uA2][i].value);
      }
    } else head.echoes.forEach((e) => (e.visible = false));
    u.uLevel.value = hd.lvl; u.uGhost.value = 0; u.uShell.value = 0; u.uCapLevel.value = 0; u.uOrthoLevel.value = 0;
    u.uSliceLevel.value = 0;
    head.setColors(P, k);
    head.root.updateMatrixWorld(true);
    head.setCut(camera, 10);                                                   // no cut here: the whole head
    head.update(dt, t, { kick, hats: lv.high });
  }

  // ---- the brain, in the right third, during the breakdown brain moments
  if (brain) {
    const el = s.elements || {};
    if (live && lv.brain > 0.02) {
      const bt = 60 / s.bpm;
      if (edge("kick", kick, 0.55, 0.25, bt * 0.4, t)) { brain.pulse("kick", 0.5 + 0.6 * kick); region = "BRAINSTEM"; }
      if (el.bass?.on && edge("bass", el.bass.hit, 0.5, 0.2, bt * 0.45, t)) { brain.pulse("bass", 0.5 + 0.5 * el.bass.level); region = "AUDITORY CORTEX"; }
      if (el.lead?.on && edge("lead", el.lead.hit, 0.5, 0.2, bt, t)) { brain.pulse("lead", 0.5 + 0.5 * el.lead.level); region = "FRONTAL LOBE"; }
      if (el.hats?.on && edge("hats", el.hats.hit, 0.45, 0.2, bt * 0.2, t)) { brain.spark(); region = "CORTEX / GYRI"; }
    }
    brain.root.position.set(halfWidth() * 0.42, 0.01 * Math.sin(t * 0.3), 0);
    brain.root.scale.setScalar(0.85);
    brain.spinSpeed = spin * (0.12 + 0.25 * trip);
    brain.setColors(P, k);
    brain.update(dt, t, { level: lv.brain, kick, mid: lv.mid, bass: live ? el.bass?.level || 0 : 0.4,
      pads: live ? (el.pads?.on ? el.pads.level : 0) : 0.3, hats: live ? el.hats?.level || 0 : 0.3, xray: 0, sweep: -1,
      points: connected ? s.brainPts || 0 : 0, px: renderer.domElement.height });
  }

  // ---- particles: the swarm scene, a light layer in builds and peaks, less over the films / her / the brain
  const iHyper = SCENES.indexOf("hyper");
  const hyperAmt = (mode === iHyper ? 1 - (modeNext !== mode ? modeMix : 0) : 0) + (modeNext === iHyper && modeNext !== mode ? modeMix : 0);
  { const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    hyper.group.position.set(center.x * 0.5 * visH, center.y * 0.5 * visH, 0);
    hyper.group.scale.setScalar(visH * 0.3 * (1 + 0.03 * kick));
    hyper.setColors(P, k);
    hyper.update(dt, { level: hyperAmt * (journeyOn ? 0 : 1), bps, kick }); }
  const iSpine = SCENES.indexOf("spine");
  const spineAmt = (mode === iSpine ? 1 - (modeNext !== mode ? modeMix : 0) : 0) + (modeNext === iSpine && modeNext !== mode ? modeMix : 0);
  if (kund) {
    kundBurst = Math.max(0, kundBurst - dt * 0.8);
    kund.setColors(P, k);
    kund.update({ level: spineAmt * (journeyOn ? 0 : 1), rise: section === "build" ? Math.min(1, st / 24) : (beat % 32) / 32,
      burst: kundBurst, kick, t, x: center.x * 0.3, aspect: innerWidth / innerHeight });
  }
  pu.uTorsoOn.value = spine && has("torso") && !journeyOn ? 1 : 0;
  const iSwarm = SCENES.indexOf("swarm");
  const swarmAmt = (mode === iSwarm ? 1 - (modeNext !== mode ? modeMix : 0) : 0) + (modeNext === iSwarm && modeNext !== mode ? modeMix : 0);
  const busy = (dancer && dancer.root.visible) || lv.brain > 0.05 || (head && head.root.visible);
  const layer = journeyOn ? 0.15 : section === "build" ? 0.2 + 0.3 * Math.min(1, st / 30) : section === "peak" ? 0.35 : 0.08;
  lv.parts = smooth(lv.parts ?? 0, Math.max(swarmAmt, layer) * (busy && swarmAmt < 0.5 ? 0.6 : 1) * (section === "silence" ? 0.5 : 1), 1.2, dt);
  parts.setColors(P, k);
  parts.formTick(beat, bps, swarmAmt > 0.5 && !journeyOn);
  if (TEST === "swarm" && parts.formAt < -1e8 && t > 1) parts.form(beat);   // (the test: a figure right away)
  if (TEST === "forms") { parts.formAt = beat - 10; parts.uniforms.uFormKind.value = Math.floor(t / 6) % 5; }   // hold each figure 6 s
  if (TEST === "hyper" && modeNext !== iHyper) { mode = modeNext = iHyper; lastSceneChange = t; }
  if (TEST === "trans" && modeNext === mode && t - lastSceneChange > 3) {   // (?test=trans&kind=0..3: scene changes one after another)
    nextScene(section, ["tunnel", "mandala", "flow", "mri"][(mode + 1) % 4]); if (Q.has("kind")) pu.uTrans.value = +Q.get("kind");
  }
  const FS = Q.get("scene"); if (FS && SCENES.includes(FS) && modeNext !== SCENES.indexOf(FS)) { mode = modeNext = SCENES.indexOf(FS); lastSceneChange = t; }   // (?scene=name: hold one scene, for testing)
  parts.update(dt, { level: lv.parts, swarm: swarmAmt, bps, speed: lv.speed * (0.6 + 0.9 * lv.low), swirl: section === "breakdown" || section === "silence" ? 1 : 0,
    kick, hats: live && els0.hats?.on ? els0.hats.level : 0, center, aspect: innerWidth / innerHeight, px: renderer.domElement.height });

  // ---- memories: the strong moments are photographed (a few seconds in), late at night they come back
  if (connected || TEST) {
    if (spineAmt > 0.9 && !memWatch.spine) { memWatch.spine = true; remember("kundalini", 5); } else if (spineAmt < 0.1) memWatch.spine = false;
    if (hyperAmt > 0.9 && !memWatch.hyper) { memWatch.hyper = true; remember("tesseract", 3); } else if (hyperAmt < 0.1) memWatch.hyper = false;
    if (lv.brain > 0.9 && !memWatch.brain) { memWatch.brain = true; remember("brain", 3); } else if (lv.brain < 0.1) memWatch.brain = false;
    if (dancerShown && !dancerScan && !memWatch.her) { memWatch.her = true; remember("her", 4); } else if (!dancerShown) memWatch.her = false;
    const fo = parts.uniforms.uForm.value;
    if (fo > 0.95 && !memWatch.form) { memWatch.form = true; remember("figure", 1); } else if (fo < 0.1) memWatch.form = false;
    if (J && J.phase !== memWatch.jphase) { memWatch.jphase = J.phase; remember("journey", 6); } else if (!J) memWatch.jphase = "";
    if (t - memWatch.lastAuto > (TEST === "memories" ? 21 : 300)) { memWatch.lastAuto = t; remember("night"); }
  }
  if (TEST === "memories" && !memEcho.on && memList.length >= 2 && t > 30) memEcho = { on: true, slot: 0, until: beat + 32 };
  if (TEST === "memories" && memList.length >= 2 && modeNext !== SCENES.indexOf("lightbox")) { mode = modeNext = SCENES.indexOf("lightbox"); lastSceneChange = t; }
  if (memEcho.on && (beat >= memEcho.until || journeyOn)) memEcho.on = false;
  W.uMemAmt.value = smooth(W.uMemAmt.value, memEcho.on ? 1 : 0, 0.5, dt);
  if (W.uMemAmt.value > 0.005) {
    const sl = memList[Math.min(memEcho.slot, memList.length - 1)]?.slot ?? 0;
    W.uMemRect.value.set((sl % 8) / 8, Math.floor(sl / 8) / 6, 1 / 8, 1 / 6);
  }
  pu.uMemN.value = memList.length; pu.uMemShift.value = memShift;
  pu.uMemLb.value = smooth(pu.uMemLb.value, has("memories") && memList.length >= 2 && !journeyOn ? 1 : 0, 0.5, dt);

  // ---- the MRI readout: during the journey, the brain on the wall, the scanner scene, or a drafting look with her
  const draftOn = draftForce !== null || fxDraftT;
  const scanScene = mode === SCENES.indexOf("scanner") && modeNext === mode;
  const dancerHere = dancer && dancerShown && !dancerScan;
  if (TEST && ["glyphs", "dither", "contours"].includes(TEST)) draftForce = DRAFTS.indexOf(TEST);
  if (TEST === "element") { draftForce = 2; maskForce = 1; dancerMode = "on"; }
  if ((TEST === "swarm" || TEST === "forms") && modeNext !== iSwarm) { mode = modeNext = iSwarm; lastSceneChange = t; }
  const wantText = TEST === "text" || connected && (!!J || lv.brain > 0.3 || scanScene || (draftOn && dancerHere));
  textAmt = smooth(textAmt, wantText || memEcho.on ? 1 : 0, 1.5, dt);
  if (textAmt > 0.01 && !wantText && memEcho.on) {                 // a memory coming back: only its tag
    const m = memList[Math.min(memEcho.slot, memList.length - 1)];
    readout.drawTag(`◈ MEMORY  ${m?.hhmm ?? ""}  ${(m?.kind ?? "").toUpperCase()}`, pu.uC1.value, t);
  } else if (textAmt > 0.01) {
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z, asp = innerWidth / innerHeight;
    const wallOf = (v, cam) => { const q = v.clone().project(cam); return { x: q.x * asp * 0.5, y: q.y * 0.5 }; };
    const markers = [];
    if (head && hd.lvl > 0.3) markers.push({ ...wallOf(head.root.position, camera), r: 0.17, label: "HEAD  /  T1 SURFACE" });
    if (brain && lv.brain > 0.3) markers.push({ ...wallOf(brain.root.position, camera), r: 0.62 * brain.size.y * 0.85 / visH, label: region });
    if (dancerHere) markers.push({ ...wallOf(dancer.root.position.clone().setY(DH * 0.9), dancerCam), r: 0.05, label: "SIGNAL  /  BODY" });
    const textSide = head && hd.lvl > 0.3 ? -hd.side : lv.brain > 0.3 ? -1 : dancerHere ? -side : -1;
    const axis = pu.uLbAxis.value, idx = pu.uLbActive.value, frac = 0.08 + 0.84 * (idx + 0.5) / 18;
    const mm = vol ? (frac - 0.5) * vol.meta.dims[axis] : 0;
    const now = new Date(), hms = [now.getHours(), now.getMinutes(), now.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
    const lines = [["SEQ", "3D VOLUME  1.0 MM"],
      ["PHASE", J ? `${J.phase.toUpperCase()}  ${Math.round(100 * J.beats / J.len)}%` : section.toUpperCase()],
      ["PLANE", ["SAGITTAL", "AXIAL", "CORONAL"][axis] || "AXIAL"],
      ["SLICE", `${String(idx + 1).padStart(2, "0")}/18  ${mm >= 0 ? "+" : ""}${mm.toFixed(1)} MM`],
      ["TEMPO", live ? `${s.bpm.toFixed(1)} BPM` : "-"], ["BAR", String(Math.floor(beat / 4)).padStart(4, "0")]];
    if (lv.brain > 0.3) lines.push(["REGION", region]);
    lines.push(["TIME", hms]);
    const lvl = (g) => (live && els0[g]?.on ? els0[g].level : 0);
    readout.draw({ side: textSide, title: J ? "PORTAL / MRI  -  JOURNEY" : lv.brain > 0.3 ? "PORTAL / MRI  -  CORTEX" : "PORTAL / MRI  -  SCAN",
      lines, bars: [["KICK", kick], ["BASS", lvl("bass")], ["LEAD", lvl("lead")], ["PADS", lvl("pads")], ["HATS", lvl("hats")]],
      markers, c1: pu.uC1.value, c2: pu.uC3.value, t, beat });
  }

  // ---- post: trails, kaleidoscope, warp; the hologram's colour drift exactly
  // (no kaleidoscope while she / the brain / the head is up here: it would fold copies of her into odd places)
  const onWall = (dancer && dancer.root.visible) || lv.brain > 0.05 || (head && head.root.visible);
  const kOn = kaleidoMode === "on" || (kaleidoMode === "auto" && !journeyOn && !onWall && (t < kaleidoUntil || section === "peak"));
  const ps = psy.uniforms, fu = feedback.uniforms;
  ps.kaleido.value = smooth(ps.kaleido.value, kOn ? 1 : 0, 1.2, dt);
  ps.krot.value += spin * dt * 0.12 * (0.5 + trip);
  ps.time.value = t;
  ps.warp.value = trip * (0.2 + 0.8 * lv.low);
  ps.aberr.value = 0.002 + 0.02 * kick * trip + 0.02 * flash;
  if (connected && s.hue !== undefined) ps.hue.value = s.hue;
  else ps.hue.value += dt * 0.02 * trip;
  fu.zoom.value = 1.002 + 0.006 * lv.speed * trip + 0.006 * kick * trip;
  if (dancer && dancer.root.visible) fu.zoom.value = 1 + (fu.zoom.value - 1) * 0.25;   // (her trail stays on her, no big ghost)
  fu.rot.value = spin * 0.002 * trip;
  fu.hue.value = 0.01 + 0.03 * lv.mid * trip;
  fu.damp.value = journeyOn ? 0.7 : section === "breakdown" ? 0.9 : 0.82;   // the lightbox stays crisp

  // ---- wall FX
  const els = s.elements || {};
  const fbar = Math.floor(beat / 4);
  if (fbar !== fxBar) {                                             // glitch bands on random bars
    fxBar = fbar;
    if (lookUntil >= 0 && fbar >= lookUntil) plainLook();          // the look's bars are over: back to plain
    // a chance of a look every 24 bars (12 at peaks) when no phrase or drop came
    if (fbar - lookBar >= (section === "peak" ? 12 : 24) && fbar % 4 === 0) pickLook(section);
    if ((section === "normal" || section === "peak" || section === "build") && Math.random() < 0.08) {
      glitchUntil = t + 0.25 / bps; glitchSeed = Math.random() * 100;
    }
  }
  if (live && els.hats?.on && edge("fxhats", els.hats.hit, 0.6, 0.2, 0.5, t) && Math.random() < 0.08) {
    glitchUntil = t + 0.12; glitchSeed = Math.random() * 100;
  }
  if (live && els.lead?.on && edge("fxlead", els.lead.hit, 0.5, 0.2, 60 / s.bpm, t)) leadFlash = 1;
  leadFlash = Math.max(0, leadFlash - dt * 2.5);
  invert = Math.max(0, invert - dt * 7);
  W.uTime.value = t;
  const someoneHere = onWall;
  const mirrorWant = journeyOn || someoneHere ? 0 : fxMirror;      // no mirror over her / the brain / the head, or the films
  if (mirrorWant) W.uMirror.value = mirrorWant;                     // (the kind stays while it fades out)
  W.uMirrorAmt.value = smooth(W.uMirrorAmt.value, mirrorWant ? 1 : 0, 0.8, dt);
  W.uEcho.value = smooth(W.uEcho.value, fxEchoT, 0.6, dt);           // (looks fade in / out over ~2 s)
  W.uBands.value = smooth(W.uBands.value, journeyOn ? 0 : fxBandsT, 0.6, dt);
  // echo spacing in musical time: 8ths, 16ths at peaks or with busy hats; the frame delays follow the frame rate
  fps = smooth(fps, 1 / Math.max(dt, 1e-3), 2, dt);
  const stepSec = (live ? 60 / s.bpm : 0.5) * (section === "peak" || (els.hats?.on && els.hats.level > 0.6) ? 0.25 : 0.5);
  const dScale = fxBandsT ? 0.5 : 1;                                 // the time bands: shorter steps into the past
  wallfx.delays = [1, 2, 3].map((i) => Math.max(1, Math.min(wallfx.hist.length - 1, Math.round(stepSec * i * 30 * dScale))));   // (30 records / s)
  W.uE1.value.copy(pu.uC2.value); W.uE2.value.copy(pu.uC3.value); W.uE3.value.copy(pu.uC4.value);
  W.uCrt.value = smooth(W.uCrt.value, fxCrtT, 0.6, dt);
  const dMode = draftForce !== null ? draftForce : fxDraftMode;
  const dMask = maskForce !== null ? maskForce : draftForce !== null ? 0 : fxDraftMask;
  if (DU.uAmt.value < 0.02 || draftForce !== null || maskForce !== null) { DU.uMode.value = dMode; DU.uMask.value = dMask; }   // (new from plain)
  DU.uAmt.value = smooth(DU.uAmt.value, draftForce !== null ? 1 : journeyOn ? 0 : fxDraftT && DU.uMode.value === dMode ? 1 : 0, 0.7, dt);
  draft.enabled = DU.uAmt.value > 0.005;
  // on the elements: they are drawn into their own layer (below, before the composer) and only they get the look
  const anyElem = (dancer && dancer.root.visible) || (brain && brain.root.visible) || (head && head.root.visible) || hyper.group.visible;
  DU.uElem.value = DU.uMask.value === 1 && anyElem && DU.uAmt.value > 0.01 ? 1 : 0;
  DU.uTime.value = t; DU.uHats.value = W.uHats.value;
  draft.setColors(pu.uC0.value, pu.uC1.value, pu.uC2.value, pu.uC3.value);
  W.uTextAmt.value = textAmt;
  W.uGlitch.value = t < glitchUntil ? 1 : 0;
  W.uGlitchSeed.value = glitchSeed;
  W.uInvert.value = invert;
  W.uHats.value = live && els.hats?.on ? els.hats.level : 0;
  W.uLead.value = leadFlash;
  W.uPads.value = live && els.pads?.on ? els.pads.level : 0;
  W.uBass.value = live && els.bass?.on ? els.bass.level : 0;
  W.uFlicker.value = section === "build" && st > 12 ? 1 - 0.25 * Math.min(1, (st - 12) / 10) * (Math.floor(beat * 2) % 2) : 1;   // 8ths
  W.uDark.value = holdNow;
  W.uBarFlash.value = section === "peak" ? Math.exp(-(beat % 4) * 6) : 0;
  W.uC0.value.copy(pu.uC0.value); W.uC1.value.copy(pu.uC1.value); W.uC2.value.copy(pu.uC2.value); W.uC3.value.copy(pu.uC3.value);
  bloom.strength = (0.4 + 0.25 * trip + 0.4 * flash) * (1 - 0.35 * wallfx.uniforms.uEcho.value);   // (was too bright)
  fu.damp.value -= 0.12 * wallfx.uniforms.uEcho.value;
  // trails per frame -> per time: the same look at 60 Hz (the panel) and 144 Hz (the laptop screen)
  { const f60 = Math.min(3, dt * 60);
    fu.damp.value = Math.pow(Math.min(0.995, fu.damp.value), f60); fu.zoom.value = Math.pow(fu.zoom.value, f60);
    fu.rot.value *= f60; fu.hue.value *= f60; }
  const pf1 = performance.now();
  // the elements' own layer: her (without her halo), the brain / head, the tesseract -> elemRT; then hidden in the main picture
  const hidden = [];
  if (DU.uElem.value) {
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setRenderTarget(elemRT); renderer.setClearColor(0x000000, 0); renderer.clear();
    const ac = renderer.autoClear; renderer.autoClear = false;     // (both renders into the same layer)
    if (dancer && dancer.root.visible) {
      const hv = halo.mesh.visible; halo.mesh.visible = false;
      renderer.render(dancerScene, dancerCam);
      halo.mesh.visible = hv;
      if (herPass) { herPass.enabled = false; hidden.push(null); }
    }
    renderer.clearDepth();
    camera.layers.set(2); renderer.render(scene, camera); camera.layers.set(0);
    renderer.autoClear = ac; renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
    for (const o of [brain?.root, head?.root, hyper.group]) if (o && o.visible) { o.visible = false; hidden.push(o); }
    DU.tElem.value = elemRT.texture;
  }
  composer.render();
  for (const o of hidden) if (o) o.visible = true; else if (herPass) herPass.enabled = true;
  for (let i = memPending.length - 1; i >= 0; i--) if (t >= memPending[i].at) { capture(memPending[i].kind); memPending.splice(i, 1); }
  const pf2 = performance.now();
  perfU = perfU * 0.9 + (pf1 - pf0) * 0.1; perfR = perfR * 0.9 + (pf2 - pf1) * 0.1;

  $("info").textContent = `${fps.toFixed(0)} fps (upd ${perfU.toFixed(1)} ms, render ${perfR.toFixed(1)} ms)   ${connected ? "linked to the hologram window" : idle ? "idle (I)" : "alone: fake 124 BPM"}   ` +
    `${live ? `${s.bpm.toFixed(1)} BPM` : "-"}  section ${section}   scene ${SCENES[mode]}${modeNext !== mode ? ` -> ${SCENES[modeNext]}` : ""}` +
    `   night ${wallPhase}, ${memList.length} memories   colours ${P.name}   she is ${dancerShown ? "here" : dancerScan ? dancerScan.dir + "ing" : "in the cube"} (${dancerMode})` +
    `   brain ${(lv.brain * 100).toFixed(0)} %   kaleidoscope ${kaleidoMode}${kOn ? " (on)" : ""}` +
    `   look ${["plain", "mirror 2", "mirror 4"][fxMirror]}${fxEchoT ? " + echoes" : fxBandsT ? " + time bands" : ""}${fxCrtT ? " + crt" : ""}${DU.uAmt.value > 0.5 ? ` + ${DRAFTS[DU.uMode.value]} (${DU.uElem.value ? "elements" : "whole wall"})` : ""}${draftForce !== null ? " (G)" : ""}` +
    `${J ? `   journey ${J.phase} ${Math.round(100 * J.beats / J.len)} % (lightbox)` : ""}\n` +
    `F fullscreen  U hide  K kaleidoscope  M mirror  I idle  S next scene  L next look  V dancer  G drafting look  Shift+G elements / wall`;
  reporter.tick($("info").textContent);                          // to the dashboard: a small picture + the info line
};

// the dashboard (dashboard.html): it sees this window (a thumbnail + the info line) and sends keys to it
const reporter = new StatusReporter(link, "projector", renderer.domElement);
listenRemote(link, "projector");

// ---------------------------------------------------------------- keep running when the browser pauses this window
// Zen pauses the animation timer of a window that isn't focused (to save power). Then a plain timer draws the frames
// instead (a frame every ~16 ms when no animation frame came for 100 ms); here also on every message from the hologram window.
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
link.ch.addEventListener("message", () => {
  const now = performance.now();
  if (now - lastRafAt > 100 && now - lastFrameAt > 14) runFrame();   // (the cap applies here too)
});
