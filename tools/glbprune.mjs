// Strip unused animation clips from a GLB (no dependencies).
//   node tools/glbprune.mjs <in.glb> <out.glb> Clip_A Clip_B ...
// Keeps the whole scene (nodes, skin, mesh) and only the named animations; buffer views no longer
// referenced by anything are dropped and the binary chunk is repacked. Data is copied byte for
// byte, so what is kept is unchanged.
import fs from 'node:fs';

const [, , inFile, outFile, ...keep] = process.argv;
if (!inFile || !outFile || !keep.length) { console.error('usage: glbprune.mjs in.glb out.glb Clip ...'); process.exit(1); }
const buf = fs.readFileSync(inFile);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));

const want = new Set(keep);
const missing = keep.filter((k) => !json.animations.some((a) => a.name === k));
if (missing.length) throw new Error('clips not found: ' + missing.join(', '));
json.animations = json.animations.filter((a) => want.has(a.name));

// every accessor still referenced (meshes, skins, kept animations)
const usedAcc = new Set();
const walk = (v, key) => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  else if (typeof v === 'number' && ['indices', 'inverseBindMatrices', 'input', 'output', 'POSITION', 'NORMAL', 'TANGENT', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(key)) usedAcc.add(v);
};
walk(json.meshes); walk(json.skins); walk(json.animations);
if (json.images?.some((i) => i.bufferView != null)) throw new Error('embedded images not handled');

const accMap = new Map(), newAcc = [];
[...usedAcc].sort((a, b) => a - b).forEach((i) => { accMap.set(i, newAcc.length); newAcc.push(json.accessors[i]); });
const remapAcc = (v, key) => {
  if (Array.isArray(v)) return v.map((x) => remapAcc(x, key));
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = remapAcc(v[k], k); return v; }
  if (typeof v === 'number' && ['indices', 'inverseBindMatrices', 'input', 'output', 'POSITION', 'NORMAL', 'TANGENT', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(key)) {
    if (!accMap.has(v)) throw new Error('unmapped accessor ' + v);
    return accMap.get(v);
  }
  return v;
};
remapAcc(json.meshes); remapAcc(json.skins); remapAcc(json.animations);

// repack the buffer views the kept accessors use, 4-byte aligned
const bvMap = new Map(), newBV = [], parts = [];
let off = 0;
for (const a of newAcc) {
  if (a.sparse) throw new Error('sparse accessors not handled');
  if (a.bufferView == null) continue;
  if (!bvMap.has(a.bufferView)) {
    const bv = json.bufferViews[a.bufferView];
    const pad = (4 - (off % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    bvMap.set(a.bufferView, newBV.length);
    newBV.push({ ...bv, buffer: 0, byteOffset: off });
    parts.push(data); off += data.length;
  }
  a.bufferView = bvMap.get(a.bufferView);
}
json.accessors = newAcc;
json.bufferViews = newBV;
json.buffers = [{ byteLength: off }];

const pad4 = (b, fill) => { const p = (4 - (b.length % 4)) % 4; return p ? Buffer.concat([b, Buffer.alloc(p, fill)]) : b; };
const jsonBuf = pad4(Buffer.from(JSON.stringify(json)), 0x20);
const binBuf = pad4(Buffer.concat(parts), 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
fs.writeFileSync(outFile, Buffer.concat([header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(binBuf.length, 0x004e4942), binBuf]));
console.log(`${inFile} ${(buf.length / 1e6).toFixed(2)} MB -> ${outFile} ${(12 + 16 + jsonBuf.length + binBuf.length) / 1e6} MB, ${json.animations.length} clips`);
