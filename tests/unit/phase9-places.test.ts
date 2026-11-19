// Phase 9 : lieux abandonnés — emplacement, création par l'hôte, bâtiments, objets, portes à clé, documents.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLLAPSE_AT, PLANS, pieceTransform } from '../../src/shared/building';
import { readContainer } from '../../src/shared/inventory';
import { DOCS, DOC_IDS, KEYS } from '../../src/shared/lore';
import { initPhysics } from '../../src/shared/physics';
import { PLACE_KINDS, type PlaceSite, findPlaces, placeLayout } from '../../src/shared/places';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { Terrain } from '../../src/shared/terrain';
import { cmd } from './helpers';

const SEED = 20261112;
let sim: LocalSimulation;

beforeAll(async () => {
  await initPhysics();
  sim = await LocalSimulation.create(SEED, { fauna: false });
});

afterAll(() => sim.dispose());

function site(kind: PlaceSite['kind']): PlaceSite {
  return sim.placeSites().find((p) => p.kind === kind)!;
}

/** Amène le joueur à `d` mètres du lieu et laisse l'hôte le créer. */
function approach(s: LocalSimulation, p: PlaceSite, d = 120): void {
  s.teleport(p.x + d, s.terrain.heightAt(p.x + d, p.z) + 0.5, p.z);
  for (let i = 0; i < 70; i++) s.step(cmd(0, 0));
}

describe('emplacement des lieux', () => {
  it('identique pour tous ; chaque genre de lieu existe, à bonne distance des autres, hors de l’eau', () => {
    const a = findPlaces(new Terrain(SEED));
    const b = findPlaces(new Terrain(SEED));
    expect(b).toEqual(a);
    for (const k of PLACE_KINDS) expect(a.some((p) => p.kind === k)).toBe(true);
    expect(a.filter((p) => p.kind === 'ferme').length).toBe(4);
    expect(a.filter((p) => p.kind === 'ruines').length).toBe(2);
    const t = new Terrain(SEED);
    for (const p of a) {
      for (const q of a) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(900);
      expect(t.heightAt(p.x, p.z)).toBeGreaterThan(t.waterLevelAt(p.x, p.z) + 0.2);
    }
    // D'autres mondes ont aussi tous leurs lieux.
    for (const seed of [7, 424242]) {
      const other = findPlaces(new Terrain(seed));
      for (const k of PLACE_KINDS) expect(other.some((p) => p.kind === k)).toBe(true);
    }
  });

  it('tous les documents de l’histoire sont placés une fois, et chaque clé a sa porte', () => {
    const sites = findPlaces(new Terrain(SEED));
    const docs: string[] = [];
    const keys: string[] = [];
    const locks: string[] = [];
    for (const p of sites) {
      const l = placeLayout(p, SEED);
      for (const it of l.loot) {
        if (it.kind === 'document' && it.tag) docs.push(it.tag);
        for (const st of it.chest ?? []) {
          if (st.item === 'document' && st.tag) docs.push(st.tag);
          if (st.item === 'cle' && st.tag) keys.push(st.tag);
        }
      }
      for (const s of l.structs) for (const pc of s.pieces) if (pc.lock) locks.push(pc.lock);
    }
    // Les peintures rupestres sont dans les grottes, pas dans les lieux.
    expect([...docs].sort()).toEqual(DOC_IDS.filter((id) => DOCS[id]!.place !== 'grotte').sort());
    expect([...keys].sort()).toEqual(Object.keys(KEYS).sort());
    expect([...locks].sort()).toEqual(Object.keys(KEYS).sort());
    for (const id of DOC_IDS) expect(DOCS[id]!.text.join(' ').length).toBeGreaterThan(40);
  });
});

describe('création des lieux par l’hôte', () => {
  it('un lieu apparaît quand un joueur approche, une seule fois, avec des bâtiments qui tiennent debout', () => {
    const p = site('mission');
    expect(sim.placesDone.has(p.id)).toBe(false);
    approach(sim, p);
    expect(sim.placesDone.has(p.id)).toBe(true);
    const near = sim.build.structures.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < 30);
    expect(near.length).toBeGreaterThan(0);
    const pieces = near.flatMap((s) => s.pieces);
    expect(pieces.length).toBeGreaterThan(30);
    for (const pc of pieces) expect(pc.support).toBeGreaterThanOrEqual(COLLAPSE_AT);
    // Encore quelques pas : rien ne s'effondre, rien n'est créé en double.
    const count = sim.build.structures.length;
    for (let i = 0; i < 200; i++) sim.step(cmd(0, 0));
    expect(sim.build.structures.length).toBe(count);
    expect(near.flatMap((s) => s.pieces).length).toBe(pieces.length);
  });

  it('les lieux de chaque genre se construisent sans pièce instable', () => {
    for (const p of sim.placeSites()) {
      if (sim.placesDone.has(p.id)) continue;
      sim.generatePlace(p);
    }
    for (const s of sim.build.structures) for (const pc of s.pieces) expect(pc.support, `${s.id} ${pc.plan}`).toBeGreaterThanOrEqual(COLLAPSE_AT);
    // La station est sur pilotis.
    const st = site('station');
    const floors = sim.build.structures.filter((s) => Math.hypot(s.x - st.x, s.z - st.z) < 20).flatMap((s) => s.pieces.filter((pc) => PLANS[pc.plan].piece === 'sol'));
    expect(floors.length).toBeGreaterThan(0);
    expect(floors.every((pc) => pc.stilts === 4)).toBe(true);
  });

  it('la sacristie est fermée à clé : sans la clé, rien ; avec, elle s’ouvre et le reste', () => {
    const s = sim.build.structures.find((x) => x.pieces.some((pc) => pc.lock === 'sacristie'))!;
    expect(s).toBeDefined();
    const door = s.pieces.find((pc) => pc.lock === 'sacristie')!;
    const t = pieceTransform(s, door.slot);
    // Devant la porte, côté chapelle (ouest de la porte, dans le repère de la construction).
    const x = t.x - Math.cos(s.yaw) * 1.2;
    const z = t.z + Math.sin(s.yaw) * 1.2;
    sim.teleport(x, t.y + 0.3, z);
    for (let i = 0; i < 20; i++) sim.step(cmd(0, 0));
    const r1 = sim.act({ type: 'piece', s: s.id, p: door.id, op: 'porte' });
    expect(r1.ok).toBe(false);
    expect(r1.message).toContain('fermée à clé');
    expect(door.open).toBe(false);
    // La sauvegarde garde la serrure.
    const saved = JSON.parse(JSON.stringify(sim.serialize())) as { build: { structures: Array<{ id: string; pieces: Array<{ id: number; lock?: string }> }> } };
    expect(saved.build.structures.find((x) => x.id === s.id)!.pieces.find((pc) => pc.id === door.id)!.lock).toBe('sacristie');
    // Avec la clé (en poche).
    sim.inventory.pockets[3] = { item: 'cle', count: 1, tag: 'sacristie' };
    const r2 = sim.act({ type: 'piece', s: s.id, p: door.id, op: 'porte' });
    expect(r2.ok).toBe(true);
    expect(door.open).toBe(true);
    expect(door.lock).toBeUndefined();
  });

  it('lire un document le recopie dans le carnet (une fois) et l’ouvre à l’écran', () => {
    sim.takeEvents();
    sim.inventory.pockets[2] = { item: 'document', count: 1, tag: 'm_conte' };
    const r = sim.act({ type: 'lire', from: { zone: 'poche', index: 2 } });
    expect(r.ok).toBe(true);
    expect(sim.knowledge.docs).toContain('m_conte');
    const ev: SimEvent[] = sim.takeEvents();
    expect(ev.some((e) => e.type === 'lire' && e.doc === 'm_conte')).toBe(true);
    sim.act({ type: 'lire', from: { zone: 'poche', index: 2 } });
    expect(sim.knowledge.docs.filter((d) => d === 'm_conte').length).toBe(1);
    // Un objet qui n'est pas un document ne se lit pas.
    sim.inventory.pockets[1] = { item: 'chiffon', count: 1 };
    expect(sim.act({ type: 'lire', from: { zone: 'poche', index: 1 } }).ok).toBe(false);
  });

  it('les lieux créés, les documents lus et les étiquettes des objets sont enregistrés', async () => {
    const save = JSON.parse(JSON.stringify(sim.serialize())) as unknown;
    const again = await LocalSimulation.create(SEED, { fauna: false, save });
    for (const id of sim.placesDone) expect(again.placesDone.has(id)).toBe(true);
    expect(again.knowledge.docs).toContain('m_conte');
    expect(again.build.structures.length).toBe(sim.build.structures.length);
    // Rien n'est recréé en double à la reprise.
    approach(again, site('mission'));
    expect(again.build.structures.length).toBe(sim.build.structures.length);
    again.dispose();
    // Étiquette d'un document ou d'une clé : relue telle quelle, refusée si elle est invalide.
    const c = readContainer({ pockets: [{ item: 'cle', count: 1, tag: 'labo' }, { item: 'document', count: 1, tag: 'x<script>' }] });
    expect(c.pockets[0]!.tag).toBe('labo');
    expect(c.pockets[1]!.tag).toBeUndefined();
  });

  it('les constructions des joueurs passent avant : aucune pièce d’un lieu ne les traverse', async () => {
    const s2 = await LocalSimulation.create(SEED, { fauna: false });
    const p = s2.placeSites().find((x) => x.kind === 'ferme')!;
    // Un mur de joueur au milieu de la future maison.
    const mine = s2.build.addPrebuilt({ x: p.x - 1, y: p.y, z: p.z - 1, yaw: p.yaw }, [{ plan: 'mur_pierre', slot: { t: 'e', d: 'x', i: 0, j: 0, k: 0 } }])!;
    const t0 = pieceTransform(mine, mine.pieces[0]!.slot);
    s2.generatePlace(p);
    for (const s of s2.build.structures) {
      if (s === mine) continue;
      for (const pc of s.pieces) {
        const t = pieceTransform(s, pc.slot);
        expect(Math.abs(t.x - t0.x) < 1.8 && Math.abs(t.z - t0.z) < 1.8 && Math.abs(t.y - t0.y) < 2.4).toBe(false);
      }
    }
    expect(s2.build.structures.includes(mine)).toBe(true);
    s2.dispose();
  });

  it('un lieu n’apparaît jamais sous les pieds d’un joueur (il attend qu’il s’éloigne un peu)', async () => {
    const s3 = await LocalSimulation.create(SEED, { fauna: false });
    const p = s3.placeSites().find((x) => x.kind === 'gare')!;
    s3.teleport(p.x + 5, s3.terrain.heightAt(p.x + 5, p.z) + 0.5, p.z);
    for (let i = 0; i < 130; i++) s3.step(cmd(0, 0));
    expect(s3.placesDone.has(p.id)).toBe(false);
    approach(s3, p, 150);
    expect(s3.placesDone.has(p.id)).toBe(true);
    s3.dispose();
  });
});
