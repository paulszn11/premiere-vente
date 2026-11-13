// Réglages individuels du joueur, conservés dans le navigateur.

import { type Bindings, defaultBindings, normalizeBindings } from './input/bindings';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type QualityMode = 'auto' | QualityPreset;
export type BackendChoice = 'auto' | 'webgl2' | 'webgpu';

export interface QualityParams {
  /** Plafond du rapport de pixels de l'écran (netteté). */
  maxPixelRatio: number;
  /** Rayon de terrain affiché, en chunks de 64 m. */
  viewChunks: number;
  /** Cellules par côté pour les chunks les plus proches (détail du relief). */
  nearCells: number;
  /** Rayon d'affichage des arbres, en chunks (au moins 1 : les arbres proches ont une collision). */
  vegetationChunks: number;
  /** Anticrénelage (appliqué au prochain démarrage). */
  antialias: boolean;
}

export const PRESETS: Record<QualityPreset, QualityParams> = {
  low: { maxPixelRatio: 1, viewChunks: 2, nearCells: 32, vegetationChunks: 1, antialias: false },
  medium: { maxPixelRatio: 1.5, viewChunks: 3, nearCells: 32, vegetationChunks: 2, antialias: false },
  high: { maxPixelRatio: 2, viewChunks: 5, nearCells: 64, vegetationChunks: 3, antialias: true },
  ultra: { maxPixelRatio: 3, viewChunks: 7, nearCells: 64, vegetationChunks: 4, antialias: true },
};

export const PRESET_ORDER: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
export const PRESET_LABELS: Record<QualityPreset, string> = { low: 'Basse', medium: 'Moyenne', high: 'Haute', ultra: 'Ultra' };

export interface Settings {
  version: 1;
  quality: QualityMode;
  backend: BackendChoice;
  /** Échelle de résolution choisie par le joueur (0,5 à 1). */
  renderScale: number;
  /** Baisse automatiquement la résolution si les images par seconde chutent. */
  adaptiveResolution: boolean;
  /** Distance d'affichage imposée (en chunks), ou null pour suivre la qualité. */
  viewChunks: number | null;
  /** Champ de vision vertical, en degrés. */
  fov: number;
  mouseSensitivity: number;
  touchSensitivity: number;
  gamepadSensitivity: number;
  invertY: boolean;
  showPerf: boolean;
  bindings: Bindings;
  /** Graine du monde local (un seul monde en solo ; sauvegardes complètes en phase 8). */
  worldSeed: number | null;
  /** Graine du point d'apparition du joueur dans ce monde (au hasard, loin des autres en multijoueur). */
  spawnSeed: number | null;
  /** Volume des sons (0 à 1). */
  volume: number;
  /** Créatures (désactivables seulement pour les tests automatiques des autres phases ; pas dans le panneau). */
  fauna: boolean;
}

const STORAGE_KEY = 'baz.settings.v1';

export function defaultSettings(): Settings {
  return {
    version: 1,
    quality: 'auto',
    backend: 'auto',
    renderScale: 1,
    adaptiveResolution: true,
    viewChunks: null,
    fov: 70,
    mouseSensitivity: 1,
    touchSensitivity: 1,
    gamepadSensitivity: 1,
    invertY: false,
    showPerf: false,
    bindings: defaultBindings(),
    worldSeed: null,
    spawnSeed: null,
    volume: 0.8,
    fauna: true,
  };
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Vérifie des réglages lus depuis le stockage ; toute valeur invalide reprend sa valeur par défaut. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const quality = (['auto', ...PRESET_ORDER] as string[]).includes(r.quality as string) ? (r.quality as QualityMode) : d.quality;
  const backend = (['auto', 'webgl2', 'webgpu'] as string[]).includes(r.backend as string) ? (r.backend as BackendChoice) : d.backend;
  const viewChunks = r.viewChunks === null || r.viewChunks === undefined ? null : Math.round(num(r.viewChunks, 1, 10, 3));
  const validSeed = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);
  const seed = validSeed(r.worldSeed);
  return {
    version: 1,
    quality,
    backend,
    renderScale: num(r.renderScale, 0.5, 1, d.renderScale),
    adaptiveResolution: typeof r.adaptiveResolution === 'boolean' ? r.adaptiveResolution : d.adaptiveResolution,
    viewChunks,
    fov: num(r.fov, 50, 100, d.fov),
    mouseSensitivity: num(r.mouseSensitivity, 0.1, 5, d.mouseSensitivity),
    touchSensitivity: num(r.touchSensitivity, 0.1, 5, d.touchSensitivity),
    gamepadSensitivity: num(r.gamepadSensitivity, 0.1, 5, d.gamepadSensitivity),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    showPerf: typeof r.showPerf === 'boolean' ? r.showPerf : d.showPerf,
    bindings: normalizeBindings(r.bindings),
    worldSeed: seed,
    spawnSeed: validSeed(r.spawnSeed),
    volume: num(r.volume, 0, 1, d.volume),
    fauna: typeof r.fauna === 'boolean' ? r.fauna : d.fauna,
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Stockage indisponible (navigation privée, quota) : les réglages restent valables pour cette session.
  }
}

/** Paramètres effectifs : qualité choisie (ou détectée) + distance d'affichage éventuellement imposée. */
export function effectiveQuality(s: Settings, autoPreset: QualityPreset): { preset: QualityPreset; params: QualityParams } {
  const preset = s.quality === 'auto' ? autoPreset : s.quality;
  const base = PRESETS[preset];
  const params = { ...base };
  if (s.viewChunks !== null) {
    params.viewChunks = s.viewChunks;
    params.vegetationChunks = Math.min(params.vegetationChunks, s.viewChunks);
  }
  params.vegetationChunks = Math.max(1, params.vegetationChunks);
  return { preset, params };
}
