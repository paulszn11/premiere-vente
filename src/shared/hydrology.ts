// Eau courante et plans d'eau locaux (phase 9) : ruisseaux, chutes d'eau, bassins, et plans d'eau
// ajoutés par d'autres modules (lacs souterrains). Le niveau de l'eau devient propre à chaque lieu.
//
// Un ruisseau naît sur les hauteurs et descend la pente pas à pas (8 m) jusqu'au fleuve, au lac, ou
// jusqu'à une cuvette où il forme un bassin. Là où il tombe d'une falaise, c'est une chute d'eau, avec un
// bassin de réception quand le relief le permet.
//
// Le tracé suit le relief d'origine (Geography). Le lit et les bassins sont ensuite creusés dans le sol
// (Terrain.heightAt) : un chenal peu profond aux rives en pente douce, dont la surface ne dépasse jamais la
// rive la plus basse (l'eau ne flotte pas en l'air) ni l'eau en amont (elle ne remonte pas).
//
// Chaque ruisseau ne dépend que de sa source (pas de fusion) : on peut les calculer dans n'importe quel
// ordre, à la demande, autour des joueurs ; l'hôte, les joueurs et le fil de calcul du terrain obtiennent
// exactement les mêmes. Calculs déterministes : uniquement + − × ÷, racine carrée et constantes en clair.

import { CHUNK_SIZE, WATER_LEVEL, WORLD_HALF } from './constants';
import type { Geography } from './geography';
import { hash32 } from './rng';

/** Un point du tracé d'un ruisseau. */
export interface StreamPoint {
  x: number;
  z: number;
  /** Altitude du relief d'origine. */
  bed: number;
  /** Surface de l'eau. */
  surface: number;
  /** Profondeur du chenal sous la surface, au milieu. */
  depth: number;
  /** Largeur de l'eau (m). */
  width: number;
  /** Ce point est le haut d'une chute d'eau (le suivant est en bas). */
  fall: boolean;
  /** Le tronçon vers le point suivant passe sous terre (ni eau visible, ni lit creusé). */
  seep: boolean;
}

export interface Stream {
  id: string;
  points: StreamPoint[];
}

/** Plan d'eau rond (bassin, cuvette, lac souterrain). */
export interface Pool {
  id: string;
  x: number;
  y?: number;
  z: number;
  r: number;
  surface: number;
  /** Profondeur creusée sous la surface, au centre (bassins des ruisseaux ; sans elle, rien n'est creusé). */
  depth?: number;
  /** Plan d'eau souterrain : ne compte qu'entre ce fond et la surface (sinon tout le volume vertical). */
  floor?: number;
  /** Bassin au pied d'une chute (pour l'écume et le son). */
  fall?: boolean;
}

/** Chute d'eau (affichage, son, cachettes). */
export interface Waterfall {
  id: string;
  /** Haut de la chute. */
  x: number;
  z: number;
  /** Bas de la chute. */
  x2: number;
  z2: number;
  top: number;
  bottom: number;
  /** Direction de l'écoulement (unitaire). */
  dx: number;
  dz: number;
  width: number;
}

/** Un tronçon de ruisseau, avec ce qu'il faut pour les requêtes rapides. */
export interface Segment {
  a: StreamPoint;
  b: StreamPoint;
  stream: string;
  /** Direction de l'écoulement (unitaire), pour le courant. */
  dx: number;
  dz: number;
  /** Tronçon avec de l'eau qui coule (ni chute, ni passage sous terre). */
  water: boolean;
}

const STEP = 8;
const MAX_STEPS = 520;
const SOURCE_CELL = 1400;
/** Les sources de l'escarpement sont cherchées à partir de cette latitude (bord nord du plateau). */
const ESCARP_SOURCE_Z = 3500;
/** Rayon (m) autour d'un point dans lequel toutes les sources sont calculées (longueur maximale d'un ruisseau). */
const REACH = MAX_STEPS * STEP + SOURCE_CELL;
/** Pente des rives creusées (m de hauteur par m). */
const BANK_SLOPE = 0.55;
/** Petit replat (m) au ras de l'eau, avant que la rive remonte (berge humide). */
const SHELF = 0.6;
/** Marge (m) autour de l'eau dans laquelle le relief peut être creusé (rives comprises). */
const STREAM_PAD = 6;
const POOL_PAD = 8;
/** Seize directions (cosinus, sinus), écrites en clair pour un calcul identique partout. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.9238795325112867, 0.3826834323650898],
  [0.7071067811865476, 0.7071067811865476],
  [0.3826834323650898, 0.9238795325112867],
  [0, 1],
  [-0.3826834323650898, 0.9238795325112867],
  [-0.7071067811865476, 0.7071067811865476],
  [-0.9238795325112867, 0.3826834323650898],
  [-1, 0],
  [-0.9238795325112867, -0.3826834323650898],
  [-0.7071067811865476, -0.7071067811865476],
  [-0.3826834323650898, -0.9238795325112867],
  [0, -1],
  [0.3826834323650898, -0.9238795325112867],
  [0.7071067811865476, -0.7071067811865476],
  [0.9238795325112867, -0.3826834323650898],
];

function widthAt(dist: number): number {
  return Math.min(7, 1.4 + dist / 900);
}

function depthAt(dist: number): number {
  return Math.min(0.9, 0.4 + dist / 6000);
}

/** Clé numérique d'un chunk (coordonnées bien plus petites que 32 768 dans un monde de 16 km). */
function ckey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export class Hydrology {
  private readonly traced = new Set<string>();
  readonly streams = new Map<string, Stream>();
  readonly pools = new Map<string, Pool>();
  readonly falls = new Map<string, Waterfall>();
  /** Segments et bassins rangés par chunk (requêtes rapides). */
  private readonly segByChunk = new Map<number, Segment[]>();
  private readonly poolByChunk = new Map<number, Pool[]>();
  /** Zones déjà préparées (cellules de sources), pour ne pas tout recalculer. */
  private readonly readyCells = new Set<string>();
  private lastCellX = NaN;
  private lastCellZ = NaN;
  /** Change quand de nouveaux ruisseaux ou bassins apparaissent (l'affichage se met à jour). */
  version = 0;

  constructor(private readonly geo: Geography) {}

  /** Calcule les ruisseaux dont la source peut atteindre ce point (à appeler avant les requêtes). */
  ensure(x: number, z: number): void {
    const cx = Math.floor(x / SOURCE_CELL);
    const cz = Math.floor(z / SOURCE_CELL);
    if (cx === this.lastCellX && cz === this.lastCellZ) return;
    const key = `${cx},${cz}`;
    if (!this.readyCells.has(key)) {
      this.readyCells.add(key);
      const r = Math.ceil(REACH / SOURCE_CELL);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) this.traceSource(cx + dx, cz + dz);
    }
    this.lastCellX = cx;
    this.lastCellZ = cz;
  }

  /**
   * Prépare à l'avance, par petits morceaux, les sources d'une zone un peu plus large que celle qu'il faut :
   * quand le joueur avance, ses ruisseaux sont déjà calculés (pas d'à-coup). Sans effet sur le résultat,
   * puisque chaque ruisseau ne dépend que de sa source. Renvoie vrai s'il reste du travail.
   */
  warm(x: number, z: number, budgetMs: number): boolean {
    const t0 = performance.now();
    const cx = Math.floor(x / SOURCE_CELL);
    const cz = Math.floor(z / SOURCE_CELL);
    const r = Math.ceil(REACH / SOURCE_CELL) + 1;
    for (let ring = 0; ring <= r; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring || this.traced.has(`${cx + dx},${cz + dz}`)) continue;
          this.traceSource(cx + dx, cz + dz);
          if (performance.now() - t0 > budgetMs) return true;
        }
      }
    }
    return false;
  }

  /** Probabilité qu'une cellule ait une source, selon la région. */
  private sourceChance(x: number, z: number): number {
    if (Math.abs(x) > WORLD_HALF - 1200 || Math.abs(z) > WORLD_HALF - 1200) return 0;
    const s = this.geo.sampleInto(x, z);
    if (s.river > 0.05 || s.bank > 0.5 || s.border > 0.2 || s.kopje > 0.05) return 0;
    let p = 0.45;
    p += 0.45 * s.east;
    p -= 0.5 * s.west;
    p -= 0.3 * s.south;
    p -= 0.4 * s.valley;
    p += 0.15 * s.matobo;
    return Math.max(0, Math.min(0.95, p));
  }

  private traceSource(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.traced.has(key)) return;
    this.traced.add(key);
    const g = this.geo;
    const seed = g.seed;
    const h = hash32(seed, cx, cz, 0x5ce0);
    const centerX = (cx + 0.5) * SOURCE_CELL;
    const centerZ = (cz + 0.5) * SOURCE_CELL;
    if ((h & 0xffff) / 65536 < this.sourceChance(centerX, centerZ)) {
      // Source : le point le plus haut parmi quelques candidats de la cellule.
      let sx = 0;
      let sz = 0;
      let sh = -1e9;
      for (let k = 0; k < 6; k++) {
        const hk = hash32(seed, cx * 7 + k, cz * 13 - k, 0x5ce1);
        const x = (cx + 0.15 + ((hk & 0xffff) / 65536) * 0.7) * SOURCE_CELL;
        const z = (cz + 0.15 + (((hk >>> 16) & 0xffff) / 65536) * 0.7) * SOURCE_CELL;
        const y = g.heightAt(x, z);
        // Pas de source au sommet d'un kopje (granite nu).
        if (g.sampleInto(x, z).kopje > 0.05) continue;
        if (y > sh) {
          sh = y;
          sx = x;
          sz = z;
        }
      }
      if (sh >= 40) this.trace(`r${cx}_${cz}`, sx, sz);
    }
    // Sources au bord du haut plateau, juste au-dessus de l'escarpement : ces ruisseaux plongent dans la
    // vallée du Zambèze par des chutes. Deux par bande de 1,4 km, là où le rebord est le plus abrupt.
    const z0 = cz * SOURCE_CELL;
    if (z0 <= ESCARP_SOURCE_Z && z0 + SOURCE_CELL > ESCARP_SOURCE_Z && Math.abs(centerX) < WORLD_HALF - 2000) {
      for (let k = 0; k < 2; k++) {
        const he = hash32(seed, cx * 2 + k, 77, 0x5ce2);
        if ((he & 0xff) >= 200) continue;
        let bestX = 0;
        let bestZ = 0;
        let bestDrop = 0;
        for (let j = 0; j < 4; j++) {
          const ex = (cx + k * 0.5 + 0.08 + j * 0.1 + (((he >>> 8) & 0xff) / 256) * 0.05) * SOURCE_CELL;
          // On remonte jusqu'au rebord du plateau, puis on mesure la descente sur 80 m.
          let ez = ESCARP_SOURCE_Z;
          let drop = 0;
          for (let step = 0; step < 45; step++) {
            const a = g.heightAt(ex, ez);
            const b = g.heightAt(ex, ez + 80);
            if (a - b > 10) {
              drop = a - b;
              break;
            }
            ez += 40;
          }
          if (drop > bestDrop && g.heightAt(ex, ez) > 60 && g.sampleInto(ex, ez).kopje < 0.05) {
            bestDrop = drop;
            bestX = ex;
            bestZ = ez;
          }
        }
        if (bestDrop > 0) this.trace(`e${cx}_${k}`, bestX, bestZ - 160);
      }
    }
  }

  private trace(id: string, x0: number, z0: number): void {
    const g = this.geo;
    let x = x0;
    let z = z0;
    let h = g.heightAt(x, z);
    // Direction de départ : la plus forte pente.
    let heading = 0;
    let best = Infinity;
    for (let k = 0; k < 16; k++) {
      const d = DIRS[k]!;
      const hh = g.heightAt(x + d[0] * STEP, z + d[1] * STEP);
      if (hh < best) {
        best = hh;
        heading = k;
      }
    }
    const pts: StreamPoint[] = [];
    const pools: Pool[] = [];
    const fallTops: number[] = [];
    let dist = 0;
    const push = () => pts.push({ x, z, bed: h, surface: h, depth: depthAt(dist), width: widthAt(dist), fall: false, seep: false });
    push();
    let endPool: Pool | null = null;
    let spills = 0;
    let cascade = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      let nx = 0;
      let nz = 0;
      let nh = Infinity;
      let nk = heading;
      for (let o = -3; o <= 3; o++) {
        const k = (heading + o + 16) % 16;
        const d = DIRS[k]!;
        const cx = x + d[0] * STEP;
        const cz = z + d[1] * STEP;
        const ch = g.heightAt(cx, cz) + (o < 0 ? -o : o) * 0.02;
        if (ch < nh) {
          nh = ch;
          nx = cx;
          nz = cz;
          nk = k;
        }
      }
      nh = g.heightAt(nx, nz);
      if (nh >= h - 0.02) {
        // Pas de pente devant : l'eau remplit le creux et déborde plus loin, par le point le plus bas trouvé.
        let found = false;
        for (const ring of [2.5, 5, 8]) {
          let bh = h - 0.3;
          for (let k = 0; k < 16; k++) {
            const d = DIRS[k]!;
            const cx = x + d[0] * STEP * ring;
            const cz = z + d[1] * STEP * ring;
            const ch = g.heightAt(cx, cz);
            if (ch < bh) {
              bh = ch;
              nx = cx;
              nz = cz;
              nh = ch;
              nk = k;
              found = true;
            }
          }
          if (found) break;
        }
        if (!found && spills < 6) {
          // Cuvette : l'eau la remplit et déborde par le point le plus bas du pourtour.
          let bh = h + 1.5;
          for (const ring of [11, 15]) {
            for (let k = 0; k < 16; k++) {
              const d = DIRS[k]!;
              const cx = x + d[0] * STEP * ring;
              const cz = z + d[1] * STEP * ring;
              const ch = g.heightAt(cx, cz);
              if (ch < bh) {
                bh = ch;
                nx = cx;
                nz = cz;
                nh = ch;
                nk = k;
                found = true;
              }
            }
            if (found) break;
          }
          if (found) {
            spills++;
            pools.push({ id: `${id}_mare${step}`, x, z, r: Math.min(12, 6 + dist / 400), surface: h + 1, depth: 1.4 });
          }
        }
        if (!found) {
          // Cuvette fermée : le ruisseau finit dans un bassin.
          endPool = { id: `${id}_bassin`, x, z, r: Math.min(12, 5 + dist / 300), surface: h + 1.3, depth: 1.8 };
          break;
        }
      }
      const drop = h - nh;
      const fall = drop > 3 && drop / (STEP * (nk === heading ? 1 : 1.2)) > 0.5;
      if (fall) {
        pts[pts.length - 1]!.fall = true;
        fallTops.push(pts.length - 1);
      }
      dist += Math.sqrt((nx - x) * (nx - x) + (nz - z) * (nz - z));
      x = nx;
      z = nz;
      h = nh;
      heading = nk;
      push();
      if (fall) cascade = true;
      else if (cascade) {
        // Bas d'une cascade (la pente s'adoucit) : bassin de réception, plus profond que le ruisseau.
        cascade = false;
        const prev = pts[pts.length - 2]!;
        const len = Math.sqrt((x - prev.x) * (x - prev.x) + (z - prev.z) * (z - prev.z)) || 1;
        pools.push({ id: `${id}_chute${step}`, x: prev.x + ((x - prev.x) / len) * 3, z: prev.z + ((z - prev.z) / len) * 3, r: 4 + Math.min(4, dist / 800), surface: prev.bed + 1, depth: 2.6, fall: true });
      }
      if (h <= WATER_LEVEL + 0.15) break;
      if (Math.abs(x) > WORLD_HALF - 700 || Math.abs(z) > WORLD_HALF - 700) break;
      // Boucle : on revient près d'un point déjà parcouru.
      let loop = false;
      for (let i = 0; i < pts.length - 4; i++) {
        const p = pts[i]!;
        if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < 36) {
          loop = true;
          break;
        }
      }
      if (loop) {
        endPool = { id: `${id}_bassin`, x, z, r: Math.min(10, 5 + dist / 300), surface: h + 1.2, depth: 1.6 };
        break;
      }
    }
    if (pts.length < 6) return;
    if (endPool) pools.push(endPool);
    this.finish(id, pts, pools, fallTops);
  }

  /** Bassin ajusté au relief : l'eau ne monte pas plus haut que le point le plus bas de son pourtour. */
  private fit(p: Pool): Pool | null {
    const g = this.geo;
    const center = g.heightAt(p.x, p.z);
    for (const f of [1, 0.7, 0.5]) {
      const r = Math.max(3, p.r * f);
      let rim = Infinity;
      for (let k = 0; k < 16; k++) {
        const d = DIRS[k]!;
        const hh = g.heightAt(p.x + d[0] * r, p.z + d[1] * r);
        if (hh < rim) rim = hh;
      }
      const surface = Math.min(rim - 0.15, center + 1.5);
      // Sur une pente, le pourtour aval est trop bas : un plus petit bassin, ou aucun.
      if (surface >= center - 1.6) return { ...p, r, surface };
    }
    return null;
  }

  /** Surface de l'eau point par point, bassins, chutes ; puis rangement pour les requêtes. */
  private finish(id: string, pts: StreamPoint[], rawPools: Pool[], fallTops: number[]): void {
    const g = this.geo;
    const n = pts.length;
    // Longs sauts (débordement d'une cuvette) : l'eau passe sous terre jusqu'au point suivant.
    for (let i = 0; i + 1 < n; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if ((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z) > 144) a.seep = true;
    }
    const pools: Pool[] = [];
    for (const p of rawPools) {
      const f = this.fit(p);
      if (f) pools.push(f);
    }
    /** Rive la plus basse des deux côtés, à `hw` du point (x, z), pour un écoulement (dx, dz) d'une longueur l. */
    const bankAt = (x: number, z: number, dx: number, dz: number, l: number, hw: number) => {
      const ux = dx / (l || 1);
      const uz = dz / (l || 1);
      return Math.min(g.heightAt(x - uz * hw, z + ux * hw), g.heightAt(x + uz * hw, z - ux * hw));
    };
    const entered = new Set<Pool>();
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const prev = i > 0 ? pts[i - 1]! : null;
      const next = i + 1 < n ? pts[i + 1]! : null;
      const from = prev ?? p;
      const to = next ?? p;
      // Jamais plus haut que la rive la plus basse (au point, et au milieu des tronçons voisins, puisque la
      // surface varie en ligne droite entre deux points), ni que l'eau en amont.
      const hw = p.width * 0.5 + 0.4;
      let bank = Math.min(p.bed, bankAt(p.x, p.z, to.x - from.x, to.z - from.z, Math.sqrt((to.x - from.x) * (to.x - from.x) + (to.z - from.z) * (to.z - from.z)), hw));
      for (const [a, b] of [
        [prev, p],
        [p, next],
      ] as const) {
        if (!a || !b || a.seep) continue;
        const sx = b.x - a.x;
        const sz = b.z - a.z;
        const mhw = (a.width + b.width) * 0.25 + 0.4;
        bank = Math.min(bank, bankAt((a.x + b.x) / 2, (a.z + b.z) / 2, sx, sz, Math.sqrt(sx * sx + sz * sz), mhw));
      }
      let s = bank - 0.15;
      const linked = prev !== null && !prev.seep;
      if (linked) s = Math.min(s, prev.surface);
      let pool: Pool | null = null;
      for (const q of pools) {
        if ((q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z) < q.r * q.r) {
          pool = q;
          break;
        }
      }
      if (pool) {
        if (!entered.has(pool)) {
          entered.add(pool);
          if (linked) pool.surface = Math.min(pool.surface, prev.surface);
        }
        s = pool.surface;
      }
      // Le tracé coupe une butte (trop profond sous le relief) : l'eau y passe sous terre.
      if (p.bed - s > 2.2) {
        s = bank - 0.15;
        if (prev) prev.seep = true;
      }
      p.surface = s;
    }
    const stream: Stream = { id, points: pts };
    this.streams.set(id, stream);
    for (const i of fallTops) {
      const a = pts[i]!;
      const b = pts[i + 1];
      if (!b || a.seep || a.surface - b.surface < 1.5) {
        a.fall = false;
        continue;
      }
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z)) || 1;
      const fid = `${id}_${i}`;
      this.falls.set(fid, { id: fid, x: a.x, z: a.z, x2: b.x, z2: b.z, top: a.surface, bottom: b.surface, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, width: a.width });
    }
    for (const q of pools) if (entered.has(q)) this.addPool(q);
    for (let i = 0; i + 1 < n; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z)) || 1;
      const seg: Segment = { a, b, stream: id, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, water: !a.fall && !a.seep };
      // Rangé dans chaque chunk touché par le segment (et ses rives).
      const pad = Math.max(a.width, b.width) * 0.5 + STREAM_PAD;
      const x0c = Math.floor((Math.min(a.x, b.x) - pad) / CHUNK_SIZE);
      const x1c = Math.floor((Math.max(a.x, b.x) + pad) / CHUNK_SIZE);
      const z0c = Math.floor((Math.min(a.z, b.z) - pad) / CHUNK_SIZE);
      const z1c = Math.floor((Math.max(a.z, b.z) + pad) / CHUNK_SIZE);
      for (let cz = z0c; cz <= z1c; cz++) {
        for (let cx = x0c; cx <= x1c; cx++) {
          const k = ckey(cx, cz);
          let list = this.segByChunk.get(k);
          if (!list) {
            list = [];
            this.segByChunk.set(k, list);
          }
          list.push(seg);
        }
      }
    }
    this.version++;
  }

  /** Ajoute un plan d'eau rond (bassins, et lacs souterrains des grottes). */
  addPool(p: Pool): void {
    if (this.pools.has(p.id)) return;
    this.pools.set(p.id, p);
    const pad = p.r + (p.depth !== undefined && p.floor === undefined ? POOL_PAD : 0);
    const x0c = Math.floor((p.x - pad) / CHUNK_SIZE);
    const x1c = Math.floor((p.x + pad) / CHUNK_SIZE);
    const z0c = Math.floor((p.z - pad) / CHUNK_SIZE);
    const z1c = Math.floor((p.z + pad) / CHUNK_SIZE);
    for (let cz = z0c; cz <= z1c; cz++) {
      for (let cx = x0c; cx <= x1c; cx++) {
        const k = ckey(cx, cz);
        let list = this.poolByChunk.get(k);
        if (!list) {
          list = [];
          this.poolByChunk.set(k, list);
        }
        list.push(p);
      }
    }
    this.version++;
  }

  /**
   * Relief creusé par les lits et les bassins en (x, z), à partir de l'altitude d'origine `raw` : chenal en
   * berceau sous la surface de l'eau, puis rives en pente douce jusqu'au relief d'origine.
   */
  carveAt(x: number, z: number, raw: number): number {
    this.ensure(x, z);
    const key = ckey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    let out = raw;
    const segs = this.segByChunk.get(key);
    if (segs) {
      for (const s of segs) {
        if (!s.water) continue;
        const a = s.a;
        const b = s.b;
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const l2 = vx * vx + vz * vz;
        if (l2 <= 0) continue;
        let u = ((x - a.x) * vx + (z - a.z) * vz) / l2;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        const px = a.x + vx * u - x;
        const pz = a.z + vz * u - z;
        const hw = (a.width + (b.width - a.width) * u) * 0.5;
        const d2 = px * px + pz * pz;
        const reach = hw + STREAM_PAD;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const surf = a.surface + (b.surface - a.surface) * u;
        let target: number;
        if (d < hw) {
          // Lit en U : profond sur presque toute la largeur, il remonte vite près du bord.
          const k = d / hw;
          const k2 = k * k;
          target = surf - (a.depth + (b.depth - a.depth) * u) * (1 - k2 * k2);
        } else if (d < hw + SHELF) target = surf + 0.04;
        else target = surf + 0.04 + (d - hw - SHELF) * BANK_SLOPE;
        if (target < out) out = target;
      }
    }
    const pools = this.poolByChunk.get(key);
    if (pools) {
      for (const p of pools) {
        if (p.depth === undefined || p.floor !== undefined) continue;
        const dx = x - p.x;
        const dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        const reach = p.r + POOL_PAD;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        let target: number;
        if (d < p.r) {
          const k = d / p.r;
          const k2 = k * k;
          target = p.surface - p.depth * (1 - k2 * k2);
        } else if (d < p.r + SHELF) target = p.surface + 0.04;
        else target = p.surface + 0.04 + (d - p.r - SHELF) * BANK_SLOPE;
        if (target < out) out = target;
      }
    }
    return out;
  }

  /**
   * Surface de l'eau locale en (x, z) — ruisseau ou bassin —, ou −∞ s'il n'y en a pas. `y` (facultatif) :
   * altitude du point, pour les plans d'eau souterrains (comptent seulement entre leur fond et leur surface).
   */
  surfaceAt(x: number, z: number, y?: number): number {
    this.ensure(x, z);
    const key = ckey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    let best = -Infinity;
    const pools = this.poolByChunk.get(key);
    if (pools) {
      for (const p of pools) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz > p.r * p.r) continue;
        if (p.floor !== undefined && (y === undefined || y < p.floor - 1 || y > p.surface + 3)) continue;
        if (p.surface > best) best = p.surface;
      }
    }
    const segs = this.segByChunk.get(key);
    if (segs) {
      for (const s of segs) {
        if (!s.water) continue;
        const u = this.along(s, x, z);
        if (u < 0) continue;
        const surf = s.a.surface + (s.b.surface - s.a.surface) * u;
        if (surf > best) best = surf;
      }
    }
    return best;
  }

  /** Position (0 à 1) le long d'un segment si (x, z) est dans son eau, sinon −1. */
  private along(s: Segment, x: number, z: number): number {
    const a = s.a;
    const b = s.b;
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz;
    if (l2 <= 0) return -1;
    let u = ((x - a.x) * vx + (z - a.z) * vz) / l2;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const px = a.x + vx * u - x;
    const pz = a.z + vz * u - z;
    const hw = (a.width + (b.width - a.width) * u) * 0.5;
    return px * px + pz * pz <= hw * hw ? u : -1;
  }

  /** Courant (m/s) d'un ruisseau en (x, z), ou nul. */
  currentAt(x: number, z: number): { x: number; z: number } {
    this.ensure(x, z);
    const segs = this.segByChunk.get(ckey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    if (segs) for (const s of segs) if (s.water && this.along(s, x, z) >= 0) return { x: s.dx * 0.5, z: s.dz * 0.5 };
    return { x: 0, z: 0 };
  }

  /** Distance (m) au ruisseau le plus proche, jusqu'à `max` (pour le son). */
  streamDistance(x: number, z: number, max: number): number {
    this.ensure(x, z);
    let best = max;
    const c0x = Math.floor((x - max) / CHUNK_SIZE);
    const c1x = Math.floor((x + max) / CHUNK_SIZE);
    const c0z = Math.floor((z - max) / CHUNK_SIZE);
    const c1z = Math.floor((z + max) / CHUNK_SIZE);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const segs = this.segByChunk.get(ckey(cx, cz));
        if (!segs) continue;
        for (const s of segs) {
          if (!s.water) continue;
          const vx = s.b.x - s.a.x;
          const vz = s.b.z - s.a.z;
          const l2 = vx * vx + vz * vz || 1;
          let u = ((x - s.a.x) * vx + (z - s.a.z) * vz) / l2;
          if (u < 0) u = 0;
          else if (u > 1) u = 1;
          const ex = s.a.x + vx * u - x;
          const ez = s.a.z + vz * u - z;
          const d = Math.sqrt(ex * ex + ez * ez) - s.a.width * 0.5;
          if (d < best) best = Math.max(0, d);
        }
      }
    }
    return best;
  }

  /** Segments des ruisseaux qui touchent un chunk (affichage). */
  segmentsIn(cx: number, cz: number): ReadonlyArray<Segment> {
    this.ensure((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
    return this.segByChunk.get(ckey(cx, cz)) ?? [];
  }

  /** Bassins qui touchent un chunk (affichage). */
  poolsIn(cx: number, cz: number): ReadonlyArray<Pool> {
    this.ensure((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
    return this.poolByChunk.get(ckey(cx, cz)) ?? [];
  }

  /** Chutes d'eau à moins de `r` mètres d'un point. */
  fallsNear(x: number, z: number, r: number): Waterfall[] {
    this.ensure(x, z);
    const out: Waterfall[] = [];
    for (const f of this.falls.values()) if ((f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < r * r) out.push(f);
    return out;
  }
}
