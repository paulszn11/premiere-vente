// Simulation du monde à pas fixe (60 pas par seconde), séparée de l'affichage.
// Phase 1 : un seul joueur, simulation dans la page. En phase 8, cette même logique
// tournera sur le serveur de l'hôte et le client ne fera plus que prédire.

import { KILL_Y, PHYS_CHUNK_RADIUS, TICK_DT, WATER_LEVEL } from './constants';
import { type InputCmd, type MoveState, copyState, makeState, quantizeInput, stepMovement } from './movement';
import { PhysicsWorld, type RAPIER, initPhysics } from './physics';
import { Terrain, chunkCoord, chunkKey } from './terrain';
import { type TreeInstance, treesInChunk } from './vegetation';

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Cherche un point d'apparition sur la terre ferme, peu pentu et sans arbre, près de l'origine. */
export function findSpawn(terrain: Terrain): SpawnPoint {
  const treeCache = new Map<string, TreeInstance[]>();
  const treesAt = (x: number, z: number): TreeInstance[] => {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    const key = chunkKey(cx, cz);
    let list = treeCache.get(key);
    if (!list) {
      list = treesInChunk(terrain, cx, cz);
      treeCache.set(key, list);
    }
    return list;
  };
  const ok = (x: number, z: number): number | null => {
    const h = terrain.heightAt(x, z);
    if (h < WATER_LEVEL + 1.5 || h > 45) return null;
    const dx = terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z);
    const dz = terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2);
    if (dx * dx + dz * dz > 1.0) return null; // pente > ~14°
    for (const t of treesAt(x, z)) {
      const ddx = t.x - x;
      const ddz = t.z - z;
      if (ddx * ddx + ddz * ddz < 9) return null;
    }
    return h;
  };
  // Spirale carrée sur une grille de 6 m (coordonnées entières = sommets de la grille physique).
  for (let ring = 0; ring < 400; ring++) {
    const r = ring * 6;
    const candidates: Array<[number, number]> = [];
    if (ring === 0) candidates.push([0, 0]);
    else {
      for (let i = -ring; i <= ring; i++) {
        candidates.push([i * 6, -r], [i * 6, r]);
        if (i > -ring && i < ring) candidates.push([-r, i * 6], [r, i * 6]);
      }
    }
    for (const [x, z] of candidates) {
      const h = ok(x, z);
      if (h !== null) return { x, y: h + 0.1, z };
    }
  }
  return { x: 0, y: terrain.heightAt(0, 0) + 2, z: 0 };
}

export class LocalSimulation {
  readonly terrain: Terrain;
  readonly phys: PhysicsWorld;
  readonly state: MoveState;
  /** État avant le dernier pas, pour interpoler l'affichage. */
  readonly prev: MoveState;
  readonly spawn: SpawnPoint;
  tick = 0;
  respawns = 0;
  private readonly collider: RAPIER.Collider;

  /** Charge Rapier si nécessaire puis crée la simulation. */
  static async create(seed: number): Promise<LocalSimulation> {
    await initPhysics();
    return new LocalSimulation(seed);
  }

  /** Rapier doit déjà être chargé (initPhysics). */
  constructor(seed: number) {
    this.terrain = new Terrain(seed);
    this.phys = new PhysicsWorld(this.terrain);
    this.spawn = findSpawn(this.terrain);
    this.state = makeState(this.spawn.x, this.spawn.y, this.spawn.z);
    this.prev = makeState(this.spawn.x, this.spawn.y, this.spawn.z);
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, 0);
    this.phys.refresh();
    this.collider = this.phys.createPlayerCollider(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  /** Fait avancer le monde d'un pas avec la commande du joueur. */
  step(cmd: InputCmd): void {
    const q = quantizeInput(cmd);
    copyState(this.prev, this.state);
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, this.tick);
    if (this.tick % 120 === 0) this.phys.unloadUnused(this.tick, 600);
    this.phys.refresh();
    stepMovement(this.phys, this.collider, this.state, q, TICK_DT);
    if (this.state.y < KILL_Y || !Number.isFinite(this.state.x + this.state.y + this.state.z)) this.respawn();
    this.tick++;
  }

  respawn(): void {
    const s = makeState(this.spawn.x, this.spawn.y, this.spawn.z);
    copyState(this.state, s);
    copyState(this.prev, s);
    this.respawns++;
  }

  dispose(): void {
    this.phys.dispose();
  }
}
