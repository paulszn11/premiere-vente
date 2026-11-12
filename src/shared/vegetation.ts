// Flore et décor fixe par biome, placés de façon déterministe (même graine = mêmes arbres).
// Le serveur en tire les collisions, le client les affiche.

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import type { BiomeId } from './geography';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

export type Species = 'miombo' | 'mopane' | 'baobab' | 'acacia' | 'teck' | 'montagne' | 'palmier' | 'figuier';

export interface SpeciesSpec {
  label: string;
  /** Rayon du tronc (× échelle) pour la collision. */
  trunkRadius: number;
  /** Hauteur du tronc (× échelle) pour la collision. */
  trunkHeight: number;
}

export const SPECIES: Record<Species, SpeciesSpec> = {
  miombo: { label: 'Arbre de miombo', trunkRadius: 0.24, trunkHeight: 4.2 },
  mopane: { label: 'Mopane', trunkRadius: 0.18, trunkHeight: 3.4 },
  baobab: { label: 'Baobab', trunkRadius: 1.1, trunkHeight: 6 },
  acacia: { label: 'Acacia', trunkRadius: 0.15, trunkHeight: 3 },
  teck: { label: 'Teck du Zambèze', trunkRadius: 0.22, trunkHeight: 7 },
  montagne: { label: 'Arbre de forêt de montagne', trunkRadius: 0.32, trunkHeight: 6 },
  palmier: { label: 'Palmier ilala', trunkRadius: 0.16, trunkHeight: 6 },
  figuier: { label: 'Figuier sauvage', trunkRadius: 0.4, trunkHeight: 5 },
};

export const SPECIES_LIST = Object.keys(SPECIES) as Species[];

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  species: Species;
  /** Rotation visuelle autour de l'axe vertical, dans [0, 1) tour. */
  rot: number;
}

export interface BushInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  /** Buisson sec (brun) ou vert. */
  dry: boolean;
}

export interface RockInstance {
  x: number;
  y: number;
  z: number;
  /** Rayon du rocher. */
  r: number;
  /** Rocher en équilibre posé dessus (rayon), ou 0. */
  top: number;
}

export interface MoundInstance {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
}

export interface ChunkFlora {
  trees: TreeInstance[];
  bushes: BushInstance[];
  rocks: RockInstance[];
  mounds: MoundInstance[];
}

/** Taille d'une cellule de placement (au plus un élément fixe par cellule). */
export const FLORA_CELL = 8;

const TREE_DENSITY: Record<BiomeId, number> = {
  plateau: 0.06,
  miombo: 0.5,
  vlei: 0.015,
  vallee: 0.22,
  fleuve: 0.45,
  escarpement: 0.25,
  matobo: 0.16,
  hautes_terres: 0.4,
  lowveld: 0.13,
  kalahari: 0.32,
  frontiere: 0.05,
};

const SPECIES_MIX: Record<BiomeId, Array<[Species, number]>> = {
  plateau: [
    ['acacia', 0.45],
    ['miombo', 0.55],
  ],
  miombo: [
    ['miombo', 0.85],
    ['mopane', 0.15],
  ],
  vlei: [['acacia', 1]],
  vallee: [
    ['mopane', 0.72],
    ['acacia', 0.18],
    ['baobab', 0.1],
  ],
  fleuve: [
    ['figuier', 0.55],
    ['palmier', 0.45],
  ],
  escarpement: [
    ['miombo', 0.6],
    ['acacia', 0.4],
  ],
  matobo: [
    ['miombo', 0.55],
    ['acacia', 0.3],
    ['figuier', 0.15],
  ],
  hautes_terres: [
    ['montagne', 0.85],
    ['miombo', 0.15],
  ],
  lowveld: [
    ['acacia', 0.55],
    ['mopane', 0.3],
    ['baobab', 0.15],
  ],
  kalahari: [
    ['teck', 0.8],
    ['acacia', 0.2],
  ],
  frontiere: [['montagne', 1]],
};

const BUSH_DENSITY: Record<BiomeId, number> = {
  plateau: 0.18,
  miombo: 0.15,
  vlei: 0.25,
  vallee: 0.25,
  fleuve: 0.2,
  escarpement: 0.15,
  matobo: 0.15,
  hautes_terres: 0.1,
  lowveld: 0.3,
  kalahari: 0.15,
  frontiere: 0.05,
};

const MOUND_BIOMES = new Set<BiomeId>(['plateau', 'miombo', 'lowveld', 'vallee', 'kalahari']);

function pickSpecies(biome: BiomeId, u: number): Species {
  const mix = SPECIES_MIX[biome];
  let acc = 0;
  for (const [sp, w] of mix) {
    acc += w;
    if (u < acc) return sp;
  }
  return mix[mix.length - 1]![0];
}

function slopeOk(terrain: Terrain, x: number, z: number, maxSlope2: number): boolean {
  const e = 1.5;
  const dx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
  const dz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
  return (dx * dx + dz * dz) / (4 * e * e) <= maxSlope2;
}

export function floraInChunk(terrain: Terrain, cx: number, cz: number): ChunkFlora {
  const out: ChunkFlora = { trees: [], bushes: [], rocks: [], mounds: [] };
  if (!terrain.floraEnabled) return out;
  const n = CHUNK_SIZE / FLORA_CELL;
  const seed = terrain.seed;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = cx * n + gx;
      const wz = cz * n + gz;
      const h0 = hash32(seed, wx, wz, 0x7ee5);
      const h1 = hash32(seed, wx, wz, 0x5ca1e);
      const x = (wx + 0.15 + (((h0 >>> 16) & 0xff) / 256) * 0.7) * FLORA_CELL;
      const z = (wz + 0.15 + (((h0 >>> 24) & 0xff) / 256) * 0.7) * FLORA_CELL;
      const s = terrain.sampleInto(x, z);
      const biome = s.biome;
      const height = s.height;
      const kopje = s.kopje;
      const p = (h0 & 0xffff) / 65536;

      // Un seul élément fixe par cellule : arbre, rocher ou termitière.
      let treeChance = TREE_DENSITY[biome];
      if (kopje > 0.5) treeChance = 0;
      else if (biome === 'hautes_terres' && height > 430) treeChance *= 0.1;
      let rockChance = 0;
      if (kopje > 0.25) rockChance = 0.35;
      else if (biome === 'matobo') rockChance = 0.06;
      else if (biome === 'escarpement' || biome === 'frontiere') rockChance = 0.05;
      else if (biome === 'hautes_terres') rockChance = 0.03;
      else rockChance = 0.008;
      const moundChance = MOUND_BIOMES.has(biome) && kopje < 0.2 ? 0.025 : 0;

      if (height > WATER_LEVEL + 0.8) {
        if (p < treeChance) {
          if (slopeOk(terrain, x, z, 0.36)) {
            out.trees.push({
              x,
              y: height,
              z,
              scale: 0.75 + ((h1 & 0xffff) / 65536) * 0.7,
              species: pickSpecies(biome, ((h1 >>> 16) & 0xffff) / 65536),
              rot: ((h0 >>> 8) & 0xff) / 256,
            });
          }
        } else if (p < treeChance + rockChance) {
          const r = (kopje > 0.25 ? 0.8 : 0.5) + ((h1 & 0xff) / 255) * (kopje > 0.25 ? 1.6 : 1.1);
          const y = terrain.heightAt(x, z) + r * 0.45;
          const top = biome === 'matobo' && ((h1 >>> 8) & 0xff) < 46 ? r * (0.6 + (((h1 >>> 16) & 0xff) / 255) * 0.3) : 0;
          out.rocks.push({ x, y, z, r, top });
        } else if (p < treeChance + rockChance + moundChance) {
          out.mounds.push({ x, y: height, z, height: 1.2 + ((h1 & 0xff) / 255) * 2, radius: 0.8 + (((h1 >>> 8) & 0xff) / 255) * 0.8 });
        }
      }

      // Buissons : position indépendante, pas de collision (on les traverse).
      const hb = hash32(seed, wx, wz, 0xb05);
      if ((hb & 0xffff) / 65536 < BUSH_DENSITY[biome] && kopje < 0.6) {
        const bx = (wx + (((hb >>> 16) & 0xff) / 256)) * FLORA_CELL;
        const bz = (wz + (((hb >>> 24) & 0xff) / 256)) * FLORA_CELL;
        const by = terrain.heightAt(bx, bz);
        if (by > WATER_LEVEL + 0.3) {
          out.bushes.push({
            x: bx,
            y: by,
            z: bz,
            scale: 0.6 + ((h1 >>> 24) / 255) * 0.9,
            rot: ((hb >>> 8) & 0xff) / 256,
            dry: biome === 'lowveld' || biome === 'kalahari' || biome === 'vallee',
          });
        }
      }
    }
  }
  return out;
}
