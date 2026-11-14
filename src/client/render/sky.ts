// Ambiance lumineuse (phase 9) : couleur du ciel et du brouillard, soleil ou lune, lumière du ciel,
// selon l'heure, la lune, la météo et le fait d'être sous terre. Pur calcul : appliqué par WorldView.

import { daylight, moonlight, sunDirection, sunElevation } from '../../shared/daynight';

export interface WeatherLook {
  /** Couverture nuageuse (0 à 1). */
  cloud: number;
  /** Pluie (0 à 1). */
  rain: number;
  /** Brouillard (0 à 1). */
  fog: number;
  /** Éclair en cours (0 à 1, décroît en une fraction de seconde). */
  flash: number;
}

export const CLEAR_WEATHER: WeatherLook = { cloud: 0, rain: 0, fog: 0, flash: 0 };

export interface Ambience {
  hour: number;
  /** Lumière du jour (0 à 1). */
  day: number;
  /** Couleur du ciel et du brouillard. */
  sky: [number, number, number];
  /** Direction de la lumière principale (vers le bas : soleil, ou lune la nuit). */
  lightDir: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
  hemiIntensity: number;
  hemiColor: [number, number, number];
  hemiGround: [number, number, number];
  /** Distance de brouillard relative (1 : normale ; plus petit : on voit moins loin). */
  fogScale: number;
  /** Sous terre : obscurité (0 à 1). */
  underground: number;
}

const DAY_SKY: [number, number, number] = [0.62, 0.74, 0.86];
const DUSK_SKY: [number, number, number] = [0.86, 0.56, 0.4];
const NIGHT_SKY: [number, number, number] = [0.02, 0.03, 0.065];
const GREY_SKY: [number, number, number] = [0.5, 0.53, 0.56];

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Ambiance pour une heure, une clarté de lune, une météo et un degré « sous terre » (0 à 1). */
export function ambienceAt(hour: number, time: number, w: WeatherLook = CLEAR_WEATHER, underground = 0): Ambience {
  const day = daylight(hour);
  const elev = sunElevation(hour);
  const moon = moonlight(time) * (1 - w.cloud * 0.8);
  // Ciel : nuit → aube/crépuscule (soleil bas) → jour ; gris sous les nuages ; sombre sous la pluie.
  const low = Math.max(0, 1 - Math.abs(elev) / 0.22) * (1 - w.cloud * 0.7);
  let sky = mix(NIGHT_SKY, DAY_SKY, day);
  sky = mix(sky, DUSK_SKY, low * 0.75 * Math.min(1, day * 3 + 0.2));
  const greyBright = 0.25 + 0.75 * day;
  sky = mix(sky, [GREY_SKY[0] * greyBright, GREY_SKY[1] * greyBright, GREY_SKY[2] * greyBright], w.cloud * 0.85);
  sky = mix(sky, [sky[0] * 0.55, sky[1] * 0.58, sky[2] * 0.62], w.rain * 0.6);
  // Nuit claire de pleine lune : un ciel un peu moins noir.
  if (day < 0.5) sky = mix(sky, [0.05, 0.07, 0.12], moon * (1 - day * 2) * 0.6);
  // Éclair : tout s'illumine un instant.
  if (w.flash > 0) sky = mix(sky, [0.85, 0.88, 0.95], w.flash * 0.8);

  // Lumière principale : soleil le jour, lune la nuit.
  const sun = sunDirection(hour);
  const useMoon = day < 0.08;
  const dir = useMoon ? { x: -sun.x * 0.6, y: Math.max(0.5, -sun.y), z: 0.3 } : sun;
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const lightDir: [number, number, number] = [-dir.x / dl, -Math.abs(dir.y) / dl, -dir.z / dl];
  const warm = Math.max(0, 1 - Math.max(0, elev) / 0.35);
  const lightColor: [number, number, number] = useMoon ? [0.55, 0.65, 0.95] : [1, 1 - 0.28 * warm, 1 - 0.5 * warm];
  let lightIntensity = useMoon ? 0.16 * moon : 0.55 * day * (1 - 0.65 * w.cloud) * (1 - 0.3 * w.rain);
  let hemiIntensity = 0.8 * day * (1 - 0.25 * w.cloud) + 0.14 * moon * (1 - day) + 0.04;
  let hemiColor: [number, number, number] = mix([0.55, 0.62, 0.85], [1, 1, 1], day);
  let hemiGround: [number, number, number] = mix([0.06, 0.06, 0.08], [0.35, 0.32, 0.28], day);
  if (w.flash > 0) {
    hemiIntensity += 1.2 * w.flash;
    hemiColor = mix(hemiColor, [0.9, 0.92, 1], w.flash);
  }
  // Brouillard : le temps de pluie et la brume réduisent la vue.
  let fogScale = 1 - 0.75 * w.fog - 0.35 * w.rain;
  // Sous terre : noir, sauf ce qu'éclairent la torche et les feux.
  const u = Math.max(0, Math.min(1, underground));
  if (u > 0) {
    sky = mix(sky, [0, 0, 0], u);
    lightIntensity *= 1 - u;
    hemiIntensity = hemiIntensity * (1 - u) + 0.015 * u;
    hemiGround = mix(hemiGround, [0, 0, 0], u);
    fogScale = fogScale * (1 - u) + 0.35 * u;
  }
  return { hour, day, sky, lightDir, lightColor, lightIntensity, hemiIntensity, hemiColor, hemiGround, fogScale: Math.max(0.12, fogScale), underground: u };
}
