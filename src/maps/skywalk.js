// "Skywalk" — duel map in the spirit of Preacher's Aerowalk: narrow walkways hung across an
// open void, Red Armor at the foot of a flight of steps, Mega Health on a high ledge, the
// Rocket Launcher up on a ledge reached by teleporter or jump pad, or by strafe-jumping across
// two floating stepping stones from the Mega Health ledge. Falling off kills.
// Identity: a steel hangar shaft open to a violet night sky. Cyan key lights and walkway strips
// against cold blue-grey steel, an amber RA alcove, a red-orange glow rising out of the void.
//
//   NW (GL, L1) ═══════ north catwalk (L1) ═══ MH ledge (L2) ═══════ NE (RG, L1)
//        ║ stairs                    ▲ pad                              ║
//   W platform (L0) ══ bridge ══ CENTRE (L0) ══ ramp ══▶ E platform (L1)
//   upper RL ledge (L2)                ║ RA steps                       ║
//   SW (YA, L0) ══ stairs ══▶ RA platform (L-1, tele) ◀══ stairs ══ SE (SG, L0) ─ pad ▶ E
//
const T = {
  steel: 'metal_panels_pt_1_3',
  steel2: 'metal_panels_pt_3',
  plates: 'metal_panels_pt_2',
  grate: 'beam_panels_pt_2',
  grate2: 'beam_panels_pt_1',
  wall: 'concrete_wall_pt_11_3',
  wall2: 'concrete_wall_pt_10_1',
  corr: 'corrugated_steel_wall_pt_2_1',
  ceil: 'corrugated_steel_pt_4_1',
  rust: 'rusty_metal_pt_3',
  floor: 'metal_panels_pt_4',
  trim: 'proc_trim',
  hazard: 'proc_hazard',
  tech: 'proc_tech',
};

const L0 = 0, L1 = 160, L2 = 320, LB = -128;
const CYAN = 0x48d8ff, ICE = 0xc8ecff, AMBER = 0xffa848, VOID = 0xff5a2a, VIOLET = 0x8a6aff;

// walkway deck: plate top, trim sides, hazard bevel
const deck = (b, top = T.grate) => ({ box: b, tex: { top, side: T.trim, bottom: T.steel2 }, bevelTex: T.hazard });
// platform: thick slab with steel sides
const slab = (b, top = T.floor) => ({ box: b, tex: { top, side: T.steel, bottom: T.steel2 }, bevelTex: T.trim });

export default {
  name: 'Skywalk',
  description: 'Duel map after Aerowalk: walkways strung across an open void in a steel shaft under the night sky.',
  world: [-1088, -512, -960, 1088, 640, 960],
  defaults: { floor: T.floor, wall: T.wall, ceil: T.ceil },
  ambient: 0.16,
  sun: { dir: [0.45, 0.8, -0.4], color: [0.62, 0.78, 1.0], intensity: 1.05, sky: [0.32, 0.34, 0.62] },
  skyColor: { top: [0.04, 0.03, 0.12], horizon: [0.42, 0.2, 0.38] },
  look: {
    fog: [0.1, 0.1, 0.2], fogDensity: 0.00036,
    ambient: [0.66, 0.74, 1.0],
    sat: 0.52, tint: [0.98, 1.0, 1.04], brightness: 1.1,
    sunColor: [0.7, 0.82, 1.0],
    planet: { dir: [-0.5, 0.42, -0.75], size: 0.36, color: [0.95, 0.55, 0.42] },
    zones: [
      { b: [-960, -512, -832, 960, -140, 832], fog: [0.4, 0.12, 0.06], density: 0.0011 },   // the void glows from below
      { b: [-192, LB, 832, 192, 96, 928], fog: [0.34, 0.2, 0.08], density: 0.0006 },       // RA alcove
    ],
  },
  spaces: [
    // the shaft: open sky, no floor (the void)
    { b: [-960, -512, -832, 960, 640, 832], wall: T.wall, sky: true, strip: [{ y: 360, h: 6, color: VOID }, { y: 820, h: 5, color: CYAN }] },
    // RA alcove at the foot of the steps
    { b: [-192, LB, 832, 192, 96, 928], floor: T.plates, wall: T.corr, ceil: T.ceil, trim: { h: 16, tex: T.hazard }, strip: { y: 150, h: 5, color: AMBER } },
    // MH alcove above the north catwalk
    { b: [-160, L2, -928, 160, 480, -832], floor: T.plates, wall: T.tech, ceil: T.ceil, trim: { h: 12, tex: T.trim }, strip: { y: 120, h: 4, color: CYAN } },
    // upper RL alcove in the west wall
    { b: [-1024, L2, -192, -960, 464, 192], floor: T.plates, wall: T.corr, ceil: T.ceil, trim: { h: 12, tex: T.hazard } },
    // east doorway room behind the raised east platform
    { b: [960, L1, -224, 1056, 352, 224], floor: T.floor, wall: T.wall2, ceil: T.ceil, trim: { h: 16, tex: T.trim }, strip: { y: 150, h: 4, color: CYAN } },
  ],
  solids: [
    // ---- main level (L0): west platform, centre, bridge
    slab([-960, -96, -448, -608, L0, 448]),
    slab([-160, -64, -160, 160, L0, 160], T.plates),
    deck([-608, -20, -48, -160, L0, 48]),
    // centre landmark: four light posts and a hanging beacon ring over the MH pad
    { box: [-160, L0, -160, -136, 96, -136], tex: T.trim }, { box: [136, L0, -160, 160, 96, -136], tex: T.trim },
    { box: [-160, L0, 136, -136, 96, 160], tex: T.trim }, { box: [136, L0, 136, 160, 96, 160], tex: T.trim },
    { box: [-162, 96, -162, -134, 102, -134], tex: T.trim, bevel: false, emit: CYAN }, { box: [134, 96, -162, 162, 102, -134], tex: T.trim, bevel: false, emit: CYAN },
    { box: [-162, 96, 134, -134, 102, 162], tex: T.trim, bevel: false, emit: CYAN }, { box: [134, 96, 134, 162, 102, 162], tex: T.trim, bevel: false, emit: CYAN },
    // centre platform underside: a tapering pylon into the void
    { box: [-96, -320, -96, 96, -64, 96], tex: { top: T.steel2, side: T.steel }, bevelTex: T.trim },
    { box: [-60, -360, -60, 60, -320, 60], tex: T.trim, bevel: false, emit: VOID },
    // ---- ramp from the centre up to the raised east platform (L1)
    { ramp: [160, L0, -48, 608, L1, 48], up: '+x', tex: { top: T.grate, side: T.trim } },
    { box: [160, L0 - 24, -48, 608, L0, 48], tex: { top: T.steel2, side: T.trim }, bevel: false },
    slab([608, 64, -448, 960, L1, 448]),
    // ---- north: NW and NE platforms joined by a catwalk along the north wall (L1)
    slab([-960, 96, -832, -560, L1, -560]),
    slab([560, 96, -832, 960, L1, -448]),
    deck([-560, L1 - 24, -832, 560, L1, -736]),
    // west platform -> NW stairs, resting on the platform and running out over the void
    { stairs: [-960, L0, -560, -864, L1, -240], up: '-z', tex: T.trim },
    // MH ledge above the catwalk (the alcove floor continues it)
    slab([-160, 256, -832, 160, L2, -704], T.plates),
    { box: [-164, 250, -708, 164, 256, -700], tex: T.trim, bevel: false, emit: CYAN },
    // ---- upper RL ledge on the west wall (L2)
    slab([-960, 256, -192, -800, L2, 192], T.plates),
    { box: [-804, 250, -196, -796, 256, 196], tex: T.trim, bevel: false, emit: AMBER },
    // ---- south: RA steps down from the centre, RA platform, SW / SE platforms
    { stairs: [-64, LB, 160, 64, L0, 480], up: '-z', tex: T.trim },
    slab([-192, -192, 480, 192, LB, 832], T.plates),
    slab([-960, -64, 448, -560, L0, 832]),
    slab([560, -64, 448, 960, L0, 832]),
    { stairs: [-560, LB, 600, -192, L0, 712], up: '-x', tex: T.trim },
    { stairs: [192, LB, 600, 560, L0, 712], up: '+x', tex: T.trim },
    // cover
    { box: [-720, L0, -96, -656, 72, -32], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    { box: [-720, L0, 32, -656, 48, 96], tex: { top: T.trim, side: T.rust } },
    { box: [720, L1, -64, 784, L1 + 64, 64], tex: { top: T.trim, side: T.rust }, bevelTex: T.hazard },
    { box: [-160, L1, -832, -96, L1 + 40, -800], tex: { top: T.trim, side: T.rust } },
    { box: [-32, LB, 720, 32, LB + 16, 784], tex: { top: T.plates, side: T.trim }, bevelTex: T.hazard },   // RA dais
    // ---- stepping stones: a strafe-jump route from the MH ledge to the upper RL ledge (L2) ----
    { box: [-448, 272, -608, -352, 304, -512], tex: { top: T.plates, side: T.steel, bottom: T.steel2 }, bevelTex: T.hazard },
    { box: [-452, 264, -612, -348, 272, -508], tex: T.trim, bevel: false, emit: CYAN },
    { box: [-736, 272, -352, -640, 304, -256], tex: { top: T.plates, side: T.steel, bottom: T.steel2 }, bevelTex: T.hazard },
    { box: [-740, 264, -356, -636, 272, -252], tex: T.trim, bevel: false, emit: CYAN },
    // ---- supports: struts and tapering pylons dropping into the void under every platform ----
    { box: [-816, -480, -336, -752, -96, -272], tex: { top: T.trim, side: T.steel } }, { box: [-816, -480, 272, -752, -96, 336], tex: { top: T.trim, side: T.steel } },
    { box: [752, -480, -336, 816, 64, -272], tex: { top: T.trim, side: T.steel } }, { box: [752, -480, 272, 816, 64, 336], tex: { top: T.trim, side: T.steel } },
    { box: [-792, -500, -312, -776, -480, -296], tex: T.trim, bevel: false, emit: VOID }, { box: [776, -500, 296, 792, -480, 312], tex: T.trim, bevel: false, emit: VOID },
    { box: [-32, -480, 600, 32, -192, 664], tex: { top: T.trim, side: T.steel } },
    { box: [-800, -400, 600, -720, -64, 680], tex: { top: T.trim, side: T.steel } }, { box: [720, -400, 600, 800, -64, 680], tex: { top: T.trim, side: T.steel } },
    { box: [-800, -400, -760, -720, 96, -680], tex: { top: T.trim, side: T.steel } }, { box: [720, -400, -760, 800, 96, -680], tex: { top: T.trim, side: T.steel } },
    // bridge underside truss
    { box: [-600, -56, -12, -168, -20, 12], tex: { top: T.trim, side: T.trim, bottom: T.steel2 } },
    // ---- shaft architecture: chamfered upper corners, cross trusses, ribs on the walls ----
    { wedge: [-960, 360, -832, -800, 640, -672], keep: '-x-z', tex: T.wall2 },
    { wedge: [800, 360, -832, 960, 640, -672], keep: '+x-z', tex: T.wall2 },
    { wedge: [-960, 360, 672, -800, 640, 832], keep: '-x+z', tex: T.wall2 },
    { wedge: [800, 360, 672, 960, 640, 832], keep: '+x+z', tex: T.wall2 },
    { box: [-960, 600, -440, 960, 624, -408], tex: { top: T.trim, side: T.trim, bottom: T.steel2 } },
    { box: [-960, 600, 408, 960, 624, 440], tex: { top: T.trim, side: T.trim, bottom: T.steel2 } },
    { box: [-960, -512, -448, -928, 640, -416], tex: T.trim }, { box: [-960, -512, 416, -928, 640, 448], tex: T.trim },
    { box: [928, -512, -448, 960, 640, -416], tex: T.trim }, { box: [928, -512, 416, 960, 640, 448], tex: T.trim },
    { box: [-448, -512, -832, -416, 640, -800], tex: T.trim }, { box: [416, -512, -832, 448, 640, -800], tex: T.trim },
    { box: [-448, -512, 800, -416, 640, 832], tex: T.trim }, { box: [416, -512, 800, 448, 640, 832], tex: T.trim },
    // east doorway and RA alcove frames
    { arch: [960, L1, -224, 1056, 352, 224], axis: 'x', tex: { top: T.trim, side: T.steel } },
    { arch: [-192, LB, 832, 192, 96, 928], axis: 'z', tex: { top: T.trim, side: T.steel }, thick: 8 },
    // hanging gantry over the shaft (landmark, out of reach)
    { box: [-12, 520, -832, 12, 544, 832], tex: { top: T.trim, side: T.trim, bottom: T.steel2 } },
    { box: [-960, 520, -12, 960, 544, 12], tex: { top: T.trim, side: T.trim, bottom: T.steel2 } },
    { box: [-48, 480, -48, 48, 520, 48], tex: { top: T.trim, side: T.tech } },
    { box: [-40, 470, -40, 40, 480, 40], tex: T.trim, bevel: false, emit: ICE },
  ],
  jumppads: [
    { at: [0, L0, -104], target: [0, L2 + 80, -790] },          // centre -> MH ledge
    { at: [-690, L0, 170], target: [-880, 520, 60] },        // west platform -> upper RL ledge
    { at: [860, L0, 760], target: [780, L1 + 70, 300] },         // SE -> east platform
  ],
  teleporters: [
    { at: [-140, LB, 530], dest: [-880, L2, 100], yaw: -90 },    // RA platform -> upper RL ledge
  ],
  lights: [
    // centre and bridges
    [0, 110, 0, ICE, 420, 1.0, { fixture: false }], [0, -300, 0, VOID, 420, 1.3, { fixture: false }],
    [-400, 60, 0, CYAN, 300, 0.7, { fixture: false }], [380, 140, 0, CYAN, 300, 0.7, { fixture: false }],
    [0, 455, 0, ICE, 560, 1.0, { fixture: false }],
    // west platform and the upper RL ledge
    [-935, 120, 0, ICE, 460, 1.0], [-935, 120, -380, CYAN, 320, 0.8], [-935, 420, 0, AMBER, 360, 1.1],
    // east platform and doorway
    [935, 260, 0, ICE, 460, 1.0], [1030, 320, 0, CYAN, 260, 0.8],
    // north catwalk, MH alcove, corners
    [-500, 260, -808, CYAN, 360, 0.9], [500, 260, -808, CYAN, 360, 0.9], [0, 456, -880, ICE, 340, 1.1],
    [-935, 290, -700, ICE, 380, 0.9], [935, 290, -700, ICE, 380, 0.9],
    // south: RA alcove amber, SW / SE
    [0, 70, 905, AMBER, 420, 1.4], [-140, LB + 40, 530, VIOLET, 240, 1.2, { fixture: false }],
    [-935, 120, 640, ICE, 420, 0.9], [935, 120, 640, ICE, 420, 0.9],
    // the void glow under the walkways
    [-600, -260, 500, VOID, 520, 1.1, { fixture: false }], [600, -260, -500, VOID, 520, 1.1, { fixture: false }],
    [-560, 340, -420, CYAN, 300, 0.8, { fixture: false }],
  ],
  items: [
    { t: 'ra', at: [0, LB + 16, 752] },
    { t: 'mh', at: [0, L2, -790] },
    { t: 'rl', at: [-990, L2, 0] },
    { t: 'gl', at: [-760, L1, -700] },
    { t: 'rg', at: [820, L1, -700] },
    { t: 'sg', at: [760, L0, 640] },
    { t: 'ya', at: [-760, L0, 640] },
    { t: 'h25', at: [-860, L0, 300] }, { t: 'h25', at: [880, L1, -300] }, { t: 'h25', at: [880, L1, 300] }, { t: 'h25', at: [-900, L1, -800] },
    { t: 'h5', at: [-96, L0, 96] }, { t: 'h5', at: [96, L0, 96] }, { t: 'h5', at: [-300, L1, -784] }, { t: 'h5', at: [300, L1, -784] },
    { t: 'shard', at: [-480, L0, 0] }, { t: 'shard', at: [-320, L0, 0] }, { t: 'shard', at: [100, LB, 560] }, { t: 'shard', at: [-100, LB, 560] },
    { t: 'am_rl', at: [-860, L0, -100] }, { t: 'am_rl', at: [840, L1, 160] }, { t: 'am_rl', at: [0, LB, 860] },
    { t: 'am_rg', at: [0, L1, -784] }, { t: 'am_gl', at: [-860, L1, -640] }, { t: 'am_sg', at: [860, L0, 520] },
    { t: 'am_mg', at: [-860, L0, 760] }, { t: 'am_gl', at: [700, L1, -600] },
    { t: 'shard', at: [-400, 304, -560] }, { t: 'shard', at: [-688, 304, -304] },
  ],
  spawns: [
    { at: [-860, L0, 160], yaw: -90 }, { at: [-860, L0, -200], yaw: -90 }, { at: [860, L1, 200], yaw: 90 },
    { at: [860, L1, -200], yaw: 90 }, { at: [-700, L1, -760], yaw: -90 }, { at: [700, L1, -760], yaw: 90 },
    { at: [-700, L0, 700], yaw: -90 }, { at: [700, L0, 700], yaw: 90 }, { at: [120, LB, 760], yaw: 0 }, { at: [0, L0, 100], yaw: 180 },
  ],
};
