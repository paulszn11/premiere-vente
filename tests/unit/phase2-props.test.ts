import { beforeAll, describe, expect, it } from 'vitest';
import { MOVE, WORLD_HALF } from '../../src/shared/constants';
import { BTN_INTERACT, BTN_JUMP, BTN_SPRINT, BTN_THROW } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { type PropDef, handlingFor, propMass, propsInChunk } from '../../src/shared/props';
import { LocalSimulation } from '../../src/shared/simulation';
import { MIN_SPAWN_DISTANCE, chooseSpawn, spawnHeight } from '../../src/shared/spawn';
import { Terrain } from '../../src/shared/terrain';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;
const LOOK_DOWN = 0.9; // radians : regard vers le sol devant soi

function sim() {
  const s = new LocalSimulation(new FlatTerrain(LEVEL));
  const run = (n: number, wx: number, wz: number, buttons = 0, yaw = 0, pitch = LOOK_DOWN) => {
    for (let i = 0; i < n; i++) s.step(cmd(wx, wz, buttons, yaw, pitch));
  };
  run(30, 0, 0);
  return { s, run };
}

function stone(id: string, x: number, z: number, radius = 0.08): PropDef {
  return { id, kind: 'pierre', x, y: LEVEL + radius + 0.02, z, rot: 0, radius, length: 0 };
}

describe('masses et prises', () => {
  it('une-main, deux-mains ou traîner selon la masse', () => {
    expect(handlingFor(propMass({ kind: 'pierre', radius: 0.08, length: 0 }))).toBe('une-main');
    expect(handlingFor(propMass({ kind: 'buche', radius: 0.09, length: 1 }))).toBe('deux-mains');
    expect(handlingFor(propMass({ kind: 'tronc', radius: 0.2, length: 2.5 }))).toBe('trainer');
  });

  it('le monde contient des objets déplaçables, placés de façon déterministe', () => {
    const t1 = new Terrain(20261112);
    const t2 = new Terrain(20261112);
    let total = 0;
    for (let cx = -2; cx <= 2; cx++) {
      const a = propsInChunk(t1, cx, 3);
      expect(propsInChunk(t2, cx, 3)).toEqual(a);
      total += a.length;
    }
    expect(total).toBeGreaterThan(5);
  });
});

describe('ramasser, porter, lancer', () => {
  it('ramasser une pierre devant soi, la porter, la poser', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add(stone('p1', p.x, p.z + 1.1));
    run(10, 0, 0);
    expect(s.props.target(p, 0, LOOK_DOWN)?.id).toBe('p1');
    run(1, 0, 0, BTN_INTERACT);
    expect(s.props.held?.id).toBe('p1');
    expect(p.carryMass).toBeGreaterThan(0);
    run(120, 0, 1, 0, 0, 0.3);
    const pos = s.props.position('p1')!;
    expect(Math.hypot(pos.x - p.x, pos.z - p.z)).toBeLessThan(1.3);
    expect(pos.y).toBeGreaterThan(LEVEL + 0.5);
    run(1, 0, 0, BTN_INTERACT);
    expect(s.props.held).toBeNull();
    run(120, 0, 0);
    expect(s.props.position('p1')!.y).toBeLessThan(LEVEL + 0.3);
  });

  it('lancer une pierre l’envoie à plusieurs mètres', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add(stone('p2', p.x, p.z + 1.1));
    run(10, 0, 0);
    run(1, 0, 0, BTN_INTERACT);
    run(30, 0, 0, 0, 0, -0.2);
    run(1, 0, 0, BTN_THROW, 0, -0.2);
    run(120, 0, 0, 0, 0, -0.2);
    const pos = s.props.position('p2')!;
    expect(pos.z - p.z).toBeGreaterThan(4);
  });

  it('un objet lourd se porte à deux mains : lent, sans course ni saut', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add({ id: 'b1', kind: 'buche', x: p.x, y: LEVEL + 0.12, z: p.z + 1.1, rot: 0.25, radius: 0.09, length: 1 });
    run(20, 0, 0);
    run(1, 0, 0, BTN_INTERACT);
    expect(s.props.held?.mode).toBe('carry');
    expect(p.carryMass).toBeGreaterThan(8);
    run(120, 0, 1, BTN_SPRINT, 0, 0.3);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(MOVE.heavyCarrySpeed + 0.05);
    const y0 = p.y;
    let maxY = y0;
    for (let i = 0; i < 30; i++) {
      run(1, 0, 0, i === 0 ? BTN_JUMP : 0, 0, 0.3);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY - y0).toBeLessThan(0.05);
  });

  it('un tronc trop lourd se traîne lentement', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add({ id: 't1', kind: 'tronc', x: p.x, y: LEVEL + 0.22, z: p.z + 1.4, rot: 0.25, radius: 0.2, length: 2.5 });
    run(20, 0, 0, 0, 0, 0.7);
    run(1, 0, 0, BTN_INTERACT, 0, 0.7);
    expect(s.props.held?.mode).toBe('drag');
    expect(p.dragging).toBe(true);
    const start = s.props.position('t1')!;
    run(240, 0, 1, BTN_SPRINT, 0, 0.7);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(MOVE.dragSpeed + 0.05);
    const end = s.props.position('t1')!;
    expect(end.z - start.z).toBeGreaterThan(1.5);
  });

  it('en marchant contre un gros tronc couché, on le fait rouler ; une petite bûche s’enjambe', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add({ id: 'g1', kind: 'tronc', x: p.x, y: LEVEL + 0.24, z: p.z + 1.3, rot: 0, radius: 0.22, length: 2.4 });
    run(30, 0, 0);
    const z0 = s.props.position('g1')!.z;
    run(240, 0, 1, 0, 0, 0);
    expect(s.props.position('g1')!.z - z0).toBeGreaterThan(0.3);

    const t = sim();
    const q = t.s.state;
    t.s.props.add({ id: 'b2', kind: 'buche', x: q.x, y: LEVEL + 0.1, z: q.z + 1.2, rot: 0, radius: 0.08, length: 1.2 });
    t.run(30, 0, 0);
    t.run(180, 0, 1, 0, 0, 0);
    expect(q.z).toBeGreaterThan(2.5);
  });
});

describe('objets déplacés mémorisés', () => {
  it('une pierre lancée reste où elle est tombée quand on part et qu’on revient', () => {
    const { s, run } = sim();
    const p = s.state;
    s.props.add(stone('p3', p.x, p.z + 1.1));
    run(10, 0, 0);
    run(1, 0, 0, BTN_INTERACT);
    run(30, 0, 0, 0, 0, -0.2);
    run(1, 0, 0, BTN_THROW, 0, -0.2);
    // Attendre que la pierre s'immobilise.
    let landed = s.props.position('p3')!;
    for (let i = 0; i < 40; i++) {
      run(30, 0, 0);
      const now = s.props.position('p3')!;
      const moved = Math.hypot(now.x - landed.x, now.z - landed.z);
      landed = now;
      if (moved < 0.002) break;
    }
    const home = { x: p.x, z: p.z };
    s.teleport(home.x + 1000, LEVEL + 0.1, home.z);
    run(800, 0, 0);
    expect(s.props.liveIds()).not.toContain('p3');
    expect(s.props.movedCount).toBeGreaterThan(0);
    s.teleport(home.x, LEVEL + 0.1, home.z);
    run(5, 0, 0);
    expect(s.props.liveIds()).toContain('p3');
    const back = s.props.position('p3')!;
    expect(Math.hypot(back.x - landed.x, back.z - landed.z)).toBeLessThan(0.2);
  });
});

describe('apparitions', () => {
  it('chaque joueur apparaît loin des autres, sur la terre ferme', () => {
    const t = new Terrain(20261112);
    const spawns: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 10; i++) {
      const sp = chooseSpawn(t, 1000 + i, spawns);
      expect(spawnHeight(t, sp.x, sp.z)).not.toBeNull();
      expect(Math.abs(sp.x)).toBeLessThan(WORLD_HALF - 900);
      expect(Math.abs(sp.z)).toBeLessThan(WORLD_HALF - 900);
      spawns.push(sp);
    }
    let minD = Infinity;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const d = Math.hypot(spawns[i]!.x - spawns[j]!.x, spawns[i]!.z - spawns[j]!.z);
        minD = Math.min(minD, d);
        sum += d;
        pairs++;
      }
    }
    // Les 6 premiers sont à plus de 4 km les uns des autres ; 10 joueurs restent à plus de 2,5 km.
    for (let i = 1; i < 6; i++) {
      for (let j = 0; j < i; j++) expect(Math.hypot(spawns[i]!.x - spawns[j]!.x, spawns[i]!.z - spawns[j]!.z)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
    }
    expect(minD).toBeGreaterThan(2500);
    expect(sum / pairs).toBeGreaterThan(5000);
  });

  it('en solo, la simulation fait apparaître le joueur au hasard dans le monde', () => {
    const a = new LocalSimulation(20261112, { spawnSeed: 1 });
    const b = new LocalSimulation(20261112, { spawnSeed: 2 });
    expect(Math.hypot(a.spawn.x - b.spawn.x, a.spawn.z - b.spawn.z)).toBeGreaterThan(100);
    a.dispose();
    b.dispose();
  });
});
