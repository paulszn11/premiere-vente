// Lieux abandonnés (phase 9) : fermes, mission, halte ferroviaire, station de recherche du lac, mine d'or,
// enceinte de pierre sèche, cercle de pierres. Leur emplacement découle de la graine (calcul identique
// partout) ; leurs bâtiments sont faits des pièces de construction du jeu, abîmés ou effondrés, et se
// visitent, se réparent ou se démontent. Seul l'hôte les crée dans le monde (quand un joueur approche) ;
// ils sont ensuite enregistrés et transmis comme toute construction.

import type { Material, PlanId, SlotRef } from './building';
import { WATER_LEVEL, WORLD_HALF } from './constants';
import { type BiomeId, LANDMARKS } from './geography';
import { DIRS16 } from './hydrology';
import type { ItemStack } from './inventory';
import type { PropKind } from './props';
import { hash32, mulberry32 } from './rng';
import type { Terrain } from './terrain';

export type PlaceKind = 'ferme' | 'mission' | 'gare' | 'station' | 'mine' | 'ruines' | 'cercle';

export const PLACE_KINDS: PlaceKind[] = ['station', 'gare', 'mission', 'mine', 'ruines', 'cercle', 'ferme'];

export const PLACE_LABELS: Record<PlaceKind, string> = {
  ferme: 'ferme abandonnée',
  mission: 'mission',
  gare: 'halte de Nyangombe',
  station: 'station de recherche du lac',
  mine: 'mine de la Colline Rouge',
  ruines: 'enceinte de pierre sèche',
  cercle: 'les Pierres Debout',
};

export interface PlaceSite {
  id: string;
  kind: PlaceKind;
  /** Rang parmi les lieux du même genre (les fermes n'ont pas toutes la même histoire). */
  index: number;
  x: number;
  /** Niveau de base des constructions. */
  y: number;
  z: number;
  /** Orientation (rad, même convention que les constructions : 0 = +z). */
  yaw: number;
}

interface Rule {
  count: number;
  biomes: BiomeId[] | null;
  /** Zone de recherche : centre et demi-côté (m). */
  cx: number;
  cz: number;
  radius: number;
  /** Demi-côté de l'emprise (m) et dénivelé admis dessus. */
  half: number;
  flat: number;
}

const RULES: Record<PlaceKind, Rule> = {
  // La station est sur pilotis (rive en pente) : on admet plus de dénivelé.
  station: { count: 1, biomes: null, cx: -2400, cz: 5900, radius: 3300, half: 7, flat: 3 },
  gare: { count: 1, biomes: ['plateau', 'miombo'], cx: 0, cz: 1500, radius: 3000, half: 16, flat: 1 },
  mission: { count: 1, biomes: ['hautes_terres', 'plateau', 'miombo'], cx: 4800, cz: 300, radius: 2600, half: 10, flat: 1 },
  mine: { count: 1, biomes: ['plateau', 'miombo', 'matobo'], cx: 1800, cz: -1600, radius: 3200, half: 10, flat: 1 },
  ruines: { count: 2, biomes: ['plateau', 'matobo', 'lowveld', 'miombo'], cx: 2500, cz: -3800, radius: 3800, half: 13, flat: 1.6 },
  cercle: { count: 1, biomes: ['lowveld', 'kalahari', 'plateau'], cx: -1200, cz: -5200, radius: 3000, half: 11, flat: 1.6 },
  ferme: { count: 4, biomes: ['plateau', 'miombo', 'vlei'], cx: 0, cz: 0, radius: 6000, half: 12, flat: 1 },
};

/** Distance minimale (m) entre deux lieux. */
const SPACING = 900;
const QUARTER = Math.PI / 2;

const cache = new WeakMap<Terrain, PlaceSite[]>();

/** Lieux d'un monde, calculés une seule fois par terrain. */
export function placesOf(terrain: Terrain): PlaceSite[] {
  let list = cache.get(terrain);
  if (!list) {
    list = findPlaces(terrain);
    cache.set(terrain, list);
  }
  return list;
}

/**
 * Emplacement des lieux d'un monde (identique pour tous). Les critères rapides portent sur le relief
 * d'origine ; l'emplacement retenu est vérifié sur le vrai sol (pas de ruisseau, pas d'eau).
 */
export function findPlaces(terrain: Terrain): PlaceSite[] {
  const out: PlaceSite[] = [];
  if (!terrain.floraEnabled) return out;
  const seed = terrain.seed;
  PLACE_KINDS.forEach((kind, ki) => {
    const rule = RULES[kind];
    let found = 0;
    for (let n = 0; n < 900 && found < rule.count; n++) {
      const h = hash32(seed, ki * 7919 + n, 0x91ace, 3);
      let x: number;
      let z: number;
      if (kind === 'station') {
        // Au bord du lac : on part du centre dans une direction et on avance jusqu'à la terre ferme.
        const c = shorePoint(terrain, n, h);
        if (!c) continue;
        x = c.x;
        z = c.z;
      } else {
        x = Math.round(rule.cx + (((h & 0xffff) / 65536) * 2 - 1) * rule.radius);
        z = Math.round(rule.cz + ((((h >>> 16) & 0xffff) / 65536) * 2 - 1) * rule.radius);
      }
      if (Math.abs(x) > WORLD_HALF - 900 || Math.abs(z) > WORLD_HALF - 900) continue;
      if (out.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < SPACING * SPACING)) continue;
      const s = terrain.sampleInto(x, z);
      if (rule.biomes && !rule.biomes.includes(s.biome)) continue;
      if (s.kopje > 0.15 || s.border > 0.05 || (kind !== 'station' && s.river > 0.01)) continue;
      const site = checkSite(terrain, kind, x, z, rule, h);
      if (!site) continue;
      out.push({ id: `${kind}${found}`, kind, index: found, ...site });
      found++;
    }
  });
  return out;
}

/** Point de la rive du grand lac (direction et recul choisis par `n` et `h`), un peu en retrait de l'eau. */
function shorePoint(terrain: Terrain, n: number, h: number): { x: number; z: number } | null {
  const L = LANDMARKS.lake;
  const d = DIRS16[n % 16]!;
  for (let t = 0.5; t < 1.8; t += 0.01) {
    const x = L.x + d[0] * L.rx * t;
    const z = L.z + d[1] * L.rz * t;
    if (terrain.rawHeightAt(x, z) > WATER_LEVEL + 1.5) {
      // Un peu en retrait (12 à 40 m), selon le tirage.
      const back = 12 + ((h >>> 20) & 31);
      return { x: Math.round(x + d[0] * back), z: Math.round(z + d[1] * back) };
    }
  }
  return null;
}

/** Vérifie une emprise : plate, hors de l'eau ; renvoie le niveau et l'orientation, ou null. */
function checkSite(terrain: Terrain, kind: PlaceKind, x: number, z: number, rule: Rule, h: number): { x: number; y: number; z: number; yaw: number } | null {
  const half = rule.half;
  let lo = Infinity;
  let hi = -Infinity;
  // D'abord le relief d'origine (rapide), puis le vrai sol (lits des ruisseaux) et l'eau locale.
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const y = terrain.rawHeightAt(x + (a * half) / 2, z + (b * half) / 2);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (hi - lo > rule.flat || lo < WATER_LEVEL + 1.2) return null;
  let yaw = ((h >>> 9) & 3) * QUARTER;
  if (kind === 'station') {
    // Au bord du lac : de l'eau profonde à 30–70 m d'un côté ; la porte donne sur l'eau.
    let best = Infinity;
    let dir = -1;
    const dirs: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    dirs.forEach(([dx, dz], k) => {
      const d = terrain.rawHeightAt(x + dx * 55, z + dz * 55);
      if (d < best) {
        best = d;
        dir = k;
      }
    });
    if (best > WATER_LEVEL - 0.8 || lo > WATER_LEVEL + 10) return null;
    // Le côté −z local (la porte) fait face à l'eau : +z local = direction opposée.
    const [dx, dz] = dirs[dir]!;
    yaw = Math.atan2(-dx, -dz);
  }
  let groundLo = Infinity;
  let groundHi = -Infinity;
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const px = x + (a * half) / 2;
      const pz = z + (b * half) / 2;
      const g = terrain.heightAt(px, pz);
      if (terrain.waterLevelAt(px, pz) > g - 0.3) return null;
      if (g < groundLo) groundLo = g;
      if (g > groundHi) groundHi = g;
    }
  }
  if (groundLo < terrain.rawHeightAt(x, z) - 1.6) return null;
  // Sur pilotis, le plancher passe au-dessus du point le plus haut ; sinon, les murs reposent au plus bas
  // (enterrés d'un mètre au plus côté amont, jamais en l'air).
  return { x, y: kind === 'station' ? groundHi + 0.15 : groundLo + 0.02, z, yaw };
}

// ——— Plans des lieux ———

export interface PieceSpec {
  plan: PlanId;
  slot: SlotRef;
  /** Plancher sur pilotis (nombre de coins). */
  stilts?: number;
  /** Points de vie restants (fraction). */
  hp?: number;
  /** Porte fermée à clé : identifiant de la clé. */
  lock?: string;
  mat?: Material;
}

export interface StructSpec {
  /** Position dans le repère du lieu (m) et orientation relative. */
  lx: number;
  lz: number;
  yaw: number;
  pieces: PieceSpec[];
}

export interface LootSpec {
  kind: PropKind;
  /** Position dans le repère du lieu (m). */
  lx: number;
  lz: number;
  rot?: number;
  /** Document ou clé : lequel. */
  tag?: string;
  /** Outil trouvé : qualité, usure. */
  q?: number;
  d?: number;
  dm?: number;
  /** Coffre : son contenu. */
  chest?: ItemStack[];
}

export interface PlaceLayout {
  structs: StructSpec[];
  loot: LootSpec[];
}

type Rand = () => number;

const edgeX = (i: number, j: number, k = 0): SlotRef => ({ t: 'e', d: 'x', i, j, k });
const edgeZ = (i: number, j: number, k = 0): SlotRef => ({ t: 'e', d: 'z', i, j, k });

interface RoomOpts {
  i0: number;
  j0: number;
  w: number;
  d: number;
  wall: PlanId;
  mat?: Material;
  /** Porte : côté ('s' −z, 'n' +z, 'o' −x, 'e' +x) et rang le long du côté. */
  door?: [side: 's' | 'n' | 'o' | 'e', at: number];
  lock?: string;
  roof: boolean;
  floor: PlanId | null;
  /** Murs manquants (fraction), toiture effondrée (fraction), usure (fraction des points de vie perdus au plus). */
  broken: number;
  roofLoss: number;
  wear: number;
  /** Côtés à ne pas construire (mur partagé avec une autre pièce). */
  skip?: Array<'s' | 'n' | 'o' | 'e'>;
}

/** Une pièce rectangulaire : sol, murs, porte, toit ; abîmée selon `broken`, `roofLoss`, `wear`. */
function room(r: Rand, o: RoomOpts): PieceSpec[] {
  const out: PieceSpec[] = [];
  const hp = () => 1 - r() * o.wear;
  const mat = o.mat ? { mat: o.mat } : {};
  if (o.floor) for (let i = o.i0; i < o.i0 + o.w; i++) for (let j = o.j0; j < o.j0 + o.d; j++) out.push({ plan: o.floor, slot: { t: 'f', i, j, k: 0 }, hp: hp() });
  const sides: Array<['s' | 'n' | 'o' | 'e', SlotRef[]]> = [
    ['s', Array.from({ length: o.w }, (_, n) => edgeX(o.i0 + n, o.j0))],
    ['n', Array.from({ length: o.w }, (_, n) => edgeX(o.i0 + n, o.j0 + o.d))],
    ['o', Array.from({ length: o.d }, (_, n) => edgeZ(o.i0, o.j0 + n))],
    ['e', Array.from({ length: o.d }, (_, n) => edgeZ(o.i0 + o.w, o.j0 + n))],
  ];
  for (const [side, edges] of sides) {
    if (o.skip?.includes(side)) continue;
    edges.forEach((slot, n) => {
      if (o.door && o.door[0] === side && o.door[1] === n) {
        out.push({ plan: 'porte', slot, hp: hp(), ...(o.lock ? { lock: o.lock } : {}) });
        return;
      }
      // Un mur sur trois au plus manque ; jamais les deux voisins de la porte (elle tient).
      if (r() < o.broken && !(o.door && o.door[0] === side && Math.abs(o.door[1] - n) === 1)) return;
      out.push({ plan: o.wall, slot, hp: hp(), ...mat });
    });
  }
  if (o.roof) for (let i = o.i0; i < o.i0 + o.w; i++) for (let j = o.j0; j < o.j0 + o.d; j++) if (r() >= o.roofLoss) out.push({ plan: 'toit_chaume', slot: { t: 'r', i, j, k: 0 }, hp: hp() });
  return out;
}

/** Centre (repère du lieu) d'une case de la grille de 2 m. */
const cell = (i: number, j: number): [number, number] => [(i + 0.5) * 2, (j + 0.5) * 2];

function stack(item: ItemStack['item'], count = 1, extra: Partial<ItemStack> = {}): ItemStack {
  return { item, count, ...extra };
}

const doc = (tag: string): ItemStack => ({ item: 'document', count: 1, tag });
const key = (tag: string): ItemStack => ({ item: 'cle', count: 1, tag });
const rifle = (): ItemStack => ({ item: 'fusil', count: 1, q: 55, d: 260, dm: 400 });

/** Plan d'un lieu (identique à chaque appel pour un même lieu et une même graine). */
export function placeLayout(site: PlaceSite, seed: number): PlaceLayout {
  const r = mulberry32(hash32(seed, site.x, site.z, 0x9a11));
  switch (site.kind) {
    case 'ferme':
      return farm(r, site.index);
    case 'mission':
      return mission(r);
    case 'gare':
      return halt(r);
    case 'station':
      return station(r);
    case 'mine':
      return mine(r);
    case 'ruines':
      return ruins(r, site.index);
    case 'cercle':
      return circle(r);
  }
}

function farm(r: Rand, index: number): PlaceLayout {
  // Maison de torchis au toit de chaume, enclos à bétail, puits.
  const house = room(r, { i0: -2, j0: -1, w: 3, d: 3, wall: 'mur_clayonnage', mat: 'torchis', door: ['s', 1], roof: true, floor: null, broken: 0.12 + (index % 2) * 0.12, roofLoss: 0.25 + index * 0.1, wear: 0.5 });
  const kraal: PieceSpec[] = [];
  for (let i = 3; i < 7; i++) {
    for (const j of [-2, 2]) if (r() > 0.2) kraal.push({ plan: 'cloture', slot: edgeX(i, j), hp: 1 - r() * 0.6 });
  }
  for (let j = -2; j < 2; j++) {
    // Côté ouest : la barrière est restée ouverte.
    if (j !== -1 && r() > 0.2) kraal.push({ plan: 'cloture', slot: edgeZ(3, j), hp: 1 - r() * 0.6 });
    if (r() > 0.2) kraal.push({ plan: 'cloture', slot: edgeZ(7, j), hp: 1 - r() * 0.6 });
  }
  const [cx, cz] = cell(0, 1);
  const chest: ItemStack[] = [stack('chiffon', 2 + Math.floor(r() * 3)), stack('corde', 1 + Math.floor(r() * 2))];
  const loot: LootSpec[] = [{ kind: 'puits', lx: -6, lz: 5 }];
  switch (index) {
    case 0:
      chest.push(stack('pot'), stack('couteau_fer', 1, { q: 50, d: 90, dm: 160 }));
      loot.push({ kind: 'document', lx: -1.5, lz: 1.2, tag: 'f_lettre_rudo1', rot: r() });
      break;
    case 1:
      // La clé de la sacristie, sous les draps (lettre de Rudo).
      chest.push(key('sacristie'), stack('pansement', 2));
      loot.push({ kind: 'document', lx: -2.6, lz: 0.6, tag: 'f_lettre_rudo2', rot: r() }, { kind: 'document', lx: -0.4, lz: 2.8, tag: 'f_cahier_tatenda', rot: r() });
      break;
    case 2:
      chest.push(stack('barre_fer', 2), stack('lanterne'));
      loot.push({ kind: 'document', lx: -1, lz: 0.4, tag: 'f_journal_sibanda', rot: r() });
      break;
    default:
      chest.push(stack('bidon_essence'), stack('fil_cuivre'), stack('hache_fer', 1, { q: 45, d: 110, dm: 200 }));
      loot.push({ kind: 'document', lx: -1, lz: -3.6, tag: 'f_note_porte', rot: r() });
      break;
  }
  loot.push({ kind: 'coffre', lx: cx, lz: cz, rot: 0.25, chest });
  return {
    structs: [
      { lx: 0, lz: 0, yaw: 0, pieces: house },
      { lx: 0, lz: 0, yaw: 0, pieces: kraal },
    ],
    loot,
  };
}

function mission(r: Rand): PlaceLayout {
  // Chapelle de pierre (4 × 6 cases) ; sacristie fermée à clé contre le mur est.
  const hall = room(r, { i0: -2, j0: -3, w: 4, d: 6, wall: 'mur_pierre', door: ['s', 1], roof: true, floor: 'dallage', broken: 0.08, roofLoss: 0.35, wear: 0.4, skip: [] });
  // Le mur est de la chapelle, entre j = 1 et j = 3, est commun avec la sacristie : sa porte (fermée à clé).
  const hallPieces = hall.filter((p) => !(p.slot.t === 'e' && p.slot.d === 'z' && p.slot.i === 2 && (p.slot.j === 1 || p.slot.j === 2)));
  hallPieces.push({ plan: 'porte', slot: edgeZ(2, 1), lock: 'sacristie' }, { plan: 'mur_pierre', slot: edgeZ(2, 2) });
  const sacristy = room(r, { i0: 2, j0: 1, w: 2, d: 2, wall: 'mur_pierre', roof: true, floor: 'dallage', broken: 0, roofLoss: 0, wear: 0.15, skip: ['o'] });
  const [sx, sz] = cell(3, 2);
  return {
    structs: [{ lx: 0, lz: 0, yaw: 0, pieces: [...hallPieces, ...sacristy] }],
    loot: [
      { kind: 'etabli', lx: 0, lz: 4.6, rot: 0 },
      { kind: 'document', lx: -1.8, lz: 2.2, tag: 'm_registre', rot: r() },
      { kind: 'document', lx: 2.2, lz: -3.4, tag: 'm_conte', rot: r() },
      { kind: 'coffre', lx: sx, lz: sz, rot: 0, chest: [doc('m_journal_pere'), doc('m_lettre_eveque'), rifle(), stack('cartouche', 6), stack('pansement', 2)] },
    ],
  };
}

function halt(r: Rand): PlaceLayout {
  // Bâtiment de pierre, quai, remblai de la voie ; appentis ouvert avec un moteur.
  const office = room(r, { i0: -3, j0: -1, w: 4, d: 2, wall: 'mur_pierre', door: ['n', 2], roof: true, floor: 'dallage', broken: 0.1, roofLoss: 0.15, wear: 0.35 });
  const platform: PieceSpec[] = [];
  for (let i = -6; i < 4; i++) platform.push({ plan: 'dallage', slot: { t: 'f', i, j: 1, k: 0 }, hp: 1 - r() * 0.3 });
  // Remblai de la voie (les rails ont été arrachés).
  for (let i = -8; i < 8; i++) platform.push({ plan: 'dallage', slot: { t: 'f', i, j: 3, k: 0 }, hp: 1 - r() * 0.3 });
  const shed: PieceSpec[] = [];
  for (const [i, j] of [
    [2, -1],
    [4, -1],
    [2, 1],
    [4, 1],
  ] as const)
    shed.push({ plan: 'poteau', slot: { t: 'c', i, j, k: 0 } });
  for (const [i, j] of [
    [2, -1],
    [3, -1],
    [2, 0],
    [3, 0],
  ] as const)
    if (r() > 0.2) shed.push({ plan: 'toit_chaume', slot: { t: 'r', i, j, k: 0 } });
  const [ox, oz] = cell(-2, 0);
  return {
    structs: [
      { lx: 0, lz: 0, yaw: 0, pieces: [...office, ...platform] },
      { lx: 0, lz: 0, yaw: 0, pieces: shed },
    ],
    loot: [
      { kind: 'etabli', lx: -1, lz: -1.2, rot: 0 },
      { kind: 'document', lx: -0.2, lz: 0.6, tag: 'g_registre', rot: r() },
      { kind: 'coffre', lx: ox, lz: oz, rot: 0.25, chest: [doc('g_telegramme'), key('labo'), stack('chiffon', 2)] },
      { kind: 'moteur_essence', lx: 6, lz: 0 },
      { kind: 'bidon_essence', lx: 7, lz: 1 },
    ],
  };
}

function station(r: Rand): PlaceLayout {
  // Maison de torchis sur pilotis, face au lac ; laboratoire fermé à clé au bout est.
  const main = room(r, { i0: -3, j0: -1, w: 5, d: 3, wall: 'mur_clayonnage', mat: 'torchis', door: ['s', 1], roof: true, floor: 'sol_rondins', broken: 0.08, roofLoss: 0.2, wear: 0.35 }).map((p) => (p.plan === 'sol_rondins' ? { ...p, stilts: 4 } : p));
  // Cloison du laboratoire (i = 0), avec sa porte fermée à clé au milieu.
  const wall: PieceSpec[] = [
    { plan: 'mur_clayonnage', slot: edgeZ(0, -1), mat: 'torchis' },
    { plan: 'porte', slot: edgeZ(0, 0), lock: 'labo' },
    { plan: 'mur_clayonnage', slot: edgeZ(0, 1), mat: 'torchis' },
  ];
  // Le laboratoire ne doit pas s'ouvrir sur l'extérieur : ses murs extérieurs sont tous là.
  const pieces = main.filter((p) => !(p.slot.t === 'e' && p.slot.i >= 0 && p.slot.i < 2));
  for (const i of [0, 1]) pieces.push({ plan: 'mur_clayonnage', slot: edgeX(i, -1), mat: 'torchis' }, { plan: 'mur_clayonnage', slot: edgeX(i, 2), mat: 'torchis' });
  for (let j = -1; j < 2; j++) if (!pieces.some((p) => p.slot.t === 'e' && p.slot.d === 'z' && p.slot.i === 2 && p.slot.j === j)) pieces.push({ plan: 'mur_clayonnage', slot: edgeZ(2, j), mat: 'torchis' });
  const [lx, lz] = cell(1, 1);
  return {
    structs: [{ lx: 0, lz: 0, yaw: 0, pieces: [...pieces, ...wall] }],
    loot: [
      { kind: 'etabli', lx: -3.4, lz: 3, rot: 0 },
      { kind: 'document', lx: -2.6, lz: 0.2, tag: 's_lettre_farai', rot: r() },
      { kind: 'lanterne', lx: -4.4, lz: 2.2 },
      { kind: 'coffre', lx, lz, rot: 0, chest: [doc('s_carnet_bord'), doc('s_releve_sonar'), stack('fil_cuivre', 3), stack('ampoule', 4), stack('cartouche', 3)] },
      { kind: 'bidon_essence', lx: 1, lz: -0.8 },
    ],
  };
}

function mine(r: Rand): PlaceLayout {
  // Bureau de torchis, réserve de pierre fermée à clé, chevalement au-dessus du puits.
  const office = room(r, { i0: -4, j0: -1, w: 3, d: 2, wall: 'mur_clayonnage', mat: 'torchis', door: ['s', 1], roof: true, floor: null, broken: 0.15, roofLoss: 0.3, wear: 0.5 });
  const store = room(r, { i0: 2, j0: -1, w: 2, d: 2, wall: 'mur_pierre', door: ['s', 0], lock: 'reserve', roof: true, floor: 'dallage', broken: 0, roofLoss: 0, wear: 0.2 });
  const headframe: PieceSpec[] = [];
  for (const [i, j] of [
    [-1, 3],
    [1, 3],
    [-1, 5],
    [1, 5],
  ] as const)
    headframe.push({ plan: 'poteau', slot: { t: 'c', i, j, k: 0 } });
  for (const [i, j] of [
    [-1, 3],
    [0, 3],
    [-1, 4],
    [0, 4],
  ] as const)
    if (r() > 0.25) headframe.push({ plan: 'toit_chaume', slot: { t: 'r', i, j, k: 0 } });
  // Barrière autour de l'ouverture du puits, avec un passage au sud vers l'échelle.
  headframe.push(
    { plan: 'cloture', slot: edgeX(0, 3) },
    { plan: 'cloture', slot: edgeX(-1, 5) },
    { plan: 'cloture', slot: edgeX(0, 5) },
    { plan: 'cloture', slot: edgeZ(-1, 3) },
    { plan: 'cloture', slot: edgeZ(-1, 4) },
    { plan: 'cloture', slot: edgeZ(1, 3) },
    { plan: 'cloture', slot: edgeZ(1, 4) },
  );
  const [ox, oz] = cell(-3, 0);
  const [sx, sz] = cell(3, 0);
  return {
    structs: [
      { lx: 0, lz: 0, yaw: 0, pieces: [...office, ...store] },
      { lx: 0, lz: 0, yaw: 0, pieces: headframe },
    ],
    loot: [
      { kind: 'etabli', lx: -6.4, lz: 1, rot: 0.25 },
      { kind: 'coffre', lx: ox, lz: oz, rot: 0, chest: [doc('mi_rapport'), key('reserve'), stack('corde', 2)] },
      { kind: 'document', lx: 2.2, lz: 9.6, tag: 'mi_note_mineur', rot: r() },
      { kind: 'coffre', lx: sx, lz: sz, rot: 0.5, chest: [rifle(), stack('cartouche', 6), stack('bidon_essence'), stack('lanterne'), stack('barre_fer', 3)] },
    ],
  };
}

function ruins(r: Rand, index: number): PlaceLayout {
  // Enceinte elliptique de pierre sèche, ouverte au sud ; tour pleine à l'intérieur.
  const inside = (i: number, j: number) => ((i + 0.5) / 5.2) ** 2 + ((j + 0.5) / 4.2) ** 2 < 1;
  const wall: PieceSpec[] = [];
  for (let i = -7; i < 7; i++) {
    for (let j = -6; j < 6; j++) {
      if (!inside(i, j)) continue;
      const add = (slot: SlotRef) => {
        // Entrée au sud, et des pans écroulés.
        if (slot.d === 'x' && slot.j <= -3 && (slot.i === 0 || slot.i === -1)) return;
        if (r() < 0.22) return;
        wall.push({ plan: 'mur_pierre', slot, hp: 1 - r() * 0.5 });
        if (r() < 0.5) wall.push({ plan: 'mur_pierre', slot: { ...slot, k: 1 }, hp: 1 - r() * 0.6 });
      };
      if (!inside(i, j - 1)) add(edgeX(i, j));
      if (!inside(i, j + 1)) add(edgeX(i, j + 1));
      if (!inside(i - 1, j)) add(edgeZ(i, j));
      if (!inside(i + 1, j)) add(edgeZ(i + 1, j));
    }
  }
  // Tour : une case murée sur trois niveaux.
  const tower: PieceSpec[] = [];
  for (let k = 0; k < 3; k++) tower.push({ plan: 'mur_pierre', slot: edgeX(2, 1, k) }, { plan: 'mur_pierre', slot: edgeX(2, 2, k) }, { plan: 'mur_pierre', slot: edgeZ(2, 1, k) }, { plan: 'mur_pierre', slot: edgeZ(3, 1, k) });
  const loot: LootSpec[] = [
    { kind: 'pepite_or', lx: -6.5, lz: 2.4 },
    { kind: 'quartz', lx: 3.4, lz: -4.2 },
  ];
  if (index === 0) loot.push({ kind: 'document', lx: -1, lz: -1.5, tag: 'r_carnet_simba', rot: r() }, { kind: 'pot', lx: -2.2, lz: -1 }, { kind: 'chiffon', lx: -1.8, lz: -2.1 });
  else loot.push({ kind: 'pepite_or', lx: 6, lz: -1.2 });
  return {
    structs: [
      { lx: 0, lz: 0, yaw: 0, pieces: wall },
      { lx: 0, lz: 0, yaw: 0, pieces: tower },
    ],
    loot,
  };
}

function circle(r: Rand): PlaceLayout {
  // Neuf grandes pierres dressées en rond (un pan de mur de pierre chacune), tournées vers le centre.
  const structs: StructSpec[] = [];
  const n = 9;
  for (let k = 0; k < n; k++) {
    if (k === 4 && r() < 0.5) continue; // une pierre tombée
    const a = (k / n) * Math.PI * 2;
    const rad = 9;
    // Le pan (bord x en (0, 0)) est centré en (1, 0) dans son repère : on recentre la pierre sur le cercle.
    const px = Math.sin(a) * rad - Math.cos(a);
    const pz = Math.cos(a) * rad + Math.sin(a);
    structs.push({ lx: px, lz: pz, yaw: a, pieces: [{ plan: 'mur_pierre', slot: edgeX(0, 0), hp: 1 - r() * 0.3 }] });
  }
  return {
    structs,
    loot: [
      { kind: 'document', lx: 0.6, lz: -0.8, tag: 'c_releve_geometre', rot: r() },
      { kind: 'quartz', lx: -1.2, lz: 0.9 },
      { kind: 'quartz', lx: 1.5, lz: 1.6 },
    ],
  };
}
