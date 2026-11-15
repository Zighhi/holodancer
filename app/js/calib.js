// Calibration: the last pass of a screen's picture. It flips, scales, stretches, keystones and moves the whole picture,
// so it looks right where it ends up (the hologram: seen in the acrylic sheet from the crowd; the projector: on the
// wall). R opens it: a test pattern (grid, circle, TOP / LEFT labels, black-level steps) instead of the show, and keys to
// adjust it while looking at the real thing. Saved on the server (memory/calib.json), so it survives reloads.
// The projector's version also marks where the cube is (C + arrows): the things that rise from the cube start there.
//   R   open / close (saves)          T   test pattern <-> the live show
//   arrows   move the picture (Shift: faster)        + / -   size          W / S   taller / shorter (stretch)
//   Q / E    keystone (top narrower / wider)          X   flip left-right   Y   flip upside down
//   O   rotate a quarter turn clockwise (the panel mounted turned; the picture keeps its proportions, + / - to fit)
//   C   (projector) arrows move the cube marker      0   reset
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const DEFAULTS = { flipX: 0, flipY: 0, rot: 0, scale: 1, stretch: 1, keystone: 0, offX: 0, offY: 0, cubeX: 0, cubeY: -0.52 };

class CalibPass extends Pass {
  constructor(pattern) {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, tPattern: { value: pattern }, uPattern: { value: 0 }, uFlipX: { value: 0 }, uFlipY: { value: 0 },
      uScale: { value: 1 }, uStretch: { value: 1 }, uKeystone: { value: 0 }, uOffset: { value: new THREE.Vector2() },
      uRot: { value: 0 }, uAspect: { value: 16 / 9 },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tPattern;
        uniform float uPattern, uFlipX, uFlipY, uScale, uStretch, uKeystone, uRot, uAspect;
        uniform vec2 uOffset;
        varying vec2 vUv;
        void main() {
          vec2 q = vUv - 0.5 - uOffset;                    // where on the source picture this screen pixel looks
          q.y /= uScale * uStretch;
          q.x /= uScale * (1.0 + uKeystone * q.y * 2.0);   // keystone: the width changes from bottom to top
          // quarter turns, in real proportions (a circle stays round): the picture turns clockwise per step
          vec2 p = vec2(q.x * uAspect, q.y);
          float a = uRot * 1.5707963, ca = floor(cos(a) + 0.5), sa = floor(sin(a) + 0.5);
          p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
          q = vec2(p.x / uAspect, p.y);
          q += 0.5;
          if (uFlipX > 0.5) q.x = 1.0 - q.x;
          if (uFlipY > 0.5) q.y = 1.0 - q.y;
          vec3 c = vec3(0.0);
          if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0)
            c = uPattern > 0.5 ? texture2D(tPattern, q).rgb : texture2D(tDiffuse, q).rgb;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.uAspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

export class Calibration {
  // name: "holo" or "wall"; the pass is added at the end of the composer
  constructor(name, composer, { cube = false } = {}) {
    this.name = name;
    this.cube = cube;
    this.s = { ...DEFAULTS };
    this.active = false;
    this.pattern = true;
    this.cubeEdit = false;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1920; this.canvas.height = 1080;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;            // after the output pass: the canvas values go out as they are
    this.pass = new CalibPass(this.tex);
    composer.addPass(this.pass);
    this.box = document.createElement("div");
    Object.assign(this.box.style, { position: "fixed", top: "10px", right: "10px", zIndex: 9, padding: "10px 14px",
      background: "rgba(10,8,20,0.85)", color: "#e8e0ff", font: "13px ui-monospace, monospace", whiteSpace: "pre",
      border: "1px solid #554a80", borderRadius: "8px", display: "none" });
    document.body.appendChild(this.box);
    this.draw();
    this.apply();
    fetch("api/calib").then((r) => r.json()).then((d) => { if (d[name]) { Object.assign(this.s, d[name]); this.apply(); this.draw(); } })
      .catch(() => {});
  }

  // the test pattern: grid of squares, a circle (should look round from the crowd), labels, black-level steps
  draw() {
    const c = this.canvas.getContext("2d"), W = 1920, H = 1080;
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#5a7cff"; c.lineWidth = 2;
    for (let x = 0; x <= W; x += 108) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y <= H; y += 108) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = "#ffc94d"; c.lineWidth = 6;
    c.beginPath(); c.arc(W / 2, H / 2, 380, 0, Math.PI * 2); c.stroke();               // must look round
    c.beginPath(); c.moveTo(W / 2 - 60, H / 2); c.lineTo(W / 2 + 60, H / 2); c.moveTo(W / 2, H / 2 - 60); c.lineTo(W / 2, H / 2 + 60); c.stroke();
    c.strokeStyle = "#ff5fa2"; c.lineWidth = 10; c.strokeRect(5, 5, W - 10, H - 10);   // the picture's edge
    c.fillStyle = "#fff"; c.font = "bold 72px system-ui, sans-serif"; c.textAlign = "center";
    c.fillText("TOP", W / 2, 110);
    c.textAlign = "left"; c.fillText("LEFT", 40, H / 2 + 24);
    c.textAlign = "right"; c.fillText("RIGHT", W - 40, H / 2 + 24);
    c.textAlign = "center"; c.font = "bold 40px system-ui, sans-serif"; c.fillStyle = "#ffc94d";
    c.fillText(this.name === "holo" ? "HOLOGRAM" : "PROJECTOR", W / 2, H - 150);
    // black level: the first steps should stay invisible (true black), the later ones just visible
    for (let i = 0; i < 12; i++) {
      const v = i * 3; c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(W / 2 - 6 * 70 + i * 70, H - 110, 66, 70);
    }
    c.fillStyle = "#888"; c.font = "22px system-ui, sans-serif";
    c.fillText("black level: 0 ... 33", W / 2, H - 20);
    if (this.cube) {                                         // where the cube is (below the wall): the rises start here
      const cx = W / 2 + this.s.cubeX * H, cy = H / 2 - this.s.cubeY * H;
      c.strokeStyle = "#4dffb0"; c.lineWidth = 6;
      c.strokeRect(cx - 90, cy - 30, 180, 120);
      c.fillStyle = "#4dffb0"; c.font = "bold 34px system-ui, sans-serif"; c.fillText("CUBE", cx, cy - 45);
    }
    this.tex.needsUpdate = true;
  }

  apply() {
    const u = this.pass.uniforms, s = this.s;
    u.uFlipX.value = s.flipX; u.uFlipY.value = s.flipY; u.uRot.value = s.rot || 0; u.uScale.value = s.scale; u.uStretch.value = s.stretch;
    u.uKeystone.value = s.keystone; u.uOffset.value.set(s.offX, s.offY);
    u.uPattern.value = this.active && this.pattern ? 1 : 0;
    this.box.style.display = this.active ? "block" : "none";
    this.box.textContent = `CALIBRATION (${this.name === "holo" ? "hologram" : "projector"})   R close + save\n` +
      `T  ${this.pattern ? "test pattern" : "live show"}\n` +
      `arrows  move ${s.offX.toFixed(3)}, ${s.offY.toFixed(3)}   (Shift: faster)\n` +
      `+ / -   size ${s.scale.toFixed(3)}\nW / S   stretch ${s.stretch.toFixed(3)}\nQ / E   keystone ${s.keystone.toFixed(3)}\n` +
      `X  flip left-right ${s.flipX ? "ON" : "off"}\nY  flip upside down ${s.flipY ? "ON" : "off"}\n` +
      `O  rotate ${(s.rot || 0) * 90}°  (clockwise; + / - to fit)\n` +
      (this.cube ? `C  ${this.cubeEdit ? "arrows move the CUBE marker" : "move the cube marker"}  (${s.cubeX.toFixed(2)}, ${s.cubeY.toFixed(2)})\n` : "") +
      `0  reset`;
  }

  save() {
    fetch("api/calib", { method: "POST", body: JSON.stringify({ [this.name]: this.s }) }).catch(() => {});
  }

  // true = the key was used here (the show ignores it)
  handleKey(e) {
    const k = e.key.toLowerCase();
    if (!this.active) {
      if (k === "r") { this.active = true; this.apply(); return true; }
      return false;
    }
    const s = this.s, step = e.shiftKey ? 0.02 : 0.004;
    if (k === "r") { this.active = false; this.cubeEdit = false; this.save(); }
    else if (k === "t") this.pattern = !this.pattern;
    else if (k === "c" && this.cube) this.cubeEdit = !this.cubeEdit;
    else if (e.key.startsWith("Arrow")) {
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, dy = e.key === "ArrowDown" ? -1 : e.key === "ArrowUp" ? 1 : 0;
      if (this.cubeEdit) { s.cubeX += dx * step * 2; s.cubeY += dy * step * 2; this.draw(); }
      else { s.offX += dx * step; s.offY += dy * step; }
      e.preventDefault();
    }
    else if (k === "+" || k === "=") s.scale *= 1.01;
    else if (k === "-") s.scale /= 1.01;
    else if (k === "w") s.stretch *= 1.01;
    else if (k === "s") s.stretch /= 1.01;
    else if (k === "q") s.keystone -= 0.01;
    else if (k === "e") s.keystone += 0.01;
    else if (k === "x") s.flipX = s.flipX ? 0 : 1;
    else if (k === "y") s.flipY = s.flipY ? 0 : 1;
    else if (k === "o") s.rot = ((s.rot || 0) + 1) % 4;
    else if (k === "0") { Object.assign(s, DEFAULTS); this.draw(); }
    this.apply();
    return true;                                             // while calibrating, every key belongs here
  }
}
