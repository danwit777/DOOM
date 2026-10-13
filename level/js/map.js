/* map.js - the tile map and every entity of "Grube Kattowitz III" (collision, checkpoints, movers, prop placement).
 *
 * Grid: MW x MH = 160 x 14 tiles of TS = 48 px (style.js: the hero is 2 tiles; the frame shows 20 x 11.25 tiles and the camera
 * follows the hero both ways). Row 0 is the top of the level, rows 11-13 are the usual ground, so a hero standing on the ground has
 * his feet at y = 11 * TS = 528 (row 12 = 576 in the colony street of C, which dips a row).
 * Tile kinds (one char each):
 *   '.' air   G ground / slag (solid)   B familok brick (solid)   S riveted steel (solid)   C crate (solid)
 *   P lattice catwalk (one-way: land from above, Down + a jump drops through)   T conveyor belt (one-way, pushes right, NOT drop-through)
 *   L ladder (climbable; its top cell is a one-way ledge, Down climbs back down)
 * Outside the map: columns < 0 or >= MW are solid walls, rows < 0 are air, rows >= MH repeat the bottom row (ground goes on down,
 * a pit stays open: falling out of the level = death).
 *
 * SCALE RULE (hero = 2 tiles, hitbox 30 x 87 px, sprite 96 px, jump 112.5 px = 2.35 tiles; the gap a jump clears, measured by
 * the playtest from the take-off edge: ~2.8 tiles walking, ~4.2 tiles running, and a full run with coyote time still lands ~2 tiles
 * under the far lip of the 5-tile shaft):
 *   HEADROOM  every surface the hero can stand on has at least 3 free tiles above it (checkHeadroom() lists violations);
 *   CAMERA    the frame shows 11.25 of the 14 rows: the engine's camera follows the hero vertically and keeps his whole sprite in
 *             the frame, a full jump's apex included (engine.js CAMERA; the playtest jumps from every kind of surface, the
 *             highest included, and checks every frame of its fuzz). For that the level must have the sky: from every standable
 *             cell, row r, r * TS - JUMP_H - the tallest air frame's anchor height >= CAM.margin (the playtest checks every
 *             cell). The highest surface is the second familok's roof at row 6: its jump peaks 4 rows under the level's top.
 *             Each surface has ONE camera rest (the street view where it frames him, else his feet at the dead zone's middle)
 *             that the camera settles to when he arrives there (a climb, a landing 1.5 tiles or more above or below, a
 *             respawn); a step or a hop of a tile keeps the dead zone. E is a framing zone of its own (ENT.landmark): the tall
 *             headframe whole in the frame;
 *   JUMPS     required jumps are at most 2 tiles up and 2 tiles across (a walking jump clears them); gaps that must NOT be jumped
 *             are wider than any jump: the cable-car chasm (8 tiles) and the shaft (5 tiles).
 * The playtest asserts that checkHeadroom() is empty, plays the camera's guarantee and searches every standable spot for softlocks
 * (every place the hero can reach must still lead to the win or to a death).
 *
 * Entities (ENT) are in native px (x = col * TS) or in tiles where they snap to the grid: the draft's numbers (32 px tiles) x K,
 * so they keep their place in tiles. Art for them lives in art/props.js (the owner's 3D models among it as sprites: art/models.js),
 * behaviour in engine.js. Beat order and ideas are those of the first draft (A Hałda, B Bocznica, C Kolonie Giesche, D Sortownia,
 * E Schacht III), re-laid out for the taller hero.
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style;
const TS = S.TS, MW = 160, MH = 14, LW = MW * TS, LH = MH * TS;
const GROUND = 11;                          // usual ground row (feet at y = 11 * TS)

const grid = Array.from({ length: MH }, () => Array(MW).fill('.'));
function fill(c0, c1, r0, r1, ch){ for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = ch; }

// A · HAŁDA (cols 0-29): start on top of the slag heap, three 1-tile steps down (half the hero's height: a staircase), then the
// closed zone: a 2-tile tank trench under the barbed wire is the first jump (a walking jump clears ~2.8 tiles).
fill(0, 5, 8, 13, 'G'); fill(6, 9, 9, 13, 'G'); fill(10, 13, 10, 13, 'G'); fill(14, 40, GROUND, 13, 'G');
fill(21, 22, GROUND, 13, '.');
// B · BOCZNICA (cols 30-61): rails, a parked hunt (cart) as a step, an 8-tile chasm (cols 41-48) crossed only in the cable-car
// bucket, a moving hunt on the far side, the guard tower. The bucket docks flush with two 2-tile loading stations (steel, rows
// 9-10): its rim is at the station floor, so the hero walks in and out, and nothing walkable lies under its path (a 2-tile hero
// would stand inside a bucket hung low enough to be jumped onto from the ground).
fill(38, 40, 9, 10, 'S'); fill(49, 51, 9, 10, 'S');
fill(49, 61, GROUND, 13, 'G');
// C · KOLONIE GIESCHE (cols 62-99): the street dips one tile into the colony (cols 63-95 at row 12: a step down, and a 1-tile step
// up into D), so the two familoki that block it are 4 and 6 tiles tall while their roofs sit low in the level, down where the
// sunset sky behind the hero is light enough to read him against (VALUE rule in style.js). Ladder (col 65) up the first house
// (roof row 8), its roof leads onto a 3-tile catwalk (row 8, 3 free tiles under it), a ladder (col 81) up the second house (roof
// row 6, the highest surface of the level), then the drop back to the street.
fill(62, 62, GROUND, 13, 'G'); fill(63, 95, GROUND + 1, 13, 'G'); fill(96, 99, GROUND, 13, 'G');
fill(66, 77, 8, 11, 'B'); fill(65, 65, 8, 11, 'L');
fill(78, 80, 8, 8, 'P');
fill(81, 81, 6, 11, 'L'); fill(82, 93, 6, 11, 'B');
// D · SORTOWNIA (cols 100-131): crates (1 then 2 tiles) up to the conveyor (row 7: 2 tiles above the top crate); steel posts reach
// the belt and close the lower road (3 tiles: too high to jump). The belt pushes right; one steel block to hop at the far end.
// What keeps the hero out from under the belt is engine.js's rule that the belt's slab is a wall from the side: standing on the
// top crate his head is in the belt's row, so he can only jump up onto the belt, never walk or hop off the crate to the right
// (that used to drop him into cols 104-107, a pocket with no way out: the belt a ceiling, the crates and post 108 walls). The
// post under the belt's head (col 104) is that closure made visible; on its own it would not do: a short hop from the crate onto
// its top led on into cols 105-107. The playtest's no-softlock search checks the whole level for such pockets.
fill(100, 131, GROUND, 13, 'G');
grid[10][102] = 'C'; grid[9][103] = 'C'; grid[10][103] = 'C';
fill(104, 120, 7, 7, 'T'); fill(104, 104, 8, 10, 'S'); fill(108, 108, 8, 10, 'S'); fill(116, 116, 8, 10, 'S');
grid[10][126] = 'S';
// E · SCHACHT III (cols 132-159): the headframe stands on the playfield, a 5-tile shaft (cols 144-148) with the cage running in it.
// Stepping into the cage while it is up and riding it down ends the level. The headframe is the finale's landmark (ENT.headframe:
// the owner's model, 382 px = 8 tiles over the street, its top at y 146), and E is a camera framing zone of its own (ENT.landmark):
// from col 136 on - the shaft and the cage descent included - the camera frames the headframe whole, its top >= 8 px inside the
// frame (a taller one would lift the view, the street never lower than 85 % down it: engine.js CAMERA; the playtest checks it
// while he waits for the cage). This one fits the street view (the camera's lowest): its top 14 px under the frame's top. Riding
// the cage down, the camera keeps that view until it has to follow him down the shaft.
fill(132, 143, GROUND, 13, 'G'); fill(149, 159, GROUND, 13, 'G');

const tile = (c, r) => (c < 0 || c >= MW) ? 'G' : r < 0 ? '.' : grid[Math.min(r, MH - 1)][c];
const SOLID = new Set(['G', 'B', 'S', 'C']);
const isSolid = (c, r) => SOLID.has(tile(c, r));
const isLadder = (c, r) => tile(c, r) === 'L';
// One-way ledges: catwalks, the belt, and the top cell of a ladder.
const isOneWay = (c, r) => { const t = tile(c, r); return t === 'P' || t === 'T' || (t === 'L' && tile(c, r - 1) !== 'L'); };
// Ledges that Down + a jump drops through (the belt is not one: its posts would otherwise trap the hero under it).
const isDropThrough = (c, r) => tile(c, r) === 'P';
// First row from the top that the hero can stand on in column c (MH if none: a pit).
function standRow(c){ for (let r = 0; r < MH; r++) if (isSolid(c, r) || isOneWay(c, r)) return r; return MH; }

// Beats: [first column, letter, name]; checkpoints: columns (respawn on the first standable row; reached when the hero passes them).
const SEGS = [[0, 'A', 'HAŁDA'], [30, 'B', 'BOCZNICA'], [62, 'C', 'KOLONIE GIESCHE'], [100, 'D', 'SORTOWNIA'], [132, 'E', 'SCHACHT III']];
const CHECK = [2, 31, 63, 101, 133];

// ---------- entities ----------
// Every entity in native px: the draft's numbers (its tile is TS / K = 32 px) x u = K, sizes from style.js SCALE. Speeds px/s,
// times s.
const ENT = (u => {
  const T = TS, G = GROUND * T, [CW, CH] = S.SCALE.cart;
  return {
    // Moving platforms (speed px/s; pause = rest at each end, wait = rest before the first move, both in seconds). They are solid
    // from above only. ceil = a ceiling the mover carries over its floor (x from its left edge, y up from its floor, negative):
    // heads bump on it from below (the bucket's yoke crossbar). The cage spans the 5-tile shaft. sprite: a hunt's model sprite
    // (art/models.js: one tub of the owner's car, or its two coupled).
    movers: [
      { id: 'cart1', kind: 'cart', sprite: 'cart_tub', x: 1140 * u, y: G - CH, w: CW, h: CH, axis: 'x', min: 1140 * u, max: 1140 * u, speed: 0, pause: 0 },   // parked hunt: a step from the street to the station
      { id: 'cart2', kind: 'cart', sprite: 'cart_pair', x: 1690 * u, y: G - CH, w: CW, h: CH, axis: 'x', min: 1690 * u, max: 1850 * u, speed: 48 * u, pause: 1.0 },   // shunting hunt past the chasm
      { id: 'bucket', kind: 'bucket', x: 41 * T, y: 9 * T, w: 56 * u, h: 24 * u, axis: 'x', min: 41 * T, max: 49 * T - 56 * u, speed: 72 * u, pause: 0.85,  // cable-car bucket: station to station over cols 41-48
        ceil: { x0: -3 * u, x1: 60 * u, y: -70 * u } },
      { id: 'cage', kind: 'cage', x: 144 * T, y: G, w: 5 * T, h: 12 * u, axis: 'y', min: G, max: G + 184 * u, speed: 66 * u, wait: 2.5, pause: 2.85 }
    ],
    cable: { x0: 38.5 * T, x1: 50.5 * T, y: 206 * u },   // cable-car rope between the two pylon heads
    pylons: [38.5 * T, 50.5 * T],                      // pylon axes, standing in the two loading stations
    guardTower: { c: 56 }, sandbags: { c: 61 },        // B: watch tower with searchlight; sandbag nest at the colony checkpoint (under its sign)
    rails: { c0: 30, c1: 61 },                         // B: track on the ground
    wire: { c0: 15, c1: 25 },                          // A: Sperrzone barbed wire (posts every 2 columns, none over the trench)
    // Signs on two posts, the board's bottom edge SCALE.signUp over the street (above the hero's head: he walks under them); c = the
    // board's first column. KOLONIE GIESCHE ends at col 62, clear of the col-65 ladder and the first familok's corner.
    signs: [{ c: 17, text: 'SPERRZONE', warn: true }, { c: 31, text: 'GLEIS 4' }, { c: 58, text: 'KOLONIE GIESCHE' }, { c: 98, text: 'SORTIERUNG' }, { c: 133, text: 'SCHACHT III' }],
    lamps: [26, 34, 52, 96, 123, 139, 152],            // sodium lamp posts (columns; clear of the signs and the parked cart); fx glows them
    vents: [{ c: 106, phase: 0 }, { c: 112, phase: 70 }, { c: 125, phase: 130 }],   // D: steam vents (phase in frames of a 200-frame cycle)
    chimneys: [69, 75, 85, 91],                        // C: chimney stacks on the familok roofs (columns; they stand on standRow); fx smokes them
    smogBank: { c0: 60, c1: 100, y0: 80 * u, y1: 300 * u },   // C: the colony's coal smoke hanging behind its rooftops (fx, behind the playfield)
    kotwica: [{ c: 68, r: 9, s: 2, tag: 'PW' }, { c: 108, r: 9, s: 1 }],   // graffiti anchors (tile, cell size)
    banner: { c: 86, r: 7 },                           // torn regime banner on the second familok
    shaft: { c0: 144, c1: 148 },                       // E: shaft columns (the cage spans them)
    // E: the playfield headframe's box over the shaft: x, w = its left and width, h = its height over the street, to its top (the
    // sheaves' rims). It is the owner's model sprite (art/models.js 'headframe': its anchor the shaft's centre line, 154 px from
    // its left; 334 px wide, the raking strut to the right; 382 px tall with its sheaves); the procedural fallback of art/props.js
    // fills the same box. What the camera frames is props.headframe(), the one drawn.
    headframe: { x: 146.5 * T - 154, w: 334, h: 382 },
    landmark: { c0: 136, c1: 159 },                    // E: the camera's framing zone (columns of the hero's centre; see E)
    engineHouse: { c: 151 },                           // E: winding-engine house
    // Story props from the owner's 3D models (art/models.js sprites, drawn by art/props.js in front of the tiles, behind the hero):
    // sprite, c = the column of its anchor (its middle; fractional), standing on the street there; rail: on a short piece of track
    // (the rail head, as the hunts' wheels on the B siding). Clear of every spot the hero stands at for long (checkpoints, the
    // playtest's VALUE spots: >= 1 tile off his hitbox), of the sign posts and lamp posts and of the movers' paths; none of them
    // is solid (the scenery's outline, not the movers' OUTLINE: style.js).
    models: [
      { sprite: 'barrel_c', c: 29.6 },                                    // B: a drum at the head of the siding, before GLEIS 4
      { sprite: 'cart_parked', c: 114.4, rail: true },                    // D: the two-tub car parked under the belt, out of reach
      { sprite: 'barrel_lying', c: 130 }, { sprite: 'barrel_b', c: 131.05 }, { sprite: 'barrel_a', c: 131.7 },   // D: drums at the yard's end
      { sprite: 'barrel_stack', c: 137.2 },                               // E: on the shaft's bank
      { sprite: 'barrel_a', c: 154.4 }, { sprite: 'barrel_lying', c: 155.45 }   // E: by the engine house
    ]
  };
})(S.K);

// Debug / design aids --------------------------------------------------------------------------------------------------------
// ascii(): the map as text rows (for docs and tests).
function ascii(){ return grid.map(r => r.join('')); }
// checkHeadroom(): every standable surface with fewer than 3 free tiles above it (one-way tiles count as blocked). The post tops
// right under the belt (104 / 108 / 116, row 8) are skipped: nothing reaches them - the belt is not drop-through, its slab is a
// wall from the side (engine.js) and the posts close the lower road, so the space under the belt (cols 105-115) is out of reach
// (the playtest's no-softlock search proves it). The street under the belt's open tail (cols 117-120) is checked: 3 free tiles.
function checkHeadroom(need = 3){
  const bad = [];
  for (let c = 0; c < MW; c++) for (let r = 0; r < MH; r++){
    if (!(isSolid(c, r) || isOneWay(c, r)) || isSolid(c, r - 1) || tile(c, r - 1) === 'T') continue;
    for (let k = 1; k <= need; k++){ const t = tile(c, r - k); if (r - k < 0) break; if (SOLID.has(t) || t === 'P' || t === 'T'){ bad.push({ c, r, blockedAt: r - k, by: t }); break; } }
  }
  return bad;
}

LVL.map = { TS, MW, MH, LW, LH, GROUND, grid, tile, isSolid, isLadder, isOneWay, isDropThrough, standRow, SEGS, CHECK, ENT, ascii, checkHeadroom };
})();
