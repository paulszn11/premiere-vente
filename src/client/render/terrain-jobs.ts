// Gestion des calculs de terrain : file d'attente par priorité, un ou deux fils de calcul,
// cache des hauteurs physiques (réutilisées par la simulation pour éviter les saccades).
// Si les fils de calcul ne sont pas disponibles, le calcul se fait dans la page.

import { PHYS_CELLS } from '../../shared/constants';
import { Terrain, chunkKey } from '../../shared/terrain';
import { type ChunkFlora, floraInChunk } from '../../shared/vegetation';
import { buildTerrainMesh, physicsHeightsFromMesh } from './terrain-mesh';

export interface ChunkJobRequest {
  type: 'chunk';
  id: number;
  cx: number;
  cz: number;
  /** Cellules du maillage (0 : pas de maillage). */
  cells: number;
  physics: boolean;
  flora: boolean;
}

export interface ChunkMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export interface ChunkJobResult {
  type: 'chunk';
  id: number;
  cx: number;
  cz: number;
  cells: number;
  mesh: ChunkMeshArrays | null;
  physics: Float32Array | null;
  flora: ChunkFlora | null;
}

interface Job {
  req: ChunkJobRequest;
  priority: number;
  done: (r: ChunkJobResult) => void;
}

const HEIGHT_CACHE_MAX = 120;

export class TerrainJobs {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private queue: Job[] = [];
  private readonly inflight = new Map<number, Job>();
  private nextId = 1;
  private fallback: Terrain | null = null;
  /** Hauteurs physiques des chunks (65 × 65, rangées par lignes). */
  readonly heights = new Map<string, Float32Array>();

  constructor(
    private readonly seed: number,
    workerCount: number,
  ) {
    try {
      for (let i = 0; i < workerCount; i++) {
        const w = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent) => this.onResult(w, e.data as ChunkJobResult);
        w.onerror = () => this.toFallback();
        w.postMessage({ type: 'init', seed });
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch {
      this.toFallback();
    }
  }

  get usesWorkers(): boolean {
    return this.fallback === null;
  }

  get pendingCount(): number {
    return this.queue.length + this.inflight.size;
  }

  /** Source de hauteurs pour la physique. */
  readonly heightProvider = (cx: number, cz: number): Float32Array | null => this.heights.get(chunkKey(cx, cz)) ?? null;

  private toFallback(): void {
    if (this.fallback) return;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.fallback = new Terrain(this.seed);
    // Les travaux en cours sont remis dans la file.
    for (const job of this.inflight.values()) this.queue.push(job);
    this.inflight.clear();
  }

  request(cx: number, cz: number, cells: number, physics: boolean, flora: boolean, priority: number, done: (r: ChunkJobResult) => void): void {
    this.queue.push({ req: { type: 'chunk', id: this.nextId++, cx, cz, cells, physics, flora }, priority, done });
  }

  /** Vide la file d'attente (les calculs déjà lancés se terminent). */
  clearQueue(): void {
    this.queue = [];
  }

  private storeHeights(r: ChunkJobResult): void {
    if (!r.physics) return;
    const key = chunkKey(r.cx, r.cz);
    this.heights.delete(key);
    this.heights.set(key, r.physics);
    if (this.heights.size > HEIGHT_CACHE_MAX) this.heights.delete(this.heights.keys().next().value!);
  }

  private onResult(w: Worker, r: ChunkJobResult): void {
    const job = this.inflight.get(r.id);
    this.inflight.delete(r.id);
    this.idle.push(w);
    this.storeHeights(r);
    job?.done(r);
    this.pump(0);
  }

  private runSync(job: Job): ChunkJobResult {
    const t = this.fallback!;
    const { cx, cz, cells } = job.req;
    let mesh: ChunkMeshArrays | null = null;
    let physics: Float32Array | null = null;
    if (cells > 0) {
      const m = buildTerrainMesh(t, cx, cz, cells);
      mesh = { positions: m.positions, normals: m.normals, colors: m.colors, indices: m.indices };
      if (job.req.physics) physics = physicsHeightsFromMesh(m, cells);
    }
    if (job.req.physics && !physics) physics = t.sampleChunk(cx, cz, PHYS_CELLS);
    return { type: 'chunk', id: job.req.id, cx, cz, cells, mesh, physics, flora: job.req.flora ? floraInChunk(t, cx, cz) : null };
  }

  /** Lance les travaux en attente (dans la page, dans la limite de temps donnée). */
  pump(budgetMs: number): void {
    if (this.queue.length === 0) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.fallback) {
      const t0 = performance.now();
      let n = 0;
      while (this.queue.length > 0 && (n === 0 || performance.now() - t0 < budgetMs)) {
        const job = this.queue.shift()!;
        const r = this.runSync(job);
        this.storeHeights(r);
        job.done(r);
        n++;
      }
      return;
    }
    while (this.idle.length > 0 && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const w = this.idle.pop()!;
      this.inflight.set(job.req.id, job);
      w.postMessage(job.req);
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.queue = [];
    this.inflight.clear();
  }
}
