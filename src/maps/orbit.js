// "Orbit" — FFA / duel map in open space, in the spirit of the classic floating-platform arenas:
// a station core hanging over a gas giant, its outlying decks joined by jump pads, a bridge with a
// gap to jump, and stepping stones for a strafe-jump route. Falling off kills.
// Story: a half-evacuated refuelling station. The core still glows inside its cage, a dropship
// is docked at the armour deck with its boarding ramp down, the launch bay's rails point at
// nothing, and the comm array on the antenna tower keeps calling for a reply.
// Identity: cold steel lit by a hard white sun, a cyan reactor heart, amber deck lights, the
// orange planet filling the sky below.
//
//                         RAIL PLATFORM (256, RG)
//                              ▲ pad
//         sat NW (48) ──pad──▶ NORTH LEDGE (0)
//              ▲ pad            ║ bridge with a gap
//   WEST WING (160, RL) ◀stairs─ fuel dock ═ bridge ═ CORE HUB (0, MH)  ─ stones ─▶ EAST WING (160, GL)
//   launch rails, tele         corner pads ▶ sats        ║ stones / pad        ▲ pad: antenna tower (352, YA)
//         sat SW (48) ─pad──▶ west wing    ARMOUR DECK (96, RA) ─ ramp ─ dropship hull (180)
//
const T = {
  floor: 's/Grid-001_Base-004',
  floor2: 's/Grid-001-7_Base-004',
  floorDark: 's/Grid-001-3_Base-004',
  deck: 's/Grid-002_Base-004',
  grate: 's/MetalGrateFloor-01_64',
  plate: 's/Metal-Panel_Base-001',
  plateDark: 's/Metal-Panel_Base-004',
  trims: 's/Metal-Panel_Base-001-Trims',
  rusty: 's/MetalPanel-01_64',
  door: 's/MetalPanel-01V_64',
  corr: 's/CorrugatedMetalPanel-01V_64',
  pipes: 's/PipesnCableswGlow-01V_64',
  pipesRed: 's/PipesnCableswRed-01V_64',
  vent: 's/Vent-001_Base-001',
  thinVent: 's/Thin-Vent-001_Base-001',
  hazard: 's/ConcreteFloor-Hazard-Full-01_64',
  hazardWall: 's/ConcreteWall-Hazard-Full-01_64',
  paintY: 's/ConcreteFloorPainted-QY_64',
  paintB: 's/ConcreteFloorPainted-QB_64',
  conc: 's/ConcretePanel-01_64',
  trim: 'proc_trim',
  tech: 'proc_tech',
};

const CYAN = 0x4ae0ff, ICE = 0xd8f0ff, AMBER = 0xffae48, RED = 0xff4030, GREEN = 0x60ff90, VIOLET = 0x9a7aff, WARM = 0xffd8a0;
const LD = 96, LW = 160, LS = 48, LR = 256, LT = 352, LH = 180;

// a floating deck: plate top, panel sides, dark machinery underneath
const slab = (b, top = T.floor, side = T.plate) => ({ box: b, tex: { top, side, bottom: T.plateDark }, bevelTex: T.trims });
const crate = (b, side = T.corr) => ({ box: b, tex: { top: T.plate, side }, bevelTex: T.trims });
const glow = (b, color) => ({ box: b, tex: T.trim, bevel: false, emit: color });
// thruster pod under a platform: a housing and a glowing nozzle ring
const pod = (x, z, y, r = 40, color = CYAN) => [
  { box: [x - r, y - 90, z - r, x + r, y, z + r], tex: { top: T.plateDark, side: T.vent }, bevelTex: T.trims },
  glow([x - r * 0.6, y - 100, z - r * 0.6, x + r * 0.6, y - 90, z + r * 0.6], color),
];
const mast = (x, z) => [
  { box: [x - 20, LS, z - 20, x + 20, LS + 120, z + 20], tex: { top: T.trim, side: T.pipes }, bevelTex: T.trims },
  glow([x - 14, LS + 120, z - 14, x + 14, LS + 128, z + 14], RED),
];
// a satellite pad: small square deck with hazard rim lights and a pod
const sat = (cx, cz) => [
  slab([cx - 112, LS - 40, cz - 112, cx + 112, LS, cz + 112], T.deck),
  glow([cx - 114, LS - 14, cz - 114, cx + 114, LS - 8, cz - 112], GREEN), glow([cx - 114, LS - 14, cz + 112, cx + 114, LS - 8, cz + 114], GREEN),
  ...pod(cx, cz, LS - 40, 48, GREEN),
  // beacon mast on the outer corner, away from the pad's arcs
  ...mast(cx + Math.sign(cx) * 80, cz + Math.sign(cz) * 80),
];

export default {
  name: 'Orbit',
  description: 'Free for all in open space: station decks over a gas giant, jump pads, a bridge gap and a strafe-jump route. Falling off kills.',
  world: [-2300, -700, -2000, 2300, 1100, 1800],
  defaults: { floor: T.floor, wall: T.plate, ceil: T.plateDark },
  ambient: 0.14,
  sun: { dir: [-0.45, 0.62, -0.64], color: [1.0, 0.95, 0.88], intensity: 1.05, sky: [0.24, 0.26, 0.4] },
  skyColor: { top: [0.02, 0.03, 0.08], horizon: [0.1, 0.06, 0.12] },
  look: {
    space: true,
    nebula: [[0.42, 0.12, 0.5], [0.05, 0.22, 0.45]],
    fog: [0.03, 0.04, 0.08], fogDensity: 0.00011,
    ambient: [0.62, 0.7, 1.0],
    sat: 0.62, tint: [1.0, 1.0, 1.02], brightness: 1.0,
    sunColor: [1.0, 0.96, 0.9],
    planet: { dir: [0.55, -0.32, 0.77], size: 0.62, color: [0.95, 0.62, 0.4] },
    zones: [
      { b: [-320, -40, -320, 320, 220, 320], fog: [0.04, 0.12, 0.16], density: 0.00022 },     // reactor cage
    ],
  },
  spaces: [
    { b: [-2300, -700, -2000, 2300, 1100, 1800], sky: true },
  ],
  solids: [
    // ================= CORE HUB (0): octagon, reactor cage with the Mega Health =================
    { cut: [-320, -40, -320, 320, 0, 320], planes: [[1, 0, 1, 224, 0, 320], [-1, 0, 1, -224, 0, 320], [1, 0, -1, 224, 0, -320], [-1, 0, -1, -224, 0, -320]], tex: { top: T.floor, side: T.plate, bottom: T.plateDark } },
    { cut: [-240, -200, -240, 240, -40, 240], planes: [[1, 0, 1, 150, 0, 240], [-1, 0, 1, -150, 0, 240], [1, 0, -1, 150, 0, -240], [-1, 0, -1, -150, 0, -240]], tex: { top: T.plateDark, side: T.vent } },
    glow([-120, -216, -120, 120, -200, 120], CYAN),
    // hazard rims along the four straight edges (painted strips flush with the floor)
    { box: [-224, -2, -320, 224, 0, -300], tex: T.hazard, bevel: false }, { box: [-224, -2, 300, 224, 0, 320], tex: T.hazard, bevel: false },
    { box: [-320, -2, -224, -300, 0, 224], tex: T.hazard, bevel: false }, { box: [300, -2, -224, 320, 0, 224], tex: T.hazard, bevel: false },
    glow([-226, -24, -322, 226, -16, -320], CYAN), glow([-226, -24, 320, 226, -16, 322], CYAN),
    glow([-322, -24, -226, -320, -16, 226], CYAN), glow([320, -24, -226, 322, -16, 226], CYAN),
    // reactor cage: four posts, a roof with the glowing core hanging under it, MH plinth
    { box: [-112, 0, -112, -80, 176, -80], tex: { top: T.trim, side: T.pipes }, bevelTex: T.trims }, { box: [80, 0, -112, 112, 176, -80], tex: { top: T.trim, side: T.pipes }, bevelTex: T.trims },
    { box: [-112, 0, 80, -80, 176, 112], tex: { top: T.trim, side: T.pipes }, bevelTex: T.trims }, { box: [80, 0, 80, 112, 176, 112], tex: { top: T.trim, side: T.pipes }, bevelTex: T.trims },
    { box: [-128, 176, -128, 128, 200, 128], tex: { top: T.plate, side: T.trims, bottom: T.plateDark }, bevelTex: T.trims },
    { box: [-56, 200, -56, 56, 260, 56], tex: { top: T.trim, side: T.vent }, bevelTex: T.trims },
    glow([-36, 140, -36, 36, 176, 36], CYAN),
    glow([-24, 260, -24, 24, 300, 24], CYAN),
    { box: [-32, 0, -32, 32, 12, 32], tex: { top: T.paintB, side: T.trim }, bevelTex: T.trims },
    glow([-34, 12, -34, 34, 14, -32], CYAN), glow([-34, 12, 32, 34, 14, 34], CYAN),
    // cover: fuel cells near the east / west edges
    crate([-300, 0, -170, -244, 52, -70], T.pipesRed), crate([244, 0, 70, 300, 52, 170], T.pipesRed),
    crate([-150, 0, -270, -90, 36, -214]), crate([90, 0, 214, 150, 36, 270]),
    // ================= NORTH: bridge with a gap, ledge, rail platform =================
    slab([-48, -24, -560, 48, 0, -320], T.grate, T.trims),
    slab([-48, -24, -880, 48, 0, -680], T.grate, T.trims),
    glow([-50, -30, -562, 50, -24, -558], RED), glow([-50, -30, -682, 50, -24, -678], RED),
    { box: [-12, -140, -500, 12, -24, -476], tex: { top: T.trim, side: T.plateDark } }, { box: [-12, -140, -760, 12, -24, -736], tex: { top: T.trim, side: T.plateDark } },
    slab([-256, -40, -1250, 256, 0, -860], T.floor2),
    ...pod(-140, -1060, -40), ...pod(140, -1060, -40),
    crate([-220, 0, -1220, -150, 64, -1150]), crate([160, 0, -1000, 230, 48, -920]),
    { box: [-256, 0, -1250, -232, 96, -1226], tex: { top: T.trim, side: T.pipes } }, { box: [232, 0, -1250, 256, 96, -1226], tex: { top: T.trim, side: T.pipes } },
    glow([-254, 96, -1248, -234, 102, -1228], RED), glow([234, 96, -1248, 254, 102, -1228], RED),
    // rail platform: a sniper nest with low armoured walls
    slab([-160, LR - 40, -1560, 160, LR, -1280], T.floorDark, T.plateDark),
    { box: [-160, LR, -1560, 160, LR + 40, -1536], tex: { top: T.trim, side: T.hazardWall }, bevelTex: T.trims },
    { box: [-160, LR, -1536, -136, LR + 40, -1440], tex: { top: T.trim, side: T.plate }, bevelTex: T.trims }, { box: [136, LR, -1536, 160, LR + 40, -1440], tex: { top: T.trim, side: T.plate }, bevelTex: T.trims },
    { box: [-40, LR, -1330, 40, LR + 30, -1300], tex: { top: T.trim, side: T.plate }, bevelTex: T.trims },
    glow([-162, LR - 10, -1282, 162, LR - 4, -1280], RED),
    ...pod(0, -1420, LR - 40, 56, RED),
    // ================= WEST: bridge, fuel dock, stairs, launch bay wing =================
    slab([-700, -24, -48, -320, 0, 48], T.grate, T.trims),
    { box: [-520, -120, -12, -496, -24, 12], tex: { top: T.trim, side: T.plateDark } },
    slab([-900, -40, -176, -700, 0, 176], T.deck),
    { box: [-890, 0, 100, -800, 80, 166], tex: { top: T.trim, side: T.pipesRed }, bevelTex: T.trims },   // fuel tank
    { box: [-890, 0, -166, -820, 56, -100], tex: { top: T.trim, side: T.pipesRed }, bevelTex: T.trims },
    { stairs: [-1100, 0, -64, -900, LW, 64], up: '-x', tex: { top: T.grate, side: T.trims } },
    { box: [-1100, -40, -64, -900, 0, 64], tex: { top: T.plateDark, side: T.trims }, bevel: false },
    slab([-1500, LW - 40, -320, -1100, LW, 320], T.floor),
    ...pod(-1300, -200, LW - 40), ...pod(-1300, 200, LW - 40),
    { box: [-1340, LW, -40, -1260, LW + 16, 40], tex: { top: T.paintY, side: T.trim }, bevelTex: T.trims },      // RL dais
    // launch rails reaching out into space (walkable, if you dare)
    { box: [-2000, LW - 24, -108, -1500, LW, -84], tex: { top: T.trims, side: T.plateDark }, bevel: false },
    { box: [-2000, LW - 24, 84, -1500, LW, 108], tex: { top: T.trims, side: T.plateDark }, bevel: false },
    glow([-2000, LW - 30, -104, -1500, LW - 24, -88], AMBER), glow([-2000, LW - 30, 88, -1500, LW - 24, 104], AMBER),
    // missile racks and the launch control booth
    crate([-1480, LW, -300, -1400, LW + 72, -200], T.door), crate([-1480, LW, 200, -1400, LW + 72, 300], T.door),
    { box: [-1220, LW, 220, -1120, LW + 96, 310], tex: { top: T.plate, side: T.tech }, bevelTex: T.trims },
    glow([-1222, LW + 60, 218, -1118, LW + 66, 220], AMBER),
    // ================= EAST: stepping stones, antenna wing, tower =================
    slab([416, 24, -64, 544, 40, 64], T.paintY, T.plate), glow([414, 16, -66, 546, 24, 66], AMBER),
    slab([640, 64, -64, 768, 80, 64], T.paintY, T.plate), glow([638, 56, -66, 770, 64, 66], AMBER),
    slab([864, 104, -64, 992, 120, 64], T.paintY, T.plate), glow([862, 96, -66, 994, 104, 66], AMBER),
    slab([1088, LW - 40, -320, 1500, LW, 320], T.floor2),
    ...pod(1300, -200, LW - 40), ...pod(1300, 200, LW - 40),
    { box: [1360, LW, -80, 1480, 320, 80], tex: { top: T.plate, side: T.pipes }, bevelTex: T.trims },          // tower
    slab([1320, 320, -112, 1500, LT, 112], T.deck, T.plate),
    glow([1318, 312, -114, 1502, 318, 114], CYAN),
    // comm dish on the tower top, tilted at the planet, and its feed horn
    { cut: [1470, LT + 20, -150, 1500, LT + 200, 150], planes: [[1, 0.4, 0, 1490, LT + 110, 0]], tex: { top: T.plate, side: T.plate }, bevel: false },
    { box: [1480, LT, -16, 1500, LT + 40, 16], tex: { top: T.trim, side: T.plateDark } },
    glow([1462, LT + 98, -10, 1474, LT + 122, 10], RED),
    crate([1120, LW, 220, 1200, LW + 56, 300]), crate([1400, LW, -300, 1480, LW + 64, -200], T.door),
    { box: [1150, LW, -40, 1190, LW + 24, 40], tex: { top: T.trim, side: T.plate }, bevelTex: T.trims },
    // ================= SOUTH: plates, armour deck, dropship, crane =================
    slab([-64, 16, 416, 64, 32, 544], T.paintB, T.plate), glow([-66, 8, 414, 66, 16, 546], CYAN),
    slab([-64, 48, 640, 64, 64, 768], T.paintB, T.plate), glow([-66, 40, 638, 66, 48, 770], CYAN),
    slab([-384, LD - 40, 880, 384, LD, 1300], T.floor),
    ...pod(-200, 1090, LD - 40, 48, AMBER), ...pod(200, 1090, LD - 40, 48, AMBER),
    { box: [-64, LD, 1180, 64, LD + 16, 1260], tex: { top: T.floorDark, side: T.trim }, bevelTex: T.trims },       // RA dais
    glow([-66, LD + 16, 1178, 66, LD + 18, 1180], RED),
    crate([-320, LD, 920, -220, LD + 64, 1000]), crate([-310, LD + 64, 930, -230, LD + 112, 990], T.door),
    crate([180, LD, 1180, 290, LD + 56, 1250]),
    // crane gantry over the deck (out of reach)
    { box: [-376, LD, 1264, -344, 420, 1296], tex: { top: T.trim, side: T.trims } }, { box: [344, LD, 1264, 376, 420, 1296], tex: { top: T.trim, side: T.trims } },
    { box: [-376, 420, 1260, 376, 444, 1300], tex: { top: T.trim, side: T.hazardWall, bottom: T.plateDark } },
    { box: [-24, 360, 1264, 24, 420, 1296], tex: { top: T.trim, side: T.plateDark } },
    glow([-376, 444, 1270, -344, 450, 1290], RED), glow([344, 444, 1270, 376, 450, 1290], RED),
    // docked dropship: boarding ramp down to the deck, walkable roof, engine glow at the stern
    { ramp: [384, LD, 1010, 520, LH, 1110], up: '+x', tex: { top: T.grate, side: T.trims } },
    { box: [384, LD - 24, 1010, 520, LD, 1110], tex: { top: T.plateDark, side: T.trims }, bevel: false },
    { box: [520, 20, 920, 900, LH, 1240], tex: { top: T.plate, side: T.door, bottom: T.plateDark }, bevelTex: T.trims },
    { cut: [900, 20, 940, 1060, 150, 1220], planes: [[1, 0.6, 0, 900, 150, 0], [1, -0.4, 0, 900, 20, 0]], tex: { top: T.plate, side: T.plate }, bevel: false },
    { box: [560, LH, 1180, 640, LH + 48, 1230], tex: { top: T.trim, side: T.vent }, bevelTex: T.trims },
    glow([500, 40, 960, 520, 140, 1200], CYAN),
    glow([520, 60, 1250, 900, 66, 1252], AMBER),
    // ================= satellites =================
    ...sat(-820, -820), ...sat(820, -820), ...sat(820, 820), ...sat(-820, 820),
    // ================= the station beyond: ring pylons and solar arrays at the edge =================
    { box: [-2260, -600, -1960, -2160, 1000, -1860], tex: { top: T.trim, side: T.trims } },
    { box: [2160, -600, -1960, 2260, 1000, -1860], tex: { top: T.trim, side: T.trims } },
    { box: [-2260, 900, -1960, 2260, 960, -1860], tex: { top: T.plate, side: T.tech, bottom: T.plateDark } },
    glow([-2160, 910, -1862, 2160, 920, -1860], CYAN),
    { box: [-2240, 200, -1500, -2220, 700, -300], tex: { top: T.trim, side: T.tech } },
    { box: [-2240, 200, 300, -2220, 700, 1500], tex: { top: T.trim, side: T.tech } },
    { box: [2220, 200, -1500, 2240, 700, -300], tex: { top: T.trim, side: T.tech } },
    { box: [2220, 200, 300, 2240, 700, 1500], tex: { top: T.trim, side: T.tech } },
  ],
  jumppads: [
    { at: [0, 0, 240], land: [0, LD, 980], arc: 140 },                 // hub -> armour deck
    { at: [250, 0, 0], land: [1200, LW, 0], arc: 220 },               // hub -> east wing
    { at: [-200, 0, -200], land: [-730, LS, -730], arc: 120 },        // hub corners -> satellites
    { at: [200, 0, -200], land: [730, LS, -730], arc: 120 },
    { at: [200, 0, 200], land: [730, LS, 730], arc: 120 },
    { at: [-200, 0, 200], land: [-730, LS, 730], arc: 120 },
    { at: [0, 0, -940], land: [0, LR, -1440], arc: 70 },              // ledge -> rail platform
    { at: [1150, LW, -220], land: [1410, LT, 0], arc: 60 },           // east wing -> antenna tower
    { at: [-820, LS, -820], land: [-120, 0, -1020], arc: 140 },       // sat NW -> north ledge
    { at: [820, LS, -820], land: [1220, LW, -120], arc: 160 },        // sat NE -> east wing
    { at: [820, LS, 820], land: [720, LH, 1100], arc: 110 },          // sat SE -> dropship roof
    { at: [-820, LS, 820], land: [-1300, LW, 100], arc: 160 },        // sat SW -> west wing
    { at: [-320, LD, 1240], land: [-1380, LW, 40], arc: 200 },       // armour deck -> west wing
  ],
  teleporters: [
    { at: [-1450, LW, -40], dest: [-180, 0, -1000], yaw: 180 },        // launch bay -> north ledge
  ],
  lights: [
    [0, 120, 0, CYAN, 520, 1.6, { fixture: false }], [0, -150, 0, CYAN, 420, 1.0, { fixture: false }],
    [-260, 80, -260, ICE, 380, 0.8, { fixture: false }], [260, 80, 260, ICE, 380, 0.8, { fixture: false }],
    [0, 90, -1060, ICE, 480, 0.9, { fixture: false }], [0, LR + 80, -1420, RED, 360, 1.0, { fixture: false }],
    [-800, 80, 0, AMBER, 380, 0.9, { fixture: false }], [-1300, LW + 110, 0, WARM, 560, 1.0, { fixture: false }], [-1750, LW + 40, 0, AMBER, 420, 0.8, { fixture: false }],
    [700, 140, 0, AMBER, 420, 0.8, { fixture: false }], [1300, LW + 110, 0, ICE, 560, 1.0, { fixture: false }], [1410, LT + 90, 0, CYAN, 360, 1.0, { fixture: false }],
    [0, LD + 120, 1090, WARM, 600, 1.1, { fixture: false }], [0, LD + 40, 1220, RED, 260, 1.0, { fixture: false }], [710, LH + 90, 1080, ICE, 420, 0.8, { fixture: false }],
    [-820, LS + 90, -820, GREEN, 300, 0.8, { fixture: false }], [820, LS + 90, -820, GREEN, 300, 0.8, { fixture: false }],
    [820, LS + 90, 820, GREEN, 300, 0.8, { fixture: false }], [-820, LS + 90, 820, GREEN, 300, 0.8, { fixture: false }],
    [-1450, LW + 40, -40, VIOLET, 240, 1.2, { fixture: false }],
  ],
  items: [
    { t: 'mh', at: [0, 12, 0] },
    { t: 'ra', at: [0, LD + 16, 1220] },
    { t: 'rg', at: [0, LR, -1480] },
    { t: 'rl', at: [-1300, LW + 16, 0] },
    { t: 'gl', at: [1300, LW, 150] },
    { t: 'sg', at: [-150, 0, 150] }, { t: 'sg', at: [700, LH, 1000] },
    { t: 'ya', at: [1410, LT, 0] },
    { t: 'h25', at: [-890, LS, -750] }, { t: 'h25', at: [750, LS, -890] }, { t: 'h25', at: [890, LS, 750] }, { t: 'h25', at: [-750, LS, 890] },
    { t: 'h25', at: [-100, 0, -1150] }, { t: 'h25', at: [-1440, LW, 250] }, { t: 'h25', at: [1440, LW, -150] }, { t: 'h25', at: [-200, LD, 1200] },
    { t: 'h5', at: [0, 0, -440] }, { t: 'h5', at: [0, 0, -780] }, { t: 'h5', at: [-560, 0, 0] }, { t: 'h5', at: [-460, 0, 0] },
    { t: 'shard', at: [480, 40, 0] }, { t: 'shard', at: [704, 80, 0] }, { t: 'shard', at: [928, 120, 0] },
    { t: 'shard', at: [0, 32, 480] }, { t: 'shard', at: [0, 64, 704] },
    { t: 'shard', at: [-1800, LW, -96] }, { t: 'shard', at: [-1800, LW, 96] }, { t: 'shard', at: [-1950, LW, 96] },
    { t: 'am_rl', at: [-1200, LW, -150] }, { t: 'am_rl', at: [180, LD, 940] }, { t: 'am_rl', at: [100, 0, -1200] },
    { t: 'am_rg', at: [100, LR, -1360] }, { t: 'am_rg', at: [-760, LS, -760] },
    { t: 'am_gl', at: [1200, LW, -100] }, { t: 'am_gl', at: [760, LS, 760] },
    { t: 'am_sg', at: [-800, 0, -40] }, { t: 'am_sg', at: [800, LH, 1150] }, { t: 'am_mg', at: [760, LS, -760] }, { t: 'am_mg', at: [-760, LS, 760] },
  ],
  spawns: [
    { at: [-200, 0, 0], yaw: -90 }, { at: [200, 0, -120], yaw: 90 }, { at: [0, 0, -280], yaw: 180 }, { at: [120, 0, 330], yaw: 0 },
    { at: [-150, 0, -1100], yaw: 180 }, { at: [150, 0, -1150], yaw: 180 },
    { at: [-1350, LW, -220], yaw: -90 }, { at: [-800, 0, 60], yaw: -90 },
    { at: [1250, LW, 100], yaw: 90 }, { at: [1200, LW, -250], yaw: 90 },
    { at: [-250, LD, 1150], yaw: 0 }, { at: [250, LD, 950], yaw: 0 }, { at: [760, LH, 1150], yaw: 90 },
    { at: [-750, LS, -890], yaw: -135 }, { at: [750, LS, 890], yaw: 45 }, { at: [890, LS, -750], yaw: 135 }, { at: [-890, LS, 750], yaw: -45 },
  ],
};
