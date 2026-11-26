// Runs the profile API and the multiplayer socket inside Vite's own server, so `npm run dev` and
// `npm run preview` give the full game (rooms included) on one port. The server modules are loaded
// with Node's own import (not bundled into the Vite config), so they behave exactly as in production.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (f) => import(pathToFileURL(path.resolve(process.cwd(), 'server', f)).href);

export function qrumperServer() {
  const setup = async (server) => {
    const [{ apiMiddleware }, { attachMultiplayer }] = await Promise.all([load('profiles.js'), load('net.js')]);
    server.middlewares.use(apiMiddleware);
    if (server.httpServer) attachMultiplayer(server.httpServer);
  };
  return {
    name: 'qrumper-server',
    configureServer: setup,
    configurePreviewServer: setup,
  };
}
