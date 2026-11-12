// Construction des données de maillage d'un chunk de terrain (sans dépendance au moteur 3D).
// Les triangles sont découpés comme dans le moteur physique, pour que le sol affiché
// corresponde exactement au sol sur lequel on marche quand le détail est maximal.

import { CHUNK_SIZE, WATER_LEVEL } from '../../shared/constants';
import { lerp, smoothstep } from '../../shared/noise';
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

function terrainColor(h: number, ny: number, wx: number, wz: number, out: Float32Array, o: number): void {
  const v = ((hash32(Math.floor(wx * 0.25), Math.floor(wz * 0.25), 17) & 255) / 255) * 0.07 - 0.035;
  let r = 0.3 + v;
  let g = 0.45 + v;
  let b = 0.2 + v * 0.5;
  const sand = 1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 1.8, h);
  r = lerp(r, 0.72, sand);
  g = lerp(g, 0.66, sand);
  b = lerp(b, 0.48, sand);
  const mud = 1 - smoothstep(WATER_LEVEL - 3, WATER_LEVEL - 0.5, h);
  r = lerp(r, 0.34, mud);
  g = lerp(g, 0.31, mud);
  b = lerp(b, 0.25, mud);
  const rock = Math.max(1 - smoothstep(0.72, 0.84, ny), smoothstep(70, 85, h));
  r = lerp(r, 0.46 + v, rock);
  g = lerp(g, 0.44 + v, rock);
  b = lerp(b, 0.41 + v, rock);
  const snow = smoothstep(92, 100, h) * smoothstep(0.7, 0.85, ny);
  r = lerp(r, 0.93, snow);
  g = lerp(g, 0.94, snow);
  b = lerp(b, 0.96, snow);
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
  out[o + 3] = 1;
}

/**
 * Maillage du chunk (cx, cz) avec `cells` cellules par côté. Les positions sont relatives
 * à l'origine du chunk. Des « jupes » verticales sur les bords masquent les fissures entre
 * deux chunks de détails différents.
 */
export function buildTerrainMesh(terrain: HeightSource, cx: number, cz: number, cells: number): TerrainMeshData {
  const n = cells + 1;
  const step = CHUNK_SIZE / cells;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const m = n + 2;
  const h = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) h[j * m + i] = terrain.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  }

  const gridCount = n * n;
  const vertexCount = gridCount + 4 * n;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const inv2s = 1 / (2 * step);

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix;
      const hc = h[(iz + 1) * m + ix + 1]!;
      const hl = h[(iz + 1) * m + ix]!;
      const hr = h[(iz + 1) * m + ix + 2]!;
      const hd = h[iz * m + ix + 1]!;
      const hu = h[(iz + 2) * m + ix + 1]!;
      let nx = (hl - hr) * inv2s;
      let ny = 1;
      let nz = (hd - hu) * inv2s;
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
      terrainColor(hc, ny, x0 + ix * step, z0 + iz * step, colors, k * 4);
    }
  }

  // Jupes : copie des sommets de bord, abaissée.
  const depth = step * 1.5 + 1;
  const edges: Array<(t: number) => number> = [
    (t) => t, // bord z = 0
    (t) => (n - 1) * n + t, // bord z = max
    (t) => t * n, // bord x = 0
    (t) => t * n + (n - 1), // bord x = max
  ];
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
      // Les deux faces, pour que la jupe soit visible quel que soit le côté.
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
