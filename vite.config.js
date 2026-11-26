import { defineConfig } from 'vite';
import { qrumperServer } from './server/vite-plugin.js';

// `allowedHosts: true` lets the dev / preview server answer under any domain (a VPS behind a
// reverse proxy); Vite 6+ otherwise rejects unknown Host headers.
export default defineConfig({
  publicDir: 'assets',
  plugins: [qrumperServer()],
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 4173, host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 2000 },
});
