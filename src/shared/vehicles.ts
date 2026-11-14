// Véhicules (phase 7) : châssis, pièces installées, masse et centre de gravité, machine à vapeur
// (bois, eau, chaleur, pression), usure, pannes et réparations. Proposition signalée (section 15 :
// types de véhicules et composants) ; les chiffres sont modifiables. La physique (roues, flottaison)
// est dans vehicle-physics.ts ; tout l'état d'un véhicule tient dans des données sauvegardées.

import { type Owned, readOwned } from './permissions';
import type { Need } from './building';
import { WATER_LEVEL } from './constants';
import { type Container, bagContentMass, readContainer } from './inventory';
import type { ItemId, ToolTag } from './items';

export type FrameKind = 'chariot_bras' | 'chariot' | 'radeau' | 'pirogue';
export type PartKind = 'petite_roue' | 'roue' | 'essieu' | 'machine_vapeur' | 'roue_aubes' | 'gouvernail';
export type Medium = 'terre' | 'eau';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Emplacement d'une pièce sur le châssis (repère du véhicule : avant = +z, droite = +x). */
export interface SlotDef {
  id: string;
  part: PartKind;
  x: number;
  y: number;
  z: number;
  /** Roue directrice (avant) ; essieu : celui de l'avant. */
  front?: boolean;
}

export interface FrameDef {
  id: FrameKind;
  label: string;
  feminine: boolean;
  medium: Medium;
  /** Masse du châssis ou de la coque (kg) et ses points de vie. */
  mass: number;
  hp: number;
  /** Demi-dimensions du collisionneur et hauteur de son centre au-dessus de l'origine du véhicule. */
  half: Vec3;
  cy: number;
  /** Hauteur des ridelles autour du plateau (0 : aucune) : le chargement ne glisse pas dehors. */
  rail: number;
  /** Pieds du conducteur (local) ; joueur qui pousse, derrière (chariots ; bateau échoué qu'on pousse à l'eau). */
  seat: Vec3 | null;
  push: { x: number; z: number } | null;
  cargo: { volume: number; maxKg: number; x: number; y: number; z: number };
  slots: SlotDef[];
  /** Roues : rayon, longueur de suspension au repos (le centre d'une roue est à la hauteur de son emplacement quand la suspension porte le véhicule à vide). */
  wheel?: { radius: number; rest: number };
  /** Coque : volume utile (m³), points de flottaison (x, z), fond et hauteur de coque, traînées. */
  hull?: { volume: number; points: Array<[number, number]>; bottom: number; height: number; dragLong: number; dragLat: number };
  /** Force du joueur qui pagaie ou qui pousse (N). */
  human: number;
  /** Braquage maximal des roues avant (rad) ; couple de virage d'un bateau (N·m). */
  steer: number;
  /** Vitesse maximale (m/s) : à la force humaine, au moteur. */
  maxHuman: number;
  maxEngine: number;
}

export interface PartDef {
  id: PartKind;
  item: ItemId;
  label: string;
  feminine: boolean;
  mass: number;
  /** Usure par kilomètre parcouru, ou par heure de marche (machine, roue à aubes). */
  perKm: number;
  perHour: number;
  repair: Need[];
  repairTool: ToolTag | null;
  /** Installer (ou retirer) la pièce : durée, outil, fixations consommées. */
  install: { seconds: number; tool: ToolTag | null; needs: Need[] };
}

const WHEELS4 = (part: PartKind, x: number, y: number, z: number): SlotDef[] => [
  { id: 'roue_avg', part, x: -x, y, z, front: true },
  { id: 'roue_avd', part, x, y, z, front: true },
  { id: 'roue_arg', part, x: -x, y, z: -z },
  { id: 'roue_ard', part, x, y, z: -z },
];

export const FRAMES: Record<FrameKind, FrameDef> = {
  chariot_bras: {
    id: 'chariot_bras',
    label: 'chariot à bras',
    feminine: false,
    medium: 'terre',
    mass: 45,
    hp: 200,
    half: { x: 0.45, y: 0.08, z: 0.75 },
    cy: 0.55,
    rail: 0.26,
    seat: null,
    push: { x: 0, z: -1.45 },
    cargo: { volume: 150, maxKg: 250, x: 0, y: 0.75, z: 0 },
    slots: WHEELS4('petite_roue', 0.42, 0.22, 0.55),
    wheel: { radius: 0.22, rest: 0.12 },
    human: 320,
    steer: 0.6,
    maxHuman: 1.9,
    maxEngine: 0,
  },
  chariot: {
    id: 'chariot',
    label: 'chariot',
    feminine: false,
    medium: 'terre',
    mass: 180,
    hp: 500,
    half: { x: 0.75, y: 0.1, z: 1.5 },
    cy: 0.95,
    rail: 0.32,
    seat: { x: 0, y: 1.3, z: -1.15 },
    push: { x: 0, z: -2.1 },
    cargo: { volume: 300, maxKg: 600, x: 0, y: 1.3, z: -0.25 },
    slots: [
      ...WHEELS4('roue', 0.82, 0.5, 1.1),
      { id: 'essieu_av', part: 'essieu', x: 0, y: 0.5, z: 1.1, front: true },
      { id: 'essieu_ar', part: 'essieu', x: 0, y: 0.5, z: -1.1 },
      { id: 'machine', part: 'machine_vapeur', x: 0, y: 1.45, z: 0.95 },
    ],
    wheel: { radius: 0.5, rest: 0.18 },
    human: 320,
    steer: 0.5,
    maxHuman: 1.2,
    maxEngine: 5,
  },
  radeau: {
    id: 'radeau',
    label: 'radeau',
    feminine: false,
    medium: 'eau',
    mass: 160,
    hp: 350,
    half: { x: 1.2, y: 0.18, z: 1.5 },
    cy: 0,
    rail: 0,
    seat: { x: 0, y: 0.18, z: 0.55 },
    push: { x: 0, z: -2.1 },
    cargo: { volume: 400, maxKg: 500, x: 0, y: 0.4, z: 0.3 },
    slots: [
      { id: 'machine', part: 'machine_vapeur', x: 0, y: 0.75, z: -0.55 },
      { id: 'aubes', part: 'roue_aubes', x: 0, y: 0.05, z: -1.8 },
      { id: 'gouvernail', part: 'gouvernail', x: 0.95, y: 0, z: -1.6 },
    ],
    hull: {
      volume: 1.5,
      points: [
        [-1, -1.2],
        [0, -1.2],
        [1, -1.2],
        [-1, 0],
        [0, 0],
        [1, 0],
        [-1, 1.2],
        [0, 1.2],
        [1, 1.2],
      ],
      bottom: -0.18,
      height: 0.36,
      dragLong: 140,
      dragLat: 1100,
    },
    human: 220,
    steer: 250,
    maxHuman: 1.4,
    maxEngine: 3,
  },
  pirogue: {
    id: 'pirogue',
    label: 'pirogue',
    feminine: true,
    medium: 'eau',
    mass: 90,
    hp: 250,
    half: { x: 0.33, y: 0.22, z: 2.4 },
    cy: 0,
    rail: 0,
    seat: { x: 0, y: -0.08, z: -0.7 },
    push: { x: 0, z: -2.9 },
    cargo: { volume: 150, maxKg: 150, x: 0, y: 0.05, z: 0.9 },
    slots: [],
    hull: {
      volume: 0.72,
      points: [
        [-0.22, -2],
        [0.22, -2],
        [-0.25, -1],
        [0.25, -1],
        [-0.27, 0],
        [0.27, 0],
        [-0.25, 1],
        [0.25, 1],
        [-0.2, 2],
        [0.2, 2],
      ],
      bottom: -0.22,
      height: 0.44,
      dragLong: 48,
      dragLat: 700,
    },
    human: 200,
    steer: 260,
    maxHuman: 2.4,
    maxEngine: 0,
  },
};

export const FRAME_KINDS = Object.keys(FRAMES) as FrameKind[];

/** Ridelles d'un plateau (repère du véhicule) : côtés, avant, arrière. */
export function railBoxes(frame: FrameKind): Array<{ x: number; y: number; z: number; hx: number; hy: number; hz: number }> {
  const f = FRAMES[frame];
  if (f.rail <= 0) return [];
  const t = 0.025;
  const y = f.cy + f.half.y + f.rail / 2;
  const hy = f.rail / 2;
  return [
    { x: -(f.half.x - t), y, z: 0, hx: t, hy, hz: f.half.z },
    { x: f.half.x - t, y, z: 0, hx: t, hy, hz: f.half.z },
    { x: 0, y, z: f.half.z - t, hx: f.half.x - 2 * t, hy, hz: t },
    { x: 0, y, z: -(f.half.z - t), hx: f.half.x - 2 * t, hy, hz: t },
  ];
}

export const PARTS: Record<PartKind, PartDef> = {
  petite_roue: { id: 'petite_roue', item: 'petite_roue', label: 'petite roue', feminine: true, mass: 4, perKm: 0.05, perHour: 0, repair: [['baton', 1], ['corde', 1]], repairTool: 'tranchant', install: { seconds: 4, tool: null, needs: [] } },
  roue: { id: 'roue', item: 'roue', label: 'roue cerclée de fer', feminine: true, mass: 25, perKm: 0.025, perHour: 0, repair: [['buche', 1], ['clous', 4]], repairTool: 'percuteur', install: { seconds: 8, tool: 'percuteur', needs: [] } },
  essieu: { id: 'essieu', item: 'essieu', label: 'essieu', feminine: false, mass: 12, perKm: 0.015, perHour: 0, repair: [['barre_fer', 1]], repairTool: 'percuteur', install: { seconds: 8, tool: 'percuteur', needs: [] } },
  machine_vapeur: {
    id: 'machine_vapeur',
    item: 'machine_vapeur',
    label: 'machine à vapeur',
    feminine: true,
    mass: 160,
    perKm: 0,
    perHour: 0.3,
    repair: [
      ['barre_fer', 2],
      ['boulons', 4],
      ['argile', 1],
    ],
    repairTool: 'percuteur',
    install: { seconds: 15, tool: 'percuteur', needs: [['boulons', 4]] },
  },
  roue_aubes: { id: 'roue_aubes', item: 'roue_aubes', label: 'roue à aubes', feminine: true, mass: 40, perKm: 0, perHour: 0.25, repair: [['buche', 1], ['clous', 4]], repairTool: 'percuteur', install: { seconds: 10, tool: 'percuteur', needs: [['boulons', 2]] } },
  gouvernail: { id: 'gouvernail', item: 'gouvernail', label: 'gouvernail', feminine: false, mass: 10, perKm: 0.01, perHour: 0, repair: [['perche', 1], ['corde', 1]], repairTool: 'tranchant', install: { seconds: 5, tool: null, needs: [['corde', 1]] } },
};

export const PART_KINDS = Object.keys(PARTS) as PartKind[];

/** Réparer le châssis ou la coque (+40 % de ses points de vie). */
export const FRAME_REPAIR: { needs: Need[]; tool: ToolTag; seconds: number } = { needs: [['buche', 1], ['clous', 4]], tool: 'percuteur', seconds: 8 };

/** Un châssis à roues sans toutes ses roues (et essieux) reste calé : il ne bouge pas. */
export function onChocks(v: VehicleState): boolean {
  return FRAMES[v.frame].medium === 'terre' && missingForRolling(v) !== null;
}
export const PART_OF_ITEM: Partial<Record<ItemId, PartKind>> = Object.fromEntries(PART_KINDS.map((k) => [PARTS[k].item, k]));

// ——— Machine à vapeur ———

export const ENGINE = {
  /** Puissance à pleine pression (W). */
  power: 4000,
  /** Secondes de feu vif par bûche, par bâton. */
  fuelLog: 120,
  fuelStick: 30,
  maxFuel: 1200,
  /** Capacité de la chaudière (L) ; eau versée par pot. */
  water: 40,
  potWater: 8,
  /** Temps caractéristiques (s) : chauffe, refroidissement, montée en pression. */
  heatUp: 25,
  coolDown: 40,
  pressure: 15,
} as const;

export interface PartState {
  slot: string;
  kind: PartKind;
  /** Usure de 0 (neuve) à 1. */
  wear: number;
  broken: boolean;
  /** Qualité de fabrication (0 à 100) : une pièce soignée s'use moins vite. */
  q: number;
}

export interface EngineState {
  /** Secondes de feu vif restantes. */
  fuel: number;
  lit: boolean;
  /** Chaleur du foyer et pression de la chaudière (0 à 1). */
  heat: number;
  pressure: number;
  /** Eau dans la chaudière (L). */
  water: number;
}

export interface VehicleState extends Owned {
  id: string;
  frame: FrameKind;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  hp: number;
  parts: PartState[];
  engine: EngineState;
  cargo: Container;
  /** Distance parcourue (m). */
  odo: number;
}

export type VehicleEvent =
  | { type: 'panne'; v: string; slot: string; kind: PartKind; reason: 'usure' | 'surchauffe' | 'choc' }
  | { type: 'feu_eteint'; v: string }
  | { type: 'plus_d_eau'; v: string };

export function newEngine(): EngineState {
  return { fuel: 0, lit: false, heat: 0, pressure: 0, water: 0 };
}

export function makeVehicle(id: string, frame: FrameKind, x: number, y: number, z: number, yaw: number): VehicleState {
  return {
    id,
    frame,
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(yaw / 2),
    qz: 0,
    qw: Math.cos(yaw / 2),
    hp: FRAMES[frame].hp,
    parts: [],
    engine: newEngine(),
    cargo: { bag: [], pockets: [] },
    odo: 0,
  };
}

/** « un radeau », « la pirogue ». */
export function vehicleName(v: Pick<VehicleState, 'frame'>, article: 'un' | 'le' = 'le'): string {
  const d = FRAMES[v.frame];
  if (article === 'un') return `${d.feminine ? 'une' : 'un'} ${d.label}`;
  return `${d.feminine ? 'la' : 'le'} ${d.label}`;
}

export function partName(kind: PartKind, article: 'un' | 'le' = 'le'): string {
  const d = PARTS[kind];
  if (article === 'un') return `${d.feminine ? 'une' : 'un'} ${d.label}`;
  if (/^[aeéèêiïoôuh]/i.test(d.label)) return `l’${d.label}`;
  return `${d.feminine ? 'la' : 'le'} ${d.label}`;
}

export function slotDef(v: Pick<VehicleState, 'frame'>, slot: string): SlotDef | undefined {
  return FRAMES[v.frame].slots.find((s) => s.id === slot);
}

export function partAt(v: VehicleState, slot: string): PartState | undefined {
  return v.parts.find((p) => p.slot === slot);
}

/** Yaw (cap) du véhicule d'après son orientation. */
export function yawOf(v: Pick<VehicleState, 'qx' | 'qy' | 'qz' | 'qw'>): number {
  // Projection de l'axe avant (+z) sur le plan horizontal.
  const { qx, qy, qz, qw } = v;
  const fx = 2 * (qx * qz + qw * qy);
  const fz = 1 - 2 * (qx * qx + qy * qy);
  return Math.atan2(fx, fz);
}

/** Point du repère du véhicule exprimé dans le monde. */
export function toWorld(v: Pick<VehicleState, 'x' | 'y' | 'z' | 'qx' | 'qy' | 'qz' | 'qw'>, p: Vec3): Vec3 {
  const { qx, qy, qz, qw } = v;
  const ix = qw * p.x + qy * p.z - qz * p.y;
  const iy = qw * p.y + qz * p.x - qx * p.z;
  const iz = qw * p.z + qx * p.y - qy * p.x;
  const iw = -qx * p.x - qy * p.y - qz * p.z;
  return {
    x: v.x + ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: v.y + iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: v.z + iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

/** Un bateau flotte (le fond de sa coque est dans l'eau) ; un véhicule terrestre, jamais. */
export function isAfloat(v: VehicleState): boolean {
  const f = FRAMES[v.frame];
  if (f.medium !== 'eau') return false;
  return WATER_LEVEL - toWorld(v, { x: 0, y: f.hull!.bottom, z: 0 }).y > 0.05;
}

/** Point du monde exprimé dans le repère du véhicule (inverse de toWorld). */
export function toLocal(v: Pick<VehicleState, 'x' | 'y' | 'z' | 'qx' | 'qy' | 'qz' | 'qw'>, p: Vec3): Vec3 {
  return toWorld({ x: 0, y: 0, z: 0, qx: -v.qx, qy: -v.qy, qz: -v.qz, qw: v.qw }, { x: p.x - v.x, y: p.y - v.y, z: p.z - v.z });
}

/** Composante verticale de l'axe « haut » du véhicule (1 : droit, 0 : sur le flanc, < 0 : à l'envers). */
export function uprightness(v: Pick<VehicleState, 'qx' | 'qy' | 'qz' | 'qw'>): number {
  return 1 - 2 * (v.qx * v.qx + v.qz * v.qz);
}

export function cargoMass(v: VehicleState): number {
  return bagContentMass(v.cargo.bag ?? []);
}

/** Masse, centre de gravité (repère local) et inertie : châssis, pièces, chargement, conducteur. */
export function massProps(v: VehicleState, driver: boolean): { mass: number; com: Vec3; inertia: Vec3 } {
  const f = FRAMES[v.frame];
  let m = f.mass;
  let cx = 0;
  let cy = f.cy * f.mass;
  let cz = 0;
  for (const p of v.parts) {
    const s = slotDef(v, p.slot);
    if (!s) continue;
    const pm = PARTS[p.kind].mass;
    m += pm;
    cx += s.x * pm;
    cy += s.y * pm;
    cz += s.z * pm;
  }
  const load = cargoMass(v);
  if (load > 0) {
    m += load;
    cx += f.cargo.x * load;
    cy += f.cargo.y * load;
    cz += f.cargo.z * load;
  }
  if (driver && f.seat) {
    m += 70;
    cx += f.seat.x * 70;
    cy += (f.seat.y + (f.medium === 'eau' ? 0.45 : 0.9)) * 70;
    cz += f.seat.z * 70;
  }
  const com = { x: cx / m, y: cy / m, z: cz / m };
  // Inertie d'une boîte de la taille du véhicule.
  const w = f.half.x * 2;
  const h = Math.max(0.4, f.half.y * 2 + (f.medium === 'terre' ? f.cy : 0.3));
  const l = f.half.z * 2;
  const inertia = { x: (m * (h * h + l * l)) / 12, y: (m * (w * w + l * l)) / 12, z: (m * (w * w + h * h)) / 12 };
  return { mass: m, com, inertia };
}

export interface WheelInfo {
  slot: string;
  kind: PartKind;
  x: number;
  y: number;
  z: number;
  front: boolean;
  broken: boolean;
  /** Essieu cassé : la roue est bloquée. */
  locked: boolean;
}

/** Roues installées (une roue cassée frotte ; un essieu cassé bloque ses deux roues). */
export function wheelsOf(v: VehicleState): WheelInfo[] {
  const f = FRAMES[v.frame];
  const out: WheelInfo[] = [];
  const axleFront = f.slots.some((s) => s.id === 'essieu_av');
  const axleBroken = (front: boolean) => {
    if (!axleFront) return false;
    const a = partAt(v, front ? 'essieu_av' : 'essieu_ar');
    return !a || a.broken;
  };
  for (const s of f.slots) {
    if (s.part !== 'roue' && s.part !== 'petite_roue') continue;
    const p = partAt(v, s.id);
    if (!p) continue;
    out.push({ slot: s.id, kind: p.kind, x: s.x, y: s.y, z: s.z, front: !!s.front, broken: p.broken, locked: axleBroken(!!s.front) });
  }
  return out;
}

/** Ce qui manque pour rouler (roues, essieux), ou null. */
export function missingForRolling(v: VehicleState): string | null {
  const f = FRAMES[v.frame];
  if (f.medium !== 'terre') return null;
  const wheelSlots = f.slots.filter((s) => s.part === 'roue' || s.part === 'petite_roue');
  const missing = wheelSlots.filter((s) => !partAt(v, s.id)).length;
  if (missing > 0) return `il manque ${missing} ${missing > 1 ? 'roues' : 'roue'}`;
  const axles = f.slots.filter((s) => s.part === 'essieu');
  const noAxle = axles.filter((s) => !partAt(v, s.id)).length;
  if (noAxle > 0) return `il manque ${noAxle} ${noAxle > 1 ? 'essieux' : 'essieu'}`;
  return null;
}

/** La machine à vapeur est installée et en état. */
export function engineOk(v: VehicleState): boolean {
  const p = v.parts.find((x) => x.kind === 'machine_vapeur');
  return !!p && !p.broken;
}

/** Puissance disponible (W) selon la pression et l'état de la machine. */
export function enginePower(v: VehicleState): number {
  const p = v.parts.find((x) => x.kind === 'machine_vapeur');
  if (!p || p.broken) return 0;
  return ENGINE.power * v.engine.pressure * (1 - p.wear * 0.3);
}

/** Propulsion sur l'eau par la machine : il faut aussi une roue à aubes en état. */
export function waterDrive(v: VehicleState): boolean {
  const a = v.parts.find((x) => x.kind === 'roue_aubes');
  return engineOk(v) && !!a && !a.broken;
}

/**
 * Foyer et chaudière pendant dt secondes : le bois brûle, la chaleur et la pression montent, l'eau
 * s'évapore selon la puissance demandée (load, de 0 à 1). Sans eau, à feu vif, la chaudière se fend.
 */
export function stepEngine(v: VehicleState, dt: number, load: number, out: VehicleEvent[]): void {
  const part = v.parts.find((x) => x.kind === 'machine_vapeur') ?? null;
  stepBoiler(v.engine, part, dt, load, v.id, out);
}

/** Foyer et chaudière d'une machine à vapeur (véhicule ou machine fixe). */
export function stepBoiler(e: EngineState, part: PartState | null, dt: number, load: number, id: string, out: VehicleEvent[]): void {
  if (!part) {
    e.lit = false;
    e.heat = Math.max(0, e.heat - dt / ENGINE.coolDown);
    e.pressure = 0;
    return;
  }
  if (e.lit && e.fuel > 0) {
    e.fuel = Math.max(0, e.fuel - dt * (0.35 + 0.65 * load));
    e.heat += (1 - e.heat) * Math.min(1, dt / ENGINE.heatUp);
    if (e.fuel <= 0) {
      e.lit = false;
      out.push({ type: 'feu_eteint', v: id });
    }
  } else {
    e.lit = false;
    e.heat -= e.heat * Math.min(1, dt / ENGINE.coolDown);
  }
  if (part.broken) e.pressure = Math.max(0, e.pressure - dt * 0.5);
  else if (e.water > 0) e.pressure += (e.heat - e.pressure) * Math.min(1, dt / ENGINE.pressure);
  else e.pressure = Math.max(0, e.pressure - dt * 0.2);
  // L'eau s'évapore : un peu au repos, beaucoup en pleine charge.
  const before = e.water;
  e.water = Math.max(0, e.water - dt * e.pressure * (0.015 + 0.075 * load));
  if (before > 0 && e.water <= 0) out.push({ type: 'plus_d_eau', v: id });
  // Surchauffe : chaudière presque vide et feu vif.
  if (!part.broken && e.heat > 0.6 && e.water < 2) {
    part.wear = Math.min(1, part.wear + dt * 0.04);
    if (part.wear >= 1) {
      part.broken = true;
      out.push({ type: 'panne', v: id, slot: part.slot, kind: part.kind, reason: 'surchauffe' });
    }
  }
  // Usure de marche.
  if (load > 0 && e.pressure > 0.1) part.wear = Math.min(1, part.wear + (dt / 3600) * PARTS.machine_vapeur.perHour * load * qualityFactor(part));
}

function qualityFactor(p: PartState): number {
  return 1.3 - 0.6 * (p.q / 100);
}

/**
 * Usure des pièces après avoir roulé ou navigué : distance (m), masse totale (kg), choc éventuel,
 * secondes de propulsion (roue à aubes). Puis tirage des pannes (rand : générateur de la simulation).
 */
export function wearParts(v: VehicleState, dist: number, mass: number, shock: number, driveSeconds: number, rand: () => number, out: VehicleEvent[]): void {
  const km = dist / 1000;
  const load = 0.5 + mass / 1000;
  for (const p of v.parts) {
    const def = PARTS[p.kind];
    if (p.broken) continue;
    let w = 0;
    if (def.perKm > 0) w += km * def.perKm * load;
    if (p.kind === 'roue_aubes') w += (driveSeconds / 3600) * def.perHour;
    if (shock > 0 && (p.kind === 'roue' || p.kind === 'petite_roue' || p.kind === 'essieu')) w += shock * 0.02;
    p.wear = Math.min(1, p.wear + w * qualityFactor(p));
    // Panne : de plus en plus probable avec l'usure (au-delà de la moitié).
    const used = def.perKm > 0 ? km : driveSeconds / 3600;
    if (used > 0 || shock > 0) {
      const risk = Math.max(0, p.wear - 0.5) ** 2 * 4 * (used * (def.perKm > 0 ? 8 : 6) + shock * 0.15);
      if (p.wear >= 1 || rand() < risk) {
        p.broken = true;
        out.push({ type: 'panne', v: v.id, slot: p.slot, kind: p.kind, reason: shock > 1 ? 'choc' : 'usure' });
      }
    }
  }
}

/** Réparer une pièce : elle redevient utilisable, une bonne part de l'usure disparaît. */
export function repairPart(p: PartState): void {
  p.broken = false;
  p.wear = Math.max(0.05, p.wear - 0.7);
}

// ——— Sauvegarde ———

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

export function readVehicles(raw: unknown): VehicleState[] {
  if (!Array.isArray(raw)) return [];
  const out: VehicleState[] = [];
  const ids = new Set<string>();
  for (const r of raw.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length > 20 || ids.has(o.id) || typeof o.frame !== 'string' || !(o.frame in FRAMES)) continue;
    const frame = o.frame as FrameKind;
    const f = FRAMES[frame];
    const v = makeVehicle(o.id, frame, num(o.x, -9000, 9000, 0), num(o.y, -200, 2000, 0), num(o.z, -9000, 9000, 0), 0);
    const q = [num(o.qx, -1, 1, 0), num(o.qy, -1, 1, 0), num(o.qz, -1, 1, 0), num(o.qw, -1, 1, 1)];
    const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
    v.qx = q[0]! / len;
    v.qy = q[1]! / len;
    v.qz = q[2]! / len;
    v.qw = q[3]! / len;
    v.hp = num(o.hp, 1, f.hp, f.hp);
    v.odo = num(o.odo, 0, 1e9, 0);
    if (Array.isArray(o.parts)) {
      for (const pr of o.parts.slice(0, 20)) {
        if (!pr || typeof pr !== 'object') continue;
        const p = pr as Record<string, unknown>;
        const slot = typeof p.slot === 'string' ? f.slots.find((s) => s.id === p.slot) : undefined;
        if (!slot || p.kind !== slot.part || v.parts.some((x) => x.slot === slot.id)) continue;
        v.parts.push({ slot: slot.id, kind: slot.part, wear: num(p.wear, 0, 1, 0), broken: p.broken === true, q: num(p.q, 0, 100, 60) });
      }
    }
    const e = o.engine as Record<string, unknown> | undefined;
    if (e && typeof e === 'object') v.engine = { fuel: num(e.fuel, 0, ENGINE.maxFuel, 0), lit: e.lit === true, heat: num(e.heat, 0, 1, 0), pressure: num(e.pressure, 0, 1, 0), water: num(e.water, 0, ENGINE.water, 0) };
    v.cargo = readContainer(o.cargo);
    if (!v.cargo.bag) v.cargo.bag = [];
    Object.assign(v, readOwned(o));
    ids.add(v.id);
    out.push(v);
  }
  return out;
}
