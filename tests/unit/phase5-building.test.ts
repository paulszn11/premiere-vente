import { describe, expect, it } from 'vitest';
import {
  BuildState,
  COLLAPSE_AT,
  GRID,
  LEVEL_H,
  PLANS,
  type Piece,
  type PlacementInput,
  type PlanId,
  combustible,
  computeSupport,
  damageFor,
  isDone,
  maxHp,
  pieceTransform,
  plansFrom,
  readPlans,
  salvage,
  startingPlans,
  stepsOf,
  toLocal,
  toWorld,
} from '../../src/shared/building';
import { WATER_LEVEL } from '../../src/shared/constants';

const flat = (h = 10) => () => h;

/** Pose un plan visé en (x, y, z), joueur à 3 m au sud, puis termine toutes ses étapes. */
function build(bs: BuildState, plan: PlanId, x: number, y: number, z: number, opts: Partial<PlacementInput> = {}) {
  const pl = bs.placement({ plan, aim: { x, y, z }, yaw: 0, turn: 0, player: { x, y, z: z - 3 }, ...opts });
  if (!pl.ok) return { pl, ref: null };
  const ref = bs.apply(pl);
  if (ref && 's' in ref) {
    const p = bs.piece(ref.s, ref.p)!;
    while (!isDone(p)) bs.advance(ref.s, ref.p, false);
  }
  return { pl, ref };
}

describe('grille et géométrie', () => {
  it('passage monde ↔ grille, quelle que soit l’orientation', () => {
    const s = { x: 100, y: 5, z: -40, yaw: 0.7 };
    const w = toWorld(s, 3, 1, -2);
    const l = toLocal(s, w.x, w.y, w.z);
    expect(l.x).toBeCloseTo(3, 9);
    expect(l.y).toBeCloseTo(1, 9);
    expect(l.z).toBeCloseTo(-2, 9);
    // Orientation 0 : la grille suit les axes du monde, z vers l'avant (même convention que le regard).
    expect(toWorld({ x: 0, y: 0, z: 0, yaw: 0 }, 0, 0, 2)).toEqual({ x: 0, y: 0, z: 2 });
  });

  it('chaque plan a des étapes, des points de vie et une description', () => {
    for (const p of Object.values(PLANS)) {
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.hp).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(10);
      // Exactement l'un des trois : pièce de la grille, installation ou véhicule (phase 7).
      expect([p.piece !== null, p.install !== null, p.vehicle !== undefined].filter(Boolean).length).toBe(1);
    }
  });
});

describe('poser des plans', () => {
  it('premier plancher sur sol plat : nouvelle construction, posée sur le sol, stable à 100 %', () => {
    const bs = new BuildState(flat());
    const pl = bs.placement({ plan: 'sol_rondins', aim: { x: 0, y: 10, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -3 } });
    expect(pl.ok).toBe(true);
    expect(pl.structure).toBeNull();
    expect(pl.stilts).toBe(0);
    expect(pl.support).toBe(1);
    // Le plancher est centré sur le point visé, son dessus légèrement au-dessus du sol.
    expect(pl.world.x).toBeCloseTo(0, 6);
    expect(pl.world.z).toBeCloseTo(0, 6);
    expect(pl.world.y).toBeCloseTo(10.15, 6);
    const ref = bs.apply(pl)!;
    expect('s' in ref).toBe(true);
    expect(bs.structures).toHaveLength(1);
  });

  it('sur une pente : pilotis aux coins bas ; trop haut (plus de 3,5 m) : refusé', () => {
    const slope = new BuildState((x) => 10 + x * 0.6);
    const pl = slope.placement({ plan: 'sol_rondins', aim: { x: 0, y: 10, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -3 } });
    expect(pl.ok).toBe(true);
    expect(pl.stilts).toBe(2);
    expect(stepsOf('sol_rondins', pl.stilts)[0]!.label).toMatch(/pilotis/);
    const cliff = new BuildState((x) => 10 + x * 3);
    const bad = cliff.placement({ plan: 'sol_rondins', aim: { x: 0, y: 10, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -3 } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/pilotis/);
  });

  it('sur l’eau : pilotis plantés dans le lit du fleuve, jusqu’à 3,5 m de profondeur', () => {
    // Berge à gauche (x < 0), lit du fleuve à 2 m sous l'eau à droite.
    const bank = new BuildState((x) => (x < 0.5 ? WATER_LEVEL + 0.4 : WATER_LEVEL - 2));
    const pl = bank.placement({ plan: 'sol_rondins', aim: { x: 0, y: WATER_LEVEL, z: 0 }, yaw: 0, turn: 0, player: { x: -2, y: WATER_LEVEL + 0.5, z: 0 } });
    expect(pl.ok).toBe(true);
    expect(pl.stilts).toBe(2);
    const deep = new BuildState((x) => (x < 0.5 ? WATER_LEVEL + 0.4 : WATER_LEVEL - 6));
    expect(deep.placement({ plan: 'sol_rondins', aim: { x: 0, y: WATER_LEVEL, z: 0 }, yaw: 0, turn: 0, player: { x: -2, y: WATER_LEVEL + 0.5, z: 0 } }).ok).toBe(false);
  });

  it('un plan voisin s’accroche à la même grille ; deux pièces au même endroit : refusé', () => {
    const bs = new BuildState(flat());
    build(bs, 'sol_rondins', 0, 10, 0);
    const s = bs.structures[0]!;
    const pl = bs.placement({ plan: 'sol_rondins', aim: { x: 2.1, y: 10.15, z: 0.3 }, yaw: 0.4, turn: 0, player: { x: 2, y: 10, z: -3 } });
    expect(pl.ok).toBe(true);
    expect(pl.structure).toBe(s.id);
    expect(pl.slot).toEqual({ t: 'f', i: 1, j: 0, k: 0 });
    const same = bs.placement({ plan: 'sol_rondins', aim: { x: 0.2, y: 10.15, z: 0.1 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -3 } });
    expect(same.ok).toBe(false);
    expect(same.reason).toMatch(/déjà/);
  });

  it('trop loin du joueur ou le joueur dans le chemin : refusé', () => {
    const bs = new BuildState(flat());
    expect(bs.placement({ plan: 'sol_rondins', aim: { x: 0, y: 10, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -9 } }).reason).toMatch(/loin/);
    build(bs, 'sol_rondins', 0, 10, 0);
    const wall = bs.placement({ plan: 'mur_clayonnage', aim: { x: 0, y: 11, z: -1 }, yaw: 0, turn: 0, player: { x: 0, y: 10.15, z: -1 } });
    expect(wall.ok).toBe(false);
    expect(wall.reason).toMatch(/chemin/);
  });
});

describe('stabilité', () => {
  // Rebord : le terrain est à 10 m pour x < 0,2, puis 8 m : un plancher centré en (1, 1) a deux
  // coins sur le rebord et deux pilotis ; seuls les murs du côté du rebord touchent le sol.
  const ledge = (x: number) => (x < 0.2 ? 10 : 8);

  it('murs sur un plancher à pilotis, étage sur les murs, porte-à-faux limité, puis effondrement en cascade', () => {
    const bs = new BuildState(ledge);
    const r0 = build(bs, 'sol_rondins', 1, 10, 1, { player: { x: -1, y: 10, z: 1 } });
    expect(r0.pl.ok, r0.pl.reason ?? '').toBe(true);
    expect(r0.pl.stilts).toBe(2);
    const s = bs.structures[0]!;
    expect(s.pieces[0]!.support).toBeCloseTo(0.95, 6);
    const at = (lx: number, ly: number, lz: number) => toWorld(s, lx, ly, lz);
    const me = { x: -1, y: 10, z: 1 };
    // Quatre murs autour de la case (0, 0).
    for (const [lx, lz] of [
      [1, 0],
      [1, 2],
      [0, 1],
      [2, 1],
    ] as const) {
      const p = at(lx, 1.2, lz);
      const r = build(bs, 'mur_clayonnage', p.x, p.y, p.z, { player: me });
      expect(r.pl.ok, r.pl.reason ?? '').toBe(true);
    }
    const walls = s.pieces.filter((p) => PLANS[p.plan].piece === 'mur');
    expect(walls).toHaveLength(4);
    // Le mur du côté du rebord est planté dans le sol ; les autres tiennent par le plancher.
    expect(walls.filter((w) => w.ground)).toHaveLength(1);
    for (const w of walls) expect(w.support).toBeCloseTo(w.ground ? 1 : 0.95 * 0.93, 5);
    // Plancher d'étage posé sur les murs (le mieux porté : celui du rebord).
    const up = at(1, LEVEL_H + 0.1, 1);
    const r1 = build(bs, 'sol_rondins', up.x, up.y, up.z, { player: me });
    expect(r1.pl.ok, r1.pl.reason ?? '').toBe(true);
    expect(r1.pl.slot).toEqual({ t: 'f', i: 0, j: 0, k: 1 });
    expect(bs.piece(s.id, (r1.ref as { p: number }).p)!.support).toBeCloseTo(0.88, 5);
    // Case voisine portée par le mur du milieu, puis une case en porte-à-faux ; la suivante, non.
    const c1 = at(3, LEVEL_H + 0.1, 1);
    expect(build(bs, 'sol_rondins', c1.x, c1.y, c1.z, { player: { x: s.x + 3, y: 8, z: s.z - 2 } }).pl.support).toBeCloseTo(0.95 * 0.93 * 0.88, 5);
    const c2 = at(5, LEVEL_H + 0.1, 1);
    const r2 = build(bs, 'sol_rondins', c2.x, c2.y, c2.z, { player: { x: s.x + 5, y: 8, z: s.z - 2 } });
    expect(r2.pl.ok, r2.pl.reason ?? '').toBe(true);
    expect(r2.pl.support).toBeCloseTo(0.95 * 0.93 * 0.88 * 0.45, 5);
    const c3 = at(7, LEVEL_H + 0.1, 1);
    const r3 = bs.placement({ plan: 'sol_rondins', aim: c3, yaw: 0, turn: 0, player: { x: s.x + 7, y: 8, z: s.z - 2 } });
    expect(r3.ok).toBe(false);
    expect(r3.reason).toMatch(/appui/);
    // On retire le plancher du bas. Le mur planté dans le sol tient, et ses deux voisins s'y
    // accrochent (faiblement) ; le mur d'en face ne tient plus, ni la case en porte-à-faux.
    const floor = s.pieces.find((p) => p.slot.t === 'f' && p.slot.k === 0)!;
    bs.remove(s.id, floor.id);
    const weak = bs.unstable();
    expect(weak.map((u) => u.p.plan).sort()).toEqual(['mur_clayonnage', 'sol_rondins']);
    for (const w of s.pieces.filter((p) => PLANS[p.plan].piece === 'mur' && !p.ground && p.support >= COLLAPSE_AT)) expect(w.support).toBeCloseTo(0.3, 5);
    // Effondrement en cascade : on retire ce qui ne tient plus, jusqu'à ce que tout soit stable.
    let waves = 0;
    for (let list = bs.unstable(); list.length && waves < 10; list = bs.unstable(), waves++) for (const u of list) bs.remove(u.s.id, u.p.id);
    expect(waves).toBeGreaterThanOrEqual(1);
    const left = s.pieces.map((p) => `${p.plan}@${p.slot.t}${p.slot.k}`).sort();
    expect(left).toEqual(['mur_clayonnage@e0', 'mur_clayonnage@e0', 'mur_clayonnage@e0', 'sol_rondins@f1', 'sol_rondins@f1']);
    expect(s.pieces.every((p) => p.support >= COLLAPSE_AT)).toBe(true);
  });

  it('la pierre porte bien vers le haut, mais mal posée sur du bois', () => {
    const bs = new BuildState(ledge);
    build(bs, 'sol_rondins', 1, 10, 1, { player: { x: -1, y: 10, z: 1 } });
    const s = bs.structures[0]!;
    const p = toWorld(s, 1, 1.2, 0);
    // Mur de pierre sur un plancher de bois : transmission réduite.
    const stone = bs.placement({ plan: 'mur_pierre', aim: p, yaw: 0, turn: 0, player: { x: -1, y: 10, z: 1 } });
    expect(stone.ok).toBe(true);
    expect(stone.support).toBeCloseTo(0.95 * 0.93 * 0.75, 5);
    const wood = bs.placement({ plan: 'mur_clayonnage', aim: p, yaw: 0, turn: 0, player: { x: -1, y: 10, z: 1 } });
    expect(wood.support).toBeCloseTo(0.95 * 0.93, 5);
  });

  it('un toit se pose sur des murs ou des poteaux, jamais seul', () => {
    const bs = new BuildState(flat());
    const alone = bs.placement({ plan: 'toit_chaume', aim: { x: 0, y: 12, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 10, z: -3 } });
    expect(alone.ok).toBe(false);
    // Quatre poteaux plantés dans le sol, puis le toit.
    build(bs, 'poteau', 0, 10, 0);
    const s = bs.structures[0]!;
    for (const [lx, lz] of [
      [GRID, 0],
      [0, GRID],
      [GRID, GRID],
    ] as const) {
      const w = toWorld(s, lx, 0.5, lz);
      expect(build(bs, 'poteau', w.x, w.y, w.z, { player: { x: s.x - 2, y: s.y, z: s.z - 2 } }).pl.ok).toBe(true);
    }
    const roofAim = toWorld(s, GRID / 2, 1.5, GRID / 2);
    const roof = build(bs, 'toit_chaume', roofAim.x, roofAim.y, roofAim.z, { player: { x: s.x - 1, y: s.y, z: s.z - 1 } });
    expect(roof.pl.ok, roof.pl.reason ?? '').toBe(true);
    expect(roof.pl.slot).toEqual({ t: 'r', i: 0, j: 0, k: 0 });
    expect(roof.pl.support).toBeCloseTo(0.9, 5);
  });

  it('un chantier reçoit un appui mais n’en donne pas', () => {
    const bs = new BuildState(flat());
    const pl = bs.placement({ plan: 'sol_rondins', aim: { x: 1, y: 10, z: 1 }, yaw: 0, turn: 0, player: { x: 1, y: 10, z: -2 } });
    const ref = bs.apply(pl) as { s: string; p: number };
    const s = bs.structure(ref.s)!;
    const w = toWorld(s, 1, 1.2, 0);
    const wall = bs.placement({ plan: 'mur_clayonnage', aim: w, yaw: 0, turn: 0, player: { x: s.x + 1, y: s.y, z: s.z - 2 } });
    // Le mur est planté dans le sol plat : il tient quand même, mais pas grâce au chantier.
    expect(wall.support).toBe(1);
    expect(bs.piece(ref.s, ref.p)!.support).toBe(1);
  });
});

describe('dégâts, feu, réparation, recyclage', () => {
  it('les dégâts dépendent du matériau et de l’outil', () => {
    expect(damageFor('bois', 'hache', 1)).toBe(18);
    expect(damageFor('pierre', 'hache', 1)).toBe(1);
    expect(damageFor('pierre', 'percuteur', 1)).toBe(7);
    expect(damageFor('torchis', 'percuteur', 1)).toBe(12);
    expect(damageFor('chaume', 'main', 1)).toBe(3);
    expect(damageFor('pierre', 'main', 1)).toBe(0);
    expect(damageFor('torchis', 'feu', 1)).toBe(0);
    expect(damageFor('chaume', 'feu', 1)).toBeGreaterThan(damageFor('bois', 'feu', 1));
    expect(combustible('bois') && combustible('chaume') && !combustible('torchis') && !combustible('pierre')).toBe(true);
  });

  it('points de vie : abîmer, réparer, détruire ; le torchis renforce et ne brûle plus ; le fer renforce', () => {
    const bs = new BuildState(flat());
    build(bs, 'sol_rondins', 1, 10, 1);
    const s = bs.structures[0]!;
    const w = toWorld(s, 1, 1.2, 0);
    const r = build(bs, 'mur_clayonnage', w.x, w.y, w.z, { player: { x: s.x + 1, y: s.y, z: s.z + 1 } });
    const ref = r.ref as { s: string; p: number };
    const wall = bs.piece(ref.s, ref.p)!;
    expect(wall.hp).toBe(220);
    expect(bs.damage(ref.s, ref.p, 150)).toBe(false);
    expect(bs.repair(ref.s, ref.p)).toBe(true);
    expect(wall.hp).toBe(70 + 88);
    expect(bs.plaster(ref.s, ref.p)).toBe(true);
    expect(wall.mat).toBe('torchis');
    expect(wall.hp).toBeGreaterThanOrEqual(240);
    expect(combustible(wall.mat)).toBe(false);
    expect(maxHp({ plan: 'porte', mat: 'bois', iron: true })).toBe(260);
    expect(bs.damage(ref.s, ref.p, 10000)).toBe(true);
  });

  it('démonter rend une partie des matériaux selon l’état ; les ligatures se perdent', () => {
    const p: Pick<Piece, 'plan' | 'stilts' | 'step' | 'mat'> = { plan: 'mur_clayonnage', stilts: 0, step: 3, mat: 'bois' };
    expect(salvage(p, 1)).toEqual([
      ['perche', 2],
      ['baton', 6],
    ]);
    expect(salvage(p, 0.5)).toEqual([
      ['perche', 1],
      ['baton', 3],
    ]);
    expect(salvage({ plan: 'mur_pierre', stilts: 0, step: 2, mat: 'pierre' }, 0.5)).toEqual([['pierre', 20]]);
  });
});

describe('installations, connaissances, sauvegarde', () => {
  it('un puits seulement près de l’eau ; une installation sur un plancher terminé', () => {
    const high = new BuildState(flat(WATER_LEVEL + 20));
    expect(high.placement({ plan: 'puits', aim: { x: 0, y: WATER_LEVEL + 20, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 0, z: -3 } }).reason).toMatch(/profonde/);
    const low = new BuildState(flat(WATER_LEVEL + 2));
    const ok = low.placement({ plan: 'puits', aim: { x: 0, y: WATER_LEVEL + 2, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 0, z: -3 } });
    expect(ok.ok).toBe(true);
    const bs = new BuildState(flat());
    const r = build(bs, 'sol_rondins', 1, 10, 1);
    const ref = r.ref as { s: string; p: number };
    const chest = bs.placement({ plan: 'coffre', aim: { x: 1, y: 10.15, z: 1 }, yaw: 0, turn: 0, onPiece: ref, player: { x: 1, y: 10, z: -2 } });
    expect(chest.ok, chest.reason ?? '').toBe(true);
    expect(chest.free?.on).toEqual(ref);
    expect(chest.free?.y).toBeCloseTo(10.15, 6);
    const site = bs.apply(chest) as { site: string };
    expect(bs.site(site.site)?.plan).toBe('coffre');
  });

  it('plans connus au départ ; d’autres appris en ramassant un matériau', () => {
    const known = startingPlans();
    expect(known).toContain('mur_clayonnage');
    expect(known).toContain('mur_pierre');
    expect(known).not.toContain('fourneau');
    expect(plansFrom(known, 'pot')).toEqual(['puits']);
    expect(plansFrom(known, 'minerai_fer')).toEqual(['fourneau']);
    expect(plansFrom(known, 'minerai_fer')).toEqual([]);
    expect(readPlans(['forge', 'n’importe quoi', 42])).toEqual([...startingPlans(), 'forge']);
  });

  it('sauvegarde et relecture ; données trafiquées ignorées', () => {
    const bs = new BuildState(flat());
    build(bs, 'sol_rondins', 1, 10, 1);
    const s = bs.structures[0]!;
    const w = toWorld(s, 1, 1.2, 0);
    build(bs, 'porte', w.x, w.y, w.z, { player: { x: s.x + 1, y: s.y, z: s.z + 1 } });
    const door = s.pieces.find((p) => p.plan === 'porte')!;
    bs.toggleDoor(s.id, door.id);
    bs.damage(s.id, door.id, 30);
    bs.apply(bs.placement({ plan: 'etabli', aim: { x: 8, y: 10, z: 8 }, yaw: 0, turn: 0, player: { x: 8, y: 10, z: 5 } }));
    const saved = JSON.parse(JSON.stringify(bs.serialize()));
    const back = new BuildState(flat());
    back.restore(saved);
    expect(JSON.stringify(back.serialize())).toBe(JSON.stringify(saved));
    const d2 = back.structures[0]!.pieces.find((p) => p.plan === 'porte')!;
    expect(d2.open).toBe(true);
    expect(d2.hp).toBe(170);
    expect(d2.support).toBeGreaterThan(0.8);
    // Un nouvel identifiant ne reprend jamais un ancien.
    const pl = back.placement({ plan: 'sol_rondins', aim: { x: 40, y: 10, z: 40 }, yaw: 0, turn: 0, player: { x: 40, y: 10, z: 37 } });
    const ref = back.apply(pl) as { s: string };
    expect(ref.s).not.toBe(s.id);
    const junk = new BuildState(flat());
    junk.restore({ structures: [{ id: 's1', x: 0, y: 0, z: 0, yaw: 0, pieces: [{ id: 1, plan: 'coffre', slot: { t: 'f', i: 0, j: 0, k: 0 } }, { id: 2, plan: 'sol_rondins', slot: { t: 'e', i: 0, j: 0, k: 0 } }, { id: 3, plan: 'sol_rondins', slot: { t: 'f', i: 0, j: 0, k: 0 }, step: 99, hp: 1e9 }] }], sites: [{ id: 'x', plan: 'mur_pierre' }] });
    expect(junk.structures[0]!.pieces).toHaveLength(1);
    expect(junk.structures[0]!.pieces[0]!.hp).toBe(260);
    expect(junk.sites).toEqual([]);
    const empty = new BuildState(flat());
    empty.restore(undefined);
    expect(empty.structures).toEqual([]);
  });

  it('stabilité recalculée identique après relecture (déterminisme)', () => {
    const bs = new BuildState(flat());
    build(bs, 'sol_rondins', 1, 10, 1);
    const s = bs.structures[0]!;
    const before = s.pieces.map((p) => p.support);
    computeSupport(s);
    expect(s.pieces.map((p) => p.support)).toEqual(before);
    expect(pieceTransform(s, s.pieces[0]!.slot).y).toBeCloseTo(10.15, 6);
  });
});
