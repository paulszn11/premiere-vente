// Phase 9 : eau locale — ruisseaux, chutes d'eau, bassins ; lit creusé dans le relief ; effets sur le joueur.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Pool, Hydrology } from '../../src/shared/hydrology';
import { BTN_CROUCH, MODE_SWIM } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { propsInChunk } from '../../src/shared/props';
import { nodesInChunk } from '../../src/shared/resources';
import { LocalSimulation } from '../../src/shared/simulation';
import { Terrain, chunkCoord } from '../../src/shared/terrain';
import { floraInChunk } from '../../src/shared/vegetation';
import { cmd } from './helpers';

const SEED = 20261112;

/** Le relief d'origine, sans lits creusés : référence pour la flore et les objets. */
class RawTerrain extends Terrain {
  override heightAt(x: number, z: number): number {
    return this.geo.heightAt(x, z);
  }
  override carveAt(_x: number, _z: number, raw: number): number {
    return raw;
  }
}

const t = new Terrain(SEED);
let sim: LocalSimulation;

beforeAll(async () => {
  await initPhysics();
  for (const [x, z] of [
    [0, 0],
    [5000, 0],
    [0, 4000],
  ] as const)
    t.hydro.ensure(x, z);
  sim = await LocalSimulation.create(SEED, { fauna: false });
});

afterAll(() => sim.dispose());

/** Milieux des tronçons d'eau (ni chute, ni passage sous terre), avec leur direction. */
function waterSpots(min = { depth: 0, width: 0 }) {
  const out: Array<{ x: number; z: number; dx: number; dz: number; surf: number; hw: number; depth: number }> = [];
  for (const s of t.hydro.streams.values()) {
    const pts = s.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (a.fall || a.seep || a.width < min.width || a.depth < min.depth) continue;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l, surf: (a.surface + b.surface) / 2, hw: (a.width + b.width) / 4, depth: (a.depth + b.depth) / 2 });
    }
  }
  return out;
}

describe('ruisseaux, chutes et bassins', () => {
  it('identiques pour tous, quel que soit l’ordre dans lequel les zones sont calculées', () => {
    const a = new Hydrology(new Terrain(SEED).geo);
    const b = new Hydrology(new Terrain(SEED).geo);
    a.ensure(0, 0);
    a.ensure(5000, 0);
    b.ensure(5000, 0);
    b.ensure(0, 0);
    expect([...b.streams.keys()].sort()).toEqual([...a.streams.keys()].sort());
    for (const [id, s] of a.streams) expect(b.streams.get(id)!.points).toEqual(s.points);
    expect([...b.pools.keys()].sort()).toEqual([...a.pools.keys()].sort());
    expect([...b.falls.keys()].sort()).toEqual([...a.falls.keys()].sort());
    // Et le relief creusé est le même partout.
    const c = new Terrain(SEED);
    for (const p of waterSpots().slice(0, 200)) expect(c.heightAt(p.x, p.z)).toBe(t.heightAt(p.x, p.z));
  });

  it('il y a des ruisseaux, des chutes, et des bassins assez profonds pour nager', () => {
    expect(t.hydro.streams.size).toBeGreaterThan(10);
    expect(t.hydro.falls.size).toBeGreaterThan(5);
    const deep = [...t.hydro.pools.values()].filter((p) => p.depth !== undefined && p.surface - t.heightAt(p.x, p.z) > 1.3);
    expect(deep.length).toBeGreaterThan(10);
  });

  it('l’eau reste dans son lit : de l’eau au milieu, la terre ferme sur les rives', () => {
    let banks = 0;
    let dryBanks = 0;
    for (const p of waterSpots()) {
      // Au milieu : on a de l'eau au-dessus d'un fond creusé.
      expect(t.waterLevelAt(p.x, p.z)).toBeGreaterThanOrEqual(p.surf - 1e-6);
      expect(p.surf - t.heightAt(p.x, p.z)).toBeGreaterThan(p.depth * 0.8);
      // Juste après le bord, des deux côtés : la rive est au-dessus de l'eau (sinon c'est un bassin).
      for (const side of [1, -1]) {
        const bx = p.x - p.dz * side * (p.hw + 0.3);
        const bz = p.z + p.dx * side * (p.hw + 0.3);
        const g = t.heightAt(bx, bz);
        banks++;
        if (g >= p.surf - 0.1 || t.waterLevelAt(bx, bz) >= p.surf - 0.01) dryBanks++;
      }
    }
    expect(banks).toBeGreaterThan(500);
    expect(dryBanks / banks).toBeGreaterThan(0.97);
  });

  it('les chutes descendent d’au moins 1,5 m et finissent plus bas que leur départ', () => {
    for (const f of t.hydro.falls.values()) {
      expect(f.top - f.bottom).toBeGreaterThanOrEqual(1.5);
      expect(t.heightAt(f.x2, f.z2)).toBeLessThan(t.heightAt(f.x, f.z));
    }
  });

  it('le relief n’est creusé que pour l’eau : arbres, objets et gisements gardent place et identifiants', () => {
    const raw = new RawTerrain(SEED);
    const chunks = new Set<string>();
    for (const p of waterSpots().slice(0, 400)) chunks.add(`${chunkCoord(p.x)},${chunkCoord(p.z)}`);
    let lowered = 0;
    for (const key of chunks) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      const fa = floraInChunk(t, cx, cz);
      const fb = floraInChunk(raw, cx, cz);
      expect(fa.trees.map((x) => [x.x, x.z, x.species])).toEqual(fb.trees.map((x) => [x.x, x.z, x.species]));
      expect(fa.bushes.length).toBe(fb.bushes.length);
      fa.trees.forEach((tr, i) => {
        if (tr.y < fb.trees[i]!.y - 0.05) lowered++;
      });
      expect(propsInChunk(t, cx, cz).map((p) => `${p.id} ${p.kind}`)).toEqual(propsInChunk(raw, cx, cz).map((p) => `${p.id} ${p.kind}`));
      expect(nodesInChunk(t, cx, cz).map((n) => `${n.id} ${n.kind}`)).toEqual(nodesInChunk(raw, cx, cz).map((n) => `${n.id} ${n.kind}`));
    }
    // Les arbres qui poussaient au bord de l'eau suivent le sol creusé (ils ne flottent pas).
    expect(lowered).toBeGreaterThan(0);
  });
});

describe('l’eau locale et le joueur', () => {
  function place(x: number, y: number, z: number, ticks = 40): void {
    sim.teleport(x, y, z);
    for (let i = 0; i < ticks; i++) sim.step(cmd(0, 0));
  }

  it('dans un ruisseau, on marche dans l’eau (plus lentement) et on peut remplir un pot', () => {
    const spot = waterSpots({ depth: 0.5, width: 3 }).find((p) => p.surf - t.heightAt(p.x, p.z) > 0.5 && t.waterLevelAt(p.x, p.z) === p.surf)!;
    expect(spot).toBeDefined();
    place(spot.x, t.heightAt(spot.x, spot.z) + 0.2, spot.z);
    expect(sim.state.mode).not.toBe(MODE_SWIM);
    expect(sim.state.surface).toBe('eau');
    expect(sim.inWater()).toBe(true);
    // Marcher dans le sens du courant, dans l'eau…
    const yaw = Math.atan2(spot.dx, spot.dz);
    for (let i = 0; i < 25; i++) sim.step(cmd(spot.dx, spot.dz, 0, yaw));
    const wet = Math.hypot(sim.state.vx, sim.state.vz);
    // … puis sur la rive, plus loin du lit.
    const bx = spot.x - spot.dz * (spot.hw + 6);
    const bz = spot.z + spot.dx * (spot.hw + 6);
    place(bx, t.heightAt(bx, bz) + 0.2, bz);
    expect(sim.inWater()).toBe(false);
    for (let i = 0; i < 25; i++) sim.step(cmd(spot.dx, spot.dz, 0, yaw));
    const dry = Math.hypot(sim.state.vx, sim.state.vz);
    expect(wet).toBeLessThan(dry * 0.8);
  });

  it('dans un bassin profond, on nage ; la tête sous l’eau, le souffle baisse', () => {
    const pool = [...t.hydro.pools.values()].find((p: Pool) => p.depth !== undefined && p.surface - t.heightAt(p.x, p.z) > 1.8)!;
    expect(pool).toBeDefined();
    place(pool.x, pool.surface - 1.2, pool.z, 30);
    expect(sim.state.mode).toBe(MODE_SWIM);
    expect(sim.inWater()).toBe(true);
    // Plonger (bouton descendre) : la tête passe sous la surface du bassin.
    for (let i = 0; i < 240; i++) sim.step(cmd(0, 0, BTN_CROUCH));
    expect(sim.state.breath).toBeLessThan(100);
  });
});
