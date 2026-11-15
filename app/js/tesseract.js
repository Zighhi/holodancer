// The tesseract (hypercube): a 4D cube turning through the 4th dimension, shown as its 3D projection - two cubes, one
// inside the other, that keep turning inside out. 16 corners (all +-1 in x, y, z, w), 32 edges (corners that differ
// in one coordinate). Rotations in the xw, yw and zw planes (the 4D ones) + a slow xy turn; then a perspective
// projection from 4D (the farther along w, the smaller). Edges are glowing tubes, corners small spheres (instanced:
// real thickness on the hologram, where 1-pixel lines would vanish).
import * as THREE from "three";

export const CORNERS = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
export const EDGES = [];
for (let i = 0; i < 16; i++) for (let d = 0; d < 4; d++) if (!(i & (1 << d))) EDGES.push([i, i | (1 << d)]);

// the classic animation: one steady rotation in the xw plane (the inner cube flows out and becomes the outer one,
// over and over), seen from a fixed tilt that slowly turns: [x, y, z, w] per corner
export function classic(theta, yaw = 0, tilt = 0.42) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  return project([theta, 0, 0, 0]).map(([x, y, z, w]) => {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;          // turn around the vertical
    return [x1, y * ct - z1 * st, y * st + z1 * ct, w];          // tilt towards the viewer
  });
}

// the 16 corners turned by the angles a = [xw, yw, zw, xy] and projected to 3D: [x, y, z, w] per corner (w kept for colour)
export function project(a, dist = 3) {
  const [cxw, sxw, cyw, syw, czw, szw, cxy, sxy] = [Math.cos(a[0]), Math.sin(a[0]), Math.cos(a[1]), Math.sin(a[1]),
    Math.cos(a[2]), Math.sin(a[2]), Math.cos(a[3]), Math.sin(a[3])];
  return CORNERS.map(([x0, y0, z0, w0]) => {
    let x = x0, y = y0, z = z0, w = w0, t;
    t = x * cxw - w * sxw; w = x * sxw + w * cxw; x = t;
    t = y * cyw - w * syw; w = y * syw + w * cyw; y = t;
    t = z * czw - w * szw; w = z * szw + w * czw; z = t;
    t = x * cxy - y * sxy; y = x * sxy + y * cxy; x = t;
    const k = 1 / (dist - w);
    return [x * k, y * k, z * k, w];
  });
}

export class Tesseract {
  constructor({ radius = 0.012, joint = 0.03 } = {}) {
    this.group = new THREE.Group();
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false });
    this.tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), mat(), EDGES.length);
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat(), 16);
    for (const m of [this.tubes, this.joints]) {
      m.frustumCulled = false; m.renderOrder = 8;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());                     // (creates the colour buffer)
    }
    this.group.add(this.tubes, this.joints);
    this.radius = radius; this.joint = joint;
    this.theta = 0; this.yaw = 0.5;
    this.c1 = new THREE.Color("#ffc94d"); this.c2 = new THREE.Color("#4fd8ff"); this.c3 = new THREE.Color("#ff5fa2");
    this.pulse = 0;
    this.group.visible = false;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._col = new THREE.Color();
  }

  setColors(P, k) {
    this.c1.lerp(new THREE.Color(P.rim), k); this.c2.lerp(new THREE.Color(P.accents[1]), k); this.c3.lerp(new THREE.Color(P.accents[0]), k);
  }

  // a kick / drop: the corners flare
  hit(s = 1) { this.pulse = Math.max(this.pulse, s); }

  // a: { level 0..1, bps (beats per second: a quarter turn through 4D per bar), kick }
  update(dt, a) {
    this.group.visible = a.level > 0.003;
    this.pulse = Math.max(0, this.pulse - dt * 2.5);
    this.theta += dt * (Math.PI / 2) * (a.bps ?? 2) / 4 * (a.speed ?? 1);   // inner -> outer once a bar
    this.yaw += dt * 0.08;
    if (!this.group.visible) return;
    const P = classic(this.theta, this.yaw), lvl = a.level * (0.55 + 0.35 * (a.kick ?? 0)), r = this.radius * (1 + 0.3 * (a.kick ?? 0));
    EDGES.forEach(([i, j], e) => {
      const A = P[i], B = P[j];
      this._v.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      const len = this._v.length();
      this._q.setFromUnitVectors(this._up, this._v.normalize());
      this._m.compose(this._s.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), this._q, new THREE.Vector3(r, len, r));
      this.tubes.setMatrixAt(e, this._m);
      const wv = ((A[3] + B[3]) / 2 + 1) / 2;                  // inner cube (far in w) one colour, outer the other
      this.tubes.setColorAt(e, this._col.copy(this.c2).lerp(this.c1, wv).multiplyScalar(lvl));
    });
    P.forEach((p, i) => {
      const s = this.joint * (1 + 1.2 * this.pulse) * (0.6 + 0.4 * (p[3] + 1) / 2);
      this._m.compose(this._s.set(p[0], p[1], p[2]), this._q.identity(), new THREE.Vector3(s, s, s));
      this.joints.setMatrixAt(i, this._m);
      this.joints.setColorAt(i, this._col.copy(this.c3).lerp(new THREE.Color(1, 1, 1), 0.3 * this.pulse).multiplyScalar(lvl * (0.8 + this.pulse)));
    });
    this.tubes.instanceMatrix.needsUpdate = this.joints.instanceMatrix.needsUpdate = true;
    this.tubes.instanceColor.needsUpdate = this.joints.instanceColor.needsUpdate = true;
  }
}
