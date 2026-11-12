// Création du moteur de rendu Babylon.js : WebGL2 par défaut, WebGPU en option.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';
import type { BackendChoice } from '../settings';

export type ActiveBackend = 'webgl2' | 'webgl1' | 'webgpu';

export interface EngineResult {
  engine: AbstractEngine;
  backend: ActiveBackend;
  /** Raison du repli sur WebGL si WebGPU a été demandé mais n'a pas pu démarrer. */
  fallbackReason?: string;
}

export const BACKEND_LABELS: Record<ActiveBackend, string> = {
  webgl2: 'WebGL 2',
  webgl1: 'WebGL 1',
  webgpu: 'WebGPU',
};

export async function createEngine(canvas: HTMLCanvasElement, choice: BackendChoice, antialias: boolean): Promise<EngineResult> {
  let fallbackReason: string | undefined;
  if (choice === 'webgpu') {
    try {
      // Chargé à la demande : le module WebGPU n'est téléchargé que s'il est choisi.
      const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias,
          adaptToDeviceRatio: false,
          powerPreference: 'high-performance',
          audioEngine: false,
        });
        await engine.initAsync();
        return { engine, backend: 'webgpu' };
      }
      fallbackReason = "WebGPU n'est pas disponible sur cet appareil.";
    } catch (err) {
      fallbackReason = `WebGPU n'a pas pu démarrer (${err instanceof Error ? err.message : String(err)}).`;
    }
  }
  const engine = new Engine(
    canvas,
    antialias,
    {
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      audioEngine: false,
      failIfMajorPerformanceCaveat: false,
    },
    false,
  );
  const backend: ActiveBackend = engine.webGLVersion >= 2 ? 'webgl2' : 'webgl1';
  return fallbackReason ? { engine, backend, fallbackReason } : { engine, backend };
}
