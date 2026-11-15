// Drafting looks for the wall (after GEOMETRIC by SHINICHI, geometric-art.com: glyph density, 1-bit dither, contour
// lines, crosshairs / corner brackets on the strong points). For the projector and the hologram:
//   DraftPass     - the three looks (glyphs, dither, contours) over the whole picture, or only on the elements
//                   (her, the brain / head, the tesseract): the show draws them into their own layer (tElem), the
//                   rest of the wall stays as it is
//   glyphAtlas()  - the glyphs of the ASCII look, sorted by how much ink they have (dark -> bright)
//   Readout       - the MRI readout: a text column with scanner data + markers (brackets, crosshair, leader line)
//                   on the head / brain / dancer, drawn into a canvas the pass lays over the picture
// (No data from the scan's file headers: only what the show itself knows - phase, plane, slice, tempo, section.)
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const GLYPHS = [" ", "·", ".", ":", "-", "+", "⊹", "*", "✧", "⋆", "×", "o", "◇", "◈", "#", "ॐ"];
const FONT = "'Segoe UI Symbol', 'Nirmala UI', 'Consolas', monospace";

export function glyphAtlas(size = 64) {
  const one = document.createElement("canvas");
  one.width = one.height = size;
  const g = one.getContext("2d", { willReadFrequently: true });
  const ink = GLYPHS.map((ch) => {                                     // how much of the cell each glyph fills
    g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
    g.fillStyle = "#fff"; g.font = `${size * 0.8}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ch, size / 2, size * 0.54);
    const d = g.getImageData(0, 0, size, size).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i];
    return { ch, ink: sum / (255 * size * size) };
  }).sort((a, b) => a.ink - b.ink);
  const c = document.createElement("canvas");
  c.width = size * ink.length; c.height = size;
  const x = c.getContext("2d");
  x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#fff"; x.font = `${size * 0.8}px ${FONT}`; x.textAlign = "center"; x.textBaseline = "middle";
  ink.forEach((e, i) => x.fillText(e.ch, size * (i + 0.5), size * 0.54));
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { tex, n: ink.length };
}

const hex = () => (Math.random() * 65536 | 0).toString(16).toUpperCase().padStart(4, "0");
const css = (c, a = 1) => `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`;

export class Readout {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.g = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.stream = Array.from({ length: 7 }, () => Array.from({ length: 6 }, hex).join(" "));
    this.last = -1;
    this.resize();
  }
  resize() { this.canvas.width = innerWidth; this.canvas.height = innerHeight; }

  // only a small tag in a corner (a memory of the night coming back)
  drawTag(text, c1, t) {
    if (t - this.last < 0.25) return;
    this.last = t;
    const { g, canvas: cv } = this, H = cv.height, fs = Math.round(H / 46);
    g.clearRect(0, 0, cv.width, H);
    g.font = `${fs}px Consolas, 'Segoe UI Symbol', monospace`; g.textBaseline = "bottom";
    g.fillStyle = css(c1, 0.8); g.fillText(text, cv.width * 0.04, H * 0.95);
    this.tex.needsUpdate = true;
  }

  // d: { side (-1 text on the left, 1 right), title, lines [[label, value]], bars [[name, 0..1]], markers [{x, y, r, label}]
  //      (wall units), c1, c2 (THREE.Color), t, beat }; redrawn ~12 times a second
  draw(d) {
    if (d.t - this.last < 0.08) return;
    this.last = d.t;
    const { g, canvas: cv } = this, W = cv.width, H = cv.height, fs = Math.round(H / 42);
    g.clearRect(0, 0, W, H);
    const toPx = (x, y) => [W / 2 + x * H, H / 2 - y * H];
    const x0 = d.side < 0 ? W * 0.05 : W * 0.72, y0 = H * 0.14, colW = W * 0.23;
    g.font = `${fs}px Consolas, 'Courier New', monospace`;
    g.textBaseline = "top";
    // the title + a rule
    g.fillStyle = css(d.c1); g.fillText(d.title, x0, y0);
    g.fillRect(x0, y0 + fs * 1.4, colW, Math.max(1, H / 900));
    // label / value rows
    let y = y0 + fs * 2;
    for (const [k, v] of d.lines) {
      g.fillStyle = css(d.c2, 0.75); g.fillText(k, x0, y);
      g.fillStyle = css(d.c1); g.fillText(v, x0 + fs * 5.5, y);
      y += fs * 1.3;
    }
    // the signal bars (the music's elements)
    y += fs * 0.6;
    for (const [k, v] of d.bars) {
      g.fillStyle = css(d.c2, 0.75); g.fillText(k, x0, y);
      const n = 16, on = Math.round(v * n);
      for (let i = 0; i < n; i++) {
        g.fillStyle = i < on ? css(d.c1, 0.9) : css(d.c2, 0.18);
        g.fillRect(x0 + fs * 5.5 + i * fs * 0.62, y + fs * 0.15, fs * 0.45, fs * 0.7);
      }
      y += fs * 1.15;
    }
    // a data stream scrolling up
    y += fs * 0.6;
    if (Math.floor(d.beat * 2) !== this.sb) { this.sb = Math.floor(d.beat * 2); this.stream.shift(); this.stream.push(Array.from({ length: 6 }, hex).join(" ")); }
    g.font = `${Math.round(fs * 0.8)}px Consolas, monospace`;
    this.stream.forEach((s, i) => { g.fillStyle = css(d.c2, 0.15 + 0.07 * i); g.fillText(s, x0, y + i * fs); });
    // markers: corner brackets, a crosshair, a leader line to the column, a label
    g.lineWidth = Math.max(1, H / 700);
    for (const m of d.markers) {
      const [cx, cy] = toPx(m.x, m.y), r = m.r * H, b = r * 0.3;
      g.strokeStyle = css(d.c1, 0.9);
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = cx + sx * r, py = cy + sy * r;
        g.moveTo(px, py - sy * b); g.lineTo(px, py); g.lineTo(px - sx * b, py);
      }
      g.moveTo(cx - b * 0.6, cy); g.lineTo(cx + b * 0.6, cy); g.moveTo(cx, cy - b * 0.6); g.lineTo(cx, cy + b * 0.6);
      g.stroke();
      const lx = d.side < 0 ? x0 + colW : x0 - fs, ex = cx - Math.sign(cx - lx) * r;
      g.strokeStyle = css(d.c2, 0.5);
      g.beginPath(); g.moveTo(ex, cy - r); g.lineTo(ex + (lx - ex) * 0.25, cy - r - fs); g.lineTo(lx, cy - r - fs); g.stroke();
      g.font = `${Math.round(fs * 0.8)}px Consolas, monospace`;
      g.fillStyle = css(d.c1, 0.85); g.fillText(m.label, cx - r, cy + r + fs * 0.4);
    }
    this.tex.needsUpdate = true;
  }
}

export const DRAFTS = ["glyphs", "dither", "contours"];
export const MASKS = ["full", "element"];

export class DraftPass extends Pass {
  constructor(glyphs) {
    super();
    const c = () => ({ value: new THREE.Color() });
    this.uniforms = {
      tDiffuse: { value: null }, tElem: { value: null }, uGlyph: { value: glyphs.tex }, uGlyphN: { value: glyphs.n },
      uAmt: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uHats: { value: 0 }, uAspect: { value: innerWidth / innerHeight },
      uElem: { value: 0 }, uMask: { value: 0 }, uGrid: { value: 1 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uC0: c(), uC1: c(), uC2: c(), uC3: c(),
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tElem, uGlyph;
        uniform float uAmt, uMode, uGlyphN, uTime, uHats, uAspect, uElem, uGrid;
        uniform vec2 uRes;
        uniform vec3 uC0, uC1, uC2, uC3;
        varying vec2 vUv;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gauss(float x, float w) { float e = x / w; return exp(-e * e); }
        float luma(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
        // what the look is made from: the whole picture, or only the elements (drawn into their own layer)
        vec3 S(vec2 uv) { return mix(texture2D(tDiffuse, uv).rgb, texture2D(tElem, uv).rgb, uElem); }   // (no branch: fast to compile)
        void main() {
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          vec4 E = texture2D(tElem, vUv) * uElem;
          float m = mix(1.0, clamp(max(E.a, luma(E.rgb) * 4.0), 0.0, 1.0), uElem);   // where the elements are
          vec3 d;
          if (uMode < 0.5) {                                          // glyphs: ASCII by brightness
            vec2 cells = vec2(floor(46.0 * uAspect), 46.0);
            vec2 ci = floor(vUv * cells), cf = fract(vUv * cells), cu = (ci + 0.5) / cells;
            vec3 src = 0.5 * S(cu) + 0.25 * (S(cu + vec2(0.3, 0.0) / cells) + S(cu - vec2(0.3, 0.0) / cells));
            float L = clamp(luma(src) * 2.2, 0.0, 1.0);
            L = L * (1.0 - 0.3 * L);                                    // (bright areas: open symbols, not solid blocks)
            float rain = gauss(fract(cu.y + h2(vec2(ci.x, 7.0)) + uTime * (0.08 + 0.1 * h2(vec2(ci.x, 3.0)))) - 0.5, 0.05);
            float g = floor(clamp(L + 0.25 * rain * step(0.04, L), 0.0, 0.999) * uGlyphN);
            if (L > 0.08 && h2(ci + floor(uTime * 10.0)) > 1.0 - 0.06 * uHats) g = floor(h2(ci * 1.7 + uTime) * uGlyphN);
            float gm = texture2D(uGlyph, vec2((g + cf.x) / uGlyphN, cf.y)).r;
            vec3 tint = src / max(max(src.r, max(src.g, src.b)), 0.05);
            d = tint * gm * (0.4 + 1.1 * L) + uC1 * rain * gm * 0.35 * step(0.04, L);
          } else if (uMode < 1.5) {                                   // 1-bit dither, two colours
            float px = max(2.0, floor(uRes.y / 300.0));
            vec2 q = floor(vUv * uRes / px);
            vec3 src = S((q + 0.5) * px / uRes);
            float L = clamp((luma(src) - 0.04) * 1.8, 0.0, 1.0);
            if (uElem > 0.5) L = max(L, 0.12 * m);                     // (her dark body still gets a few dots)
            d = mix(uC0 * 0.06, mix(uC1, uC3, vUv.y), step(bayer8(q) + 0.5 / 64.0, L));
          } else {                                                    // contour lines (+ a blueprint grid on the whole wall)
            vec2 o = 1.5 / uRes;
            float L = luma(S(vUv) + S(vUv + vec2(o.x, 0.0)) + S(vUv - vec2(o.x, 0.0)) + S(vUv + vec2(0.0, o.y)) + S(vUv - vec2(0.0, o.y))) * 0.2;
            if (uElem > 0.5) L = max(L, 0.03 * m);                     // (her outline always shows)
            float k = L * 16.0 - uTime * 0.15;
            float fw = fwidth(k) * 1.2 + 1e-4, f = abs(fract(k) - 0.5);
            float line = smoothstep(0.5 - fw, 0.5, f) * step(0.015, L);
            vec2 gp = vUv * vec2(uAspect, 1.0) * 24.0;
            vec2 gw = fwidth(gp) * 0.8;
            vec2 gq = smoothstep(vec2(0.5) - gw, vec2(0.5), abs(fract(gp) - 0.5));
            float grid = max(gq.x, gq.y) * uGrid * (1.0 - uElem);
            float edge = uElem > 0.5 ? gauss(m - 0.5, 0.25) * 0.8 : 0.0;   // the element's silhouette as a line
            d = mix(uC2, uC3, clamp(L * 1.5, 0.0, 1.0)) * line * (0.5 + L) + uC1 * (grid * 0.07 + edge) + S(vUv) * 0.12;
          }
          // the elements: drafted where they are (fading in from their plain look); the rest of the wall stays as it is
          vec3 outc = uElem > 0.5 ? mix(col, mix(E.rgb, d, uAmt), m) : mix(col, d, uAmt);
          gl_FragColor = vec4(outc, 1.0);
        }`,
    }));
  }
  setColors(c0, c1, c2, c3) { const u = this.uniforms; u.uC0.value.copy(c0); u.uC1.value.copy(c1); u.uC2.value.copy(c2); u.uC3.value.copy(c3); }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  setSize(w, h) { this.uniforms.uAspect.value = w / h; this.uniforms.uRes.value.set(w, h); }
}
