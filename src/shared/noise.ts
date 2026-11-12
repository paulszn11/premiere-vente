// Bruit simplex 2D avec graine (d'après l'algorithme public de Stefan Gustavson).
// Volontairement sans sin/cos/pow/exp : seules les opérations + - * / floor sqrt
// sont utilisées, car elles donnent des résultats identiques au bit près sur tous
// les moteurs JavaScript (Chrome, Safari, Firefox, Node).

import { mulberry32 } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float64Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 1, -1]);

export class Simplex2 {
  private readonly perm = new Uint8Array(512);
  private readonly permMod8 = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rand = mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]!;
      this.permMod8[i] = this.perm[i]! & 7;
    }
  }

  /** Valeur dans [-1, 1] environ. */
  noise(x: number, y: number): number {
    const perm = this.perm;
    const pm = this.permMod8;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm[ii + perm[jj]!]!;
      t0 *= t0;
      n += t0 * t0 * (GX[g]! * x0 + GY[g]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pm[ii + i1 + perm[jj + j1]!]!;
      t1 *= t1;
      n += t1 * t1 * (GX[g]! * x1 + GY[g]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm[ii + 1 + perm[jj + 1]!]!;
      t2 *= t2;
      n += t2 * t2 * (GX[g]! * x2 + GY[g]! * y2);
    }
    return 70 * n;
  }

  /** Somme fractale (fBm) normalisée dans [-1, 1] environ. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /** Bruit « crêtes » dans [0, 1] : utile pour les chaînes de montagnes. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let v = 1 - Math.abs(this.noise(x * freq, y * freq));
      v *= v;
      v *= weight;
      weight = v < 0 ? 0 : v > 1 ? 1 : v;
      sum += v * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
