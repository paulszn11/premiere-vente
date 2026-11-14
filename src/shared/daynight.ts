// Cycle jour/nuit (phase 9). L'heure découle du temps du monde (secondes réelles de simulation) :
// l'hôte et les joueurs voient le même ciel sans rien échanger de plus.
//
// Un jour dure 40 minutes réelles, découpées en : aube 2 min (5 h → 7 h, lever du soleil à 6 h),
// jour 26 min (7 h → 17 h), crépuscule 2 min (17 h → 19 h, coucher à 18 h), nuit 10 min (19 h → 5 h).
// Un nouveau monde commence à 7 h. Le monde est dans l'hémisphère sud (vers 18° S) : à midi, le soleil
// passe au nord du zénith.

export const DAY_SECONDS = 2400;
/** Phase (secondes dans le cycle, 0 = 5 h) au début d'un nouveau monde (7 h). */
const START_PHASE = 120;

/** Tranches du cycle : [début (s), fin (s), heure au début, heure à la fin]. */
const SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 120, 5, 7],
  [120, 1680, 7, 17],
  [1680, 1800, 17, 19],
  [1800, 2400, 19, 29],
];

/** Heure du jour (0 à 24, décimale) au temps du monde `time` (secondes). */
export function hourOf(time: number): number {
  const t = Number.isFinite(time) ? time : 0;
  const p = (((t + START_PHASE) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  for (const [a, b, ha, hb] of SEGMENTS) {
    if (p < b) return (ha + ((p - a) / (b - a)) * (hb - ha)) % 24;
  }
  return 5;
}

/** Numéro du jour (le premier jour du monde est le jour 1). */
export function dayOf(time: number): number {
  return Math.floor((Math.max(0, time) + START_PHASE) / DAY_SECONDS) + 1;
}

/** Temps du monde (s) du prochain passage à l'heure `hour` après `time`. */
export function nextTimeAt(time: number, hour: number): number {
  // Recherche par pas d'une seconde réelle suffisante pour les tests et les outils.
  let t = time;
  for (let i = 0; i < DAY_SECONDS + 2; i++, t++) {
    const h0 = hourOf(t);
    const h1 = hourOf(t + 1);
    const crosses = h0 <= h1 ? h0 <= hour && hour < h1 : hour >= h0 || hour < h1;
    if (crosses) return t + 1;
  }
  return time;
}

/** Hauteur du soleil : sinus de l'élévation (−1 à 1), maximal à midi, nul à 6 h et 18 h. */
export function sunElevation(hour: number): number {
  const a = ((hour - 6) / 12) * Math.PI;
  return Math.sin(a) * 0.97;
}

/** Direction vers le soleil (vecteur unitaire, y vers le haut ; x est, z nord). */
export function sunDirection(hour: number): { x: number; y: number; z: number } {
  const a = ((hour - 6) / 12) * Math.PI;
  // Se lève à l'est (+x), passe au nord (+z, hémisphère sud), se couche à l'ouest.
  const x = Math.cos(a);
  const y = Math.sin(a) * 0.97;
  const z = 0.24 + Math.sin(a) * 0.1;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Lumière du jour de 0 (nuit noire) à 1 (plein jour). La lune n'en fait pas partie. */
export function daylight(hour: number): number {
  return smooth(-0.1, 0.28, sunElevation(hour));
}

/** Il fait nuit (le soleil est sous l'horizon). */
export function isNight(hour: number): boolean {
  return sunElevation(hour) < -0.02;
}

/** Lune : clarté nocturne de 0 à 1 selon la phase (cycle de 8 jours de jeu, plus court que la réalité). */
export function moonlight(time: number): number {
  const day = dayOf(time);
  const phase = (day % 8) / 8;
  return 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
}

/** Heure lisible (« 14 h 30 »), pour les outils de test et les documents. */
export function hourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${h} h ${String(m).padStart(2, '0')}`;
}
