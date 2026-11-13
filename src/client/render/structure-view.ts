// Affichage des constructions (phase 5) : pièces terminées (instances), chantiers translucides,
// pilotis, portes ouvertes ou fermées, flammes des pièces qui brûlent, et fantôme du plan qu'on
// trace (vert : possible, rouge : impossible). Graphismes simples, comme le reste du prototype.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { type BuildState, GRID, LEVEL_H, PLANS, type Piece, type Placement, type PlanId, isDone, pieceTransform, stiltPosts, wallThickness } from '../../shared/building';
import { INSTALL_HALF, type InstallPropKind } from '../../shared/props';
import { FRAME_KINDS, type FrameKind } from '../../shared/vehicles';
import { buildFrameMesh } from './vehicle-view';
import { type Part, box, buildItemMesh, can, meshFromParts, rod } from './item-meshes';

const WOOD: [number, number, number] = [0.47, 0.34, 0.22];
const DARK_WOOD: [number, number, number] = [0.36, 0.26, 0.17];
const TWINE: [number, number, number] = [0.62, 0.52, 0.34];
const STONE: [number, number, number] = [0.55, 0.53, 0.5];
const DAGGA: [number, number, number] = [0.66, 0.47, 0.32];
const THATCH: [number, number, number] = [0.78, 0.66, 0.36];

/** Pyramide à base carrée (toit), dessinée à partir de sa base. */
function pyramid(base: number, height: number): VertexData {
  const vd = CreateCylinderVertexData({ height, diameterTop: 0, diameterBottom: base * Math.SQRT2, tessellation: 4 });
  vd.transform(Matrix.RotationY(Math.PI / 4).multiply(Matrix.Translation(0, height / 2, 0)));
  return vd;
}

/** Pièces de chaque gabarit, dans le repère de la pièce (base à l'origine, x le long du bord). */
function templateParts(key: string): Part[] {
  const H = LEVEL_H;
  switch (key) {
    case 'sol': {
      const parts: Part[] = [];
      for (let k = 0; k < 6; k++) {
        const z = -GRID / 2 + 0.17 + k * 0.333;
        const shade = k % 2 ? WOOD : DARK_WOOD;
        parts.push([rod(GRID, 0.3, 7, 0, -0.12, z), ...shade]);
      }
      parts.push([box(0.08, 0.06, GRID, -0.7, -0.01, 0), ...TWINE], [box(0.08, 0.06, GRID, 0.7, -0.01, 0), ...TWINE]);
      return parts;
    }
    case 'dallage': {
      const parts: Part[] = [];
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          const v = ((a * 3 + b) % 3) * 0.04;
          parts.push([box(0.62, 0.16, 0.62, -0.66 + a * 0.66, -0.08, -0.66 + b * 0.66, (a + b) * 0.07), STONE[0] - v, STONE[1] - v, STONE[2] - v]);
        }
      return parts;
    }
    case 'poteau':
      return [[can(H, 0.2, 8, H / 2), ...WOOD]];
    case 'mur:bois': {
      const parts: Part[] = [[can(H, 0.12, 6, H / 2), ...WOOD]];
      parts[0]![0].transform(Matrix.Translation(-0.95, 0, 0));
      const right = can(H, 0.12, 6, H / 2);
      right.transform(Matrix.Translation(0.95, 0, 0));
      parts.push([right, ...WOOD]);
      // Baguettes tressées.
      for (let k = 0; k < 9; k++) parts.push([box(GRID - 0.1, 0.18, 0.08, 0, 0.18 + k * 0.255, (k % 2 ? 0.02 : -0.02)), ...(k % 2 ? DARK_WOOD : WOOD)]);
      return parts;
    }
    case 'mur:torchis':
      return [
        [box(GRID, H, wallThickness('torchis'), 0, H / 2, 0), ...DAGGA],
        [box(GRID + 0.02, 0.1, wallThickness('torchis') + 0.02, 0, 0.05, 0), 0.5, 0.36, 0.26],
      ];
    case 'mur:pierre': {
      const parts: Part[] = [];
      const t = wallThickness('pierre');
      // Assises de pierres, sans mortier.
      for (let row = 0; row < 6; row++) {
        const y = 0.2 + row * 0.4;
        const off = row % 2 ? 0.25 : 0;
        for (let k = 0; k < 4; k++) {
          const x = -GRID / 2 + 0.25 + off + k * 0.5;
          if (x > GRID / 2 - 0.2) continue;
          const v = ((row + k) % 3) * 0.035;
          parts.push([box(0.48, 0.38, t, x, y, 0), STONE[0] - v, STONE[1] - v, STONE[2] - v]);
        }
      }
      return parts;
    }
    case 'porte:cadre':
      return [
        [box(0.5, H, 0.16, -0.75, H / 2, 0), ...WOOD],
        [box(0.5, H, 0.16, 0.75, H / 2, 0), ...WOOD],
        [box(1, H - 2, 0.16, 0, 2 + (H - 2) / 2, 0), ...DARK_WOOD],
      ];
    case 'porte:battant': {
      // Charnière à l'origine, le battant s'étend vers +x.
      const parts: Part[] = [];
      for (let k = 0; k < 6; k++) parts.push([box(0.16, 2, 0.07, 0.08 + k * 0.165, 1, 0), ...(k % 2 ? WOOD : DARK_WOOD)]);
      parts.push([box(1, 0.08, 0.09, 0.5, 0.5, 0), ...TWINE], [box(1, 0.08, 0.09, 0.5, 1.5, 0), ...TWINE]);
      return parts;
    }
    case 'toit':
      return [
        [pyramid(GRID + 0.5, 1.3), ...THATCH],
        [box(GRID + 0.1, 0.08, 0.08, 0, 0.02, -GRID / 2), ...DARK_WOOD],
        [box(GRID + 0.1, 0.08, 0.08, 0, 0.02, GRID / 2), ...DARK_WOOD],
      ];
    case 'echelle': {
      const parts: Part[] = [
        [box(0.07, H, 0.07, -0.26, H / 2, 0.12), ...WOOD],
        [box(0.07, H, 0.07, 0.26, H / 2, 0.12), ...WOOD],
      ];
      for (let k = 0; k < 7; k++) parts.push([box(0.56, 0.05, 0.05, 0, 0.25 + k * 0.32, 0.12), ...DARK_WOOD]);
      return parts;
    }
    case 'cloture': {
      const parts: Part[] = [];
      for (let k = 0; k < 7; k++) {
        const x = -GRID / 2 + 0.15 + k * 0.28;
        parts.push([box(0.06, 1.3, 0.06, x, 0.6, 0, 0, k % 2 ? 0.35 : -0.35), ...(k % 2 ? DARK_WOOD : WOOD)]);
      }
      parts.push([box(GRID, 0.06, 0.06, 0, 0.9, 0), 0.4, 0.42, 0.24]);
      return parts;
    }
    case 'pilotis':
      // Cylindre unitaire (hauteur 1, de y = 0 à y = 1), mis à l'échelle.
      return [[can(1, 0.16, 6, 0.5), ...DARK_WOOD]];
    default:
      return [[box(1, 1, 1), 1, 0, 1]];
  }
}

const TEMPLATE_KEYS = ['sol', 'dallage', 'poteau', 'mur:bois', 'mur:torchis', 'mur:pierre', 'porte:cadre', 'porte:battant', 'toit', 'echelle', 'cloture', 'pilotis'] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Gabarits d'une pièce (plusieurs pour une porte). */
function keysFor(plan: PlanId, mat: Piece['mat']): TemplateKey[] {
  switch (PLANS[plan].piece) {
    case 'sol':
      return ['sol'];
    case 'dallage':
      return ['dallage'];
    case 'poteau':
      return ['poteau'];
    case 'mur':
      return [mat === 'pierre' ? 'mur:pierre' : mat === 'torchis' ? 'mur:torchis' : 'mur:bois'];
    case 'porte':
      return ['porte:cadre', 'porte:battant'];
    case 'toit':
      return ['toit'];
    case 'echelle':
      return ['echelle'];
    case 'cloture':
      return ['cloture'];
    default:
      return [];
  }
}


const tmpM = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

function writeMatrix(buf: Float32Array, i: number, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1): void {
  Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, tmpQ);
  tmpS.set(sx, sy, sz);
  tmpP.set(x, y, z);
  Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
  tmpM.copyToArray(buf, i * 16);
}

export class StructureView {
  private readonly solid = new Map<TemplateKey, Mesh>();
  private readonly ghost = new Map<TemplateKey, Mesh>();
  private readonly preview = new Map<string, Mesh>();
  private readonly siteMeshes = new Map<InstallPropKind, Mesh>();
  /** Chantiers de véhicules (châssis en cours). */
  private readonly frameSites = new Map<FrameKind, Mesh>();
  private readonly ghostMat: StandardMaterial;
  private readonly okMat: StandardMaterial;
  private readonly badMat: StandardMaterial;
  private readonly flames: Mesh;
  private builtVersion = -1;
  private center = { x: Number.NaN, z: Number.NaN };
  /** Pièces qui brûlent (pour les flammes et les lumières). */
  burning: Array<{ x: number; y: number; z: number }> = [];

  constructor(
    private readonly scene: Scene,
    material: StandardMaterial,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    const translucent = (name: string, color: Color3, alpha: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = color;
      m.emissiveColor = color.scale(0.45);
      m.specularColor = new Color3(0, 0, 0);
      m.alpha = alpha;
      m.backFaceCulling = false;
      return m;
    };
    this.ghostMat = translucent('chantier', new Color3(0.85, 0.82, 0.7), 0.35);
    this.okMat = translucent('plan possible', new Color3(0.35, 0.9, 0.45), 0.45);
    this.badMat = translucent('plan impossible', new Color3(0.95, 0.3, 0.25), 0.45);
    for (const key of TEMPLATE_KEYS) {
      const m = meshFromParts(`construction ${key}`, templateParts(key), scene, material);
      m.isVisible = false;
      m.alwaysSelectAsActiveMesh = true;
      this.solid.set(key, m);
      const g = meshFromParts(`chantier ${key}`, templateParts(key), scene, this.ghostMat);
      g.isVisible = false;
      g.alwaysSelectAsActiveMesh = true;
      this.ghost.set(key, g);
    }
    for (const kind of Object.keys(INSTALL_HALF) as InstallPropKind[]) {
      const m = buildItemMesh(`chantier ${kind}`, kind, scene, this.ghostMat);
      m.isVisible = false;
      m.alwaysSelectAsActiveMesh = true;
      this.siteMeshes.set(kind, m);
    }
    for (const frame of FRAME_KINDS) {
      const m = buildFrameMesh(`chantier ${frame}`, frame, scene, this.ghostMat);
      m.isVisible = false;
      m.alwaysSelectAsActiveMesh = true;
      this.frameSites.set(frame, m);
    }
    const flameMat = new StandardMaterial('incendie', scene);
    flameMat.emissiveColor = new Color3(1, 0.5, 0.1);
    flameMat.diffuseColor = new Color3(0, 0, 0);
    flameMat.disableLighting = true;
    this.flames = new Mesh('incendie', scene);
    CreateCylinderVertexData({ height: 1.4, diameterTop: 0, diameterBottom: 1.1, tessellation: 6 }).applyToMesh(this.flames);
    this.flames.material = flameMat;
    this.flames.isPickable = false;
    this.flames.isVisible = false;
    this.flames.alwaysSelectAsActiveMesh = true;
  }

  /** Reconstruit les instances si les constructions ont changé (ou si la caméra s'est éloignée). */
  update(bs: BuildState, camX: number, camZ: number, time: number): void {
    const moved = !(Math.hypot(camX - this.center.x, camZ - this.center.z) < 60);
    if (bs.version !== this.builtVersion || moved) {
      this.builtVersion = bs.version;
      this.center = { x: camX, z: camZ };
      this.rebuild(bs, camX, camZ);
    }
    // Les flammes vacillent.
    if (this.burning.length) {
      const buf = new Float32Array(this.burning.length * 16);
      this.burning.forEach((b, i) => {
        const k = 0.85 + 0.2 * Math.sin(time * 7 + b.x);
        writeMatrix(buf, i, b.x, b.y, b.z, b.z, k, 0.9 + 0.3 * Math.sin(time * 9 + b.z), k);
      });
      this.flames.thinInstanceSetBuffer('matrix', buf, 16, false);
      this.flames.isVisible = true;
    } else this.flames.isVisible = false;
  }

  private rebuild(bs: BuildState, camX: number, camZ: number): void {
    const solid = new Map<TemplateKey, number[][]>();
    const ghost = new Map<TemplateKey, number[][]>();
    const push = (map: Map<TemplateKey, number[][]>, key: TemplateKey, m: number[]) => {
      let l = map.get(key);
      if (!l) map.set(key, (l = []));
      l.push(m);
    };
    this.burning = [];
    for (const s of bs.structures) {
      if (Math.hypot(s.x - camX, s.z - camZ) > 300) continue;
      for (const p of s.pieces) {
        const t = pieceTransform(s, p.slot);
        const done = isDone(p);
        const target = done ? solid : ghost;
        for (const key of keysFor(p.plan, p.mat)) {
          if (key === 'porte:battant') {
            // Charnière au montant gauche ; ouverte, le battant pivote vers l'intérieur.
            const c = Math.cos(t.yaw);
            const n = Math.sin(t.yaw);
            push(target, key, [t.x - 0.5 * c, t.y, t.z + 0.5 * n, t.yaw + (p.open ? -Math.PI / 2 : 0)]);
          } else push(target, key, [t.x, t.y, t.z, t.yaw]);
        }
        if (p.stilts > 0) for (const post of stiltPosts(s, p, this.heightAt)) push(target, 'pilotis', [post.x, post.bottom, post.z, 0, post.top - post.bottom]);
        if (p.burning > 0) this.burning.push({ x: t.x, y: t.y + (p.slot.t === 'f' ? 0.1 : p.slot.t === 'r' ? 0.5 : 0.9), z: t.z });
      }
    }
    const fill = (meshes: Map<TemplateKey, Mesh>, lists: Map<TemplateKey, number[][]>) => {
      for (const [key, mesh] of meshes) {
        const list = lists.get(key);
        if (!list?.length) {
          mesh.isVisible = false;
          continue;
        }
        const buf = new Float32Array(list.length * 16);
        list.forEach((v, i) => writeMatrix(buf, i, v[0]!, v[1]!, v[2]!, v[3]!, 1, v[4] ?? 1, 1));
        mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
        mesh.isVisible = true;
      }
    };
    fill(this.solid, solid);
    fill(this.ghost, ghost);
    // Chantiers d'installation.
    for (const [kind, mesh] of this.siteMeshes) {
      const list = bs.sites.filter((x) => PLANS[x.plan].install === kind && Math.hypot(x.x - camX, x.z - camZ) < 300);
      if (!list.length) {
        mesh.isVisible = false;
        continue;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((x, i) => writeMatrix(buf, i, x.x, x.y + INSTALL_HALF[kind], x.z, x.yaw));
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      mesh.isVisible = true;
    }
    // Chantiers de véhicules : le châssis, en transparence.
    for (const [frame, mesh] of this.frameSites) {
      const list = bs.sites.filter((x) => PLANS[x.plan].vehicle === frame && Math.hypot(x.x - camX, x.z - camZ) < 300);
      if (!list.length) {
        mesh.isVisible = false;
        continue;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((x, i) => writeMatrix(buf, i, x.x, x.y, x.z, x.yaw));
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      mesh.isVisible = true;
    }
  }

  /** Fantôme du plan qu'on trace (null : rien). */
  setPreview(pl: Placement | null): void {
    for (const m of this.preview.values()) m.isVisible = false;
    if (!pl) return;
    const def = PLANS[pl.plan];
    const mat = pl.ok ? this.okMat : this.badMat;
    const w = pl.world;
    if (def.vehicle) {
      const key = `vehicule:${def.vehicle}:${pl.ok ? 'ok' : 'non'}`;
      let m = this.preview.get(key);
      if (!m) {
        m = buildFrameMesh(`plan ${key}`, def.vehicle, this.scene, mat);
        this.preview.set(key, m);
      }
      m.position.set(w.x, w.y, w.z);
      m.rotation.set(0, w.yaw, 0);
      m.isVisible = true;
      return;
    }
    if (def.install) {
      const key = `install:${def.install}:${pl.ok ? 'ok' : 'non'}`;
      let m = this.preview.get(key);
      if (!m) {
        m = buildItemMesh(`plan ${key}`, def.install, this.scene, mat);
        this.preview.set(key, m);
      }
      m.position.set(w.x, w.y + INSTALL_HALF[def.install], w.z);
      m.rotation.set(0, w.yaw, 0);
      m.isVisible = true;
      return;
    }
    keysFor(pl.plan, def.material).forEach((tk, n) => {
      const key = `${tk}:${pl.ok ? 'ok' : 'non'}:${n}`;
      let m = this.preview.get(key);
      if (!m) {
        m = meshFromParts(`plan ${key}`, templateParts(tk), this.scene, mat);
        this.preview.set(key, m);
      }
      if (tk === 'porte:battant') m.position.set(w.x - 0.5 * Math.cos(w.yaw), w.y, w.z + 0.5 * Math.sin(w.yaw));
      else m.position.set(w.x, w.y, w.z);
      m.rotation.set(0, w.yaw, 0);
      m.isVisible = true;
    });
  }

  dispose(): void {
    for (const m of [...this.solid.values(), ...this.ghost.values(), ...this.preview.values(), ...this.siteMeshes.values(), ...this.frameSites.values()]) m.dispose();
    this.flames.dispose();
    this.ghostMat.dispose();
    this.okMat.dispose();
    this.badMat.dispose();
  }
}
