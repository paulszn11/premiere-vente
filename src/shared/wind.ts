// Vent et vagues (complément de la phase 7, avant la météo de la phase 9). Le vent change lentement
// de force et de direction au fil du temps du monde ; il lève des vagues sur l'eau profonde, qui font
// danser les bateaux, et il les pousse (dérive). Les mêmes fonctions servent à la simulation (flottaison)
// et à l'affichage (surface de l'eau). La phase 9 (météo) pourra piloter windAt.

export interface Wind {
  /** Direction vers laquelle souffle le vent (cap, radians : 0 = +z, π/2 = +x). */
  dir: number;
  /** Vitesse (m/s). */
  speed: number;
}

/** Bruit lisse dans [0, 1] le long du temps (somme de sinusoïdes de périodes premières entre elles). */
function smooth(t: number, seed: number): number {
  const a = Math.sin(t * 0.0071 + seed * 1.37) * 0.5;
  const b = Math.sin(t * 0.0029 + seed * 2.11) * 0.35;
  const c = Math.sin(t * 0.0173 + seed * 0.53) * 0.15;
  return 0.5 + (a + b + c) * 0.5;
}

/** Vent à l'instant t (temps du monde, s) : de 1 à 8 m/s, direction qui tourne lentement autour d'un vent dominant d'est. */
export function windAt(t: number, seed: number): Wind {
  const s = (seed % 997) + 1;
  const speed = 1 + 7 * smooth(t, s) ** 1.6;
  const dir = -Math.PI / 2 + 0.9 * (smooth(t * 0.5, s + 7) - 0.5) * 2;
  return { dir, speed };
}

/** Hauteur maximale des vagues (m) pour un vent donné, sur une eau assez profonde. */
export function waveAmplitude(w: Wind): number {
  return Math.min(0.32, 0.005 * w.speed * w.speed);
}

const WAVES: Array<{ len: number; turn: number; share: number; phase: number }> = [
  { len: 7.3, turn: 0, share: 0.5, phase: 0 },
  { len: 4.4, turn: 0.55, share: 0.3, phase: 1.7 },
  { len: 2.9, turn: -0.6, share: 0.2, phase: 4.1 },
];

/**
 * Élévation de la surface (m) au point (x, z) : trois houles dans le sens du vent (dispersion en eau
 * profonde, ω = √(g·k)). depthFactor : 0 près du bord ou en eau peu profonde, 1 au large.
 */
export function waveHeight(x: number, z: number, t: number, w: Wind, depthFactor = 1): number {
  if (depthFactor <= 0) return 0;
  const a = waveAmplitude(w) * depthFactor;
  if (a <= 0.001) return 0;
  let h = 0;
  for (const wv of WAVES) {
    const k = (2 * Math.PI) / wv.len;
    const om = Math.sqrt(9.81 * k);
    const d = w.dir + wv.turn;
    h += wv.share * Math.sin(k * (Math.sin(d) * x + Math.cos(d) * z) - om * t + wv.phase);
  }
  return a * h;
}

/** Les vagues ne se forment que sur une eau assez profonde (pas sur le bord). */
export function waveDepthFactor(depth: number): number {
  return Math.max(0, Math.min(1, (depth - 0.4) / 1.6));
}
