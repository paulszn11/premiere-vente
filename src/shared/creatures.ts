// Catalogue des créatures (phase 6) : espèces, caractéristiques, sens, attaques, et géométrie de
// leur corps (capsule) pour localiser les coups. Proposition signalée (section 15 du cahier) :
// les chiffres sont modifiables. Les comportements sont dans fauna.ts.

import type { BiomeId } from './geography';
import type { InjuryKind, Zone } from './vitals';

export type SpeciesId = 'impala' | 'phacochere' | 'babouin' | 'elephant' | 'hyene' | 'leopard' | 'crocodile' | 'vautour' | 'ombre';

/** Grandes familles de comportement. */
export type Archetype = 'proie' | 'defensif' | 'troupe' | 'pachyderme' | 'meute' | 'embuscade' | 'aquatique' | 'charognard' | 'abysse';

/** Parties du corps d'une créature (localisation des coups). */
export type BodyPart = 'tete' | 'cou' | 'corps' | 'arriere' | 'pattes';

export const PART_LABELS: Record<BodyPart, string> = { tete: 'à la tête', cou: 'au cou', corps: 'au flanc', arriere: 'à l’arrière-train', pattes: 'à la patte' };
/** Multiplicateur de dégâts selon la partie touchée. */
export const PART_DAMAGE: Record<BodyPart, number> = { tete: 2, cou: 1.6, corps: 1, arriere: 0.8, pattes: 0.6 };

export interface AttackSpec {
  label: string;
  /** Portée depuis l'avant du corps (m). */
  reach: number;
  /** Temps de préparation (s) puis délai avant la suivante. */
  windup: number;
  cooldown: number;
  /** Santé ôtée au joueur. */
  damage: number;
  /** Zones visées (tirées au hasard, pondérées). */
  zones: Array<[Zone, number]>;
  injury: InjuryKind;
  /** Probabilité d'une coupure grave (si coupure) et d'une fracture en plus. */
  grave: number;
  fracture: number;
  /** Vitesse donnée au joueur par le choc (m/s). */
  knock: number;
  /** Saisit le joueur (crocodile, créature du lac). */
  grab?: boolean;
}

export interface SpeciesDef {
  id: SpeciesId;
  label: string;
  plural: string;
  feminine: boolean;
  archetype: Archetype;
  /** Masse (kg), santé, demi-longueur du corps, hauteur au garrot, rayon du corps (m). */
  mass: number;
  hp: number;
  halfLength: number;
  height: number;
  radius: number;
  /** Vitesses (m/s) : marche, course ; nage pour les aquatiques. Virage (rad/s), accélération (m/s²). */
  walk: number;
  run: number;
  swim: number;
  turn: number;
  accel: number;
  /** Profondeur d'eau maximale où il s'aventure (m) ; profondeur minimale (aquatiques stricts). */
  maxWade: number;
  minDepth: number;
  /** Pente maximale : composante verticale minimale de la normale du sol. */
  slope: number;
  vision: { range: number; fov: number };
  /** Multiplicateur de l'ouïe et portée de l'odorat (m). */
  hearing: number;
  smell: number;
  /** Distance de fuite de base face au joueur (m). */
  flee: number;
  /** Rayon de crainte du feu (m ; 0 : indifférent). */
  fearFire: number;
  group: [number, number];
  /** Habitat : intérêt de chaque biome (0 à 1). */
  biomes: Partial<Record<BiomeId, number>>;
  /** Individus par km² dans un habitat idéal. */
  density: number;
  /** Naissances par heure de jeu et par individu (population de la zone). */
  births: number;
  attack?: AttackSpec;
  /** Portions de viande d'une carcasse. */
  meat: number;
}

const LEGS: Array<[Zone, number]> = [
  ['jambe_g', 3],
  ['jambe_d', 3],
  ['bras_g', 1],
  ['bras_d', 1],
  ['torse', 0.6],
];

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  impala: {
    id: 'impala',
    label: 'impala',
    plural: 'impalas',
    feminine: false,
    archetype: 'proie',
    mass: 55,
    hp: 60,
    halfLength: 0.65,
    height: 0.9,
    radius: 0.28,
    walk: 1.3,
    run: 12,
    swim: 1,
    turn: 4,
    accel: 14,
    maxWade: 0.6,
    minDepth: 0,
    slope: 0.74,
    vision: { range: 75, fov: 300 },
    hearing: 1.3,
    smell: 40,
    flee: 35,
    fearFire: 10,
    group: [4, 9],
    biomes: { plateau: 1, lowveld: 1, vallee: 0.8, miombo: 0.6, vlei: 0.5, fleuve: 0.4 },
    density: 22,
    births: 0.05,
    meat: 6,
  },
  phacochere: {
    id: 'phacochere',
    label: 'phacochère',
    plural: 'phacochères',
    feminine: false,
    archetype: 'defensif',
    mass: 80,
    hp: 80,
    halfLength: 0.6,
    height: 0.7,
    radius: 0.3,
    walk: 1,
    run: 8.5,
    swim: 0.8,
    turn: 3.5,
    accel: 10,
    maxWade: 0.5,
    minDepth: 0,
    slope: 0.76,
    vision: { range: 25, fov: 220 },
    hearing: 1,
    smell: 40,
    flee: 18,
    fearFire: 8,
    group: [1, 4],
    biomes: { lowveld: 1, plateau: 0.7, vallee: 0.7, kalahari: 0.6, vlei: 0.5, miombo: 0.4 },
    density: 6,
    births: 0.05,
    attack: { label: 'coup de défenses', reach: 0.6, windup: 0.35, cooldown: 1.6, damage: 12, zones: LEGS, injury: 'coupure', grave: 0.3, fracture: 0.05, knock: 2.5 },
    meat: 5,
  },
  babouin: {
    id: 'babouin',
    label: 'babouin',
    plural: 'babouins',
    feminine: false,
    archetype: 'troupe',
    mass: 25,
    hp: 50,
    halfLength: 0.4,
    height: 0.6,
    radius: 0.22,
    walk: 1.4,
    run: 9,
    swim: 0.8,
    turn: 5,
    accel: 14,
    maxWade: 0.5,
    minDepth: 0,
    slope: 0.5,
    vision: { range: 90, fov: 180 },
    hearing: 1,
    smell: 15,
    flee: 25,
    fearFire: 8,
    group: [6, 11],
    biomes: { matobo: 1, escarpement: 1, hautes_terres: 0.6, vallee: 0.5, fleuve: 0.5, miombo: 0.4 },
    density: 10,
    births: 0.03,
    attack: {
      label: 'morsure',
      reach: 0.45,
      windup: 0.3,
      cooldown: 1.2,
      damage: 9,
      zones: [
        ['bras_g', 2],
        ['bras_d', 2],
        ['jambe_g', 2],
        ['jambe_d', 2],
        ['torse', 1],
      ],
      injury: 'coupure',
      grave: 0.25,
      fracture: 0,
      knock: 1,
    },
    meat: 3,
  },
  elephant: {
    id: 'elephant',
    label: 'éléphant',
    plural: 'éléphants',
    feminine: false,
    archetype: 'pachyderme',
    mass: 4000,
    hp: 900,
    halfLength: 1.9,
    height: 2.9,
    radius: 1.15,
    walk: 1.5,
    run: 6.5,
    swim: 1.2,
    turn: 1.2,
    accel: 3,
    maxWade: 2.6,
    minDepth: 0,
    slope: 0.8,
    vision: { range: 30, fov: 200 },
    hearing: 1.2,
    smell: 120,
    flee: 22,
    fearFire: 4,
    group: [3, 6],
    biomes: { vallee: 1, fleuve: 0.8, miombo: 0.7, lowveld: 0.6, kalahari: 0.3 },
    density: 1.5,
    births: 0.005,
    attack: {
      label: 'charge',
      reach: 1.2,
      windup: 0.5,
      cooldown: 3,
      damage: 55,
      zones: [
        ['torse', 4],
        ['jambe_g', 1],
        ['jambe_d', 1],
        ['tete', 1],
      ],
      injury: 'contusion',
      grave: 0,
      fracture: 0.55,
      knock: 9,
    },
    meat: 20,
  },
  hyene: {
    id: 'hyene',
    label: 'hyène',
    plural: 'hyènes',
    feminine: true,
    archetype: 'meute',
    mass: 60,
    hp: 90,
    halfLength: 0.62,
    height: 0.8,
    radius: 0.3,
    walk: 1.6,
    run: 11,
    swim: 1,
    turn: 4,
    accel: 12,
    maxWade: 0.8,
    minDepth: 0,
    slope: 0.72,
    vision: { range: 60, fov: 200 },
    hearing: 1.4,
    smell: 150,
    flee: 12,
    fearFire: 6,
    group: [3, 5],
    biomes: { lowveld: 1, vallee: 0.8, plateau: 0.7, kalahari: 0.6, miombo: 0.4 },
    density: 1.2,
    births: 0.02,
    attack: { label: 'morsure', reach: 0.55, windup: 0.4, cooldown: 1.4, damage: 14, zones: LEGS, injury: 'coupure', grave: 0.35, fracture: 0.12, knock: 1.5 },
    meat: 4,
  },
  leopard: {
    id: 'leopard',
    label: 'léopard',
    plural: 'léopards',
    feminine: false,
    archetype: 'embuscade',
    mass: 60,
    hp: 110,
    halfLength: 0.7,
    height: 0.7,
    radius: 0.26,
    walk: 1.5,
    run: 16,
    swim: 1,
    turn: 5,
    accel: 18,
    maxWade: 0.6,
    minDepth: 0,
    slope: 0.45,
    vision: { range: 90, fov: 200 },
    hearing: 1.2,
    smell: 30,
    flee: 30,
    fearFire: 8,
    group: [1, 1],
    biomes: { matobo: 1, escarpement: 0.8, hautes_terres: 0.6, miombo: 0.5 },
    density: 0.25,
    births: 0,
    attack: {
      label: 'attaque',
      reach: 0.6,
      windup: 0.25,
      cooldown: 1.3,
      damage: 26,
      zones: [
        ['torse', 3],
        ['tete', 2],
        ['bras_g', 1.5],
        ['bras_d', 1.5],
        ['jambe_g', 0.5],
        ['jambe_d', 0.5],
      ],
      injury: 'coupure',
      grave: 0.5,
      fracture: 0.05,
      knock: 3,
    },
    meat: 4,
  },
  crocodile: {
    id: 'crocodile',
    label: 'crocodile',
    plural: 'crocodiles',
    feminine: false,
    archetype: 'aquatique',
    mass: 400,
    hp: 300,
    halfLength: 1.9,
    height: 0.5,
    radius: 0.35,
    walk: 0.8,
    run: 3,
    swim: 2.5,
    turn: 2.2,
    accel: 16,
    maxWade: 99,
    minDepth: 0,
    slope: 0.8,
    vision: { range: 25, fov: 170 },
    hearing: 1,
    smell: 10,
    flee: 8,
    fearFire: 0,
    group: [1, 1],
    biomes: { fleuve: 1, vlei: 0.4, vallee: 0.3 },
    density: 3,
    births: 0.01,
    attack: { label: 'morsure', reach: 0.7, windup: 0.15, cooldown: 2.5, damage: 20, zones: LEGS, injury: 'coupure', grave: 0.5, fracture: 0.3, knock: 0, grab: true },
    meat: 8,
  },
  vautour: {
    id: 'vautour',
    label: 'vautour',
    plural: 'vautours',
    feminine: false,
    archetype: 'charognard',
    mass: 6,
    hp: 15,
    halfLength: 0.4,
    height: 0.8,
    radius: 0.25,
    walk: 0.8,
    run: 12,
    swim: 0,
    turn: 2,
    accel: 6,
    maxWade: 0.2,
    minDepth: 0,
    slope: 0,
    vision: { range: 400, fov: 360 },
    hearing: 0.5,
    smell: 0,
    flee: 12,
    fearFire: 0,
    group: [3, 6],
    biomes: {},
    density: 0,
    births: 0,
    meat: 0,
  },
  ombre: {
    id: 'ombre',
    label: 'créature du lac',
    plural: 'créatures du lac',
    feminine: true,
    archetype: 'abysse',
    mass: 3000,
    hp: 600,
    halfLength: 1.2,
    height: 1.2,
    radius: 0.7,
    walk: 3,
    run: 9,
    swim: 3,
    turn: 1.6,
    accel: 5,
    maxWade: 999,
    minDepth: 3,
    slope: 0,
    vision: { range: 20, fov: 360 },
    hearing: 1,
    smell: 120,
    flee: 0,
    fearFire: 0,
    group: [1, 1],
    biomes: {},
    density: 0,
    births: 0,
    attack: {
      label: 'saisie',
      reach: 1,
      windup: 0.2,
      cooldown: 6,
      damage: 8,
      zones: [
        ['jambe_g', 2],
        ['jambe_d', 2],
        ['torse', 1],
      ],
      injury: 'contusion',
      grave: 0,
      fracture: 0.2,
      knock: 0,
      grab: true,
    },
    meat: 0,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
/** Espèces dont la population vit dans les zones (apparitions dynamiques). */
export const POPULATION_SPECIES: SpeciesId[] = ['impala', 'phacochere', 'babouin', 'elephant', 'hyene', 'crocodile'];

export function isSpeciesId(v: unknown): v is SpeciesId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIES, v);
}

/** « un impala », « une hyène », « l'éléphant ». */
export function speciesName(id: SpeciesId, article: 'un' | 'le' = 'un'): string {
  const d = SPECIES[id];
  if (article === 'un') return `${d.feminine ? 'une' : 'un'} ${d.label}`;
  if (/^[aeéèêiïoôuh]/i.test(d.label)) return `l’${d.label}`;
  return `${d.feminine ? 'la' : 'le'} ${d.label}`;
}

// ——— Géométrie du corps ———

/** Segment central de la capsule du corps (avant et arrière), dans le monde. */
export function bodySegment(sp: SpeciesId, x: number, y: number, z: number, yaw: number, scale = 1): { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number } {
  const d = SPECIES[sp];
  const hl = d.halfLength * scale;
  const cy = y + Math.max(d.radius, d.height * 0.62) * scale;
  const sx = Math.sin(yaw) * hl;
  const sz = Math.cos(yaw) * hl;
  return { ax: x + sx, ay: cy, az: z + sz, bx: x - sx, by: cy, bz: z - sz, r: d.radius * scale * 1.15 };
}

/**
 * Intersection d'un rayon (origine o, direction unitaire d) avec une capsule [a, b] de rayon r.
 * Renvoie la distance le long du rayon, ou null.
 */
export function rayCapsule(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, r: number, maxT: number): number | null {
  // Recherche du point le plus proche par échantillonnage fin puis affinage : robuste et suffisant ici.
  const steps = 24;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = (maxT * i) / steps;
    const dist = pointSegmentDistance(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t, a, b);
    if (dist < bestD) {
      bestD = dist;
      best = t;
    }
  }
  if (best < 0) return null;
  let lo = Math.max(0, best - maxT / steps);
  let hi = Math.min(maxT, best + maxT / steps);
  for (let k = 0; k < 20; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = pointSegmentDistance(o.x + d.x * m1, o.y + d.y * m1, o.z + d.z * m1, a, b);
    const d2 = pointSegmentDistance(o.x + d.x * m2, o.y + d.y * m2, o.z + d.z * m2, a, b);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const tc = (lo + hi) / 2;
  const dc = pointSegmentDistance(o.x + d.x * tc, o.y + d.y * tc, o.z + d.z * tc, a, b);
  if (dc > r) return null;
  // Remonte jusqu'à l'entrée dans la capsule.
  let enter = tc;
  let lo2 = 0;
  let hi2 = tc;
  for (let k = 0; k < 20; k++) {
    const m = (lo2 + hi2) / 2;
    if (pointSegmentDistance(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m, a, b) <= r) hi2 = m;
    else lo2 = m;
  }
  enter = hi2;
  return enter;
}

export function pointSegmentDistance(px: number, py: number, pz: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t - px;
  const cy = a.y + aby * t - py;
  const cz = a.z + abz * t - pz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Distance entre deux segments (approchée par échantillonnage du premier). */
export function segmentSegmentDistance(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { d: number; t: number } {
  let best = Infinity;
  let bt = 0;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const d = pointSegmentDistance(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t, a, b);
    if (d < best) {
      best = d;
      bt = t;
    }
  }
  return { d: best, t: bt };
}

/** Partie du corps touchée, d'après le point d'impact (monde) et la position de la créature. */
export function partAt(sp: SpeciesId, cx: number, cy: number, cz: number, yaw: number, hx: number, hy: number, hz: number, scale = 1): BodyPart {
  const d = SPECIES[sp];
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Avant (+) ou arrière (−) le long du corps, normalisé par la demi-longueur.
  const along = ((hx - cx) * fx + (hz - cz) * fz) / Math.max(0.1, d.halfLength * scale);
  const up = (hy - cy) / Math.max(0.1, d.height * scale);
  if (d.archetype === 'abysse') return along > 0.5 ? 'tete' : 'corps';
  if (up < 0.38 && d.height > 0.55) return 'pattes';
  if (along > 0.85) return up > 0.55 || d.height < 0.6 ? 'tete' : 'cou';
  if (along > 0.55) return 'cou';
  if (along < -0.55) return 'arriere';
  return 'corps';
}
