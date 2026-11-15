// Wall particles (projector): a flowing swarm and bursts from the cube. All on the GPU and stateless: each particle
// lives a few seconds, is born somewhere new each life, and its path is integrated in the vertex shader through a
// curl-noise flow (like streamlines / flow engraving), so nothing is simulated on the CPU.
//   flow   - ~24k points drifting along the field; the bass speeds it up, breakdowns swirl it into the portal,
//            a drop's shockwave blows it outwards from the centre, the hats make points twinkle
//   bursts - 8 slots x 500 sparks fountaining up out of the cube (not used on the wall any more)
//   forms  - in the swarm scene, on phrases the swarm gathers into a figure (flower of life, golden spiral,
//            hexagram, circle chain), holds it for a few bars, then lets it go back into the flow
//   network- ~140 drifting nodes linked to their neighbours by thin lines (proximity links, after GEOMETRIC)
// Wall coordinates as in the portal shader: units of the picture's height, centred (x +-aspect/2, y +-0.5).
import * as THREE from "three";
import { classic } from "./tesseract.js";

const FLOW = 18000, SLOTS = 8, PER_SLOT = 500, NODES = 140, MAXSEG = 700, LINK = 0.13;

const COMMON = /* glsl */ `
uniform float uAspect, uPx;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(dot(i, vec2(1.0, 57.0))), b = hash(dot(i + vec2(1, 0), vec2(1.0, 57.0)));
  float c = hash(dot(i + vec2(0, 1), vec2(1.0, 57.0))), d = hash(dot(i + vec2(1, 1), vec2(1.0, 57.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pot(vec2 p, float t) { return n2(p + vec2(t, -t * 0.7)) + 0.5 * n2(p * 2.1 - vec2(t * 0.6, 0.0)); }
vec2 grad(vec2 p, float t) {
  const float e = 0.02;
  return vec2(pot(p + vec2(e, 0.0), t) - pot(p - vec2(e, 0.0), t), pot(p + vec2(0.0, e), t) - pot(p - vec2(0.0, e), t)) / (2.0 * e);
}
vec2 curl(vec2 p, float t) { vec2 g = grad(p, t); return vec2(g.y, -g.x); }   // divergence-free flow from a noise potential
const float TAU = 6.2831853;
vec4 toClip(vec2 p) { return vec4(p.x / (uAspect * 0.5), p.y / 0.5, 0.0, 1.0); }`;

const FLOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uLevel, uSwirl, uShock, uKick, uHats, uScale, uForm, uFormKind, uFormRot;
uniform vec2 uCenter, uShockC, uFormC;
uniform vec2 uTV[16];                              // the tesseract's corners, turned + projected (for the figure)
uniform vec3 uC0, uC1, uC2, uC3;
varying vec3 vCol;
${COMMON}
// a point of a figure (u: where along it, v: a little thickness); about +-0.4 in size
vec2 figure(float k, float u, float v) {
  float j = (v - 0.5) * 0.008;
  if (k > 3.5) {                                   // the tesseract: its 32 edges (corners differing in one bit)
    int e = min(int(u * 32.0), 31), dm = e / 8, kk = e - dm * 8;
    int lo = kk & ((1 << dm) - 1), a = ((kk >> dm) << (dm + 1)) | lo, b = a | (1 << dm);
    return mix(uTV[a], uTV[b], fract(u * 32.0)) + vec2(j);
  }
  if (k < 0.5) {                                   // flower of life: 7 circles + the outer circle
    float n = floor(u * 8.0), a = fract(u * 8.0) * TAU, r = 0.13;
    vec2 c = n > 0.5 && n < 6.5 ? vec2(cos(n * TAU / 6.0), sin(n * TAU / 6.0)) * r : vec2(0.0);
    return c + vec2(cos(a), sin(a)) * ((n > 6.5 ? 2.0 * r : r) + j);
  }
  if (k < 1.5) {                                   // golden spiral, two arms
    float t = fract(u * 2.0) * 3.0 * 3.14159, arm = step(0.5, u) * 3.14159;
    float r = 0.02 * exp(0.3063 * t) + j;
    return vec2(cos(t + arm), sin(t + arm)) * r;
  }
  if (k < 2.5) {                                   // hexagram in a circle
    float n = floor(u * 7.0), t = fract(u * 7.0);
    if (n > 5.5) return vec2(cos(t * TAU), sin(t * TAU)) * (0.36 + j);
    float tri = step(2.5, n), e = mod(n, 3.0), R = 0.33 + j;
    float a0 = 1.5708 + tri * 3.14159 + e * TAU / 3.0, a1 = a0 + TAU / 3.0;
    return mix(vec2(cos(a0), sin(a0)), vec2(cos(a1), sin(a1)), t) * R;
  }
  float n = floor(u * 7.0), a = fract(u * 7.0) * TAU;   // a circle chain: tangent circles, shrinking, turning
  vec2 c = vec2(-0.12, 0.0); float r = 0.15, b = 0.0;
  for (int i = 0; i < 7; i++) {
    if (float(i) >= n) break;
    float rn = r * 0.74; b += 1.05; c += vec2(cos(b), sin(b)) * (r + rn); r = rn;
  }
  return c + vec2(cos(a), sin(a)) * (r + j);
}
void main() {
  float L = 3.0 + 4.0 * aSeed.y;                   // a life: 3..7 s (of flow time)
  float u = uTime / L + aSeed.x;
  float age = fract(u), cyc = floor(u);
  vec2 p = (vec2(hash(aSeed.z * 91.7 + cyc * 3.1), hash(aSeed.w * 53.3 + cyc * 7.9)) - 0.5) * vec2(uAspect * 1.15, 1.15);
  float t0 = uTime - age * L, h;
  h = age * L / 8.0;
  for (int i = 0; i < 8; i++) {                    // its path so far: along the field's lines and down into its valleys
    float ti = t0 + float(i) * h;                  // (so the swarm gathers into streams instead of staying even)
    vec2 g = grad(p * uScale, ti * 0.05);
    vec2 v = vec2(g.y, -g.x) * 0.06 - g * 0.085;
    vec2 r = p - uCenter;
    float d = length(r) + 0.08;
    v += uSwirl * (vec2(-r.y, r.x) / d * 0.07 - r / d * 0.025);   // breakdowns: a slow whirl into the portal
    p += v * h;
  }
  vec2 r = p - uShockC;                            // the drop: blown outwards, the nearest the most
  p += normalize(r + 1e-4) * uShock * (0.12 + 0.25 * aSeed.w) * exp(-length(r) * 1.2);
  float fade = sin(3.14159 * age);
  float tw = step(1.0 - 0.35 * uHats, hash(aSeed.z * 13.0 + floor(uTime * 14.0)));   // hats: twinkles
  vec3 c = aSeed.z < 0.33 ? uC1 : aSeed.z < 0.66 ? uC2 : uC3;
  float gather = smoothstep(0.1, 0.6, age);       // dim while scattered, brighter once in a stream
  float w = uForm * smoothstep(0.0, 0.35, uForm - aSeed.y * 0.5 + 0.35);   // the figure: some arrive earlier
  if (w > 0.001) {
    float cr = cos(uFormRot), sr = sin(uFormRot);
    vec2 f = mat2(cr, -sr, sr, cr) * figure(uFormKind, aSeed.z, aSeed.w) * (1.0 + 0.05 * uKick) + uFormC;
    p = mix(p, f, w);
    fade = mix(fade, 1.0, w * 0.8); gather = mix(gather, 0.45, w);   // (all of them on one line: less each)
  }
  vCol = mix(c, vec3(1.0), 0.25 * tw) * fade * (0.06 + 0.6 * gather + 0.3 * uKick + 0.9 * tw) * uLevel;
  gl_PointSize = (1.0 + 1.2 * aSeed.y + 1.5 * tw) * uPx / 720.0;
  gl_Position = toClip(p);
}`;

const BURST_VERT = /* glsl */ `
attribute vec4 aSeed;                              // x: slot, y..w: random
uniform vec4 uBurst[${SLOTS}];                    // x, y (the cube), age 0..1, strength
uniform float uTime;
uniform vec3 uC1, uC2, uC3;
varying vec3 vCol;
${COMMON}
void main() {
  vec4 B = uBurst[int(aSeed.x + 0.5)];
  float age = B.z;
  float a = (aSeed.y - 0.5) * 2.4;                 // a fountain: mostly upwards, out of the cube
  vec2 dir = vec2(sin(a), cos(a));
  float spd = 0.25 + 0.6 * aSeed.z * aSeed.z;
  vec2 p = B.xy + dir * spd * (1.0 - exp(-age * 3.5)) * 0.55;
  p += curl(p * 2.0, uTime * 0.1 + aSeed.w) * 0.02 * age;
  p.y -= 0.06 * age * age;                         // they slow and sink a little at the end
  float life = 1.0 - smoothstep(0.35 + 0.6 * aSeed.w, 1.0, age);
  vec3 c = aSeed.w < 0.33 ? uC1 : aSeed.w < 0.66 ? uC2 : uC3;
  vCol = mix(c, vec3(1.0), 0.35 * (1.0 - age)) * life * B.w * (age < 1.0 ? 1.0 : 0.0);
  gl_PointSize = (1.5 + 2.5 * aSeed.z) * (1.0 - 0.5 * age) * uPx / 720.0;
  gl_Position = toClip(p);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.1, 0.5, length(c));
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

function points(n, seed, vert, uniforms) {
  const g = new THREE.BufferGeometry();
  const s = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) seed(s, i);
  g.setAttribute("aSeed", new THREE.BufferAttribute(s, 4));
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // (unused: placed in the shader)
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: FRAG, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 20;
  return p;
}

export class WallParticles {
  constructor() {
    const col = () => ({ value: new THREE.Color() });
    this.uniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uSwirl: { value: 0 }, uShock: { value: 0 }, uKick: { value: 0 },
      uHats: { value: 0 }, uScale: { value: 1.15 }, uAspect: { value: innerWidth / innerHeight }, uPx: { value: innerHeight },
      uCenter: { value: new THREE.Vector2() }, uShockC: { value: new THREE.Vector2() },
      uC0: col(), uC1: col(), uC2: col(), uC3: col(),
      uBurst: { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, 1, 0)) },
      uForm: { value: 0 }, uFormKind: { value: 0 }, uFormRot: { value: 0 }, uFormC: { value: new THREE.Vector2() },
      uTV: { value: Array.from({ length: 16 }, () => new THREE.Vector2()) },
    };
    this.formAt = -1e9; this.formAllowed = false;
    this.group = new THREE.Group();
    this.flow = points(FLOW, (s, i) => s.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4), FLOW_VERT, this.uniforms);
    this.bursts = points(SLOTS * PER_SLOT, (s, i) => s.set([Math.floor(i / PER_SLOT), Math.random(), Math.random(), Math.random()], i * 4),
      BURST_VERT, this.uniforms);
    this.group.add(this.flow, this.bursts);
    // the network: nodes drifting on the CPU, a line to each neighbour closer than LINK
    this.nodes = Array.from({ length: NODES }, () => ({ x: (Math.random() - 0.5) * 2, y: Math.random() - 0.5, s: Math.random() }));
    const lg = new THREE.BufferGeometry();
    this.linePos = new Float32Array(MAXSEG * 6); this.lineCol = new Float32Array(MAXSEG * 6);
    lg.setAttribute("position", new THREE.BufferAttribute(this.linePos, 3));
    lg.setAttribute("aCol", new THREE.BufferAttribute(this.lineCol, 3));
    const flat = { transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false };   // positions = clip space
    this.lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ ...flat,
      vertexShader: "attribute vec3 aCol; varying vec3 vC; void main() { vC = aCol; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }" }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 19;
    const ng = new THREE.BufferGeometry();
    this.nodePos = new Float32Array(NODES * 3);
    ng.setAttribute("position", new THREE.BufferAttribute(this.nodePos, 3));
    this.nodeMat = new THREE.ShaderMaterial({ ...flat, uniforms: { uCol: { value: new THREE.Color() }, uSize: { value: 3 } },
      vertexShader: "uniform float uSize; void main() { gl_PointSize = uSize; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform vec3 uCol; void main() { float a = 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(uCol * a, 1.0); }" });
    this.nodePts = new THREE.Points(ng, this.nodeMat);
    this.nodePts.frustumCulled = false; this.nodePts.renderOrder = 19;
    this.group.add(this.lines, this.nodePts);
    this.netLevel = 0;
    this.flowTime = Math.random() * 100;
    this.shock = 0;
    this.slots = Array.from({ length: SLOTS }, () => ({ x: 0, y: 0, age: 1, s: 0, dur: 1.6 }));
  }

  // sparks out of the cube (x, y in wall units)
  burst(x, y, strength = 1) {
    const r = this.slots.reduce((a, b) => (b.age > a.age ? b : a));
    Object.assign(r, { x, y, age: 0, s: strength, dur: 1.3 + 0.8 * Math.random() });
  }

  // a phrase: the swarm gathers into a new figure (only in the swarm scene); it builds over a bar, holds ~5 bars
  form(beat) {
    if (!this.formAllowed || Math.random() > 0.75) return;
    const u = this.uniforms;
    let k = 0 | Math.random() * 5;                      // flower, spiral, hexagram, circle chain, tesseract
    if (k === u.uFormKind.value) k = (k + 1) % 5;
    u.uFormKind.value = k;
    this.formAt = beat;
    u.uFormC.value.copy(u.uCenter.value).multiplyScalar(0.5);
  }
  formTick(beat, bps, allowed) {
    this.formAllowed = allowed;
    const b = beat - this.formAt, u = this.uniforms;
    const env = !allowed ? 0 : b < 0 ? 0 : b < 4 ? b / 4 : b < 24 ? 1 : b < 32 ? 1 - (b - 24) / 8 : 0;
    u.uForm.value += (env * env * (3 - 2 * env) - u.uForm.value) * 0.2;
    u.uFormRot.value = beat * 0.02;
  }

  // a drop: the swarm is blown outwards from c
  shockwave(c) { this.shock = 1; this.uniforms.uShockC.value.copy(c); }

  setColors(P, k) {
    const u = this.uniforms;
    u.uC0.value.lerp(new THREE.Color(P.glow), k); u.uC1.value.lerp(new THREE.Color(P.rim), k);
    u.uC2.value.lerp(new THREE.Color(P.accents[0]), k); u.uC3.value.lerp(new THREE.Color(P.accents[1]), k);
  }

  network(dt, a) {
    this.netLevel += ((a.swarm ?? 0) * a.level * (1 - 0.7 * this.uniforms.uForm.value) - this.netLevel) * Math.min(1, dt * 1.5);
    const on = this.netLevel > 0.01;
    this.lines.visible = this.nodePts.visible = on;
    if (!on) return;
    this.netAcc = (this.netAcc ?? 0) + dt;
    if (this.netAcc < 1 / 30) return;                         // (the links: 30 times a second is plenty)
    dt = this.netAcc; this.netAcc = 0;
    const t = this.flowTime, hw = a.aspect / 2, sx = 1 / hw, sy = 2, N = this.nodes, sw = this.uniforms.uSwirl.value;
    for (const n of N) {                                      // a slow drift along a simple field, wrapping round
      n.x += (Math.sin(n.y * 3.1 + t * 0.21 + n.s * 6) * 0.03 - 0.012 * sw * n.y) * dt * a.speed;
      n.y += (Math.cos(n.x * 2.3 - t * 0.17 + n.s * 4) * 0.025 + 0.012 * sw * n.x) * dt * a.speed;
      if (n.x > hw + 0.05) n.x -= 2 * hw + 0.1; else if (n.x < -hw - 0.05) n.x += 2 * hw + 0.1;
      if (n.y > 0.55) n.y -= 1.1; else if (n.y < -0.55) n.y += 1.1;
    }
    const c1 = this.uniforms.uC1.value, c2 = this.uniforms.uC3.value, L = this.netLevel * (0.5 + 0.5 * a.kick);
    let k = 0;
    for (let i = 0; i < N.length; i++) {
      const A = N[i];
      this.nodePos.set([A.x * sx, A.y * sy, 0], i * 3);
      for (let j = i + 1; j < N.length && k < MAXSEG; j++) {
        const B = N[j], dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy;
        if (d2 > LINK * LINK) continue;
        const f = (1 - Math.sqrt(d2) / LINK) * L * 0.6, o = k * 6;
        this.linePos.set([A.x * sx, A.y * sy, 0, B.x * sx, B.y * sy, 0], o);
        this.lineCol.set([c1.r * f, c1.g * f, c1.b * f, c2.r * f, c2.g * f, c2.b * f], o);
        k++;
      }
    }
    this.lines.geometry.setDrawRange(0, k * 2);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.aCol.needsUpdate = true;
    this.nodePts.geometry.attributes.position.needsUpdate = true;
    this.nodeMat.uniforms.uCol.value.copy(c1).multiplyScalar(this.netLevel * 0.8);
    this.nodeMat.uniforms.uSize.value = 3 * a.px / 720;
  }

  // a: { level (the flow), speed, swirl, kick, hats, center (Vector2), aspect, px, swarm (the swarm scene's amount) }
  update(dt, a) {
    const u = this.uniforms;
    this.flowTime += dt * a.speed;                       // flow time: speed changes never jump the paths
    this.shock = Math.max(0, this.shock - dt * 0.9);
    u.uTime.value = this.flowTime;
    u.uLevel.value = a.level;
    u.uSwirl.value += (a.swirl - u.uSwirl.value) * Math.min(1, dt * 0.5);
    u.uShock.value = Math.sin(Math.PI * Math.min(1, (1 - this.shock) * 1.0)) * (this.shock > 0 ? 1 : 0);
    u.uKick.value = a.kick; u.uHats.value = a.hats;
    u.uAspect.value = a.aspect; u.uPx.value = a.px;
    u.uCenter.value.copy(a.center);
    let any = false;
    this.slots.forEach((r, i) => {
      r.age = Math.min(1, r.age + dt / r.dur);
      if (r.age < 1) any = true;
      u.uBurst.value[i].set(r.x, r.y, r.age, r.s);
    });
    this.flow.visible = a.level > 0.005;
    this.bursts.visible = any;
    if (u.uForm.value > 0.001 && u.uFormKind.value === 4) {   // the tesseract figure turns through 4D
      this.hyperA = (this.hyperA ?? 0) + dt * (Math.PI / 2) * (a.bps ?? 2) / 4;   // inner -> outer once a bar
      classic(this.hyperA, this.hyperA * 0.1 + 0.5).forEach((p, i) => u.uTV.value[i].set(p[0] * 0.3, p[1] * 0.3));
    }
    this.network(dt, a);
  }
}
