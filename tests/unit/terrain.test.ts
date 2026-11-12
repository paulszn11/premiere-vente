import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WATER_LEVEL } from '../../src/shared/constants';
import { Simplex2 } from '../../src/shared/noise';
import { PhysicsWorld, initPhysics } from '../../src/shared/physics';
import { mulberry32 } from '../../src/shared/rng';
import { findSpawn } from '../../src/shared/simulation';
import { Terrain, triangulatedHeight } from '../../src/shared/terrain';
import { treesInChunk } from '../../src/shared/vegetation';

beforeAll(async () => {
  await initPhysics();
});

describe('bruit et relief déterministes', () => {
  it('le bruit simplex reste dans [-1, 1] et dépend de la graine', () => {
    const a = new Simplex2(42);
    const b = new Simplex2(42);
    const c = new Simplex2(43);
    const rand = mulberry32(7);
    let min = Infinity;
    let max = -Infinity;
    let differs = 0;
    for (let i = 0; i < 20000; i++) {
      const x = (rand() - 0.5) * 2000;
      const y = (rand() - 0.5) * 2000;
      const v = a.noise(x, y);
      expect(b.noise(x, y)).toBe(v);
      if (c.noise(x, y) !== v) differs++;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min).toBeGreaterThan(1.2);
    expect(differs).toBeGreaterThan(19000);
  });

  it('deux terrains de même graine sont identiques au bit près', () => {
    const t1 = new Terrain(123456);
    const t2 = new Terrain(123456);
    const rand = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const x = (rand() - 0.5) * 20000;
      const z = (rand() - 0.5) * 20000;
      const h = t1.heightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-70);
      expect(h).toBeLessThan(170);
      expect(t2.heightAt(x, z)).toBe(h);
    }
  });

  it("le relief a de l'eau, des plaines et des reliefs marqués", () => {
    const t = new Terrain(2026);
    const rand = mulberry32(5);
    let water = 0;
    let high = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const h = t.heightAt((rand() - 0.5) * 30000, (rand() - 0.5) * 30000);
      if (h < WATER_LEVEL) water++;
      if (h > 40) high++;
    }
    expect(water / n).toBeGreaterThan(0.05);
    expect(water / n).toBeLessThan(0.7);
    expect(high).toBeGreaterThan(0);
  });

  it('sampleChunk correspond à heightAt aux sommets', () => {
    const t = new Terrain(77);
    const cells = 16;
    const s = t.sampleChunk(-3, 5, cells);
    const step = CHUNK_SIZE / cells;
    for (const [ix, iz] of [
      [0, 0],
      [16, 0],
      [7, 9],
      [16, 16],
    ] as const) {
      expect(s[iz * (cells + 1) + ix]).toBeCloseTo(t.heightAt(-3 * CHUNK_SIZE + ix * step, 5 * CHUNK_SIZE + iz * step), 4);
    }
  });

  it("le point d'apparition est sur la terre ferme, près de l'origine, pour plusieurs graines", () => {
    for (const seed of [1, 2, 3, 99, 2026, 123456789, 4000000000]) {
      const t = new Terrain(seed);
      const sp = findSpawn(t);
      expect(sp.y).toBeGreaterThan(WATER_LEVEL + 1.5);
      expect(Math.hypot(sp.x, sp.z)).toBeLessThan(600);
    }
  });
});

describe('le sol physique coïncide avec le relief', () => {
  it('rayons verticaux : altitude physique = surface triangulée (hors troncs)', () => {
    const t = new Terrain(31337);
    const phys = new PhysicsWorld(t);
    phys.ensureAround([{ x: 10, z: -20 }], 1, 0);
    phys.refresh();
    const trees = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dz) => treesInChunk(t, dx, -1 + dz)));
    const rand = mulberry32(3);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const x = -50 + rand() * 120;
      const z = -80 + rand() * 120;
      if (trees.some((tr) => Math.hypot(tr.x - x, tr.z - z) < 1.5)) continue;
      const physical = phys.groundHeight(x, z);
      expect(physical).not.toBeNull();
      expect(physical!).toBeCloseTo(triangulatedHeight(t, x, z, 1), 2);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    phys.dispose();
  });
});
