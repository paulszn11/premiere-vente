import { describe, expect, it } from 'vitest';
import { type DeviceInfo, suggestPreset } from '../../src/client/device';
import { addBinding, codeLabel, defaultBindings, normalizeBindings, removeBinding } from '../../src/client/input/bindings';
import { AdaptiveResolution, computeStats } from '../../src/client/perf/perf-monitor';
import { buildTerrainMesh } from '../../src/client/render/terrain-mesh';
import { PRESETS, defaultSettings, effectiveQuality, normalizeSettings } from '../../src/client/settings';
import { CHUNK_SIZE } from '../../src/shared/constants';
import { Terrain } from '../../src/shared/terrain';
import { FlatTerrain } from './helpers';

describe('maillage du terrain', () => {
  it('les sommets suivent exactement le relief et la diagonale est celle du moteur physique', () => {
    const t = new Terrain(555);
    const cells = 16;
    const n = cells + 1;
    const m = buildTerrainMesh(t, 2, -1, cells);
    expect(m.vertexCount).toBe(n * n + 4 * n);
    expect(m.positions.length).toBe(m.vertexCount * 3);
    expect(m.colors.length).toBe(m.vertexCount * 4);
    const step = CHUNK_SIZE / cells;
    for (const [ix, iz] of [
      [0, 0],
      [5, 9],
      [16, 16],
    ] as const) {
      const k = iz * n + ix;
      expect(m.positions[k * 3]).toBeCloseTo(ix * step, 5);
      expect(m.positions[k * 3 + 2]).toBeCloseTo(iz * step, 5);
      expect(m.positions[k * 3 + 1]).toBeCloseTo(t.heightAt(2 * CHUNK_SIZE + ix * step, -CHUNK_SIZE + iz * step), 3);
    }
    // Première cellule : triangles (A, B, D) et (B, C, D) → diagonale B–D.
    expect(Array.from(m.indices.slice(0, 6))).toEqual([0, 1, n, 1, n + 1, n]);
    for (let i = 0; i < m.indices.length; i++) expect(m.indices[i]).toBeLessThan(m.vertexCount);
  });

  it('normales unitaires, verticales sur sol plat ; jupes sous les bords', () => {
    const m = buildTerrainMesh(new FlatTerrain(3), 0, 0, 8);
    for (let v = 0; v < m.vertexCount; v++) {
      const len = Math.hypot(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!);
      expect(len).toBeCloseTo(1, 5);
      expect(m.normals[v * 3 + 1]).toBeCloseTo(1, 5);
      expect(m.colors[v * 4 + 3]).toBe(1);
    }
    for (let v = m.gridVertexCount; v < m.vertexCount; v++) expect(m.positions[v * 3 + 1]).toBeLessThan(3);
  });
});

describe('réglages et commandes', () => {
  it('des réglages corrompus reprennent les valeurs par défaut', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    const s = normalizeSettings({ quality: 'super', renderScale: 7, fov: 'x', mouseSensitivity: -3, viewChunks: 99, worldSeed: -1, bindings: { jump: ['KeyJ', 42, '<script>'] } });
    expect(s.quality).toBe('auto');
    expect(s.renderScale).toBe(1);
    expect(s.fov).toBe(70);
    expect(s.mouseSensitivity).toBe(0.1);
    expect(s.viewChunks).toBe(10);
    expect(s.worldSeed).toBeNull();
    expect(s.bindings.jump).toEqual(['KeyJ']);
    expect(s.bindings.forward).toEqual(defaultBindings().forward);
  });

  it('qualité effective : distance imposée et arbres toujours visibles autour du joueur', () => {
    const s = { ...defaultSettings(), quality: 'high' as const, viewChunks: 2 };
    const q = effectiveQuality(s, 'low');
    expect(q.preset).toBe('high');
    expect(q.params.viewChunks).toBe(2);
    expect(q.params.vegetationChunks).toBe(2);
    expect(effectiveQuality(defaultSettings(), 'medium').params).toEqual(PRESETS.medium);
    for (const p of Object.values(PRESETS)) expect(p.vegetationChunks).toBeGreaterThanOrEqual(1);
  });

  it('assigner une touche la retire des autres actions', () => {
    let b = defaultBindings();
    b = addBinding(b, 'jump', 'KeyW');
    expect(b.jump).toContain('KeyW');
    expect(b.forward).not.toContain('KeyW');
    b = removeBinding(b, 'jump', 'Space');
    expect(b.jump).not.toContain('Space');
    expect(normalizeBindings(b)).toEqual(b);
  });

  it('libellés lisibles, y compris clavier AZERTY', () => {
    const azerty = new Map([
      ['KeyW', 'z'],
      ['KeyA', 'q'],
    ]);
    expect(codeLabel('KeyW', azerty)).toBe('Z');
    expect(codeLabel('KeyA', azerty)).toBe('Q');
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Space')).toBe('Espace');
    expect(codeLabel('Mouse2')).toBe('Clic droit');
    expect(codeLabel('Pad:0')).toBe('Manette A / Croix');
  });
});

describe('qualité choisie automatiquement', () => {
  const base: DeviceInfo = { mobile: false, touch: false, cores: 8, memoryGb: 8, dpr: 1, gpu: 'Intel(R) UHD Graphics', softwareRenderer: false, screen: '1920×1080' };
  it('iPhone (mesuré à 60 images/s en Ultra) : Haute', () => {
    expect(suggestPreset({ ...base, mobile: true, touch: true, cores: 4, memoryGb: null, dpr: 3, gpu: 'Apple GPU', screen: '393×852' })).toBe('high');
  });
  it('téléphones Android : selon la mémoire et les processeurs', () => {
    expect(suggestPreset({ ...base, mobile: true, touch: true, cores: 8, memoryGb: 8, gpu: 'Adreno (TM) 740' })).toBe('medium');
    expect(suggestPreset({ ...base, mobile: true, touch: true, cores: 4, memoryGb: 2, gpu: 'Mali-G52' })).toBe('low');
  });
  it('ordinateurs et rendu logiciel', () => {
    expect(suggestPreset(base)).toBe('medium');
    expect(suggestPreset({ ...base, gpu: 'NVIDIA GeForce RTX 4060' })).toBe('high');
    expect(suggestPreset({ ...base, gpu: 'SwiftShader', softwareRenderer: true })).toBe('low');
  });
});

describe('mesures de performance', () => {
  it('statistiques des temps d’image', () => {
    const frames = [...Array<number>(99).fill(16), 100];
    const s = computeStats(frames);
    expect(s.frames).toBe(100);
    expect(s.msMedian).toBe(16);
    expect(s.fpsLow1).toBeCloseTo(10, 5);
    expect(s.fps).toBeCloseTo(100000 / (99 * 16 + 100), 5);
  });

  it('résolution adaptative : baisse si lent, remonte doucement si fluide', () => {
    const a = new AdaptiveResolution();
    let now = 0;
    const feed = (ms: number, seconds: number) => {
      for (let t = 0; t < seconds * 1000; t += ms) {
        now += ms;
        a.frame(ms, now);
      }
    };
    feed(33, 2.1);
    expect(a.scale).toBeCloseTo(0.9, 5);
    feed(33, 20);
    expect(a.scale).toBe(0.5);
    feed(16, 30);
    expect(a.scale).toBeGreaterThan(0.5);
    expect(a.scale).toBeLessThanOrEqual(1);
  });
});
