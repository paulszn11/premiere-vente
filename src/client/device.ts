// Détection de l'appareil pour choisir une qualité de départ adaptée.
// Ce n'est qu'un point de départ : la résolution adaptative et le test de performance
// sur l'appareil réel permettent ensuite d'ajuster.

import type { QualityPreset } from './settings';

export interface DeviceInfo {
  mobile: boolean;
  touch: boolean;
  cores: number;
  memoryGb: number | null;
  dpr: number;
  gpu: string;
  softwareRenderer: boolean;
  screen: string;
}

/** Nom du processeur graphique, lu via un contexte WebGL temporaire. */
export function detectGpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'inconnu (WebGL indisponible)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return 'inconnu';
  }
}

export function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // « Tactile » = le tactile est le moyen principal (téléphone, tablette). Un ordinateur portable
  // à écran tactile garde la souris et le clavier comme commandes principales.
  const touch = matchMedia('(pointer: coarse)').matches || (mobile && navigator.maxTouchPoints > 0);
  const gpu = detectGpuName();
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    mobile,
    touch,
    cores: navigator.hardwareConcurrency || 2,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    dpr: window.devicePixelRatio || 1,
    gpu,
    softwareRenderer: /SwiftShader|llvmpipe|softpipe|Basic Render|Software/i.test(gpu),
    screen: `${screen.width}×${screen.height}`,
  };
}

export function suggestPreset(d: DeviceInfo): QualityPreset {
  if (d.softwareRenderer) return 'low';
  if (d.mobile) {
    if ((d.memoryGb !== null && d.memoryGb <= 3) || d.cores <= 4) return 'low';
    return 'medium';
  }
  if (/NVIDIA|GeForce|RTX|Radeon|AMD|Apple M\d|Apple GPU/i.test(d.gpu)) return 'high';
  return 'medium';
}
