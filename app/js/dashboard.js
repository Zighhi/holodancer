// The dashboard (dashboard.html, on the laptop screen): the show's state, a live thumbnail + info line of both show
// windows, buttons for the main moments, and a key pad that sends keys to either window (calibration included).
// It only talks to the show windows over their BroadcastChannel ("holodancer"); nothing leaves the laptop.
import { ShowLink } from "./link.js";

const $ = (id) => document.getElementById(id);
const link = new ShowLink("dashboard");
const key = (to, k, shift = false) => link.emit("key", { to, key: k, shift });

// ---- buttons: [label, key, shift]
const HOLO = [
  ["Send her up / down", "v"], ["Unison", "q"], ["Fake drop", "d"], ["Head journey", "j"], ["Journey snippet", "z"],
  ["Scanner pass", "y"], ["Echo slices", "e"], ["Brain", "b"], ["Brain: points", "B", true], ["Tesseract", "I", true],
  ["Spine stack", "S", true], ["Drafting look", "i"], ["Next move", "n"], ["Next colours", "c"], ["Night phase", "o"],
  ["New night", "O", true], ["Hide info", "u"], ["Calibration", "r"],
];
const WALL = [
  ["Next scene", "s"], ["Next look", "l"], ["Drafting look", "g"], ["Elements / wall", "G", true], ["Kaleidoscope", "k"],
  ["Dancer", "v"], ["Mirror (rear)", "m"], ["Hide info", "u"], ["Calibration", "r"],
];
function buttons(el, to, list) {
  for (const [label, k, shift] of list) {
    const b = document.createElement("button");
    b.innerHTML = `${label}<small>${shift ? "⇧" : ""}${k.toUpperCase()}</small>`;
    b.onclick = () => key(to, k, shift);
    el.append(b);
  }
}
buttons($("bH"), "hologram", HOLO);
buttons($("bP"), "projector", WALL);

// ---- calibration: one row per screen (open it with the first button; the others only work while it is open)
const CALIB = [
  ["Calibration on / off", "r"], ["Test pattern / show", "t"], ["Rotate 90°", "o"], ["Flip ↔", "x"], ["Flip ↕", "y"],
  ["Bigger", "+"], ["Smaller", "-"], ["Taller", "w"], ["Shorter", "s"], ["Top narrower", "q"], ["Top wider", "e"],
  ["← move", "ArrowLeft"], ["→ move", "ArrowRight"], ["↑ move", "ArrowUp"], ["↓ move", "ArrowDown"],
  ["← fast", "ArrowLeft", true], ["→ fast", "ArrowRight", true], ["↑ fast", "ArrowUp", true], ["↓ fast", "ArrowDown", true],
];
function calibRow(after, to) {
  const box = document.createElement("div");
  box.innerHTML = `<div class="lbl" style="margin:4px 0 6px">calibration (open it first; it saves when closed)</div>`;
  const row = document.createElement("div");
  row.className = "btns";
  for (const [label, k, shift] of CALIB) {
    const b = document.createElement("button");
    b.textContent = label;
    if (k === "r" || k === "o") b.style.borderColor = "var(--accent)";
    b.onclick = () => key(to, k, !!shift);
    row.append(b);
  }
  const reset = document.createElement("button");
  reset.textContent = "Reset";
  reset.onclick = () => { if (confirm(`Reset the ${to} calibration to the defaults?`)) key(to, "0"); };
  row.append(reset);
  box.append(row);
  after.after(box);
}
calibRow($("bH"), "hologram");
calibRow($("bP"), "projector");

// ---- the key pad: every key to the chosen window
let target = "hologram";
for (const b of document.querySelectorAll(".seg button")) {
  b.onclick = (e) => {
    e.stopPropagation();
    target = b.dataset.to;
    document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    $("pad").focus();
  };
}
$("pad").addEventListener("keydown", (e) => {
  if (e.key === "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;     // (keep the browser's own shortcuts)
  e.preventDefault();
  key(target, e.key, e.shiftKey);
  $("last").textContent = `${e.shiftKey && e.key.length > 1 ? "⇧" : ""}${e.key === " " ? "space" : e.key} → ${target}`;
});

// ---- status from the show windows
const seen = { hologram: -1e9, projector: -1e9 };
link.on("status", (m) => {
  const H = m.from === "hologram";
  seen[m.from] = performance.now();
  if (m.img) $(H ? "thH" : "thP").getContext("2d").putImageData(m.img, 0, 0);
  $(H ? "infoH" : "infoP").textContent = m.text || "";
  const fps = /^(\d+) fps/.exec(m.text || "");
  $(H ? "fpsH" : "fpsP").textContent = fps ? `${fps[1]} fps` : "";
});

// ---- audio inputs (this window asks once for the labels; the hologram does the listening)
async function devices() {
  try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* labels may stay empty */ }
  const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  $("dev").innerHTML = list.map((d) => `<option value="${d.deviceId}">${d.label || "input " + d.deviceId.slice(0, 6)}</option>`).join("");
  const pref = list.find((d) => /usb audio codec|ssl|ufo/i.test(d.label) && !/^default/i.test(d.label));
  if (pref) $("dev").value = pref.deviceId;
}
devices();
$("use").onclick = () => link.emit("cmd", { to: "hologram", action: "audio", deviceId: $("dev").value });

// ---- a test track (testing without the mixer): the file itself goes to the hologram window, which plays it
$("file").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  link.postRaw("cmd", { to: "hologram", action: "file", file: f });   // (a File is cloned over the channel as it is)
  $("fileName").textContent = f.name;
  e.target.value = "";                                                   // the same file can be picked again
};
$("playpause").onclick = () => link.emit("cmd", { to: "hologram", action: "playpause" });

// ---- the header, 4 times a second
setInterval(() => {
  const d = new Date();
  $("clock").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const s = link.connected ? link.state : null;
  $("phase").textContent = s?.phase || "-";
  $("bpm").textContent = s?.running && s.bpm ? s.bpm.toFixed(1) : "-";
  $("section").textContent = s?.section || "-";
  $("inten").style.width = `${Math.round(100 * (s?.intensity || 0))}%`;
  const what = [];
  if (s) {
    if (s.mind) what.push({ journey: "head journey", brainWall: "brain on the wall", brain: "the brain", hyper: "tesseract", spineStack: "spine stack" }[s.mind] || s.mind);
    if (s.stage && s.stage !== "holo") what.push(`she is on the ${s.stage === "wall" ? "wall" : "move"}`);
    if (s.unison) what.push("unison");
    if (s.journey) what.push(`journey ${s.journey}`);
  }
  $("now").textContent = what.join(" · ") || (s ? "-" : "no hologram window");
  const now = performance.now();
  $("dotH").classList.toggle("on", now - seen.hologram < 2000);
  $("dotP").classList.toggle("on", now - seen.projector < 2000);
}, 250);
