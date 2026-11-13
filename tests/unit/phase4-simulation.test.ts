import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerAction } from '../../src/shared/actions';
import { EYE_HEIGHT } from '../../src/shared/constants';
import { ensureToolMeta, skillLevel } from '../../src/shared/crafting';
import { FX_DURCI, FX_RESINE, type ItemStack, countOf, store } from '../../src/shared/inventory';
import { initPhysics } from '../../src/shared/physics';
import type { PropDef } from '../../src/shared/props';
import { NODE_SPECS, TREE_REGROW, treeSpec } from '../../src/shared/resources';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { addInjury } from '../../src/shared/vitals';
import { floraInChunk } from '../../src/shared/vegetation';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;

/** Terrain plat couvert de forêt de miombo (arbres, bois mort, herbes). */
class ForestTerrain extends FlatTerrain {
  constructor() {
    super(LEVEL, { biome: 'miombo', forest: 0.9 });
    this.floraEnabled = true;
  }
}

function setup(terrain = new FlatTerrain(LEVEL)) {
  const s = new LocalSimulation(terrain);
  const events: SimEvent[] = [];
  let yaw = 0;
  let pitch = 0;
  const run = (n: number, wx = 0, wz = 0, buttons = 0) => {
    for (let i = 0; i < n; i++) {
      s.step(cmd(wx, wz, buttons, yaw, pitch));
      events.push(...s.takeEvents());
    }
  };
  const aim = (x: number, y: number, z: number) => {
    const st = s.state;
    const eye = st.y + EYE_HEIGHT;
    yaw = Math.atan2(x - st.x, z - st.z);
    pitch = Math.atan2(eye - y, Math.hypot(x - st.x, z - st.z));
    run(2);
  };
  const act = (a: PlayerAction) => s.act(a);
  /** Donne un objet et le prend en main. */
  const hold = (st: ItemStack) => {
    s.inventory.bag!.unshift(st);
    const r = s.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    run(5);
    return r;
  };
  /** Coups d'outil, avec le temps de chaque coup. */
  const strike = (times: number) => {
    const out = [];
    for (let i = 0; i < times; i++) {
      out.push(s.act({ type: 'utiliser' }));
      run(40);
    }
    return out;
  };
  const kinds = (kind: string) => s.props.views().filter((v) => v.kind === kind);
  run(30);
  return { s, run, aim, act, hold, strike, kinds, events };
}

function node(id: string, kind: PropDef['kind'], x: number, z: number, size = 0.6): PropDef {
  return { id, kind, x, y: LEVEL + (kind === 'bloc_quartz' || kind === 'filon_fer' ? size * 0.25 : 0.02), z, rot: 0, radius: size / 2, length: 0, fixed: true, size };
}

function nearestTree(s: LocalSimulation) {
  const cx = Math.floor(s.state.x / 64);
  const cz = Math.floor(s.state.z / 64);
  let best = null as null | { x: number; z: number; d: number };
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
      for (const t of floraInChunk(s.terrain, cx + dx, cz + dz).trees) {
        if (t.species !== 'miombo') continue;
        const d = Math.hypot(t.x - s.state.x, t.z - s.state.z);
        if (!best || d < best.d) best = { x: t.x, z: t.z, d };
      }
  return best!;
}

/** Se place à 1,1 m d'un arbre, en le regardant à hauteur des yeux. */
function goToTree(h: ReturnType<typeof setup>) {
  const t = nearestTree(h.s);
  h.s.teleport(t.x - 1.1, LEVEL + 0.1, t.z);
  h.run(30);
  h.aim(t.x, LEVEL + 1.5, t.z);
  return t;
}

describe('récolte', () => {
  it('frapper un bloc de quartz avec un galet : des éclats tombent ; le bloc s’épuise puis se reconstitue', () => {
    const h = setup();
    const { s } = h;
    s.props.add(node('q1', 'bloc_quartz', s.state.x, s.state.z + 1.1));
    h.run(10);
    h.aim(s.state.x, LEVEL + 0.3, s.state.z + 1.1);
    expect(h.strike(1)[0]).toEqual({ ok: false, message: expect.stringMatching(/galet/) });
    h.hold({ item: 'pierre', count: 1, mass: 1, radius: 0.045 });
    h.aim(s.state.x, LEVEL + 0.3, s.state.z + 1.1);
    const res = h.strike(3);
    expect(res[2]!.ok).toBe(true);
    expect(h.kinds('quartz').length).toBeGreaterThanOrEqual(1);
    // Six récoltes au total, puis épuisé.
    h.strike(3 * (NODE_SPECS.bloc_quartz.charges - 1));
    h.aim(s.state.x, LEVEL + 0.3, s.state.z + 1.1);
    expect(h.strike(1)[0]!.message).toMatch(/Plus rien/);
    s.time += NODE_SPECS.bloc_quartz.regen + 1;
    expect(h.strike(1)[0]!.ok).toBe(true);
    s.dispose();
  });

  it('arracher des herbes sèches à la main (Prendre)', () => {
    const h = setup();
    const { s } = h;
    s.props.add(node('h1', 'touffe_herbe', s.state.x, s.state.z + 1.2, 0.6));
    h.run(10);
    h.aim(s.state.x, LEVEL + 0.05, s.state.z + 1.2);
    h.run(1, 0, 0, 8);
    h.run(30);
    expect(h.kinds('herbe').length).toBe(1);
    s.dispose();
  });

  it('écorcer un arbre avec un éclat de quartz, couper une branche, entailler pour la résine', () => {
    const h = setup(new ForestTerrain());
    const { s } = h;
    h.hold({ item: 'quartz', count: 1 });
    goToTree(h);
    expect(h.strike(1)[0]!.ok).toBe(true);
    for (let i = 0; i < 30 && h.kinds('ecorce').length < 2; i++) h.strike(1);
    expect(h.kinds('ecorce').length).toBe(2);
    for (let i = 0; i < 12 && h.kinds('manche').length < 1; i++) h.strike(1);
    expect(h.kinds('manche').length).toBe(1);
    s.dispose();
  });

  it('abattre un arbre à la hache : il disparaît, laisse des bûches, puis repousse au bout de 12 h', () => {
    const h = setup(new ForestTerrain());
    const { s } = h;
    const axe: ItemStack = { item: 'hache', count: 1 };
    ensureToolMeta(axe, 80);
    h.hold(axe);
    const t = goToTree(h);
    const near = () => h.kinds('buche').filter((v) => Math.hypot(v.x - t.x, v.z - t.z) < 8).length;
    const logsBefore = near();
    let felled = false;
    for (let i = 0; i < 60 && !felled; i++) felled = (h.strike(1)[0]!.message ?? '').includes('s’abat');
    expect(felled).toBe(true);
    h.run(60);
    expect(s.props.targetTree(s.state, Math.atan2(t.x - s.state.x, t.z - s.state.z), 0.1)).toBeNull();
    expect(near()).toBeGreaterThanOrEqual(logsBefore + 2);
    expect(treeSpec('miombo', 1).logs).toBeGreaterThanOrEqual(2);
    // La hache s'est usée.
    const held = s.props.defOf(s.props.held!.id)!;
    expect(held.meta!.d!).toBeLessThan(held.meta!.dm!);
    // Sauvegarde : l'arbre reste abattu.
    const save = JSON.parse(JSON.stringify(s.serialize()));
    const b = new LocalSimulation(new ForestTerrain(), { save });
    for (let i = 0; i < 30; i++) b.step(cmd(0, 0, 0, Math.atan2(t.x - b.state.x, t.z - b.state.z), 0.1));
    expect(b.props.targetTree(b.state, Math.atan2(t.x - b.state.x, t.z - b.state.z), 0.1)).toBeNull();
    // Repousse.
    b.time += TREE_REGROW + 1;
    for (let i = 0; i < 620; i++) b.step(cmd(0, 0, 0, Math.atan2(t.x - b.state.x, t.z - b.state.z), 0.1));
    expect(b.props.targetTree(b.state, Math.atan2(t.x - b.state.x, t.z - b.state.z), 0.1)).not.toBeNull();
    b.dispose();
    s.dispose();
  });

  it('orpailler avec une batée : de l’or, rarement', () => {
    const h = setup();
    const { s } = h;
    s.props.add(node('g1', 'gravier_or', s.state.x, s.state.z + 1.2, 1.2));
    h.run(10);
    h.aim(s.state.x, LEVEL + 0.05, s.state.z + 1.2);
    expect(h.strike(1)[0]!.message).toMatch(/batée/);
    expect(s.knowledge.hinted).toContain('batee');
    h.hold({ item: 'batee', count: 1 });
    h.aim(s.state.x, LEVEL + 0.05, s.state.z + 1.2);
    for (let i = 0; i < 40 && h.kinds('pepite_or').length === 0; i++) {
      if (h.strike(1)[0]!.message?.startsWith('Plus rien')) s.time += NODE_SPECS.gravier_or.regen * 3;
    }
    expect(h.kinds('pepite_or').length).toBe(1);
    s.dispose();
  });
});

describe('fabrication', () => {
  it('écorce → fibres → corde → couteau, par étapes et avec des outils ; la compétence progresse', () => {
    const h = setup();
    const { s, act } = h;
    store(s.inventory, { item: 'ecorce', count: 2 });
    s.inventory.bag!.push({ item: 'pierre', count: 1, mass: 1, radius: 0.045 });
    const bark = s.inventory.bag!.findIndex((st) => st.item === 'ecorce');
    expect(act({ type: 'etabli_poser', from: { zone: 'sac', index: bark } }).ok).toBe(true);
    expect(s.benchRecipe()?.recipe.id).toBe('fibres');
    expect(act({ type: 'fabriquer' }).ok).toBe(true);
    h.run(60 * 3.5);
    expect(countOf(s.inventory, 'fibres')).toBe(2);
    // Le surplus d'écorce reste sur le plan de travail : une deuxième fois.
    act({ type: 'fabriquer' });
    h.run(60 * 3.5);
    expect(countOf(s.inventory, 'fibres')).toBe(4);
    expect(s.inventory.bench).toEqual([]);
    const fib = s.inventory.pockets.findIndex((p) => p?.item === 'fibres');
    act({ type: 'etabli_poser', from: { zone: 'poche', index: fib } });
    act({ type: 'fabriquer' });
    h.run(60 * 4.5);
    expect(countOf(s.inventory, 'corde')).toBe(1);
    expect(s.inventory.bench).toEqual([{ item: 'fibres', count: 1 }]);
    act({ type: 'etabli_reprendre', index: 0 });
    // Couteau : éclat + branche + corde ; il faut un autre outil tranchant pour fendre le manche.
    store(s.inventory, { item: 'quartz', count: 2 });
    store(s.inventory, { item: 'manche', count: 1 });
    const put = (item: string) => {
      const i = s.inventory.pockets.findIndex((p) => p?.item === item);
      if (i >= 0) return act({ type: 'etabli_poser', from: { zone: 'poche', index: i } });
      return act({ type: 'etabli_poser', from: { zone: 'sac', index: s.inventory.bag!.findIndex((st) => st.item === item) } });
    };
    // Un outil se pose un par un : l'autre éclat reste en poche pour fendre le manche.
    put('quartz');
    expect(s.inventory.bench).toEqual([{ item: 'quartz', count: 1 }]);
    expect(countOf(s.inventory, 'quartz')).toBe(1);
    put('manche');
    put('corde');
    expect(s.benchRecipe()?.recipe.id).toBe('couteau');
    // Sans autre outil tranchant sous la main, la première étape est refusée.
    const spare = s.inventory.pockets.findIndex((p) => p?.item === 'quartz');
    const keep = s.inventory.pockets[spare]!;
    s.inventory.pockets[spare] = null;
    expect(act({ type: 'fabriquer' })).toEqual({ ok: false, message: expect.stringMatching(/outil tranchant/) });
    s.inventory.pockets[spare] = keep;
    const xp = s.knowledge.xp;
    for (let step = 0; step < 3; step++) {
      expect(act({ type: 'fabriquer' }).ok).toBe(true);
      h.run(60 * 4.5);
    }
    const knife = s.inventory.bag!.find((st) => st.item === 'couteau')!;
    expect(knife).toBeDefined();
    expect(knife.q).toBeGreaterThan(0);
    expect(knife.d).toBe(knife.dm);
    expect(s.knowledge.xp).toBeGreaterThan(xp);
    expect(s.knowledge.hinted).toEqual(expect.arrayContaining(['hache', 'lance']));
    expect(skillLevel(s.knowledge.xp)).toBeGreaterThanOrEqual(1);
    s.dispose();
  });

  it('expérimenter : découvrir une recette inconnue, ou recevoir un indice', () => {
    const h = setup();
    const { s, act } = h;
    s.inventory.bag!.push({ item: 'ilala', count: 3 });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: 0 } });
    expect(s.knowledge.known).not.toContain('corde_ilala');
    const r = act({ type: 'fabriquer' });
    expect(r.message).toMatch(/Nouvelle recette/);
    expect(s.knowledge.known).toContain('corde_ilala');
    h.run(60 * 5.5);
    expect(countOf(s.inventory, 'corde')).toBe(1);
    store(s.inventory, { item: 'quartz', count: 1 });
    store(s.inventory, { item: 'manche', count: 1 });
    act({ type: 'etabli_poser', from: { zone: 'poche', index: s.inventory.pockets.findIndex((p) => p?.item === 'quartz') } });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: s.inventory.bag!.findIndex((st) => st.item === 'manche') } });
    expect(act({ type: 'fabriquer' })).toEqual({ ok: false, message: expect.stringMatching(/corde/) });
    s.dispose();
  });

  it('feu : monter un foyer, l’allumer à l’archet, l’alimenter ; eau bouillie, pansements propres, pot cuit', () => {
    const h = setup();
    const { s, act } = h;
    s.inventory.bag!.push({ item: 'baton', count: 5 }, { item: 'herbe', count: 3 });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: 0 } });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: 0 } });
    expect(act({ type: 'fabriquer' }).ok).toBe(true);
    h.run(60 * 4.5);
    const fire = h.kinds('foyer')[0]!;
    expect(fire).toBeDefined();
    expect(act({ type: 'allumer', prop: fire.id }).message).toMatch(/archet/);
    // L'herbe en trop est restée sur le plan de travail : on la reprend.
    expect(s.inventory.bench).toEqual([{ item: 'baton', count: 1 }, { item: 'herbe', count: 1 }]);
    act({ type: 'etabli_reprendre', index: 1 });
    act({ type: 'etabli_reprendre', index: 0 });
    const bow: ItemStack = { item: 'archet', count: 1 };
    ensureToolMeta(bow);
    s.inventory.bag!.push(bow);
    expect(act({ type: 'allumer', prop: fire.id }).ok).toBe(true);
    h.run(60 * 6.5);
    expect(s.props.defOf(fire.id)!.fire!.lit).toBe(true);
    expect(s.state.stamina).toBeLessThan(80);
    const fuel = s.props.defOf(fire.id)!.fire!.fuel;
    expect(act({ type: 'alimenter', prop: fire.id }).ok).toBe(true);
    expect(s.props.defOf(fire.id)!.fire!.fuel).toBeGreaterThan(fuel + 50);
    // Eau bouillie.
    s.inventory.bag!.push({ item: 'pot', count: 1, w: 1 });
    act({ type: 'poser_feu', prop: fire.id, from: { zone: 'sac', index: s.inventory.bag!.length - 1 } });
    h.run(60 * 31);
    expect(s.props.defOf(fire.id)!.fire!.pot?.w).toBe(2);
    act({ type: 'reprendre_feu', prop: fire.id });
    // Pansements propres.
    store(s.inventory, { item: 'chiffon', count: 2 });
    act({ type: 'etabli_poser', from: { zone: 'poche', index: s.inventory.pockets.findIndex((p) => p?.item === 'chiffon') } });
    const r = act({ type: 'fabriquer' });
    expect(r.message).toMatch(/Pansements propres/);
    h.run(60 * 4.5);
    expect(countOf(s.inventory, 'pansement')).toBe(2);
    expect(s.inventory.bag!.find((st) => st.item === 'pot')!.w).toBe(0);
    // Pot d'argile crue cuit au feu.
    s.inventory.bag!.push({ item: 'pot_cru', count: 1, q: 70 });
    act({ type: 'poser_feu', prop: fire.id, from: { zone: 'sac', index: s.inventory.bag!.length - 1 } });
    h.run(60 * 92);
    expect(s.props.defOf(fire.id)!.fire!.pot?.item).toBe('pot');
    // Sans bois, le feu s'éteint.
    s.props.defOf(fire.id)!.fire!.fuel = 1;
    h.run(60 * 2);
    expect(s.props.defOf(fire.id)!.fire!.lit).toBe(false);
    s.dispose();
  });

  it('un pansement propre ne s’infecte jamais', () => {
    const h = setup();
    const { s, act } = h;
    for (let k = 0; k < 10; k++) {
      s.vitals.injuries = [];
      const cut = addInjury(s.vitals, 'bras_g', 'coupure', true);
      store(s.inventory, { item: 'pansement', count: 1 });
      expect(act({ type: 'soigner', injury: cut.id, treatment: 'bander' }).ok).toBe(true);
      h.run(60 * 6.5);
      expect(cut.bandaged).toBe(true);
      expect(cut.infectAt).toBe(-1);
    }
    s.dispose();
  });

  it('remplir un pot dans l’eau', () => {
    const h = setup(new FlatTerrain(-0.6));
    const { s, act } = h;
    s.teleport(s.state.x, -0.5, s.state.z);
    h.run(30);
    s.inventory.bag!.push({ item: 'pot', count: 1 });
    expect(act({ type: 'remplir', from: { zone: 'sac', index: 0 } }).ok).toBe(true);
    expect(s.inventory.bag![0]!.w).toBe(1);
    s.dispose();
    const dry = setup();
    dry.s.inventory.bag!.push({ item: 'pot', count: 1 });
    expect(dry.act({ type: 'remplir', from: { zone: 'sac', index: 0 } }).ok).toBe(false);
    dry.s.dispose();
  });

  it('réparer (le maximum baisse), améliorer (résine, durcir au feu), démonter', () => {
    const h = setup();
    const { s, act } = h;
    const knife: ItemStack = { item: 'couteau', count: 1 };
    ensureToolMeta(knife, 70);
    knife.d = 10;
    s.inventory.bag!.push(knife);
    expect(act({ type: 'reparer', from: { zone: 'sac', index: 0 }, kind: 'religaturer' }).message).toMatch(/corde/);
    store(s.inventory, { item: 'corde', count: 1 });
    const dm = knife.dm!;
    expect(act({ type: 'reparer', from: { zone: 'sac', index: 0 }, kind: 'religaturer' }).ok).toBe(true);
    h.run(60 * 4.5);
    expect(knife.d).toBeGreaterThan(10);
    expect(knife.dm).toBeLessThan(dm);
    store(s.inventory, { item: 'resine', count: 1 });
    act({ type: 'ameliorer', from: { zone: 'sac', index: 0 }, kind: 'resine' });
    h.run(60 * 3.5);
    expect(knife.fx! & FX_RESINE).toBeTruthy();
    // Durcir au feu : il faut un feu allumé tout près.
    const stick: ItemStack = { item: 'baton_fouir', count: 1 };
    ensureToolMeta(stick);
    s.inventory.bag!.push(stick);
    const si = s.inventory.bag!.length - 1;
    expect(act({ type: 'ameliorer', from: { zone: 'sac', index: si }, kind: 'durcir' }).message).toMatch(/feu/);
    const fireId = s.props.spawnDynamic({ kind: 'foyer', x: s.state.x + 1, y: LEVEL + 0.12, z: s.state.z, rot: 0, radius: 0.45, length: 0, fixed: true, fire: { lit: true, fuel: 600, pot: null, cook: 0 } });
    expect(fireId).toBeTruthy();
    expect(act({ type: 'ameliorer', from: { zone: 'sac', index: si }, kind: 'durcir' }).ok).toBe(true);
    h.run(60 * 8.5);
    expect(stick.fx! & FX_DURCI).toBeTruthy();
    // Démonter le couteau.
    expect(act({ type: 'demonter', from: { zone: 'sac', index: 0 } }).ok).toBe(true);
    h.run(60 * 3.5);
    expect(s.inventory.bag!.some((st) => st.item === 'couteau')).toBe(false);
    expect(countOf(s.inventory, 'manche') + countOf(s.inventory, 'quartz') + countOf(s.inventory, 'corde')).toBeGreaterThan(0);
    s.dispose();
  });

  it('le plan de travail, les recettes connues et l’état du monde sont sauvegardés', () => {
    const h = setup();
    const { s, act } = h;
    s.inventory.bag!.push({ item: 'ilala', count: 3 });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: 0 } });
    act({ type: 'fabriquer' });
    s.gesture = null;
    s.inventory.bag!.push({ item: 'argile', count: 2 });
    act({ type: 'etabli_poser', from: { zone: 'sac', index: s.inventory.bag!.length - 1 } });
    s.world.useNode('n:9:9:1', 'bloc_quartz', s.time);
    const save = JSON.parse(JSON.stringify(s.serialize()));
    s.dispose();
    const b = new LocalSimulation(new FlatTerrain(LEVEL), { save });
    expect(b.knowledge.known).toContain('corde_ilala');
    expect(b.inventory.bench.map((st) => st.item).sort()).toEqual(['argile', 'ilala']);
    expect(b.world.nodeLeft('n:9:9:1', 'bloc_quartz', b.time)).toBe(NODE_SPECS.bloc_quartz.charges - 1);
    b.dispose();
  });
});
