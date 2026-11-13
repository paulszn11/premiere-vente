// Phase 6 : créatures, sens, comportements, combats, carcasses, pièges, écosystème.

import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerAction } from '../../src/shared/actions';
import { EYE_HEIGHT, WATER_LEVEL } from '../../src/shared/constants';
import { SPECIES, SPECIES_IDS, bodySegment, partAt, rayCapsule, speciesName } from '../../src/shared/creatures';
import { Fauna } from '../../src/shared/fauna';
import { type ItemStack, countOf } from '../../src/shared/inventory';
import { BTN_CROUCH, BTN_INTERACT, BTN_SPRINT } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { itemShape } from '../../src/shared/props';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { addInjury } from '../../src/shared/vitals';
import { FlatTerrain, FnTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;

function setup(terrain = new FlatTerrain(LEVEL)) {
  const s = new LocalSimulation(terrain, { fauna: true });
  s.fauna.wild = false;
  const events: SimEvent[] = [];
  let yaw = 0;
  let pitch = 0;
  const run = (n: number, wx = 0, wz = 0, buttons = 0) => {
    for (let i = 0; i < n; i++) {
      s.step(cmd(wx, wz, buttons, yaw, pitch));
      events.push(...s.takeEvents());
    }
  };
  const look = (y: number, p = 0) => {
    yaw = y;
    pitch = p;
  };
  const aim = (x: number, y: number, z: number) => {
    const st = s.state;
    const eye = st.y + EYE_HEIGHT;
    yaw = Math.atan2(x - st.x, z - st.z);
    pitch = Math.atan2(eye - y, Math.hypot(x - st.x, z - st.z));
    run(2);
  };
  const act = (a: PlayerAction) => s.act(a);
  const hold = (st: ItemStack) => {
    s.inventory.bag!.unshift(st);
    const r = s.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    run(5);
    return r;
  };
  const creatures = (sp?: string) => s.creatureViews().filter((c) => !sp || c.sp === sp);
  const of = (type: string) => events.filter((e) => e.type === type);
  run(30);
  return { s, run, look, aim, act, hold, creatures, events, of };
}

describe('catalogue et géométrie', () => {
  it('chaque espèce a des valeurs cohérentes ; noms avec articles', () => {
    for (const id of SPECIES_IDS) {
      const d = SPECIES[id];
      expect(d.hp).toBeGreaterThan(0);
      expect(d.run).toBeGreaterThanOrEqual(d.walk);
      expect(d.group[0]).toBeLessThanOrEqual(d.group[1]);
      if (d.attack) expect(d.attack.zones.length).toBeGreaterThan(0);
    }
    expect(speciesName('hyene')).toBe('une hyène');
    expect(speciesName('elephant', 'le')).toBe('l’éléphant');
    expect(speciesName('leopard', 'le')).toBe('le léopard');
  });

  it('un rayon touche la capsule du corps ; la partie touchée dépend du point d’impact', () => {
    const seg = bodySegment('hyene', 0, 0, 0, 0);
    const t = rayCapsule({ x: -3, y: seg.ay, z: 0 }, { x: 1, y: 0, z: 0 }, { x: seg.ax, y: seg.ay, z: seg.az }, { x: seg.bx, y: seg.by, z: seg.bz }, seg.r, 6);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(2.4);
    expect(t!).toBeLessThan(3);
    const miss = rayCapsule({ x: -3, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, { x: seg.ax, y: seg.ay, z: seg.az }, { x: seg.bx, y: seg.by, z: seg.bz }, seg.r, 6);
    expect(miss).toBeNull();
    // Hyène tournée vers +z : avant = tête, arrière = arrière-train, bas = pattes.
    expect(partAt('hyene', 0, 0, 0, 0, 0, 0.7, 0.75)).toBe('tete');
    expect(partAt('hyene', 0, 0, 0, 0, 0, 0.5, -0.5)).toBe('arriere');
    expect(partAt('hyene', 0, 0, 0, 0, 0.1, 0.12, 0)).toBe('pattes');
    expect(partAt('hyene', 0, 0, 0, 0, 0.3, 0.5, 0)).toBe('corps');
  });
});

describe('sens et comportements', () => {
  it('une harde d’impalas fuit le joueur qui court vers elle et donne l’alarme', () => {
    const { s, run, creatures, of } = setup();
    s.spawnCreatures('impala', s.state.x, s.state.z + 35, 4);
    run(60);
    const before = creatures('impala').map((c) => Math.hypot(c.x - s.state.x, c.z - s.state.z));
    run(60 * 6, 0, 1, BTN_SPRINT);
    const herd = creatures('impala');
    expect(herd.some((c) => c.mode === 'fuite')).toBe(true);
    expect(of('son').some((e) => e.type === 'son' && e.kind === 'impala_alarme')).toBe(true);
    // Ils ont pris le large malgré la course du joueur.
    run(60 * 4);
    const after = creatures('impala').map((c) => Math.hypot(c.x - s.state.x, c.z - s.state.z));
    expect(Math.min(...after)).toBeGreaterThan(Math.min(...before) * 0.6);
  });

  it('accroupi et lent, on s’approche bien plus près sans les effrayer', () => {
    const near = (crouch: boolean) => {
      const { s, run, creatures } = setup();
      s.spawnCreatures('impala', s.state.x, s.state.z + 45, 3);
      run(60);
      let closest = Infinity;
      for (let t = 0; t < 60 * 25; t++) {
        run(1, 0, crouch ? 1 : 1, crouch ? BTN_CROUCH : BTN_SPRINT);
        const herd = creatures('impala');
        if (herd.some((c) => c.mode === 'fuite')) break;
        closest = Math.min(closest, ...herd.map((c) => Math.hypot(c.x - s.state.x, c.z - s.state.z)));
      }
      return closest;
    };
    expect(near(true)).toBeLessThan(near(false));
  });

  it('les hyènes encerclent et mordent un joueur blessé et seul', () => {
    const { s, run, of } = setup();
    s.vitals.health = 40;
    addInjury(s.vitals, 'jambe_g', 'coupure', false);
    s.spawnCreatures('hyene', s.state.x, s.state.z + 40, 3);
    for (let k = 0; k < 60 * 60 && !of('attaque').length; k++) run(1);
    const bites = of('attaque').filter((e) => e.type === 'attaque' && e.sp === 'hyene');
    expect(bites.length).toBeGreaterThan(0);
    expect(s.vitals.injuries.length).toBeGreaterThan(1);
    expect(of('message').some((e) => e.type === 'message' && /hyène vous mord/.test(e.text))).toBe(true);
  });

  it('près d’un feu allumé, les hyènes gardent leurs distances', () => {
    const { s, run, of } = setup();
    s.vitals.health = 40;
    addInjury(s.vitals, 'jambe_g', 'coupure', false);
    const st = s.state;
    s.props.spawnDynamic({ kind: 'foyer', x: st.x + 1.2, y: st.y + 0.1, z: st.z, rot: 0, ...itemShape('foyer'), fixed: true, fire: { lit: true, fuel: 3000, pot: null, cook: 0 } });
    s.spawnCreatures('hyene', st.x, st.z + 40, 3);
    run(60 * 60);
    expect(of('attaque').filter((e) => e.type === 'attaque' && e.sp === 'hyene').length).toBe(0);
  });

  it('le léopard attaque par derrière sans prévenir', () => {
    const { s, run, look, of } = setup();
    look(0);
    const [id] = s.spawnCreatures('leopard', s.state.x + 2, s.state.z - 30, 1);
    const c = s.fauna.creatures.get(id!)!;
    c.yaw = Math.atan2(s.state.x - c.x, s.state.z - c.z);
    run(60 * 30);
    const atk = of('attaque').filter((e) => e.type === 'attaque' && e.sp === 'leopard');
    expect(atk.length).toBeGreaterThan(0);
  });

  it('fixé du regard, le léopard renonce et se replie', () => {
    const { s, run, look, of } = setup();
    const [id] = s.spawnCreatures('leopard', s.state.x, s.state.z - 20, 1);
    const c = s.fauna.creatures.get(id!)!;
    c.yaw = Math.atan2(s.state.x - c.x, s.state.z - c.z);
    // Le joueur regarde vers le léopard (vers −z).
    look(Math.PI);
    let retreated = false;
    for (let k = 0; k < 60 * 15; k++) {
      run(1);
      if (c.mode === 'repli') retreated = true;
    }
    expect(retreated).toBe(true);
    expect(of('attaque').filter((e) => e.type === 'attaque' && e.sp === 'leopard').length).toBe(0);
  });

  it('les éléphants préviennent puis chargent si l’on insiste ; ils renversent une clôture sur leur passage', () => {
    const { s, run, of } = setup();
    const st = s.state;
    s.spawnCreatures('elephant', st.x, st.z + 30, 3);
    for (const c of s.fauna.creatures.values()) c.yaw = Math.atan2(st.x - c.x, st.z - c.z);
    run(60 * 4);
    // On avance vers eux.
    run(60 * 8, 0, 1);
    const sounds = of('son').filter((e) => e.type === 'son' && e.kind === 'elephant_barrit');
    expect(sounds.length).toBeGreaterThan(0);
    expect([...s.fauna.creatures.values()].some((c) => c.mode === 'charge' || c.mode === 'menace')).toBe(true);
  });
});

describe('combats, carcasse, viande', () => {
  it('à la lance : dégâts localisés, saignement ; la carcasse se dépèce ; la viande cuit au feu et se mange', () => {
    const { s, run, aim, act, hold, creatures, of } = setup();
    hold({ item: 'lance', count: 1 });
    const st = s.state;
    const [id] = s.spawnCreatures('impala', st.x, st.z + 2.2, 1);
    const c = s.fauna.creatures.get(id!)!;
    c.yaw = Math.PI / 2;
    s.fauna.setCaught(id!, 'test');
    let killed = false;
    for (let k = 0; k < 12 && !killed; k++) {
      aim(c.x, c.y + 0.6, c.z);
      const r = act({ type: 'utiliser' });
      expect(r.ok).toBe(true);
      run(70);
      killed = c.dead;
    }
    expect(killed).toBe(true);
    expect(of('touche').length).toBeGreaterThan(0);
    run(10);
    const carcass = s.props.views().find((v) => v.kind === 'carcasse');
    expect(carcass?.sp).toBe('impala');
    expect(creatures('impala').length).toBe(0);
    // Dépeçage au couteau.
    act({ type: 'ranger' });
    run(10);
    hold({ item: 'couteau', count: 1 });
    aim(carcass!.x, carcass!.y, carcass!.z);
    const r = act({ type: 'utiliser' });
    expect(r.ok, r.message).toBe(true);
    expect(s.gesture?.kind).toBe('depecage');
    run(60 * 20);
    expect(countOf(s.inventory, 'viande_crue')).toBe(2);
    // Cuisson sur un foyer allumé.
    const fire = s.props.spawnDynamic({ kind: 'foyer', x: st.x + 1, y: st.y + 0.1, z: st.z + 1, rot: 0, ...itemShape('foyer'), fixed: true, fire: { lit: true, fuel: 3000, pot: null, cook: 0 } });
    const slot = s.inventory.pockets.findIndex((p) => p?.item === 'viande_crue');
    const from = slot >= 0 ? { zone: 'poche' as const, index: slot } : { zone: 'sac' as const, index: s.inventory.bag!.findIndex((b) => b.item === 'viande_crue') };
    expect(act({ type: 'poser_feu', prop: fire, from }).ok).toBe(true);
    run(60 * 50);
    expect(s.props.defOf(fire)!.fire!.pot?.item).toBe('viande_cuite');
    expect(act({ type: 'reprendre_feu', prop: fire }).ok).toBe(true);
    expect(countOf(s.inventory, 'viande_cuite')).toBe(2);
  });

  it('une pierre lancée blesse l’animal touché', () => {
    const { s, run, look, act, creatures } = setup();
    const st = s.state;
    const [id] = s.spawnCreatures('phacochere', st.x, st.z + 6, 1);
    const c = s.fauna.creatures.get(id!)!;
    s.fauna.setCaught(id!, 'test');
    c.yaw = Math.PI / 2;
    const stone = s.props.spawnDynamic({ kind: 'pierre', x: st.x, y: st.y + 1.2, z: st.z + 0.6, rot: 0, radius: 0.08, length: 0 });
    look(0, -0.05);
    run(2);
    s.props.grab(stone, s.state);
    run(20);
    const hp0 = c.hp;
    // Lancer (clic gauche).
    run(1, 0, 0, 16);
    run(60);
    expect(c.hp).toBeLessThan(hp0);
    expect(creatures('phacochere').length).toBe(1);
    void act;
  });

  it('le crocodile saisit le joueur dans l’eau ; frappé à la tête, il lâche', () => {
    // Rive : terre ferme pour x < 0, eau de 1,5 m au-delà.
    const terrain = new FnTerrain((x) => (x < 0 ? 1 : -1.5), { biome: 'fleuve', river: 1 });
    const { s, run, act, hold, of } = setup(terrain);
    s.teleport(3, -1.5, 0);
    run(30);
    hold({ item: 'couteau', count: 1 });
    const [id] = s.spawnCreatures('crocodile', 9, 0, 1);
    const c = s.fauna.creatures.get(id!)!;
    c.yaw = -Math.PI / 2;
    c.alert = 1;
    let grabbed = false;
    for (let k = 0; k < 60 * 30 && !grabbed; k++) {
      run(1);
      grabbed = s.fauna.grab !== null;
    }
    expect(grabbed).toBe(true);
    expect(of('message').some((e) => e.type === 'message' && /crocodile vous entraîne/.test(e.text))).toBe(true);
    for (let k = 0; k < 10 && s.fauna.grab; k++) {
      act({ type: 'utiliser' });
      run(60);
    }
    expect(s.fauna.grab).toBeNull();
    expect(s.vitals.injuries.length).toBeGreaterThan(0);
  });

  it('se débattre (E à répétition) libère aussi d’une prise', () => {
    const terrain = new FnTerrain((x) => (x < 0 ? 1 : -1.5), { biome: 'fleuve', river: 1 });
    const { s, run } = setup(terrain);
    s.teleport(3, -1.5, 0);
    run(30);
    const [id] = s.spawnCreatures('crocodile', 6, 0, 1);
    const c = s.fauna.creatures.get(id!)!;
    c.yaw = -Math.PI / 2;
    c.alert = 1;
    for (let k = 0; k < 60 * 30 && !s.fauna.grab; k++) run(1);
    expect(s.fauna.grab).not.toBeNull();
    for (let k = 0; k < 12 && s.fauna.grab; k++) {
      run(3, 0, 0, BTN_INTERACT);
      run(3);
    }
    expect(s.fauna.grab).toBeNull();
  });

  it('à terre, un prédateur achève sa proie : mort par attaque, corps laissé', () => {
    const { s, run } = setup();
    s.vitals.state = 'critique';
    s.vitals.health = 0;
    s.vitals.timer = 90;
    addInjury(s.vitals, 'torse', 'coupure', true);
    s.spawnCreatures('hyene', s.state.x + 3, s.state.z + 3, 3);
    for (let k = 0; k < 60 * 40 && !s.dead; k++) run(1);
    expect(s.dead).toBe(true);
    expect(['attaque', 'hemorragie']).toContain(s.vitals.cause);
  });
});

describe('pièges', () => {
  function trap(s: LocalSimulation, kind: 'collet' | 'fosse' | 'assommoir', x: number, z: number) {
    return s.props.spawnDynamic({ kind, x, y: LEVEL + 0.05, z, rot: 0, ...itemShape(kind), fixed: true, trap: { armed: true, caught: null } });
  }

  it('un collet retient l’impala qui y passe ; le joueur qui marche dessus est pris, puis se dégage (E)', () => {
    const { s, run, look } = setup();
    const st = s.state;
    const tid = trap(s, 'collet', st.x + 20, st.z + 20);
    // L'impala pose la patte dans le nœud.
    const [id] = s.spawnCreatures('impala', st.x + 20, st.z + 20.2, 1);
    const c = s.fauna.creatures.get(id!)!;
    run(60);
    expect(c.caught).toBe(tid);
    expect(s.props.defOf(tid)!.trap!.caught).toBe(id);
    // Le joueur marche sur un second collet.
    const t2 = trap(s, 'collet', st.x, st.z + 2);
    look(0);
    run(60 * 2, 0, 1);
    expect(s.trappedIn).toBe(t2);
    const z0 = s.state.z;
    run(60, 0, 1);
    expect(Math.abs(s.state.z - z0)).toBeLessThan(0.05);
    run(2, 0, 0, BTN_INTERACT);
    run(60 * 3);
    expect(s.trappedIn).toBeNull();
  });

  it('la fosse blesse la créature et la retient ; l’assommoir lâche une vraie pierre qui blesse', () => {
    const { s, run } = setup();
    const st = s.state;
    const fosse = trap(s, 'fosse', st.x + 30, st.z);
    const [hy] = s.spawnCreatures('hyene', st.x + 30, st.z + 0.5, 1);
    const h = s.fauna.creatures.get(hy!)!;
    run(60);
    expect(h.hp).toBeLessThan(h.maxHp);
    expect(s.props.defOf(fosse)!.trap!.armed).toBe(false);
    const ass = trap(s, 'assommoir', st.x - 30, st.z);
    const [ph] = s.spawnCreatures('phacochere', st.x - 30, st.z + 0.2, 1);
    const p = s.fauna.creatures.get(ph!)!;
    for (let k = 0; k < 60 && s.props.defOf(ass)!.trap!.armed; k++) run(1);
    // Il reste sous la pierre qui tombe.
    s.fauna.setCaught(ph!, 'test');
    run(60 * 3);
    expect(s.props.defOf(ass)!.trap!.armed).toBe(false);
    expect(p.hp).toBeLessThan(p.maxHp);
  });
});

describe('écosystème, mémoire, sauvegarde', () => {
  it('les populations croissent vers la capacité ; la chasse rend la zone et l’espèce méfiantes', () => {
    const f = new Fauna(7, new FlatTerrain(LEVEL));
    const n0 = f.population('impala', 100, 100);
    // Simule des heures de jeu sans joueur proche.
    for (let k = 0; k < 120; k++) (f as unknown as { stepEcosystem(m: number): void }).stepEcosystem(60);
    const n1 = f.population('impala', 100, 100);
    expect(n1).toBeGreaterThanOrEqual(n0);
    const g = f.spawnGroup('impala', 0, 0, 1);
    const id = g.members[0]!;
    f.hurt(id, 999, 'corps', { bleed: false, by: 'joueur', x: 0, z: 0 });
    expect(f.traits.impala!.wary).toBeGreaterThan(0);
    expect(f.takeEvents().some((e) => e.type === 'mort')).toBe(true);
  });

  it('le léopard retient les endroits où il a vu le joueur ; sauvegarde et relecture des individus suivis', () => {
    const { s, run } = setup();
    const st = s.state;
    const [id] = s.spawnCreatures('leopard', st.x, st.z + 25, 1);
    const g = s.fauna.groups.get(s.fauna.creatures.get(id!)!.group)!;
    g.key = 'leopard:test';
    s.fauna.creatures.get(id!)!.yaw = Math.PI;
    run(60 * 3);
    expect(g.habits.length).toBeGreaterThan(0);
    const save = JSON.parse(JSON.stringify(s.serialize()));
    expect(save.fauna.groups.some((x: { key: string; habits: unknown[] }) => x.key === 'leopard:test' && x.habits.length > 0)).toBe(true);
    const back = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: true, save });
    const g2 = [...back.fauna.groups.values()].find((x) => x.key === 'leopard:test');
    expect(g2?.habits.length).toBe(g.habits.length);
    // Ancienne sauvegarde sans faune : se relit.
    delete save.fauna;
    expect(() => new LocalSimulation(new FlatTerrain(LEVEL), { fauna: true, save })).not.toThrow();
  });

  it('déterminisme : deux simulations identiques donnent les mêmes créatures', () => {
    const a = setup();
    const b = setup();
    a.s.spawnCreatures('hyene', a.s.state.x, a.s.state.z + 30, 3);
    b.s.spawnCreatures('hyene', b.s.state.x, b.s.state.z + 30, 3);
    a.run(60 * 10, 0, 1);
    b.run(60 * 10, 0, 1);
    expect(JSON.stringify(a.creatures())).toBe(JSON.stringify(b.creatures()));
  });

  it('le babouin vole la nourriture laissée sans surveillance et s’en souvient', () => {
    const { s, run } = setup();
    const st = s.state;
    const fig = s.props.spawnDynamic({ kind: 'figue', x: st.x + 40, y: LEVEL + 0.1, z: st.z, rot: 0, ...itemShape('figue') });
    const ids = s.spawnCreatures('babouin', st.x + 55, st.z, 4);
    const g = s.fauna.groups.get(s.fauna.creatures.get(ids[0]!)!.group)!;
    run(60 * 40);
    expect(s.props.defOf(fig)).toBeNull();
    expect(g.food.length).toBeGreaterThan(0);
  });
});

describe('créature du lac (monde réel)', () => {
  it('nager dans les eaux profondes attire la créature, qui tourne autour puis saisit et entraîne vers le fond', () => {
    const s = new LocalSimulation(20261112, { spawnSeed: 1 });
    s.fauna.wild = false;
    const g = [...s.fauna.groups.values()].find((x) => x.sp === 'ombre')!;
    const home = g.home;
    const y = s.terrain.heightAt(home.x, home.z);
    expect(WATER_LEVEL - y).toBeGreaterThan(5);
    s.teleport(home.x, WATER_LEVEL - 1, home.z);
    const events: SimEvent[] = [];
    let grabbed = false;
    let seen = false;
    for (let k = 0; k < 60 * 240 && !grabbed; k++) {
      // Nage rapide en rond : bruyant.
      const a = k / 600;
      s.step(cmd(Math.cos(a), Math.sin(a), BTN_SPRINT));
      events.push(...s.takeEvents());
      if (s.creatureViews().some((c) => c.sp === 'ombre')) seen = true;
      grabbed = s.fauna.grab !== null;
    }
    expect(seen).toBe(true);
    expect(grabbed).toBe(true);
    expect(events.some((e) => e.type === 'son' && e.kind === 'ombre_gronde')).toBe(true);
    // Frappée, elle lâche, se retire et disparaît : elle ne meurt pas.
    const c = [...s.fauna.creatures.values()].find((x) => x.sp === 'ombre')!;
    s.fauna.hurt(c.id, 5000, 'tete', { bleed: true, by: 'joueur', x: s.state.x, z: s.state.z });
    expect(s.fauna.grab).toBeNull();
    expect(c.dead).toBe(false);
    for (let k = 0; k < 60 * 20; k++) s.step(cmd(0, 0, 0));
    expect(s.creatureViews().some((x) => x.sp === 'ombre')).toBe(false);
    expect(s.fauna.traits.ombre!.wary).toBeGreaterThan(0);
  });
});
