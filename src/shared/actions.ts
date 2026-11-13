// Actions ponctuelles du joueur (sac, soins, repos…). En phase 8, le client les enverra au
// serveur de l'hôte, qui les validera avec `readAction` avant de les appliquer.

import { PLANS, type PlanId } from './building';
import type { ImproveKind, RepairKind } from './crafting';
import type { ClothingPart, Slot } from './inventory';
import { BENCH_SLOTS, POCKET_COUNT } from './inventory';
import type { Treatment } from './vitals';

export type HandOrSlot = Slot | { zone: 'main' };

/** Pièce d'une construction, ou chantier d'installation. */
export type BuildRef = { kind: 'piece'; s: string; p: number } | { kind: 'site'; id: string };

export type PieceOp = 'reparer' | 'torchis' | 'demonter' | 'porte' | 'eteindre';
export type FurnaceOp = 'minerai' | 'bois' | 'souffler' | 'loupe';

export type PlayerAction =
  /** Range l'objet tenu en main (poche, sinon sac). */
  | { type: 'ranger' }
  /** Sort une unité d'une poche ou du sac et la prend en main. */
  | { type: 'sortir'; from: Slot }
  /** Déplace toute une pile entre poches et sac. */
  | { type: 'deplacer'; from: Slot; to: 'poche' | 'sac' }
  /** Pose une unité au sol (ou l'objet tenu). */
  | { type: 'poser'; from: HandOrSlot }
  | { type: 'manger'; from: HandOrSlot }
  | { type: 'soigner'; injury: number; treatment: Treatment }
  | { type: 'dechirer'; part: ClothingPart }
  | { type: 'reposer' }
  | { type: 'dormir' }
  | { type: 'lever' }
  | { type: 'poser_sac' }
  /** Met sur son dos le sac posé (ou celui d'un corps) quand on n'en a pas. */
  | { type: 'prendre_sac'; prop: string }
  /** Prend une pile dans un sac posé ou sur un corps. */
  | { type: 'prendre_dans'; prop: string; from: Slot }
  | { type: 'tout_prendre'; prop: string }
  /** Range une pile de son inventaire dans un sac posé. */
  | { type: 'deposer_dans'; prop: string; from: Slot }
  | { type: 'trainer'; prop: string }
  /** Poche 1 à 4 : prend l'objet en main, ou y range l'objet tenu. */
  | { type: 'poche'; index: number }
  /** Utilise l'objet tenu : récolter avec un outil, manger, bander, désinfecter. `repeat` : touche maintenue. */
  | { type: 'utiliser'; repeat?: boolean }
  /** Plan de travail : y poser une pile, en reprendre une, faire l'étape suivante. */
  | { type: 'etabli_poser'; from: HandOrSlot }
  | { type: 'etabli_reprendre'; index: number }
  | { type: 'fabriquer' }
  | { type: 'reparer'; from: HandOrSlot; kind: RepairKind }
  | { type: 'ameliorer'; from: HandOrSlot; kind: ImproveKind }
  | { type: 'demonter'; from: HandOrSlot }
  /** Remplir un pot d'eau (dans l'eau). */
  | { type: 'remplir'; from: HandOrSlot }
  /** Foyer : allumer, ajouter du bois, poser ou reprendre un pot. */
  | { type: 'allumer'; prop: string }
  | { type: 'alimenter'; prop: string }
  | { type: 'poser_feu'; prop: string; from: HandOrSlot }
  | { type: 'reprendre_feu'; prop: string }
  /** Construction : tracer un plan (point visé, rotation en crans de 15°, plancher visé pour une installation). */
  | { type: 'planifier'; plan: PlanId; aim: { x: number; y: number; z: number }; turn: number; on: { s: string; p: number } | null }
  /** Faire l'étape suivante d'un chantier (comme « Utiliser » en le visant). */
  | { type: 'chantier'; target: BuildRef }
  /** Abandonner un chantier (une partie des matériaux déjà posés est rendue). */
  | { type: 'annuler_chantier'; target: BuildRef }
  /** Pièce terminée : réparer, enduire de torchis, démonter, ouvrir/fermer, éteindre. */
  | { type: 'piece'; s: string; p: number; op: PieceOp }
  /** Bas fourneau : charger du minerai, du bois, actionner le soufflet, retirer une loupe. */
  | { type: 'fourneau'; prop: string; op: FurnaceOp }
  /** Interrompt le geste en cours. */
  | { type: 'interrompre' }
  /** État critique ou inconscient : mourir tout de suite (personne ne peut venir). */
  | { type: 'abandonner' };

export interface ActionResult {
  ok: boolean;
  message?: string;
}

const TYPES = new Set([
  'ranger',
  'sortir',
  'deplacer',
  'poser',
  'manger',
  'soigner',
  'dechirer',
  'reposer',
  'dormir',
  'lever',
  'poser_sac',
  'prendre_sac',
  'prendre_dans',
  'tout_prendre',
  'deposer_dans',
  'trainer',
  'poche',
  'utiliser',
  'etabli_poser',
  'etabli_reprendre',
  'fabriquer',
  'reparer',
  'ameliorer',
  'demonter',
  'remplir',
  'allumer',
  'alimenter',
  'poser_feu',
  'reprendre_feu',
  'interrompre',
  'abandonner',
  'planifier',
  'chantier',
  'annuler_chantier',
  'piece',
  'fourneau',
]);

function readSlot(raw: unknown, allowHand: boolean): HandOrSlot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.zone === 'main') return allowHand ? { zone: 'main' } : null;
  if (r.zone !== 'poche' && r.zone !== 'sac') return null;
  const i = r.index;
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) return null;
  if (r.zone === 'poche' && i >= POCKET_COUNT) return null;
  if (r.zone === 'sac' && i >= 200) return null;
  return { zone: r.zone, index: i };
}

const propId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40;
const finite = (x: unknown, lim: number): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim;
const pieceId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1e6;

function readBuildRef(raw: unknown): BuildRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'piece') return propId(r.s) && pieceId(r.p) ? { kind: 'piece', s: r.s, p: r.p } : null;
  if (r.kind === 'site') return propId(r.id) ? { kind: 'site', id: r.id } : null;
  return null;
}

/** Vérifie une action reçue (réseau en phase 8) ; renvoie null si elle est invalide. */
export function readAction(raw: unknown): PlayerAction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string' || !TYPES.has(r.type)) return null;
  switch (r.type) {
    case 'sortir': {
      const from = readSlot(r.from, false);
      return from && from.zone !== 'main' ? { type: 'sortir', from } : null;
    }
    case 'deplacer': {
      const from = readSlot(r.from, false);
      return from && from.zone !== 'main' && (r.to === 'poche' || r.to === 'sac') ? { type: 'deplacer', from, to: r.to } : null;
    }
    case 'poser':
    case 'manger': {
      const from = readSlot(r.from, true);
      return from ? { type: r.type, from } : null;
    }
    case 'soigner':
      return typeof r.injury === 'number' && Number.isInteger(r.injury) && (r.treatment === 'bander' || r.treatment === 'attelle' || r.treatment === 'aloes')
        ? { type: 'soigner', injury: r.injury, treatment: r.treatment }
        : null;
    case 'dechirer':
      return r.part === 'haut' || r.part === 'bas' ? { type: 'dechirer', part: r.part } : null;
    case 'prendre_sac':
    case 'tout_prendre':
    case 'trainer':
      return propId(r.prop) ? { type: r.type, prop: r.prop } : null;
    case 'prendre_dans':
    case 'deposer_dans': {
      const from = readSlot(r.from, false);
      return propId(r.prop) && from && from.zone !== 'main' ? { type: r.type, prop: r.prop, from } : null;
    }
    case 'poche':
      return typeof r.index === 'number' && Number.isInteger(r.index) && r.index >= 0 && r.index < POCKET_COUNT ? { type: 'poche', index: r.index } : null;
    case 'utiliser':
      return r.repeat === true ? { type: 'utiliser', repeat: true } : { type: 'utiliser' };
    case 'etabli_poser':
    case 'demonter':
    case 'remplir': {
      const from = readSlot(r.from, true);
      return from ? { type: r.type, from } : null;
    }
    case 'etabli_reprendre':
      return typeof r.index === 'number' && Number.isInteger(r.index) && r.index >= 0 && r.index < BENCH_SLOTS ? { type: 'etabli_reprendre', index: r.index } : null;
    case 'reparer': {
      const from = readSlot(r.from, true);
      return from && (r.kind === 'religaturer' || r.kind === 'affuter' || r.kind === 'retailler' || r.kind === 'recorder') ? { type: 'reparer', from, kind: r.kind } : null;
    }
    case 'ameliorer': {
      const from = readSlot(r.from, true);
      return from && (r.kind === 'durcir' || r.kind === 'resine') ? { type: 'ameliorer', from, kind: r.kind } : null;
    }
    case 'allumer':
    case 'alimenter':
    case 'reprendre_feu':
      return propId(r.prop) ? { type: r.type, prop: r.prop } : null;
    case 'poser_feu': {
      const from = readSlot(r.from, true);
      return propId(r.prop) && from ? { type: 'poser_feu', prop: r.prop, from } : null;
    }
    case 'planifier': {
      const a = r.aim as Record<string, unknown> | null;
      if (typeof r.plan !== 'string' || !Object.prototype.hasOwnProperty.call(PLANS, r.plan) || !a || typeof a !== 'object') return null;
      if (!finite(a.x, 9000) || !finite(a.y, 5000) || !finite(a.z, 9000) || !(typeof r.turn === 'number' && Number.isInteger(r.turn) && Math.abs(r.turn) <= 24)) return null;
      let on: { s: string; p: number } | null = null;
      if (r.on !== null && r.on !== undefined) {
        const o = r.on as Record<string, unknown>;
        if (!propId(o.s) || !pieceId(o.p)) return null;
        on = { s: o.s, p: o.p };
      }
      return { type: 'planifier', plan: r.plan as PlanId, aim: { x: a.x, y: a.y, z: a.z }, turn: r.turn, on };
    }
    case 'chantier':
    case 'annuler_chantier': {
      const target = readBuildRef(r.target);
      return target ? { type: r.type, target } : null;
    }
    case 'piece':
      return propId(r.s) && pieceId(r.p) && (r.op === 'reparer' || r.op === 'torchis' || r.op === 'demonter' || r.op === 'porte' || r.op === 'eteindre') ? { type: 'piece', s: r.s, p: r.p, op: r.op } : null;
    case 'fourneau':
      return propId(r.prop) && (r.op === 'minerai' || r.op === 'bois' || r.op === 'souffler' || r.op === 'loupe') ? { type: 'fourneau', prop: r.prop, op: r.op } : null;
    default:
      return { type: r.type } as PlayerAction;
  }
}
