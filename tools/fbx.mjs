// Minimal binary FBX reader / writer (no dependencies), enough to edit a file's node tree and
// write it back: node records are re-serialized with fresh offsets, property values are copied
// byte for byte, the footer is kept verbatim.
import zlib from 'node:zlib';

const MAGIC = 'Kaydara FBX Binary  \0';

export function readFbx(buf) {
  if (buf.toString('latin1', 0, 21) !== MAGIC) throw new Error('not a binary FBX');
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;
  let off = 27;
  const readNode = () => {
    const end = wide ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off);
    const nProps = wide ? Number(buf.readBigUInt64LE(off + 8)) : buf.readUInt32LE(off + 4);
    off += wide ? 24 : 12;
    const nameLen = buf[off++];
    if (end === 0) return null;
    const name = buf.toString('latin1', off, off + nameLen);
    off += nameLen;
    const props = [];
    for (let i = 0; i < nProps; i++) {
      const start = off, t = String.fromCharCode(buf[off++]);
      switch (t) {
        case 'Y': off += 2; break;
        case 'C': off += 1; break;
        case 'I': case 'F': off += 4; break;
        case 'D': case 'L': off += 8; break;
        case 'f': case 'd': case 'l': case 'i': case 'b': off += 12 + buf.readUInt32LE(off + 8); break;
        case 'S': case 'R': off += 4 + buf.readUInt32LE(off); break;
        default: throw new Error('unknown property type ' + t);
      }
      props.push({ t, raw: buf.subarray(start, off) });
    }
    const children = [];
    while (off < end) { const c = readNode(); if (!c) break; children.push(c); }
    off = end;
    return { name, props, children };
  };
  const nodes = [];
  for (;;) { const n = readNode(); if (!n) break; nodes.push(n); }
  return { version, wide, header: buf.subarray(0, 27), nodes, footer: buf.subarray(off) };
}

export function writeFbx(f) {
  const parts = [f.header];
  let off = f.header.length;
  const push = (b) => { parts.push(b); off += b.length; };
  const recHead = f.wide ? 25 : 13;
  const nullRec = Buffer.alloc(recHead);
  const writeNode = (n) => {
    const head = Buffer.alloc(recHead + n.name.length);
    const at = parts.length;
    push(head);
    let plen = 0;
    for (const p of n.props) { push(p.raw); plen += p.raw.length; }
    for (const c of n.children) writeNode(c);
    if (n.children.length || !n.props.length) push(nullRec);
    if (f.wide) { head.writeBigUInt64LE(BigInt(off), 0); head.writeBigUInt64LE(BigInt(n.props.length), 8); head.writeBigUInt64LE(BigInt(plen), 16); head[24] = n.name.length; head.write(n.name, 25, 'latin1'); }
    else { head.writeUInt32LE(off, 0); head.writeUInt32LE(n.props.length, 4); head.writeUInt32LE(plen, 8); head[12] = n.name.length; head.write(n.name, 13, 'latin1'); }
    parts[at] = head;
  };
  for (const n of f.nodes) writeNode(n);
  push(nullRec);
  // footer: [16-byte id][4 zero bytes][zero padding to a 16-byte boundary (16 if already aligned)]
  // [version][120 zero bytes][16-byte magic]; id and the tail are kept from the original
  const fl = f.footer;
  push(fl.subarray(0, 20));
  push(Buffer.alloc((16 - (off % 16)) % 16 || 16));
  push(fl.subarray(fl.length - 140));
  return Buffer.concat(parts);
}

// property helpers
export function propValue(p) {
  const r = p.raw;
  switch (p.t) {
    case 'S': return r.toString('utf8', 5, 5 + r.readUInt32LE(1));
    case 'R': return r.subarray(5, 5 + r.readUInt32LE(1));
    case 'L': return r.readBigInt64LE(1);
    case 'I': return r.readInt32LE(1);
    case 'D': return r.readDoubleLE(1);
    default: return null;
  }
}
export function rawProp(bytes) {
  const b = Buffer.alloc(5 + bytes.length);
  b[0] = 0x52; b.writeUInt32LE(bytes.length, 1); bytes.copy(b, 5);
  return { t: 'R', raw: b };
}
export function arrayValue(p) {
  const r = p.raw, n = r.readUInt32LE(1), enc = r.readUInt32LE(5), len = r.readUInt32LE(9);
  const data = enc ? zlib.inflateSync(r.subarray(13, 13 + len)) : r.subarray(13, 13 + len);
  return { n, data };
}
