// Météo (phase 9) : calculée à partir de la graine, du temps du monde et du lieu, comme le vent.
// L'hôte et les joueurs obtiennent exactement la même météo sans rien échanger (bruit de Perlin
// déterministe, sans fonctions trigonométriques).
//
// - Des perturbations passent (quelques minutes réelles à un quart d'heure) et couvrent quelques kilomètres.
// - Les hautes terres de l'Est sont pluvieuses et brumeuses ; le Kalahari et le lowveld sont secs.
// - Brouillard au matin dans les zones humides et les vallées ; dans les nuages sur les hauteurs.
// - La neige ne tombe que sur les sommets les plus hauts.

import { hourOf } from './daynight';
import { Simplex2 } from './noise';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

export interface Weather {
  /** Couverture nuageuse (0 à 1). */
  cloud: number;
  /** Pluie (0 à 1 ; 0 quand il neige). */
  rain: number;
  /** Orage (0 à 1) : éclairs, vent fort. */
  storm: number;
  /** Brouillard (0 à 1). */
  fog: number;
  /** Neige (0 à 1). */
  snow: number;
  /** Vent supplémentaire (m/s) dû à la perturbation. */
  gust: number;
}

export const CLEAR: Weather = { cloud: 0, rain: 0, storm: 0, fog: 0, snow: 0, gust: 0 };

/** Climat d'un lieu (ne change pas avec le temps). */
interface Climate {
  /** Humidité de base (−0,6 sec à +0,4 pluvieux). */
  wet: number;
  /** Brume au matin (0 à 1). */
  mist: number;
  height: number;
}

class WeatherField {
  private readonly a: Simplex2;
  private readonly b: Simplex2;
  private readonly c: Simplex2;
  private readonly climate = new Map<string, Climate>();

  constructor(seed: number) {
    this.a = new Simplex2(hash32(seed, 91, 0x77e));
    this.b = new Simplex2(hash32(seed, 92, 0x77e));
    this.c = new Simplex2(hash32(seed, 93, 0x77e));
  }

  /** Climat d'une cellule de 128 m (mis en cache). */
  climateAt(terrain: Terrain, x: number, z: number): Climate {
    const cx = Math.floor(x / 128);
    const cz = Math.floor(z / 128);
    const key = `${cx},${cz}`;
    let c = this.climate.get(key);
    if (!c) {
      const s = terrain.sampleInto((cx + 0.5) * 128, (cz + 0.5) * 128);
      const wet = 0.28 * s.east - 0.42 * s.west - 0.25 * s.south - 0.05 * s.valley + 0.1 * s.wetland;
      const mist = Math.min(1, 0.8 * s.wetland + 0.5 * s.east + 0.35 * s.valley + 0.4 * s.bank);
      c = { wet, mist, height: s.height };
      if (this.climate.size > 4000) this.climate.clear();
      this.climate.set(key, c);
    }
    return c;
  }

  at(terrain: Terrain, time: number, x: number, z: number): Weather {
    const c = this.climateAt(terrain, x, z);
    // Perturbations : deux échelles de temps et d'espace, qui se déplacent lentement vers l'ouest.
    const drift = time * 1.2;
    const h1 = this.a.noise((x + drift) / 4200, time / 900);
    const h2 = this.b.noise(z / 2600 + 17, time / 260);
    const humidity = 0.62 * h1 + 0.38 * h2 + c.wet;
    const cloud = smooth(-0.15, 0.5, humidity);
    let rain = smooth(0.28, 0.75, humidity);
    const stormNoise = this.c.noise((x - drift) / 5200 + 40, time / 420);
    const storm = rain * smooth(0.3, 0.75, stormNoise);
    // Brume du matin (de 4 h 30 à 9 h), et dans les nuages sur les hauteurs.
    const hour = hourOf(time);
    const morning = hour > 4.5 && hour < 9.5 ? 1 - Math.abs(hour - 6.5) / 3 : 0;
    let fog = Math.max(0, morning) * c.mist * (0.6 + 0.4 * cloud);
    if (c.height > 330) fog = Math.max(fog, cloud * smooth(330, 450, c.height) * 0.85);
    fog = Math.max(fog, rain * 0.35);
    // Neige : sur les plus hauts sommets (au-dessus de 450 m, plus bas la nuit).
    const cold = c.height - (hour < 6 || hour > 20 ? 30 : 0);
    let snow = 0;
    if (cold > 440) {
      snow = rain * smooth(440, 480, cold);
      rain -= snow;
    }
    const gust = storm * 11 + cloud * 1.5;
    return { cloud, rain: clamp01(rain), storm: clamp01(storm), fog: clamp01(fog), snow: clamp01(snow), gust };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const fields = new Map<number, WeatherField>();

function field(seed: number): WeatherField {
  let f = fields.get(seed);
  if (!f) {
    f = new WeatherField(seed);
    fields.set(seed, f);
  }
  return f;
}

/** Météo au temps du monde `time` (s), au lieu (x, z). */
export function weatherAt(terrain: Terrain, time: number, x: number, z: number): Weather {
  if (!terrain.floraEnabled) return CLEAR;
  return field(terrain.seed).at(terrain, time, x, z);
}

/** Sol mouillé (0 à 1) : la pluie des trois dernières minutes. */
export function wetnessAt(terrain: Terrain, time: number, x: number, z: number): number {
  let w = 0;
  for (let k = 0; k < 6; k++) {
    const r = weatherAt(terrain, time - k * 36, x, z).rain;
    w = Math.max(w, r * (1 - k * 0.14));
  }
  return w;
}
