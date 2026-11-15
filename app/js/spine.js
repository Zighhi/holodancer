// The spine, from the spine MRI (tools/volume/make_spine.py -> assets/spine/; local only, medical data):
//   loadSpine()   - the sagittal T2 (17 slices, whole spine) and the coronal T2 (34 slices, torso) as 3D textures, and
//                   the path of the spinal cord (the canal's centre, traced on the sagittal)
//   SpineStack    - the 17 sagittal slices as a glowing stack (a mind moment in the cube), one pulled out per beat
//   KundaliniWall - the wall's "spine" scene: the whole spine tall on the wall, fanned films, energy climbing the cord
//                   through the chakras, bursting into the brain on the drop
import * as THREE from "three";

async function vol(name) {
  const [meta, bin] = await Promise.all([fetch(`assets/spine/${name}.json`).then((r) => r.json()),
    fetch(`assets/spine/${name}.bin`).then((r) => r.arrayBuffer())]);
  const tex = new THREE.Data3DTexture(new Uint8Array(bin), ...meta.dims);
  Object.assign(tex, { format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter, unpackAlignment: 1, needsUpdate: true });
  return { tex, meta };
}

export async function loadSpine() {
  const [sag, cor, cord] = await Promise.all([vol("spine_sag"), vol("spine_cor"),
    fetch("assets/spine/cord.json").then((r) => r.json())]);
  return { sag, cor, cord: cord.points_lps_mm };
}

// ---------------------------------------------------------------- a slice of a volume as a glowing film
const SLICE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SLICE_FRAG = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uVol;
uniform float uZ, uLevel, uHot, uRise, uRiseAmt;
uniform vec4 uCrop;                 // u0, v0, u1, v1 of the image to show
uniform vec3 uC1, uC2, uC3;
varying vec2 vUv;
void main() {
  vec2 q = mix(uCrop.xy, uCrop.zw, vUv);
  float c = texture(uVol, vec3(q, uZ)).r;
  float b = smoothstep(0.28, 0.85, c);
  float edge = (1.0 - smoothstep(0.85, 1.0, abs(vUv.x - 0.5) * 2.0)) * (1.0 - smoothstep(0.9, 1.0, abs(vUv.y - 0.5) * 2.0));
  vec3 col = mix(uC1, uC2, b) * b * (0.25 + 0.9 * uHot);
  float e = (vUv.y - uRise) / 0.02;
  col += uC3 * (exp(-e * e) * 1.5 + 0.3 * step(vUv.y, uRise)) * b * uRiseAmt;
  gl_FragColor = vec4(col * edge * uLevel, 1.0);
}`;
function sliceMaterial(volTex) {
  const c = (h) => ({ value: new THREE.Color(h) });
  return new THREE.ShaderMaterial({
    uniforms: { uVol: { value: volTex }, uZ: { value: 0.5 }, uLevel: { value: 0 }, uHot: { value: 0 }, uRise: { value: 0 },
      uRiseAmt: { value: 0 }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, uC1: c("#4fd8ff"), uC2: c("#ffc94d"), uC3: c("#ff5fa2") },
    vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
}
function tint(mat, P, k) {
  const u = mat.uniforms;
  u.uC1.value.lerp(new THREE.Color(P.accents[1]), k); u.uC2.value.lerp(new THREE.Color(P.rim), k); u.uC3.value.lerp(new THREE.Color(P.accents[0]), k);
}

// ---------------------------------------------------------------- the spine stack (a mind moment in the cube)
export class SpineStack {
  constructor(spine) {
    const m = spine.sag.meta, n = m.dims[2];
    this.n = n;
    this.crop = [0.25, 0.0, 0.9, 1.0];                              // front of the vertebrae .. the back; sacrum .. skull
    const w = m.mm[0] * (this.crop[2] - this.crop[0]) * 0.001, h = m.mm[1] * 0.001;
    this.height = h;
    this.group = new THREE.Group();
    this.slices = [];
    for (let i = 0; i < n; i++) {
      const mat = sliceMaterial(spine.sag.tex);
      mat.uniforms.uZ.value = (i + 0.5) / n;
      mat.uniforms.uCrop.value.set(...this.crop);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.y = Math.PI / 2;                                // a sagittal plane: its normal along x
      mesh.renderOrder = 7; mesh.frustumCulled = false;
      this.group.add(mesh); this.slices.push(mesh);
    }
    this.spread = 0.0036; this.group.visible = false;
  }
  setColors(P, k) { for (const s of this.slices) tint(s.material, P, k); }
  // a: { level, explode, hot (index 0..n-1 of the pulled-out slice, -1 none), lift 0..1, rise, riseAmt }
  update(a) {
    this.group.visible = a.level > 0.003;
    if (!this.group.visible) return;
    this.slices.forEach((s, i) => {
      // fanned like the pages of a half-open book around the spine's vertical axis; the hot one turns to the crowd
      const hot = a.hot >= 0 ? Math.exp(-(((i - a.hot) / 0.8) ** 2)) : 0;
      const ang = (i - (this.n - 1) / 2) * (0.07 + 0.02 * a.explode);
      s.rotation.y = Math.PI / 2 + ang * (1 - hot * a.lift) - hot * a.lift * (Math.PI / 2 + this.group.rotation.y);
      s.position.set(0, 0, hot * a.lift * 0.08);
      const u = s.material.uniforms;
      u.uLevel.value = a.level * (0.14 + 0.86 * hot * a.lift);    // (17 films add up: only the pulled-out one bright)
      u.uHot.value = 0.3 + 0.7 * hot * a.lift;
      u.uRise.value = a.rise; u.uRiseAmt.value = a.riseAmt;
    });
  }
}

// ---------------------------------------------------------------- the wall's kundalini scene
export class KundaliniWall {
  constructor(spine) {
    const m = spine.sag.meta;
    const c = (h) => ({ value: new THREE.Color(h) });
    // the cord's path in the image (u along AP, v foot -> head), for the energy to climb it
    const top = m.top_z_mm, y0 = m.y0_mm;
    const path = spine.cord.map(([x, y, z]) => new THREE.Vector2((y - y0) / m.mm[0], 1 - (top - z) / m.mm[1]));
    const pathTex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
    for (let i = 0; i < 256; i++) {                                  // u of the path at height v = i / 255
      const v = i / 255;
      let best = path[0];
      for (const p of path) if (Math.abs(p.y - v) < Math.abs(best.y - v)) best = p;
      pathTex.image.data.set([best.x, v, 0, 1], i * 4);
    }
    pathTex.minFilter = pathTex.magFilter = THREE.NearestFilter; pathTex.needsUpdate = true;   // (float: no linear filtering)
    this.uniforms = { uVol: { value: spine.sag.tex }, uPath: { value: pathTex }, uAspect: { value: innerWidth / innerHeight },
      uLevel: { value: 0 }, uRise: { value: 0 }, uBurst: { value: 0 }, uKick: { value: 0 }, uTime: { value: 0 }, uX: { value: 0 },
      uImgAsp: { value: (m.mm[0] * 0.62) / m.mm[1] }, uC1: c("#4fd8ff"), uC2: c("#ffc94d"), uC3: c("#ff5fa2") };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.uniforms,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        precision highp sampler3D;
        uniform sampler3D uVol;
        uniform sampler2D uPath;
        uniform float uAspect, uLevel, uRise, uBurst, uKick, uTime, uX, uImgAsp;
        uniform vec3 uC1, uC2, uC3;
        varying vec2 vUv;
        float gauss(float x, float w) { float e = x / w; return exp(-e * e); }
        // one film: the slice z, centred at x0 (wall units), height h; the image's columns 0.28 .. 0.9 (body .. back)
        vec3 film(vec2 p, float x0, float h, float z, float amt, out float inside, out vec2 q) {
          vec2 d = vec2((p.x - x0) / (h * uImgAsp), p.y / h) + 0.5;
          inside = step(0.0, d.x) * step(d.x, 1.0) * step(0.0, d.y) * step(d.y, 1.0);
          q = vec2(0.28 + d.x * 0.62, d.y);
          float c = texture(uVol, vec3(q, z)).r;
          float b = smoothstep(0.1, 0.8, c);
          return mix(uC1, uC2, b) * b * amt * inside;
        }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float h = 0.96, ins; vec2 q;
          vec3 col = film(p, uX, h, 0.5, 0.75, ins, q);
          vec2 qq; float i2;
          col += film(p, uX - 0.36, h * 0.82, 0.3, 0.28, i2, qq) + film(p, uX + 0.36, h * 0.82, 0.7, 0.28, i2, qq);
          col += film(p, uX - 0.66, h * 0.66, 0.15, 0.12, i2, qq) + film(p, uX + 0.66, h * 0.66, 0.85, 0.12, i2, qq);
          // the energy: up the cord to uRise (the path's u at this height), a bright front, the chakras as it passes
          float cu = texture2D(uPath, vec2(q.y, 0.5)).r;
          float near = gauss((q.x - cu) * h * uImgAsp / 0.62, 0.012) * ins;
          float front = gauss(q.y - uRise, 0.02);
          col += mix(uC3, vec3(1.0), 0.35) * near * (front * 2.5 + 0.6 * step(q.y, uRise)) * (0.8 + 0.4 * uKick);
          for (int i = 0; i < 7; i++) {
            float hv = 0.06 + float(i) * 0.15;                       // root ... crown
            float cv = texture2D(uPath, vec2(hv, 0.5)).r;
            vec2 cp = vec2(uX + ((cv - 0.28) / 0.62 - 0.5) * h * uImgAsp, (hv - 0.5) * h);   // on the cord, at that height
            float lit = smoothstep(hv - 0.02, hv + 0.02, uRise);
            float r = length(p - cp);
            col += mix(uC2, uC3, float(i) / 6.0) * (gauss(r, 0.012) * 1.5 + gauss(r - 0.035 - 0.01 * uKick, 0.003)) * (0.15 + 0.85 * lit);
          }
          // the drop: the energy bursts out of the crown
          vec2 crown = vec2(uX, 0.5 * h);
          float rr = length(p - crown), aa = atan(p.y - crown.y, p.x - crown.x);
          col += uC3 * uBurst * (gauss(rr - (1.0 - uBurst) * 0.9, 0.03) + 0.4 * pow(abs(sin(aa * 12.0 + uTime)), 20.0) * exp(-rr * 2.0));
          gl_FragColor = vec4(col * uLevel, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.visible = false;
  }
  setColors(P, k) { tint({ uniforms: this.uniforms }, P, k); }
  // a: { level, rise 0..1, burst 0..1, kick, t, x (the film's centre on the wall), aspect }
  update(a) {
    const u = this.uniforms;
    this.mesh.visible = a.level > 0.003;
    u.uLevel.value = a.level; u.uRise.value = a.rise; u.uBurst.value = a.burst; u.uKick.value = a.kick;
    u.uTime.value = a.t; u.uX.value = a.x; u.uAspect.value = a.aspect;
  }
}
