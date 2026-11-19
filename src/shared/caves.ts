// Grottes et mines (phase 9) : de vrais volumes souterrains, creusés sous le relief.
//
// Chaque réseau est une suite de galeries (tubes au sol plat) et de salles (ellipsoïdes au sol plat), avec
// un bruit qui rend la roche irrégulière. La surface de la roche est la frontière de la fonction
//   V(p) = min(distance aux galeries et salles, hauteur du sol − y)     (V > 0 : roche, V < 0 : air)
// extraite en triangles (« marching tetrahedra ») sur une grille de 1 m alignée sur celle du sol physique.
// Là où une galerie débouche à la surface, les cellules du sol sont retirées (trou) et remplacées par les
// triangles de V : les bords du trou coïncident exactement avec le relief physique (même triangulation).
//
// Tout est déterministe (uniquement + − × ÷ et racine carrée, aucune trigonométrie) : l'hôte, les joueurs et
// le fil de calcul du terrain obtiennent les mêmes volumes.

import { CHUNK_SIZE, PHYS_CELLS, WATER_LEVEL } from './constants';
import { LANDMARKS } from './geography';
import { DIRS16, type Pool } from './hydrology';
import { placesOf } from './places';
import type { PropDef } from './props';
import type { NodeKind } from './resources';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

export type CaveKind = 'granite' | 'escarpement' | 'mine';

export const CAVE_LABELS: Record<CaveKind, string> = {
  granite: 'grotte des collines de granit',
  escarpement: 'grotte de l’escarpement',
  mine: 'galeries de la mine',
};

/** Galerie (tube) ou salle (ellipsoïde) : centre(s), rayon horizontal `r`, rayon vertical `ry`. */
interface Prim {
  room: boolean;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
  ry: number;
  /** Sol plat à `fa` (et `fb` au bout d'une galerie) ; une cheminée n'en a pas. */
  flat: boolean;
  fa: number;
  fb: number;
  /** Bruit de la roche (m). */
  noise: number;
  min: [number, number, number];
  max: [number, number, number];
}

/** Ce qu'on trouve dans une grotte (posé sur le sol) : gisements, peintures, objets. */
export interface CaveSpot {
  kind: NodeKind | 'peinture';
  x: number;
  y: number;
  z: number;
  /** Peinture : texte qu'on lit en la regardant. */
  tag?: string;
  /** Peinture : direction (depuis le centre de la salle) de la paroi où elle est peinte. */
  out?: readonly [number, number];
}

export interface CaveNet {
  id: string;
  kind: CaveKind;
  /** Entrée (au sol, devant l'ouverture) et direction vers l'intérieur. */
  mouth: { x: number; y: number; z: number; dx: number; dz: number };
  prims: Prim[];
  spots: CaveSpot[];
  pools: Pool[];
  /** Salle du fond (créatures des profondeurs). */
  deep: { x: number; y: number; z: number } | null;
  /** Mine : le puits (centre, sol en surface, fond). */
  shaft?: { x: number; z: number; top: number; bottom: number };
  min: [number, number, number];
  max: [number, number, number];
}

/** Maillage d'un bloc de roche (coordonnées du monde). */
export interface CaveMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

const BLOCK = 16;
/** Marge (m) autour des galeries pour le bruit et le relief. */
const MARGIN = 2.5;
/** Hauteur du sol d'une galerie sous son centre (fraction du rayon vertical). */
const FLOOR_K = 0.62;

function bkey(bx: number, by: number, bz: number): number {
  return ((bx + 1024) * 2048 + (by + 1024)) * 2048 + (bz + 1024);
}

function ckey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** Bruit de valeur 3D, de −1 à 1 (réseau d'entiers hachés, interpolation polynomiale). */
function vnoise(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => (hash32(seed, a, b, c) & 0xffff) / 32768 - 1;
  const x00 = h(xi, yi, zi) + (h(xi + 1, yi, zi) - h(xi, yi, zi)) * u;
  const x10 = h(xi, yi + 1, zi) + (h(xi + 1, yi + 1, zi) - h(xi, yi + 1, zi)) * u;
  const x01 = h(xi, yi, zi + 1) + (h(xi + 1, yi, zi + 1) - h(xi, yi, zi + 1)) * u;
  const x11 = h(xi, yi + 1, zi + 1) + (h(xi + 1, yi + 1, zi + 1) - h(xi, yi + 1, zi + 1)) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Point de plan (x, z) avec la hauteur de son sol. */
interface Pt {
  x: number;
  z: number;
  floor: number;
}

function prim(room: boolean, a: Pt, b: Pt, r: number, ry: number, noise: number, flat = true): Prim {
  const ay = a.floor + FLOOR_K * ry;
  const by = b.floor + FLOOR_K * ry;
  const m = Math.max(r, ry) + noise + MARGIN;
  return {
    room,
    ax: a.x,
    ay,
    az: a.z,
    bx: b.x,
    by,
    bz: b.z,
    r,
    ry,
    flat,
    fa: a.floor,
    fb: b.floor,
    noise,
    min: [Math.min(a.x, b.x) - m, Math.min(ay, by) - m, Math.min(a.z, b.z) - m],
    max: [Math.max(a.x, b.x) + m, Math.max(ay, by) + m, Math.max(a.z, b.z) + m],
  };
}

/** Distance (approchée) à une galerie ou une salle, négative à l'intérieur ; sans le bruit. */
function primDist(p: Prim, x: number, y: number, z: number): number {
  const k = p.r / p.ry;
  let d: number;
  let floor: number;
  if (p.room) {
    const dx = x - p.ax;
    const dy = (y - p.ay) * k;
    const dz = z - p.az;
    d = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r;
    floor = p.fa;
  } else {
    const vx = p.bx - p.ax;
    const vy = (p.by - p.ay) * k;
    const vz = p.bz - p.az;
    const wx = x - p.ax;
    const wy = (y - p.ay) * k;
    const wz = z - p.az;
    const l2 = vx * vx + vy * vy + vz * vz;
    let t = l2 > 0 ? (wx * vx + wy * vy + wz * vz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const ex = wx - vx * t;
    const ey = wy - vy * t;
    const ez = wz - vz * t;
    d = Math.sqrt(ex * ex + ey * ey + ez * ez) - p.r;
    floor = p.fa + (p.fb - p.fa) * t;
  }
  // Sol plat : on ne descend pas sous le plancher de la galerie.
  if (p.flat && floor - y > d) d = floor - y;
  return d;
}

/** Tétraèdres d'un cube (diagonale 0–6, même découpage partout : faces cohérentes entre cubes voisins). */
const TETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];
/** Coins d'un cube : décalages (x, y, z). */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [0, 1, 0],
  [1, 1, 0],
  [1, 1, 1],
  [0, 1, 1],
];

const ROCK: Record<CaveKind, [number, number, number]> = {
  granite: [0.52, 0.47, 0.43],
  escarpement: [0.4, 0.37, 0.34],
  mine: [0.5, 0.33, 0.24],
};

export class Caves {
  private netsCache: CaveNet[] | null = null;
  private readonly holes = new Map<number, Uint8Array | null>();
  private readonly meshes = new Map<number, CaveMesh | null>();
  private blockSet: Set<number> | null = null;
  private readonly seed: number;

  constructor(private readonly terrain: Terrain) {
    this.seed = terrain.seed;
  }

  /** Les réseaux du monde (calculés une fois). */
  get nets(): CaveNet[] {
    if (!this.netsCache) this.netsCache = this.terrain.floraEnabled ? buildNets(this.terrain) : [];
    return this.netsCache;
  }

  /** Distance à la roche la plus proche des galeries (avec le bruit) : négative dans l'air d'une grotte. */
  sdf(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const n of this.nets) {
      if (x < n.min[0] || x > n.max[0] || y < n.min[1] || y > n.max[1] || z < n.min[2] || z > n.max[2]) continue;
      for (const p of n.prims) {
        if (x < p.min[0] || x > p.max[0] || y < p.min[1] || y > p.max[1] || z < p.min[2] || z > p.max[2]) continue;
        const d = this.primNoisy(p, x, y, z);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private primNoisy(p: Prim, x: number, y: number, z: number): number {
    const d = primDist(p, x, y, z);
    if (p.noise <= 0 || d > p.noise + 1.5 || d < -p.noise - 1.5) return d;
    const n = vnoise(this.seed, x * 0.23, y * 0.31, z * 0.23) * 0.7 + vnoise(this.seed ^ 0x51ed, x * 0.61, y * 0.61, z * 0.61) * 0.3;
    // Le sol reste praticable : moins de bruit au ras du plancher.
    const nearFloor = p.flat ? Math.min(1, Math.max(0.25, (y - (p.fa + p.fb) * 0.5) / 1.2)) : 1;
    return d + n * p.noise * nearFloor;
  }

  /** Sous terre (0 à 1) : dans l'air d'une grotte et sous la surface du sol. */
  underground(x: number, y: number, z: number): number {
    const nets = this.nets;
    if (!nets.length) return 0;
    let inside = false;
    for (const n of nets) if (x >= n.min[0] && x <= n.max[0] && y >= n.min[1] && y <= n.max[1] && z >= n.min[2] && z <= n.max[2]) inside = true;
    if (!inside || this.sdf(x, y, z) > 0.6) return 0;
    const depth = this.terrain.heightAt(x, z) - y;
    return Math.max(0, Math.min(1, (depth - 1) / 5));
  }

  /**
   * Cellules (1 m) du sol physique retirées dans un chunk : là où l'air d'une grotte atteint la surface.
   * 64 × 64, rangées par lignes (iz × 64 + ix) ; null s'il n'y en a aucune.
   */
  holesInChunk(cx: number, cz: number): Uint8Array | null {
    const key = ckey(cx, cz);
    if (this.holes.has(key)) return this.holes.get(key)!;
    const out = this.computeHoles(cx, cz);
    this.holes.set(key, out);
    return out;
  }

  private computeHoles(cx: number, cz: number): Uint8Array | null {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const x1 = x0 + CHUNK_SIZE;
    const z1 = z0 + CHUNK_SIZE;
    const prims: Prim[] = [];
    for (const n of this.nets) {
      if (n.max[0] < x0 || n.min[0] > x1 || n.max[2] < z0 || n.min[2] > z1) continue;
      for (const p of n.prims) if (!(p.max[0] < x0 || p.min[0] > x1 || p.max[2] < z0 || p.min[2] > z1)) prims.push(p);
    }
    if (!prims.length) return null;
    let mask: Uint8Array | null = null;
    const t = this.terrain;
    for (const p of prims) {
      const ix0 = Math.max(0, Math.floor(p.min[0] - x0));
      const ix1 = Math.min(PHYS_CELLS - 1, Math.ceil(p.max[0] - x0));
      const iz0 = Math.max(0, Math.floor(p.min[2] - z0));
      const iz1 = Math.min(PHYS_CELLS - 1, Math.ceil(p.max[2] - z0));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          if (mask && mask[iz * PHYS_CELLS + ix]) continue;
          const wx = x0 + ix;
          const wz = z0 + iz;
          // Coins et centre de la cellule, juste sous la surface.
          let hit = false;
          for (const [ox, oz] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
            [0.5, 0.5],
          ] as const) {
            const px = wx + ox;
            const pz = wz + oz;
            const h = ox === 0.5 ? (t.heightAt(wx, wz + 1) + t.heightAt(wx + 1, wz)) * 0.5 : t.heightAt(px, pz);
            if (h - 2 > p.max[1] || h + 1 < p.min[1]) continue;
            // L'air de la grotte à moins d'environ 1,5 m sous la surface : la roche y serait plus mince qu'une
            // maille de 1 m, on ouvre la cellule (sinon une fente apparaît entre le sol et la voûte).
            if (this.sdf(px, h - 0.35, pz) < 0.6 || this.sdf(px, h - 1, pz) < 0.6 || this.sdf(px, h - 1.8, pz) < 0.3) {
              hit = true;
              break;
            }
          }
          if (hit) {
            if (!mask) mask = new Uint8Array(PHYS_CELLS * PHYS_CELLS);
            mask[iz * PHYS_CELLS + ix] = 1;
          }
        }
      }
    }
    return mask;
  }

  /** Une cellule du sol (1 m) est-elle retirée ? */
  isHole(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const m = this.holesInChunk(cx, cz);
    if (!m) return false;
    const ix = Math.floor(x - cx * CHUNK_SIZE);
    const iz = Math.floor(z - cz * CHUNK_SIZE);
    return m[iz * PHYS_CELLS + ix] === 1;
  }

  /** Tous les blocs de roche à mailler (ceux que touchent les galeries). */
  private blocks(): Set<number> {
    if (this.blockSet) return this.blockSet;
    const set = new Set<number>();
    for (const n of this.nets) {
      for (const p of n.prims) {
        for (let bx = Math.floor(p.min[0] / BLOCK); bx <= Math.floor(p.max[0] / BLOCK); bx++)
          for (let by = Math.floor(p.min[1] / BLOCK); by <= Math.floor(p.max[1] / BLOCK); by++) for (let bz = Math.floor(p.min[2] / BLOCK); bz <= Math.floor(p.max[2] / BLOCK); bz++) set.add(bkey(bx, by, bz));
      }
    }
    this.blockSet = set;
    return set;
  }

  /** Blocs à moins de `r` mètres (à l'horizontale) d'un point. */
  blocksNear(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    if (!this.nets.length) return out;
    const near = this.nets.some((n) => x > n.min[0] - r && x < n.max[0] + r && z > n.min[2] - r && z < n.max[2] + r);
    if (!near) return out;
    for (const k of this.blocks()) {
      const [bx, , bz] = unkey(k);
      const cx = (bx + 0.5) * BLOCK;
      const cz = (bz + 0.5) * BLOCK;
      if (Math.abs(cx - x) < r + BLOCK / 2 && Math.abs(cz - z) < r + BLOCK / 2) out.push(k);
    }
    return out;
  }

  /** Le maillage d'un bloc est-il déjà calculé ? */
  hasMesh(key: number): boolean {
    return this.meshes.has(key);
  }

  /** Maillage d'un bloc (calculé une fois) ; null s'il est vide. */
  blockMesh(key: number): CaveMesh | null {
    if (this.meshes.has(key)) return this.meshes.get(key)!;
    const m = this.meshBlock(key);
    this.meshes.set(key, m);
    return m;
  }

  /**
   * Prépare à l'avance, par petits morceaux, les blocs proches d'un point (affichage fluide) ; renvoie vrai
   * s'il reste du travail.
   */
  warm(x: number, z: number, r: number, budgetMs: number): boolean {
    const t0 = performance.now();
    for (const k of this.blocksNear(x, z, r)) {
      if (this.meshes.has(k)) continue;
      this.blockMesh(k);
      if (performance.now() - t0 > budgetMs) return true;
    }
    return false;
  }

  private meshBlock(key: number): CaveMesh | null {
    const [bx, by, bz] = unkey(key);
    const ox = bx * BLOCK;
    const oy = by * BLOCK;
    const oz = bz * BLOCK;
    const prims: Array<{ p: Prim; kind: CaveKind }> = [];
    for (const n of this.nets) {
      for (const p of n.prims) {
        if (p.max[0] < ox - 1 || p.min[0] > ox + BLOCK + 1 || p.max[1] < oy - 1 || p.min[1] > oy + BLOCK + 1 || p.max[2] < oz - 1 || p.min[2] > oz + BLOCK + 1) continue;
        prims.push({ p, kind: n.kind });
      }
    }
    if (!prims.length) return null;
    const kind = prims[0]!.kind;
    const N = BLOCK + 1;
    const t = this.terrain;
    // Hauteur du sol aux nœuds de la grille (la même triangulation que la physique, en mètres entiers).
    const col = new Float64Array(N * N);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) col[iz * N + ix] = t.heightAt(ox + ix, oz + iz);
    const caveAt = (x: number, y: number, z: number) => {
      let best = Infinity;
      for (const { p } of prims) {
        if (x < p.min[0] || x > p.max[0] || y < p.min[1] || y > p.max[1] || z < p.min[2] || z > p.max[2]) continue;
        const d = this.primNoisy(p, x, y, z);
        if (d < best) best = d;
      }
      return best;
    };
    const V = new Float64Array(N * N * N);
    let air = false;
    let rock = false;
    for (let iy = 0; iy < N; iy++) {
      for (let iz = 0; iz < N; iz++) {
        for (let ix = 0; ix < N; ix++) {
          const y = oy + iy;
          const v = Math.min(caveAt(ox + ix, y, oz + iz), col[iz * N + ix]! - y);
          V[(iy * N + iz) * N + ix] = v;
          if (v < 0) air = true;
          else rock = true;
        }
      }
    }
    if (!air || !rock) return null;
    // Hauteur triangulée du sol en un point du bloc (diagonale (x+1, z)–(x, z+1), comme la physique).
    const triH = (x: number, z: number) => {
      const gx = Math.min(BLOCK - 1, Math.max(0, Math.floor(x - ox)));
      const gz = Math.min(BLOCK - 1, Math.max(0, Math.floor(z - oz)));
      const u = x - ox - gx;
      const v = z - oz - gz;
      const h00 = col[gz * N + gx]!;
      const h10 = col[gz * N + gx + 1]!;
      const h01 = col[(gz + 1) * N + gx]!;
      if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
      const h11 = col[(gz + 1) * N + gx + 1]!;
      return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    };
    const pos: number[] = [];
    const idx: number[] = [];
    const vmap = new Map<number, number>();
    const total = N * N * N;
    const vertexOn = (ia: number, ib: number): number => {
      const ek = ia < ib ? ia * total + ib : ib * total + ia;
      const known = vmap.get(ek);
      if (known !== undefined) return known;
      const va = V[ia]!;
      const vb = V[ib]!;
      const s = va / (va - vb);
      const ax = ia % N;
      const az = Math.floor(ia / N) % N;
      const ay = Math.floor(ia / (N * N));
      const bxi = ib % N;
      const bzi = Math.floor(ib / N) % N;
      const byi = Math.floor(ib / (N * N));
      const n = pos.length / 3;
      pos.push(ox + ax + (bxi - ax) * s, oy + ay + (byi - ay) * s, oz + az + (bzi - az) * s);
      vmap.set(ek, n);
      return n;
    };
    const tri: number[] = [];
    const emit = (a: number, b: number, c: number, airI: number, rockI: number) => {
      // Face visible du côté de l'air (on voit la roche de l'intérieur de la grotte). Comme le maillage du
      // sol, le produit vectoriel (b − a) × (c − a) pointe à l'opposé de la face visible : vers la roche.
      const ax = pos[a * 3]!;
      const ay = pos[a * 3 + 1]!;
      const az = pos[a * 3 + 2]!;
      const ux = pos[b * 3]! - ax;
      const uy = pos[b * 3 + 1]! - ay;
      const uz = pos[b * 3 + 2]! - az;
      const vx = pos[c * 3]! - ax;
      const vy = pos[c * 3 + 1]! - ay;
      const vz = pos[c * 3 + 2]! - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const dx = (airI % N) - (rockI % N);
      const dy = Math.floor(airI / (N * N)) - Math.floor(rockI / (N * N));
      const dz = (Math.floor(airI / N) % N) - (Math.floor(rockI / N) % N);
      if (nx * dx + ny * dy + nz * dz > 0) tri.push(a, c, b);
      else tri.push(a, b, c);
    };
    const corner = new Array<number>(8);
    for (let iy = 0; iy < BLOCK; iy++) {
      for (let iz = 0; iz < BLOCK; iz++) {
        for (let ix = 0; ix < BLOCK; ix++) {
          let anyAir = false;
          let anyRock = false;
          for (let c = 0; c < 8; c++) {
            const o = CORNERS[c]!;
            const i = ((iy + o[1]) * N + (iz + o[2])) * N + (ix + o[0]);
            corner[c] = i;
            if (V[i]! < 0) anyAir = true;
            else anyRock = true;
          }
          if (!anyAir || !anyRock) continue;
          for (const tet of TETS) {
            const q = [corner[tet[0]]!, corner[tet[1]]!, corner[tet[2]]!, corner[tet[3]]!];
            const inAir = q.filter((i) => V[i]! < 0);
            const inRock = q.filter((i) => V[i]! >= 0);
            if (inAir.length === 0 || inRock.length === 0) continue;
            if (inAir.length === 1 || inRock.length === 1) {
              const lone = inAir.length === 1 ? inAir[0]! : inRock[0]!;
              const others = inAir.length === 1 ? inRock : inAir;
              emit(vertexOn(lone, others[0]!), vertexOn(lone, others[1]!), vertexOn(lone, others[2]!), inAir[0]!, inRock[0]!);
            } else {
              const [a0, a1] = inAir as [number, number];
              const [r0, r1] = inRock as [number, number];
              const p00 = vertexOn(a0, r0);
              const p01 = vertexOn(a0, r1);
              const p11 = vertexOn(a1, r1);
              const p10 = vertexOn(a1, r0);
              emit(p00, p01, p11, a0, r0);
              emit(p00, p11, p10, a0, r0);
            }
          }
        }
      }
    }
    // Les triangles de la surface du sol ne sont gardés que dans les cellules retirées (le trou) ; ailleurs,
    // le relief habituel est déjà là.
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k]!;
      const b = tri[k + 1]!;
      const c = tri[k + 2]!;
      const cx = (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3;
      const cy = (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3;
      const cz = (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3;
      const ground = triH(cx, cz) - cy;
      const isGround = ground < caveAt(cx, cy, cz);
      if (isGround && !this.isHole(cx, cz)) continue;
      idx.push(a, b, c);
    }
    if (!idx.length) return null;
    // Normales lissées (somme des faces, tournées vers l'air) et couleurs de la roche.
    const nv = pos.length / 3;
    const normals = new Float32Array(nv * 3);
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k]!;
      const b = idx[k + 1]!;
      const c = idx[k + 2]!;
      const ux = pos[b * 3]! - pos[a * 3]!;
      const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
      const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
      const vx = pos[c * 3]! - pos[a * 3]!;
      const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
      const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
      const nx = -(uy * vz - uz * vy);
      const ny = -(uz * vx - ux * vz);
      const nz = -(ux * vy - uy * vx);
      for (const i of [a, b, c]) {
        normals[i * 3] = normals[i * 3]! + nx;
        normals[i * 3 + 1] = normals[i * 3 + 1]! + ny;
        normals[i * 3 + 2] = normals[i * 3 + 2]! + nz;
      }
    }
    const colors = new Float32Array(nv * 4);
    const [rr, rg, rb] = ROCK[kind];
    for (let i = 0; i < nv; i++) {
      const nx = normals[i * 3]!;
      const ny = normals[i * 3 + 1]!;
      const nz = normals[i * 3 + 2]!;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[i * 3] = nx / l;
      normals[i * 3 + 1] = ny / l;
      normals[i * 3 + 2] = nz / l;
      const x = pos[i * 3]!;
      const y = pos[i * 3 + 1]!;
      const z = pos[i * 3 + 2]!;
      const g = ((hash32(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2), 77) & 255) / 255) * 0.1 - 0.05;
      // Les sols sont plus sombres (poussière, eau) ; près de la surface, la terre.
      const floor = ny / l > 0.6 ? 0.82 : 1;
      const nearSky = Math.max(0, Math.min(1, 1 - (triH(x, z) - y) / 1.5));
      colors[i * 4] = (rr * floor + g) * (1 - nearSky) + 0.42 * nearSky;
      colors[i * 4 + 1] = (rg * floor + g) * (1 - nearSky) + 0.39 * nearSky;
      colors[i * 4 + 2] = (rb * floor + g * 0.8) * (1 - nearSky) + 0.28 * nearSky;
      colors[i * 4 + 3] = 1;
    }
    return { positions: Float32Array.from(pos), normals, colors, indices: Uint32Array.from(idx) };
  }

  /** Sol d'une grotte sous un point (recherche vers le bas), ou null hors des grottes. */
  floorBelow(x: number, y: number, z: number, maxDrop = 30): number | null {
    let prev = this.sdf(x, y, z);
    if (prev > 0) return null;
    for (let d = 0.25; d <= maxDrop; d += 0.25) {
      const v = this.sdf(x, y - d, z);
      if (v > 0) {
        // Entre y − d + 0,25 et y − d : interpolation.
        const s = prev / (prev - v);
        return y - d + 0.25 - 0.25 * s;
      }
      prev = v;
    }
    return null;
  }
}

const NODE_SIZE: Partial<Record<NodeKind, number>> = { bloc_quartz: 0.8, filon_fer: 1, gravier_or: 1.2 };
/** Gisements posés en relief (les autres sont à plat). */
const SOLID = new Set<string>(['bloc_quartz', 'filon_fer']);

/**
 * Gisements et peintures des grottes d'un chunk, comme objets fixes (identifiants stables). Une peinture est
 * plaquée sur la paroi la plus proche dans sa direction.
 */
export function caveSpotsInChunk(t: Terrain, cx: number, cz: number): PropDef[] {
  if (!t.floraEnabled) return [];
  const out: PropDef[] = [];
  const caves = t.caves;
  for (const n of caves.nets) {
    if (n.max[0] < cx * CHUNK_SIZE - 20 || n.min[0] > (cx + 1) * CHUNK_SIZE + 20 || n.max[2] < cz * CHUNK_SIZE - 20 || n.min[2] > (cz + 1) * CHUNK_SIZE + 20) continue;
    n.spots.forEach((s, i) => {
      let x = s.x;
      let z = s.z;
      let y = s.y;
      if (s.kind === 'peinture' && s.out) {
        // On avance du centre de la salle jusqu'à la roche, puis on recule de quelques centimètres.
        for (let k = 0; k < 120; k++) {
          const nx = x + s.out[0] * 0.1;
          const nz = z + s.out[1] * 0.1;
          if (caves.sdf(nx, y, nz) > -0.05) break;
          x = nx;
          z = nz;
        }
      } else {
        const f = caves.floorBelow(s.x, s.y + 1, s.z, 4);
        if (f !== null) y = f;
      }
      if (Math.floor(x / CHUNK_SIZE) !== cx || Math.floor(z / CHUNK_SIZE) !== cz) return;
      const id = `c:${n.id}:${i}`;
      if (s.kind === 'peinture') {
        const rot = s.out ? (((Math.atan2(s.out[0], s.out[1]) / (Math.PI * 2)) % 1) + 1) % 1 : 0;
        out.push({ id, kind: 'peinture', x, y, z, rot, radius: 0.9, length: 0.6, fixed: true, ...(s.tag ? { meta: { tag: s.tag } } : {}) });
      } else {
        const size = NODE_SIZE[s.kind] ?? 0.8;
        out.push({ id, kind: s.kind, x, y: y + (SOLID.has(s.kind) ? size * 0.25 : 0.02), z, rot: (i * 0.37) % 1, radius: size / 2, length: 0, fixed: true, size });
      }
    });
  }
  return out;
}

function unkey(k: number): [number, number, number] {
  const bz = (k % 2048) - 1024;
  const r = Math.floor(k / 2048);
  const by = (r % 2048) - 1024;
  const bx = Math.floor(r / 2048) - 1024;
  return [bx, by, bz];
}

// ——— Réseaux ———

function buildNets(t: Terrain): CaveNet[] {
  const out: CaveNet[] = [];
  const granite = graniteCave(t);
  if (granite) out.push(granite);
  const esc = escarpCave(t);
  if (esc) out.push(esc);
  const mine = mineGalleries(t);
  if (mine) out.push(mine);
  return out;
}

/** Pente (gradient) du relief d'origine. */
function grad(t: Terrain, x: number, z: number): [number, number] {
  const e = 2;
  return [(t.rawHeightAt(x + e, z) - t.rawHeightAt(x - e, z)) / (2 * e), (t.rawHeightAt(x, z + e) - t.rawHeightAt(x, z - e)) / (2 * e)];
}

/** Direction (parmi seize) la plus proche d'un vecteur. */
function dirOf(gx: number, gz: number): readonly [number, number] {
  let best = 0;
  let bd = -Infinity;
  for (let k = 0; k < 16; k++) {
    const d = DIRS16[k]!;
    const s = d[0] * gx + d[1] * gz;
    if (s > bd) {
      bd = s;
      best = k;
    }
  }
  return DIRS16[best]!;
}

/** Pied d'une paroi raide : on part d'un point de forte pente et on descend jusqu'au replat. */
function cliffFoot(t: Terrain, x0: number, z0: number, minSlope: number): { x: number; z: number; d: readonly [number, number] } | null {
  const [gx, gz] = grad(t, x0, z0);
  const g = Math.sqrt(gx * gx + gz * gz);
  if (g < minSlope) return null;
  const d = dirOf(gx, gz);
  let x = x0;
  let z = z0;
  for (let k = 0; k < 40; k++) {
    x -= d[0];
    z -= d[1];
    const [hx, hz] = grad(t, x, z);
    if (hx * hx + hz * hz < 0.3 * 0.3) return { x: Math.round(x), z: Math.round(z), d };
  }
  return null;
}

/** Le sol doit couvrir la grotte : le plancher est abaissé là où la roche serait trop mince. */
function covered(t: Terrain, p: Pt, ry: number, r: number): Pt {
  let h = Infinity;
  for (const [ox, oz] of [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ] as const)
    h = Math.min(h, t.rawHeightAt(p.x + ox, p.z + oz));
  const top = p.floor + ry * (1 + FLOOR_K);
  return top > h - 3 ? { ...p, floor: h - 3 - ry * (1 + FLOOR_K) } : p;
}

function pt(x: number, z: number, floor: number): Pt {
  return { x, z, floor };
}

function finish(id: string, kind: CaveKind, mouth: CaveNet['mouth'], prims: Prim[], spots: CaveSpot[], pools: Pool[], deep: CaveNet['deep']): CaveNet {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p.min[i]!);
      max[i] = Math.max(max[i]!, p.max[i]!);
    }
  }
  return { id, kind, mouth, prims, spots, pools, deep, min, max };
}

/** Grotte des collines de granit : abri peint, salle aux cristaux, passage étroit vers une salle cachée. */
function graniteCave(t: Terrain): CaveNet | null {
  const L = LANDMARKS.matobo;
  for (let n = 0; n < 1500; n++) {
    const h = hash32(t.seed, n, 0xca7e, 1);
    const x0 = Math.round(L.x + (((h & 0xffff) / 65536) * 2 - 1) * L.rx * 0.7);
    const z0 = Math.round(L.z + ((((h >>> 16) & 0xffff) / 65536) * 2 - 1) * L.rz * 0.7);
    const foot = cliffFoot(t, x0, z0, 0.9);
    if (!foot) continue;
    const { x, z, d } = foot;
    const g = t.rawHeightAt(x, z);
    if (g < WATER_LEVEL + 3 || t.waterLevelAt(x, z) > t.heightAt(x, z) - 0.5) continue;
    // La colline doit vraiment monter derrière l'entrée.
    if (t.rawHeightAt(x + d[0] * 12, z + d[1] * 12) < g + 6 || t.rawHeightAt(x + d[0] * 26, z + d[1] * 26) < g + 10) continue;
    const px = -d[1];
    const pz = d[0];
    const at = (a: number, b: number, floor: number): Pt => pt(x + d[0] * a + px * b, z + d[1] * a + pz * b, g + floor);
    const P0 = at(-3, 0, -0.4);
    const A = covered(t, at(11, 0, -1.6), 1.5, 2);
    const B = covered(t, at(24, 4, -4), 3.4, 6);
    const C = covered(t, at(34, -6, -6.5), 2.8, 5);
    const D = covered(t, at(37, -17, -7.5), 2.2, 3.5);
    const nz = 0.55;
    const prims = [
      prim(false, P0, A, 2.1, 1.6, nz * 0.6),
      prim(false, A, B, 1.9, 1.5, nz),
      prim(true, B, B, 6, 3.4, nz),
      prim(false, B, C, 1.7, 1.45, nz),
      prim(true, C, C, 5, 2.8, nz),
      // Passage étroit (on s'y baisse) vers la salle cachée.
      prim(false, C, D, 1.15, 0.95, nz * 0.5),
      prim(true, D, D, 3.5, 2.2, nz * 0.7),
    ];
    const spots: CaveSpot[] = [
      { kind: 'peinture', x: B.x, y: B.floor + 1.6, z: B.z, tag: 'p_abri', out: d },
      { kind: 'bloc_quartz', x: C.x + px * 2.5, y: C.floor, z: C.z + pz * 2.5 },
      { kind: 'bloc_quartz', x: C.x - d[0] * 2, y: C.floor, z: C.z - d[1] * 2 },
      { kind: 'bloc_quartz', x: C.x + d[0] * 2.8 - px * 1.2, y: C.floor, z: C.z + d[1] * 2.8 - pz * 1.2 },
      { kind: 'gravier_or', x: D.x + d[0], y: D.floor, z: D.z + d[1] },
      { kind: 'peinture', x: D.x, y: D.floor + 1.3, z: D.z, tag: 'p_salle_cachee', out: [-px, -pz] },
    ];
    return finish('granite0', 'granite', { x, y: t.heightAt(x, z), z, dx: d[0], dz: d[1] }, prims, spots, [], null);
  }
  return null;
}

/** Grotte de l'escarpement : grande caverne et son lac, siphon vers une salle sèche, galerie profonde. */
function escarpCave(t: Terrain): CaveNet | null {
  for (let n = 0; n < 2500; n++) {
    const h = hash32(t.seed, n, 0xe5ca, 2);
    const x0 = Math.round((((h & 0xffff) / 65536) * 2 - 1) * 5500);
    const z0 = Math.round(3800 + (((h >>> 16) & 0xffff) / 65536) * 1100);
    const foot = cliffFoot(t, x0, z0, 0.75);
    if (!foot) continue;
    const { x, z, d } = foot;
    const g = t.rawHeightAt(x, z);
    if (g < WATER_LEVEL + 4 || t.waterLevelAt(x, z) > t.heightAt(x, z) - 0.5) continue;
    if (t.rawHeightAt(x + d[0] * 15, z + d[1] * 15) < g + 8 || t.rawHeightAt(x + d[0] * 45, z + d[1] * 45) < g + 22) continue;
    const px = -d[1];
    const pz = d[0];
    const at = (a: number, b: number, floor: number): Pt => pt(x + d[0] * a + px * b, z + d[1] * a + pz * b, g + floor);
    const P0 = at(-3, 0, -0.4);
    const A = covered(t, at(13, 0, -2.5), 1.8, 2.2);
    const B = covered(t, at(38, 0, -9), 1.7, 2);
    // Grande caverne (16 m) ; le lac occupe un creux sur le côté.
    const cav = covered(t, at(56, 4, -13), 8, 16);
    const fc = cav.floor;
    const lake = pt(cav.x + px * 7 + d[0] * 3, cav.z + pz * 7 + d[1] * 3, fc - 3.4);
    // Siphon : sous l'eau sur une douzaine de mètres, puis il remonte vers une salle sèche.
    const s1 = pt(lake.x + d[0] * 14, lake.z + d[1] * 14, fc - 3.3);
    const room = pt(s1.x + d[0] * 11, s1.z + d[1] * 11, fc - 0.2);
    // Galerie qui descend vers le fond.
    const G1 = pt(cav.x - px * 18 + d[0] * 6, cav.z - pz * 18 + d[1] * 6, fc - 6);
    const deep = covered(t, pt(G1.x - px * 14 + d[0] * 10, G1.z - pz * 14 + d[1] * 10, fc - 11), 4, 7);
    const nz = 0.6;
    const prims = [
      prim(false, P0, A, 2.3, 1.8, nz * 0.6),
      prim(false, A, B, 2, 1.6, nz),
      prim(false, B, cav, 2.2, 1.8, nz),
      prim(true, cav, cav, 16, 8, nz * 1.2),
      prim(true, lake, lake, 9, 3.8, nz * 0.6),
      prim(false, lake, s1, 1.6, 1.1, nz * 0.4),
      prim(false, s1, room, 1.6, 1.25, nz * 0.4),
      prim(true, room, room, 4.2, 2.5, nz * 0.7),
      prim(false, cav, G1, 1.9, 1.6, nz),
      prim(false, G1, deep, 1.8, 1.5, nz),
      prim(true, deep, deep, 7, 4, nz),
    ];
    // Le lac : sa surface reste sous le plancher de la caverne (rive sèche) ; il remplit le siphon.
    const surface = fc - 0.6;
    const pools: Pool[] = [
      { id: 'grotte_lac', x: lake.x, z: lake.z, r: 8.5, surface, floor: lake.floor - 0.5 },
      { id: 'grotte_siphon1', x: (lake.x + s1.x) / 2, z: (lake.z + s1.z) / 2, r: 6.5, surface, floor: s1.floor - 0.5 },
      { id: 'grotte_siphon2', x: s1.x + d[0] * 4, z: s1.z + d[1] * 4, r: 5, surface, floor: s1.floor - 0.5 },
    ];
    const spots: CaveSpot[] = [
      { kind: 'filon_fer', x: cav.x - d[0] * 10, y: fc, z: cav.z - d[1] * 10 },
      { kind: 'filon_fer', x: cav.x - px * 9, y: fc, z: cav.z - pz * 9 },
      { kind: 'bloc_quartz', x: B.x + px * 1.2, y: B.floor, z: B.z + pz * 1.2 },
      { kind: 'gravier_or', x: room.x + d[0] * 1.5, y: room.floor, z: room.z + d[1] * 1.5 },
      { kind: 'gravier_or', x: room.x - px * 1.8, y: room.floor, z: room.z - pz * 1.8 },
      { kind: 'peinture', x: room.x, y: room.floor + 1.3, z: room.z, tag: 'p_siphon', out: d },
      { kind: 'bloc_quartz', x: deep.x + px * 3, y: deep.floor, z: deep.z + pz * 3 },
    ];
    for (const p of pools) p.y = (p.surface + p.floor!) / 2;
    return finish('escarp0', 'escarpement', { x, y: t.heightAt(x, z), z, dx: d[0], dz: d[1] }, prims, spots, pools, { x: deep.x, y: deep.floor, z: deep.z });
  }
  return null;
}

/** Galeries de la mine : un puits vertical, des galeries étayées, la galerie 7 et la cavité qu'elle a percée. */
function mineGalleries(t: Terrain): CaveNet | null {
  const site = placesOf(t).find((p) => p.kind === 'mine');
  if (!site) return null;
  // Orientation du lieu par quarts de tour, sans trigonométrie (valeurs exactes).
  const q = (((Math.round(site.yaw / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const COS = [1, 0, -1, 0][q]!;
  const SIN = [0, 1, 0, -1][q]!;
  const at = (lx: number, lz: number, floor: number): Pt => pt(site.x + lx * COS + lz * SIN, site.z - lx * SIN + lz * COS, floor);
  // Le puits est sous le chevalement (repère du lieu : (0, 8)).
  const m = at(0, 8, 0);
  const g = t.heightAt(m.x, m.z);
  const bottom = g - 23;
  const top = pt(m.x, m.z, g + 2);
  const foot = pt(m.x, m.z, bottom);
  const nz = 0.25;
  const main1 = at(0, 44, bottom - 1);
  const side1a = at(0, 20, bottom - 0.3);
  const side1b = at(22, 20, bottom - 0.6);
  const side2a = at(0, 32, bottom - 0.6);
  const side2b = at(-20, 32, bottom - 1.2);
  const cavity = covered(t, at(6, 56, bottom - 4), 4.5, 8);
  const deep = covered(t, at(-8, 70, bottom - 10), 4, 6);
  const prims = [
    // Cheminée verticale (sans plancher), puis la salle du fond du puits.
    { ...prim(false, top, foot, 1.5, 1.5, 0.1, false), ay: g + 2, by: bottom + 0.3 },
    prim(true, foot, foot, 3, 2.2, nz),
    prim(false, foot, main1, 1.5, 1.3, nz),
    prim(false, side1a, side1b, 1.4, 1.2, nz),
    prim(false, side2a, side2b, 1.4, 1.2, nz),
    // Galerie 7 : elle a percé une cavité naturelle, plus bas encore le fond.
    prim(false, main1, cavity, 1.4, 1.2, nz * 2),
    prim(true, cavity, cavity, 8, 4.5, 0.5),
    prim(false, cavity, deep, 1.6, 1.4, 0.5),
    prim(true, deep, deep, 6, 4, 0.55),
  ];
  // Cheminée : rayon horizontal 1,5 m sur toute la hauteur (ellipsoïde dégénéré : tube vertical).
  const shaft = prims[0]!;
  shaft.min = [m.x - 1.5 - MARGIN, bottom - MARGIN, m.z - 1.5 - MARGIN];
  shaft.max = [m.x + 1.5 + MARGIN, g + 2 + MARGIN, m.z + 1.5 + MARGIN];
  const spots: CaveSpot[] = [
    { kind: 'filon_fer', x: side1b.x, y: side1b.floor, z: side1b.z },
    { kind: 'filon_fer', x: side2b.x, y: side2b.floor, z: side2b.z },
    { kind: 'gravier_or', x: cavity.x + 2, y: cavity.floor, z: cavity.z - 1 },
    { kind: 'gravier_or', x: cavity.x - 3, y: cavity.floor, z: cavity.z + 2 },
    { kind: 'bloc_quartz', x: main1.x, y: main1.floor, z: main1.z },
    { kind: 'peinture', x: cavity.x, y: cavity.floor + 1.5, z: cavity.z, tag: 'p_cavite', out: [SIN, COS] },
  ];
  const net = finish('mine0', 'mine', { x: m.x, y: g, z: m.z, dx: 0, dz: 0 }, prims, spots, [], { x: deep.x, y: deep.floor, z: deep.z });
  net.shaft = { x: m.x, z: m.z, top: g, bottom };
  return net;
}
