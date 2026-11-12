import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig } from 'vite';

const rapierWeb = fileURLToPath(new URL('./src/vendor/rapier-web.js', import.meta.url));

/**
 * Remplace le chargeur WebAssembly de @dimforge/rapier3d : le fichier .wasm est émis comme
 * ressource (avec empreinte dans son nom) et chargé en flux avec WebAssembly.instantiateStreaming.
 */
function rapierWasmFile(): Plugin {
  return {
    name: 'rapier-wasm-file',
    enforce: 'pre',
    load(id) {
      if (!/[\\/]@dimforge[\\/]rapier3d[\\/]rapier_wasm3d\.js$/.test(id.split('?')[0]!)) return null;
      return `import * as bg from "./rapier_wasm3d_bg.js";
export * from "./rapier_wasm3d_bg.js";
import wasmUrl from "./rapier_wasm3d_bg.wasm?url";
let ready = null;
export function __initRapierWasm() {
  if (!ready) {
    ready = (async () => {
      const imports = { "./rapier_wasm3d_bg.js": bg };
      let result;
      try {
        result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
      } catch {
        const res = await fetch(wasmUrl);
        result = await WebAssembly.instantiate(await res.arrayBuffer(), imports);
      }
      bg.__wbg_set_wasm(result.instance.exports);
    })();
  }
  return ready;
}
`;
    },
  };
}

// Client web 3D (phase 1 : jeu solo).
export default defineConfig({
  plugins: [rapierWasmFile()],
  resolve: {
    alias: [{ find: /^@dimforge\/rapier3d-compat$/, replacement: rapierWeb }],
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d', '@dimforge/rapier3d-compat'],
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
    sourcemap: false,
  },
  server: { host: true },
  preview: { host: true },
});
