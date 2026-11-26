// Production server: serves the built game (dist/), the profile API and the multiplayer socket
// from one port.   npm run build && npm start      (PORT=3000 by default)
// `npm run dev` / `npm run preview` also run the API and multiplayer (see server/vite-plugin.js).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { apiMiddleware } from './profiles.js';
import { attachMultiplayer } from './net.js';

const ROOT = path.resolve(process.cwd(), 'dist');
const PORT = +(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary',
};

// text and the mannequin GLB shrink a lot under gzip; images, audio and FBX (already compressed) don't
const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg', '.ttf', '.glb']);
const gzCache = new Map();   // file -> { etag, body }

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first (or use `npm run dev`).');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  apiMiddleware(req, res, () => {
    let p;
    try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.statusCode = 400; return res.end(); }
    let file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      else if (err) file = path.join(ROOT, 'index.html');    // single page: unknown paths get the game
      fs.stat(file, (se, fst) => {
        if (se || !fst.isFile()) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
        // hashed build assets can be cached for good; everything else revalidates, and an unchanged
        // file answers 304 so returning players don't download the models / textures / audio again
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        const etag = `"${fst.size.toString(36)}-${Math.floor(fst.mtimeMs).toString(36)}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', fst.mtime.toUTCString());
        const inm = req.headers['if-none-match'], ims = req.headers['if-modified-since'];
        if (inm ? inm.split(/\s*,\s*/).includes(etag) : ims && Math.floor(fst.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000)) {
          res.statusCode = 304; return res.end();
        }
        if (GZIP.has(path.extname(file).toLowerCase())) {
          res.setHeader('Vary', 'Accept-Encoding');
          if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
            let gz = gzCache.get(file);
            if (!gz || gz.etag !== etag) {
              try { gz = { etag, body: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) }; } catch { res.statusCode = 500; return res.end(); }
              gzCache.set(file, gz);
            }
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', gz.body.length);
            return res.end(req.method === 'HEAD' ? undefined : gz.body);
          }
        }
        res.setHeader('Content-Length', fst.size);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
      });
    });
  });
});
attachMultiplayer(server);
server.listen(PORT, HOST, () => console.log(`[qrumper] serving dist/ on http://${HOST}:${PORT}`));
