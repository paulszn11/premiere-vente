// Monde physique partagé (Rapier, compilé en WebAssembly).
// Le serveur s'en sert comme référence ; le client l'utilise pour prédire ses
// propres déplacements sans attendre la réponse du serveur.

import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK_SIZE, MOVE, PHYS_CELLS, PLAYER_CENTER_Y, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, WORLD_HALF } from './constants';
import { type Terrain, chunkCoord, chunkKey } from './terrain';
import { SPECIES, type Species, floraInChunk } from './vegetation';

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
/** Gisements plats (herbes, argile, gravier) et foyers : visables, mais on marche dessus. */
export const GROUP_NODE = 0x0020;
/** Véhicules (phase 7) : ils heurtent le décor, les objets, le joueur et les autres véhicules. */
export const GROUP_VEHICLE = 0x0040;

export function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

/** Les joueurs rencontrent le décor, les obstacles et les objets (pas les autres joueurs en phase 2). */
export const PLAYER_GROUPS = interactionGroups(GROUP_PLAYER, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP | GROUP_VEHICLE);
export const TERRAIN_GROUPS = interactionGroups(GROUP_TERRAIN, 0xffff);
export const OBSTACLE_GROUPS = interactionGroups(GROUP_OBSTACLE, 0xffff);
export const PROP_GROUPS = interactionGroups(GROUP_PROP, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP | GROUP_PLAYER | GROUP_HELD | GROUP_VEHICLE);
export const HELD_GROUPS = interactionGroups(GROUP_HELD, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);
export const VEHICLE_GROUPS = interactionGroups(GROUP_VEHICLE, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP | GROUP_PLAYER | GROUP_VEHICLE);
/** Requête de visée des véhicules. */
export const QUERY_VEHICLES = interactionGroups(0xffff, GROUP_VEHICLE);
export const DRAGGED_GROUPS = interactionGroups(GROUP_PROP, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP | GROUP_VEHICLE);
/** Requête ne touchant que le sol et les rochers (escalade). */
export const QUERY_TERRAIN = interactionGroups(0xffff, GROUP_TERRAIN);
/** Requête ne touchant que les objets déplaçables. */
export const QUERY_PROPS = interactionGroups(0xffff, GROUP_PROP);
/** Requête de visée : objets et gisements. */
export const QUERY_TARGETS = interactionGroups(0xffff, GROUP_PROP | GROUP_NODE);
/** Gisements plats : seuls le décor et les objets les touchent (pas le joueur). */
export const NODE_GROUPS = interactionGroups(GROUP_NODE, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);
/** Requête « tout le décor » (sol, obstacles, objets). */
export const QUERY_SOLID = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE | GROUP_PROP);

interface PhysChunk {
  colliders: RAPIER.Collider[];
  lastNeeded: number;
}

/** Arbre touché par un rayon (pour l'écorcer, le couper, l'abattre). */
export interface TreeHit {
  key: string;
  species: Species;
  scale: number;
  x: number;
  y: number;
  z: number;
  cx: number;
  cz: number;
  index: number;
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
  /** Troncs : poignée du collisionneur → arbre. */
  private readonly trees = new Map<number, TreeHit>();
  /** Arbre abattu (ignoré : ni tronc, ni collision). */
  treeFelled: ((cx: number, cz: number, index: number) => boolean) | null = null;
  /** Chocs violents (force de contact au-delà du seuil d'un collisionneur) : poignées et force. */
  onContactForce: ((h1: number, h2: number, force: number) => void) | null = null;
  private readonly events = new RAPIER.EventQueue(true);

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

  /** Chunks physiques chargés (coordonnées). */
  loadedChunks(): Array<{ cx: number; cz: number }> {
    return [...this.chunks.keys()].map((k) => {
      const [cx, cz] = k.split(',').map(Number);
      return { cx: cx!, cz: cz! };
    });
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
        for (const c of chunk.colliders) {
          this.trees.delete(c.handle);
          this.world.removeCollider(c, false);
        }
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
    this.world.step(this.events);
    this.needsRefresh = false;
    const cb = this.onContactForce;
    this.events.drainContactForceEvents((e) => cb?.(e.collider1(), e.collider2(), e.totalForceMagnitude()));
    this.events.clear();
  }

  /** Des collisionneurs ont été ajoutés ou retirés : mettre à jour les requêtes au prochain refresh. */
  markDirty(): void {
    this.needsRefresh = true;
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
    this.events.free();
    this.world.free();
    this.chunks.clear();
  }

  /** Arbre correspondant à un collisionneur (tronc), ou null. */
  treeOf(collider: RAPIER.Collider): TreeHit | null {
    return this.trees.get(collider.handle) ?? null;
  }

  /** Reconstruit le décor d'un chunk chargé (arbre abattu ou repoussé). */
  rebuildChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const c of chunk.colliders) {
      this.trees.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    chunk.colliders = this.buildChunk(cx, cz);
    this.needsRefresh = true;
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
    flora.trees.forEach((t, index) => {
      if (this.treeFelled?.(cx, cz, index)) return;
      const spec = SPECIES[t.species];
      const halfHeight = (spec.trunkHeight * t.scale) / 2;
      const trunk = RAPIER.ColliderDesc.cylinder(halfHeight, spec.trunkRadius * t.scale)
        .setTranslation(t.x, t.y - 0.3 + halfHeight, t.z)
        .setCollisionGroups(OBSTACLE_GROUPS);
      const col = this.world.createCollider(trunk);
      this.trees.set(col.handle, { key: `${cx}:${cz}:${index}`, species: t.species, scale: t.scale, x: t.x, y: t.y, z: t.z, cx, cz, index });
      colliders.push(col);
    });
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
