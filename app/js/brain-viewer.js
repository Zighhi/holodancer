// Brain viewer: checks the MRI model and its effects without music. Drag = rotate, wheel = zoom.
// A fake 130 BPM track drives it: kick every beat, bass on the offbeats, lead every 2 beats, hats on the 16ths.
// Keys: X x-ray, S scan sweep, W pads wash, B dissolve out/in, C colours, P phrase signal, space = sparks, R auto-rotate.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Brain } from "./brain.js";
import { Head } from "./head.js";
import { Journey, SNIPPETS } from "./journey.js";
import { PALETTES } from "./dancer.js";

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#000");
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 10);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

const brain = await Brain.load();
scene.add(brain.root);
let head = null, journey = null;
try { head = await Head.load(); scene.add(head.root); journey = new Journey(head, brain); } catch (e) { console.info("no head:", e.message); }
const q = new URLSearchParams(location.search);          // ?yaw=1.57&xray=1 etc. for screenshots
let yaw = +(q.get("yaw") ?? 0.6), pitch = +(q.get("pitch") ?? 0.15), dist = 0.55, auto = !q.has("yaw");
let xray = +(q.get("xray") ?? 0), sweepOn = q.get("sweep") === "1", waves = q.get("waves") !== "0", target = 1, palette = 0;
brain.spinSpeed = 0;
let drag = null;
addEventListener("pointerdown", (e) => (drag = [e.clientX, e.clientY]));
addEventListener("pointerup", () => (drag = null));
addEventListener("pointermove", (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.006; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.006));
  drag = [e.clientX, e.clientY]; auto = false;
});
addEventListener("wheel", (e) => (dist = Math.max(0.2, Math.min(2, dist * (1 + e.deltaY * 0.001)))));
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "x") xray = xray > 0.5 ? 0 : 1;
  if (k === "s") sweepOn = !sweepOn;
  if (k === "w") waves = !waves;
  if (k === "b") target = target ? 0 : 1;
  if (k === "c") palette = (palette + 1) % PALETTES.length;
  if (k === "r") auto = !auto;
  if (k === " ") for (let i = 0; i < 6; i++) brain.spark();
  if (k === "p") brain.pulse("phrase");
  if (k === "o") pts = pts ? 0 : 1;                        // O: the point cloud
  if (k === "d") brain.burst();                            // D: a drop burst
  if (k === "j" && journey) {                              // J: the head journey at a fake 130 BPM (front view)
    if (journey.active) journey.stop(); else { journey.start(false); auto = false; yaw = 0; pitch = 0.12; dist = 0.75; }
  }
  if (k === "n" && journey?.active) journey.beats = 1e3;   // N: next journey phase
  if (k === "z" && journey) {                              // Z: a journey snippet (one stage, a few bars)
    const o = Object.keys(SNIPPETS); journey.startSnippet(o[0 | Math.random() * o.length]);
    auto = false; yaw = 0; pitch = 0.12; dist = 0.75;
  }
});

const clock = new THREE.Clock();
if (q.has("points")) brain.ptsMix = 1;                    // ?points: start as the point cloud
if (q.has("journey") && journey) {                         // ?journey=5&beat=40: start the journey at a phase / beat
  journey.start(false); journey.i = +q.get("journey"); journey.beats = +(q.get("beat") || 0);
  auto = false; yaw = 0; pitch = 0.12; dist = 0.75;
}
let level = q.has("yaw") || q.has("points") ? 1 : 0, xr = xray, beatT = 0, pts = q.has("points") ? 1 : 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  level += (target - level) * Math.min(1, dt * 0.8);
  xr += (xray - xr) * Math.min(1, dt * 1.5);
  if (auto) yaw += dt * 0.2;
  const b0 = beatT * 130 / 60;                             // a fake 130 BPM track
  beatT += dt;
  const b1 = beatT * 130 / 60, ph = b1 % 1, kick = Math.exp(-ph * 8);
  const crossed = (step) => Math.floor(b1 / step) !== Math.floor(b0 / step);
  if (crossed(1)) brain.pulse("kick", 1);
  if (Math.floor(b1 + 0.5) !== Math.floor(b0 + 0.5)) brain.pulse("bass", 0.8);
  if (crossed(2)) brain.pulse("lead", 0.8);
  if (crossed(0.25) && Math.random() < 0.5) brain.spark();
  if (crossed(32)) brain.pulse("phrase");
  const d = dist * (journey ? 1 + (journey.camZoom - 1) * journey.cover : 1);
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(0, 0, 0);
  brain.setColors(PALETTES[palette], 1);
  const bass = 0.5 + 0.5 * Math.sin(b1 * Math.PI);
  const jOn = journey && (journey.active || journey.cover > 0.01);
  if (journey) {
    head.setColors(PALETTES[palette], 1);
    journey.update(dt, t, { bpm: 130, section: "", kick, bass, hats: 0.5, steps: 2, camera, anchor: new THREE.Vector3(), height: 0.26 });
  }
  if (!jOn) { brain.root.position.set(0, 0, 0); brain.root.scale.setScalar(1); brain.root.quaternion.identity(); }
  brain.update(dt, t, { level: jOn ? journey.brainLevel : level, xray: jOn ? 0 : xr, kick, mid: 0.4 + 0.3 * Math.sin(t * 0.3), bass,
    pads: waves ? 0.8 : 0, hats: 0.6, sweep: sweepOn && !jOn ? (t / 6) % 1 : -1, fixed: jOn,
    points: jOn ? 0 : pts, px: renderer.domElement.height });
  composer.render();
  document.getElementById("info").textContent =
    `brain ${(brain.size.x * 1000).toFixed(0)} x ${(brain.size.y * 1000).toFixed(0)} x ${(brain.size.z * 1000).toFixed(0)} mm   ` +
    `colours ${PALETTES[palette].name}   ${pts ? "points" : "solid"}   x-ray ${xray ? "on" : "off"}   sweep ${sweepOn ? "on" : "off"}   pads ${waves ? "on" : "off"}   ` +
    `journey ${journey ? journey.progress : "none (no head model)"}\n` +
    `drag rotate, wheel zoom   X x-ray  S sweep  W pads  B dissolve  C colours  P phrase  space sparks  R auto-rotate  O points  D burst  J head journey  N next phase  Z snippet`;
});
