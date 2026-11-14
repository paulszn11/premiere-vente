// Affichage des autres joueurs (phase 8) : silhouette simple (corps, tête, bras, jambes) à la couleur du joueur,
// accroupie, nageant, couchée quand elle dort ou est à terre. Les positions reçues sont interpolées.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { MODE_CLIMB, MODE_SWIM } from '../../shared/movement';
import type { NetPlayerView } from '../../shared/replication';
import { meshFromParts, type Part } from './item-meshes';

function box(w: number, h: number, d: number, x: number, y: number, z: number): VertexData {
  const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

/** Couleur de vêtement stable pour un joueur (d'après son identifiant). */
function colorOf(id: string): [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const palette: Array<[number, number, number]> = [
    [0.62, 0.32, 0.18],
    [0.25, 0.4, 0.55],
    [0.45, 0.5, 0.22],
    [0.55, 0.45, 0.25],
    [0.5, 0.22, 0.3],
    [0.28, 0.5, 0.45],
    [0.6, 0.55, 0.4],
    [0.35, 0.3, 0.5],
  ];
  return palette[h % palette.length]!;
}

interface Avatar {
  mesh: Mesh;
  /** Positions interpolées. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  target: NetPlayerView;
  seen: number;
}

export class AvatarView {
  private readonly material: StandardMaterial;
  private readonly avatars = new Map<string, Avatar>();

  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial('joueurs', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.specularColor = new Color3(0.05, 0.05, 0.05);
  }

  private build(id: string): Mesh {
    const [r, g, b] = colorOf(id);
    const skin: [number, number, number] = [0.42, 0.28, 0.2];
    const parts: Part[] = [
      [box(0.38, 0.62, 0.22, 0, 1.12, 0), r, g, b],
      [box(0.36, 0.12, 0.24, 0, 0.78, 0), r * 0.7, g * 0.7, b * 0.7],
      [box(0.14, 0.78, 0.16, -0.1, 0.39, 0), 0.25, 0.22, 0.18],
      [box(0.14, 0.78, 0.16, 0.1, 0.39, 0), 0.25, 0.22, 0.18],
      [box(0.11, 0.6, 0.12, -0.26, 1.12, 0), r * 0.9, g * 0.9, b * 0.9],
      [box(0.11, 0.6, 0.12, 0.26, 1.12, 0), r * 0.9, g * 0.9, b * 0.9],
      [(() => {
        const h = CreateSphereVertexData({ diameter: 0.24, segments: 6 });
        h.transform(Matrix.Translation(0, 1.58, 0));
        return h;
      })(), ...skin],
      // Le regard (avant = +z) : un petit bandeau sombre.
      [box(0.16, 0.04, 0.04, 0, 1.6, 0.11), 0.1, 0.08, 0.06],
    ];
    const mesh = meshFromParts(`joueur ${id}`, parts, this.scene, this.material);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.rotationQuaternion = null;
    return mesh;
  }

  /** Met à jour la liste des joueurs visibles (dernier instantané reçu, ou état de la simulation chez l'hôte). */
  update(list: NetPlayerView[], dt: number, now: number): void {
    for (const p of list) {
      let a = this.avatars.get(p.id);
      if (!a) {
        a = { mesh: this.build(p.id), x: p.x, y: p.y, z: p.z, yaw: p.yaw, target: p, seen: now };
        this.avatars.set(p.id, a);
      }
      a.target = p;
      a.seen = now;
    }
    const k = Math.min(1, dt * 12);
    for (const [id, a] of this.avatars) {
      if (now - a.seen > 1500) {
        a.mesh.dispose();
        this.avatars.delete(id);
        continue;
      }
      const t = a.target;
      // Grand écart (téléportation, réapparition) : on replace d'un coup.
      if (Math.hypot(t.x - a.x, t.z - a.z) > 8) {
        a.x = t.x;
        a.y = t.y;
        a.z = t.z;
      } else {
        a.x += (t.x - a.x) * k;
        a.y += (t.y - a.y) * k;
        a.z += (t.z - a.z) * k;
      }
      let dy = t.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * k;
      const m = a.mesh;
      const down = t.asleep || t.state !== 'eveille';
      m.position.set(a.x, a.y, a.z);
      if (down) {
        // Couché sur le dos.
        m.rotation.set(-Math.PI / 2, a.yaw, 0);
        m.position.y = a.y + 0.15;
        m.scaling.set(1, 1, 1);
      } else if (t.mode === MODE_SWIM) {
        m.rotation.set(1.1, a.yaw, 0);
        m.position.y = a.y - 0.6;
        m.scaling.set(1, 1, 1);
      } else {
        m.rotation.set(0, a.yaw, 0);
        m.scaling.set(1, t.crouched ? 0.65 : 1, 1);
        if (t.mode === MODE_CLIMB) m.rotation.x = -0.15;
      }
    }
  }

  /** Joueur visé (à moins de 15 m, dans l'axe du regard) : son nom s'affiche. */
  aimed(x: number, y: number, z: number, yaw: number, pitch: number): NetPlayerView | null {
    const dx0 = Math.sin(yaw) * Math.cos(pitch);
    const dy0 = -Math.sin(pitch);
    const dz0 = Math.cos(yaw) * Math.cos(pitch);
    let best: NetPlayerView | null = null;
    let bestD = 15;
    for (const a of this.avatars.values()) {
      const px = a.x - x;
      const py = a.y + 1 - y;
      const pz = a.z - z;
      const d = Math.hypot(px, py, pz);
      if (d > bestD || d < 0.3) continue;
      const cos = (px * dx0 + py * dy0 + pz * dz0) / d;
      if (cos < Math.cos(Math.max(0.06, 0.6 / d))) continue;
      best = a.target;
      bestD = d;
    }
    return best;
  }

  dispose(): void {
    for (const a of this.avatars.values()) a.mesh.dispose();
    this.avatars.clear();
    this.material.dispose();
  }
}
