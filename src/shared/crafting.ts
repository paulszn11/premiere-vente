// Fabrication (phase 4) : recettes faites d'étapes (chacune demande un outil et prend du temps),
// recettes connues, pressenties et découvertes, compétence « Fabrication », qualité et défauts,
// usure, réparation, améliorations et démontage. Données simples, sérialisables, déterministes.

import { type PlanId, readPlans, startingPlans } from './building';
import { FX_DURCI, FX_LIGATURE_LACHE, FX_MANCHE_FENDU, FX_RESINE, type ItemStack, unitMass } from './inventory';
import { ITEMS, type ItemId, type ToolTag } from './items';

export type RecipeId =
  | 'fibres'
  | 'corde'
  | 'corde_ilala'
  | 'couteau'
  | 'hache'
  | 'baton_fouir'
  | 'lance'
  | 'archet'
  | 'pot_cru'
  | 'batee'
  | 'foyer'
  | 'pansement'
  // Phase 5 : éclairage et forge
  | 'torche'
  | 'torche_resine'
  | 'barre_fer'
  | 'boulons'
  | 'clous'
  | 'hache_fer'
  | 'couteau_fer'
  // Phase 7 : pièces de véhicules et de machines
  | 'petite_roue'
  | 'roue'
  | 'essieu'
  | 'machine_vapeur'
  | 'roue_aubes'
  | 'gouvernail';

export interface RecipeStep {
  label: string;
  /** Outil nécessaire (en plus des pièces posées), null : à la main. */
  tool: ToolTag | null;
  seconds: number;
}

export interface Recipe {
  id: RecipeId;
  label: string;
  /** Pièces posées sur le plan de travail (consommées). */
  inputs: Array<[ItemId, number]>;
  /** Pierre de la tête de hache : masse entre ces bornes (kg). */
  stoneKg?: [number, number];
  steps: RecipeStep[];
  /** Objet obtenu, ou foyer monté devant soi. */
  output: { item: ItemId; count: number } | { place: 'foyer' };
  /** Connue dès le départ. */
  known: boolean;
  /** Pressentie quand on ramasse ou fabrique l'un de ces objets. */
  hintedBy: ItemId[];
  /** Indice affiché tant qu'elle n'est pas découverte. */
  hint: string;
  /** Il faut de l'eau bouillie dans un pot (pansements). */
  boiledWater?: boolean;
  /** Il faut une forge allumée à moins de 3 m. */
  station?: 'forge';
  /** Torche : secondes de combustion. */
  burn?: number;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  fibres: {
    id: 'fibres',
    label: 'Fibres d’écorce',
    inputs: [['ecorce', 1]],
    steps: [{ label: 'Battre l’écorce', tool: 'percuteur', seconds: 3 }],
    output: { item: 'fibres', count: 2 },
    known: true,
    hintedBy: [],
    hint: '',
  },
  corde: {
    id: 'corde',
    label: 'Corde de fibres',
    inputs: [['fibres', 3]],
    steps: [{ label: 'Torsader les fibres', tool: null, seconds: 4 }],
    output: { item: 'corde', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
  },
  corde_ilala: {
    id: 'corde_ilala',
    label: 'Corde d’ilala',
    inputs: [['ilala', 3]],
    steps: [{ label: 'Tresser les feuilles', tool: null, seconds: 5 }],
    output: { item: 'corde', count: 1 },
    known: false,
    hintedBy: ['ilala'],
    hint: 'Les feuilles d’ilala se tressent peut-être, comme les fibres…',
  },
  couteau: {
    id: 'couteau',
    label: 'Couteau de pierre',
    inputs: [
      ['quartz', 1],
      ['manche', 1],
      ['corde', 1],
    ],
    steps: [
      { label: 'Fendre le bout du manche', tool: 'tranchant', seconds: 3 },
      { label: 'Emmancher l’éclat', tool: null, seconds: 2 },
      { label: 'Ligaturer', tool: null, seconds: 4 },
    ],
    output: { item: 'couteau', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
  },
  hache: {
    id: 'hache',
    label: 'Hache de pierre',
    inputs: [
      ['pierre', 1],
      ['manche', 1],
      ['corde', 2],
    ],
    stoneKg: [0.8, 3.5],
    steps: [
      { label: 'Tailler le tranchant de la pierre', tool: 'percuteur', seconds: 6 },
      { label: 'Fendre le manche', tool: 'tranchant', seconds: 3 },
      { label: 'Emmancher la tête', tool: null, seconds: 2 },
      { label: 'Ligaturer serré', tool: null, seconds: 5 },
    ],
    output: { item: 'hache', count: 1 },
    known: false,
    hintedBy: ['couteau'],
    hint: 'Un couteau emmanché… Une pierre plus lourde, emmanchée de même, ferait une hache (une pierre de 1 à 3 kg).',
  },
  baton_fouir: {
    id: 'baton_fouir',
    label: 'Bâton à fouir',
    inputs: [['baton', 1]],
    steps: [{ label: 'Tailler la pointe', tool: 'tranchant', seconds: 4 }],
    output: { item: 'baton_fouir', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
  },
  lance: {
    id: 'lance',
    label: 'Lance',
    inputs: [
      ['perche', 1],
      ['quartz', 1],
      ['corde', 1],
    ],
    steps: [
      { label: 'Fendre le bout de la perche', tool: 'tranchant', seconds: 3 },
      { label: 'Emmancher la pointe', tool: null, seconds: 2 },
      { label: 'Ligaturer', tool: null, seconds: 4 },
    ],
    output: { item: 'lance', count: 1 },
    known: false,
    hintedBy: ['perche', 'couteau'],
    hint: 'Une longue perche, une pointe de quartz, une ligature…',
  },
  archet: {
    id: 'archet',
    label: 'Archet à feu',
    inputs: [
      ['baton', 2],
      ['corde', 1],
      ['buche', 1],
    ],
    steps: [
      { label: 'Tailler la planchette dans la bûche', tool: 'tranchant', seconds: 5 },
      { label: 'Tailler le fuseau', tool: 'tranchant', seconds: 3 },
      { label: 'Bander l’archet', tool: null, seconds: 2 },
    ],
    output: { item: 'archet', count: 1 },
    known: false,
    hintedBy: ['herbe'],
    hint: 'Des herbes sèches pour un feu… il faudrait de quoi frotter du bois : deux bâtons, une corde, une bûche.',
  },
  pot_cru: {
    id: 'pot_cru',
    label: 'Pot d’argile crue',
    inputs: [['argile', 3]],
    steps: [{ label: 'Modeler le pot', tool: null, seconds: 8 }],
    output: { item: 'pot_cru', count: 1 },
    known: false,
    hintedBy: ['argile'],
    hint: 'L’argile se modèle : trois boules feraient un pot, à cuire ensuite au feu.',
  },
  batee: {
    id: 'batee',
    label: 'Batée',
    inputs: [['buche', 1]],
    steps: [
      { label: 'Creuser la batée', tool: 'tranchant', seconds: 10 },
      { label: 'Poncer avec une pierre', tool: 'percuteur', seconds: 4 },
    ],
    output: { item: 'batee', count: 1 },
    known: false,
    hintedBy: [],
    hint: 'Ce gravier brille… Un plat de bois creusé dans une bûche permettrait de le laver.',
  },
  foyer: {
    id: 'foyer',
    label: 'Foyer',
    inputs: [
      ['baton', 4],
      ['herbe', 2],
    ],
    steps: [{ label: 'Monter le foyer devant soi', tool: null, seconds: 4 }],
    output: { place: 'foyer' },
    known: true,
    hintedBy: [],
    hint: '',
  },
  pansement: {
    id: 'pansement',
    label: 'Pansements propres',
    inputs: [['chiffon', 2]],
    steps: [{ label: 'Faire bouillir les chiffons', tool: 'recipient', seconds: 4 }],
    output: { item: 'pansement', count: 2 },
    known: false,
    hintedBy: ['pot'],
    hint: 'Un pot d’eau bouillante… y faire bouillir des chiffons les rendrait propres.',
    boiledWater: true,
  },
  torche: {
    id: 'torche',
    label: 'Torche d’herbes',
    inputs: [
      ['baton', 1],
      ['herbe', 1],
    ],
    steps: [{ label: 'Lier les herbes au bâton', tool: null, seconds: 3 }],
    output: { item: 'torche', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
    burn: 600,
  },
  torche_resine: {
    id: 'torche_resine',
    label: 'Torche à la résine',
    inputs: [
      ['baton', 1],
      ['resine', 1],
    ],
    steps: [{ label: 'Enduire le bout de résine', tool: null, seconds: 3 }],
    output: { item: 'torche', count: 1 },
    known: false,
    hintedBy: ['resine'],
    hint: 'La résine brûle longtemps… sur un bâton, elle ferait une torche durable.',
    burn: 1200,
  },
  barre_fer: {
    id: 'barre_fer',
    label: 'Barre de fer',
    inputs: [['loupe_fer', 1]],
    steps: [
      { label: 'Chauffer la loupe au rouge', tool: null, seconds: 6 },
      { label: 'Battre pour chasser les scories', tool: 'percuteur', seconds: 8 },
    ],
    output: { item: 'barre_fer', count: 1 },
    known: false,
    hintedBy: ['loupe_fer'],
    hint: 'La loupe est pleine de scories : chauffée à la forge et battue, elle donnerait une barre de fer.',
    station: 'forge',
  },
  boulons: {
    id: 'boulons',
    label: 'Boulons (deux barres)',
    inputs: [['barre_fer', 2]],
    steps: [
      { label: 'Forger les tiges', tool: 'percuteur', seconds: 6 },
      { label: 'Refouler les têtes', tool: 'percuteur', seconds: 5 },
    ],
    output: { item: 'boulons', count: 8 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Deux barres de fer : de quoi forger des boulons pour les planchers et les poteaux.',
    station: 'forge',
  },
  clous: {
    id: 'clous',
    label: 'Clous (une barre)',
    inputs: [['barre_fer', 1]],
    steps: [
      { label: 'Étirer le fer', tool: 'percuteur', seconds: 6 },
      { label: 'Couper et appointer', tool: 'tranchant', seconds: 4 },
    ],
    output: { item: 'clous', count: 12 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Une barre de fer étirée et coupée : des clous.',
    station: 'forge',
  },
  hache_fer: {
    id: 'hache_fer',
    label: 'Hache en fer',
    inputs: [
      ['barre_fer', 2],
      ['manche', 1],
    ],
    steps: [
      { label: 'Souder les deux barres à la forge', tool: 'percuteur', seconds: 8 },
      { label: 'Forger le tranchant et l’œil', tool: 'percuteur', seconds: 8 },
      { label: 'Emmancher', tool: null, seconds: 3 },
    ],
    output: { item: 'hache_fer', count: 1 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Deux barres soudées à la forge, un manche : une hache en fer.',
    station: 'forge',
  },
  couteau_fer: {
    id: 'couteau_fer',
    label: 'Couteau en fer',
    inputs: [
      ['barre_fer', 1],
      ['manche', 1],
    ],
    steps: [
      { label: 'Forger la lame', tool: 'percuteur', seconds: 8 },
      { label: 'Emmancher', tool: null, seconds: 3 },
    ],
    output: { item: 'couteau_fer', count: 1 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Une barre de fer forgée en lame, un manche : un couteau en fer.',
    station: 'forge',
  },
  // Phase 7 : pièces de véhicules et de machines.
  petite_roue: {
    id: 'petite_roue',
    label: 'Petite roue',
    inputs: [
      ['buche', 1],
      ['baton', 2],
      ['corde', 1],
    ],
    steps: [
      { label: 'Tailler le moyeu et la jante dans la bûche', tool: 'tranchant', seconds: 6 },
      { label: 'Monter les rayons et ligaturer', tool: null, seconds: 4 },
    ],
    output: { item: 'petite_roue', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
  },
  roue: {
    id: 'roue',
    label: 'Roue cerclée de fer',
    inputs: [
      ['buche', 2],
      ['barre_fer', 1],
      ['clous', 8],
    ],
    steps: [
      { label: 'Assembler la jante et les rayons', tool: 'tranchant', seconds: 8 },
      { label: 'Cercler à chaud le bandage de fer', tool: 'percuteur', seconds: 8 },
    ],
    output: { item: 'roue', count: 1 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Une jante de bois, un bandage de fer posé à chaud à la forge : une roue qui tiendra la charge.',
    station: 'forge',
  },
  essieu: {
    id: 'essieu',
    label: 'Essieu',
    inputs: [
      ['barre_fer', 2],
      ['perche', 1],
    ],
    steps: [
      { label: 'Forger les fusées', tool: 'percuteur', seconds: 8 },
      { label: 'Les emmancher sur la perche', tool: null, seconds: 4 },
    ],
    output: { item: 'essieu', count: 1 },
    known: false,
    hintedBy: ['barre_fer'],
    hint: 'Une perche, deux fusées de fer à ses bouts : un essieu pour deux roues.',
    station: 'forge',
  },
  machine_vapeur: {
    id: 'machine_vapeur',
    label: 'Machine à vapeur',
    inputs: [
      ['barre_fer', 6],
      ['boulons', 8],
      ['clous', 12],
      ['argile', 3],
    ],
    steps: [
      { label: 'Forger et river la chaudière', tool: 'percuteur', seconds: 12 },
      { label: 'Forger le cylindre et ajuster le piston', tool: 'percuteur', seconds: 10 },
      { label: 'Monter le foyer d’argile', tool: null, seconds: 6 },
      { label: 'Boulonner l’ensemble', tool: 'percuteur', seconds: 6 },
    ],
    output: { item: 'machine_vapeur', count: 1 },
    known: false,
    hintedBy: ['boulons'],
    hint: 'De l’eau chauffée dans une chaudière de fer rivetée pousse un piston : une machine qui travaille seule, tant qu’on la nourrit de bois.',
    station: 'forge',
  },
  roue_aubes: {
    id: 'roue_aubes',
    label: 'Roue à aubes',
    inputs: [
      ['buche', 3],
      ['barre_fer', 1],
      ['boulons', 4],
    ],
    steps: [
      { label: 'Tailler les aubes', tool: 'hache', seconds: 8 },
      { label: 'Les boulonner sur l’axe de fer', tool: 'percuteur', seconds: 8 },
    ],
    output: { item: 'roue_aubes', count: 1 },
    known: false,
    hintedBy: ['machine_vapeur'],
    hint: 'Entraînée par la machine à vapeur, une roue garnie d’aubes pousserait un radeau.',
    station: 'forge',
  },
  gouvernail: {
    id: 'gouvernail',
    label: 'Gouvernail',
    inputs: [
      ['perche', 1],
      ['buche', 1],
      ['corde', 1],
    ],
    steps: [
      { label: 'Tailler le safran', tool: 'hache', seconds: 6 },
      { label: 'Le ligaturer à la barre', tool: null, seconds: 3 },
    ],
    output: { item: 'gouvernail', count: 1 },
    known: true,
    hintedBy: [],
    hint: '',
  },
};

export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

/** Outils fabriqués à ligature (réparables en re-ligaturant). */
const BOUND = new Set<ItemId>(['couteau', 'hache', 'lance']);

// ——— Connaissances et compétence ———

export interface Knowledge {
  known: RecipeId[];
  hinted: RecipeId[];
  /** Expérience de fabrication (et de construction). */
  xp: number;
  /** Plans de construction connus (phase 5). */
  plans: PlanId[];
}

export function makeKnowledge(): Knowledge {
  return { known: RECIPE_IDS.filter((id) => RECIPES[id].known), hinted: [], xp: 0, plans: startingPlans() };
}

/** Niveau de 0 à 10 : 10, 40, 90, 160… points d'expérience. */
export function skillLevel(xp: number): number {
  return Math.min(10, Math.floor(Math.sqrt(Math.max(0, xp) / 10)));
}

/** Rend pressenties les recettes liées à un objet ramassé ou fabriqué ; renvoie les nouvelles. */
export function hintFrom(k: Knowledge, item: ItemId): RecipeId[] {
  const out: RecipeId[] = [];
  for (const id of RECIPE_IDS) {
    if (k.known.includes(id) || k.hinted.includes(id)) continue;
    if (RECIPES[id].hintedBy.includes(item)) {
      k.hinted.push(id);
      out.push(id);
    }
  }
  return out;
}

export function hintRecipe(k: Knowledge, id: RecipeId): boolean {
  if (k.known.includes(id) || k.hinted.includes(id)) return false;
  k.hinted.push(id);
  return true;
}

export function learn(k: Knowledge, id: RecipeId): boolean {
  if (k.known.includes(id)) return false;
  k.known.push(id);
  k.hinted = k.hinted.filter((h) => h !== id);
  return true;
}

export function readKnowledge(raw: unknown): Knowledge {
  const k = makeKnowledge();
  if (typeof raw !== 'object' || raw === null) return k;
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown): RecipeId[] => (Array.isArray(v) ? v.filter((x): x is RecipeId => typeof x === 'string' && x in RECIPES) : []);
  for (const id of ids(r.known)) if (!k.known.includes(id)) k.known.push(id);
  for (const id of ids(r.hinted)) if (!k.known.includes(id) && !k.hinted.includes(id)) k.hinted.push(id);
  if (typeof r.xp === 'number' && Number.isFinite(r.xp)) k.xp = Math.max(0, Math.min(1e6, r.xp));
  k.plans = readPlans(r.plans);
  return k;
}

// ——— Plan de travail ———

/**
 * Recette correspondant aux pièces posées (quelle que soit la connaissance) : les mêmes sortes
 * de pièces, en quantité suffisante ; le surplus reste sur le plan de travail.
 */
export function matchRecipe(bench: ItemStack[]): Recipe | null {
  const count = new Map<ItemId, number>();
  for (const st of bench) count.set(st.item, (count.get(st.item) ?? 0) + st.count);
  for (const id of RECIPE_IDS) {
    const r = RECIPES[id];
    if (r.inputs.length !== count.size) continue;
    if (!r.inputs.every(([item, n]) => (count.get(item) ?? 0) >= n)) continue;
    if (r.stoneKg) {
      const stone = bench.find((st) => st.item === 'pierre');
      const kg = stone ? unitMass(stone) : 0;
      if (kg < r.stoneKg[0] || kg > r.stoneKg[1]) continue;
    }
    return r;
  }
  return null;
}

/** Indice pour une combinaison qui ne donne rien. */
export function experimentHint(bench: ItemStack[], k: Knowledge): string {
  if (bench.length === 0) return 'Posez des pièces sur le plan de travail.';
  const items = new Set(bench.map((st) => st.item));
  let best: Recipe | null = null;
  let bestScore = 0;
  for (const id of RECIPE_IDS) {
    const r = RECIPES[id];
    const score = r.inputs.filter(([item]) => items.has(item)).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (!best) return 'Rien ne se passe : ces pièces ne vont pas ensemble.';
  const missing = best.inputs.filter(([item, n]) => (bench.filter((st) => st.item === item).reduce((a, st) => a + st.count, 0) ?? 0) < n);
  const extra = [...items].filter((item) => !best!.inputs.some(([i]) => i === item));
  const knownRecipe = k.known.includes(best.id);
  if (extra.length) return `Rien ne se passe. Une pièce semble en trop (${ITEMS[extra[0]!].label}).`;
  if (best.stoneKg && missing.length === 0) return 'Il faudrait une pierre de 1 à 3 kg pour la tête.';
  if (missing.length) {
    const [item, n] = missing[0]!;
    if (knownRecipe || bestScore >= 2) return `Il manque quelque chose : peut-être ${ITEMS[item].label}${n > 1 ? ` (${n} en tout)` : ''}.`;
    return 'Ces pièces semblent aller ensemble, mais il manque quelque chose.';
  }
  return 'Rien ne se passe.';
}

/** L'outil d'une étape est-il disponible ? (pièces du plan de travail exclues) */
export function stepToolOk(step: RecipeStep, tools: ItemStack[]): boolean {
  if (!step.tool) return true;
  return tools.some((st) => ITEMS[st.item].tool?.tags.includes(step.tool!) && (st.d === undefined || st.d > 0));
}

// ——— Qualité, usure, réparation ———

/** Qualité d'un objet fabriqué selon les pièces, la compétence et le hasard (0 à 1). */
export function craftQuality(inputs: ItemStack[], level: number, r1: number, r2: number, r3: number): { q: number; fx: number } {
  const qs = inputs.map((st) => st.q ?? 60);
  const base = qs.reduce((a, b) => a + b, 0) / Math.max(1, qs.length);
  const q = Math.round(Math.max(5, Math.min(100, base * 0.6 + level * 4 + r1 * 20)));
  let fx = 0;
  if (r2 < Math.max(0.03, 0.25 - level * 0.022)) fx |= r3 < 0.5 ? FX_LIGATURE_LACHE : FX_MANCHE_FENDU;
  return { q, fx };
}

/** Durabilité maximale d'un outil neuf selon sa qualité et ses défauts. */
export function maxDurability(item: ItemId, q: number, fx: number): number {
  const base = ITEMS[item].tool?.durability ?? 0;
  if (base <= 0) return 0;
  let dm = base * (0.6 + q / 250);
  if (fx & FX_LIGATURE_LACHE) dm *= 0.7;
  if (fx & FX_MANCHE_FENDU) dm *= 0.8;
  if (fx & FX_DURCI) dm *= 1.5;
  if (fx & FX_RESINE) dm *= 1.25;
  return Math.max(1, Math.round(dm));
}

/** Donne à un outil ses propriétés s'il n'en a pas encore (outil naturel ou neuf). */
export function ensureToolMeta(st: ItemStack, q = 60): void {
  const spec = ITEMS[st.item].tool;
  if (!spec || spec.durability <= 0) return;
  if (st.q === undefined) st.q = q;
  if (st.dm === undefined) st.dm = maxDurability(st.item, st.q, st.fx ?? 0);
  if (st.d === undefined) st.d = st.dm;
}

/** Travail fait par coup selon la qualité et l'état. */
export function toolPower(st: ItemStack): number {
  const spec = ITEMS[st.item].tool;
  if (!spec) return 0;
  // Galets : toujours pareils. Objet naturel sans qualité connue : bonne qualité.
  if (spec.durability <= 0) return spec.power;
  const q = st.q ?? 75;
  let p = spec.power * (0.6 + (0.4 * q) / 100);
  if (st.d !== undefined && st.dm) {
    const ratio = st.d / st.dm;
    if (ratio < 0.2) p *= 0.7;
    else if (ratio < 0.5) p *= 0.85;
  }
  return p;
}

export type Condition = 'neuf' | 'usé' | 'abîmé' | 'très abîmé' | 'cassé';

export function conditionOf(st: ItemStack): Condition | null {
  if (st.d === undefined || !st.dm) return null;
  const r = st.d / st.dm;
  if (st.d <= 0) return 'cassé';
  if (r > 0.8) return 'neuf';
  if (r > 0.5) return 'usé';
  if (r > 0.2) return 'abîmé';
  return 'très abîmé';
}

/** Use l'outil ; renvoie vrai s'il casse. */
export function wear(st: ItemStack, amount = 1): boolean {
  if (st.d === undefined) return false;
  st.d = Math.max(0, st.d - amount);
  return st.d <= 0;
}

/** Lames qu'une meule sait affûter (phase 7). */
const SHARP_EDGES = new Set<ItemId>(['couteau', 'hache', 'couteau_fer', 'hache_fer', 'lance']);

export type RepairKind = 'religaturer' | 'affuter' | 'retailler' | 'recorder' | 'meule';

export interface RepairOption {
  kind: RepairKind;
  label: string;
  needs: Array<[ItemId, number]>;
  tool: ToolTag | null;
  seconds: number;
}

/** Options de réparation ; meule : une meule entraînée tourne à portée (phase 7). */
export function repairOptions(st: ItemStack, meule = false): RepairOption[] {
  if (st.d === undefined || !st.dm || st.d >= st.dm) return [];
  const out: RepairOption[] = [];
  if (meule && SHARP_EDGES.has(st.item)) out.push({ kind: 'meule', label: 'Affûter à la meule', needs: [], tool: null, seconds: 4 });
  if (BOUND.has(st.item)) out.push({ kind: 'religaturer', label: 'Refaire la ligature', needs: [['corde', 1]], tool: null, seconds: 4 });
  if (st.item === 'couteau' || st.item === 'hache' || st.item === 'couteau_fer' || st.item === 'hache_fer') out.push({ kind: 'affuter', label: 'Affûter sur une pierre', needs: [], tool: 'percuteur', seconds: 5 });
  if (st.item === 'baton_fouir' || st.item === 'lance') out.push({ kind: 'retailler', label: 'Retailler la pointe', needs: [], tool: 'tranchant', seconds: 3 });
  if (st.item === 'archet') out.push({ kind: 'recorder', label: 'Changer la corde', needs: [['corde', 1]], tool: null, seconds: 2 });
  return out;
}

/** Répare : rend de la durabilité, mais chaque réparation réduit le maximum. */
export function applyRepair(st: ItemStack, kind: RepairKind): void {
  if (st.d === undefined || !st.dm) return;
  if (kind === 'meule') {
    // La meule rend tout le tranchant sans entamer la lame : la durabilité maximale ne baisse pas.
    st.d = st.dm;
    return;
  }
  const gain = kind === 'religaturer' ? 0.5 : kind === 'affuter' ? 0.3 : kind === 'retailler' ? 0.4 : 0.9;
  const loss = kind === 'affuter' ? 0.92 : 0.9;
  st.dm = Math.max(1, Math.round(st.dm * loss));
  st.d = Math.min(st.dm, Math.round(st.d + st.dm * gain));
  if (kind === 'religaturer' && st.fx) st.fx &= ~FX_LIGATURE_LACHE;
}

export type ImproveKind = 'durcir' | 'resine';

export interface ImproveOption {
  kind: ImproveKind;
  label: string;
  needs: Array<[ItemId, number]>;
  /** Il faut un feu allumé à côté. */
  fire: boolean;
  seconds: number;
}

export function improveOptions(st: ItemStack): ImproveOption[] {
  const out: ImproveOption[] = [];
  const fx = st.fx ?? 0;
  if ((st.item === 'baton_fouir' || st.item === 'lance') && !(fx & FX_DURCI)) out.push({ kind: 'durcir', label: 'Durcir la pointe au feu', needs: [], fire: true, seconds: 8 });
  if (BOUND.has(st.item) && !(fx & FX_RESINE)) out.push({ kind: 'resine', label: 'Enduire la ligature de résine', needs: [['resine', 1]], fire: false, seconds: 3 });
  return out;
}

export function applyImprove(st: ItemStack, kind: ImproveKind): void {
  if (st.d === undefined || !st.dm) ensureToolMeta(st);
  const factor = kind === 'durcir' ? 1.5 : 1.25;
  st.fx = (st.fx ?? 0) | (kind === 'durcir' ? FX_DURCI : FX_RESINE);
  if (kind === 'resine') st.fx &= ~FX_LIGATURE_LACHE;
  st.dm = Math.round(st.dm! * factor);
  st.d = Math.min(st.dm, Math.round(st.d! * factor));
  st.q = Math.min(100, (st.q ?? 60) + 5);
}

// ——— Démontage (recyclage) ———

/** Pièces récupérées en démontant un objet, selon son état (r : nombres au hasard dans [0, 1)). */
export function dismantle(st: ItemStack, r: () => number): ItemStack[] {
  const ratio = st.d !== undefined && st.dm ? st.d / st.dm : 1;
  const out: ItemStack[] = [];
  const add = (item: ItemId, count = 1, extra: Partial<ItemStack> = {}) => out.push({ item, count, ...extra });
  switch (st.item) {
    case 'couteau':
      if (r() < 0.9) add('manche');
      if (ratio > 0.5) add('quartz', 1, { q: Math.round((st.q ?? 60) * 0.8) });
      if (ratio > 0.3 && r() < 0.6) add('corde');
      break;
    case 'hache':
      add('pierre', 1, { mass: 1.5, radius: 0.07 });
      if (r() < 0.8) add('manche');
      if (ratio > 0.3) add('corde', r() < 0.5 ? 2 : 1);
      break;
    case 'lance':
      if (r() < 0.9) add('perche');
      if (ratio > 0.5) add('quartz', 1, { q: Math.round((st.q ?? 60) * 0.8) });
      if (ratio > 0.3 && r() < 0.6) add('corde');
      break;
    case 'archet':
      add('baton', ratio > 0.4 ? 2 : 1);
      if (r() < 0.7) add('corde');
      break;
    case 'baton_fouir':
      if (ratio > 0.3) add('baton');
      break;
    case 'corde':
      add('fibres', ratio > 0.5 ? 2 : 1);
      break;
    case 'hache_fer':
      if (r() < 0.8) add('manche');
      if (ratio > 0.3) add('barre_fer');
      break;
    case 'couteau_fer':
      if (r() < 0.9) add('manche');
      if (ratio > 0.5) add('barre_fer');
      break;
    default:
      break;
  }
  return out;
}

export function canDismantle(item: ItemId): boolean {
  return ['couteau', 'hache', 'lance', 'archet', 'baton_fouir', 'corde', 'hache_fer', 'couteau_fer'].includes(item);
}
