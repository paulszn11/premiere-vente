import { defineConfig } from 'vite';

// Client web 3D. Le serveur du monde est empaqueté comme un worker (SharedWorker ou Worker).
export default defineConfig({
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    sourcemap: false,
  },
  server: { host: true },
  preview: { host: true },
});
