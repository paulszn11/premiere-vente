// Phase 8 : réplication entre le serveur de l'hôte et la copie du monde d'un joueur distant.
// Les messages passent par JSON (comme sur le réseau), avec une latence simulée.

import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerAction } from '../../src/shared/actions';
import { countOf } from '../../src/shared/inventory';
import type { InputCmd } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { type HostMessage, type NetPlayerView, Replicator, applyHostMessage } from '../../src/shared/replication';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;

function pair(latencyTicks = 6) {
  const host = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: 'hote', playerName: 'Hôte' });
  for (let i = 0; i < 20; i++) host.step(cmd(0, 0));
  const start = { x: host.state.x + 8, y: LEVEL, z: host.state.z };
  host.addPlayer('b', 'Béa', 7, { ...start });
  const rep = new Replicator(host, 'b');
  const toHost: Array<{ at: number; kind: 'in' | 'act'; data: unknown }> = [];
  const toClient: Array<{ at: number; msg: HostMessage }> = [];
  let now = 0;
  const client = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: 'b', start });
  client.replica = { act: (a: PlayerAction) => toHost.push({ at: now + latencyTicks, kind: 'act', data: JSON.parse(JSON.stringify(a)) }) };
  let players: NetPlayerView[] = [];
  const results: Array<{ ok: boolean; message?: string }> = [];
  const tick = (c: InputCmd, hostCmd: InputCmd = cmd(0, 0)) => {
    now++;
    client.step(c);
    toHost.push({ at: now + latencyTicks, kind: 'in', data: JSON.parse(JSON.stringify(c)) });
    // Le serveur reçoit ce qui est arrivé, avance, puis envoie.
    while (toHost.length && toHost[0]!.at <= now) {
      const m = toHost.shift()!;
      if (m.kind === 'in') host.setInput('b', m.data as InputCmd);
      else results.push(host.actAs('b', m.data as PlayerAction));
    }
    host.step(hostCmd);
    for (const msg of rep.collect(host.tick)) toClient.push({ at: now + latencyTicks, msg: JSON.parse(JSON.stringify(msg)) as HostMessage });
    while (toClient.length && toClient[0]!.at <= now) {
      const r = applyHostMessage(client, toClient.shift()!.msg);
      if (r.players) players = r.players;
    }
  };
  const run = (n: number, wx = 0, wz = 0, buttons = 0, yaw = 0, pitch = 0) => {
    for (let i = 0; i < n; i++) tick(cmd(wx, wz, buttons, yaw, pitch));
  };
  return { host, client, run, tick, players: () => players, results, slot: () => host.players.get('b')! };
}

describe('réplication hôte → joueur distant', () => {
  it('les pas prédits par le joueur distant restent d’accord avec l’hôte (latence de 100 ms)', () => {
    const { client, run, slot } = pair(6);
    run(30);
    run(120, 0, 1);
    run(60, 0.7, -0.7, 0, 0.8);
    run(60);
    const b = slot().state;
    expect(Math.hypot(client.state.x - b.x, client.state.z - b.z)).toBeLessThan(0.05);
    // Il a bien avancé, et la prédiction n'a presque jamais dû être corrigée.
    expect(Math.hypot(b.x - client.spawn.x, b.z - client.spawn.z)).toBeGreaterThan(4);
    expect(client.corrections).toBeLessThan(5);
  });

  it('le joueur distant voit l’hôte bouger', () => {
    const { host, tick, players } = pair(3);
    const x0 = host.state.x;
    for (let i = 0; i < 90; i++) tick(cmd(0, 0), cmd(1, 0));
    for (let i = 0; i < 30; i++) tick(cmd(0, 0));
    const h = players().find((p) => p.id === 'hote');
    expect(h).toBeDefined();
    expect(h!.name).toBe('Hôte');
    expect(h!.x).toBeCloseTo(host.state.x, 1);
    expect(host.state.x - x0).toBeGreaterThan(2);
  });

  it('les objets apparaissent, bougent et disparaissent chez le joueur distant', () => {
    const { host, client, run, slot } = pair(3);
    run(20);
    const b = slot().state;
    const id = host.props.spawnDynamic({ kind: 'pierre', x: b.x + 1, y: LEVEL + 2, z: b.z, rot: 0, radius: 0.1, length: 0 });
    run(90);
    const hp = host.props.position(id)!;
    const cp = client.props.position(id);
    expect(cp).not.toBeNull();
    expect(Math.hypot(cp!.x - hp.x, cp!.y - hp.y, cp!.z - hp.z)).toBeLessThan(0.05);
    host.props.remove(id);
    run(20);
    expect(client.props.livePose(id)).toBeNull();
  });

  it('le sac et le corps viennent de l’hôte ; une action du joueur distant passe par l’hôte', () => {
    const { client, run, slot, results } = pair(3);
    run(10);
    slot().inventory.pockets[0] = { item: 'chiffon', count: 1 };
    run(15);
    expect(countOf(client.inventory, 'chiffon')).toBe(1);
    // Sortir le chiffon : l'action part chez l'hôte, qui l'applique ; la copie le voit en main.
    client.act({ type: 'sortir', from: { zone: 'poche', index: 0 } });
    run(30);
    expect(results.at(-1)?.ok).toBe(true);
    expect(slot().held).not.toBeNull();
    expect(client.props.held?.id).toBe(slot().held!.id);
    expect(countOf(client.inventory, 'chiffon')).toBe(0);
  });

  it('les événements du joueur distant lui parviennent (chute)', () => {
    const { host, client, run, slot } = pair(3);
    run(10);
    const b = slot();
    host.withPlayer(b, () => host.teleport(b.state.x, LEVEL + 7, b.state.z));
    run(90);
    const ev: SimEvent[] = client.takeEvents();
    expect(ev.some((e) => e.type === 'chute')).toBe(true);
    // Elle est restée chez Béa : le joueur local de l'hôte n'a pas chuté.
    expect(host.takeEvents().some((e) => e.type === 'chute')).toBe(false);
  });

  it('les constructions et les véhicules de l’hôte arrivent chez le joueur distant', () => {
    const { host, client, run, slot } = pair(3);
    run(10);
    const b = slot().state;
    const vid = host.spawnVehicle('chariot_bras', b.x + 3, b.z + 3, 0, { parts: 'toutes' });
    host.build.version++;
    run(40);
    const v = client.vehicle(vid);
    expect(v).toBeDefined();
    const hv = host.vehicle(vid)!;
    expect(Math.hypot(v!.x - hv.x, v!.z - hv.z)).toBeLessThan(0.05);
    expect(client.build.version).toBe(host.build.version);
  });
});
