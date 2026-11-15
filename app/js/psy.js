// Psychedelic layers for the hologram scene: feedback tunnel, kaleidoscope/warp/RGB-split pass, a fractal mandala
// backdrop, a particle vortex and wireframe "sacred geometry" orbiters. All driven by a single "trip" level 0..1.
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

const HUE_GLSL = /* glsl */`
  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }`;

const QUAD_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ------------------------------------------------------------------ feedback: zoom + rotate + hue-shift the past
export class FeedbackPass extends Pass {
  constructor() {
    super();
    const rt = () => new THREE.WebGLRenderTarget(innerWidth, innerHeight,
      { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.old = rt(); this.comp = rt();
    this.uniforms = {
      tOld: { value: null }, tNew: { value: null }, damp: { value: 0.88 }, zoom: { value: 1.0 }, rot: { value: 0 },
      hue: { value: 0 }, exposure: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.5) },
      aspect: { value: innerWidth / innerHeight },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tOld, tNew;
        uniform float damp, zoom, rot, hue, exposure, aspect;
        uniform vec2 center;
        varying vec2 vUv;
        ${HUE_GLSL}
        bool bad(vec4 v) { uvec4 b = floatBitsToUint(v) & 0x7f800000u; return any(equal(b, uvec4(0x7f800000u))); }
        void main() {
          vec2 p = (vUv - center) * vec2(aspect, 1.0);
          float c = cos(rot), s = sin(rot);
          p = mat2(c, -s, s, c) * p / zoom;
          vec2 uv = p / vec2(aspect, 1.0) + center;
          vec4 o = texture2D(tOld, uv);
          o *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          o.rgb = hueShift(o.rgb, hue);
          vec4 n = texture2D(tNew, vUv);
          if (bad(o)) o = vec4(0.0);                                 // NaN / Inf never survive (a bit test: the
          if (bad(n)) n = vec4(0.0);                                 // D3D compiler may drop "x == x" checks)
          o = min(o, vec4(16.0)); n = min(n, vec4(16.0));
          vec4 glow = max(n, o * damp);
          vec4 expo = mix(n, o, damp);
          gl_FragColor = mix(glow, expo, exposure);
        }`,
    }));
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false }));
  }
  set mode(m) { this.uniforms.exposure.value = m === "exposure" ? 1 : 0; }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tOld.value = this.old.texture;
    this.uniforms.tNew.value = readBuffer.texture;
    renderer.setRenderTarget(this.comp);
    this.quad.render(renderer);
    this.copy.material.uniforms.tDiffuse.value = this.comp.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
    [this.old, this.comp] = [this.comp, this.old];
  }
  setSize(w, h) { this.old.setSize(w, h); this.comp.setSize(w, h); this.uniforms.aspect.value = w / h; }
}

// ------------------------------------------------------------------ kaleidoscope + liquid warp + RGB split + hue
export class PsyPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, time: { value: 0 }, segments: { value: 6 }, kaleido: { value: 0 }, krot: { value: 0 },
      warp: { value: 0 }, aberr: { value: 0 }, hue: { value: 0 }, aspect: { value: innerWidth / innerHeight },
      center: { value: new THREE.Vector2(0.5, 0.5) }, vignette: { value: 1 },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float time, segments, kaleido, krot, warp, aberr, hue, aspect, vignette;
        uniform vec2 center;
        varying vec2 vUv;
        ${HUE_GLSL}
        vec3 rgbSplit(vec2 uv) {
          vec2 d = (uv - center) * aberr;
          return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
        }
        void main() {
          vec2 uv = vUv;
          // liquid wobble, kept OUT of the centre (where the dancer is) so her body never looks bent
          float wm = smoothstep(0.2, 0.6, length((vUv - center) * vec2(aspect, 1.0)));
          uv += warp * 0.004 * wm * vec2(sin(uv.y * 5.0 + time * 0.9) + 0.5 * sin(uv.y * 9.0 - time * 0.6),
                                         cos(uv.x * 4.0 - time * 0.8) + 0.5 * cos(uv.x * 8.0 + time * 0.7));
          vec3 col = rgbSplit(uv);
          if (kaleido > 0.001) {
            vec2 p = (uv - center) * vec2(aspect, 1.0);
            float r = length(p), a = atan(p.y, p.x) + krot, seg = 6.2831853 / segments;
            a = mod(a, seg); a = abs(a - 0.5 * seg);
            vec2 k = vec2(cos(a), sin(a)) * r / vec2(aspect, 1.0) + center;
            col = mix(col, rgbSplit(k), kaleido);
          }
          col = hueShift(col, hue);
          vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
          col *= mix(1.0, 1.0 - smoothstep(0.35, 0.95, length(v)), vignette);   // fade to black at the edges
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  setSize(w, h) { this.uniforms.aspect.value = w / h; }
}

// ------------------------------------------------------------------ fractal mandala halo (follows the camera)
// A ring around the dancer: dark in the middle (so she reads clearly), fading out at the edges, colours spread over
// the palette (colA..colC + the body glow).
export class Mandala {
  constructor() {
    this.uniforms = {
      time: { value: 0 }, energy: { value: 0.5 }, kick: { value: 0 }, segs: { value: 8 }, bright: { value: 0.4 },
      colA: { value: new THREE.Color("#ff5fa2") }, colB: { value: new THREE.Color("#4fd8ff") },
      colC: { value: new THREE.Color("#ffb347") }, colD: { value: new THREE.Color("#30245a") },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthWrite: false, depthTest: false, vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        uniform float time, energy, kick, segs, bright;
        uniform vec3 colA, colB, colC, colD;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        vec3 pal(float x) {                       // smooth loop through the 4 palette colours
          x = fract(x) * 4.0;
          if (x < 1.0) return mix(colA, colB, x);
          if (x < 2.0) return mix(colB, colC, x - 1.0);
          if (x < 3.0) return mix(colC, colD * 3.0, x - 2.0);
          return mix(colD * 3.0, colA, x - 3.0);
        }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(1.7, 1.0) * 2.0;
          float r = length(p), a = atan(p.y, p.x) + time * 0.03, seg = 6.2831853 / segs;
          a = abs(mod(a, seg) - 0.5 * seg);
          vec2 q = vec2(cos(a), sin(a)) * r;
          float w = fbm(q * 2.0 - time * 0.06);
          float f = fbm(q * 3.0 + vec2(time * 0.1, -time * 0.07) + 2.0 * w);
          float rings = 0.5 + 0.5 * sin(r * 18.0 - time * 1.5 - kick * 4.0);
          float lines = smoothstep(0.46, 0.5, f) - smoothstep(0.5, 0.54, f);         // glowing contour lines
          float v = smoothstep(0.5, 0.85, f) * (0.4 + 0.6 * rings) * 0.6 + 1.2 * lines;
          vec3 col = pal(f * 1.5 + r * 0.6 + time * 0.03) * v * bright * (0.4 + 0.6 * energy);
          col *= smoothstep(0.35, 0.6, r) * (1.0 - smoothstep(0.75, 1.2, r));               // a halo: empty middle, soft edge
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }
  setColors(palette, k) {
    const u = this.uniforms;
    palette.accents.forEach((c, i) => [u.colA, u.colB, u.colC][i].value.lerp(new THREE.Color(c), k));
    u.colD.value.lerp(new THREE.Color(palette.glow), k);
  }
  // keep the plane filling the view, far behind the dancer
  follow(camera, dist = 8) {
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.mesh.scale.set(h * camera.aspect, h, 1);
    this.mesh.position.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), dist);
    this.mesh.quaternion.copy(camera.quaternion);
  }
}

// ------------------------------------------------------------------ two wireframe shapes + a halo ring
export class Orbiters {
  constructor(height) {
    this.h = height;
    this.group = new THREE.Group();
    const mat = () => new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false });
    const shapes = [new THREE.IcosahedronGeometry(1, 0), new THREE.TorusKnotGeometry(0.7, 0.18, 64, 8, 2, 3)];
    this.items = shapes.map((g, i) => {
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), mat());
      m.userData = { phase: i * Math.PI, tilt: 0.3 + i * 0.5, speed: 0.25 + 0.1 * i };
      this.group.add(m);
      return m;
    });
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos(i / 128 * 6.283), Math.sin(i / 128 * 6.283), 0))),
    mat());
    this.group.add(this.ring);
    this.materials = [...this.items.map((m) => m.material), this.ring.material];
  }
  setColors(palette, k) {
    this.materials.forEach((m, i) => m.color.lerp(new THREE.Color(palette.accents[(i + 1) % 3]), k));
  }
  update(t, { trip = 0.5, beatPhase = 0, kick = 0 } = {}) {
    const h = this.h, pulse = 1 + 0.2 * Math.pow(1 - beatPhase, 4) * trip;
    this.items.forEach((m) => {
      const u = m.userData, a = t * u.speed + u.phase;
      m.position.set(Math.cos(a) * h * 0.7, h * (0.55 + 0.3 * Math.sin(a * 0.7 + u.tilt)), Math.sin(a) * h * 0.7);
      m.rotation.set(t * 0.3 + u.tilt, t * 0.5 * u.speed, 0);
      m.scale.setScalar(h * 0.07 * pulse);
    });
    this.ring.position.set(0, h * 0.55, -h * 0.4);
    this.ring.scale.setScalar(h * (0.6 + 0.04 * kick) * pulse);
    this.materials.forEach((m) => (m.opacity = 0.12 + 0.4 * trip));
  }
}
