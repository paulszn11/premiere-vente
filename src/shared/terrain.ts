// Génération déterministe du relief à partir de la graine du monde.
// Le client (affichage + prédiction) et le serveur (physique de référence) appellent
// exactement les mêmes fonctions : le monde n'a jamais besoin d'être envoyé sur le réseau.

import { CHUNK_SIZE } from './constants';
import { Simplex2, lerp, smoothstep } from './noise';
import { hash32 } from './rng';

export interface HeightSource {
  readonly seed: number;
  heightAt(x: number, z: number): number;
}

const INV_CONTINENT = 1 / 1500;
const INV_HILLS = 1 / 280;
const INV_MOUNTAIN_MASK = 1 / 2000;
const INV_RIDGES = 1 / 600;
const INV_DETAIL = 1 / 23;
const INV_FOREST = 1 / 350;
const INV_SPAWN_R2 = 1 / (260 * 260);

export class Terrain implements HeightSource {
  readonly seed: number;
  private readonly continent: Simplex2;
  private readonly hills: Simplex2;
  private readonly mountainMask: Simplex2;
  private readonly ridges: Simplex2;
  private readonly detail: Simplex2;
  private readonly forest: Simplex2;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.continent = new Simplex2(hash32(this.seed, 1));
    this.hills = new Simplex2(hash32(this.seed, 2));
    this.mountainMask = new Simplex2(hash32(this.seed, 3));
    this.ridges = new Simplex2(hash32(this.seed, 4));
    this.detail = new Simplex2(hash32(this.seed, 5));
    this.forest = new Simplex2(hash32(this.seed, 6));
  }

  /** Altitude du sol (en mètres) au point (x, z). */
  heightAt(x: number, z: number): number {
    const c = this.continent.fbm(x * INV_CONTINENT, z * INV_CONTINENT, 3);
    const land = smoothstep(-0.32, 0.18, c);
    const hills = this.hills.fbm(x * INV_HILLS, z * INV_HILLS, 4);
    const mountains = smoothstep(0.05, 0.55, this.mountainMask.fbm(x * INV_MOUNTAIN_MASK, z * INV_MOUNTAIN_MASK, 2));
    const r = this.ridges.ridged(x * INV_RIDGES, z * INV_RIDGES, 4);
    const detail = this.detail.noise(x * INV_DETAIL, z * INV_DETAIL);

    let h = -20 + land * 28; // fonds marins ≈ -20 m, plaines ≈ +8 m
    h += hills * (3 + 11 * land);
    h += r * r * 95 * mountains * land;
    h += detail * 0.45;

    // Zone de départ : relevée doucement au-dessus de l'eau autour de l'origine.
    const d2 = (x * x + z * z) * INV_SPAWN_R2;
    if (d2 < 1) {
      const f = 1 - d2;
      const target = 5 + hills * 2.5;
      if (h < target) h = lerp(h, target, f * f);
    }
    return h;
  }

  /** Densité de forêt dans [0, 1]. */
  forestDensity(x: number, z: number): number {
    return smoothstep(-0.15, 0.45, this.forest.fbm(x * INV_FOREST, z * INV_FOREST, 3));
  }

  /**
   * Hauteurs d'un chunk sur une grille de (cells + 1)² sommets, rangées par lignes :
   * index = iz * (cells + 1) + ix, avec x = cx * CHUNK_SIZE + ix * pas.
   */
  sampleChunk(cx: number, cz: number, cells: number): Float32Array {
    const n = cells + 1;
    const step = CHUNK_SIZE / cells;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const out = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      const z = z0 + iz * step;
      for (let ix = 0; ix < n; ix++) {
        out[iz * n + ix] = this.heightAt(x0 + ix * step, z);
      }
    }
    return out;
  }
}

/** Clé texte d'un chunk. */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Coordonnée de chunk contenant la position x (ou z). */
export function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

/**
 * Altitude sur la surface triangulée exactement comme le moteur physique
 * (diagonale reliant les sommets (x+1, z) et (x, z+1) de chaque cellule).
 */
export function triangulatedHeight(source: HeightSource, x: number, z: number, cellSize: number): number {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);
  const u = x / cellSize - gx;
  const v = z / cellSize - gz;
  const x0 = gx * cellSize;
  const z0 = gz * cellSize;
  const h00 = source.heightAt(x0, z0);
  const h10 = source.heightAt(x0 + cellSize, z0);
  const h01 = source.heightAt(x0, z0 + cellSize);
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  const h11 = source.heightAt(x0 + cellSize, z0 + cellSize);
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
