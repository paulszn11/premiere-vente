// Formes 3D très simples des objets (graphismes soignés plus tard), partagées par l'affichage
// du monde (instances) et par la vue du sac. Couleurs par sommet, un seul matériau.

import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { PropKind } from '../../shared/props';

type Part = [VertexData, number, number, number];

function colored(vd: VertexData, r: number, g: number, b: number): VertexData {
  const count = vd.positions!.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  vd.colors = colors;
  return vd;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rotY = 0, rotZ = 0): VertexData {
  const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
  vd.transform(Matrix.RotationYawPitchRoll(rotY, 0, rotZ).multiply(Matrix.Translation(x, y, z)));
  return vd;
}

function ball(dx: number, dy: number, dz: number, segments: number, x = 0, y = 0, z = 0): VertexData {
  const vd = CreateSphereVertexData({ diameterX: dx, diameterY: dy, diameterZ: dz, segments });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

/** Cylindre couché le long de l'axe X. */
function rod(length: number, diameter: number, tess: number, x = 0, y = 0, z = 0, rotY = 0): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameter, tessellation: tess });
  vd.transform(Matrix.RotationZ(Math.PI / 2).multiply(Matrix.RotationY(rotY)).multiply(Matrix.Translation(x, y, z)));
  return vd;
}

/** Feuille d'aloès : cône allongé, incliné vers l'extérieur. */
function leaf(angle: number, length: number, tilt: number): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameterTop: 0, diameterBottom: length * 0.22, tessellation: 4 });
  vd.transform(Matrix.Translation(0, length / 2, 0).multiply(Matrix.RotationZ(-tilt)).multiply(Matrix.RotationY(angle)));
  return vd;
}

const SKIN: [number, number, number] = [0.42, 0.29, 0.21];
const CLOTH: [number, number, number] = [0.27, 0.32, 0.4];

/** Pièces de chaque objet, à l'échelle réelle (mètres). */
export function itemParts(kind: PropKind): Part[] {
  switch (kind) {
    case 'pierre':
      return [[ball(2, 1.7, 1.9, 3), 0.52, 0.5, 0.47]];
    case 'buche':
    case 'tronc':
    case 'baton':
      return [[rod(1, 2, 7), 0.45, 0.33, 0.22]];
    case 'chiffon':
      return [
        [box(0.2, 0.012, 0.16), 0.82, 0.78, 0.66],
        [box(0.1, 0.012, 0.16, 0.04, 0.012, 0, 0.3), 0.76, 0.72, 0.6],
      ];
    case 'aloes': {
      const parts: Part[] = [];
      for (let i = 0; i < 7; i++) parts.push([leaf((i / 7) * Math.PI * 2, 0.22 + (i % 3) * 0.04, 0.55 + (i % 2) * 0.25), 0.36, 0.5, 0.38]);
      parts.push([ball(0.05, 0.03, 0.05, 3, 0, 0.02, 0), 0.5, 0.25, 0.2]);
      // Le centre de la boîte de collision est à 7 cm du sol.
      for (const pt of parts) pt[0].transform(Matrix.Translation(0, -0.07, 0));
      return parts;
    }
    case 'fruit_baobab':
      return [
        [ball(0.12, 0.11, 0.2, 6), 0.55, 0.52, 0.32],
        [rod(0.05, 0.012, 4, 0, 0, 0.12, Math.PI / 2), 0.4, 0.3, 0.2],
      ];
    case 'figue':
      return [[ball(0.044, 0.05, 0.044, 5), 0.45, 0.2, 0.25]];
    case 'muhacha':
      return [[ball(0.05, 0.045, 0.05, 5), 0.66, 0.42, 0.18]];
    case 'sac':
      return [
        [box(0.34, 0.44, 0.2), 0.36, 0.38, 0.22],
        [box(0.35, 0.16, 0.21, 0, 0.17, 0.005), 0.3, 0.32, 0.18],
        [box(0.28, 0.16, 0.06, 0, -0.08, 0.12), 0.32, 0.34, 0.2],
      ];
    case 'corps':
      // Allongé le long de l'axe X, posé au sol (la capsule de collision a 28 cm de rayon).
      return [
        [box(0.62, 0.22, 0.36, 0.05, -0.16), ...CLOTH],
        [ball(0.22, 0.22, 0.22, 5, 0.48, -0.15, 0), ...SKIN],
        [box(0.72, 0.16, 0.13, -0.6, -0.19, 0.1), ...CLOTH],
        [box(0.72, 0.16, 0.13, -0.6, -0.19, -0.1), ...CLOTH],
        [box(0.5, 0.1, 0.1, 0.1, -0.2, 0.25), ...SKIN],
        [box(0.5, 0.1, 0.1, 0.1, -0.2, -0.25), ...SKIN],
      ];
  }
}

/** Construit le maillage d'un objet (à l'échelle réelle). */
export function buildItemMesh(name: string, kind: PropKind, scene: Scene, material: StandardMaterial): Mesh {
  const [first, ...rest] = itemParts(kind).map(([vd, r, g, b]) => colored(vd, r, g, b));
  const merged = rest.length ? first!.merge(rest, true) : first!;
  const mesh = new Mesh(name, scene);
  merged.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  return mesh;
}
