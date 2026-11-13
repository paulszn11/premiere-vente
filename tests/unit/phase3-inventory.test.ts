import { describe, expect, it } from 'vitest';
import {
  BAG_CAPACITY_L,
  BAG_EMPTY_MASS,
  POCKET_COUNT,
  addToBag,
  bagVolume,
  carriedMass,
  consume,
  countOf,
  makeInventory,
  readInventory,
  store,
  tearClothing,
} from '../../src/shared/inventory';
import { ITEMS, itemName } from '../../src/shared/items';
import { propsInChunk } from '../../src/shared/props';
import { Terrain } from '../../src/shared/terrain';

describe('inventaire', () => {
  it('départ : 4 poches vides, un sac vide, des vêtements intacts', () => {
    const inv = makeInventory();
    expect(inv.pockets).toHaveLength(POCKET_COUNT);
    expect(inv.pockets.every((p) => p === null)).toBe(true);
    expect(inv.bag).toEqual([]);
    expect(inv.clothes).toEqual({ haut: true, bas: true });
    expect(carriedMass(inv)).toBeCloseTo(BAG_EMPTY_MASS, 5);
  });

  it('les petits objets vont dans les poches, regroupés, puis dans le sac', () => {
    const inv = makeInventory();
    expect(store(inv, { item: 'figue', count: 25 })).toBe(0);
    // 10 figues par poche au plus : 10 + 10 + 5.
    expect(inv.pockets.map((p) => p?.count ?? 0)).toEqual([10, 10, 5, 0]);
    expect(store(inv, { item: 'chiffon', count: 4 })).toBe(0);
    expect(inv.pockets[3]).toEqual({ item: 'chiffon', count: 4 });
    // Poches pleines : le reste va dans le sac.
    expect(store(inv, { item: 'muhacha', count: 3 })).toBe(0);
    expect(inv.bag).toEqual([{ item: 'muhacha', count: 3 }]);
    expect(countOf(inv, 'figue')).toBe(25);
  });

  it('un bâton ne rentre pas dans une poche ; le sac a un volume limité (30 litres)', () => {
    const inv = makeInventory();
    const max = Math.floor(BAG_CAPACITY_L / ITEMS.baton.volume);
    expect(store(inv, { item: 'baton', count: max + 5 }, 'poche')).toBe(max + 5);
    expect(store(inv, { item: 'baton', count: max + 5 })).toBe(5);
    expect(countOf(inv, 'baton')).toBe(max);
    expect(bagVolume(inv.bag!)).toBeLessThanOrEqual(BAG_CAPACITY_L + 1e-9);
  });

  it('les pierres : jamais regroupées, et pas plus de 8 kg dans le sac', () => {
    const inv = makeInventory();
    expect(addToBag(inv, { item: 'pierre', count: 1, mass: 12, radius: 0.1 })).toBe(1);
    expect(addToBag(inv, { item: 'pierre', count: 1, mass: 3, radius: 0.07 })).toBe(0);
    expect(addToBag(inv, { item: 'pierre', count: 1, mass: 3, radius: 0.07 })).toBe(0);
    expect(inv.bag).toHaveLength(2);
    expect(carriedMass(inv)).toBeCloseTo(BAG_EMPTY_MASS + 6, 5);
  });

  it('sans sac, seules les poches servent', () => {
    const inv = makeInventory(false);
    expect(store(inv, { item: 'baton', count: 1 })).toBe(1);
    expect(store(inv, { item: 'fruit_baobab', count: 1 })).toBe(0);
    expect(carriedMass(inv)).toBeCloseTo(ITEMS.fruit_baobab.mass, 5);
  });

  it('déchirer un vêtement donne 4 chiffons, une seule fois', () => {
    const inv = makeInventory();
    expect(tearClothing(inv, 'haut')).toBe(0);
    expect(countOf(inv, 'chiffon')).toBe(4);
    expect(inv.clothes.haut).toBe(false);
    expect(tearClothing(inv, 'haut')).toBe(-1);
    expect(tearClothing(inv, 'bas')).toBe(0);
    expect(countOf(inv, 'chiffon')).toBe(8);
  });

  it('chiffons sans place : le nombre restant est signalé (posés au sol par la simulation)', () => {
    const inv = makeInventory(false);
    store(inv, { item: 'figue', count: 40 });
    expect(tearClothing(inv, 'haut')).toBe(4);
  });

  it('consommer retire des poches puis du sac', () => {
    const inv = makeInventory();
    store(inv, { item: 'chiffon', count: 6 }, 'poche');
    store(inv, { item: 'chiffon', count: 3 }, 'sac');
    expect(consume(inv, 'chiffon', 8)).toBe(8);
    expect(countOf(inv, 'chiffon')).toBe(1);
    expect(consume(inv, 'chiffon', 5)).toBe(1);
    expect(countOf(inv, 'chiffon')).toBe(0);
  });

  it('une sauvegarde abîmée ou trafiquée est nettoyée', () => {
    const inv = readInventory({
      pockets: [{ item: 'figue', count: 3 }, { item: 'lingot', count: 1 }, { item: 'chiffon', count: 999 }, null, { item: 'figue', count: 1 }],
      bag: [{ item: 'baton', count: 8 }, 'n’importe quoi', { item: 'pierre', count: 1, mass: 50 }],
      clothes: { haut: false },
    });
    expect(inv.pockets).toEqual([{ item: 'figue', count: 3 }, null, null, null]);
    expect(inv.bag).toEqual([{ item: 'baton', count: 8 }]);
    expect(inv.clothes).toEqual({ haut: false, bas: true });
    expect(readInventory(null)).toEqual({ bag: null, pockets: [null, null, null, null], clothes: { haut: true, bas: true } });
  });

  it('noms avec article et pluriel', () => {
    expect(itemName('figue')).toBe('une figue sauvage');
    expect(itemName('baton')).toBe('un bâton');
    expect(itemName('chiffon', 3)).toBe('3 chiffons');
  });
});

describe('objets du monde (phase 3)', () => {
  it('fruits au pied des arbres, bois mort et aloès : présents, déterministes, identifiants uniques', () => {
    const t1 = new Terrain(20261113);
    const t2 = new Terrain(20261113);
    const counts: Record<string, number> = {};
    const ids = new Set<string>();
    // Un carré de 16 × 16 chunks (1 km) dans le lowveld et un autre dans les collines de granit.
    for (const [ox, oz] of [
      [-10, -95],
      [-75, -58],
      [-40, 90],
    ] as const) {
      for (let cz = oz; cz < oz + 16; cz++) {
        for (let cx = ox; cx < ox + 16; cx++) {
          const a = propsInChunk(t1, cx, cz);
          expect(propsInChunk(t2, cx, cz)).toEqual(a);
          for (const p of a) {
            expect(ids.has(p.id)).toBe(false);
            ids.add(p.id);
            counts[p.kind] = (counts[p.kind] ?? 0) + 1;
            expect(p.y).toBeGreaterThan(t1.heightAt(p.x, p.z));
          }
        }
      }
    }
    expect(counts.baton ?? 0).toBeGreaterThan(5);
    expect(counts.aloes ?? 0).toBeGreaterThan(5);
    expect((counts.fruit_baobab ?? 0) + (counts.figue ?? 0) + (counts.muhacha ?? 0)).toBeGreaterThan(5);
  });
});
