import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WATER_LEVEL, WORLD_HALF } from '../../src/shared/constants';
import { LANDMARKS } from '../../src/shared/geography';
import { Simplex2 } from '../../src/shared/noise';
import { PhysicsWorld, initPhysics } from '../../src/shared/physics';
import { mulberry32 } from '../../src/shared/rng';
import { findSpawn } from '../../src/shared/simulation';
import { Terrain, triangulatedHeight } from '../../src/shared/terrain';
import { floraInChunk } from '../../src/shared/vegetation';

beforeAll(async () => {
  await initPhysics();
});

const SEED = 20261112;

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
    for (let i = 0; i < 3000; i++) {
      const x = (rand() - 0.5) * 2 * WORLD_HALF;
      const z = (rand() - 0.5) * 2 * WORLD_HALF;
      const h = t1.heightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-30);
      expect(h).toBeLessThan(700);
      expect(t2.heightAt(x, z)).toBe(h);
      expect(t2.sample(x, z)).toEqual(t1.sample(x, z));
    }
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
});

describe('géographie inspirée du Zimbabwe (16 km × 16 km)', () => {
  const t = new Terrain(SEED);
  const biomeShare = (x0: number, x1: number, z0: number, z1: number) => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const s = t.sampleInto(x0 + ((x1 - x0) * (i + 0.5)) / 12, z0 + ((z1 - z0) * (j + 0.5)) / 12);
        counts[s.biome] = (counts[s.biome] ?? 0) + 1;
        n++;
      }
    }
    return (b: string) => (counts[b] ?? 0) / n;
  };

  it('au nord : vallée basse du Zambèze, le fleuve et le lac sous l’eau', () => {
    const share = biomeShare(-1000, 3000, 5300, 7000);
    expect(share('vallee') + share('fleuve')).toBeGreaterThan(0.7);
    expect(t.heightAt(LANDMARKS.lake.x, LANDMARKS.lake.z)).toBeLessThan(WATER_LEVEL - 5);
    // Le fleuve a de l'eau tout le long : on trouve un point immergé près de sa ligne.
    for (const x of [-6000, -3000, 1000, 4000]) {
      let wet = false;
      for (let dz = -700; dz <= 700 && !wet; dz += 10) if (t.heightAt(x, LANDMARKS.zambeziZ + dz) < WATER_LEVEL - 1) wet = true;
      expect(wet, `fleuve à x=${x}`).toBe(true);
    }
  });

  it('au centre : haut plateau bien plus haut que la vallée', () => {
    const share = biomeShare(-2000, 2000, -2000, 2000);
    expect(share('plateau') + share('miombo') + share('vlei') + share('matobo')).toBeGreaterThan(0.8);
    expect(t.heightAt(0, 0)).toBeGreaterThan(100);
    expect(t.heightAt(1000, 6000)).toBeLessThan(40);
  });

  it('à l’est : hautes terres montagneuses', () => {
    expect(biomeShare(6200, 7200, -3000, 3000)('hautes_terres')).toBeGreaterThan(0.7);
    let maxH = 0;
    for (let z = -3000; z <= 3000; z += 100) maxH = Math.max(maxH, t.heightAt(6600, z));
    expect(maxH).toBeGreaterThan(300);
  });

  it('à l’ouest : sables du Kalahari ; au sud : lowveld et Limpopo ; au sud-ouest : granit', () => {
    expect(biomeShare(-7200, -6300, -2000, 2000)('kalahari')).toBeGreaterThan(0.7);
    expect(biomeShare(-2000, 2000, -6600, -5800)('lowveld')).toBeGreaterThan(0.6);
    let wet = false;
    for (let dz = -600; dz <= 600 && !wet; dz += 10) if (t.heightAt(0, LANDMARKS.limpopoZ + dz) < WATER_LEVEL - 1) wet = true;
    expect(wet).toBe(true);
    let kopje = 0;
    for (let i = 0; i < 400; i++) if (t.sampleInto(-5500 + (i % 20) * 120, -4600 + Math.floor(i / 20) * 120).kopje > 0.5) kopje++;
    expect(kopje).toBeGreaterThan(20);
  });

  it('les bords du monde sont des montagnes frontalières', () => {
    for (const [x, z] of [
      [0, WORLD_HALF - 60],
      [0, -WORLD_HALF + 60],
      [WORLD_HALF - 60, 0],
      [-WORLD_HALF + 60, 0],
    ] as const) {
      expect(t.sampleInto(x, z).biome).toBe('frontiere');
      expect(t.heightAt(x, z)).toBeGreaterThan(150);
    }
  });

  it("le point d'apparition de repli est sur la terre ferme près de l'origine", () => {
    for (const seed of [1, 2, 99, SEED]) {
      const sp = findSpawn(new Terrain(seed));
      expect(sp.y).toBeGreaterThan(WATER_LEVEL + 1.5);
      expect(Math.hypot(sp.x, sp.z)).toBeLessThan(800);
    }
  });
});

describe('le sol physique coïncide avec le relief', () => {
  it('rayons verticaux : altitude physique = surface triangulée (hors arbres et rochers)', () => {
    const t = new Terrain(31337);
    const phys = new PhysicsWorld(t);
    phys.ensureAround([{ x: 10, z: -20 }], 1, 0);
    phys.refresh();
    const flora = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => floraInChunk(t, dx, -1 + dz)));
    const obstacles = flora.flatMap((f) => [...f.trees.map((tr) => ({ x: tr.x, z: tr.z, r: 1.5 })), ...f.rocks.map((r) => ({ x: r.x, z: r.z, r: r.r + 0.5 })), ...f.mounds.map((m) => ({ x: m.x, z: m.z, r: 1.5 }))]);
    const rand = mulberry32(3);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const x = -50 + rand() * 120;
      const z = -80 + rand() * 120;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) continue;
      const physical = phys.groundHeight(x, z);
      expect(physical).not.toBeNull();
      expect(physical!).toBeCloseTo(triangulatedHeight(t, x, z, 1), 2);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    phys.dispose();
  });
});
