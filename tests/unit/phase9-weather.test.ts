// Phase 9 : météo (déterministe, régionale) et ses effets sur le jeu.

import { beforeAll, describe, expect, it } from 'vitest';
import { itemShape } from '../../src/shared/props';
import { OBSTACLE_GROUPS, RAPIER, initPhysics } from '../../src/shared/physics';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { Terrain } from '../../src/shared/terrain';
import { type Weather, weatherAt } from '../../src/shared/weather';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;
const RAIN: Weather = { cloud: 1, rain: 0.9, storm: 0, fog: 0.3, snow: 0, gust: 2 };
const STORM: Weather = { cloud: 1, rain: 0.9, storm: 1, fog: 0.3, snow: 0, gust: 11 };

describe('météo du monde', () => {
  it('identique pour tous (même graine, même instant, même lieu) ; plus humide à l’est qu’à l’ouest', () => {
    const a = new Terrain(20261112);
    const b = new Terrain(20261112);
    for (const t of [0, 1234.5, 98765]) expect(weatherAt(a, t, 800, -300)).toEqual(weatherAt(b, t, 800, -300));
    let east = 0;
    let west = 0;
    for (let t = 0; t < 2400 * 20; t += 60) {
      east += weatherAt(a, t, 6500, 0).rain;
      west += weatherAt(a, t, -6500, 0).rain;
    }
    expect(east).toBeGreaterThan(west * 5 + 1);
  });

  it('la météo change avec le temps (il ne pleut pas sans cesse)', () => {
    const t = new Terrain(20261112);
    const seen = new Set<string>();
    for (let time = 0; time < 2400 * 20; time += 120) {
      const w = weatherAt(t, time, 6500, 0);
      seen.add(w.rain > 0.3 ? 'pluie' : w.cloud > 0.5 ? 'nuages' : 'clair');
    }
    expect(seen.size).toBe(3);
  });
});

describe('effets de la météo', () => {
  function setup() {
    const s = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false });
    for (let i = 0; i < 20; i++) s.step(cmd(0, 0));
    return s;
  }

  it('sous la pluie, l’herbe devient de la boue (on marche plus lentement)', () => {
    const s = setup();
    for (let i = 0; i < 30; i++) s.step(cmd(0, 1));
    expect(s.state.surface).toBe('herbe');
    const dry = Math.hypot(s.state.vx, s.state.vz);
    s.weatherOverride = RAIN;
    for (let i = 0; i < 60; i++) s.step(cmd(0, 1));
    expect(s.state.surface).toBe('boue');
    expect(Math.hypot(s.state.vx, s.state.vz)).toBeLessThan(dry * 0.8);
  });

  it('la pluie éteint un feu à découvert ; sous un toit, il tient', () => {
    const s = setup();
    const st = s.state;
    const lit = (x: number) => s.props.spawnDynamic({ kind: 'foyer', x, y: LEVEL + 0.1, z: st.z + 3, rot: 0, ...itemShape('foyer'), fixed: true, fire: { lit: true, fuel: 3000, pot: null, cook: 0 } });
    const outside = lit(st.x - 4);
    const inside = lit(st.x + 4);
    // Un toit au-dessus du second feu.
    s.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(st.x + 4, LEVEL + 3, st.z + 3).setCollisionGroups(OBSTACLE_GROUPS));
    s.phys.markDirty();
    s.weatherOverride = RAIN;
    for (let i = 0; i < 60 * 90; i++) s.step(cmd(0, 0));
    expect(s.props.defOf(outside)?.fire?.lit).toBe(false);
    expect(s.props.defOf(inside)?.fire?.lit).toBe(true);
    expect(s.sheltered(st.x + 4, LEVEL, st.z + 3)).toBe(true);
    expect(s.sheltered(st.x - 4, LEVEL, st.z + 3)).toBe(false);
  });

  it('la foudre qui tombe sur un joueur à découvert le brûle et l’assomme ; à l’abri, rien', () => {
    const s = setup();
    const events: SimEvent[] = [];
    s.strike(s.state.x + 1, s.state.z);
    for (let i = 0; i < 5; i++) {
      s.step(cmd(0, 0));
      events.push(...s.takeEvents());
    }
    expect(events.some((e) => e.type === 'foudre')).toBe(true);
    expect(s.vitals.injuries.some((i) => i.kind === 'brulure')).toBe(true);
    expect(s.vitals.state).not.toBe('eveille');
    // Un autre joueur, sous un abri, n'est pas touché.
    const s2 = setup();
    const p = s2.state;
    s2.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(p.x, p.y + 3, p.z).setCollisionGroups(OBSTACLE_GROUPS));
    s2.phys.markDirty();
    s2.step(cmd(0, 0));
    s2.strike(p.x + 1, p.z);
    expect(s2.vitals.injuries.length).toBe(0);
  });

  it('pendant un orage, la foudre tombe régulièrement près du joueur', () => {
    const s = setup();
    s.weatherOverride = STORM;
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      s.step(cmd(0, 0));
      events.push(...s.takeEvents());
    }
    const strikes = events.filter((e) => e.type === 'foudre').length;
    expect(strikes).toBeGreaterThan(1);
    expect(strikes).toBeLessThan(40);
  });
});
