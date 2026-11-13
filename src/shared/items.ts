// Catalogue des objets transportables (phases 3 et 4). Masses en kilogrammes, volumes en litres.
// Les troncs ne sont pas dans ce catalogue : trop grands pour le sac, on les porte ou on les
// traîne. Les pierres et les bûches gardent leur propre masse (8 kg au plus dans le sac).

export type ItemId =
  | 'pierre'
  | 'baton'
  | 'chiffon'
  | 'aloes'
  | 'fruit_baobab'
  | 'figue'
  | 'muhacha'
  // Phase 4 : matériaux
  | 'buche'
  | 'quartz'
  | 'ecorce'
  | 'fibres'
  | 'corde'
  | 'herbe'
  | 'ilala'
  | 'argile'
  | 'resine'
  | 'minerai_fer'
  | 'pepite_or'
  | 'manche'
  | 'perche'
  // Phase 4 : objets fabriqués
  | 'couteau'
  | 'hache'
  | 'baton_fouir'
  | 'lance'
  | 'archet'
  | 'pot_cru'
  | 'pot'
  | 'batee'
  | 'pansement'
  // Phase 5 : éclairage et fer
  | 'torche'
  | 'loupe_fer'
  | 'barre_fer'
  | 'clous'
  | 'boulons'
  | 'hache_fer'
  | 'couteau_fer';

/** Usages d'un outil. */
export type ToolTag = 'tranchant' | 'hache' | 'percuteur' | 'fouir' | 'batee' | 'feu' | 'recipient' | 'pointe';

export interface ToolSpec {
  tags: ToolTag[];
  /** Durabilité d'un outil neuf (nombre de coups ou d'usages). */
  durability: number;
  /** Portée (m) et équilibre (0 : lourd en tête, 1 : bien équilibré) : pour les combats (phase 6). */
  reach: number;
  balance: number;
  /** Travail fait par coup (1 : référence). */
  power: number;
}

export type Rarity = 'commun' | 'rare' | 'tres_rare';

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
  tool?: ToolSpec;
  rarity?: Rarity;
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
    tool: { tags: ['percuteur'], durability: 0, reach: 0.4, balance: 0.5, power: 1 },
    description: 'Se lance, se pose, sert de percuteur pour tailler le quartz. Les pierres de plus de 8 kg ne rentrent pas dans le sac.',
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
  // ——— Phase 4 : matériaux ———
  buche: {
    id: 'buche',
    label: 'bûche',
    plural: 'bûches',
    feminine: true,
    mass: 5,
    volume: 7,
    pocket: false,
    stack: 1,
    description: 'Bois pour le feu, une planchette ou une batée. Les bûches de plus de 8 kg ne rentrent pas dans le sac.',
  },
  quartz: {
    id: 'quartz',
    label: 'éclat de quartz',
    plural: 'éclats de quartz',
    feminine: false,
    mass: 0.08,
    volume: 0.05,
    pocket: true,
    stack: 8,
    tool: { tags: ['tranchant'], durability: 25, reach: 0.15, balance: 0.6, power: 0.6 },
    description: 'Tranchant comme un rasoir, mais fragile. Il entaille l’écorce et coupe les branches. Taillé dans un bloc de quartz avec un galet.',
  },
  ecorce: {
    id: 'ecorce',
    label: "bande d'écorce",
    plural: "bandes d'écorce",
    feminine: true,
    mass: 0.25,
    volume: 0.5,
    pocket: false,
    stack: 10,
    description: 'Battue avec une pierre, elle donne des fibres.',
  },
  fibres: {
    id: 'fibres',
    label: "poignée de fibres",
    plural: 'poignées de fibres',
    feminine: true,
    mass: 0.08,
    volume: 0.15,
    pocket: true,
    stack: 12,
    description: 'Fibres d’écorce. Trois poignées torsadées font une corde.',
  },
  corde: {
    id: 'corde',
    label: 'corde',
    plural: 'cordes',
    feminine: true,
    mass: 0.12,
    volume: 0.2,
    pocket: true,
    stack: 6,
    description: 'Ligature les outils, bande un archet.',
  },
  herbe: {
    id: 'herbe',
    label: "brassée d'herbes sèches",
    plural: "brassées d'herbes sèches",
    feminine: true,
    mass: 0.05,
    volume: 0.5,
    pocket: false,
    stack: 10,
    description: 'Amadou pour allumer un feu.',
  },
  ilala: {
    id: 'ilala',
    label: "feuille d'ilala",
    plural: "feuilles d'ilala",
    feminine: true,
    mass: 0.12,
    volume: 0.6,
    pocket: false,
    stack: 10,
    description: 'Feuille de palmier ilala. Trois feuilles tressées font une corde.',
  },
  argile: {
    id: 'argile',
    label: "boule d'argile",
    plural: "boules d'argile",
    feminine: true,
    mass: 0.8,
    volume: 0.5,
    pocket: false,
    stack: 6,
    description: 'Se modèle, puis se cuit au feu.',
  },
  resine: {
    id: 'resine',
    label: 'boulette de résine',
    plural: 'boulettes de résine',
    feminine: true,
    mass: 0.05,
    volume: 0.05,
    pocket: true,
    stack: 8,
    rarity: 'rare',
    description: 'Colle naturelle : renforce une ligature.',
  },
  minerai_fer: {
    id: 'minerai_fer',
    label: 'minerai de fer',
    plural: 'morceaux de minerai de fer',
    feminine: false,
    mass: 2.5,
    volume: 0.7,
    pocket: false,
    stack: 4,
    rarity: 'rare',
    description: 'Lourd et rougeâtre. Il faudra un four pour le fondre.',
  },
  pepite_or: {
    id: 'pepite_or',
    label: "pépite d'or",
    plural: "pépites d'or",
    feminine: true,
    mass: 0.01,
    volume: 0.002,
    pocket: true,
    stack: 50,
    rarity: 'tres_rare',
    description: 'Très rare. Trouvée en orpaillant.',
  },
  manche: {
    id: 'manche',
    label: 'branche verte',
    plural: 'branches vertes',
    feminine: true,
    mass: 0.4,
    volume: 0.5,
    pocket: false,
    stack: 4,
    description: 'Souple et solide : un manche pour un outil.',
  },
  perche: {
    id: 'perche',
    label: 'perche',
    plural: 'perches',
    feminine: true,
    mass: 1.2,
    volume: 2.4,
    pocket: false,
    stack: 2,
    description: 'Longue branche droite : le bois d’une lance.',
  },
  // ——— Phase 4 : objets fabriqués ———
  couteau: {
    id: 'couteau',
    label: 'couteau de pierre',
    plural: 'couteaux de pierre',
    feminine: false,
    mass: 0.25,
    volume: 0.3,
    pocket: false,
    stack: 1,
    tool: { tags: ['tranchant'], durability: 120, reach: 0.3, balance: 0.7, power: 1 },
    description: 'Éclat de quartz emmanché et ligaturé. Coupe, entaille, taille.',
  },
  hache: {
    id: 'hache',
    label: 'hache de pierre',
    plural: 'haches de pierre',
    feminine: true,
    mass: 1.3,
    volume: 1.5,
    pocket: false,
    stack: 1,
    tool: { tags: ['hache', 'tranchant'], durability: 150, reach: 0.6, balance: 0.35, power: 1 },
    description: 'Tête de pierre taillée, emmanchée et ligaturée. Abat les arbres, coupe les perches.',
  },
  baton_fouir: {
    id: 'baton_fouir',
    label: 'bâton à fouir',
    plural: 'bâtons à fouir',
    feminine: false,
    mass: 0.5,
    volume: 0.7,
    pocket: false,
    stack: 1,
    tool: { tags: ['fouir'], durability: 80, reach: 0.9, balance: 0.6, power: 1 },
    description: 'Bâton à la pointe taillée : creuse l’argile.',
  },
  lance: {
    id: 'lance',
    label: 'lance',
    plural: 'lances',
    feminine: true,
    mass: 1.1,
    volume: 2.5,
    pocket: false,
    stack: 1,
    tool: { tags: ['pointe'], durability: 100, reach: 1.8, balance: 0.55, power: 1 },
    description: 'Perche à pointe de quartz. Pour la chasse et la défense (phase 6).',
  },
  archet: {
    id: 'archet',
    label: 'archet à feu',
    plural: 'archets à feu',
    feminine: false,
    mass: 0.6,
    volume: 1,
    pocket: false,
    stack: 1,
    tool: { tags: ['feu'], durability: 25, reach: 0.4, balance: 0.5, power: 1 },
    description: 'Archet, fuseau et planchette : allume un feu avec des herbes sèches.',
  },
  pot_cru: {
    id: 'pot_cru',
    label: "pot d'argile crue",
    plural: "pots d'argile crue",
    feminine: false,
    mass: 1.6,
    volume: 2.5,
    pocket: false,
    stack: 1,
    description: 'À cuire au feu pour qu’il tienne l’eau.',
  },
  pot: {
    id: 'pot',
    label: 'pot en terre cuite',
    plural: 'pots en terre cuite',
    feminine: false,
    mass: 1.2,
    volume: 2.5,
    pocket: false,
    stack: 1,
    tool: { tags: ['recipient'], durability: 200, reach: 0.3, balance: 0.5, power: 1 },
    description: 'Se remplit d’eau au fleuve ; posé sur le feu, l’eau bout.',
  },
  batee: {
    id: 'batee',
    label: 'batée',
    plural: 'batées',
    feminine: true,
    mass: 0.9,
    volume: 2,
    pocket: false,
    stack: 1,
    tool: { tags: ['batee'], durability: 120, reach: 0.4, balance: 0.5, power: 1 },
    description: 'Plat de bois creusé pour laver le gravier et trouver de l’or.',
  },
  pansement: {
    id: 'pansement',
    label: 'pansement propre',
    plural: 'pansements propres',
    feminine: false,
    mass: 0.03,
    volume: 0.08,
    pocket: true,
    stack: 6,
    description: 'Chiffon bouilli : bande une plaie sans risque d’infection.',
  },
  torche: {
    id: 'torche',
    label: 'torche',
    plural: 'torches',
    feminine: true,
    mass: 0.5,
    volume: 0.8,
    pocket: false,
    stack: 1,
    description: 'S’allume à un feu. Tenue en main ou plantée au sol, elle éclaire et peut mettre le feu au bois et au chaume.',
  },
  loupe_fer: {
    id: 'loupe_fer',
    label: 'loupe de fer',
    plural: 'loupes de fer',
    feminine: true,
    mass: 2.5,
    volume: 0.4,
    pocket: false,
    stack: 4,
    description: 'Fer brut sorti du bas fourneau, encore plein de scories. À chauffer et battre à la forge.',
  },
  barre_fer: {
    id: 'barre_fer',
    label: 'barre de fer',
    plural: 'barres de fer',
    feminine: true,
    mass: 1,
    volume: 0.2,
    pocket: false,
    stack: 6,
    description: 'Fer forgé, prêt à devenir clous, boulons ou outils.',
  },
  clous: {
    id: 'clous',
    label: 'clou',
    plural: 'clous',
    feminine: false,
    mass: 0.02,
    volume: 0.01,
    pocket: true,
    stack: 50,
    description: 'Fixe le bois plus solidement qu’une corde (portes, murs, toits).',
  },
  boulons: {
    id: 'boulons',
    label: 'boulon',
    plural: 'boulons',
    feminine: false,
    mass: 0.08,
    volume: 0.02,
    pocket: true,
    stack: 20,
    description: 'Fixe les rondins des planchers et les poteaux.',
  },
  hache_fer: {
    id: 'hache_fer',
    label: 'hache en fer',
    plural: 'haches en fer',
    feminine: true,
    mass: 1.2,
    volume: 1.5,
    pocket: false,
    stack: 1,
    tool: { tags: ['hache', 'tranchant'], durability: 600, reach: 0.65, balance: 0.4, power: 1.6 },
    description: 'Tête de fer forgée, emmanchée. Abat et taille bien plus vite qu’une hache de pierre.',
  },
  couteau_fer: {
    id: 'couteau_fer',
    label: 'couteau en fer',
    plural: 'couteaux en fer',
    feminine: false,
    mass: 0.25,
    volume: 0.3,
    pocket: true,
    stack: 1,
    tool: { tags: ['tranchant'], durability: 400, reach: 0.3, balance: 0.75, power: 1.5 },
    description: 'Lame forgée : coupe, taille et écorce longtemps.',
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

/** Densité moyenne d'une pierre et du bois (kg par litre). */
export const STONE_DENSITY_KG_L = 2.6;
export const WOOD_DENSITY_KG_L = 0.7;

/** Objets dont chaque exemplaire garde sa propre masse (et ne se regroupe pas). */
export const MASS_ITEMS = new Set<ItemId>(['pierre', 'buche']);

export function hasTag(id: ItemId, tag: ToolTag): boolean {
  return ITEMS[id].tool?.tags.includes(tag) ?? false;
}
