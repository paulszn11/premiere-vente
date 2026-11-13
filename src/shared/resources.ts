// Ressources du monde (phase 4) : gisements (quartz, herbes sèches, argile, fer, or) et parties
// des arbres (écorce, branches, perches, résine, feuilles d'ilala, abattage). L'emplacement est
// déterministe ; l'état (charges utilisées, arbres abattus, entailles) est mémorisé et
// sauvegardé. Chaque ressource se régénère à son rythme, en temps du monde (secondes).

import { CHUNK_SIZE, WATER_LEVEL } from './constants';
import type { BiomeId } from './geography';
import type { ItemId, Rarity, ToolTag } from './items';
import { hash32 } from './rng';
import type { Terrain } from './terrain';
import { SPECIES, type Species } from './vegetation';

export type NodeKind = 'bloc_quartz' | 'touffe_herbe' | 'gisement_argile' | 'filon_fer' | 'gravier_or';

export interface NodeDef {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Taille (mètres). */
  size: number;
}

export interface NodeSpec {
  label: string;
  /** Récoltes possibles avant épuisement. */
  charges: number;
  /** Secondes pour regagner une charge. */
  regen: number;
  /** Outil nécessaire (null : à la main). */
  tool: ToolTag | null;
  /** Coups nécessaires pour une récolte. */
  strikes: number;
  yields: ItemId;
  /** Nombre d'objets obtenus par récolte (au plus). */
  amount: number;
  /** Probabilité d'obtenir quelque chose à chaque récolte (orpaillage). */
  chance: number;
  rarity: Rarity;
}

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  bloc_quartz: { label: 'bloc de quartz', charges: 6, regen: 7200, tool: 'percuteur', strikes: 3, yields: 'quartz', amount: 2, chance: 1, rarity: 'commun' },
  touffe_herbe: { label: 'touffe d’herbes sèches', charges: 2, regen: 1200, tool: null, strikes: 1, yields: 'herbe', amount: 1, chance: 1, rarity: 'commun' },
  gisement_argile: { label: 'gisement d’argile', charges: 5, regen: 3600, tool: 'fouir', strikes: 4, yields: 'argile', amount: 1, chance: 1, rarity: 'commun' },
  filon_fer: { label: 'affleurement de minerai de fer', charges: 4, regen: 21600, tool: 'percuteur', strikes: 10, yields: 'minerai_fer', amount: 1, chance: 1, rarity: 'rare' },
  gravier_or: { label: 'gravier aurifère', charges: 3, regen: 14400, tool: 'batee', strikes: 5, yields: 'pepite_or', amount: 1, chance: 0.3, rarity: 'tres_rare' },
};

export const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[];

const CELL = 16;
const GRASS_BIOMES = new Set<BiomeId>(['plateau', 'lowveld', 'kalahari', 'vallee', 'vlei', 'miombo']);
const QUARTZ_BIOMES = new Set<BiomeId>(['matobo', 'escarpement']);
const IRON_BIOMES = new Set<BiomeId>(['escarpement', 'hautes_terres', 'frontiere']);

/** Gisements d'un chunk (déterministes). */
export function nodesInChunk(terrain: Terrain, cx: number, cz: number): NodeDef[] {
  const out: NodeDef[] = [];
  if (!terrain.floraEnabled) return out;
  const n = CHUNK_SIZE / CELL;
  const seed = terrain.seed;
  let i = 0;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = cx * n + gx;
      const wz = cz * n + gz;
      const h = hash32(seed, wx, wz, 0x4e0d);
      const x = (wx + 0.15 + (((h >>> 16) & 0xff) / 256) * 0.7) * CELL;
      const z = (wz + 0.15 + (((h >>> 24) & 0xff) / 256) * 0.7) * CELL;
      const s = terrain.sampleInto(x, z);
      const p = (h & 0xffff) / 65536;
      const y = s.height;
      const bankLow = s.bank > 0.5 && y > WATER_LEVEL + 0.3 && y < 3;
      let kind: NodeKind | null = null;
      if (y < WATER_LEVEL + 0.3) continue;
      // Très rare : graviers aurifères sur les berges basses des fleuves.
      if (bankLow && s.biome === 'fleuve' && p < 0.004) kind = 'gravier_or';
      // Rare : affleurements de fer sur les roches de l'escarpement et des hautes terres.
      else if (IRON_BIOMES.has(s.biome) && s.kopje < 0.3 && p < 0.012) kind = 'filon_fer';
      else if ((s.kopje > 0.3 && p < 0.07) || (QUARTZ_BIOMES.has(s.biome) && p < 0.03) || (bankLow && p < 0.02)) kind = 'bloc_quartz';
      else if ((s.biome === 'vlei' && p < 0.08) || (bankLow && p < 0.07)) kind = 'gisement_argile';
      else if (GRASS_BIOMES.has(s.biome) && s.kopje < 0.2 && p < 0.14) kind = 'touffe_herbe';
      if (!kind) continue;
      const u = ((h >>> 8) & 0xff) / 255;
      const size = kind === 'touffe_herbe' ? 0.5 + u * 0.3 : kind === 'gisement_argile' ? 1.2 + u * 0.8 : kind === 'gravier_or' ? 1 + u * 0.5 : 0.5 + u * 0.4;
      out.push({ id: `n:${cx}:${cz}:${i++}`, kind, x, y: terrain.heightAt(x, z), z, rot: u, size });
    }
  }
  return out;
}

// ——— Arbres ———

export type TreePart = 'ecorce' | 'manche' | 'perche' | 'ilala';

export interface TreeSpec {
  /** Récoltes possibles de chaque partie avant qu'elle repousse. */
  parts: Record<TreePart, number>;
  resin: boolean;
  /** Coups de hache pour l'abattre. */
  fellStrikes: number;
  /** Bûches obtenues. */
  logs: number;
}

const BARK: Record<Species, number> = { baobab: 4, miombo: 2, mopane: 2, acacia: 1, teck: 2, montagne: 2, palmier: 0, figuier: 2 };
const RESIN = new Set<Species>(['mopane', 'teck', 'acacia']);
const POLES = new Set<Species>(['miombo', 'teck', 'montagne', 'mopane']);

export function treeSpec(species: Species, scale: number): TreeSpec {
  const sp = SPECIES[species];
  return {
    parts: {
      ecorce: BARK[species],
      manche: species === 'palmier' ? 0 : species === 'baobab' ? 1 : 2,
      perche: POLES.has(species) ? 1 : 0,
      ilala: species === 'palmier' ? 3 : 0,
    },
    resin: RESIN.has(species),
    fellStrikes: Math.round(8 + 30 * sp.trunkRadius * scale),
    logs: Math.max(2, Math.min(6, 2 + Math.round((sp.trunkHeight * scale) / 3))),
  };
}

/** Secondes pour qu'une partie repousse (par récolte). */
export const PART_REGEN: Record<TreePart, number> = { ecorce: 3600, manche: 2400, perche: 7200, ilala: 1800 };
/** La résine coule pendant 10 minutes après l'entaille. */
export const RESIN_DELAY = 600;
/** Un arbre abattu repousse au bout de 12 heures de jeu. */
export const TREE_REGROW = 12 * 3600;

export function treeKey(cx: number, cz: number, index: number): string {
  return `${cx}:${cz}:${index}`;
}

export function parseTreeKey(key: string): { cx: number; cz: number; index: number } | null {
  const m = /^(-?\d+):(-?\d+):(\d+)$/.exec(key);
  return m ? { cx: Number(m[1]), cz: Number(m[2]), index: Number(m[3]) } : null;
}

interface Usage {
  used: number;
  /** Temps du monde de la dernière mise à jour. */
  t: number;
}

interface TreeState {
  felledAt?: number;
  /** Coups d'abattage reçus. */
  fell?: number;
  parts?: Partial<Record<TreePart, Usage>>;
  /** Entaille pour la résine. */
  resinAt?: number;
}

function regenerate(u: Usage, regen: number, now: number): void {
  if (u.used <= 0) {
    u.t = now;
    return;
  }
  const k = Math.floor((now - u.t) / regen);
  if (k <= 0) return;
  u.used = Math.max(0, u.used - k);
  u.t = u.used === 0 ? now : u.t + k * regen;
}

/** État du monde modifié par les joueurs (gisements, arbres). */
export class WorldState {
  private readonly nodes = new Map<string, Usage>();
  private readonly trees = new Map<string, TreeState>();
  /** Augmente quand un arbre tombe ou repousse (affichage et physique à refaire). */
  version = 0;

  nodeLeft(id: string, kind: NodeKind, now: number): number {
    const spec = NODE_SPECS[kind];
    const u = this.nodes.get(id);
    if (!u) return spec.charges;
    regenerate(u, spec.regen, now);
    return spec.charges - u.used;
  }

  /** Consomme une charge ; renvoie faux si le gisement est épuisé. */
  useNode(id: string, kind: NodeKind, now: number): boolean {
    if (this.nodeLeft(id, kind, now) <= 0) return false;
    const u = this.nodes.get(id) ?? { used: 0, t: now };
    u.used++;
    this.nodes.set(id, u);
    return true;
  }

  isFelled(key: string, now: number): boolean {
    const st = this.trees.get(key);
    if (!st?.felledAt) return false;
    return now < st.felledAt + TREE_REGROW;
  }

  felledAt(key: string): number | null {
    return this.trees.get(key)?.felledAt ?? null;
  }

  /** Parties restantes d'un arbre (sur pied). */
  partLeft(key: string, part: TreePart, spec: TreeSpec, now: number): number {
    const max = spec.parts[part];
    if (max <= 0 || this.isFelled(key, now)) return 0;
    const u = this.trees.get(key)?.parts?.[part];
    if (!u) return max;
    regenerate(u, PART_REGEN[part], now);
    return max - u.used;
  }

  usePart(key: string, part: TreePart, spec: TreeSpec, now: number): boolean {
    if (this.partLeft(key, part, spec, now) <= 0) return false;
    const st = this.trees.get(key) ?? {};
    st.parts ??= {};
    const u = st.parts[part] ?? { used: 0, t: now };
    u.used++;
    st.parts[part] = u;
    this.trees.set(key, st);
    return true;
  }

  /** Un coup de hache ; renvoie vrai quand l'arbre tombe. */
  fellStrike(key: string, spec: TreeSpec, power: number, now: number): { felled: boolean; progress: number } {
    const st = this.trees.get(key) ?? {};
    st.fell = (st.fell ?? 0) + power;
    this.trees.set(key, st);
    if (st.fell >= spec.fellStrikes) {
      st.felledAt = now;
      delete st.fell;
      delete st.parts;
      delete st.resinAt;
      this.version++;
      return { felled: true, progress: 1 };
    }
    return { felled: false, progress: st.fell / spec.fellStrikes };
  }

  fellProgress(key: string, spec: TreeSpec): number {
    return Math.min(1, (this.trees.get(key)?.fell ?? 0) / spec.fellStrikes);
  }

  /** Entaille l'écorce : la résine sera prête dans 10 minutes. */
  incise(key: string, now: number): boolean {
    const st = this.trees.get(key) ?? {};
    if (st.resinAt !== undefined) return false;
    st.resinAt = now;
    this.trees.set(key, st);
    return true;
  }

  resinState(key: string, now: number): 'aucune' | 'coule' | 'prete' {
    const at = this.trees.get(key)?.resinAt;
    if (at === undefined) return 'aucune';
    return now >= at + RESIN_DELAY ? 'prete' : 'coule';
  }

  takeResin(key: string, now: number): boolean {
    if (this.resinState(key, now) !== 'prete') return false;
    delete this.trees.get(key)!.resinAt;
    return true;
  }

  /** Arbres abattus d'un chunk (indices), pour l'affichage et la physique. */
  felledIn(cx: number, cz: number, now: number): number[] {
    const out: number[] = [];
    for (const [key, st] of this.trees) {
      if (!st.felledAt || now >= st.felledAt + TREE_REGROW) continue;
      const k = parseTreeKey(key);
      if (k && k.cx === cx && k.cz === cz) out.push(k.index);
    }
    return out;
  }

  /** Fait repousser les arbres dont le temps est venu ; renvoie les chunks touchés. */
  regrow(now: number): Array<{ cx: number; cz: number }> {
    const out: Array<{ cx: number; cz: number }> = [];
    for (const [key, st] of this.trees) {
      if (st.felledAt && now >= st.felledAt + TREE_REGROW) {
        this.trees.delete(key);
        const k = parseTreeKey(key);
        if (k) out.push({ cx: k.cx, cz: k.cz });
      }
    }
    if (out.length) this.version++;
    return out;
  }

  serialize(): { nodes: Array<[string, number, number]>; trees: Array<[string, TreeState]> } {
    return { nodes: [...this.nodes].filter(([, u]) => u.used > 0).map(([id, u]) => [id, u.used, u.t]), trees: [...this.trees] };
  }

  restore(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (Array.isArray(r.nodes)) {
      for (const e of r.nodes.slice(0, 100000)) {
        if (!Array.isArray(e) || typeof e[0] !== 'string' || e[0].length > 40 || !fin(e[1]) || !fin(e[2])) continue;
        this.nodes.set(e[0], { used: Math.max(0, Math.min(100, Math.round(e[1]))), t: e[2] });
      }
    }
    if (Array.isArray(r.trees)) {
      for (const e of r.trees.slice(0, 100000)) {
        if (!Array.isArray(e) || typeof e[0] !== 'string' || !parseTreeKey(e[0]) || typeof e[1] !== 'object' || e[1] === null) continue;
        const o = e[1] as Record<string, unknown>;
        const st: TreeState = {};
        if (fin(o.felledAt)) st.felledAt = o.felledAt;
        if (fin(o.fell)) st.fell = Math.max(0, o.fell);
        if (fin(o.resinAt)) st.resinAt = o.resinAt;
        if (typeof o.parts === 'object' && o.parts !== null) {
          const parts: Partial<Record<TreePart, Usage>> = {};
          for (const part of ['ecorce', 'manche', 'perche', 'ilala'] as const) {
            const u = (o.parts as Record<string, unknown>)[part] as Record<string, unknown> | undefined;
            if (u && fin(u.used) && fin(u.t)) parts[part] = { used: Math.max(0, Math.min(20, Math.round(u.used))), t: u.t };
          }
          st.parts = parts;
        }
        this.trees.set(e[0], st);
      }
    }
    this.version++;
  }
}
