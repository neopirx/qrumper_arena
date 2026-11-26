# Asset library (not shipped)

Source material that the game does not load. `assets/` is Vite's public directory and is copied
whole into `dist/`, so anything kept there ships to every player; this folder does not.

- `textures/` — the parts of the texture packs no map uses (same folder layout as `assets/textures/`).
  To use one, move the PNG (and its `_normal.png` for `textures_01`) back to the same path under
  `assets/textures/`, then run `python3 tools/pngslim.py <file>` on it (lossless).
- `animations/UAL1_Standard.glb`, `UAL2_Standard.glb` — the full Universal Animation Library
  files. The game loads `assets/animations/ual_mannequin.glb`, cut from UAL1 down to the clips it
  plays. To add a clip, list it in `src/render/entities.js` and regenerate:
  `node tools/glbprune.mjs asset-library/animations/UAL1_Standard.glb assets/animations/ual_mannequin.glb <clip> ...`
- `audio-masters/` — the original 24-bit / 96 kHz WAVs. The game ships FLAC (lossless, 24-bit,
  48 kHz): `ffmpeg -i in.wav -map 0:a -map_metadata -1 -ar 48000 -sample_fmt s32 -bits_per_raw_sample 24 -c:a flac -compression_level 12 out.flac`
- `icons/` — badge sheets the per-badge icons were cut from; `fonts/paladins.ttf` — unused font.

Models in `assets/weapons` and `assets/characters` were passed through `tools/fbxslim.mjs`
(embedded textures → lossless WebP, unused normal maps removed). Run it on any new model FBX.
The untouched originals are in git history (commit 9e5f7cd and earlier).
