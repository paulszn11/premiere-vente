import { beforeAll, describe, expect, it } from 'vitest';
import { readAction } from '../../src/shared/actions';
import { MOVE } from '../../src/shared/constants';
import { countOf, store } from '../../src/shared/inventory';
import { BTN_CROUCH, BTN_INTERACT, BTN_SPRINT } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { type PropDef, type PropKind, itemShape } from '../../src/shared/props';
import { BODY_EMPTY_SECONDS, LocalSimulation, RESPAWN_DELAY, type SimEvent, compassDirection } from '../../src/shared/simulation';
import { addInjury } from '../../src/shared/vitals';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;
const LOOK_DOWN = 0.9;

function setup(level = LEVEL) {
  const s = new LocalSimulation(new FlatTerrain(level));
  const events: SimEvent[] = [];
  const run = (n: number, wx = 0, wz = 0, buttons = 0, yaw = 0, pitch = LOOK_DOWN) => {
    for (let i = 0; i < n; i++) {
      s.step(cmd(wx, wz, buttons, yaw, pitch));
      events.push(...s.takeEvents());
    }
  };
  run(30);
  return { s, run, events };
}

function item(id: string, kind: PropKind, x: number, z: number): PropDef {
  const shape = itemShape(kind);
  return { id, kind, x, y: LEVEL + shape.radius + 0.03, z, rot: 0, ...shape };
}

describe('ramasser et ranger', () => {
  it('ramasser une figue la met en poche ; un bâton va dans le sac', () => {
    const { s, run } = setup();
    s.props.add(item('f', 'figue', s.state.x, s.state.z + 1.2));
    run(20);
    run(1, 0, 0, BTN_INTERACT);
    run(5);
    expect(countOf(s.inventory, 'figue')).toBe(1);
    expect(s.inventory.pockets[0]?.item).toBe('figue');
    expect(s.props.liveIds()).not.toContain('f');
    s.props.add(item('b', 'baton', s.state.x, s.state.z + 1.2));
    run(20);
    run(1, 0, 0, BTN_INTERACT);
    run(5);
    expect(s.inventory.bag).toEqual([{ item: 'baton', count: 1 }]);
    s.dispose();
  });

  it('sortir, poser, ranger, déplacer entre poches et sac', () => {
    const { s, run } = setup();
    store(s.inventory, { item: 'chiffon', count: 3 });
    expect(s.act({ type: 'sortir', from: { zone: 'poche', index: 0 } }).ok).toBe(true);
    run(10);
    expect(s.props.held).not.toBeNull();
    expect(countOf(s.inventory, 'chiffon')).toBe(2);
    expect(s.act({ type: 'sortir', from: { zone: 'poche', index: 0 } })).toEqual({ ok: false, message: 'Vos mains sont déjà prises.' });
    expect(s.act({ type: 'ranger' }).ok).toBe(true);
    expect(countOf(s.inventory, 'chiffon')).toBe(3);
    expect(s.act({ type: 'deplacer', from: { zone: 'poche', index: 0 }, to: 'sac' }).ok).toBe(true);
    expect(s.inventory.bag).toEqual([{ item: 'chiffon', count: 3 }]);
    const before = s.props.liveIds().length;
    expect(s.act({ type: 'poser', from: { zone: 'sac', index: 0 } }).ok).toBe(true);
    run(30);
    expect(s.props.liveIds().length).toBe(before + 1);
    expect(countOf(s.inventory, 'chiffon')).toBe(2);
    s.dispose();
  });

  it('poches 1 à 4 : prendre en main, puis y ranger l’objet tenu', () => {
    const { s, run } = setup();
    store(s.inventory, { item: 'aloes', count: 1 });
    expect(s.act({ type: 'poche', index: 0 }).ok).toBe(true);
    run(5);
    expect(s.inventory.pockets[0]).toBeNull();
    expect(s.act({ type: 'poche', index: 2 }).ok).toBe(true);
    expect(s.inventory.pockets[2]?.item).toBe('aloes');
    expect(s.props.held).toBeNull();
    s.dispose();
  });

  it('déchirer sa chemise donne 4 chiffons', () => {
    const { s } = setup();
    const r = s.act({ type: 'dechirer', part: 'haut' });
    expect(r.ok).toBe(true);
    expect(countOf(s.inventory, 'chiffon')).toBe(4);
    expect(s.act({ type: 'dechirer', part: 'haut' }).ok).toBe(false);
    s.dispose();
  });

  it('un sac chargé ralentit ; au-delà de 25 kg, plus de course', () => {
    const light = setup();
    light.run(120, 0, 1, BTN_SPRINT, 0, 0);
    const vLight = Math.hypot(light.s.state.vx, light.s.state.vz);
    const heavy = setup();
    for (let i = 0; i < 4; i++) store(heavy.s.inventory, { item: 'pierre', count: 1, mass: 7, radius: 0.09 });
    heavy.run(120, 0, 1, BTN_SPRINT, 0, 0);
    const vHeavy = Math.hypot(heavy.s.state.vx, heavy.s.state.vz);
    expect(vLight).toBeGreaterThan(MOVE.runSpeed * 0.9);
    expect(vHeavy).toBeLessThan(MOVE.walkSpeed);
    light.s.dispose();
    heavy.s.dispose();
  });
});

describe('manger et se soigner', () => {
  it('manger prend un geste de 1,5 s ; bouger l’interrompt ; la santé remonte ensuite', () => {
    const { s, run } = setup();
    s.vitals.health = 50;
    store(s.inventory, { item: 'figue', count: 2 });
    expect(s.act({ type: 'manger', from: { zone: 'poche', index: 0 } }).ok).toBe(true);
    run(30);
    run(1, 0, 1);
    expect(s.gesture).toBeNull();
    expect(countOf(s.inventory, 'figue')).toBe(2);
    run(10);
    expect(s.act({ type: 'manger', from: { zone: 'poche', index: 0 } }).ok).toBe(true);
    run(100);
    expect(countOf(s.inventory, 'figue')).toBe(1);
    run(60 * 13);
    expect(s.vitals.health).toBeGreaterThan(54.5);
    s.dispose();
  });

  it('bander une coupure grave arrête le saignement (chiffon consommé)', () => {
    const { s, run } = setup();
    const cut = addInjury(s.vitals, 'bras_g', 'coupure', true);
    expect(s.act({ type: 'soigner', injury: cut.id, treatment: 'bander' })).toEqual({ ok: false, message: 'Il vous faut un chiffon.' });
    s.act({ type: 'dechirer', part: 'haut' });
    expect(s.act({ type: 'soigner', injury: cut.id, treatment: 'bander' }).ok).toBe(true);
    run(60 * 7);
    expect(cut.bandaged).toBe(true);
    expect(countOf(s.inventory, 'chiffon')).toBe(3);
    const h = s.vitals.health;
    run(120);
    expect(s.vitals.health).toBeCloseTo(h, 3);
    s.dispose();
  });

  it('jambe cassée : vitesse limitée ; attelle avec 2 bâtons et 2 chiffons tenus ou rangés', () => {
    const { s, run } = setup();
    const f = addInjury(s.vitals, 'jambe_d', 'fracture');
    run(120, 0, 1, BTN_SPRINT, 0, 0);
    expect(Math.hypot(s.state.vx, s.state.vz)).toBeLessThan(0.85);
    run(30);
    s.act({ type: 'dechirer', part: 'haut' });
    expect(s.act({ type: 'soigner', injury: f.id, treatment: 'attelle' }).message).toBe('Il vous faut 2 bâtons.');
    store(s.inventory, { item: 'baton', count: 1 });
    s.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    store(s.inventory, { item: 'baton', count: 1 });
    run(5);
    // Un bâton en main, un dans le sac : « Utiliser » pose l'attelle.
    expect(s.act({ type: 'utiliser' }).ok).toBe(true);
    run(60 * 9);
    expect(f.splinted).toBe(true);
    expect(s.available('baton')).toBe(0);
    expect(countOf(s.inventory, 'chiffon')).toBe(2);
    expect(s.props.held).toBeNull();
    run(120, 0, 1, BTN_SPRINT, 0, 0);
    expect(Math.hypot(s.state.vx, s.state.vz)).toBeGreaterThan(1);
    s.dispose();
  });

  it('se reposer et dormir : il faut avoir sommeil ; bouger réveille', () => {
    const { s, run } = setup();
    s.vitals.fatigue = 5;
    expect(s.act({ type: 'dormir' }).message).toBe('Vous n’avez pas sommeil.');
    expect(s.act({ type: 'reposer' }).ok).toBe(true);
    expect(s.vitals.posture).toBe('assis');
    run(60, 0, 1);
    expect(s.vitals.posture).toBe('debout');
    s.vitals.fatigue = 60;
    expect(s.act({ type: 'dormir' }).ok).toBe(true);
    run(60 * 61);
    expect(s.respawnPoint).not.toBeNull();
    run(1, 1, 0);
    expect(s.vitals.posture).toBe('debout');
    s.dispose();
  });
});

describe('mort, corps et réapparition', () => {
  it('hémorragie : état critique, mort, corps avec l’équipement, réapparition au point d’arrivée sans sac', () => {
    const { s, run, events } = setup();
    store(s.inventory, { item: 'figue', count: 3 });
    store(s.inventory, { item: 'baton', count: 2 });
    addInjury(s.vitals, 'torse', 'coupure', true);
    s.vitals.health = 2;
    run(60 * 5);
    expect(s.vitals.state).toBe('critique');
    expect(s.act({ type: 'manger', from: { zone: 'poche', index: 0 } }).ok).toBe(false);
    run(60 * 90);
    expect(events.some((e) => e.type === 'mort' && e.cause === 'hemorragie')).toBe(true);
    const body = s.lastBody!;
    expect(body).not.toBeNull();
    const c = s.props.container(body.id)!;
    expect(c.pockets[0]).toEqual({ item: 'figue', count: 3 });
    expect(c.bag).toEqual([{ item: 'baton', count: 2 }]);
    run(60 * (RESPAWN_DELAY + 1));
    const rep = events.find((e) => e.type === 'reapparition');
    expect(rep && rep.type === 'reapparition' && rep.place).toBe('arrivee');
    expect(s.vitals.state).toBe('eveille');
    expect(s.vitals.health).toBe(70);
    expect(s.inventory.bag).toBeNull();
    expect(Math.hypot(s.state.x - s.spawn.x, s.state.z - s.spawn.z)).toBeLessThan(1);
    // Le corps est toujours là, au même endroit, avec son contenu.
    expect(s.props.defOf(body.id)?.kind).toBe('corps');
    s.dispose();
  });

  it('on réapparaît là où l’on a dormi ; on se souvient de la direction du corps ; on le fouille', () => {
    const { s, run, events } = setup();
    s.vitals.fatigue = 60;
    s.act({ type: 'dormir' });
    run(60 * 61);
    run(1, 0, 1);
    const sleptAt = { ...s.respawnPoint! };
    // Marcher 40 m vers le nord, puis mourir.
    run(60 * 24, 0, 1, 0, 0, 0);
    expect(s.state.z - sleptAt.z).toBeGreaterThan(35);
    store(s.inventory, { item: 'muhacha', count: 4 });
    s.vitals.health = 0.5;
    addInjury(s.vitals, 'jambe_g', 'coupure', true);
    run(60 * 3);
    expect(s.act({ type: 'abandonner' }).ok).toBe(true);
    expect(s.dead).toBe(true);
    run(60 * (RESPAWN_DELAY + 1));
    const rep = events.find((e) => e.type === 'reapparition');
    expect(rep?.type === 'reapparition' && rep.place).toBe('sommeil');
    expect(rep?.type === 'reapparition' && rep.body).toEqual({ distance: 100, direction: 'au nord' });
    expect(Math.hypot(s.state.x - sleptAt.x, s.state.z - sleptAt.z)).toBeLessThan(1);
    // Retour au corps et récupération.
    const b = s.lastBody!;
    s.teleport(b.x, LEVEL + 0.1, b.z - 1.2);
    run(30);
    expect(s.act({ type: 'tout_prendre', prop: b.id }).ok).toBe(true);
    expect(s.inventory.bag).not.toBeNull();
    expect(countOf(s.inventory, 'muhacha')).toBe(4);
    s.dispose();
  });

  it('un corps vidé disparaît au bout de 10 minutes ; un corps plein reste', () => {
    const { s, run } = setup();
    const full = s.props.spawnDynamic({ ...item('x', 'corps', s.state.x + 3, s.state.z), container: { bag: [{ item: 'baton', count: 1 }], pockets: [null, null, null, null] } });
    const empty = s.props.spawnDynamic({ ...item('y', 'corps', s.state.x - 3, s.state.z), container: { bag: null, pockets: [null, null, null, null] } });
    run(600);
    s.time += BODY_EMPTY_SECONDS + 1;
    run(600);
    expect(s.props.defOf(empty)).toBeNull();
    expect(s.props.defOf(full)).not.toBeNull();
    s.dispose();
  });

  it('chute de 30 m : mort sur le coup', () => {
    const { s, run, events } = setup();
    s.teleport(s.state.x, LEVEL + 30, s.state.z);
    run(60 * 4);
    expect(events.some((e) => e.type === 'mort' && e.cause === 'chute')).toBe(true);
    s.dispose();
  });

  it('rester sous l’eau : noyade', () => {
    const { s, run, events } = setup(-6);
    run(60 * 2);
    // Plonger et rester au fond.
    run(60 * 60, 0, 0, BTN_CROUCH, 0, 0);
    expect(events.some((e) => e.type === 'mort' && e.cause === 'noyade')).toBe(true);
    s.dispose();
  });
});

describe('sauvegarde', () => {
  it('le joueur, son inventaire et les objets ramassés ou posés sont repris', () => {
    const terrain = new FlatTerrain(LEVEL);
    const a = new LocalSimulation(terrain);
    for (let i = 0; i < 30; i++) a.step(cmd(0, 0, 0, 0, LOOK_DOWN));
    store(a.inventory, { item: 'chiffon', count: 2 });
    addInjury(a.vitals, 'jambe_g', 'entorse');
    a.vitals.energy = 42;
    a.act({ type: 'poser', from: { zone: 'poche', index: 0 } });
    for (let i = 0; i < 60; i++) a.step(cmd(0, 0, 0, 0, LOOK_DOWN));
    const save = JSON.parse(JSON.stringify(a.serialize()));
    a.dispose();

    const b = new LocalSimulation(terrain, { save });
    for (let i = 0; i < 30; i++) b.step(cmd(0, 0, 0, 0, LOOK_DOWN));
    expect(countOf(b.inventory, 'chiffon')).toBe(1);
    expect(b.vitals.injuries.map((i) => i.kind)).toEqual(['entorse']);
    expect(b.vitals.energy).toBeCloseTo(42, 0);
    expect(b.props.liveIds().filter((id) => b.props.defOf(id)?.kind === 'chiffon')).toHaveLength(1);
    b.dispose();
  });

  it('mort au moment de sauvegarder : la reprise se fait comme après la réapparition', () => {
    const { s, run } = setup();
    s.vitals.health = 0;
    addInjury(s.vitals, 'torse', 'coupure', true);
    run(10);
    s.act({ type: 'abandonner' });
    const save = s.serialize();
    expect(save.player.vitals.health).toBe(70);
    expect(Math.hypot(save.player.x - s.spawn.x, save.player.z - s.spawn.z)).toBeLessThan(1);
    s.dispose();
  });
});

describe('divers', () => {
  it('directions cardinales (+z nord, +x est)', () => {
    expect(compassDirection(0, 10)).toBe('au nord');
    expect(compassDirection(10, 0)).toBe("à l'est");
    expect(compassDirection(-7, -7)).toBe('au sud-ouest');
  });

  it('les actions reçues sont validées', () => {
    expect(readAction({ type: 'poche', index: 2 })).toEqual({ type: 'poche', index: 2 });
    expect(readAction({ type: 'poche', index: 9 })).toBeNull();
    expect(readAction({ type: 'soigner', injury: 3, treatment: 'amputer' })).toBeNull();
    expect(readAction({ type: 'manger', from: { zone: 'main' } })).toEqual({ type: 'manger', from: { zone: 'main' } });
    expect(readAction({ type: 'sortir', from: { zone: 'main' } })).toBeNull();
    expect(readAction({ type: 'pirater' })).toBeNull();
  });
});
