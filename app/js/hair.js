// Long hair with physics: verlet strands rooted around the back of the dancer's head, colliding with her head, neck
// and upper back, drawn as thin camera-facing ribbons in the BODY's own look (her glow colour at the roots, a touch of
// rim light toward the tips, see-through instead of additive) so it reads as part of her, not as an effect.
import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// The lower edge of the character's own hair mesh (rest pose, world space), around the back and sides of the head:
// per angle the lowest hair points, and the direction the hair flows there (from the hair just above down to the edge).
function hairEdge(rest, center) {
  let mesh = null;
  rest.traverse((o) => { if (!mesh && o.isMesh && /hair/i.test(o.name)) mesh = o; });
  if (!mesh) return [];
  const pa = mesh.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld);
    const d = v.clone().sub(center);
    if (d.z > 0.25 * d.length()) continue;                           // back and sides only
    pts.push({ p: v.clone(), az: Math.atan2(d.x, -d.z) });
  }
  const bins = 40, out = [];
  for (let b = 0; b < bins; b++) {
    const lo = -2.6 + 5.2 * b / bins, hi = lo + 5.2 / bins;
    const inBin = pts.filter((q) => q.az >= lo && q.az < hi);
    if (inBin.length < 4) continue;
    inBin.sort((a, c) => a.p.y - c.p.y);
    const low = inBin[0].p, span = inBin[inBin.length - 1].p.y - low.y;
    const above = inBin.filter((q) => q.p.y > low.y + span * 0.08 && q.p.y < low.y + span * 0.3);
    const up = above.length ? above.reduce((acc, q) => acc.add(q.p), new THREE.Vector3()).divideScalar(above.length)
                            : low.clone().add(new THREE.Vector3(0, 0.01, 0));
    const d = low.clone().sub(up).normalize();
    if (d.y > -0.2) d.y = -0.2;                                      // always fall at least a little downward
    out.push({ p: low.clone(), d: d.normalize() });
  }
  return out;
}

const findBone = (root, re) => { let b = null; root.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };

export class Hair {
  constructor(dancer, { strands = 600, segments = 14, length = 0.32, brightness = 0.85 } = {}) {
    this.brightness = brightness;   // scales the hair's colour relative to the body
    const H = dancer.height;
    this.N = strands; this.S = segments + 1;
    this.head = findBone(dancer.model, /head$/i);
    this.colliders = [/spine2$/i, /spine1$/i, /neck$/i, /leftshoulder$/i, /rightshoulder$/i]
      .map((re, i) => ({ bone: findBone(dancer.model, re), r: H * [0.085, 0.09, 0.05, 0.05, 0.05][i] }))
      .filter((c) => c.bone);
    this.H = H;
    this.ok = !!this.head;
    if (!this.ok) { console.warn("hair: no head bone found"); this.mesh = new THREE.Group(); return; }

    // anchors: worked out once in the REST pose (she faces +Z, up is +Y), stored in the head bone's local space
    const rest = SkeletonUtils.clone(dancer.model);
    rest.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); });
    rest.updateMatrixWorld(true);
    const rHead = findBone(rest, /head$/i), rTop = findBone(rest, /headtop_end$/i);
    const hp = rHead.getWorldPosition(new THREE.Vector3());
    const tp = rTop ? rTop.getWorldPosition(new THREE.Vector3()) : hp.clone().add(new THREE.Vector3(0, H * 0.11, 0));
    const headH = tp.distanceTo(hp);
    const center = hp.clone().lerp(tp, 0.5).add(new THREE.Vector3(0, 0, -headH * 0.08));
    this.headR = headH * 0.55;
    const inv = rHead.matrixWorld.clone().invert();
    this.centerLocal = center.clone().applyMatrix4(inv);
    this.anchors = []; this.outDirs = []; this.lens = [];
    const edge = hairEdge(rest, center);
    if (edge.length >= 8) {
      // Long hair growing out of the LOWER EDGE of her own hair mesh (back and sides): each strand starts tucked just
      // under the edge and continues in the direction her haircut flows there, so the two read as one hairstyle.
      for (let i = 0; i < strands; i++) {
        const t = Math.random() * (edge.length - 1), e0 = edge[Math.floor(t)], e1 = edge[Math.ceil(t)], f = t % 1;
        const pos = e0.p.clone().lerp(e1.p, f), flow = e0.d.clone().lerp(e1.d, f).normalize();
        const inward = center.clone().sub(pos).normalize();
        pos.addScaledVector(flow, -H * 0.012).addScaledVector(inward, H * 0.004);   // tucked under the edge (overlap)
        this.anchors.push(pos.applyMatrix4(inv));
        this.outDirs.push(flow.transformDirection(inv));
        const layer = i % 3 === 0 ? 0.4 + 0.3 * Math.random() : 0.85 + 0.3 * Math.random();   // 1/3 short inner layer
        this.lens.push(H * length * layer / segments);
      }
      console.info(`hair: ${strands} strands from the edge of her own hair (${edge.length} edge points)`);
    } else {
      // no hair mesh found: roots around the back and sides of the head, below the crown down to the nape
      const dir = new THREE.Vector3(), comb = new THREE.Vector3();
      while (this.anchors.length < strands) {
        dir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue;
        dir.normalize();
        if (dir.z > 0.15 || dir.y > 0.35 || dir.y < -0.5) continue;
        comb.set(dir.x * 0.4, -1, -0.25).normalize();
        comb.addScaledVector(dir, -comb.dot(dir)).normalize();
        this.anchors.push(center.clone().addScaledVector(dir, this.headR * 1.02).applyMatrix4(inv));
        this.outDirs.push(comb.clone().transformDirection(inv));
        this.lens.push(H * length * (0.85 + 0.3 * Math.random()) / segments);
      }
    }

    this.pos = new Float32Array(strands * this.S * 3);
    this.prev = new Float32Array(strands * this.S * 3);
    this.started = false;
    // ribbon geometry: 2 vertices per hair point, indices fixed
    const V = strands * this.S * 2;
    this.vpos = new Float32Array(V * 3);
    this.vcol = new Float32Array(V * 4);                       // RGBA: strands thin out toward the tips
    const idx = [];
    for (let s = 0; s < strands; s++) for (let k = 0; k < this.S - 1; k++) {
      const a = (s * this.S + k) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.vpos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.vcol, 4));
    geo.setIndex(idx);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.colRoot = new THREE.Color("#30245a"); this.colTip = new THREE.Color("#ffc94d");   // body glow, rim
    this.glow = 1;
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.lastHead = new THREE.Vector3();
  }

  // bodyGlow = the body's current glow colour, rim = its rim colour (copied every frame from the dancer)
  setColors(bodyGlow, rim, rimStrength = 0.6) { this.colRoot.copy(bodyGlow); this.colTip.copy(rim); this.rimStrength = rimStrength; }

  update(dt, camera, { kick = 0, energy = 0.4, highs = 0.3 } = {}) {
    if (!this.ok || !this.mesh.visible) return;
    const [a, b, c, d] = this._v;
    const S = this.S, P = this.pos, Q = this.prev, H = this.H;
    const hm = this.head.matrixWorld;
    const headC = a.copy(this.centerLocal).applyMatrix4(hm);
    // a jump of the head (first frame, or a teleport) resets the hair hanging straight down
    if (!this.started || headC.distanceTo(this.lastHead) > H * 0.3) {
      for (let s = 0; s < this.N; s++) {
        b.copy(this.anchors[s]).applyMatrix4(hm);
        for (let k = 0; k < S; k++) {
          const i = (s * S + k) * 3;
          P[i] = Q[i] = b.x; P[i + 1] = Q[i + 1] = b.y - k * this.lens[s]; P[i + 2] = Q[i + 2] = b.z;
        }
      }
      this.started = true;
    }
    const headVel = this._hv || (this._hv = new THREE.Vector3());
    headVel.copy(headC).sub(this.lastHead);
    if (headVel.length() > H * 0.2) headVel.set(0, 0, 0);       // first frame / teleport: no fake movement
    this.lastHead.copy(headC);
    const hc = this.hc || (this.hc = new THREE.Vector3());
    hc.copy(headC);
    const cols = this.colliders.map((cl) => ({ p: cl.bone.getWorldPosition(new THREE.Vector3()), r: cl.r }));
    cols.push({ p: headC.clone(), r: this.headR * 1.08 });
    const steps = 2, h = Math.min(dt, 1 / 30) / steps, g = -9.81 * h * h;                    // real gravity
    this.t = (this.t || 0) + dt;
    const wind = H * 0.00004;                                           // a barely noticeable air movement
    const flick = 0;                                                     // no artificial kick forces: pure physics
    // (speed: plain sqrt instead of Math.hypot, wind once per strand, collisions once per step - same look)
    const nc = cols.length;
    for (let st = 0; st < steps; st++) {
      for (let s = 0; s < this.N; s++) {
        const root = b.copy(this.anchors[s]).applyMatrix4(hm);
        const out = c.copy(this.outDirs[s]).transformDirection(hm);
        const L = this.lens[s];
        // wind: smooth per-strand turbulence (pure physics otherwise: no flick, no extra lag)
        const ph = s * 1.7, tt = this.t;
        const wx = (Math.sin(tt * 1.3 + ph) + 0.5 * Math.sin(tt * 2.9 + ph * 1.9)) * wind;
        const wz = (Math.cos(tt * 1.1 + ph * 1.3) + 0.5 * Math.cos(tt * 2.3 + ph * 0.7)) * wind;
        for (let k = 1; k < S; k++) {                                 // verlet with air damping
          const i = (s * S + k) * 3;
          const vx = (P[i] - Q[i]) * 0.96, vy = (P[i + 1] - Q[i + 1]) * 0.96, vz = (P[i + 2] - Q[i + 2]) * 0.96;
          Q[i] = P[i]; Q[i + 1] = P[i + 1]; Q[i + 2] = P[i + 2];
          const tip = k / (S - 1);
          P[i] += vx + wx * tip;
          P[i + 1] += vy + g;
          P[i + 2] += vz + wz * tip;
        }
        const i0 = s * S * 3;
        P[i0] = root.x; P[i0 + 1] = root.y; P[i0 + 2] = root.z;
        // the first two segments follow the comb direction along the skull (stiff roots = a haircut), then free
        const i1 = i0 + 3, i2 = i0 + 6;
        P[i1] += (root.x + out.x * L - P[i1]) * 0.85; P[i1 + 1] += (root.y + out.y * L - P[i1 + 1]) * 0.85;
        P[i1 + 2] += (root.z + out.z * L - P[i1 + 2]) * 0.85;
        P[i2] += (P[i1] + out.x * L - P[i2]) * 0.55; P[i2 + 1] += (P[i1 + 1] + out.y * L - P[i2 + 1]) * 0.55;
        P[i2 + 2] += (P[i1 + 2] + out.z * L - P[i2 + 2]) * 0.55;
        const i3 = i0 + 9;
        P[i3] += (P[i2] + out.x * L - P[i3]) * 0.25; P[i3 + 1] += (P[i2 + 1] + out.y * L - P[i3 + 1]) * 0.25;
        P[i3 + 2] += (P[i2 + 2] + out.z * L - P[i3 + 2]) * 0.25;
        for (let it = 0; it < 4; it++) {
          for (let k = 0; k < S - 1; k++) {                           // keep segment lengths
            const i = (s * S + k) * 3, j = i + 3;
            let dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, diff = (dist - L) / dist;
            if (k === 0) { P[j] -= dx * diff; P[j + 1] -= dy * diff; P[j + 2] -= dz * diff; }
            else {
              dx *= 0.5 * diff; dy *= 0.5 * diff; dz *= 0.5 * diff;
              P[i] += dx; P[i + 1] += dy; P[i + 2] += dz; P[j] -= dx; P[j + 1] -= dy; P[j + 2] -= dz;
            }
          }
        }
        for (let k = 2; k < S; k++) {                                 // stay outside head, neck and back
          const i = (s * S + k) * 3;
          for (let ci = 0; ci < nc; ci++) {
            const cl = cols[ci], cp = cl.p, r = cl.r;
            const dx = P[i] - cp.x, dy = P[i + 1] - cp.y, dz = P[i + 2] - cp.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < r * r && d2 > 1e-12) {
              const f = r / Math.sqrt(d2);
              P[i] = cp.x + dx * f; P[i + 1] = cp.y + dy * f; P[i + 2] = cp.z + dz * f;
            }
          }
        }
      }
    }
    // ribbons facing the camera, thin at the tips; colour fades from root to tip
    const cam = camera.position, V = this.vpos, C = this.vcol;
    this.glow += (1 - this.glow) * Math.min(1, dt * 3);
    const bright = (this.glow + 0.3 * kick) * this.brightness;
    for (let s = 0; s < this.N; s++) {
      for (let k = 0; k < S; k++) {
        const i = (s * S + k) * 3, j = Math.min(S - 1, k + 1), jm = Math.max(0, k - 1);
        a.set(P[(s * S + j) * 3] - P[(s * S + jm) * 3], P[(s * S + j) * 3 + 1] - P[(s * S + jm) * 3 + 1],
          P[(s * S + j) * 3 + 2] - P[(s * S + jm) * 3 + 2]);
        b.set(cam.x - P[i], cam.y - P[i + 1], cam.z - P[i + 2]);
        const u = k / (S - 1);
        d.crossVectors(a, b).normalize().multiplyScalar(H * (0.0026 * (1 - u) * (1 - u) + 0.0005));   // wide roots cover the scalp
        const v = (s * S + k) * 6;
        V[v] = P[i] - d.x; V[v + 1] = P[i + 1] - d.y; V[v + 2] = P[i + 2] - d.z;
        V[v + 3] = P[i] + d.x; V[v + 4] = P[i + 1] + d.y; V[v + 5] = P[i + 2] + d.z;
        // colour: the body's glow, plus RIM LIGHT on the outline of the hair mass (like the body's edge light):
        // a strand is on the outline when it points sideways to the camera, seen from the head (crown) or from the
        // vertical axis through the head (falling hair)
        const ox = P[i] - hc.x, oy = (P[i + 1] - hc.y) * (1 - u), oz = P[i + 2] - hc.z;
        const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1, bl = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z) || 1;
        const facing = Math.abs((ox * b.x + oy * b.y + oz * b.z) / (ol * bl)), nf = 1 - facing;
        const rim = nf * nf * nf * (this.rimStrength ?? 0.6) * 0.8 * bright;
        const glow = 0.5 * bright, vc = (s * S + k) * 8;
        const alpha = Math.min(1, (0.55 + 0.35 * rim) * (1 - 0.7 * u));
        const r = this.colRoot.r * glow + this.colTip.r * rim;
        const gg = this.colRoot.g * glow + this.colTip.g * rim;
        const bb = this.colRoot.b * glow + this.colTip.b * rim;
        C[vc] = C[vc + 4] = r; C[vc + 1] = C[vc + 5] = gg; C[vc + 2] = C[vc + 6] = bb; C[vc + 3] = C[vc + 7] = alpha;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
