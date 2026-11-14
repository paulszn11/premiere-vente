// Phase 8 : serveur de l'hôte et joueurs distants, reliés en mémoire (même code que dans le navigateur).

import { beforeAll, describe, expect, it } from 'vitest';
import { RemoteClient } from '../../src/client/net/remote-client';
import { HostServer } from '../../src/server/host';
import { type Link, memoryLinkPair } from '../../src/shared/link';
import { type Identity, deriveWorldKeys, identityVerifier, newIdentity, readRecoveryKey, recoveryKey } from '../../src/shared/net-crypto';
import { DEFAULT_RULES, type Member } from '../../src/shared/permissions';
import { initPhysics } from '../../src/shared/physics';
import { LocalSimulation } from '../../src/shared/simulation';
import { generateWorldCode } from '../../src/shared/worldcode';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;
const tick = () => new Promise((r) => setTimeout(r, 0));

async function world(rules = { ...DEFAULT_RULES }) {
  const code = generateWorldCode();
  const keys = (await deriveWorldKeys(code))!;
  const sim = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: 'hote', playerName: 'Hôte' });
  for (let i = 0; i < 10; i++) sim.step(cmd(0, 0));
  const members = new Map<string, Member>([['hote', { id: 'hote', name: 'Hôte', role: 'hote', overrides: {}, verifier: '0'.repeat(64), lastSeen: 0 }]]);
  let clock = 1_000_000;
  const host = new HostServer({ sim, keys, world: { name: 'Test', seed: 1 }, members, rules, now: () => clock });
  const clients: Array<{ client: RemoteClient; replica: LocalSimulation | null }> = [];
  const step = async (n = 1, hostCmd = cmd(0, 0)) => {
    for (let i = 0; i < n; i++) {
      host.beforeStep();
      sim.step(hostCmd);
      host.afterStep();
      clock += 1000 / 60;
      for (const c of clients) {
        if (!c.replica || !c.client.connected) continue;
        const k = cmd(0, 0);
        c.replica.step(k);
        c.client.sendInput(k);
      }
      await tick();
    }
  };
  const join = async (code2: string, idn: Identity = newIdentity(), name = 'Béa', source = 'pair') => {
    const [a, b] = memoryLinkPair('hote', source);
    const client = new RemoteClient(a, idn, name, (await deriveWorldKeys(code2))!);
    const entry = { client, replica: null as LocalSimulation | null, link: a as Link };
    const p = client.connect(5000);
    host.attach(b);
    // Le serveur doit avancer pendant la poignée de main (chiffrement asynchrone).
    let welcome;
    let error;
    p.then((w) => (welcome = w)).catch((e) => (error = e));
    for (let i = 0; i < 200 && !welcome && !error; i++) await tick();
    if (error) throw error;
    const w = welcome!;
    const replica = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: false, playerId: w.you.id, start: w.start });
    client.attach(replica);
    entry.replica = replica;
    clients.push(entry);
    return { client, replica, welcome: w, identity: idn, link: a };
  };
  return { code, sim, host, members, step, join, advance: (ms: number) => (clock += ms) };
}

describe('serveur de l’hôte', () => {
  it('un joueur rejoint avec le code ; l’hôte retient son identité (empreinte seulement)', async () => {
    const w = await world();
    const idn = newIdentity();
    const j = await w.join(w.code, idn);
    expect(j.welcome.you.role).toBe('membre');
    expect(w.sim.players.has(idn.id)).toBe(true);
    const m = w.members.get(idn.id)!;
    expect(m.verifier).toBe(await identityVerifier(idn.secret));
    expect(JSON.stringify(m)).not.toContain(idn.secret);
    expect(w.host.roster().find((r) => r.id === idn.id)?.online).toBe(true);
  });

  it('un mauvais code est refusé, puis la source est bloquée après 5 essais', async () => {
    const w = await world();
    const wrong = generateWorldCode();
    for (let k = 0; k < 5; k++) await expect(w.join(wrong, newIdentity(), 'X', 'intrus')).rejects.toMatchObject({ reason: 'bad_code' });
    await expect(w.join(wrong, newIdentity(), 'X', 'intrus')).rejects.toMatchObject({ reason: 'rate_limited' });
    // Une autre source n'est pas bloquée.
    await expect(w.join(w.code, newIdentity(), 'Y', 'autre')).resolves.toBeDefined();
  });

  it('on ne peut pas prendre l’identité d’un autre joueur ; la clé de récupération, si', async () => {
    const w = await world();
    const idn = newIdentity();
    const j = await w.join(w.code, idn);
    j.client.leave();
    await w.step(10);
    // Même identifiant, autre clé : refusé.
    await expect(w.join(w.code, { id: idn.id, secret: newIdentity().secret }, 'Imposteur', 'p2')).rejects.toMatchObject({ reason: 'identity' });
    // La clé de récupération recopiée sur un autre appareil redonne l'identité.
    const copy = readRecoveryKey(recoveryKey(idn).toLowerCase())!;
    expect(copy).toEqual(idn);
    await expect(w.join(w.code, copy, 'Béa', 'p3')).resolves.toBeDefined();
  });

  it('le joueur joue à distance : ses pas et ses actions passent par l’hôte, qui fait foi', async () => {
    const w = await world();
    const j = await w.join(w.code);
    await w.step(30);
    const slot = w.sim.players.get(j.welcome.you.id)!;
    // Il avance : sa copie prédit, l'hôte applique les mêmes commandes.
    for (let i = 0; i < 90; i++) {
      const k = cmd(0, 1);
      j.replica.step(k);
      j.client.sendInput(k);
      w.host.beforeStep();
      w.sim.step(cmd(0, 0));
      w.host.afterStep();
      await tick();
    }
    j.client.flush();
    await w.step(40);
    expect(Math.hypot(slot.state.x - j.welcome.start.x, slot.state.z - j.welcome.start.z)).toBeGreaterThan(2);
    expect(Math.hypot(j.replica.state.x - slot.state.x, j.replica.state.z - slot.state.z)).toBeLessThan(0.1);
    // Une action : le chiffon en poche passe en main (chez l'hôte, puis dans la copie).
    slot.inventory.pockets[0] = { item: 'chiffon', count: 1 };
    await w.step(10);
    j.replica.act({ type: 'sortir', from: { zone: 'poche', index: 0 } });
    await w.step(20);
    expect(slot.held).not.toBeNull();
    expect(j.replica.props.held?.id).toBe(slot.held!.id);
    // Il ne voit pas l'hôte, à plusieurs kilomètres (aucune carte des joueurs)…
    expect(j.client.players.some((p) => p.id === 'hote')).toBe(false);
    // … mais le voit quand il s'approche.
    w.sim.teleport(slot.state.x + 10, LEVEL + 0.1, slot.state.z);
    await w.step(20);
    expect(j.client.players.some((p) => p.id === 'hote')).toBe(true);
  });

  it('un invité ne peut pas construire : l’hôte refuse et le dit ; promu membre, il peut', async () => {
    const w = await world({ ...DEFAULT_RULES, defaultRole: 'invite' });
    const j = await w.join(w.code);
    await w.step(10);
    const messages: string[] = [];
    j.client.onResult = (_ok, m) => m && messages.push(m);
    const s = j.replica.state;
    j.replica.act({ type: 'planifier', plan: 'coffre', aim: { x: s.x, y: LEVEL, z: s.z + 2 }, turn: 0, on: null });
    await w.step(10);
    expect(messages.some((m) => /droit de construire/.test(m))).toBe(true);
    expect(w.sim.build.sites.length).toBe(0);
    w.host.setRole(j.welcome.you.id, 'membre');
    await w.step(5);
    expect(j.client.role).toBe('membre');
    expect(j.client.perms?.construire).toBe(true);
    j.replica.act({ type: 'planifier', plan: 'coffre', aim: { x: s.x, y: LEVEL, z: s.z + 2 }, turn: 0, on: null });
    await w.step(10);
    expect(w.sim.build.sites.at(-1)?.owner).toBe(j.welcome.you.id);
    // Le chantier apparaît chez lui.
    await w.step(35);
    expect(j.replica.build.sites.length).toBe(1);
  });

  it('déconnecté, le personnage reste endormi un moment puis quitte le monde ; il revient au même endroit', async () => {
    const w = await world({ ...DEFAULT_RULES, awaySeconds: 60 });
    const idn = newIdentity();
    const j = await w.join(w.code, idn);
    await w.step(20);
    const pos = { x: w.sim.players.get(idn.id)!.state.x, z: w.sim.players.get(idn.id)!.state.z };
    j.link.close();
    await w.step(5);
    const slot = w.sim.players.get(idn.id);
    expect(slot?.away).toBe(true);
    // Une minute plus tard, il quitte le monde (gardé parmi les absents).
    w.advance(61_000);
    await w.step(31);
    expect(w.sim.players.has(idn.id)).toBe(false);
    expect(w.sim.absent.has(idn.id)).toBe(true);
    // Il revient : même endroit.
    const j2 = await w.join(w.code, idn, 'Béa', 'p2');
    expect(Math.hypot(j2.welcome.start.x - pos.x, j2.welcome.start.z - pos.z)).toBeLessThan(0.5);
  });

  it('l’hôte peut retirer un joueur ; quand il ferme son monde, tout le monde est prévenu', async () => {
    const w = await world();
    const a = await w.join(w.code, newIdentity(), 'A', 'pa');
    const b = await w.join(w.code, newIdentity(), 'B', 'pb');
    const stops: string[] = [];
    a.client.onStop = (t) => stops.push(`a:${t}`);
    b.client.onStop = (t) => stops.push(`b:${t}`);
    w.host.kick(a.welcome.you.id);
    await w.step(5);
    expect(stops.some((t) => t.startsWith('a:') && /retiré/.test(t))).toBe(true);
    expect(w.sim.players.has(a.welcome.you.id)).toBe(false);
    w.host.close();
    await w.step(5);
    expect(stops.some((t) => t.startsWith('b:') && /fermé son monde/.test(t))).toBe(true);
  });
});
