// Points d'apparition. Principe du jeu : chaque joueur arrive à un endroit au hasard, loin
// des autres, et se retrouver doit être très difficile. Le serveur (phase 8) passera la
// liste des joueurs existants ; en solo, l'apparition est simplement aléatoire.

import { WATER_LEVEL, WORLD_HALF } from './constants';
import type { BiomeId } from './geography';
import { mulberry32 } from './rng';
import { type Terrain, chunkCoord, chunkKey } from './terrain';
import { type TreeInstance, floraInChunk } from './vegetation';

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Distance minimale visée entre deux joueurs à l'apparition. */
export const MIN_SPAWN_DISTANCE = 4000;
/** Marge intérieure par rapport aux montagnes frontalières. */
const SPAWN_MARGIN = 1000;

const treeCache = new WeakMap<Terrain, Map<string, TreeInstance[]>>();

function treesNear(terrain: Terrain, x: number, z: number): TreeInstance[] {
  let cache = treeCache.get(terrain);
  if (!cache) {
    cache = new Map();
    treeCache.set(terrain, cache);
  }
  const key = chunkKey(chunkCoord(x), chunkCoord(z));
  let list = cache.get(key);
  if (!list) {
    list = floraInChunk(terrain, chunkCoord(x), chunkCoord(z)).trees;
    cache.set(key, list);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return list;
}

/** Altitude du sol si le point convient pour apparaître (terre ferme, peu pentue, dégagée), sinon null. */
export function spawnHeight(terrain: Terrain, x: number, z: number): number | null {
  if (Math.abs(x) > WORLD_HALF - SPAWN_MARGIN || Math.abs(z) > WORLD_HALF - SPAWN_MARGIN) return null;
  const s = terrain.sampleInto(x, z);
  const h = s.height;
  if (h < WATER_LEVEL + 1.5 || h > 420 || s.kopje > 0.2 || s.biome === 'frontiere') return null;
  const dx = terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z);
  const dz = terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2);
  if (dx * dx + dz * dz > 1.0) return null;
  for (const t of treesNear(terrain, x, z)) {
    const ddx = t.x - x;
    const ddz = t.z - z;
    if (ddx * ddx + ddz * ddz < 9) return null;
  }
  return h;
}

/**
 * Choisit un point d'apparition aléatoire (graine `seed`), à au moins `minDistance` mètres
 * des joueurs déjà présents si possible ; sinon le plus éloigné trouvé.
 */
export function chooseSpawn(terrain: Terrain, seed: number, others: ReadonlyArray<{ x: number; z: number }> = [], minDistance = MIN_SPAWN_DISTANCE, attempts = 600): SpawnPoint {
  const rand = mulberry32(seed);
  let best: SpawnPoint | null = null;
  let bestScore = -1;
  const range = WORLD_HALF - SPAWN_MARGIN;
  for (let i = 0; i < attempts; i++) {
    const x = Math.round((rand() * 2 - 1) * range);
    const z = Math.round((rand() * 2 - 1) * range);
    const h = spawnHeight(terrain, x, z);
    if (h === null) continue;
    let score = Infinity;
    for (const o of others) {
      const dx = o.x - x;
      const dz = o.z - z;
      score = Math.min(score, Math.sqrt(dx * dx + dz * dz));
    }
    const p = { x, y: h + 0.1, z };
    if (score >= minDistance) return p;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ?? findSpawnNear(terrain, 0, 0);
}

/** Cherche, en spirale carrée autour de (x0, z0), un point d'apparition valable. */
export function findSpawnNear(terrain: Terrain, x0: number, z0: number, step = 6, maxRings = 400): SpawnPoint {
  for (let ring = 0; ring < maxRings; ring++) {
    const r = ring * step;
    const candidates: Array<[number, number]> = [];
    if (ring === 0) candidates.push([x0, z0]);
    else {
      for (let i = -ring; i <= ring; i++) {
        candidates.push([x0 + i * step, z0 - r], [x0 + i * step, z0 + r]);
        if (i > -ring && i < ring) candidates.push([x0 - r, z0 + i * step], [x0 + r, z0 + i * step]);
      }
    }
    for (const [x, z] of candidates) {
      const h = spawnHeight(terrain, x, z);
      if (h !== null) return { x, y: h + 0.1, z };
    }
  }
  return { x: x0, y: terrain.heightAt(x0, z0) + 2, z: z0 };
}

/** Destinations de l'outil de test (téléportation), avec un point de départ de recherche. */
export interface TestDestination {
  id: string;
  label: string;
  biome?: BiomeId;
  x: number;
  z: number;
  /** Place le joueur dans l'eau profonde, ou face à une paroi à escalader. */
  kind?: 'eau' | 'paroi';
}

export const TEST_DESTINATIONS: TestDestination[] = [
  { id: 'plateau', label: 'Haut plateau (prairie)', biome: 'plateau', x: 0, z: 0 },
  { id: 'miombo', label: 'Forêt de miombo', biome: 'miombo', x: 600, z: 800 },
  { id: 'vlei', label: 'Zone humide (boue)', biome: 'vlei', x: -800, z: 300 },
  { id: 'vallee', label: 'Vallée du Zambèze', biome: 'vallee', x: 3000, z: 5100 },
  { id: 'fleuve', label: 'Bords du Zambèze', biome: 'fleuve', x: 2500, z: 6000 },
  { id: 'lac', label: 'Grand lac (nager)', x: -2400, z: 5900, kind: 'eau' },
  { id: 'escarpement', label: 'Escarpement', biome: 'escarpement', x: 0, z: 4200 },
  { id: 'kopje', label: 'Paroi de granit (grimper)', x: -4300, z: -3400, kind: 'paroi' },
  { id: 'matobo', label: 'Collines de granit', biome: 'matobo', x: -4300, z: -3400 },
  { id: 'hautes_terres', label: 'Hautes terres de l’Est', biome: 'hautes_terres', x: 6400, z: 0 },
  { id: 'lowveld', label: 'Lowveld (savane sèche)', biome: 'lowveld', x: 0, z: -6000 },
  { id: 'kalahari', label: 'Sables du Kalahari', biome: 'kalahari', x: -6500, z: 0 },
];

export interface ResolvedDestination {
  x: number;
  y: number;
  z: number;
  /** Cap à donner au regard (face à la paroi pour l'escalade). */
  yaw: number | null;
}

/** Trouve un point précis pour une destination de test. */
export function resolveDestination(terrain: Terrain, d: TestDestination): ResolvedDestination {
  if (d.kind === 'eau') return { x: d.x, y: WATER_LEVEL - 1.3, z: d.z, yaw: null };
  if (d.kind === 'paroi') {
    // Pied d'une paroi raide : on cherche une forte pente puis on recule d'un pas.
    for (let ring = 0; ring < 120; ring++) {
      for (let i = 0; i < 8 * Math.max(1, ring); i++) {
        const a = (i / (8 * Math.max(1, ring))) * Math.PI * 2;
        const x = d.x + Math.cos(a) * ring * 12;
        const z = d.z + Math.sin(a) * ring * 12;
        const e = 1;
        const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
        const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
        const g = Math.sqrt(gx * gx + gz * gz);
        if (g < 2) continue; // pente < 63°
        // Reculer vers le bas de la pente jusqu'à un sol praticable.
        let bx = x;
        let bz = z;
        for (let k = 0; k < 40; k++) {
          bx -= (gx / g) * 0.5;
          bz -= (gz / g) * 0.5;
          const hx = (terrain.heightAt(bx + e, bz) - terrain.heightAt(bx - e, bz)) / (2 * e);
          const hz = (terrain.heightAt(bx, bz + e) - terrain.heightAt(bx, bz - e)) / (2 * e);
          if (hx * hx + hz * hz < 0.64) break; // pente < 39° : on tient debout, la paroi est proche
        }
        const h = terrain.heightAt(bx, bz);
        if (h < WATER_LEVEL + 1) continue;
        return { x: bx, y: h + 0.2, z: bz, yaw: Math.atan2(gx, gz) };
      }
    }
  }
  // Point du biome demandé le plus proche du point de départ.
  for (let ring = 0; ring < 150; ring++) {
    const n = Math.max(1, ring * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.round(d.x + Math.cos(a) * ring * 40);
      const z = Math.round(d.z + Math.sin(a) * ring * 40);
      if (d.biome && terrain.sampleInto(x, z).biome !== d.biome) continue;
      const h = spawnHeight(terrain, x, z);
      if (h !== null) return { x, y: h + 0.1, z, yaw: null };
    }
  }
  const p = findSpawnNear(terrain, d.x, d.z);
  return { ...p, yaw: null };
}
