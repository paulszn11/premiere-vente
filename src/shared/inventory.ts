// Inventaire physique : 4 poches pour les petits objets, un sac à dos de 30 litres, les
// vêtements (que l'on peut déchirer en chiffons). Données simples (sérialisables) : elles
// seront sauvegardées par l'hôte et échangées sur le réseau en phase 8.

import { ITEMS, type ItemId, STONE_DENSITY_KG_L, isItemId } from './items';

export interface ItemStack {
  item: ItemId;
  count: number;
  /** Masse d'une unité si elle diffère du catalogue (pierres). */
  mass?: number;
  /** Rayon de la pierre (pour la reposer telle quelle dans le monde). */
  radius?: number;
}

/** Contenu d'un sac et de poches : celui du joueur, d'un corps ou d'un sac posé. */
export interface Container {
  /** Contenu du sac, ou null s'il n'y a pas de sac. */
  bag: ItemStack[] | null;
  pockets: Array<ItemStack | null>;
}

export interface Clothes {
  /** Haut intact (sinon déchiré en chiffons). */
  haut: boolean;
  bas: boolean;
}

export interface Inventory extends Container {
  clothes: Clothes;
}

export type ClothingPart = keyof Clothes;

export const POCKET_COUNT = 4;
export const POCKET_MAX_L = 1;
export const BAG_CAPACITY_L = 30;
export const BAG_EMPTY_MASS = 1.2;
/** Une pierre plus lourde ne rentre pas dans le sac. */
export const BAG_STONE_MAX_KG = 8;
export const RAGS_PER_PART: Record<ClothingPart, number> = { haut: 4, bas: 4 };
export const CLOTHING_LABELS: Record<ClothingPart, string> = { haut: 'votre chemise', bas: 'votre pantalon' };

export function emptyPockets(): Array<ItemStack | null> {
  return Array.from({ length: POCKET_COUNT }, () => null);
}

/** Inventaire de départ : vêtements intacts, sac vide, poches vides. */
export function makeInventory(withBag = true): Inventory {
  return { bag: withBag ? [] : null, pockets: emptyPockets(), clothes: { haut: true, bas: true } };
}

export function unitMass(st: ItemStack): number {
  return st.mass ?? ITEMS[st.item].mass;
}

export function unitVolume(st: ItemStack): number {
  return st.item === 'pierre' ? unitMass(st) / STONE_DENSITY_KG_L : ITEMS[st.item].volume;
}

export function stackMass(st: ItemStack): number {
  return unitMass(st) * st.count;
}

export function stackVolume(st: ItemStack): number {
  return unitVolume(st) * st.count;
}

export function bagVolume(bag: ItemStack[]): number {
  let v = 0;
  for (const st of bag) v += stackVolume(st);
  return v;
}

export function bagContentMass(bag: ItemStack[]): number {
  let m = 0;
  for (const st of bag) m += stackMass(st);
  return m;
}

/** Masse d'un sac posé (sac + contenu). */
export function bagTotalMass(bag: ItemStack[]): number {
  return BAG_EMPTY_MASS + bagContentMass(bag);
}

/** Masse portée sur soi (poches, sac et son contenu ; l'objet tenu en main est compté à part). */
export function carriedMass(c: Container): number {
  let m = c.bag ? bagTotalMass(c.bag) : 0;
  for (const p of c.pockets) if (p) m += stackMass(p);
  return m;
}

/** Deux piles peuvent-elles se regrouper ? (les pierres, toutes différentes, jamais) */
function sameKind(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.item !== 'pierre' && a.mass === undefined && b.mass === undefined;
}

export function fitsBag(st: ItemStack): boolean {
  return st.item !== 'pierre' || unitMass(st) <= BAG_STONE_MAX_KG;
}

/** Range dans les poches autant d'unités que possible ; renvoie le nombre restant. */
export function addToPockets(c: Container, st: ItemStack): number {
  const def = ITEMS[st.item];
  if (!def.pocket) return st.count;
  let left = st.count;
  const unitV = unitVolume(st);
  const fitIn = (slot: ItemStack | null): number => {
    const already = slot ? slot.count : 0;
    const byStack = def.stack - already;
    const byVolume = Math.floor((POCKET_MAX_L - (slot ? stackVolume(slot) : 0)) / unitV + 1e-9);
    return Math.max(0, Math.min(left, byStack, byVolume));
  };
  for (const slot of c.pockets) {
    if (!slot || !sameKind(slot, st) || left === 0) continue;
    const n = fitIn(slot);
    slot.count += n;
    left -= n;
  }
  for (let i = 0; i < c.pockets.length && left > 0; i++) {
    if (c.pockets[i]) continue;
    const n = fitIn(null);
    if (n <= 0) break;
    c.pockets[i] = { ...st, count: n };
    left -= n;
  }
  return left;
}

/** Range dans le sac autant d'unités que possible ; renvoie le nombre restant. */
export function addToBag(c: Container, st: ItemStack): number {
  const bag = c.bag;
  if (!bag || !fitsBag(st)) return st.count;
  const def = ITEMS[st.item];
  const unitV = unitVolume(st);
  let left = st.count;
  let free = BAG_CAPACITY_L - bagVolume(bag);
  for (const slot of bag) {
    if (!sameKind(slot, st) || left === 0) continue;
    const n = Math.max(0, Math.min(left, def.stack - slot.count, Math.floor(free / unitV + 1e-9)));
    slot.count += n;
    left -= n;
    free -= n * unitV;
  }
  while (left > 0) {
    const n = Math.min(left, def.stack, Math.floor(free / unitV + 1e-9));
    if (n <= 0) break;
    bag.push({ ...st, count: n });
    left -= n;
    free -= n * unitV;
  }
  return left;
}

/** Range un objet : poches d'abord pour les petits objets, puis le sac. Renvoie le nombre restant. */
export function store(c: Container, st: ItemStack, prefer: 'auto' | 'poche' | 'sac' = 'auto'): number {
  let left = st.count;
  if (prefer !== 'sac') left = addToPockets(c, { ...st, count: left });
  if (left > 0 && prefer !== 'poche') left = addToBag(c, { ...st, count: left });
  return left;
}

export function countOf(c: Container, item: ItemId): number {
  let n = 0;
  for (const p of c.pockets) if (p?.item === item) n += p.count;
  if (c.bag) for (const st of c.bag) if (st.item === item) n += st.count;
  return n;
}

/** Retire `n` unités (poches d'abord, puis sac). Renvoie le nombre réellement retiré. */
export function consume(c: Container, item: ItemId, n: number): number {
  let need = n;
  for (let i = 0; i < c.pockets.length && need > 0; i++) {
    const p = c.pockets[i];
    if (!p || p.item !== item) continue;
    const k = Math.min(need, p.count);
    p.count -= k;
    need -= k;
    if (p.count <= 0) c.pockets[i] = null;
  }
  if (c.bag) {
    for (let i = c.bag.length - 1; i >= 0 && need > 0; i--) {
      const st = c.bag[i]!;
      if (st.item !== item) continue;
      const k = Math.min(need, st.count);
      st.count -= k;
      need -= k;
      if (st.count <= 0) c.bag.splice(i, 1);
    }
  }
  return n - need;
}

export type Slot = { zone: 'poche'; index: number } | { zone: 'sac'; index: number };

export function stackAt(c: Container, slot: Slot): ItemStack | null {
  if (slot.zone === 'poche') return c.pockets[slot.index] ?? null;
  return c.bag?.[slot.index] ?? null;
}

/** Retire `n` unités d'un emplacement précis. Renvoie la pile retirée. */
export function takeAt(c: Container, slot: Slot, n = 1): ItemStack | null {
  const st = stackAt(c, slot);
  if (!st) return null;
  const k = Math.min(n, st.count);
  const out: ItemStack = { ...st, count: k };
  st.count -= k;
  if (st.count <= 0) {
    if (slot.zone === 'poche') c.pockets[slot.index] = null;
    else c.bag!.splice(slot.index, 1);
  }
  return out;
}

export function isEmpty(c: Container): boolean {
  return c.pockets.every((p) => !p) && (!c.bag || c.bag.length === 0);
}

/**
 * Déchire un vêtement en chiffons, rangés si possible. Renvoie le nombre de chiffons qui
 * n'ont pas trouvé de place (à poser au sol), ou -1 si le vêtement est déjà déchiré.
 */
export function tearClothing(inv: Inventory, part: ClothingPart): number {
  if (!inv.clothes[part]) return -1;
  inv.clothes[part] = false;
  return store(inv, { item: 'chiffon', count: RAGS_PER_PART[part] });
}

// ——— Lecture sûre (sauvegardes, réseau) ———

function readStack(raw: unknown): ItemStack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isItemId(r.item)) return null;
  const count = typeof r.count === 'number' && Number.isInteger(r.count) ? r.count : 0;
  if (count < 1 || count > ITEMS[r.item].stack) return null;
  const st: ItemStack = { item: r.item, count };
  if (typeof r.mass === 'number' && Number.isFinite(r.mass) && r.mass > 0 && r.mass < 1000) st.mass = r.mass;
  if (typeof r.radius === 'number' && Number.isFinite(r.radius) && r.radius > 0 && r.radius < 2) st.radius = r.radius;
  return st;
}

export function readContainer(raw: unknown): Container {
  const out: Container = { bag: null, pockets: emptyPockets() };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.pockets)) r.pockets.slice(0, POCKET_COUNT).forEach((p, i) => (out.pockets[i] = readStack(p)));
  if (Array.isArray(r.bag)) {
    out.bag = [];
    for (const s of r.bag.slice(0, 200)) {
      const st = readStack(s);
      if (st && addToBag(out, st) > 0) break;
    }
  }
  return out;
}

export function readInventory(raw: unknown): Inventory {
  const c = readContainer(raw);
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const cl = (typeof r.clothes === 'object' && r.clothes !== null ? r.clothes : {}) as Record<string, unknown>;
  return { ...c, clothes: { haut: cl.haut !== false, bas: cl.bas !== false } };
}
