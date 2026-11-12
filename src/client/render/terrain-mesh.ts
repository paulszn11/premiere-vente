// Construction des données de maillage d'un chunk de terrain (sans dépendance au moteur 3D).
// Les triangles sont découpés comme dans le moteur physique, pour que le sol affiché
// corresponde exactement au sol sur lequel on marche quand le détail est maximal.
// Les couleurs suivent les biomes, avec des transitions continues.

import { CHUNK_SIZE, WATER_LEVEL } from '../../shared/constants';
import type { GeoSample } from '../../shared/geography';
import { smoothstep } from '../../shared/noise';
import { hash32 } from '../../shared/rng';
import type { HeightSource } from '../../shared/terrain';

export interface TerrainMeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Couleurs RVBA par sommet. */
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  gridVertexCount: number;
}

/** Source de relief avec détails de biome (le Terrain du jeu ; les terrains de test peuvent s'en passer). */
interface DetailedSource extends HeightSource {
  sampleInto?: (x: number, z: number) => Readonly<GeoSample>;
}

function mix(c: number[], r: number, g: number, b: number, t: number): void {
  if (t <= 0) return;
  if (t > 1) t = 1;
  c[0] = c[0]! + (r - c[0]!) * t;
  c[1] = c[1]! + (g - c[1]!) * t;
  c[2] = c[2]! + (b - c[2]!) * t;
}

const tmp = [0, 0, 0];

/** Couleur du sol : herbe du plateau, miombo, terre rouge, sable, boue, granite, roche, neige. */
export function groundColor(s: Readonly<GeoSample> | null, h: number, ny: number, wx: number, wz: number, out: Float32Array, o: number): void {
  const c = tmp;
  c[0] = 0.55;
  c[1] = 0.55;
  c[2] = 0.3;
  if (s) {
    mix(c, 0.36, 0.47, 0.22, s.forest * (1 - s.valley) * (1 - s.south) * (1 - s.west) * 0.8);
    mix(c, 0.3, 0.48, 0.25, s.east);
    mix(c, 0.57, 0.43, 0.29, Math.max(s.valley, s.south) * 0.85);
    mix(c, 0.8, 0.71, 0.52, s.west * 0.9);
    mix(c, 0.27, 0.43, 0.2, s.bank * 0.6);
    mix(c, 0.33, 0.27, 0.19, smoothstep(0.2, 0.5, s.wetland));
  }
  mix(c, 0.62, 0.56, 0.42, 1 - smoothstep(WATER_LEVEL + 0.3, WATER_LEVEL + 2, h));
  mix(c, 0.3, 0.3, 0.24, 1 - smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.3, h));
  if (s) mix(c, 0.62, 0.56, 0.52, smoothstep(0.35, 0.7, s.kopje));
  mix(c, 0.45, 0.43, 0.41, 1 - smoothstep(0.66, 0.82, ny));
  if (s) mix(c, 0.36, 0.34, 0.33, s.border);
  mix(c, 0.93, 0.94, 0.96, smoothstep(465, 490, h) * smoothstep(0.7, 0.85, ny));
  const v = ((hash32(Math.floor(wx * 0.25), Math.floor(wz * 0.25), 17) & 255) / 255) * 0.07 - 0.035;
  out[o] = c[0]! + v;
  out[o + 1] = c[1]! + v;
  out[o + 2] = c[2]! + v * 0.5;
  out[o + 3] = 1;
}

/**
 * Maillage du chunk (cx, cz) avec `cells` cellules par côté. Les positions sont relatives
 * à l'origine du chunk. Des « jupes » verticales sur les bords masquent les fissures entre
 * deux chunks de détails différents.
 */
export function buildTerrainMesh(terrain: DetailedSource, cx: number, cz: number, cells: number): TerrainMeshData {
  const n = cells + 1;
  const step = CHUNK_SIZE / cells;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const m = n + 2;
  const h = new Float32Array(m * m);
  const detailed = typeof terrain.sampleInto === 'function';
  for (let j = 0; j < m; j++) {
    const inner = j > 0 && j < m - 1;
    for (let i = 0; i < m; i++) {
      // Les sommets intérieurs sont calculés plus loin avec leurs détails ; ici, seulement le bord.
      if (detailed && inner && i > 0 && i < m - 1) continue;
      h[j * m + i] = terrain.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    }
  }
  const gridCount = n * n;
  const vertexCount = gridCount + 4 * n;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const samples: Array<GeoSample | null> = new Array(gridCount).fill(null);
  if (detailed) {
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const s = terrain.sampleInto!(x0 + ix * step, z0 + iz * step);
        h[(iz + 1) * m + ix + 1] = s.height;
        samples[iz * n + ix] = { ...s };
      }
    }
  }
  const inv2s = 1 / (2 * step);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix;
      const hc = h[(iz + 1) * m + ix + 1]!;
      let nx = (h[(iz + 1) * m + ix]! - h[(iz + 1) * m + ix + 2]!) * inv2s;
      let ny = 1;
      let nz = (h[iz * m + ix + 1]! - h[(iz + 2) * m + ix + 1]!) * inv2s;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      positions[k * 3] = ix * step;
      positions[k * 3 + 1] = hc;
      positions[k * 3 + 2] = iz * step;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      groundColor(samples[k] ?? null, hc, ny, x0 + ix * step, z0 + iz * step, colors, k * 4);
    }
  }

  // Jupes : copie des sommets de bord, abaissée.
  const depth = step * 1.5 + 1;
  const edges: Array<(t: number) => number> = [(t) => t, (t) => (n - 1) * n + t, (t) => t * n, (t) => t * n + (n - 1)];
  let v = gridCount;
  for (const edge of edges) {
    for (let t = 0; t < n; t++) {
      const src = edge(t);
      positions[v * 3] = positions[src * 3]!;
      positions[v * 3 + 1] = positions[src * 3 + 1]! - depth;
      positions[v * 3 + 2] = positions[src * 3 + 2]!;
      normals[v * 3] = normals[src * 3]!;
      normals[v * 3 + 1] = normals[src * 3 + 1]!;
      normals[v * 3 + 2] = normals[src * 3 + 2]!;
      colors.set(colors.subarray(src * 4, src * 4 + 4), v * 4);
      v++;
    }
  }

  const gridIdx = cells * cells * 6;
  const skirtIdx = 4 * cells * 12;
  const indices = vertexCount > 65535 ? new Uint32Array(gridIdx + skirtIdx) : new Uint16Array(gridIdx + skirtIdx);
  let p = 0;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const d = a + n;
      const c = d + 1;
      // Diagonale B–D, comme le champ de hauteur physique ; ordre anti-horaire vu du dessus.
      indices[p++] = a;
      indices[p++] = b;
      indices[p++] = d;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  }
  for (let e = 0; e < 4; e++) {
    const edge = edges[e]!;
    const base = gridCount + e * n;
    for (let t = 0; t < cells; t++) {
      const top0 = edge(t);
      const top1 = edge(t + 1);
      const bot0 = base + t;
      const bot1 = base + t + 1;
      indices[p++] = top0;
      indices[p++] = bot0;
      indices[p++] = top1;
      indices[p++] = top1;
      indices[p++] = bot0;
      indices[p++] = bot1;
      indices[p++] = top0;
      indices[p++] = top1;
      indices[p++] = bot0;
      indices[p++] = top1;
      indices[p++] = bot1;
      indices[p++] = bot0;
    }
  }
  return { positions, normals, colors, indices, vertexCount, gridVertexCount: gridCount };
}

/** Hauteurs physiques (65 × 65) extraites d'un maillage à 64 cellules (mêmes points de grille). */
export function physicsHeightsFromMesh(mesh: TerrainMeshData, cells: number): Float32Array | null {
  if (cells !== 64) return null;
  const n = cells + 1;
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = mesh.positions[k * 3 + 1]!;
  return out;
}
