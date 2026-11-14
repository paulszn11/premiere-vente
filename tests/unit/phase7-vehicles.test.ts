// Phase 7 : véhicules (pièces, masse, équilibre, machine à vapeur, usure, pannes, réparations),
// physique des roues et de la flottaison, conduite, machines et transmission.

import { beforeAll, describe, expect, it } from 'vitest';
import { type PlayerAction, readAction } from '../../src/shared/actions';
import { PLANS } from '../../src/shared/building';
import { EYE_HEIGHT, TICK_DT, WATER_LEVEL } from '../../src/shared/constants';
import { ensureToolMeta } from '../../src/shared/crafting';
import { RECIPES } from '../../src/shared/crafting';
import { type ItemStack, countOf, store } from '../../src/shared/inventory';
import { ITEMS } from '../../src/shared/items';
import { MACHINES, newMachine, powerNetwork, waterWheelPower } from '../../src/shared/machines';
import { BTN_INTERACT } from '../../src/shared/movement';
import { PhysicsWorld, initPhysics } from '../../src/shared/physics';
import { type PropKind, itemShape } from '../../src/shared/props';
import { LocalSimulation, type SimEvent } from '../../src/shared/simulation';
import { type DriveInput, VehiclePhysics } from '../../src/shared/vehicle-physics';
import {
  ENGINE,
  FRAMES,
  FRAME_KINDS,
  PARTS,
  PART_KINDS,
  type VehicleEvent,
  type VehicleState,
  isAfloat,
  makeVehicle,
  massProps,
  missingForRolling,
  readVehicles,
  repairPart,
  stepEngine,
  uprightness,
  wearParts,
  yawOf,
} from '../../src/shared/vehicles';
import { FlatTerrain, FnTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const LEVEL = 10;
const log = (): ItemStack => ({ item: 'buche', count: 1, mass: 5, radius: 0.07, length: 0.6 });
const tool = (item: ItemStack['item']): ItemStack => {
  const st: ItemStack = { item, count: 1 };
  ensureToolMeta(st, 75);
  return st;
};
const all = (v: VehicleState) => {
  for (const sd of FRAMES[v.frame].slots) v.parts.push({ slot: sd.id, kind: sd.part, wear: 0, broken: false, q: 60 });
  return v;
};

/** Rive : terre ferme pour x < 3, puis le fond descend (0,5 m d'eau de plus par mètre). */
class ShoreTerrain extends FnTerrain {
  constructor(private readonly flow = 0) {
    super((x) => 1.5 - 0.5 * x);
  }
  override currentAt(x: number, z: number): { x: number; z: number } {
    return { x: this.heightAt(x, z) < WATER_LEVEL ? this.flow : 0, z: 0 };
  }
}

function setup(terrain: FnTerrain = new FlatTerrain(LEVEL), opts: { fauna?: boolean } = {}) {
  const s = new LocalSimulation(terrain, opts.fauna ? { fauna: true } : {});
  if (opts.fauna) s.fauna.wild = false;
  const events: SimEvent[] = [];
  let yaw = 0;
  let pitch = 0;
  const run = (n: number, wx = 0, wz = 0, buttons = 0) => {
    for (let i = 0; i < n; i++) {
      s.step(cmd(wx, wz, buttons, yaw, pitch));
      events.push(...s.takeEvents());
    }
  };
  const look = (y: number, p = 0) => {
    yaw = y;
    pitch = p;
  };
  const aim = (x: number, y: number, z: number) => {
    const st = s.state;
    const eye = st.y + EYE_HEIGHT;
    yaw = Math.atan2(x - st.x, z - st.z);
    pitch = Math.atan2(eye - y, Math.hypot(x - st.x, z - st.z));
    run(2);
  };
  const act = (a: PlayerAction) => s.act(a);
  const work = (times: number, seconds = 11) => {
    const out = [];
    for (let i = 0; i < times; i++) {
      out.push(s.act({ type: 'utiliser' }));
      run(Math.round(60 * seconds));
    }
    return out;
  };
  const of = (type: SimEvent['type']) => events.filter((e) => e.type === type);
  const messages = () => events.filter((e) => e.type === 'message').map((e) => (e as { text: string }).text);
  run(30);
  return { s, run, look, aim, act, work, events, of, messages, yaw: () => yaw };
}

/** Physique seule : un monde, des véhicules, des commandes. */
function bench(terrain: FnTerrain) {
  const phys = new PhysicsWorld(terrain);
  phys.ensureAround([{ x: 0, z: 0 }], 3, 0);
  phys.refresh();
  const vp = new VehiclePhysics(phys, terrain);
  const run = (v: VehicleState, n: number, input: DriveInput | null) => {
    for (let i = 0; i < n; i++) {
      vp.sync([v], input ? v.id : null);
      vp.preStep(v, input, TICK_DT);
      phys.step(TICK_DT);
      vp.postStep(v, input);
    }
  };
  return { phys, vp, run };
}
const drive = (throttle: number, steer = 0, extra: Partial<DriveInput> = {}): DriveInput => ({ throttle, steer, brake: false, sprint: false, effort: 1, seated: true, ...extra });

describe('mécanique : pièces, masse, machine à vapeur, usure', () => {
  it('catalogue cohérent : chaque emplacement attend une pièce connue ; chaque pièce a son objet et sa recette', () => {
    for (const k of FRAME_KINDS) {
      const f = FRAMES[k];
      expect(f.mass).toBeGreaterThan(0);
      expect(f.hp).toBeGreaterThan(0);
      expect(PLANS[k].vehicle).toBe(k);
      for (const sd of f.slots) expect(PART_KINDS).toContain(sd.part);
      if (f.medium === 'terre') expect(f.wheel).toBeDefined();
      else expect(f.hull!.points.length).toBeGreaterThanOrEqual(8);
    }
    for (const k of PART_KINDS) {
      const d = PARTS[k];
      expect(ITEMS[d.item]).toBeDefined();
      expect(RECIPES[d.item as keyof typeof RECIPES]).toBeDefined();
      expect(d.repair.length).toBeGreaterThan(0);
    }
  });

  it('masse et centre de gravité : les pièces et le conducteur comptent, la machine remonte le centre de gravité', () => {
    const v = makeVehicle('v', 'chariot', 0, 0, 0, 0);
    const bare = massProps(v, false);
    expect(bare.mass).toBe(FRAMES.chariot.mass);
    all(v);
    const full = massProps(v, false);
    expect(full.mass).toBeCloseTo(180 + 4 * 25 + 2 * 12 + 160, 5);
    expect(full.com.z).toBeGreaterThan(bare.com.z);
    const driven = massProps(v, true);
    expect(driven.mass).toBeCloseTo(full.mass + 70, 5);
    expect(missingForRolling(makeVehicle('w', 'chariot_bras', 0, 0, 0, 0))).toMatch(/4 roues/);
    expect(missingForRolling(v)).toBeNull();
  });

  it('chaudière : le bois brûle, la pression monte avec de l’eau ; à sec et à feu vif, elle se fend', () => {
    const v = all(makeVehicle('v', 'chariot', 0, 0, 0, 0));
    const out: VehicleEvent[] = [];
    v.engine = { fuel: 300, lit: true, heat: 0, pressure: 0, water: ENGINE.water };
    for (let t = 0; t < 60; t++) stepEngine(v, 1, 0, out);
    expect(v.engine.heat).toBeGreaterThan(0.85);
    expect(v.engine.pressure).toBeGreaterThan(0.75);
    expect(v.engine.fuel).toBeLessThan(300);
    // Pleine charge : l'eau s'évapore bien plus vite.
    const idle = v.engine.water;
    for (let t = 0; t < 30; t++) stepEngine(v, 1, 1, out);
    expect(idle - v.engine.water).toBeGreaterThan(1.5);
    // Plus de bois : le feu s'éteint et la pression retombe.
    v.engine.fuel = 5;
    for (let t = 0; t < 120; t++) stepEngine(v, 1, 0, out);
    expect(out.some((e) => e.type === 'feu_eteint')).toBe(true);
    expect(v.engine.pressure).toBeLessThan(0.2);
    // À sec, feu vif : surchauffe, la machine casse.
    const w = all(makeVehicle('w', 'chariot', 0, 0, 0, 0));
    w.engine = { fuel: 600, lit: true, heat: 1, pressure: 1, water: 1 };
    const out2: VehicleEvent[] = [];
    for (let t = 0; t < 60; t++) stepEngine(w, 1, 1, out2);
    expect(out2.some((e) => e.type === 'plus_d_eau')).toBe(true);
    expect(out2.some((e) => e.type === 'panne' && e.reason === 'surchauffe')).toBe(true);
    expect(w.parts.find((p) => p.kind === 'machine_vapeur')!.broken).toBe(true);
  });

  it('usure et pannes : la distance et la charge usent, une pièce très usée finit par casser, réparer la remet en service', () => {
    const v = all(makeVehicle('v', 'chariot_bras', 0, 0, 0, 0));
    const out: VehicleEvent[] = [];
    wearParts(v, 1000, 60, 0, 0, () => 0.99, out);
    const w1 = v.parts[0]!.wear;
    expect(w1).toBeGreaterThan(0.02);
    // Chargé, la même distance use davantage.
    const u = all(makeVehicle('u', 'chariot_bras', 0, 0, 0, 0));
    wearParts(u, 1000, 300, 0, 0, () => 0.99, out);
    expect(u.parts[0]!.wear).toBeGreaterThan(w1);
    // Neuve : aucun risque de panne ; très usée : la panne arrive.
    expect(out).toHaveLength(0);
    for (const p of v.parts) p.wear = 0.92;
    let km = 0;
    while (!v.parts.some((p) => p.broken) && km < 50) {
      wearParts(v, 200, 60, 0, 0, () => 0.05, out);
      km += 0.2;
    }
    const broken = v.parts.find((p) => p.broken)!;
    expect(broken).toBeDefined();
    expect(out.some((e) => e.type === 'panne')).toBe(true);
    repairPart(broken);
    expect(broken.broken).toBe(false);
    expect(broken.wear).toBeLessThan(0.5);
  });
});

describe('physique des véhicules', () => {
  it('chariot à bras : poussé, il plafonne à la vitesse de la marche ; lâché, il s’arrête ; il tourne', () => {
    const b = bench(new FlatTerrain(LEVEL));
    const v = all(makeVehicle('c', 'chariot_bras', 0, LEVEL + 0.05, 0, 0));
    b.run(v, 90, null);
    expect(v.y).toBeGreaterThan(LEVEL - 0.1);
    expect(uprightness(v)).toBeGreaterThan(0.99);
    b.run(v, 300, drive(1));
    const speed = b.vp.speedOf('c');
    expect(speed).toBeGreaterThan(1.5);
    expect(speed).toBeLessThan(FRAMES.chariot_bras.maxHuman + 0.3);
    expect(v.z).toBeGreaterThan(5);
    b.run(v, 120, drive(1, 1));
    expect(yawOf(v)).toBeGreaterThan(0.6);
    b.run(v, 90, null);
    expect(Math.abs(b.vp.speedOf('c'))).toBeLessThan(0.1);
  });

  it('chariot à vapeur : assis sans pression il ne bouge pas ; la machine l’emmène à 5 m/s ; on freine', () => {
    const b = bench(new FlatTerrain(LEVEL));
    const v = all(makeVehicle('c', 'chariot', 0, LEVEL + 0.05, 0, 0));
    // Assis aux commandes, personne ne pousse : effort nul.
    b.run(v, 60, drive(1, 0, { effort: 0 }));
    expect(b.vp.speedOf('c')).toBeLessThan(0.3);
    v.engine = { fuel: 600, lit: true, heat: 1, pressure: 1, water: ENGINE.water };
    b.run(v, 600, drive(1));
    expect(b.vp.speedOf('c')).toBeGreaterThan(4.5);
    expect(b.vp.speedOf('c')).toBeLessThan(5.6);
    expect(uprightness(v)).toBeGreaterThan(0.95);
    b.run(v, 120, drive(0, 0, { brake: true }));
    expect(Math.abs(b.vp.speedOf('c'))).toBeLessThan(0.6);
  });

  it('un chariot à qui il manque une roue reste calé : il ne bouge pas', () => {
    const b = bench(new FlatTerrain(LEVEL));
    const v = all(makeVehicle('c', 'chariot_bras', 0, LEVEL + 0.02, 0, 0));
    v.parts.splice(0, 1);
    b.run(v, 120, drive(1));
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.01);
    expect(v.y).toBeCloseTo(LEVEL + 0.02, 3);
  });

  it('radeau et pirogue flottent ; la pirogue, fine, va plus vite à la pagaie ; le radeau tourne', () => {
    const terrain = new FlatTerrain(-4);
    const b = bench(terrain);
    const raft = makeVehicle('r', 'radeau', 0, 0.2, 0, 0);
    b.run(raft, 240, drive(0));
    expect(raft.y).toBeGreaterThan(-0.1);
    expect(raft.y).toBeLessThan(0.25);
    expect(uprightness(raft)).toBeGreaterThan(0.98);
    b.run(raft, 600, drive(1));
    const raftSpeed = b.vp.speedOf('r');
    expect(raftSpeed).toBeGreaterThan(0.9);
    b.run(raft, 300, drive(0.3, 1));
    expect(Math.abs(yawOf(raft))).toBeGreaterThan(1);
    const b2 = bench(terrain);
    const canoe = makeVehicle('p', 'pirogue', 0, 0.2, 0, 0);
    b2.run(canoe, 240, drive(0));
    b2.run(canoe, 600, drive(1));
    expect(b2.vp.speedOf('p')).toBeGreaterThan(raftSpeed + 0.4);
    expect(uprightness(canoe)).toBeGreaterThan(0.95);
  });

  it('équilibre : sur un dévers trop fort le chariot se renverse, sur un dévers léger il passe', () => {
    const roll = (deg: number) => {
      const t = Math.tan((deg * Math.PI) / 180);
      // Plat pour z < 0, puis un dévers (pente vers -x) qui s'installe sur 4 m.
      const terrain = new FnTerrain((x, z) => LEVEL + x * t * Math.max(0, Math.min(1, z / 4)));
      const b = bench(terrain);
      const v = all(makeVehicle('c', 'chariot', 0, LEVEL + 0.05, -6, 0));
      v.engine = { fuel: 600, lit: true, heat: 1, pressure: 1, water: ENGINE.water };
      let worst = 1;
      for (let i = 0; i < 8 * 60; i++) {
        b.run(v, 1, drive(v.z < 8 ? 0.5 : 0));
        worst = Math.min(worst, uprightness(v));
      }
      return worst;
    };
    // Angle de stabilité statique : atan(demi-voie / hauteur du centre de gravité) ; il bascule à ±4° près.
    const full = all(makeVehicle('m', 'chariot', 0, 0, 0, 0));
    const critical = (Math.atan(0.82 / massProps(full, true).com.y) * 180) / Math.PI;
    expect(critical).toBeGreaterThan(30);
    expect(critical).toBeLessThan(40);
    expect(roll(10)).toBeGreaterThan(0.9);
    expect(roll(critical - 4)).toBeGreaterThan(0.5);
    expect(roll(critical + 4)).toBeLessThan(0);
  });
});

describe('simulation : construire, équiper, conduire', () => {
  it('chariot à bras : plan, chantier, il reste calé jusqu’à ses quatre roues, puis on le pousse ; Prendre pour lâcher', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    h.aim(x0, LEVEL, z0 + 3.5);
    const { aim } = s.aimPoint();
    const plan = act({ type: 'planifier', plan: 'chariot_bras', aim, turn: 0, on: null });
    expect(plan.ok, plan.message).toBe(true);
    s.inventory.bag!.push(log(), log(), tool('couteau'), { item: 'perche', count: 2 });
    store(s.inventory, { item: 'corde', count: 2 });
    h.aim(aim.x, aim.y + 0.4, aim.z);
    const steps = h.work(2, 9);
    expect(steps.every((x) => x.ok), steps.map((x) => x.message).join(' / ')).toBe(true);
    expect(s.vehicles).toHaveLength(1);
    const v = s.vehicles[0]!;
    expect(v.frame).toBe('chariot_bras');
    // Prendre sur le châssis : son panneau s'ouvre.
    h.aim(v.x, v.y + 0.55, v.z);
    h.run(1, 0, 0, BTN_INTERACT);
    h.run(2);
    expect(h.of('vehicule').at(-1)).toMatchObject({ v: v.id });
    expect(act({ type: 'vehicule', v: v.id, op: 'monter' }).message).toMatch(/il manque 4 roues/);
    // Quatre petites roues, installées une à une.
    s.inventory.bag!.push({ item: 'petite_roue', count: 4 });
    for (const slot of ['roue_avg', 'roue_avd', 'roue_arg', 'roue_ard']) {
      const r = act({ type: 'vehicule', v: v.id, op: 'installer', slot });
      expect(r.ok, r.message).toBe(true);
      h.run(60 * 4.5);
    }
    expect(v.parts).toHaveLength(4);
    expect(countOf(s.inventory, 'petite_roue')).toBe(0);
    expect(missingForRolling(v)).toBeNull();
    h.run(60);
    // On le pousse : le joueur marche derrière, le chariot avance.
    const r = act({ type: 'vehicule', v: v.id, op: 'monter' });
    expect(r.ok, r.message).toBe(true);
    expect(s.driving).toEqual({ v: v.id, mode: 'pousse' });
    const z1 = v.z;
    const yaw = yawOf(v);
    h.look(yaw);
    h.run(60 * 4, Math.sin(yaw), Math.cos(yaw));
    const moved = Math.hypot(v.x - aim.x, v.z - aim.z);
    expect(moved).toBeGreaterThan(4);
    expect(Math.hypot(s.state.x - v.x, s.state.z - v.z)).toBeLessThan(2);
    expect(v.z).not.toBe(z1);
    h.run(1, 0, 0, BTN_INTERACT);
    h.run(10);
    expect(s.driving).toBeNull();
    s.dispose();
  });

  it('chargement : les bûches et la pierre posées sur le plateau voyagent avec le chariot (ridelles), même en virage', () => {
    const h = setup();
    const { s, act } = h;
    const id = s.spawnVehicle('chariot_bras', s.state.x, s.state.z + 2.5, 0, { parts: 'toutes' });
    h.run(60);
    const v = s.vehicle(id)!;
    const loads = [0, 1, 2].map((k) => s.props.spawnDynamic({ kind: 'buche', x: v.x - 0.2 + k * 0.2, y: v.y + 0.8, z: v.z, rot: 0, radius: 0.07, length: 0.6 }));
    loads.push(s.props.spawnDynamic({ kind: 'pierre', x: v.x, y: v.y + 0.85, z: v.z + 0.4, rot: 0, radius: 0.12, length: 0 }));
    h.run(90);
    expect(act({ type: 'vehicule', v: v.id, op: 'monter' }).ok).toBe(true);
    const z0 = v.z;
    h.look(0);
    h.run(60 * 6, 0, 1);
    h.run(60 * 2, 0.7, 0.7);
    h.run(60 * 2, 0, 0, 1);
    expect(Math.hypot(v.x - s.state.x, v.z - z0)).toBeGreaterThan(8);
    for (const id2 of loads) {
      const p = s.props.position(id2)!;
      expect(Math.hypot(p.x - v.x, p.z - v.z)).toBeLessThan(0.9);
      expect(p.y - v.y).toBeGreaterThan(0.55);
    }
    s.dispose();
  });

  it('coffre du véhicule : on y range de petits objets (volume et charge maximaux), leur masse compte, il est sauvegardé', () => {
    const h = setup();
    const { s, act } = h;
    const id = s.spawnVehicle('chariot_bras', s.state.x, s.state.z + 2.5, 0, { parts: 'toutes' });
    h.run(30);
    const v = s.vehicle(id)!;
    const m0 = massProps(v, false).mass;
    s.inventory.bag!.push({ item: 'clous', count: 20 }, { item: 'corde', count: 3 });
    const at = (item: string) => s.inventory.bag!.findIndex((x) => x.item === item);
    expect(act({ type: 'deposer_dans', prop: id, from: { zone: 'sac', index: at('clous') } }).ok).toBe(true);
    expect(act({ type: 'deposer_dans', prop: id, from: { zone: 'sac', index: at('corde') } }).ok).toBe(true);
    expect(v.cargo.bag!.map((x) => x.item).sort()).toEqual(['clous', 'corde']);
    expect(massProps(v, false).mass).toBeGreaterThan(m0);
    // Trop lourd : le coffre du chariot à bras porte 250 kg au plus.
    const max = FRAMES.chariot_bras.cargo.maxKg;
    const load = () => massProps(v, false).mass - m0;
    // On le remplit à 3 kg de sa charge maximale avec des barres de fer.
    const bar = ITEMS.barre_fer.mass;
    v.cargo.bag!.push({ item: 'barre_fer', count: Math.floor((max - 3 - load()) / bar) });
    expect(load()).toBeGreaterThan(max - 3 - bar);
    s.inventory.bag!.push({ item: 'pierre', count: 1, mass: 6, radius: 0.08 });
    const r = act({ type: 'deposer_dans', prop: id, from: { zone: 'sac', index: at('pierre') } });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/plein/);
    expect(load()).toBeLessThanOrEqual(max + 1e-6);
    expect(countOf(s.inventory, 'pierre')).toBe(1);
    v.cargo.bag!.splice(2);
    // On reprend tout ; trop loin, plus rien.
    expect(act({ type: 'prendre_dans', prop: id, from: { zone: 'sac', index: 0 } }).ok).toBe(true);
    s.inventory.bag!.push({ item: 'clous', count: 5 });
    expect(act({ type: 'deposer_dans', prop: id, from: { zone: 'sac', index: at('clous') } }).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(s.serialize()));
    const back = new LocalSimulation(new FlatTerrain(LEVEL), { save: saved });
    expect(back.vehicles[0]!.cargo.bag!.length).toBe(v.cargo.bag!.length);
    back.dispose();
    s.teleport(s.state.x + 30, LEVEL + 0.1, s.state.z);
    h.run(5);
    expect(act({ type: 'tout_prendre', prop: id }).message).toMatch(/Trop loin/);
    s.dispose();
  });

  it('chariot à vapeur : bois, eau, feu, la pression monte, on conduit ; sauvegarde et reprise', () => {
    const h = setup();
    const { s, act } = h;
    const id = s.spawnVehicle('chariot', s.state.x, s.state.z + 4, 0, { parts: 'toutes' });
    h.run(60);
    const v = s.vehicle(id)!;
    expect(act({ type: 'vehicule', v: id, op: 'allumer' }).message).toMatch(/pas de bois/);
    s.inventory.bag!.push(log(), log(), log(), tool('archet'));
    for (let i = 0; i < 3; i++) expect(act({ type: 'vehicule', v: id, op: 'bois' }).ok).toBe(true);
    expect(v.engine.fuel).toBe(3 * ENGINE.fuelLog);
    const pot = tool('pot');
    pot.w = 1;
    s.inventory.bag!.push(pot);
    expect(act({ type: 'vehicule', v: id, op: 'eau' }).ok).toBe(true);
    expect(v.engine.water).toBe(ENGINE.potWater);
    expect(act({ type: 'vehicule', v: id, op: 'eau' }).message).toMatch(/pot plein/);
    expect(act({ type: 'vehicule', v: id, op: 'allumer' }).ok).toBe(true);
    expect(v.engine.lit).toBe(true);
    h.run(60 * 40);
    expect(v.engine.pressure).toBeGreaterThan(0.5);
    const r = act({ type: 'vehicule', v: id, op: 'monter' });
    expect(r.ok, r.message).toBe(true);
    expect(s.driving?.mode).toBe('siege');
    const z1 = v.z;
    h.look(0);
    h.run(60 * 8, 0, 1);
    expect(v.z - z1).toBeGreaterThan(18);
    expect(s.state.z).toBeCloseTo(v.z + FRAMES.chariot.seat!.z, 0);
    expect(s.lastDrive!.speed).toBeGreaterThan(3);
    h.run(60 * 3, 0, 0, 1);
    // Sauvegarde : le véhicule, ses pièces et sa chaudière reviennent ; le joueur reprend à côté.
    const saved = JSON.parse(JSON.stringify(s.serialize()));
    const back = new LocalSimulation(new FlatTerrain(LEVEL), { save: saved });
    expect(back.vehicles).toHaveLength(1);
    const v2 = back.vehicles[0]!;
    expect(v2.parts).toHaveLength(v.parts.length);
    expect(v2.engine.fuel).toBeCloseTo(v.engine.fuel, 3);
    expect(v2.z).toBeCloseTo(v.z, 3);
    expect(Math.hypot(back.state.x - v.x, back.state.z - v.z)).toBeGreaterThan(0.8);
    back.step(cmd(0, 0));
    back.dispose();
    // Une ancienne sauvegarde (sans véhicules) se relit sans erreur.
    delete saved.vehicles;
    const old = new LocalSimulation(new FlatTerrain(LEVEL), { save: saved });
    expect(old.vehicles).toHaveLength(0);
    old.dispose();
    s.dispose();
  });

  it('radeau : assemblé dans l’eau peu profonde, on pagaie (endurance), on descend dans l’eau', () => {
    const h = setup(new ShoreTerrain());
    const { s, act } = h;
    s.teleport(2.2, 0.5, 0);
    h.run(30);
    h.aim(4.6, -0.8, 0);
    const { aim } = s.aimPoint();
    expect(act({ type: 'planifier', plan: 'radeau', aim: { x: 1.8, y: 0.6, z: 0 }, turn: 0, on: null }).message).toMatch(/eau peu profonde/);
    const plan = act({ type: 'planifier', plan: 'radeau', aim, turn: 0, on: null });
    expect(plan.ok, plan.message).toBe(true);
    for (let i = 0; i < 6; i++) s.inventory.bag!.push(log());
    s.inventory.bag!.push({ item: 'perche', count: 2 });
    store(s.inventory, { item: 'corde', count: 4 });
    h.aim(aim.x, 0.4, aim.z);
    const steps = h.work(2, 11);
    expect(steps.every((x) => x.ok), steps.map((x) => x.message).join(' / ')).toBe(true);
    const v = s.vehicles[0]!;
    expect(v.frame).toBe('radeau');
    h.run(120);
    expect(v.y).toBeGreaterThan(-0.15);
    const r = act({ type: 'vehicule', v: v.id, op: 'monter' });
    expect(r.ok, r.message).toBe(true);
    expect(r.message).toMatch(/pagaie/);
    const yaw = yawOf(v);
    h.look(yaw);
    const stamina = s.state.stamina;
    const x1 = v.x;
    h.run(60 * 10, Math.sin(yaw), Math.cos(yaw));
    expect(v.x - x1).toBeGreaterThan(6);
    expect(s.state.stamina).toBeLessThan(stamina - 20);
    expect(s.effortW).toBeGreaterThan(150);
    // On remplit un pot depuis le bateau.
    const pot = tool('pot');
    s.inventory.bag!.push(pot);
    expect(act({ type: 'remplir', from: { zone: 'sac', index: s.inventory.bag!.length - 1 } }).ok).toBe(true);
    h.run(1, 0, 0, BTN_INTERACT);
    h.run(30);
    expect(s.driving).toBeNull();
    expect(s.inWater()).toBe(true);
    s.dispose();
  });

  it('pirogue : creusée dans un tronc couché sur la terre ferme, puis poussée jusqu’à l’eau où elle flotte', () => {
    // Pente douce vers un lac : la rive à x = 6, 1 m de fond à x = 16.
    const h = setup(new FnTerrain((x) => 0.6 - 0.1 * x));
    const { s, act } = h;
    s.teleport(-1, 0.75, 0);
    h.run(30);
    s.knowledge.plans.push('pirogue');
    // Un tronc couché à côté du futur chantier (sans tronc, l'étape est impossible).
    h.aim(2.5, 0.35, 0);
    const { aim } = s.aimPoint();
    const plan = act({ type: 'planifier', plan: 'pirogue', aim, turn: 0, on: null });
    expect(plan.ok, plan.message).toBe(true);
    s.inventory.bag!.push(tool('hache'), tool('archet'), tool('couteau'), { item: 'baton', count: 4 }, { item: 'herbe', count: 2 });
    h.aim(aim.x, aim.y + 0.3, aim.z);
    const noTrunk = act({ type: 'utiliser' });
    expect(noTrunk.ok).toBe(false);
    expect(noTrunk.message).toMatch(/tronc couché/);
    // Couché dans le sens de la pente : il ne roule pas.
    s.props.spawnDynamic({ kind: 'tronc', x: aim.x, y: aim.y + 0.4, z: aim.z + 1.4, rot: 0, radius: 0.2, length: 2.6 });
    h.run(60);
    h.aim(aim.x, aim.y + 0.3, aim.z);
    const steps = h.work(3, 17);
    expect(steps.every((x) => x.ok), steps.map((x) => x.message).join(' / ')).toBe(true);
    expect(s.props.views().some((p) => p.kind === 'tronc')).toBe(false);
    const v = s.vehicles.find((x) => x.frame === 'pirogue')!;
    expect(v, `${JSON.stringify(s.build.sites)} · ${h.messages().slice(-4).join(' | ')}`).toBeDefined();
    h.run(60);
    expect(isAfloat(v)).toBe(false);
    expect(act({ type: 'vehicule', v: v.id, op: 'monter' }).ok).toBe(true);
    expect(act({ type: 'vehicule', v: v.id, op: 'descendre' }).ok).toBe(true);
    h.run(30);
    // On la pousse par la poupe, vers l'eau (la pirogue est dans l'axe de la pente).
    const r = act({ type: 'vehicule', v: v.id, op: 'pousser' });
    expect(r.ok, r.message).toBe(true);
    expect(s.driving).toEqual({ v: v.id, mode: 'pousse' });
    const yaw = yawOf(v);
    h.look(yaw);
    const trace: string[] = [];
    for (let k = 0; k < 40 && s.driving && !isAfloat(v); k++) {
      h.run(30, Math.sin(yaw), Math.cos(yaw));
      trace.push(`${v.x.toFixed(1)},${v.y.toFixed(2)} ${s.lastDrive?.speed.toFixed(2)} ${Math.round(s.effortW)}W`);
    }
    expect(isAfloat(v), `yaw ${yaw.toFixed(2)} · ${trace.slice(0, 8).join(' | ')} · conduite ${JSON.stringify(s.driving)} · ${h.messages().slice(-2).join(' | ')}`).toBe(true);
    h.run(60);
    if (s.driving) h.run(1, 0, 0, BTN_INTERACT);
    h.run(10);
    expect(act({ type: 'vehicule', v: v.id, op: 'monter' }).ok).toBe(true);
    expect(s.driving?.mode).toBe('siege');
    s.dispose();
  });

  it('chocs et pannes : percuter un mur abîme le véhicule ; une créature percutée est blessée', () => {
    const h = setup(new FlatTerrain(LEVEL), { fauna: true });
    const { s, act } = h;
    const id = s.spawnVehicle('chariot', s.state.x + 3, s.state.z, 0, { parts: 'toutes', steam: true });
    h.run(30);
    const v = s.vehicle(id)!;
    expect(act({ type: 'vehicule', v: id, op: 'monter' }).ok).toBe(true);
    h.look(0);
    h.run(60 * 5, 0, 1);
    expect(s.lastDrive!.speed).toBeGreaterThan(4);
    // Une hyène surgit juste devant.
    const [hy] = s.spawnCreatures('hyene', v.x, v.z + 5, 1);
    const hp0 = s.fauna.creatures.get(hy!)!.hp;
    h.run(60 * 2, 0, 1);
    const c = s.fauna.creatures.get(hy!);
    expect(!c || c.dead || c.hp < hp0).toBe(true);
    expect(h.of('touche').length).toBeGreaterThan(0);
    // Un mur de pierre : le choc abîme le chariot (et use les roues).
    h.run(60, 0, 0, 1);
    const hp1 = v.hp;
    const wear1 = v.parts.find((p) => p.kind === 'roue')!.wear;
    const pl = s.build.placement({ plan: 'mur_pierre', aim: { x: v.x, y: LEVEL, z: v.z + 7 }, yaw: Math.PI / 2, turn: 0, player: { x: v.x, y: LEVEL, z: v.z + 2 } });
    expect(pl.ok, pl.reason ?? '').toBe(true);
    const ref = s.build.apply(pl) as { s: string; p: number };
    s.build.piece(ref.s, ref.p)!.step = 99;
    s.build.piece(ref.s, ref.p)!.hp = 900;
    s.build.touch();
    h.run(10);
    h.run(60 * 5, 0, 1);
    expect(v.hp).toBeLessThan(hp1);
    expect(v.parts.find((p) => p.kind === 'roue')!.wear).toBeGreaterThan(wear1);
    s.dispose();
  });

  it('créatures : un véhicule barre leur route, une créature qui le chevauche en est repoussée, l’éléphant le bouscule', () => {
    const h = setup(new FlatTerrain(LEVEL), { fauna: true });
    const { s } = h;
    const id = s.spawnVehicle('chariot', s.state.x + 6, s.state.z, 0, { parts: 'toutes' });
    h.run(60);
    const v = s.vehicle(id)!;
    const env = (s as unknown as { faunaEnv: { ray: (...a: number[]) => number | null; moveRay: (...a: number[]) => number | null } }).faunaEnv;
    // Un rayon de déplacement vers le chariot le rencontre ; la vue passe (on voit le conducteur assis).
    expect(env.moveRay(v.x - 4, LEVEL + 1.1, v.z, 1, 0, 0, 8)).not.toBeNull();
    expect(env.ray(v.x - 4, LEVEL + 1.1, v.z, 1, 0, 0, 8)).toBeNull();
    const piece = (s as unknown as { pieceNear: (x: number, y: number, z: number, r: number) => { s: string } | null }).pieceNear(v.x, LEVEL + 0.8, v.z + 1, 0.5);
    expect(piece?.s).toBe(`veh:${id}`);
    // Une hyène apparue dans le chariot en ressort.
    const [hy] = s.spawnCreatures('hyene', v.x, v.z + 0.3, 1);
    const c = s.fauna.creatures.get(hy!)!;
    c.x = v.x + 0.2;
    c.z = v.z + 0.3;
    h.run(12);
    const lx = Math.abs(c.x - v.x);
    const lz = Math.abs(c.z - v.z);
    expect(lx > FRAMES.chariot.half.x || lz > FRAMES.chariot.half.z).toBe(true);
    // L'éléphant le bouscule : dégâts, le chariot est poussé.
    const [el] = s.spawnCreatures('elephant', v.x - 4, v.z, 1);
    const e0 = s.fauna.creatures.get(el!)!;
    e0.x = v.x - 3.5;
    e0.z = v.z;
    const hp0 = v.hp;
    const x0 = v.x;
    (s as unknown as { creatureHitsVehicle: (id: string, sp: string, dmg: number) => void }).creatureHitsVehicle(id, 'elephant', 60);
    h.run(30);
    expect(v.hp).toBeLessThan(hp0);
    expect(v.x - x0).toBeGreaterThan(0.2);
    s.dispose();
  });

  it('actions validées (véhicule, machine, affûtage à la meule)', () => {
    expect(readAction({ type: 'vehicule', v: 'veh1', op: 'monter' })).toEqual({ type: 'vehicule', v: 'veh1', op: 'monter' });
    expect(readAction({ type: 'vehicule', v: 'veh1', op: 'installer', slot: 'roue_avg' })).toEqual({ type: 'vehicule', v: 'veh1', op: 'installer', slot: 'roue_avg' });
    expect(readAction({ type: 'vehicule', v: 'veh1', op: 'voler' })).toBeNull();
    expect(readAction({ type: 'vehicule', v: 'veh1', op: 'installer', slot: 42 })).toBeNull();
    expect(readAction({ type: 'machine', prop: 'd3', op: 'bois' })).toEqual({ type: 'machine', prop: 'd3', op: 'bois' });
    expect(readAction({ type: 'machine', prop: 'd3', op: 'exploser' })).toBeNull();
    expect(readAction({ type: 'reparer', from: { zone: 'sac', index: 0 }, kind: 'meule' })).toEqual({ type: 'reparer', from: { zone: 'sac', index: 0 }, kind: 'meule' });
    expect(readVehicles([{ id: 'veh1', frame: 'radeau', x: 1, y: 0, z: 2, qx: 0, qy: 0, qz: 0, qw: 1, parts: [{ slot: 'gouvernail', kind: 'gouvernail', wear: 0.2 }, { slot: 'gouvernail', kind: 'roue' }] }, { id: 'x', frame: 'fusee' }])).toHaveLength(1);
  });
});

describe('machines et transmission', () => {
  it('réseau : la puissance des sources est partagée entre les machines reliées (moins de 6 m de proche en proche)', () => {
    const r = powerNetwork([
      { id: 'roue', kind: 'roue_eau', x: 0, z: 0, output: 300 },
      { id: 'meule', kind: 'meule', x: 5, z: 0, output: 0 },
      { id: 'pompe', kind: 'pompe', x: 10, z: 0, output: 0 },
      { id: 'loin', kind: 'soufflet_meca', x: 40, z: 0, output: 0 },
    ]);
    expect(r.get('meule')).toBeCloseTo(300 / (MACHINES.meule.demand + MACHINES.pompe.demand), 5);
    expect(r.get('pompe')).toBeCloseTo(r.get('meule')!, 5);
    expect(r.get('loin')).toBe(0);
    expect(r.get('roue')).toBe(1);
    expect(waterWheelPower(0.75)).toBeGreaterThan(waterWheelPower(0.4));
    expect(waterWheelPower(0)).toBe(0);
    // Théorie de la roue à impulsion : la puissance croît comme le cube de la vitesse de l'eau.
    expect(waterWheelPower(0.8) / waterWheelPower(0.4)).toBeCloseTo(8, 5);
    expect(waterWheelPower(0.75)).toBeGreaterThan(MACHINES.meule.demand + 100);
    expect(waterWheelPower(0.4)).toBeLessThan(MACHINES.meule.demand);
  });

  const machine = (s: LocalSimulation, kind: PropKind, x: number, z: number) =>
    s.props.spawnDynamic({ kind, x, y: s.terrain.heightAt(x, z) + 0.6, z, rot: 0, ...itemShape(kind), fixed: true, machine: newMachine(kind as 'meule') });

  it('machine à vapeur fixe et meule : l’affûtage rend tout le tranchant sans réduire la durabilité maximale', () => {
    const h = setup();
    const { s, act } = h;
    const x0 = s.state.x;
    const z0 = s.state.z;
    const engine = machine(s, 'machine_fixe', x0 + 2.2, z0 + 1.2);
    machine(s, 'meule', x0 - 1.5, z0);
    h.run(40);
    const m = s.props.defOf(engine)!.machine!;
    s.inventory.bag!.push(log(), log(), tool('archet'));
    const pot = tool('pot');
    pot.w = 1;
    s.inventory.bag!.push(pot);
    expect(act({ type: 'machine', prop: engine, op: 'bois' }).ok).toBe(true);
    expect(act({ type: 'machine', prop: engine, op: 'eau' }).ok).toBe(true);
    expect(act({ type: 'machine', prop: engine, op: 'allumer' }).ok).toBe(true);
    expect(s.meuleNearby()).toBe(false);
    h.run(60 * 40);
    expect(m.engine!.pressure).toBeGreaterThan(0.3);
    expect(m.power).toBeGreaterThan(MACHINES.meule.demand);
    expect(s.meuleNearby()).toBe(true);
    const knife = tool('couteau_fer');
    knife.d = 10;
    s.inventory.bag!.push(knife);
    const dm = knife.dm!;
    const r = act({ type: 'reparer', from: { zone: 'sac', index: s.inventory.bag!.length - 1 }, kind: 'meule' });
    expect(r.ok, r.message).toBe(true);
    h.run(60 * 5);
    const sharpened = s.inventory.bag!.find((x) => x.item === 'couteau_fer')!;
    expect(sharpened.d).toBe(dm);
    expect(sharpened.dm).toBe(dm);
    s.dispose();
  });

  it('roue à eau : seulement sur la rive d’un fleuve qui coule ; elle entraîne une meule', () => {
    const still = new LocalSimulation(new ShoreTerrain(0));
    const p0 = still.build.placement({ plan: 'roue_eau', aim: { x: 2.2, y: 0.4, z: 0 }, yaw: 0, turn: 0, player: { x: -1, y: 2, z: 0 } });
    expect(p0.ok).toBe(false);
    expect(p0.reason).toMatch(/courant/);
    still.dispose();
    const h = setup(new ShoreTerrain(0.75));
    const { s } = h;
    s.teleport(0, 1.6, 0);
    h.run(30);
    const p1 = s.build.placement({ plan: 'roue_eau', aim: { x: 2.2, y: 0.4, z: 0 }, yaw: 0, turn: 0, player: { x: 0, y: 1.6, z: 0 } });
    expect(p1.ok, p1.reason ?? '').toBe(true);
    const wheel = machine(s, 'roue_eau', 2.2, 0);
    const grind = machine(s, 'meule', -1, 1);
    h.run(60);
    expect(s.props.defOf(wheel)!.machine!.power).toBeCloseTo(waterWheelPower(0.75), 3);
    expect(s.props.defOf(grind)!.machine!.power).toBe(1);
    s.dispose();
  });

  it('pompe : entraînée, elle remplit la chaudière d’un chariot garé à côté et on y remplit un pot', () => {
    const h = setup(new ShoreTerrain(0.75));
    const { s, act } = h;
    s.teleport(0, 1.6, 0);
    h.run(30);
    machine(s, 'roue_eau', 2.2, 0);
    machine(s, 'pompe', 1.2, 1.5);
    const id = s.spawnVehicle('chariot', -3, 3, 0, { parts: 'toutes' });
    h.run(60 * 5);
    expect(s.vehicle(id)!.engine.water).toBeGreaterThan(5);
    s.teleport(0.5, 1.4, 1.5);
    h.run(30);
    s.inventory.bag!.push(tool('pot'));
    expect(act({ type: 'remplir', from: { zone: 'sac', index: s.inventory.bag!.length - 1 } }).ok).toBe(true);
    s.dispose();
  });

  it('soufflet mécanique : à côté d’un bas fourneau allumé, la fonte avance sans le joueur', () => {
    const h = setup();
    const { s } = h;
    const x0 = s.state.x + 6;
    const z0 = s.state.z;
    const engine = machine(s, 'machine_fixe', x0, z0 + 4);
    const m = s.props.defOf(engine)!.machine!;
    m.engine = { fuel: ENGINE.maxFuel, lit: true, heat: 1, pressure: 1, water: ENGINE.water };
    machine(s, 'soufflet_meca', x0 + 1.5, z0);
    const furnace = s.props.spawnDynamic({ kind: 'fourneau', x: x0, y: LEVEL + 0.7, z: z0, rot: 0, ...itemShape('fourneau'), fixed: true, furnace: { ore: 2, fuel: 3000, lit: true, heat: 20, work: 0, blooms: 0 } });
    const f = s.props.defOf(furnace)!.furnace!;
    h.run(60 * 70);
    expect(f.blooms).toBe(1);
    expect(f.ore).toBe(0);
    s.dispose();
  });
});
