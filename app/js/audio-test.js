// Meters for the audio engine: spectrum, bands, kick, tempo + beat clock, sections and drops, history graph.
import { AudioEngine } from "./audio.js";

const engine = new AudioEngine();
const $ = (id) => document.getElementById(id);
const canvas = $("c"), g = canvas.getContext("2d");
const log = [];                       // recent events for the list on the right
const history = [];                   // scrolling graph: level, low, high, section
const SECTION_COL = { silence: "#222", normal: "#2b3a55", breakdown: "#5a2b55", build: "#7a5a1e", peak: "#1f6b4c" };

function addLog(text, color = "#ddd") {
  log.unshift({ text: `${new Date().toLocaleTimeString()}  ${text}`, color });
  log.length = Math.min(log.length, 22);
}
engine.on("drop", (d) => addLog(`DROP  (breakdown ${d.breakdownLength.toFixed(0)} s)`, "#ffd34d"));
engine.on("section", (d) => addLog(`section: ${d.prev} -> ${d.section}`, "#a99de0"));
engine.on("tempo", (d) => addLog(`tempo -> ${d.bpm.toFixed(1)} BPM`, "#7fd1ff"));
const GCOL = { kick: "#ffd34d", bass: "#ff4fa3", pads: "#c86bff", lead: "#6be0ff", hats: "#b8ff6b" };
engine.on("element", (d) => addLog(`${d.group.toUpperCase()} ${d.type}${d.dist ? ` (${(d.dist * 100).toFixed(0)} % different)` : ""}` +
  `   width ${(d.width * 100).toFixed(0)} %, pan ${d.pan > 0.05 ? "R" : d.pan < -0.05 ? "L" : "C"}`, GCOL[d.group]));
engine.on("predrop", () => addLog("PRE-DROP: the mix collapses, drop coming", "#ff6b6b"));
engine.on("phrase", (d) => addLog(`NEW PHRASE  (${d.reasons.join(", ")})`, "#ffffff"));
engine.on("stereo", (d) => addLog(`STEREO ${d.type}  (width ${(d.width * 100).toFixed(0)} %)`, "#ff9e4d"));
engine.on("surge", (d) => addLog(`SURGE  intensity ${(d.from * 100).toFixed(0)} -> ${(d.to * 100).toFixed(0)} %`, "#5dffb0"));

async function fillDevices() {
  const sel = $("device"), keep = sel.value;
  const inputs = await AudioEngine.listInputs();
  sel.innerHTML = '<option value="">default input</option>' +
    inputs.map((d) => `<option value="${d.deviceId}">${d.label || "input " + d.deviceId.slice(0, 6)}</option>`).join("");
  sel.value = keep;
  // pre-select the SSL 2 if it is there
  const ssl = inputs.find((d) => /ssl|solid state|usb audio codec|behringer|ufo/i.test(d.label));
  if (!keep && ssl) sel.value = ssl.deviceId;
}

$("start").onclick = async () => {
  try {
    await engine.startInput($("device").value);
    await fillDevices();
    $("src").textContent = "input: " + engine.state.source;
    addLog("started input " + engine.state.source);
  } catch (err) { $("src").textContent = "error: " + err.message; }
};
$("file").onchange = async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  $("player").style.display = "block";
  await engine.startFile(f, $("player"));
  $("src").textContent = "file: " + f.name;
  addLog("playing " + f.name);
};
fillDevices();

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", resize);
resize();

function bar(x, y, w, h, v, col, label) {
  g.fillStyle = "#16141f"; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y + h * (1 - v), w, h * v);
  g.fillStyle = "#aaa"; g.font = "12px system-ui"; g.textAlign = "center";
  g.fillText(label, x + w / 2, y + h + 16);
}

function draw() {
  const s = engine.update();
  const W = canvas.clientWidth, H = canvas.clientHeight;
  g.fillStyle = "#07060b"; g.fillRect(0, 0, W, H);

  // spectrum (log frequency axis)
  const sx = 20, sy = 20, sw = W * 0.55, sh = H * 0.32;
  g.fillStyle = "#0e0c15"; g.fillRect(sx, sy, sw, sh);
  if (engine.spec) {
    const n = 160, fMin = 30, fMax = 16000;
    for (let i = 0; i < n; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / n);
      const db = engine.spec[Math.round(f / engine.binHz)] ?? -160;
      const v = Math.max(0, Math.min(1, (db + 100) / 70));
      g.fillStyle = `hsl(${270 - 200 * i / n} 70% 60%)`;
      g.fillRect(sx + i * sw / n, sy + sh * (1 - v), sw / n - 1, sh * v);
    }
  }
  g.fillStyle = "#777"; g.font = "12px system-ui"; g.textAlign = "left";
  g.fillText("spectrum 30 Hz - 16 kHz", sx + 4, sy + 14);

  // band bars + level
  const bx = sx + sw + 30, by = sy, bw = 34, bh = sh;
  bar(bx, by, bw, bh, s.level, "#e0e0e0", "level");
  bar(bx + 50, by, bw, bh, s.bands.low, "#ff4fa3", "low");
  bar(bx + 100, by, bw, bh, s.bands.lowmid, "#c86bff", "lowmid");
  bar(bx + 150, by, bw, bh, s.bands.mid, "#6b8bff", "mid");
  bar(bx + 200, by, bw, bh, s.bands.high, "#4fe0ff", "high");

  // kick flash, BPM, beat clock
  const kx = bx + 300, ky = sy + 60;
  g.beginPath(); g.arc(kx, ky, 26 + 14 * s.kick, 0, 2 * Math.PI);
  g.fillStyle = `rgba(255, 211, 77, ${0.15 + 0.85 * s.kick})`; g.fill();
  g.fillStyle = "#aaa"; g.textAlign = "center"; g.fillText("kick", kx, ky + 58);
  g.textAlign = "left"; g.fillStyle = "#fff"; g.font = "bold 40px system-ui";
  g.fillText(s.bpm ? s.bpm.toFixed(1) : "--", kx + 60, ky + 4);
  g.font = "13px system-ui"; g.fillStyle = "#999";
  g.fillText(`BPM   confidence ${(s.bpmConfidence * 100).toFixed(0)} %`, kx + 62, ky + 26);
  for (let i = 0; i < 4; i++) {
    const on = s.bpm && s.beatCount % 4 === i;
    g.fillStyle = on ? `rgba(127, 209, 255, ${1 - s.beatPhase * 0.7})` : "#1d1a28";
    g.fillRect(kx + 62 + i * 34, ky + 40, 28, 28);
  }

  // section
  g.font = "bold 22px system-ui"; g.fillStyle = SECTION_COL[s.section] === "#222" ? "#666" : "#fff";
  g.fillText(`section: ${s.section.toUpperCase()}  (${s.sectionTime.toFixed(0)} s)`, kx - 26, ky + 120);
  g.font = "13px system-ui"; g.fillStyle = "#999";
  g.fillText(`since last drop: ${Number.isFinite(s.sinceDrop) ? s.sinceDrop.toFixed(0) + " s" : "-"}` +
    `     kick: ${s.kickOn ? "ON" : "OFF"} (${(s.punch * 100).toFixed(0)} %)` +
    `     density: ${(s.densityRel * 100).toFixed(0)} % of full     intensity: ${(s.intensity * 100).toFixed(0)} %`,
    kx - 26, ky + 142);

  // which of the 24 bands are "playing" (low -> high)
  const ax = kx - 26, ay = ky + 160, aw = 14;
  for (let k = 0; k < s.active.length; k++) {
    g.fillStyle = `hsl(${300 - 260 * k / s.active.length} 80% ${10 + 50 * s.active[k]}%)`;
    g.fillRect(ax + k * (aw + 3), ay, aw, 22);
  }
  g.fillStyle = "#888"; g.font = "12px system-ui";
  g.fillText("elements playing, 24 bands: bass  ->  highs", ax, ay + 38);

  // instrument groups: on/off, level, stereo width and pan
  if (s.elements) {
    let gy = ay + 60;
    for (const [name, e] of Object.entries(s.elements)) {
      g.fillStyle = e.on ? GCOL[name] : "#333"; g.fillRect(ax, gy, 12, 12);
      g.fillStyle = "#aaa"; g.font = "12px system-ui"; g.fillText(name, ax + 18, gy + 10);
      g.fillStyle = "#1d1a28"; g.fillRect(ax + 60, gy, 120, 12);
      g.fillStyle = GCOL[name]; g.fillRect(ax + 60, gy, 120 * e.level, 12);
      g.fillStyle = "#1d1a28"; g.fillRect(ax + 190, gy, 80, 12);
      g.fillStyle = "#ff9e4d"; g.fillRect(ax + 190, gy, 80 * Math.min(1, e.width * 2), 12);
      g.fillStyle = "#555"; g.fillRect(ax + 280, gy + 5, 80, 2);
      g.fillStyle = "#fff"; g.fillRect(ax + 280 + 40 + 38 * e.pan - 2, gy, 4, 12);
      g.fillStyle = "#888"; g.font = "11px ui-monospace, monospace";
      g.fillText(`attack ${(e.trans * 100).toFixed(0).padStart(3)}  sustain ${(e.sustain * 100).toFixed(0).padStart(3)}  noise ${(e.noise * 100).toFixed(0).padStart(3)}`, ax + 370, gy + 10);
      g.font = "12px system-ui";
      gy += 18;
    }
    g.fillStyle = "#888";
    g.fillText(`level              width              pan L - R      stereo width ${(s.stereo.width * 100).toFixed(0)} %`, ax + 60, gy + 10);
  }

  // history graph
  if (s.running) history.push({ l: s.env.short, lo: Math.min(1, s.densityRel / 1.5), hi: s.onset, sec: s.section, k: s.kick });
  const maxN = 1800;                                        // ~30 s at 60 fps
  if (history.length > maxN) history.shift();
  const hx = 20, hy = Math.max(sy + sh + 50, 440), hw = W * 0.7 - 20, hh = Math.max(120, H - hy - 30);
  g.fillStyle = "#0e0c15"; g.fillRect(hx, hy, hw, hh);
  const step = hw / maxN;
  history.forEach((p, i) => { g.fillStyle = SECTION_COL[p.sec]; g.fillRect(hx + i * step, hy, step + 0.5, hh); });
  for (const [key, col] of [["l", "#e0e0e0"], ["lo", "#ff4fa3"], ["hi", "#4fe0ff"]]) {
    g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
    history.forEach((p, i) => { const y = hy + hh * (1 - p[key]); i ? g.lineTo(hx + i * step, y) : g.moveTo(hx, y); });
    g.stroke();
  }
  history.forEach((p, i) => { if (p.k === 1) { g.fillStyle = "#ffd34d"; g.fillRect(hx + i * step, hy + hh - 8, 2, 8); } });
  g.fillStyle = "#888"; g.font = "12px system-ui";
  g.fillText("last 30 s: level (white), density (pink), onset strength (cyan), kicks (yellow ticks); " +
    "background = section (blue normal, green peak, purple breakdown, orange build)", hx + 4, hy + 14);

  // event log
  const lx = W * 0.72, ly = hy + 6;
  g.font = "13px ui-monospace, monospace";
  log.forEach((e, i) => { g.fillStyle = e.color; g.fillText(e.text, lx, ly + 18 * i + 10); });

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
