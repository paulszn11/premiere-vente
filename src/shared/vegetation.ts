// Placement déterministe des arbres. Le serveur en tire les collisions des troncs,
// le client les affiche : les deux obtiennent les mêmes arbres à partir de la graine.

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  /** Facteur d'échelle de l'arbre (1 = arbre moyen). */
  scale: number;
  /** Variante visuelle (0 à 2). */
  variant: number;
  /** Rotation visuelle autour de l'axe vertical, dans [0, 1) tour. */
  rot: number;
}

/** Taille d'une cellule de placement (au plus un arbre par cellule). */
export const TREE_CELL = 8;
/** Rayon du tronc (multiplié par l'échelle). */
export const TREE_TRUNK_RADIUS = 0.22;
/** Hauteur du tronc utilisée pour la collision (multipliée par l'échelle). */
export const TREE_TRUNK_HEIGHT = 4.2;
export const TREE_LINE = 72;

export function treesInChunk(terrain: Terrain, cx: number, cz: number): TreeInstance[] {
  const out: TreeInstance[] = [];
  const n = CHUNK_SIZE / TREE_CELL;
  const seed = terrain.seed;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = cx * n + gx;
      const wz = cz * n + gz;
      const h0 = hash32(seed, wx, wz, 0x7ee5);
      const p = (h0 & 0xffff) / 65536;
      const jx = ((h0 >>> 16) & 0xff) / 256;
      const jz = ((h0 >>> 24) & 0xff) / 256;
      const x = (wx + 0.15 + jx * 0.7) * TREE_CELL;
      const z = (wz + 0.15 + jz * 0.7) * TREE_CELL;
      const density = terrain.forestDensity(x, z);
      if (p > 0.04 + density * 0.8) continue;
      const y = terrain.heightAt(x, z);
      if (y < WATER_LEVEL + 1.2 || y > TREE_LINE) continue;
      const e = 1.5;
      const dx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
      const dz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
      const slope2 = (dx * dx + dz * dz) / (4 * e * e);
      if (slope2 > 0.36) continue;
      const h1 = hash32(seed, wx, wz, 0x5ca1e);
      out.push({
        x,
        y,
        z,
        scale: 0.75 + ((h1 & 0xffff) / 65536) * 0.7,
        variant: (h1 >>> 16) % 3,
        rot: ((h1 >>> 18) & 0x3fff) / 16384,
      });
    }
  }
  return out;
}
