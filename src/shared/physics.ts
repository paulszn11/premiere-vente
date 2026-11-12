// Monde physique partagé (Rapier, compilé en WebAssembly).
// Le serveur s'en sert comme référence ; le client l'utilise pour prédire ses
// propres déplacements sans attendre la réponse du serveur.

import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK_SIZE, MOVE, PHYS_CELLS, PLAYER_CENTER_Y, PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from './constants';
import { chunkCoord, chunkKey, type Terrain } from './terrain';
import { TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS, treesInChunk } from './vegetation';

export { RAPIER };

let initPromise: Promise<void> | null = null;

/** Charge le module WebAssembly de Rapier (une seule fois). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export const GROUP_TERRAIN = 0x0001;
export const GROUP_PLAYER = 0x0002;

export function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

/** Les joueurs ne rencontrent que le décor (pas les autres joueurs) en phase 1. */
export const PLAYER_GROUPS = interactionGroups(GROUP_PLAYER, GROUP_TERRAIN);
export const TERRAIN_GROUPS = interactionGroups(GROUP_TERRAIN, 0xffff);

interface PhysChunk {
  colliders: RAPIER.Collider[];
  lastNeeded: number;
}

const DEG = Math.PI / 180;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly controller: RAPIER.KinematicCharacterController;
  private readonly chunks = new Map<string, PhysChunk>();
  private needsRefresh = false;

  constructor(readonly terrain: Terrain) {
    this.world = new RAPIER.World({ x: 0, y: -MOVE.gravity, z: 0 });
    const c = this.world.createCharacterController(MOVE.controllerOffset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle(MOVE.maxSlopeClimbDeg * DEG);
    c.setMinSlopeSlideAngle(MOVE.minSlopeSlideDeg * DEG);
    c.enableAutostep(MOVE.autostepHeight, MOVE.autostepMinWidth, false);
    c.enableSnapToGround(MOVE.snapToGround);
    c.setSlideEnabled(true);
    this.controller = c;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  /** Charge les chunks dans un rayon autour de chaque point. Retourne le nombre de chunks créés. */
  ensureAround(points: ReadonlyArray<{ x: number; z: number }>, radius: number, now: number): number {
    let created = 0;
    for (const p of points) {
      const pcx = chunkCoord(p.x);
      const pcz = chunkCoord(p.z);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);
          const existing = this.chunks.get(key);
          if (existing) {
            existing.lastNeeded = now;
          } else {
            this.chunks.set(key, { colliders: this.buildChunk(cx, cz), lastNeeded: now });
            created++;
          }
        }
      }
    }
    if (created > 0) this.needsRefresh = true;
    return created;
  }

  /** Décharge les chunks inutilisés depuis plus de graceMs. */
  unloadUnused(now: number, graceMs: number): number {
    let removed = 0;
    for (const [key, chunk] of this.chunks) {
      if (now - chunk.lastNeeded > graceMs) {
        for (const c of chunk.colliders) this.world.removeCollider(c, false);
        this.chunks.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.needsRefresh = true;
    return removed;
  }

  /**
   * Met à jour la structure d'accélération des requêtes après un ajout ou un retrait
   * de collisions. Le monde ne contient aucun corps dynamique : cette étape ne déplace rien.
   */
  refresh(): void {
    if (this.needsRefresh) {
      this.world.step();
      this.needsRefresh = false;
    }
  }

  createPlayerCollider(x: number, y: number, z: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
      .setTranslation(x, y + PLAYER_CENTER_Y, z)
      .setCollisionGroups(PLAYER_GROUPS);
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Altitude du premier obstacle sous (x, z) parmi le décor chargé, ou null. */
  groundHeight(x: number, z: number, fromY = 600): number | null {
    this.refresh();
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 1000, true, undefined, TERRAIN_GROUPS);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
    this.chunks.clear();
  }

  private buildChunk(cx: number, cz: number): RAPIER.Collider[] {
    const n = PHYS_CELLS + 1;
    const rowMajor = this.terrain.sampleChunk(cx, cz, PHYS_CELLS);
    // Rapier attend une matrice rangée par colonnes : lignes = axe z, colonnes = axe x.
    const heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) heights[ix * n + iz] = rowMajor[iz * n + ix]!;
    }
    const half = CHUNK_SIZE / 2;
    const ground = RAPIER.ColliderDesc.heightfield(PHYS_CELLS, PHYS_CELLS, heights, { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE })
      .setTranslation(cx * CHUNK_SIZE + half, 0, cz * CHUNK_SIZE + half)
      .setCollisionGroups(TERRAIN_GROUPS);
    const colliders = [this.world.createCollider(ground)];
    for (const t of treesInChunk(this.terrain, cx, cz)) {
      const halfHeight = (TREE_TRUNK_HEIGHT * t.scale) / 2;
      const trunk = RAPIER.ColliderDesc.cylinder(halfHeight, TREE_TRUNK_RADIUS * t.scale)
        .setTranslation(t.x, t.y - 0.3 + halfHeight, t.z)
        .setCollisionGroups(TERRAIN_GROUPS);
      colliders.push(this.world.createCollider(trunk));
    }
    return colliders;
  }
}
