// Monde physique partagé (Rapier, compilé en WebAssembly).
// Le serveur s'en sert comme référence ; le client l'utilise pour prédire ses
// propres déplacements sans attendre la réponse du serveur.

import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK_SIZE, MOVE, PHYS_CELLS, PLAYER_CENTER_Y, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, WORLD_HALF } from './constants';
import { type Terrain, chunkCoord, chunkKey } from './terrain';
import { SPECIES, floraInChunk } from './vegetation';

export { RAPIER };

let initPromise: Promise<void> | null = null;

/** Charge le module WebAssembly de Rapier (une seule fois). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

/** Sol et rochers : surfaces naturelles, escaladables si assez raides. */
export const GROUP_TERRAIN = 0x0001;
export const GROUP_PLAYER = 0x0002;
/** Objets déplaçables. */
export const GROUP_PROP = 0x0004;
/** Obstacles fixes non escaladables : troncs, termitières, murs de la frontière. */
export const GROUP_OBSTACLE = 0x0008;
/** Objet tenu en main : ne heurte pas le joueur. */
export const GROUP_HELD = 0x0010;

export function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

/** Les joueurs rencontrent le décor, les obstacles et les objets (pas les autres joueurs en phase 2). */
export const PLAYER_GROUPS = interactionGroups(GROUP_PLAYER, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);
export const TERRAIN_GROUPS = interactionGroups(GROUP_TERRAIN, 0xffff);
export const OBSTACLE_GROUPS = interactionGroups(GROUP_OBSTACLE, 0xffff);
export const PROP_GROUPS = interactionGroups(GROUP_PROP, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP | GROUP_PLAYER | GROUP_HELD);
export const HELD_GROUPS = interactionGroups(GROUP_HELD, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);
export const DRAGGED_GROUPS = interactionGroups(GROUP_PROP, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);
/** Requête ne touchant que le sol et les rochers (escalade). */
export const QUERY_TERRAIN = interactionGroups(0xffff, GROUP_TERRAIN);
/** Requête ne touchant que les objets déplaçables. */
export const QUERY_PROPS = interactionGroups(0xffff, GROUP_PROP);
/** Requête « tout le décor » (sol, obstacles, objets). */
export const QUERY_SOLID = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);

interface PhysChunk {
  colliders: RAPIER.Collider[];
  lastNeeded: number;
}

const DEG = Math.PI / 180;

/** Fournit les hauteurs physiques d'un chunk (65 × 65, rangées par lignes), par exemple depuis un cache. */
export type HeightProvider = (cx: number, cz: number) => Float32Array | null;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly controller: RAPIER.KinematicCharacterController;
  /** Prévenu quand un chunk entre ou sort de la zone simulée (objets déplaçables). */
  onChunkLoaded: ((cx: number, cz: number) => void) | null = null;
  onChunkUnloaded: ((cx: number, cz: number) => void) | null = null;
  /** Source optionnelle de hauteurs précalculées (fil de calcul du client). */
  heightProvider: HeightProvider | null = null;
  private readonly chunks = new Map<string, PhysChunk>();
  private needsRefresh = false;

  constructor(readonly terrain: Terrain) {
    this.world = new RAPIER.World({ x: 0, y: -MOVE.gravity, z: 0 });
    const c = this.world.createCharacterController(MOVE.controllerOffset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle(MOVE.maxSlopeClimbDeg * DEG);
    c.setMinSlopeSlideAngle(MOVE.minSlopeSlideDeg * DEG);
    // On enjambe les petits obstacles, y compris les objets déplaçables (pierres, bûches basses).
    c.enableAutostep(MOVE.autostepHeight, MOVE.autostepMinWidth, true);
    c.enableSnapToGround(MOVE.snapToGround);
    c.setSlideEnabled(true);
    // La poussée des objets est calculée par stepMovement (force limitée à celle d'un humain).
    c.setApplyImpulsesToDynamicBodies(false);
    this.controller = c;
    this.buildBorderWalls();
  }

  /** Murs invisibles aux limites du monde (derrière les montagnes frontalières). */
  private buildBorderWalls(): void {
    const t = 50;
    const h = 2000;
    const len = WORLD_HALF + t * 2;
    const walls: Array<[number, number, number, number]> = [
      [WORLD_HALF + t, 0, t, len],
      [-WORLD_HALF - t, 0, t, len],
      [0, WORLD_HALF + t, len, t],
      [0, -WORLD_HALF - t, len, t],
    ];
    for (const [x, z, hx, hz] of walls) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, h, hz).setTranslation(x, 0, z).setCollisionGroups(OBSTACLE_GROUPS));
    }
    this.needsRefresh = true;
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
            this.onChunkLoaded?.(cx, cz);
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
        const [cx, cz] = key.split(',').map(Number) as [number, number];
        this.onChunkUnloaded?.(cx, cz);
        for (const c of chunk.colliders) this.world.removeCollider(c, false);
        this.chunks.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.needsRefresh = true;
    return removed;
  }

  /** Met à jour la structure des requêtes sans faire avancer le temps (aucun corps dynamique ne doit exister). */
  refresh(): void {
    if (this.needsRefresh) {
      this.world.step();
      this.needsRefresh = false;
    }
  }

  /** Fait avancer la physique d'un pas (objets dynamiques) et met à jour les requêtes. */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
    this.needsRefresh = false;
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
  groundHeight(x: number, z: number, fromY = 900, query = QUERY_TERRAIN): number | null {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 1000, true, undefined, query);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
    this.chunks.clear();
  }

  private buildChunk(cx: number, cz: number): RAPIER.Collider[] {
    const n = PHYS_CELLS + 1;
    const rowMajor = this.heightProvider?.(cx, cz) ?? this.terrain.sampleChunk(cx, cz, PHYS_CELLS);
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
    const flora = floraInChunk(this.terrain, cx, cz);
    for (const t of flora.trees) {
      const spec = SPECIES[t.species];
      const halfHeight = (spec.trunkHeight * t.scale) / 2;
      const trunk = RAPIER.ColliderDesc.cylinder(halfHeight, spec.trunkRadius * t.scale)
        .setTranslation(t.x, t.y - 0.3 + halfHeight, t.z)
        .setCollisionGroups(OBSTACLE_GROUPS);
      colliders.push(this.world.createCollider(trunk));
    }
    for (const r of flora.rocks) {
      colliders.push(this.world.createCollider(RAPIER.ColliderDesc.ball(r.r).setTranslation(r.x, r.y, r.z).setCollisionGroups(TERRAIN_GROUPS)));
      if (r.top > 0) {
        colliders.push(
          this.world.createCollider(RAPIER.ColliderDesc.ball(r.top).setTranslation(r.x, r.y + r.r + r.top * 0.85, r.z).setCollisionGroups(TERRAIN_GROUPS)),
        );
      }
    }
    for (const m of flora.mounds) {
      const halfHeight = m.height / 2;
      colliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(halfHeight, m.radius * 0.6).setTranslation(m.x, m.y + halfHeight - 0.2, m.z).setCollisionGroups(OBSTACLE_GROUPS),
        ),
      );
    }
    return colliders;
  }
}
