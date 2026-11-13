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

export type Part = [VertexData, number, number, number];

export function colored(vd: VertexData, r: number, g: number, b: number): VertexData {
  const count = vd.positions!.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  vd.colors = colors;
  return vd;
}

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rotY = 0, rotZ = 0): VertexData {
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
export function rod(length: number, diameter: number, tess: number, x = 0, y = 0, z = 0, rotY = 0): VertexData {
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

/** Cylindre debout. */
export function can(height: number, diameter: number, tess: number, y = 0, top = diameter): VertexData {
  const vd = CreateCylinderVertexData({ height, diameterTop: top, diameterBottom: diameter, tessellation: tess });
  vd.transform(Matrix.Translation(0, y, 0));
  return vd;
}

const WOOD: [number, number, number] = [0.45, 0.33, 0.22];
const TWINE: [number, number, number] = [0.62, 0.52, 0.34];
const QUARTZ: [number, number, number] = [0.9, 0.9, 0.93];
const STONE: [number, number, number] = [0.5, 0.49, 0.46];
const IRON: [number, number, number] = [0.36, 0.37, 0.4];

/** Pièces de chaque objet, à l'échelle réelle (mètres). Gisements : taille 1, mis à l'échelle à l'affichage. */
export function itemParts(kind: PropKind): Part[] {
  switch (kind) {
    case 'pierre':
      return [[ball(2, 1.7, 1.9, 3), 0.52, 0.5, 0.47]];
    case 'buche':
    case 'tronc':
    case 'baton':
    case 'manche':
    case 'perche':
      return [[rod(1, 2, 7), ...WOOD]];
    case 'chiffon':
      return [
        [box(0.2, 0.012, 0.16), 0.82, 0.78, 0.66],
        [box(0.1, 0.012, 0.16, 0.04, 0.012, 0, 0.3), 0.76, 0.72, 0.6],
      ];
    case 'pansement':
      return [[box(0.1, 0.015, 0.08), 0.96, 0.96, 0.93]];
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
    case 'quartz':
      return [[box(0.05, 0.03, 0.035, 0, 0, 0, 0.4, 0.3), ...QUARTZ]];
    case 'ecorce':
      return [[box(0.5, 0.012, 0.1), 0.42, 0.36, 0.29]];
    case 'fibres':
      return [[box(0.1, 0.04, 0.1), 0.72, 0.62, 0.44]];
    case 'corde':
      return [[can(0.03, 0.14, 10), ...TWINE]];
    case 'herbe':
      return [
        [box(0.4, 0.05, 0.1), 0.78, 0.7, 0.36],
        [box(0.36, 0.04, 0.08, 0.02, 0.03, 0.02, 0.2), 0.72, 0.64, 0.3],
      ];
    case 'ilala':
      return [[box(0.8, 0.01, 0.3), 0.34, 0.5, 0.26]];
    case 'argile':
      return [[ball(0.12, 0.1, 0.12, 5), 0.6, 0.4, 0.28]];
    case 'resine':
      return [[ball(0.04, 0.035, 0.04, 4), 0.78, 0.5, 0.14]];
    case 'minerai_fer':
      return [[ball(0.15, 0.12, 0.14, 3), 0.44, 0.24, 0.18]];
    case 'pepite_or':
      return [[ball(0.025, 0.018, 0.022, 4), 0.92, 0.76, 0.24]];
    case 'couteau':
      return [
        [rod(0.2, 0.035, 6, -0.05), ...WOOD],
        [box(0.1, 0.012, 0.035, 0.1), ...QUARTZ],
        [rod(0.04, 0.042, 6, 0.04), ...TWINE],
      ];
    case 'hache':
      return [
        [rod(0.6, 0.04, 6), ...WOOD],
        [box(0.08, 0.07, 0.15, 0.24, 0, 0), ...STONE],
        [rod(0.06, 0.05, 6, 0.24), ...TWINE],
      ];
    case 'baton_fouir':
      return [
        [rod(0.8, 0.045, 6, -0.05), ...WOOD],
        [rod(0.1, 0.03, 4, 0.4), 0.55, 0.42, 0.28],
      ];
    case 'lance':
      return [
        [rod(1.8, 0.045, 6, -0.05), ...WOOD],
        [box(0.12, 0.012, 0.04, 0.9), ...QUARTZ],
        [rod(0.06, 0.055, 6, 0.83), ...TWINE],
      ];
    case 'archet':
      return [
        [rod(0.6, 0.025, 5), ...WOOD],
        [box(0.56, 0.006, 0.006, 0, 0.03, 0), ...TWINE],
        [box(0.25, 0.02, 0.06, 0, -0.03, 0.06), 0.55, 0.42, 0.28],
      ];
    case 'pot_cru':
      return [
        [can(0.18, 0.24, 10, -0.02, 0.18), 0.6, 0.46, 0.33],
        [can(0.04, 0.2, 10, 0.08), 0.56, 0.42, 0.3],
      ];
    case 'pot':
      return [
        [can(0.18, 0.24, 10, -0.02, 0.18), 0.72, 0.38, 0.22],
        [can(0.04, 0.2, 10, 0.08), 0.66, 0.34, 0.2],
      ];
    case 'batee':
      return [[can(0.06, 0.4, 12, 0, 0.36), 0.5, 0.36, 0.22]];
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
    // Gisements, à la taille 1 (mis à l'échelle à l'affichage).
    case 'bloc_quartz':
      return [
        [ball(0.9, 0.7, 0.8, 3), 0.86, 0.86, 0.88],
        [box(0.3, 0.25, 0.3, 0.2, 0.25, 0.1, 0.6, 0.3), ...QUARTZ],
      ];
    case 'filon_fer':
      return [
        [ball(0.9, 0.7, 0.8, 3), 0.42, 0.25, 0.19],
        [box(0.25, 0.2, 0.3, -0.2, 0.22, 0.1, 0.5, 0.2), 0.3, 0.18, 0.14],
      ];
    case 'touffe_herbe': {
      const parts: Part[] = [];
      for (let i = 0; i < 6; i++) parts.push([leaf((i / 6) * Math.PI * 2, 0.55 + (i % 3) * 0.1, 0.25 + (i % 2) * 0.2), 0.74, 0.66, 0.32]);
      return parts;
    }
    case 'gisement_argile':
      return [[can(0.05, 1, 12, 0.02, 0.9), 0.62, 0.42, 0.3]];
    case 'gravier_or':
      return [
        [can(0.04, 1, 12, 0.02, 0.9), 0.6, 0.56, 0.44],
        [ball(0.05, 0.03, 0.05, 3, 0.2, 0.05, 0.1), 0.85, 0.72, 0.3],
        [ball(0.04, 0.03, 0.04, 3, -0.25, 0.05, -0.15), 0.85, 0.72, 0.3],
      ];
    // Phase 5 : éclairage, fer.
    case 'torche':
      return [
        [rod(0.6, 0.04, 6, -0.03), ...WOOD],
        [rod(0.12, 0.07, 6, 0.26), 0.62, 0.5, 0.26],
      ];
    case 'loupe_fer':
      return [[ball(0.14, 0.1, 0.13, 3), 0.3, 0.27, 0.26]];
    case 'barre_fer':
      return [[box(0.35, 0.025, 0.03), ...IRON]];
    case 'clous':
      return [
        [box(0.06, 0.008, 0.008, 0, 0, 0), ...IRON],
        [box(0.06, 0.008, 0.008, 0, 0.01, 0.02, 0.5), ...IRON],
        [box(0.06, 0.008, 0.008, 0, 0.005, -0.02, -0.4), ...IRON],
      ];
    case 'boulons':
      return [
        [rod(0.08, 0.016, 6), ...IRON],
        [can(0.012, 0.035, 6, 0.0), ...IRON],
      ];
    case 'hache_fer':
      return [
        [rod(0.65, 0.04, 6), ...WOOD],
        [box(0.07, 0.06, 0.16, 0.26, 0, 0), ...IRON],
      ];
    case 'couteau_fer':
      return [
        [rod(0.12, 0.035, 6, -0.08), ...WOOD],
        [box(0.17, 0.008, 0.032, 0.07), ...IRON],
      ];
    // Installations (le centre du volume est l'origine).
    case 'coffre':
      return [
        [box(0.9, 0.5, 0.6, 0, -0.05), ...WOOD],
        [box(0.92, 0.1, 0.62, 0, 0.25), 0.4, 0.29, 0.19],
        [box(0.06, 0.12, 0.02, 0, 0.12, 0.31), ...TWINE],
      ];
    case 'etabli':
      return [
        [box(1.6, 0.12, 0.7, 0, 0.39), ...WOOD],
        [box(0.08, 0.8, 0.08, -0.7, -0.06, -0.28), ...WOOD],
        [box(0.08, 0.8, 0.08, 0.7, -0.06, -0.28), ...WOOD],
        [box(0.08, 0.8, 0.08, -0.7, -0.06, 0.28), ...WOOD],
        [box(0.08, 0.8, 0.08, 0.7, -0.06, 0.28), ...WOOD],
      ];
    case 'puits':
      return [
        [can(0.8, 1.4, 14, 0, 1.4), ...STONE],
        [can(0.82, 0.95, 14, 0.01, 0.95), 0.12, 0.2, 0.26],
      ];
    case 'fourneau':
      return [
        [can(0.5, 1.1, 10, -0.45, 1.1), ...STONE],
        [can(0.95, 0.9, 10, 0.25, 0.45), 0.62, 0.4, 0.27],
        [rod(0.5, 0.08, 6, 0.35, -0.5, 0, Math.PI / 2), 0.58, 0.38, 0.26],
      ];
    case 'forge':
      return [
        [box(1.2, 0.5, 0.8, 0, -0.15), ...STONE],
        [box(0.5, 0.35, 0.35, 0.3, 0.27, 0), 0.42, 0.42, 0.44],
        [can(0.12, 0.5, 8, 0.16), 0.6, 0.4, 0.27],
      ];
    case 'foyer': {
      const parts: Part[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push([ball(0.16, 0.12, 0.14, 3, Math.cos(a) * 0.36, -0.06, Math.sin(a) * 0.36), ...STONE]);
      }
      parts.push([rod(0.5, 0.06, 6, 0, -0.05, 0, 0.4), 0.3, 0.22, 0.15]);
      parts.push([rod(0.5, 0.06, 6, 0, -0.03, 0, -0.5), 0.3, 0.22, 0.15]);
      return parts;
    }
  }
}

/** Assemble des pièces colorées en un seul maillage. */
export function meshFromParts(name: string, parts: Part[], scene: Scene, material: StandardMaterial): Mesh {
  const [first, ...rest] = parts.map(([vd, r, g, b]) => colored(vd, r, g, b));
  const merged = rest.length ? first!.merge(rest, true) : first!;
  const mesh = new Mesh(name, scene);
  merged.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  return mesh;
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
