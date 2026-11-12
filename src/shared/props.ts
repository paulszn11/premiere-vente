// Objets déplaçables posés dans la nature : pierres, bûches, troncs.
// Leur position d'origine est déterministe ; une fois déplacés, leur nouvel état est
// mémorisé par la simulation (et sauvegardé par l'hôte en phase 8).

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import type { BiomeId } from './geography';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

export type PropKind = 'pierre' | 'buche' | 'tronc';
export type Handling = 'une-main' | 'deux-mains' | 'trainer';

export interface PropDef {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** Orientation autour de l'axe vertical, dans [0, 1) tour. */
  rot: number;
  /** Pierre : rayon. Bûche et tronc : rayon (la longueur est dans `length`). */
  radius: number;
  length: number;
}

export const PROP_LABELS: Record<PropKind, string> = { pierre: 'pierre', buche: 'bûche', tronc: 'tronc' };
export const DENSITY: Record<PropKind, number> = { pierre: 2600, buche: 700, tronc: 700 };

/** Au-delà de 8 kg : à deux mains ; au-delà de 60 kg : on ne peut que le traîner. */
export const ONE_HAND_MAX_KG = 8;
export const TWO_HANDS_MAX_KG = 60;

export function propMass(p: Pick<PropDef, 'kind' | 'radius' | 'length'>): number {
  const v = p.kind === 'pierre' ? (4 / 3) * Math.PI * p.radius * p.radius * p.radius : Math.PI * p.radius * p.radius * p.length;
  return v * DENSITY[p.kind];
}

export function handlingFor(mass: number): Handling {
  if (mass <= ONE_HAND_MAX_KG) return 'une-main';
  if (mass <= TWO_HANDS_MAX_KG) return 'deux-mains';
  return 'trainer';
}

const PROP_CELL = 16;
const FOREST_BIOMES = new Set<BiomeId>(['miombo', 'fleuve', 'hautes_terres', 'kalahari', 'escarpement']);
const ROCKY_BIOMES = new Set<BiomeId>(['matobo', 'escarpement', 'frontiere', 'hautes_terres']);

export function propsInChunk(terrain: Terrain, cx: number, cz: number): PropDef[] {
  const out: PropDef[] = [];
  if (!terrain.floraEnabled) return out;
  const n = CHUNK_SIZE / PROP_CELL;
  const seed = terrain.seed;
  let i = 0;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = cx * n + gx;
      const wz = cz * n + gz;
      const h = hash32(seed, wx, wz, 0x9e09);
      const h2 = hash32(seed, wx, wz, 0x9e0a);
      const x = (wx + 0.1 + (((h >>> 16) & 0xff) / 256) * 0.8) * PROP_CELL;
      const z = (wz + 0.1 + (((h >>> 24) & 0xff) / 256) * 0.8) * PROP_CELL;
      const s = terrain.sampleInto(x, z);
      if (s.height < WATER_LEVEL + 0.4) continue;
      const p = (h & 0xffff) / 65536;
      const rocky = ROCKY_BIOMES.has(s.biome) || s.kopje > 0.2 || s.bank > 0.5;
      const stoneChance = rocky ? 0.4 : 0.14;
      const logChance = FOREST_BIOMES.has(s.biome) ? 0.2 : s.biome === 'plateau' || s.biome === 'vallee' ? 0.04 : 0;
      const trunkChance = FOREST_BIOMES.has(s.biome) ? 0.03 : 0;
      let def: Omit<PropDef, 'id' | 'y'> | null = null;
      const u = (h2 & 0xffff) / 65536;
      const rot = ((h2 >>> 16) & 0xff) / 256;
      if (p < stoneChance) def = { kind: 'pierre', x, z, rot, radius: 0.06 + u * 0.07, length: 0 };
      else if (p < stoneChance + logChance) def = { kind: 'buche', x, z, rot, radius: 0.07 + u * 0.04, length: 0.6 + (((h2 >>> 24) & 0xff) / 255) * 0.6 };
      else if (p < stoneChance + logChance + trunkChance) def = { kind: 'tronc', x, z, rot, radius: 0.18 + u * 0.06, length: 2.2 + (((h2 >>> 24) & 0xff) / 255) * 1 };
      if (!def) continue;
      const lift = def.kind === 'pierre' ? def.radius : def.radius;
      out.push({ ...def, id: `${cx}:${cz}:${i++}`, y: terrain.heightAt(x, z) + lift + 0.05 });
    }
  }
  return out;
}
