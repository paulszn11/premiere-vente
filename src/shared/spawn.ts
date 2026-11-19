// Points d'apparition. Principe du jeu : chaque joueur arrive à un endroit au hasard, loin
// des autres, et se retrouver doit être très difficile. Le serveur (phase 8) passera la
// liste des joueurs existants ; en solo, l'apparition est simplement aléatoire.

import { CHUNK_SIZE, WATER_LEVEL, WORLD_HALF } from './constants';
import type { BiomeId } from './geography';
import { type NodeKind, nodesInChunk } from './resources';
import { type PlaceKind, type PlaceSite, placesOf } from './places';
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
  /**
   * Place le joueur dans l'eau profonde, face à une paroi à escalader, devant le gisement le plus proche,
   * ou (phase 9) au pied de la chute d'eau, au bord du ruisseau ou dans le bassin les plus proches.
   */
  kind?: 'eau' | 'paroi' | 'gisement' | 'chute' | 'ruisseau' | 'bassin' | 'lieu';
  node?: NodeKind;
  /** Phase 9 : lieu abandonné le plus proche (devant son entrée). */
  place?: PlaceKind;
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
  { id: 'quartz', label: 'Bloc de quartz le plus proche', x: 0, z: 0, kind: 'gisement', node: 'bloc_quartz' },
  { id: 'argile', label: 'Gisement d’argile le plus proche', x: 0, z: 0, kind: 'gisement', node: 'gisement_argile' },
  { id: 'fer', label: 'Affleurement de fer le plus proche', x: 0, z: 0, kind: 'gisement', node: 'filon_fer' },
  { id: 'or', label: 'Gravier aurifère le plus proche', x: 0, z: 0, kind: 'gisement', node: 'gravier_or' },
  { id: 'chute', label: 'Chute d’eau la plus proche', x: 0, z: 0, kind: 'chute' },
  { id: 'ruisseau', label: 'Ruisseau le plus proche', x: 0, z: 0, kind: 'ruisseau' },
  { id: 'bassin', label: 'Bassin le plus proche (nager)', x: 0, z: 0, kind: 'bassin' },
  { id: 'lieu_ferme', label: 'Ferme abandonnée la plus proche', x: 0, z: 0, kind: 'lieu', place: 'ferme' },
  { id: 'lieu_mission', label: 'Mission', x: 0, z: 0, kind: 'lieu', place: 'mission' },
  { id: 'lieu_gare', label: 'Halte ferroviaire', x: 0, z: 0, kind: 'lieu', place: 'gare' },
  { id: 'lieu_station', label: 'Station de recherche du lac', x: 0, z: 0, kind: 'lieu', place: 'station' },
  { id: 'lieu_mine', label: 'Mine de la Colline Rouge', x: 0, z: 0, kind: 'lieu', place: 'mine' },
  { id: 'lieu_ruines', label: 'Enceinte de pierre sèche la plus proche', x: 0, z: 0, kind: 'lieu', place: 'ruines' },
  { id: 'lieu_cercle', label: 'Les Pierres Debout', x: 0, z: 0, kind: 'lieu', place: 'cercle' },
];

/** Phase 9 : devant l'entrée du lieu abandonné le plus proche (outil de test). */
function nearestPlace(terrain: Terrain, kind: PlaceKind, x0: number, z0: number): ResolvedDestination | null {
  let best: PlaceSite | null = null;
  let bd = Infinity;
  for (const p of placesOf(terrain)) {
    if (p.kind !== kind) continue;
    const d = Math.hypot(p.x - x0, p.z - z0);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return null;
  // Les portes donnent sur le côté −z du lieu : on se place à 45 m devant (un lieu n’apparaît pas sous les
  // pieds d’un joueur), tourné vers lui.
  const c = Math.cos(best.yaw);
  const n = Math.sin(best.yaw);
  // Devant d'abord, puis sur les côtés et derrière (la station du lac a sa porte face à l'eau).
  for (const [lx, lz] of [
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
  ] as const) {
    for (const back of [45, 55]) {
      const x = best.x + (lx * c + lz * n) * back;
      const z = best.z + (-lx * n + lz * c) * back;
      const h = terrain.heightAt(x, z);
      if (terrain.waterLevelAt(x, z) > h - 0.1) continue;
      return { x, y: h + 0.3, z, yaw: Math.atan2(best.x - x, best.z - z) };
    }
  }
  return null;
}

/** Phase 9 : chute d'eau, ruisseau ou bassin le plus proche (outil de test). */
function nearestWater(terrain: Terrain, kind: 'chute' | 'ruisseau' | 'bassin', x0: number, z0: number): ResolvedDestination | null {
  if (!terrain.floraEnabled) return null;
  const hydro = terrain.hydro;
  hydro.ensure(x0, z0);
  const dry = (x: number, z: number) => {
    const h = terrain.heightAt(x, z);
    return terrain.waterLevelAt(x, z) < h - 0.05 ? h : null;
  };
  if (kind === 'chute') {
    // Les grandes chutes comptent comme plus proches (20 m de distance par mètre de hauteur).
    let best = null;
    let bd = Infinity;
    for (const f of hydro.falls.values()) {
      const d = Math.hypot(f.x2 - x0, f.z2 - z0) - (f.top - f.bottom) * 20;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) return null;
    // Au pied, un peu en aval et sur le côté, face à la chute.
    const mx = (best.x + best.x2) / 2;
    const mz = (best.z + best.z2) / 2;
    for (const back of [8, 12, 16, 22]) {
      for (const side of [1, -1]) {
        const off = best.width * 0.5 + 3;
        const x = best.x2 + best.dx * back - best.dz * side * off;
        const z = best.z2 + best.dz * back + best.dx * side * off;
        const h = dry(x, z);
        if (h !== null) return { x, y: h + 0.2, z, yaw: Math.atan2(mx - x, mz - z) };
      }
    }
    return null;
  }
  if (kind === 'bassin') {
    let best = null;
    let bd = Infinity;
    for (const p of hydro.pools.values()) {
      if (p.depth === undefined || p.floor !== undefined) continue;
      const d = Math.hypot(p.x - x0, p.z - z0);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? { x: best.x, y: best.surface - 1.3, z: best.z, yaw: null } : null;
  }
  // Ruisseau : au bord d'un tronçon assez profond pour y marcher dans l'eau, face au courant.
  let best: { x: number; z: number; dx: number; dz: number; w: number } | null = null;
  let bd = Infinity;
  for (const st of hydro.streams.values()) {
    const pts = st.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (a.fall || a.seep || a.width < 2) continue;
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      const d = Math.hypot(x - x0, z - z0);
      if (d >= bd) continue;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      bd = d;
      best = { x, z, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l, w: a.width };
    }
  }
  if (!best) return null;
  for (const side of [1, -1]) {
    for (const off of [1.5, 2.5, 4]) {
      const x = best.x - best.dz * side * (best.w * 0.5 + off);
      const z = best.z + best.dx * side * (best.w * 0.5 + off);
      const h = dry(x, z);
      if (h !== null) return { x, y: h + 0.2, z, yaw: Math.atan2(best.x - x, best.z - z) };
    }
  }
  return null;
}

/** Gisement d'un type donné le plus proche d'un point (recherche par anneaux de chunks, 4 km au plus). */
export function nearestNode(terrain: Terrain, kind: NodeKind, x0: number, z0: number, maxRings = 64): { x: number; z: number; y: number } | null {
  const c0 = chunkCoord(x0);
  const r0 = chunkCoord(z0);
  let best: { x: number; z: number; y: number } | null = null;
  let bestD = Infinity;
  for (let ring = 0; ring <= maxRings; ring++) {
    for (let cz = r0 - ring; cz <= r0 + ring; cz++) {
      for (let cx = c0 - ring; cx <= c0 + ring; cx++) {
        if (Math.max(Math.abs(cx - c0), Math.abs(cz - r0)) !== ring) continue;
        for (const n of nodesInChunk(terrain, cx, cz)) {
          if (n.kind !== kind) continue;
          const d = Math.hypot(n.x - x0, n.z - z0);
          if (d < bestD) {
            bestD = d;
            best = { x: n.x, z: n.z, y: n.y };
          }
        }
      }
    }
    // Un gisement trouvé à l'anneau r peut être battu par un autre de l'anneau r + 1, pas au-delà.
    if (best && bestD < ring * CHUNK_SIZE) break;
  }
  return best;
}

export interface ResolvedDestination {
  x: number;
  y: number;
  z: number;
  /** Cap à donner au regard (face à la paroi pour l'escalade). */
  yaw: number | null;
}

/** Trouve un point précis pour une destination de test. */
export function resolveDestination(terrain: Terrain, d: TestDestination, from: { x: number; z: number } = { x: d.x, z: d.z }): ResolvedDestination {
  if (d.kind === 'eau') return { x: d.x, y: WATER_LEVEL - 1.3, z: d.z, yaw: null };
  if (d.kind === 'lieu' && d.place) {
    const r = nearestPlace(terrain, d.place, from.x, from.z);
    return r ?? { x: from.x, y: terrain.heightAt(from.x, from.z) + 0.2, z: from.z, yaw: null };
  }
  if (d.kind === 'chute' || d.kind === 'ruisseau' || d.kind === 'bassin') {
    const r = nearestWater(terrain, d.kind, from.x, from.z);
    return r ?? { x: from.x, y: terrain.heightAt(from.x, from.z) + 0.2, z: from.z, yaw: null };
  }
  if (d.kind === 'gisement' && d.node) {
    const n = nearestNode(terrain, d.node, from.x, from.z);
    if (n) {
      // Un pas à côté du gisement, sur la terre ferme, le regard tourné vers lui.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = n.x + Math.cos(a) * 1.9;
        const z = n.z + Math.sin(a) * 1.9;
        const h = terrain.heightAt(x, z);
        if (h < WATER_LEVEL + 0.1) continue;
        return { x, y: h + 0.2, z, yaw: Math.atan2(n.x - x, n.z - z) };
      }
    }
    return { x: from.x, y: terrain.heightAt(from.x, from.z) + 0.2, z: from.z, yaw: null };
  }
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
