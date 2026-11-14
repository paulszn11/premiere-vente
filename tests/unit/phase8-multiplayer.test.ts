// Phase 8 : plusieurs joueurs dans la même simulation (un emplacement par joueur, monde partagé).

import { beforeAll, describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../../src/shared/constants';
import { countOf } from '../../src/shared/inventory';
import { BTN_INTERACT } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { addInjury } from '../../src/shared/vitals';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;

/** Ce qu'on garde d'un joueur, placé à un endroit précis (sauvegarde minimale). */
function at(x: number, z: number, extra: Record<string, unknown> = {}) {
  return { x, y: LEVEL, z, ...extra };
}

function setup(fauna = false) {
  const s = new LocalSimulation(new FlatTerrain(LEVEL), { fauna, playerId: 'hote', playerName: 'Hôte' });
  s.fauna.wild = false;
  const events: SimEvent[] = [];
  const run = (n: number, wx = 0, wz = 0, buttons = 0, yaw = 0, pitch = 0) => {
    for (let i = 0; i < n; i++) {
      s.step(cmd(wx, wz, buttons, yaw, pitch));
      events.push(...s.takeEvents());
    }
  };
  run(20);
  return { s, run, events };
}

describe('emplacements des joueurs', () => {
  it('le joueur local est le premier ; un joueur rejoint à l’endroit sauvegardé', () => {
    const { s, run } = setup();
    expect(s.local.id).toBe('hote');
    expect(s.players.size).toBe(1);
    const p0 = { x: s.state.x, z: s.state.z };
    const b = s.addPlayer('b', 'Béa', 7, at(p0.x + 6, p0.z));
    run(10);
    expect(s.players.size).toBe(2);
    expect(b.state.x).toBeCloseTo(p0.x + 6, 0);
    expect(b.state.grounded).toBe(true);
    // Le joueur local n'a pas bougé et les champs exposés restent les siens.
    expect(s.playerId).toBe('hote');
    expect(Math.hypot(s.state.x - p0.x, s.state.z - p0.z)).toBeLessThan(0.05);
  });

  it('chaque joueur avance avec sa propre commande', () => {
    const { s, run } = setup();
    const p0 = { x: s.state.x, z: s.state.z };
    const b = s.addPlayer('b', 'Béa', 7, at(p0.x + 6, p0.z));
    run(5);
    const b0 = { x: b.state.x, z: b.state.z };
    for (let i = 0; i < 90; i++) {
      s.setInput('b', cmd(0, 1));
      run(1);
    }
    s.setInput('b', cmd(0, 0));
    run(20);
    expect(Math.hypot(b.state.x - b0.x, b.state.z - b0.z)).toBeGreaterThan(2);
    expect(Math.hypot(s.state.x - p0.x, s.state.z - p0.z)).toBeLessThan(0.05);
    expect(b.lastSeq).toBeGreaterThan(0);
  });

  it('un joueur loin des autres apparaît au hasard, loin d’eux', () => {
    const s = new LocalSimulation(7, { fauna: false, playerId: 'hote' });
    const b = s.addPlayer('b', 'Béa', 12345);
    expect(Math.hypot(b.state.x - s.state.x, b.state.z - s.state.z)).toBeGreaterThan(1000);
    s.dispose();
  });

  it('le sac et les actions de chacun sont séparés', () => {
    const { s, run } = setup();
    const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 6, s.state.z));
    run(5);
    const before = countOf(s.inventory, 'chiffon');
    b.inventory.pockets[0] = { item: 'chiffon', count: 1 };
    expect(s.actAs('b', { type: 'sortir', from: { zone: 'poche', index: 0 } }).ok).toBe(true);
    run(5);
    expect(b.held).not.toBeNull();
    expect(countOf(s.inventory, 'chiffon')).toBe(before);
    expect(s.props.held).toBeNull();
  });

  it('un objet tenu par un joueur ne peut pas être pris par un autre', () => {
    const { s, run } = setup();
    const p = s.state;
    // Une pierre à 1,1 m devant le joueur local (qui regarde vers +z) ; Béa à 1,1 m de la pierre, sur le côté.
    const stone = { x: p.x, z: p.z + 1.1 };
    const b = s.addPlayer('b', 'Béa', 7, at(stone.x + 1.1, stone.z));
    run(5);
    s.props.add({ id: 'pierre1', kind: 'pierre', x: stone.x, y: LEVEL + 0.1, z: stone.z, rot: 0, radius: 0.08, length: 0 });
    run(5);
    const pitch = Math.atan2(EYE_HEIGHT - 0.1, 1.1);
    const yaw = Math.atan2(stone.x - b.state.x, stone.z - b.state.z);
    s.setInput('b', cmd(0, 0, 0, yaw, pitch));
    run(3);
    s.setInput('b', cmd(0, 0, BTN_INTERACT, yaw, pitch));
    run(1);
    s.setInput('b', cmd(0, 0, 0, yaw, pitch));
    run(5);
    expect(b.held?.id).toBe('pierre1');
    // Le joueur local vise la même pierre : il ne peut ni la viser ni la prendre.
    run(3, 0, 0, 0, 0, pitch);
    expect(s.props.target(s.state, 0, pitch)?.id).not.toBe('pierre1');
    run(1, 0, 0, BTN_INTERACT, 0, pitch);
    run(5, 0, 0, 0, 0, pitch);
    expect(s.props.held).toBeNull();
    expect(b.held?.id).toBe('pierre1');
  });
});

describe('véhicules et plusieurs joueurs', () => {
  it('un joueur distant pousse un chariot ; un autre ne peut pas le prendre en même temps', () => {
    const { s, run } = setup();
    const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 6, s.state.z));
    run(10);
    const id = s.spawnVehicle('chariot_bras', b.state.x, b.state.z + 2.5, 0, { parts: 'toutes' });
    run(60);
    const v = s.vehicle(id)!;
    expect(s.actAs('b', { type: 'vehicule', v: id, op: 'pousser' }).ok).toBe(true);
    const z0 = v.z;
    for (let i = 0; i < 60 * 5; i++) {
      s.setInput('b', cmd(0, 1, 0, 0, 0));
      run(1);
    }
    expect(v.z - z0).toBeGreaterThan(3);
    // Le chariot reste avec Béa ; le joueur local, venu à côté, ne peut pas le prendre.
    s.teleport(v.x + 1.6, v.y + 0.2, v.z);
    run(10);
    const r = s.act({ type: 'vehicule', v: id, op: 'pousser' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Béa est déjà aux commandes/);
  });
});

describe('faune et plusieurs joueurs', () => {
  it('les hyènes s’en prennent au joueur blessé proche d’elles ; l’autre n’est pas touché', () => {
    const { s, run } = setup(true);
    const far = { x: s.state.x + 400, z: s.state.z };
    const b = s.addPlayer('b', 'Béa', 7, at(far.x, far.z));
    b.vitals.health = 40;
    addInjury(b.vitals, 'jambe_g', 'coupure', false);
    run(30);
    s.spawnCreatures('hyene', far.x, far.z + 40, 3);
    const bEvents: SimEvent[] = [];
    for (let k = 0; k < 60 * 60 && !bEvents.some((e) => e.type === 'attaque'); k++) {
      run(1);
      bEvents.push(...s.takePlayerEvents('b'));
    }
    expect(bEvents.some((e) => e.type === 'attaque')).toBe(true);
    expect(b.vitals.injuries.length).toBeGreaterThan(1);
    expect(bEvents.some((e) => e.type === 'message' && /hyène vous mord/.test(e.text))).toBe(true);
    // Le joueur local, loin, est indemne.
    expect(s.vitals.injuries.length).toBe(0);
  });

  it('un joueur protégé (absent dans sa base) est ignoré par les créatures', () => {
    const { s, run } = setup(true);
    const far = { x: s.state.x + 400, z: s.state.z };
    const b = s.addPlayer('b', 'Béa', 7, at(far.x, far.z));
    b.vitals.health = 40;
    addInjury(b.vitals, 'jambe_g', 'coupure', false);
    b.shielded = true;
    run(30);
    s.spawnCreatures('hyene', far.x, far.z + 40, 3);
    run(60 * 40);
    expect(s.takePlayerEvents('b').some((e) => e.type === 'attaque')).toBe(false);
  });
});

describe('sauvegarde du monde partagé', () => {
  it('un joueur qui part est gardé parmi les absents, puis retrouvé à son retour', () => {
    const { s, run } = setup();
    const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 8, s.state.z));
    b.inventory.pockets[0] = { item: 'chiffon', count: 1 };
    run(10);
    const bx = b.state.x;
    const save = s.removePlayer('b');
    expect(save).not.toBeNull();
    expect(s.players.size).toBe(1);
    expect(s.absent.has('b')).toBe(true);
    // La sauvegarde du monde contient le joueur absent…
    const data = JSON.parse(JSON.stringify(s.serialize()));
    expect(data.others.b.x).toBeCloseTo(bx, 1);
    expect(data.others.b.name).toBe('Béa');
    // … et un nouveau monde chargé depuis elle le retrouve à son retour.
    const s2 = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: 'hote', save: data });
    const b2 = s2.addPlayer('b', 'Béa', 99);
    expect(b2.state.x).toBeCloseTo(bx, 1);
    expect(countOf(b2.inventory, 'chiffon')).toBe(1);
    s2.dispose();
  });

  it('les joueurs présents sont sauvegardés avec le monde', () => {
    const { s, run } = setup();
    const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 8, s.state.z));
    run(10);
    const data = s.serialize();
    expect(data.player.name).toBe('Hôte');
    expect(data.others?.b?.x).toBeCloseTo(b.state.x, 1);
  });

  it('deux mondes identiques avancent à l’identique (déterminisme)', () => {
    const runWorld = () => {
      const { s, run } = setup();
      const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 6, s.state.z));
      for (let i = 0; i < 120; i++) {
        s.setInput('b', cmd(0.5, 1, 0, 0.3, 0));
        run(1, -0.4, 0.8);
      }
      return [s.state.x, s.state.z, b.state.x, b.state.z];
    };
    expect(runWorld()).toEqual(runWorld());
  });
});

describe('permissions et propriété', () => {
  it('ce qu’on construit nous appartient ; un invité ne construit pas ; le propriétaire règle l’accès', async () => {
    const { permitUse } = await import('../../src/shared/permissions');
    const { s, run } = setup();
    const b = s.addPlayer('b', 'Béa', 7, at(s.state.x + 5, s.state.z));
    const members = new Map([
      ['hote', { id: 'hote', name: 'Hôte', role: 'hote' as const, overrides: {}, verifier: '0'.repeat(64), lastSeen: 0 }],
      ['b', { id: 'b', name: 'Béa', role: 'invite' as const, overrides: {}, verifier: '0'.repeat(64), lastSeen: 0 }],
    ]);
    s.permit = (pid, use, owner, access) => permitUse(members, pid, use, owner, access);
    run(10);
    // Un coffre tracé par l'hôte lui appartient.
    const aim = { x: s.state.x, y: LEVEL, z: s.state.z + 2 };
    const r = s.act({ type: 'planifier', plan: 'coffre', aim, turn: 0, on: null });
    expect(r.ok).toBe(true);
    const site = s.build.sites.at(-1)!;
    expect(site.owner).toBe('hote');
    // L'invitée ne peut pas construire.
    const rb = s.actAs('b', { type: 'planifier', plan: 'coffre', aim: { x: b.state.x, y: LEVEL, z: b.state.z + 2 }, turn: 0, on: null });
    expect(rb.ok).toBe(false);
    expect(rb.message).toMatch(/droit de construire/);
    // Elle ne peut pas annuler le chantier de l'hôte ; devenue membre, elle peut construire.
    expect(s.actAs('b', { type: 'annuler_chantier', target: { kind: 'site', id: site.id } }).message).toMatch(/appartient à Hôte/);
    members.get('b')!.role = 'membre' as never;
    const rb2 = s.actAs('b', { type: 'planifier', plan: 'coffre', aim: { x: b.state.x, y: LEVEL, z: b.state.z + 2 }, turn: 0, on: null });
    expect(rb2.ok).toBe(true);
    expect(s.build.sites.at(-1)!.owner).toBe('b');
    // Un coffre privé de Béa : l'hôte peut tout, mais un autre membre ne l'ouvre pas.
    const coffre = s.props.spawnDynamic({ kind: 'coffre', x: b.state.x + 1, y: LEVEL + 0.3, z: b.state.z, rot: 0, radius: 0.4, length: 0, fixed: true, container: { pockets: [], bag: [] }, owner: 'b' });
    expect(s.actAs('b', { type: 'acces', target: { kind: 'prop', prop: coffre }, access: 'prive' }).ok).toBe(true);
    expect(s.props.defOf(coffre)!.access).toBe('prive');
    expect(permitUse(members, 'c', 'ouvrir', 'b', 'prive')).toMatch(/privé/);
    expect(permitUse(members, 'hote', 'ouvrir', 'b', 'prive')).toBeNull();
    // Le propriétaire et l'accès sont sauvegardés.
    const data = JSON.parse(JSON.stringify(s.serialize()));
    const s2 = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: 'hote', save: data });
    expect(s2.build.sites.find((x) => x.id === site.id)?.owner).toBe('hote');
    s2.dispose();
  });
});
