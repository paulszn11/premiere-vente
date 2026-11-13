// Affichage du monde : terrain chargé progressivement par chunks autour de la caméra
// (calculé dans un fil séparé), plusieurs niveaux de détail, flore par biome (instances),
// rochers, termitières, eau, lumière, brouillard et objets déplaçables.
// Graphismes volontairement simples pour l'instant.

import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CHUNK_SIZE, WATER_LEVEL } from '../../shared/constants';
import type { PropView } from '../../shared/interaction';
import type { PropKind } from '../../shared/props';
import { type Terrain, chunkCoord, chunkKey } from '../../shared/terrain';
import { type ChunkFlora, SPECIES, SPECIES_LIST, type Species } from '../../shared/vegetation';
import type { QualityParams } from '../settings';
import { buildItemMesh } from './item-meshes';
import type { ChunkJobResult, TerrainJobs } from './terrain-jobs';

const SKY = new Color3(0.62, 0.74, 0.86);

/** Objets affichés à leur taille réelle (les bâtons, bûches, branches et perches utilisent la forme des bûches). */
const ITEM_RENDER_KINDS: PropKind[] = [
  'chiffon',
  'aloes',
  'fruit_baobab',
  'figue',
  'muhacha',
  'sac',
  'corps',
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
  'couteau',
  'hache',
  'baton_fouir',
  'lance',
  'archet',
  'pot_cru',
  'pot',
  'batee',
  'pansement',
  'foyer',
  'torche',
  'loupe_fer',
  'barre_fer',
  'clous',
  'boulons',
  'hache_fer',
  'couteau_fer',
  'coffre',
  'etabli',
  'puits',
  'fourneau',
  'forge',
  // Phase 6 : viande et pièges (les carcasses sont dessinées par l'affichage des créatures).
  'viande_crue',
  'viande_cuite',
  'collet',
  'assommoir',
  'fosse',
  // Phase 7 : pièces de véhicules.
  'petite_roue',
  'roue',
  'essieu',
  'machine_vapeur',
  'roue_aubes',
  'gouvernail',
  // Machines.
  'roue_eau',
  'machine_fixe',
  'meule',
  'soufflet_meca',
  'pompe',
];
const NODE_RENDER_KINDS: PropKind[] = ['bloc_quartz', 'filon_fer', 'touffe_herbe', 'gisement_argile', 'gravier_or'];
const UNDERWATER = new Color3(0.05, 0.2, 0.24);

interface ChunkRecord {
  cells: number;
  mesh: Mesh;
}

interface Desired {
  cx: number;
  cz: number;
  cells: number;
  dist: number;
  flora: boolean;
}

export interface WorldViewStats {
  chunks: number;
  pending: number;
  trees: number;
  vertices: number;
}

type Part = [VertexData, number, number, number];

function colored(vd: VertexData, r: number, g: number, b: number): VertexData {
  const count = vd.positions!.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  vd.colors = colors;
  return vd;
}

function cyl(height: number, top: number, bottom: number, tess: number, y: number): VertexData {
  const vd = CreateCylinderVertexData({ height, diameterTop: top, diameterBottom: bottom, tessellation: tess });
  vd.transform(Matrix.Translation(0, y, 0));
  return vd;
}

function ball(dx: number, dy: number, dz: number, segments: number, x: number, y: number, z: number): VertexData {
  const vd = CreateSphereVertexData({ diameterX: dx, diameterY: dy, diameterZ: dz, segments });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

const BARK: [number, number, number] = [0.36, 0.26, 0.17];

/** Géométrie très simple de chaque espèce (tronc + houppier), à l'échelle 1. */
function speciesParts(sp: Species): Part[] {
  switch (sp) {
    case 'miombo':
      return [
        [cyl(4.2, 0.3, 0.45, 6, 2.1), ...BARK],
        [ball(5, 2.2, 5, 5, 0, 4.9, 0), 0.3, 0.42, 0.18],
      ];
    case 'mopane':
      return [
        [cyl(3.4, 0.22, 0.32, 6, 1.7), ...BARK],
        [ball(3, 2.6, 3, 5, 0, 4.2, 0), 0.38, 0.45, 0.2],
      ];
    case 'baobab':
      return [
        [cyl(6, 1.8, 2.4, 9, 3), 0.55, 0.48, 0.42],
        [ball(1.8, 1.2, 1.8, 4, 0.8, 6.4, 0), 0.35, 0.42, 0.2],
        [ball(1.6, 1.1, 1.6, 4, -0.7, 6.3, 0.5), 0.35, 0.42, 0.2],
        [ball(1.5, 1, 1.5, 4, 0, 6.5, -0.8), 0.35, 0.42, 0.2],
      ];
    case 'acacia':
      return [
        [cyl(3.1, 0.18, 0.26, 5, 1.55), ...BARK],
        [cyl(0.5, 5, 4.2, 9, 3.3), 0.36, 0.44, 0.2],
      ];
    case 'teck':
      return [
        [cyl(7, 0.3, 0.42, 6, 3.5), ...BARK],
        [ball(3.5, 4, 3.5, 5, 0, 7.8, 0), 0.33, 0.42, 0.2],
      ];
    case 'montagne':
      return [
        [cyl(6, 0.45, 0.62, 6, 3), ...BARK],
        [ball(5.5, 4.5, 5.5, 5, 0, 7, 0), 0.18, 0.36, 0.17],
      ];
    case 'palmier':
      return [
        [cyl(6, 0.24, 0.32, 5, 3), 0.45, 0.38, 0.28],
        [cyl(1.4, 4, 0.3, 8, 6.5), 0.3, 0.48, 0.2],
      ];
    case 'figuier':
      return [
        [cyl(5, 0.6, 0.85, 7, 2.5), 0.45, 0.4, 0.32],
        [ball(7, 4, 7, 5, 0, 6.2, 0), 0.22, 0.4, 0.18],
      ];
  }
}

function buildMesh(name: string, scene: Scene, material: StandardMaterial, parts: Part[]): Mesh {
  const [first, ...rest] = parts.map(([vd, r, g, b]) => colored(vd, r, g, b));
  const merged = rest.length ? first!.merge(rest, true) : first!;
  const mesh = new Mesh(name, scene);
  merged.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = false;
  return mesh;
}

const m = new Matrix();
const q = new Quaternion();
const sv = new Vector3();
const pv = new Vector3();

function writeMatrix(buf: Float32Array, i: number, x: number, y: number, z: number, yawTurns: number, sx: number, sy: number, sz: number): void {
  Quaternion.RotationYawPitchRollToRef(yawTurns * Math.PI * 2, 0, 0, q);
  sv.set(sx, sy, sz);
  pv.set(x, y, z);
  Matrix.ComposeToRef(sv, q, pv, m);
  m.copyToArray(buf, i * 16);
}

export class WorldView {
  private readonly material: StandardMaterial;
  private readonly waterMaterial: StandardMaterial;
  private readonly water: Mesh;
  private readonly flora = new Map<string, Mesh>();
  private readonly stoneMesh: Mesh;
  private readonly logMesh: Mesh;
  /** Petits objets, sacs posés et corps (une forme par type, à l'échelle réelle). */
  private readonly itemMeshes = new Map<PropKind, Mesh>();
  /** Gisements (taille 1, mis à l'échelle). */
  private readonly nodeMeshes = new Map<PropKind, Mesh>();
  private readonly flameMesh: Mesh;
  private readonly smokeMesh: Mesh;
  /** Arbre abattu : on affiche sa souche à la place (fourni par la session). */
  treeFelled: ((cx: number, cz: number, index: number) => boolean) | null = null;
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly floraCache = new Map<string, ChunkFlora>();
  private desired = new Map<string, Desired>();
  private readonly requested = new Set<string>();
  private readonly heightRequested = new Set<string>();
  private readonly ready: ChunkJobResult[] = [];
  private centerKey = '';
  private center = { cx: 0, cz: 0 };
  private vegetationDirty = true;
  private treeCount = 0;
  private underwater = false;
  private params: QualityParams;

  constructor(
    private readonly scene: Scene,
    private readonly terrain: Terrain,
    private readonly jobs: TerrainJobs,
    params: QualityParams,
  ) {
    this.params = params;
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = SKY.clone();
    scene.skipPointerMovePicking = true;

    const sky = new HemisphericLight('ciel', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.8;
    sky.groundColor = new Color3(0.35, 0.32, 0.28);
    const sun = new DirectionalLight('soleil', new Vector3(-0.35, -1, -0.25), scene);
    sun.intensity = 0.55;

    this.material = new StandardMaterial('sol', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.specularColor = new Color3(0, 0, 0);

    this.waterMaterial = new StandardMaterial('eau', scene);
    this.waterMaterial.diffuseColor = new Color3(0.12, 0.32, 0.4);
    this.waterMaterial.specularColor = new Color3(0.25, 0.25, 0.25);
    this.waterMaterial.alpha = 0.78;
    this.waterMaterial.backFaceCulling = false;
    this.water = CreateGround('eau', { width: 1, height: 1 }, scene);
    this.water.material = this.waterMaterial;
    this.water.position.y = WATER_LEVEL;
    this.water.isPickable = false;

    for (const sp of SPECIES_LIST) this.flora.set(sp, buildMesh(`arbre ${sp}`, scene, this.material, speciesParts(sp)));
    this.flora.set('buisson', buildMesh('buissons', scene, this.material, [[ball(1.6, 1.1, 1.6, 4, 0, 0.4, 0), 0.3, 0.42, 0.2]]));
    this.flora.set('buisson-sec', buildMesh('buissons secs', scene, this.material, [[ball(1.6, 1, 1.6, 4, 0, 0.35, 0), 0.52, 0.46, 0.3]]));
    this.flora.set('rocher', buildMesh('rochers', scene, this.material, [[ball(2, 1.8, 2, 3, 0, 0, 0), 0.6, 0.55, 0.52]]));
    this.flora.set('termitiere', buildMesh('termitières', scene, this.material, [[cyl(1, 0.25, 2, 7, 0.5), 0.58, 0.36, 0.22]]));
    this.stoneMesh = buildMesh('pierres', scene, this.material, [[ball(2, 1.7, 1.9, 3, 0, 0, 0), 0.52, 0.5, 0.47]]);
    const log = cyl(1, 2, 2, 8, 0);
    log.transform(Matrix.RotationZ(Math.PI / 2));
    this.logMesh = buildMesh('bûches', scene, this.material, [[log, 0.45, 0.33, 0.22]]);
    for (const kind of ITEM_RENDER_KINDS) {
      const mesh = buildItemMesh(`objets ${kind}`, kind, scene, this.material);
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
      this.itemMeshes.set(kind, mesh);
    }
    for (const kind of NODE_RENDER_KINDS) {
      const mesh = buildItemMesh(`gisements ${kind}`, kind, scene, this.material);
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
      this.nodeMeshes.set(kind, mesh);
    }
    this.flora.set('souche', buildMesh('souches', scene, this.material, [[cyl(0.55, 2, 2.4, 7, 0.27), 0.42, 0.32, 0.22]]));
    // Feu : flammes lumineuses et colonne de fumée visible de loin (pour signaler sa position).
    const flameMat = new StandardMaterial('flammes', scene);
    flameMat.emissiveColor = new Color3(1, 0.55, 0.12);
    flameMat.diffuseColor = new Color3(0, 0, 0);
    flameMat.disableLighting = true;
    this.flameMesh = new Mesh('flammes', scene);
    CreateCylinderVertexData({ height: 0.7, diameterTop: 0, diameterBottom: 0.45, tessellation: 7 }).applyToMesh(this.flameMesh);
    this.flameMesh.material = flameMat;
    this.flameMesh.isPickable = false;
    this.flameMesh.alwaysSelectAsActiveMesh = true;
    this.flameMesh.isVisible = false;
    const smokeMat = new StandardMaterial('fumée', scene);
    smokeMat.diffuseColor = new Color3(0.55, 0.55, 0.56);
    smokeMat.emissiveColor = new Color3(0.35, 0.35, 0.36);
    smokeMat.specularColor = new Color3(0, 0, 0);
    smokeMat.alpha = 0.32;
    smokeMat.backFaceCulling = false;
    this.smokeMesh = new Mesh('fumée', scene);
    // Colonne qui s'élargit en montant ; transparente au pied (on voit le feu) et en haut (elle se dissipe).
    const smoke = CreateCylinderVertexData({ height: 1, diameterTop: 4, diameterBottom: 0.35, tessellation: 8, subdivisions: 6, cap: 0 });
    const sp = smoke.positions!;
    const sc: number[] = [];
    for (let i = 0; i < sp.length; i += 3) {
      const t = sp[i + 1]! + 0.5;
      sc.push(1, 1, 1, Math.max(0, t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88));
    }
    smoke.colors = sc;
    smoke.applyToMesh(this.smokeMesh);
    this.smokeMesh.hasVertexAlpha = true;
    this.smokeMesh.material = smokeMat;
    this.smokeMesh.isPickable = false;
    this.smokeMesh.alwaysSelectAsActiveMesh = true;
    this.smokeMesh.isVisible = false;
    this.applyFog();
  }

  get viewDistance(): number {
    return this.params.viewChunks * CHUNK_SIZE;
  }

  get isUnderwater(): boolean {
    return this.underwater;
  }

  stats(): WorldViewStats {
    let vertices = 0;
    for (const c of this.chunks.values()) vertices += c.mesh.getTotalVertices();
    return { chunks: this.chunks.size, pending: this.requested.size + this.ready.length, trees: this.treeCount, vertices };
  }

  setQuality(params: QualityParams): void {
    this.params = params;
    this.centerKey = '';
    this.vegetationDirty = true;
    this.applyFog();
  }

  private applyFog(): void {
    const d = this.viewDistance;
    this.scene.fogStart = d * 0.55;
    this.scene.fogEnd = d * 0.95;
    const size = d * 2.6;
    this.water.scaling.set(size, 1, size);
  }

  private lodCells(dist: number): number {
    const near = this.params.nearCells;
    const cells = dist <= 1.5 ? near : dist <= 3.5 ? near / 2 : near / 4;
    return Math.max(8, cells);
  }

  private recompute(ccx: number, ccz: number): void {
    const r = this.params.viewChunks;
    const vr = this.params.vegetationChunks;
    const desired = new Map<string, Desired>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > r + 0.5) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        desired.set(chunkKey(cx, cz), { cx, cz, cells: this.lodCells(dist), dist, flora: dist <= vr + 0.5 });
      }
    }
    this.desired = desired;
    for (const [key, rec] of this.chunks) {
      if (!desired.has(key)) {
        rec.mesh.dispose();
        this.chunks.delete(key);
      }
    }
    for (const key of this.floraCache.keys()) if (!desired.get(key)?.flora) this.floraCache.delete(key);

    // Nouvelle file d'attente, triée par distance.
    this.jobs.clearQueue();
    this.requested.clear();
    this.heightRequested.clear();
    for (const [key, d] of desired) {
      const rec = this.chunks.get(key);
      const needMesh = rec?.cells !== d.cells;
      const needFlora = d.flora && !this.floraCache.has(key);
      const needHeights = Math.max(Math.abs(d.cx - ccx), Math.abs(d.cz - ccz)) <= 2 && !this.jobs.heights.has(key);
      if (!needMesh && !needFlora && !needHeights) continue;
      this.requested.add(key);
      this.jobs.request(d.cx, d.cz, needMesh ? d.cells : 0, needHeights, needFlora, d.dist, (res) => this.ready.push(res));
    }
  }

  private apply(res: ChunkJobResult): void {
    const key = chunkKey(res.cx, res.cz);
    this.requested.delete(key);
    const d = this.desired.get(key);
    if (!d) return;
    if (res.flora && d.flora) {
      this.floraCache.set(key, res.flora);
      this.vegetationDirty = true;
    }
    if (res.mesh && res.cells === d.cells) {
      const vd = new VertexData();
      vd.positions = res.mesh.positions;
      vd.normals = res.mesh.normals;
      vd.colors = res.mesh.colors;
      vd.indices = res.mesh.indices;
      const mesh = new Mesh(`terrain ${key}`, this.scene);
      vd.applyToMesh(mesh, false);
      mesh.material = this.material;
      mesh.position.set(res.cx * CHUNK_SIZE, 0, res.cz * CHUNK_SIZE);
      mesh.isPickable = false;
      mesh.hasVertexAlpha = false;
      mesh.freezeWorldMatrix();
      this.chunks.get(key)?.mesh.dispose();
      this.chunks.set(key, { cells: res.cells, mesh });
    }
  }

  private rebuildVegetation(): void {
    const r = this.params.vegetationChunks;
    const buckets = new Map<string, Array<(buf: Float32Array, i: number) => void>>();
    const add = (type: string, write: (buf: Float32Array, i: number) => void) => {
      let list = buckets.get(type);
      if (!list) {
        list = [];
        buckets.set(type, list);
      }
      list.push(write);
    };
    let trees = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.sqrt(dx * dx + dz * dz) > r + 0.5) continue;
        const f = this.floraCache.get(chunkKey(this.center.cx + dx, this.center.cz + dz));
        if (!f) continue;
        const ccx = this.center.cx + dx;
        const ccz = this.center.cz + dz;
        f.trees.forEach((t, ti) => {
          if (this.treeFelled?.(ccx, ccz, ti)) {
            const r = SPECIES[t.species].trunkRadius * t.scale;
            add('souche', (b, i) => writeMatrix(b, i, t.x, t.y - 0.3, t.z, t.rot, r, 1, r));
            return;
          }
          trees++;
          add(t.species, (b, i) => writeMatrix(b, i, t.x, t.y - 0.3, t.z, t.rot, t.scale, t.scale, t.scale));
        });
        for (const b of f.bushes) add(b.dry ? 'buisson-sec' : 'buisson', (buf, i) => writeMatrix(buf, i, b.x, b.y, b.z, b.rot, b.scale, b.scale, b.scale));
        for (const k of f.rocks) {
          add('rocher', (buf, i) => writeMatrix(buf, i, k.x, k.y, k.z, (k.x * 0.37) % 1, k.r, k.r, k.r));
          if (k.top > 0) add('rocher', (buf, i) => writeMatrix(buf, i, k.x, k.y + k.r + k.top * 0.85, k.z, (k.z * 0.29) % 1, k.top, k.top, k.top));
        }
        for (const mo of f.mounds) add('termitiere', (buf, i) => writeMatrix(buf, i, mo.x, mo.y - 0.2, mo.z, 0, mo.radius, mo.height, mo.radius));
      }
    }
    this.treeCount = trees;
    for (const [type, mesh] of this.flora) {
      const list = buckets.get(type);
      if (!list || list.length === 0) {
        mesh.isVisible = false;
        continue;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((w, i) => w(buf, i));
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      mesh.isVisible = true;
    }
  }

  /** Met à jour l'affichage des objets déplaçables (positions issues de la simulation). */
  updateProps(views: PropView[]): void {
    const stones = views.filter((v) => v.kind === 'pierre');
    const logs = views.filter((v) => v.kind === 'buche' || v.kind === 'tronc' || v.kind === 'baton' || v.kind === 'manche' || v.kind === 'perche');
    const fill = (mesh: Mesh, list: PropView[], scale: (v: PropView) => [number, number, number]) => {
      if (list.length === 0) {
        mesh.isVisible = false;
        return;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((v, i) => {
        q.set(v.qx, v.qy, v.qz, v.qw);
        const [sx, sy, sz] = scale(v);
        sv.set(sx, sy, sz);
        pv.set(v.x, v.y, v.z);
        Matrix.ComposeToRef(sv, q, pv, m);
        m.copyToArray(buf, i * 16);
      });
      mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
      mesh.isVisible = true;
    };
    fill(this.stoneMesh, stones, (v) => [v.radius, v.radius, v.radius]);
    fill(this.logMesh, logs, (v) => [v.length, v.radius, v.radius]);
    for (const [kind, mesh] of this.itemMeshes) fill(mesh, views.filter((v) => v.kind === kind), () => [1, 1, 1]);
    for (const [kind, mesh] of this.nodeMeshes) fill(mesh, views.filter((v) => v.kind === kind), (v) => [v.size ?? 1, v.size ?? 1, v.size ?? 1]);
    // Flammes : foyers, forges, fourneaux, torches (plus petites, au bout du manche).
    const FLAME: Partial<Record<PropView['kind'], [number, number]>> = { foyer: [0, 1], forge: [0.3, 0.8], fourneau: [0.85, 0.7], torche: [0.22, 0.35] };
    const lit = views.filter((v) => v.lit && FLAME[v.kind]);
    const t = performance.now() * 0.006;
    fill(
      this.flameMesh,
      lit.map((v) => ({ ...v, y: v.y + FLAME[v.kind]![0], qx: 0, qy: 0, qz: 0, qw: 1 })),
      (v) => {
        const s = FLAME[v.kind]![1];
        const k = (0.85 + 0.15 * Math.sin(t + v.x)) * s;
        return [k, (0.9 + 0.2 * Math.sin(t * 1.7 + v.z)) * s, k];
      },
    );
    // Colonne de fumée : 30 m de haut, centrée 15 m au-dessus du foyer (pas pour les torches).
    fill(this.smokeMesh, lit.filter((v) => v.kind !== 'torche').map((v) => ({ ...v, y: v.y + 15, qx: 0, qy: 0, qz: 0, qw: 1 })), () => [1, 30, 1]);
  }

  /** À appeler quand des arbres sont abattus ou repoussent. */
  invalidateVegetation(): void {
    this.vegetationDirty = true;
  }

  /** À appeler à chaque image : demande, reçoit et affiche les chunks, dans la limite de temps donnée. */
  update(camX: number, camY: number, camZ: number, budgetMs: number): void {
    const ccx = chunkCoord(camX);
    const ccz = chunkCoord(camZ);
    const key = chunkKey(ccx, ccz);
    if (key !== this.centerKey) {
      this.centerKey = key;
      this.center = { cx: ccx, cz: ccz };
      this.recompute(ccx, ccz);
      this.vegetationDirty = true;
    }
    const t0 = performance.now();
    this.jobs.pump(budgetMs);
    let applied = 0;
    while (this.ready.length > 0 && (applied === 0 || performance.now() - t0 < budgetMs)) {
      this.apply(this.ready.shift()!);
      applied++;
    }
    if (this.vegetationDirty) {
      this.vegetationDirty = false;
      this.rebuildVegetation();
    }
    this.water.position.x = camX;
    this.water.position.z = camZ;

    const under = camY < WATER_LEVEL - 0.05;
    if (under !== this.underwater) {
      this.underwater = under;
      const c = under ? UNDERWATER : SKY;
      this.scene.fogColor = c.clone();
      this.scene.clearColor = new Color4(c.r, c.g, c.b, 1);
      this.scene.fogMode = under ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_LINEAR;
    }
    if (under) {
      // Plus on descend, plus l'eau est sombre et trouble.
      const depth = WATER_LEVEL - camY;
      this.scene.fogDensity = 0.06 + Math.min(0.12, depth * 0.008);
      const k = Math.max(0.35, 1 - depth * 0.04);
      this.scene.fogColor.set(UNDERWATER.r * k, UNDERWATER.g * k, UNDERWATER.b * k);
      this.scene.clearColor.set(UNDERWATER.r * k, UNDERWATER.g * k, UNDERWATER.b * k, 1);
    }
  }

  /** Attend que le terrain proche soit prêt (écran de chargement). */
  async preload(camX: number, camY: number, camZ: number, onProgress?: (done: number, total: number) => void, timeoutMs = 20000): Promise<void> {
    this.update(camX, camY, camZ, 8);
    const t0 = performance.now();
    const near = [...this.desired.entries()].filter(([, d]) => d.dist <= 1.5).map(([k]) => k);
    for (;;) {
      this.update(camX, camY, camZ, 8);
      const done = near.filter((k) => this.chunks.has(k)).length;
      onProgress?.(done, near.length);
      if (done >= near.length || performance.now() - t0 > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.dispose();
    this.chunks.clear();
    for (const mesh of this.flora.values()) mesh.dispose();
    this.stoneMesh.dispose();
    this.logMesh.dispose();
    for (const mesh of this.itemMeshes.values()) mesh.dispose();
    for (const mesh of this.nodeMeshes.values()) mesh.dispose();
    this.flameMesh.dispose();
    this.smokeMesh.dispose();
    this.water.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
  }

  /** Terrain affiché (pour les outils). */
  get world(): Terrain {
    return this.terrain;
  }
}
