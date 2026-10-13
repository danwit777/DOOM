/* art/props.js - the playfield props of each beat and the moving platforms, painted natively at 52.5 px per metre (style.js
 * RESOLUTION and SCALE: the 96 px hero, 48 px tiles), with the owner's 3D models among them as sprites (art/models.js: the E
 * headframe, the hunts, the drums and the parked car; each painted prop of theirs stays as the fallback when the atlas is
 * missing). Placement comes from LVL.map.ENT; the painted story decor that has no gameplay at all is placed by DECOR below.
 *
 * API (called by engine.js; g = context of the whole static playfield canvas, LW x LH px; ctx = the VW x VH game canvas;
 * v = view { cx, cy: camera top-left (integer), t: frame counter at 60 Hz }; every coordinate is a native world or frame px):
 *   props.build()                    once, after art/models.js has loaded: prepares the mover sprites (cart, bucket, cage) with the
 *                                    1 px dark OUTLINE (style.js), so the things you can stand on read against the scenery, and
 *                                    where the model headframe stands (or the fallback's sheave sprite)
 *   props.drawBack(g)                static props BEHIND the tiles: the winding-engine house and the E shaft headframe - the owner's
 *                                    model (models.drawHeadframe) with the hoist ropes from the engine house and the cage guides
 *                                    on down the shaft, or the procedural lattice with its back strut -, B guard tower, cable-car
 *                                    pylons, sandbag nest, C roof chimneys (the hero walks in front of these: VALUE rule in
 *                                    style.js)
 *   props.drawFront(g)               static props IN FRONT of the tiles: rails, Sperrzone barbed-wire fence, graffiti anchors, the
 *                                    regime banner, the story decor (DECOR) and the story props of the owner's models (map
 *                                    ENT.models: drums, the parked car on its piece of track), German signs (boards SCALE.signUp
 *                                    over the street: he walks under them), sodium lamp posts, D steam nozzles
 *   props.drawDynamic(ctx, v, cage)  per frame, before the movers: the headframe's sheaves (turning with the cage, the rope lying
 *                                    in their grooves) and its warning lamp, the hoist ropes down to the cage, the cable-car rope
 *   props.drawMover(ctx, m, v)       one moving platform m = { kind: 'cart' | 'bucket' | 'cage', x, y, w, h } (x, y = top-left of
 *                                    the surface you stand on), drawn before the hero; a hunt is its model sprite (m.sprite)
 *   props.drawMoverFront(ctx, m, v)  the part of a mover that is in front of a hero standing in it (the cage's bars and frame,
 *                                    the bucket's front wall), drawn after the hero
 *   props.anchors()                  where the lights and vents of the props are, in world px, for art/fx.js (so a repainted lamp
 *                                    or tower moves its glow with it; fx never copies prop geometry):
 *                                      { lamps: [{ x, y }]        centre of each sodium lamp's glass (the glow's centre),
 *                                        searchlights: [{ x, y }] centre of the B guard tower's searchlight lens (the beam's origin),
 *                                        vents: [{ x, y, phase }] top centre of each D steam nozzle (phase from map ENT),
 *                                        chimneys: [{ x, y }] top centre of each C roof chimney's flue (smoke source) }
 *   props.signs()                    the sign boards [{ text, x, y, w, h, street }] (world px; for tests and for anything that
 *                                    must keep clear of them)
 *   props.headframe()                the E headframe drawn, its extent { x, x1: its left and right, top: its highest row (the
 *                                    sheaves' tops) } (world px; the model sprite's, or the fallback's inside map ENT.headframe:
 *                                    the camera frames it in E, the playtest checks it at the cage)
 * Signage is German only (Kattowitz, Grube, Schacht, Gleis, Sperrzone); the only Polish is graffiti (kotwica, PW).
 * Scale (style.js SCALE, the hero 96 px = 1.85 m): sign boards 36 px tall with their bottom edge 126 px over the street, lamp posts
 * 204 px, carts 108 x 60 (wheels on the rails), the guard-tower cab 108 x 120 on 4.5-tile legs, headframe sheaves r 39 with
 * 1 px spokes, the engine house 348 x 252 in 12 x 4 brick courses with a 60 x 120 door, roof chimneys 25 x 54, the Sperrzone
 * fence 108 px (+ its bent top), sandbags 33 x 15, a bicycle 93 px long, ladder rungs every 14 px, the shaft cage 240 px wide
 * with 147 px of headroom under 96 px of bridle, the guard's head 12 px, the searchlight's lens 20 px. One canvas px = one pixel for
 * every painter; light from the upper left (lit top / left edges, shadowed bottom / right edges, style.js LIGHT), colours from the
 * style.js ramps; no dither, no noise: texture is placed (hash() picks among a few hand-made variants, keyed to world px).
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, M = LVL.map, E = M.ENT, SC = S.SCALE;
const { RAMP, OUTLINE, PIX, mk, R, line, disc, poly, txt, tw, hash, outline } = S;
const props = LVL.art.props = {};
const TS = M.TS, NGY = M.GROUND * TS;   // tile size, the usual ground line (feet at y = 11 * TS)
const SPR = {};                          // sprites: movers { c: canvas (outlined), ox, oy: its top-left from the mover's top-left }, sheave

const WD = RAMP.wood, PA = RAMP.paper, IR = RAMP.smog, BR = RAMP.brick, LA = RAMP.lamp, BN = RAMP.banner, ST = RAMP.steel,
  RU = RAMP.rust, CO = RAMP.coal, SK = RAMP.sky, BU = RAMP.burlap, PT = RAMP.whitewash, LN = RAMP.lens;
const groundAt = x => M.standRow(Math.floor(x / TS)) * TS;     // y of the first standable surface under x
// y of the street under x: the first ground tile of the column (in front of a familok its roof is the first STANDABLE row)
const streetAt = x => { const c = Math.floor(x / TS); for (let r = 0; r < M.MH; r++) if (M.tile(c, r) === 'G') return r * TS; return M.MH * TS; };

// ---------- the pixel buffer the static props are painted into ----------
// buf(X, Y, W, H): a W x H box of the world whose top-left is world (X, Y), standing in for a 2D context: fillStyle (a '#rrggbb'
// ramp colour) and fillRect(x, y, w, h) in WORLD px write the box's pixels (clipped to it) into a typed array, drawImage(img, x, y)
// lays an image's opaque pixels 1:1 (the baked font's text, txt(): each image is read back once, IMG keeps its pixels), and
// blit(g, x = X, y = Y) puts the box on g with one drawImage, its top-left at (x, y). So every helper of style.js (R, line, disc,
// poly, txt) and of this file paints into it as onto a canvas, at the cost of a typed-array fill per pixel run instead of a canvas
// call: the props are painted pixel by pixel, and the build stays a few ms per prop.
const U32 = new Map(), IMG = new WeakMap();
function u32(hex){
  let v = U32.get(hex);
  if (v === undefined){ if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('props: not a ramp colour: ' + hex);
    const n = parseInt(hex.slice(1), 16); v = (0xff000000 | (n & 255) << 16 | (n & 0xff00) | n >> 16) >>> 0; U32.set(hex, v); }
  return v;
}
function buf(X, Y, W, H){
  const px = new Uint32Array(W * H); let style = null, col = 0;
  return {
    get fillStyle(){ return style; }, set fillStyle(v){ style = v; col = u32(v); },
    fillRect(x, y, w, h){
      let x0 = Math.round(x) - X, y0 = Math.round(y) - Y, x1 = x0 + Math.round(w), y1 = y0 + Math.round(h);
      if (x1 < x0) [x0, x1] = [x1, x0]; if (y1 < y0) [y0, y1] = [y1, y0];
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      for (let j = y0; j < y1; j++) px.fill(col, j * W + x0, j * W + x1);
    },
    drawImage(img, x, y){
      let d = IMG.get(img); if (!d) IMG.set(img, d = new Uint32Array(img.getContext('2d').getImageData(0, 0, img.width, img.height).data.buffer));
      const ox = Math.round(x) - X, oy = Math.round(y) - Y;
      for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++){ const X1 = ox + i, Y1 = oy + j, v = d[j * img.width + i];
        if (v >>> 24 && X1 >= 0 && Y1 >= 0 && X1 < W && Y1 < H) px[Y1 * W + X1] = v; }
    },
    blit(g, x = X, y = Y){ const [c, cg] = mk(W, H), id = cg.createImageData(W, H); new Uint32Array(id.data.buffer).set(px); cg.putImageData(id, 0, 0); g.drawImage(c, x, y); }
  };
}
// paint(cv, X, Y, W, H, fn): fn(g) paints a buffer g over that box of the world, which is then laid on cv (the painters below take
// the playfield's context as cv and paint only into their own buffer g)
function paint(cv, X, Y, W, H, fn){ const b = buf(Math.round(X), Math.round(Y), Math.ceil(W), Math.ceil(H)); fn(b); b.blit(cv); }

// ---------- pixel helpers ----------
const dot = (g, x, y, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
const seg = (g, x0, y0, x1, y1, col) => { g.fillStyle = col; line(g, x0, y0, x1, y1); };
// Bresenham line whose pixel colour is f(i, x, y) (i = step from the start; a falsy colour skips the pixel): ropes with a strand
// lay, members that change tone along their length.
function lineF(g, x0, y0, x1, y1, f){
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, last = null;
  for (let i = 0; ; i++){ const c = f(i, x0, y0); if (c){ if (c !== last){ g.fillStyle = c; last = c; } g.fillRect(x0, y0, 1, 1); }
    if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy){ err += dy; x0 += sx; } if (e2 <= dx){ err += dx; y0 += sy; } }
}
// How squarely a surface with outward unit normal (nx, ny) faces the key light (style.js LIGHT, upper left): 1 at it, -1 away.
const facing = (nx, ny) => (nx * S.LIGHT.x + ny * S.LIGHT.y) * Math.SQRT1_2;
// Every pixel whose centre lies r0 < d <= r1 from the pixel centre (cx, cy), coloured col(d, nx, ny) ((nx, ny) = unit vector out
// from the centre; a falsy colour skips): a gap-free band (stacked circle outlines leave holes on the diagonals).
function annulus(g, cx, cy, r0, r1, col){
  const n = Math.ceil(r1);
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++){ const d = Math.hypot(dx, dy);
    if (d > r0 && d <= r1){ const c = col(d, d ? dx / d : 0, d ? dy / d : 0); if (c) dot(g, cx + dx, cy + dy, c); } }
}
// A 3-step shade by facing(): lit (> 0.35), mid, shadow (< -0.35).
const shade3 = (f, lit, mid, dark) => f > 0.35 ? lit : f < -0.35 ? dark : mid;
// A 2 px rope from (x0, y0) to (x1, y1): the lit strand on the upper (or, for a steep rope, the left) line every 3rd pixel shows
// the lay; the other line is the rope's shadow side.
function rope(g, x0, y0, x1, y1){
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0), ox = steep ? 1 : 0, oy = steep ? 0 : 1;
  seg(g, x0 + ox, y0 + oy, x1 + ox, y1 + oy, CO[1]);
  lineF(g, x0, y0, x1, y1, i => i % 3 ? CO[2] : CO[4]);
}
// A plank or timber w px thick along (x0, y0) -> (x1, y1), its rows (top to bottom) in cols: e.g. [lit edge, body, shadow edge].
function plank(g, x0, y0, x1, y1, cols){ cols.forEach((c, k) => seg(g, x0, y0 + k, x1, y1 + k, c)); }
// Where a rope from (px, py) touches the circle (cx, cy, r): the tangent point at angle phi + side * acos(r / d) (screen angles,
// y down; phi = direction from the centre to the point). side -1 = the rope arrives over the top from the right and wraps the
// wheel's left side; +1 = it leaves that way (see the headframe).
function tangent(cx, cy, r, px, py, side){
  const dx = px - cx, dy = py - cy, a = Math.atan2(dy, dx) + side * Math.acos(Math.min(1, r / Math.hypot(dx, dy)));
  return { a, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}
// Brush strokes: a shape of strokes (polylines [x0, y0, x1, y1, ...] and elliptic arcs { cx, cy, rx, ry, a0, a1 }, sampled into
// lines), in px; brush(segs, r, w, h) = a w x h mask (1 where the pixel centre (i + .5, j + .5) lies within r of a stroke: a round
// brush of radius r), each segment visiting only the pixels of its own bounding box.
function strokes(list){
  const segs = [];
  for (const s of list){
    if (Array.isArray(s)) for (let i = 0; i + 3 < s.length; i += 2) segs.push(s.slice(i, i + 4));
    else { const n = Math.max(6, Math.ceil(Math.abs(s.a1 - s.a0) * Math.max(s.rx, s.ry) / 2));
      for (let i = 0; i < n; i++){ const a = s.a0 + (s.a1 - s.a0) * i / n, b = s.a0 + (s.a1 - s.a0) * (i + 1) / n;
        segs.push([s.cx + s.rx * Math.cos(a), s.cy + s.ry * Math.sin(a), s.cx + s.rx * Math.cos(b), s.cy + s.ry * Math.sin(b)]); } }
  }
  return segs;
}
function brush(segs, r, w, h){
  const on = new Uint8Array(w * h);
  for (const [ax, ay, bx, by] of segs){ const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r)), j0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){ const px = i + 0.5, py = j + 0.5, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      if (Math.hypot(px - ax - t * dx, py - ay - t * dy) <= r) on[j * w + i] = 1; } }
  return on;
}

// ---------- the sign face ----------
// STENCIL: caps 13 px tall, 1 px strokes, 9 px wide (I 1, 1 5), 3 px apart, a space 6 px (so 12 px between words): a condensed
// stencil face sized for the 960 x 540 frame (a 0.25 m letter at 52.5 px/m). The stencil bridges are the 1 px gaps a cut-out
// letter needs to keep its counters: the arms of E F L and the bowls of B D P R stand off the stem, O Q U 0 and the apex of A are
// split at the top / bottom, T's bar floats over its stem, 4's bar is cut where it crosses the stem. Corners are cut by one pixel
// (the round stencil bridges of a real Schablonenschrift). Ä Ö Ü add two dots 2 px over the caps; anything else is a box.
const CAP = 13, SGAP = 3, SSPACE = 6, STENCIL = {};
const O9 = '#.......#';
('A ..##.##..|.#.....#.|#.......#|#.......#|#.......#|#.......#|#.......#|#########|#.......#|#.......#|#.......#|#.......#|#.......#;' +
 'B #.######.|#.......#|#.......#|#.......#|#.......#|#......#.|#.######.|#.......#|#.......#|#.......#|#.......#|#.......#|#.######.;' +
 'C ..######.|.#......#|#........|#........|#........|#........|#........|#........|#........|#........|#........|.#......#|..######.;' +
 'D #.#####..|#......#.|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#......#.|#.#####..;' +
 'E #.#######|#........|#........|#........|#........|#........|#.#####..|#........|#........|#........|#........|#........|#.#######;' +
 'F #.#######|#........|#........|#........|#........|#........|#.#####..|#........|#........|#........|#........|#........|#........;' +
 'G ..######.|.#......#|#........|#........|#........|#........|#...#####|#.......#|#.......#|#.......#|#.......#|.#......#|..######.;' +
 'H #.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#########|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#;' +
 'I #|#|#|#|#|#|#|#|#|#|#|#|#;' +
 'J ........#|........#|........#|........#|........#|........#|........#|........#|........#|#.......#|#.......#|.#......#|..######.;' +
 'K #.......#|#......#.|#.....#..|#....#...|#...#....|#..#.....|#.##.....|#...#....|#....#...|#.....#..|#......#.|#.......#|#.......#;' +
 'L #........|#........|#........|#........|#........|#........|#........|#........|#........|#........|#........|#........|#.#######;' +
 'M #.......#|##.....##|#.#...#.#|#..#.#..#|#...#...#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#;' +
 'N #.......#|##......#|#.#.....#|#.#.....#|#..#....#|#..#....#|#...#...#|#....#..#|#....#..#|#.....#.#|#.....#.#|#......##|#.......#;' +
 'O ..##.##..|.#.....#.|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|.#.....#.|..##.##..;' +
 'P #.######.|#.......#|#.......#|#.......#|#.......#|#......#.|#.#####..|#........|#........|#........|#........|#........|#........;' +
 'Q ..##.##..|.#.....#.|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#....#..#|#.....#.#|.#.....#.|..####..#;' +
 'R #.######.|#.......#|#.......#|#.......#|#.......#|#......#.|#.#####..|#....#...|#.....#..|#.....#..|#......#.|#......#.|#.......#;' +
 'S .#######.|#.......#|#........|#........|#........|.#.......|..#####..|.......#.|........#|........#|........#|#.......#|.#######.;' +
 'T #########|.........|....#....|....#....|....#....|....#....|....#....|....#....|....#....|....#....|....#....|....#....|....#....;' +
 'U #.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|.#.....#.|..##.##..;' +
 'V #.......#|#.......#|#.......#|#.......#|#.......#|.#.....#.|.#.....#.|..#...#..|..#...#..|...#.#...|...#.#...|....#....|....#....;' +
 'W #.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#...#...#|#...#...#|#..#.#..#|#.#...#.#|##.....##|#.......#;' +
 'X #.......#|#.......#|.#.....#.|.#.....#.|..#...#..|...#.#...|....#....|...#.#...|..#...#..|.#.....#.|.#.....#.|#.......#|#.......#;' +
 'Y #.......#|#.......#|.#.....#.|..#...#..|...#.#...|....#....|....#....|....#....|....#....|....#....|....#....|....#....|....#....;' +
 'Z #########|........#|.......#.|......#..|......#..|.....#...|....#....|...#.....|..#......|..#......|.#.......|#........|#########;' +
 '0 ..##.##..|.#.....#.|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|.#.....#.|..##.##..;' +
 '1 ..#..|.##..|#.#..|..#..|..#..|..#..|..#..|..#..|..#..|..#..|..#..|..#..|#####;' +
 '2 .#######.|#.......#|........#|........#|........#|.......#.|..#####..|.#.......|#........|#........|#........|#........|#########;' +
 '3 .#######.|#.......#|........#|........#|........#|.......#.|...####..|.......#.|........#|........#|........#|#.......#|.#######.;' +
 '4 ......#..|.....##..|....#.#..|...#..#..|..#...#..|.#....#..|#.....#..|#####.###|......#..|......#..|......#..|......#..|......#..;' +
 '5 #########|#........|#........|#........|#........|########.|........#|........#|........#|........#|........#|#.......#|.#######.;' +
 '6 .#######.|#.......#|#........|#........|#........|#.######.|#.......#|#.......#|#.......#|#.......#|#.......#|#.......#|.#######.;' +
 '7 #########|........#|.......#.|.......#.|......#..|......#..|.....#...|.....#...|....#....|....#....|....#....|....#....|....#....;' +
 '8 .#######.|#.......#|#.......#|#.......#|#.......#|.#.....#.|..#####..|.#.....#.|#.......#|#.......#|#.......#|#.......#|.#######.;' +
 '9 .#######.|#.......#|#.......#|#.......#|#.......#|#.......#|.######.#|........#|........#|........#|........#|#.......#|.#######.;' +
 '- .....|.....|.....|.....|.....|.....|#####|.....|.....|.....|.....|.....|.....;. .|.|.|.|.|.|.|.|.|.|.|.|#;: .|.|.|#|.|.|.|.|.|#|.|.|.;' +
 '! #|#|#|#|#|#|#|#|#|.|.|.|#;□ #########|' + Array(11).fill(O9).join('|') + '|#########').split(';').forEach(e => { STENCIL[e[0]] = e.slice(2).split('|'); });
const UML = { 'Ä': 'A', 'Ö': 'O', 'Ü': 'U' };
function sglyph(ch){ const u = ch.toUpperCase(); if (STENCIL[u]) return { rows: STENCIL[u], uml: false };
  return UML[u] ? { rows: STENCIL[UML[u]], uml: true } : { rows: STENCIL['□'], uml: false }; }
function stw(s){ let w = 0; for (const ch of s) w += (ch === ' ' ? SSPACE : sglyph(ch).rows[0].length) + SGAP; return Math.max(0, w - SGAP); }
function stencil(g, s, x, y, col){
  g.fillStyle = col; let ox = Math.round(x); y = Math.round(y);
  for (const ch of s){ if (ch === ' '){ ox += SSPACE + SGAP; continue; }
    const { rows, uml } = sglyph(ch), gw = rows[0].length;
    rows.forEach((r, j) => { for (let i = 0; i < gw;){ if (r[i] !== '#'){ i++; continue; } let k = i; while (k < gw && r[k] === '#') k++; g.fillRect(ox + i, y + j, k - i, 1); i = k; } });
    if (uml){ g.fillRect(ox + 2, y - 2, 1, 1); g.fillRect(ox + gw - 3, y - 2, 1, 1); }
    ox += gw + SGAP; }
}

// ---------- signs, lamps, fence, roof chimneys ----------
// German sign on two square posts. The board is SIGN_H tall with its bottom edge SCALE.signUp over the higher of the two streets
// under it (the street may step under a sign), so the 96 px hero walks under it and never hides a letter; the stencil face sits
// in a painted border, SIGN_PAD px in from each end: the coach bolts into the posts (x + 8..9, x + w - 10..-9) and their rust runs
// stay 8 px clear of the first and last letter, the upper runs end over the cap band, the lower ones start under it. warn: red
// bands and red letters on a whiter board (Sperrzone).
const SIGN_H = 36, SIGN_PAD = 18, SIGN_CAP_Y = (SIGN_H - CAP) >> 1;
function signBox(s){ const w = stw(s.text) + 2 * SIGN_PAD, x = s.c * TS, posts = [x + 6, x + w - 12], base = Math.min(...posts.map(px => groundAt(px + 3)));
  return { x, w, posts, y: base - SC.signUp - SIGN_H, base }; }
function sign(cv, s){
  const b = signBox(s), { x, w, y } = b, h = SIGN_H, base = Math.max(...b.posts.map(px => groundAt(px + 3)));
  paint(cv, x - 4, y - 1, w + 8, base - y + 2, g => {
    // posts: they stand right behind the hero on the street, so their bodies are wood[3] (VALUE rule in style.js): a lit left
    // face, a shadowed right one, the board's shadow under it, a few seasoning checks, earth heaped at the foot
    for (const px of b.posts){ const gy = groundAt(px + 3), top = y + 4;
      R(g, px, top, 6, gy - top, WD[3]); R(g, px, top, 1, gy - top, WD[4]); R(g, px + 4, top, 1, gy - top, WD[2]); R(g, px + 5, top, 1, gy - top, WD[1]);
      R(g, px, y + h, 6, 3, WD[1]); R(g, px + 4, y + h, 2, 3, WD[0]);
      for (let k = 0; k < 4; k++){ const cy = y + h + 12 + (hash(px, k) * (gy - y - h - 30) | 0); R(g, px + 2 + (k & 1), cy, 1, 4 + (hash(k, px) * 6 | 0), WD[2]); }
      R(g, px - 3, gy - 2, 12, 2, CO[4]); R(g, px - 2, gy - 3, 9, 1, CO[5]); dot(g, px - 1, gy - 3, CO[6]); }
    // the board: a 1 px frame, the painted face with a lit rim (upper left) and a shaded rim, a painted border (warn: red bands)
    const face = s.warn ? PA[3] : PA[2], ink = s.warn ? BN[2] : PA[0];
    R(g, x, y, w, h, WD[0]); R(g, x + 1, y + 1, w - 2, h - 2, face);
    R(g, x + 1, y + 1, w - 2, 1, PA[3]); R(g, x + 1, y + 1, 1, h - 2, PA[3]);
    R(g, x + 1, y + h - 2, w - 2, 1, PA[1]); R(g, x + w - 2, y + 1, 1, h - 2, PA[1]);
    if (s.warn){ R(g, x + 4, y + 4, w - 8, 3, BN[3]); R(g, x + 4, y + h - 7, w - 8, 3, BN[3]); R(g, x + 4, y + 6, w - 8, 1, BN[2]); R(g, x + 4, y + h - 5, w - 8, 1, BN[2]); }
    else { g.fillStyle = PA[1]; g.fillRect(x + 4, y + 4, w - 8, 1); g.fillRect(x + 4, y + h - 5, w - 8, 1); g.fillRect(x + 4, y + 4, 1, h - 8); g.fillRect(x + w - 5, y + 4, 1, h - 8); }
    // wear: paint flaked off the lower edge down to the wood in a few places, grime settled along it (short runs, not a rule)
    for (let i = 0; i < 3; i++){ const fx = x + 6 + (hash(x + i, 19) * (w - 16) | 0); R(g, fx, y + h - 2, 3 + (i & 1) * 2, 1, WD[2]); dot(g, fx + 1, y + h - 3, PA[1]); }
    for (let i = 0; i < (w >> 4); i++) R(g, x + 6 + (hash(x + i, 61) * (w - 14) | 0), y + h - 3, 2 + (hash(i, x) * 5 | 0), 1, PA[1]);
    stencil(g, s.text, x + SIGN_PAD, y + SIGN_CAP_Y, ink);
    for (const px of b.posts) for (const by of [y + 5, y + h - 9]){                           // coach bolts into the posts, rust run
      R(g, px + 2, by, 2, 2, ST[5]); dot(g, px + 3, by + 1, ST[1]);                            // down from each: the upper ones end
      R(g, px + 3, by + 2, 1, by < y + SIGN_CAP_Y ? 2 : 4, RU[2]); dot(g, px + 3, by + (by < y + SIGN_CAP_Y ? 3 : 5), RU[1]); }   // over the caps
  });
}
// Sodium street lamp (SCALE.lamp tall): a cast-iron pole on a plinth with its access door, a flared foot, a collar where the 6 px
// lower pole steps to 4 px and one higher up, a swan neck bending into an arm that reaches right, a strut with a ring bracing the
// arm, a hood with a finial over the glass. Light from the upper left: lit left edges, shadowed right edges. The plinth and the
// pole stand right behind the hero on the street, so they are painted in the smog ramp's upper steps (smog[5..6] bodies, a step
// lighter than the upper pole, as the ground fog lights them: VALUE rule in style.js), only the hood high above in its darks. The glass centre is the fx glow's anchor (lampGlass()).
const lampGeo = cl => { const x = cl * TS + 24, gy = groundAt(x); return { x, gy, top: gy - SC.lamp }; };
const lampGlass = cl => { const { x, top } = lampGeo(cl); return { x: x + 33, y: top + 14 }; };
function lamp(cv, cl){
  const { x, gy, top } = lampGeo(cl);
  paint(cv, x - 12, top - 2, 60, SC.lamp + 2, g => {
    R(g, x - 9, gy - 14, 18, 14, IR[6]); R(g, x - 9, gy - 14, 1, 14, IR[7]); R(g, x + 7, gy - 14, 1, 14, IR[5]); R(g, x + 8, gy - 14, 1, 14, IR[4]);   // plinth
    R(g, x - 9, gy - 1, 18, 1, IR[4]);
    R(g, x - 10, gy - 17, 20, 3, IR[6]); R(g, x - 10, gy - 17, 20, 1, IR[7]); R(g, x + 9, gy - 16, 1, 2, IR[4]); R(g, x - 10, gy - 15, 20, 1, IR[4]);   // its cap
    R(g, x - 4, gy - 12, 7, 9, IR[5]); R(g, x - 4, gy - 12, 7, 1, IR[3]); R(g, x - 4, gy - 12, 1, 9, IR[3]); R(g, x + 2, gy - 11, 1, 8, IR[7]);   // access door
    dot(g, x + 1, gy - 8, IR[7]);
    for (let j = 0; j < 12; j++){ const hw = 5 - (j >> 2), y = gy - 18 - j;                                                                      // flared foot
      R(g, x - hw, y, 2 * hw, 1, IR[5]); dot(g, x - hw, y, IR[7]); dot(g, x - hw + 1, y, IR[6]); dot(g, x + hw - 1, y, IR[3]); }
    R(g, x - 3, gy - 92, 6, 62, IR[5]); R(g, x - 3, gy - 92, 1, 62, IR[7]); R(g, x - 2, gy - 92, 1, 62, IR[6]); R(g, x + 2, gy - 92, 1, 62, IR[3]);   // lower pole
    const up = gy - 96 - (top + 9);
    R(g, x - 2, top + 9, 4, up, IR[4]); R(g, x - 2, top + 9, 1, up, IR[6]); R(g, x + 1, top + 9, 1, up, IR[2]);                                    // upper pole
    for (const [cy, hw] of [[gy - 96, 4], [gy - 158, 3]]){ R(g, x - hw, cy, 2 * hw, 4, IR[5]); R(g, x - hw, cy, 2 * hw, 1, IR[7]); R(g, x + hw - 1, cy, 1, 4, IR[3]); R(g, x - hw, cy + 3, 2 * hw, 1, IR[3]); }   // collars
    annulus(g, x + 9, top + 10, 7.5, 10.5, (d, ux, uy) => ux > 0.05 || uy > 0.05 ? null : d > 9.5 ? IR[6] : d > 8.5 ? IR[4] : IR[2]);              // swan neck
    R(g, x + 9, top, 26, 3, IR[4]); R(g, x + 9, top, 26, 1, IR[6]); R(g, x + 9, top + 2, 26, 1, IR[2]);                                           // arm
    plank(g, x + 2, top + 21, x + 18, top + 3, [IR[5], IR[3]]);                                                                                  // bracket strut, its ring
    annulus(g, x + 10, top + 12, 1.5, 3.5, (d, ux, uy) => d > 2.5 ? (facing(ux, uy) > 0 ? IR[6] : IR[3]) : IR[4]); dot(g, x + 10, top + 12, IR[2]);
    R(g, x + 32, top - 2, 3, 3, IR[4]); dot(g, x + 32, top - 2, IR[6]); dot(g, x + 34, top, IR[2]);                                              // finial
    g.fillStyle = IR[2]; poly(g, [x + 21, top + 12, x + 46, top + 12, x + 41, top + 3, x + 26, top + 3]);                                       // hood
    seg(g, x + 21, top + 11, x + 26, top + 3, IR[4]); seg(g, x + 46, top + 11, x + 41, top + 3, IR[1]);
    R(g, x + 26, top + 3, 15, 1, IR[5]); R(g, x + 21, top + 11, 25, 1, IR[1]);
    R(g, x + 27, top + 12, 13, 1, LA[3]); R(g, x + 27, top + 13, 13, 3, LA[2]); R(g, x + 27, top + 16, 13, 1, LA[1]); R(g, x + 27, top + 17, 13, 1, LA[0]);   // glass
    R(g, x + 28, top + 13, 3, 1, LA[4]); R(g, x + 26, top + 12, 1, 6, IR[1]); R(g, x + 40, top + 12, 1, 6, IR[1]); R(g, x + 27, top + 18, 13, 1, IR[2]);
    R(g, x + 32, top + 19, 3, 1, IR[3]); dot(g, x + 33, top + 20, IR[3]);
  });
}
// Sperrzone fence, ENT.wire: concrete posts every 2 columns (none in the trench), SCALE.fence tall with the top bent out toward the
// side you come from, six sagging strands of barbed wire (a twisted pair: a lit twist every 3 px, barbs every 12 px) that span the
// trench, two more along the bent tops. It stands behind the hero; its top stays under the SPERRZONE board.
const FENCE_ARM = 15, STRANDS = [12, 30, 48, 66, 84, 101];
function fence(cv){
  const posts = [], H = SC.fence;
  for (let cl = E.wire.c0; cl <= E.wire.c1; cl += 2) if (M.isSolid(cl, M.GROUND)) posts.push(cl * TS + 21);
  const x0 = posts[0] - FENCE_ARM - 4, x1 = posts[posts.length - 1] + 10;
  paint(cv, x0, NGY - H - FENCE_ARM - 4, x1 - x0, H + FENCE_ARM + 4, g => {
    const strand = (xa, ya, xb, yb, sag) => { for (let x = xa; x <= xb; x++){ const u = (x - xa) / Math.max(1, xb - xa), y = Math.round(ya + (yb - ya) * u + Math.sin(Math.PI * u) * sag);
      dot(g, x, y, x % 3 === 0 ? ST[5] : ST[2]);
      if (x % 12 === 5){ for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) dot(g, x + dx, y + dy, ST[3]); dot(g, x - 2, y - 2, ST[4]); dot(g, x + 2, y + 2, ST[1]); } } };
    for (let i = 0; i + 1 < posts.length; i++){ const a = posts[i] + 3, b = posts[i + 1] + 3, sag = Math.max(1, Math.round((b - a) / 40));
      for (const h of STRANDS) strand(a, NGY - h, b, NGY - h, sag);
      for (const k of [7, FENCE_ARM]) strand(a - k, NGY - H - k, b - k, NGY - H - k, sag); }
    for (const x of posts){
      R(g, x, NGY - H, 6, H, IR[6]); R(g, x, NGY - H, 1, H, IR[7]); R(g, x + 4, NGY - H, 1, H, IR[5]); R(g, x + 5, NGY - H, 1, H, IR[4]);
      for (let k = 0; k < 2; k++){ const cy = NGY - 20 - (hash(x, k) * (H - 40) | 0); R(g, x + 1 + 2 * k, cy, 2, 2, IR[5]); dot(g, x + 1 + 2 * k, cy + 1, IR[3]); }   // chips
      R(g, x - 2, NGY - 6, 10, 6, IR[5]); R(g, x - 2, NGY - 6, 10, 1, IR[7]); R(g, x - 2, NGY - 5, 1, 5, IR[6]); R(g, x + 7, NGY - 5, 1, 5, IR[3]);   // footing
      for (let i = 1; i <= FENCE_ARM; i++){ R(g, x - i, NGY - H - i, 4, 1, IR[6]); dot(g, x - i, NGY - H - i, IR[7]); dot(g, x - i + 3, NGY - H - i, IR[4]); }   // bent top
      for (const h of STRANDS){ R(g, x - 1, NGY - h - 1, 8, 2, ST[3]); dot(g, x - 1, NGY - h - 1, ST[5]); dot(g, x + 6, NGY - h, ST[1]); } }   // strand clamps
  });
}
// Roof chimney of a familok: a stack two bricks wide (style.js SCALE.brick, 1 px mortar, running bond), the lit left brick a step
// lighter than the shaded right one, a corbelled course and a concrete cap slab over a sooty flue (the top two courses blackened
// brick by brick, posterised); it stands on the roof right behind the hero, so its bricks stay at brick[5] and lighter (VALUE
// rule in style.js). fx smokes it from chimTop().
const CH_W = 2 * SC.brick[0] + 1, CH_H = 54;
const chimGeo = cl => { const x = cl * TS + 12, ry = groundAt(cl * TS + 24); return { x, ry, y: ry - CH_H }; };
const chimTop = cl => { const { x, y } = chimGeo(cl); return { x: x + (CH_W >> 1), y: y - 1 }; };
function chimney(cv, cl){
  const { x, ry, y } = chimGeo(cl), [bw, bh] = SC.brick;
  paint(cv, x - 4, y - 1, CH_W + 8, CH_H + 1, g => {
    R(g, x, y + 9, CH_W, ry - y - 9, BR[3]);                                                  // mortar
    for (let r = 0, yy = y + 9; yy < ry; r++, yy += bh + 1){ const off = r & 1 ? -(bw >> 1) - 1 : 0;
      for (let bx = off; bx < CH_W; bx += bw + 1){ const a = Math.max(0, bx), b = Math.min(CH_W, bx + bw), hb = hash(cl * 31 + bx, r), lit = a < CH_W / 2;
        if (b <= a) continue;
        const col = lit ? (hb > 0.88 ? BR[7] : BR[6]) : (hb > 0.75 ? BR[6] : BR[5]), hh = Math.min(bh, ry - yy);
        const soot = r < 2 ? bh : r === 2 && hb > 0.6 ? 1 : 0;                                             // soot running down
        R(g, x + a, yy, b - a, hh, col); if (soot) R(g, x + a, yy, b - a, Math.min(soot, hh), r < 2 && hb > 0.7 ? BR[2] : BR[1]); } }
    R(g, x, y + 9, 1, ry - y - 9, BR[7]); R(g, x + CH_W - 1, y + 9, 1, ry - y - 9, BR[4]); R(g, x, y + 9, 1, 10, BR[3]);   // edges (sooted at the top)
    R(g, x - 1, y + 5, CH_W + 2, 4, BR[3]); R(g, x - 1, y + 5, CH_W + 2, 1, BR[4]); R(g, x - 1, y + 8, CH_W + 2, 1, BR[1]);   // corbelled course
    R(g, x - 3, y, CH_W + 6, 5, IR[5]); R(g, x - 3, y, CH_W + 6, 1, IR[7]); R(g, x - 3, y + 1, 1, 4, IR[6]); R(g, x - 3, y + 4, CH_W + 6, 1, IR[2]);   // cap slab
    R(g, x + CH_W + 2, y + 1, 1, 3, IR[3]); dot(g, x + 4, y + 2, IR[3]); dot(g, x + 17, y + 3, IR[4]);
    R(g, x + 5, y - 1, CH_W - 10, 1, CO[0]);                                                  // flue mouth
  });
}

// ---------- B: guard tower ----------
// Wachturm, ENT.guardTower: two of its four splayed timber legs seen side-on (7 px squared timbers on concrete footings), 4.5 tiles
// from the street to the walkway beam, girts and X-braced panels, a ladder up the middle to the floor hatch (rungs every
// SCALE.rung); a board cab of style.js SCALE.towerCab: weathered vertical boards with a batten, a window band of three panes (the
// middle one lit by a bulb inside: the guard in a Stahlhelm seen in profile, his rifle slung, a cigarette at his lips; the others
// dark, the sunset streaked across them), a fascia of butt-jointed boards under the eaves' brackets, a hip roof of tar-paper
// strips lapped down the slope, nailed under a few battens, with a stove pipe; a steel-pipe railing round the walkway, and the
// searchlight on a bracket off its right end post (searchlight()). The legs, girts and braces stand right behind the hero on the
// street, so their bodies are wood[3] (VALUE rule in style.js), the darker steps only on their shadow edges.
// cx: the tower's axis; floor: the top of the walkway beam; CW x CH: the cab; hw: half the walkway; x0, top: the cab's top-left;
// lens: the searchlight's lens centre
function towerGeo(){
  const [CW, CH] = SC.towerCab, cx = E.guardTower.c * TS + 36, gy = groundAt(cx), floor = gy - 216, hw = CW / 2 + 15;
  return { cx, gy, floor, CW, CH, hw, x0: cx - CW / 2, top: floor - CH, lens: { x: cx + hw + 12, y: floor - 40 } };
}
// sprite(g, rows, x, y, pal): rows of characters, each a key of pal (its colour) or '.' (left clear), top-left at (x, y)
function sprite(g, rows, x, y, pal){
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++){ const c = pal[r[i]]; if (c) dot(g, x + i, y + j, c); } });
}
// The guard: a silhouette against the lit back wall, seen in profile facing left toward the street, from the chest up at the
// hero's scale (head 12 px from chin to crown, 11 px deep): the Stahlhelm's dome (13 px long) with the bulb's light on its crown,
// the short visor lip over the brow and the skirt flaring 2 px out over the nape (1 px of light between them), forehead, nose,
// lips with a cigarette (c: paper, e: its ember), chin, the neck into the collar, shoulders 22 px across sloping down.
const GUARD = [
  '......rrrrr...........', '....rrXXXXXrr.........', '...rXXXXXXXXXr........', '..rXXXXXXXXXXXX.......', '..XXXXXXXXXXXXX.......',
  '.XXXXXXXXXXXXXXX......', '...XXXXXXXXXXXXX......', '...XXXXXXXXXXXXXX.....', '..XXXXXXXXXXX.XXX.....', '...XXXXXXXXXX.........',
  'ecccXXXXXXXXX.........', '...XXXXXXXXXX.........', '....XXXXXXXXX.........', '.......XXXXXX.........', '.......XXXXXXX........',
  '.....XXXXXXXXXX.......', '...rrXXXXXXXXXXXrr....', '.rrXXXXXXXXXXXXXXXXr..', 'rXXXXXXXXXXXXXXXXXXXXr', 'XXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXX'];
const GUARD_PAL = { X: CO[1], r: CO[4], c: PA[3], e: RAMP.signal[1] };
// The searchlight (Suchscheinwerfer) on its fork, its lens centre at L: a barrel aimed down at the street and toward the viewer,
// tilted 20 degrees left of plumb (so the view looks along it from below: the lens face an ellipse, the barrel's top side running
// up behind it), drawn as a projected cylinder. d: the barrel's axis on screen from the lens to the back, n: across it (toward
// the shadow side); a cross-section of radius r is an ellipse r along n, FS r along d, and its near half lies toward the back, so
// a pixel with across-coordinate w (|w| <= r) shows the barrel's side at t = u - h(w) behind the lens (u: its coordinate along d,
// h(w) = FS sqrt(r^2 - w^2)). The side is shaded by w (lit left edge, steel[3..4] body, shadowed right side), with two cooling
// ribs (a lit ring, its shadow behind it) and a rolled rim at the back, behind which the smaller back cap shows; the lens is a
// bezel ring (lit at the upper left outside, at the lower right on its inner lip) round the glass. The fork's arms rise past the
// barrel's sides to the trunnion bosses at its middle; its yoke and post hide under the lens, the post standing on the bracket.
const SL = { d: [0.34, -0.94], RB: 10, RG: 7, FS: 0.7, LEN: 16, CAP: [7.5, 3], RIBS: [5.5, 10.5] };
function searchlight(g, L){
  const [dx, dy] = SL.d, nx = -dy, ny = dx, { RB, RG, FS, LEN } = SL, [RC, CL] = SL.CAP, n = RB + CL + LEN;
  const side = (r, w) => FS * Math.sqrt(Math.max(0, r * r - w * w));
  // every pixel (i, j) from the lens centre (integer): its coordinates u along the barrel, w across it
  const each = f => { for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++){ const c = f(i * dx + j * dy, i * nx + j * ny, i, j); if (c) dot(g, L.x + i, L.y + j, c); } };
  // the fork: post, yoke (under the lens), arms up to the trunnions at the barrel's middle (level with each other: the tilt is
  // the aim's sideways lean, the trunnion axis stays level)
  const ty = Math.round(L.y + dy * LEN / 2), tx = [-1, 1].map(s => Math.round(L.x + dx * LEN / 2 + s * (RB + 2)));
  R(g, L.x - 1, L.y + 4, 3, 12, ST[3]); R(g, L.x - 1, L.y + 4, 1, 12, ST[5]); R(g, L.x + 1, L.y + 4, 1, 12, ST[1]);
  R(g, tx[0] - 1, L.y + 4, tx[1] - tx[0] + 3, 3, ST[3]); R(g, tx[0] - 1, L.y + 4, tx[1] - tx[0] + 3, 1, ST[5]); R(g, tx[0], L.y + 6, tx[1] - tx[0] + 1, 1, ST[1]);
  for (const ax of tx){ R(g, ax - 1, ty, 3, L.y + 5 - ty, ST[3]); R(g, ax - 1, ty, 1, L.y + 5 - ty, ST[5]); R(g, ax + 1, ty + 2, 1, L.y + 3 - ty, ST[1]); }
  // the back cap, then the barrel over it (the side of a cylinder of radius r from t0 to t1 behind the lens, shaded by s = w / r)
  const cyl = (r, t0, t1, f) => each((u, w) => { if (Math.abs(w) > r) return null; const t = u - side(r, w); return t > t0 && t <= t1 ? f(t, w / r) : null; });
  cyl(RC, LEN - 1, LEN + CL, (t, s) => t > LEN + CL - 1 ? (s < 0 ? ST[4] : ST[1]) : s < -0.5 ? ST[4] : s < 0.4 ? ST[3] : ST[1]);
  cyl(RB, 0, LEN, (t, s) => {
    if (Math.abs(s) > 0.93) return s < 0 ? ST[6] : ST[1];                                          // silhouette edges
    if (t > LEN - 1.5) return s < 0.3 ? ST[6] : ST[3];                                            // rolled rim at the back
    for (const rt of SL.RIBS){ if (Math.abs(t - rt) < 0.5) return s < 0.3 ? ST[6] : ST[4];        // a cooling rib,
      if (t - rt >= 0.5 && t - rt < 1.5) return s < -0.6 ? ST[4] : ST[2]; }                       // its shadow behind it
    return s < -0.6 ? ST[5] : s < -0.1 ? ST[4] : s < 0.5 ? ST[3] : ST[2]; });
  // the lens face: bezel ring and glass (elliptic radius e: 1 at the bezel's edge, eg: 1 at the glass's)
  each((u, w, i, j) => { const e = Math.hypot(w / RB, u / (FS * RB)), eg = e * RB / RG; if (e > 1) return null;
    const f = i || j ? facing(i / Math.hypot(i, j), j / Math.hypot(i, j)) : 0;
    if (eg > 1) return e > 0.88 ? shade3(f, ST[6], ST[4], ST[1]) : eg < 1.18 ? shade3(-f, ST[5], ST[3], ST[1]) : shade3(f, ST[5], ST[3], ST[2]);
    return eg > 0.78 ? (f < 0 ? LN[0] : LN[1]) : f > 0.45 && eg > 0.3 && eg < 0.7 ? LN[3] : f < -0.4 && eg > 0.35 ? LN[1] : LN[2]; });
  for (const ax of tx){ R(g, ax - 1, ty - 1, 3, 3, ST[4]); dot(g, ax - 1, ty - 1, ST[6]); dot(g, ax + 1, ty + 1, ST[1]); dot(g, ax, ty, ST[7]); }   // trunnion bosses
}
function guardTower(cv){
  const { cx, gy, floor, CW, hw, x0, top, lens } = towerGeo(), legTop = floor + 9;
  const legX = (side, y) => { const u = (gy - y) / (gy - legTop); return side < 0 ? Math.round(cx - 62 + 18 * u) : Math.round(cx + 55 - 18 * u); };
  paint(cv, cx - hw - 16, top - 48, 2 * hw + 64, gy - top + 49, g => {
    for (const s of [-1, 1]){ const fx = legX(s, gy - 1) - 3;                                   // concrete footings
      R(g, fx, gy - 8, 13, 8, IR[5]); R(g, fx, gy - 8, 13, 1, IR[7]); R(g, fx, gy - 7, 1, 7, IR[6]); R(g, fx + 12, gy - 8, 1, 8, IR[3]); R(g, fx + 1, gy - 1, 11, 1, IR[4]); }
    // X-braced panels between the girts (behind the legs): planks lit along their upper edge, a bolt where they cross
    const lv = [gy - 9, gy - 78, gy - 147, legTop];
    for (let k = 0; k + 1 < lv.length; k++){ const yb = lv[k], ya = lv[k + 1] + 5;
      plank(g, legX(-1, ya) + 6, ya, legX(1, yb) - 1, yb - 4, [WD[4], WD[3], WD[1]]);
      plank(g, legX(1, ya), ya, legX(-1, yb) + 7, yb - 4, [WD[4], WD[3], WD[1]]);
      const my = Math.round((ya + yb) / 2) - 2; R(g, cx - 4, my, 2, 2, ST[5]); dot(g, cx - 3, my + 1, ST[1]); }
    for (let y = legTop; y < gy - 1; y++) for (const s of [-1, 1]){ const x = legX(s, y);          // legs: lit left face, shadow edge
      R(g, x, y, 1, 1, WD[4]); R(g, x + 1, y, 4, 1, WD[3]); R(g, x + 5, y, 1, 1, WD[2]); R(g, x + 6, y, 1, 1, WD[1]); }
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++){ const y = legTop + 20 + (hash(s + 5, k) * (gy - legTop - 50) | 0);   // seasoning checks
      for (let j = 0; j < 5 + k * 2; j++) dot(g, legX(s, y + j) + 2 + (k & 1), y + j, WD[2]); }
    for (const y of [lv[1], lv[2]]){ const a = legX(-1, y) - 5, b = legX(1, y) + 12;            // girts, bolted to the legs
      R(g, a, y, b - a, 7, WD[3]); R(g, a, y, b - a, 1, WD[4]); R(g, a, y + 5, b - a, 1, WD[2]); R(g, a, y + 6, b - a, 1, WD[1]);
      R(g, a, y, 1, 7, WD[4]); R(g, b - 1, y + 1, 1, 6, WD[1]);
      for (const s of [-1, 1]){ const bx = legX(s, y) + 2; R(g, bx - 1, y + 2, 2, 2, ST[5]); dot(g, bx, y + 3, ST[1]); R(g, bx + 2, y + 3, 2, 2, ST[5]); dot(g, bx + 3, y + 4, ST[1]); } }
    // ladder up the middle to the hatch: two rails, a rung every SCALE.rung px (lit top, shadow under)
    const lx = cx + 5, rung = SC.rung;
    for (const rx of [lx, lx + 21]){ R(g, rx, legTop, 2, gy - legTop - 1, WD[3]); R(g, rx, legTop, 1, gy - legTop - 1, WD[4]); R(g, rx + 2, legTop, 1, gy - legTop - 1, WD[1]); }
    for (let y = gy - 12; y > legTop + 3; y -= rung){ R(g, lx + 3, y, 18, 1, WD[4]); R(g, lx + 3, y + 1, 18, 1, WD[2]); R(g, lx + 3, y + 2, 18, 1, WD[0]); }
    // walkway beam (joist ends on its face) and the hatch frame under it
    R(g, cx - hw, floor, 2 * hw, 9, WD[2]); R(g, cx - hw, floor, 2 * hw, 1, WD[4]); R(g, cx - hw, floor + 1, 2 * hw, 1, WD[3]); R(g, cx - hw, floor + 8, 2 * hw, 1, WD[0]);
    for (let x = cx - hw + 4; x < cx + hw - 3; x += 18){ R(g, x, floor + 3, 4, 4, WD[1]); dot(g, x, floor + 3, WD[3]); dot(g, x + 3, floor + 6, WD[0]); }
    R(g, lx - 2, floor + 9, 27, 3, WD[0]);
    // cab: lower wall of vertical boards (9 px: lit left edge, dark joint), two nails top and bottom, a few knots, a batten
    const wb = floor - 63;
    for (let bx = 0; bx < CW; bx += 9){ const hb = hash(bx, 7), body = hb > 0.8 ? WD[1] : WD[2];
      R(g, x0 + bx, wb, 9, 63, body); R(g, x0 + bx, wb, 1, 63, WD[3]); R(g, x0 + bx + 8, wb, 1, 63, WD[0]);
      for (const ny of [wb + 4, floor - 6, wb + 31]) dot(g, x0 + bx + 3, ny, ST[3]);
      if (hb < 0.35){ const ky = wb + 8 + (hash(bx, 11) * 16 | 0); R(g, x0 + bx + 3, ky, 3, 2, WD[1]); dot(g, x0 + bx + 3, ky, WD[3]); }   // knots
      if (hb > 0.55 && hb < 0.7) R(g, x0 + bx + 5, wb + 38, 1, 9, WD[1]); }                                                               // a split
    R(g, x0, wb + 29, CW, 1, WD[4]); R(g, x0, wb + 30, CW, 2, WD[3]); R(g, x0, wb + 32, CW, 1, WD[0]);
    // window band: posts, three panes (dark glass with the sunset streaked across; the middle one lit, the guard in it)
    const wy = top + 18, gyw = wy + 3, gh = wb - 5 - gyw, pw = 30;
    R(g, x0, wy, CW, wb - wy, WD[1]); R(g, x0, wy, CW, 1, WD[3]);
    for (let i = 0; i < 3; i++){ const gx = x0 + 6 + i * (pw + 3);
      if (i === 1){
        R(g, gx, gyw, pw, gh, LA[0]); R(g, gx + 4, gyw + 6, pw - 7, gh - 6, LA[1]); R(g, gx, gyw, pw, 4, BR[3]); R(g, gx, gyw + 4, pw, 1, BR[1]);   // the lit back wall (a bulb out of
        seg(g, gx + 22, gyw + gh - 1, gx + 26, gyw + 5, CO[1]); seg(g, gx + 23, gyw + gh - 1, gx + 27, gyw + 5, CO[2]); R(g, gx + 26, gyw + 3, 2, 3, CO[1]);   // sight above it), the rifle slung
        const gt = gyw + gh - GUARD.length; sprite(g, GUARD, gx + 4, gt, GUARD_PAL);                                                              // behind him, muzzle up; the guard,
        dot(g, gx + 3, gt + 8, PA[2]); dot(g, gx + 3, gt + 7, PA[1]); dot(g, gx + 2, gt + 5, PA[2]); dot(g, gx + 3, gt + 3, PA[1]); dot(g, gx + 2, gt + 1, PA[1]);   // the smoke
      } else {
        R(g, gx, gyw, pw, gh, IR[2]); R(g, gx, gyw + gh - 6, pw, 6, IR[1]);
        seg(g, gx + 2, gyw + gh - 9, gx + 18, gyw + 1, SK[3]); seg(g, gx + 3, gyw + gh - 9, gx + 19, gyw + 1, SK[2]); seg(g, gx + 4, gyw + gh - 9, gx + 20, gyw + 1, SK[2]);
        seg(g, gx + 14, gyw + gh - 3, gx + 27, gyw + 10, SK[2]);
        R(g, gx, gyw + 15, pw, 1, WD[1]); R(g, gx + 15, gyw, 1, gh, WD[1]); }                     // glazing bars (the lit pane is one sheet)
      R(g, gx, gyw, 1, gh, WD[0]); R(g, gx, gyw, pw, 1, WD[0]); }                                 // the reveal's shadow
    R(g, x0 - 3, wb - 4, CW + 6, 1, WD[4]); R(g, x0 - 3, wb - 3, CW + 6, 2, WD[2]); R(g, x0 - 2, wb - 1, CW + 4, 1, WD[0]);   // sill
    // fascia: two lapped boards (the upper one's shadow on the lower), butt joints with a nail pair, under the eaves' shadow;
    // the eaves brackets: tapering knees, lit left, a shadow under their tips
    R(g, x0, top, CW, 18, WD[2]); R(g, x0, top + 9, CW, 1, WD[1]); R(g, x0, top + 10, CW, 1, WD[3]); R(g, x0, top + 17, CW, 1, WD[1]); R(g, x0, top, CW, 4, CO[2]);
    for (const [jx, y0, y1] of [[x0 + 41, top + 4, top + 9], [x0 + 77, top + 10, top + 17], [x0 + 23, top + 10, top + 17]]){
      R(g, jx, y0, 1, y1 - y0, WD[0]); R(g, jx + 1, y0, 1, y1 - y0, WD[3]); dot(g, jx - 2, y0 + 2, ST[3]); dot(g, jx + 3, y1 - 3, ST[3]); }
    for (let bx = x0 + 3; bx < x0 + CW - 4; bx += 18){
      [5, 5, 4, 3, 2, 1].forEach((w, k) => { R(g, bx, top + k, w, 1, WD[3]); dot(g, bx, top + k, WD[4]); if (w > 2) dot(g, bx + w - 1, top + k, WD[2]); if (k > 3) dot(g, bx + w, top + k, WD[1]); });
      R(g, bx + 1, top + 6, 2, 1, WD[1]); }
    // roof: tar paper in strips laid from the eaves up, each lapping the one below (its lit lap edge, the shadow line under it),
    // three battens nailed down the slope, two patches; hip edges (lit left, dark right), the eaves board; the stove pipe through it
    const sp = x0 + CW - 21;
    R(g, sp, top - 42, 6, 33, ST[3]); R(g, sp, top - 42, 1, 33, ST[5]); R(g, sp + 1, top - 42, 1, 33, ST[4]); R(g, sp + 5, top - 42, 1, 33, ST[1]);
    R(g, sp - 3, top - 46, 12, 3, ST[4]); R(g, sp - 3, top - 46, 12, 1, ST[6]); R(g, sp - 3, top - 44, 12, 1, ST[2]); R(g, sp + 1, top - 43, 4, 1, CO[0]);
    R(g, sp - 1, top - 30, 8, 2, ST[3]); R(g, sp - 1, top - 30, 8, 1, ST[5]);
    const rh = 24, rx0 = x0 - 12, rx1 = x0 + CW + 12, hip = 33, inset = j => Math.round((rh - 1 - j) * hip / (rh - 1));
    for (let j = 0; j < rh; j++){ const y = top - rh + j, a = rx0 + inset(j), b = rx1 - inset(j), k = (rh - 1 - j) % 7;
      R(g, a, y, b - a, 1, k === 0 && j < rh - 1 ? IR[4] : k === 6 ? IR[2] : IR[3]); R(g, a, y, 2, 1, IR[6]); dot(g, a + 2, y, IR[5]); R(g, b - 2, y, 2, 1, IR[1]); }
    for (const bx of [x0 + 18, x0 + CW / 2, x0 + CW - 18]) for (let j = 0; j < rh - 1; j++){ const y = top - rh + j;
      if (bx > rx0 + inset(j) + 2 && bx < rx1 - inset(j) - 3){ dot(g, bx, y, IR[4]); dot(g, bx + 1, y, IR[2]); if ((rh - 1 - j) % 7 === 3) dot(g, bx, y, IR[5]); } }
    for (const [px, k] of [[x0 + 14, 1], [x0 + 63, 2]]){ const y = top - 1 - 7 * k - 4; R(g, px, y, 13, 4, IR[2]); R(g, px, y, 13, 1, IR[4]); dot(g, px + 12, y + 1, IR[1]); }   // patches
    R(g, rx0 + hip, top - rh, rx1 - rx0 - 2 * hip, 1, IR[5]);
    R(g, rx0, top - 3, rx1 - rx0, 3, IR[4]); R(g, rx0, top - 3, rx1 - rx0, 1, IR[6]); R(g, rx0, top, rx1 - rx0, 1, CO[0]);
    // railing: steel pipe posts and two rails along the walkway, their shadow on the boards
    const ry = floor - 45;
    for (const px of [cx - hw, cx - 24, cx + 21, cx + hw - 3]){ R(g, px, ry, 3, 45, ST[4]); R(g, px, ry, 1, 45, ST[6]); R(g, px + 2, ry, 1, 45, ST[2]); }
    for (const [y, hi, lo] of [[ry, ST[6], ST[3]], [ry + 21, ST[5], ST[2]]]){
      R(g, cx - hw, y, 2 * hw, 1, hi); R(g, cx - hw, y + 1, 2 * hw, 1, lo); R(g, x0 + 1, y + 2, CW, 1, WD[0]); }
    // searchlight: the bracket arm off the end post (in line with the lower rail), its knee brace, the lamp on its fork post
    const bw = lens.x + 3 - (cx + hw - 1);
    R(g, cx + hw - 1, lens.y + 16, bw, 3, ST[4]); R(g, cx + hw - 1, lens.y + 16, bw, 1, ST[6]); R(g, cx + hw - 1, lens.y + 18, bw, 1, ST[2]);
    seg(g, cx + hw + 2, lens.y + 19, cx + hw + 11, lens.y + 28, ST[4]); seg(g, cx + hw + 2, lens.y + 20, cx + hw + 10, lens.y + 28, ST[2]);
    searchlight(g, lens);
  });
}

// ---------- B: cable-car pylons, sandbags, rails ----------
// Seilbahnstütze, ENT.pylons: a lattice mast (corner chords tapering to the head, 1 px struts every 18 px and zig-zag lacing)
// under a crossarm on knee braces carrying the saddle sheave (r 9, four spokes) the rope rests on; the rope ends at this end
// tower: past the sheave it bends down into a rope socket pinned to a lug on the crossarm's outer end (nothing hangs down over the
// station the hero crosses).
function pylon(cv, px){
  const cy = E.cable.y, sr = 9, sy = cy + sr + 1, top = sy + 12, base = NGY, out = px < (E.cable.x0 + E.cable.x1) / 2 ? -1 : 1;
  const hw = y => Math.round(6 + 13 * (y - top) / (base - top));
  paint(cv, px - 40, cy - 4, 81, base - cy + 4, g => {
    for (let y = top + 18, k = 0; y < base; y += 18, k++){ const w0 = hw(y - 18), w1 = hw(y);
      seg(g, px + (k & 1 ? w0 : -w0), y - 18, px + (k & 1 ? -w1 : w1), y, ST[3]);
      R(g, px - w1, y, 2 * w1 + 1, 1, ST[4]); R(g, px - w1 + 1, y + 1, 2 * w1 - 1, 1, ST[2]); }
    for (let y = top; y < base; y++){ const w = hw(y); dot(g, px - w - 1, y, ST[6]); dot(g, px - w, y, ST[4]); dot(g, px + w, y, ST[4]); dot(g, px + w + 1, y, ST[2]); }
    R(g, px - 2, sy, 5, top - sy, ST[3]); R(g, px - 2, sy, 1, top - sy, ST[5]); R(g, px + 2, sy, 1, top - sy, ST[1]);   // the sheave's hanger plate
    R(g, px - 22, top, 45, 4, ST[4]); R(g, px - 22, top, 45, 1, ST[6]); R(g, px - 22, top + 3, 45, 1, ST[2]);           // crossarm
    for (const s of [-1, 1]) seg(g, px + s * 20, top + 4, px + s * (hw(top + 22) + 1), top + 22, ST[3]);                 // knee braces
    for (let x = px - 19; x < px + 21; x += 8) dot(g, x, top + 2, ST[6]);                                               // rivets
    annulus(g, px, sy, sr - 0.5, sr + 0.5, () => ST[2]);                                                                 // groove edge
    annulus(g, px, sy, sr - 2.5, sr - 0.5, (d, ux, uy) => shade3(facing(ux, uy), ST[6], ST[5], ST[3]));                   // rim
    annulus(g, px, sy, 2.5, sr - 2.5, (d, ux, uy) => { const a = Math.atan2(uy, ux) - Math.PI / 4;                        // four spokes (the
      return Math.abs(((a / (Math.PI / 2)) % 1 + 1) % 1 - 0.5) > 0.5 - 0.9 / d ? (facing(ux, uy) > 0 ? ST[5] : ST[3]) : null; });   // sky between them)
    annulus(g, px, sy, -1, 2.5, d => d <= 1 ? ST[2] : ST[5]); dot(g, px - 1, sy - 1, ST[7]);                            // hub, axle
    // the rope over the sheave's outer half, down into its socket (lit left side), the clevis pin through the lug
    for (let x = px; x !== px + out * (sr + 1); x += out){ dot(g, x, cy, x % 3 ? CO[2] : CO[4]); dot(g, x, cy + 1, CO[1]); }
    const ax = px + out * 18;
    rope(g, px + out * (sr + 1) + (out > 0 ? 0 : -1), cy + 2, ax, top - 10);
    R(g, ax - 2, top - 10, 5, 6, ST[4]); dot(g, ax - 2, top - 10, ST[6]); R(g, ax + 2, top - 9, 1, 5, ST[2]); R(g, ax - 2, top - 5, 5, 1, ST[1]);
    R(g, ax - 3, top - 4, 7, 4, ST[3]); R(g, ax - 3, top - 4, 7, 1, ST[5]); dot(g, ax, top - 3, ST[7]); dot(g, ax + 1, top - 2, ST[1]);
  });
}
// One sandbag, w x h, its top-left at (x, y): a pillow of sunlit burlap (a step lighter than the coal sacks), rounded at its free
// end and pinched toward the tied one, lit top rows and left end, a shadowed underside and right end, a side seam stitched along
// its lower third, the folds the cord gathers into the cloth, the cord, and a tuft of cloth fanning out past it (at the right end
// when tieRight, else at the left); a sag crease where the course above presses on it.
function sandbag(g, x, y, w, h, tieRight, k){
  const tuft = 4, bw = w - tuft, bx = tieRight ? x : x + tuft, neck = tieRight ? bx + bw : bx - 1;   // the body, the cord's column
  let a0 = 0, b0 = 0;
  for (let j = 0; j < h; j++){ const v = (2 * j + 1) / h - 1, round = Math.round(3.5 * (1 - Math.sqrt(1 - v * v))), pinch = Math.round(5 * Math.abs(v) ** 1.6);
    const a = bx + (tieRight ? round : pinch), b = bx + bw - (tieRight ? pinch : round);
    R(g, a, y + j, b - a, 1, v < -0.62 ? BU[5] : v < 0.05 ? BU[4] : v < 0.62 ? BU[3] : BU[2]);
    if (Math.abs(v) < 0.75){ dot(g, a, y + j, BU[5]); dot(g, b - 1, y + j, BU[2]); if (v > -0.62) dot(g, b - 2, y + j, BU[3]); }
    if (j === h >> 1){ a0 = a; b0 = b; } }
  for (let i = a0 + 5; i < b0 - 5; i += 3) dot(g, i, y + h - 5, BU[2]);                               // the stitched seam
  const d = tieRight ? -1 : 1, nx = tieRight ? b0 - 1 : a0;                                          // folds gathered into the neck
  seg(g, nx + d * 7, y + 3, nx + d, y + (h >> 1) - 1, BU[3]); seg(g, nx + d * 6, y + h - 3, nx + d, y + (h >> 1) + 1, BU[2]);
  R(g, neck, y + (h >> 1) - 2, 1, 5, BU[1]);                                                         // the cord
  for (let i = 1; i <= tuft; i++){ const hh = 1 + i, tx = neck - d * i, ty = y + (h >> 1) - hh;          // the tuft past it
    R(g, tx, ty, 1, hh, BU[4]); R(g, tx, ty + hh, 1, hh, BU[3]); dot(g, tx, ty, BU[5]); if (hash(k, i) > 0.5) dot(g, tx, ty + 2 * hh - 1, BU[2]); }
  const cx = a0 + 9 + (hash(k, 3) * (b0 - a0 - 20) | 0);                                              // sag crease
  dot(g, cx, y + 2, BU[3]); dot(g, cx + 1, y + 3, BU[3]); dot(g, cx + 1, y + 4, BU[2]); dot(g, cx + 2, y + 5, BU[3]);
}
// Sandbag nest at the colony checkpoint, ENT.sandbags: three courses in a running bond (4, 3, 2 bags) stepping in toward the top,
// packed so tight they overlap two pixels each way, each course backed by a dark fill from its top row down (the top course from
// its second row: its top row is the nest's outline), so the crevices between the pillows are shadow, never a slit to the
// background; each bag's tied end alternates. It sits under the sign that
// spans its column, its right end 3 px short of that sign's right post (the post stands beside the nest, not through it).
const BAG_W = 33, BAG_H = 15;
function sandbags(cv){
  const step = BAG_W - 2, NW = 3 * step + BAG_W, rows = [[0, 4], [16, 3], [32, 2]], c = E.sandbags.c * TS;
  const over = E.signs.map(signBox).find(b => b.x <= c && c < b.x + b.w), x0 = over ? over.posts[1] - 3 - NW : c - 6, gy = groundAt(x0 + NW / 2);
  const yOf = r => gy - (BAG_H - 2) * (r + 1) - 2;
  paint(cv, x0 - 2, yOf(2) - 1, NW + 4, gy - yOf(2) + 1, g => {
    rows.forEach(([off, n], r) => { const t = r === rows.length - 1 ? 1 : 0; R(g, x0 + off + 3, yOf(r) + t, n * step - 4, BAG_H - t, BU[1]); });   // the crevices
    rows.forEach(([off, n], r) => { for (let i = 0; i < n; i++) sandbag(g, x0 + off + i * step, yOf(r), BAG_W, BAG_H, ((i + r) & 1) === 0, r * 7 + i); });
    R(g, x0 - 1, gy - 1, NW + 2, 1, BU[0]);                                                          // contact shadow
  });
}
// Rails on the open ground of B (ENT.rails; not under the loading stations), or of columns c0..c1 (the short track a parked car of
// ENT.models stands on): the polished running surface (a few dull spots), the rusty head, web and foot; sleeper ends every 30 px
// in front of the foot with their spikes, a few ballast stones between them; a fishplate joint with four bolts every 384 px. The
// carts' wheels stand on the rail head, 4 px over the street (their flanges dip in front of it).
function rails(cv, c0 = E.rails.c0, c1 = E.rails.c1){
  const gy = NGY, cols = [];
  for (let cl = c0; cl <= c1; cl++) if (M.tile(cl, M.GROUND) === 'G' && !M.isSolid(cl, M.GROUND - 1)) cols.push(cl);
  paint(cv, c0 * TS - 8, gy - 8, (c1 - c0 + 1) * TS + 16, 8, g => {
    for (const cl of cols){ const xa = cl * TS;
      R(g, xa, gy - 7, TS, 1, ST[7]); R(g, xa, gy - 6, TS, 1, RU[3]); R(g, xa, gy - 5, TS, 1, RU[1]); R(g, xa, gy - 4, TS, 2, RU[2]); R(g, xa, gy - 2, TS, 1, RU[3]); R(g, xa, gy - 1, TS, 1, RU[1]);
      for (let x = xa; x < xa + TS; x++){
        if (hash(x >> 2, 3) > 0.9) dot(g, x, gy - 7, ST[5]);                                     // dull spots on the running surface
        const s = ((x % 30) + 30) % 30;
        if (s < 15){ dot(g, x, gy - 4, s === 0 ? WD[4] : WD[3]); dot(g, x, gy - 3, s === 14 ? WD[1] : WD[2]); dot(g, x, gy - 2, s === 14 ? WD[1] : WD[2]); dot(g, x, gy - 1, WD[1]); }   // sleeper end
        if (s === 3 || s === 11){ dot(g, x, gy - 4, ST[5]); dot(g, x, gy - 3, ST[2]); }                  // spikes
        if (s > 17 && s < 28 && hash(x, 5) > 0.6){ dot(g, x, gy - 1, CO[5]); if (hash(x, 6) > 0.5) dot(g, x, gy - 2, CO[6]); }   // ballast
      } }
    for (const cl of cols) for (let x = cl * TS; x < cl * TS + TS; x++) if (x % 384 === 192){                      // fishplates
      R(g, x - 7, gy - 5, 15, 3, ST[3]); R(g, x - 7, gy - 5, 15, 1, ST[5]); for (const bx of [-5, -2, 2, 5]) dot(g, x + bx, gy - 4, ST[6]); dot(g, x, gy - 7, ST[2]); }
  });
}

// ---------- E: shaft headframe ----------
// Fördergerüst over the shaft. The playfield headframe is the owner's 3D model as a sprite (art/models.js 'headframe', anchored on
// the shaft's centre line, its sheaves turning per frame: drawDynamic), with what the model leaves to the level: the hoist ropes
// from the engine house up onto its sheaves (hoist), the cage guides on down the shaft under the street, the ropes down to the
// cage and its warning lamp (drawDynamic). Each hoist rope comes up from the engine house to the top right of its sheave, wraps
// over the top and leaves the sheave's left side down to the cage hanger (both wheels turn the same way with the rope).
// Without the atlas (models.err) the procedural fallback stands in the same box, ENT.headframe (x, w = its left and width, h = its
// height over the street to the sheaves' tops): two lattice legs (1 px chords 15 px apart with zig-zag lacing) taper to the deck,
// strut levels with gusset plates and X-bracing between them (panels of ~72 px: round(legs / 72) - 1 levels, evenly spaced), the
// cage guides (Spurlatten) from the deck down the shaft, the deck girder with its railing and the sheaves' bearing pedestals; the
// raking back strut toward the engine house (backStrut, painted behind the house: it rakes down behind its roof), tied to the
// right leg at its two upper strut levels. The two sheaves (style.js SCALE.sheaveR) stand on the deck, their lowest rows in the
// deck slot, their tops at the box's top. It is painted in the model's materials: the steelwork red lead gone to rust, a step
// over the model's own body and lit steps (rust[2] / rust[3]: its 1 px members have no mass to read by) - members rust[3], their
// lit edges rust[4], shadowed sides rust[1], the legs' and the strut's lacing rust[2], the X-bracing a rust[3] bar over a rust[1]
// shadow row (it reads on the dark town and on the bright sunset alike), the deck girder rust[2] with its lit rows rust[3..4],
// rivets rust[5] -, the cage guides, the bearing blocks and the sheaves steel-teal. The right leg's outer chord takes a warm rim
// from the low sun near the top, fading out down the leg (sky[5] -> sky[4] -> sky[3] -> rust[1]).
const MD = LVL.art.models, SHAFT_X = (E.shaft.c0 + E.shaft.c1 + 1) / 2 * TS;   // the model sprites; the shaft's centre line
let HFM = null;                          // the model headframe where it stands (models.headframeGeo, + the ropes' arrivals): build()
// the rope holes in the engine house's corner pilaster, one per sheave; w.arr: where the rope from its hole arrives on the wheel
const ropeIn = (w, i) => { const eh = ehGeo(); w.hole = { x: eh.x0 + 3, y: eh.top + 18 + i * 12 }; w.arr = tangent(w.x, w.y, w.r - 1, w.hole.x, w.hole.y, -1); return w; };
let HFG = null;
function hfGeo(){                        // the procedural fallback
  if (HFG) return HFG;
  const hf = E.headframe, gy = NGY, r = SC.sheaveR, ty = gy - hf.h + 2 * r + 1, legs = gy - ty, inset = Math.round(hf.w * 0.28);
  const tl = hf.x + inset, tr = hf.x + hf.w - inset, deck = ty - 6;                            // the sheaves' tops at gy - h
  const wheels = [tl + 6, tr - 6].map((x, i) => ropeIn({ x, y: deck - r + 6, r }, i));
  const n = Math.max(2, Math.round(legs / 72));                                                 // panels; levels between them
  return HFG = { x: hf.x, w: hf.w, gy, ty, tl, tr, deck, r, wheels, strutX: hf.x + hf.w + Math.round(legs * 0.55),
    levels: Array.from({ length: n - 1 }, (_, k) => gy - Math.round(legs * (k + 1) / n)),
    top: Math.min(deck - 21, ...wheels.map(w => w.y - r - 1)) };                               // the highest painted row
}
// The model headframe's own parts of the static playfield: the hoist ropes from the engine house to where they arrive on its
// sheaves (static: the wheel turns under them), the rope holes; the cage guides on down the shaft from the street, in line with
// the sprite's (3 px rails at the shaft's edges, a bolt every 24 px).
function hoist(cv){
  const h = HFM, x0 = Math.min(...h.wheels.map(w => w.arr.x)), x1 = h.wheels[0].hole.x + 4;
  paint(cv, x0 - 2, h.top, x1 - x0 + 4, NGY - h.top, g => {
    for (const wh of h.wheels){ rope(g, wh.hole.x, wh.hole.y, wh.arr.x, wh.arr.y); R(g, wh.hole.x - 3, wh.hole.y - 2, 6, 6, CO[0]); } });
  paint(cv, E.shaft.c0 * TS, NGY, (E.shaft.c1 - E.shaft.c0 + 1) * TS, M.LH - NGY, g => {
    for (const gx of [E.shaft.c0 * TS + 1, (E.shaft.c1 + 1) * TS - 4]){
      R(g, gx, NGY, 1, M.LH - NGY, ST[5]); R(g, gx + 1, NGY, 1, M.LH - NGY, ST[4]); R(g, gx + 2, NGY, 1, M.LH - NGY, ST[2]);
      for (let y = NGY + 14; y < M.LH; y += 24) dot(g, gx + 1, y, ST[6]); } });
}
// x of the right leg's outer chord at height y (the back strut's ties start there)
const hfRightLeg = (h, y) => Math.round(h.x + h.w + (h.tr - h.x - h.w) * (h.gy - y) / (h.gy - h.ty));
// The back strut: two chords from the deck's right end down to a footing (A: the outer, B: the inner chord), laced, tied to the
// right leg twice.
function backStrut(cv){
  const h = hfGeo(), { gy, ty, tr } = h, sx = h.strutX;
  paint(cv, tr - 2, ty - 2, sx - tr + 14, gy - ty + 2, g => {
    const A = t => [tr + (sx - tr) * t, ty + (gy - 1 - ty) * t], B = t => [tr + (sx - 21 - tr) * t, ty + 15 + (gy - 1 - ty - 15) * t];
    for (let k = 0; k < 18; k++){ const a = A(k / 18), b = B((k + 0.5) / 18), c = A((k + 1) / 18); seg(g, a[0], a[1], b[0], b[1], RU[2]); seg(g, b[0], b[1], c[0], c[1], RU[2]); }
    seg(g, tr, ty, sx, gy - 1, RU[4]); seg(g, tr + 1, ty, sx + 1, gy - 1, RU[1]); seg(g, tr, ty + 15, sx - 21, gy - 1, RU[3]);
    for (const y of h.levels.slice(-2)){ const xb = Math.round(B((y - ty - 15) / (gy - ty - 15))[0]), xa = hfRightLeg(h, y);
      R(g, xa, y, xb - xa, 1, RU[3]); R(g, xa, y + 1, xb - xa, 1, RU[1]); }
    R(g, sx - 30, gy - 9, 42, 9, IR[5]); R(g, sx - 30, gy - 9, 42, 1, IR[7]); R(g, sx + 11, gy - 9, 1, 9, IR[3]);
  });
}
function headframe(cv){
  const h = hfGeo(), { x, w, gy, ty, tl, tr, deck } = h, lerp = (a, b, y) => Math.round(a + (b - a) * (gy - y) / (gy - ty));
  const L = { o: y => lerp(x, tl, y), i: y => lerp(x + 15, tl + 15, y) }, Rr = { o: y => hfRightLeg(h, y), i: y => lerp(x + w - 15, tr - 15, y) };
  const d0 = tl - 48, d1 = tr + 48;
  paint(cv, Math.min(x, d0) - 2, h.top - 2, Math.max(x + w, d1, E.engineHouse.c * TS + 8) - Math.min(x, d0) + 4, M.LH - h.top + 2, g => {
    // cage guides down the shaft (behind everything else): steel rails at the shaft's inner edges, a bolt row
    for (const gx of [E.shaft.c0 * TS + 1, (E.shaft.c1 + 1) * TS - 5]){
      R(g, gx, deck + 9, 4, M.LH - deck - 9, ST[4]); R(g, gx, deck + 9, 1, M.LH - deck - 9, ST[5]); R(g, gx + 3, deck + 9, 1, M.LH - deck - 9, ST[2]);
      for (let y = deck + 30; y < M.LH; y += 36) dot(g, gx + 2, y, ST[6]); }
    // X-bracing in each panel (inner chords; a lit bar over its shadow row), then the strut levels with their gussets
    const lv = [ty + 3, ...h.levels.slice().reverse(), gy - 1];
    for (let k = 0; k + 1 < lv.length; k++){ const ya = lv[k] + 3, yb = lv[k + 1];
      for (const [c, d] of [[RU[1], 1], [RU[3], 0]]){ seg(g, L.i(ya), ya + d, Rr.i(yb), yb + d, c); seg(g, Rr.i(ya), ya + d, L.i(yb), yb + d, c); } }
    for (const y of h.levels){ const a = L.i(y), b = Rr.i(y);
      R(g, a, y, b - a + 1, 1, RU[4]); R(g, a, y + 1, b - a + 1, 1, RU[3]); R(g, a, y + 2, b - a + 1, 1, RU[1]);
      for (const gx of [a - 2, b - 5]){ R(g, gx, y - 3, 8, 8, RU[3]); R(g, gx, y - 3, 8, 1, RU[4]); R(g, gx + 7, y - 2, 1, 7, RU[1]); dot(g, gx + 2, y, RU[5]); dot(g, gx + 5, y + 3, RU[5]); } }
    // legs: two chords each with zig-zag lacing; the left leg's outer chord faces the light, the right leg's outer chord the sun
    const rim = y => y < ty + 36 ? SK[5] : y < ty + 54 ? SK[4] : y < ty + 66 ? SK[3] : RU[1];
    for (const [leg, oc, ic] of [[L, () => RU[4], RU[3]], [Rr, rim, RU[3]]]){
      for (let y = ty + 6; y + 21 <= gy; y += 21){ seg(g, leg.o(y), y, leg.i(y + 10), y + 10, RU[2]); seg(g, leg.i(y + 10), y + 10, leg.o(y + 21), y + 21, RU[2]); }
      for (let y = ty; y < gy; y++){ dot(g, leg.i(y), y, ic); dot(g, leg.o(y), y, oc(y)); } }
    // deck girder: lit top, rivets, brackets under its overhangs; its railing; the sheaves' bearing pedestals (behind the wheels)
    R(g, d0, deck - 21, d1 - d0, 1, RU[4]); R(g, d0, deck - 11, d1 - d0, 1, RU[2]);
    for (let px = d0; px <= d1; px += 21) R(g, px, deck - 21, 1, 21, RU[3]);
    for (const wh of h.wheels){
      seg(g, wh.x - 20, deck - 1, wh.x - 4, wh.y + 4, RU[4]); seg(g, wh.x - 19, deck - 1, wh.x - 3, wh.y + 4, RU[1]);
      seg(g, wh.x + 20, deck - 1, wh.x + 4, wh.y + 4, RU[3]); seg(g, wh.x + 19, deck - 1, wh.x + 3, wh.y + 4, RU[1]);
      R(g, wh.x - 8, wh.y - 4, 17, 10, ST[3]); R(g, wh.x - 8, wh.y - 4, 17, 1, ST[6]); R(g, wh.x - 8, wh.y + 5, 17, 1, ST[1]); }
    R(g, d0, deck, d1 - d0, 9, RU[2]); R(g, d0, deck, d1 - d0, 1, RU[4]); R(g, d0, deck + 1, d1 - d0, 1, RU[3]); R(g, d0, deck + 8, d1 - d0, 1, RU[0]);
    for (let px = d0 + 4; px < d1; px += 12) dot(g, px, deck + 4, RU[4]);
    for (const [a, b] of [[d0 + 3, L.i(ty + 27)], [d1 - 3, Rr.i(ty + 27)]]){ seg(g, a, deck + 9, b, ty + 27, RU[3]); seg(g, a, deck + 10, b, ty + 28, RU[1]); }
    // the hoist ropes from the engine house: from its wall up to where they lie over each sheave (static: the wheel turns under them)
    for (const wh of h.wheels){ rope(g, wh.hole.x, wh.hole.y, wh.arr.x, wh.arr.y); R(g, wh.hole.x - 3, wh.hole.y - 2, 6, 6, CO[0]); }
  });
}
// Sheave sprite (once): the 5 px rim (outer lip, groove, web, inner edge: the outside faces lit toward the upper left, the inside
// edge lit at the lower right), a stiffening ring at two thirds of the radius and the hub with its axle; the 1 px spokes and the
// rope in the groove are drawn per frame under / over it.
function sheaveSprite(r){
  const n = 2 * r + 3, b = buf(0, 0, n, n), o = r + 1;
  annulus(b, o, o, r - 4.5, r + 0.5, (d, ux, uy) => { const k = Math.floor(r + 0.5 - d), f = facing(ux, uy);
    return k === 0 ? shade3(f, ST[6], ST[5], ST[3]) : k === 1 ? shade3(f, ST[5], ST[4], ST[2]) : k === 2 ? shade3(f, ST[4], ST[3], ST[1]) : k === 3 ? ST[2] : shade3(-f, ST[5], ST[3], ST[1]); });
  annulus(b, o, o, 0.62 * r - 1, 0.62 * r, (d, ux, uy) => shade3(facing(ux, uy), ST[5], ST[3], ST[2]));
  annulus(b, o, o, 4.5, 7.5, (d, ux, uy) => d > 6.5 ? shade3(facing(ux, uy), ST[6], ST[4], ST[2]) : ST[3]);
  annulus(b, o, o, -1, 4.5, d => d <= 2 ? ST[1] : ST[4]);
  dot(b, o - 1, o - 1, ST[7]);
  for (let k = 0; k < 6; k++){ const a = k * Math.PI / 3 + 0.5; dot(b, o + Math.round(Math.cos(a) * 6), o + Math.round(Math.sin(a) * 6), ST[1]); }
  const [c, g] = mk(n, n); b.blit(g); return c;
}

// ---------- E: winding-engine house ----------
// Fördermaschinenhaus, ENT.engineHouse: 348 x 252 px of brick in the tiles' scale (style.js SCALE.brick + 1 px mortar, running
// bond) on a dressed-stone plinth: the draft's dark body (the machine hall: soot-dark brick, a dentil frieze under the eaves) with
// tall round-arched iron windows glowing over a string course - the shadow of the hall's travelling-crane girder crossing every
// lit one at the same height, the winding engine's rope drum dark against the light in the middle bays - and a lighter, lamp-lit
// ground floor (pale lime mortar, segmental-arched lit windows, the double door in its own wider bay standing half open on the
// lit hall): that band is the hero's backdrop (VALUE rule in style.js). Five window bays and the door bay between brick pilasters
// (over the door a lit oculus and the date plate); a slate hip roof with a gutter, a louvred ridge lantern leaking warm light, a
// brick chimney with iron bands and a corbelled cap, a downpipe; the hoist ropes enter through the corner pilaster. The lamp post
// of map ENT col 152 stands in front of bay 1, so that bay's hall window is dark: the lamp's glass reads against it.
const EH_W = 348, EH_H = 252;
const ehGeo = () => { const x0 = E.engineHouse.c * TS, gy = groundAt(x0 + 12); return { x0, W: EH_W, gy, top: gy - EH_H }; };
// A window of the engine house: an opening of 2 half + 1 px (x cx - half .. cx + half) under a round arch (r = half) or a
// segmental one (larger r) with brick voussoirs and a stone keystone; reveals 2 px each side (the left one in shadow, the right one
// lit), iron bars every 8 px splitting it into 7 px panes, 12 px tall, a stone sill. lit: the hall's lamp light (warmer and
// brighter low in the window; crane: the y of the crane girder's shadow; inside(x, y): the machine standing in the hall, seen as a
// dim silhouette against the light), else dark glass mirroring the sky: the upper-left panes catch it, one diagonal glint, the
// lower-right ones fall dark. marks: hand-placed damage { 'col,row': 'broken' | 'boarded' } (pane column 0..3, pane row from
// the springing line down), a hole with a shard of glass left in its upper-left corner, or a pane boarded with two planks.
function archWindow(g, cx, yTop, yBot, r, lit, upper, marks = {}, crane = null, inside = null){
  const half = 17, ay = yTop + r, spring = Math.ceil(ay - Math.sqrt(r * r - half * half)), topAt = x => Math.ceil(ay - Math.sqrt(Math.max(0, r * r - (x + 0.5 - cx) ** 2)));
  const vou = upper ? [BR[4], BR[3]] : [BR[7], BR[6]], step = 0.2 * 17 / r;
  for (let y = yTop - 5; y < spring + 1; y++) for (let x = cx - half - 4; x <= cx + half + 4; x++){       // voussoirs, a keystone
    const dx = x + 0.5 - cx, dy = y + 0.5 - ay, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (d > r && d <= r + 4 && y < spring) dot(g, x, y, Math.abs(a + Math.PI / 2) < step * 0.7 ? IR[7] : Math.floor((a + Math.PI) / step) & 1 ? vou[0] : vou[1]); }
  for (let x = cx - half; x <= cx + half; x++){ const t = topAt(x), lx = x - (cx - half), pc = Math.min(3, Math.max(0, (lx - 2) >> 3));
    for (let y = t; y < yBot; y++){ const row = Math.floor((y - spring) / 12), mark = marks[pc + ',' + row], u = lx - 2 - pc * 8, v = y - spring - row * 12;
      let col;
      if (lx < 2) col = BR[1];                                                                       // left reveal (in shadow)
      else if (lx > 2 * half - 2) col = lx === 2 * half ? (upper ? BR[4] : BR[7]) : (upper ? BR[3] : BR[6]);   // right reveal (lit)
      else if (y === t) col = BR[1];                                                                  // the arch soffit
      else if (lx === 9 || lx === 17 || lx === 25 || (y >= spring && v === 0)) col = CO[2];           // iron glazing bars
      else {
        if (lit){ col = y < spring ? LA[0] : y > yBot - (upper ? 36 : 24) ? LA[2] : LA[1];
          if (crane !== null && y >= crane && y < crane + 4) col = y === crane + 3 ? LA[0] : CO[3]; else if (inside && inside(x, y)) col = LA[0]; }
        else { const sky = pc + Math.max(0, row) * 1.4;                                              // the sky in the upper-left panes
          col = sky < 1.5 ? SK[3] : sky < 3 ? SK[2] : sky < 4.5 ? IR[3] : IR[2];
          if (u + v === 9 && pc + row === 2) col = SK[4]; }                                          // one glint
        if (mark === 'broken' && u + v > 2 + (u === 1 ? 1 : 0)) col = CO[1];                          // the hole, a shard left
        else if (mark === 'boarded') col = v === 1 || v === 7 ? WD[4] : v === 6 || v === 11 ? WD[1] : u === 1 && (v === 3 || v === 9) ? ST[5] : WD[3];
      }
      dot(g, x, y, col); } }
  R(g, cx - half - 3, yBot, 2 * half + 7, 1, IR[8]); R(g, cx - half - 3, yBot + 1, 2 * half + 7, 2, IR[6]); R(g, cx - half - 2, yBot + 3, 2 * half + 5, 1, IR[3]);   // stone sill
}
function engineHouse(cv){
  const { x0, W, gy, top } = ehGeo(), mid = gy - 114, plinth = gy - 18, [bw, bh] = SC.brick;
  const pil = [[x0, 12], ...[1, 2, 3, 4, 5].map(i => [x0 + 3 + 51 * i, 9]), [x0 + W - 12, 12]];    // pilasters [x, w]
  const bays = [0, 1, 2, 3, 4].map(i => x0 + 33 + 51 * i), door = x0 + 301;                           // window axes, the door's
  const RH = 54, ridge = top - RH, chx = x0 + 262, cht = top - 126;
  paint(cv, x0 - 10, cht - 2, W + 20, gy - cht + 2, g => {
    // brick: SCALE.brick bricks + 1 px mortar in a running bond; the hall soot-dark, the ground floor lighter in lime mortar. Soot
    // under the eaves blackens whole bricks (posterised, no dither) down to a ragged edge 18..40 px under the wall top.
    const sooted = (x, y) => y - top < 18 + (hash(x >> 4, 5) * 23 | 0), SOOT = [BR[1], BR[2]];
    for (let y = top, course = 0; y < plinth; y += bh + 1, course++){ const upper = y < mid, mort = upper ? BR[1] : IR[6];
      R(g, x0, y + bh, W, 1, mort);
      for (let bx = course & 1 ? -((bw + 1) >> 1) : 0; bx < W; bx += bw + 1){ const hb = hash(x0 + bx * 3 + course, course * 7 + 1), a = Math.max(0, bx), b = Math.min(W, bx + bw);
        const col = sooted(x0 + bx + 6, y) ? SOOT[hb < 0.6 ? 0 : 1] : upper ? (hb < 0.6 ? BR[2] : hb < 0.9 ? BR[3] : BR[4]) : (hb < 0.5 ? BR[6] : hb < 0.86 ? BR[5] : hb < 0.95 ? BR[4] : BR[7]);
        if (b > a) R(g, x0 + a, y, b - a, Math.min(bh, plinth - y), col);
        if (bx + bw < W && bx + bw >= 0) R(g, x0 + bx + bw, y, 1, bh, mort);
        if (!upper && hb > 0.97 && b - a > 4) dot(g, x0 + a + 1, y, BR[3]); } }                             // a chipped corner
    // pilasters: lit left edge, shadowed right edge and a 1 px cast shadow on the wall (on the lit ground floor the right face 2 px
    // of brick[4], the cast shadow a step darker, so they stand proud of the wall); their bricks bonded in headers
    for (const [px, pw] of pil) for (let y = top, course = 0; y < plinth; y += bh + 1, course++){ const upper = y < mid, hb = hash(px, course) > 0.5;
      R(g, px, y, pw, Math.min(bh, plinth - y), sooted(px + 4, y) ? SOOT[hb ? 1 : 0] : hb ? (upper ? BR[3] : BR[6]) : (upper ? BR[4] : BR[5]));
      R(g, px, y + bh, pw, 1, upper ? BR[1] : IR[6]);
      if (course & 1) R(g, px + (pw >> 1), y, 1, bh, upper ? BR[1] : IR[6]);
      R(g, px, y, 1, bh + 1, upper ? BR[5] : BR[7]); R(g, px + pw - (upper ? 1 : 2), y, upper ? 1 : 2, bh + 1, upper ? BR[1] : BR[4]);
      if (px + pw < x0 + W) R(g, px + pw, y, 1, bh + 1, upper ? BR[1] : BR[3]); }
    // dentil frieze and corbel band under the eaves, the eaves' shadow
    R(g, x0, top + 5, W, 1, BR[5]); R(g, x0, top + 6, W, 2, BR[3]);
    for (let x = x0; x < x0 + W; x += 9){ R(g, x, top + 9, 6, 6, BR[4]); R(g, x, top + 9, 6, 1, BR[5]); R(g, x + 5, top + 10, 1, 5, BR[1]); }
    R(g, x0, top + 15, W, 1, BR[1]); R(g, x0, top, W, 5, CO[1]);
    // string course over the ground floor (projecting: lit top, shadow under), broken by the door's arch
    for (const [a, b] of [[x0 - 2, door - 37], [door + 37, x0 + W + 2]]){ R(g, a, mid - 6, b - a, 1, BR[7]); R(g, a, mid - 5, b - a, 3, BR[5]); R(g, a, mid - 2, b - a, 1, BR[3]); R(g, a, mid - 1, b - a, 1, BR[1]); }
    // plinth: dressed stone, one course of 33 px blocks (the door stands in it on its threshold), a few chips
    R(g, x0 - 3, plinth, W + 6, 18, IR[6]); R(g, x0 - 3, plinth, W + 6, 1, IR[8]); R(g, x0 - 3, plinth + 1, W + 6, 1, IR[7]); R(g, x0 - 3, gy - 1, W + 6, 1, IR[4]);
    for (let x = x0 + 14; x < x0 + W; x += 33){ R(g, x, plinth + 1, 1, 17, IR[4]); dot(g, x + 1, plinth + 1, IR[8]); }
    for (let i = 0; i < 9; i++){ const sx = x0 + (hash(i, 77) * W | 0), sy = plinth + 5 + (hash(i, 78) * 9 | 0); R(g, sx, sy, 2, 1, IR[5]); dot(g, sx, sy + 1, IR[4]); }
    // windows: tall round-arched ones in the hall (bays 1 and 4 dark), segmental lit ones on the ground floor
    const DAMAGE = { up: { 2: { '3,0': 'broken' }, 4: { '0,2': 'broken' } }, down: { 3: { '1,1': 'boarded', '2,1': 'boarded' } } };   // chosen panes
    // the winding engine in the hall: the rim, spokes and hub of its rope drum, the drum's bearing pedestal, seen through bays 2-3
    const dc = { x: x0 + 160, y: top + 150 }, drum = (x, y) => { const dx = x + 0.5 - dc.x, dy = y + 0.5 - dc.y, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      return (d > 58 && d <= 65) || d <= 9 || (d < 58 && Math.abs(((a / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.5 - 2.2 / Math.max(d, 1)) || (Math.abs(dx) < 12 && dy > 0); };
    const crane = top + 54;
    bays.forEach((bc, i) => {
      archWindow(g, bc, top + 24, mid - 15, 17, i !== 1 && i !== 4, true, DAMAGE.up[i], crane, drum);
      archWindow(g, bc, mid + 14, gy - 33, 30, true, false, DAMAGE.down[i]); });
    // over the door bay, where the hall has no window: an oculus lit from the hall (a ring of voussoirs with four stone keys, the
    // reveal shadowed at the upper left, iron bars in a wheel), and the cast-iron date plate under it (raised letters, lit rim)
    const oy = top + 66;
    annulus(g, door, oy, 15.5, 19.5, (d, ux, uy) => Math.abs(ux) > 0.97 || Math.abs(uy) > 0.97 ? IR[7] : (Math.floor((Math.atan2(uy, ux) + Math.PI) / 0.22) & 1 ? BR[4] : BR[3]));
    annulus(g, door, oy, -1, 15.5, (d, ux, uy) => { const a = Math.atan2(uy, ux), spoke = Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.5 - 0.8 / Math.max(d, 1);
      return d > 13.5 ? (facing(ux, uy) > 0 ? BR[1] : BR[4]) : spoke || (d > 5.5 && d <= 6.5) || d <= 2 ? CO[2] : uy < -0.4 && d > 8 ? LA[0] : uy > 0.3 && d > 7 ? LA[2] : LA[1]; });
    const pw = tw(null, 'ERBAUT 1911') + 8, pX = door - (pw >> 1), pY = oy + 25;
    R(g, pX, pY, pw, 11, ST[2]); R(g, pX, pY, pw, 1, ST[4]); R(g, pX, pY, 1, 11, ST[4]); R(g, pX, pY + 10, pw, 1, ST[1]); R(g, pX + pw - 1, pY, 1, 11, ST[1]);
    txt(g, 'ERBAUT 1911', pX + 4, pY + 2, ST[5], PIX); for (const bxx of [pX + 2, pX + pw - 3]) dot(g, bxx, pY + 5, ST[6]);
    // the door (its own bay): a round arch of 30 over a 60 px opening, a lit fanlight with radial bars over the transom, the left
    // leaf shut (planks, strap hinges, a ring handle), the right leaf swung in on the lit hall (seen edge-on), light under it; the
    // leaves 102 px (1.94 m: the hero, 96, walks through under the transom)
    const dx0 = door - 30, dW = 60, sp = gy - 108, dr = 30;
    annulus(g, door, sp, dr, dr + 5, (d, ux, uy) => uy > 0.02 ? null : Math.abs(Math.atan2(uy, ux) + Math.PI / 2) < 0.07 ? IR[7] : Math.floor((Math.atan2(uy, ux) + Math.PI) / 0.12) & 1 ? BR[7] : BR[6]);
    for (let x = dx0; x < dx0 + dW; x++){ const t = Math.ceil(sp - Math.sqrt(Math.max(0, dr * dr - (x + 0.5 - door) ** 2))), lx = x - dx0;
      for (let y = t; y < gy - 3; y++){
        let col;
        if (lx < 2) col = BR[1]; else if (lx >= dW - 2) col = BR[7];
        else if (y < sp){ const fa = Math.atan2(y + 0.5 - sp, x + 0.5 - door), fd = Math.hypot(y + 0.5 - sp, x + 0.5 - door);   // fanlight
          col = y === t ? BR[1] : fd < 6 ? CO[2] : Math.abs(((fa + Math.PI) / (Math.PI / 8)) % 1 - 0.5) > 0.5 - 1.1 / fd ? CO[2] : fd < 15 ? LA[2] : LA[1]; }
        else if (y < sp + 3) col = y === sp ? WD[3] : WD[1];                                          // transom
        else if (lx < 31){ const p = (lx - 2) % 7; col = p === 0 ? WD[4] : p === 6 ? WD[1] : WD[3]; }   // the shut leaf: 7 px planks
        else if (lx < 36) col = lx === 31 ? WD[0] : lx === 35 ? WD[1] : WD[2];                        // the open leaf, edge-on
        else col = y > gy - 16 ? LA[0] : y > gy - 24 && lx > 40 ? LA[2] : LA[1];                    // the lit hall inside, its floor
        dot(g, x, y, col); } }
    for (const hy of [sp + 12, gy - 24]){ R(g, dx0 + 2, hy, 26, 3, ST[2]); R(g, dx0 + 2, hy, 26, 1, ST[4]); for (const rx of [dx0 + 5, dx0 + 13, dx0 + 21]) dot(g, rx, hy + 1, ST[6]); }
    annulus(g, dx0 + 25, gy - 56, 1.5, 3.5, (d, ux, uy) => uy > 0 ? (ux < 0 ? ST[5] : ST[2]) : null); R(g, dx0 + 24, gy - 58, 3, 2, ST[3]);   // ring handle
    R(g, dx0 - 4, gy - 3, dW + 8, 3, IR[7]); R(g, dx0 - 4, gy - 3, dW + 8, 1, IR[8]); R(g, dx0 + 36, gy - 3, dW - 38, 1, LA[1]); R(g, dx0 + 38, gy - 2, dW - 42, 1, LA[0]);   // threshold, light
    // downpipe at the right corner, brackets, its shoe
    const dp = x0 + W - 7;
    R(g, dp, top, 4, plinth - top, ST[4]); R(g, dp, top, 1, plinth - top, ST[5]); R(g, dp + 3, top, 1, plinth - top, ST[2]);
    for (let y = top + 30; y < plinth; y += 45){ R(g, dp - 1, y, 6, 3, ST[3]); dot(g, dp - 1, y, ST[5]); dot(g, dp + 4, y + 2, ST[1]); }
    R(g, dp - 4, plinth - 4, 8, 4, ST[4]); R(g, dp - 4, plinth - 4, 8, 1, ST[5]); R(g, dp - 4, plinth - 1, 8, 1, ST[2]);
    // chimney (drawn before the roof, which covers its foot): two bricks wide, iron bands, corbelled cap, soot, the flue
    const cw = 2 * bw + 1;
    for (let y = cht + 9, course = 0; y < top; y += bh + 1, course++){ R(g, chx, y + bh, cw, 1, BR[1]);
      for (let bx = course & 1 ? -((bw + 1) >> 1) : 0; bx < cw; bx += bw + 1){ const a = Math.max(0, bx), b = Math.min(cw, bx + bw), hb = hash(bx + 40, course);
        if (b > a) R(g, chx + a, y, b - a, bh, course < 3 + (hb > 0.5 ? 1 : 0) ? SOOT[hb > 0.8 ? 1 : 0] : a < cw / 2 ? (hb > 0.6 ? BR[4] : BR[3]) : (hb > 0.6 ? BR[3] : BR[2]));
        if (bx + bw < cw && bx + bw >= 0) R(g, chx + bx + bw, y, 1, bh, BR[1]); }
      R(g, chx, y, 1, bh + 1, course < 3 ? BR[2] : BR[5]); R(g, chx + cw - 1, y, 1, bh + 1, BR[1]); }
    for (const by of [cht + 33, cht + 69]){ R(g, chx - 1, by, cw + 2, 2, ST[4]); R(g, chx - 1, by, cw + 2, 1, ST[5]); R(g, chx - 1, by + 2, cw + 2, 1, ST[1]); dot(g, chx + 3, by + 1, ST[6]); dot(g, chx + cw - 4, by + 1, ST[6]); }
    R(g, chx - 4, cht, cw + 8, 4, BR[4]); R(g, chx - 4, cht, cw + 8, 1, BR[6]); R(g, chx - 3, cht + 4, cw + 6, 3, BR[3]); R(g, chx - 2, cht + 7, cw + 4, 2, BR[2]); R(g, chx - 2, cht + 8, cw + 4, 1, BR[1]);
    R(g, chx + 3, cht - 1, cw - 6, 1, CO[0]);                                                        // the flue
    // slate hip roof: courses every 6 rows with staggered joints, a slipped slate, lit left hip, dark right hip, the ridge;
    // a gutter at the eaves
    for (let k = 0; k < RH; k++){ const y = top - 1 - k, ins = 2 * k - 6, a = x0 + ins, b = x0 + W - ins, course = (k / 6) | 0;
      R(g, a, y, b - a, 1, k % 6 === 0 ? IR[2] : k % 6 === 1 ? IR[3] : IR[4]);
      if (k % 6 > 1) for (let x = a + (course & 1 ? 8 : 0) + 4; x < b - 3; x += 15) dot(g, x, y, IR[3]);
      R(g, a, y, 2, 1, IR[6]); dot(g, a + 2, y, IR[5]); dot(g, b - 1, y, IR[2]); dot(g, b - 2, y, IR[3]); }
    R(g, x0 + 140, top - 26, 9, 5, CO[2]); R(g, x0 + 140, top - 26, 9, 1, IR[2]); R(g, x0 + 141, top - 22, 8, 1, WD[2]);   // a slipped slate, the lath behind
    R(g, x0 + 2 * RH - 7, ridge - 1, W - 4 * RH + 14, 1, IR[6]); R(g, x0 + 2 * RH - 7, ridge, W - 4 * RH + 14, 1, IR[5]);
    R(g, x0 - 8, top - 3, W + 16, 3, ST[4]); R(g, x0 - 8, top - 3, W + 16, 1, ST[5]); R(g, x0 - 8, top - 1, W + 16, 1, ST[2]); R(g, x0 + W + 7, top - 3, 1, 3, ST[2]);
    // ridge lantern (Dachreiter): louvred walls with the hall's warm light between the slats, posts, a small hip roof, a finial
    const lw = 84, lx0 = x0 + W / 2 - lw / 2, lt = ridge - 20;
    for (let y = lt; y < ridge; y++){ const j = y - lt; R(g, lx0, y, lw, 1, j % 3 === 0 ? IR[6] : j % 3 === 1 ? IR[4] : LA[0]); }
    for (const px of [lx0, lx0 + 27, lx0 + 54, lx0 + lw - 3]){ R(g, px, lt, 3, 20, IR[3]); dot(g, px, lt, IR[6]); R(g, px + 2, lt, 1, 20, IR[2]); }
    for (let j = 0; j < 12; j++){ const y = lt - 1 - j, a = lx0 - 6 + 2 * j, b = lx0 + lw + 6 - 2 * j;
      R(g, a, y, b - a, 1, j % 4 === 3 ? IR[3] : IR[4]); R(g, a, y, 2, 1, IR[6]); dot(g, b - 1, y, IR[2]); }
    R(g, lx0 - 6, lt - 1, lw + 12, 1, IR[5]); R(g, lx0 - 6, lt, lw + 12, 1, CO[1]);
    R(g, lx0 + lw / 2, lt - 21, 1, 8, ST[3]); R(g, lx0 + lw / 2 - 1, lt - 23, 3, 2, ST[5]); dot(g, lx0 + lw / 2 - 1, lt - 23, ST[6]);
  });
}

// ---------- C / D: graffiti, banner ----------
// Kotwica Polski Walczącej, ENT.kotwica (k.c, k.r: tile; k.s: size class, 1 = small, 2 = big): whitewash brushed on the wall along
// the anchor's strokes, painted natively with a round brush (big: 84 px with a 5 px brush, small: 39 px with a 2-3 px one): the edges
// bitten where the brush ran dry, dry-brush streaks and a few loaded blobs in the paint, a fine overspray halo, drips running from
// the lower edges (ending in a bead); the big one carries the PW tag under its foot, brushed in 2 px strokes with a forward slant.
// ANCHOR follows the owner's style.js KOTWICA (its 13 x 13 cells are the units, cell centres at + 0.5): the stem, the P's bars and
// bowl, the arms rising straight at their tips and running down into the flat foot (an angular W, never a round "peace" ring), the
// W's inner strokes from the stem out to the arms, and a barb flaring out under each tip. It stays inside the box tiles.js keeps
// blank for it (45 x 60 px per size class from the tile's corner).
const ANCHOR = [[6.5, 0.4, 6.5, 12.6], [6.5, 0.4, 9.3, 0.4], [6.5, 3.6, 9.3, 3.6], { cx: 9.3, cy: 2, rx: 1.5, ry: 1.6, a0: -Math.PI / 2, a1: Math.PI / 2 },
  [0.5, 4.9, 0.5, 7.4, 4.1, 12.5, 8.9, 12.5, 12.5, 7.4, 12.5, 4.9],
  [0.5, 4.9, -0.4, 6.1], [12.5, 4.9, 13.4, 6.1], [6.5, 7.9, 2.6, 10.3], [6.5, 7.9, 10.4, 10.3]];
const TAG = { P: [[0, 0, 0, 16], [0, 0, 4, 0], [0, 8, 4, 8], { cx: 4, cy: 4, rx: 4, ry: 4, a0: -Math.PI / 2, a1: Math.PI / 2 }],
  W: [[0, 0, 2.5, 16, 5, 6, 7.5, 16, 10, 0]] };
function graffiti(cv, k){
  const big = k.s > 1, n = big ? 84 : 39, rb = big ? 2.6 : 1.25, x0 = k.c * TS + 3, y0 = k.r * TS + 3, seed = k.c * 131 + k.r;
  const core = big ? PT[2] : PT[1], edge = big ? PT[1] : PT[0], m = Math.ceil(rb) + 1, u = (n - 2 * m) / 14, P = v => m + (v + 0.5) * u;   // cell units -> px
  const segs = strokes(ANCHOR.map(s => Array.isArray(s) ? s.map(P) : { cx: P(s.cx), cy: P(s.cy), rx: s.rx * u, ry: s.ry * u, a0: s.a0, a1: s.a1 }));
  const on = brush(segs, rb, n, n), at = (i, j) => i >= 0 && j >= 0 && i < n && j < n && on[j * n + i];
  paint(cv, x0 - 2, y0 - 2, n + 4, n + (big ? 40 : 14), g => {
    for (let j = -2; j < n + 2; j++) for (let i = -2; i < n + 2; i++){                            // overspray
      if (at(i, j) || !(at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1))) continue;
      if (hash(x0 + i + seed, y0 + j) < (big ? 0.14 : 0.07)) dot(g, x0 + i, y0 + j, PT[0]); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){ if (!at(i, j)) continue;               // strokes
      const isEdge = !at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1), h = hash(x0 + i, y0 + j + seed);
      if (isEdge && h < (big ? 0.08 : 0.04)) continue;
      const streak = big && !isEdge && hash(x0 + i + seed, (y0 + j) / 6 | 0) > 0.955;                 // dry-brush streaks, loaded blobs
      dot(g, x0 + i, y0 + j, isEdge ? edge : streak ? PT[1] : h > 0.975 ? PT[3] : core); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){ if (!at(i, j) || at(i, j + 1)) continue; // drips
      if (hash(x0 + i * 7, y0 + j * 3 + seed) < (big ? 0.05 : 0.04)){ const L = 3 + (hash(i, j + seed) * (big ? 14 : 6) | 0);
        R(g, x0 + i, y0 + j + 1, 1, L, edge); R(g, x0 + i, y0 + j + 1 + L, 1, 2, core); dot(g, x0 + i + 1, y0 + j + L + 2, edge); } }
    if (k.tag && big){ const ty = y0 + n + 4, tagW = 4 + 4 + 10 + 4, tx = x0 + Math.round((n - tagW) / 2) + 2;
      let ox = tx; for (const ch of k.tag){ const sh = TAG[ch]; if (!sh) continue;
        const tm = brush(strokes(sh.map(s => Array.isArray(s) ? s.map((v, i) => v + (i & 1 ? 1 : 2)) : Object.assign({}, s, { cx: s.cx + 2, cy: s.cy + 1 }))), 1.1, 16, 19);
        for (let j = 0; j < 19; j++) for (let i = 0; i < 16; i++){ const X = ox + i - 2, Y = ty + j - 1, sl = Math.round((17 - j) * 0.25);   // forward slant
          if (tm[j * 16 + i]) dot(g, X + sl, Y, hash(X, Y) > 0.88 ? edge : core); }
        R(g, ox + 1, ty + 17, 1, 4, edge); R(g, ox + 1, ty + 21, 1, 2, core);                                     // a drip
        ox += (ch === 'P' ? 8 : 12) + 4; } }
  });
}
// The regime banner, ENT.banner: a 60 x 150 px red cloth on a steel rod with ball finials, hung from two wall hooks; its sleeve
// gathered on the rod; folds (FOLD: lit ridge, body, shadowed valley, a deep crease) that carry through the white roundel and the
// cog emblem (a fictional cog in a circle: never a swastika) and the black band under it: gathered tight under the sleeve, they
// splay out toward the hem (FOLD is the hem's pattern, sampled ever closer together up the cloth), and the hem follows them (the
// ridges hang a pixel lower than the valleys) before it is torn and frayed into hanging threads; a ragged hole showing the wall;
// a 1 px contact shadow on the wall. Hooks, rod, finials and threads stay inside the box tiles.js keeps blank for it (84 x 168
// px from the tile's corner).
const FOLD = 'mlhhlmmmmddkdmlhhlmmmmdddkdmlhlmmmmddkdmmlhhlmmmmddkdmmlhhlm';   // per column: h l m d k = banner[4] [3] [2] [1] [0]
function banner(cv){
  const bx = E.banner.c * TS + 12, by = E.banner.r * TS + 10, W = FOLD.length, L = 150, cx = bx + 30, cy = by + 36;
  // the fold at column i, row y: FOLD read at a position pulled in toward the middle by 20 % at the sleeve, 0 at the hem
  const fi = (i, y) => { const v = Math.max(0, Math.min(1, (y - by) / L)), k = Math.round((W - 1) / 2 + (i - (W - 1) / 2) / (0.8 + 0.2 * v));
    return 'kdmlh'.indexOf(FOLD[Math.max(0, Math.min(W - 1, k))]); };
  const tear = i => (hash(i, 3) * 7 | 0) + (i >= 33 && i < 52 ? Math.round(24 - Math.abs(i - 42) * 2.6) : 0) + (i < 4 ? 4 - i : 0);
  const hole = (x, y) => { const u = (x - (bx + 17)) / 7, v = (y - (by + 100)) / 13; return u * u + v * v < 1 + (hash(x, y) - 0.5) * 0.45; };
  paint(cv, bx - 12, by - 10, W + 24, L + 18, g => {
    R(g, bx + W, by + 4, 1, L - 26, BR[1]);                                                         // contact shadow on the wall
    for (const hx of [bx + 6, bx + W - 8]){ R(g, hx, by - 10, 3, 5, ST[2]); dot(g, hx, by - 10, ST[4]); dot(g, hx + 2, by - 6, ST[1]); }   // wall hooks
    R(g, bx - 7, by - 6, W + 14, 4, ST[3]); R(g, bx - 7, by - 6, W + 14, 1, ST[5]); R(g, bx - 7, by - 3, W + 14, 1, ST[1]);   // rod
    for (const fx of [bx - 9, bx + W + 8]){ disc(g, fx, by - 4, 3, ST[4]); R(g, fx - 2, by - 6, 2, 1, ST[6]); dot(g, fx - 2, by - 5, ST[6]); R(g, fx + 1, by - 2, 2, 1, ST[2]); }
    for (let i = 0; i < W; i++){ const x = bx + i, fh = fi(i, by + L), bot = by + L - tear(i) + (fh >= 3 ? 1 : fh <= 1 ? -1 : 0);
      for (let y = by - 2; y < bot; y++){
        if (hole(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), f = fi(i, y);
        let col;
        if (y < by + 4) col = y === by - 2 ? BN[3] : (i % 6 === 2 || i % 6 === 3) ? BN[1] : BN[2];            // the sleeve over the rod
        else if (y === by + 4) col = BN[1];
        else if (d <= 21.5){ const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx), tooth = Math.abs(((ang / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.27;
          const cog = (d > 11 && d <= 14.5) || (d > 14.5 && d <= 18 && tooth) || (d <= 5 && d > 2.2);
          col = cog ? (f <= 1 ? BN[1] : f >= 4 ? BN[3] : BN[2]) : d > 20.5 ? PA[1] : f <= 1 ? PA[1] : f >= 3 ? PA[3] : PA[2]; }
        else if (Math.abs(x + 0.5 - cx) <= 6.5 && y > cy + 22 && y < by + 120) col = f >= 3 ? CO[4] : f <= 1 ? CO[1] : CO[2];   // black band
        else col = BN[Math.max(0, f - (y > by + 104 && f === 4 ? 1 : 0))];
        let nearHole = false; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (hole(x + a, y + b)) nearHole = true;
        dot(g, x, y, nearHole || y === bot - 1 ? BN[1] : col); }
      if (hash(i, 9) > 0.6){ const len = 2 + (hash(i, 10) * 6 | 0), kink = hash(i, 11) > 0.5 ? 1 : -1;               // frayed threads
        for (let t = 0; t < len; t++) dot(g, x + (t > 3 ? kink : 0), bot + t, t === len - 1 ? BN[0] : BN[1]); } }
  });
}

// ---------- story decor ----------
// No gameplay, so placed here and not in map ENT: c = column of the left edge (fractional), standing on the street of that column
// (in front of a familok: the ground in front of it, not its roof); up = height of a wall poster's top over the street. The C
// pieces sit on the familok walls clear of their doors and windows as tiles.houses lays them out (re-check them if that changes).
const DECOR = [
  { kind: 'poster', c: 71.58, up: 114 }, // C: a BEKANNTMACHUNG notice on the first familok, beside its door, at eye height
  { kind: 'bike', c: 75.6 },             // C: a bicycle leaning on the first familok, under its last window
  { kind: 'bench', c: 86.1 },            // C: a bench under the regime banner
  { kind: 'bucket', c: 87.85 },          // C: a coal bucket beside it
  { kind: 'sacks', c: 98.8 }             // D: coal sacks and a shovel between the SORTIERUNG posts
];
// Official notice (Bekanntmachung): 33 x 45 px paper pasted on the wall: the cog stamp and a heavy two-line heading, a rule, lines of
// small print in two paragraphs with ragged right ends, a signature over a typed name; paste wrinkles, a water stain's tide mark,
// a torn and curled lower-right corner (the paper's back showing), its shadow on the wall.
function poster(cv, d){
  const x = Math.round(d.c * TS), y = streetAt(x + 16) - d.up, w = 33, h = 45, curl = 10;
  paint(cv, x - 1, y - 1, w + 3, h + 3, g => {
    for (let j = 0; j < h; j++){ const cut = j > h - curl ? j - (h - curl) : 0;
      R(g, x, y + j, w - cut, 1, PA[2]); if (cut) R(g, x + w - cut, y + j, Math.min(2, cut), 1, PA[1]); }
    R(g, x, y, w, 1, PA[3]); R(g, x, y, 1, h, PA[3]); R(g, x + w, y + 1, 1, h - curl, BR[1]); R(g, x + 1, y + h, w - curl, 1, BR[1]);   // its shadow
    annulus(g, x + 16, y + 6, 1.5, 3.5, () => BN[2]); dot(g, x + 16, y + 6, BN[2]); for (const a of [0, 1, 2, 3]) dot(g, x + 16 + [0, 4, 0, -4][a], y + 6 + [-4, 0, 4, 0][a], BN[2]);   // stamp
    R(g, x + 4, y + 12, 25, 2, PA[0]); R(g, x + 8, y + 15, 17, 2, PA[0]); R(g, x + 4, y + 19, 25, 1, PA[1]);                // heading, rule
    for (let l = 0; l < 9; l++){ const ly = y + 22 + l * 2 + (l > 4 ? 1 : 0), len = l === 4 || l === 8 ? 11 : 20 + (hash(l, 3) * 5 | 0);
      const room = w - 7 - (ly - y > h - curl ? ly - y - (h - curl) : 0);
      for (let i = 0; i < Math.min(len, room); i++) if (hash(x + i, ly) > 0.2) dot(g, x + 4 + i, ly, PA[1]); }
    R(g, x + 19, y + 41, 7, 1, PA[1]); seg(g, x + 18, y + 40, x + 21, y + 38, PA[0]); seg(g, x + 21, y + 38, x + 23, y + 40, PA[0]); dot(g, x + 24, y + 39, PA[0]);   // signature
    seg(g, x + 2, y + 30, x + 9, y + 24, PA[3]); seg(g, x + 3, y + 30, x + 10, y + 24, PA[1]);                          // a paste wrinkle
    for (let dy = -6; dy <= 6; dy++) for (let dx = -8; dx <= 8; dx++){ const e = (dx / 7.5) ** 2 + (dy / 5) ** 2;     // the tide mark of a water stain
      if (e > 0.75 && e <= 1.1 && hash(dx + 9, dy + 7) > 0.25) dot(g, x + 10 + dx, y + h - 9 + dy, PA[1]); }
    for (let j = 0; j < curl; j++) for (let i = 0; i <= j; i++) if (i + 2 <= j) dot(g, x + w - curl + i + 1, y + h - curl + j, i === 0 ? PA[0] : PA[1]);   // the curl's back
  });
}
// Bicycle (93 px, wheels r 18 on 28" rims): black enamelled tubes with a lit top line (it must read against the brick), rusty
// mudguards, a sprung leather saddle, an upright bar with grips, a dynamo lamp, spoked wheels (tyre, rim lit at the upper left, 12
// thin spokes), the chainring, chain and a crank, a carrier over the rear wheel; it leans on the wall (side view).
function bicycle(cv, d){
  const x = Math.round(d.c * TS), gy = streetAt(x + 46), r = 18, wy = gy - r - 1, rw = x + 19, fw = x + 75;
  const bb = { x: x + 45, y: gy - 14 }, st = { x: x + 38, y: gy - 49 }, hd = { x: x + 68, y: gy - 47 }, hl = { x: x + 71, y: gy - 37 };
  paint(cv, x - 2, gy - 64, 98, 64, g => {
    for (const wx of [rw, fw]){
      for (let k = 0; k < 12; k++){ const a = k * Math.PI / 6 + (wx & 3) * 0.2; seg(g, wx + Math.cos(a) * 3, wy + Math.sin(a) * 3, wx + Math.cos(a) * (r - 3), wy + Math.sin(a) * (r - 3), CO[3]); }
      annulus(g, wx, wy, r - 3.5, r - 1.5, (dd, ux, uy) => shade3(facing(ux, uy), ST[6], ST[4], ST[2]));
      annulus(g, wx, wy, r - 1.5, r + 0.5, (dd, ux, uy) => facing(ux, uy) > 0.5 ? CO[4] : dd > r - 0.5 ? CO[1] : CO[2]);
      R(g, wx - 2, wy - 2, 4, 4, ST[3]); dot(g, wx - 2, wy - 2, ST[6]);
      annulus(g, wx, wy, r + 0.5, r + 3, (dd, ux, uy) => uy < -0.15 && (wx === fw ? ux > -0.8 : ux < 0.9) ? (dd > r + 2 ? RU[3] : RU[1]) : null); }   // mudguards
    const tube = (a, b) => { seg(g, a.x, a.y, b.x, b.y, CO[6]); seg(g, a.x, a.y + 1, b.x, b.y + 1, CO[3]); };
    tube(bb, { x: rw, y: wy }); tube(st, { x: rw, y: wy }); tube(bb, st); tube(st, hd); tube(bb, hl);
    seg(g, hd.x, hd.y, hl.x, hl.y, CO[4]); seg(g, hd.x + 1, hd.y, hl.x + 1, hl.y, CO[1]);           // head tube
    seg(g, hl.x, hl.y, fw, wy, CO[4]); seg(g, hl.x + 1, hl.y, fw + 1, wy, CO[1]);                   // fork
    seg(g, x + 6, gy - 39, rw + 2, gy - 39, CO[4]); seg(g, x + 6, gy - 38, rw + 2, gy - 38, CO[1]); seg(g, x + 8, gy - 38, rw, wy, CO[2]);   // carrier, its stay
    annulus(g, bb.x, bb.y, -1, 5.5, (dd, ux, uy) => dd > 4.5 ? (facing(ux, uy) > 0 ? ST[5] : ST[2]) : dd > 1.5 ? ST[3] : ST[1]);   // chainring
    lineF(g, bb.x, bb.y + 6, rw, wy + 3, i => i & 1 ? ST[2] : ST[4]); lineF(g, bb.x, bb.y - 5, rw, wy - 2, i => i & 1 ? ST[2] : ST[3]);   // chain
    seg(g, bb.x, bb.y, bb.x + 6, bb.y + 9, CO[4]); R(g, bb.x + 3, bb.y + 9, 8, 2, CO[3]); R(g, bb.x + 3, bb.y + 9, 8, 1, CO[5]);   // crank, pedal
    R(g, st.x - 1, st.y - 3, 2, 3, CO[3]); R(g, st.x - 9, st.y - 7, 15, 3, WD[2]); R(g, st.x - 9, st.y - 7, 14, 1, WD[3]); R(g, st.x + 5, st.y - 6, 1, 2, WD[1]);   // saddle
    for (const sx of [st.x - 6, st.x - 3]) R(g, sx, st.y - 4, 1, 3, ST[4]);                                                 // its springs
    R(g, hd.x, hd.y - 9, 2, 9, CO[4]); dot(g, hd.x + 1, hd.y - 9, CO[1]);                                                   // stem, bar, grip
    seg(g, hd.x + 1, hd.y - 9, hd.x - 9, hd.y - 11, CO[4]); seg(g, hd.x + 1, hd.y - 8, hd.x - 9, hd.y - 10, CO[1]); R(g, hd.x - 13, hd.y - 12, 5, 3, WD[1]); dot(g, hd.x - 13, hd.y - 12, WD[3]);
    R(g, hd.x + 3, hd.y + 2, 4, 4, ST[4]); dot(g, hd.x + 3, hd.y + 2, ST[6]); R(g, hd.x + 7, hd.y + 3, 1, 2, ST[6]);           // dynamo lamp
  });
}
// Park bench: two cast-iron end frames (a curved front leg, a back leg, the armrest scrolling down), three seat slats and two back
// slats in lit wood, bolt heads where they cross the frames.
function bench(cv, d){
  const x = Math.round(d.c * TS), gy = streetAt(x + 42), w = 84;
  paint(cv, x - 6, gy - 48, w + 12, 48, g => {
    for (const y of [gy - 45, gy - 36]){ R(g, x + 3, y, w - 6, 4, WD[3]); R(g, x + 3, y, w - 6, 1, WD[4]); R(g, x + 3, y + 3, w - 6, 1, WD[1]); R(g, x + 3, y + 4, w - 6, 1, WD[0]); }   // back slats
    for (const fx of [x + 5, x + w - 11]){
      R(g, fx + 2, gy - 46, 3, 22, CO[3]); dot(g, fx + 2, gy - 46, CO[5]); R(g, fx + 4, gy - 45, 1, 21, CO[1]);             // back post
      for (const y of [gy - 44, gy - 35]) dot(g, fx + 3, y, ST[5]);                                                          // bolts
      seg(g, fx, gy - 24, fx - 4, gy - 1, CO[4]); seg(g, fx + 1, gy - 24, fx - 3, gy - 1, CO[2]); seg(g, fx + 2, gy - 24, fx - 2, gy - 1, CO[1]);   // front leg
      seg(g, fx + 5, gy - 24, fx + 8, gy - 1, CO[3]); seg(g, fx + 6, gy - 24, fx + 9, gy - 1, CO[1]);                       // back leg
      R(g, fx - 6, gy - 1, 5, 1, CO[2]); R(g, fx + 7, gy - 1, 5, 1, CO[2]);                                                  // feet
      R(g, fx - 3, gy - 33, 11, 3, CO[3]); R(g, fx - 3, gy - 33, 11, 1, CO[5]); annulus(g, fx - 3, gy - 29, 1.5, 3.5, (dd, ux) => ux < 0.2 ? CO[3] : null); }   // armrest
    for (let k = 0; k < 4; k++){ const y = gy - 25 + k; R(g, x, y, w, 1, k === 0 ? WD[4] : k === 3 ? WD[1] : WD[3]); }   // seat (front edge of the slats)
    for (let i = 7; i < w; i += 21) dot(g, x + i, gy - 24, WD[2]);
    R(g, x + 1, gy - 21, w - 2, 1, CO[1]);
  });
}
// Zinc bucket of coal: tapered, rolled rim, two hoops, a heap of lumps proud of the rim, the wire bail lying back over it.
function bucket(cv, d){
  const x = Math.round(d.c * TS), gy = streetAt(x + 9), h = 17, w = 18;
  paint(cv, x - 3, gy - h - 8, w + 6, h + 8, g => {
    for (let j = 0; j < h; j++){ const ins = Math.round(j * 2 / (h - 1)), a = x + ins, b = x + w - ins;
      R(g, a, gy - h + j, b - a, 1, j === 6 || j === 12 ? ST[4] : ST[5]); dot(g, a, gy - h + j, ST[6]); dot(g, b - 1, gy - h + j, ST[2]); dot(g, b - 2, gy - h + j, ST[3]); }
    for (const j of [6, 12]) R(g, x + 3, gy - h + j + 1, w - 6, 1, ST[3]);
    R(g, x - 1, gy - h - 1, w + 2, 1, ST[7]); R(g, x - 1, gy - h, w + 2, 1, ST[3]); R(g, x + 2, gy - 1, w - 4, 1, ST[1]);
    for (let i = 0; i < w - 2; i++){ const hgt = 1 + Math.round(2 * Math.sin(Math.PI * i / (w - 2))); R(g, x + 1 + i, gy - h - 1 - hgt, 1, hgt, hash(i, 22) > 0.6 ? CO[5] : CO[3]); }
    for (const [i, j] of [[4, 3], [9, 4], [13, 3]]) dot(g, x + i, gy - h - j, CO[6]);
    seg(g, x - 1, gy - h, x + 3, gy - h - 6, ST[3]); seg(g, x + 3, gy - h - 6, x + 14, gy - h - 6, ST[3]); seg(g, x + 14, gy - h - 6, x + w, gy - h, ST[3]);
  });
}
// Coal sacks by the sorting plant: three jute sacks slumped on the ground (round shoulders under the tie, a belly that bulges into
// a flat foot with a sag crease over it, the right third and the underside of the belly a posterised step darker; the neck tied
// off, the gathered tuft over the tie leaning to one side, the folds the tie pulls into the cloth on the lit side, a few weave
// ticks, the pit mark K3 stencilled on one, a contact shadow), a few lumps of spilt coal, and a shovel leaning on the last one
// (its D grip, the haft, the socket and the spade seen edge-on, standing on its tip).
function sacks(cv, d){
  const x = Math.round(d.c * TS), gy = streetAt(x + 30);
  paint(cv, x - 8, gy - 66, 104, 66, g => {
    const sack = (sx, w, h, lean, mark) => {                                // w: width of the foot; lean: the neck's offset (px, + right)
      const top = gy - h, mid = v => sx + w / 2 + lean * (1 - v) * (1 - v), nx = Math.round(mid(0)), sagY = top + Math.round(h * 0.7);
      // the profile (half-width f of w / 2 down the sack, v = 0..1): the gathered neck, round shoulders (a quarter ellipse), the
      // belly bulging 6 % over the flat foot
      for (let j = 0; j < h; j++){ const v = j / (h - 1), y = top + j;
        const f = v < 0.5 ? Math.max(0.4, Math.sqrt(1 - (1 - v / 0.5) ** 2)) : v < 0.88 ? 1 + 0.06 * Math.sin(Math.PI * (v - 0.5) / 0.38) : 1;
        const a = Math.round(mid(v) - w / 2 * f), b = Math.round(mid(v) + w / 2 * f);
        R(g, a, y, b - a, 1, j < 4 ? BU[4] : j === h - 1 ? BU[1] : j >= h - 5 || j === sagY - top + 1 ? BU[2] : BU[3]);
        const rs = Math.round(a + (b - a) * 0.64); if (j < h - 5) R(g, rs, y, b - rs, 1, j < 4 ? BU[3] : BU[2]);          // the shadowed third
        dot(g, a, y, j < h - 2 ? BU[5] : BU[3]); if (j > 3 && j < h - 3) dot(g, a + 1, y, BU[4]);                       // lit left flank
        dot(g, b - 1, y, BU[1]); if (j > 1 && j < h - 1) dot(g, b - 2, y, BU[2]); }                                    // shadowed right flank
      const sa = Math.round(mid(0.7) - w * 0.3), sb = Math.round(mid(0.7) + w * 0.36);                              // the belly's sag crease
      R(g, sa, sagY - 1, sb - sa, 1, BU[4]); R(g, sa + 1, sagY, sb - sa - 1, 1, BU[1]); dot(g, sa, sagY, BU[2]);
      seg(g, nx - 3, top + 3, nx - 9, top + 14, BU[2]); seg(g, nx - 4, top + 3, nx - 10, top + 13, BU[5]);           // folds from the tie
      seg(g, nx + 2, top + 4, nx + 5, top + 12, BU[2]); seg(g, nx - 1, top + 4, nx - 3, top + 10, BU[2]);
      for (const [dx, dy] of [[-7, 18], [-4, 21], [-9, 23], [3, 19]]) R(g, nx + dx, top + dy, 3, 1, BU[4]);        // weave ticks
      R(g, sx - 2, gy - 1, w + 4, 1, BU[0]);                                                                         // contact shadow
      const e = Math.sign(lean) || 1;                     // the neck under the tie, the gathered tuft over it flaring and leaning with the neck
      R(g, nx - 3, top - 3, 6, 3, BU[3]); dot(g, nx - 3, top - 3, BU[4]); R(g, nx - 4, top - 4, 8, 1, BU[1]); dot(g, nx + 3, top - 2, BU[2]);
      for (const [j, l, n] of [[5, -3, 6], [6, -4 + e, 8], [7, -4 + 2 * e, 8], [8, -3 + 2 * e, 6], [9, -2 + 3 * e, 3]]){
        R(g, nx + l, top - j, n, 1, BU[3]); dot(g, nx + l, top - j, BU[5]); dot(g, nx + l + n - 1, top - j, BU[2]); }
      if (mark) txt(g, 'K3', nx - 4, top + 15, BU[1], PIX); };
    sack(x, 30, 33, -3, false); sack(x + 26, 32, 37, 3, true); sack(x + 54, 27, 29, 2, false);
    for (const [dx, k] of [[-6, 3], [24, 1], [53, 2], [84, 1]]){ R(g, x + dx, gy - 3, k + 2, 3, CO[2]); dot(g, x + dx, gy - 3, CO[4]); dot(g, x + dx + k + 1, gy - 1, CO[1]); }   // spilt coal
    const sx = x + 76;                                                                              // shovel: the haft (lit left)
    seg(g, sx + 1, gy - 15, sx - 9, gy - 56, WD[3]); seg(g, sx + 2, gy - 15, sx - 8, gy - 56, WD[2]); seg(g, sx + 3, gy - 15, sx - 7, gy - 56, WD[1]);
    seg(g, sx - 9, gy - 57, sx - 13, gy - 62, WD[3]); seg(g, sx - 8, gy - 57, sx - 12, gy - 62, WD[1]);              // the D grip: two cheeks
    seg(g, sx - 7, gy - 57, sx - 4, gy - 62, WD[2]); seg(g, sx - 6, gy - 57, sx - 3, gy - 62, WD[1]);              // round a hole,
    R(g, sx - 14, gy - 65, 12, 3, WD[3]); R(g, sx - 14, gy - 65, 12, 1, WD[4]); R(g, sx - 14, gy - 63, 12, 1, WD[1]); dot(g, sx - 3, gy - 64, WD[2]);   // the grip
    R(g, sx, gy - 17, 4, 6, ST[3]); R(g, sx, gy - 17, 1, 6, ST[5]); R(g, sx + 3, gy - 16, 1, 5, ST[1]); R(g, sx, gy - 15, 4, 1, ST[2]);   // the socket, a rivet band
    for (let j = 0; j < 11; j++){ const th = 3 - (j * 3 / 11 | 0), bx0 = sx + 1 + Math.round(j * 0.3), y = gy - 11 + j;    // the spade edge-on: 3 px thick
      R(g, bx0, y, th, 1, ST[4]); dot(g, bx0, y, ST[6]); if (th > 1) dot(g, bx0 + th - 1, y, ST[2]); }                   // at the socket, 1 at the tip
    R(g, sx + 2, gy - 8, 1, 3, RU[2]); dot(g, sx + 3, gy - 6, RU[1]);                                                     // rust on its back
  });
}
const DECOR_PAINT = { poster, bike: bicycle, bench, bucket, sacks };
// A story prop of map ENT.models: the owner's model sprite (art/models.js: the drums, the parked car) standing on the street at
// column d.c, or with d.rail on a short track under it (whole tiles, a tile past each end), its anchor on the rail head like the
// hunts' wheels. Without the atlas there is nothing to draw: they are decor only.
function modelProp(cv, d){
  const s = MD.get(d.sprite); if (!s) return;
  const x = Math.round(d.c * TS), gy = streetAt(x);
  if (d.rail) rails(cv, Math.floor((x - s.ax - TS / 2) / TS), Math.floor((x - s.ax + s.w + TS / 2) / TS));
  MD.draw(cv, d.sprite, x, gy - (d.rail ? 4 : 0));
}

// D: steam nozzle: a capped pipe stub out of the ground, a flange, the dark bore; fx puffs steam from anchors().vents
function nozzle(cv, a){
  const { x, y } = a;
  paint(cv, x - 9, y - 1, 19, NGY - y + 1, g => {
    R(g, x - 4, y + 6, 9, NGY - y - 6, ST[3]); R(g, x - 4, y + 6, 1, NGY - y - 6, ST[5]); R(g, x + 3, y + 6, 1, NGY - y - 6, ST[2]); R(g, x + 4, y + 6, 1, NGY - y - 6, ST[1]);
    R(g, x - 6, NGY - 9, 13, 3, ST[4]); R(g, x - 6, NGY - 9, 13, 1, ST[5]); dot(g, x - 4, NGY - 8, ST[6]); dot(g, x + 4, NGY - 8, ST[6]);   // flange
    R(g, x - 7, y, 15, 6, ST[4]); R(g, x - 7, y, 15, 1, ST[6]); R(g, x - 7, y + 1, 1, 5, ST[5]); R(g, x - 7, y + 5, 15, 1, ST[2]); R(g, x + 7, y + 1, 1, 5, ST[1]);
    R(g, x - 3, y, 6, 1, ST[0]); R(g, x - 2, y + 1, 4, 1, ST[1]); R(g, x - 1, y + 7, 2, 3, RU[2]); dot(g, x, y + 10, RU[1]);   // dark bore, a rust run
  });
}

props.drawBack = g => {
  if (!HFM) backStrut(g);                             // E: the fallback headframe's back strut, raking down behind the engine house
  engineHouse(g);                                     // E: the engine house
  if (HFM){ MD.drawHeadframe(g, 'play', SHAFT_X, NGY); hoist(g); }   // E: the owner's headframe over the shaft (sheaves: drawDynamic)
  else headframe(g);                                  //    or the procedural one
  guardTower(g);                                      // B: guard tower with the searchlight (fx draws the beam from its lens)
  for (const px of E.pylons) pylon(g, px);            // B: cable-car pylons in the two loading stations
  sandbags(g);                                        // B: sandbag nest at the colony checkpoint
  for (const cl of E.chimneys) chimney(g, cl);        // C: roof chimneys
};
props.drawFront = g => {
  rails(g);                                           // B: track on the open ground
  fence(g);                                           // A: the Sperrzone fence
  for (const k of E.kotwica) graffiti(g, k);          // C / D: Polska Walcząca anchors
  banner(g);                                          // C: torn regime banner on the second familok
  for (const d of DECOR) DECOR_PAINT[d.kind](g, d);   // C / D: story decor
  for (const d of E.models) modelProp(g, d);          // B / D / E: story props from the owner's models (drums, the parked car)
  for (const cl of E.lamps) lamp(g, cl);              // sodium lamp posts (the glow is fx, centred on anchors().lamps)
  for (const s of E.signs) sign(g, s);                // German signs, over the lamps' feet
  for (const a of anchors().vents) nozzle(g, a);      // D: steam nozzles
};

// ---------- anchors for fx, the API's geometry ----------
// The geometry comes from the painters above (lampGlass, towerGeo, chimTop, the nozzle's bore 12 px over the ground).
let ANCH = null;
function anchors(){
  return ANCH || (ANCH = {
    lamps: E.lamps.map(lampGlass),
    searchlights: [towerGeo().lens],
    vents: E.vents.map(vt => ({ x: vt.c * TS + TS / 2, y: NGY - 12, phase: vt.phase })),
    chimneys: E.chimneys.map(chimTop)
  });
}
props.anchors = anchors;
props.signs = () => E.signs.map(s => { const b = signBox(s); return { text: s.text, x: b.x, y: b.y, w: b.w, h: SIGN_H, street: b.base }; });
props.headframe = () => { if (HFM) return { x: HFM.x, x1: HFM.x1, top: HFM.top }; const h = hfGeo(); return { x: h.x, x1: h.x + h.w, top: h.top }; };

// ---------- movers ----------
// Each sprite is painted around the mover's top-left (ox, oy inside its own canvas; y = 0 is the surface you stand on) and gets the
// 1 px OUTLINE; a '...Front' sprite (drawn after the hero) shares the frame. { c, ox, oy } = canvas, its top-left from the mover's.
function moverSprite(w, h, ox, oy, paintFn, part, withOutline = true){
  const b = buf(-ox, -oy, w, h), [c, g] = mk(w, h); paintFn(b, 0, 0, part); b.blit(g, 0, 0);
  let f = c; if (withOutline) f = outline(c, OUTLINE); else { const [e, eg] = mk(w + 2, h + 2); eg.drawImage(c, 1, 1); f = e; }
  return { c: f, ox: -ox - 1, oy: -oy - 1 };
}
// Hunt (mine car), w x h (SCALE.cart) with the wheels standing on the rails at y + h: a riveted rust tub tapering toward its floor,
// a rolled steel rim (the surface the hero stands on is its top edge, y = 0), a coal heap a few px proud of the rim, the frame, two
// wheels and the couplings. The playfield carts are the owner's 3D car as sprites (art/models.js, map ENT's mover sprite); this is
// the clean fallback at the same size. Light from the upper left: the upper wall, facing the sky, in rust[3], the wall under the
// stiffening hoop in rust[2] with grime toward the floor; stiffening ribs, rivets with rust runs, the stencilled pit mark and car
// number on the lower wall. The shunting cart passes right behind the hero on the B street: its light upper half keeps him
// readable against it (VALUE rule in style.js).
function paintCart(w, h){
  return (g, x, y) => {
    const body = h - 18, hoop = 19;
    for (let j = 0; j < body; j++){ const ins = Math.floor(j * 6 / body), u = j < hoop;
      R(g, x + ins, y + j, w - 2 * ins, 1, u ? RU[3] : RU[2]); R(g, x + ins, y + j, 1, 1, u ? RU[4] : RU[3]); R(g, x + w - 1 - ins, y + j, 1, 1, u ? RU[2] : RU[1]); }
    for (let i = 6; i < w - 6; i++){ const d = 1 + (hash(i >> 2, 47) * 3 | 0); R(g, x + i, y + body - 1 - d, 1, d, RU[1]); }   // grime toward the floor
    for (const rx of [21, 45, 63, 87]) if (rx < w - 8){ R(g, x + rx, y + 6, 1, hoop - 6, RU[4]); R(g, x + rx + 1, y + 6, 1, hoop - 6, RU[2]);   // ribs
      R(g, x + rx, y + hoop + 3, 1, body - hoop - 5, RU[3]); R(g, x + rx + 1, y + hoop + 3, 1, body - hoop - 5, RU[1]); }
    const hi = Math.floor(hoop * 6 / body);                                                                // the hoop: lit top, shadow under
    R(g, x + hi, y + hoop, w - 2 * hi, 2, RU[4]); R(g, x + hi, y + hoop, w - 2 * hi, 1, RU[5]); R(g, x + hi, y + hoop + 2, w - 2 * hi, 1, RU[1]);
    for (let i = 6; i < w - 4; i += 9){ R(g, x + i, y + 7, 1, 1, ST[6]); R(g, x + i, y + 8, 1, 1, RU[1]); }       // rivets under the rim
    for (let i = 0; i < 6; i++){ const sx = x + 8 + (hash(i, 41) * (w - 16) | 0), L = 4 + (hash(i, 43) * 9 | 0); R(g, sx, y + 9, 1, L, RU[2]); }   // rust runs
    txt(g, 'K3', x + w - 30, y + hoop + 6, PA[1], PIX); txt(g, '17', x + 12, y + hoop + 6, PA[1], PIX);           // stencilled pit mark + car number
    for (let i = 0; i < w - 12; i++){ const hgt = Math.round(4 * Math.sin(Math.PI * i / (w - 12)) + hash(i >> 1, 5) * 1.5);   // coal heap proud of the rim
      if (hgt > 0) R(g, x + 6 + i, y - hgt, 1, hgt, hash(i >> 1, 6) > 0.7 ? CO[4] : CO[2]); }
    for (let i = 0; i < 12; i++){ const lx = x + 12 + (hash(i, 7) * (w - 26) | 0); R(g, lx, y - 3 + (hash(i, 8) * 2 | 0), 2, 1, CO[5]); }
    R(g, x - 1, y, w + 2, 1, ST[6]); R(g, x - 1, y + 1, w + 2, 1, ST[4]); R(g, x, y + 2, w, 1, ST[2]);           // rolled rim (lit top), its shadow
    R(g, x + 4, y + body, w - 8, 4, ST[3]); R(g, x + 4, y + body, w - 8, 1, ST[4]); R(g, x + 4, y + body + 3, w - 8, 1, ST[1]);   // frame
    for (const end of [-1, 1]){ const cx = end < 0 ? x - 6 : x + w; R(g, cx, y + body - 3, 6, 5, ST[3]); R(g, cx, y + body - 3, 6, 1, ST[5]); R(g, cx, y + body + 1, 6, 1, ST[1]); }   // couplings
    for (const wx of [x + 22, x + w - 23]){ const cy = y + h - 9;                                         // wheels: r 9 on the rail
      disc(g, wx, cy, 9, ST[2]); g.fillStyle = ST[4]; S.circle(g, wx, cy, 8);
      annulus(g, wx, cy, 6.5, 8.5, (d, ux, uy) => facing(ux, uy) > 0.6 ? ST[6] : null);
      for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) R(g, wx + dx - 1, cy + dy - 1, 2, 2, ST[1]);       // lightening holes
      R(g, wx - 2, cy - 2, 5, 5, ST[3]); dot(g, wx - 2, cy - 2, ST[6]); dot(g, wx + 2, cy + 2, ST[1]);
      R(g, wx - 5, y + body - 1, 11, 5, ST[3]); R(g, wx - 5, y + body - 1, 11, 1, ST[5]); R(g, wx + 5, y + body, 1, 4, ST[1]); }   // axle box
  };
}
// Cable-car bucket (Seilbahnkübel), 84 px wide: the hero stands INSIDE the tub. A yoke carries it: a trolley rolling on the rope,
// a crossbar above head height (its underside is the mover's ceil: heads bump on it) and two arms down to lugs at the rim ends
// (90 px apart, clear of the 40-60 px hero sprite, so no rod runs through him). The front wall, 15 px higher than the floor he
// stands on, is drawn again in front of him: his boots sit in the tub.
function paintBucket(ropeY, ceil){        // ropeY: y of the cable relative to the bucket's floor (negative); ceil: map ENT yoke
  return (g, x, y, part) => {
    // the tub's outer front wall, a trapezoid from the rolled lip (y - 15) to the bottom (y + 33), 9 px in at each side there: three
    // plates welded together (bead seams), two stiffening ribs, its number stencilled in faded, flaking paint, the rivet row under
    // the lip with rust running from it, coal grime caked up from the bottom in a ragged posterised band; the lip lit from above,
    // dented in two places (its highlight pushed down, rust in the dent) and scraped bright in a few; lit left flank, dark right one
    const front = () => {
      const a = j => x - 2 + Math.round(j * 9 / 48), b = j => x + 86 - Math.round(j * 9 / 48);   // the wall's ends j rows under the lip
      g.fillStyle = ST[4]; poly(g, [x - 2, y - 15, x + 86, y - 15, x + 77, y + 33, x + 7, y + 33]);
      for (const u of [0.34, 0.67]) for (let j = 3; j < 47; j++) dot(g, Math.round(a(j) + (b(j) - a(j)) * u), y - 15 + j, j & 1 ? ST[3] : ST[5]);   // weld seams
      for (const ry of [-3, 15]){ const j = ry + 15; R(g, a(j), y + ry, b(j) - a(j), 1, ST[5]); R(g, a(j), y + ry + 1, b(j) - a(j), 1, ST[2]); }   // ribs
      const flake = { set fillStyle(v){ g.fillStyle = v; }, fillRect(x0, y0, w0, h0){                                     // the number,
        for (let j = 0; j < h0; j++) for (let i = 0; i < w0; i++) if (hash(x0 + i, y0 + j + 5) < 0.8) g.fillRect(x0 + i, y0 + j, 1, 1); } };   // paint flaked off
      stencil(flake, 'NR.12', x + 20, y - 1, PA[1]);
      for (let i = x + 7; i < x + 78; i++){ const t = y + 21 + (hash(i >> 1, 31) * 4 | 0); R(g, i, t, 1, y + 32 - t, ST[3]); if (hash(i, 32) > 0.8) dot(g, i, t, CO[5]); }   // grime
      for (let i = 0; i < 7; i++){ const rx = x + 6 + i * 12; R(g, rx, y - 10, 1, 1, ST[7]); R(g, rx, y - 9, 1, 1, ST[1]);   // rivets + rust runs
        if (hash(i, 7) > 0.35){ const L = 4 + (hash(i, 9) * 16 | 0); R(g, rx, y - 8, 1, L, RU[1]); R(g, rx, y - 8, 1, Math.max(1, L >> 2), RU[2]); } }
      R(g, x - 2, y - 15, 88, 1, ST[7]); R(g, x - 2, y - 14, 88, 1, ST[6]); R(g, x - 1, y - 13, 86, 1, ST[3]);   // rolled lip, lit from above,
      for (const [dx, n] of [[19, 5], [61, 4]]){ R(g, x + dx, y - 15, n, 1, ST[5]); R(g, x + dx + 1, y - 14, n - 2, 1, ST[7]); R(g, x + dx + 1, y - 13, n - 2, 1, RU[2]); dot(g, x + dx + 2, y - 12, RU[1]); }   // dents,
      for (const dx of [8, 43, 74]) R(g, x + dx, y - 14, 2, 1, ST[7]);                                                         // scrapes
      g.fillStyle = ST[6]; for (let j = 0; j < 48; j++) g.fillRect(a(j), y - 15 + j, 1, 1);                                 // lit left flank
      g.fillStyle = ST[1]; for (let j = 0; j < 48; j++) g.fillRect(b(j) - 2, y - 15 + j, 2, 1);                             // shadow flank
      R(g, x + 7, y + 32, 70, 1, ST[1]);
    };
    if (part === 'front'){ front(); return; }
    const cb = y + ceil.y - 6;              // top of the yoke's crossbar (its underside is the mover's ceil in map.js: heads bump on it)
    // trolley on the rope: side plate, two wheels riding on top of the cable, the clamp gripping it, the hanger down to the crossbar
    R(g, x + 24, y + ropeY - 11, 37, 6, ST[4]); R(g, x + 24, y + ropeY - 11, 37, 1, ST[6]); R(g, x + 24, y + ropeY - 6, 37, 1, ST[2]);
    for (const wx of [x + 31, x + 53]){ disc(g, wx, y + ropeY - 5, 4, ST[2]); annulus(g, wx, y + ropeY - 5, 2.5, 4.5, (d, ux, uy) => facing(ux, uy) > 0.4 ? ST[5] : null); dot(g, wx, y + ropeY - 5, ST[6]); }
    R(g, x + 40, y + ropeY - 2, 5, 5, ST[3]); dot(g, x + 40, y + ropeY - 2, ST[5]);
    R(g, x + 40, y + ropeY + 3, 5, cb - (y + ropeY + 3), ST[3]); R(g, x + 40, y + ropeY + 3, 1, cb - (y + ropeY + 3), ST[5]); R(g, x + 44, y + ropeY + 3, 1, cb - (y + ropeY + 3), ST[1]);
    // yoke: crossbar above his head, arms down to the lugs at the rim ends
    R(g, x - 5, cb, 95, 6, ST[4]); R(g, x - 5, cb, 95, 1, ST[6]); R(g, x - 5, cb + 5, 95, 1, ST[2]); for (let i = x; i < x + 88; i += 12) dot(g, i, cb + 2, ST[6]);
    for (const ax of [x - 5, x + 85]){ const L = y - 18 - cb - 6;
      R(g, ax, cb + 6, 5, L, ST[4]); R(g, ax, cb + 6, 1, L, ST[6]); R(g, ax + 4, cb + 6, 1, L, ST[2]);
      R(g, ax - 2, y - 19, 9, 9, ST[5]); R(g, ax - 2, y - 19, 9, 1, ST[6]); dot(g, ax + 2, y - 15, ST[7]); dot(g, ax + 3, y - 14, ST[1]); R(g, ax + 6, y - 18, 1, 8, ST[2]); }
    // the inside of the back wall, seen over the front lip (the view looks very slightly down), then the front wall
    g.fillStyle = ST[6]; poly(g, [x + 1, y - 21, x + 83, y - 21, x + 84, y - 18, x, y - 18]);
    R(g, x, y - 18, 84, 3, RU[1]); R(g, x + 12, y - 18, 21, 1, RU[0]); R(g, x + 52, y - 17, 12, 1, RU[2]);
    front();
  };
}
// Förderkorb (shaft cage), 240 px wide = the 5-tile shaft, 147 px of headroom (the hero is 96). The frame is riveted channel iron
// (CHANNEL: a lit flange edge, the web recessed in shadow under it, the other flange's lit inner face, a 1 px dark edge): the top
// beam, the floor beam the hero stands on and the two corner posts, with triangular gusset plates riveted into the four corners.
// Behind him the sheet-steel back plate stays calm and at steel[4] (the VALUE rule in style.js): sheets between a stiffener over
// his head and a scuffed kick plate (worn brighter by boots, a few dents and paint chips, a band of coal grime settled along the
// floor); above his head the shadow under the top beam and ventilation slots. In front of him (drawn again after him) the bars
// with the enamelled plate KORB 1 riveted on them over his head, the waist rail, the posts and gussets, the gate's two hinges on
// the left post and its latch on the right one. On top: two lugs, the bridle chains from them up to a shackle, the shackle's pin
// through the triangular hanger plate, and the two rope sockets (capels) the hoist ropes end in (CAGE_HANG: their tops, where
// drawDynamic ties the ropes on).
const CAGE_TOP = -156, CAGE_HANG = -252;
// A channel's cross-section, outer flange edge first: steel ramp steps (top beam and floor beam top to bottom, posts left to right)
const CHANNEL = { beam: [7, 6, 5, 1, 2, 3, 3, 5, 4, 1], floor: [7, 6, 5, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 4, 3, 1], post: [7, 6, 5, 1, 2, 3, 3, 5, 1] };
// A chain from (x0, y0) to (x1, y1): links 5 px long, alternately seen flat (two rails round a hole: the upper one lit, the lower
// one in shadow) and edge-on (a single bar)
function chain(g, x0, y0, x1, y1){
  const L = Math.hypot(x1 - x0, y1 - y0), N = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))), steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  const ox = steep ? 1 : 0, oy = steep ? 0 : 1;
  for (let i = 0; i <= N; i++){ const x = Math.round(x0 + (x1 - x0) * i / N), y = Math.round(y0 + (y1 - y0) * i / N), q = i * L / N % 10;
    if (q < 5){ if (q < 1 || q >= 4) dot(g, x, y, ST[4]); else { dot(g, x - ox, y - oy, ST[6]); dot(g, x + ox, y + oy, ST[2]); } }
    else { dot(g, x, y, ST[5]); if (q >= 6 && q < 9) dot(g, x + ox, y + oy, ST[1]); } }
}
function paintCage(w){
  return (g, x, y, part) => {
    const T0 = y + CAGE_TOP, inH = -CAGE_TOP - 9, cx = x + w / 2, rivet = (rx, ry) => { dot(g, rx, ry, ST[7]); dot(g, rx + 1, ry + 1, ST[1]); };
    const rows = (y0, x0, x1, steps) => steps.forEach((k, j) => R(g, x0, y0 + j, x1 - x0, 1, ST[k]));
    const cols = (x0, y0, y1, steps) => steps.forEach((k, i) => R(g, x0 + i, y0, 1, y1 - y0, ST[k]));
    // a triangular gusset plate in a corner (its two legs along the members, n px long; sx, sy: the directions they run in), its free
    // edge shaded by the way it faces, a 1 px dark contour past it
    const gusset = (gx, gy, sx, sy, n, body) => { for (let j = 0; j < n; j++){ const len = n - j;
        for (let i = 0; i < len; i++) dot(g, gx + sx * i, gy + sy * j, i === len - 1 ? shade3(facing(sx, sy), ST[6], ST[4], ST[2]) : body);
        dot(g, gx + sx * len, gy + sy * j, ST[1]); }
      for (const [i, j] of [[3, 3], [8, 3], [3, 8]]) rivet(gx + sx * i - (sx < 0), gy + sy * j - (sy < 0)); };
    const frontParts = () => {
      for (let bx = 27; bx < w - 18; bx += 30) cols(x + bx, T0 + 9, y, [7, 6, 5, 2]);                                         // bars
      rows(y - 72, x + 8, x + w - 8, [7, 6, 4, 2]); for (let bx = 28; bx < w - 18; bx += 30) rivet(x + bx, y - 71);         // waist rail
      rows(T0, x, x + w, CHANNEL.beam); for (let i = 15; i < w - 9; i += 18) rivet(x + i, T0 + 5);                           // top beam
      for (const px of [0, w - 9]){ cols(x + px, T0, y + 18, CHANNEL.post); for (let ry = T0 + 14; ry < y + 12; ry += 21) rivet(x + px + 4, ry); }   // posts
      gusset(x + 9, T0 + 10, 1, 1, 15, ST[5]); gusset(x + w - 10, T0 + 10, -1, 1, 15, ST[5]); gusset(x + 9, y - 1, 1, -1, 12, ST[3]); gusset(x + w - 10, y - 1, -1, -1, 12, ST[3]);
      for (const hy of [T0 + 30, y - 40]){ R(g, x + 9, hy, 4, 7, ST[4]); R(g, x + 9, hy, 4, 1, ST[6]); R(g, x + 12, hy + 1, 1, 6, ST[2]); dot(g, x + 10, hy + 3, ST[7]); }   // hinges
      R(g, x + w - 21, y - 66, 12, 3, ST[5]); R(g, x + w - 21, y - 66, 12, 1, ST[7]); R(g, x + w - 21, y - 64, 12, 1, ST[2]);   // latch bar,
      R(g, x + w - 24, y - 68, 4, 7, ST[4]); dot(g, x + w - 24, y - 68, ST[6]); R(g, x + w - 21, y - 61, 2, 5, ST[3]); dot(g, x + w - 21, y - 61, ST[5]);   // its keeper, the handle
      const px = cx - 18, py = T0 + 13;                                                                                       // the plate KORB 1,
      R(g, px, py, 36, 11, ST[2]); R(g, px + 1, py + 1, 34, 9, PA[2]); R(g, px + 1, py + 1, 34, 1, PA[3]); R(g, px + 1, py + 9, 34, 1, PA[1]);   // riveted on
      txt(g, 'KORB 1', px + 5, py + 2, PA[0], PIX); rivet(px + 2, py + 4); rivet(px + 32, py + 4); R(g, px + 31, py + 8, 3, 1, ST[3]); dot(g, px + 1, py + 1, ST[3]);   // the bars
    };
    if (part === 'front'){ frontParts(); return; }
    // the hanger: chains from the lugs up to the shackle, its pin through the hanger plate, the rope sockets on the plate
    const H = y + CAGE_HANG;
    for (const lx of [x + 36, x + w - 37]){ R(g, lx - 3, T0 - 8, 7, 8, ST[4]); R(g, lx - 3, T0 - 8, 1, 8, ST[6]); R(g, lx + 3, T0 - 7, 1, 7, ST[2]); R(g, lx - 3, T0 - 8, 7, 1, ST[5]);
      R(g, lx - 1, T0 - 6, 2, 2, ST[0]); chain(g, lx, T0 - 6, cx + (lx < cx ? -2 : 1), H + 37); }
    for (let j = 0; j < 17; j++){ const hw = Math.max(3, Math.round(16 - j)), yy = H + 12 + j;                                 // hanger plate
      R(g, cx - hw, yy, 2 * hw, 1, j === 0 ? ST[6] : ST[4]); dot(g, cx - hw, yy, ST[6]); dot(g, cx + hw - 1, yy, ST[1]); }
    for (const sx of [-1, 1]){ const lx = cx + sx * 9;                                                                         // rope sockets
      for (let j = 0; j < 12; j++){ const hw = 2 + (j > 5 ? 1 : 0); R(g, lx - hw, H + j, 2 * hw, 1, j === 2 || j === 3 ? ST[5] : ST[4]); dot(g, lx - hw, H + j, ST[6]); dot(g, lx + hw - 1, H + j, ST[2]); }
      R(g, lx - 3, H + 12, 6, 6, ST[4]); R(g, lx - 3, H + 12, 1, 6, ST[6]); R(g, lx + 2, H + 12, 1, 6, ST[2]); rivet(lx - 1, H + 14); }
    R(g, cx - 5, H + 24, 11, 2, ST[5]); R(g, cx - 5, H + 24, 11, 1, ST[6]); rivet(cx, H + 24);                                    // shackle pin, its bow
    for (const sx of [-4, 3]){ R(g, cx + sx, H + 26, 2, 7, ST[4]); dot(g, cx + sx, H + 26, ST[6]); }
    annulus(g, cx + 0.5, H + 32, 2.5, 4.5, (d, ux, uy) => uy > 0.1 ? (ux < -0.3 ? ST[6] : ux > 0.3 ? ST[2] : ST[4]) : null);
    // back plate: steel[4] sheets (joints every 60 px), the stiffener over his head; above it the top beam's shadow and the slots;
    // below him the kick plate (scuffs, dents, chips, its rivet row) and the grime along the floor, posterised
    R(g, x + 9, T0 + 10, w - 18, inH - 1, ST[4]); rows(T0 + 10, x + 9, x + w - 9, [1, 2, 2, 3, 3, 3]);
    for (let i = x + 69; i < x + w - 30; i += 60){ R(g, i, T0 + 16, 1, y - T0 - 34, ST[3]); R(g, i + 1, T0 + 16, 1, y - T0 - 34, ST[5]); }   // sheet joints
    rows(y - 118, x + 9, x + w - 9, [6, 5, 5, 2]); for (let i = x + 15; i < x + w - 12; i += 15) rivet(i, y - 117);          // stiffener
    for (let i = x + 17; i < x + w - 20; i += 15) if (Math.abs(i + 4 - cx) > 26){ R(g, i, T0 + 22, 9, 2, ST[1]); R(g, i, T0 + 24, 9, 1, ST[5]); }   // slots
    rows(y - 18, x + 9, x + w - 9, [6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]); for (let i = x + 16; i < x + w - 12; i += 16) rivet(i, y - 16);   // kick plate
    for (const [sx, sy, l] of [[31, -11, 7], [88, -8, 5], [140, -12, 9], [197, -7, 6]]) R(g, x + sx, y + sy, l, 1, ST[6]);   // boot scuffs
    for (const [dx, dy] of [[58, -12], [118, -9], [176, -13]]){ R(g, x + dx, y + dy, 3, 1, ST[3]); dot(g, x + dx, y + dy + 1, ST[3]); R(g, x + dx + 1, y + dy + 2, 3, 1, ST[6]); }   // dents
    for (const [dx, dy] of [[45, -6], [151, -5], [212, -9]]){ R(g, x + dx, y + dy, 2, 1, RU[2]); dot(g, x + dx, y + dy + 1, RU[1]); }          // chips
    for (let i = x + 9; i < x + w - 9; i++){ const d = 2 + (hash(i >> 2, 71) * 3 | 0); R(g, i, y - d, 1, d, ST[3]); if (d > 3 && hash(i, 72) > 0.7) dot(g, i, y - d, CO[4]); }   // grime
    // floor beam, the surface he stands on
    rows(y, x, x + w, CHANNEL.floor); for (let i = 9; i < w; i += 15) rivet(x + i, y + 8);
    frontParts();
  };
}
props.build = function(){
  for (const m of E.movers){
    if (SPR[m.kind]) continue;
    if (m.kind === 'cart') SPR.cart = moverSprite(m.w + 16, m.h + 8, 8, 7, paintCart(m.w, m.h), 'all');      // canvas: coal heap -7 .. wheels h
    else if (m.kind === 'bucket'){ const ropeY = E.cable.y - m.y, paintB = paintBucket(ropeY, m.ceil), top = -ropeY + 12;   // canvas: rope - 12 .. +34
      SPR.bucket = moverSprite(m.w + 16, top + 35, 7, top, paintB, 'all'); SPR.bucketFront = moverSprite(m.w + 16, top + 35, 7, top, paintB, 'front'); }
    else if (m.kind === 'cage'){ const paintC = paintCage(m.w), top = -CAGE_HANG;
      SPR.cage = moverSprite(m.w, top + 19, 0, top, paintC, 'all'); SPR.cageFront = moverSprite(m.w, top + 19, 0, top, paintC, 'front', false); }
  }
  const geo = MD.headframeGeo('play', SHAFT_X, NGY);                                           // the model headframe, if its atlas loaded
  HFM = geo && Object.assign(geo, { wheels: geo.sheaves.map((w, i) => ropeIn(Object.assign({}, w), i)) });
  const r = HFM ? HFM.wheels[0].r : hfGeo().r; SPR.groove = [];                                  // the groove's pixels for the rope
  if (!HFM) SPR.sheave = sheaveSprite(r);                                                         // + the fallback's sheave
  for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++){ const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (d > r - 2.5 && d <= r + 0.5) SPR.groove.push({ dx, dy, a, col: d > r - 0.5 ? (Math.round(a * 60) % 3 ? CO[2] : CO[4]) : CO[1] }); }
  SPR.groove.sort((p, q) => p.col < q.col ? -1 : p.col > q.col ? 1 : 0);                        // grouped by colour (grooveArc)
};
function drawSprite(ctx, s, m, v){
  const x = Math.round(m.x) - v.cx; if (!s || x > S.VW + m.w || x + 2 * m.w < 0) return;
  ctx.drawImage(s.c, x + s.ox, Math.round(m.y) - v.cy + s.oy);
}
// the hunts are the owner's car (art/models.js: map ENT's m.sprite, its rim on the mover's deck) when the atlas loaded, else painted
props.drawMover = (ctx, m, v) => m.kind === 'cart' && MD.get(m.sprite) ? MD.drawCart(ctx, m.sprite, m, v) : drawSprite(ctx, SPR[m.kind], m, v);
props.drawMoverFront = (ctx, m, v) => drawSprite(ctx, SPR[m.kind + 'Front'], m, v);
// Sheaves and hoist ropes: each rope comes from the engine house to the top right of its wheel, wraps over the top (the
// counter-clockwise way on screen) and leaves the wheel's left side for the cage hanger, so both wheels turn the same way by the
// rope's travel (cage.y / r). The model's wheels are its sprite's turn frames (models.drawSheaves); the fallback's are the sheave
// sprite over 8 spokes, 1 px members turning with the wheel, their lowest rows hidden in the deck slot (clip). The rope lies in
// the groove from where it arrives to where it leaves; the departure tangent follows the cage, so rope and wheel never part. The
// rope in the groove is painted into a small canvas per wheel (ARC) only when its departure angle changes (while the cage moves),
// then drawn with one drawImage. The model headframe's warning lamp blinks on its column.
const TAU = 2 * Math.PI, modT = a => (a % TAU + TAU) % TAU, ARC = [];
function grooveArc(i, w, dep){
  const A = ARC[i] || (ARC[i] = (([c, g]) => ({ c, g, a: null }))(mk(2 * w.r + 3, 2 * w.r + 3)));
  if (A.a !== dep.a){ const span = modT(w.arr.a - dep.a), o = w.r + 1; A.a = dep.a; A.g.clearRect(0, 0, A.c.width, A.c.height);
    let last = null; for (const p of SPR.groove) if (modT(w.arr.a - p.a) <= span){ if (p.col !== last) A.g.fillStyle = last = p.col; A.g.fillRect(o + p.dx, o + p.dy, 1, 1); } }
  return A.c;
}
props.drawDynamic = function(ctx, v, cage){
  const h = HFM || hfGeo(), right = HFM ? HFM.x1 : h.tr;
  if (h.x - 120 - v.cx < S.VW && right + 120 - v.cx > 0){
    const hx = cage.x + cage.w / 2, hy = Math.round(cage.y) + CAGE_HANG, ang = h.wheels.map((w, i) => -cage.y / w.r + i * 0.4);
    if (HFM) MD.drawSheaves(ctx, 'play', SHAFT_X - v.cx, NGY - v.cy, ang);
    h.wheels.forEach((w, i) => {
      const sx = w.x - v.cx, sy = w.y - v.cy, dx = i ? 9 : -9, dep = tangent(w.x, w.y, w.r - 1, hx + dx, hy, 1);
      if (!HFM){ ctx.save(); ctx.beginPath(); ctx.rect(sx - w.r - 2, sy - w.r - 2, 2 * w.r + 5, h.deck - w.y + w.r + 2); ctx.clip();
        for (let k = 0; k < 8; k++){ const a = ang[i] + k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
          seg(ctx, sx + c * 8, sy + s * 8, sx + c * (w.r - 5), sy + s * (w.r - 5), ST[5]); }
        ctx.drawImage(SPR.sheave, sx - w.r - 1, sy - w.r - 1); ctx.restore(); }
      ctx.drawImage(grooveArc(i, w, dep), sx - w.r - 1, sy - w.r - 1);
      rope(ctx, dep.x - v.cx, dep.y - v.cy, Math.round(hx) + dx - v.cx, hy - v.cy);
    });
    if (HFM) MD.drawLamp(ctx, 'play', SHAFT_X - v.cx, NGY - v.cy, ((v.t + SHAFT_X) >> 5) & 1);
  }
  // cable-car rope: the strand lay keyed to world x (it does not swim when the camera moves), its shadow side under it
  const x0 = Math.max(E.cable.x0, v.cx - 2), x1 = Math.min(E.cable.x1, v.cx + S.VW + 2), y = E.cable.y - v.cy;
  if (x1 > x0){ R(ctx, x0 - v.cx, y + 1, x1 - x0, 1, CO[1]); R(ctx, x0 - v.cx, y, x1 - x0, 1, CO[2]);
    ctx.fillStyle = CO[4]; for (let x = x0 + ((3 - x0 % 3) % 3); x < x1; x += 3) ctx.fillRect(x - v.cx, y, 1, 1); }
};
})();
