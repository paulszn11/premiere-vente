// Fil de calcul du terrain : génère les maillages, les hauteurs physiques et la flore des
// chunks hors du fil principal, pour que l'affichage reste fluide (surtout sur téléphone).

import { PHYS_CELLS } from '../../shared/constants';
import { Terrain } from '../../shared/terrain';
import { floraInChunk } from '../../shared/vegetation';
import { buildTerrainMesh, physicsHeightsFromMesh } from './terrain-mesh';
import type { ChunkJobRequest, ChunkJobResult } from './terrain-jobs';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };
let terrain: Terrain | null = null;

scope.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: 'init'; seed: number } | ChunkJobRequest;
  if (msg.type === 'init') {
    terrain = new Terrain(msg.seed);
    return;
  }
  if (!terrain) return;
  const t = terrain;
  const transfer: Transferable[] = [];
  let mesh: ChunkJobResult['mesh'] = null;
  let physics: Float32Array | null = null;
  if (msg.cells > 0) {
    const m = buildTerrainMesh(t, msg.cx, msg.cz, msg.cells);
    mesh = { positions: m.positions, normals: m.normals, colors: m.colors, indices: m.indices };
    transfer.push(m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer);
    if (msg.physics) physics = physicsHeightsFromMesh(m, msg.cells);
  }
  if (msg.physics && !physics) physics = t.sampleChunk(msg.cx, msg.cz, PHYS_CELLS);
  if (physics) transfer.push(physics.buffer);
  const flora = msg.flora ? floraInChunk(t, msg.cx, msg.cz) : null;
  const result: ChunkJobResult = { type: 'chunk', id: msg.id, cx: msg.cx, cz: msg.cz, cells: msg.cells, mesh, physics, flora };
  scope.postMessage(result, transfer);
};
