/* style.js - the shared look of "Grube Kattowitz III": palette, material ramps, light, and the pixel helpers every art module uses.
 *
 * Loaded first by index.html. The plain <script> files share ONE global namespace, window.LVL:
 *   LVL.style     palette, ramps, light direction, the VALUE and SKY rules, the baked pixel font, helpers (this file)
 *   LVL.map       tile map + entities (map.js)
 *   LVL.art.fx    smoke / steam / ash / light glows / beams (art/fx.js)
 *   LVL.art.bg    sky + far / midfar / mid / fg parallax layers (art/bg.js)
 *   LVL.art.tiles every tile kind of the playfield (art/tiles.js)
 *   LVL.art.models the owner's 3D models as pixel sprites: the headframes, the carts, the drums (art/models.js)
 *   LVL.art.props playfield props per beat + movers (art/props.js)
 *   LVL.engine    loop, input, camera, physics, movers, player, HUD, layer compositing (engine.js)
 *
 * RESOLUTION CONTRACT. The internal canvas is VW x VH = 960 x 540 px (20 x 11.25 tiles): exactly 1920 x 1080 at x2 and 4K at
 * x4. The hero, rendered from the 3D model, is SCALE.hero = 96 px = 1.85 m tall, 2 tiles of TS = 48 px; the world is drawn at
 * SCALE.pxPerM = 52.5 px per metre. K = TS / 32 = 1.5 is the zoom over the first draft's density (32 px tiles, a 64 px hero, an
 * 800 x 448 canvas): the map's entities and the engine's physics are the draft's numbers x K, so the level plays exactly as it
 * did, in tiles and seconds. The level (160 x 14 tiles = 7680 x 672 px) is taller than the frame: the engine's camera follows the
 * hero vertically too (engine.js, CAMERA). Every coordinate passed between modules is a NATIVE pixel (world x = column * TS,
 * world y = row * TS). Pixel-art rules: integer coordinates when drawing, no image smoothing, no sub-pixel anything, colours
 * from the ramps below, one pixel density everywhere: one art pixel is one canvas pixel (nothing in the world is drawn at 2 x 2 px
 * or more per pixel). The one deliberate exception is the interface laid over the world: the HUD labels and the win overlay draw
 * the baked font at HUD.k (3 or 4) px per font pixel (engine.js HUD), the debug grid's labels at PIX16, so they read as UI; all
 * world signage, stencils and graffiti use PIX.
 *
 * LIGHT. Like the hero render, the key light comes from the UPPER LEFT (LIGHT): lit faces are top and left, shadow faces bottom and
 * right. That key is the smog-diffused sky dome, not the sun: the sun sits low right of centre behind the smoke and is too weak to
 * cast its own shading; at most it adds a 1 px warm rim (sky[5] / lamp[0]) on a right-facing edge that faces it, sparingly, on
 * tall silhouettes (headframes, towers). Ramps are hue-shifted the way the hero's are: shadows lean violet / cold, lights lean warm
 * amber, so a ramp step changes hue as well as value. A 1 px near-black OUTLINE separates the things you can stand on (movers)
 * from the scenery. It is #0b080b, a hair lighter and more violet than the hero's own pure #000000 contour, on purpose: the hero
 * always owns the darkest edge.
 *
 * VALUE RULE (VALUE below; tools/probes.mjs measures it, the playtest asserts it). The hero is a near-black figure: his sheet
 * frames are ~40 % #000000 and ~25 % #181712, mean relative luminance ~0.029. He reads by VALUE where the backdrop right around his
 * silhouette (a ring 6 draft px x K = 9 px wide) is clearly lighter: contrast ratio (L + 0.05) / (0.029 + 0.05) >= VALUE.target 1.6
 * (ring L >= 0.076) where he walks the street, the stations and the belt, and never under VALUE.floor 1.4 anywhere he can stand.
 * Where that matters: his BODY band, the 2 tiles over the surface he stands on; on the street (the camera at its lowest, the street
 * at frame y 396) that is frame y 300..396, and the sky high above it is only ever behind him for a moment in a jump.
 *   Street band: the backdrop is what the layers PAINT there (art/bg.js: fogged facades, lit glazing, gaps where the sunset band
 *   shows; fx.HAZE is only a low ground fog), so their large masses behind his body sit at dusk[4] or lighter. Props on the
 *   playfield behind him get no haze either, so large areas of them use at least: sky[4] #9a5a36 (2.5) · smog[6] #6e5048 (1.8) ·
 *   brick[6] #8e3f2a (1.8) · steel[4] #4f5a5c (1.9) · rust[3] #a8562c (2.6) · wood[3] #7a5030 (1.9) · banner[3] #a01e1e (1.7) ·
 *   coal[6] #6e5a4a (2.0); sky[3], brick[5] and rust[2] (1.5-1.6) are the borderline steps. A dark prop (the engine house) gets
 *   its contrast from a lit band where he stands: lit windows, a lighter ground floor.
 *   High places (the C rooftops): the sky behind is dark there by design (SKY rule), so they are lifted LOCALLY, in world space:
 *   the colony's smog bank (map ENT.smogBank, fx) and its chimney smoke, never by a veil over the whole frame.
 *   The darker steps (sky[0..3], smog[0..5], brick[0..4], steel[0..3], coal[0..5], outline) are for small accents, contours, windows,
 *   the upper sky, and the playfield he STANDS on (tiles lie below his feet, not behind him).
 * SKY RULE (SKY below, measured by the playtest at five cameras along the level, the camera at its lowest - the street view - and
 * the hero off screen): the owner's sunset value gradient stays: dark smoky top, the sunset band the brightest part of the sky.
 * Mean luminance of the horizon band (SKY.horizon: frame rows just over the street) >= SKY.minRatio 1.4 x that of the top band
 * (SKY.top: the frame's top rows), as (L + 0.05) ratios (the first draft: 1.6..2.0). The sky is painted that way (art/bg.js): no
 * veil lies over the upper sky.
 * SCALE (SCALE below) - one proportion table for every artist, all against the 96 px hero = 1.85 m, i.e. 52.5 px per metre: a
 * storey is 144 px (3 tiles; windows never on consecutive 2-tile rows), a street door 60 x 120 px (2.5 tiles, the strongest
 * human-scale cue: every familok gets one on its street row), a window 42 x 66 px with a sill and a lintel, brick courses 4-5 px
 * tall (bricks ~12 x 4, mortar 1 px), ladder rung pitch ~14 px, a crate 48 px, a mine cart 108 x 60, a lamp post 204 px, the
 * Sperrzone fence 108 px, sign boards with their bottom edge 126 px over the street, a guard-tower cab at least 108 x 120 on 4-5
 * tile legs, a headframe sheave r ~39 px drawn with 1 px lattice members. Parallax layers scale these down with distance (mid
 * layer ~0.6-0.7, midfar ~0.4).
 */
(() => {
'use strict';
const LVL = window.LVL = window.LVL || {};
LVL.art = LVL.art || {};

// SCALE: the proportion table above, in native px (hero 96 px = 1.85 m); mid / midfar: the parallax layers' scale factors
const SCALE = { pxPerM: 52.5, hero: 96, storey: 144, door: [60, 120], window: [42, 66], brick: [12, 4], rung: 14, crate: 48,
  cart: [108, 60], lamp: 204, fence: 108, signUp: 126, towerCab: [108, 120], sheaveR: 39, mid: 0.65, midfar: 0.4 };
const TS = SCALE.hero / 2;                     // 48: tile size, the hero is 2 tiles tall
const K = TS / 32;                             // 1.5: the zoom over the draft's 32 px tile
const VW = 960, VH = 540;                      // internal canvas (native px): 20 x 11.25 tiles
const PIX = '8px pixel';                       // text size tokens for txt() / tw(): the baked font below at an 8 px em (1 px per font pixel)
const PIX16 = '16px pixel';                    // ... and at a 16 px em (HUD, overlays at native size: one font pixel = 2 x 2 px)
const OUTLINE = '#0b080b';                     // the 1 px sprite contour: the near-black of the hero's outline and the fg silhouettes
const LIGHT = { x: -1, y: -1 };                // direction the light comes FROM (screen space, y down): upper left
// Value rule numbers (relative luminance, WCAG formula). heroL: mean of the hero's sheet frames; minBehind: the mean value of the
// ring around him that gives the target contrast ((minBehind + 0.05) / (heroL + 0.05) = 1.6); floor: no standable spot below it;
// medianMin: the playtest's bar for the median over all probe spots. SKY: the sunset gradient (bands = [y0, y1) frame rows at the
// street view: the draft's bands [40, 120) / [260, 340), of which the street view shows draft rows 88.., x K).
const VALUE = { heroL: 0.029, minBehind: 0.076, target: 1.6, floor: 1.4, medianMin: 1.75 };
const SKY = { minRatio: 1.4, top: [0, 72], horizon: [258, 378] };

// Named colours of the first draft (kept: the design sheet's swatches and the painters use them).
const PAL = {
  smog:'#6e5048', rust:'#7a3b22', rustHi:'#a8562c', brick:'#6b2e22', brickHi:'#8e3f2a', mortar:'#3a1e1a',
  lamp:'#ffb84a', steel:'#4f5a5c', steelHi:'#7c8a86', soot:'#120e12', coal:'#1b171b', coalHi:'#3a3238',
  banner:'#7a1414', bannerHi:'#a01e1e', ink:'#e8dcc0', sky3:'#d89a52', outline: OUTLINE
};
// Design-sheet swatches (name, colour), in the order the page shows them.
const SWATCH = [
  ['Smog', PAL.smog], ['Zachód przez dym', PAL.sky3], ['Rdza', PAL.rustHi], ['Cegła familoka', PAL.brick],
  ['Sód (lampy)', PAL.lamp], ['Stal', PAL.steelHi], ['Węgiel', PAL.coalHi], ['Sukno banera', PAL.bannerHi]
];
// Material ramps, darkest -> lightest, built from the draft's colours and hue-shifted (violet shadows, amber lights).
// Index 0 is the contact shadow / outline tone of that material; the last entry is the specular / rim tone, used sparingly.
const RAMP = {
  coal:   ['#0b080b', '#120e12', '#1b171b', '#241e22', '#3a3238', '#4a3e3a', '#6e5a4a'],
  brick:  ['#1e1012', '#2a1614', '#3a1e1a', '#5a2620', '#6b2e22', '#7a3526', '#8e3f2a', '#b0603a'],
  steel:  ['#141216', '#252a2c', '#2c3234', '#3d4446', '#4f5a5c', '#5c6866', '#7c8a86', '#a8b2a4'],
  rust:   ['#2a1214', '#4a2018', '#7a3b22', '#a8562c', '#c87a3e', '#e0a058'],
  wood:   ['#1e1410', '#3a2414', '#5a3a22', '#7a5030', '#9a6a40'],
  banner: ['#140c0c', '#4a0c0c', '#7a1414', '#a01e1e', '#c8402a'],
  lamp:   ['#7a4a1a', '#c8822e', '#ffb84a', '#ffd890', '#fff3c4'],
  paper:  ['#2a1a12', '#8a7a5a', '#c8b48c', '#e8dcc0'],
  sky:    ['#1f171d', '#2e1f25', '#4a2e2c', '#6e4232', '#9a5a36', '#c47a3e', '#d89a52', '#f2d38a', '#fbe6b0'],
  smog:   ['#141014', '#1c161a', '#241b20', '#2f2226', '#3b2a2e', '#4a3434', '#6e5048', '#8a706a', '#b8aca0'],
  // ---- track: tiles (art/tiles.js) ----
  slag:   ['#170f13', '#2b181b', '#452622', '#66382c', '#8a523c', '#ad7352'],              // burnt colliery spoil ("red dog"), cinders
  stone:  ['#1d1719', '#3b3133', '#5c4e48', '#806e60', '#a38e76', '#c6b294'],              // sandstone + cement: sills, plinths, steps, kerbs, lime bloom
  paint:  ['#0d1211', '#18211f', '#24302b', '#34433a', '#4b5a48', '#6b7a5c'],              // weathered bottle-green paint of window frames and doors
  glass:  ['#0e0b10', '#1a1419', '#2a2026', '#433031', '#6a4838', '#9a6a48'],              // unlit panes mirroring the smoggy sunset
  basalt: ['#141118', '#201b24', '#2d2731', '#3c3540', '#4d4550', '#625863', '#7a6f76', '#978a8a'],  // crushed basalt / granite: track ballast, the colony's setts
  dust:   ['#2a2027', '#40333a', '#594741', '#755f50', '#927a62', '#ae9574'],              // coal dust and fines lit by the sky dome: the walked tops (heap, yards, belt)
  // ---- end track: tiles ----
  // ---- PROPS track (art/props.js) ----
  // burlap: sandbags and coal sacks (jute, olive-ochre: lit tops at [4..5]; the shadows lean violet: the tie and creases at [1],
  //         the contact shadow on the ground at [0]);
  // whitewash: the whitewash of the graffiti (core [2], thin edges [1], overspray [0]: the thinner the paint, the cooler the grey);
  // lens:   the guard tower's searchlight glass, shadowed rim to highlight; lens[2] is the pixel the fx beam leaves from (the
  //         playtest reads it)
  burlap: ['#1c1218', '#3a2a2c', '#5a4a34', '#6a583e', '#8a7650', '#a8926a'],
  whitewash: ['#857d86', '#bab2a6', '#d8d0b8', '#ece6d2'],
  lens:   ['#8a8064', '#c8bc8a', '#e8d8a0', '#fff3c4'],
  // ---- end PROPS track ----
  // ---- atmos track (art/bg.js, art/fx.js) ----
  // dusk: distant masses seen through the sunset smog, violet shade -> the warm, sunset-lit ground fog their feet dissolve in (far
  // and midfar layers, the fog; dusk[4] and up are the backdrop steps behind the hero's body band: 1.6 .. 3.7 on their own; [7..8]
  // only in the ground fog's lower bands, a little paler and closer together: denser fog, less contrast)
  dusk:   ['#24171d', '#33202a', '#472a2e', '#5c3532', '#734236', '#8a5038', '#a4623e', '#ae6e4a', '#b67a58'],
  // hull: the patrol airship's doped fabric, cold violet shadow -> the top lit by the sky dome
  hull:   ['#121014', '#1e1a22', '#2b252e', '#3a3238', '#4c4244', '#62564e', '#80705e'],
  // mbrick: familok brick of the mid layer, houses standing as silhouettes against the sunset: darker than the sky band behind
  // them and than the playfield's brick (mortar, body, lit trim, lit corner); below the fog line bg.js repaints them in dusk
  mbrick: ['#2e1a1c', '#42221f', '#582c24', '#6c3628'],
  // dsteel: steel seen across the smog at dusk (the mid layer's screening house and water tower): warmer and darker than the
  // playfield's steel, so the belt pillars and blocks in front of it keep their own read
  dsteel: ['#16121a', '#221b21', '#2f2529', '#3d3031', '#4d3c39', '#5f4b43'],
  // signal: warning lamps of chimneys, headframes, the Gauturm beacon and the airship: [halo ring, lamp, hot pixel = also the warm
  // white of the searchlight beams]
  signal: ['#8a1e16', '#ff4030', '#ffe9b0']
  // ---- end atmos ----
};

// ---------- random / noise ----------
// rng(seed): mulberry32 stream in [0, 1). hash(x, y): stable per-cell value in [0, 1) (integer inputs).
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(x, y){ let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// noise(x, y, seed): smooth value noise in [0, 1) on a unit lattice (smoothstep between hashed corners); fbm: 2x-frequency octaves.
function noise(x, y, seed = 0){
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi + seed * 7919, yi), b = hash(xi + 1 + seed * 7919, yi), c = hash(xi + seed * 7919, yi + 1), d = hash(xi + 1 + seed * 7919, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 3, seed = 0){ let s = 0, amp = 0.5, n = 0; for (let i = 0; i < oct; i++){ s += noise(x, y, seed + i) * amp; n += amp; x *= 2; y *= 2; amp *= 0.5; } return s / n; }

// ---------- canvas + primitive helpers (all integer, no smoothing) ----------
// mk(w, h, read): an offscreen canvas + its 2D context (read = true when the pixels will be read back with getImageData).
function mk(w, h, read = false){ const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', read ? { willReadFrequently: true } : undefined); g.imageSmoothingEnabled = false; return [c, g]; }
function R(c, x, y, w, h, col){ if (col) c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
// Bresenham line of 1x1 pixels in the current fillStyle.
function line(c, x0, y0, x1, y1){
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;){ c.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy){ err += dy; x0 += sx; } if (e2 <= dx){ err += dx; y0 += sy; } }
}
function disc(c, cx, cy, r, col){ if (col) c.fillStyle = col; cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  for (let dy = -r; dy <= r; dy++){ const w = Math.floor(Math.sqrt(r * r - dy * dy)); c.fillRect(cx - w, cy + dy, 2 * w + 1, 1); } }
// Ordered 4x4 Bayer dither: lights `level` of every 16 pixels (0..16). The pattern is keyed to absolute coordinates, so adjacent
// calls (tiles, bands) tile seamlessly; use it for gradients between two ramp steps. BAYER: the threshold matrix itself, row-major
// (pixel (x, y) is lit when BAYER[(y & 3) * 4 + (x & 3)] < level), for painters that dither per pixel.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function bayer(c, x, y, w, h, col, level){ if (level <= 0) return; c.fillStyle = col; x = Math.round(x); y = Math.round(y);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){ const X = x + i, Y = y + j; if (BAYER[(Y & 3) * 4 + (X & 3)] < level) c.fillRect(X, Y, 1, 1); } }

// Relative luminance of '#rrggbb' (WCAG 2) and the contrast ratio of two luminances: the units of the VALUE rule.
function lum(hex){ const n = parseInt(hex.slice(1), 16), f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); }
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Midpoint (Bresenham) circle outline of radius r in the current fillStyle: every pixel once, no doubles or gaps.
function circle(c, cx, cy, r){
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r); if (r <= 0){ c.fillRect(cx, cy, 1, 1); return; }
  let x = r, y = 0, e = 1 - r; const seen = new Set();
  const px = (X, Y) => { const k = X * 4099 + Y; if (!seen.has(k)){ seen.add(k); c.fillRect(cx + X, cy + Y, 1, 1); } };
  while (x >= y){ for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) px(a, b); y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; } }
}
// Filled polygon from integer row spans (even-odd, no anti-aliasing): light cones, slanted roofs, tub sides. pts = [x0, y0, x1, y1,
// ...] in the current transform's units; rows are sampled at their centres, spans rounded to whole pixels. clip = [y0, y1] limits
// the rows (e.g. to the screen) for very tall shapes.
function poly(c, pts, clip){
  let ylo = Infinity, yhi = -Infinity; for (let i = 1; i < pts.length; i += 2){ ylo = Math.min(ylo, pts[i]); yhi = Math.max(yhi, pts[i]); }
  ylo = Math.round(ylo); yhi = Math.round(yhi); if (clip){ ylo = Math.max(ylo, clip[0]); yhi = Math.min(yhi, clip[1]); }
  const n = pts.length / 2, xs = [];
  for (let y = ylo; y <= yhi; y++){
    const yc = y + 0.5; xs.length = 0;
    for (let i = 0; i < n; i++){ const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[(i + 1) % n * 2], by = pts[(i + 1) % n * 2 + 1];
      if ((yc < ay) !== (yc < by)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2){ const a = Math.round(xs[k]), b = Math.round(xs[k + 1]); if (b > a) c.fillRect(a, y, b - a, 1); }
  }
}
const tri = (c, ax, ay, bx, by, cx, cy, clip) => poly(c, [ax, ay, bx, by, cx, cy], clip);

// 1 px edge bevel lit from the upper left: top + left edges in `hi`, bottom + right edges in `lo` (t = thickness).
function bevel(c, x, y, w, h, hi, lo, t = 1){
  R(c, x, y, w, t, hi); R(c, x, y, t, h, hi); R(c, x, y + h - t, w, t, lo); R(c, x + w - t, y, t, h, lo);
}
// A box shaded with a material ramp: ramp[i] body, ramp[i+1] lit top/left bevel, ramp[i-1] shadowed bottom/right bevel and an
// optional ramp[0] contour. The default i picks the middle of the ramp.
function shadedBox(c, x, y, w, h, ramp, opt = {}){
  const i = opt.i ?? Math.floor(ramp.length / 2), hi = ramp[Math.min(ramp.length - 1, i + 1)], lo = ramp[Math.max(0, i - 1)];
  R(c, x, y, w, h, ramp[i]); bevel(c, x, y, w, h, hi, lo, opt.t || 1);
  if (opt.outline){ c.fillStyle = ramp[0]; c.fillRect(x - 1, y, 1, h); c.fillRect(x + w, y, 1, h); c.fillRect(x, y - 1, w, 1); c.fillRect(x, y + h, w, 1); }
}
// Returns a NEW canvas 2 px larger than src (1 px margin on every side) with a 1 px contour in `col` around every non-transparent
// pixel (4-neighbour, like the hero's outline; corners = true also fills diagonal neighbours). Draw it at (x - 1, y - 1).
function outline(src, col = OUTLINE, corners = false){
  const w = src.width + 2, h = src.height + 2, [c, g] = mk(w, h, true); g.drawImage(src, 1, 1);
  const img = g.getImageData(0, 0, w, h), d = img.data, a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  const rgb = parseInt(col.slice(1), 16), cr = rgb >> 16 & 255, cg = rgb >> 8 & 255, cb = rgb & 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y * w + x; if (a[i]) continue;
    let on = (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]);
    if (!on && corners) on = (x > 0 && y > 0 && a[i - w - 1]) || (x < w - 1 && y > 0 && a[i - w + 1]) || (x > 0 && y < h - 1 && a[i + w - 1]) || (x < w - 1 && y < h - 1 && a[i + w + 1]);
    if (on){ d[i * 4] = cr; d[i * 4 + 1] = cg; d[i * 4 + 2] = cb; d[i * 4 + 3] = 255; }
  }
  g.putImageData(img, 0, 0); return c;
}

// ---------- baked pixel font ----------
// Canvas text (signs, billboard, HUD, grid labels) is drawn from this 5 px caps font in the spirit of Silkscreen (the face the page's
// HTML uses), so it is crisp and identical whether or not web fonts load (offline, blocked, slow) and no glyph is ever anti-aliased.
// Metrics per em pixel: caps are 5 rows tall and start 1 row below y (an 8 px em, like 8px Silkscreen with textBaseline 'top');
// acute / dot / umlaut accents use the 2 rows above the caps, ogonki the row below; advance = glyph width + 1. Lower case is drawn
// as caps; an unknown character is drawn as a hollow box. font: PIX (1 em pixel = 1 px of the context) or PIX16 (2 x 2 px).
const GLYPH = {};
('A .XX.|X..X|XXXX|X..X|X..X;B XXX.|X..X|XXX.|X..X|XXX.;C .XXX|X...|X...|X...|.XXX;D XXX.|X..X|X..X|X..X|XXX.;E XXXX|X...|XXX.|X...|XXXX;' +
 'F XXXX|X...|XXX.|X...|X...;G .XXX|X...|X.XX|X..X|.XXX;H X..X|X..X|XXXX|X..X|X..X;I XXX|.X.|.X.|.X.|XXX;J ...X|...X|...X|X..X|.XX.;' +
 'K X..X|X.X.|XX..|X.X.|X..X;L X...|X...|X...|X...|XXXX;M X...X|XX.XX|X.X.X|X...X|X...X;N X...X|XX..X|X.X.X|X..XX|X...X;' +
 'O .XX.|X..X|X..X|X..X|.XX.;P XXX.|X..X|XXX.|X...|X...;Q .XX.|X..X|X..X|X.X.|.X.X;R XXX.|X..X|XXX.|X.X.|X..X;S .XXX|X...|.XX.|...X|XXX.;' +
 'T XXXXX|..X..|..X..|..X..|..X..;U X..X|X..X|X..X|X..X|.XX.;V X...X|X...X|X...X|.X.X.|..X..;W X...X|X...X|X.X.X|XX.XX|X...X;' +
 'X X...X|.X.X.|..X..|.X.X.|X...X;Y X...X|.X.X.|..X..|..X..|..X..;Z XXXX|...X|.XX.|X...|XXXX;' +
 '0 .XX.|X.XX|X..X|XX.X|.XX.;1 .X.|XX.|.X.|.X.|XXX;2 XXX.|...X|.XX.|X...|XXXX;3 XXX.|...X|.XX.|...X|XXX.;4 X..X|X..X|XXXX|...X|...X;' +
 '5 XXXX|X...|XXX.|...X|XXX.;6 .XX.|X...|XXX.|X..X|.XX.;7 XXXX|...X|..X.|.X..|.X..;8 .XX.|X..X|.XX.|X..X|.XX.;9 .XX.|X..X|.XXX|...X|.XX.;' +
 'Ł .X...|.X.X.|.XX..|XX...|.XXXX;ß XXX.|X..X|X.X.|X..X|X.X.;· .|.|X|.|.;. .|.|.|.|X;, .|.|.|.|X|X;: .|X|.|X|.;- ...|...|XXX|...|...;' +
 '= ...|XXX|...|XXX|...;! X|X|X|.|X;? XXX.|...X|.XX.|....|.X..;/ ...X|..X.|..X.|.X..|X...;\' X|X|.|.|.;( .X|X.|X.|X.|.X;) X.|.X|.X|.X|X.;' +
 '+ ...|.X.|XXX|.X.|...;% X..X|...X|..X.|.X..|X..X;# .X.X.|XXXXX|.X.X.|XXXXX|.X.X.;' +
 '□ XXX|X.X|X.X|X.X|XXX').split(';').forEach(e => { GLYPH[e[0]] = e.slice(2).split('|'); });
GLYPH[' '] = ['..', '..', '..', '..', '..'];
// accented capitals: base glyph + mark ('a' acute, 'd' dot above, 'u' umlaut, 'o' ogonek)
const ACCENT = { 'Ą': 'Ao', 'Ę': 'Eo', 'Ć': 'Ca', 'Ń': 'Na', 'Ó': 'Oa', 'Ś': 'Sa', 'Ź': 'Za', 'Ż': 'Zd', 'Ä': 'Au', 'Ö': 'Ou', 'Ü': 'Uu' };
function glyph(ch){
  let g = GLYPH[ch]; if (g) return { rows: g, mark: null };
  const u = ch.toUpperCase(); if (GLYPH[u]) return { rows: GLYPH[u], mark: null };
  const a = ACCENT[u]; if (a) return { rows: GLYPH[a[0]], mark: a[1] };
  return { rows: GLYPH['□'], mark: null };
}
const fontScale = font => font === PIX16 ? 2 : 1;
function tw(c, s, font = PIX){ let w = 0; for (const ch of s) w += glyph(ch).rows[0].length + 1; return Math.max(0, w - 1) * fontScale(font); }
const textCache = new Map();
// Draws s with its em box's top-left at (x, y) (rounded), in col, through the context's current transform.
function txt(c, s, x, y, col, font = PIX){
  const k = fontScale(font), key = s + '\u0000' + col + '\u0000' + k; let b = textCache.get(key);
  if (!b){
    const w = tw(null, s, PIX), [cv, g] = mk(Math.max(1, w * k), 9 * k); g.fillStyle = col; let ox = 0;   // em rows -1 .. 7 (+1 for accents)
    for (const ch of s){ const { rows, mark } = glyph(ch), gw = rows[0].length, m = gw >> 1;
      rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === 'X') g.fillRect((ox + i) * k, (j + 2) * k, k, k); });
      const dot = (i, j) => g.fillRect((ox + i) * k, (j + 1) * k, k, k);                // em row j (-1 = above the em box)
      if (mark === 'a'){ dot(m + 1, -1); dot(m, 0); } else if (mark === 'd') dot(m, -1); else if (mark === 'u'){ dot(1, -1); dot(gw - 2, -1); }
      else if (mark === 'o'){ dot(gw - 1, 6); dot(gw, 7); }
      ox += gw + 1; }
    b = cv; if (textCache.size > 400) textCache.clear(); textCache.set(key, b);
  }
  c.drawImage(b, Math.round(x), Math.round(y) - k);
}
// Kotwica Polski Walczącej (13 x 13 cells), the only Polish voice in the scene, as graffiti.
const KOTWICA = [
  '......XXXX...', '......X...X..', '......X...X..', '......XXXX...', '......X......',
  'X.....X.....X', 'X.....X.....X', 'XX....X....XX', '.X...XXX...X.', '.XX.X.X.X.XX.',
  '..XX..X..XX..', '...XX.X.XX...', '....XXXXX....'];
function sprite(c, rows, x, y, col, s = 1){ c.fillStyle = col; rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === 'X') c.fillRect(x + i * s, y + j * s, s, s); }); }

LVL.style = {
  VW, VH, TS, K, PIX, PIX16, OUTLINE, LIGHT, VALUE, SKY, SCALE, PAL, SWATCH, RAMP,
  rng, hash, noise, fbm, mk, R, line, disc, circle, poly, tri, BAYER, bayer, bevel, shadedBox, outline, lum, contrast, txt, tw, KOTWICA, sprite
};
})();
