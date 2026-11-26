// "Spire" — FFA map for 4-10 players, a Quake-style fortress rather than a ring of rooms.
// An octagonal open-sky courtyard around the Spire: a tower whose flanks carry a spiral of ramps
// up to the Red Armor landing, with bridges out to a colonnaded gallery ring. Four wings sit on
// four different heights and are chained by corner rooms into an outer loop, so every route
// changes level: a teal research wing (192) with a sunken railgun pit, a gold great hall (0)
// with a terrace, an east forge hall (96) with a lava pit under the GL bridge, and the green
// chem vault (-96) where the Mega Health sits past a slime channel.
//
//      NW (192) ─── NORTH WING (192, RG pit) ─── NE (96, stairs)
//         │               │ gallery arcade              │
//   GREAT HALL (0)  ═ arch ═  COURTYARD + SPIRE  ═ ramp ═  FORGE HALL (96, lava pit, GL bridge)
//   terrace (192) ── gallery ring (192), bridges to the RA landing (192)    │
//         │               │ stairs down                  │
//      SW (-96) ──── CHEM VAULT (-96, slime channel, MH) ─── SE (-96, stairs)
//
const T = {
  cobble: 'tiles_floor_pt_7',
  paving: 'concrete_pt_1_1',
  paving2: 'tiles_floor_pt_6',
  stone: 'stone_wall_pt_2',
  stone2: 'concrete_wall_pt_3',
  brick: 'concrete_wall_pt_3_1',
  brickOld: 'concrete_wall_pt_3_2',
  conc: 'concrete_wall_pt_11_2',
  concFloor: 'concrete_pt_1',
  wood: 'metal_panels_pt_4',
  planks: 'beam_panels_pt_2',
  roof: 'metal_roofing_pt_1',
  metal: 'beam_panels_pt_1',
  rust: 'rusty_metal_pt_7',
  tiles: 'tiles_floor_pt_5',
  tilesDark: 'beam_panels_pt_2_1',
  chem: 'concrete_wall_pt_9',
  glass: 'glass_block_windows_pt_1',
  shutters: 'metal_shutters_pt_1',
  trim: 'proc_trim',
  hazard: 'proc_hazard',
  tech: 'proc_tech',
  beams: 'corrugated_steel_pt_3',
};

const LG = 192, LE = 96, LS = -96, TOP = 864;
const GOLD = 0xffbe4a, GOLDW = 0xffd890, NAVY = 0x5a78ff, TEAL = 0x3ee0d0, CHEM = 0x7cff3a, LAVA = 0xff5a1a;

const deck = (b, top = T.planks) => ({ box: b, tex: { top, side: T.trim, bottom: T.stone2 }, bevelTex: T.hazard });
const col = (x, z, y0, y1, r = 18, side = T.stone) => ({ box: [x - r, y0, z - r, x + r, y1, z + r], tex: { top: T.trim, side }, bevel: Math.round(r * 0.6) });
const band = (x, z, y, r, color = GOLD) => ({ box: [x - r, y, z - r, x + r, y + 8, z + r], tex: T.trim, bevel: false, emit: color });

// colonnade under a gallery: columns every `step` along x (axis 'x') or z
function colonnade(axis, from, to, fixed, step, y1) {
  const out = [];
  for (let v = from; v <= to + 0.1; v += step) out.push(axis === 'x' ? col(v, fixed, 0, y1) : col(fixed, v, 0, y1));
  return out;
}

export default {
  name: 'Spire',
  description: 'FFA fortress at dusk: a spiral-ramp tower in an octagonal courtyard, four wings on four levels joined in a loop.',
  world: [-1600, -224, -1600, 1600, TOP, 1600],
  defaults: { floor: T.concFloor, wall: T.brick, ceil: T.beams },
  ambient: 0.2,
  sun: { dir: [-0.5, 0.72, 0.34], color: [1.0, 0.74, 0.42], intensity: 1.3, sky: [0.34, 0.42, 0.8] },
  skyColor: { top: [0.04, 0.06, 0.17], horizon: [0.95, 0.6, 0.28] },
  look: {
    fog: [0.13, 0.16, 0.33], fogDensity: 0.00032,
    ambient: [0.62, 0.72, 1.0],
    sat: 0.5, tint: [1.0, 0.98, 0.96], brightness: 1.15,
    sunColor: [1.0, 0.72, 0.36],
    planet: { dir: [0.35, 0.4, -0.85], size: 0.3, color: [0.62, 0.7, 1.0] },
    zones: [
      { b: [-640, LG, -1472, 640, 480, -704], fog: [0.07, 0.22, 0.26], density: 0.00045 },    // north wing
      { b: [-640, -224, 704, 640, 256, 1472], fog: [0.12, 0.24, 0.06], density: 0.0005 },     // chem vault
      { b: [-1472, 0, -640, -704, 384, 640], fog: [0.26, 0.2, 0.12], density: 0.0004 },       // great hall
      { b: [704, -32, -640, 1472, 416, 640], fog: [0.34, 0.14, 0.06], density: 0.00045 },     // forge hall
    ],
  },
  spaces: [
    // ---- courtyard ----
    { b: [-640, 0, -640, 640, TOP, 640], floor: T.cobble, wall: T.stone, sky: true, trim: { h: 32, tex: T.trim }, strip: [{ y: 168, h: 6, color: GOLD }, { y: 380, h: 5, color: GOLD }] },
    { b: [-384, LG, -704, 384, 416, -640], floor: T.planks, wall: T.trim, ceil: T.trim },        // arcade to the north wing
    { b: [-160, LS, 640, 160, 160, 704], floor: T.hazard, wall: T.trim, ceil: T.trim },          // stairs down to the vault
    { b: [-704, 0, -128, -640, 160, 128], floor: T.hazard, wall: T.trim, ceil: T.trim },          // arch to the great hall
    { b: [-704, LG, -448, -640, 352, -320], floor: T.hazard, wall: T.trim, ceil: T.trim },        // gallery -> terrace
    { b: [640, 0, -128, 704, 224, 128], floor: T.hazard, wall: T.trim, ceil: T.trim },            // ramp to the forge
    { b: [704, 0, -128, 896, LE, 128], floor: T.wood, wall: T.trim },
    { b: [640, LG, 256, 704, 352, 448], floor: T.hazard, wall: T.trim, ceil: T.trim },            // gallery -> forge (drop)

    // ---- north wing (192): glass roof, sunken railgun pit ----
    { b: [-640, LG, -1472, 640, 480, -704], floor: T.tiles, wall: T.stone2, ceil: T.glass, trim: { h: 24, tex: T.tech }, crown: { h: 32, tex: T.trim }, strip: { y: 150, h: 5, color: TEAL } },
    { b: [-256, 128, -1216, 256, LG, -960], floor: T.tilesDark, wall: T.tech },

    // ---- great hall (0) with its terrace (192) ----
    { b: [-1472, 0, -640, -704, 384, 640], floor: T.wood, wall: T.brickOld, ceil: T.beams, trim: { h: 24, tex: T.trim }, crown: { h: 24, tex: T.trim }, strip: { y: 300, h: 5, color: GOLD } },

    // ---- forge hall (96) with the lava pit ----
    { b: [704, LE, -640, 1472, 416, 640], floor: T.metal, wall: T.conc, ceil: T.beams, trim: { h: 24, tex: T.hazard }, crown: { h: 24, tex: T.trim }, strip: { y: 220, h: 5, color: LAVA } },
    { b: [960, -32, -384, 1216, LE, 384], floor: T.rust, wall: T.rust },

    // ---- chem vault (-96) and the slime channel ----
    { b: [-640, LS, 704, 640, 256, 1472], floor: T.tilesDark, wall: T.chem, ceil: T.metal, trim: { h: 24, tex: T.hazard }, strip: { y: 200, h: 6, color: CHEM } },
    { b: [-640, -160, 1024, 640, LS, 1152], floor: T.metal, wall: T.rust },

    // ---- corner rooms: the outer loop ----
    { b: [-1216, LG, -1472, -704, 416, -704], floor: T.paving, wall: T.conc, ceil: T.roof, trim: { h: 24, tex: T.trim } },          // NW (192)
    { b: [-704, LG, -1216, -640, 352, -1088], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [-960, LG, -704, -704, 352, -640], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [704, LE, -1472, 1216, 416, -704], floor: T.paving, wall: T.conc, ceil: T.roof, trim: { h: 24, tex: T.trim } },             // NE (96)
    { b: [640, LG, -1216, 704, 352, -1088], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [832, LE, -704, 1088, 288, -640], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [704, LS, 704, 1216, 288, 1472], floor: T.paving2, wall: T.shutters, ceil: T.metal, trim: { h: 24, tex: T.hazard } },     // SE (-96)
    { b: [832, LE, 640, 1088, 288, 704], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [640, LS, 1184, 704, 96, 1344], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [-1216, LS, 704, -704, 288, 1472], floor: T.paving2, wall: T.shutters, ceil: T.metal, trim: { h: 24, tex: T.hazard } },   // SW (-96)
    { b: [-1088, 0, 640, -832, 160, 704], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [-704, LS, 1184, -640, 96, 1344], floor: T.hazard, wall: T.trim, ceil: T.trim },
  ],
  solids: [
    // ---- courtyard: octagon corners ----
    { wedge: [-640, 0, -640, -448, TOP, -448], keep: '-x-z', tex: T.stone },
    { wedge: [448, 0, -640, 640, TOP, -448], keep: '+x-z', tex: T.stone },
    { wedge: [-640, 0, 448, -448, TOP, 640], keep: '-x+z', tex: T.stone },
    { wedge: [448, 0, 448, 640, TOP, 640], keep: '+x+z', tex: T.stone },
    // the Spire: tower core with gold bands, crown and needle
    { box: [-128, 0, -128, 128, 520, 128], tex: { top: T.roof, side: T.stone2 } },
    band(0, 0, 240, 132), band(0, 0, 400, 132),
    { box: [-104, 520, -104, 104, 568, 104], tex: { top: T.roof, side: T.trim } },
    { box: [-40, 568, -40, 40, 760, 40], tex: { top: T.trim, side: T.stone } },
    { box: [-26, 760, -26, 26, 800, 26], tex: T.trim, bevel: false, emit: GOLDW },
    // spiral of ramps around the tower: W (0->48), N (48->96), E (96->144), S (144->192)
    { ramp: [-224, 0, -128, -128, 48, 128], up: '-z', tex: T.planks },
    { box: [-224, 0, -224, -128, 48, -128], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { box: [-128, 0, -224, 128, 48, -128], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { ramp: [-128, 48, -224, 128, 96, -128], up: '+x', tex: T.planks },
    { box: [128, 0, -224, 224, 96, -128], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { box: [128, 0, -128, 224, 96, 128], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { ramp: [128, 96, -128, 224, 144, 128], up: '+z', tex: T.planks },
    { box: [128, 0, 128, 224, 144, 224], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { box: [-128, 0, 128, 128, 144, 224], tex: { top: T.planks, side: T.stone2 }, bevel: false },
    { ramp: [-128, 144, 128, 128, LG, 224], up: '-x', tex: T.planks },
    { box: [-224, 0, 128, -128, LG, 224], tex: { top: T.tiles, side: T.stone2 }, bevelTex: T.hazard },     // RA landing
    // bridges from the RA landing: west to the W gallery, south to the S gallery
    deck([-544, LG - 16, 128, -224, LG, 224]),
    deck([-224, LG - 16, 224, -128, LG, 544]),
    // gallery ring (192) on colonnades, corner decks over the wedges
    deck([-448, LG - 16, -640, 448, LG, -544]), deck([-448, LG - 16, 544, 448, LG, 640]),
    deck([-640, LG - 16, -448, -544, LG, 448]), deck([544, LG - 16, -448, 640, LG, 448]),
    deck([-640, LG - 16, -640, -448, LG, -448]), deck([448, LG - 16, -640, 640, LG, -448]),
    deck([-640, LG - 16, 448, -448, LG, 640]), deck([448, LG - 16, 448, 640, LG, 640]),
    ...colonnade('x', -336, 336, -560, 224, LG - 16), ...colonnade('x', -336, 336, 560, 224, LG - 16),
    ...colonnade('z', -336, 336, -560, 224, LG - 16), ...colonnade('z', -336, 336, 560, 224, LG - 16),
    { box: [-448, LG - 22, -548, 448, LG - 16, -544], tex: T.trim, bevel: false, emit: GOLD },
    { box: [-448, LG - 22, 544, 448, LG - 16, 548], tex: T.trim, bevel: false, emit: GOLD },
    // arch frames
    { arch: [-704, 0, -128, -640, 160, 128], axis: 'x', tex: { top: T.trim, side: T.stone2 } },
    { arch: [640, 0, -128, 704, 224, 128], axis: 'x', tex: { top: T.trim, side: T.stone2 } },
    { arch: [-160, LS, 640, 160, 160, 704], axis: 'z', tex: { top: T.trim, side: T.stone2 } },
    // courtyard cover: stone planters
    { box: [-400, 0, -48, -336, 40, 48], tex: { top: T.paving, side: T.stone2 } },
    { box: [336, 0, -48, 400, 40, 48], tex: { top: T.paving, side: T.stone2 } },
    { box: [-48, 0, -400, 48, 40, -336], tex: { top: T.paving, side: T.stone2 } },
    // stairs into the vault
    { stairs: [-160, LS, 640, 160, 0, 864], up: '-z', tex: T.trim },
    // ramp to the forge
    { ramp: [640, 0, -128, 896, LE, 128], up: '+x', tex: T.wood },

    // ---- north wing ----
    { ramp: [-256, 128, -1216, -160, LG, -960], up: '-x', tex: T.tiles },
    { ramp: [160, 128, -1216, 256, LG, -960], up: '+x', tex: T.tiles },
    { box: [-40, 128, -1128, 40, 144, -1048], tex: { top: T.tech, side: T.trim }, bevelTex: T.hazard },     // RG plinth
    col(-448, -896, LG, 480, 24, T.stone2), col(448, -896, LG, 480, 24, T.stone2), col(-448, -1280, LG, 480, 24, T.stone2), col(448, -1280, LG, 480, 24, T.stone2),
    band(-448, -896, 400, 28, TEAL), band(448, -896, 400, 28, TEAL), band(-448, -1280, 400, 28, TEAL), band(448, -1280, 400, 28, TEAL),
    { wedge: [-640, LG, -1472, -512, 480, -1344], keep: '-x-z', tex: T.stone2 },
    { wedge: [512, LG, -1472, 640, 480, -1344], keep: '+x-z', tex: T.stone2 },
    { box: [-256, LG, -1472, 256, LG + 48, -1408], tex: { top: T.tech, side: T.trim }, bevelTex: T.hazard },
    { box: [-640, LG, -800, -576, LG + 64, -704], tex: { top: T.trim, side: T.rust } },

    // ---- great hall: terrace along the north, stairs down the west wall, gold columns ----
    { box: [-1344, 0, -640, -704, LG, -320], tex: { top: T.planks, side: T.stone2 }, bevelTex: T.hazard },
    { stairs: [-1472, 0, -640, -1344, LG, -192], up: '-z', tex: T.trim },
    { box: [-1344, LG - 6, -324, -704, LG, -320], tex: T.trim, bevel: false, emit: GOLD },
    col(-1216, 128, 0, 384, 26, T.stone2), col(-960, 128, 0, 384, 26, T.stone2), col(-1216, 448, 0, 384, 26, T.stone2), col(-960, 448, 0, 384, 26, T.stone2),
    band(-1216, 128, 300, 30), band(-960, 128, 300, 30), band(-1216, 448, 300, 30), band(-960, 448, 300, 30),
    { box: [-1136, 0, 240, -1040, 16, 336], tex: { top: T.tiles, side: T.trim }, bevelTex: T.hazard },   // RL plinth
    { wedge: [-1472, 0, 512, -1344, 384, 640], keep: '-x+z', tex: T.brickOld },
    { cut: [-1472, 288, -320, -704, 384, 640], planes: [[0, -1, -0.1, 0, 384, -320]], tex: T.beams },        // sloped roof

    // ---- forge hall: lava pit with the GL bridge, stairs out, SG dais ----
    deck([960, LE - 16, -48, 1216, LE, 48], T.metal),
    { stairs: [960, -32, -384, 1216, LE, -256], up: '-z', tex: T.trim },
    { box: [960, -32, -256, 1216, -24, 384], tex: T.rust, emit: LAVA, bevel: false },
    { box: [1280, LE, -96, 1408, LE + 24, 96], tex: { top: T.tiles, side: T.trim }, bevelTex: T.hazard },
    col(960, -512, LE, 416, 22, T.rust), col(1216, -512, LE, 416, 22, T.rust), col(960, 512, LE, 416, 22, T.rust), col(1216, 512, LE, 416, 22, T.rust),
    { box: [1408, LE, -640, 1472, LE + 96, -512], tex: { top: T.trim, side: T.rust } },
    { box: [1344, LE, 448, 1472, LE + 56, 576], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },

    // ---- chem vault: slime channel, bridge, MH dais, steps out of the channel ----
    deck([-80, LS - 16, 1024, 80, LS, 1152], T.metal),
    { box: [-512, -160, 1024, 512, -152, 1152], tex: T.metal, emit: CHEM, bevel: false },
    { stairs: [512, -160, 1024, 640, LS, 1152], up: '+x', tex: T.trim },
    { stairs: [-640, -160, 1024, -512, LS, 1152], up: '-x', tex: T.trim },
    { box: [-96, LS, 1280, 96, LS + 24, 1408], tex: { top: T.tiles, side: T.trim }, bevelTex: T.hazard },
    col(-384, 896, LS, 256, 24, T.chem), col(384, 896, LS, 256, 24, T.chem), col(-384, 1344, LS, 256, 24, T.chem), col(384, 1344, LS, 256, 24, T.chem),
    band(-384, 896, 160, 28, CHEM), band(384, 896, 160, 28, CHEM), band(-384, 1344, 160, 28, CHEM), band(384, 1344, 160, 28, CHEM),
    { wedge: [-640, LS, 1344, -512, 256, 1472], keep: '-x+z', tex: T.chem }, { wedge: [512, LS, 1344, 640, 256, 1472], keep: '+x+z', tex: T.chem },

    // ---- corner rooms ----
    { stairs: [704, LE, -1216, 960, LG, -1088], up: '-x', tex: T.trim },                       // NE: down from the north wing
    { stairs: [832, LS, 704, 1088, LE, 1088], up: '-z', tex: T.trim },                         // SE: down to the vault level
    { stairs: [-1088, LS, 640, -832, 0, 960], up: '-z', tex: T.trim },                         // SW: down from the great hall
    { box: [-1216, LG, -1472, -1088, LG + 32, -1344], tex: { top: T.trim, side: T.rust } },
    { box: [1088, LS, 1280, 1216, LS + 48, 1472], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    { box: [-1216, LS, 1280, -1088, LS + 64, 1472], tex: { top: T.trim, side: T.rust } },
  ],
  hazards: [
    { b: [960, -32, -256, 1216, 8, 384], dmg: 60, mod: 'lava' },
    { b: [-512, -160, 1024, 512, -120, 1152], dmg: 20, mod: 'slime' },
  ],
  jumppads: [
    { at: [-360, 0, -360], target: [-280, LG + 40, -592] },    // courtyard -> north gallery
    { at: [360, 0, 360], target: [280, LG + 40, 592] },        // courtyard -> south gallery
  ],
  teleporters: [
    { at: [-1152, LG, -800], dest: [1152, LS, 1150], yaw: 90 },   // NW -> SE
    { at: [1152, LS, 900], dest: [-1150, LG, -1150], yaw: -90 },  // SE -> NW
  ],
  lights: [
    // courtyard
    [-620, 120, 0, GOLD, 440, 1.1], [620, 120, 0, GOLD, 440, 1.1], [0, 120, -620, GOLD, 400, 1.0], [0, 120, 620, GOLD, 400, 1.0],
    [-200, 330, 240, GOLDW, 300, 0.55, { fixture: false }], [0, 600, 0, GOLDW, 500, 0.9, { fixture: false }],
    [-620, 300, -300, NAVY, 380, 0.6], [620, 300, 300, NAVY, 380, 0.6],
    // north wing
    [0, 440, -900, TEAL, 600, 1.0], [0, 440, -1300, TEAL, 560, 1.0], [0, 170, -1088, TEAL, 300, 1.2, { fixture: false }], [-600, 300, -1100, GOLDW, 360, 0.8], [600, 300, -1100, GOLDW, 360, 0.8],
    // great hall
    [-1088, 340, -100, GOLD, 600, 1.1], [-1088, 340, 450, GOLD, 520, 1.0], [-1440, 300, 300, GOLDW, 380, 0.9], [-1020, 330, -480, GOLDW, 420, 0.9],
    // forge
    [1088, 0, 64, LAVA, 520, 1.6, { fixture: false }], [1088, 380, -400, GOLD, 480, 0.9], [1088, 380, 400, GOLD, 480, 0.9], [1440, 260, 0, LAVA, 360, 1.0],
    // vault
    [0, -130, 1088, CHEM, 600, 1.4, { fixture: false }], [-300, 220, 900, CHEM, 420, 1.0], [300, 220, 1300, CHEM, 420, 1.0], [0, 200, 1440, GOLDW, 360, 0.9],
    // corners
    [-960, 390, -1100, GOLDW, 460, 0.9], [960, 390, -1100, NAVY, 460, 0.9], [960, 260, 1100, NAVY, 460, 0.9], [-960, 260, 1100, GOLDW, 460, 0.9],
    [-1152, LG + 20, -800, 0x9a7aff, 260, 1.0, { fixture: false }], [1152, LS + 20, 900, 0x9a7aff, 260, 1.0, { fixture: false }],
  ],
  items: [
    { t: 'ra', at: [-176, LG, 176] },
    { t: 'mh', at: [0, LS + 24, 1344] },
    { t: 'rl', at: [-1088, 16, 288] },
    { t: 'rg', at: [0, 144, -1088] },
    { t: 'gl', at: [1088, LE, 0] },
    { t: 'sg', at: [1344, LE + 24, 0] },
    { t: 'ya', at: [-1024, LG, -480] }, { t: 'ya', at: [960, LE, -1300] },
    { t: 'h25', at: [-500, LG, -592] }, { t: 'h25', at: [500, LG, 592] }, { t: 'h25', at: [-1400, 0, 500] }, { t: 'h25', at: [1400, LE, 350] },
    { t: 'h25', at: [-960, LS, 1300] }, { t: 'h25', at: [960, LS, 1300] }, { t: 'h25', at: [0, LG, -1300] },
    { t: 'h5', at: [-176, 48, -176] }, { t: 'h5', at: [176, 96, -176] }, { t: 'h5', at: [176, 144, 176] },
    { t: 'shard', at: [-592, LG, -96] }, { t: 'shard', at: [-592, LG, 0] }, { t: 'shard', at: [-592, LG, 96] },
    { t: 'shard', at: [592, LG, -96] }, { t: 'shard', at: [592, LG, 0] }, { t: 'shard', at: [592, LG, 96] },
    { t: 'shard', at: [-24, LS, 1088] }, { t: 'shard', at: [24, LS, 1088] },
    { t: 'am_rl', at: [-1400, 0, -100] }, { t: 'am_rl', at: [0, LG, 592] }, { t: 'am_rl', at: [1000, LE, -1000] },
    { t: 'am_rg', at: [-480, LG, -1350] }, { t: 'am_rg', at: [480, LG, -1350] },
    { t: 'am_gl', at: [1400, LE, -300] }, { t: 'am_sg', at: [1400, LE, 300] }, { t: 'am_sg', at: [-960, LG, -1300] },
    { t: 'am_mg', at: [-400, LS, 800] }, { t: 'am_mg', at: [400, LS, 800] }, { t: 'am_gl', at: [-960, LS, 1150] },
  ],
  spawns: [
    { at: [-400, 0, 200], yaw: 90 }, { at: [400, 0, -200], yaw: -90 }, { at: [0, 0, -420], yaw: 180 }, { at: [250, 0, 400], yaw: 0 },
    { at: [-300, LG, -1100], yaw: 180 }, { at: [300, LG, -820], yaw: 0 }, { at: [-1200, 0, 0], yaw: -90 }, { at: [-900, LG, -500], yaw: -90 },
    { at: [1300, LE, 300], yaw: 90 }, { at: [800, LE, -400], yaw: -90 }, { at: [-300, LS, 1300], yaw: 0 }, { at: [300, LS, 800], yaw: 180 },
    { at: [-960, LG, -1000], yaw: 0 }, { at: [960, LE, -900], yaw: 180 }, { at: [960, LS, 1200], yaw: 0 }, { at: [-960, LS, 1200], yaw: 0 },
  ],
};
