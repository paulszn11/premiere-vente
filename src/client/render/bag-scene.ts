// Vue 3D du sac : le contenu du sac, des poches et des mains (et d'un corps ou d'un sac posé
// que l'on fouille) est posé sur une toile, vue de dessus, par-dessus le monde qui continue.
// Caméra orthogonale vue de dessus : passer de l'écran à la toile est un simple calcul linéaire
// (sélection au doigt ou à la souris, étiquettes, tests).

import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Scene } from '@babylonjs/core/scene';
import type { Container, ItemStack } from '../../shared/inventory';
import type { PropKind } from '../../shared/props';
import { buildItemMesh } from './item-meshes';

export type BagSlot =
  | { zone: 'poche'; index: number }
  | { zone: 'sac'; index: number }
  | { zone: 'main' }
  | { zone: 'autre-poche'; index: number }
  | { zone: 'autre-sac'; index: number }
  | { zone: 'etabli'; index: number };

export interface BagModel {
  pockets: Array<ItemStack | null>;
  bag: ItemStack[] | null;
  hand: { kind: PropKind; radius: number; length: number } | null;
  other: Container | null;
  /** Plan de travail (pièces posées pour fabriquer). */
  bench: ItemStack[];
  /** Nom du contenant fouillé (« Son sac » par défaut ; coffre d'un véhicule). */
  otherLabel?: string;
}

export interface Cell {
  slot: BagSlot;
  x: number;
  z: number;
  kind: PropKind | null;
  count: number;
}

export interface AreaLabel {
  text: string;
  x: number;
  z: number;
}

const C = 0.3;
const BAG_COLS = 6;
const KINDS: PropKind[] = [
  'pierre',
  'baton',
  'chiffon',
  'aloes',
  'fruit_baobab',
  'figue',
  'muhacha',
  'buche',
  'quartz',
  'ecorce',
  'fibres',
  'corde',
  'herbe',
  'ilala',
  'argile',
  'resine',
  'minerai_fer',
  'pepite_or',
  'manche',
  'perche',
  'couteau',
  'hache',
  'baton_fouir',
  'lance',
  'archet',
  'pot_cru',
  'pot',
  'batee',
  'pansement',
  'torche',
  'loupe_fer',
  'barre_fer',
  'clous',
  'boulons',
  'hache_fer',
  'couteau_fer',
  'viande_crue',
  'viande_cuite',
  'petite_roue',
  'essieu',
];
/** Objets longs (dessinés en travers de la case). */
const LONG: PropKind[] = ['baton', 'buche', 'manche', 'perche', 'lance', 'baton_fouir', 'hache', 'archet', 'couteau', 'ilala', 'ecorce', 'torche', 'hache_fer', 'couteau_fer', 'barre_fer', 'essieu'];

export function sameSlot(a: BagSlot | null, b: BagSlot | null): boolean {
  if (!a || !b || a.zone !== b.zone) return false;
  return a.zone === 'main' || (a as { index: number }).index === (b as { index: number }).index;
}

export class BagScene {
  readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly templates = new Map<PropKind, Mesh>();
  private readonly itemMat: StandardMaterial;
  private readonly padMat: StandardMaterial;
  private readonly padSelMat: StandardMaterial;
  private readonly matMat: StandardMaterial;
  private readonly otherMatMat: StandardMaterial;
  private readonly benchMat: StandardMaterial;
  private readonly dim: Mesh;
  private dynamic: Array<Mesh | InstancedMesh> = [];
  private signature = '';
  cells: Cell[] = [];
  labels: AreaLabel[] = [];
  private selected: BagSlot | null = null;
  private bounds = { minX: 0, maxX: 1, minZ: -1, maxZ: 0 };
  /** Rectangle d'affichage (pixels CSS, relatif à la fenêtre). */
  private rect = { left: 0, top: 0, width: 1, height: 1 };
  private ortho = { left: -1, right: 1, top: 1, bottom: -1 };

  constructor(
    engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.autoClear = false;
    scene.autoClearDepthAndStencil = true;
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.skipPointerMovePicking = true;
    this.camera = new FreeCamera('vue du sac', new Vector3(0, 10, 0), scene);
    this.camera.inputs.clear();
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.rotation.set(Math.PI / 2, 0, 0);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 30;
    const sky = new HemisphericLight('lumière du sac', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.85;
    sky.groundColor = new Color3(0.3, 0.3, 0.3);
    const sun = new DirectionalLight('soleil du sac', new Vector3(-0.4, -1, 0.5), scene);
    sun.intensity = 0.5;

    const flat = (name: string, c: Color3, alpha = 1): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      return m;
    };
    this.itemMat = flat('objets du sac', Color3.White());
    this.padMat = flat('case', new Color3(0.34, 0.3, 0.23));
    this.padSelMat = flat('case choisie', new Color3(0.78, 0.63, 0.29));
    this.padSelMat.emissiveColor = new Color3(0.35, 0.28, 0.1);
    this.matMat = flat('toile', new Color3(0.55, 0.48, 0.36));
    this.otherMatMat = flat('toile du corps', new Color3(0.36, 0.31, 0.26));
    this.benchMat = flat('plan de travail', new Color3(0.46, 0.4, 0.3));
    const dimMat = flat('voile', Color3.Black(), 0.55);
    dimMat.disableLighting = true;
    this.dim = CreateBox('voile', { width: 200, height: 0.01, depth: 200 }, scene);
    this.dim.material = dimMat;
    this.dim.position.y = -0.2;
    for (const kind of KINDS) {
      const mesh = buildItemMesh(`modèle ${kind}`, kind, scene, this.itemMat);
      mesh.setEnabled(false);
      this.templates.set(kind, mesh);
    }
  }

  /** Rectangle de l'écran où dessiner la toile (pixels CSS). */
  setRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = { ...rect, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  setSelected(slot: BagSlot | null): void {
    this.selected = slot;
    this.signature = '';
  }

  /** Reconstruit les cases si le contenu a changé. */
  update(model: BagModel): void {
    const sig = JSON.stringify([model, this.selected]);
    if (sig === this.signature) return;
    this.signature = sig;
    for (const m of this.dynamic) m.dispose();
    this.dynamic = [];
    this.cells = [];
    this.labels = [];

    // Plan de travail (en haut), sac du joueur (grille), puis poches et main en dessous.
    for (let i = 0; i < BAG_COLS; i++) {
      const st = model.bench[i] ?? null;
      this.cells.push({ slot: { zone: 'etabli', index: i }, x: i * C + C / 2, z: 0.62 - C / 2, kind: st ? (st.item as PropKind) : null, count: st?.count ?? 0 });
    }
    this.labels.push({ text: 'Plan de travail', x: 0.02, z: 0.62 + 0.07 });
    this.addMat(-0.06, BAG_COLS * C + 0.06, 0.62 + 0.14, 0.62 - C - 0.06, this.benchMat);
    const bagCount = model.bag ? Math.max(model.bag.length + 1, BAG_COLS * 2) : 0;
    const bagRows = Math.ceil(bagCount / BAG_COLS);
    const top = 0;
    if (model.bag) {
      for (let i = 0; i < Math.min(bagCount, BAG_COLS * 8); i++) {
        const st = model.bag[i] ?? null;
        this.cells.push({ slot: { zone: 'sac', index: i }, x: (i % BAG_COLS) * C + C / 2, z: top - Math.floor(i / BAG_COLS) * C - C / 2, kind: st ? (st.item as PropKind) : null, count: st?.count ?? 0 });
      }
      this.labels.push({ text: 'Sac', x: 0.02, z: top + 0.07 });
    }
    const rowZ = top - bagRows * C - (model.bag ? 0.32 : 0.12) - C / 2;
    model.pockets.forEach((st, i) => {
      this.cells.push({ slot: { zone: 'poche', index: i }, x: i * C + C / 2, z: rowZ, kind: st ? (st.item as PropKind) : null, count: st?.count ?? 0 });
    });
    this.labels.push({ text: 'Poches', x: 0.02, z: rowZ + C / 2 + 0.07 });
    const handX = 4 * C + 0.25 + C / 2;
    this.cells.push({ slot: { zone: 'main' }, x: handX, z: rowZ, kind: model.hand?.kind ?? null, count: model.hand ? 1 : 0 });
    this.labels.push({ text: 'Main', x: handX - C / 2, z: rowZ + C / 2 + 0.07 });
    const playerW = Math.max(BAG_COLS * C, handX + C / 2);
    const playerBottom = rowZ - C / 2;
    this.addMat(-0.06, playerW + 0.06, top + 0.14, playerBottom - 0.06, this.matMat);

    // Contenu fouillé (corps ou sac posé), à droite.
    let maxX = playerW;
    let minZ = playerBottom;
    if (model.other) {
      const ox = playerW + 0.5;
      const o = model.other;
      let z = top;
      if (o.pockets.length > 0) {
        o.pockets.forEach((st, i) => {
          this.cells.push({ slot: { zone: 'autre-poche', index: i }, x: ox + i * C + C / 2, z: z - C / 2, kind: st ? (st.item as PropKind) : null, count: st?.count ?? 0 });
        });
        this.labels.push({ text: 'Ses poches', x: ox + 0.02, z: z + 0.07 });
        z -= C + 0.32;
      }
      if (o.bag) {
        const n = Math.max(o.bag.length, BAG_COLS);
        for (let i = 0; i < Math.min(n, BAG_COLS * 8); i++) {
          const st = o.bag[i] ?? null;
          this.cells.push({ slot: { zone: 'autre-sac', index: i }, x: ox + (i % BAG_COLS) * C + C / 2, z: z - Math.floor(i / BAG_COLS) * C - C / 2, kind: st ? (st.item as PropKind) : null, count: st?.count ?? 0 });
        }
        this.labels.push({ text: model.otherLabel ?? 'Son sac', x: ox + 0.02, z: z + 0.07 });
        z -= Math.ceil(n / BAG_COLS) * C;
      }
      maxX = ox + BAG_COLS * C;
      minZ = Math.min(minZ, z);
      this.addMat(ox - 0.06, maxX + 0.06, top + 0.14, z - 0.06, this.otherMatMat);
    }
    this.bounds = { minX: -0.15, maxX: maxX + 0.15, minZ: minZ - 0.15, maxZ: 0.62 + 0.25 };

    for (const cell of this.cells) {
      const sel = sameSlot(cell.slot, this.selected);
      const pad = CreateBox('case', { width: C * 0.88, height: 0.01, depth: C * 0.88 }, this.scene);
      pad.position.set(cell.x, 0.005, cell.z);
      pad.material = sel ? this.padSelMat : this.padMat;
      this.dynamic.push(pad);
      if (!cell.kind) continue;
      const tpl = this.templates.get(cell.kind);
      if (!tpl) continue;
      const inst = tpl.createInstance(`objet ${cell.kind}`);
      const ext = tpl.getBoundingInfo().boundingBox.extendSize;
      const size = Math.max(ext.x, ext.z) * 2;
      let scale = (C * 0.72) / Math.max(size, 1e-3);
      if (cell.kind === 'pierre') scale = (C * 0.6) / 2;
      // Bâtons, bûches, branches, perches : forme unitaire (longueur 1, rayon 1), mise à l'échelle.
      if (cell.kind === 'baton' || cell.kind === 'manche' || cell.kind === 'perche') inst.scaling.set(C * 1.05, 0.022, 0.022);
      else if (cell.kind === 'buche') inst.scaling.set(C * 0.9, 0.06, 0.06);
      else inst.scaling.setAll(scale);
      inst.rotation.y = LONG.includes(cell.kind) ? Math.PI / 4 : 0.3;
      inst.position.set(cell.x, 0.06, cell.z);
      this.dynamic.push(inst);
    }
  }

  private addMat(x0: number, x1: number, z0: number, z1: number, mat: StandardMaterial): void {
    const m = CreateBox('toile', { width: x1 - x0, height: 0.01, depth: z0 - z1 }, this.scene);
    m.position.set((x0 + x1) / 2, -0.01, (z0 + z1) / 2);
    m.material = mat;
    this.dynamic.push(m);
  }

  /** Cadre la toile dans le rectangle donné. */
  private fit(): void {
    const engine = this.scene.getEngine();
    const cw = this.canvas.clientWidth || 1;
    const ch = this.canvas.clientHeight || 1;
    const cr = this.canvas.getBoundingClientRect();
    const r = this.rect;
    const vx = (r.left - cr.left) / cw;
    const vy = 1 - (r.top - cr.top + r.height) / ch;
    this.camera.viewport = new Viewport(Math.max(0, vx), Math.max(0, vy), Math.min(1, r.width / cw), Math.min(1, r.height / ch));
    const b = this.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    const aspect = r.width / r.height;
    let halfW = w / 2;
    let halfH = h / 2;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    this.camera.position.set(cx, 10, cz);
    this.ortho = { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
    void engine;
  }

  render(): void {
    this.fit();
    this.scene.render();
  }

  /** Position à l'écran (pixels CSS, fenêtre) d'un point de la toile. */
  toScreen(x: number, z: number): { x: number; y: number } {
    const o = this.ortho;
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const u = (x - cx - o.left) / (o.right - o.left);
    const v = (cz + o.top - z) / (o.top - o.bottom);
    return { x: this.rect.left + u * this.rect.width, y: this.rect.top + v * this.rect.height };
  }

  /** Case sous un point de l'écran (pixels CSS, fenêtre). */
  slotAt(px: number, py: number): BagSlot | null {
    const o = this.ortho;
    const u = (px - this.rect.left) / this.rect.width;
    const v = (py - this.rect.top) / this.rect.height;
    const x = this.camera.position.x + o.left + u * (o.right - o.left);
    const z = this.camera.position.z + o.top - v * (o.top - o.bottom);
    for (const c of this.cells) if (Math.abs(x - c.x) <= C / 2 && Math.abs(z - c.z) <= C / 2) return c.slot;
    return null;
  }

  /** Case voisine dans une direction (navigation à la manette ou au clavier). */
  neighbor(from: BagSlot | null, dx: number, dz: number): BagSlot | null {
    const cur = this.cells.find((c) => sameSlot(c.slot, from)) ?? null;
    if (!cur) return this.cells[0]?.slot ?? null;
    let best: Cell | null = null;
    let bestScore = Infinity;
    for (const c of this.cells) {
      if (c === cur) continue;
      const ddx = c.x - cur.x;
      const ddz = c.z - cur.z;
      const along = ddx * dx + ddz * dz;
      if (along <= 0.01) continue;
      const across = Math.abs(ddx * dz - ddz * dx);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best?.slot ?? cur.slot;
  }

  dispose(): void {
    this.scene.dispose();
  }
}
