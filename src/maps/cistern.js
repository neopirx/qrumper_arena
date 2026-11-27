// "Cistern" — duel map: an old stone waterworks around a tall open-sky hub. The hub is the fast,
// exposed shortcut; a full ring of decks runs round it on the upper level, so you can always
// circle, drop in anywhere, or climb back out by stairs, pad, teleporter or rocket jump.
// Control triangle on three heights: Red Armor on a perch in the hub's north wall (top), Mega
// Health on a dais in the pump room (middle, seen from the perch through a low window in the hub
// wall), Yellow Armor in the west hall; the Rocket Launcher sits in the pit where routes cross.
// Movement tech: the MH ramp launches rocket jumps onto the pump-room catwalk; one hub teleporter
// drops you out mid-air over the cistern, and air-strafing lands you on a shelf you can't walk to.
// Identity: wet grey-green stone and verdigris under a pale sky, teal water glow low down, warm
// sodium lamps up high, a red-lit armour perch and a green-lit MH dais. Bright, even light.
//
//   NW ROOM (L2) ════════ GALLERY (L2) ═══ RA PERCH ═══ GALLERY ════════ NE LOFT (L2, RG)
//      ║ stairs                ┌──────── RING DECKS (L2) ────────┐       ║ drop ▲ pad
//   W HALL (L1, YA) ═ stairs ═ │   HUB (L0, sky)  pit (LB, RL)    │ ═ stairs ═ E HALL (L1, SG)
//      ║ ledge / stairs        └─ tele ▼cistern    tele ▲loft ───┘ window     ║ stairs
//   CISTERN (LB, GL, shelf) ══ COURT (LB) ══ PUMP ROOM (L0: MH dais L1, ramp, catwalk L2)
//
const T = {
  floor: 'g/str_stoneflr4',
  floor2: 'g/str_stoneflr6',
  floorLow: 'g/str_stoneflr5',
  tiles: 'tiles_floor_pt_7',
  brick: 'g/str_stonebrk3',
  brick2: 'g/str_stonebrk4',
  brickDark: 'g/str_stonebrk6',
  wall: 'g/str_stonewall3',
  wallWet: 'g/str_stonewall7',
  stone: 'g/str_stonegen2',
  stone2: 'g/str_stonegen4',
  masonry: 'stone_wall_pt_2',
  conc: 'concrete_wall_pt_3',
  grate: 'beam_panels_pt_2',
  metal: 'g/str_metalgen1',
  metal2: 'g/str_metalgen3',
  metalFloor: 'g/str_metalflr3',
  panel: 'g/str_metalpan5',
  rust: 'rusty_metal_pt_7',
  ceil: 'g/str_stonegen4',
  trim: 'proc_trim',
  hazard: 'proc_hazard',
};

const LB = -96, L0 = 0, L1 = 128, L2 = 256, PERCH = 296, TOP = 704;
const WATER = 0x38d8c8, SODIUM = 0xffb058, WARM = 0xffd09a, RED = 0xff3a24, GREEN = 0x6aff7a, DAWN = 0xc8dcff;

const col = (x, z, y0, y1, r = 24, side = T.stone) => ({ box: [x - r, y0, z - r, x + r, y1, z + r], tex: { top: T.metal, side }, bevelTex: T.metal, bevel: Math.round(r * 0.5) });
const band = (x, z, y, r, color) => ({ box: [x - r, y, z - r, x + r, y + 8, z + r], tex: T.trim, bevel: false, emit: color });
const plinth = (x, z, y, r = 40, h = 16, top = T.metalFloor) => ({ box: [x - r, y, z - r, x + r, y + h, z + r], tex: { top, side: T.trim }, bevelTex: T.metal });
const glow = (b, color) => ({ box: b, tex: T.trim, bevel: false, emit: color });
const deck = (b, top = T.grate) => ({ box: b, tex: { top, side: T.trim, bottom: T.metal2 }, bevelTex: T.metal });

export default {
  name: 'Cistern',
  description: 'Duel waterworks: a tall open hub ringed by upper decks, armour perch over the rocket pit, mega dais behind a window, mid-air teleporter shelf.',
  world: [-1152, -224, -1088, 1152, TOP + 64, 1088],
  defaults: { floor: T.floor, wall: T.brick, ceil: T.ceil },
  ambient: 0.22,
  sun: { dir: [0.4, 0.75, 0.55], color: [0.85, 0.9, 1.0], intensity: 1.2, sky: [0.42, 0.52, 0.62] },
  skyColor: { top: [0.16, 0.24, 0.36], horizon: [0.72, 0.76, 0.74] },
  look: {
    fog: [0.2, 0.26, 0.28], fogDensity: 0.00032,
    ambient: [0.78, 0.9, 0.95],
    sat: 0.52, tint: [0.98, 1.02, 1.02], brightness: 1.12,
    sunColor: [0.86, 0.92, 1.0],
    zones: [
      { b: [-1088, LB, 448, -576, 448, 1024], fog: [0.08, 0.26, 0.26], density: 0.0007 },   // cistern: teal water haze
      { b: [-128, PERCH, -576, 128, 480, -448], fog: [0.28, 0.1, 0.08], density: 0.0006 },  // armour perch
      { b: [256, L0, 576, 1088, 448, 1024], fog: [0.1, 0.22, 0.12], density: 0.0005 },     // pump room
    ],
  },
  spaces: [
    // ---- HUB (L0): tall, open sky, ring decks on all four walls at L2, the rocket pit below ----
    { b: [-448, L0, -448, 448, TOP, 448], floor: T.floor, wall: T.masonry, sky: true, trim: { h: 20, tex: T.trim }, strip: [{ y: 200, h: 5, color: WATER }, { y: 470, h: 5, color: SODIUM }] },
    { b: [-192, LB, -192, 192, L0, 192], floor: T.floorLow, wall: T.wallWet, sky: true, strip: { y: 40, h: 5, color: WATER } },
    { b: [-576, L0, -96, -448, 232, 96], floor: T.trim, wall: T.brickDark, ceil: T.stone },        // stairs up to the west hall
    { b: [448, L0, -96, 576, 232, 96], floor: T.trim, wall: T.brickDark, ceil: T.stone },          // stairs up to the east hall
    { b: [-160, LB, 448, 32, 232, 576], floor: T.trim, wall: T.brickDark, ceil: T.stone },         // stairs down to the court
    { b: [256, L1, 448, 448, 232, 576], floor: T.trim, wall: T.trim, ceil: T.trim },               // low window onto the MH dais
    { b: [-576, L2, 192, -448, 400, 320], floor: T.trim, wall: T.brickDark, ceil: T.stone },       // west deck door
    { b: [448, L2, -320, 576, 400, -192], floor: T.trim, wall: T.brickDark, ceil: T.stone },       // east deck door

    // ---- north: armour perch in the hub wall, gallery behind it, NW room, rail loft ----
    { b: [-128, PERCH, -576, 128, 480, -448], floor: T.floor2, wall: T.brickDark, ceil: T.stone, trim: { h: 16, tex: T.trim }, strip: { y: 120, h: 5, color: RED } },
    { b: [-576, L2, -704, 576, 448, -576], floor: T.floor2, wall: T.brick2, ceil: T.ceil, trim: { h: 16, tex: T.trim }, crown: { h: 20, tex: T.trim }, strip: { y: 150, h: 4, color: SODIUM } },
    { b: [-1088, L2, -1024, -576, 480, -576], floor: T.floor, wall: T.brickDark, ceil: T.ceil, trim: { h: 20, tex: T.trim }, strip: { y: 170, h: 4, color: WARM } },
    { b: [576, L2, -1024, 1088, 480, -576], floor: T.metalFloor, wall: T.panel, ceil: T.ceil, trim: { h: 16, tex: T.hazard }, strip: { y: 170, h: 4, color: SODIUM } },

    // ---- west hall (L1): stairs to the NW room and to the west deck, open ledge over the cistern ----
    { b: [-1088, L1, -448, -576, 384, 448], floor: T.floor, wall: T.wall, ceil: T.ceil, trim: { h: 20, tex: T.trim }, crown: { h: 20, tex: T.trim }, strip: { y: 200, h: 4, color: WARM } },
    { b: [-1088, L2, -576, -960, 448, -448], floor: T.trim, wall: T.brickDark, ceil: T.stone },

    // ---- east hall (L1): stairs to the east deck and the catwalk, pad up to the loft, the loft's drop ----
    { b: [576, L1, -448, 1088, 384, 448], floor: T.floor2, wall: T.wall, ceil: T.ceil, trim: { h: 20, tex: T.trim }, crown: { h: 20, tex: T.trim }, strip: { y: 200, h: 4, color: WARM } },
    { b: [832, L1, -576, 1088, 448, -448], floor: T.metalFloor, wall: T.panel, ceil: T.stone },
    { b: [960, L2, 448, 1088, 416, 576], floor: T.trim, wall: T.brickDark, ceil: T.stone },        // door onto the catwalk

    // ---- lower floor (LB): the cistern and the court ----
    { b: [-1088, LB, 448, -576, 448, 1024], floor: T.floorLow, wall: T.wallWet, ceil: T.stone2, trim: { h: 24, tex: T.metal2 }, strip: [{ y: 60, h: 4, color: WATER }, { y: 380, h: 4, color: SODIUM }] },
    { b: [-576, LB, 704, -448, 96, 832], floor: T.trim, wall: T.brickDark, ceil: T.stone },
    { b: [-448, LB, 576, 128, 256, 1024], floor: T.floor, wall: T.brick, ceil: T.ceil, trim: { h: 20, tex: T.trim }, crown: { h: 20, tex: T.trim }, strip: { y: 200, h: 4, color: WATER } },
    { b: [128, LB, 832, 256, 160, 960], floor: T.trim, wall: T.brickDark, ceil: T.stone },

    // ---- pump room (L0): MH dais (L1) by the window, ramp up to it, catwalk (L2) along the east wall ----
    { b: [256, L0, 576, 1088, 448, 1024], floor: T.grate, wall: T.conc, ceil: T.ceil, trim: { h: 16, tex: T.hazard }, crown: { h: 20, tex: T.trim }, strip: { y: 300, h: 4, color: GREEN } },
  ],
  solids: [
    // ===== HUB =====
    // ring decks: full circuit at L2, open to the hub on the inside
    deck([-448, L2 - 16, -448, 448, L2, -320]), deck([-448, L2 - 16, 320, 448, L2, 448]),
    deck([-448, L2 - 16, -320, -320, L2, 320]), deck([320, L2 - 16, -320, 448, L2, 320]),
    glow([-322, L2 - 22, -322, 322, L2 - 16, -318], WATER), glow([-322, L2 - 22, 318, 322, L2 - 16, 322], WATER),
    glow([-322, L2 - 22, -318, -318, L2 - 16, 318], WATER), glow([318, L2 - 22, -318, 322, L2 - 16, 318], WATER),
    // deck columns (cover on the hub floor)
    ...[[-320, -320], [320, -320], [-320, 320], [320, 320], [-160, -320], [160, -320], [-160, 320], [160, 320]].map(([x, z]) => col(x, z, L0, L2 - 16, 18, T.masonry)),
    // pit: ramps out west and east (ramp jumps), RL plinth, wet rim
    { ramp: [-192, LB, -64, -48, L0, 64], up: '-x', tex: T.stone },
    { ramp: [48, LB, -64, 192, L0, 64], up: '+x', tex: T.stone },
    plinth(0, 0, LB, 36, 12),
    glow([-192, LB, -192, 192, LB + 2, -184], WATER), glow([-192, LB, 184, 192, LB + 2, 192], WATER),
    { box: [-192, -6, -200, 192, L0, -192], tex: T.metal2, bevel: false }, { box: [-192, -6, 192, 192, L0, 200], tex: T.metal2, bevel: false },
    // stairs out of the hub, with arch frames
    { stairs: [-576, L0, -96, -448, L1, 96], up: '-x', tex: T.trim },
    { stairs: [448, L0, -96, 576, L1, 96], up: '+x', tex: T.trim },
    { stairs: [-160, LB, 448, 32, L0, 576], up: '-z', tex: T.trim },
    { arch: [-576, L0, -96, -448, 232, 96], axis: 'x', tex: { top: T.metal, side: T.stone } },
    { arch: [448, L0, -96, 576, 232, 96], axis: 'x', tex: { top: T.metal, side: T.stone } },
    // teleporter pads under the deck corners
    glow([-416, L0, 352, -352, L0 + 2, 416], 0x6a8cff), glow([352, L0, -416, 416, L0 + 2, -352], 0x6a8cff),
    // aqueduct beam high across the sky
    { box: [-448, 600, -32, 448, 640, 32], tex: { top: T.stone, side: T.brick2, bottom: T.stone2 } },
    { box: [-448, 636, -28, 448, 640, 28], tex: T.trim, bevel: false, emit: WATER },

    // ===== NORTH =====
    // armour perch: red altar, lit lip; back stairs down to the gallery
    { box: [-64, PERCH, -560, 64, PERCH + 12, -496], tex: { top: T.tiles, side: T.trim }, bevelTex: T.metal },
    glow([-128, PERCH - 6, -452, 128, PERCH, -448], RED),
    { stairs: [-128, L2, -640, 128, PERCH, -576], up: '+z', tex: T.trim },
    // gallery pilasters
    ...[-448, -288, 288, 448].map((x) => col(x, -688, L2, 448, 16, T.brick2)),
    // NW room: braziers, corner wedge
    { wedge: [-1088, L2, -1024, -992, 480, -928], keep: '-x-z', tex: T.brickDark },
    plinth(-700, -960, L2, 24, 40, T.metal), band(-700, -960, L2 + 40, 18, SODIUM),
    plinth(-1040, -640, L2, 24, 40, T.metal), band(-1040, -640, L2 + 40, 18, SODIUM),
    // rail loft: RG plinth, crates
    plinth(960, -864, L2, 36, 16),
    { box: [1008, L2, -640, 1088, L2 + 64, -576], tex: { top: T.metal, side: T.rust }, bevelTex: T.hazard },
    { box: [640, L2, -1024, 720, L2 + 48, -964], tex: { top: T.metal, side: T.rust }, bevelTex: T.hazard },

    // ===== WEST HALL =====
    { box: [-1088, L1, -448, -960, L2, -384], tex: { top: T.floor, side: T.wall } },
    { stairs: [-1088, L1, -384, -960, L2, 0], up: '-z', tex: T.trim },
    { stairs: [-704, L1, 192, -576, L2, 320], up: '+x', tex: T.trim },
    plinth(-832, 0, L1, 40, 16),
    col(-704, -192, L1, 384, 20), col(-960, 192, L1, 384, 20),
    col(-912, 432, L1, 200, 14, T.brickDark), col(-640, 432, L1, 200, 14, T.brickDark),
    glow([-1088, L1 + 70, 440, -576, L1 + 74, 448], WATER),

    // ===== EAST HALL =====
    plinth(832, 0, L1, 40, 16),
    { stairs: [576, L1, -320, 704, L2, -192], up: '-x', tex: T.trim },
    { stairs: [960, L1, 192, 1088, L2, 448], up: '+z', tex: T.trim },
    col(768, -256, L1, 384, 20), col(768, 256, L1, 384, 20),
    // walljump stack by the east wall
    { box: [1024, L1, -96, 1088, L1 + 80, 96], tex: { top: T.metal, side: T.rust }, bevelTex: T.hazard },
    { box: [992, L1, -64, 1024, L1 + 40, 64], tex: { top: T.metal, side: T.rust } },

    // ===== CISTERN =====
    { box: [-1088, LB, 448, -960, L1, 512], tex: { top: T.floor, side: T.wallWet } },
    { stairs: [-1088, LB, 512, -960, L1, 1024], up: '-z', tex: T.trim },
    // the teleporter shelf high on the south wall: only the mid-air exit (or a rocket jump) gets you up
    deck([-960, 144, 928, -784, 160, 1024], T.metalFloor),
    glow([-960, 136, 926, -784, 144, 928], SODIUM),
    // GL island over the glowing basin, stepping blocks
    glow([-912, LB, 560, -624, LB + 2, 848], WATER),
    plinth(-768, 704, LB, 72, 32, T.stone),
    { box: [-904, LB, 584, -856, LB + 16, 632], tex: { top: T.stone, side: T.metal2 } },
    { box: [-680, LB, 776, -632, LB + 16, 824], tex: { top: T.stone, side: T.metal2 } },
    col(-960, 600, LB, 448, 22, T.wallWet), col(-640, 600, LB, 448, 22, T.wallWet),
    band(-960, 600, 120, 26, WATER), band(-640, 600, 120, 26, WATER),

    // ===== COURT =====
    { box: [-232, LB, 728, -88, LB + 40, 872], tex: { top: T.metal, side: T.stone }, bevelTex: T.metal },
    glow([-220, LB + 40, 740, -100, LB + 42, 860], WATER),
    { box: [-448, LB, 960, 128, LB + 40, 1024], tex: { top: T.floor2, side: T.brick2 }, bevelTex: T.metal },
    { stairs: [-448, LB, 912, -352, LB + 40, 960], up: '+z', tex: T.trim },
    { stairs: [32, LB, 912, 128, LB + 40, 960], up: '+z', tex: T.trim },
    col(-352, 640, LB, 256, 20, T.brick2), col(64, 640, LB, 256, 20, T.brick2),
    { stairs: [128, LB, 832, 256, L0, 960], up: '+x', tex: T.trim },

    // ===== PUMP ROOM =====
    // MH dais level with the hub window, ramp up from the floor (ramp jumps, rocket jumps to the catwalk)
    { box: [256, L0, 576, 576, L1, 832], tex: { top: T.metalFloor, side: T.conc }, bevelTex: T.hazard },
    { ramp: [576, L0, 640, 832, L1, 832], up: '-x', tex: T.metalFloor },
    glow([400, L1, 688, 496, L1 + 2, 720], GREEN),
    // catwalk along the east wall at L2, open to the room
    deck([960, L2 - 16, 576, 1088, L2, 1024]),
    glow([956, L2 - 22, 576, 960, L2 - 16, 1024], GREEN),
    // pumps
    ...[[680, 940], [840, 940]].flatMap(([x, z]) => [
      { box: [x - 36, L0, z - 36, x + 36, 112, z + 36], tex: { top: T.metal, side: T.rust }, bevelTex: T.metal },
      { box: [x - 40, 76, z - 40, x + 40, 84, z + 40], tex: T.trim, bevel: false, emit: GREEN },
      { box: [x - 8, 112, z - 8, x + 8, 448, z + 8], tex: T.metal2, bevel: false },
    ]),
  ],
  jumppads: [
    { at: [0, L0, 256], land: [0, L2, 392], arc: 80 },          // hub floor -> south deck
    { at: [960, L1, -320], land: [880, L2, -720], arc: 72 },    // east hall -> rail loft
  ],
  teleporters: [
    { at: [-384, L0, 384], dest: [-680, 380, 780], yaw: 180 },  // hub -> mid-air over the cistern (strafe left onto the shelf)
    { at: [384, L0, -384], dest: [800, L2, -800], yaw: 90 },    // hub -> rail loft
  ],
  // [x, y, z, colorHex, radius, intensity, { fixture: false }?]
  lights: [
    // hub: bright and even, warm up high, teal low
    [-440, 400, 0, SODIUM, 620, 1.2], [440, 400, 0, SODIUM, 620, 1.2], [0, 400, -440, SODIUM, 620, 1.1], [0, 400, 440, SODIUM, 620, 1.1],
    [-300, 180, -300, WARM, 380, 0.8, { fixture: false }], [300, 180, -300, WARM, 380, 0.8, { fixture: false }], [-300, 180, 300, WARM, 380, 0.8, { fixture: false }], [300, 180, 300, WARM, 380, 0.8, { fixture: false }],
    [0, -40, 0, WATER, 360, 1.3, { fixture: false }], [0, 560, 0, DAWN, 700, 0.9, { fixture: false }],
    [-384, 60, 384, 0x6a8cff, 200, 1.0, { fixture: false }], [384, 60, -384, 0x6a8cff, 200, 1.0, { fixture: false }],
    // north
    [0, 440, -512, RED, 300, 0.9], [-300, 420, -640, WARM, 420, 1.0], [300, 420, -640, WARM, 420, 1.0],
    [-832, 450, -800, WARM, 520, 1.1], [832, 450, -800, SODIUM, 520, 1.1],
    // west / east halls
    [-832, 350, -200, WARM, 480, 1.1], [-832, 350, 250, WARM, 480, 1.1], [-1060, 300, -420, SODIUM, 280, 0.8],
    [832, 350, -200, WARM, 480, 1.1], [832, 350, 250, WARM, 480, 1.1], [960, 420, -512, SODIUM, 300, 0.9],
    // cistern
    [-768, 400, 704, WARM, 560, 1.1], [-768, -60, 704, WATER, 420, 1.3, { fixture: false }], [-736, 300, 990, SODIUM, 360, 0.9], [-1060, 250, 900, DAWN, 300, 0.7],
    // court
    [-160, 230, 640, WATER, 460, 1.0], [-160, 230, 990, WARM, 460, 1.1], [-160, -40, 800, WATER, 260, 0.9, { fixture: false }],
    // pump room
    [448, 400, 704, GREEN, 460, 1.0], [448, 200, 704, GREEN, 280, 1.0, { fixture: false }], [720, 400, 800, WARM, 520, 1.0], [1024, 400, 800, SODIUM, 360, 0.9],
  ],
  items: [
    { t: 'rl', at: [0, LB + 12, 0] },
    { t: 'ra', at: [0, PERCH + 12, -528] },
    { t: 'mh', at: [448, L1, 704] },
    { t: 'ya', at: [-832, L1 + 16, 0] },
    { t: 'rg', at: [960, L2 + 16, -864] },
    { t: 'gl', at: [-768, LB + 32, 704] },
    { t: 'sg', at: [832, L1 + 16, 0] },
    // health: route glue on every loop
    { t: 'h50', at: [-872, 160, 976] },
    { t: 'h25', at: [-1000, L1, 300] }, { t: 'h25', at: [1000, L1, -160] }, { t: 'h25', at: [-300, LB + 40, 992] }, { t: 'h25', at: [0, LB + 40, 992] },
    { t: 'h25', at: [-832, L2, -700] }, { t: 'h25', at: [1024, L2, 900] },
    { t: 'h5', at: [-80, L2, 384] }, { t: 'h5', at: [0, L2, 384] }, { t: 'h5', at: [80, L2, 384] },
    { t: 'h5', at: [-120, LB, -150] }, { t: 'h5', at: [120, LB, 150] },
    // armour shards on the west and east decks, and the gallery
    { t: 'shard', at: [-384, L2, -96] }, { t: 'shard', at: [-384, L2, 0] }, { t: 'shard', at: [-384, L2, 96] },
    { t: 'shard', at: [384, L2, -96] }, { t: 'shard', at: [384, L2, 0] }, { t: 'shard', at: [384, L2, 96] },
    { t: 'shard', at: [-200, L2, -640] }, { t: 'shard', at: [200, L2, -640] },
    // ammo next to the weapons it feeds, never on the majors
    { t: 'am_rl', at: [-920, 160, 976] }, { t: 'am_rl', at: [400, L0, 960] }, { t: 'am_rl', at: [-1000, L2, -960] },
    { t: 'am_rg', at: [720, L2, -660] }, { t: 'am_rg', at: [-300, L2, -640] },
    { t: 'am_gl', at: [-1000, LB, 600] }, { t: 'am_sg', at: [640, L1, 380] }, { t: 'am_sg', at: [-380, LB, 680] },
    { t: 'am_mg', at: [-640, L1, -380] },
  ],
  spawns: [
    { at: [-960, L1, 280], yaw: -90 }, { at: [-680, L1, -380], yaw: 180 },
    { at: [880, L1, 340], yaw: 90 }, { at: [680, L1, -100], yaw: 180 },
    { at: [-880, L1, -260], yaw: -90 }, { at: [700, L2, -760], yaw: 90 },
    { at: [-420, L2, -660], yaw: -90 }, { at: [420, L2, -660], yaw: 90 },
    { at: [-880, LB, 520], yaw: 180 }, { at: [-300, LB, 760], yaw: 0 },
    { at: [-380, LB, 860], yaw: 0 }, { at: [420, L0, 900], yaw: -90 },
  ],
};
