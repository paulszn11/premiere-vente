// Test de performance : la caméra suit un parcours fixe dans un monde fixe, pour chaque
// niveau de qualité, et on mesure la fluidité. Le rapport se copie pour être comparé
// entre appareils.

import { GAME_VERSION } from '../../shared/constants';
import type { DeviceInfo } from '../device';
import { BACKEND_LABELS, type ActiveBackend } from '../render/engine';
import { PRESET_LABELS, type QualityPreset } from '../settings';
import type { FrameStats } from './perf-monitor';

/** Monde utilisé pour tous les tests de performance (comparaisons possibles entre appareils). */
export const BENCH_SEED = 20261112;
export const BENCH_WARMUP_S = 1;
export const BENCH_MEASURE_S = 8;
export const BENCH_MAX_LOADING_S = 12;

export interface BenchResult extends FrameStats {
  preset: QualityPreset;
  /** Temps de calcul d'une image côté processeur (médiane et 95e centile), en ms. */
  cpuMedian: number;
  cpuP95: number;
  drawCalls: number;
  chunks: number;
  trees: number;
  vertices: number;
  renderWidth: number;
  renderHeight: number;
  loadingS: number;
}

export interface BenchReport {
  date: string;
  version: string;
  userAgent: string;
  backend: ActiveBackend;
  device: DeviceInfo;
  viewport: string;
  results: BenchResult[];
  cancelled: boolean;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function formatReport(r: BenchReport): string {
  const d = r.device;
  const lines = [
    `Bienvenue au Zimbabwe — test de performance (version ${r.version})`,
    `Date : ${r.date}`,
    `Appareil : ${r.userAgent}`,
    `Écran : ${d.screen} · fenêtre ${r.viewport} · rapport de pixels ${d.dpr}`,
    `Processeurs : ${d.cores} · mémoire : ${d.memoryGb !== null ? `${d.memoryGb} Go` : 'inconnue'} · ${d.mobile ? 'mobile' : 'ordinateur'}${d.touch ? ', tactile' : ''}`,
    `Moteur : ${BACKEND_LABELS[r.backend]} · GPU : ${d.gpu}`,
    '',
    `${pad('Qualité', 9)}${pad('IPS moy.', 10)}${pad('1 % bas', 9)}${pad('ms méd./95 %', 15)}${pad('Calcul ms', 12)}${pad('Résolution', 12)}${pad('Chunks', 8)}${pad('Arbres', 8)}Appels`,
  ];
  for (const x of r.results) {
    lines.push(
      `${pad(PRESET_LABELS[x.preset], 9)}${pad(x.fps.toFixed(1), 10)}${pad(x.fpsLow1.toFixed(1), 9)}${pad(`${x.msMedian.toFixed(1)} / ${x.msP95.toFixed(1)}`, 15)}${pad(`${x.cpuMedian.toFixed(1)} / ${x.cpuP95.toFixed(1)}`, 12)}${pad(`${x.renderWidth}×${x.renderHeight}`, 12)}${pad(String(x.chunks), 8)}${pad(String(x.trees), 8)}${Math.round(x.drawCalls)}`,
    );
  }
  lines.push(
    '',
    'Calcul ms : temps passé par le processeur pour préparer une image (simulation, commandes de dessin).',
    'Le travail de la puce graphique n’y est pas compté : si les IPS baissent alors que ce temps reste faible, c’est elle qui limite.',
  );
  if (r.cancelled) lines.push('', 'Test interrompu avant la fin.');
  if (d.softwareRenderer) lines.push('', 'Attention : rendu logiciel (pas de carte graphique utilisée), chiffres non représentatifs.');
  return lines.join('\n');
}

export function reportMeta(backend: ActiveBackend, device: DeviceInfo): Omit<BenchReport, 'results' | 'cancelled'> {
  return {
    date: new Date().toLocaleString('fr-FR'),
    version: GAME_VERSION,
    userAgent: navigator.userAgent,
    backend,
    device,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  };
}
