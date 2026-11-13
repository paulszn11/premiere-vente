// Machines (phase 7) : sources d'énergie (roue à eau, machine à vapeur fixe) et machines entraînées
// par un arbre de transmission (meule, soufflet mécanique, pompe). Proposition signalée (section 15) ;
// les puissances sont modifiables. Les machines à moins de TRANSMISSION mètres l'une de l'autre forment
// un même réseau : la puissance des sources est partagée entre les machines qui tournent.

import type { MachinePropKind, MachineState, PropKind } from './props';
import { ENGINE, type EngineState, type PartState, newEngine } from './vehicles';

/** Portée d'un arbre de transmission entre deux machines (m). */
export const TRANSMISSION = 6;

export interface MachineDef {
  id: MachinePropKind;
  label: string;
  source: boolean;
  /** Puissance demandée pour tourner à plein régime (W). */
  demand: number;
}

export const MACHINES: Record<MachinePropKind, MachineDef> = {
  roue_eau: { id: 'roue_eau', label: 'roue à eau', source: true, demand: 0 },
  machine_fixe: { id: 'machine_fixe', label: 'machine à vapeur fixe', source: true, demand: 0 },
  meule: { id: 'meule', label: 'meule', source: false, demand: 150 },
  soufflet_meca: { id: 'soufflet_meca', label: 'soufflet mécanique', source: false, demand: 300 },
  pompe: { id: 'pompe', label: 'pompe', source: false, demand: 250 },
};

/** Une machine entraînée tourne assez pour servir au-delà de cette part de sa puissance. */
export const RUNS_AT = 0.5;

/**
 * Puissance d'une roue à eau selon la vitesse du courant (m/s). Formule simplifiée (proportionnelle
 * au carré de la vitesse) : environ 340 W dans le courant du Zambèze (0,75 m/s), 100 W dans le Limpopo.
 */
export function waterWheelPower(current: number): number {
  return current < 0.15 ? 0 : 600 * current * current;
}

/** Puissance d'une machine à vapeur fixe selon sa pression et son usure (W). */
export function boilerPower(m: MachineState): number {
  if (!m.engine || !m.part || m.part.broken) return 0;
  return ENGINE.power * m.engine.pressure * (1 - m.part.wear * 0.3);
}

export function newMachine(kind: MachinePropKind): MachineState {
  if (kind === 'machine_fixe') return { engine: newEngine(), part: { slot: 'socle', kind: 'machine_vapeur', wear: 0, broken: false, q: 60 }, power: 0 };
  return { power: 0 };
}

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

/** Relit l'état sauvegardé d'une machine (valeurs bornées). */
export function readMachine(kind: PropKind, raw: unknown): MachineState {
  const m = newMachine(kind as MachinePropKind);
  if (!raw || typeof raw !== 'object') return m;
  const o = raw as Record<string, unknown>;
  if (m.engine) {
    const e = (o.engine ?? {}) as Record<string, unknown>;
    m.engine = { fuel: num(e.fuel, 0, ENGINE.maxFuel, 0), lit: e.lit === true, heat: num(e.heat, 0, 1, 0), pressure: num(e.pressure, 0, 1, 0), water: num(e.water, 0, ENGINE.water, 0) } satisfies EngineState;
  }
  if (m.part) {
    const p = (o.part ?? {}) as Record<string, unknown>;
    m.part = { slot: 'socle', kind: 'machine_vapeur', wear: num(p.wear, 0, 1, 0), broken: p.broken === true, q: num(p.q, 0, 100, 60) } satisfies PartState;
  }
  return m;
}

export interface PowerNode {
  id: string;
  kind: MachinePropKind;
  x: number;
  z: number;
  /** Sources : puissance disponible (W). */
  output: number;
}

/**
 * Réseaux de transmission : machines reliées de proche en proche (moins de TRANSMISSION m). Renvoie,
 * pour chaque machine entraînée, la part de sa puissance qu'elle reçoit (0 à 1) et, pour chaque source,
 * la part de sa puissance utilisée (sa charge, de 0 à 1).
 */
export function powerNetwork(nodes: PowerNode[]): Map<string, number> {
  const n = nodes.length;
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.hypot(a.x - b.x, a.z - b.z) <= TRANSMISSION) parent[find(i)] = find(j);
    }
  const supply = new Map<number, number>();
  const demand = new Map<number, number>();
  nodes.forEach((m, i) => {
    const r = find(i);
    const def = MACHINES[m.kind];
    if (def.source) supply.set(r, (supply.get(r) ?? 0) + m.output);
    else demand.set(r, (demand.get(r) ?? 0) + def.demand);
  });
  const out = new Map<string, number>();
  nodes.forEach((m, i) => {
    const r = find(i);
    const sup = supply.get(r) ?? 0;
    const dem = demand.get(r) ?? 0;
    if (MACHINES[m.kind].source) out.set(m.id, sup > 0 ? Math.min(1, dem / sup) : 0);
    else out.set(m.id, dem > 0 ? Math.min(1, sup / dem) : 0);
  });
  return out;
}
