// "Vigil" — FFA / duel map: a desecrated cathedral-foundry where the iron of the old works has
// grown into the stone. A long nave with arcaded aisles and galleries above them, a hanging
// chandelier with the Mega Health, an apse where a machine heart pumps blood down the wall into
// a pool around the Red Armour altar, an ossuary crypt under the nave (the floor has caved in),
// two side chapels, and a graveyard courtyard with the bell tower outside.
// Story: the vigil never ended. Candles still burn in the aisles, the pews are long gone, the
// crypt's dead are stacked in the walls, and something under the apse keeps beating.
// Identity: warm candlelight on brown stone against a cold violet night, arterial red in the
// apse, sick green in the crypt.
//
//                       APSE (48, blood pool, RA altar, heart machine)
//                                 ║ steps
//   W CHAPEL (SG) ─ W AISLE ═ arcade ═  NAVE (0, chandelier 288 = MH, caved-in floor)  ═ E AISLE ─ E CHAPEL (GL)
//                   gallery 176 (YA)          ║ hole                          gallery 176
//                   stairs ▼ CRYPT (-192, RL, ossuary) ▲ stairs     (crypt tele ▶ bell tower)
//                       NARTHEX (0, SG) ── three doors ── COURTYARD (graves, blood well, BELL TOWER 320 = RG)
//
const T = {
  floor: 'g/str_stoneflr2',
  floor2: 'g/str_stoneflr4',
  floor3: 'g/str_stoneflr6',
  cryptFloor: 'g/str_stoneflr5',
  brick: 'g/str_stonebrk1',
  brick2: 'g/str_stonebrk3',
  brickDark: 'g/str_stonebrk6',
  wall: 'g/str_stonewall3',
  wallRust: 'g/str_stonewall5',
  wallRust2: 'g/str_stonewall7',
  wallOut: 'g/str_stonebrk4',
  stone: 'g/str_stonegen2',
  stone2: 'g/str_stonegen4',
  rubble: 'g/str_stonerubble',
  metalFloor: 'g/str_metalflr3',
  metalFloor2: 'g/str_metalflr5',
  metal: 'g/str_metalgen1',
  metal2: 'g/str_metalgen3',
  grate: 'g/str_metalgrbl2',
  panel: 'g/str_metalpan2',
  panelRust: 'g/str_metalpan5',
  wood: 'g/str_rotwoodgen1',
  wood2: 'g/str_rotwoodgen2',
  flesh: 'g/str_bloodvein3',
  flesh2: 'g/str_bloodvein5',
  flesh3: 'g/str_bloodvein1',
  blood: 'g/str_blood',
  bloodfall: 'g/+0str_bloodfall',
  sand: 'g/str_wasteland2',
  sand2: 'g/str_wasteland4',
  trim: 'proc_trim',
};

const CANDLE = 0xffa050, FLAME = 0xffc070, BLOOD = 0xff2a18, DEEP = 0x9a1008, MOON = 0x8a9aff, SICK = 0x7aff6a, VIOLET = 0xa070ff;
const AP = 48, GA = 176, CH = 288, TW = 320, CR = -192;

const col = (x, z, y0, y1, r = 24, side = T.stone) => ({ box: [x - r, y0, z - r, x + r, y1, z + r], tex: { top: T.metal, side }, bevelTex: T.metal, bevel: Math.round(r * 0.5) });
const band = (x, z, y, r, tex = T.metal) => ({ box: [x - r, y, z - r, x + r, y + 14, z + r], tex: { top: tex, side: tex }, bevelTex: tex });
const glow = (b, color) => ({ box: b, tex: T.trim, bevel: false, emit: color });
// a cluster of candles: wax stubs with fullbright flames
const candles = (x, y, z, n = 3) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ox = x + (i - (n - 1) / 2) * 10, oz = z + (i % 2) * 6;
    const h = 10 + ((i * 7) % 3) * 5;
    out.push({ box: [ox - 2.5, y, oz - 2.5, ox + 2.5, y + h, oz + 2.5], tex: { top: T.stone, side: T.stone }, bevel: false });
    out.push(glow([ox - 1.2, y + h, oz - 1.2, ox + 1.2, y + h + 4, oz + 1.2], FLAME));
  }
  return out;
};
// pointed-arch haunches between two columns of an arcade (axis z, the arcade wall at x)
const bay = (x, z0, z1, y0, y1, th = 18) => {
  const zm = (z0 + z1) / 2;
  return [
    { cut: [x - th, y0, z0, x + th, y1, zm], planes: [[0, -(zm - z0), y1 - y0, 0, y0, z0]], tex: T.brick2, bevel: false },
    { cut: [x - th, y0, zm, x + th, y1, z1], planes: [[0, -(z1 - zm), -(y1 - y0), 0, y0, z1]], tex: T.brick2, bevel: false },
  ];
};
const headstone = (x, z, h = 40, w = 18) => ({ box: [x - w, 0, z - 5, x + w, h, z + 5], tex: { top: T.stone2, side: T.stone2 }, bevelTex: T.stone2 });

const COLS_Z = [-800, -608, -416, -224, -32, 160, 352, 544];

export default {
  name: 'Vigil',
  description: 'Gothic cathedral-foundry: arcaded nave and galleries, a blood-pool apse, an ossuary crypt and a graveyard bell tower.',
  world: [-900, -256, -1344, 900, 900, 1664],
  defaults: { floor: T.floor, wall: T.brick, ceil: T.brickDark },
  ambient: 0.16,
  sun: { dir: [0.3, 0.72, 0.62], color: [0.56, 0.6, 0.95], intensity: 0.75, sky: [0.3, 0.24, 0.45] },
  skyColor: { top: [0.03, 0.02, 0.06], horizon: [0.32, 0.08, 0.07] },
  look: {
    fog: [0.12, 0.07, 0.05], fogDensity: 0.00042,
    ambient: [1.0, 0.82, 0.7],
    sat: 0.58, tint: [1.04, 0.98, 0.94], brightness: 1.1,
    sunColor: [0.6, 0.62, 1.0],
    planet: { dir: [-0.25, 0.42, 0.87], size: 0.16, color: [0.95, 0.28, 0.16] },
    zones: [
      { b: [-384, -32, -1280, 384, 512, -896], fog: [0.26, 0.04, 0.03], density: 0.0009 },     // apse: red haze
      { b: [-576, CR, -640, 576, -32, 384], fog: [0.06, 0.12, 0.06], density: 0.0011 },         // crypt: sick green
      { b: [-800, 0, 896, 800, 900, 1664], fog: [0.12, 0.09, 0.2], density: 0.00045 },          // courtyard: night
    ],
  },
  spaces: [
    // nave and its aisles (open to each other through the arcade)
    { b: [-256, 0, -896, 256, 640, 640], floor: T.floor, wall: T.brick, ceil: T.brickDark, trim: { h: 24, tex: T.metal }, crown: { h: 40, tex: T.wallRust2 } },
    { b: [-576, 0, -896, -256, 400, 640], floor: T.floor2, wall: T.wall, ceil: T.wood, trim: { h: 20, tex: T.metal } },
    { b: [256, 0, -896, 576, 400, 640], floor: T.floor2, wall: T.wallRust, ceil: T.wood, trim: { h: 20, tex: T.metal } },
    // apse and the blood pool
    { b: [-384, 0, -1280, 384, 512, -896], floor: T.floor3, wall: T.flesh, ceil: T.flesh2, trim: { h: 48, tex: T.metal2 } },
    { b: [-160, -32, -1200, 160, 0, -1000], floor: T.blood, wall: T.metal2 },
    // narthex, three doors, the courtyard (open sky)
    { b: [-576, 0, 640, 576, 320, 864], floor: T.metalFloor, wall: T.wallRust2, ceil: T.wood2, trim: { h: 24, tex: T.metal } },
    { b: [-96, 0, 864, 96, 224, 896], floor: T.metalFloor, wall: T.metal, ceil: T.metal },
    { b: [-480, 0, 864, -352, 192, 896], floor: T.metalFloor, wall: T.metal, ceil: T.metal },
    { b: [352, 0, 864, 480, 192, 896], floor: T.metalFloor, wall: T.metal, ceil: T.metal },
    { b: [-800, 0, 896, 800, 900, 1664], floor: T.sand, wall: T.wallOut, sky: true },
    { b: [-480, -40, 1200, -352, 0, 1328], floor: T.blood, wall: T.stone2 },                         // the blood well
    // crypt, its two stairwells, and the caved-in hole in the nave floor
    { b: [-256, CR, -640, 256, -32, 384], floor: T.cryptFloor, wall: T.stone2, ceil: T.brickDark, trim: { h: 16, tex: T.metal2 } },
    { b: [-576, CR, -560, -256, 0, -432], floor: T.cryptFloor, wall: T.stone2, ceil: T.brickDark },
    { b: [256, CR, 192, 576, 0, 320], floor: T.cryptFloor, wall: T.stone2, ceil: T.brickDark },
    { b: [-64, -32, -96, 64, 0, 0], floor: T.rubble, wall: T.rubble },
    // side chapels off the aisles
    { b: [-832, 0, -512, -576, 256, -192], floor: T.metalFloor2, wall: T.flesh3, ceil: T.wood, trim: { h: 20, tex: T.metal } },
    { b: [576, 0, -512, 832, 256, -192], floor: T.metalFloor2, wall: T.wallRust2, ceil: T.wood, trim: { h: 20, tex: T.metal } },
  ],
  solids: [
    // ================= NAVE: arcade columns with capitals and pointed arches =================
    ...COLS_Z.flatMap((z) => [col(-256, z, 0, 400), col(256, z, 0, 400), band(-256, z, 300, 28), band(256, z, 300, 28)]),
    ...COLS_Z.slice(0, -1).flatMap((z, i) => [...bay(-256, z + 24, COLS_Z[i + 1] - 24, 320, 400), ...bay(256, z + 24, COLS_Z[i + 1] - 24, 320, 400)]),
    // vault ribs across the nave ceiling and the clerestory sill
    ...COLS_Z.map((z) => ({ box: [-256, 600, z - 12, 256, 640, z + 12], tex: { top: T.metal, side: T.metal2, bottom: T.metal2 } })),
    { box: [-256, 400, -896, -240, 416, 640], tex: T.metal, bevel: false }, { box: [240, 400, -896, 256, 416, 640], tex: T.metal, bevel: false },
    // chandelier (MH): an iron ring hung on chains, candles on the rim
    { box: [-80, CH - 16, -272, 80, CH, -112], tex: { top: T.grate, side: T.metal, bottom: T.metal2 }, bevelTex: T.metal },
    { box: [-4, CH, -196, 4, 640, -188], tex: T.metal, bevel: false },
    { box: [-76, CH, -268, -70, 600, -262], tex: T.metal, bevel: false }, { box: [70, CH, -268, 76, 600, -262], tex: T.metal, bevel: false },
    { box: [-76, CH, -122, -70, 600, -116], tex: T.metal, bevel: false }, { box: [70, CH, -122, 76, 600, -116], tex: T.metal, bevel: false },
    ...candles(-64, CH, -260, 2), ...candles(64, CH, -260, 2), ...candles(-64, CH, -128, 2), ...candles(64, CH, -128, 2),
    // the caved-in floor: broken slabs around the hole into the crypt
    { box: [-80, 0, -112, -64, 6, 16], tex: T.rubble, bevel: false }, { box: [64, 0, -104, 84, 10, 8], tex: T.rubble, bevel: false },
    { box: [-48, 0, 0, 40, 8, 18], tex: T.rubble, bevel: false }, { box: [-30, -192, -80, 30, -170, -20], tex: T.rubble },
    // candle stands down the nave walls between the columns, and the lectern
    ...[-704, -320, 64, 448].flatMap((z) => [...candles(-228, 0, z, 4), ...candles(220, 0, z + 20, 3)]),
    { box: [-24, 0, 420, 24, 52, 452], tex: { top: T.wood, side: T.wood2 }, bevelTex: T.metal },
    // ================= AISLES: galleries, stairs, stairwells to the crypt =================
    { box: [-576, GA - 16, -800, -432, GA, 560], tex: { top: T.metalFloor, side: T.metal, bottom: T.wood }, bevelTex: T.metal },
    { box: [432, GA - 16, -800, 576, GA, 560], tex: { top: T.metalFloor, side: T.metal, bottom: T.wood }, bevelTex: T.metal },
    { box: [-440, GA, -800, -432, GA + 28, 560], tex: T.metal, bevel: false }, { box: [432, GA, -800, 440, GA + 28, 560], tex: T.metal, bevel: false },
    ...[-640, -320, 0, 320].flatMap((z) => [{ box: [-470, 96, z - 10, -432, GA - 16, z + 10], tex: T.metal2 }, { box: [432, 96, z - 10, 470, GA - 16, z + 10], tex: T.metal2 }]),
    { stairs: [-576, 0, 560, -432, GA, 760], up: '-z', tex: { top: T.wood, side: T.metal } },
    { stairs: [432, 0, 560, 576, GA, 760], up: '-z', tex: { top: T.wood, side: T.metal } },
    { stairs: [-576, CR, -560, -256, 0, -432], up: '-x', tex: { top: T.cryptFloor, side: T.stone2 } },
    { stairs: [256, CR, 192, 576, 0, 320], up: '+x', tex: { top: T.cryptFloor, side: T.stone2 } },
    { box: [-480, 0, -568, -256, 28, -560], tex: T.metal, bevel: false }, { box: [-480, 0, -432, -256, 28, -424], tex: T.metal, bevel: false },
    { box: [256, 0, 184, 480, 28, 192], tex: T.metal, bevel: false }, { box: [256, 0, 320, 480, 28, 328], tex: T.metal, bevel: false },
    // aisle clutter: confessional booth (W), toppled organ pipes (E)
    { box: [-576, 0, -160, -500, 120, -40], tex: { top: T.wood, side: T.wood2 }, bevelTex: T.metal },
    { box: [500, 0, -200, 576, 60, 40], tex: { top: T.panelRust, side: T.panel }, bevelTex: T.metal },
    { box: [520, 60, -180, 556, 220, -150], tex: T.panel, bevel: false }, { box: [520, 60, -120, 556, 260, -90], tex: T.panel, bevel: false },
    { box: [520, 60, -60, 556, 190, -30], tex: T.panel, bevel: false },
    ...candles(-540, GA, -300, 3), ...candles(540, GA, 200, 3),
    // ================= APSE: raised floor around the pool, altar, heart machine, blood fall =================
    { box: [-384, 0, -1000, 384, AP, -960], tex: { top: T.floor3, side: T.metal2 }, bevelTex: T.metal },
    { box: [-384, 0, -1280, 384, AP, -1200], tex: { top: T.floor3, side: T.metal2 }, bevelTex: T.metal },
    { box: [-384, 0, -1200, -160, AP, -1000], tex: { top: T.floor3, side: T.metal2 }, bevelTex: T.metal },
    { box: [160, 0, -1200, 384, AP, -1000], tex: { top: T.floor3, side: T.metal2 }, bevelTex: T.metal },
    { stairs: [-256, 0, -960, 256, AP, -880], up: '-z', tex: { top: T.floor3, side: T.metal2 } },
    { box: [-160, -32, -1200, 160, -20, -1000], tex: T.blood, emit: 0x5a0806 },
    { wedge: [-384, 0, -1280, -256, 512, -1152], keep: '-x-z', tex: T.flesh },
    { wedge: [256, 0, -1280, 384, 512, -1152], keep: '+x-z', tex: T.flesh },
    { box: [-96, AP, -1272, 96, 96, -1216], tex: { top: T.panelRust, side: T.stone }, bevelTex: T.metal },
    ...candles(-80, 96, -1262, 2), ...candles(80, 96, -1262, 2),
    { box: [-200, AP, -1280, 200, 470, -1272], tex: T.bloodfall, emit: 0x902018, bevel: false },
    { box: [-200, 470, -1280, 200, 500, -1262], tex: { top: T.metal, side: T.metal2 } },
    // the heart: a riveted iron chamber hung over the altar, glowing at the seams, on chains
    { box: [-70, 300, -1230, 70, 420, -1110], tex: { top: T.grate, side: T.panelRust, bottom: T.metal2 }, bevelTex: T.metal },
    glow([-40, 330, -1110, 40, 390, -1106], BLOOD), glow([-74, 356, -1200, -70, 364, -1140], BLOOD), glow([70, 356, -1200, 74, 364, -1140], BLOOD),
    { box: [-60, 420, -1180, -52, 512, -1172], tex: T.metal, bevel: false }, { box: [52, 420, -1180, 60, 512, -1172], tex: T.metal, bevel: false },
    // flesh columns flanking the apse arch
    col(-300, -930, 0, 512, 34, T.flesh2), col(300, -930, 0, 512, 34, T.flesh2),
    // ================= CRYPT: pillars, ossuary niches, the RL bier, sarcophagi =================
    ...[-512, -256, 0, 256].flatMap((z) => [col(-128, z, CR, -32, 22, T.stone2), col(128, z, CR, -32, 22, T.stone2)]),
    { box: [-48, CR, -340, 48, CR + 16, -260], tex: { top: T.panelRust, side: T.stone }, bevelTex: T.metal },
    { box: [-220, CR, 200, -150, CR + 40, 340], tex: { top: T.stone, side: T.stone2 }, bevelTex: T.metal },
    { box: [150, CR, -500, 220, CR + 40, -360], tex: { top: T.stone, side: T.stone2 }, bevelTex: T.metal },
    ...[-560, -400, -240, -80, 80, 240].flatMap((z) => [{ box: [-256, CR + 40, z - 40, -240, CR + 100, z + 40], tex: T.rubble, bevel: false }, { box: [240, CR + 40, z - 40, 256, CR + 100, z + 40], tex: T.rubble, bevel: false }]),
    ...candles(-200, CR, -600, 3), ...candles(190, CR, 340, 3), ...candles(-30, CR + 16, -330, 2),
    // ================= CHAPELS =================
    { box: [-820, 0, -420, -760, 60, -284], tex: { top: T.panelRust, side: T.stone }, bevelTex: T.metal },
    { box: [760, 0, -420, 820, 60, -284], tex: { top: T.panelRust, side: T.stone }, bevelTex: T.metal },
    { arch: [-592, 0, -496, -576, 224, -208], axis: 'x', tex: { top: T.metal, side: T.stone }, thick: 8 },
    { arch: [576, 0, -496, 592, 224, -208], axis: 'x', tex: { top: T.metal, side: T.stone }, thick: 8 },
    ...candles(-800, 60, -352, 3), ...candles(800, 60, -352, 3),
    // ================= NARTHEX and the facade =================
    { box: [-576, 0, 640, -520, 120, 720], tex: { top: T.wood, side: T.wood2 }, bevelTex: T.metal },
    { box: [500, 0, 780, 576, 80, 864], tex: { top: T.wood, side: T.wood2 }, bevelTex: T.metal },
    { arch: [-96, 0, 864, 96, 224, 896], axis: 'z', tex: { top: T.metal, side: T.stone }, thick: 10 },
    // facade buttresses and the rose window over the main door
    ...[-640, -280, 280, 640].map((x) => ({ box: [x - 40, 0, 896, x + 40, 520, 960], tex: { top: T.stone, side: T.wallOut }, bevelTex: T.stone })),
    { cut: [-110, 380, 896, 110, 600, 902], planes: [[1, 1, 0, 70, 560, 0], [-1, 1, 0, -70, 560, 0], [1, -1, 0, 70, 420, 0], [-1, -1, 0, -70, 420, 0]], tex: T.trim, emit: 0xc04020 },
    { box: [-120, 370, 896, 120, 380, 910], tex: T.metal, bevel: false },
    // ================= COURTYARD: graves, ruined walls, dead tree, blood well, bell tower =================
    ...[[-260, 1400], [-180, 1420], [-100, 1390], [-20, 1430], [60, 1400], [-220, 1520], [-120, 1540], [-20, 1510], [80, 1530]].map(([x, z], i) => headstone(x, z, 34 + (i % 3) * 10)),
    { box: [-700, 0, 1050, -640, 150, 1230], tex: { top: T.rubble, side: T.wallOut }, bevelTex: T.stone },
    { box: [-640, 0, 1050, -560, 90, 1090], tex: { top: T.rubble, side: T.wallOut }, bevelTex: T.stone },
    { box: [640, 0, 1000, 760, 110, 1060], tex: { top: T.rubble, side: T.wallOut }, bevelTex: T.stone },
    { box: [160, 0, 1150, 188, 210, 1178], tex: T.wood2 },
    { box: [100, 150, 1158, 160, 162, 1170], tex: T.wood2, bevel: false }, { box: [188, 180, 1160, 250, 190, 1168], tex: T.wood2, bevel: false },
    { box: [-496, 0, 1184, -336, 28, 1200], tex: T.stone2 }, { box: [-496, 0, 1328, -336, 28, 1344], tex: T.stone2 },
    { box: [-496, 0, 1200, -480, 28, 1328], tex: T.stone2 }, { box: [-352, 0, 1200, -336, 28, 1328], tex: T.stone2 },
    { box: [-480, -40, 1200, -352, -24, 1328], tex: T.blood, emit: 0x5a0806 },
    { box: [400, 0, 1300, 640, TW, 1540], tex: { top: T.floor3, side: T.wallOut }, bevelTex: T.stone },
    ...[[400, 1300], [600, 1300], [400, 1500], [600, 1500]].map(([x, z]) => ({ box: [x, TW, z, x + 40, TW + 40, z + 40], tex: T.stone })),
    { box: [480, TW, 1380, 560, TW + 8, 1460], tex: T.metal, bevel: false },
    { box: [500, TW + 150, 1400, 540, TW + 200, 1440], tex: { top: T.metal, side: T.metal2 } },
    { box: [416, TW + 40, 1316, 432, TW + 160, 1332], tex: T.stone, bevel: false }, { box: [608, TW + 40, 1316, 624, TW + 160, 1332], tex: T.stone, bevel: false },
    { box: [416, TW + 40, 1508, 432, TW + 160, 1524], tex: T.stone, bevel: false }, { box: [608, TW + 40, 1508, 624, TW + 160, 1524], tex: T.stone, bevel: false },
    { box: [400, TW + 160, 1300, 640, TW + 184, 1540], tex: { top: T.wood, side: T.wood2, bottom: T.wood } },
    // courtyard wall crenellations
    ...[-700, -500, -300, -100, 100, 300, 500, 700].map((x) => ({ box: [x - 40, 380, 1624, x + 40, 420, 1664], tex: T.stone })),
  ],
  hazards: [
    { b: [-160, -32, -1200, 160, -10, -1000], dmg: 25, mod: 'slime' },
    { b: [-480, -40, 1200, -352, -12, 1328], dmg: 25, mod: 'slime' },
  ],
  jumppads: [
    { at: [0, 0, 256], land: [0, CH, -170], arc: 60 },                 // nave -> chandelier
    { at: [520, 0, 1180], land: [520, TW, 1460], arc: 130 },            // courtyard -> bell tower
  ],
  teleporters: [
    { at: [0, CR, -590], dest: [460, TW, 1360], yaw: 0 },              // crypt -> bell tower
  ],
  lights: [
    // nave: candlelight low, the chandelier, cold clerestory light high up
    [0, 260, -190, CANDLE, 640, 1.3, { fixture: false }], [0, 120, 300, CANDLE, 420, 0.9, { fixture: false }], [0, 120, -600, CANDLE, 420, 0.9, { fixture: false }],
    [-230, 40, -320, FLAME, 220, 0.9, { fixture: false }], [230, 40, 84, FLAME, 220, 0.9, { fixture: false }], [-230, 40, 448, FLAME, 220, 0.9, { fixture: false }], [230, 40, -684, FLAME, 220, 0.9, { fixture: false }],
    [0, 560, -400, MOON, 560, 0.6, { fixture: false }], [0, 560, 300, MOON, 560, 0.6, { fixture: false }],
    // aisles and galleries
    [-560, 300, -500, CANDLE, 420, 1.0], [-560, 300, 200, CANDLE, 420, 1.0], [560, 300, -500, CANDLE, 420, 1.0], [560, 300, 200, CANDLE, 420, 1.0],
    [-500, 200, -300, FLAME, 200, 0.8, { fixture: false }], [500, 200, 200, FLAME, 200, 0.8, { fixture: false }],
    // apse: blood
    [0, 40, -1100, BLOOD, 520, 1.5, { fixture: false }], [0, 360, -1100, BLOOD, 420, 1.2, { fixture: false }], [0, 120, -1250, FLAME, 260, 0.9, { fixture: false }],
    [-360, 300, -1000, DEEP, 380, 1.0], [360, 300, -1000, DEEP, 380, 1.0],
    // crypt: sick green with a few candles
    [0, -70, -400, SICK, 380, 0.55, { fixture: false }], [0, -70, 200, SICK, 380, 0.55, { fixture: false }], [-200, -150, -600, FLAME, 220, 1.0, { fixture: false }], [190, -150, 340, FLAME, 220, 1.0, { fixture: false }],
    [0, -150, -590, VIOLET, 220, 1.2, { fixture: false }],
    // chapels, narthex
    [-800, 200, -352, VIOLET, 380, 1.0], [800, 200, -352, SICK, 380, 0.9], [-800, 90, -352, FLAME, 200, 0.9, { fixture: false }], [800, 90, -352, FLAME, 200, 0.9, { fixture: false }],
    [-300, 280, 752, CANDLE, 460, 1.0], [300, 280, 752, CANDLE, 460, 1.0],
    // courtyard: moon, the rose window spilling red, the well, the bell tower lamp
    [0, 480, 940, 0xff5030, 420, 0.9, { fixture: false }], [-416, 30, 1264, BLOOD, 300, 1.2, { fixture: false }],
    [520, TW + 140, 1420, CANDLE, 360, 1.0, { fixture: false }], [-400, 300, 1400, MOON, 600, 0.7, { fixture: false }], [400, 200, 1100, MOON, 520, 0.6, { fixture: false }],
  ],
  items: [
    { t: 'mh', at: [0, CH, -192] },
    { t: 'ra', at: [0, 96, -1244] },
    { t: 'ya', at: [-504, GA, -120] },
    { t: 'rl', at: [0, CR + 16, -300] },
    { t: 'rg', at: [560, TW, 1480] },
    { t: 'gl', at: [704, 0, -352] },
    { t: 'sg', at: [-704, 0, -352] }, { t: 'sg', at: [0, 0, 760] },
    { t: 'h25', at: [-420, 0, -800] }, { t: 'h25', at: [420, 0, -800] }, { t: 'h25', at: [-420, 0, 520] }, { t: 'h25', at: [420, 0, 400] },
    { t: 'h25', at: [-160, CR, -600] }, { t: 'h25', at: [160, CR, 330] }, { t: 'h25', at: [-600, 0, 1500] }, { t: 'h25', at: [700, 0, 1450] },
    { t: 'h5', at: [0, 0, 100] }, { t: 'h5', at: [0, 0, -400] }, { t: 'h5', at: [-300, AP, -1240] }, { t: 'h5', at: [300, AP, -1240] },
    { t: 'shard', at: [504, GA, -600] }, { t: 'shard', at: [504, GA, -400] }, { t: 'shard', at: [504, GA, -200] },
    { t: 'shard', at: [-400, CR + 48, -496] }, { t: 'shard', at: [400, CR + 48, 256] },
    { t: 'am_rl', at: [-60, CR, 100] }, { t: 'am_rl', at: [-600, 0, 800] }, { t: 'am_rl', at: [600, 0, 1200] },
    { t: 'am_rg', at: [460, TW, 1330] }, { t: 'am_rg', at: [-300, AP, -1050] },
    { t: 'am_gl', at: [760, 0, -240] }, { t: 'am_gl', at: [300, AP, -1050] },
    { t: 'am_sg', at: [-760, 0, -240] }, { t: 'am_sg', at: [-150, 0, 1450] }, { t: 'am_mg', at: [504, GA, 400] }, { t: 'am_mg', at: [-504, GA, 300] },
  ],
  spawns: [
    { at: [-150, 0, 560], yaw: 0 }, { at: [150, 0, -700], yaw: 180 }, { at: [-420, 0, -300], yaw: -90 }, { at: [420, 0, 0], yaw: 90 },
    { at: [-504, GA, -700], yaw: 180 }, { at: [504, GA, 0], yaw: 0 },
    { at: [-200, AP, -1060], yaw: 180 }, { at: [200, AP, -1240], yaw: 180 },
    { at: [0, CR, 300], yaw: 0 }, { at: [-180, CR, -100], yaw: 0 },
    { at: [-720, 0, -260], yaw: -90 }, { at: [720, 0, -440], yaw: 90 },
    { at: [-400, 0, 760], yaw: -90 }, { at: [0, 0, 1300], yaw: 0 }, { at: [-650, 0, 1400], yaw: -45 }, { at: [700, 0, 1250], yaw: 45 },
  ],
};
