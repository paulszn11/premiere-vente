// Relief du monde, calculé à partir de la graine (voir geography.ts pour la carte).
// Le client (affichage + prédiction) et le serveur (physique de référence) appellent
// exactement les mêmes fonctions : le monde n'a jamais besoin d'être envoyé sur le réseau.

import { CHUNK_SIZE } from './constants';
import { type GeoSample, Geography, type SurfaceId, surfaceOf } from './geography';

export interface HeightSource {
  readonly seed: number;
  heightAt(x: number, z: number): number;
}

export class Terrain implements HeightSource {
  readonly seed: number;
  readonly geo: Geography;
  /** Les terrains de test peuvent désactiver la flore et les objets. */
  floraEnabled = true;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.geo = new Geography(this.seed);
  }

  /** Altitude du sol (en mètres) au point (x, z). */
  heightAt(x: number, z: number): number {
    return this.geo.heightAt(x, z);
  }

  /** Détails du point (biome, masques) dans un tampon réutilisé : à lire aussitôt. */
  sampleInto(x: number, z: number): Readonly<GeoSample> {
    return this.geo.sampleInto(x, z);
  }

  /** Détails du point (nouvel objet). */
  sample(x: number, z: number): GeoSample {
    return { ...this.sampleInto(x, z) };
  }

  /** Composante verticale de la normale du sol (1 = plat). */
  normalY(x: number, z: number): number {
    const e = 0.75;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Nature du sol sous un point. */
  surfaceAt(x: number, z: number): SurfaceId {
    const ny = this.normalY(x, z);
    return surfaceOf(this.sampleInto(x, z), ny);
  }

  /** Courant de l'eau au point (m/s). */
  currentAt(x: number, z: number): { x: number; z: number } {
    return this.geo.currentAt(x, z);
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
