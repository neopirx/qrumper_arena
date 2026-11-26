// Shrink binary FBX models without changing how they look in game:
//   node tools/fbxslim.mjs <model.fbx> ...        (rewrites the files in place)
// - embedded textures are re-encoded as lossless WebP (pixel-exact, verified by tools/webp.py)
// - embedded normal maps are removed: the game's entity material only uses the colour map
// Geometry, skin, materials and everything else are copied byte for byte (tools/fbx.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFbx, writeFbx, propValue, rawProp } from './fbx.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const strProp = (s) => { const b = Buffer.from(s, 'utf8'); const r = Buffer.alloc(5 + b.length); r[0] = 0x53; r.writeUInt32LE(b.length, 1); b.copy(r, 5); return { t: 'S', raw: r }; };

for (const file of process.argv.slice(2)) {
  const before = fs.statSync(file).size;
  const f = readFbx(fs.readFileSync(file));
  const objects = f.nodes.find((n) => n.name === 'Objects');
  const conns = f.nodes.find((n) => n.name === 'Connections');
  const id = (n) => propValue(n.props[0]);
  const link = (c) => ({ kind: propValue(c.props[0]), child: propValue(c.props[1]), parent: propValue(c.props[2]), prop: c.props[3] ? propValue(c.props[3]) : null });

  // normal maps: texture -> material over a "NormalMap" connection, plus the video feeding it
  const drop = new Set();
  for (const c of conns.children.map(link)) if (c.prop === 'NormalMap') drop.add(c.child);
  for (const c of conns.children.map(link)) if (drop.has(c.parent) && objects.children.some((n) => n.name === 'Video' && id(n) === c.child)) drop.add(c.child);
  objects.children = objects.children.filter((n) => !((n.name === 'Texture' || n.name === 'Video') && drop.has(id(n))));
  conns.children = conns.children.filter((c) => { const l = link(c); return !drop.has(l.child) && !drop.has(l.parent); });

  // colour maps: PNG -> lossless WebP
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbxslim-'));
  for (const v of objects.children.filter((n) => n.name === 'Video')) {
    const content = v.children.find((n) => n.name === 'Content');
    const data = content && content.props[0] ? propValue(content.props[0]) : null;
    if (!data || data.subarray(1, 4).toString() !== 'PNG') continue;
    const src = path.join(tmp, 'in.png'), dst = path.join(tmp, 'out.webp');
    fs.writeFileSync(src, data);
    execFileSync('python3', [path.join(here, 'webp.py'), src, dst]);
    content.props[0] = rawProp(fs.readFileSync(dst));
    for (const key of ['RelativeFilename', 'Filename']) {
      const n = v.children.find((x) => x.name === key);
      if (n) n.props[0] = strProp(propValue(n.props[0]).replace(/\.png$/i, '.webp'));
    }
  }
  fs.rmSync(tmp, { recursive: true });
  const out = writeFbx(f);
  readFbx(out);   // sanity: parses back
  fs.writeFileSync(file, out);
  console.log(`${file}: ${(before / 1e6).toFixed(2)} MB -> ${(out.length / 1e6).toFixed(2)} MB${drop.size ? `, removed ${drop.size} normal-map nodes` : ''}`);
}
