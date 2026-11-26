#!/usr/bin/env python3
"""Lossless PNG shrink: python3 tools/pngslim.py <file.png> ...

Re-encodes each PNG with maximum zlib effort, drops an alpha channel that is fully opaque and
keeps the colour chunks (gAMA, cHRM, sRGB, iCCP) so browsers decode exactly the same pixels.
Text / time / background / pHYs chunks are dropped. A file is only replaced when the decoded
pixels are verified identical and the result is smaller.
"""
import io
import struct
import sys
import zlib

from PIL import Image

KEEP = {b'gAMA', b'cHRM', b'sRGB', b'iCCP'}


def chunks(data):
    i = 8
    while i < len(data):
        (n,) = struct.unpack('>I', data[i:i + 4])
        yield data[i + 4:i + 8], data[i:i + 12 + n]
        i += 12 + n


def slim(path):
    orig = open(path, 'rb').read()
    im = Image.open(io.BytesIO(orig))
    im.load()
    src = im
    if im.mode == 'RGBA' and im.getchannel('A').getextrema() == (255, 255):
        im = im.convert('RGB')
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True, compress_level=9)
    new = buf.getvalue()
    # splice the original colour chunks in right after IHDR
    color = b''.join(raw for t, raw in chunks(orig) if t in KEEP)
    if color:
        parts = list(chunks(new))
        ihdr_end = 8 + len(parts[0][1])
        rest = b''.join(raw for t, raw in parts[1:] if t not in KEEP)
        new = new[:ihdr_end] + color + rest
    check = Image.open(io.BytesIO(new))
    if check.convert('RGBA').tobytes() != src.convert('RGBA').tobytes():
        raise SystemExit(f'pixel mismatch: {path}')
    if len(new) < len(orig):
        open(path, 'wb').write(new)
        return len(orig), len(new)
    return len(orig), len(orig)


total_a = total_b = 0
for p in sys.argv[1:]:
    a, b = slim(p)
    total_a += a
    total_b += b
print(f'{len(sys.argv) - 1} files: {total_a / 1e6:.2f} MB -> {total_b / 1e6:.2f} MB')
