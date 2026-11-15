// A glowing whip / ribbon held in the dancer's hand: a verlet rope that swings with the hand, cracks on demand.
import * as THREE from "three";

export class Whip {
  constructor({ length = 1.2, segments = 26, radius = 0.006, color = "#ffd27a" } = {}) {
    this.n = segments;
    this.seg = length / segments;
    this.radius = radius;
    this.pos = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this.prev = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this.color = new THREE.Color(color);          // base colour (can be blended by the show)
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.started = false;
    this.glow = 1;
  }

  // shoot energy down the whip (a "crack"): sideways kick that travels to the tip
  crack(strength = 1) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    for (let i = 1; i <= this.n; i++) this.prev[i].addScaledVector(dir, -0.04 * strength * (i / this.n));
    this.glow = 2.5;
  }

  update(dt, handPos) {
    if (!this.started) {
      for (let i = 0; i <= this.n; i++) { this.pos[i].copy(handPos).y -= i * this.seg; this.prev[i].copy(this.pos[i]); }
      this.started = true;
    }
    const steps = 3, h = Math.min(dt, 1 / 30) / steps;
    const g = new THREE.Vector3(0, -9.81 * h * h, 0), tmp = new THREE.Vector3();
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i <= this.n; i++) {                       // verlet integration with air damping
        tmp.copy(this.pos[i]);
        this.pos[i].addScaledVector(tmp.clone().sub(this.prev[i]), 0.985).add(g);
        this.prev[i].copy(tmp);
      }
      this.pos[0].copy(handPos);                                 // handle follows the hand
      for (let k = 0; k < 10; k++) {                             // keep segment lengths
        for (let i = 0; i < this.n; i++) {
          const a = this.pos[i], b = this.pos[i + 1];
          tmp.subVectors(b, a);
          const d = tmp.length() || 1e-6, diff = (d - this.seg) / d;
          if (i === 0) b.addScaledVector(tmp, -diff);
          else { a.addScaledVector(tmp, 0.5 * diff); b.addScaledVector(tmp, -0.5 * diff); }
        }
      }
    }
    this.glow += (1 - this.glow) * Math.min(1, dt * 2);
    this.material.color.copy(this.color).multiplyScalar(this.glow);
    const curve = new THREE.CatmullRomCurve3(this.pos);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(curve, this.n * 2, this.radius, 5, false);
  }
}
