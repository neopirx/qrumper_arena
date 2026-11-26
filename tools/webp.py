#!/usr/bin/env python3
"""Lossless WebP: python3 tools/webp.py in.png out.webp

Drops an alpha channel that is fully opaque, encodes lossless (exact) and verifies that the
decoded pixels match the source. Used by tools/fbxslim.mjs for embedded model textures.
"""
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
im.load()
ref = im.convert('RGBA').tobytes()
if im.mode == 'RGBA' and im.getchannel('A').getextrema() == (255, 255):
    im = im.convert('RGB')
elif im.mode not in ('RGB', 'RGBA'):
    im = im.convert('RGBA')
im.save(dst, 'WEBP', lossless=True, quality=100, method=6, exact=True)
if Image.open(dst).convert('RGBA').tobytes() != ref:
    raise SystemExit(f'pixel mismatch: {src}')
