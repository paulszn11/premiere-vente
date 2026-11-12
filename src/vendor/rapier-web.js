// Rapier pour le navigateur : même interface que @dimforge/rapier3d-compat, mais le moteur
// WebAssembly est servi comme fichier .wasm séparé (≈ 30 % plus léger à télécharger et
// compilé pendant le téléchargement) au lieu d'être intégré en texte base64.
// Activé par un alias dans vite.config.ts ; les tests dans Node utilisent la version compat.
import * as R from '@dimforge/rapier3d/rapier.js';
import { __initRapierWasm } from '@dimforge/rapier3d/rapier_wasm3d.js';

export * from '@dimforge/rapier3d/rapier.js';

export function init() {
  return __initRapierWasm();
}

const RAPIER = Object.assign({}, R, { init });
export default RAPIER;
