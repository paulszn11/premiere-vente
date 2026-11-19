// Roche des grottes et des galeries (phase 9) : les maillages des blocs proches de la caméra, calculés par le
// module partagé (les mêmes que pour la physique), affichés tant qu'on est près d'une grotte.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Terrain } from '../../shared/terrain';
import { groundColor } from './terrain-mesh';

export class CaveView {
  private readonly meshes = new Map<number, Mesh | null>();
  private readonly material: StandardMaterial;
  private lastCheck = -1e9;
  /** Blocs affichés (outils de test). */
  shown = 0;

  constructor(
    private readonly scene: Scene,
    private readonly terrain: Terrain,
  ) {
    const m = new StandardMaterial('roche des grottes', scene);
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    // Les torches et les feux éclairent la roche : jusqu'à six lumières à la fois.
    m.maxSimultaneousLights = 6;
    this.material = m;
  }

  /**
   * Affiche les blocs à moins de `radius` m de la caméra ; les maillages sont calculés au besoin (au plus
   * `budgetMs` par image, sauf tout près, où il faut la roche tout de suite).
   */
  update(x: number, z: number, radius: number, now: number, budgetMs: number): void {
    if (!this.terrain.floraEnabled) return;
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    const caves = this.terrain.caves;
    const keys = caves.blocksNear(x, z, radius);
    const want = new Set(keys);
    for (const [k, m] of this.meshes) {
      if (want.has(k)) continue;
      m?.dispose();
      this.meshes.delete(k);
    }
    const t0 = performance.now();
    for (const k of keys) {
      if (this.meshes.has(k)) continue;
      if (!caves.hasMesh(k) && performance.now() - t0 > budgetMs) continue;
      const data = caves.blockMesh(k);
      let mesh: Mesh | null = null;
      if (data) {
        mesh = new Mesh(`roche ${k}`, this.scene);
        const vd = new VertexData();
        vd.positions = data.positions;
        vd.normals = data.normals;
        // Autour d'une entrée, le sol remplacé prend exactement la couleur du sol voisin.
        const colors = Float32Array.from(data.colors);
        const pos = data.positions;
        for (let i = 0; i < pos.length / 3; i++) {
          const px = pos[i * 3]!;
          const py = pos[i * 3 + 1]!;
          const pz = pos[i * 3 + 2]!;
          if (Math.abs(py - this.terrain.heightAt(px, pz)) > 0.06) continue;
          groundColor(this.terrain.sampleInto(px, pz), py, data.normals[i * 3 + 1]!, px, pz, colors, i * 4);
        }
        vd.colors = colors;
        vd.indices = data.indices;
        vd.applyToMesh(mesh);
        mesh.material = this.material;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
      }
      this.meshes.set(k, mesh);
    }
    let n = 0;
    for (const m of this.meshes.values()) if (m) n++;
    this.shown = n;
  }

  dispose(): void {
    for (const m of this.meshes.values()) m?.dispose();
    this.meshes.clear();
    this.material.dispose();
  }
}
