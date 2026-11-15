// The head from the MRI (tools/volume/make_head.py -> assets/brain/head.glb + head_volume.bin/.json), in the brain's frame.
// Parts, all sharing one set of uniforms:
//   skin   - the head surface: dark shaded body + rim; a scanner band passes over it and briefly shows the MRI
//            tissue under the skin; "ghost" leaves only the rim silhouette around whatever is inside
//   shell  - the same surface pushed ~8 mm inwards: the skull layer for the onion peel
//   cap    - the cut face: the real MRI section on the cut plane (3D texture), tissue colours + anatomy edges
//   ortho  - three planes at once (sagittal, axial, coronal) crossing at a point that steps with the music
//   slices - a stack of ~20 real MRI slices through the brain, drawn as glowing outlines; one active slice in colour
// The cut plane (uClip: normal, distance) removes everything on its + side; the brain shader honours it too.
// Medical data with a face: these assets stay local, never in a repo or a published page.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const NSLICES = 20;

const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.03) + 0.15 * noise(p * 4.1); }`;

// MRI at a point of the head frame -> tissue colour, plus the anatomy edges (intensity gradient) and the outline of
// what is kept (head, or only the brain). Brain tissue in the accents, the rest (scalp, muscle, fat) in the rim colours.
const TRANSFER = /* glsl */ `
uniform highp sampler3D uVol;
uniform vec3 uVolMin, uVolSize, uRim, uRim2, uGlow, uA0, uA1, uA2;
uniform float uBrainOnly;
vec3 mri(vec3 p, out float keep, out float edge, out float outline) {
  vec3 tc = (p - uVolMin) / uVolSize;
  keep = 0.0; edge = 0.0; outline = 0.0;
  if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) return vec3(0.0);
  vec2 s = texture(uVol, tc).rg;
  float isBrain = step(0.75, s.g), isHead = step(0.25, s.g);
  keep = isHead * mix(1.0, isBrain, uBrainOnly);
  vec3 e = 1.2 / vec3(textureSize(uVol, 0));
  vec2 x1 = texture(uVol, tc + vec3(e.x, 0, 0)).rg, x0 = texture(uVol, tc - vec3(e.x, 0, 0)).rg;
  vec2 y1 = texture(uVol, tc + vec3(0, e.y, 0)).rg, y0 = texture(uVol, tc - vec3(0, e.y, 0)).rg;
  vec2 z1 = texture(uVol, tc + vec3(0, 0, e.z)).rg, z0 = texture(uVol, tc - vec3(0, 0, e.z)).rg;
  edge = smoothstep(0.1, 0.35, length(vec3(x1.r - x0.r, y1.r - y0.r, z1.r - z0.r)));
  // outline of the kept region: where the label changes (brain border, or the skin when the whole head is kept)
  float lvl = uBrainOnly > 0.5 ? 0.75 : 0.25;
  float k = step(lvl, x1.g) + step(lvl, x0.g) + step(lvl, y1.g) + step(lvl, y0.g) + step(lvl, z1.g) + step(lvl, z0.g);
  outline = 1.0 - smoothstep(4.5, 6.0, k);
  float v = s.r;
  vec3 tissue = isBrain > 0.5
    ? mix(uGlow * 1.5, uA1, smoothstep(0.35, 0.6, v)) + uA0 * smoothstep(0.62, 0.85, v)      // grey -> white matter
    : mix(uGlow, uRim2, smoothstep(0.2, 0.55, v)) + uRim * smoothstep(0.6, 0.95, v) * 0.7;   // muscle -> fat/skin
  return tissue * smoothstep(0.05, 0.25, v);
}`;

const SKIN_VERT = /* glsl */ `
uniform float uInset;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vLN;
void main() {
  vec3 p = position - normal * uInset;
  vPos = p;
  vLN = normal;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

// the skin: dark shaded body + rim (the "uncanny" look). A scanner band passes over it now and then (uBand, along
// uBandAxis); right behind the band the skin turns into the real MRI tissue just under it, then fades back to skin.
// Ghost mode (uGhost): only the rim silhouette is left, so things inside show through.
const SKIN_FRAG = /* glsl */ `
uniform float uLevel, uGhost, uTime, uKick, uHats, uBand, uBandAmt, uGain;
uniform vec3 uBandAxis;
uniform vec4 uClip;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vLN;
${NOISE}
${TRANSFER}
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  float n = fbm(vPos * 45.0 + vec3(0.0, uTime * 0.06, 0.0));
  float cut = (1.0 - uLevel) * 1.05;
  if (n < cut) discard;
  float edgeGlow = 1.0 - smoothstep(0.0, 0.05, n - cut);
  vec3 N = normalize(vN), V = normalize(-vView);
  if (!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  if (fres < 0.45 && edgeGlow < 0.05 && fbm(vPos * 60.0 + 9.0) < uGhost * 1.05) discard;   // dissolves to a ghost
  float h = clamp((vPos.y + 0.15) / 0.26, 0.0, 1.0);
  vec3 col = uGlow * 0.4 * (0.25 + 0.75 * ndv) * (1.0 - uGhost);
  col += mix(uRim2, uRim, h) * fres * (0.45 + 0.5 * uKick);
  // the scanner band and its wake (MRI tissue just under the skin)
  if (uBandAmt > 0.01) {
    float c = dot(vPos, uBandAxis) - uBand;                  // > 0 = the band has passed here
    float band = exp(-c * c / 0.0000035);
    float wake = step(0.0, c) * exp(-c * 22.0);
    if (wake > 0.01) {
      float keep, edge, outline;
      vec3 tissue = mri(vPos - normalize(vLN) * 0.004, keep, edge, outline);
      col = mix(col, tissue * 1.1 + uA2 * edge * 0.6, wake * uBandAmt * keep);
    }
    col += mix(uRim, vec3(1.0), 0.35) * band * uBandAmt * (1.2 + 0.6 * uHats);
  }
  col += mix(uRim, uA0, 0.5) * edgeGlow * 1.4;
  col *= smoothstep(-0.16, -0.1, vPos.y);                    // the neck fades out
  if (!gl_FrontFacing) col *= 0.25;
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

// the skull layer for the onion peel: bone-white rim, dim body
const SHELL_FRAG = /* glsl */ `
uniform float uShell, uTime, uKick, uGain;
uniform vec4 uClip;
uniform vec3 uRim, uRim2, uA2;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vLN;
${NOISE}
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  float n = fbm(vPos * 38.0 + 5.1);
  float cut = (1.0 - uShell) * 1.05;
  if (n < cut) discard;
  float edgeGlow = 1.0 - smoothstep(0.0, 0.05, n - cut);
  vec3 N = normalize(vN), V = normalize(-vView);
  if (!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.0);
  vec3 bone = mix(uRim2, vec3(1.0, 0.95, 0.85), 0.45);
  vec3 col = bone * (0.08 + 0.55 * fres) * (0.7 + 0.5 * uKick) + uRim * edgeGlow * 1.4;
  col *= smoothstep(-0.16, -0.1, vPos.y);
  if (!gl_FrontFacing) col *= 0.3;
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

// face echoes: rim-only ghosts of the head that trail behind it when it turns (additive)
const ECHO_FRAG = /* glsl */ `
uniform float uEchoLevel;
uniform vec3 uEchoColor;
uniform vec4 uClip;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying vec3 vLN;
void main() {
  if (dot(vPos, uClip.xyz) > uClip.w) discard;
  vec3 N = normalize(vN), V = normalize(-vView);
  float fres = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.0);
  gl_FragColor = vec4(uEchoColor * fres * uEchoLevel * smoothstep(-0.16, -0.1, vPos.y), 1.0);
}`;

const CAP_VERT = /* glsl */ `
uniform mat4 uHeadInv;
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);     // the cap hangs in the root: back to the head's own frame
  vPos = (uHeadInv * world).xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const CAP_FRAG = /* glsl */ `
uniform float uCapLevel, uTime, uKick, uStepFlash;
varying vec3 vPos;
${NOISE}
${TRANSFER}
void main() {
  float keep, edge, outline;
  vec3 c = mri(vPos, keep, edge, outline);
  if (keep < 0.5) discard;
  float n = fbm(vPos * 45.0 + 3.7);
  if (n < (1.0 - uCapLevel) * 1.05) discard;
  vec3 col = c * (0.55 + 0.25 * uKick + 0.35 * uStepFlash) + uA2 * edge * (0.35 + 0.6 * uStepFlash) + uRim * outline * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const ORTHO_VERT = /* glsl */ `
attribute float plane;
uniform vec3 uOrtho;
uniform vec3 uVolMin, uVolSize;
varying vec3 vPos; varying float vPlane;
void main() {
  vec3 oc = (uOrtho - uVolMin) / uVolSize;
  vec3 q = plane < 0.5 ? vec3(oc.x, position.x, position.y) : plane < 1.5 ? vec3(position.x, oc.y, position.y)
                                                                         : vec3(position.x, position.y, oc.z);
  vPos = uVolMin + q * uVolSize;
  vPlane = plane;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
}`;

const ORTHO_FRAG = /* glsl */ `
uniform float uOrthoLevel, uKick;
uniform vec3 uOrthoFlash, uOrthoMask;
varying vec3 vPos; varying float vPlane;
${NOISE}
${TRANSFER}
void main() {
  float keep, edge, outline;
  vec3 c = mri(vPos, keep, edge, outline);
  if (keep < 0.5) discard;
  float fl = vPlane < 0.5 ? uOrthoFlash.x : vPlane < 1.5 ? uOrthoFlash.y : uOrthoFlash.z;
  float lv = uOrthoLevel * (vPlane < 0.5 ? uOrthoMask.x : vPlane < 1.5 ? uOrthoMask.y : uOrthoMask.z);
  if (fbm(vPos * 45.0 + 1.3 + vPlane) < (1.0 - lv) * 1.05) discard;
  vec3 col = c * (0.5 + 0.6 * fl + 0.2 * uKick) + uA2 * edge * (0.3 + 0.7 * fl) + uRim * outline * (0.7 + 0.8 * fl);
  gl_FragColor = vec4(col, 1.0);
}`;

const SLICE_VERT = /* glsl */ `
attribute float slice;
uniform float uAxis, uExplode, uSlices, uScan, uLift;
uniform vec3 uBoxMin, uBoxSize;
varying vec3 vTex; varying float vT;
void main() {
  float t = (slice + 0.5) / uSlices;
  vec3 q = uAxis < 0.5 ? vec3(t, position.x, position.y) : uAxis < 1.5 ? vec3(position.x, t, position.y) : vec3(position.x, position.y, t);
  vTex = uBoxMin + q * uBoxSize;                       // where the slice samples the MRI
  float spread = 0.5 + (t - 0.5) * (1.0 + uExplode);   // where it is drawn: pushed apart along the stack
  if (uAxis < 0.5) q.x = spread; else if (uAxis < 1.5) q.y = spread; else q.z = spread;
  // the slice of the moment is pulled out of the stack (upwards; the axial stack: sideways), like a film
  float e = (t - uScan) * uSlices / 0.9;
  float lift = uLift * exp(-e * e) * 0.75;
  if (uAxis < 1.5 && uAxis > 0.5) q.x += lift; else q.y += lift;
  vT = t;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uBoxMin + q * uBoxSize, 1.0);
}`;

const SLICE_FRAG = /* glsl */ `
uniform float uSliceLevel, uKick, uScan, uSlices, uSliceReveal, uLift;
varying vec3 vTex; varying float vT;
${TRANSFER}
void main() {
  if (abs(vT - 0.5) * 2.0 > uSliceReveal) discard;
  float keep, edge, outline;
  vec3 c = mri(vTex, keep, edge, outline);
  if (keep < 0.5) discard;
  float e = (vT - uScan) * uSlices / 1.3;                              // (x*x: pow of a negative is NaN -> black)
  float hot = exp(-e * e);                                             // one slice in full colour, running through (not "active": a reserved word)
  float rest = 0.07 * (1.0 - 0.6 * uLift);                             // (while one is pulled out, the rest dims)
  vec3 col = c * (rest + 0.95 * hot) + uA2 * edge * (0.12 + 0.6 * hot) + uRim * outline * (0.6 + 0.5 * uKick) * (1.0 - 0.5 * uLift * (1.0 - hot));
  gl_FragColor = vec4(col * uSliceLevel, 1.0);
}`;

function quads(n, attr) {
  const pos = [], tag = [], idx = [];
  for (let i = 0; i < n; i++) {
    pos.push(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0);
    tag.push(i, i, i, i);
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(attr, new THREE.Float32BufferAttribute(tag, 1));
  g.setIndex(idx);
  return g;
}

export class Head {
  static async load(base = "assets/brain/") {
    const [gltf, meta, bin] = await Promise.all([
      new GLTFLoader().loadAsync(base + "head.glb"),
      fetch(base + "head_volume.json").then((r) => r.json()),
      fetch(base + "head_volume.bin").then((r) => r.arrayBuffer()),
    ]);
    return new Head(gltf.scene, meta, new Uint8Array(bin));
  }

  constructor(model, meta, data) {
    const [w, h, d] = meta.dims;
    const tex = new THREE.Data3DTexture(data, w, h, d);
    Object.assign(tex, { format: THREE.RGFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter, unpackAlignment: 1, needsUpdate: true });
    this.uniforms = {
      uLevel: { value: 0 }, uGain: { value: 0.7 }, uShell: { value: 0 }, uGhost: { value: 0 }, uBand: { value: 1 }, uBandAmt: { value: 0 },
      uBandAxis: { value: new THREE.Vector3(0, 1, 0) }, uOrthoMask: { value: new THREE.Vector3(1, 1, 1) }, uSliceReveal: { value: 1 }, uCapLevel: { value: 0 }, uOrthoLevel: { value: 0 },
      uSliceLevel: { value: 0 }, uBrainOnly: { value: 0 }, uTime: { value: 0 }, uKick: { value: 0 }, uHats: { value: 0 },
      uStepFlash: { value: 0 }, uOrthoFlash: { value: new THREE.Vector3() }, uOrtho: { value: new THREE.Vector3() },
      uExplode: { value: 0 }, uAxis: { value: 0 }, uScan: { value: 0 }, uLift: { value: 0 }, uSlices: { value: NSLICES },
      uClip: { value: new THREE.Vector4(0, 0, 1, 10) },
      uVol: { value: tex }, uVolMin: { value: new THREE.Vector3(...meta.min) }, uVolSize: { value: new THREE.Vector3(...meta.size) },
      uBoxMin: { value: new THREE.Vector3(-0.075, -0.075, -0.085) }, uBoxSize: { value: new THREE.Vector3(0.15, 0.15, 0.17) },
      uHeadInv: { value: new THREE.Matrix4() },
      uRim: { value: new THREE.Color("#ffc94d") }, uRim2: { value: new THREE.Color("#ff5fa2") }, uGlow: { value: new THREE.Color("#30245a") },
      uA0: { value: new THREE.Color("#ff5fa2") }, uA1: { value: new THREE.Color("#4fd8ff") }, uA2: { value: new THREE.Color("#ffb347") },
    };
    const u = this.uniforms;
    const mat = (vertexShader, fragmentShader, extra = {}, uniforms = u) => new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide, transparent: true, depthWrite: true, ...extra });
    this.root = new THREE.Group();
    this.spinner = new THREE.Group();          // the head's own turn; the brain copies it during the journey
    this.root.add(this.spinner);

    this.skinMat = mat(SKIN_VERT, SKIN_FRAG, {}, { ...u, uInset: { value: 0 } });
    this.shellMat = mat(SKIN_VERT, SHELL_FRAG, {}, { ...u, uInset: { value: 0.008 } });
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();   // the GLB has none
      o.material = this.skinMat; o.renderOrder = 4; o.frustumCulled = false; this.skin = o;
    });
    this.spinner.add(model);
    this.shell = new THREE.Mesh(this.skin.geometry, this.shellMat);
    this.shell.renderOrder = 4; this.shell.frustumCulled = false;
    this.spinner.add(this.shell);

    // the cut face: a big quad on the plane, placed each frame (child of root, not of the spinner)
    this.cap = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat(CAP_VERT, CAP_FRAG));
    this.cap.renderOrder = 4; this.cap.frustumCulled = false;
    this.root.add(this.cap);
    // three planes crossing at uOrtho, over the whole MRI box
    this.ortho = new THREE.Mesh(quads(3, "plane"), mat(ORTHO_VERT, ORTHO_FRAG));
    this.ortho.renderOrder = 4; this.ortho.frustumCulled = false;
    this.spinner.add(this.ortho);
    // the slice stack through the brain box
    this.slices = new THREE.Mesh(quads(NSLICES, "slice"), mat(SLICE_VERT, SLICE_FRAG,
      { depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.slices.renderOrder = 7; this.slices.frustumCulled = false;
    this.spinner.add(this.slices);

    // face echoes: the same surface, rim only, turned the way the head was a moment ago (set by the journey)
    this.echoes = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(this.skin.geometry, new THREE.ShaderMaterial({
        uniforms: { ...u, uInset: { value: 0 }, uEchoLevel: { value: 0 }, uEchoColor: { value: new THREE.Color("#ff5fa2") } },
        vertexShader: SKIN_VERT, fragmentShader: ECHO_FRAG, side: THREE.DoubleSide, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 6; m.frustumCulled = false; m.visible = false;
      this.root.add(m);
      return m;
    });

    this.size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());   // ~0.17 x 0.24 x 0.22 m
    this.root.visible = false;
    this._n = new THREE.Vector3();
  }

  // the slice stack covers the brain (centred on the origin of this frame), with a little margin
  setBrainSize(size) {
    this.uniforms.uBoxSize.value.copy(size).addScalar(0.006);
    this.uniforms.uBoxMin.value.copy(this.uniforms.uBoxSize.value).multiplyScalar(-0.5);
  }

  // echo i: turned like the head was (quaternion), brightness, colour
  setEcho(i, quaternion, level, color) {
    const e = this.echoes[i];
    e.quaternion.copy(quaternion);
    e.material.uniforms.uEchoLevel.value = level;
    e.material.uniforms.uEchoColor.value.copy(color);
    e.visible = level > 0.01;
  }

  setColors(P, k) {
    const u = this.uniforms;
    u.uRim.value.lerp(new THREE.Color(P.rim), k);
    u.uRim2.value.lerp(new THREE.Color(P.rim2), k);
    u.uGlow.value.lerp(new THREE.Color(P.glow), k);
    [u.uA0, u.uA1, u.uA2].forEach((a, i) => a.value.lerp(new THREE.Color(P.accents[i]), k));
  }

  // the cut plane faces the camera: everything closer to the camera than 'depth' (metres from the brain centre,
  // in the head's own frame) is cut away; returns the plane (normal + distance) in the head frame
  setCut(camera, depth) {
    const u = this.uniforms;
    this.spinner.updateMatrixWorld(true);
    const n = this.spinner.worldToLocal(this._n.copy(camera.position)).normalize();
    u.uClip.value.set(n.x, n.y, n.z, depth);
    const nRoot = n.clone().applyQuaternion(this.spinner.quaternion);
    this.cap.position.copy(nRoot).multiplyScalar(depth);
    this.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nRoot);
    u.uHeadInv.value.copy(this.spinner.matrixWorld).invert();
    return u.uClip.value;
  }

  update(dt, t, { kick = 0, hats = 0 } = {}) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uKick.value = kick;
    u.uHats.value = hats;
    const on = (x) => x > 0.002;
    this.skin.visible = on(u.uLevel.value);
    this.shell.visible = on(u.uShell.value);
    this.cap.visible = on(u.uCapLevel.value) && u.uClip.value.w < 0.14;
    this.ortho.visible = on(u.uOrthoLevel.value);
    this.slices.visible = on(u.uSliceLevel.value);
    this.root.visible = this.skin.visible || this.shell.visible || this.cap.visible || this.ortho.visible || this.slices.visible ||
      this.echoes.some((e) => e.visible);
  }
}
