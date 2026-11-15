// The brain: a real MRI brain (tools/volume/make_mesh.py -> assets/brain/brain.glb) as a hologram object.
// Cortex = the folds (vertex colour R = sulcal depth), white = the white matter inside, seen when the cortex x-rays away.
// Dark by default: only a dim silhouette and a thin rim. The music lights it where it "enters":
//   kick   -> a ring rising from the brainstem          bass  -> waves out of both ears (auditory cortex)
//   lead   -> a front sweeping from the frontal lobe back   pads  -> a slow colour wash over the crowns
//   hats   -> sparks on the gyri crowns                  phrase -> one slow signal crossing the whole brain
// plus breathing folds (bass), an MRI scan line, and a noise dissolve with a glowing edge (appear / leave / x-ray).
// Point cloud: the same cortex as ~130k glowing points (update's 'points' 0..1 dissolves the solid brain into them),
// with signals flowing over the surface, the same pulses and sparks; burst() blows the points outwards (drops).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SPARKS = 10, PULSES = 12;

// pulse kinds: [type 0 = ring from a point / 1 = front along -z, speed m/s, width m, life s, palette colour]
const KINDS = {
  kick: { type: 0, speed: 0.22, width: 0.007, life: 0.6, color: "rim", src: [[0, -0.062, -0.015]] },
  bass: { type: 0, speed: 0.09, width: 0.011, life: 1.1, color: "a0", src: [[0.058, -0.012, 0.004], [-0.058, -0.012, 0.004]] },
  lead: { type: 1, speed: 0.16, width: 0.010, life: 1.1, color: "a1", src: [[0, 0, 0.085]] },
  phrase: { type: 0, speed: 0.06, width: 0.022, life: 3.2, color: "a2", src: [[0.06, -0.012, 0.004]] },
};

const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.03) + 0.15 * noise(p * 4.1); }`;

const VERT = /* glsl */ `
attribute vec4 color;
uniform float uBreath;
varying vec3 vPos;      // brain space, metres (about +-0.08)
varying vec3 vN;        // view space normal
varying vec3 vView;     // view space position
varying float vDepth;   // sulcal depth 0 (crown) .. 1 (deep)
void main() {
  vDepth = color.r;
  vec3 p = position + normal * uBreath * 0.0018 * (1.0 - vDepth);   // the crowns swell with the bass
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uLevel, uXray, uTime, uKick, uPads, uHats, uSweep, uSweepAmt, uBase, uRimAmt, uSolid;
uniform vec4 uClip;      // cut plane (normal, distance): the + side is cut away (the head journey)
uniform vec3 uRim, uRim2, uGlow, uA0, uA1, uA2;
uniform vec4 uSparks[${SPARKS}];
uniform vec4 uP[${PULSES}];      // source xyz, age
uniform vec4 uQ[${PULSES}];      // type, speed, width, life
uniform vec3 uC[${PULSES}];      // colour
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vDepth;
${NOISE}
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  vec3 N = normalize(vN), V = normalize(-vView);
  if (!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0);
  float crown = 1.0 - smoothstep(0.0, 0.7, vDepth);           // 1 on top of the gyri, 0 in the sulci
  float lit = 0.15 + 0.85 * crown;                            // what light lands on: the crowns, not the sulci
  float h = clamp(vPos.y / 0.14 + 0.5, 0.0, 1.0);             // bottom -> top

  // dissolve: appear / leave (uLevel) and x-ray (uXray); a glowing edge where it eats in
  float n = fbm(vPos * 55.0 + vec3(0.0, uTime * 0.05, 0.0));
  float cut = (1.0 - uLevel * uSolid) * 1.05 + uXray * 0.75;   // (uSolid < 1: it dissolves into the point cloud)
  if (n < cut) discard;
  float edge = 1.0 - smoothstep(0.0, 0.05, n - cut);

  // the dark body: a dim silhouette, thin rim (brighter on the kick)
  vec3 col = uGlow * uBase * (0.2 + 0.8 * crown) * (0.3 + 0.7 * ndv);
  col += mix(uRim, uRim2, h) * fres * uRimAmt * (0.35 + 0.65 * uKick) * (0.4 + 0.6 * crown);
  // pads: a slow wash drifting over the crowns
  float f = fbm(vPos * 28.0 + vec3(0.0, uTime * 0.12, uTime * 0.05));
  col += mix(uA1, uA2, f) * smoothstep(0.45, 0.85, f) * uPads * 0.45 * crown;
  // the music's pulses, each from its own place
  for (int i = 0; i < ${PULSES}; i++) {
    vec4 P = uP[i], Q = uQ[i];
    if (P.w >= Q.w) continue;
    float a = 1.0 - P.w / Q.w;
    float d = Q.x < 0.5 ? distance(vPos, P.xyz) : P.z - vPos.z;
    float front = P.w * Q.y;
    float e = (d - front) / Q.z;                                 // (x*x, not pow: pow of a negative = NaN)
    float g = exp(-e * e) + 0.35 * step(d, front) * exp(-(front - d) * 40.0);   // front + wake
    if (Q.x > 0.5) g *= smoothstep(-0.035, 0.0, vPos.y);     // the lead runs over the cerebrum only
    col += uC[i] * g * a * a * lit * 1.6;
  }
  // hats: sparks - a hot core and a small ring on the crowns
  for (int i = 0; i < ${SPARKS}; i++) {
    vec4 s = uSparks[i];
    if (s.w >= 1.0) continue;
    float r = distance(vPos, s.xyz), ring = s.w * 0.035, a = 1.0 - s.w;
    float e = (r - ring) / 0.003;
    float g = exp(-e * e) * a + exp(-r * r / 0.00003) * a * a * 1.5;
    col += mix(uA2, vec3(1.0), 0.3) * g * crown * (0.5 + 0.5 * uHats);
  }
  // scan line (MRI slice) sweeping top -> bottom, with a faint afterglow above it
  float d = vPos.y - uSweep;
  col += uA2 * uSweepAmt * (exp(-d * d / 0.000012) * 1.6 + 0.2 * smoothstep(0.0, 0.03, d) * exp(-d * 25.0));
  col += mix(uRim, uA0, 0.5) * edge * 1.4;
  gl_FragColor = vec4(col, 1.0);
}`;

// the point cloud: one point per cortex vertex
const PTS_VERT = /* glsl */ `
attribute vec4 color;
uniform float uPtsLevel, uScatter, uTime, uKick, uHats, uPx, uSize, uFlow;
uniform vec3 uRim, uRim2, uA0, uA1, uA2;
uniform vec4 uSparks[${SPARKS}];
uniform vec4 uP[${PULSES}];
uniform vec4 uQ[${PULSES}];
uniform vec3 uC[${PULSES}];
varying vec3 vPos; varying vec3 vCol;
${NOISE}
void main() {
  vPos = position;
  float crown = 1.0 - smoothstep(0.0, 0.7, color.r);
  float rnd = hash(position * 997.0);
  // a drop blows the points out (along the surface normal, a little noise), then they fall back in
  vec3 nz = vec3(noise(position * 60.0 + 3.1), noise(position * 60.0 + 7.7), noise(position * 60.0 + 1.3)) - 0.5;
  vec3 p = position + (normal * (0.015 + 0.05 * rnd) + nz * 0.04) * uScatter;
  // signals flowing over the surface: bright contour lines of a slowly moving noise field
  float f = fbm(position * 26.0 + vec3(0.0, uTime * 0.04, 0.0));
  float e = (fract(f * 5.0 - uTime * 0.22 * uFlow) - 0.5) / 0.06;
  float flow = exp(-e * e) * (0.35 + 0.65 * crown);
  float b = 0.05 + 0.15 * crown + 0.9 * flow;
  vec3 col = mix(uRim, uA1, crown) * (0.04 + 0.12 * crown) + mix(uA1, uA2, f) * flow * 0.9;
  for (int i = 0; i < ${PULSES}; i++) {
    vec4 P = uP[i], Q = uQ[i];
    if (P.w >= Q.w) continue;
    float a = 1.0 - P.w / Q.w;
    float d = Q.x < 0.5 ? distance(position, P.xyz) : P.z - position.z;
    float k = (d - P.w * Q.y) / (Q.z * 1.4);
    float g = exp(-k * k) * a * a;
    col += uC[i] * g * 1.6; b += g * 1.5;
  }
  for (int i = 0; i < ${SPARKS}; i++) {
    vec4 s = uSparks[i];
    if (s.w >= 1.0) continue;
    float r = distance(position, s.xyz), ring = s.w * 0.04;
    float k = (r - ring) / 0.004;
    float g = exp(-k * k) * (1.0 - s.w) * (0.6 + 0.4 * uHats);
    col += mix(uA2, vec3(1.0), 0.4) * g * 1.4; b += g;
  }
  col *= (0.75 + 0.5 * uKick) * (1.0 - 0.5 * uScatter) * uPtsLevel * 0.45;   // (dim: thousands add up, + bloom)
  vCol = col;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sc = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);   // the brain's scale (it is drawn at many sizes)
  gl_PointSize = clamp(uSize * sc * (0.6 + 0.6 * min(b, 1.5) + 0.4 * rnd) * projectionMatrix[1][1] * uPx * 0.5 / -mv.z, 1.0, 3.5);
  gl_Position = projectionMatrix * mv;
}`;
const PTS_FRAG = /* glsl */ `
uniform vec4 uClip;
varying vec3 vPos; varying vec3 vCol;
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.15, 0.5, length(c));
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

// white matter: a soft inner glow, only really seen when the cortex x-rays away
const WHITE_FRAG = /* glsl */ `
uniform float uLevel, uXray, uTime, uKick, uSolid;
uniform vec4 uClip;
uniform vec3 uRim, uA1, uA2;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vDepth;
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  vec3 N = normalize(vN), V = normalize(-vView);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.6);
  float pulse = 0.5 + 0.5 * sin(vPos.y * 90.0 - uTime * 3.0);
  vec3 col = mix(uA1, uA2, pulse) * (0.15 + 0.85 * fres) + uRim * fres * uKick * 0.6;
  gl_FragColor = vec4(col * uLevel * uXray * uSolid * 0.7, 1.0);
}`;

export class Brain {
  static async load(url = "assets/brain/brain.glb") {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Brain(gltf.scene);
  }

  constructor(model) {
    const v4 = (n, w) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, w));
    this.uniforms = {
      uLevel: { value: 0 }, uXray: { value: 0 }, uTime: { value: 0 }, uKick: { value: 0 }, uBreath: { value: 0 },
      uPads: { value: 0 }, uHats: { value: 0 }, uSweep: { value: 1 }, uSweepAmt: { value: 0 },
      uSolid: { value: 1 }, uPtsLevel: { value: 0 }, uScatter: { value: 0 }, uPx: { value: 1080 }, uSize: { value: 0.0007 },
      uFlow: { value: 1 },
      uBase: { value: 0.5 }, uRimAmt: { value: 0.5 }, uClip: { value: new THREE.Vector4(0, 0, 1, 10) },        // how bright the body and the rim are at rest
      uRim: { value: new THREE.Color("#ffc94d") }, uRim2: { value: new THREE.Color("#ff5fa2") }, uGlow: { value: new THREE.Color("#30245a") },
      uA0: { value: new THREE.Color("#ff5fa2") }, uA1: { value: new THREE.Color("#4fd8ff") }, uA2: { value: new THREE.Color("#ffb347") },
      uSparks: { value: v4(SPARKS, 1) },
      uP: { value: v4(PULSES, 1) }, uQ: { value: v4(PULSES, 0) },
      uC: { value: Array.from({ length: PULSES }, () => new THREE.Color()) },
    };
    // "transparent" only so it draws after the dancer (needed inside her head); it writes depth and is fully opaque
    this.cortexMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.DoubleSide, transparent: true, depthWrite: true });
    this.whiteMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: WHITE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.root = new THREE.Group();          // placed by the show (scene centre or inside her head)
    this.spinner = new THREE.Group();       // own slow rotation
    this.root.add(this.spinner);
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();   // the GLB has none
      const white = /white/i.test(o.name) || /white/i.test(o.parent?.name || "");
      o.material = white ? this.whiteMat : this.cortexMat;
      o.renderOrder = white ? 6 : 5;
      o.frustumCulled = false;
      if (!white) this.cortex = o;
      else this.white = o;
    });
    this.spinner.add(model);
    // the point cloud: the cortex's own vertices (same geometry, drawn as glowing points, added on top)
    this.pointsMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PTS_VERT, fragmentShader: PTS_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(Brain.thin(this.cortex.geometry, 3), this.pointsMat);   // every 3rd vertex (~43k)
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.cortex.parent.add(this.points);
    // a depth-only copy of the cortex, a little inside the surface: hides the points on the far side of the brain
    this.occluder = new THREE.Mesh(this.cortex.geometry, new THREE.ShaderMaterial({
      uniforms: this.uniforms, colorWrite: false, side: THREE.FrontSide,
      vertexShader: `uniform float uScatter; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position - normal * (0.0025 + 0.03 * uScatter), 1.0); }`,
      fragmentShader: `void main() { gl_FragColor = vec4(0.0); }` }));
    this.occluder.renderOrder = 6;
    this.occluder.frustumCulled = false;
    this.occluder.visible = false;
    this.cortex.parent.add(this.occluder);
    this.occluder.position.copy(this.cortex.position); this.occluder.quaternion.copy(this.cortex.quaternion);
    this.occluder.scale.copy(this.cortex.scale);
    this.points.position.copy(this.cortex.position); this.points.quaternion.copy(this.cortex.quaternion);
    this.points.scale.copy(this.cortex.scale);
    this.ptsMix = 0;            // 0 = the solid brain, 1 = the point cloud
    this.scatter = 0;
    const box = new THREE.Box3().setFromObject(model);
    this.size = box.getSize(new THREE.Vector3());                  // metres, real size (~0.14 x 0.14 x 0.16)
    this.root.visible = false;
    this.level = 0;
    this.sparkNext = 0;
    this.pulseNext = 0;
    this.spinSpeed = 0.12;
    this._clearDepth = false;
    // inside her head the brain must draw over the head: clear the depth once before the cortex draws
    this.cortex.onBeforeRender = (r) => { if (this._clearDepth) r.clearDepth(); };
  }

  // a spark (hats) at a random point on the cortex, preferring the crowns
  spark() {
    const pos = this.cortex.geometry.attributes.position, dep = this.cortex.geometry.attributes.color;
    let i = (Math.random() * pos.count) | 0;
    for (let k = 0; k < 4 && dep && dep.getX(i) > 0.3; k++) i = (Math.random() * pos.count) | 0;
    this.uniforms.uSparks.value[this.sparkNext].set(pos.getX(i), pos.getY(i), pos.getZ(i), 0);
    this.sparkNext = (this.sparkNext + 1) % SPARKS;
  }

  // a pulse of one musical element from its place in the brain (see KINDS); strength scales the brightness
  pulse(kind, strength = 1) {
    const K = KINDS[kind];
    if (!K) return;
    const u = this.uniforms;
    const color = { rim: u.uRim, a0: u.uA0, a1: u.uA1, a2: u.uA2 }[K.color].value;
    const srcs = kind === "phrase" ? [K.src[0].map((v, j) => (j === 0 && Math.random() < 0.5 ? -v : v))] : K.src;
    for (const src of srcs) {
      const i = this.pulseNext;
      this.pulseNext = (i + 1) % PULSES;
      u.uP.value[i].set(src[0], src[1], src[2], 0);
      u.uQ.value[i].set(K.type, K.speed, K.width, K.life);
      u.uC.value[i].copy(color).multiplyScalar(strength);
    }
  }

  // a copy of a geometry with every n-th vertex (position, normal, colour) for the point cloud
  static thin(geo, n) {
    const out = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "color"]) {
      const a = geo.attributes[name];
      if (!a) continue;
      const k = a.itemSize, src = a.array, m = Math.floor(a.count / n), dst = new Float32Array(m * k);
      for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) dst[i * k + j] = a.normalized ? a.getComponent(i * n, j) : src[i * n * k + j];
      out.setAttribute(name, new THREE.BufferAttribute(dst, k));
    }
    return out;
  }

  // a drop: the points blow outwards and fall back in (and sparks all over)
  burst(strength = 1) {
    this.scatter = Math.max(this.scatter, strength);
    for (let i = 0; i < 6; i++) this.spark();
  }

  setColors(P, k) {
    const u = this.uniforms;
    u.uRim.value.lerp(new THREE.Color(P.rim), k);
    u.uRim2.value.lerp(new THREE.Color(P.rim2), k);
    u.uGlow.value.lerp(new THREE.Color(P.glow), k);
    [u.uA0, u.uA1, u.uA2].forEach((a, i) => a.value.lerp(new THREE.Color(P.accents[i]), k));
  }

  // a: { level 0..1, xray 0..1, kick, mid, bass, pads, hats, sweep (-1 = none, 0..1 = top..bottom), inHead,
  //      fixed (someone else turns it: the head journey), points 0..1 (the point cloud), px (the drawing height in pixels) }
  update(dt, t, a) {
    const u = this.uniforms;
    this.level = a.level;
    this.root.visible = a.level > 0.002;
    this.ptsMix += ((a.points ?? 0) - this.ptsMix) * Math.min(1, dt * 0.8);   // the dissolve takes ~2 s
    this.scatter = Math.max(0, this.scatter - dt * 0.7);
    u.uSolid.value = Math.min(1, 1.15 * (1 - this.ptsMix));
    u.uPtsLevel.value = a.level * Math.min(1, this.ptsMix * 1.6);
    u.uScatter.value = this.scatter * this.scatter * (3 - 2 * this.scatter);
    if (a.px) u.uPx.value = a.px;
    u.uFlow.value = 0.6 + 1.2 * (a.mid ?? 0.4);
    this.points.visible = this.root.visible && u.uPtsLevel.value > 0.003;
    this.occluder.visible = this.points.visible && u.uScatter.value < 0.6 && !a.inHead;   // (blown apart: all of them)
    this.cortex.visible = u.uSolid.value > 0.001;
    if (this.white) this.white.visible = this.cortex.visible;
    for (const p of u.uP.value) p.w += dt;
    for (const s of u.uSparks.value) if (s.w < 1) s.w = Math.min(1, s.w + dt / 0.5);
    if (!this.root.visible) return;
    u.uLevel.value = a.level;
    u.uXray.value = a.xray;
    u.uTime.value = t;
    u.uKick.value = a.kick;
    u.uBreath.value = a.bass ?? 0;
    u.uPads.value = a.pads ?? 0;
    u.uHats.value = a.hats ?? 0;
    const top = this.size.y * 0.55;
    u.uSweepAmt.value = a.sweep >= 0 ? 1 : 0;
    if (a.sweep >= 0) u.uSweep.value = top - a.sweep * 2 * top;
    if (!a.inHead && !a.fixed) {                           // inside her head it turns with her head only
      this.spinner.rotation.y += dt * this.spinSpeed * (1 + 1.5 * (a.mid ?? 0));
      this.spinner.rotation.x = 0.12 * Math.sin(t * 0.21);
    }
    this._clearDepth = !!a.inHead;
  }
}
