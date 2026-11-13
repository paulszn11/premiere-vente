// Objets déplaçables posés dans la nature : pierres, bûches, troncs, et depuis la phase 3
// bâtons, fruits et aloès, ainsi que les objets créés en jouant (sac posé, chiffons, corps).
// La position d'origine des objets naturels est déterministe ; une fois déplacés ou ramassés,
// leur nouvel état est mémorisé par la simulation (et sauvegardé).

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import type { BiomeId } from './geography';
import { type Container, type ItemMeta, type ItemStack, bagTotalMass } from './inventory';
import { ITEMS, type ItemId } from './items';
import type { NodeKind } from './resources';
import { hash32 } from './rng';
import type { Terrain } from './terrain';
import { floraInChunk } from './vegetation';

/** Objets transportables : leur type est aussi leur identifiant dans le catalogue. */
export type ItemPropKind = Exclude<ItemId, never>;
export type PropKind = ItemPropKind | 'tronc' | 'sac' | 'corps' | NodeKind | 'foyer' | InstallPropKind;

/** Installations construites (phase 5) : objets fixes. */
export type InstallPropKind = 'coffre' | 'etabli' | 'puits' | 'fourneau' | 'forge';
export const INSTALL_PROP_KINDS = new Set<PropKind>(['coffre', 'etabli', 'puits', 'fourneau', 'forge']);

/** État d'un bas fourneau (phase 5). */
export interface FurnaceState {
  /** Minerai de fer chargé (unités). */
  ore: number;
  /** Bois chargé (secondes de combustion). */
  fuel: number;
  lit: boolean;
  /** Chaleur (0 à 100) : monte avec le soufflet, retombe sans lui. */
  heat: number;
  /** Travail de réduction accompli (secondes de soufflet à bonne chaleur). */
  work: number;
  /** Loupes de fer prêtes à retirer. */
  blooms: number;
}

/** État d'un foyer. */
export interface FireState {
  lit: boolean;
  /** Secondes de combustion restantes. */
  fuel: number;
  /** Objet posé sur le feu (pot d'eau, pot cru) et temps de cuisson écoulé. */
  pot: ItemStack | null;
  cook: number;
}
export type Handling = 'une-main' | 'deux-mains' | 'trainer';

export interface PropDef {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** Orientation autour de l'axe vertical, dans [0, 1) tour. */
  rot: number;
  /** Pierre : rayon. Bûche, tronc, bâton : rayon (la longueur est dans `length`). */
  radius: number;
  length: number;
  /** Objet créé pendant la partie (posé, jeté, corps) : pas d'emplacement d'origine. */
  dynamic?: boolean;
  /** Sac posé ou corps : ce qu'il contient. */
  container?: Container;
  /** Corps : temps du monde où il a été vidé (il disparaît ensuite). */
  emptiedAt?: number;
  /** Outil ou objet fabriqué : qualité, durabilité, améliorations ; pot : eau. */
  meta?: ItemMeta;
  /** Gisement ou foyer : immobile. */
  fixed?: boolean;
  /** Taille d'un gisement (mètres). */
  size?: number;
  fire?: FireState;
  /** Bas fourneau. */
  furnace?: FurnaceState;
  /** Installation posée sur un plancher : la pièce qui la porte. */
  on?: { s: string; p: number };
}

const OTHER_LABELS = {
  tronc: 'tronc',
  sac: 'sac à dos',
  corps: 'corps',
  bloc_quartz: 'bloc de quartz',
  touffe_herbe: 'touffe d’herbes sèches',
  gisement_argile: 'gisement d’argile',
  filon_fer: 'affleurement de minerai de fer',
  gravier_or: 'gravier aurifère',
  foyer: 'foyer',
  coffre: 'coffre',
  etabli: 'établi',
  puits: 'puits',
  fourneau: 'bas fourneau',
  forge: 'forge',
} as const;

export const PROP_LABELS: Record<PropKind, string> = {
  ...(Object.fromEntries(Object.values(ITEMS).map((d) => [d.id, d.label])) as Record<ItemId, string>),
  aloes: 'aloès',
  ...OTHER_LABELS,
};

const FEMININE = new Set<string>(['tronc_', 'touffe_herbe', 'forge']);

/** « la pierre », « le bâton », « l'aloès ». */
export function propWithArticle(kind: PropKind): string {
  const label = PROP_LABELS[kind];
  if (/^[aeéèêiïoôuh]/i.test(label) && kind !== 'herbe' && kind !== 'hache') return `l'${label}`;
  const fem = kind in ITEMS ? ITEMS[kind as ItemId].feminine : FEMININE.has(kind);
  return `${fem ? 'la' : 'le'} ${label}`;
}

export const DENSITY: Record<'pierre' | 'buche' | 'tronc' | 'baton' | 'manche' | 'perche' | 'baton_fouir' | 'lance', number> = {
  pierre: 2600,
  buche: 700,
  tronc: 700,
  baton: 600,
  manche: 650,
  perche: 650,
  baton_fouir: 600,
  lance: 650,
};
export const BODY_MASS = 70;

/** Objets que l'on peut ranger (poche ou sac), avec leur identifiant dans le catalogue. */
export const ITEM_OF_PROP: Partial<Record<PropKind, ItemId>> = Object.fromEntries(Object.keys(ITEMS).map((id) => [id, id])) as Partial<Record<PropKind, ItemId>>;

/** Objets rangés directement en les ramassant (pierres et bûches se prennent en main). */
export const QUICK_PICK = new Set<PropKind>((Object.keys(ITEMS) as ItemId[]).filter((id) => id !== 'pierre' && id !== 'buche'));

/** Gisements (immobiles, exploitables). */
export const NODE_PROP_KINDS = new Set<PropKind>(['bloc_quartz', 'touffe_herbe', 'gisement_argile', 'filon_fer', 'gravier_or']);

/** Délai de repousse d'un objet naturel ramassé (secondes ; Infinity : jamais). */
export function regrowDelay(kind: PropKind): number {
  if (kind === 'baton') return 3600;
  if (kind === 'figue' || kind === 'muhacha' || kind === 'fruit_baobab') return 7200;
  if (kind === 'aloes') return 10800;
  return Infinity;
}

/** Au-delà de 8 kg : à deux mains ; au-delà de 60 kg : on ne peut que le traîner. */
export const ONE_HAND_MAX_KG = 8;
export const TWO_HANDS_MAX_KG = 60;

export function propMass(p: Pick<PropDef, 'kind' | 'radius' | 'length' | 'container'>): number {
  switch (p.kind) {
    case 'pierre':
      return (4 / 3) * Math.PI * p.radius * p.radius * p.radius * DENSITY.pierre;
    case 'buche':
    case 'tronc':
    case 'baton':
      return Math.PI * p.radius * p.radius * p.length * DENSITY[p.kind];
    case 'bloc_quartz':
    case 'touffe_herbe':
    case 'gisement_argile':
    case 'filon_fer':
    case 'gravier_or':
    case 'foyer':
    case 'coffre':
    case 'etabli':
    case 'puits':
    case 'fourneau':
    case 'forge':
      return 0;
    case 'sac':
      return bagTotalMass(p.container?.bag ?? []);
    case 'corps':
      return BODY_MASS;
    default:
      return ITEMS[p.kind].mass;
  }
}

export function handlingFor(mass: number): Handling {
  if (mass <= ONE_HAND_MAX_KG) return 'une-main';
  if (mass <= TWO_HANDS_MAX_KG) return 'deux-mains';
  return 'trainer';
}

/** Taille d'affichage et de collision d'un petit objet (rayon, longueur). */
export function itemShape(kind: PropKind): { radius: number; length: number } {
  switch (kind) {
    case 'fruit_baobab':
      return { radius: 0.07, length: 0.2 };
    case 'figue':
      return { radius: 0.022, length: 0 };
    case 'muhacha':
      return { radius: 0.025, length: 0 };
    case 'chiffon':
      return { radius: 0.1, length: 0 };
    case 'aloes':
      return { radius: 0.12, length: 0.3 };
    case 'baton':
      return { radius: 0.022, length: 0.75 };
    case 'sac':
      return { radius: 0.22, length: 0 };
    case 'corps':
      return { radius: 0.28, length: 1.1 };
    case 'quartz':
      return { radius: 0.03, length: 0 };
    case 'ecorce':
      return { radius: 0.05, length: 0.5 };
    case 'fibres':
    case 'pansement':
      return { radius: 0.05, length: 0 };
    case 'corde':
      return { radius: 0.07, length: 0 };
    case 'herbe':
      return { radius: 0.12, length: 0.4 };
    case 'ilala':
      return { radius: 0.15, length: 0.8 };
    case 'argile':
      return { radius: 0.06, length: 0 };
    case 'resine':
      return { radius: 0.02, length: 0 };
    case 'minerai_fer':
      return { radius: 0.07, length: 0 };
    case 'pepite_or':
      return { radius: 0.012, length: 0 };
    case 'manche':
      return { radius: 0.02, length: 0.5 };
    case 'perche':
      return { radius: 0.025, length: 1.8 };
    case 'couteau':
      return { radius: 0.02, length: 0.3 };
    case 'hache':
      return { radius: 0.05, length: 0.6 };
    case 'baton_fouir':
      return { radius: 0.022, length: 0.9 };
    case 'lance':
      return { radius: 0.025, length: 1.9 };
    case 'archet':
      return { radius: 0.05, length: 0.6 };
    case 'pot_cru':
    case 'pot':
      return { radius: 0.13, length: 0.22 };
    case 'batee':
      return { radius: 0.2, length: 0.08 };
    case 'foyer':
      return { radius: 0.45, length: 0 };
    case 'torche':
      return { radius: 0.03, length: 0.6 };
    case 'loupe_fer':
      return { radius: 0.07, length: 0 };
    case 'barre_fer':
      return { radius: 0.02, length: 0.35 };
    case 'clous':
    case 'boulons':
      return { radius: 0.04, length: 0 };
    case 'hache_fer':
      return { radius: 0.05, length: 0.65 };
    case 'couteau_fer':
      return { radius: 0.02, length: 0.3 };
    case 'coffre':
      return { radius: 0.45, length: 0.3 };
    case 'etabli':
      return { radius: 0.8, length: 0.45 };
    case 'puits':
      return { radius: 0.7, length: 0.4 };
    case 'fourneau':
      return { radius: 0.5, length: 0.7 };
    case 'forge':
      return { radius: 0.6, length: 0.4 };
    default:
      return { radius: 0.1, length: 0 };
  }
}

const PROP_CELL = 16;
const FOREST_BIOMES = new Set<BiomeId>(['miombo', 'fleuve', 'hautes_terres', 'kalahari', 'escarpement']);
const ROCKY_BIOMES = new Set<BiomeId>(['matobo', 'escarpement', 'frontiere', 'hautes_terres']);
const ALOE_BIOMES = new Set<BiomeId>(['matobo', 'escarpement', 'lowveld', 'vallee']);

/** `skipTree(i)` : arbre abattu, sans fruits ni bois mort à son pied. */
export function propsInChunk(terrain: Terrain, cx: number, cz: number, skipTree?: (index: number) => boolean): PropDef[] {
  const out: PropDef[] = [];
  if (!terrain.floraEnabled) return out;
  const n = CHUNK_SIZE / PROP_CELL;
  const seed = terrain.seed;
  let i = 0;
  let j = 0;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = cx * n + gx;
      const wz = cz * n + gz;
      const h = hash32(seed, wx, wz, 0x9e09);
      const h2 = hash32(seed, wx, wz, 0x9e0a);
      const x = (wx + 0.1 + (((h >>> 16) & 0xff) / 256) * 0.8) * PROP_CELL;
      const z = (wz + 0.1 + (((h >>> 24) & 0xff) / 256) * 0.8) * PROP_CELL;
      const s = terrain.sampleInto(x, z);
      if (s.height < WATER_LEVEL + 0.4) continue;
      const p = (h & 0xffff) / 65536;
      const rocky = ROCKY_BIOMES.has(s.biome) || s.kopje > 0.2 || s.bank > 0.5;
      const kopje = s.kopje;
      const biome = s.biome;
      const stoneChance = rocky ? 0.4 : 0.14;
      const logChance = FOREST_BIOMES.has(biome) ? 0.2 : biome === 'plateau' || biome === 'vallee' ? 0.04 : 0;
      const trunkChance = FOREST_BIOMES.has(biome) ? 0.03 : 0;
      let def: Omit<PropDef, 'id' | 'y'> | null = null;
      const u = (h2 & 0xffff) / 65536;
      const rot = ((h2 >>> 16) & 0xff) / 256;
      if (p < stoneChance) def = { kind: 'pierre', x, z, rot, radius: 0.06 + u * 0.07, length: 0 };
      else if (p < stoneChance + logChance) def = { kind: 'buche', x, z, rot, radius: 0.07 + u * 0.04, length: 0.6 + (((h2 >>> 24) & 0xff) / 255) * 0.6 };
      else if (p < stoneChance + logChance + trunkChance) def = { kind: 'tronc', x, z, rot, radius: 0.18 + u * 0.06, length: 2.2 + (((h2 >>> 24) & 0xff) / 255) * 1 };
      if (def) out.push({ ...def, id: `${cx}:${cz}:${i++}`, y: terrain.heightAt(x, z) + def.radius + 0.05 });

      // Aloès : sur les sols rocheux et les kopjes de granit.
      const ha = hash32(seed, wx, wz, 0xa10e);
      const aloeChance = kopje > 0.3 ? 0.18 : ALOE_BIOMES.has(biome) && rocky ? 0.08 : 0;
      if ((ha & 0xffff) / 65536 < aloeChance) {
        const ax = (wx + 0.1 + (((ha >>> 16) & 0xff) / 256) * 0.8) * PROP_CELL;
        const az = (wz + 0.1 + (((ha >>> 24) & 0xff) / 256) * 0.8) * PROP_CELL;
        const ah = terrain.heightAt(ax, az);
        if (ah > WATER_LEVEL + 0.4) out.push({ id: `${cx}:${cz}:o${j++}`, kind: 'aloes', x: ax, y: ah + 0.08, z: az, rot: ((ha >>> 8) & 0xff) / 256, ...itemShape('aloes') });
      }
    }
  }

  // Fruits tombés et bois mort au pied des arbres.
  const trees = floraInChunk(terrain, cx, cz).trees;
  for (let ti = 0; ti < trees.length; ti++) {
    const t = trees[ti]!;
    if (skipTree?.(ti)) continue;
    const ht = hash32(seed, Math.round(t.x * 4), Math.round(t.z * 4), 0x51a7);
    const r = (ht & 0xffff) / 65536;
    let fruit: PropKind | null = null;
    let count = 0;
    if (t.species === 'baobab' && r < 0.7) {
      fruit = 'fruit_baobab';
      count = 1 + ((ht >>> 16) & 1);
    } else if (t.species === 'figuier' && r < 0.7) {
      fruit = 'figue';
      count = 2 + ((ht >>> 16) & 3);
    } else if (t.species === 'miombo' && r < 0.12) {
      fruit = 'muhacha';
      count = 1 + ((ht >>> 16) % 3);
    }
    const trunk = t.species === 'baobab' ? 1.3 : t.species === 'figuier' ? 0.6 : 0.4;
    const place = (k: number, kind: PropKind) => {
      const hk = hash32(seed, ht, k, 0x51a8);
      const ang = ((hk & 0xffff) / 65536) * Math.PI * 2;
      const dist = trunk * t.scale + 0.5 + (((hk >>> 16) & 0xff) / 255) * 2.2;
      const px = t.x + Math.cos(ang) * dist;
      const pz = t.z + Math.sin(ang) * dist;
      const py = terrain.heightAt(px, pz);
      if (py < WATER_LEVEL + 0.3) return;
      const shape = itemShape(kind);
      out.push({ id: `${cx}:${cz}:o${j++}`, kind, x: px, y: py + shape.radius + 0.04, z: pz, rot: ((hk >>> 24) & 0xff) / 256, ...shape });
    };
    for (let k = 0; k < count && fruit; k++) place(k, fruit);
    if (((ht >>> 24) & 0xff) / 255 < 0.15) place(9, 'baton');
  }
  return out;
}
