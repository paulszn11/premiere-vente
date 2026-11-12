import { beforeAll, describe, expect, it } from 'vitest';
import { MOVE, PHYS_CHUNK_RADIUS, TICK_DT } from '../../src/shared/constants';
import { BTN_JUMP, BTN_SPRINT, type MoveState, makeState, quantizeInput, stepMovement } from '../../src/shared/movement';
import { PhysicsWorld, initPhysics } from '../../src/shared/physics';
import { mulberry32 } from '../../src/shared/rng';
import { LocalSimulation } from '../../src/shared/simulation';
import { Terrain } from '../../src/shared/terrain';
import { SPECIES, floraInChunk } from '../../src/shared/vegetation';
import { FlatTerrain, SlopeTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

function world(terrain: Terrain, x: number, y: number, z: number) {
  const phys = new PhysicsWorld(terrain);
  const state = makeState(x, y, z);
  phys.ensureAround([state], PHYS_CHUNK_RADIUS + 1, 0);
  phys.refresh();
  const collider = phys.createPlayerCollider(x, y, z);
  const run = (n: number, wx: number, wz: number, buttons = 0, onTick?: (s: MoveState) => void) => {
    for (let i = 0; i < n; i++) {
      phys.ensureAround([state], PHYS_CHUNK_RADIUS, i);
      phys.refresh();
      stepMovement(phys, collider, state, quantizeInput(cmd(wx, wz, buttons)), TICK_DT);
      onTick?.(state);
    }
  };
  return { phys, state, run };
}

describe('déplacements sur sol plat', () => {
  it('le joueur se pose au sol et y reste', () => {
    const w = world(new FlatTerrain(10), 0, 10.5, 0);
    w.run(90, 0, 0);
    expect(w.state.grounded).toBe(true);
    expect(w.state.y).toBeGreaterThan(9.95);
    expect(w.state.y).toBeLessThan(10.1);
  });

  it('marche avec accélération : ~1,62 m en 1 s, puis vitesse de marche', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    const z0 = w.state.z;
    w.run(60, 0, 1);
    expect(w.state.z - z0).toBeGreaterThan(1.5);
    expect(w.state.z - z0).toBeLessThan(1.75);
    expect(w.state.vz).toBeCloseTo(MOVE.walkSpeed, 1);
  });

  it('la course est plus rapide que la marche', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    const x0 = w.state.x;
    w.run(120, 1, 0, BTN_SPRINT);
    const dist = w.state.x - x0;
    // 2 s : 2 × 5,2 − 5,2² / (2 × 9) ≈ 8,9 m
    expect(dist).toBeGreaterThan(8.4);
    expect(dist).toBeLessThan(9.3);
  });

  it("l'inertie : arrêt progressif en moins d'une demi-seconde", () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    w.run(90, 0, 1);
    const z0 = w.state.z;
    w.run(30, 0, 0);
    const slide = w.state.z - z0;
    expect(slide).toBeGreaterThan(0.05);
    expect(slide).toBeLessThan(0.3);
    expect(Math.abs(w.state.vz)).toBeLessThan(1e-6);
  });

  it('saut : environ 0,66 m de hauteur, un seul saut par appui', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    const y0 = w.state.y;
    let apex = y0;
    let landings = 0;
    let wasGrounded = true;
    w.run(150, 0, 0, BTN_JUMP, (s) => {
      apex = Math.max(apex, s.y);
      if (s.grounded && !wasGrounded) landings++;
      wasGrounded = s.grounded;
    });
    const expected = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity);
    expect(apex - y0).toBeGreaterThan(expected - 0.06);
    expect(apex - y0).toBeLessThan(expected + 0.06);
    expect(landings).toBe(1);
    expect(w.state.grounded).toBe(true);
  });
});

describe('pentes et obstacles', () => {
  it('une pente douce (20°) se gravit', () => {
    const w = world(new SlopeTerrain(0.36), -2, 0, 0);
    w.run(30, 0, 0);
    w.run(240, 1, 0);
    expect(w.state.x).toBeGreaterThan(4);
    expect(w.state.y).toBeGreaterThan(1.4);
  });

  it('en descente (30°), le joueur reste au sol', () => {
    const w = world(new SlopeTerrain(0.58), 30, 30 * 0.58 + 0.05, 0);
    w.run(30, 0, 0);
    let airborne = 0;
    w.run(150, -1, 0, BTN_SPRINT, (s) => {
      if (!s.grounded) airborne++;
    });
    expect(w.state.x).toBeLessThan(25);
    expect(airborne).toBeLessThan(10);
  });

  it('une pente trop raide (61°) ne se gravit pas', () => {
    const w = world(new SlopeTerrain(1.8), -2, 0, 0);
    w.run(30, 0, 0);
    w.run(240, 1, 0, BTN_SPRINT);
    expect(w.state.x).toBeLessThan(0.8);
  });

  it('les troncs d’arbres bloquent le joueur', () => {
    const t = new Terrain(2026);
    let found = null as null | { x: number; z: number; r: number };
    for (let cx = -3; cx <= 3 && !found; cx++) {
      for (let cz = -3; cz <= 3 && !found; cz++) {
        for (const tr of floraInChunk(t, cx, cz).trees) {
          if (tr.species === 'baobab') continue;
          // Terrain dégagé devant l'arbre (pas d'autre obstacle sur 4 m).
          found = { x: tr.x, z: tr.z, r: SPECIES[tr.species].trunkRadius * tr.scale };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const startX = found!.x - 4;
    const w = world(t, startX, t.heightAt(startX, found!.z) + 0.5, found!.z);
    w.run(40, 0, 0);
    let minDist = Infinity;
    w.run(180, 1, 0, 0, (s) => {
      minDist = Math.min(minDist, Math.hypot(s.x - found!.x, s.z - found!.z));
    });
    expect(minDist).toBeGreaterThan(found!.r + 0.25);
  });
});

describe('déterminisme et simulation', () => {
  it('deux mondes identiques donnent des états identiques au bit près', async () => {
    const a = await LocalSimulation.create(424242);
    const b = await LocalSimulation.create(424242);
    const rand = mulberry32(11);
    for (let i = 0; i < 900; i++) {
      const c = {
        seq: i + 1,
        wx: rand() * 2 - 1,
        wz: rand() * 2 - 1,
        yaw: rand() * 6,
        pitch: 0,
        buttons: (rand() < 0.1 ? BTN_JUMP : 0) | (rand() < 0.5 ? BTN_SPRINT : 0),
      };
      a.step(c);
      b.step({ ...c });
    }
    expect(b.state).toEqual(a.state);
    a.dispose();
    b.dispose();
  });

  it("la simulation démarre au point d'apparition et le joueur s'y pose", async () => {
    const sim = await LocalSimulation.create(7);
    for (let i = 0; i < 120; i++) sim.step(cmd(0, 0));
    expect(sim.state.grounded).toBe(true);
    expect(Math.abs(sim.state.y - sim.terrain.heightAt(sim.state.x, sim.state.z))).toBeLessThan(0.15);
    sim.dispose();
  });

  it('chute hors du monde : retour au point d’apparition', async () => {
    const sim = await LocalSimulation.create(7);
    sim.state.y = -500;
    sim.step(cmd(0, 0));
    expect(sim.respawns).toBe(1);
    expect(sim.state.y).toBeGreaterThan(0);
    sim.dispose();
  });
});
