/* art/tiles.js - every tile kind of the playfield (the cells of LVL.map.grid), painted natively: TS = 48 px cells at 52.5 px per
 * metre, the density of the 96 px hero (style.js RESOLUTION, SCALE).
 *
 * API (called by engine.js when it builds the static playfield canvas, g = a context of the whole level, LW x LH native px):
 *   tiles.drawBack(g)        behind everything on the playfield: the backs of the pits (columns with no floor), by beat: the A
 *                            tank trench's plank revetment, the B chasm's spoil strata (hazed by the distance across), the E
 *                            shaft's brick lining with its cage guides and buntons; each sinks into the dark, its left lip casting
 *                            a shadow down the back
 *   tiles.draw(g)            every tile: the G ground (crust, the made ground and the coal measures under it, stones, faces) from
 *                            the map's cells, the other kinds per block / run found in the map (S steel blocks, C crates, P
 *                            catwalks, T belts, L ladders) and the B familok facades per house block (tiles.houses)
 *   tiles.drawAnim(ctx, v)   per frame on the game canvas (v = { cx, cy, t }: the camera's top-left, the frame counter): the belts'
 *                            moving parts (cleats and coal riding the top run, splices on the return run, the turning drums and
 *                            idlers), moved in whole px: floor(t x the engine's push P.BELT x DT), the px the push carries the
 *                            hero standing on the belt
 *   tiles.belts              the conveyor runs found in the map: [{ r: row, c0, c1: first and last column }]
 *   tiles.houses             the familok blocks (connected B cells) and their facades, native px, left to right: [{ c0, c1, r0,
 *                            r1, x, y, w, h, street: the y they stand on, storeys, attic: px of attic band over them, no: house
 *                            number, doors: [{ x, y, w, h }], windows: [{ x, y, w, h, lit, boarded?, k: storey (0 = street), v: a
 *                            hashed 0..1 that picks its dressing: curtains, drapes, a plant, a crack }], attics: [{ x, y, lit }]
 *                            (AW x AH = 24 x 18) }] (e.g. for window glows: a lit window's glass is its box inset by its 3 px frame)
 * Look (style.js): light from the upper left (lit top / left edges and faces, shadowed bottom / right ones; a recess takes its
 * shadow on its top and left inside, its light on the bottom and right), hue-shifted ramps only, every pattern keyed to WORLD
 * coordinates through hash() / noise() so nothing visibly repeats, the walkable top of every kind its brightest line (only the
 * A heap's embers glow brighter, and the lit windows), 1 px detail, no noise and no dithering: transitions are posterised bands
 * with wavy edges, like the hero's shading. Scale (SCALE, native px): bricks 12 x 4 + 1 px mortar (a 13 x 5 bond), storeys 144,
 * windows 42 x 66, street doors 60 x 120, crates 48, ladder rungs every 14, sleepers 14 x 8, ground stones 3..36 px across,
 * stencilled letters 7 px tall.
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, M = LVL.map, E = M.ENT;
const { RAMP, SCALE, VW, VH, mk, R, line, disc, circle, hash, noise, txt } = S;
const tiles = LVL.art.tiles = {};
const TS = M.TS, LW = M.LW, LH = M.LH;
const CO = RAMP.coal, BR = RAMP.brick, ST = RAMP.steel, RU = RAMP.rust, WD = RAMP.wood, LA = RAMP.lamp, PA = RAMP.paper,
  SM = RAMP.smog, BN = RAMP.banner, SL = RAMP.slag, SN = RAMP.stone, PT = RAMP.paint, GL = RAMP.glass, BS = RAMP.basalt,
  DU = RAMP.dust;

// ---------- reading the map ----------
const tile = M.tile, solid = M.isSolid;
const SEGC = Array.from({ length: M.MW }, (_, c) => { let s = M.SEGS[0][1]; for (const q of M.SEGS) if (c >= q[0]) s = q[1]; return s; });
const seg = c => SEGC[Math.max(0, Math.min(M.MW - 1, c))];                                        // beat letter of a column
const span = l => { const i = M.SEGS.findIndex(q => q[1] === l); return [M.SEGS[i][0], i + 1 < M.SEGS.length ? M.SEGS[i + 1][0] : M.MW]; };   // a beat's columns [c0, c1)
// blocks(ch): the connected cells of one kind (4-neighbour) with their bounding box, in cells and px
function blocks(ch){
  const seen = new Uint8Array(M.MW * M.MH), out = [];
  for (let r = 0; r < M.MH; r++) for (let c = 0; c < M.MW; c++){
    if (M.grid[r][c] !== ch || seen[r * M.MW + c]) continue;
    const b = { c0: c, c1: c, r0: r, r1: r }, st = [[c, r]]; seen[r * M.MW + c] = 1;
    while (st.length){ const [x, y] = st.pop(); b.c0 = Math.min(b.c0, x); b.c1 = Math.max(b.c1, x); b.r0 = Math.min(b.r0, y); b.r1 = Math.max(b.r1, y);
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]])
        if (X >= 0 && X < M.MW && Y >= 0 && Y < M.MH && M.grid[Y][X] === ch && !seen[Y * M.MW + X]){ seen[Y * M.MW + X] = 1; st.push([X, Y]); } }
    out.push(Object.assign(b, { x: b.c0 * TS, y: b.r0 * TS, w: (b.c1 - b.c0 + 1) * TS, h: (b.r1 - b.r0 + 1) * TS }));
  }
  return out;
}
// y of the ground's top in each column (its first G from the top); TOP0 = the highest
const groundTop = Array.from({ length: M.MW }, (_, c) => { let r = 0; while (r < M.MH && M.grid[r][c] !== 'G') r++; return r * TS; });
const TOP0 = Math.min(...groundTop);

// ---------- per-pixel painting ----------
// The ground and the pit backs are painted pixel by pixel into buffers sized to the box they cover, then drawn in one go
// (transparent where nothing was set); pixels() does the same for small boxes (window glass). DARKER: one ramp step down, for
// shadows cast over finished colours; HEX: the ramp colour of a pixel value (every ramp colour is registered).
const U32 = new Map(), HEX = new Map(), DARKER = new Map();
function u32(hex){ let v = U32.get(hex); if (v === undefined){ const n = parseInt(hex.slice(1), 16); v = (0xff000000 | (n & 255) << 16 | (n & 0xff00) | n >> 16) >>> 0; U32.set(hex, v); HEX.set(v, hex); } return v; }
for (const k in RAMP) RAMP[k].forEach((col, i) => { u32(col); if (!DARKER.has(col)) DARKER.set(col, RAMP[k][Math.max(0, i - 1)]); });
// pixbuf(X, Y, W, H): a W x H buffer whose top-left is world (X, Y); every call takes world px. set(x, y, null) clears a pixel,
// dark(x, y) takes the colour there one ramp step down.
function pixbuf(X, Y, W, H){
  const [c, g] = mk(W, H), img = g.createImageData(W, H), u = new Uint32Array(img.data.buffer);
  const at = (x, y) => { x -= X; y -= Y; return x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1; };
  let lc = null, lv = 0;                                                                           // the last colour set (runs repeat it)
  return {
    set(x, y, col){ const i = at(x, y); if (i >= 0) u[i] = !col ? 0 : col === lc ? lv : (lc = col, lv = u32(col)); },
    has(x, y){ const i = at(x, y); return i >= 0 && u[i] !== 0; },
    dark(x, y){ const i = at(x, y); if (i >= 0 && u[i]) u[i] = u32(DARKER.get(HEX.get(u[i])) || CO[0]); },
    blit(dst){ g.putImageData(img, 0, 0); dst.drawImage(c, X, Y); }
  };
}
// pixels(g, x, y, w, h, fn): fn(i, j) -> a colour (or null: left as it is) for each pixel of a w x h box (w, h <= 128), in one go
const [SCR, SG] = mk(128, 128);
function pixels(g, x, y, w, h, fn){
  const img = SG.createImageData(w, h), u = new Uint32Array(img.data.buffer);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){ const col = fn(i, j); if (col) u[j * w + i] = u32(col); }
  SG.clearRect(0, 0, w, h); SG.putImageData(img, 0, 0); g.drawImage(SCR, 0, 0, w, h, x, y, w, h);
}
// shade(g, x, y, rows, pal): a small hand-pixel shape ('#' its body, 'o' a rivet or bolt head, '.' empty) lit from the upper left:
// a px with an empty neighbour above or to its left takes pal[2] (lit), else one with an empty neighbour below or to its right
// pal[0] (shadow), else pal[1]; a rivet head pal[3]. A shape mirrored by the caller (rows reversed / flipped) is shaded right.
function shade(g, x, y, rows, pal){
  const on = (i, j) => j >= 0 && j < rows.length && i >= 0 && i < rows[j].length && rows[j][i] !== '.';
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++){ if (r[i] === '.') continue;
    R(g, x + i, y + j, 1, 1, r[i] === 'o' ? pal[3] : !on(i, j - 1) || !on(i - 1, j) ? pal[2] : !on(i, j + 1) || !on(i + 1, j) ? pal[0] : pal[1]); } });
}
const flipX = rows => rows.map(r => [...r].reverse().join('')), flipY = rows => rows.slice().reverse();

// ---------- G: the ground ----------
// Colliery spoil and the ground it was tipped on, painted in passes into one buffer (paintGround): the cells (crust over the
// body), the buried track, the ballast, the stones, the exposed faces, the loose stuff on top.
// Crust: a cell whose top is not more ground (air, or something standing on it: the street runs on under the houses) gets its
// beat's lit crust, its top row the brightest line (coal dust and fines lit by the sky dome, now and then a lip 2 px thick): A / B
// slag (three wavering bands; embers: the heap smoulders), B track ballast (basalt chips over a band of fines), C domed setts in
// sand joints, D spilled coal, E cinders and ash. Where two crusts meet on level ground nothing stops on a column line: the loose
// ones blend across it, the ballast's bed ends in a shoulder with chips strayed over the loose crust beside it, a sett course ends
// on a dressed kerb sett with the fines of a loose crust beside it spilled over its last setts.
const SURF = c => (c >= E.rails.c0 && c <= E.rails.c1) ? 'ballast' : { A: 'slag', B: 'slag', C: 'cobble', D: 'coal', E: 'ash' }[seg(c)];
const CRUST = { slag: [DU[4], DU[2], CO[4], CO[3]], coal: [DU[3], CO[4], CO[3], CO[2]], ash: [SM[7], SM[6], SM[5], CO[3]],   // [line, upper, lower, under]
  ballast: [BS[5], BS[4]] };                                                                       // (ballast: its line and chips, for faces and pebbles)
const LOOSE = { slag: 1, coal: 1, ash: 1 };                                                        // the crusts that blend and spill
const PACKED = { ballast: 16, cobble: 14 };                                                      // rows of a packed crust no stone enters
const isSpoil = c => seg(c) === 'A' || seg(c) === 'B';
const AIR = null;                                    // a crust px left clear (a sunk or missing sett); undefined: under the crust, the body
// runs(surf): the runs of open-topped cells of one crust, left to right: { r, xa, xb (px, xb exclusive), nl, nr: the crust of the
// open ground going on level with it on the left / right, null at a pit or a riser }
function runs(surf){
  const out = [], open = (k, r) => tile(k, r) === 'G' && tile(k, r - 1) !== 'G';
  for (let r = 0; r < M.MH; r++) for (let c = 0; c < M.MW; c++){
    if (!open(c, r) || SURF(c) !== surf || (open(c - 1, r) && SURF(c - 1) === surf)) continue;
    let e = c; while (open(e + 1, r) && SURF(e + 1) === surf) e++;
    out.push({ r, xa: c * TS, xb: (e + 1) * TS, nl: open(c - 1, r) ? SURF(c - 1) : null, nr: open(e + 1, r) ? SURF(e + 1) : null });
  }
  return out;
}
const SETTS = runs('cobble'), BALLAST = runs('ballast'), runAt = (list, x, r) => list.find(q => q.r === r && x >= q.xa && x < q.xb);
const KERB = 16, SHOULDER = 18;                                                                    // a kerb sett's length; the ballast shoulder
// stone(x, layer, pitch, jit): the stone of a packed layer (the setts) holding x: the axis cut into stones pitch +- jit px long;
// returns [first x, length, id]
function stone(x, layer, pitch, jit){
  const edge = k => k * pitch + Math.floor((hash(k, layer) - 0.5) * jit);
  let k = Math.floor(x / pitch); while (edge(k) > x) k--; while (edge(k + 1) <= x) k++;
  return [edge(k), edge(k + 1) - edge(k), k];
}
// A column x of the crust (everything in it depends on x only): j (the row under the top) -> its colour, AIR, or undefined under
// the crust. Setts (run q): a course of setts (8..17 px wide, 6..8 tall) in sand joints swept full to the top: each one value of
// the basalt ramp, a lit cap on the upper left, a lit left side, a shadowed right side and underside; most domed (rounded
// shoulders), some worn flat, now and then one sunk a px or gone (its sand bed and a pebble in the hole), a joint run full of tar
// (a cold sheen on top); a sand bed and the fill under them. At an end of the course that meets level ground a kerb sett:
// sandstone dressed square, a lit top arris and left side, a tooled face, its right side in shadow; beside a loose crust its
// fines lie spilled over the kerb and the last setts, thinning out away from it (thicker in the joints).
function settCol(x, q){
  const k = noise(x / 13, 0.5, 4) * 4 | 0, bed = j => j < 10 + (k >> 1) ? SN[1] : j < 14 + k ? CO[3] : undefined;
  const sp = LOOSE[q.nr] ? q.xb - x : LOOSE[q.nl] ? x - q.xa + 1 : 1e9, reach = KERB + 18 + (noise(x / 9, 6.5, 59) * 14 | 0);
  const dust = sp < reach ? Math.max(0, Math.round(3 * (1 - sp / reach) + noise(x / 6, 1.5, 58) - 0.4)) : 0;   // rows of spilled fines on top
  const fines = (j, col) => j < dust ? (j ? CO[4] : DU[3]) : col;
  if ((q.nl && x < q.xa + KERB) || (q.nr && x >= q.xb - KERB)){                                    // a kerb sett
    const i = q.nl && x < q.xa + KERB ? x - q.xa : x - q.xb + KERB;
    return j => j > 8 ? bed(j) : fines(j, j === 8 || i === KERB - 1 ? SN[1] : j === 0 ? (i ? SN[4] : SN[5]) : i === 0 ? SN[3] : i === KERB - 2 ? SN[1]
      : j === 1 ? SN[3] : (j === 3 || j === 4) && (i === j + 1 || i === j + 7) ? SN[3] : SN[2]);    // (two chisel strokes)
  }
  const [sx, sw, id] = stone(x, 50, 12, 6), w = sw - (hash(id, 52) > 0.7 ? 2 : 1), i = x - sx, t = 3 + (hash(id, 51) * 3 | 0);
  const top = hash(id, 54) < 0.12 ? 1 : 0, bot = top + 5 + (hash(id, 55) * 3 | 0), domed = hash(id, 53) > 0.4, tar = hash(id, 56) < 0.18;
  const gone = w >= 8 && hash(id, 57) < 0.03, edge = i === 0 || i === w - 1, shoulder = i === 1 || i === w - 2, lit = i <= 2 + w / 3;
  return j => {
    if (j > 8) return bed(j);
    if (i >= w) return j > 6 ? SN[1] : tar ? (j ? CO[1] : ST[3]) : j === 0 && top ? AIR : fines(j + (dust ? 0 : 1), j ? SN[1] : SN[2]);   // the joint
    if (gone) return j < 2 ? AIR : fines(j - 2, j === 2 ? (i === w >> 1 || i === (w >> 1) + 1 ? BS[4] : SN[2]) : SN[1]);
    if (j < top) return AIR;
    if (j > bot) return SN[1];
    let col;
    if (j === top) col = edge ? (domed ? SN[1] : BS[t]) : shoulder && domed ? BS[t] : lit ? BS[t + 2] : BS[t + 1];
    else if (j === bot) col = edge && domed ? SN[1] : lit ? BS[t - 1] : BS[t - 2];
    else if (i === 0) col = BS[t + 1];
    else if (i === w - 1) col = j > top + 3 ? BS[t - 2] : BS[t - 1];
    else if (j === top + 1 && lit) col = BS[t + 1];
    else if (j === bot - 1) col = lit ? BS[t] : BS[t - 1];
    else col = hash(x, id * 7 + j) < 0.04 ? BS[t - 1] : BS[t];                                      // a fleck in the stone
    return fines(j - top, col);
  };
}
// Ballast (run q): its line and fines (the chips come in ballast()); where it meets a loose crust its bed's shoulder slopes down
// and out across SHOULDER px, the loose crust over it. Slag, coal, ash: the line, then three bands wavering apart.
function crustCol(x, surf, q){
  if (surf === 'ballast'){
    const f = 15 + (noise(x / 13, 0.5, 4) * 4 | 0), bed = j => j === 0 ? BS[5] : j < 10 ? BS[2] : j < f ? BS[1] : undefined;
    const sh = LOOSE[q.nl] && x < q.xa + SHOULDER ? [q.nl, x - q.xa] : LOOSE[q.nr] && x >= q.xb - SHOULDER ? [q.nr, q.xb - 1 - x] : null;
    if (!sh) return bed;
    const loose = crustCol(x, sh[0]); return j => sh[1] < SHOULDER - j * 1.1 ? loose(j) : bed(j);
  }
  if (surf === 'cobble') return settCol(x, q);
  const near = SURF((x + (noise(x / 16, 7.7, 3) - 0.5) * 72) / TS | 0);                       // loose crusts blend across a beat line
  const P = CRUST[LOOSE[near] ? near : surf], line = hash(x >> 1, 5) < 0.06 ? P[1] : P[0];
  const lip = noise(x / 9, 3.3, 9) > 0.64;                                                         // the lit lip 2 px thick
  const a = 1 + (noise(x / 9, 0.5, 4) * 3.6 | 0), b = a + 3 + (noise(x / 21, 1.5, 4) * 7 | 0), d = b + 3 + (noise(x / 8, 2.5, 5) * 4 | 0);
  return j => j === 0 || (j === 1 && lip) ? line : j <= a ? P[1] : j <= b ? P[2] : j <= d ? P[3] : undefined;
}
// Body: the ground under the crust, quiet (it lies under his feet: the dark steps of the coal, slag and stone ramps; mostly flat
// tone, the marks in it rare and deliberate), by world (x, y); every depth is taken from the street level GY (the map's GROUND
// row) or the level's foot LH. Over the buried land surface (OLD, ~GY + 48; under the colony's lower street its fill goes 30 px
// deep) made ground: on the A / B heaps and the D / E yards the spoil in tipped layers dipping right the way it was tipped (tip():
// a broken 1 px parting between them, a lens of burnt red spoil in one layer of six), the colony's fill a plain one, each tipped
// layer running on into it a hashed way before it pinches out (no seam at the beat lines); a dark soil line on the old surface.
// Under it the coal measures (MEASURES, measure()): shale with long partings, mudstone (ironstone nodules: stones()), a coal seam
// with its cleat, a rare cold glint along its top and a dirt band where it swells, the pale underclay under it with rootlets
// (pinching out here and there), a sandstone lens (flat tone under its lit top parting), shale and mudstone again. Each
// bed swells and thins on a wave of its own, the whole stack rolls in a gentle regional dip, and one small fault per beat
// (FAULTS) throws it a few px: a 1 px gouge line hading toward the downthrown side, broken now and then, dying out at the old
// surface (the made ground is younger). So no two beats show the same stack. The heap's deep made ground is one posterised step
// darker; so is the level's foot, two steps at the very bottom (deep()).
const GY = M.GROUND * TS;
const colOf = f => Int16Array.from({ length: LW }, (_, x) => f(x));
const OLD = colOf(x => GY + 44 + (noise(x / 83, 0.5, 81) * 8 | 0));
const DEEP = colOf(x => GY - 54 + 10 * noise(x / 41, 1.5, 76) | 0), FOOT = colOf(x => LH - 22 + 6 * noise(x / 23, 4.5, 84) | 0);
const deep = (x, y, col) => { if (y > FOOT[x]) col = DARKER.get(col); return y > LH - 8 ? DARKER.get(col) : col; };
const madeTo = (x, c) => Math.max(OLD[x], groundTop[c] + 30);
const tip = (x, y) => (y - 0.42 * x + 15 * noise(x / 55, y / 61, 71)) / 34;                     // layer index (floor) + place in it
const [CX0, CX1] = span('C').map(c => c * TS);
const tipped = (x, b) => x < CX0 - 24 + (hash(b, 78) * 96 | 0) || x >= CX1 + 24 - (hash(b, 79) * 96 | 0);   // layer b here, or the colony's fill
// [kind, thickness, the amplitude and wavelength of its swell] top down; the shale under the old surface runs down to the mudstone
const MEASURES = [['shale'], ['mud', 10, 3, 90], ['shale', 14, 4, 150], ['seam', 7, 2.5, 70], ['clay', 3, 5, 60], ['sand', 13, 10, 230], ['shale', 14, 4, 120], ['mud']];
const BED = n => MEASURES.findIndex(m => m[0] === n);
const BND = [null];                                                                                // BND[k][x]: bed k's top in column x, unfaulted
{ const acc = Float32Array.from({ length: LW }, (_, x) => GY + 57 + 14 * noise(x / 700, 0.5, 87) + 6 * noise(x / 110, 2.5, 88));   // the regional dip
  for (let k = 1; k < MEASURES.length; k++){ BND.push(colOf(x => Math.floor(acc[x]))); const [, T, A, wl] = MEASURES[k];
    if (T) for (let x = 0; x < LW; x++) acc[x] += Math.max(0, T + A * (2 * noise(x / wl, k + 0.5, 85 + k) - 1)); } }
// one fault in the middle of each beat, clear of its pits: { x (its trace at GY), t: the throw of the beds right of it, px down }
const FAULTS = M.SEGS.map(([c0, l], i) => { const c1 = span(l)[1];
  let c = c0 + Math.floor((0.3 + 0.4 * hash(c0, 88)) * (c1 - c0)); while (c < c1 - 3 && [0, 1, 2].some(k => tile(c + k, M.MH - 1) !== 'G')) c++;
  return { x: c * TS + (hash(c0, 89) * TS | 0), t: (i & 1 ? -1 : 1) * (3 + (hash(c0, 90) * 4 | 0)) }; });
const fx = (f, y) => Math.round(f.x + Math.sign(f.t) * (y - GY) * 0.4);                           // the fault's trace at depth y
const thrown = (x, y) => { let t = 0; for (let i = 0; i < FAULTS.length; i++) if (x > fx(FAULTS[i], y)) t += FAULTS[i].t; return t; };
const gouge = (x, y) => { for (let i = 0; i < FAULTS.length; i++) if (x === fx(FAULTS[i], y)) return hash(y >> 2, x) > 0.12; return false; };   // broken now and then
let MJ = 0, MT = 0;                                                                                // measure(): the row in the bed, its thickness
function measure(x, y){
  const yy = y - thrown(x, y); let k = 1; while (k < BND.length && yy >= BND[k][x]) k++; k--;
  const top = k ? BND[k][x] : GY; MJ = yy - top; MT = k + 1 < BND.length ? BND[k + 1][x] - top : 1e4;
  return k;
}
function bodyPx(x, y, c){
  const mb = madeTo(x, c);
  let col;
  if (y < mb - 2){
    col = CO[2];
    const s = tip(x, y), b = Math.floor(s), f = s - b;
    if (tipped(x, b)){
      if (f < 0.045 && hash(b, 74) < 0.6 && hash(x >> 3, b) < 0.8) col = CO[1];                  // a parting
      else if (hash(b, 73) < 0.17 && f > 0.35 && f < 0.6 + 0.2 * noise(x / 31, b, 75)) col = SL[1]; }   // burnt spoil
    if (y > DEEP[x]) col = DARKER.get(col);
  } else if (y < mb) col = hash(x >> 1, y) < 0.15 ? SL[0] : CO[1];                                // the old soil line
  else if (gouge(x, y)) col = CO[0];                                                             // a fault's gouge
  else {
    const k = measure(x, y), kind = MEASURES[k][0], j = MJ;
    col = kind === 'shale' ? (j % 5 === 2 && noise(x / 14, j + 9 * k, 92) > 0.6 ? CO[1] : CO[2])
      : kind === 'mud' ? CO[1]
      : kind === 'seam' ? (j === 0 ? (hash(x, 611) < 0.03 ? ST[2] : CO[1])                          // its top, a glint
        : j === MT - 1 || (hash(x, 612) < 0.025 && j < MT - 2) ? CO[0] : MT > 7 && j === MT >> 1 && noise(x / 40, 3.5, 91) > 0.6 ? CO[2] : CO[1])   // foot, cleat, dirt band
      : kind === 'clay' ? (hash(x >> 1, 613) < 0.06 && j > 1 ? CO[1] : SN[0])                       // rootlets
      : j === 0 ? SN[1] : SN[0];                                                                    // the sand's lit parting
  }
  return deep(x, y, col);
}
function groundCell(buf, c, r){
  const x0 = c * TS, y0 = r * TS, top = tile(c, r - 1) !== 'G', surf = SURF(c);
  const q = top ? (surf === 'cobble' ? runAt(SETTS, x0, r) : surf === 'ballast' ? runAt(BALLAST, x0, r) : null) : null;
  for (let i = 0; i < TS; i++){ const x = x0 + i, crust = top ? crustCol(x, surf, q) : null;
    for (let j = 0; j < TS; j++){ const v = crust ? crust(j) : undefined; buf.set(x, y0 + j, v === undefined ? bodyPx(x, y0 + j, c) : v); } }
}
// Buried track (B: under the siding, E.rails; D: the yard's narrow gauge, the beat's columns): an older line sunk in the made
// ground before the yards were raised, its sleepers resting on the old surface: rotten timber seen end-on (B: 14 x 8 px every
// ~34, the narrow gauge 10 x 6; some gone, some sunk 1..3 px or tilted), the rail lying along them (B 7 px: head, web in its
// shadow, foot; D 4), sagging with the ground, rusted, broken off now and then, a fishplate at its joints; each line ends a
// hashed way short of its columns' ends. Quiet: the rust and wood ramps' dark steps.
function buriedTrack(buf){
  const [d0, d1] = span('D');
  for (const [c0, c1, sw, sh, rh, pitch] of [[E.rails.c0, E.rails.c1 + 1, 14, 8, 7, 34], [d0, d1, 10, 6, 4, 26]]){
    const xa = c0 * TS + 18 + (hash(c0, 97) * 60 | 0), xb = c1 * TS - 18 - (hash(c1, 97) * 60 | 0);
    const ok = x => tile(x / TS | 0, M.GROUND) === 'G' && tile(x / TS | 0, M.GROUND - 1) !== 'G', yt = x => OLD[x] - 2 + (noise(x / 90, 9.5, 83) * 5 | 0);
    const lost = x => hash(Math.floor(x / 288), sh) < 0.3 && (x % 288) > 96 + hash(Math.floor(x / 288), 7) * 96;   // a length broken off
    for (let x = xa; x < xb; x++){                                                                  // the rail
      if (!ok(x) || lost(x)) continue; const y0 = yt(x) - sh - rh;
      for (let j = 0; j < rh; j++) buf.set(x, y0 + j, j === 0 ? RU[1] : rh > 4 && (j === 3 || j === 4) ? CO[1] : j === rh - 2 && rh > 4 ? RU[1] : RU[0]);
      if (x % 288 === 0) for (let i = -9; i < 9; i++) for (let j = 2; j < rh - 1; j++) buf.set(x + i, y0 + j, (i === -6 || i === 5) && j === 3 ? RU[2] : j === 2 ? RU[1] : RU[0]);   // fishplate, its bolts
    }
    for (let x = xa + (hash(c0, sh) * 12 | 0); x < xb - sw; x += pitch - 4 + (hash(x, sh + 1) * 9 | 0)){   // the sleepers
      if (!ok(x) || !ok(x + sw) || hash(x, 91) < 0.16) continue;
      const y0 = yt(x + (sw >> 1)) - sh + (hash(x, 94) * 3.6 | 0), tilt = hash(x, 95) < 0.3 ? (hash(x, 96) < 0.5 ? 1 : -1) : 0;
      const split = 3 + (hash(x, 92) * (sw - 6) | 0), rot = hash(x, 93);
      for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++){
        let col = j === sh - 1 || i === sw - 1 ? WD[0] : (j === 0 && i < sw - 3) || i === 0 ? WD[1] : j < sh >> 1 ? WD[1] : WD[0];   // lit top / left edges in WD[1]
        if (i === split && j > 1 && j < sh - 1) col = WD[0];                                         // a split end
        if (rot > 0.6 && j >= sh - 3 && i > sw - 6 && hash(x + i, j) < 0.6) col = CO[1];            // rotted away
        buf.set(x + i, y0 + j + (tilt > 0 ? i >= sw >> 1 : tilt < 0 && i < sw >> 1 ? 1 : 0), col); }
    }
  }
}

// Ballast, per run (BALLAST): three courses of angular basalt chips (stamps: L lit, B body, D shadow), laid bottom up so each course
// overlaps the one under it, a 1 px gap of fines between chips so each stone reads: the top course few and large (6..8 px, one
// broad lit face each, their lit faces making the line), the middle 4..6 px, the lowest the smallest and darkest. Where the run
// meets a loose crust on level ground its bed ends in a shoulder (the courses stop short, the top one shortest) and a few chips
// lie strayed over the crust beside it, thinning out; at a pit or the setts the chips stop at the run's end. (The sleepers and
// rails are props'.)
const CHIPS = [
  [['..LLLB.', '.LLLLBD', 'LLLLBBD', 'BBBBBDD', '.BBBDD.'], ['.LLLB.', 'LLLLBD', 'LLLBBD', 'BBBBDD', '.BBDD.'], ['..LLLLB.', '.LLLLLBD', 'LLLLLBBD', 'BBBBBBDD', '..BBBDD.'],
    ['.LLLLB', 'LLLLBD', 'LLBBBD', '.BBDD.']],                                                    // top course
  [['..LLB.', '.LLBBD', 'LLBBBD', 'BBBBDD', '.BBDD.'], ['.LLB', 'LLBB', 'LBBD', 'BBDD'], ['.LLLB.', 'LLLBBD', 'LBBBDD', '.BBDD.'],
    ['LLB.', 'LBBD', 'BBDD', '.DD.'], ['..LLB', '.LLBB', 'LLBBD', 'BBBDD', '.BDD.']],             // middle
  [['LLB', 'LBD', 'BDD'], ['.LB', 'LBD', 'BD.']]];                                                // lowest; strays
function ballast(buf){
  const stamp = (st, x, y, t, lo, hi, dd) => st.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.' && x + i >= lo && x + i < hi)
    buf.set(x + i, y + j, row[i] === 'L' ? BS[t + 1] : row[i] === 'B' ? BS[t] : BS[t - dd]); });
  for (const q of BALLAST){
    const { xa, xb } = q, y0 = q.r * TS, sl = LOOSE[q.nl] ? 1 : 0, sr = LOOSE[q.nr] ? 1 : 0;
    for (const [course, dy, t0, inset] of [[2, 10, 2, 2], [1, 5, 3, 9], [0, 0, 4, SHOULDER - 2]]){        // [course, row, tone, its inset on a shoulder]
      const set = CHIPS[2 - course], lo = sl ? -1e9 : xa, hi = sr ? 1e9 : xb, xe = xb - sr * inset;
      for (let x = xa + sl * inset - 3 + (hash(xa, course) * 4 | 0); x < xe;){
        const st = set[hash(x, course * 31 + q.r) * set.length | 0], t = t0 + (hash(x, course + 7) * 2 | 0), y = y0 + dy + (course === 1 ? hash(x, 13) * 2 | 0 : 0);
        stamp(st, x, y, t, lo, hi, course === 2 ? 2 : 1);
        x += st[0].length + 1 + (hash(x, course + 3) < 0.3 ? 1 : 0);
      }
    }
    for (const [on, e, s] of [[sl, xa, -1], [sr, xb, 1]]) if (on)                                // chips strayed over the loose crust beside it
      for (let d = 2; d < 44; d += 4 + (hash(e + d, 15) * 5 | 0)) if (hash(e + s * d, 16) < 0.75 * (1 - d / 44)){
        const st = CHIPS[2][hash(e + d, 17) * 2 | 0]; stamp(st, s < 0 ? e - d - 3 : e + d, y0 + (hash(e + d, 18) * 2 | 0), 3, -1e9, 1e9, 2); }
  }
}

// Stones in the made ground, on a jittered world grid. A cluster field gates them, so scree patches alternate with bare
// stretches; near the top they are bigger, denser and lighter (the largest break into the crust band), deep down sparse, small and
// dark; now and then a boulder. All are angular lumps (lump()): burnt shale on the A / B heaps splits into flat flakes (squashed
// 4..5-gons) lying along the partings of its tipped layers; the colony's fill holds brick bats, D's spill glossy anthracite (cold
// glints), E's ash vesicular clinker. Drawn top to bottom, so the lower ones lie in front. The coal measures under the made ground
// hold no loose stones, only a few ironstone nodules along the mudstone bed. Grit (1..4 px stamps) and the A heap's embers
// follow, gated the same way.
const TAU = Math.PI * 2;
const cluster = (x, y) => noise(x / 69, y / 40, 61) * 0.7 + noise(x / 19, y / 13, 62) * 0.3;
const parting = (x, y) => { const s = tip(x, y), b = Math.floor(s); return hash(b, 72) < 0.5 && s - b < 0.3; };   // near a tip parting
const KIND = { cobble: ['bat', 0.18], coal: ['coal', 0.65], ash: ['clinker', 0.45] };            // [kind, share] off the spoil heaps
const LUMP = {                                                                                     // [shadow, body, mid, lit] by depth band
  slag:    [[CO[0], CO[3], CO[4], CO[5]], [CO[0], CO[3], CO[4], CO[5]], [CO[0], CO[2], CO[3], CO[4]]],
  coal:    [[CO[0], CO[1], CO[2], ST[3]], [CO[0], CO[1], CO[2], ST[3]], [CO[0], CO[0], CO[1], ST[2]]],
  clinker: [[CO[0], SM[3], SM[4], SM[5]], [CO[0], SM[2], SM[3], SM[4]], [CO[0], SM[1], SM[2], SM[3]]],
  bat:     [[BR[0], BR[2], BR[3], BR[4]], [BR[0], BR[1], BR[2], BR[3]], [CO[0], BR[1], BR[1], BR[2]]],
  shale:   [[SL[0], SL[1], SL[2], SL[3]], [SL[0], SL[1], SL[2], SL[3]], [CO[0], SL[0], SL[1], SL[2]]],
  nodule:  [[CO[0], SL[1], SL[1], SL[2]]]
};
const LUMP_TOP = { slag: [CO[1], CO[4], CO[5], DU[3]], coal: [CO[0], CO[2], CO[3], ST[4]], clinker: [CO[1], SM[4], SM[5], SM[6]],   // in the
  bat: [BR[1], BR[3], BR[4], BR[5]], shale: [SL[0], SL[2], SL[3], SL[3]] };                       // crust: lit like it, never over the line
const GRIT = [['LB', 'BD'], ['LBB', 'BBD'], ['.LB', 'LBD', '.D.'], ['LB'], ['L', 'D'], ['.LL', 'LBD', 'BD.'], ['LLB', 'BBD', '.DD']];
const LM = new Int8Array(8192);                                                                    // lump(): its facet mask (tone, -1 outside)
function inTri(x, y, ax, ay, bx, by, cx, cy){
  const d1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), d2 = (cx - bx) * (y - by) - (cy - by) * (x - bx), d3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// lump(buf, L, ok): an angular lump at (L.cx, L.cy) of radius L.r: a 4..7-gon (or L.n; squashed by L.sq or a hashed 0.55..0.85,
// turned by a hashed angle) cut into facets from its peak; a facet takes the L.pal step ([shadow, body, mid, lit]) of how
// squarely it faces the upper left, so 1..3 facets on its top / left are lit, and its edge toward the light one step more. A lone
// facet pixel takes the tone all its neighbours share (clean clusters, like the hero's). Below a hashed line (or L.cut) it is
// buried in the matrix: its lowest visible pixel in each column is its shadowed underside, and a 1 px shadow falls under and right
// of it where it lies free. Coal gets a glint, clinker pores. ok(x, y): may paint there.
function lump(buf, L, ok){
  const { cx, cy, r, s, pal } = L, sq = L.sq ?? 0.55 + hash(s, 4) * 0.3, n = L.n ?? 4 + (hash(s, 1) * 4 | 0), a0 = hash(s, 2) * TAU, vx = [], vy = [];
  for (let i = 0; i < n; i++){ const a = a0 + (i + (hash(s, i + 3) - 0.5) * 0.7) * TAU / n, q = r * (0.72 + hash(s + i, 9) * 0.45);
    vx.push(cx + Math.cos(a) * q); vy.push(cy + Math.sin(a) * q * sq); }
  const px = cx + r * 0.1, py = cy - r * sq * 0.15, tone = [];                                      // the peak
  for (let i = 0; i < n; i++){ const k = (i + 1) % n, mx = (vx[i] + vx[k]) / 2 - px, my = (vy[i] + vy[k]) / 2 - py, f = -(mx + 1.4 * my) / (1.72 * Math.hypot(mx, my) + 1e-6);
    tone.push(f > 0.4 ? 3 : f > -0.1 ? 2 : f > -0.7 ? 1 : 0); }
  const X0 = Math.floor(Math.min(...vx)), Y0 = Math.floor(Math.min(...vy)), W = Math.ceil(Math.max(...vx)) - X0 + 1, H = Math.ceil(Math.max(...vy)) - Y0 + 1;
  const cut = L.cut ?? cy + (0.15 + hash(s, 6) * 0.85) * r * sq, m = LM.fill(-1, 0, (W + 2) * (H + 2));
  const at = (x, y) => x < X0 - 1 || x > X0 + W || y < Y0 - 1 || y > Y0 + H ? -1 : (y - Y0 + 1) * (W + 2) + x - X0 + 1, mt = (x, y) => { const i = at(x, y); return i < 0 ? -1 : m[i]; };
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++){
    if (y + 0.5 > cut + (hash(x, s) < 0.4 ? 1 : 0)) continue;
    for (let i = 0; i < n; i++){ const k = (i + 1) % n; if (inTri(x + 0.5, y + 0.5, px, py, vx[i], vy[i], vx[k], vy[k])){ m[at(x, y)] = tone[i]; break; } }
  }
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++){                              // lone facet pixels
    const i = at(x, y), t = m[i]; if (t < 0) continue; let u = -1, nb = 0, same = true;
    for (const q of [m[i - 1], m[i + 1], m[i - W - 2], m[i + W + 2]]){ if (q < 0) continue; nb++; if (u < 0) u = q; else if (q !== u) same = false; }
    if (nb >= 2 && same && u !== t) m[i] = u;
  }
  let glint = L.kind === 'coal' && L.band < 2 && hash(s, 11) < 0.8;
  for (let y = Y0; y < Y0 + H; y++) for (let x = X0; x < X0 + W; x++){
    const t = mt(x, y); if (t < 0 || !ok(x, y)) continue;
    const base = mt(x, y + 1) < 0, rimLit = t > 0 && (mt(x, y - 1) < 0 || mt(x - 1, y) < 0);       // its edge toward the light catches it
    buf.set(x, y, base ? pal[0] : glint && t === 3 ? ST[5] : pal[rimLit ? Math.min(3, t + 1) : t]); if (!base && t === 3) glint = false;
    if (base && y + 1 <= cut) m[at(x, y + 1)] = -2;                                                // the shadow it casts: marked -2
    if (mt(x + 1, y) === -1 && y >= cy - 1) m[at(x + 1, y)] = -2;
  }
  for (let y = Y0; y <= Y0 + H; y++) for (let x = X0; x <= X0 + W; x++) if (m[at(x, y)] === -2 && ok(x, y)) buf.dark(x, y);
  if (L.kind === 'clinker' && r >= 4) for (let k = 0; k < 3; k++){                                 // pores: shadowed inside top / left, lit lower right
    const x = Math.round(cx + (hash(s, 12 + k) - 0.5) * r), y = Math.round(cy - 1 + (hash(s, 14 + k) - 0.5) * r * sq);
    if (mt(x, y) > 0 && mt(x + 1, y + 1) > 0 && ok(x, y) && ok(x + 1, y + 1)){ buf.set(x, y, pal[0]); buf.set(x + 1, y + 1, pal[3]); } }
}
function stones(buf){
  const list = [], P = [[0.1, 0.45, 0.95], [0.025, 0.18, 0.8], [0.01, 0.07, 0.45]];             // chance by depth band x cluster (bare, mixed, scree)
  for (let gy = Math.floor(TOP0 / 12); gy * 12 < LH; gy++) for (let gx = 0; gx * 15 < LW; gx++){
    const cx = gx * 15 + hash(gx, gy + 300) * 13.5, cy = gy * 12 + hash(gx + 300, gy) * 10.5, c = cx / TS | 0;
    if (tile(c, cy / TS | 0) !== 'G' || cy > madeTo(cx | 0, c) + 3) continue;
    const d = cy - groundTop[c], surf = SURF(c), min = PACKED[surf] || 3, band = d < 24 ? 0 : d < 84 ? 1 : 2, hp = hash(gx * 5 + 3, gy * 11 + 7);
    if (d < min + 3 || hp > P[band][2]) continue;
    const g = cluster(cx, cy), h = hash(gx + 7, gy + 3), s = gx * 7919 + gy * 31;
    if (hp > P[band][g > 0.56 ? 2 : g > 0.44 ? 1 : 0]) continue;
    let r = [4.5 + h * 7.5, 3.75 + h * 5.25, 3 + h * 3.75][band] + (g > 0.56 ? 1.5 : 0);
    if (band && hash(gx + 13, gy + 17) < 0.02) r = 10.5 + h * 7.5;                                   // a boulder
    const kind = isSpoil(c) ? (r < 10.5 && (hash(s, 5) < 0.1 || (parting(cx, cy) && hash(s, 6) < 0.7)) ? 'shale' : 'slag') : hash(s, 5) < KIND[surf][1] ? KIND[surf][0] : 'slag';
    const flat = kind === 'shale' ? { r: r * 1.25, sq: 0.28 + hash(s, 7) * 0.14, n: 4 + (hash(s, 1) * 2 | 0) } : {};
    const top = surf === 'ash' && kind === 'slag' ? LUMP.slag[0] : LUMP_TOP[kind];                 // (under the ash's duller line: one step down)
    list.push({ cx, cy, r, s, kind, band, min, pal: d < 14 ? top : LUMP[kind][band], ...flat });
  }
  for (let x = 40; x < LW; x += 70 + (hash(x, 581) * 80 | 0)){                                  // ironstone nodules in the mudstone
    const c = x / TS | 0, m = BND[BED('mud')][x] + 5, y = m + thrown(x, m); if (tile(c, y / TS | 0) !== 'G' || y < madeTo(x, c) + 4 || hash(x, 582) < 0.35) continue;
    list.push({ cx: x, cy: y, r: 4 + hash(x, 583) * 3.5, s: x * 13, kind: 'nodule', band: 2, min: 3, pal: LUMP.nodule[0], sq: 0.5, n: 6, cut: y + 9 });
  }
  list.sort((a, b) => a.cy - b.cy);
  for (const L of list){
    const ok = (X, Y) => buf.has(X, Y) && tile(X / TS | 0, Y / TS | 0) === 'G' && Y - groundTop[X / TS | 0] >= L.min;
    lump(buf, L, ok);
  }
  const put = (X, Y, col, min) => { if (buf.has(X, Y) && Y - groundTop[X / TS | 0] >= min) buf.set(X, Y, col); };
  for (let gy = Math.floor(TOP0 / 9); gy * 9 < LH; gy++) for (let gx = 0; gx * 10 < LW; gx++){
    const x = gx * 10 + (hash(gx, gy + 101) * 9 | 0), y = gy * 9 + (hash(gx + 57, gy) * 8 | 0), c = x / TS | 0;
    if (tile(c, y / TS | 0) !== 'G' || !buf.has(x, y)) continue;
    const d = y - groundTop[c], surf = SURF(c), min = (PACKED[surf] || 3) + 1, kind = hash(gx + 9, gy + 13);
    if (d < min) continue;
    if (surf === 'slag' && d < 15 && kind < 0.05){ put(x, y, RU[4], min); put(x + 1, y, RU[3], min); put(x, y + 1, RU[2], min); put(x + 1, y + 1, RU[1], min); continue; }   // embers
    const hp = hash(gx * 3 + 1, gy * 7 + 2), p = (d < 21 ? 0.45 : d < 72 ? 0.2 : 0.07) * (y > madeTo(x, c) ? 0.2 : 1);
    if (hp > p * 1.5 || hp > p * (cluster(x, y) > 0.5 ? 1.5 : 0.5)) continue;                     // (the first test spares the noise)
    let pal = d < 21 ? [CO[5], CO[4], CO[1]] : d < 72 ? [CO[4], CO[3], CO[1]] : [CO[3], CO[2], CO[0]];   // [L, B, D]
    if (isSpoil(c) && kind < 0.15) pal = d < 72 ? [SL[3], SL[2], SL[0]] : [SL[2], SL[1], SL[0]];     // burnt shale
    else if (surf === 'coal' && kind < 0.4) pal = [ST[4], CO[1], CO[0]];                              // anthracite: a cold glint on black
    else if (surf === 'ash' && kind < 0.3) pal = [SM[5], SM[4], CO[1]];                               // ash, cinders
    else if (surf === 'cobble' && kind < 0.1) pal = [BR[4], BR[3], BR[1]];                            // brick grit
    GRIT[hash(gx + 31, gy + 17) * GRIT.length | 0].forEach((row, j) => { for (let i = 0; i < row.length; i++){ const ch = row[i];
      if (ch !== '.') put(x + i, y + j, ch === 'L' ? pal[0] : ch === 'B' ? pal[1] : pal[2], min); } });
  }
}

// The exposed sides of the ground (step risers, pit walls), per run of cells down a column: crumbling scree. The face itself
// stands 3 px back (lit on a LEFT face, in shadow on a RIGHT one) and small lumps are stacked down it at hashed steps (lump(),
// 3.6..6.3 px, each sticking out up to a px past the cell: the ragged edge), their top / left facets catching the light, darker
// deep down. A top outer corner open to the sky is chipped back 3 px; rubble lies heaped at the foot of a riser. The colony's
// are dressed kerbstones instead (a lit top arris, joints every 16 px).
function scree(buf, c, r0, r1, side, open){
  const x0 = c * TS, ex = side < 0 ? x0 : x0 + TS - 1, lit = side < 0, P = CRUST[SURF(c)], y0 = r0 * TS, y1 = (r1 + 1) * TS;
  for (let y = y0; y < y1; y++){
    const j = y - y0, deep = y - groundTop[c] > 72;
    if (open && j < 3){ for (let e = 0; e < 3 - j; e++) buf.set(ex - side * e, y, null); buf.set(ex - side * (3 - j), y, lit ? P[0] : j ? CO[4] : P[1]); continue; }
    for (let e = 0; e < 3; e++) buf.set(ex - side * e, y, null);
    buf.set(ex - side * 3, y, lit ? (deep ? CO[4] : CO[5]) : CO[1]); buf.set(ex - side * 4, y, lit ? (deep ? CO[3] : CO[4]) : CO[2]);
  }
  const ok = (X, Y) => Y >= y0 + (open ? 3 : 0) && Y < y1 && (side < 0 ? X >= x0 - 1 && X < x0 + 10 : X <= ex + 1 && X > ex - 10);
  for (let y = y0 + (open ? 6 : 1), k = 0; y < y1 + 3; k++){
    const s = c * 977 + k * 131 + (side > 0 ? 7 : 0), deep = y - groundTop[c] > 72;
    const pal = lit ? (deep ? [CO[0], CO[2], CO[3], CO[4]] : [CO[1], CO[3], CO[4], CO[5]]) : deep ? [CO[0], CO[1], CO[2], CO[3]] : [CO[0], CO[2], CO[3], CO[4]];
    lump(buf, { cx: ex - side * (2 + hash(s, 22) * 2.5), cy: y, r: 3.6 + hash(s, 21) * 2.7, s, pal, sq: 0.7 + hash(s, 23) * 0.3, cut: y + 13 }, ok);
    y += 4 + (hash(s, 24) * 6 | 0);
  }
}
function kerbFace(buf, c, r0, r1, side, open){
  const ex = side < 0 ? c * TS : c * TS + TS - 1;
  for (let y = r0 * TS; y < (r1 + 1) * TS; y++){ const joint = y % 16 === 15, arris = open && y === r0 * TS;
    for (let e = 0; e < 6; e++){ const x = ex - side * e;
      if (arris) buf.set(x, y, e ? (side < 0 ? SN[5] : SN[3]) : null);                              // the top arris (its corner worn round)
      else buf.set(x, y, joint ? SN[1] : side < 0 ? [SN[4], SN[3], SN[3], SN[3], SN[2], SN[1]][e] : [SN[1], SN[2], SN[2], SN[2], SN[2], SN[1]][e]); } }
}
function rubble(buf, c, r){                          // a heap of small lumps at the riser's foot, on the lower step (never over 6 px tall)
  const xf = (c + 1) * TS, yf = (r + 1) * TS, ok = (X, Y) => X >= xf - 4 && Y < yf && Y >= yf - 7 && (buf.has(X, Y) || tile(X / TS | 0, Y / TS | 0) === '.');
  for (let k = 0; k < 5; k++){ const s = c * 131 + r * 17 + k, rr = 5.1 - k * 0.8 + hash(s, 2) * 0.9;
    lump(buf, { cx: xf + 1 + k * 4 + hash(s, 1) * 2, cy: yf - rr * 0.45, r: rr, s, pal: [CO[2], CO[3], CO[4], CO[5]], cut: yf - 0.5 }, ok); }
}
function faces(buf){
  for (let c = 0; c < M.MW; c++) for (const side of [-1, 1]) for (let r = 0; r < M.MH; r++){
    const face = k => tile(c, k) === 'G' && !solid(c + side, k);
    if (!face(r) || face(r - 1)) continue;
    let e = r; while (e + 1 < M.MH && face(e + 1)) e++;
    const open = tile(c, r - 1) === '.';
    if (SURF(c) === 'cobble'){ kerbFace(buf, c, r, e, side, open); continue; }
    scree(buf, c, r, e, side, open);
    if (side > 0 && tile(c + 1, e) === '.' && tile(c + 1, e + 1) === 'G') rubble(buf, c, e);
  }
}
// on every open top but the setts: loose pebbles (1..2 px, at most as light as the line); on the A heap a few small lumps stand
// proud of it (3 px, lit facets one step under the line)
function loose(buf){
  for (let c = 0; c < M.MW; c++){
    const r = groundTop[c] / TS, surf = SURF(c); if (r >= M.MH || tile(c, r - 1) !== '.' || surf === 'cobble') continue;
    const x0 = c * TS, y0 = r * TS, f = CRUST[surf];
    for (let i = 4; i < TS - 4; i++){ const x = x0 + i, h = hash(x, y0 + 1);
      if (h < (surf === 'ballast' ? 0.07 : 0.035)){ buf.set(x, y0 - 1, f[1]); if (h < 0.015) buf.set(x + 1, y0 - 1, f[0]); } }
    if (seg(c) === 'A') for (let k = 0; k < 2; k++) if (hash(c, k + 40) < 0.35){ const s = c * 53 + k;
      lump(buf, { cx: x0 + 10 + k * 21 + hash(s, 41) * 9, cy: y0, r: 3.3 + hash(s, 42) * 2.4, s, pal: [CO[3], CO[4], CO[5], DU[3]], cut: y0 - 0.5 }, (X, Y) => Y < y0 && Y >= y0 - 3); }
  }
}
function paintGround(g){
  const y0 = TOP0 - 9, buf = pixbuf(0, y0, LW, LH - y0);
  for (let r = 0; r < M.MH; r++) for (let c = 0; c < M.MW; c++) if (M.grid[r][c] === 'G') groundCell(buf, c, r);
  buriedTrack(buf); ballast(buf); stones(buf); faces(buf); loose(buf);
  buf.blit(g);
}

// ---------- pit backs ----------
// The far wall of each pit seen across it, from its rim (the ground line) to the level's foot: the A trench is shored with planks
// between two posts (nailed to them), the B chasm cuts through spoil strata (a burnt red layer among them, a few lumps standing
// out of the upper ones), seen 8 tiles off across the smoky air, so hazed lighter, its crest a few px under the near ground line;
// the E shaft has a concrete collar over a brick lining, two timber cage guides (bolted to the buntons) and steel buntons. Across
// a death gap nothing may read as a walk line: the trench's far bank shows its lip over the rim but dark, the chasm's crest sinks
// under it, and the shaft leaves a dark gap at the rim with its collar set 5 px down, its top in the near lip's shadow (no lighter
// than the ground body), the guides running up through it. The left lip's shadow falls down-right across the back (light from
// the upper left); everything sinks into black in three posterised steps (sooner in the deep chasm). Under the pit walls the back
// starts 3 px down, under their chipped corners.
function post(i){ return i === 0 ? WD[3] : i === 5 ? WD[0] : i === 4 ? WD[1] : WD[2]; }          // a 6 px timber, lit left, shadowed right
function trenchPx(x, y, d, x0, x1){
  const pi = x - x0 - 6, pj = x1 - 12 - x;                                                     // the two posts
  if ((pi >= 0 && pi < 6) || (pj >= 0 && pj < 6)) return post(pi >= 0 && pi < 6 ? pi : pj);
  const pr = d % 11, pk = d / 11 | 0;
  if ((x === x0 + 13 || x === x1 - 13) && pr === 5) return ST[4];                              // the nails into the posts
  if (pr === 10 || ((x + pk * 19) % 43 === 0)) return WD[0];                                    // plank seams, butt joints
  return pr === 0 ? WD[2] : hash(x >> 3, pk * 7 + (pr >> 2)) > 0.84 && (pr === 4 || pr === 7) ? WD[0] : WD[1];   // lit plank edge, grain
}
function chasmPx(x, y){
  const band = Math.floor((y + 6 * noise(x / 28, y / 20, 21)) / 13), h = hash(band, 61);
  if (h < 0.2) return (y + band) % 13 === 0 ? SL[3] : SL[2];
  return h < 0.6 ? SM[3] : SM[4];
}
const COLLAR = 5;                                                                                   // the shaft collar's top, px under the rim
function shaftPx(x, y, d, x0, x1){
  const gi = x - x0 - 21, gj = x1 - 27 - x, i = gi >= 0 && gi < 6 ? gi : gj >= 0 && gj < 6 ? gj : -1, bd = (d - 41) % 60;
  if (i >= 0){ const col = d >= 41 && (bd === 2 || bd === 3) && (i === 1 || i === 4) ? ST[5] : post(i);   // the cage guides, bolted to the buntons
    return d < COLLAR + 8 ? DARKER.get(col) : col; }                                              // (in the rim's shadow down the collar)
  if (d < COLLAR) return d < 2 ? CO[0] : CO[1];                                                   // the dark gap at the rim
  if (d < COLLAR + 8) return d === COLLAR ? SN[2] : d === COLLAR + 7 ? CO[1] : SN[1];             // the collar: its top, face, the shadow under it
  if (d >= 41 && bd < 6) return bd === 0 ? ST[4] : bd === 5 ? ST[0] : bd === 4 ? ST[1] : ST[2];   // buntons
  const k = Math.floor((d - COLLAR - 8) / 5), off = (k & 1) * 6; if ((d - COLLAR - 8) % 5 === 0 || (x + off) % 13 === 0) return CO[1];   // brick lining
  return hash(Math.floor((x + off) / 13), k) > 0.6 ? BR[2] : BR[1];
}
function pitBack(g, p){
  const x0 = p.c0 * TS, x1 = (p.c1 + 1) * TS, top = GY, buf = pixbuf(x0 - 4, top - 12, x1 - x0 + 8, LH - top + 12);
  const F = p.kind === 'B' ? [33, 66, 99] : [57, 93, 126];                                       // depths of the three steps into the dark
  const lip = (x, d) => x - x0 < d * 0.9 - 3;                                                    // in the left lip's shadow
  for (let x = x0 - 4; x < x1 + 4; x++){                                                        // (4 px on under the ragged pit walls)
    const under = x < x0 || x >= x1, n = noise(x / 16, 0.5, 3) * 7 | 0;
    const crest = under ? -3 : p.kind === 'A' ? 3 + n : p.kind === 'B' ? -4 - n : 0;             // px over the rim (negative: under it)
    for (let y = top - crest; y < LH; y++){
      const d = y - top;
      let col = y === top - crest && !under && p.kind !== 'E' ? (p.kind === 'B' ? SM[5] : CO[4]) : d < 0 ? CO[3]
        : p.kind === 'A' ? trenchPx(x, y, d, x0, x1) : p.kind === 'E' ? shaftPx(x, y, d, x0, x1) : chasmPx(x, y);
      if (d > 0 && lip(x, d)) col = DARKER.get(col) || col;
      const dd = p.kind === 'E' ? d : d + 6 * noise(x / 19, 2.5, 5), fade = dd > F[2] ? 3 : dd > F[1] ? 2 : dd > F[0] ? 1 : 0;   // sinking into the dark
      for (let f = 0; f < fade; f++) col = DARKER.get(col) || col;
      buf.set(x, y, fade === 3 ? CO[0] : col);
    }
  }
  if (p.kind === 'B') for (let k = 0, x = x0 + 30; x < x1 - 24; k++, x += 26 + (hash(k, 64) * 28 | 0)){   // lumps in the far bank's upper layers, hazed
    const r = 5 + hash(k, 62) * 4.5, cy = top + 12 + (hash(k, 63) * 16 | 0);
    if (!lip(x - r, cy - top + r)) lump(buf, { cx: x, cy, r, s: x * 7 + 3, pal: [SM[2], SM[3], SM[4], SM[5]], sq: 0.55 + hash(k, 65) * 0.2 },
      (X, Y) => Y - top < F[0] - 2 && !lip(X, Y - top) && buf.has(X, Y));
  }
  buf.blit(g);
}

// ---------- S: riveted steel ----------
// Per block (the B loading stations, the D belt posts and block): plates one tile tall (72 wide on the 3-tile stations) with 2 px
// bevels (lit top / left, dark bottom / right: together the seams), domed rivets in rows 4 px inside the edges at ~9 px or a
// rippled weld bead, grime settled low on each plate (each its own: none, a low band or a high ragged one), a rust streak or two
// on some plates, wandering down from the top seam or a rivet, a ragged rust tide creeping up from the foot with specks over it,
// a dark contact edge and arris. On top: a checker-plate deck with a lit nosing (the brightest line; hazard stripes on the fascia
// toward a chasm) or, under the belt, a bearing cap; a post stands on a base plate with hex anchor nuts. The stations carry a
// stencil (STENCIL).
function rivet(g, x, y){                             // a 3 x 3 domed head: lit upper left, shadowed lower right, its shadow cast on the plate
  R(g, x + 1, y, 1, 1, ST[6]); R(g, x, y + 1, 1, 1, ST[6]); R(g, x + 1, y + 1, 1, 1, ST[5]); R(g, x + 2, y + 1, 1, 1, ST[3]); R(g, x + 1, y + 2, 1, 1, ST[3]); R(g, x + 2, y + 2, 1, 1, ST[2]);
}
const spaced = (a, b, p) => { const n = Math.max(1, Math.round((b - a) / p)), out = []; for (let k = 0; k <= n; k++) out.push(Math.round(a + (b - a) * k / n)); return out; };   // a..b in ~p steps
// a rust streak from (x, y), L px down: a warm head 2 px wide where the water leaves the seam or rivet (RU[3] beside RU[2] for a
// px or two), tapering to 1 px of RU[2], then the darker RU[1], dying out as stained steel (ST[3]) over its last third; it
// wanders 1 px now and then
function streak(g, x, y, L, s){
  for (let k = 0, X = x, head = 1 + (hash(s, 99) * 2 | 0); k < L; k++){
    if (k > 3 && hash(s, k) < 0.15) X += hash(s, k + 50) < 0.5 ? -1 : 1;
    const f = k / L; R(g, X, y + k, 1, 1, k === 0 ? RU[3] : f < 0.35 ? RU[2] : f < 0.67 ? RU[1] : ST[3]);
    if (k < head) R(g, X + 1, y + k, 1, 1, k ? RU[1] : RU[2]); }
}
function plate(g, x, y, w, h, weld){
  const hp = hash(x * 3 + 1, y), base = hp < 0.2 ? 0 : 2 + (hp * 7 | 0), fr = 8 + hash(x + 1, y) * 12, sd = 31 + (hash(y, x) * 40 | 0);
  R(g, x, y, w, h, ST[4]);
  if (base) for (let i = x + 3; i < x + w - 3; i++){ const gh = base + 2 * (noise(i / fr, y / 10, sd) * 2.4 | 0); R(g, i, y + h - 3 - gh, 1, gh, ST[3]);   // grime settled low, its tidemark
    const off = 4 + (hash(i, sd + 2) * 12 | 0); if (hash(i, sd + 1) < 0.04 && h - 3 - gh - off > 4) R(g, i, y + off, 1, h - 3 - gh - off, ST[3]); }   // ... and washed down the plate
  R(g, x, y, w, 1, ST[6]); R(g, x + 1, y + 1, w - 2, 1, ST[5]); R(g, x, y, 1, h, ST[5]); R(g, x + 1, y + 1, 1, h - 2, ST[5]);
  R(g, x, y + h - 1, w, 1, ST[1]); R(g, x + 2, y + h - 2, w - 3, 1, ST[3]); R(g, x + w - 1, y, 1, h, ST[1]); R(g, x + w - 2, y + 2, 1, h - 3, ST[3]);
  const cols = spaced(x + 5, x + w - 8, 9), rows = h >= 30 ? spaced(y + 4, y + h - 8, 9) : [y + 4, y + h - 8];
  if (weld) for (let i = x + 3; i < x + w - 3; i++){ R(g, i, y + 4, 1, 1, i % 3 ? ST[3] : ST[6]); R(g, i, y + 5, 1, 1, i % 3 === 1 ? ST[2] : ST[5]); R(g, i, y + 6, 1, 1, ST[3]); }
  else for (const i of cols) rivet(g, i, rows[0]);
  for (const i of cols) rivet(g, i, rows[rows.length - 1]);
  for (const j of rows.slice(1, -1)){ rivet(g, x + 4, j); rivet(g, x + w - 8, j); }
  const hs = hash(x, y + 5);
  for (let k = 0, n = hs < 0.45 ? 0 : hs < 0.85 ? 1 : 2; k < n; k++){ const s = x * 31 + y * 7 + k;   // rust streaks from the top seam, off the rivets
    streak(g, x + 6 + (hash(s, 1) * (w - 13) | 0), y + 3, 5 + (hash(s, 2) * 11 | 0), s); }
  if (rows.length > 2 && hash(y, x + 9) < 0.3){ const rx = hash(x, y + 9) < 0.5 ? x + 4 : x + w - 8, ry = rows[1 + (hash(x + 2, y) * (rows.length - 2) | 0)];
    streak(g, rx + 1, ry + 3, 4 + (hash(rx, ry) * 6 | 0), rx * 13 + ry); }                         // ... or one from a rivet of a side row
}
const NUT = ['.###.', '#####', '##o##', '#####', '.###.'];                                         // a hex anchor nut (its stud end the 'rivet')
// STENCIL: the paint on steel and crates, a stencil face 7 px tall with 1 px strokes (about 13 cm caps at 52.5 px / m: legible at
// 1x), the bridges a stencil needs cut through A's crossbar and B's spine; only the glyphs used (SEILBAHN, the crates' lot
// marks). stencil(g, s, x, y, col): 1 px between letters, whole strokes (a px worn off a 1 px stroke breaks the letter: the
// paint shows its age in its faded tone instead).
const STENCIL = { S: '.####|#....|#....|.###.|....#|....#|####.', E: '#####|#....|#....|####.|#....|#....|#####', I: '###|.#.|.#.|.#.|.#.|.#.|###',
  L: '#....|#....|#....|#....|#....|#....|#####', B: '####.|#...#|#...#|.###.|#...#|#...#|####.', A: '.###.|#...#|#...#|##.##|#...#|#...#|#...#',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', N: '#...#|##..#|#.#.#|#.#.#|#..##|#...#|#...#', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  G: '.####|#....|#....|#..##|#...#|#...#|.###.', 3: '####.|....#|....#|.###.|....#|....#|####.', 4: '#..#.|#..#.|#..#.|#####|...#.|...#.|...#.',
  7: '#####|....#|...#.|..#..|..#..|.#...|.#...' };
const stw = s => [...s].reduce((w, ch) => w + STENCIL[ch].indexOf('|') + 1, -1);
function stencil(g, s, x, y, col){
  g.fillStyle = col;
  for (const ch of s){ const rows = STENCIL[ch].split('|');
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') g.fillRect(x + i, y + j, 1, 1); });
    x += rows[0].length + 1; }
}
function paintSteel(g, b){
  const { x, y, w, h } = b, above = tile(b.c0, b.r0 - 1), deck = above === '.', cap = above === 'T', pw = w > TS && w % 72 === 0 ? 72 : TS;
  const y0 = y + (deck ? 12 : cap ? 6 : 0);
  for (let py = y0; py < y + h; py += TS) for (let px = x; px < x + w; px += pw)
    plate(g, px, py, Math.min(pw, x + w - px), Math.min(TS, y + h - py), hash(px, py) > 0.72);
  for (let i = x + 1; i < x + w - 1; i++){ const n = noise(i / 9, y / 13, 33) * 0.8 + hash(i, y + 33) * 0.2, rh = Math.max(0, (n - 0.5) * 18 | 0);   // a ragged rust tide
    if (rh){ R(g, i, y + h - 1 - rh, 1, rh, RU[0]); R(g, i, y + h - 1 - rh, 1, Math.min(2, rh), rh > 5 ? RU[2] : RU[1]); }
    if (hash(i, y + 34) < 0.1) R(g, i, y + h - 5 - rh - (hash(i, y + 35) * 9 | 0), 1, 1, RU[1]); }                 // specks over it
  R(g, x, y + h - 1, w, 1, ST[0]); R(g, x + w - 1, y, 1, h, ST[0]);
  if (deck){
    R(g, x, y, w, 1, ST[7]);                                                                     // nosing: the brightest line
    R(g, x, y + 1, w, 4, ST[5]);
    for (let i = x + 1; i < x + w - 5; i += 6){ R(g, i, y + 1, 3, 1, ST[6]); R(g, i + 1, y + 2, 2, 1, ST[3]); R(g, i + 3, y + 3, 2, 1, ST[6]); R(g, i + 4, y + 4, 2, 1, ST[3]); }   // checker plate
    R(g, x, y + 5, w, 1, ST[2]);
    R(g, x, y + 6, w, 6, ST[4]); R(g, x, y + 6, w, 1, ST[6]); R(g, x, y + 10, w, 1, ST[3]); R(g, x, y + 11, w, 1, ST[1]);   // fascia angle
    for (let i = x + 8; i < x + w - 6; i += 18){ R(g, i, y + 7, 2, 2, ST[5]); R(g, i, y + 7, 1, 1, ST[7]); R(g, i + 1, y + 8, 1, 1, ST[2]); }
    for (const side of [-1, 1]){                                                                 // hazard stripes toward a chasm
      const nc = side < 0 ? b.c0 - 1 : b.c1 + 1; if (tile(nc, M.MH - 1) !== '.') continue;
      const sx = side < 0 ? x : x + w - 36;
      for (let i = 0; i < 36; i++) for (let j = 0; j < 3; j++) R(g, sx + i, y + 7 + j, 1, 1, (i + j) % 8 < 4 ? LA[1] : CO[1]);
    }
    R(g, x, y, 1, 12, ST[6]);
  } else if (cap){ R(g, x - 3, y, w + 6, 6, ST[4]); R(g, x - 3, y, w + 6, 1, ST[6]); R(g, x - 3, y + 1, w + 6, 1, ST[5]); R(g, x - 3, y + 5, w + 6, 1, ST[1]);
    for (const bx of [x + 4, x + w - 7]){ R(g, bx, y + 2, 3, 2, ST[6]); R(g, bx + 2, y + 3, 1, 1, ST[2]); } }
  if (b.w === TS && b.h > TS){                                                                    // a post: base plate, anchor nuts
    const by = y + h - 6; R(g, x - 5, by, w + 10, 6, ST[3]); R(g, x - 5, by, w + 10, 1, ST[5]); R(g, x - 5, by + 5, w + 10, 1, ST[0]); R(g, x - 5, by, 1, 6, ST[5]);
    for (const nx of [x - 4, x + w - 1]) shade(g, nx, by - 5, NUT, [ST[2], ST[4], ST[6], ST[7]]); }
  if (b.w >= 3 * TS) stencil(g, 'SEILBAHN', x + ((pw - stw('SEILBAHN')) >> 1), y0 + 10, PA[1]);    // on a loading station, inside its first plate
}

// ---------- C: crates ----------
// Each crate cell is one crate (a stack reads as separate crates): a dark contour (the top one open to the sky its lit lid edge,
// the brightest line), three planks with grain and knots, a diagonal brace, a frame of boards lit on top / left, iron corner
// brackets with rivets, nail heads (a rust tear under some), a stencil in dark paint.
function board(g, x, y, w, h){ R(g, x, y, w, h, WD[3]); R(g, x, y, w, 1, WD[4]); R(g, x, y, 1, h, WD[4]); R(g, x, y + h - 1, w, 1, WD[1]); R(g, x + w - 1, y + 1, 1, h - 1, WD[1]); }
const IRON = ['##########', '#####o####', '###.......', '###.......', '###.......', '#o#.......', '###.......', '###.......', '###.......', '###.......'];
function paintCrate(g, c, r){
  const x = c * TS, y = r * TS, hc = (k, s) => hash(c * 7 + k, r * 13 + s);
  R(g, x, y, TS, TS, WD[0]);
  for (let k = 0; k < 3; k++){ const py = y + 7 + k * 12, ph = k === 2 ? 10 : 11;              // planks
    R(g, x + 7, py, 34, ph, WD[2]); R(g, x + 7, py, 34, 1, WD[3]); R(g, x + 7, py + ph - 1, 34, 1, WD[1]);
    for (let q = 0; q < 2; q++) R(g, x + 9 + (hc(k, q) * 10 | 0), py + 2 + (hc(k, q + 2) * (ph - 4) | 0), 8 + (hc(k, q + 4) * 14 | 0), 1, WD[1]);   // grain
    if (hc(k, 6) > 0.45){ const kx = x + (k ? 11 : 27) + (hc(k, 7) * (k ? 20 : 6) | 0), ky = py + 3 + (hc(k, 8) * 4 | 0);   // a knot (off the stencil)
      R(g, kx, ky, 3, 2, WD[0]); R(g, kx, ky - 1, 3, 1, WD[1]); R(g, kx - 1, ky, 1, 2, WD[1]); R(g, kx + 3, ky + 1, 2, 1, WD[1]); } }
  for (let i = 0; i < 34; i++){ const bx = x + 7 + i, by = y + 40 - i;                           // brace, lower left to upper right
    R(g, bx, by - 3, 1, 5, WD[3]); R(g, bx, by - 4, 1, 1, WD[4]); R(g, bx, by + 2, 1, 1, WD[0]); if (i % 9 === 4) R(g, bx, by - 1, 1, 1, WD[1]); }
  board(g, x + 1, y + 1, 46, 6); board(g, x + 1, y + 41, 46, 6); board(g, x + 1, y + 7, 6, 34); board(g, x + 41, y + 7, 6, 34);
  R(g, x + 9 + (hc(3, 0) * 20 | 0), y + 3, 11, 1, WD[2]); R(g, x + 15 + (hc(3, 1) * 16 | 0), y + 44, 9, 1, WD[2]);   // grain of the frame
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]){                                     // iron corners
    let rows = IRON; if (fx) rows = flipX(rows); if (fy) rows = flipY(rows);
    shade(g, fx ? x + 37 : x + 1, fy ? y + 37 : y + 1, rows, [ST[2], ST[3], ST[5], ST[6]]); }
  for (let k = 0; k < 3; k++){ const py = y + 11 + k * 12;                                       // nails
    R(g, x + 3, py, 2, 1, ST[5]); R(g, x + 3, py + 1, 1, 1, ST[3]); R(g, x + 43, py, 2, 1, ST[4]); R(g, x + 44, py + 1, 1, 1, ST[2]);
    if (hc(k, 9) < 0.4){ R(g, x + 3, py + 2, 1, 1, RU[2]); R(g, x + 3, py + 3, 1, 1 + (hc(k, 10) * 2 | 0), RU[1]); } }   // a rust tear
  stencil(g, ['K3', '47', 'G3'][hash(c, r) * 3 | 0], x + 11, y + 9, WD[1]);
  if (tile(c, r - 1) === '.') R(g, x + 1, y, TS - 2, 1, WD[4]);                                  // the lid's lit edge
}

// ---------- P: catwalks ----------
// Steel grating seen edge-on (its bars every 4 px with the sky glinting between, the lit top the brightest line), a side channel
// with bolts, a W truss under it; a slim tube handrail at the back (posts every tile, the top rail at 45 px, a knee rail), kept
// under the deck's value so it never reads as a ledge across the hero.
function paintCatwalk(g, b){
  const x0 = b.x, x1 = b.x + b.w, y = b.y, w = b.w, posts = [];
  for (let px = x0 + 3; px < x1; px += TS) posts.push(Math.min(px, x1 - 6));
  for (const X of posts){ R(g, X, y - 45, 3, 45, ST[3]); R(g, X, y - 45, 1, 45, ST[5]); R(g, X + 2, y - 45, 1, 45, ST[2]); }
  R(g, x0, y - 47, w, 1, ST[5]); R(g, x0, y - 46, w, 1, ST[4]); R(g, x0, y - 45, w, 1, ST[2]);     // top rail (a tube), knee rail
  R(g, x0, y - 24, w, 1, ST[4]); R(g, x0, y - 23, w, 1, ST[2]);
  R(g, x0, y, w, 1, ST[6]);                                                                      // the deck: its lit top, the grating's bars
  for (let i = x0; i < x1; i++){ const p = (i - x0) & 3;
    R(g, i, y + 1, 1, 1, p === 3 ? ST[3] : ST[5]); if (p !== 3) R(g, i, y + 2, 1, 4, p === 0 ? ST[4] : p === 1 ? ST[3] : ST[2]); }
  R(g, x0, y + 6, w, 1, ST[1]);
  R(g, x0, y + 7, w, 1, ST[5]); R(g, x0, y + 8, w, 4, ST[3]); R(g, x0, y + 11, w, 1, ST[2]); R(g, x0, y + 12, w, 1, ST[1]);   // side channel
  for (let i = x0 + 9; i < x1 - 3; i += 24){ R(g, i, y + 9, 2, 2, ST[5]); R(g, i, y + 9, 1, 1, ST[6]); R(g, i + 1, y + 10, 1, 1, ST[1]); }
  for (let i = x0; i < x1; i += 24){ g.fillStyle = ST[3]; line(g, i, y + 13, i + 12, y + 25); line(g, i + 12, y + 25, i + 24, y + 13);   // W truss
    g.fillStyle = ST[2]; line(g, i + 1, y + 13, i + 12, y + 24); line(g, i + 12, y + 24, i + 23, y + 13); }
  for (const X of posts){ R(g, X, y + 13, 3, 13, ST[3]); R(g, X, y + 13, 1, 13, ST[4]); R(g, X + 2, y + 13, 1, 13, ST[1]); }
  R(g, x0, y + 26, w, 3, ST[3]); R(g, x0, y + 26, w, 1, ST[4]); R(g, x0, y + 28, w, 1, ST[1]);
}

// ---------- L: ladders ----------
// Two 4 px stiles (lit left, shadowed right) rising 30 px over the top cell as grab rails, round rungs every SCALE.rung px with a
// rivet head where each meets a stile (worn bright in the middle where boots land, some rusty), foot plates, rust creeping up
// from them, flat-bar brackets bolted into the wall where brick stands next to it.
function paintLadder(g, b){
  const x = b.x, top = b.y, bot = b.y + b.h, ext = 30;
  for (let yy = top + 39; yy < bot - 12; yy += 96) if (tile(b.c0 + 1, yy / TS | 0) === 'B'){
    R(g, x + 39, yy, 9, 3, ST[3]); R(g, x + 39, yy, 9, 1, ST[5]); R(g, x + 39, yy + 2, 9, 1, ST[1]);
    R(g, x + 46, yy - 3, 2, 9, ST[2]); R(g, x + 46, yy - 3, 1, 1, ST[6]); R(g, x + 46, yy + 5, 1, 1, ST[6]); }
  for (const sx of [x + 9, x + 35]){
    const H = bot - top + ext;
    R(g, sx, top - ext, 4, H, ST[4]); R(g, sx, top - ext, 1, H, ST[6]); R(g, sx + 1, top - ext, 1, H, ST[5]); R(g, sx + 3, top - ext, 1, H, ST[2]);
    R(g, sx + 1, top - ext - 1, 2, 1, ST[5]);                                                     // its rounded cap
    for (let i = 0; i < 4; i++){ const rh = 4 + (hash(sx + i, bot) * 14 | 0); R(g, sx + i, bot - 3 - rh, 1, rh, i === 3 ? RU[0] : i === 0 ? RU[2] : RU[1]); }
    R(g, sx - 2, bot - 3, 8, 3, ST[3]); R(g, sx - 2, bot - 3, 8, 1, ST[5]); R(g, sx - 2, bot - 1, 8, 1, ST[1]);
  }
  for (let yy = top, n = 0; yy < bot - 6; yy += SCALE.rung, n++){
    const h = hash(x + n, 77);
    R(g, x + 13, yy, 22, 1, ST[5]); R(g, x + 13, yy + 1, 22, 1, ST[3]); R(g, x + 13, yy + 2, 22, 1, ST[1]);   // a round bar: lit top, its underside
    if (n === 0 || h < 0.55) R(g, x + 17, yy, 14, 1, h < 0.2 ? ST[7] : ST[6]);                                // worn bright where boots land
    else if (h > 0.85) R(g, x + 15 + (h * 97 % 13 | 0), yy + 1, 4, 1, RU[2]);
    for (const rx of [x + 10, x + 36]){ R(g, rx, yy, 2, 2, ST[6]); R(g, rx + 1, yy + 1, 1, 1, ST[3]); }
  }
}

// ---------- T: conveyor belts ----------
// A run is drawn between its two drums (tail on the left, head on the right, radius DR; the belt, BT px thick, wraps them, so the
// top run lies on the row's top and the return run under the drums): the belt (its dusty lit top the brightest line), carrying
// idlers (r 4: 15 cm rolls) every 48 px on brackets over a side channel (stringer) with bolts, return idlers every 96 px hanging
// under it, legs down to any steel post under the run. drawAnim moves the cleats, the coal and the return-run splices and turns
// the drums and idlers; the cleats (every ~36 px) and splices (~72 px) divide the loop evenly, so none bunch up where it closes.
const DR = 16, BT = 4;
const belts = [];
for (let r = 0; r < M.MH; r++) for (let c = 0; c < M.MW; c++) if (M.grid[r][c] === 'T' && tile(c - 1, r) !== 'T'){ let e = c; while (tile(e + 1, r) === 'T') e++; belts.push({ r, c0: c, c1: e }); }
tiles.belts = belts;
const beltGeo = belts.map(b => {
  const y = b.r * TS, x0 = b.c0 * TS, x1 = (b.c1 + 1) * TS, ca = x0 + 22, cb = x1 - 24, L = cb - ca, cy = y + DR + BT, idlers = [];
  for (let i = ca + 30; i < cb - 18; i += 48) idlers.push({ x: i, y: y + BT + 5, r: 4 });
  for (let i = ca + 54; i < cb - 24; i += 96) idlers.push({ x: i, y: cy + DR + BT + 3, r: 3 });
  const coal = Array.from({ length: Math.floor(L / 20) }, (_, i) => ({ p: hash(i, b.r * 31 + b.c0) * L | 0, w: 3 + (hash(i, 7) * 6 | 0), h: 2 + (hash(i, 9) * 2.6 | 0), glint: hash(i, 11) > 0.7 }));
  return { b, y, x0, x1, ca, cb, cy, L, idlers, coal, cleat: L / Math.round(L / 36), splice: L / Math.round(L / 72) };
});
function idler(g, x, y, r){
  disc(g, x, y, r, ST[2]); g.fillStyle = ST[4]; circle(g, x, y, r);
  g.fillStyle = ST[6]; for (let a = 3.6; a < 5.0; a += 0.12) R(g, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);   // its lit upper left
  if (r > 3){ R(g, x - 1, y - 1, 2, 2, ST[3]); R(g, x - 1, y - 1, 1, 1, ST[5]); } R(g, x, y, 1, 1, ST[0]);
}
function paintBelt(g, k){
  const { b, y, ca, cb, cy } = k, ry = cy + DR;                                                  // ry: the return run's top
  for (let c = b.c0; c <= b.c1; c++) if (tile(c, b.r + 1) === 'S'){ const lx = c * TS + 12;     // legs down to a post's cap, a brace
    for (const X of [lx, lx + 20]){ R(g, X, y + 27, 4, 21, ST[3]); R(g, X, y + 27, 1, 21, ST[5]); R(g, X + 3, y + 27, 1, 21, ST[1]); }
    R(g, lx, y + 31, 24, 3, ST[3]); R(g, lx, y + 31, 24, 1, ST[4]); R(g, lx, y + 33, 24, 1, ST[1]); }
  for (const id of k.idlers) if (id.r === 3) R(g, id.x, y + 27, 1, id.y - y - 27, ST[2]);       // the return idlers' hangers
  R(g, ca, y + 15, cb - ca, 12, ST[3]); R(g, ca, y + 15, cb - ca, 1, ST[5]); R(g, ca, y + 16, cb - ca, 1, ST[4]); R(g, ca, y + 25, cb - ca, 1, ST[2]); R(g, ca, y + 26, cb - ca, 1, ST[1]);   // stringer
  for (let i = ca + 18; i < cb - 6; i += 24){ R(g, i, y + 19, 2, 2, ST[5]); R(g, i, y + 19, 1, 1, ST[6]); R(g, i + 1, y + 20, 1, 1, ST[1]); }
  for (const id of k.idlers) if (id.r > 3){ R(g, id.x - 1, id.y + id.r, 3, y + 15 - id.y - id.r, ST[2]); R(g, id.x - 1, id.y + id.r, 1, y + 15 - id.y - id.r, ST[4]); idler(g, id.x, id.y, id.r); }
  for (const dx of [ca, cb]){                                                                     // drums
    disc(g, dx, cy, DR, ST[2]); g.fillStyle = ST[3]; circle(g, dx, cy, DR); circle(g, dx, cy, DR - 4);
    g.fillStyle = ST[5]; for (let a = 3.5; a < 5.2; a += 0.05) R(g, Math.round(dx + Math.cos(a) * DR), Math.round(cy + Math.sin(a) * DR), 1, 1);
    R(g, dx - 3, cy - 3, 7, 7, ST[4]); R(g, dx - 3, cy - 3, 7, 1, ST[6]); R(g, dx - 3, cy - 3, 1, 7, ST[6]); R(g, dx + 3, cy - 2, 1, 6, ST[2]); R(g, dx - 2, cy + 3, 6, 1, ST[2]); }
  R(g, ca, y, cb - ca, 1, DU[4]); R(g, ca, y + 1, cb - ca, 1, CO[4]); R(g, ca, y + 2, cb - ca, 1, CO[3]); R(g, ca, y + 3, cb - ca, 1, CO[1]);   // top run: its dusty lit top
  R(g, ca, ry, cb - ca, 1, CO[3]); R(g, ca, ry + 1, cb - ca, 2, CO[2]); R(g, ca, ry + 3, cb - ca, 1, CO[0]);                                 // return run
  for (const id of k.idlers) if (id.r === 3) idler(g, id.x, id.y, id.r);
  for (const [dx, side] of [[ca, -1], [cb, 1]]) for (let j = -DR - BT; j <= DR + BT; j++) for (let i = 0; i <= DR + BT; i++){   // the wraps
    const d = Math.hypot(i, j); if (d < DR + 0.5 || d >= DR + BT + 0.5) continue;
    const X = dx + side * i, outer = d >= DR + BT - 0.5;
    R(g, X, cy + j, 1, 1, j < -DR + 1 ? (outer ? DU[4] : CO[3]) : outer ? (j < 0 ? (side < 0 ? CO[5] : CO[4]) : CO[1]) : j < 0 ? CO[3] : CO[2]); }
}
// rect batches drawAnim fills every frame, one fillStyle each (flat x, y, w, h runs, reused: nothing is allocated per frame)
const BAT = { cleat: [], rubber: [], coal: [], coalLit: [], dark: [], glint: [], splice: [], hub: [], axle: [], mark: [] };
const BATCOL = { cleat: DU[3], rubber: CO[3], coal: CO[2], coalLit: CO[4], dark: CO[0], glint: ST[6], splice: CO[5], hub: ST[5], axle: ST[0], mark: ST[6] };
function batch(ctx, col, a){ if (!a.length) return; ctx.fillStyle = col; for (let i = 0; i < a.length; i += 4) ctx.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); }
tiles.drawAnim = function(ctx, v){
  const s = Math.floor(v.t * LVL.engine.P.BELT * LVL.engine.DT), on = X => X > -24 && X < VW + 24;   // px moved at the engine's belt push
  const { cleat, rubber, coal, coalLit, dark, glint, splice, hub, axle, mark } = BAT;
  for (const k of beltGeo){
    if (k.x1 - v.cx < -12 || k.x0 - v.cx > VW + 12 || k.y + TS - v.cy < 0 || k.y - v.cy > VH) continue;
    const { ca, L } = k, y = k.y - v.cy, cy = k.cy - v.cy, at = u => ca + (u % L + L) % L - v.cx;
    for (const a in BAT) BAT[a].length = 0;
    for (let n = 0; n * k.cleat < L - 0.5; n++){ const X = at(Math.round(n * k.cleat) + s); if (on(X)){ cleat.push(X, y - 2, 3, 1); rubber.push(X, y - 1, 2, 1); dark.push(X + 2, y - 1, 1, 1); } }   // cleats riding right
    for (const l of k.coal){ const u = (l.p + s) % L; if (u < 6 || u > L - 10) continue; const X = ca + u - v.cx; if (!on(X)) continue;   // coal on its way to the head
      coal.push(X, y - l.h + 1, l.w, l.h - 1); coalLit.push(X + 1, y - l.h, l.w - 2, 1); dark.push(X + l.w - 1, y - l.h + 1, 1, l.h - 1); if (l.glint) glint.push(X + 1, y - l.h, 1, 1); }
    for (let n = 0; n * k.splice < L - 0.5; n++){ const X = at(Math.round(n * k.splice) - s); if (on(X)) splice.push(X, cy + DR, 4, 1); }   // splices riding back left
    for (const a of ['cleat', 'rubber', 'coal', 'coalLit', 'dark', 'glint', 'splice']) batch(ctx, BATCOL[a], BAT[a]);
    ctx.fillStyle = ST[4];                                                                                                              // drums turn clockwise
    for (const dx of [ca, k.cb]){ const X = dx - v.cx; if (!on(X)) continue;
      for (let n = 0; n < 3; n++){ const a = s / DR + n * 2 * Math.PI / 3; line(ctx, X + Math.cos(a) * 4, cy + Math.sin(a) * 4, X + Math.cos(a) * (DR - 5), cy + Math.sin(a) * (DR - 5)); }
      hub.push(X - 2, cy - 2, 5, 5); axle.push(X, cy, 1, 1); }
    for (const id of k.idlers){ const X = id.x - v.cx, a = s / id.r; if (on(X)) mark.push(Math.round(X + Math.cos(a) * (id.r - 2)), Math.round(id.y - v.cy + Math.sin(a) * (id.r - 2)), 1, 1); }
    batch(ctx, BATCOL.hub, hub); batch(ctx, BATCOL.axle, axle); batch(ctx, BATCOL.mark, mark);
  }
};

// ---------- B: familoki ----------
// Each block of brick cells is one house, painted as a whole: running bond in 12 x 4 bricks (posterised clusters of two tones,
// lighter and darker strays, a proud brick's lit arris, a burnt header end, soot under the cornice and run down from it in
// streaks, chipped corners, salt bloom on the low courses over the stone plinth, a patch of fresher replacement brick in cement,
// bullet scars), a lit left arris and a shadowed right one, a zinc-flashed corbelled cornice with a dentil frieze (its lit top =
// the roof line he walks on), a rowlock string course at every storey line. Storeys are 144 px from the street up; a band left
// over at the top is an attic with frieze windows sitting on the string course under stone lintels. Window axes every 96 px:
// windows with segmental brick arches and stone sills, lit or dark; the street storey has one door on the axis right of the
// middle. A window or door whose box meets a graffiti anchor or the banner (map ENT, painted by props.js on blank brick: KEEP,
// boxes sized after props.js's anchor sprite + tag and banner cloth: re-measure them if those grow) is left out. Soot licks up
// the wall over the one burnt-out flat (soot()), the first house's street flat right of its door. A downpipe runs down the right
// end.
const STOREY = SCALE.storey, [WW, WH] = SCALE.window, [DW, DH] = SCALE.door, AXIS = 96, SILL = 45, AW = 24, AH = 18, CORN = 18, PLINTH = 18;
const KEEP = [...E.kotwica.map(k => ({ x: k.c * TS, y: k.r * TS, w: 45 * k.s, h: 60 * k.s })), { x: E.banner.c * TS, y: E.banner.r * TS, w: 84, h: 168 }];
const isB = (c, r) => tile(c, r) === 'B';
function allB(x, y, w, h){ for (let c = Math.floor(x / TS); c <= Math.floor((x + w - 1) / TS); c++) for (let r = Math.floor(y / TS); r <= Math.floor((y + h - 1) / TS); r++) if (!isB(c, r)) return false; return true; }
const free = (x, y, w, h) => allB(x, y, w, h) && !KEEP.some(k => x < k.x + k.w && x + w > k.x && y < k.y + k.h && y + h > k.y);
// dk(v): the draft's coordinate (style.js K) of a native one: which windows are lit and how they are dressed is hashed from it,
// so the colony keeps the lit / dark pattern of the owner's draft
const dk = v => Math.round(v / S.K);
const houses = blocks('B').sort((a, b) => a.x - b.x).map((b, i) => {
  const H = Object.assign(b, { street: b.y + b.h, storeys: Math.floor(b.h / STOREY), doors: [], windows: [], attics: [], no: String(3 + 2 * i) });
  H.attic = b.h - H.storeys * STOREY;
  const axes = []; for (let a = b.x + AXIS / 2; a + WW / 2 <= b.x + b.w; a += AXIS) axes.push(a);
  const door = axes.find(a => a > b.x + b.w / 2 && free(a - DW / 2 - 3, H.street - DH - 12, DW + 6, DH + 12));
  for (let k = 0; k < H.storeys; k++){ const wy = H.street - k * STOREY - SILL - WH;
    for (const a of axes){
      if (k === 0 && a === door){ H.doors.push({ x: a - DW / 2, y: H.street - DH, w: DW, h: DH }); continue; }
      if (free(a - WW / 2 - 3, wy - 12, WW + 6, WH + 17)) H.windows.push({ x: a - WW / 2, y: wy, w: WW, h: WH, lit: hash(dk(a), dk(wy)) > 0.45, v: hash(dk(a) + 5, dk(wy) + 9), k }); } }
  if (H.attic >= 36) for (const a of axes) if (free(a - AW / 2 - 2, b.y + CORN, AW + 4, AH + 3)) H.attics.push({ x: a - AW / 2, y: b.y + CORN + 3, lit: hash(dk(a), 77) > 0.7 });
  const lit = H.windows.filter(w => w.lit).length;                                                // never all lit or all dark
  if (H.windows.length > 1 && (lit === 0 || lit === H.windows.length)) H.windows[H.windows.length >> 1].lit = !lit;
  return H;
});
{ const H = houses[0], d = H && H.doors[0], w = d && H.windows.find(w => w.k === 0 && w.x > d.x); if (w){ w.boarded = true; w.lit = false; } }   // the burnt-out flat
tiles.houses = houses;

function brickField(g, H){
  const { x, y, w, street } = H, top = y + CORN, bot = street - PLINTH, ops = H.windows.concat(H.doors);
  R(g, x, top, w, bot - top, BR[2]);                                                              // mortar
  // a patch of fresher replacement brick in cement on a blank pier (the first free spot of a hashed search)
  let patch = null;
  for (let n = 0; n < 40 && !patch; n++){ const px = x + 12 + (hash(H.c0, n) * (w - 78) | 0), py = top + 24 + (hash(H.r0, n + 7) * (bot - top - 66) | 0);
    if (free(px - 6, py - 6, 66, 42) && !ops.some(o => px < o.x + o.w + 12 && px + 54 > o.x - 12 && py < o.y + o.h + 12 && py + 30 > o.y - 18)) patch = { x: px, y: py, w: 54, h: 30 }; }
  if (patch) R(g, patch.x - 6, patch.y, patch.w + 12, patch.h, SN[1]);
  for (let k = 0, cy = bot - 5; cy > top - 5; k++, cy -= 5){                                     // courses from the plinth up: a bed joint over 4 rows of brick
    const off = (k & 1) * 6, up = cy - top, dn = bot - cy, y0 = Math.max(cy + 1, top);           // up: px under the cornice, dn: over the plinth
    if (dn <= 25) for (let i = x; i < x + w; i++) if (noise(i / 25, cy / 13, 23) > 0.5 + dn / 60) R(g, i, cy, 1, 1, SN[2]);   // salt bloom in the low joints
    for (let bx = x - off; bx < x + w; bx += 13){
      const x0 = Math.max(bx, x), x1 = Math.min(bx + 12, x + w); if (x1 <= x0) continue;
      const hb = hash(bx * 3 + 1, cy * 7 + 2), hf = hash(bx + 7, cy + 5), n = noise(bx / 60, cy / 27, 13);
      let t = n > 0.57 ? 5 : 4; if (hb > 0.92) t = t === 5 ? 6 : 5; else if (hb < 0.07) t = 3;
      const run = 30 + 69 * Math.max(0, noise(bx / 35, 0.5, 17) - 0.55) / 0.45, soot = Math.max(0, 1 - up / run);   // soot, streaks
      if (hash(bx + 3, cy + 11) < soot * 0.95) t -= soot > 0.6 ? 2 : 1;
      const inPatch = patch && bx + 6 >= patch.x - (hash(k, 5) * 9 | 0) && bx + 6 < patch.x + patch.w + (hash(k, 6) * 9 | 0) && cy >= patch.y && cy < patch.y + patch.h;
      if (inPatch) t = hb > 0.55 ? 6 : hb > 0.15 ? 5 : 7;
      R(g, x0, y0, x1 - x0, cy + 5 - y0, BR[t]);
      if (hf < 0.16 && t < 7 && y0 === cy + 1) R(g, x0, y0, Math.min(8, x1 - x0), 1, BR[t + 1]);      // a proud brick's lit arris
      else if (hf > 0.92 && x1 - x0 > 6) R(g, x1 - 4, y0, 4, cy + 5 - y0, BR[Math.max(1, t - 1)]); // a burnt header end
      if (dn < 20 && noise(bx / 25, cy / 13, 23) > 0.62 + dn / 50) R(g, x0, cy + 4, x1 - x0, 1, SN[2]);           // salt crust on its foot
      if (hb > 0.4 && hb < 0.43 && x1 - x0 > 6 && y0 === cy + 1){ R(g, x1 - 3, cy + 1, 3, 1, BR[2]); R(g, x1 - 2, cy + 2, 2, 1, BR[2]); R(g, x1 - 3, cy + 2, 1, 1, BR[Math.min(7, t + 1)]); }   // chipped
    }
  }
  pockmarks(g, H);
}
// bullet scars, a burst of them on a blank stretch: a dark hole, its lower right inside lit, spalled brick round it
function pockmarks(g, H){
  const ops = H.windows.concat(H.doors);
  for (let n = 0; n < 30; n++){ const cx = H.x + 30 + (hash(H.c1, n) * (H.w - 60) | 0), cy = H.y + 36 + (hash(H.c1 + 1, n) * (H.h - 90) | 0);
    if (!free(cx - 21, cy - 15, 42, 30) || ops.some(o => cx > o.x - 27 && cx < o.x + o.w + 27 && cy > o.y - 24 && cy < o.y + o.h + 15)) continue;
    for (let m = 0; m < 7; m++){ const hx = cx + ((hash(n, m) - 0.5) * 36 | 0), hy = cy + ((hash(m, n + 3) - 0.5) * 21 | 0);
      R(g, hx - 2, hy - 1, 6, 4, BR[3]); R(g, hx - 1, hy - 2, 4, 1, BR[3]);
      R(g, hx, hy, 2, 2, BR[0]); R(g, hx + 1, hy + 1, 1, 1, BR[1]); R(g, hx + 2, hy + 1, 1, 1, BR[6]); R(g, hx + 1, hy + 2, 1, 1, BR[6]); }
    return; }
}
function stringCourse(g, H, yy){                     // a projecting rowlock band: lit top, headers on edge, its underside, a soft cast shadow
  R(g, H.x, yy - 9, H.w, 1, BR[6]); R(g, H.x, yy - 8, H.w, 5, BR[5]);
  for (let i = H.x + 1; i < H.x + H.w; i += 6){ R(g, i, yy - 8, 1, 5, BR[3]); const h = hash(i, yy); if (h < 0.2 || h > 0.85) R(g, i + 1, yy - 8, 5, 5, BR[h < 0.2 ? 4 : 6]); }
  R(g, H.x, yy - 3, H.w, 1, BR[3]); R(g, H.x, yy - 2, H.w, 1, BR[1]); R(g, H.x + 1, yy - 1, H.w - 1, 1, BR[2]);
}
function cornice(g, H){
  const { x, y, w } = H, lo = isB(H.c0 - 1, H.r0) ? 0 : 3, ro = isB(H.c1 + 1, H.r0) ? 0 : 3, X = x - lo, W = w + lo + ro;
  R(g, X, y, W, 1, ST[6]); R(g, X, y + 1, W, 1, ST[5]); R(g, X, y + 2, W, 2, ST[4]); R(g, X, y + 4, W, 1, ST[2]); R(g, X, y + 5, W, 1, ST[1]);   // zinc flashing: the roof line, its face, the drip
  for (let i = X + 10; i < X + W - 2; i += 36){ R(g, i, y + 1, 1, 4, ST[3]); R(g, i + 1, y + 1, 1, 4, ST[5]); }                                 // its laps
  R(g, X, y + 6, W, 1, BR[6]); R(g, X, y + 7, W, 3, BR[5]); R(g, X, y + 10, W, 1, BR[1]);         // corbel course
  for (let i = X + 4; i < X + W; i += 13) R(g, i, y + 7, 1, 3, BR[3]);
  R(g, X, y + 6, 1, 4, BR[7]); R(g, X + W - 1, y + 6, 1, 4, BR[2]);
  R(g, x, y + 11, w, 6, BR[1]);                                                                   // dentil frieze
  for (let i = x + 2; i < x + w - 5; i += 9){ R(g, i, y + 11, 5, 5, BR[5]); R(g, i, y + 11, 5, 1, BR[6]); R(g, i, y + 12, 1, 4, BR[6]); R(g, i + 4, y + 12, 1, 4, BR[3]); R(g, i + 1, y + 15, 3, 1, BR[3]); }
  R(g, x, y + 17, w, 1, BR[2]);
}
function plinth(g, H){
  const { x, w, street } = H, y0 = street - PLINTH;
  R(g, x, y0, w, PLINTH, SN[2]); R(g, x, y0, w, 1, SN[4]); R(g, x, y0 + 1, w, 1, SN[3]);            // its weathered top, lit
  R(g, x, y0 + 9, w, 1, SN[1]); R(g, x, y0 + 10, w, 1, SN[3]);                                    // the bed joint, the lower course's lit arris
  for (let i = x + 16; i < x + w; i += 36){ R(g, i, y0 + 2, 1, 7, SN[1]); R(g, i + 1, y0 + 2, 1, 7, SN[3]); R(g, i + 18, y0 + 11, 1, 7, SN[1]); R(g, i + 19, y0 + 11, 1, 7, SN[3]); }   // ashlar joints
  for (let i = x; i < x + w; i++){ const h = hash(i, y0); if (h < 0.08) R(g, i, y0 + 2 + (h * 100 | 0) % 15, 1, 1, h < 0.04 ? SN[3] : SN[1]); }   // tooling
  for (let i = x; i < x + w; i++) if (noise(i / 11, 0.5, 29) > 0.55) R(g, i, street - 3, 1, 2, SN[1]);   // splashed dirt
  R(g, x, y0, 1, PLINTH, SN[4]); R(g, x + w - 1, y0, 1, PLINTH, SN[1]); R(g, x, street - 1, w, 1, SN[1]);
}
// segmental arch of bricks on end over an opening `span` px wide centred on cx whose head is at y, rising `rise` px at the crown:
// 6 px voussoirs (lit extrados, shadowed intrados), joints every 4 px, a mortar line over them, a proud keystone at the crown, the
// segment under them part of the dark recess
function arch(g, cx, y, span, rise){
  const x0 = Math.round(cx - span / 2);
  for (let i = 0; i < span; i++){
    const u = (i + 0.5) / span * 2 - 1, d = Math.round(rise * (1 - u * u)), X = x0 + i, yi = y - d, hv = hash((i >> 2) + x0, y) > 0.5;
    R(g, X, yi - 7, 1, 1, BR[2]);
    R(g, X, yi - 6, 1, 6, i % 4 === 3 ? BR[2] : BR[hv ? 6 : 5]);
    if (i % 4 !== 3){ R(g, X, yi - 6, 1, 1, BR[hv ? 7 : 6]); R(g, X, yi - 1, 1, 1, BR[3]); }
    if (d > 0 && i > 2 && i < span - 3) R(g, X, yi, 1, d, BR[1]);
  }
  const kx = Math.round(cx) - 3, ky = y - rise - 8;                                              // the keystone
  R(g, kx, ky, 6, 9, BR[6]); R(g, kx, ky, 6, 1, BR[7]); R(g, kx, ky, 1, 9, BR[7]); R(g, kx + 5, ky + 1, 1, 8, BR[3]); R(g, kx + 1, ky + 9, 5, 1, BR[1]);
}
function sill(g, x, y, w){                           // stone sill: lit top, its front, the drip, the shadow it casts, dirt washed off an end
  R(g, x - 3, y, w + 6, 1, SN[4]); R(g, x - 3, y + 1, w + 6, 2, SN[3]); R(g, x - 3, y + 3, w + 6, 1, SN[1]);
  R(g, x - 3, y, 1, 3, SN[5]); R(g, x + w + 2, y + 1, 1, 3, SN[2]);
  R(g, x - 2, y + 4, w + 6, 1, BR[1]); R(g, x - 1, y + 5, w + 5, 1, BR[2]);
  const h = hash(x, y), ex = h < 0.5 ? x - 2 : x + w + 1, L = 6 + (hash(y, x) * 18 | 0);
  if (h < 0.3 || h > 0.6){ R(g, ex, y + 4, 1, L, BR[3]); R(g, ex, y + 4 + L, 1, 3, BR[2]); }
}
// Window WW x WH: a 3 px frame, a 4 px mullion and transom, a glazing bar across each casement: two fanlights over four casement
// panes. PANES [x, y, w, h] in window-local px (n: 0, 1 fanlights; 2..5 casements); paneAt(i, j) = n or -1.
const PANES = [[3, 3, 16, 15], [23, 3, 16, 15], [3, 22, 16, 18], [23, 22, 16, 18], [3, 43, 16, 18], [23, 43, 16, 18]];
const paneAt = (i, j) => { const c = i >= 3 && i < 19 ? 0 : i >= 23 && i < 39 ? 1 : -1, r = j >= 3 && j < 18 ? 0 : j >= 22 && j < 40 ? 1 : j >= 43 && j < 61 ? 2 : -1; return c < 0 || r < 0 ? -1 : r * 2 + c; };
const FLORA = ['..F.....FF...', '.FFF...FFFF..', '..FF..F.FF...', '..L.LLL..L...', '.LLLLLLLLLL..', 'LLLL.LLLLLLL.', '.LLLLLLLLLLLL', '..LLLLLLLLLL.',   // a geranium
  '...LLLLLLLL..', '....LLLLL....', '...PPPPPPP...', '...PPPPPPP...', '....PPPPP....', '....PPPPP....'];                           // in its pot
function litPx(w, i, j, n, pi, pj, pw, ph){
  const lx = w.v * 13 % 1 < 0.5 ? 30 : 11, dl = Math.abs(i - lx) + Math.abs(j - 11), corner = j > 50 && (i < 11 || i > 30);   // the lamp; the lower outer corners
  let col = pi === pw - 1 || pj === ph - 1 ? LA[1] : dl < 4 ? LA[4] : dl < 12 ? LA[3] : corner ? LA[1] : LA[2];   // glow falling off from the lamp, dimmer at the bars
  const u = Math.abs(i - lx);                                                                     // the lamp hanging in the fanlight: its cord, the
  if (j < 7 ? u === 0 && j > 2 : j < 10 && u <= j - 6) col = LA[0]; else if (j === 10 && u <= 1) col = LA[4];   // shade dark against its glow, the bulb
  if (n >= 4 && w.v < 0.66){                                                                      // café curtain of lace (a zazdrostka) on its rod:
    const q = j - 43;                                                                             // a net of open holes, a scalloped hem
    if (q === 1) col = LA[0];
    else if (q > 1 && q < 13) col = (q % 4 === 2 && i % 4 === 1) || (q % 4 === 0 && i % 4 === 3) ? LA[4] : LA[3];
    else if (q === 13) col = i % 4 === 0 ? col : LA[3];
    else if (q === 14 && (i % 4 === 1 || i % 4 === 2)) col = LA[3];
  }
  if (j >= 22 && (w.v < 0.33 || w.v >= 0.66)){                                                    // drapes under a pelmet, tied back
    const wd = j < 25 ? 18 : j < 40 ? 7 : j < 47 ? 7 - ((j - 40) >> 1) : j < 50 ? 3 : 5;
    if (j < 25 ? j < 24 || i % 5 < 3 : i < 3 + wd || i > 38 - wd) col = j === 47 || j === 48 ? BN[3] : i % 3 === 0 ? BN[2] : BN[1]; }
  if (w.v >= 0.33 && w.v < 0.66 && n === 5){                                                      // a geranium in its pot, against the light
    const f = (FLORA[j - 47] || '')[i - 24];
    if (f === 'F') col = (i + j) % 3 ? BN[3] : BN[4]; else if (f === 'L') col = (i + j) % 4 ? PT[1] : PT[2];
    else if (f === 'P') col = j === 57 ? RU[2] : i <= 28 ? RU[1] : RU[0]; }
  return col;
}
function darkPx(w, i, j, n, pi, pj, pw, ph){
  let col = n < 2 ? GL[2] : GL[1];
  if (n >= 2 && w.v > 0.3 && w.v < 0.6) col = i % 4 === 0 ? BN[0] : i % 4 === 3 ? WD[0] : WD[1];   // a drawn curtain behind the glass, in folds
  const r = pi + ph - 1 - pj; if (pj < ph * 0.6 && r >= 14 && r < 17) col = n < 2 ? GL[4] : GL[3];   // the sky's sheen, high on the glass
  if (pi === 0 || pj === 0) col = GL[0];                                                          // the frame's shadow on the glass
  if (w.v >= 0.6 && w.v < 0.8 && n === 4 && CRACK.has(i * 128 + j)) col = GL[5];                 // a cracked pane
  return col;
}
const CRACK = new Set();
{ const ix = 10, iy = 52; CRACK.add(ix * 128 + iy);
  for (const [dx, dy, len] of [[1, -1, 7], [-1, -1, 6], [1, 1, 8], [-1, 0.5, 6], [0.3, 1, 7]]) for (let s = 1; s <= len; s++) CRACK.add(Math.round(ix + dx * s + (s & 1) * 0.4) * 128 + Math.round(iy + dy * s)); }
function windowAt(g, w){
  const { x, y } = w;
  arch(g, x + WW / 2, y, WW + 6, 5);
  R(g, x, y, WW, WH, BR[1]);
  if (w.boarded){ boarded(g, w); sill(g, x, y + WH, WW); return; }
  R(g, x + 1, y, WW - 2, WH, PT[3]);
  pixels(g, x + 3, y + 3, 36, 58, (i, j) => { const I = i + 3, J = j + 3, n = paneAt(I, J); if (n < 0) return null;
    const [pi0, pj0, pw, ph] = PANES[n]; return (w.lit ? litPx : darkPx)(w, I, J, n, I - pi0, J - pj0, pw, ph); });
  R(g, x + 1, y, WW - 2, 1, PT[1]); R(g, x + 1, y + 1, 1, WH - 1, PT[1]); R(g, x + 2, y + 1, WW - 4, 1, PT[2]); R(g, x + 2, y + 2, 1, WH - 3, PT[4]);   // frame: soffit / jamb shadow, lit stile
  R(g, x + 19, y + 3, 1, 58, PT[4]); R(g, x + 20, y + 3, 2, 58, PT[3]); R(g, x + 22, y + 3, 1, 58, PT[2]);                                 // mullion
  R(g, x + 3, y + 18, 36, 1, PT[4]); R(g, x + 3, y + 19, 36, 2, PT[3]); R(g, x + 3, y + 21, 36, 1, PT[2]);                                 // transom
  for (const bx of [x + 3, x + 23]){ R(g, bx, y + 40, 16, 1, PT[4]); R(g, bx, y + 41, 16, 1, PT[3]); R(g, bx, y + 42, 16, 1, PT[2]); }   // glazing bars
  R(g, x + 2, y + 61, WW - 4, 1, PT[4]); R(g, x + 2, y + 62, WW - 4, 2, PT[3]); R(g, x + 2, y + 64, WW - 4, 1, PT[2]); R(g, x + 1, y + 65, WW - 2, 1, PT[1]);   // bottom rail
  R(g, x + WW - 3, y + 1, 1, WH - 2, PT[3]); R(g, x + WW - 2, y + 1, 1, WH - 1, PT[2]);
  R(g, x + 20, y + 47, 1, 4, ST[5]); R(g, x + 21, y + 48, 1, 2, ST[3]);                           // the casement's handle
  R(g, x + WW - 1, y, 1, WH, w.lit ? LA[0] : BR[5]);                                              // right reveal, lit (by the room if lit)
  sill(g, x, y + WH, WW);
}
function boarded(g, w){                              // planks nailed over a burnt-out flat (soot() blackens the wall over it), broken glass behind
  const { x, y } = w;
  R(g, x + 1, y, WW - 2, WH, GL[0]);
  for (let k = 0; k < 9; k++){ const sx = x + 3 + (hash(k, x) * 33 | 0), sy = y + 3 + (hash(x, k) * 57 | 0); g.fillStyle = GL[3]; S.tri(g, sx, sy, sx + 4, sy, sx, sy + 6); }
  for (const [j, dy] of [[4, 0], [20, 1], [38, -1], [54, 1]]){
    for (let i = -4; i < WW + 4; i++){ const yy = y + j + (i > WW / 2 ? dy : 0); R(g, x + i, yy, 1, 1, WD[3]); R(g, x + i, yy + 1, 1, 5, WD[2]); R(g, x + i, yy + 6, 1, 1, WD[0]); }
    for (const nx of [x - 2, x + WW + 1]){ R(g, nx, y + j + 3, 1, 1, ST[6]); R(g, nx, y + j + 4, 1, 2, RU[1]); }
    R(g, x + 9 + (hash(j, x) * 21 | 0), y + j + 3, 8, 1, WD[1]); R(g, x + 2 + (hash(x, j) * 30 | 0), y + j + 2, 5, 1, WD[1]); }
}
// a frieze window in the attic band, AW x AH, sitting on the string course (its sill): a stone lintel, a recess, a frame with a
// mullion and a bottom rail, two panes (lit: brighter toward the top inside corner; dark: the sky's reflection, the frame's shadow
// on the glass)
function atticWindow(g, a){
  const { x, y } = a;
  R(g, x - 2, y - 3, AW + 4, 1, SN[4]); R(g, x - 2, y - 2, AW + 4, 1, SN[3]); R(g, x - 2, y - 1, AW + 4, 1, SN[1]); R(g, x - 2, y - 3, 1, 2, SN[5]); R(g, x + AW + 1, y - 3, 1, 3, SN[1]);   // lintel
  R(g, x, y, AW, AH, BR[1]); R(g, x + 1, y, AW - 2, AH, PT[3]);
  pixels(g, x + 3, y + 2, AW - 6, AH - 5, (i, j) => { if (i === 8 || i === 9) return null; const pi = i < 8 ? i : i - 10;
    return a.lit ? (pi === 7 || j === AH - 6 ? LA[0] : pi + j < 6 ? LA[3] : pi + j < 11 ? LA[2] : LA[1]) : (pi === 0 || j === 0 ? GL[0] : (i + j) % 9 < 2 ? GL[3] : GL[1]); });
  R(g, x + 1, y, AW - 2, 1, PT[1]); R(g, x + 1, y, 1, AH, PT[1]); R(g, x + 2, y + 1, 1, AH - 3, PT[4]);
  R(g, x + 11, y + 2, 1, AH - 5, PT[4]); R(g, x + 12, y + 2, 1, AH - 5, PT[2]);                    // mullion
  R(g, x + 2, y + AH - 3, AW - 4, 1, PT[4]); R(g, x + 2, y + AH - 2, AW - 4, 1, PT[3]); R(g, x + 1, y + AH - 1, AW - 2, 1, PT[1]);   // bottom rail
  R(g, x + AW - 2, y + 1, 1, AH - 1, PT[2]); R(g, x + AW - 1, y, 1, AH, a.lit ? LA[0] : BR[5]);   // right reveal
}
function panel(g, px, py, pw, ph){                   // a fielded door panel: the recess (shadow top / left, light bottom / right), the raised field
  R(g, px, py, pw, ph, PT[2]); R(g, px, py, pw, 1, PT[1]); R(g, px, py, 1, ph, PT[1]); R(g, px, py + ph - 1, pw, 1, PT[4]); R(g, px + pw - 1, py, 1, ph, PT[4]);
  R(g, px + 3, py + 3, pw - 6, ph - 6, PT[3]); R(g, px + 3, py + 3, pw - 6, 1, PT[4]); R(g, px + 3, py + 3, 1, ph - 6, PT[4]);
  R(g, px + 3, py + ph - 4, pw - 6, 1, PT[2]); R(g, px + pw - 4, py + 4, 1, ph - 7, PT[2]);
}
// Street door, DW x DH: segmental arch, recess, frame, a fanlight with a sunburst of bars over a transom, two panelled leaves (a
// glazed upper panel behind an iron grille, a fielded lower panel, a kick plate; a lever handle on the right leaf, a letter slot
// on the left), scuffs where boots and hands wear the paint, a stone step worn hollow, the house number on an enamel plate.
function doorAt(g, d, H){
  const { x, y } = d, lit = hash(dk(x), 3) > 0.4;
  arch(g, x + DW / 2, y, DW + 6, 6);
  R(g, x, y, DW, DH, BR[1]); R(g, x + 1, y, DW - 2, DH - 6, PT[3]);
  R(g, x + 1, y, DW - 2, 1, PT[1]); R(g, x + 1, y, 1, DH - 6, PT[1]); R(g, x + 2, y + 1, 1, DH - 7, PT[4]); R(g, x + DW - 4, y + 1, 1, DH - 7, PT[2]); R(g, x + DW - 2, y, 1, DH - 6, PT[1]);
  pixels(g, x + 5, y + 3, 51, 19, (i0, j0) => { const i = i0 + 5, j = j0 + 3, dx = i - 30, dy = 22 - j, r = Math.hypot(dx, dy);   // fanlight
    let col = lit ? (r < 9 ? LA[3] : r < 16 ? LA[2] : LA[1]) : (i + j) % 13 < 2 ? GL[3] : GL[1];
    for (let m = 1; m < 8; m++){ const a = m * Math.PI / 8; if (Math.abs(dx * Math.sin(a) - dy * Math.cos(a)) < 0.6 && r > 5) col = PT[2]; }
    if (r <= 5) col = r > 4 ? PT[4] : PT[3];                                                      // the sunburst's hub
    return j === 3 || i === 5 ? (lit ? LA[0] : GL[0]) : col; });
  R(g, x + 5, y + 22, 51, 5, PT[3]); R(g, x + 5, y + 22, 51, 1, PT[4]); R(g, x + 5, y + 26, 51, 1, PT[1]);   // transom
  for (const [lx, active] of [[x + 5, false], [x + 31, true]]){
    const ly = y + 27, lw = 25, lh = 87;
    R(g, lx, ly, lw, lh, PT[3]); R(g, lx, ly, lw, 1, PT[4]); R(g, lx, ly, 1, lh, PT[4]); R(g, lx + lw - 1, ly, 1, lh, PT[1]); R(g, lx + lw - 2, ly + 1, 1, lh - 1, PT[2]);
    R(g, lx + 4, ly + 4, lw - 8, 31, PT[1]);                                                      // glazed upper panel + grille
    pixels(g, lx + 5, ly + 5, lw - 10, 29, (i, j) => i % 4 === 2 || j === 14 || ((j === 13 || j === 15) && i % 4 !== 0) ? PT[0]
      : lit ? (j > 20 ? LA[0] : j < 7 ? LA[2] : LA[1]) : (i + j) % 11 < 2 ? GL[3] : GL[1]);
    R(g, lx + 4, ly + 35, lw - 8, 1, PT[4]);
    panel(g, lx + 4, ly + 42, lw - 8, 30);
    R(g, lx + 2, ly + 75, lw - 4, 9, ST[3]); R(g, lx + 2, ly + 75, lw - 4, 1, ST[5]); R(g, lx + 2, ly + 83, lw - 4, 1, ST[1]);   // kick plate
    for (const kx of [lx + 3, lx + lw - 4]) for (const ky of [ly + 77, ly + 81]) R(g, kx, ky, 1, 1, ST[6]);
    if (active){ R(g, lx + 3, ly + 36, 3, 7, LA[0]); R(g, lx + 3, ly + 38, 7, 2, LA[1]); R(g, lx + 3, ly + 38, 1, 1, LA[3]); R(g, lx + 4, ly + 41, 1, 2, PT[0]);   // handle, keyhole
      for (let k = 0; k < 8; k++) R(g, lx + 1 + (hash(k, x) * 9 | 0), ly + 31 + (hash(x, k) * 15 | 0), 1, 1, WD[2]); }   // worn paint
    else { R(g, lx + 7, ly + 38, 11, 1, LA[1]); R(g, lx + 7, ly + 39, 11, 1, LA[0]); R(g, lx + 7, ly + 40, 11, 1, PT[0]); }   // letter slot
    for (let k = 0; k < 7; k++) R(g, lx + 1 + (hash(k + 9, lx) * (lw - 3) | 0), ly + 72 + (hash(lx, k + 2) * 4 | 0), 1 + (k & 1), 1, WD[2]);   // scuffs
  }
  R(g, x + 30, y + 27, 1, 87, PT[0]);                                                             // the gap between the leaves
  R(g, x + DW - 1, y, 1, DH - 6, BR[5]);                                                          // right reveal, lit
  const sy = H.street - 6;                                                                        // the stone step
  R(g, x - 6, sy, DW + 12, 6, SN[3]); R(g, x - 6, sy, DW + 12, 1, SN[5]); R(g, x - 6, sy + 1, DW + 12, 1, SN[4]); R(g, x - 6, sy + 5, DW + 12, 1, SN[1]);
  R(g, x + 14, sy, 32, 1, SN[4]); R(g, x - 6, sy, 1, 6, SN[5]); R(g, x + DW + 5, sy + 1, 1, 5, SN[2]);
  const px = x + DW + 9, py = y + 12;                                                             // house number
  R(g, px, py, 15, 13, PT[0]); R(g, px + 1, py + 1, 13, 11, PA[2]); R(g, px + 1, py + 1, 13, 1, PA[3]); R(g, px + 1, py + 1, 1, 11, PA[3]);
  txt(g, H.no, px + 8 - (S.tw(null, H.no) >> 1), py + 3, PT[1]); R(g, px + 1, py + 13, 15, 1, BR[1]); R(g, px + 15, py + 1, 1, 12, BR[1]);
}
function downpipe(g, px, top, bottom){               // zinc rainwater pipe: hopper under the cornice, joints, holderbats, a shoe at the street
  R(g, px + 6, top + 3, 1, bottom - top - 3, BR[1]);
  R(g, px, top, 6, bottom - top, ST[4]); R(g, px, top, 1, bottom - top, ST[5]); R(g, px + 1, top, 1, bottom - top, ST[6]); R(g, px + 4, top, 1, bottom - top, ST[3]); R(g, px + 5, top, 1, bottom - top, ST[2]);
  for (let yy = top + 60; yy < bottom - 30; yy += 72){ R(g, px, yy, 6, 1, ST[2]); R(g, px, yy + 1, 6, 1, ST[5]); }
  for (let yy = top + 33; yy < bottom - 15; yy += 48){ R(g, px - 1, yy, 8, 3, ST[4]); R(g, px - 1, yy, 8, 1, ST[6]); R(g, px - 1, yy + 2, 8, 1, ST[2]); R(g, px + 7, yy, 1, 3, ST[1]);
    R(g, px + 7, yy + 3, 1, 4 + (hash(px, yy) * 12 | 0), RU[1]); }
  R(g, px - 3, top - 2, 12, 6, ST[4]); R(g, px - 3, top - 2, 12, 1, ST[6]); R(g, px - 3, top - 1, 1, 5, ST[5]); R(g, px + 8, top - 1, 1, 5, ST[2]); R(g, px - 2, top + 4, 10, 1, ST[2]);
  R(g, px, bottom - 6, 10, 4, ST[4]); R(g, px, bottom - 6, 10, 1, ST[6]); R(g, px + 9, bottom - 6, 1, 4, ST[2]); R(g, px, bottom - 2, 10, 1, ST[2]);
}
// Soot licking up the wall over the burnt-out (boarded) flat, over everything painted there (brick, its arch, the string course,
// the sill above): each pixel 1..3 ramp steps darker by height, flame tongues at the edge (read back from the house's own canvas,
// whose top-left is world (ox0, oy0), and written in one go)
function soot(g, H, ox0, oy0){
  for (const o of H.windows) if (o.boarded){
    const ox = o.x + WW / 2, X0 = Math.max(H.x, ox - 60), X1 = Math.min(H.x + H.w, ox + 60), Y0 = Math.max(H.y, o.y - 78), Y1 = o.y + 2, w = X1 - X0;
    const img = g.getImageData(X0 - ox0, Y0 - oy0, w, Y1 - Y0), u = new Uint32Array(img.data.buffer);
    for (let py = Y0; py < Y1; py++) for (let px = X0; px < X1; px++){
      const up = o.y - 9 - py, half = 18 + up * 0.25 + (noise(px / 7, up / 10, 41) - 0.5) * 18, i = (py - Y0) * w + px - X0;
      let col = HEX.get(u[i]); if (up >= 69 || Math.abs(px - ox) >= half || !col) continue;
      for (let b = up < 21 ? 3 : up < 45 ? 2 : 1; b > 0; b--) col = DARKER.get(col);
      u[i] = u32(col);
    }
    g.putImageData(img, X0 - ox0, Y0 - oy0);
  }
}
// a house is painted on a canvas of its own (soot() reads it back), then laid on the playfield
function paintHouse(dst, H){
  const X = H.x - 6, Y = H.y - 3, [hc, g] = mk(H.w + 12, H.h + 4, true); g.translate(-X, -Y);
  brickField(g, H);
  const openL = !isB(H.c0 - 1, H.r0), openR = !isB(H.c1 + 1, H.r0), bot = H.street - PLINTH;     // arrises: lit left, shadowed right
  for (let cy = H.y + CORN; cy < bot; cy++){ if (openL && (bot - cy) % 5) R(g, H.x, cy, 1, 1, BR[6]); if (openR) R(g, H.x + H.w - 1, cy, 1, 1, BR[1]); }
  plinth(g, H);
  for (let k = 1; k * STOREY < H.h; k++) stringCourse(g, H, H.street - k * STOREY);
  cornice(g, H);
  H.windows.forEach(w => windowAt(g, w)); H.attics.forEach(a => atticWindow(g, a)); H.doors.forEach(d => doorAt(g, d, H));
  soot(g, H, X, Y);
  downpipe(g, H.x + H.w - 18, H.y + CORN, H.street);
  dst.drawImage(hc, X, Y);
}

// ---------- drawing ----------
tiles.drawBack = g => {
  for (let c = 0; c < M.MW; c++) if (tile(c, M.MH - 1) === '.' && tile(c - 1, M.MH - 1) !== '.'){ let e = c; while (tile(e + 1, M.MH - 1) === '.') e++; pitBack(g, { c0: c, c1: e, kind: seg(c) }); }
};
tiles.draw = g => {
  paintGround(g);
  for (const H of houses) paintHouse(g, H);
  for (const b of blocks('S')) paintSteel(g, b);
  for (let r = 0; r < M.MH; r++) for (let c = 0; c < M.MW; c++) if (M.grid[r][c] === 'C') paintCrate(g, c, r);
  for (const b of blocks('L')) paintLadder(g, b);
  for (const b of blocks('P')) paintCatwalk(g, b);
  for (const k of beltGeo) paintBelt(g, k);
};
})();
