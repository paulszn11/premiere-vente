// Géographie du monde, inspirée du Zimbabwe, sur 16 km × 16 km (x vers l'est, z vers le nord).
//
//   Nord   : vallée du Zambèze (basse, chaude), le fleuve d'ouest en est et un grand lac.
//   ↓        escarpement (falaises) entre la vallée et le plateau.
//   Centre : haut plateau (Highveld) : prairies, forêts claires de miombo, zones humides (vleis).
//   Est    : hautes terres (montagnes, forêt de montagne, rares sommets enneigés).
//   Sud-O. : collines de granit (inspirées des Matobo) : kopjes, rochers en équilibre.
//   Sud    : lowveld (savane sèche, baobabs) qui descend vers le Limpopo.
//   Ouest  : sables du Kalahari (forêt sèche de teck, cuvettes).
//   Bords  : montagnes frontalières infranchissables.
//
// Toutes les fonctions sont déterministes et n'utilisent que + - * / floor sqrt abs min max :
// le client et le serveur calculent exactement le même monde à partir de la graine.
// Les limites entre régions sont déformées par du bruit pour paraître naturelles.

import { WATER_LEVEL, WORLD_HALF } from './constants';
import { Simplex2, lerp, smoothstep } from './noise';
import { hash32 } from './rng';

export type BiomeId =
  | 'plateau'
  | 'miombo'
  | 'vlei'
  | 'vallee'
  | 'fleuve'
  | 'escarpement'
  | 'matobo'
  | 'hautes_terres'
  | 'lowveld'
  | 'kalahari'
  | 'frontiere';

export type SurfaceId = 'herbe' | 'terre' | 'sable' | 'boue' | 'roche' | 'granite' | 'neige' | 'eau';

export const BIOME_LABELS: Record<BiomeId, string> = {
  plateau: 'Haut plateau (prairie)',
  miombo: 'Forêt claire de miombo',
  vlei: 'Zone humide (vlei)',
  vallee: 'Vallée du Zambèze',
  fleuve: 'Bords du fleuve',
  escarpement: 'Escarpement',
  matobo: 'Collines de granit',
  hautes_terres: 'Hautes terres de l’Est',
  lowveld: 'Lowveld (savane sèche)',
  kalahari: 'Sables du Kalahari',
  frontiere: 'Montagnes frontalières',
};

export const SURFACE_LABELS: Record<SurfaceId, string> = {
  herbe: 'herbe',
  terre: 'terre sèche',
  sable: 'sable',
  boue: 'boue',
  roche: 'roche',
  granite: 'granite',
  neige: 'neige',
  eau: 'eau',
};

/** Effet d'un sol sur les déplacements. */
export interface SurfaceEffect {
  /** Multiplicateur de vitesse. */
  speed: number;
  /** Multiplicateur d'accélération (adhérence). */
  grip: number;
  /** Pente maximale gravissable sur ce sol, en degrés. */
  maxClimbDeg: number;
  /** Multiplicateur de la violence d'une chute à l'atterrissage. */
  impact: number;
}

export const SURFACE_EFFECTS: Record<SurfaceId, SurfaceEffect> = {
  herbe: { speed: 1, grip: 1, maxClimbDeg: 45, impact: 1 },
  terre: { speed: 1, grip: 1, maxClimbDeg: 45, impact: 1 },
  sable: { speed: 0.82, grip: 0.8, maxClimbDeg: 34, impact: 0.8 },
  boue: { speed: 0.55, grip: 0.55, maxClimbDeg: 25, impact: 0.8 },
  roche: { speed: 1, grip: 0.95, maxClimbDeg: 45, impact: 1.1 },
  granite: { speed: 0.95, grip: 0.9, maxClimbDeg: 42, impact: 1.1 },
  neige: { speed: 0.7, grip: 0.6, maxClimbDeg: 30, impact: 0.8 },
  eau: { speed: 0.6, grip: 0.6, maxClimbDeg: 30, impact: 0.3 },
};

/** Détails d'un point du monde (pour l'affichage, la flore, les sols). */
export interface GeoSample {
  height: number;
  biome: BiomeId;
  valley: number;
  east: number;
  south: number;
  west: number;
  matobo: number;
  border: number;
  /** 1 dans le lit d'un fleuve ou d'un lac. */
  river: number;
  /** Proximité d'une rive (forêt riveraine, berges). */
  bank: number;
  wetland: number;
  /** 1 sur un kopje (affleurement de granit). */
  kopje: number;
  forest: number;
}

const INV_WARP = 1 / 3000;
const INV_HILLS = 1 / 700;
const INV_PANS = 1 / 900;
const INV_RIDGES = 1 / 1300;
const INV_MOUNTAIN = 1 / 2600;
const INV_CLIFFS = 1 / 260;
const INV_WET = 1 / 1100;
const INV_FOREST = 1 / 600;
const INV_DETAIL = 1 / 23;
const INV_MEANDER_Z = 1 / 2600;
const INV_MEANDER_L = 1 / 2200;
const INV_WIDTH = 1 / 1900;
const INV_LAKE_EDGE = 1 / 700;
const INV_BORDER = 1 / 900;
export const KOPJE_CELL = 260;
const D = Math.SQRT1_2;
/** Huit directions possibles du côté en pente douce d'un kopje. */
const GENTLE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [D, D],
  [0, 1],
  [-D, D],
  [-1, 0],
  [-D, -D],
  [0, -1],
  [D, -D],
];

/** Grandes lignes du monde, utilisées aussi pour les outils de test (téléportation). */
export const LANDMARKS = {
  zambeziZ: 6200,
  lake: { x: -2400, z: 5900, rx: 2700, rz: 1150 },
  limpopoZ: -7050,
  matobo: { x: -4300, z: -3400, rx: 3000, rz: 2600 },
} as const;

export class Geography {
  private readonly warpA: Simplex2;
  private readonly warpB: Simplex2;
  private readonly hills: Simplex2;
  private readonly pans: Simplex2;
  private readonly ridges: Simplex2;
  private readonly mountain: Simplex2;
  private readonly cliffs: Simplex2;
  private readonly wet: Simplex2;
  private readonly forestN: Simplex2;
  private readonly detail: Simplex2;
  private readonly meanderA: Simplex2;
  private readonly meanderB: Simplex2;
  private readonly meanderC: Simplex2;
  private readonly borderN: Simplex2;
  private readonly s: GeoSample = {
    height: 0,
    biome: 'plateau',
    valley: 0,
    east: 0,
    south: 0,
    west: 0,
    matobo: 0,
    border: 0,
    river: 0,
    bank: 0,
    wetland: 0,
    kopje: 0,
    forest: 0,
  };

  constructor(readonly seed: number) {
    const n = (k: number) => new Simplex2(hash32(seed, k, 0x9e0));
    this.warpA = n(1);
    this.warpB = n(2);
    this.hills = n(3);
    this.pans = n(4);
    this.ridges = n(5);
    this.mountain = n(6);
    this.cliffs = n(7);
    this.wet = n(8);
    this.forestN = n(9);
    this.detail = n(10);
    this.meanderA = n(11);
    this.meanderB = n(12);
    this.meanderC = n(13);
    this.borderN = n(14);
  }

  /** Densité de kopjes d'une cellule, d'après les grandes régions (sans déformation). */
  private kopjeDensity(cx: number, cz: number): number {
    const x = (cx + 0.5) * KOPJE_CELL;
    const z = (cz + 0.5) * KOPJE_CELL;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > WORLD_HALF - 900) return 0;
    if (Math.abs(z - LANDMARKS.zambeziZ) < 900) return 0;
    const lx = (x - LANDMARKS.lake.x) / (LANDMARKS.lake.rx + 600);
    const lz = (z - LANDMARKS.lake.z) / (LANDMARKS.lake.rz + 600);
    if (lx * lx + lz * lz < 1) return 0;
    const mx = (x - LANDMARKS.matobo.x) / LANDMARKS.matobo.rx;
    const mz = (z - LANDMARKS.matobo.z) / LANDMARKS.matobo.rz;
    const matobo = 1 - smoothstep(0.55, 1, Math.sqrt(mx * mx + mz * mz));
    const valley = smoothstep(3700, 5000, z);
    const east = smoothstep(4300, 6300, x);
    const south = smoothstep(-3700, -5300, z);
    const west = smoothstep(-4300, -6100, x);
    let d = 0.1;
    d = lerp(d, 0.02, west);
    d = lerp(d, 0.06, south);
    d = lerp(d, 0.12, east);
    d = lerp(d, 0, valley);
    d = lerp(d, 0.85, matobo);
    return d;
  }

  /**
   * Calcule l'altitude. Si `full`, remplit aussi les détails (biome, masques) dans le
   * tampon interne `this.s` (pas d'allocation : appelé des centaines de milliers de fois).
   */
  private evaluate(x: number, z: number, full: boolean): number {
    const wx = x + 900 * this.warpA.fbm(x * INV_WARP, z * INV_WARP, 2);
    const wz = z + 900 * this.warpB.fbm(x * INV_WARP, z * INV_WARP, 2);
    const valley = smoothstep(3700, 5000, wz);
    const east = smoothstep(4300, 6300, wx);
    const south = smoothstep(-3700, -5300, wz);
    const west = smoothstep(-4300, -6100, wx);
    const mdx = (wx - LANDMARKS.matobo.x) / LANDMARKS.matobo.rx;
    const mdz = (wz - LANDMARKS.matobo.z) / LANDMARKS.matobo.rz;
    const matobo = 1 - smoothstep(0.55, 1, Math.sqrt(mdx * mdx + mdz * mdz));
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const border = smoothstep(WORLD_HALF - 700, WORLD_HALF - 150, edge);

    // Haut plateau (Highveld), légèrement vallonné.
    const rolling = this.hills.fbm(x * INV_HILLS, z * INV_HILLS, 4);
    let h = 150 + rolling * 14;

    // Kalahari : plateau sableux plus bas et plat, avec des cuvettes sèches.
    if (west > 0) {
      const pans = this.pans.fbm(x * INV_PANS, z * INV_PANS, 2);
      const kal = 104 + rolling * 4 - Math.max(0, pans - 0.35) * 30;
      h = lerp(h, kal, west);
    }
    // Lowveld : bas et chaud, descend vers le Limpopo.
    if (south > 0) {
      const low = 30 + rolling * 6 - 24 * smoothstep(-5600, -7000, z);
      h = lerp(h, low, south * (1 - 0.6 * east));
    }
    // Vallée du Zambèze, séparée du plateau par un escarpement abrupt.
    if (valley > 0) {
      const vs = valley * valley * (3 - 2 * valley);
      h = lerp(h, 12 + rolling * 5, vs);
      const escarp = 1 - Math.abs(valley * 2 - 1);
      if (escarp > 0) h += escarp * escarp * this.cliffs.ridged(x * INV_CLIFFS, z * INV_CLIFFS, 3) * 28;
    }
    // Collines de granit : socle un peu plus haut.
    h += matobo * 12;
    // Hautes terres de l'Est : montagnes.
    if (east > 0) {
      const r = this.ridges.ridged(x * INV_RIDGES, z * INV_RIDGES, 4);
      const m = this.mountain.fbm(x * INV_MOUNTAIN, z * INV_MOUNTAIN, 2);
      h += (r * r * 330 + (m + 1) * 50) * east;
    }

    // Kopjes : affleurements de granit en dôme, aux flancs raides.
    let kh = 0;
    let rock = 0;
    const gx = Math.floor(x / KOPJE_CELL);
    const gz = Math.floor(z / KOPJE_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx;
        const cz = gz + dz;
        const hsh = hash32(this.seed, cx, cz, 0x6b6f70);
        if ((hsh & 0xffff) / 65536 >= this.kopjeDensity(cx, cz)) continue;
        const kx = (cx + 0.2 + (((hsh >>> 16) & 0xff) / 256) * 0.6) * KOPJE_CELL;
        const kz = (cz + 0.2 + (((hsh >>> 24) & 0xff) / 256) * 0.6) * KOPJE_CELL;
        const h2 = hash32(this.seed, cx, cz, 0x6b6f71);
        const radius = 35 + ((h2 & 0xff) / 255) * 85;
        // Hauteur limitée par la largeur : pas d'aiguille impossible.
        const height = Math.min(14 + (((h2 >>> 8) & 0xff) / 255) * 50, radius * 0.9);
        const elong = 0.7 + (((h2 >>> 16) & 0xff) / 255) * 0.6;
        const ox = x - kx;
        const oz = z - kz;
        // Chaque kopje a un côté en pente douce (on y monte à pied, comme sur les dômes de
        // granit des Matobo) ; les autres côtés restent raides, pour l'escalade.
        const g = GENTLE_DIRS[(h2 >>> 24) & 7]!;
        const dist = Math.sqrt(ox * ox + oz * oz);
        const cosA = dist > 1e-6 ? (ox * g[0] + oz * g[1]) / dist : 0;
        const stretch = 1 + (Math.min(3, 250 / radius) - 1) * smoothstep(0.3, 0.95, cosA);
        const ux = ox / (radius * stretch);
        const uz = oz / (radius * elong * stretch);
        const t2 = ux * ux + uz * uz;
        if (t2 >= 1) continue;
        const prof = smoothstep(1, 0.45, Math.sqrt(t2));
        const v = height * prof * (1 - 0.25 * t2);
        if (v > kh) kh = v;
        if (prof > rock) rock = prof;
      }
    }
    h += kh;

    // Zones humides (vleis) du plateau : légères cuvettes boueuses.
    let wetland = 0;
    const plateauness = (1 - valley) * (1 - south) * (1 - west) * (1 - east) * (1 - matobo * 0.7);
    if (plateauness > 0.05) {
      wetland = smoothstep(0.38, 0.6, this.wet.fbm(x * INV_WET, z * INV_WET, 2)) * plateauness;
      h -= wetland * 5;
    }

    // Fleuves et lac, creusés sous le niveau de l'eau.
    let river = 0;
    let bank = 0;
    const zrz = LANDMARKS.zambeziZ + 420 * this.meanderA.fbm(x * INV_MEANDER_Z, 3.7, 2);
    const dZam = Math.abs(z - zrz);
    if (dZam < 700) {
      const w = 70 + 30 * this.meanderB.noise(x * INV_WIDTH, 9.1);
      const r = smoothstep(w * 2.4, w * 0.7, dZam);
      if (r > 0) h = lerp(h, Math.min(h, -6.5 + 4 * (dZam / w) * (dZam / w)), r);
      river = Math.max(river, r);
      bank = Math.max(bank, smoothstep(w * 6, w * 1.2, dZam));
    }
    const lk = LANDMARKS.lake;
    const lx = (x - lk.x) / lk.rx;
    const lz = (z - lk.z) / lk.rz;
    const ld = Math.sqrt(lx * lx + lz * lz) + 0.12 * this.warpA.noise(x * INV_LAKE_EDGE, z * INV_LAKE_EDGE);
    if (ld < 1.3) {
      const lake = smoothstep(1, 0.75, ld);
      if (lake > 0) h = lerp(h, Math.min(h, -15 + 12 * ld * ld), lake);
      river = Math.max(river, lake);
      bank = Math.max(bank, smoothstep(1.3, 0.9, ld));
    }
    const lrz = LANDMARKS.limpopoZ + 250 * this.meanderC.fbm(x * INV_MEANDER_L, 1.3, 2);
    const dLim = Math.abs(z - lrz);
    if (dLim < 600) {
      const w = 65 + 15 * this.meanderB.noise(x * INV_WIDTH, 4.2);
      const r = smoothstep(w * 2.2, w * 0.7, dLim);
      if (r > 0) h = lerp(h, Math.min(h, -4 + 3 * (dLim / w) * (dLim / w)), r);
      river = Math.max(river, r);
      bank = Math.max(bank, smoothstep(w * 5, w * 1.2, dLim));
    }

    // Montagnes frontalières : le monde est fermé par des reliefs infranchissables.
    if (border > 0) {
      const top = 230 + 170 * this.borderN.ridged(x * INV_BORDER, z * INV_BORDER, 3);
      h = lerp(h, Math.max(h, top), border);
    }

    h += this.detail.noise(x * INV_DETAIL, z * INV_DETAIL) * 0.45;

    if (full) {
      const s = this.s;
      s.height = h;
      s.valley = valley;
      s.east = east;
      s.south = south;
      s.west = west;
      s.matobo = matobo;
      s.border = border;
      s.river = river;
      s.bank = bank;
      s.wetland = wetland;
      s.kopje = rock;
      s.forest = smoothstep(-0.1, 0.45, this.forestN.fbm(x * INV_FOREST, z * INV_FOREST, 3));
      s.biome = this.classify(s);
    }
    return h;
  }

  private classify(s: GeoSample): BiomeId {
    if (s.border > 0.5) return 'frontiere';
    if (s.river > 0.15 || (s.bank > 0.6 && s.height < 6)) return 'fleuve';
    if (s.east > 0.55) return 'hautes_terres';
    if (s.valley > 0.6) return 'vallee';
    if (s.valley > 0.18 && s.south < 0.5) return 'escarpement';
    if (s.south > 0.55) return 'lowveld';
    if (s.west > 0.55) return 'kalahari';
    if (s.matobo > 0.5 || s.kopje > 0.3) return 'matobo';
    if (s.wetland > 0.35) return 'vlei';
    return s.forest > 0.55 ? 'miombo' : 'plateau';
  }

  heightAt(x: number, z: number): number {
    return this.evaluate(x, z, false);
  }

  /** Détails complets d'un point (nouvel objet). */
  sample(x: number, z: number): GeoSample {
    this.evaluate(x, z, true);
    return { ...this.s };
  }

  /** Détails complets dans le tampon interne (valable jusqu'au prochain appel). */
  sampleInto(x: number, z: number): Readonly<GeoSample> {
    this.evaluate(x, z, true);
    return this.s;
  }

  /** Courant de l'eau (m/s) : le Zambèze et le Limpopo coulent vers l'est. */
  currentAt(x: number, z: number): { x: number; z: number } {
    const zrz = LANDMARKS.zambeziZ + 420 * this.meanderA.fbm(x * INV_MEANDER_Z, 3.7, 2);
    const dZam = Math.abs(z - zrz);
    const w = 70 + 30 * this.meanderB.noise(x * INV_WIDTH, 9.1);
    let cx = 0.75 * smoothstep(w * 1.2, w * 0.2, dZam);
    const lrz = LANDMARKS.limpopoZ + 250 * this.meanderC.fbm(x * INV_MEANDER_L, 1.3, 2);
    const dLim = Math.abs(z - lrz);
    cx += 0.4 * smoothstep(70, 15, dLim);
    // Pas de courant dans le lac.
    const lk = LANDMARKS.lake;
    const lx = (x - lk.x) / lk.rx;
    const lz = (z - lk.z) / lk.rz;
    if (lx * lx + lz * lz < 1) cx *= 0.15;
    return { x: cx, z: 0 };
  }
}

/** Sol d'un point, d'après ses détails et la pente (ny = composante verticale de la normale). */
export function surfaceOf(s: Readonly<GeoSample>, ny: number): SurfaceId {
  if (s.height < WATER_LEVEL - 0.3) return 'eau';
  if (ny < 0.72) return s.kopje > 0.3 ? 'granite' : 'roche';
  if (s.kopje > 0.6) return 'granite';
  if (s.biome === 'frontiere') return 'roche';
  if (s.biome === 'hautes_terres' && s.height > 470) return 'neige';
  if (s.bank > 0.5 && s.height < 2.5) return s.south > 0.5 || s.west > 0.5 ? 'sable' : 'boue';
  if (s.biome === 'vlei') return 'boue';
  if (s.biome === 'kalahari') return 'sable';
  if (s.biome === 'lowveld' || s.biome === 'vallee' || s.biome === 'escarpement') return 'terre';
  return 'herbe';
}
