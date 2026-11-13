import { beforeAll, describe, expect, it } from 'vitest';
import { type PlayerAction, readAction } from '../../src/shared/actions';
import { type PlanId, type Structure, isDone, maxHp, pieceTransform, toWorld } from '../../src/shared/building';
import { EYE_HEIGHT, WATER_LEVEL } from '../../src/shared/constants';
import { ensureToolMeta } from '../../src/shared/crafting';
import { type ItemStack, countOf, store } from '../../src/shared/inventory';
import { BTN_INTERACT, BTN_JUMP, MODE_CLIMB } from '../../src/shared/movement';
import { initPhysics } from '../../src/shared/physics';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;

function setup(level = LEVEL) {
  const s = new LocalSimulation(new FlatTerrain(level));
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
  const hold = (st: ItemStack) => {
    s.inventory.bag!.unshift(st);
    const r = s.act({ type: 'sortir', from: { zone: 'sac', index: 0 } });
    run(5);
    return r;
  };
  /** Fait les étapes d'un chantier visé (« Utiliser »), en laissant le temps à chaque geste. */
  const work = (times: number, seconds = 11) => {
    const out = [];
    for (let i = 0; i < times; i++) {
      out.push(s.act({ type: 'utiliser' }));
      run(Math.round(60 * seconds));
    }
    return out;
  };
  const kinds = (kind: string) => s.props.views().filter((v) => v.kind === kind);
  run(30);
  return { s, run, aim, act, hold, work, kinds, events };
}

/** Pose une pièce directement (joueur supposé à 3 m) et la termine. */
function put(s: LocalSimulation, plan: PlanId, x: number, y: number, z: number, finish = true) {
  const pl = s.build.placement({ plan, aim: { x, y, z }, yaw: 0, turn: 0, player: { x, y, z: z - 3 } });
  expect(pl.ok, pl.reason ?? '').toBe(true);
  const ref = s.build.apply(pl)!;
  if (finish && 's' in ref) {
    const p = s.build.piece(ref.s, ref.p)!;
    while (!isDone(p)) s.build.advance(ref.s, ref.p, false);
  }
  return ref as { s: string; p: number };
}

const stone = (mass: number): ItemStack => ({ item: 'pierre', count: 1, mass, radius: Math.cbrt((3 * mass) / (4 * Math.PI * 2600)) });
const log = (): ItemStack => ({ item: 'buche', count: 1, mass: 5, radius: 0.07, length: 0.6 });
const tool = (item: ItemStack['item']): ItemStack => {
  const st: ItemStack = { item, count: 1 };
  ensureToolMeta(st, 75);
  return st;
};

describe('chantier : un plan, des matériaux, des étapes', () => {
  it('tracer un plancher, apporter les bûches (posées à côté), ligaturer : le plancher devient solide', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    h.aim(x0, LEVEL, z0 + 2.6);
    const { aim, on } = s.aimPoint();
    const r = act({ type: 'planifier', plan: 'sol_rondins', aim, turn: 0, on });
    expect(r.ok, r.message).toBe(true);
    expect(s.build.structures).toHaveLength(1);
    const st = s.build.structures[0]!;
    const piece = st.pieces[0]!;
    expect(piece.step).toBe(0);
    // Pas encore de matériaux.
    h.aim(aim.x, LEVEL + 0.1, aim.z);
    const none = act({ type: 'utiliser' });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/4 bûches/);
    expect(s.useHint()?.action).toMatch(/il manque 4 bûches/);
    // Quatre bûches posées à côté du chantier (trop lourdes pour les porter toutes), deux cordes en poche.
    for (let k = 0; k < 4; k++) s.props.spawnDynamic({ kind: 'buche', x: aim.x - 1.6 + k * 0.3, y: LEVEL + 0.4, z: aim.z + 1.2, rot: 0.25, radius: 0.07, length: 0.6 });
    store(s.inventory, { item: 'corde', count: 2 });
    h.run(60);
    h.aim(aim.x, LEVEL + 0.1, aim.z);
    expect(s.useHint()?.ready).toBe(true);
    const results = h.work(2, 7);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(isDone(piece)).toBe(true);
    expect(piece.hp).toBe(maxHp(piece));
    expect(h.kinds('buche')).toHaveLength(0);
    expect(countOf(s.inventory, 'corde')).toBe(0);
    expect(h.events.some((e) => e.type === 'message' && /terminé/.test(e.text))).toBe(true);
    // On peut marcher dessus.
    s.teleport(aim.x, LEVEL + 1.5, aim.z);
    h.run(90);
    expect(s.state.y).toBeGreaterThan(LEVEL + 0.1);
    expect(s.structPhys.count).toBeGreaterThan(0);
    s.dispose();
  });

  it('fixations en fer : avec des clous, le mur est cloué (plus solide) ; abandonner un chantier rend des matériaux', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    h.aim(x0, LEVEL, z0 + 2.5);
    const { aim } = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'mur_clayonnage', aim, turn: 0, on: null }).ok).toBe(true);
    s.inventory.bag!.push({ item: 'perche', count: 2 }, { item: 'baton', count: 6 }, tool('pierre'));
    store(s.inventory, { item: 'clous', count: 6 });
    store(s.inventory, { item: 'corde', count: 1 });
    h.aim(aim.x, LEVEL + 1.2, aim.z);
    expect(h.work(3, 7).every((x) => x.ok)).toBe(true);
    const wall = s.build.structures[0]!.pieces[0]!;
    expect(wall.iron).toBe(true);
    expect(wall.hp).toBe(Math.round(220 * 1.3));
    expect(countOf(s.inventory, 'clous')).toBe(0);
    expect(countOf(s.inventory, 'corde')).toBe(1);
    // Un autre chantier, abandonné après une étape : une partie des perches revient.
    h.aim(x0 + 3, LEVEL, z0 + 2.5);
    const p2 = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'mur_clayonnage', aim: p2.aim, turn: 0, on: null }).ok).toBe(true);
    s.inventory.bag!.push({ item: 'perche', count: 2 });
    // Le plan s'est accroché à la grille du premier mur (une case plus loin) : on vise son milieu.
    const site = s.build.structures.flatMap((st) => st.pieces).find((p) => !isDone(p))!;
    const t2 = pieceTransform(s.build.structures.find((st) => st.pieces.includes(site))!, site.slot);
    s.teleport(t2.x, LEVEL + 0.1, t2.z - 2);
    h.run(20);
    h.aim(t2.x, LEVEL + 1.2, t2.z);
    h.work(1, 5);
    expect(site.step).toBe(1);
    const st2 = s.build.structures.find((st) => st.pieces.includes(site))!;
    expect(act({ type: 'annuler_chantier', target: { kind: 'piece', s: st2.id, p: site.id } }).ok).toBe(true);
    h.run(30);
    expect(h.kinds('perche').length).toBe(1);
    s.dispose();
  });
});

describe('physique des constructions', () => {
  it('une porte fermée arrête le joueur ; ouverte (E), on passe', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    const ref = put(s, 'porte', x0, LEVEL, z0 + 2);
    h.run(10);
    h.run(150, 0, 1);
    expect(s.state.z).toBeLessThan(z0 + 1.8);
    h.run(10);
    expect(act({ type: 'piece', s: ref.s, p: ref.p, op: 'porte' }).ok).toBe(true);
    h.run(150, 0, 1);
    expect(s.state.z).toBeGreaterThan(z0 + 2.4);
    // Refermer sur soi : refusé.
    s.teleport(x0, LEVEL + 0.1, z0 + 2);
    h.run(20);
    expect(act({ type: 'piece', s: ref.s, p: ref.p, op: 'porte' }).message).toMatch(/passage/);
    // Les mains prises (une bûche), E ferme quand même la porte visée, sans lâcher la bûche.
    s.teleport(x0, LEVEL + 0.1, z0 + 0.5);
    h.run(20);
    h.hold(log());
    h.aim(x0 + 0.75, LEVEL + 1.2, z0 + 2);
    h.run(1, 0, 0, BTN_INTERACT);
    h.run(3);
    expect(s.build.piece(ref.s, ref.p)!.open).toBe(false);
    expect(s.props.held).not.toBeNull();
    s.dispose();
  });

  it('une échelle s’escalade (Sauter face à elle) ; un mur, non', () => {
    const h = setup();
    const { s } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    put(s, 'echelle', x0, LEVEL, z0 + 1.5);
    put(s, 'mur_clayonnage', x0 + 6, LEVEL, z0 + 1.5);
    h.run(10);
    let climbed = false;
    for (let i = 0; i < 40 && !climbed; i++) {
      h.run(4, 0, 1);
      h.run(1, 0, 1, BTN_JUMP);
      climbed = s.state.mode === MODE_CLIMB;
    }
    expect(climbed).toBe(true);
    h.run(60, 0, 1);
    expect(s.state.y).toBeGreaterThan(LEVEL + 0.8);
    // Face au mur, sauter ne fait que sauter.
    s.teleport(x0 + 6, LEVEL + 0.1, z0);
    h.run(30);
    let wallClimb = false;
    for (let i = 0; i < 20; i++) {
      h.run(4, 0, 1);
      h.run(1, 0, 1, BTN_JUMP);
      if (s.state.mode === MODE_CLIMB) wallClimb = true;
    }
    expect(wallClimb).toBe(false);
    s.dispose();
  });

  it('plus d’appui : l’étage s’effondre en débris physiques', () => {
    const h = setup();
    const { s } = h;
    const x0 = s.state.x + 8;
    const z0 = s.state.z;
    put(s, 'sol_rondins', x0 + 1, LEVEL, z0 + 1);
    const st = s.build.structures[0]!;
    const at = (lx: number, ly: number, lz: number) => toWorld(st, lx, ly, lz);
    for (const [lx, lz] of [
      [1, 0],
      [1, 2],
      [0, 1],
      [2, 1],
    ] as const) {
      const p = at(lx, 1.2, lz);
      put(s, 'mur_clayonnage', p.x, p.y, p.z);
    }
    const up = at(1, 2.5, 1);
    put(s, 'sol_rondins', up.x, up.y, up.z);
    h.run(20);
    expect(st.pieces).toHaveLength(6);
    const logsBefore = h.kinds('buche').length;
    for (const w of [...st.pieces].filter((p) => p.plan === 'mur_clayonnage')) s.build.remove(st.id, w.id);
    h.run(30);
    expect(st.pieces.map((p) => p.slot.k)).toEqual([0]);
    expect(h.kinds('buche').length).toBeGreaterThan(logsBefore);
    expect(h.events.some((e) => e.type === 'message' && /effondre/.test(e.text))).toBe(true);
    s.dispose();
  });

  it('frapper à la hache : le bois cède ; une pierre lancée abîme un mur', () => {
    const h = setup();
    const { s } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    const ref = put(s, 'mur_clayonnage', x0, LEVEL, z0 + 2);
    h.run(10);
    h.hold(tool('hache'));
    h.aim(x0, LEVEL + 1.4, z0 + 2);
    expect(s.useHint()?.action).toMatch(/frapper/);
    for (let i = 0; i < 30 && s.build.piece(ref.s, ref.p); i++) {
      s.state.stamina = 100;
      s.act({ type: 'utiliser' });
      h.run(40);
    }
    expect(s.build.piece(ref.s, ref.p)).toBeUndefined();
    expect(h.kinds('perche').length + h.kinds('baton').length).toBeGreaterThan(0);
    // Une grosse pierre lancée contre un mur de clayonnage.
    const w2 = put(s, 'mur_clayonnage', x0 + 6, LEVEL, z0 + 3);
    h.run(10);
    const before = s.build.piece(w2.s, w2.p)!.hp;
    s.props.spawnDynamic({ kind: 'pierre', x: x0 + 6, y: LEVEL + 1.3, z: z0 + 1, rot: 0, radius: 0.12, length: 0 }, { x: 0, y: 1, z: 14 });
    h.run(60);
    expect(s.build.piece(w2.s, w2.p)!.hp).toBeLessThan(before);
    s.dispose();
  });

  it('le feu : une torche enflamme le bois, le feu le ronge, un pot d’eau l’éteint ; le torchis ne brûle pas', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    const ref = put(s, 'mur_clayonnage', x0, LEVEL, z0 + 2);
    // Un feu allumé à côté pour allumer la torche.
    s.props.spawnDynamic({ kind: 'foyer', x: x0 + 1, y: LEVEL + 0.12, z: z0, rot: 0, radius: 0.45, length: 0, fixed: true, fire: { lit: true, fuel: 900, pot: null, cook: 0 } });
    h.run(10);
    h.hold({ item: 'torche', count: 1, d: 600, dm: 600 });
    expect(act({ type: 'utiliser' }).message).toMatch(/allume/);
    h.aim(x0, LEVEL + 1.4, z0 + 2);
    expect(act({ type: 'utiliser' }).message).toMatch(/feu prend/);
    const wall = s.build.piece(ref.s, ref.p)!;
    h.run(60 * 6);
    expect(wall.hp).toBeLessThan(220 - 30);
    s.inventory.bag!.push({ item: 'pot', count: 1, w: 1, q: 70, d: 200, dm: 200 });
    expect(act({ type: 'piece', s: ref.s, p: ref.p, op: 'eteindre' }).ok).toBe(true);
    expect(wall.burning).toBe(0);
    expect(s.inventory.bag!.find((x) => x.item === 'pot')!.w).toBe(0);
    // Torchis : enduit, il ne prend plus feu.
    store(s.inventory, { item: 'argile', count: 3 });
    expect(act({ type: 'piece', s: ref.s, p: ref.p, op: 'torchis' }).ok).toBe(true);
    h.run(60 * 6.5);
    expect(wall.mat).toBe('torchis');
    expect(act({ type: 'utiliser' }).message).toMatch(/ne brûle pas/);
    s.dispose();
  });
});

describe('installations', () => {
  it('coffre sur un plancher : on y range des objets ; si le plancher disparaît, le coffre tombe et son contenu aussi', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    const floor = put(s, 'sol_rondins', x0, LEVEL, z0 + 2.5);
    h.run(10);
    h.aim(x0, LEVEL + 0.15, z0 + 2.5);
    const { aim, on } = s.aimPoint();
    expect(on).toEqual(floor);
    expect(act({ type: 'planifier', plan: 'coffre', aim, turn: 0, on }).ok).toBe(true);
    s.inventory.bag!.push(log(), log(), tool('couteau'));
    store(s.inventory, { item: 'corde', count: 1 });
    h.aim(aim.x, aim.y + 0.4, aim.z);
    expect(h.work(2, 7).every((x) => x.ok)).toBe(true);
    const chest = h.kinds('coffre')[0]!;
    expect(chest).toBeDefined();
    store(s.inventory, { item: 'figue', count: 4 });
    const i = s.inventory.pockets.findIndex((p) => p?.item === 'figue');
    s.inventory.bag!.push(s.inventory.pockets[i]!);
    s.inventory.pockets[i] = null;
    expect(act({ type: 'deposer_dans', prop: chest.id, from: { zone: 'sac', index: s.inventory.bag!.length - 1 } }).ok).toBe(true);
    expect(s.props.container(chest.id)!.bag).toEqual([{ item: 'figue', count: 4 }]);
    // Sauvegarde et reprise : construction et contenu du coffre.
    const saved = JSON.parse(JSON.stringify(s.serialize()));
    const back = new LocalSimulation(new FlatTerrain(LEVEL), { save: saved });
    expect(back.build.structures[0]!.pieces).toHaveLength(1);
    back.step(cmd(0, 0));
    const chest2 = back.props.views().find((v) => v.kind === 'coffre')!;
    expect(back.props.container(chest2.id)!.bag).toEqual([{ item: 'figue', count: 4 }]);
    back.dispose();
    s.build.remove(floor.s, floor.p);
    h.run(30);
    expect(h.kinds('coffre')).toHaveLength(0);
    expect(h.kinds('figue').length).toBe(1);
    s.dispose();
  });

  it('puits près de l’eau : on y remplit son pot', () => {
    const h = setup(WATER_LEVEL + 2);
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    s.knowledge.plans.push('puits');
    h.aim(x0, WATER_LEVEL + 2, z0 + 2.5);
    const { aim } = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'puits', aim, turn: 0, on: null }).ok).toBe(true);
    s.inventory.bag!.push(tool('baton_fouir'), stone(7), stone(7), stone(7), stone(5));
    h.aim(aim.x, aim.y + 0.4, aim.z);
    expect(h.work(3, 11).every((x) => x.ok)).toBe(true);
    expect(h.kinds('puits')).toHaveLength(1);
    s.inventory.bag!.push({ item: 'pot', count: 1, q: 70, d: 200, dm: 200, w: 0 });
    expect(act({ type: 'remplir', from: { zone: 'sac', index: s.inventory.bag!.length - 1 } }).ok).toBe(true);
    expect(s.inventory.bag!.find((x) => x.item === 'pot')!.w).toBe(1);
    s.dispose();
  });

  it('bas fourneau puis forge : minerai → loupe de fer → barre → clous ; la forge doit être allumée', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    expect(s.knowledge.plans).not.toContain('fourneau');
    // Ramasser du minerai (E) fait penser au fourneau.
    const ore = s.props.spawnDynamic({ kind: 'minerai_fer', x: x0, y: LEVEL + 0.3, z: z0 + 1.2, rot: 0, radius: 0.07, length: 0 });
    h.run(40);
    const op = s.props.position(ore)!;
    h.aim(op.x, op.y, op.z);
    h.run(1, 0, 0, BTN_INTERACT);
    h.run(2);
    expect(countOf(s.inventory, 'minerai_fer')).toBe(1);
    expect(s.knowledge.plans).toContain('fourneau');
    store(s.inventory, { item: 'minerai_fer', count: 1 });
    h.aim(x0, LEVEL, z0 + 2.5);
    const { aim } = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'fourneau', aim, turn: 0, on: null }).ok).toBe(true);
    s.inventory.bag!.push(stone(7), stone(7), stone(7), tool('quartz'), { item: 'baton', count: 2 });
    store(s.inventory, { item: 'argile', count: 6 });
    store(s.inventory, { item: 'corde', count: 1 });
    h.aim(aim.x, aim.y + 0.5, aim.z);
    expect(h.work(3, 9).every((x) => x.ok)).toBe(true);
    const furnace = h.kinds('fourneau')[0]!;
    expect(furnace).toBeDefined();
    const f = s.props.defOf(furnace.id)!.furnace!;
    s.inventory.bag!.push(log(), log());
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'minerai' }).ok).toBe(true);
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'minerai' }).ok).toBe(true);
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'souffler' }).message).toMatch(/Allumez/);
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'bois' }).ok).toBe(true);
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'bois' }).ok).toBe(true);
    s.inventory.bag!.push(tool('archet'), { item: 'herbe', count: 3 });
    expect(act({ type: 'allumer', prop: furnace.id }).ok).toBe(true);
    h.run(60 * 6.5);
    expect(f.lit).toBe(true);
    for (let i = 0; i < 16 && f.blooms === 0; i++) {
      s.state.stamina = 100;
      act({ type: 'fourneau', prop: furnace.id, op: 'souffler' });
      h.run(60 * 4.2);
    }
    expect(f.blooms).toBe(1);
    expect(f.ore).toBe(0);
    expect(act({ type: 'fourneau', prop: furnace.id, op: 'loupe' }).ok).toBe(true);
    expect(countOf(s.inventory, 'loupe_fer')).toBe(1);
    expect(s.knowledge.plans).toContain('forge');
    expect(s.knowledge.hinted).toContain('barre_fer');
    // La forge.
    h.aim(x0 + 2.5, LEVEL, z0);
    const p2 = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'forge', aim: p2.aim, turn: 0, on: null }).ok).toBe(true);
    s.inventory.bag!.push(stone(7), stone(7), stone(6), stone(4), stone(6));
    store(s.inventory, { item: 'argile', count: 2 });
    h.aim(p2.aim.x, p2.aim.y + 0.4, p2.aim.z);
    expect(h.work(2, 7).every((x) => x.ok)).toBe(true);
    const forge = h.kinds('forge')[0]!;
    expect(forge).toBeDefined();
    // Barre de fer : sur le plan de travail, forge éteinte puis allumée.
    s.inventory.bench.push({ item: 'loupe_fer', count: 1 });
    s.inventory.bag!.splice(
      s.inventory.bag!.findIndex((x) => x.item === 'loupe_fer'),
      1,
    );
    s.inventory.bag!.push(stone(2));
    const r0 = act({ type: 'fabriquer' });
    expect(r0.message).toMatch(/forge allumée/);
    s.inventory.bag!.push(log());
    expect(act({ type: 'alimenter', prop: forge.id }).ok).toBe(true);
    expect(act({ type: 'allumer', prop: forge.id }).ok).toBe(true);
    h.run(60 * 6.5);
    expect(s.props.defOf(forge.id)!.fire!.lit).toBe(true);
    for (let i = 0; i < 2; i++) {
      expect(act({ type: 'fabriquer' }).ok).toBe(true);
      h.run(60 * 8.5);
    }
    expect(countOf(s.inventory, 'barre_fer')).toBe(1);
    expect(s.knowledge.hinted).toEqual(expect.arrayContaining(['clous', 'boulons', 'hache_fer', 'couteau_fer']));
    // Clous : une barre.
    const bi = s.inventory.bag!.findIndex((x) => x.item === 'barre_fer');
    act({ type: 'etabli_poser', from: { zone: 'sac', index: bi } });
    for (let i = 0; i < 2; i++) {
      expect(act({ type: 'fabriquer' }).ok).toBe(true);
      h.run(60 * 6.5);
    }
    expect(countOf(s.inventory, 'clous')).toBe(12);
    s.dispose();
  });

  it('près d’un établi, les gestes de fabrication sont plus rapides', () => {
    const h = setup();
    const { s, act } = h;
    s.inventory.bench.push({ item: 'baton', count: 1 }, { item: 'herbe', count: 1 });
    expect(act({ type: 'fabriquer' }).ok).toBe(true);
    const far = s.gesture!.total;
    h.run(60 * 3.5);
    s.props.spawnDynamic({ kind: 'etabli', x: s.state.x + 1.5, y: LEVEL + 0.45, z: s.state.z, rot: 0, radius: 0.8, length: 0.45, fixed: true });
    h.run(10);
    s.inventory.bench.push({ item: 'baton', count: 1 }, { item: 'herbe', count: 1 });
    s.knowledge.xp = 0;
    expect(act({ type: 'fabriquer' }).ok).toBe(true);
    expect(s.gesture!.total).toBeCloseTo(far * 0.8, 5);
    h.run(60 * 3.5);
    const torches = [...s.inventory.pockets, ...(s.inventory.bag ?? [])].filter((x) => x?.item === 'torche');
    expect(torches).toHaveLength(2);
    expect(torches[0]!.d).toBe(600);
    s.dispose();
  });
});

describe('actions réseau', () => {
  it('les nouvelles actions sont vérifiées', () => {
    expect(readAction({ type: 'planifier', plan: 'sol_rondins', aim: { x: 1, y: 2, z: 3 }, turn: 2, on: null })).toEqual({ type: 'planifier', plan: 'sol_rondins', aim: { x: 1, y: 2, z: 3 }, turn: 2, on: null });
    expect(readAction({ type: 'planifier', plan: 'chateau', aim: { x: 1, y: 2, z: 3 }, turn: 0, on: null })).toBeNull();
    expect(readAction({ type: 'planifier', plan: 'sol_rondins', aim: { x: Number.NaN, y: 2, z: 3 }, turn: 0, on: null })).toBeNull();
    expect(readAction({ type: 'planifier', plan: 'sol_rondins', aim: { x: 1, y: 2, z: 3 }, turn: 99, on: null })).toBeNull();
    expect(readAction({ type: 'chantier', target: { kind: 'site', id: 'i3' } })).toEqual({ type: 'chantier', target: { kind: 'site', id: 'i3' } });
    expect(readAction({ type: 'chantier', target: { kind: 'piece', s: 's1', p: -1 } })).toBeNull();
    expect(readAction({ type: 'piece', s: 's1', p: 2, op: 'demonter' })).toEqual({ type: 'piece', s: 's1', p: 2, op: 'demonter' });
    expect(readAction({ type: 'piece', s: 's1', p: 2, op: 'exploser' })).toBeNull();
    expect(readAction({ type: 'fourneau', prop: 'd4', op: 'souffler' })).toEqual({ type: 'fourneau', prop: 'd4', op: 'souffler' });
  });

  it('un plan inconnu ne se trace pas ; trop loin non plus', () => {
    const h = setup();
    const { s, act } = h;
    expect(act({ type: 'planifier', plan: 'forge', aim: { x: s.state.x, y: LEVEL, z: s.state.z + 2 }, turn: 0, on: null }).message).toMatch(/connaissez/);
    expect(act({ type: 'planifier', plan: 'sol_rondins', aim: { x: s.state.x, y: LEVEL, z: s.state.z + 20 }, turn: 0, on: null }).message).toMatch(/loin/);
    const st: Structure | undefined = s.build.structures[0];
    expect(st).toBeUndefined();
    s.dispose();
  });
});
