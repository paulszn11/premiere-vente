// Affichage du monde : terrain chargé progressivement par chunks autour de la caméra,
// avec plusieurs niveaux de détail, arbres (instances), eau, lumière et brouillard.
// Graphismes volontairement simples en phase 1.

import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CHUNK_SIZE, WATER_LEVEL } from '../../shared/constants';
import { type Terrain, chunkCoord, chunkKey } from '../../shared/terrain';
import { type TreeInstance, TREE_TRUNK_HEIGHT, treesInChunk } from '../../shared/vegetation';
import type { QualityParams } from '../settings';
import { buildTerrainMesh } from './terrain-mesh';

const SKY = new Color3(0.62, 0.74, 0.86);
const UNDERWATER = new Color3(0.05, 0.2, 0.24);

interface ChunkRecord {
  cells: number;
  mesh: Mesh;
}

interface ChunkJob {
  key: string;
  cx: number;
  cz: number;
  cells: number;
  dist: number;
}

export interface WorldViewStats {
  chunks: number;
  pending: number;
  trees: number;
  vertices: number;
}

function colored(vd: VertexData, r: number, g: number, b: number): VertexData {
  const count = vd.positions!.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  vd.colors = colors;
  return vd;
}

/** Arbre très simple : tronc + deux cônes de feuillage, couleurs par sommet. */
function buildTreeMesh(scene: Scene, material: StandardMaterial): Mesh {
  const trunk = colored(CreateCylinderVertexData({ height: TREE_TRUNK_HEIGHT, diameterTop: 0.3, diameterBottom: 0.44, tessellation: 6 }), 0.36, 0.25, 0.15);
  trunk.transform(Matrix.Translation(0, TREE_TRUNK_HEIGHT / 2, 0));
  const low = colored(CreateCylinderVertexData({ height: 4, diameterTop: 0, diameterBottom: 3.2, tessellation: 7 }), 0.16, 0.36, 0.17);
  low.transform(Matrix.Translation(0, 4.6, 0));
  const high = colored(CreateCylinderVertexData({ height: 3, diameterTop: 0, diameterBottom: 2.3, tessellation: 7 }), 0.19, 0.42, 0.19);
  high.transform(Matrix.Translation(0, 6.6, 0));
  const merged = trunk.merge([low, high], true);
  const mesh = new Mesh('arbres', scene);
  merged.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = false;
  return mesh;
}

export class WorldView {
  private readonly material: StandardMaterial;
  private readonly waterMaterial: StandardMaterial;
  private readonly water: Mesh;
  private readonly treeMesh: Mesh;
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly treeCache = new Map<string, TreeInstance[]>();
  private queue: ChunkJob[] = [];
  private centerKey = '';
  private vegetationDirty = true;
  private treeCount = 0;
  private underwater = false;
  private params: QualityParams;

  constructor(
    private readonly scene: Scene,
    private readonly terrain: Terrain,
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

    this.treeMesh = buildTreeMesh(scene, this.material);
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
    return { chunks: this.chunks.size, pending: this.queue.length, trees: this.treeCount, vertices };
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
    const desired = new Map<string, ChunkJob>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > r + 0.5) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = chunkKey(cx, cz);
        desired.set(key, { key, cx, cz, cells: this.lodCells(dist), dist });
      }
    }
    for (const [key, rec] of this.chunks) {
      if (!desired.has(key)) {
        rec.mesh.dispose();
        this.chunks.delete(key);
      }
    }
    this.queue = [...desired.values()].filter((j) => this.chunks.get(j.key)?.cells !== j.cells).sort((a, b) => a.dist - b.dist);
  }

  private buildChunk(job: ChunkJob): void {
    const data = buildTerrainMesh(this.terrain, job.cx, job.cz, job.cells);
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.colors = data.colors;
    vd.indices = data.indices;
    const mesh = new Mesh(`terrain ${job.key}`, this.scene);
    vd.applyToMesh(mesh, false);
    mesh.material = this.material;
    mesh.position.set(job.cx * CHUNK_SIZE, 0, job.cz * CHUNK_SIZE);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = false;
    mesh.freezeWorldMatrix();
    this.chunks.get(job.key)?.mesh.dispose();
    this.chunks.set(job.key, { cells: job.cells, mesh });
  }

  private treesFor(cx: number, cz: number): TreeInstance[] {
    const key = chunkKey(cx, cz);
    let list = this.treeCache.get(key);
    if (!list) {
      list = treesInChunk(this.terrain, cx, cz);
      this.treeCache.set(key, list);
      if (this.treeCache.size > 400) this.treeCache.delete(this.treeCache.keys().next().value!);
    }
    return list;
  }

  private rebuildVegetation(ccx: number, ccz: number): void {
    const r = this.params.vegetationChunks;
    const trees: TreeInstance[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.sqrt(dx * dx + dz * dz) > r + 0.5) continue;
        for (const t of this.treesFor(ccx + dx, ccz + dz)) trees.push(t);
      }
    }
    this.treeCount = trees.length;
    if (trees.length === 0) {
      this.treeMesh.isVisible = false;
      return;
    }
    const buf = new Float32Array(trees.length * 16);
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    trees.forEach((t, i) => {
      Quaternion.RotationYawPitchRollToRef(t.rot * Math.PI * 2, 0, 0, q);
      s.set(t.scale, t.scale * (0.9 + t.variant * 0.1), t.scale);
      p.set(t.x, t.y - 0.3, t.z);
      Matrix.ComposeToRef(s, q, p, m);
      m.copyToArray(buf, i * 16);
    });
    this.treeMesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    this.treeMesh.isVisible = true;
  }

  /** À appeler à chaque image : charge/décharge les chunks dans la limite de temps donnée. */
  update(camX: number, camY: number, camZ: number, budgetMs: number): void {
    const ccx = chunkCoord(camX);
    const ccz = chunkCoord(camZ);
    const key = chunkKey(ccx, ccz);
    if (key !== this.centerKey) {
      this.centerKey = key;
      this.recompute(ccx, ccz);
      this.vegetationDirty = true;
    }
    const t0 = performance.now();
    let built = 0;
    while (this.queue.length > 0 && (built === 0 || performance.now() - t0 < budgetMs)) {
      this.buildChunk(this.queue.shift()!);
      built++;
    }
    if (this.vegetationDirty) {
      this.vegetationDirty = false;
      this.rebuildVegetation(ccx, ccz);
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
      this.scene.fogDensity = 0.07;
    }
  }

  /** Construit immédiatement tous les chunks en attente (écran de chargement, tests). */
  flush(camX: number, camY: number, camZ: number): void {
    this.update(camX, camY, camZ, 1e9);
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.dispose();
    this.chunks.clear();
    this.treeMesh.dispose();
    this.water.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
  }
}
