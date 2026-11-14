// Pluie, neige et éclairs (phase 9). Un seul dessin par couche : des traits disposés dans une boîte
// autour de la caméra, qui descendent et se répètent (deux copies décalées, sans trou).

import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';

const BOX = 26;
const HEIGHT = 22;

interface Layer {
  meshes: [LinesMesh, LinesMesh];
  speed: number;
  phase: number;
}

function layer(scene: Scene, name: string, count: number, len: number, color: Color3, alpha: number, seed: number): [LinesMesh, LinesMesh] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const lines: Vector3[][] = [];
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * BOX * 2;
    const z = (rnd() - 0.5) * BOX * 2;
    const y = rnd() * HEIGHT;
    lines.push([new Vector3(x, y, z), new Vector3(x, y + len, z)]);
  }
  const make = (k: number) => {
    const m = CreateLineSystem(`${name} ${k}`, { lines, useVertexAlpha: false }, scene);
    m.color = color;
    m.alpha = alpha;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.isVisible = false;
    return m;
  };
  return [make(0), make(1)];
}

export class PrecipView {
  private readonly rain: Layer;
  private readonly snow: Layer;
  private readonly bolts: Array<{ mesh: LinesMesh; until: number }> = [];

  constructor(private readonly scene: Scene) {
    this.rain = { meshes: layer(scene, 'pluie', 1400, 0.55, new Color3(0.7, 0.75, 0.82), 0.45, 7), speed: 11, phase: 0 };
    this.snow = { meshes: layer(scene, 'neige', 900, 0.06, new Color3(0.95, 0.96, 1), 0.9, 11), speed: 1.4, phase: 0 };
  }

  private place(l: Layer, x: number, y: number, z: number, level: number, dt: number, tiltX: number, tiltZ: number, wobble: number): void {
    l.phase = (l.phase + l.speed * dt) % HEIGHT;
    const visible = level > 0.02;
    // On suit la caméra par pas entiers de la boîte : les traits ne glissent pas quand on marche.
    const bx = Math.round(x / 2) * 2;
    const bz = Math.round(z / 2) * 2;
    l.meshes.forEach((m, k) => {
      m.isVisible = visible;
      if (!visible) return;
      m.position.set(bx + wobble, y - HEIGHT * 0.6 - l.phase + k * HEIGHT, bz + wobble * 0.6);
      m.rotation.set(tiltZ, 0, -tiltX);
      m.alpha = Math.min(1, 0.12 + level * 0.6);
    });
  }

  /**
   * Met à jour la pluie et la neige autour de la caméra. `rain` et `snow` de 0 à 1 ; le vent (m/s, cap)
   * incline les traits.
   */
  update(x: number, y: number, z: number, rain: number, snow: number, windSpeed: number, windDir: number, dt: number, now: number): void {
    const tilt = Math.min(0.5, windSpeed * 0.03);
    const tx = Math.sin(windDir) * tilt;
    const tz = Math.cos(windDir) * tilt;
    this.place(this.rain, x, y, z, rain, dt, tx, tz, 0);
    this.place(this.snow, x, y, z, snow, dt, tx * 0.5, tz * 0.5, Math.sin(now * 0.0007) * 0.6);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      if (now > b.until) {
        b.mesh.dispose();
        this.bolts.splice(i, 1);
      } else b.mesh.isVisible = Math.floor(now / 45) % 3 !== 1;
    }
  }

  /** Un éclair, du ciel jusqu'au point frappé (visible un instant). */
  bolt(x: number, y: number, z: number, now: number): void {
    const pts: Vector3[] = [];
    let px = x;
    let pz = z;
    const top = y + 260;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(new Vector3(px, top + (y - top) * t, pz));
      px += (Math.random() - 0.5) * 9;
      pz += (Math.random() - 0.5) * 9;
    }
    pts[pts.length - 1] = new Vector3(x, y, z);
    const mesh = CreateLineSystem('éclair', { lines: [pts], colors: [pts.map(() => new Color4(0.92, 0.95, 1, 1))] }, this.scene);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.bolts.push({ mesh, until: now + 260 });
  }

  dispose(): void {
    for (const m of [...this.rain.meshes, ...this.snow.meshes]) m.dispose();
    for (const b of this.bolts) b.mesh.dispose();
    this.bolts.length = 0;
  }
}
