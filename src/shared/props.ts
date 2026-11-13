// Objets déplaçables posés dans la nature : pierres, bûches, troncs, et depuis la phase 3
// bâtons, fruits et aloès, ainsi que les objets créés en jouant (sac posé, chiffons, corps).
// La position d'origine des objets naturels est déterministe ; une fois déplacés ou ramassés,
// leur nouvel état est mémorisé par la simulation (et sauvegardé).

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import type { BiomeId } from './geography';
import { type Container, bagTotalMass } from './inventory';
import { ITEMS, type ItemId } from './items';
import { hash32 } from './rng';
import type { Terrain } from './terrain';
import { floraInChunk } from './vegetation';

export type PropKind = 'pierre' | 'buche' | 'tronc' | 'baton' | 'chiffon' | 'aloes' | 'fruit_baobab' | 'figue' | 'muhacha' | 'sac' | 'corps';
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
  /** Corps : pas de simulation où il a été vidé (il disparaît ensuite). */
  emptiedAt?: number;
}

export const PROP_LABELS: Record<PropKind, string> = {
  pierre: 'pierre',
  buche: 'bûche',
  tronc: 'tronc',
  baton: 'bâton',
  chiffon: 'chiffon',
  aloes: 'aloès',
  fruit_baobab: 'fruit du baobab',
  figue: 'figue sauvage',
  muhacha: 'muhacha',
  sac: 'sac à dos',
  corps: 'corps',
};

/** « la pierre », « le bâton », « l'aloès ». */
export function propWithArticle(kind: PropKind): string {
  if (kind === 'aloes') return "l'aloès";
  const fem = kind === 'pierre' || kind === 'buche' || kind === 'figue';
  return `${fem ? 'la' : 'le'} ${PROP_LABELS[kind]}`;
}

export const DENSITY: Record<'pierre' | 'buche' | 'tronc' | 'baton', number> = { pierre: 2600, buche: 700, tronc: 700, baton: 600 };
export const BODY_MASS = 70;

/** Objets que l'on peut ranger (poche ou sac), avec leur identifiant dans le catalogue. */
export const ITEM_OF_PROP: Partial<Record<PropKind, ItemId>> = {
  pierre: 'pierre',
  baton: 'baton',
  chiffon: 'chiffon',
  aloes: 'aloes',
  fruit_baobab: 'fruit_baobab',
  figue: 'figue',
  muhacha: 'muhacha',
};

/** Petits objets rangés directement en les ramassant (les pierres se prennent en main). */
export const QUICK_PICK = new Set<PropKind>(['baton', 'chiffon', 'aloes', 'fruit_baobab', 'figue', 'muhacha']);

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
    default:
      return { radius: 0.1, length: 0 };
  }
}

const PROP_CELL = 16;
const FOREST_BIOMES = new Set<BiomeId>(['miombo', 'fleuve', 'hautes_terres', 'kalahari', 'escarpement']);
const ROCKY_BIOMES = new Set<BiomeId>(['matobo', 'escarpement', 'frontiere', 'hautes_terres']);
const ALOE_BIOMES = new Set<BiomeId>(['matobo', 'escarpement', 'lowveld', 'vallee']);

export function propsInChunk(terrain: Terrain, cx: number, cz: number): PropDef[] {
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
  for (const t of trees) {
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
