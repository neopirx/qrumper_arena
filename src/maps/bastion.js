// "Bastion" — duel / small FFA map in the Quake tradition: no grid of rooms, but one connected
// foundry folded over itself on five floor heights, built for movement. Ramps to jump off,
// a slime trench to strafe-jump across, a walljump nook, a crawl tunnel under the atrium, and
// windows and balconies that let every area see into the next.
// Identity: rust-orange foundry under a dusk sky. Sodium keys against teal fills, ochre haze,
// green slime, a red-lit armour shrine, and the hanging crucible over the atrium as landmark.
//
//   NW room (192) ── door ── NORTH HALL (192, colonnade, RA dais W, MH stair E) ── corridor (256) ─┐
//      │ stairs                        │ balcony                                                    │ drop
//   WEST WING (0)  ═ arch ═  ATRIUM (0, open sky)  ═ ramp door ═▶  EAST WING (64, SG)  ◀── MH nook (136)
//   slime trench,                 basin (-96, RL)                          │
//   GL bridge                     │ crawl tunnel                           │ ramp down
//      └─ stairs ──▶  SOUTH HALL (-96, YA; RG mezzanine at 64)  ◀──────────┘   teleporter → north hall
//
const T = {
  floorStone: 'tiles_floor_pt_6',
  floorMetal: 'metal_panels_pt_4',
  floorConc: 'concrete_pt_6',
  floorGrate: 'beam_panels_pt_2',
  wallStone: 'concrete_wall_pt_10_3',
  wallPanel: 'concrete_wall_pt_11_1',
  wallBrick: 'metal_panels_pt_1_2',
  wallConc: 'concrete_wall_pt_10_2',
  rust: 'rusty_metal_pt_5',
  rust2: 'rusty_metal_pt_2_2',
  grate: 'beam_panels_pt_1',
  ceilMetal: 'corrugated_steel_pt_4',
  ceilCorr: 'corrugated_steel_pt_5',
  corrWall: 'corrugated_steel_wall_pt_2',
  plates: 'metal_panels_pt_2',
  tilesRed: 'misc_pt_3',
  trim: 'proc_trim',
  hazard: 'proc_hazard',
  tech: 'proc_tech',
};

const LB = -96, LE = 64, LN = 192, LM = 128;
const TOP = 704;
const SODIUM = 0xffa040, TEAL = 0x3fd0d8, WARM = 0xffc27a, SLIME = 0x6aff40, BLOOD = 0xff2a18;

// helpers
const deck = (b, top = T.floorGrate) => ({ box: b, tex: { top, side: T.trim, bottom: T.rust2 }, bevelTex: T.hazard });
const col8 = (x, z, y0, y1, r = 24, side = T.rust2) => ({ box: [x - r, y0, z - r, x + r, y1, z + r], tex: { top: T.trim, side }, bevel: Math.round(r * 0.6) });
const collar = (x, z, y, r = 28, color = SODIUM) => ({ box: [x - r, y, z - r, x + r, y + 10, z + r], tex: T.trim, bevel: false, emit: color });

export default {
  name: 'Bastion',
  description: 'Duel foundry on five levels: a sunken reactor basin, slime trench, colonnaded upper hall and a walljump nook.',
  world: [-1280, -224, -1088, 1280, TOP, 1088],
  defaults: { floor: T.floorConc, wall: T.wallPanel, ceil: T.ceilMetal },
  ambient: 0.17,
  sun: { dir: [-0.5, 0.55, 0.65], color: [1.0, 0.62, 0.32], intensity: 1.25, sky: [0.3, 0.5, 0.6] },
  skyColor: { top: [0.1, 0.1, 0.16], horizon: [0.85, 0.42, 0.16] },
  look: {
    fog: [0.42, 0.22, 0.08], fogDensity: 0.0004,
    ambient: [0.68, 0.86, 0.95],
    sat: 0.5, tint: [1.04, 0.98, 0.92], brightness: 1.0,
    sunColor: [1.0, 0.6, 0.28],
    planet: { dir: [0.55, 0.32, 0.77], size: 0.2, color: [0.95, 0.62, 0.42] },
    zones: [
      { b: [-992, -96, -320, -704, 48, 320], fog: [0.14, 0.3, 0.06], density: 0.0009 },     // slime trench
      { b: [-704, LN, -1024, 704, 480, -384], fog: [0.32, 0.18, 0.1], density: 0.00048 },   // north hall
      { b: [-704, LB, 384, 704, 192, 1024], fog: [0.1, 0.2, 0.24], density: 0.0006 },      // south hall (cold)
      { b: [-80, LB, 160, 80, 64, 384], fog: [0.1, 0.18, 0.22], density: 0.0008 },         // crawl tunnel
    ],
  },
  spaces: [
    // ---- atrium: open sky, octagonal (corner wedges), sunken basin in the middle ----
    { b: [-384, 0, -320, 384, TOP, 320], floor: T.floorStone, wall: T.wallStone, sky: true, trim: { h: 20, tex: T.hazard }, strip: [{ y: 168, h: 6, color: SODIUM }, { y: 420, h: 5, color: SODIUM }] },
    { b: [-224, LB, -160, 224, 0, 160], floor: T.plates, wall: T.rust, sky: true, strip: { y: 40, h: 5, color: 0xff7a20 } },
    // balcony: the atrium's north wall is open above the north hall floor
    { b: [-256, LN, -384, 256, 448, -320], floor: T.floorGrate, wall: T.trim, ceil: T.trim },
    // crawl tunnel from the basin south, under the atrium floor, into the south hall
    { b: [-80, LB, 160, 80, -16, 320], floor: T.grate, wall: T.rust2, ceil: T.trim },
    { b: [-80, LB, 320, 80, 64, 384], floor: T.grate, wall: T.trim, ceil: T.trim },

    // ---- west wing: slime trench across the middle, GL bridge ----
    { b: [-1216, 0, -320, -448, 320, 320], floor: T.floorConc, wall: T.wallConc, ceil: T.ceilMetal, trim: { h: 20, tex: T.hazard }, crown: { h: 20, tex: T.trim }, strip: { y: 236, h: 4, color: TEAL } },
    { b: [-960, -96, -320, -736, 0, 320], floor: T.grate, wall: T.rust, strip: { y: 56, h: 5, color: SLIME } },
    { b: [-448, 0, -112, -384, 176, 112], floor: T.hazard, wall: T.trim, ceil: T.trim },                // arch to the atrium
    { b: [-1216, LN, -384, -1088, 352, -320], floor: T.hazard, wall: T.trim, ceil: T.trim },            // stair head -> NW room

    // ---- NW room and the north hall (192) ----
    { b: [-1216, LN, -1024, -768, 416, -384], floor: T.tilesRed, wall: T.plates, ceil: T.ceilMetal, trim: { h: 24, tex: T.trim }, strip: { y: 180, h: 5, color: BLOOD } },
    { b: [-768, LN, -960, -704, 352, -800], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [-704, LN, -1024, 704, 480, -384], floor: T.floorMetal, wall: T.wallBrick, ceil: T.ceilCorr, trim: { h: 16, tex: T.trim }, crown: { h: 24, tex: T.trim }, strip: { y: 236, h: 4, color: TEAL } },
    // corridor east from the MH stair, then the drop into the nook
    { b: [704, 256, -640, 1216, 400, -512], floor: T.floorGrate, wall: T.corrWall, ceil: T.ceilCorr, trim: { h: 12, tex: T.trim } },
    { b: [1088, LM, -640, 1216, 400, -320], floor: T.plates, wall: T.corrWall, ceil: T.ceilCorr, trim: { h: 12, tex: T.hazard }, strip: { y: 160, h: 5, color: 0x4a8bff } },

    // ---- east wing (64): ramp up from the atrium ----
    { b: [448, LE, -320, 1216, 352, 320], floor: T.floorMetal, wall: T.corrWall, ceil: T.ceilCorr, trim: { h: 16, tex: T.trim }, crown: { h: 20, tex: T.trim }, strip: { y: 200, h: 4, color: SODIUM } },
    { b: [384, 0, -112, 448, 192, 112], floor: T.hazard, wall: T.trim, ceil: T.trim },
    { b: [448, 0, -112, 640, LE, 112], floor: T.floorMetal, wall: T.trim },

    // ---- south hall (-96): RG mezzanine along the south wall ----
    { b: [-704, LB, 384, 704, 224, 1024], floor: T.floorConc, wall: T.wallPanel, ceil: T.ceilMetal, trim: { h: 20, tex: T.hazard }, crown: { h: 20, tex: T.trim }, strip: { y: 250, h: 5, color: TEAL } },
    { b: [-640, LB, 320, -512, 128, 384], floor: T.hazard, wall: T.trim, ceil: T.trim },   // stairs up to the west wing
    { b: [512, LB, 320, 640, 224, 384], floor: T.hazard, wall: T.trim, ceil: T.trim },     // ramp up to the east wing

    // ---- SMELTER (SE, -96): crucible, molten channel, casting mezzanine; stairs up to the east wing ----
    { b: [768, LB, 448, 1216, 320, 1024], floor: T.plates, wall: T.rust, ceil: T.ceilCorr, trim: { h: 20, tex: T.hazard }, crown: { h: 24, tex: T.trim }, strip: { y: 260, h: 5, color: 0xff6a20 } },
    { b: [704, LB, 576, 768, 96, 704], floor: T.hazard, wall: T.trim, ceil: T.trim },                // door from the south hall
    { b: [960, LB, 320, 1088, 224, 448], floor: T.floorGrate, wall: T.trim, ceil: T.trim },          // stairwell to the east wing
    { b: [1120, -136, 448, 1216, LB, 1024], floor: T.rust, wall: T.rust2 },                          // molten channel

    // ---- LOCKER ROOM (SW, 0): the crew's changing room, off the west wing and the south hall ----
    { b: [-1216, 0, 448, -768, 224, 1024], floor: T.tilesRed, wall: T.wallPanel, ceil: T.ceilMetal, trim: { h: 16, tex: T.trim }, strip: { y: 176, h: 4, color: TEAL } },
    { b: [-1088, 0, 320, -960, 192, 448], floor: T.hazard, wall: T.trim, ceil: T.trim },             // passage from the west wing
    { b: [-768, 0, 736, -704, 160, 928], floor: T.hazard, wall: T.trim, ceil: T.trim },              // door to the south hall stairs

    // ---- PUMP ROOM (NE, 256): slime pumps feeding the trench, off the MH platform and the corridor ----
    { b: [768, 256, -1024, 1216, 448, -704], floor: T.floorGrate, wall: T.corrWall, ceil: T.ceilCorr, trim: { h: 16, tex: T.hazard }, strip: { y: 150, h: 5, color: SLIME } },
    { b: [704, 256, -960, 768, 400, -832], floor: T.hazard, wall: T.trim, ceil: T.trim },             // door from the MH platform
    { b: [832, 256, -704, 960, 400, -640], floor: T.hazard, wall: T.trim, ceil: T.trim },             // door to the corridor
  ],
  solids: [
    // ---- atrium ----
    { wedge: [-384, 0, -320, -256, TOP, -192], keep: '-x-z', tex: T.wallStone },
    { wedge: [256, 0, -320, 384, TOP, -192], keep: '+x-z', tex: T.wallStone },
    { wedge: [-384, 0, 192, -256, TOP, 320], keep: '-x+z', tex: T.wallStone },
    { wedge: [256, 0, 192, 384, TOP, 320], keep: '+x+z', tex: T.wallStone },
    // basin: ramps up on the west and east sides (ramp jumps out of the pit), RL plinth
    { ramp: [-224, LB, -96, -112, 0, 96], up: '-x', tex: T.plates },
    { ramp: [112, LB, -96, 224, 0, 96], up: '+x', tex: T.plates },
    { box: [-40, LB, -40, 40, LB + 12, 40], tex: { top: T.plates, side: T.trim }, bevelTex: T.hazard },
    // basin rim: hazard-striped lip and four stubby bollards
    { box: [-224, -8, -168, 224, 0, -160], tex: T.hazard, bevel: false }, { box: [-224, -8, 160, 224, 0, 168], tex: T.hazard, bevel: false },
    col8(-224, -160, 0, 40, 12), col8(224, -160, 0, 40, 12), col8(-224, 160, 0, 40, 12), col8(224, 160, 0, 40, 12),
    // upper ring: catwalks along W / E, joined to the north balcony across the corner wedges
    deck([-384, LN - 16, -320, -288, LN, 192]), deck([288, LN - 16, -320, 384, LN, 192]),
    deck([-384, LN - 16, -320, -192, LN, -256]), deck([192, LN - 16, -320, 384, LN, -256]),
    deck([-256, LN - 16, -320, 256, LN, -296]),
    { box: [-294, LN - 22, -180, -288, LN - 16, 180], tex: T.trim, bevel: false, emit: TEAL }, { box: [288, LN - 22, -180, 294, LN - 16, 180], tex: T.trim, bevel: false, emit: TEAL },
    // crane gantry and the hanging crucible (landmark), out of the jump pad arcs
    { box: [-384, 448, -24, 384, 472, 24], tex: { top: T.trim, side: T.trim, bottom: T.rust2 } },
    { box: [-48, 384, -48, 48, 448, 48], tex: { top: T.trim, side: T.plates } },
    { box: [-42, 372, -42, 42, 384, 42], tex: T.trim, bevel: false, emit: 0xff7a20 },
    { box: [-36, 336, -36, 36, 372, 36], tex: { top: T.trim, side: T.rust2 } },
    { box: [-30, 326, -30, 30, 336, 30], tex: T.trim, bevel: false, emit: 0xffb040 },
    // arch frames on the atrium doors
    { arch: [-448, 0, -112, -384, 176, 112], axis: 'x', tex: { top: T.trim, side: T.rust2 } },
    { arch: [384, 0, -112, 448, 192, 112], axis: 'x', tex: { top: T.trim, side: T.rust2 } },

    // ---- west wing ----
    // the GL bridge over the slime, and steps out of the trench at its south end
    deck([-960, -16, -48, -736, 0, 48]),
    { stairs: [-960, -96, 224, -736, 0, 320], up: '+z', tex: T.trim },
    { box: [-960, -96, -320, -736, -88, 224], tex: T.grate, emit: SLIME, bevel: false },
    // stairs up along the west wall to the NW room, with a landing
    { stairs: [-1216, 0, -128, -1088, LN, 320], up: '-z', tex: T.trim },
    { box: [-1216, 0, -320, -1088, LN, -128], tex: { top: T.floorMetal, side: T.wallConc } },
    // cover: crates and a pillar pair framing the arch
    { box: [-608, 0, 192, -512, 64, 288], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    { box: [-576, 0, -288, -496, 40, -208], tex: { top: T.trim, side: T.rust2 } },
    col8(-544, -136, 0, 320, 20), col8(-544, 136, 0, 320, 20),

    // ---- NW room: armour shrine ----
    { box: [-1152, LN, -960, -1024, LN + 16, -832], tex: { top: T.plates, side: T.trim }, bevelTex: T.hazard },
    { wedge: [-1216, LN, -1024, -1120, 416, -928], keep: '-x-z', tex: T.plates },
    { wedge: [-864, LN, -1024, -768, 416, -928], keep: '+x-z', tex: T.plates },

    // ---- north hall: colonnade, RA dais (west), MH stair platform (east) ----
    col8(-384, -704, LN, 480), col8(-128, -704, LN, 480), col8(128, -704, LN, 480), col8(384, -704, LN, 480),
    collar(-384, -704, 400), collar(-128, -704, 400), collar(128, -704, 400), collar(384, -704, 400),
    { box: [-704, LN, -1024, -512, LN + 32, -832], tex: { top: T.tilesRed, side: T.trim }, bevelTex: T.hazard },
    { stairs: [-512, LN, -1024, -448, LN + 32, -832], up: '-x', tex: T.trim },
    { box: [448, LN, -1024, 704, 256, -512], tex: { top: T.floorGrate, side: T.wallBrick }, bevelTex: T.hazard },
    { stairs: [320, LN, -1000, 448, 256, -768], up: '+x', tex: T.trim },
    { box: [-160, LN, -896, -96, LN + 48, -832], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    { box: [96, LN, -896, 160, LN + 48, -832], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    // sloped roof edges above the colonnade
    { cut: [-704, 400, -1024, 704, 480, -896], planes: [[0, -1, 1, 0, 480, -896]], tex: T.ceilCorr },

    // ---- east wing ----
    { ramp: [448, 0, -112, 640, LE, 112], up: '+x', tex: T.floorMetal },
    { box: [768, LE, -64, 896, LE + 16, 64], tex: { top: T.plates, side: T.trim }, bevelTex: T.hazard },   // SG plinth
    col8(704, -192, LE, 352, 20), col8(704, 192, LE, 352, 20), col8(1024, -192, LE, 352, 20), col8(1024, 192, LE, 352, 20),
    { box: [1088, LE, 128, 1216, LE + 72, 320], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },  // step-up crate stack
    { box: [1152, LE + 72, 224, 1216, LE + 120, 320], tex: { top: T.trim, side: T.rust2 } },

    // ---- south hall ----
    { box: [-704, LB, 896, 704, LE, 1024], tex: { top: T.plates, side: T.wallStone }, bevelTex: T.hazard },   // RG mezzanine
    { ramp: [-704, LB, 704, -576, LE, 896], up: '+z', tex: T.plates },
    { ramp: [576, LB, 704, 704, LE, 896], up: '+z', tex: T.plates },
    { stairs: [-640, LB, 320, -512, 0, 576], up: '-z', tex: T.trim },
    { ramp: [512, LB, 320, 640, LE, 640], up: '-z', tex: T.floorMetal },
    col8(-256, 640, LB, 224, 22, T.wallStone), col8(256, 640, LB, 224, 22, T.wallStone),
    { box: [-96, LB, 560, 96, LB + 48, 624], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    { wedge: [-704, LB, 384, -640, 224, 448], keep: '-x-z', tex: T.wallPanel },
    { wedge: [640, LB, 384, 704, 224, 448], keep: '+x-z', tex: T.wallPanel },
    // south hall dressing: a fallen gantry beam, pallets, a work lamp
    { box: [-300, LB, 760, 300, LB + 24, 792], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    { box: [380, LB, 450, 460, LB + 40, 530], tex: { top: T.floorGrate, side: T.rust }, bevelTex: T.trim },
    { stairs: [-704, LB, 736, -576, 0, 928], up: '-x', tex: T.trim },

    // ===== SMELTER =====
    { stairs: [960, LB, 320, 1088, LE, 560], up: '-z', tex: T.trim },
    // the crucible on its cradle: a riveted pot glowing at the lip, a pour spout over the channel
    { box: [880, LB, 640, 1040, LB + 32, 800], tex: { top: T.plates, side: T.trim }, bevelTex: T.hazard },
    { box: [896, LB + 32, 656, 1024, LB + 152, 784], tex: { top: T.rust2, side: T.rust }, bevelTex: T.trim },
    { box: [904, LB + 152, 664, 1016, LB + 156, 776], tex: T.trim, bevel: false, emit: 0xff8a20 },
    { box: [1024, LB + 120, 704, 1124, LB + 136, 736], tex: { top: T.rust2, side: T.trim } },
    { box: [1100, LB + 60, 708, 1120, LB + 120, 732], tex: T.trim, bevel: false, emit: 0xff6a10 },
    // molten channel along the east wall
    { box: [1120, -136, 448, 1216, -128, 1024], tex: T.rust, emit: 0xff5a10, bevel: false },
    // casting mezzanine along the south wall, reached by the stairs from the channel side
    deck([768, LE - 16, 928, 1120, LE, 1024]),
    { stairs: [768, LB, 736, 864, LE, 928], up: '+z', tex: T.trim },
    { box: [1116, LE, 928, 1120, LE + 30, 1024], tex: T.trim, bevel: false },
    // ingot stacks, moulds, the conveyor to the south hall door
    { box: [800, LB, 480, 880, LB + 48, 560], tex: { top: T.plates, side: T.rust2 }, bevelTex: T.hazard },
    { box: [810, LB + 48, 490, 870, LB + 80, 550], tex: { top: T.plates, side: T.rust2 } },
    { box: [776, LB, 600, 960, LB + 28, 640], tex: { top: T.floorGrate, side: T.trim }, bevelTex: T.hazard },
    { box: [1056, LB, 860, 1112, LB + 64, 916], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    // hanging ladle chain from the crane rail
    { box: [768, 280, 712, 1216, 300, 728], tex: { top: T.trim, side: T.trim, bottom: T.rust2 } },
    { box: [956, 180, 716, 964, 280, 724], tex: T.trim, bevel: false },
    { box: [930, 150, 690, 990, 180, 750], tex: { top: T.rust2, side: T.rust } },

    // ===== LOCKER ROOM =====
    ...[480, 560, 640, 720, 800, 880].map((z) => ({ box: [-1216, 0, z, -1180, 144, z + 64], tex: { top: T.trim, side: T.plates }, bevelTex: T.trim })),
    ...[-1120, -1040, -960, -880].map((x) => ({ box: [x, 0, 988, x + 64, 144, 1024], tex: { top: T.trim, side: T.plates }, bevelTex: T.trim })),
    { box: [-1100, 0, 640, -900, 20, 688], tex: { top: T.floorGrate, side: T.trim } },
    { box: [-1100, 0, 800, -900, 20, 848], tex: { top: T.floorGrate, side: T.trim } },
    { box: [-860, 0, 480, -800, 96, 560], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    { box: [-1180, 0, 900, -1120, 8, 960], tex: T.floorGrate, bevel: false },

    // ===== PUMP ROOM =====
    ...[[832, -960], [960, -960], [1088, -960]].flatMap(([x, z]) => [
      { box: [x, 256, z, x + 96, 400, z + 96], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.trim },
      { box: [x - 4, 330, z - 4, x + 100, 338, z + 100], tex: T.trim, bevel: false, emit: SLIME },
      { box: [x + 40, 400, z + 40, x + 56, 448, z + 56], tex: T.trim, bevel: false },
    ]),
    { box: [768, 256, -760, 1216, 284, -736], tex: { top: T.trim, side: T.rust2 } },
    { box: [1120, 256, -880, 1200, 320, -800], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },

    // ===== dressing across the old rooms =====
    // west wing: pipe runs along the north wall, a slime pump on the trench edge
    // (they start past the stair head at x -1088 so the stairs up to the NW room stay open)
    { box: [-1072, 260, -320, -448, 276, -304], tex: T.trim, bevel: false }, { box: [-1072, 240, -320, -448, 252, -308], tex: T.rust2, bevel: false },
    { box: [-990, 0, 280, -940, 70, 320], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    // north hall: a tool cart and banner frames between the columns
    { box: [-300, LN, -1000, -220, LN + 40, -960], tex: { top: T.trim, side: T.rust2 }, bevelTex: T.hazard },
    { box: [250, 360, -1024, 266, 470, -1018], tex: T.trim, bevel: false, emit: SODIUM }, { box: [-266, 360, -1024, -250, 470, -1018], tex: T.trim, bevel: false, emit: SODIUM },
    // east wing: a forklift-sized crate pile and a cable drum
    { box: [880, LE, -300, 980, LE + 56, -220], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    { box: [900, LE + 56, -290, 960, LE + 96, -240], tex: { top: T.trim, side: T.rust2 } },
    // atrium: cable bundles hanging off the gantry
    { box: [-200, 400, -6, -194, 448, 6], tex: T.trim, bevel: false }, { box: [194, 380, -6, 200, 448, 6], tex: T.trim, bevel: false },
  ],
  hazards: [
    { b: [-960, -96, -320, -736, -64, 224], dmg: 20, mod: 'slime' },
    { b: [1120, -136, 448, 1216, -110, 1024], dmg: 60, mod: 'lava' },
  ],
  jumppads: [
    { at: [-160, 0, 248], target: [-160, LN + 40, -300] },   // atrium south -> north balcony, over the basin
    { at: [160, 0, 248], target: [160, LN + 40, -300] },
    { at: [-656, 0, -232], target: [-1150, LN + 30, -260] }, // west wing -> stair landing
  ],
  teleporters: [
    { at: [-400, LB, 800], dest: [0, LN, -560], yaw: 180 },   // south hall -> north hall
  ],
  // [x, y, z, colorHex, radius, intensity, { fixture: false }?]
  lights: [
    // atrium
    [-364, 300, 0, SODIUM, 520, 1.25], [364, 300, 0, SODIUM, 520, 1.25],
    [0, 130, -300, TEAL, 360, 0.8], [0, 130, 300, TEAL, 360, 0.8],
    [0, 300, 0, 0xff8a30, 560, 1.4, { fixture: false }],
    [0, -40, 0, 0xff7a20, 300, 1.2, { fixture: false }],
    // west wing
    [-832, 290, 0, WARM, 520, 1.0], [-1190, 240, 200, SODIUM, 320, 0.8], [-848, -40, -100, SLIME, 340, 1.4, { fixture: false }], [-848, -40, 140, SLIME, 300, 1.2, { fixture: false }],
    // NW room / north hall
    [-990, 390, -700, BLOOD, 480, 1.3], [-1190, 300, -900, BLOOD, 300, 1.0],
    [-256, 450, -560, WARM, 520, 1.0], [256, 450, -560, WARM, 520, 1.0], [0, 300, -1000, TEAL, 420, 0.9], [-600, 330, -1000, SODIUM, 320, 0.9], [600, 360, -1000, SODIUM, 300, 0.8],
    [960, 380, -576, 0x4a8bff, 360, 1.0], [1150, 330, -480, 0x4a8bff, 300, 1.0],
    // east wing
    [832, 330, 0, WARM, 560, 1.1], [1190, 240, -200, SODIUM, 300, 0.8], [520, 170, 0, TEAL, 260, 0.6],
    // south hall
    [-384, 200, 700, TEAL, 520, 1.0], [384, 200, 700, TEAL, 520, 1.0], [0, 200, 1000, WARM, 420, 1.0], [0, -40, 240, TEAL, 200, 0.8, { fixture: false }],
    [-400, -60, 800, 0x6a5cff, 260, 1.0, { fixture: false }],
    // smelter: the crucible and the channel glow, work lights
    [960, 120, 720, 0xff7a20, 520, 1.5, { fixture: false }], [1168, -60, 736, 0xff5a10, 480, 1.4, { fixture: false }], [990, 280, 520, WARM, 420, 0.9], [900, 280, 980, SODIUM, 360, 0.8],
    // locker room: cold tubes, one dying
    [-992, 200, 600, TEAL, 420, 0.9], [-992, 200, 880, 0xd8f0ff, 380, 0.8],
    // pump room
    [992, 420, -880, SLIME, 460, 1.0], [992, 300, -760, WARM, 300, 0.7],
  ],
  items: [
    { t: 'rl', at: [0, LB + 12, 0] },
    { t: 'gl', at: [-848, 0, 0] },
    { t: 'sg', at: [832, LE + 16, 0] },
    { t: 'rg', at: [0, LE, 960] },
    { t: 'ra', at: [-1088, LN + 16, -896] },
    { t: 'ya', at: [0, LB + 48, 592] },
    { t: 'mh', at: [1152, LM, -480] },
    { t: 'h25', at: [-1008, 0, 256] }, { t: 'h25', at: [960, LE, 256] }, { t: 'h25', at: [-608, LN + 32, -928] }, { t: 'h25', at: [-384, LE, 960] },
    { t: 'h5', at: [-96, LN, -352] }, { t: 'h5', at: [0, LN, -352] }, { t: 'h5', at: [96, LN, -352] },
    { t: 'h5', at: [-24, LB, 240] }, { t: 'h5', at: [24, LB, 280] },
    { t: 'shard', at: [-352, LN, -100] }, { t: 'shard', at: [-352, LN, 0] }, { t: 'shard', at: [-352, LN, 100] },
    { t: 'shard', at: [352, LN, -100] }, { t: 'shard', at: [352, LN, 0] }, { t: 'shard', at: [352, LN, 100] },
    { t: 'shard', at: [-848, -16, -24] }, { t: 'shard', at: [-848, -16, 24] },
    { t: 'am_rl', at: [-160, LB, -120] }, { t: 'am_rl', at: [600, 256, -960] }, { t: 'am_rl', at: [-1152, LN, -500] },
    { t: 'am_rg', at: [384, LE, 960] }, { t: 'am_gl', at: [-1008, 0, -256] }, { t: 'am_sg', at: [1152, LE, -256] },
    { t: 'am_mg', at: [-416, LB, 440] }, { t: 'am_sg', at: [416, LB, 440] },
    { t: 'h50', at: [940, LE, 976] }, { t: 'am_rl', at: [820, LB, 960] }, { t: 'shard', at: [1000, LB, 500] }, { t: 'shard', at: [1000, LB, 560] },
    { t: 'h25', at: [-1000, 0, 560] }, { t: 'h25', at: [-1000, 0, 900] }, { t: 'am_sg', at: [-820, 0, 980] }, { t: 'am_gl', at: [-1150, 0, 760] },
    { t: 'am_rg', at: [1150, 256, -760] }, { t: 'h5', at: [880, 256, -790] }, { t: 'h5', at: [1000, 256, -790] },
  ],
  spawns: [
    { at: [-1024, 0, 192], yaw: 0 }, { at: [-640, 0, -96], yaw: -90 }, { at: [960, LE, -128], yaw: 90 },
    { at: [640, LE, 256], yaw: 90 }, { at: [-384, LN, -896], yaw: 180 }, { at: [256, LN, -900], yaw: 180 },
    { at: [-960, LN, -560], yaw: -90 }, { at: [-320, LB, 640], yaw: 0 }, { at: [320, LB, 520], yaw: 0 },
    { at: [-288, 0, 0], yaw: 90 }, { at: [288, 0, -200], yaw: -90 }, { at: [0, LE, 960], yaw: 180 },
    { at: [1150, LB, 600], yaw: 90 }, { at: [-1100, 0, 520], yaw: 180 }, { at: [1100, 256, -800], yaw: 90 },
  ],
};
