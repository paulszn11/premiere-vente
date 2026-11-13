// Actions ponctuelles du joueur (sac, soins, repos…). En phase 8, le client les enverra au
// serveur de l'hôte, qui les validera avec `readAction` avant de les appliquer.

import type { ClothingPart, Slot } from './inventory';
import { POCKET_COUNT } from './inventory';
import type { Treatment } from './vitals';

export type HandOrSlot = Slot | { zone: 'main' };

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
  /** Utilise l'objet tenu : manger, bander, désinfecter. */
  | { type: 'utiliser' }
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
  'interrompre',
  'abandonner',
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
    default:
      return { type: r.type } as PlayerAction;
  }
}
