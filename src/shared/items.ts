// Catalogue des objets transportables (phase 3). Masses en kilogrammes, volumes en litres.
// Les bûches et les troncs ne sont pas dans ce catalogue : trop grands pour le sac, on les
// porte ou on les traîne.

export type ItemId = 'pierre' | 'baton' | 'chiffon' | 'aloes' | 'fruit_baobab' | 'figue' | 'muhacha';

export interface FoodEffect {
  /** Santé rendue au total. */
  heal: number;
  /** Durée de la digestion pendant laquelle la santé remonte. */
  seconds: number;
}

export interface ItemDef {
  id: ItemId;
  label: string;
  plural: string;
  feminine: boolean;
  /** Masse d'une unité (une pierre garde sa propre masse). */
  mass: number;
  /** Volume d'une unité (une pierre : selon sa masse). */
  volume: number;
  /** Rentre dans une poche. */
  pocket: boolean;
  /** Nombre maximal d'unités par emplacement. */
  stack: number;
  food?: FoodEffect;
  description: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  pierre: {
    id: 'pierre',
    label: 'pierre',
    plural: 'pierres',
    feminine: true,
    mass: 2,
    volume: 0.8,
    pocket: false,
    stack: 1,
    description: 'Se lance, se pose. Les pierres de plus de 8 kg ne rentrent pas dans le sac.',
  },
  baton: {
    id: 'baton',
    label: 'bâton',
    plural: 'bâtons',
    feminine: false,
    mass: 0.4,
    volume: 0.5,
    pocket: false,
    stack: 8,
    description: 'Branche morte. Deux bâtons et deux chiffons font une attelle.',
  },
  chiffon: {
    id: 'chiffon',
    label: 'chiffon',
    plural: 'chiffons',
    feminine: false,
    mass: 0.05,
    volume: 0.15,
    pocket: true,
    stack: 6,
    description: 'Morceau de vêtement. Arrête un saignement, maintient une entorse.',
  },
  aloes: {
    id: 'aloes',
    label: "feuille d'aloès",
    plural: "feuilles d'aloès",
    feminine: true,
    mass: 0.25,
    volume: 0.35,
    pocket: true,
    stack: 3,
    description: 'Plante des kopjes de granit. Désinfecte une plaie et calme la douleur.',
  },
  fruit_baobab: {
    id: 'fruit_baobab',
    label: 'fruit du baobab',
    plural: 'fruits du baobab',
    feminine: false,
    mass: 0.4,
    volume: 0.7,
    pocket: true,
    stack: 1,
    food: { heal: 20, seconds: 40 },
    description: 'Pulpe sèche et nourrissante. Rend beaucoup de santé, lentement.',
  },
  figue: {
    id: 'figue',
    label: 'figue sauvage',
    plural: 'figues sauvages',
    feminine: true,
    mass: 0.04,
    volume: 0.05,
    pocket: true,
    stack: 10,
    food: { heal: 5, seconds: 12 },
    description: 'Tombée des figuiers, près de l’eau. Un peu de santé.',
  },
  muhacha: {
    id: 'muhacha',
    label: 'muhacha',
    plural: 'muhachas',
    feminine: false,
    mass: 0.05,
    volume: 0.06,
    pocket: true,
    stack: 10,
    food: { heal: 7, seconds: 15 },
    description: 'Prune du miombo, farineuse et sucrée. Un peu de santé.',
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, v);
}

/** « un bâton », « une figue sauvage », « 3 chiffons ». */
export function itemName(id: ItemId, count = 1): string {
  const d = ITEMS[id];
  if (count === 1) return `${d.feminine ? 'une' : 'un'} ${d.label}`;
  return `${count} ${d.plural}`;
}

/** Densité moyenne d'une pierre (kg par litre). */
export const STONE_DENSITY_KG_L = 2.6;
