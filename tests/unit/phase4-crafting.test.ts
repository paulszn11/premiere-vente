import { describe, expect, it } from 'vitest';
import {
  RECIPES,
  applyImprove,
  applyRepair,
  conditionOf,
  craftQuality,
  dismantle,
  ensureToolMeta,
  experimentHint,
  hintFrom,
  improveOptions,
  learn,
  makeKnowledge,
  matchRecipe,
  maxDurability,
  readKnowledge,
  repairOptions,
  skillLevel,
  toolPower,
  wear,
} from '../../src/shared/crafting';
import { FX_DURCI, FX_LIGATURE_LACHE, FX_RESINE, type ItemStack, addToBag, makeInventory, store } from '../../src/shared/inventory';
import { ITEMS, ITEM_IDS } from '../../src/shared/items';
import { NODE_SPECS, type NodeKind, TREE_REGROW, WorldState, nodesInChunk, treeSpec } from '../../src/shared/resources';
import { TEST_DESTINATIONS, nearestNode, resolveDestination } from '../../src/shared/spawn';
import { CHUNK_SIZE, WATER_LEVEL } from '../../src/shared/constants';
import { Terrain } from '../../src/shared/terrain';

describe('matériaux et outils', () => {
  it('chaque objet a une masse et un volume ; les outils ont une durabilité, une portée, un équilibre', () => {
    for (const id of ITEM_IDS) {
      const d = ITEMS[id];
      expect(d.mass).toBeGreaterThan(0);
      expect(d.volume).toBeGreaterThan(0);
      if (d.tool && id !== 'pierre') {
        expect(d.tool.durability).toBeGreaterThan(0);
        expect(d.tool.reach).toBeGreaterThan(0);
        expect(d.tool.balance).toBeGreaterThan(0);
      }
    }
    expect(ITEMS.resine.rarity).toBe('rare');
    expect(ITEMS.minerai_fer.rarity).toBe('rare');
    expect(ITEMS.pepite_or.rarity).toBe('tres_rare');
  });

  it('un outil usé ne se regroupe pas avec un neuf ; une bûche de plus de 8 kg ne rentre pas dans le sac', () => {
    const inv = makeInventory();
    store(inv, { item: 'quartz', count: 2 });
    store(inv, { item: 'quartz', count: 1, d: 10, dm: 25, q: 50 });
    expect(inv.pockets.filter((p) => p?.item === 'quartz')).toHaveLength(2);
    expect(addToBag(inv, { item: 'buche', count: 1, mass: 12, radius: 0.1, length: 0.8 })).toBe(1);
    expect(addToBag(inv, { item: 'buche', count: 1, mass: 5, radius: 0.07, length: 0.6 })).toBe(0);
  });
});

describe('gisements', () => {
  it('outil de test : se rendre devant le gisement le plus proche (comparé à une recherche exhaustive)', () => {
    const t = new Terrain(20261112);
    const x0 = 1779;
    const z0 = -6962;
    for (const id of ['quartz', 'argile', 'fer', 'or']) {
      const d = TEST_DESTINATIONS.find((x) => x.id === id)!;
      const kind = d.node as NodeKind;
      // Recherche exhaustive dans un carré de ±1,3 km.
      let best = Infinity;
      const c = Math.floor(x0 / CHUNK_SIZE);
      const r = Math.floor(z0 / CHUNK_SIZE);
      for (let cz = r - 21; cz <= r + 21; cz++) for (let cx = c - 21; cx <= c + 21; cx++) for (const n of nodesInChunk(t, cx, cz)) if (n.kind === kind) best = Math.min(best, Math.hypot(n.x - x0, n.z - z0));
      const n = nearestNode(t, kind, x0, z0)!;
      expect(n, id).not.toBeNull();
      expect(Math.hypot(n.x - x0, n.z - z0), id).toBeCloseTo(best, 6);
      const dest = resolveDestination(t, d, { x: x0, z: z0 });
      expect(Math.hypot(dest.x - n.x, dest.z - n.z), id).toBeCloseTo(1.9, 5);
      expect(dest.y, id).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('répartis selon les biomes, déterministes ; le fer est rare et l’or très rare', () => {
    const t1 = new Terrain(20261113);
    const t2 = new Terrain(20261113);
    const counts: Record<string, number> = {};
    const ids = new Set<string>();
    for (const [ox, oz] of [
      [-75, -58],
      [-10, -95],
      [-40, 90],
      [60, 20],
      [20, 60],
    ] as const) {
      for (let cz = oz; cz < oz + 14; cz++) {
        for (let cx = ox; cx < ox + 14; cx++) {
          const a = nodesInChunk(t1, cx, cz);
          expect(nodesInChunk(t2, cx, cz)).toEqual(a);
          for (const n of a) {
            expect(ids.has(n.id)).toBe(false);
            ids.add(n.id);
            counts[n.kind] = (counts[n.kind] ?? 0) + 1;
          }
        }
      }
    }
    expect(counts.bloc_quartz ?? 0).toBeGreaterThan(20);
    expect(counts.touffe_herbe ?? 0).toBeGreaterThan(50);
    expect(counts.gisement_argile ?? 0).toBeGreaterThan(5);
    expect(counts.filon_fer ?? 0).toBeLessThan((counts.bloc_quartz ?? 0) / 2);
    expect(counts.gravier_or ?? 0).toBeLessThan((counts.filon_fer ?? 0) + 5);
  });

  it('un gisement s’épuise puis se régénère à son rythme', () => {
    const w = new WorldState();
    const spec = NODE_SPECS.bloc_quartz;
    for (let i = 0; i < spec.charges; i++) expect(w.useNode('n:0:0:0', 'bloc_quartz', 100)).toBe(true);
    expect(w.useNode('n:0:0:0', 'bloc_quartz', 100)).toBe(false);
    expect(w.nodeLeft('n:0:0:0', 'bloc_quartz', 100 + spec.regen - 1)).toBe(0);
    expect(w.nodeLeft('n:0:0:0', 'bloc_quartz', 100 + spec.regen + 1)).toBe(1);
    expect(w.nodeLeft('n:0:0:0', 'bloc_quartz', 100 + spec.regen * 10)).toBe(spec.charges);
  });

  it('arbres : écorce limitée qui repousse, abattage, souche, repousse au bout de 12 h', () => {
    const w = new WorldState();
    const spec = treeSpec('miombo', 1);
    expect(spec.parts.ecorce).toBe(2);
    expect(w.usePart('3:4:5', 'ecorce', spec, 0)).toBe(true);
    expect(w.usePart('3:4:5', 'ecorce', spec, 0)).toBe(true);
    expect(w.usePart('3:4:5', 'ecorce', spec, 0)).toBe(false);
    expect(w.partLeft('3:4:5', 'ecorce', spec, 3601)).toBe(1);
    let r = { felled: false, progress: 0 };
    for (let i = 0; i < spec.fellStrikes && !r.felled; i++) r = w.fellStrike('3:4:5', spec, 1, 10);
    expect(r.felled).toBe(true);
    expect(w.isFelled('3:4:5', 20)).toBe(true);
    expect(w.felledIn(3, 4, 20)).toEqual([5]);
    expect(w.partLeft('3:4:5', 'ecorce', spec, 20)).toBe(0);
    expect(w.regrow(10 + TREE_REGROW + 1)).toEqual([{ cx: 3, cz: 4 }]);
    expect(w.isFelled('3:4:5', 10 + TREE_REGROW + 1)).toBe(false);
    expect(treeSpec('baobab', 1).fellStrikes).toBeGreaterThan(spec.fellStrikes * 2);
  });

  it('résine : entaille, puis prête dix minutes plus tard', () => {
    const w = new WorldState();
    expect(w.incise('1:1:1', 0)).toBe(true);
    expect(w.resinState('1:1:1', 300)).toBe('coule');
    expect(w.takeResin('1:1:1', 300)).toBe(false);
    expect(w.resinState('1:1:1', 601)).toBe('prete');
    expect(w.takeResin('1:1:1', 601)).toBe(true);
    expect(w.resinState('1:1:1', 602)).toBe('aucune');
  });

  it('l’état du monde se sauvegarde et se relit', () => {
    const w = new WorldState();
    w.useNode('n:1:2:3', 'touffe_herbe', 50);
    const spec = treeSpec('mopane', 1);
    for (let i = 0; i < 40; i++) w.fellStrike('7:8:9', spec, 1, 60);
    const copy = new WorldState();
    copy.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.nodeLeft('n:1:2:3', 'touffe_herbe', 50)).toBe(1);
    expect(copy.isFelled('7:8:9', 70)).toBe(true);
    copy.restore({ nodes: [['x', 'y']], trees: [['pas une clé', {}]] });
  });
});

describe('recettes', () => {
  const st = (item: ItemStack['item'], count = 1, extra: Partial<ItemStack> = {}): ItemStack => ({ item, count, ...extra });

  it('le plan de travail reconnaît une recette (le surplus reste), et la pierre de la hache doit peser 1 à 3 kg', () => {
    expect(matchRecipe([st('quartz'), st('manche'), st('corde')])?.id).toBe('couteau');
    expect(matchRecipe([st('fibres', 5)])?.id).toBe('corde');
    expect(matchRecipe([st('pierre', 1, { mass: 1.5 }), st('manche'), st('corde', 2)])?.id).toBe('hache');
    expect(matchRecipe([st('pierre', 1, { mass: 6 }), st('manche'), st('corde', 2)])).toBeNull();
    expect(matchRecipe([st('quartz'), st('manche')])).toBeNull();
  });

  it('expérimentation : un échec ne coûte rien et donne un indice', () => {
    const k = makeKnowledge();
    expect(experimentHint([st('quartz'), st('manche')], k)).toMatch(/corde/);
    expect(experimentHint([st('quartz'), st('manche'), st('corde'), st('figue')], k)).toMatch(/en trop/);
    expect(experimentHint([], k)).toMatch(/Posez/);
  });

  it('recettes connues au départ, pressenties en ramassant ou en fabriquant, puis apprises', () => {
    const k = makeKnowledge();
    expect(k.known).toEqual(expect.arrayContaining(['couteau', 'corde', 'fibres', 'baton_fouir', 'foyer']));
    expect(k.known).not.toContain('hache');
    expect(hintFrom(k, 'couteau')).toEqual(expect.arrayContaining(['hache', 'lance']));
    expect(hintFrom(k, 'couteau')).toEqual([]);
    expect(learn(k, 'hache')).toBe(true);
    expect(k.hinted).not.toContain('hache');
    const back = readKnowledge(JSON.parse(JSON.stringify(k)));
    expect(back.known).toContain('hache');
    expect(readKnowledge({ known: ['inventée'], xp: -5 }).xp).toBe(0);
  });

  it('la compétence progresse : meilleure qualité et moins de défauts', () => {
    expect(skillLevel(0)).toBe(0);
    expect(skillLevel(40)).toBe(2);
    expect(skillLevel(1e6)).toBe(10);
    let defectsNovice = 0;
    let defectsExpert = 0;
    let qNovice = 0;
    let qExpert = 0;
    for (let i = 0; i < 200; i++) {
      const r = [((i * 37) % 100) / 100, ((i * 61) % 100) / 100, ((i * 13) % 100) / 100] as const;
      const a = craftQuality([st('quartz')], 0, ...r);
      const b = craftQuality([st('quartz')], 10, ...r);
      if (a.fx) defectsNovice++;
      if (b.fx) defectsExpert++;
      qNovice += a.q;
      qExpert += b.q;
    }
    expect(defectsExpert).toBeLessThan(defectsNovice);
    expect(qExpert).toBeGreaterThan(qNovice);
  });

  it('usure, état, efficacité, réparation qui réduit le maximum, améliorations', () => {
    const knife: ItemStack = { item: 'couteau', count: 1 };
    ensureToolMeta(knife, 80);
    expect(knife.dm).toBe(maxDurability('couteau', 80, 0));
    expect(conditionOf(knife)).toBe('neuf');
    const fresh = toolPower(knife);
    knife.d = Math.round(knife.dm! * 0.1);
    expect(conditionOf(knife)).toBe('très abîmé');
    expect(toolPower(knife)).toBeLessThan(fresh);
    expect(repairOptions(knife).map((o) => o.kind)).toEqual(['religaturer', 'affuter']);
    const dm = knife.dm!;
    applyRepair(knife, 'religaturer');
    expect(knife.dm).toBeLessThan(dm);
    expect(knife.d).toBeGreaterThan(Math.round(dm * 0.1));
    knife.fx = FX_LIGATURE_LACHE;
    expect(improveOptions(knife).map((o) => o.kind)).toEqual(['resine']);
    applyImprove(knife, 'resine');
    expect(knife.fx! & FX_RESINE).toBeTruthy();
    expect(knife.fx! & FX_LIGATURE_LACHE).toBeFalsy();
    const stick: ItemStack = { item: 'baton_fouir', count: 1 };
    ensureToolMeta(stick);
    const before = stick.dm!;
    applyImprove(stick, 'durcir');
    expect(stick.fx! & FX_DURCI).toBeTruthy();
    expect(stick.dm).toBeGreaterThan(before * 1.4);
    expect(wear({ item: 'quartz', count: 1, d: 1, dm: 25 })).toBe(true);
  });

  it('démontage : ce qu’on récupère dépend de l’état', () => {
    const r = () => 0.1;
    const good = dismantle({ item: 'couteau', count: 1, d: 100, dm: 100, q: 70 }, r).map((p) => p.item);
    const worn = dismantle({ item: 'couteau', count: 1, d: 10, dm: 100, q: 70 }, r).map((p) => p.item);
    expect(good).toEqual(['manche', 'quartz', 'corde']);
    expect(worn).toEqual(['manche']);
    expect(dismantle({ item: 'hache', count: 1, d: 5, dm: 100 }, r).map((p) => p.item)).toContain('pierre');
  });

  it('chaque recette a des pièces, des étapes et un résultat', () => {
    for (const r of Object.values(RECIPES)) {
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(0);
      if (!r.known) expect(r.hint.length).toBeGreaterThan(10);
    }
  });
});
