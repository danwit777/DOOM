/* art/bg.js - the sky and the parallax layers behind (far, midfar, mid) and in front of (fg) the playfield.
 *
 * NATIVE: painted at the level's own density (style.js RESOLUTION: the 960 x 540 frame, 52.5 px per metre), each layer scaled
 * down from SCALE with its distance; 1 px lattice, 1 px dithers, ramp steps only.
 *
 * API (called by engine.js; ctx = the VW x VH game canvas, v = view { cx, cy: camera top-left (native, integer), t: frame counter
 * at 60 Hz }):
 *   bg.build(opt)              once at boot (canvas text is style.js's baked font: nothing to wait for): renders the sky, the
 *                              airship, every static layer into its own canvas and the frames of what turns (the sheaves).
 *                              opt.headframe (optional): a sprite provider for the lattice headframes of the mid and midfar
 *                              layers (HEADFRAMES below), spec => null (the lattice is painted here) or { img, x, y, anims?,
 *                              lamps? }: img is laid on the layer at layer px (x, y) in its place and goes through the layer's
 *                              ground fog with the rest (any colours: under the fog line the far / midfar fog takes each as the
 *                              dusk step nearest its value, the mid fog gives it a role by its value, see FOG), anims (as in
 *                              layers[id].anims: the sprite's own turning sheaves) and lamps ([{ x, y }] blinking warning lamps)
 *                              are added to the layer; spec = { layer, x, gy, w, h, r, strut, sun, rope } in that layer's px
 *                              (x .. x + w the legs' feet on the ground row gy, h the deck's height over it, r the sheave
 *                              radius, strut +-1 / 0 its raking back-strut to the right / left / none, sun: it takes the sun's
 *                              rim, rope: [x, y] the engine house's drum its winding ropes run to, or null), so a render of
 *                              the owner's 3D headframe can stand in without touching the rest
 *   bg.layers[id]              id in 'far' | 'midfar' | 'mid' | 'fg': { c: canvas (lw x LH), lw: wrap width, f: scroll factor x
 *                              camera across, fy: the same up and down (art behind: f; the fg 1, as a factor over 1 would lift its
 *                              girders off the frame's top), smoke: [{ x, y, rate, tone, age?, ageY?, grow, spread?, big? }] smoke
 *                              / steam sources in layer px (art/fx.js emits from them; tone = [shadow, body, light], the three ramp
 *                              steps its plume is shaded with, age = the steps of the plume's older part above the row ageY;
 *                              grow, spread: px per frame, px; rate: puffs per frame; big: a dense steam plume), anims: [{ x, y, strip, n, spin }] the turning parts (a strip of
 *                              n square frames, one turn of their symmetry, laid with its top-left at layer px (x, y), spin =
 *                              radians per frame, signed), far only: tower { x, y, lights } = the Gauturm's two searchlights on
 *                              its lamp deck, their lenses at (x + lights[i], y) in layer px (fx sweeps their beams from there),
 *                              and beacon { x, y } its blinking mast lamp (both inside the frame's rows at every camera height) }
 *                              (+ private fields of this module)
 *   bg.offset(id, cx)          integer scroll offset of a layer for camera cx (layers repeat every lw px; + its phase, if any)
 *   bg.offsetY(id, cy)         the frame y of the layer's top for camera cy ('sky': 0, it does not move): every layer sits as
 *                              painted at the street view (the camera's lowest, REF = LH - VH) and moves fy x the camera from
 *                              there; each is LH tall, so no layer ever leaves a gap at the frame's top or bottom
 *   bg.drawSky(ctx, v)         sky, sun sliced by smoke bands (frame rows: v is not read)
 *   bg.drawLayer(ctx, id, v)   one background layer: the static canvas (wrapping) + its animated bits (sheaves, warning lamps,
 *                              the Gauturm beacon, the embers of the smouldering heap); after the far layer the patrol airship
 *                              (+ its searchlight via LVL.art.fx.beam), which flies nearer than the distant works
 *   bg.drawFg(ctx, v)          the dark foreground silhouettes (girder + crane trolley and hook, pipe stand, hanging chain and
 *                              hook, slack cable), 1.35 x camera across, 1:1 up and down
 *
 * DEPTH AND VALUE ARE PAINTED, not veiled (fx.HAZE is down to a ground fog at the frame's bottom). The sky keeps the owner's
 * sunset: a dark smoky top (sky[0..1]), the bands brightening to the sunset (sky[4..6]) the sun sits in. Every layer is a dark
 * silhouette against that sunset above the FOG LINE (FOG_Y), and below it its feet stand in the sunset-lit ground fog, painted
 * as three flat posterised bands, each paler and lower in contrast than the one over it (fogged(): each colour re-painted with
 * its fogged step; the far and midfar fog's top is a 3-row dithered seam, the band edges hard lines that wander +-2 px): the
 * farther the layer, the closer its steps sit to the fog (far: dusk +2 steps, midfar +1, one more per band down; mid: its
 * structure kept at one step of contrast - shadow lines, walls, lit trim in three dusk steps per band - with only the brick
 * texture gone, lit glass one lamp step dimmer, banner red kept). The VALUE rule (style.js) is met by what is painted where the hero stands: the fogged facades, gaps in the
 * house rows where the sunset band shows (behind the B station, the guard tower, the end of the C street), the sunlit flank of
 * the cooling tower behind the start heap, the lit glazing of the screening house behind the D belt; up on the C roofs the
 * colony's smog bank (fx) lifts the dark silhouettes. Horizontal lines of the mid layer keep clear of the playfield's lines they
 * would slide along: the cable-car rope (world y 309, B is seen from the street view only: mid row 309) and the C roofs (world
 * y 288 / 384, seen from the camera's rests 132, 87 and 0: a mid row Y lies on world row Y + 0.4 cy - 0.4 REF).
 * Scale: the mid layer is drawn at SCALE.mid (familok storey 93 px, window 27 x 42, door 39 x 78, brick courses 4 px, sheave r
 * 25, lettering 9 px caps), the midfar at ~SCALE.midfar (sheave r 14, the halls' saw teeth 30 x 24), the far layer at ~0.25 (the
 * works' windows 2 x 3); the fg is the nearest thing (girder 27 px, chain links 9 x 15).
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, FX = LVL.art.fx;
const { RAMP, OUTLINE, VW, VH, rng, hash, noise, mk, R, line, disc, poly, outline, lum } = S, LH = LVL.map.LH;
const bg = LVL.art.bg = { layers: {} };
const SK = RAMP.sky, SM = RAMP.smog, MB = RAMP.mbrick, ST = RAMP.steel, DS = RAMP.dsteel, LA = RAMP.lamp, BN = RAMP.banner,
  DU = RAMP.dusk, HU = RAMP.hull, CO = RAMP.coal, PA = RAMP.paper, WD = RAMP.wood, SG = RAMP.signal;
const REF = LH - VH;                                        // the street view's camera y (the camera's lowest)
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const by = (x, y) => BAY[(y & 3) * 4 + (x & 3)];          // the 4 x 4 Bayer threshold (0..15) of a pixel
const hexOf = (r, g, b) => '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
const WORDS = new Map(), wordOf = h => { let w = WORDS.get(h); if (w === undefined){ const n = parseInt(h.slice(1), 16);   // RGBA word, little endian
  w = (0xff000000 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; WORDS.set(h, w); } return w; };
// Midpoint circle whose every pixel is coloured by col(dx, dy) (shaded rims: lit upper left, dark lower right).
function rim(g, cx, cy, r, col){
  let x = r, y = 0, e = 1 - r; const seen = new Set();
  const px = (X, Y) => { const k = X * 4099 + Y; if (!seen.has(k)){ seen.add(k); g.fillStyle = col(X, Y); g.fillRect(cx + X, cy + Y, 1, 1); } };
  while (x >= y){ for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) px(a, b); y++; if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; } }
}
const shade3 = (lit, mid, dark) => (dx, dy) => dx + dy < -2 ? lit : dx + dy > 2 ? dark : mid;
// The regime emblem: an ink disc with the banner-red cog on it (8 square teeth on a ring, a hub), the cog shaded from the upper
// left (lit step on its upper-left faces, dark on its lower-right). r = the disc's radius (>= 6). A cog, never anything else.
function emblem(g, cx, cy, r, ink = PA[3], red = BN[2]){
  disc(g, cx, cy, r, ink); const ro = r - 1.5, rb = r * 0.68, ri = r * 0.38, hub = Math.max(1, r * 0.16);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
    const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), tooth = Math.cos(8 * a) > 0.25;
    if (!(d <= hub + 0.3 || (d >= ri && d <= rb) || (tooth && d > rb - 0.5 && d <= ro))) continue;
    const s = (dx + dy) / Math.max(1, d);                     // the cog's surface faces: upper left lit, lower right dark
    R(g, cx + dx, cy + dy, 1, 1, d >= rb - 1 ? (s < -0.5 ? BN[3] : s > 0.5 ? BN[1] : red) : d >= ri && d < ri + 1 && s < -0.5 ? BN[1] : red);   // the hole's rim: shaded up left
  }
}

// ---------- the ground fog: three posterised bands ----------
// From the row FOG_Y down, every pixel a layer painted is re-painted with its fogged step (rule(colour, band): '#rrggbb' ->
// '#rrggbb', each layer's own rule): flat colours, no dither inside the fog, so the hero's ring never sees a screen door. The fog
// lies in three BANDS (FOG_BANDS: their top rows), each paler and lower in contrast than the one over it, the way a ground fog
// thickens towards the street; each band's top is a hard edge that wanders +-2 px along the layer (fogWave: sines whose periods
// divide every wrap width, so the wave has no seam where a layer repeats), so the bands read as layers of fog, not a ruled paint
// dip. The far and midfar layers (seen over the mid layer's roofs, never right behind him) get a 3-row seam over the first edge
// (1/4, 2/4, 3/4 of the pixels fogged, keyed to the Bayer cell), so their fog lies on the heaps and towers as a bank. At the
// street view the edges sit at frame y 286 (over the heads of the street spots: their ring starts at ~291, under the colony's
// lowest unfogged sills, so it never cuts a window there), ~330 and ~370. A layer is painted on a read-back canvas
// (style.mk(..., true)), fogged in one getImageData / putImageData, then copied into a plain canvas for the per-frame blits.
const FOG_Y = 418, FOG_BANDS = [FOG_Y, 462, 502];
const fogWave = x => Math.round(1.1 * Math.sin(x * Math.PI / 150) + 0.7 * Math.sin(x * Math.PI / 50 + 1.3) + 0.3 * Math.sin(x * Math.PI / 30 + 0.4));
function fogged(c, g, rule, seam = 0){
  const w = c.width, y0 = FOG_Y - 3 - seam, img = g.getImageData(0, y0, w, LH - y0), d = new Uint32Array(img.data.buffer);
  const memo = FOG_BANDS.map(() => new Map()), wave = Int8Array.from({ length: w }, (_, x) => fogWave(x));
  let lk = -1, lb = -1, lo = 0;                                                               // runs of one colour skip the lookup
  for (let y = y0, i = 0; y < LH; y++) for (let x = 0; x < w; x++, i++){ const v = d[i]; if (!(v >>> 24)) continue;
    const e = y - wave[x];                                                                    // e: the row against the bands' edges
    let b = e >= FOG_BANDS[2] ? 2 : e >= FOG_BANDS[1] ? 1 : e >= FOG_Y ? 0 : -1;
    if (b < 0){ if (!(seam && e >= FOG_Y - seam && by(x, y) < 4 * (e - FOG_Y + seam + 1))) continue; b = 0; }   // the seam: 4, 8, 12 of 16
    if (v !== lk || b !== lb){ lk = v; lb = b; lo = memo[b].get(v);
      if (lo === undefined){ lo = (v & 0xff000000 | wordOf(rule(hexOf(v & 255, v >> 8 & 255, v >> 16 & 255), b)) & 0xffffff) >>> 0; memo[b].set(v, lo); } }
    d[i] = lo; }
  g.putImageData(img, 0, y0);
  const [p, pg] = mk(w, LH); pg.drawImage(c, 0, 0); return p;
}
const LUM = new Map(), lumOf = h => { let L = LUM.get(h); if (L === undefined){ L = lum(h); LUM.set(h, L); } return L; };
// a colour as a dusk index: its own if it is a dusk step, else the dusk step nearest its value (any other ramp's colours, a
// sprite's: whatever lies in the fog ends up in its steps)
const toDusk = h => { let k = DU.indexOf(h); if (k >= 0) return k; k = 0;
  for (let i = 1; i < DU.length; i++) if (Math.abs(lumOf(DU[i]) - lumOf(h)) < Math.abs(lumOf(DU[k]) - lumOf(h))) k = i; return k; };
// lit glass in the fog is its own step: one lamp step dimmer (the dimmest stays)
const fogGlass = h => { const i = LA.indexOf(h); return i < 0 ? null : LA[Math.max(0, i - 1)]; };
// The mid layer's fog keeps the STRUCTURE of what it covers at one step of contrast and drops only the brick texture (brick()
// paints no mortar under the fog line): each colour plays a ROLE by its index in its own ramp, 0 shadow (mortar and shadow lines,
// reveals, dark glass, the panels' recesses), 1 body (walls, slate, steel, the casement cross of dark glass), 2 lit (sills, string
// courses, arched headers, quoins, door and window surrounds, lit edges) - a colour of no ramp listed (a sprite's) by its value -
// and a band paints the roles in its three dusk steps (MIDFOG).
const ROLES = { mbrick: [0, 1, 2, 2], smog: [0, 0, 1, 1, 2, 2, 2, 2, 2], dsteel: [0, 0, 0, 1, 2, 2], steel: [0, 0, 0, 1, 1, 2, 2, 2],
  wood: [0, 1, 2, 2, 2], paper: [0, 1, 2, 2], sky: [1, 1, 1, 2, 2, 2, 2, 2, 2] };
const roleOf = h => { for (const k in ROLES){ const i = RAMP[k].indexOf(h); if (i >= 0) return ROLES[k][i]; } const L = lumOf(h); return L < 0.012 ? 0 : L < 0.075 ? 1 : 2; };
const MIDFOG = [[DU[4], DU[5], DU[6]], [DU[5], DU[6], DU[7]], [DU[6], DU[7], DU[8]]];
// The layers' fog rules (b = the band): far +2 dusk steps, capped at dusk[5] in the first band (+1 step and cap per band down);
// midfar +1 (capped at dusk[6], then the same); a colour of another ramp is first taken as the dusk step of its value; mid: the
// roles above, the banner's red one step lighter (the regime's colour still shows); lit glass dimmed on every layer.
const step = (i, n, cap) => DU[Math.min(DU.length - 1, cap, i + n)];
const FOG = {
  far: (h, b) => fogGlass(h) || step(toDusk(h), 2 + b, 5 + b),
  midfar: (h, b) => fogGlass(h) || step(toDusk(h), 1 + b, 6 + b),
  mid: (h, b) => fogGlass(h) || (BN.includes(h) ? BN[Math.min(BN.length - 1, BN.indexOf(h) + 1)] : MIDFOG[b][roleOf(h)])
};

// ---------- sky ----------
// The frame's own rows (it does not move). Built on a palette-index buffer (index 0 = smog[1], 1 + i = sky[i]): bands, halo and
// smoke bands are index shifts, so every pixel is a ramp step by construction. SKY_EDGES: where each band starts, SKY_SEAM: the
// ordered-dither ramp into it (18 px in the upper sky, 6 px over the street band); the last two edges lie in the hero's body band
// at the street view (frame y 300..396) and are flat posterised steps (a dither seam there runs through his chest and neck as a
// dotted stripe). The top 72 rows (style.js SKY.top) are sky[0], the owner's dark smoky top; the sunset band (sky[4..6]) fills
// the rows over the street (SKY.horizon).
const SKY_EDGES = [90, 146, 206, 266, 328, 380], SKY_SEAM = [18, 18, 18, 6, 0, 0];
const SUN = { x: 725, y: 318, r: 51 };
// the four smoke bands slicing the sun, [y, x0, x1, thickness] (darker by one step, by two over its disc)
const SUN_BANDS = [[285, 524, 959, 7], [304, 599, 899, 4], [322, 569, 869, 4], [340, 629, 989, 7]];
let sky, ship;
function buildSky(){
  const [c, g] = mk(VW, VH), P = [SM[1], ...SK], N = P.length, idx = new Int8Array(VW * VH);
  for (let y = 0; y < VH; y++){
    let k = 0; while (k < SKY_EDGES.length && y >= SKY_EDGES[k]) k++;
    const e = SKY_EDGES[k], h = SKY_SEAM[k], fr = e !== undefined && y >= e - h ? (y - e + h) / h : -1;
    for (let x = 0; x < VW; x++) idx[y * VW + x] = 1 + k + (fr >= 0 && by(x, y) < Math.round(2 + fr * 14) ? 1 : 0);
  }
  const shift = (x, y, n) => { if (x < 0 || y < 0 || x >= VW || y >= VH) return; const i = y * VW + x; idx[i] = Math.max(0, Math.min(N - 1, idx[i] + n)); };
  // halo: one step lighter in a dither that thins out in posterised rings, spread wider than tall (the glow lies along the
  // smog layer); then the disc (rim sky[6], body sky[7], hot core up-left). Squared distances: no sqrt per pixel.
  const RING = [[60, 16], [72, 12], [87, 9], [105, 6], [126, 4], [150, 2], [168, 1]].map(([e, l]) => [e * e, l]), r2 = SUN.r * SUN.r;
  for (let y = SUN.y - 168; y <= SUN.y + 168; y++) for (let x = SUN.x - 210; x <= SUN.x + 210; x++){
    const dx = x - SUN.x, dy = y - SUN.y, e2 = dx * dx * 0.64 + dy * dy * 1.21; let lv = 0;
    for (const [e, l] of RING) if (e2 < e){ lv = l; break; }
    if (by(x, y) < lv) shift(x, y, 1);
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 + SUN.r && x >= 0 && x < VW){ const c2 = (dx + 10) * (dx + 10) + (dy + 10) * (dy + 10);
      idx[y * VW + x] = d2 > (SUN.r - 3) * (SUN.r - 3) ? 7 : c2 < 676 || (c2 < 1024 && by(x, y) < 8) ? 9 : 8; }
  }
  // smoke bands (wavy, tapered, 1 px dithered fringe): over the sun two steps darker, elsewhere one; up in the dark sky the
  // streaks catch the dome light instead: one step LIGHTER at a sparse dither (the draft's lighter streaks up there)
  const rr = rng(7), bands = SUN_BANDS.map(b => [...b, -1]);
  for (let i = 0; i < 12; i++){ const y = -20 + rr() * 270 | 0, x0 = rr() * (VW + 180) - 180 | 0; bands.push([y, x0, x0 + 270 + rr() * 450 | 0, 3 + rr() * 8 | 0, y < 100 ? 1 : -1]); }
  bands.forEach(([y, x0, x1, th, n], bi) => {
    for (let x = Math.max(0, x0); x < Math.min(VW, x1); x++){
      const t = Math.min(th, Math.round(th * Math.min(x - x0, x1 - x) / 69)); if (t <= 0) continue;
      const yc = y + Math.round(3.75 * Math.sin(x / 91.5 + bi) + 2.25 * Math.sin(x / 34.5 + 2 * bi)), ya = yc - (t >> 1);
      for (let j = 0; j < t; j++){ const Y = ya + j, edge = t > 2 && (j === 0 || j === t - 1), dx = x - SUN.x, dy = Y - SUN.y;
        if (n > 0 ? by(x, Y) < (edge ? 2 : 5) : (!edge || by(x, Y) < 8)) shift(x, Y, n < 0 && dx * dx + dy * dy <= r2 ? -2 : n); }
    }
  });
  const img = g.createImageData(VW, VH), d = new Uint32Array(img.data.buffer), word = P.map(wordOf);
  for (let i = 0; i < VW * VH; i++) d[i] = word[idx[i]];
  g.putImageData(img, 0, 0); sky = c;
}

// ---------- patrol airship ----------
// A Zeppelin with the regime emblem on a red hull band: the doped hull shaded per pixel with RAMP.hull (lit from the upper left,
// posterised into clean bands with a 1 px dithered seam between them), ring frames every 21 px and the longitudinal gores between
// the fabric panels as 1 px seams one step darker, the nose cap and tail cone, tail fins with the red rudder, a gondola with
// lit windows (one dark) and the searchlight housing and lens under its nose, two engine pods on struts (propellers turn in
// drawShip), a 1 px contour. Nose to the right (it drifts right). SHIP geometry in its own px; the contoured canvas is drawn at
// (X - 1, Y - 1). beam = the reach of its searchlight past the hull (px), for culling.
const SHIP = { w: 282, h: 108, cy: 42, xm: 138, len: 126, hh: 33, lens: [183, 92], nav: [12, 8], props: [[76, 66], [190, 64]], beam: 560 };
const hullH = x => { const u = (x - SHIP.xm) / SHIP.len; return Math.abs(u) >= 1 ? 0 : Math.round(SHIP.hh * Math.sqrt(1 - Math.pow(Math.abs(u), x < SHIP.xm ? 2.4 : 1.8))); };
function buildAirship(){
  const { w, h, cy } = SHIP, [c, g] = mk(w, h);
  // fins first (the hull overlaps their roots): upper and lower (seen from the side), the edge-on stabiliser, the red rudder
  g.fillStyle = HU[3]; poly(g, [18, cy - hullH(18) + 3, 7, cy - 33, 36, cy - 33, 75, cy - hullH(75) + 3]);
  g.fillStyle = HU[2]; poly(g, [18, cy + hullH(18) - 3, 7, cy + 33, 36, cy + 33, 75, cy + hullH(75) - 3]);
  R(g, 7, cy - 33, 29, 1, HU[5]); R(g, 7, cy + 32, 29, 1, HU[1]); g.fillStyle = HU[4]; line(g, 36, cy - 33, 75, cy - hullH(75) + 3);
  for (const fy of [cy - 24, cy - 16, cy + 16, cy + 24]) R(g, 9, fy, 24, 1, fy < cy ? HU[2] : HU[1]);                 // fin ribs
  // the rudders, hinged on the fins' trailing edges (the regime's red): ribs along the chord every 4 px, lit top and trailing
  // edges, the hinge a dark seam; the lower one in the hull's shadow a step darker
  for (let j = 0; j < 14; j++){ const xl = 5 + Math.round(j * 2 / 13);
    R(g, xl, cy - 32 + j, 17 - xl, 1, j === 0 ? BN[3] : j % 4 === 3 ? BN[1] : BN[2]); R(g, xl, cy - 32 + j, 1, 1, BN[3]);
    R(g, xl, cy + 19 + j, 17 - xl, 1, j === 0 ? BN[2] : j === 13 ? BN[0] : j % 4 === 2 ? BN[0] : BN[1]); R(g, xl, cy + 19 + j, 1, 1, BN[2]); }
  R(g, 17, cy - 32, 1, 14, HU[1]); R(g, 17, cy + 19, 1, 14, HU[0]);
  R(g, 3, cy - 2, 51, 3, HU[2]); R(g, 3, cy - 2, 51, 1, HU[4]); R(g, 3, cy, 51, 1, HU[1]);
  // hull: five bands of light; the Bayer term only decides the 1 px seam where two bands meet
  for (let x = SHIP.xm - SHIP.len + 1; x < SHIP.xm + SHIP.len; x++){
    const hh = hullH(x); if (!hh) continue; const s = (x - SHIP.xm) / SHIP.len;
    for (let y = -hh; y <= hh; y++){
      const t = y / hh, v = 0.64 - 0.56 * t - 0.14 * s + (by(x, cy + y) / 16 - 0.5) * 0.05;
      let k = Math.max(0, Math.min(4, Math.round(v * 4)));
      if ((x - 12) % 21 === 0 && Math.abs(t) < 0.9 && k > 0) k--;                     // ring frame
      for (const gq of [-0.72, -0.4, 0.4]) if (Math.round(gq * hh) === y && k > 0 && Math.abs(s) < 0.94) k--;   // gores
      const band = x >= 174 && x < 186;                                                // the red emblem band
      g.fillStyle = band ? (k >= 3 ? BN[3] : k >= 1 ? BN[2] : BN[1]) : y === -hh && s < 0.4 ? HU[6] : y === hh ? HU[1] : HU[1 + k];
      g.fillRect(x, cy + y, 1, 1);
    }
  }
  for (let y = -3; y <= 3; y++) R(g, SHIP.xm + SHIP.len - 4 + Math.abs(y) - 2, cy + y, 3, 1, y < 0 ? HU[4] : HU[2]);   // nose cap
  emblem(g, 180, cy - 5, 10);
  // engine pods on struts, the gondola (lit windows, a dark one, the searchlight housing and lens under the nose)
  for (const [px, py] of SHIP.props){ g.fillStyle = HU[1]; line(g, px + 9, py - 3, px + 13, cy + hullH(px + 12) - 3); line(g, px + 10, py - 3, px + 14, cy + hullH(px + 12) - 3);
    R(g, px + 1, py - 3, 18, 7, HU[2]); R(g, px + 2, py - 3, 16, 1, HU[4]); R(g, px + 1, py + 3, 18, 1, HU[1]); R(g, px + 17, py - 2, 3, 5, HU[3]); R(g, px + 19, py - 1, 1, 3, HU[4]);
    for (let i = px + 4; i < px + 16; i += 3) R(g, i, py, 1, 2, HU[1]); }                                             // cooling slots
  const gx = 111, gy = cy + 28;
  R(g, gx, gy, 69, 15, HU[2]); R(g, gx, gy, 69, 1, HU[4]); R(g, gx, gy + 1, 1, 12, HU[3]); R(g, gx + 1, gy + 12, 67, 3, HU[1]);
  R(g, gx + 69, gy + 1, 4, 11, HU[2]); R(g, gx + 73, gy + 3, 2, 7, HU[2]); R(g, gx + 75, gy + 5, 1, 4, HU[1]); R(g, gx + 69, gy + 1, 4, 1, HU[4]);
  g.fillStyle = HU[1]; line(g, gx + 4, gy, gx + 10, cy + hullH(gx + 10) - 2); line(g, gx + 62, gy, gx + 56, cy + hullH(gx + 56) - 2);
  for (let i = 0; i < 10; i++){ const wx = gx + 5 + i * 6; R(g, wx, gy + 4, 4, 5, i === 7 ? HU[0] : LA[2]); if (i !== 7){ R(g, wx, gy + 7, 4, 2, LA[1]); R(g, wx, gy + 4, 1, 1, LA[3]); } }
  R(g, SHIP.lens[0] - 5, SHIP.lens[1] - 5, 9, 4, HU[1]); R(g, SHIP.lens[0] - 4, SHIP.lens[1] - 5, 7, 1, HU[3]); R(g, SHIP.lens[0] - 2, SHIP.lens[1] - 1, 4, 1, LA[4]); R(g, SHIP.lens[0] - 2, SHIP.lens[1] - 1, 1, 1, SG[2]);
  ship = outline(c, HU[0]);
}
// propeller frames: a blade edge-on, then the blur disc (3 phases), drawn at a pod's rear
function propeller(ctx, x, y, t){
  const k = (t >> 1) % 3;
  if (k === 0) R(ctx, x, y - 8, 1, 17, HU[4]); else if (k === 1){ R(ctx, x, y - 6, 1, 5, HU[4]); R(ctx, x, y + 2, 1, 5, HU[4]); } else R(ctx, x, y - 2, 1, 5, HU[5]);
}

// ---------- builders shared by the layers ----------
// HEADFRAMES: the lattice headframes (Fördergerüste) of the layers, [layer, x, gy, w, h, r, strut, sun, rope]: legs from the
// ground row gy (x .. x + w) up to the deck h over it, sheave radius r, strut = +-1 a raking back-strut to the right / left, sun:
// a 1 px warm rim down the sun-facing (right) leg, rope = [x, y] where the winding ropes run off the sheaves to (the engine
// house's drum; layer px). bg.build's opt.headframe may lay a sprite in their place (see the API). (The third midfar one stands
// clear of the hero's body at the D drums' spot: its legs would converge right behind him there.)
const HEADFRAMES = [
  ['midfar', 780, 570, 66, 162, 14, 1, false, [880, 540]], ['midfar', 1560, 570, 66, 162, 14, 1, false, [1660, 540]], ['midfar', 2150, 570, 66, 162, 14, 1, false, [2250, 540]],
  ['mid', 450, 594, 138, 378, 25, 1, true, [742, 452]], ['mid', 3669, 594, 108, 321, 20, 0, true, [3870, 470]]
];
// Lattice headframe, painted: two 3 px legs (lit outer chord on the left, shaded on the right) tapering from the ground to the
// deck, a girt every `step` px with a gusset plate (a lit pixel) at each joint and 1 px X-bracing in every panel, the deck (lit
// top, railing), the sheaves' pedestals, the hoist ropes (down the shaft between the legs, and off the sheaves' tops to the
// engine), and with strut a raking back-strut of two laced chords. Ramp k = [dark, brace, body, lit, rim] steps; the sheave rims
// are painted here (2 px, shaded), their spokes turn as anims; a mast between them carries the warning lamp. Returns { anims,
// lamps }.
function headframe(g, layer, x, gy, w, h, r, strut, k, sun, rope){
  const inset = Math.round(w * 0.28), tl = x + inset, tr = x + w - inset, ty = gy - h, step = Math.max(14, Math.round(h / 12));
  const [dk, br, bd, lt, hi] = k, legX = (y, side) => Math.round(side < 0 ? x + inset * (gy - y) / h : x + w - inset * (gy - y) / h);
  let prev = { lx: x, rx: x + w, y: gy };
  for (let y = gy - step; y > ty + 6; y -= step){
    const lx = legX(y, -1), rx = legX(y, 1);
    g.fillStyle = br; line(g, prev.lx + 2, prev.y - 1, rx - 2, y + 1); line(g, prev.rx - 2, prev.y - 1, lx + 2, y + 1);
    R(g, lx, y, rx - lx + 1, 1, bd); R(g, lx + 3, y + 1, rx - lx - 5, 1, dk); R(g, lx + 1, y - 1, 2, 1, hi); R(g, rx - 2, y - 1, 2, 1, lt);
    prev = { lx, rx, y };
  }
  g.fillStyle = br; line(g, prev.lx + 2, prev.y - 1, tr - 2, ty + 1); line(g, prev.rx - 2, prev.y - 1, tl + 2, ty + 1);
  // legs: three chords each, the left one lit on its outer face, the right one shaded on its outer face
  g.fillStyle = lt; line(g, x, gy, tl, ty); g.fillStyle = bd; line(g, x + 1, gy, tl + 1, ty); g.fillStyle = dk; line(g, x + 2, gy, tl + 2, ty);
  g.fillStyle = bd; line(g, x + w - 2, gy, tr - 2, ty); line(g, x + w - 1, gy, tr - 1, ty); g.fillStyle = dk; line(g, x + w, gy, tr, ty);
  if (sun){ g.fillStyle = SK[5]; line(g, tr + 1, ty + 3, Math.round(tr + (x + w - tr) * 0.45) + 1, Math.round(ty + h * 0.45)); }
  if (strut){
    const sx = strut > 0 ? x + w + Math.round(h * 0.5) : x - Math.round(h * 0.5), ax = strut > 0 ? tr : tl, d = Math.max(7, Math.round(h * 0.04));
    g.fillStyle = bd; line(g, ax, ty + 3, sx, gy); line(g, ax + strut, ty + 3, sx + strut, gy); g.fillStyle = dk; line(g, ax, ty + 3 + 2 * d, sx - 2 * d * strut, gy);
    g.fillStyle = br; for (let i = 1; i < 14; i++){ const t0 = i / 14, t1 = (i + 0.5) / 14;
      line(g, ax + (sx - ax) * t0, ty + 3 + (gy - ty - 3) * t0, ax + (sx - 2 * d * strut - ax) * t1, ty + 3 + 2 * d + (gy - ty - 3 - 2 * d) * t1); }
  }
  // deck with railing; the sheaves on their pedestals (2 px rims: lit upper left, dark lower right; an inner ring); hoist ropes
  const dx0 = tl - Math.round(r * 0.5), dw = tr - tl + Math.round(r), wy = ty - 6 - r;
  R(g, dx0, ty - 4, dw, 4, bd); R(g, dx0, ty - 4, dw, 1, lt); R(g, dx0, ty - 1, dw, 1, dk); for (let i = dx0 + 2; i < dx0 + dw; i += 5) R(g, i, ty - 3, 1, 2, br);
  for (let i = dx0; i < dx0 + dw; i += 6) R(g, i, ty - 11, 1, 7, br); R(g, dx0, ty - 11, dw, 1, bd); R(g, dx0, ty - 7, dw, 1, br);
  const wheels = [{ x: tl + 3, y: wy, r }, { x: tr - 3, y: wy, r }];
  // the cage ropes drop off each sheave's left side: the right one's into the shaft between the legs, the left one's through the deck
  g.fillStyle = dk; for (const wl of wheels) line(g, wl.x - r + 1, wl.y + 2, wl.x - r + 1, wl.x - r + 1 > tl + 2 ? gy - Math.round(h * 0.12) : ty - 4);
  if (rope) for (const wl of wheels){ g.fillStyle = dk; line(g, wl.x + Math.round(r * 0.55), wl.y - Math.round(r * 0.83), rope[0], rope[1]); }
  for (const wl of wheels){ rim(g, wl.x, wl.y, wl.r, shade3(hi, lt, bd)); rim(g, wl.x, wl.y, wl.r - 1, shade3(lt, bd, dk)); rim(g, wl.x, wl.y, wl.r - 4, shade3(bd, br, dk));
    const pw = Math.max(4, Math.round(r * 0.3));                                  // the bearing trestle: two raking legs, a brace
    g.fillStyle = lt; line(g, wl.x - pw, ty - 5, wl.x - 1, wl.y + 3); g.fillStyle = bd; line(g, wl.x + pw, ty - 5, wl.x + 1, wl.y + 3);
    R(g, wl.x - Math.round(pw / 2), Math.round((ty - 5 + wl.y) / 2) + 2, pw + 1, 1, br); R(g, wl.x - 2, wl.y + 2, 5, 3, bd); R(g, wl.x - 2, wl.y + 2, 5, 1, lt); }
  const mx = Math.round((tl + tr) / 2), my = wy - r - 6; R(g, mx, my, 1, ty - 11 - my, br); R(g, mx - 1, ty - 13, 3, 2, bd);
  const strip = spokeStrip(r, k);
  return { anims: wheels.map((wl, i) => ({ x: wl.x - r, y: wl.y - r, strip: strip.c, n: strip.n, spin: SPIN[layer] * (i & 1 ? -1 : 1) })), lamps: [{ x: mx, y: my - 1 }] };
}
const SPIN = { midfar: 0.04, mid: 0.05 };
// The turning part of a sheave whose rims are painted in the layer: 3 diameters (6 spokes) inside the inner ring and the hub,
// one frame per px the spoke tips move (r x 60 degrees), side by side: { c, n }. Built once per radius and ramp.
const STRIPS = new Map();
function spokeStrip(r, k){
  const key = r + k.join(); let s = STRIPS.get(key); if (s) return s;
  const n = Math.max(6, Math.round(r * Math.PI / 3)), fw = 2 * r + 1, [c, g] = mk(fw * n, fw), [dk, , bd, lt, hi] = k;
  for (let f = 0; f < n; f++){ const ox = f * fw + r, a0 = f / n * Math.PI / 3, e = r - 5;
    g.fillStyle = bd; for (let i = 0; i < 3; i++){ const a = a0 + i * Math.PI / 3, cs = Math.cos(a) * e, sn = Math.sin(a) * e; line(g, ox - cs, r - sn, ox + cs, r + sn); }
    disc(g, ox, r, Math.max(2, Math.round(r * 0.14)), bd); R(g, ox - 1, r - 1, 1, 1, hi); R(g, ox + 1, r + 1, 1, 1, dk); R(g, ox, r, 1, 1, lt); }
  s = { c, n }; STRIPS.set(key, s); return s;
}
// opt.headframe's sprite or the painted lattice, for HEADFRAMES entry hf on layer canvas g -> { anims, lamps } either brings
let HFSPR = null;
function placeHeadframe(g, hf, k){
  const [layer, x, gy, w, h, r, strut, sun, rope] = hf, spr = HFSPR && HFSPR({ layer, x, gy, w, h, r, strut, sun, rope });
  if (spr){ g.drawImage(spr.img, spr.x, spr.y); return { anims: spr.anims || [], lamps: spr.lamps || [] }; }
  return headframe(g, layer, x, gy, w, h, r, strut, k, sun, rope);
}
// Mid-scale brick (SCALE.mid: 8 x 3 bricks, 1 px mortar, 4 px courses, running bond) in the silhouette steps (body mbrick[1],
// mortar mbrick[0]) as a pattern anchored to the layer; from 2 rows over the fog's highest edge down the wall is flat body: the
// fog drops the texture, the structure painted over it stays (see ROLES).
let brickPat = null;
function brick(g, x, y, w, h){
  if (!brickPat){ const [t, tg] = mk(9, 8); R(tg, 0, 0, 9, 8, MB[1]); R(tg, 0, 3, 9, 1, MB[0]); R(tg, 0, 7, 9, 1, MB[0]); R(tg, 8, 0, 1, 3, MB[0]); R(tg, 3, 4, 1, 3, MB[0]);
    brickPat = g.createPattern(t, 'repeat'); }
  const yf = Math.max(y, Math.min(y + h, FOG_Y - 4));
  g.fillStyle = brickPat; g.fillRect(x, y, w, yf - y); R(g, x, yf, w, y + h - yf, MB[1]);
}
// A window at mid scale (27 x 42): a segmental arch header and a sill a step lighter than the wall, a dark reveal; kind 'lit' =
// warm glass (a lamp low in the room: the lower part brighter) with a dark brown casement cross and a curtain drawn half
// across, 'dark' = black glass with a glint of the sky up left and a grey casement cross, 'shut' = closed board shutters with
// louvres.
function midWindow(g, x, y, kind){
  R(g, x - 2, y - 3, 31, 3, MB[2]); R(g, x - 1, y - 4, 29, 1, MB[2]); R(g, x + 3, y - 5, 21, 1, MB[3]); R(g, x - 1, y - 4, 4, 1, MB[3]);   // arch header
  R(g, x - 3, y + 42, 33, 3, MB[2]); R(g, x - 3, y + 42, 33, 1, MB[3]); R(g, x - 2, y + 45, 31, 1, MB[0]);                          // sill
  R(g, x, y, 27, 42, MB[0]);                                                                                                           // reveal
  const gx = x + 2, gy = y + 1, gw = 24, gh = 40;
  if (kind === 'lit'){ R(g, gx, gy, gw, gh, LA[1]); R(g, gx, gy + 18, gw, gh - 18, LA[2]); R(g, gx + 2, gy + 26, gw - 4, 8, LA[3]);
    R(g, gx + gw - 7, gy, 7, gh, LA[0]); R(g, gx + gw - 7, gy, 1, gh, MB[0]);                                                     // curtain
    R(g, gx + 11, gy, 2, gh, MB[0]); R(g, gx, gy + 13, gw, 2, MB[0]); R(g, gx, gy, gw, 1, MB[0]); }
  else if (kind === 'shut'){ R(g, gx, gy, gw, gh, WD[1]); R(g, gx, gy, 1, gh, WD[2]); R(g, gx + 12, gy, 1, gh, WD[0]);
    for (let j = gy + 3; j < gy + gh; j += 4){ R(g, gx + 1, j, 11, 1, WD[0]); R(g, gx + 13, j, 11, 1, WD[0]); } R(g, gx + 10, gy + 18, 1, 3, WD[3]); }
  else { R(g, gx, gy, gw, gh, SM[0]); R(g, gx + 2, gy + 2, 4, 1, SK[2]); R(g, gx + 2, gy + 3, 1, 3, SK[2]); R(g, gx + 15, gy + 2, 3, 1, SK[1]);
    R(g, gx + 11, gy, 2, gh, SM[2]); R(g, gx, gy + 13, gw, 2, SM[2]); }
}
// A familok at the mid layer's scale, a silhouette against the sunset: facade x .. x + w standing on gy, `fl` storeys of 93 px
// under a cornice, a slate roof rh tall (hipped: opt.hip = the hips' share of rh), dormers, chimneys, a string course at every
// floor, windows from the seeded stream (opt.lit = share lit, else dark, or a run of shuttered flats on one floor), a door on the
// street row. opt.bays: window columns; opt.gable: a blind upper wall (the poster's) instead of the top two rows of windows;
// opt.risalit: a projecting central bay of two window columns rising 51 px over the cornice into a gable with an oculus (the
// colony's Nikiszowiec look); opt.dormers, opt.chimneys: dormer count, chimney positions (0..1 of w); opt.wo: the windows' top
// under their storey's string course (27; the colony's 35 keeps its headers and sills off the C roofs). Returns the chimney tops.
const ST_H = 93;
function familok(g, x, gy, w, fl, rr, opt = {}){
  const eave = gy - fl * ST_H - 12, rh = opt.rh || 45, nwin = opt.bays || Math.max(2, Math.round(w / 48)), gap = (w - nwin * 27) / (nwin + 1);
  const rw = 84, xr = Math.round(x + (w - rw) / 2), inBay = wx => opt.risalit && wx + 27 > xr - 6 && wx < xr + rw + 6;
  brick(g, x, eave, w, gy - eave);
  R(g, x, eave, 1, gy - eave, MB[3]); R(g, x + 1, eave, 2, gy - eave, MB[2]); R(g, x + w - 1, eave, 1, gy - eave, MB[0]);    // lit / shaded corners
  for (let y = eave + 18; y < gy; y += 8) R(g, x + 1, y, 3, 1, MB[0]);                                                          // quoins
  for (let f = 1; f < fl; f++){ const y = eave + 12 + f * ST_H; R(g, x, y, w, 2, MB[2]); R(g, x, y, w, 1, MB[3]); R(g, x, y + 2, w, 1, MB[0]); }   // string courses
  R(g, x - 4, eave, w + 8, 3, MB[2]); R(g, x - 4, eave, w + 8, 1, MB[3]); R(g, x - 4, eave + 3, w + 8, 5, MB[1]); R(g, x - 3, eave + 8, w + 6, 3, MB[0]);   // cornice
  for (let i = x - 2; i < x + w + 2; i += 5) R(g, i, eave + 4, 2, 3, MB[0]);                                                   // dentils
  const shutF = rr() < 0.6 ? Math.floor(rr() * fl) : -1, shutI = Math.floor(rr() * nwin);
  for (let f = 0; f < fl; f++) for (let i = 0; i < nwin; i++){
    const wx = Math.round(x + gap + i * (27 + gap)), wy = eave + 12 + f * ST_H + (opt.wo || 27);
    if ((opt.gable && f < 2) || inBay(wx)) continue;
    if (f === fl - 1 && i === (nwin >> 1)){                                                   // the street door (39 x 78)
      const dx = wx - 6, dy = gy - 78;
      R(g, dx - 4, dy - 6, 47, gy - dy + 6, MB[2]); R(g, dx - 4, dy - 6, 47, 1, MB[3]); R(g, dx - 4, dy - 6, 1, gy - dy + 6, MB[3]);
      R(g, dx, dy, 39, 78, WD[1]); R(g, dx, dy, 39, 1, WD[2]); R(g, dx, dy, 1, 78, WD[2]); R(g, dx + 19, dy + 15, 1, 63, WD[0]);
      R(g, dx + 2, dy + 2, 35, 11, rr() < 0.6 ? LA[1] : SM[1]); R(g, dx + 2, dy + 13, 35, 2, WD[0]); R(g, dx + 19, dy + 2, 1, 11, WD[0]);
      for (const px of [dx + 4, dx + 23]){ R(g, px, dy + 20, 12, 22, WD[0]); R(g, px + 1, dy + 21, 11, 21, WD[1]); R(g, px, dy + 48, 12, 22, WD[0]); R(g, px + 1, dy + 49, 11, 21, WD[1]); }
      R(g, dx + 16, dy + 44, 2, 3, PA[1]); R(g, dx - 4, gy - 3, 47, 3, MB[3]); continue; }
    const lit = rr() < (opt.lit ?? 0.3);
    midWindow(g, wx, wy, lit ? 'lit' : f === shutF && Math.abs(i - shutI) <= 1 ? 'shut' : 'dark');
  }
  // roof: hipped slate (lit left hip, shaded right hip, slate courses with staggered joints), ridge, gutter shadow
  const rx0 = x - 6, rx1 = x + w + 6, ry = eave - rh, ins = Math.round(rh * (opt.hip ?? 0.7));
  g.fillStyle = SM[3]; poly(g, [rx0, eave, rx1, eave, rx1 - ins, ry, rx0 + ins, ry]);
  for (let y = ry + 4, n = 0; y < eave; y += 4, n++){ const k = Math.round(ins * (eave - y) / rh); R(g, rx0 + k, y, rx1 - rx0 - 2 * k, 1, SM[2]);
    for (let i = rx0 + k + (n & 1 ? 4 : 0); i < rx1 - k; i += 8) R(g, i, y - 3, 1, 3, SM[2]); }
  g.fillStyle = SM[4]; poly(g, [rx0, eave, rx0 + ins, ry, rx0 + ins + 4, ry, rx0 + 9, eave]);
  g.fillStyle = SM[2]; poly(g, [rx1, eave, rx1 - ins, ry, rx1 - ins - 4, ry, rx1 - 9, eave]);
  R(g, rx0 + ins, ry, rx1 - rx0 - 2 * ins, 1, SM[5]); R(g, rx0 + ins, ry + 1, rx1 - rx0 - 2 * ins, 1, SM[4]); R(g, rx0, eave - 2, rx1 - rx0, 2, SM[1]);
  if (opt.risalit){                    // the bay: lit left edge, its shadow cast right, a cornice 51 px over the eave, gable + oculus
    const bt = eave - 51, gt = bt - 30;
    brick(g, xr, bt, rw, gy - bt); g.fillStyle = brickPat; poly(g, [xr, bt, xr + rw, bt, xr + rw / 2, gt]);
    R(g, xr, bt, 1, gy - bt, MB[3]); R(g, xr + 1, bt, 2, gy - bt, MB[2]); R(g, xr + rw - 1, bt, 1, gy - bt, MB[0]); R(g, xr + rw, eave + 12, 3, gy - eave - 12, MB[0]);
    g.fillStyle = MB[3]; line(g, xr - 3, bt + 1, xr + rw / 2, gt - 1); line(g, xr - 3, bt + 2, xr + rw / 2, gt); g.fillStyle = MB[0]; line(g, xr + rw / 2, gt - 1, xr + rw + 3, bt + 1);
    R(g, xr - 3, bt, rw + 6, 3, MB[2]); R(g, xr - 3, bt, rw + 6, 1, MB[3]); R(g, xr - 3, bt + 3, rw + 6, 2, MB[0]);
    disc(g, xr + rw / 2, gt + 17, 6, MB[2]); disc(g, xr + rw / 2, gt + 17, 4, rr() < 0.5 ? LA[1] : SM[0]); R(g, xr + rw / 2 - 4, gt + 17, 9, 1, MB[2]); R(g, xr + rw / 2, gt + 13, 1, 9, MB[2]);
    for (let f = 0; f < fl - 1; f++) for (const wx of [xr + 12, xr + rw - 39]) midWindow(g, wx, eave + 12 + f * ST_H + (opt.wo || 27), rr() < (opt.lit ?? 0.3) ? 'lit' : 'dark');
    const dx = xr + rw / 2 - 17, dy = gy - 84;                                          // the colony's arched door in the bay
    R(g, dx - 3, dy - 3, 40, gy - dy + 3, MB[2]); R(g, dx - 3, dy - 4, 40, 1, MB[3]); R(g, dx, dy, 34, gy - dy, WD[1]); R(g, dx, dy, 34, 1, WD[2]); R(g, dx + 17, dy + 1, 1, gy - dy - 1, WD[0]);
    R(g, dx + 2, dy + 2, 30, 9, rr() < 0.6 ? LA[1] : SM[1]); R(g, dx + 2, dy + 11, 30, 1, WD[0]);
  }
  // the downpipe at the east corner: a hopper head under the gutter, brackets every 31 px, a shoe at the foot
  { const dx = x + w - 8; R(g, dx, eave + 12, 3, gy - eave - 15, SM[2]); R(g, dx, eave + 12, 1, gy - eave - 15, SM[4]); R(g, dx + 2, eave + 12, 1, gy - eave - 15, SM[1]);
    R(g, dx - 2, eave + 8, 7, 5, SM[2]); R(g, dx - 2, eave + 8, 7, 1, SM[4]); R(g, dx - 1, gy - 4, 6, 4, SM[2]); R(g, dx - 1, gy - 4, 6, 1, SM[3]);
    for (let y = eave + 30; y < gy - 8; y += 31) R(g, dx - 1, y, 5, 2, SM[1]); }
  const tops = [], nd = opt.dormers ?? Math.max(1, nwin - 3);
  for (let i = 0; i < nd; i++){                                                    // dormers: cheeks, a pent roof, a casement
    const dxp = Math.round(x + w * (i + 1) / (nd + 1)) - 9, dy = eave - 21;
    R(g, dxp, dy, 18, 19, MB[1]); R(g, dxp, dy, 1, 19, MB[3]); R(g, dxp + 17, dy, 1, 19, MB[0]); g.fillStyle = SM[4]; poly(g, [dxp - 3, dy, dxp + 21, dy, dxp + 9, dy - 10]);
    g.fillStyle = SM[2]; poly(g, [dxp + 9, dy - 10, dxp + 21, dy, dxp + 15, dy]);
    R(g, dxp + 4, dy + 4, 10, 12, MB[0]); R(g, dxp + 5, dy + 5, 8, 11, rr() < 0.4 ? LA[1] : SM[0]); R(g, dxp + 8, dy + 5, 2, 11, MB[0]); R(g, dxp + 5, dy + 9, 8, 1, MB[0]);
  }
  for (const fx0 of opt.chimneys || [0.22, 0.78]){
    const cx = Math.round(x + w * fx0) - 6, ct = ry - 12 - (rr() * 9 | 0), ch = eave - ct - 9;
    R(g, cx, ct, 13, ch, MB[1]); R(g, cx, ct, 3, ch, MB[2]); R(g, cx, ct, 1, ch, MB[3]); R(g, cx + 12, ct, 1, ch, MB[0]);
    for (let y = ct + 4; y < ct + ch; y += 4) R(g, cx + 3, y, 9, 1, MB[0]);
    R(g, cx - 2, ct - 4, 17, 4, SM[2]); R(g, cx - 2, ct - 4, 17, 1, SM[4]); R(g, cx - 2, ct - 1, 17, 1, SM[1]); R(g, cx + 4, ct - 6, 5, 2, SM[1]); R(g, cx + 4, ct - 6, 5, 1, SM[3]);
    tops.push({ x: cx + 6, y: ct - 6 });
  }
  return tops;
}
// Ruler of lit / dark window slits of a far / midfar facade: rows every dy, columns every dx, lit with probability p.
function slits(g, x0, y0, x1, y1, dx, dy, w, h, p, lit, dark, seed){
  for (let y = y0; y + h <= y1; y += dy) for (let x = x0; x + w <= x1; x += dx){ const q = hash(x * 3 + seed, y); R(g, x, y, w, h, q < p ? lit : dark); }
}
// Lettering of the mid layer (SCALE.mid: 9 px caps, the playfield signs' 10 px font x ~0.65 of their 16 px em), hand-drawn: 1 px
// stems, a 1 px drop shadow down-right in a darker ink so the strokes read bold at a distance. Only the letters the scene needs.
const MIDFONT = {
  K: ['X....X', 'X...X.', 'X..X..', 'X.X...', 'XX....', 'X.X...', 'X..X..', 'X...X.', 'X....X'],
  O: ['.XXXX.', 'X....X', 'X....X', 'X....X', 'X....X', 'X....X', 'X....X', 'X....X', '.XXXX.'],
  H: ['X....X', 'X....X', 'X....X', 'X....X', 'XXXXXX', 'X....X', 'X....X', 'X....X', 'X....X'],
  L: ['X.....', 'X.....', 'X.....', 'X.....', 'X.....', 'X.....', 'X.....', 'X.....', 'XXXXXX'],
  E: ['XXXXXX', 'X.....', 'X.....', 'X.....', 'XXXXX.', 'X.....', 'X.....', 'X.....', 'XXXXXX'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  S: ['.XXXXX', 'X.....', 'X.....', 'X.....', '.XXXX.', '.....X', '.....X', '.....X', 'XXXXX.'],
  T: ['XXXXXXX', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...'],
  G: ['.XXXXX', 'X.....', 'X.....', 'X.....', 'X..XXX', 'X....X', 'X....X', 'X....X', '.XXXX.']
};
function midText(g, s, x, y, ink, shadow){
  for (const [col, dx] of [[shadow, 1], [ink, 0]]){ let ox = x + dx;
    for (const ch of s){ const gl = MIDFONT[ch]; g.fillStyle = col; gl.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'X') g.fillRect(ox + i, y + j + dx, 1, 1); }); ox += gl[0].length + 2; } }
}

// ---------- far layer (0.15): slag heaps, a skyline of works, chimneys with warning lamps, the Gauturm ----------
function buildFar(){
  const lw = 2700, hz = 546, [c, g] = mk(lw, LH, true), rr = rng(21);
  // slag heaps (hałdy): cones on the wrap, each at its own depth (z: where two overlap, the nearer one's flank cuts across the
  // farther one, a slanted edge, not a seam down a column), with an irregular crest (value noise along the skyline) and tipping
  // notches (bites where the skips dump). Each cone is lit from the upper left: its terminator runs from the apex down to a third
  // of the right flank's width at the foot (a straight line on a cone), lit (dusk[3]) left of it, shaded (dusk[2]) right, its
  // crest (and the edge where it stands in front of another) a step lighter; a few gullies run down its fall lines (rays from the
  // apex: a short meandering groove with a lit lip on its upper-left side), a few short lit rubble ledges; the two tallest carry a
  // tipping incline
  const cones = Array.from({ length: 7 }, (_, j) => ({ cx: rr() * lw, h: 96 + rr() * 123, s: 0.42 + rr() * 0.3, z: hash(j, 93) }));
  const wrapD = (x, q) => { let d0 = x - q.cx; if (Math.abs(d0) > lw / 2) d0 -= Math.sign(d0) * lw; return d0; };
  const crest = x => (noise(x / 13.5, 3) - 0.5) * 9 + (noise(x / 46.5, 5) - 0.5) * 12 - (hash(x / 6 | 0, 41) < 0.07 ? 4 : 0);
  const tops = new Int16Array(lw);
  // the cones over column x, nearest last: [cone, its d, its top row]
  const over = x => cones.map((q, j) => { const d = wrapD(x, q), tp = q.h - Math.abs(d) * q.s; return [j, d, tp > 9 ? hz - Math.round(tp + crest(x)) : hz - Math.round(tp)]; })
    .filter(([, , y]) => y < hz).sort((A, B) => cones[A[0]].z - cones[B[0]].z);
  const ownerAt = (x, y) => { let o = -1; for (const [j, , y0] of over(x)) if (y >= y0) o = j; return o; };
  for (let x = 0; x < lw; x++){                                                  // far cones first, the nearer painted over them
    const ov = over(x); if (!ov.length) continue; tops[x] = hz - Math.min(...ov.map(e => e[2]));
    for (const [j, d, y0] of ov){ const q = cones[j], yt = d <= 0 ? y0 : Math.max(y0, Math.min(hz, Math.round(hz - q.h + d * q.s * 3)));   // the terminator's row
      R(g, x, y0, 1, yt - y0, DU[2]); R(g, x, yt, 1, hz - yt, DU[3]); R(g, x, y0, 1, 1, yt > y0 ? DU[3] : DU[4]); if (yt === y0) R(g, x, y0 + 1, 1, 1, DU[4]); }
  }
  const wr = x => ((x % lw) + lw) % lw, inHeap = (x, y, j) => ownerAt(wr(x), y) === j && y > hz - tops[wr(x)] + 2 && y < hz - 3;
  cones.forEach((q, j) => { for (let i = 0; i < 3; i++){                       // gullies down the fall lines: short, meandering, widest mid-way
    const a = (hash(j, i + 50) - 0.5) * 1.4, lit = a < 1 / 3, D0 = q.h * (0.2 + hash(i, j + 50) * 0.2), D1 = D0 + q.h * (0.22 + hash(j + 50, i) * 0.2);
    for (let D = Math.round(D0); D < D1; D++){ const u = (D - D0) / (D1 - D0), x = Math.round(q.cx + a * D / q.s + (noise(D / 9, i + j * 5, 61) - 0.5) * 4), y = Math.round(hz - q.h + D), gw = u > 0.25 && u < 0.7 ? 2 : 1;
      if (inHeap(x - 1, y, j) && inHeap(x + gw, y, j)){ R(g, wr(x), y, 1, 1, lit ? DU[1] : DU[0]); if (gw > 1) R(g, wr(x + 1), y, 1, 1, lit ? DU[2] : DU[1]); R(g, wr(x - 1), y, 1, 1, lit ? DU[4] : DU[3]); } } } });
  for (let i = 0; i < 22; i++){ const x = Math.round(hash(i, 77) * lw), t = tops[x]; if (t < 45) continue;   // lit rubble ledges
    const y = hz - Math.round(t * (0.3 + hash(77, i) * 0.5)), n = 4 + Math.round(hash(i, 78) * 6);
    for (let k = 0; k < n; k++){ const X = x + k; if (X < lw && hz - tops[X] < y - 1){ R(g, X, y, 1, 1, DU[4]); R(g, X, y + 1, 1, 1, DU[1]); } } }
  // the highest heap smoulders (Silesian slag heaps burn for decades): ember pixels on its shaded flank, a thin smoke
  const hot = cones.reduce((a, b) => b.h > a.h ? b : a), embers = [];
  for (let i = 0; i < 20; i++){ const u = hash(i, 31), ex = Math.round(hot.cx + 9 + u * hot.h / hot.s * 0.6), ey = Math.round(hz - hot.h + (ex - hot.cx) * hot.s + 9 + hash(31, i) * 45);
    if (ey < hz - 12 && ey > hz - tops[((ex % lw) + lw) % lw] + 3){ R(g, ex, ey, 1, 1, i % 3 ? LA[0] : LA[1]); embers.push({ x: ex, y: ey }); } }
  for (const q of [...cones].sort((a, b) => b.h - a.h).slice(0, 2)){
    const x0 = q.cx - q.h / q.s * 0.8, y0 = hz - q.h * 0.2 + 4, x1 = q.cx - 6, y1 = hz - q.h + 12;
    g.fillStyle = DU[1]; line(g, x0, y0, x1, y1); g.fillStyle = DU[4]; line(g, x0, y0 - 1, x1, y1 - 1);
    const sx = Math.round(x0 + (x1 - x0) * 0.62), sy = Math.round(y0 + (y1 - y0) * 0.62); R(g, sx - 3, sy - 5, 7, 4, DU[1]); R(g, sx - 3, sy - 5, 7, 1, DU[3]);
  }
  // a skyline of distant works along the horizon: blocks, saw-tooth sheds, stacks, a few lit windows
  for (let x = 0; x < lw;){
    const w = 36 + rr() * 66 | 0, h = 12 + rr() * 30 | 0, y0 = hz - h, kind = rr();
    R(g, x, y0, w, h, DU[2]); R(g, x, y0, 1, h, DU[3]); R(g, x, y0, w, 1, DU[3]); R(g, x + w - 1, y0, 1, h, DU[1]);
    if (kind < 0.3) for (let i = 0; i + 12 <= w; i += 12){ g.fillStyle = DU[2]; poly(g, [x + i, y0, x + i, y0 - 9, x + i + 12, y0]); R(g, x + i, y0 - 9, 1, 9, DU[4]); }
    else if (kind < 0.5){ R(g, x + w - 12, y0 - 27, 4, 27, DU[2]); R(g, x + w - 12, y0 - 27, 1, 27, DU[3]); R(g, x + w - 13, y0 - 28, 6, 1, DU[3]); }
    slits(g, x + 4, y0 + 6, x + w - 3, hz - 6, 6, 9, 2, 3, 0.16, LA[1], DU[1], x);
    x += w + (rr() * 15 | 0);
  }
  // chimneys: tapered, banded, capped; warning lamps (top + half way) blink in drawLayer
  const chim = [];
  for (const [x, h] of [[270, 225], [540, 168], [990, 288], [1380, 192], [2220, 252], [2490, 180]]){
    for (let y = hz - h; y < hz; y++){ const wv = Math.round(7 + 5 * (y - hz + h) / h), xl = x - (wv >> 1);
      R(g, xl, y, wv, 1, DU[2]); R(g, xl, y, 1, 1, DU[3]); R(g, xl + 1, y, 1, 1, DU[3]); R(g, xl + wv - 1, y, 1, 1, DU[1]); }
    for (let y = hz - h + 18; y < hz - 30; y += 39){ const wv = Math.round(7 + 5 * (y - hz + h) / h) + 2; R(g, x - (wv >> 1), y, wv, 2, DU[1]); R(g, x - (wv >> 1), y - 1, wv, 1, DU[3]); }
    R(g, x - 6, hz - h - 3, 12, 4, DU[2]); R(g, x - 6, hz - h - 3, 12, 1, DU[4]); R(g, x - 6, hz - h, 12, 1, DU[1]);
    chim.push({ x, y: hz - h - 5, mid: hz - Math.round(h / 2) });
  }
  // the Gauturm (the occupation's administration tower): a colonnaded base, the shaft of lit window slits between pilasters, the
  // banner block under the lamp deck (fx's two searchlights), a stepped crown and the beacon mast. Its crown stands in the frame:
  // the shaft's top ty is set so that at the street view (the far layer's rows - REF, REF = 132) the lamp deck is at frame y 114
  // and the beacon at 46, both under the E headframe's sheave tops (frame y ~14: the headframe is the tallest thing in E) and
  // over the dark top band the two beams sweep up through; the banner block hangs under the playfield headframe's sheaves on the
  // E approach, not behind their spokes. The base and the shaft's foot stand behind the mid layer.
  const tx = 1770, ty = hz - 198, dk = DU[1], bd = DU[2], lt = DU[3], hi = DU[4];
  const block = (x0, y0, w, h) => { R(g, x0, y0, w, h, bd); R(g, x0, y0, 3, h, lt); R(g, x0, y0, w, 1, hi); R(g, x0 + w - 3, y0, 3, h, dk); R(g, x0, y0 + h - 1, w, 1, dk); };
  block(tx - 72, hz - 84, 144, 84); for (let i = tx - 66; i < tx + 66; i += 12){ R(g, i, hz - 72, 3, 72, lt); R(g, i, hz - 72, 1, 72, hi); R(g, i + 3, hz - 72, 1, 72, dk); }
  R(g, tx - 72, hz - 78, 144, 2, lt); R(g, tx - 72, hz - 76, 144, 1, dk);
  block(tx - 45, ty, 90, hz - 84 - ty); slits(g, tx - 39, ty + 9, tx + 39, hz - 90, 9, 15, 3, 7, 0.42, LA[1], DU[0], 3);
  for (const px of [tx - 42, tx - 15, tx + 12, tx + 39]) R(g, px, ty, 1, hz - 84 - ty, dk);
  for (let y = ty + 30; y < hz - 90; y += 45) R(g, tx - 45, y, 90, 1, lt);
  block(tx - 30, ty - 96, 60, 96); R(g, tx - 11, ty - 87, 22, 66, BN[2]); R(g, tx - 11, ty - 87, 2, 66, BN[3]); R(g, tx + 9, ty - 87, 2, 66, BN[1]);
  for (let i = 0; i < 22; i += 4) R(g, tx - 11 + i, ty - 21, 2, 2 + (i & 4 ? 3 : 0), BN[2]);
  emblem(g, tx, ty - 68, 8);
  const deck = ty - 102, lights = [-30, 30];                                   // the lamp deck's top row; its two searchlights (x off tx)
  R(g, tx - 36, deck, 72, 6, lt); R(g, tx - 36, deck, 72, 1, hi); R(g, tx - 36, deck + 5, 72, 1, dk); for (let i = tx - 35; i < tx + 36; i += 4) R(g, i, deck - 6, 1, 6, bd); R(g, tx - 36, deck - 6, 72, 1, lt);
  for (const dx of lights){ const lx = tx + dx; R(g, lx - 2, deck - 8, 5, 8, dk); R(g, lx - 2, deck - 8, 1, 8, bd); R(g, lx - 2, deck - 8, 5, 1, LA[3]); R(g, lx, deck - 8, 1, 1, SG[2]); }   // housings, lenses up
  block(tx - 18, deck - 24, 36, 18); block(tx - 9, deck - 36, 18, 12); R(g, tx - 1, deck - 66, 3, 30, bd); R(g, tx - 1, deck - 66, 1, 30, lt); R(g, tx - 4, deck - 48, 9, 1, lt);
  R(g, 0, hz, lw, LH - hz, DU[3]); R(g, 0, hz, lw, 1, DU[4]);
  bg.layers.far = { c: fogged(c, g, FOG.far, 3), lw, f: 0.15, chim, embers, anims: [], lamps: [], tower: { x: tx, y: deck - 8, lights }, beacon: { x: tx, y: deck - 68 },
    smoke: [...chim.map(p => ({ x: p.x, y: p.y, rate: 0.09, tone: [SM[2], SM[3], SM[4]], grow: 0.075 })),
      { x: Math.round(hot.cx + 21), y: Math.round(hz - hot.h + 24), rate: 0.08, tone: [SM[3], SM[4], SM[5]], grow: 0.06, spread: 45 }] };
}

// ---------- midfar layer (0.32): cooling towers with steam crowns, saw-tooth halls, small headframes, a stack ----------
// Hyperboloid cooling tower (h tall, standing on hz), painted pixel by pixel into its own ImageData and laid on g once. The shell:
// its throat (the waist) 22 % of h under the rim, as on the real towers, so whatever part shows over the street or the heap reads
// as a waist flaring out downward; concrete posterised into four flat bands lit on its left flank (dusk[5..2] across, a dusk[6]
// rim on the lit edge, 1 px checker seams between bands), the formwork rings every 13 px and a few short rain streaks only on the
// shaded half (the lit flank stays plain: the hero stands against it at A_start), a lip round the mouth, the X-leg colonnade at
// its foot. The steam crown rises out of the mouth: billows from inside the shell (the shell and its front lip are painted over
// their roots), narrower than the mouth at the root, growing and leaning left with the wind as they rise, shaded as ONE mass:
// each pixel takes the frontmost billow over it, lit by that billow's upper-left slope, by its height in the column and along
// the column's upper-left edge, darker along its lower-right edge and in the mouth's shadow, posterised into smog[5..8], no
// dither. Returns the crown's top (the plume's source). The first tower stands right behind the start heap at camera 0: the hero
// stands against its sunlit flank, the crown rising over him.
const TOWER_BANDS = [0.02, 0.27, 0.52, 0.78];
function coolingTower(g, cx, hz, h){
  const top = hz - h, W = 360, CH = 126, H = h + CH, x0 = cx - 180, y0 = top - CH, [c, cg] = mk(W, H), img = cg.createImageData(W, H), d = new Uint32Array(img.data.buffer);
  const set = (x, y, hex) => { if (x >= 0 && y >= 0 && x < W && y < H) d[y * W + x] = wordOf(hex); };
  const wAt = u => Math.round(88 * Math.sqrt(1 + Math.pow((u - 0.22) / (u < 0.22 ? 0.35 : 0.465), 2)));
  // the crown (its roots 8 px down in the mouth)
  const rr = rng(cx), bl = [], on = new Int8Array(W * H).fill(-1);
  for (let i = 0; i < 24; i++){ const u = i / 23;
    bl.push({ x: cx + 6 - Math.round(u * u * 22) + Math.round((rr() - 0.5) * (52 + u * 50)), y: top + 8 - Math.round(u * 66 + rr() * 8), r: Math.round(13 + u * 7 + rr() * 4) }); }
  bl.sort((a, b) => a.y - b.y);                                                              // the lower billows in front
  bl.forEach((b, k) => { for (let y = Math.max(0, b.y - b.r - y0); y <= b.y + b.r - y0; y++) for (let x = b.x - b.r - x0; x <= b.x + b.r - x0; x++){
    const dx = x0 + x - b.x, dy = y0 + y - b.y; if (x >= 0 && x < W && dx * dx + dy * dy <= b.r * b.r + b.r * 0.8) on[y * W + x] = k; } });
  const T = [SM[5], SM[6], SM[7], SM[8]], air = (x, y) => x < 0 || y < 0 || x >= W || on[y * W + x] < 0;
  for (let y = 0; y < CH + 8; y++) for (let x = 0; x < W; x++){ const k = on[y * W + x]; if (k < 0) continue;
    const b = bl[k], Y = y0 + y, u = (x0 + x - b.x) / b.r, q = (Y - b.y) / b.r;
    let v = (-0.5 * u - 0.62 * q + 0.6 * Math.sqrt(Math.max(0, 1 - u * u - q * q))) * 0.9 + (top - 40 - Y) / 60;   // the billow's sphere, lit up left
    if (air(x - 2, y - 2)) v += 0.45; if (air(x + 2, y + 2)) v -= 0.45; if (Y > top - 6) v -= 0.6;
    set(x, y, T[v > 0.62 ? 3 : v > -0.2 ? 2 : v > -0.95 ? 1 : 0]); }
  // the shell: four bands across (dusk[5..2]), the lit rim, checker seams; rings and streaks on the shaded half only
  const SH = [DU[6], DU[5], DU[4], DU[3], DU[2]];
  const streaks = Array.from({ length: 3 }, (_, i) => [0.82 + hash(cx, i) * 0.13, 3, 4 + Math.round(hash(i, cx) * 6)]);   // [across, from, rows]: stains under the lip
  for (let y = 3; y < h - 18; y++){
    const w = wAt(y / h), xl = cx - (w >> 1), ring = y % 13 === 0, B = TOWER_BANDS.map(q => Math.round(q * w));
    for (let i = 0; i < w; i++){ let k = 0; while (k < B.length && i >= B[k]) k++;
      const seam = k > 1 && B.includes(i); if (seam && ((xl + i + top + y) & 1)) k--;                // the seam: 1 px checker
      if (i / w > 0.6 && (ring || (!seam && streaks.some(([p, sy, n]) => i === Math.round(p * w) && y >= sy && y < sy + n)))) k = Math.min(4, k + 1);
      set(xl + i - x0, top + y - y0, SH[k]); }
  }
  { const w = wAt(0) + 4, xl = cx - (w >> 1);                                                   // the lip round the mouth (over the crown's roots)
    for (let i = 0; i < w; i++){ const p = i / w; set(xl + i - x0, top - y0, p < 0.6 ? DU[6] : DU[5]); set(xl + i - x0, top + 1 - y0, p < 0.3 ? DU[5] : p < 0.75 ? DU[4] : DU[3]); set(xl + i - x0, top + 2 - y0, DU[2]); } }
  // the X-leg colonnade
  const wb = wAt(1), xb = cx - (wb >> 1);
  for (let y = hz - 18; y < hz; y++) for (let x = xb; x < xb + wb; x++) set(x - x0, y - y0, DU[0]);
  cg.putImageData(img, 0, 0); g.drawImage(c, x0, y0);
  R(g, xb, hz - 19, wb, 1, DU[4]); g.fillStyle = DU[3]; for (let i = 0; i < wb; i += 12){ line(g, xb + i, hz - 18, xb + i + 6, hz - 1); line(g, xb + i + 12, hz - 18, xb + i + 6, hz - 1); }
  const hi = bl[0]; return { x: hi.x, y: hi.y - hi.r + 6 };
}
function buildMidFar(){
  const lw = 3300, hz = 570, [c, g] = mk(lw, LH, true), rr = rng(33);
  const steam = [], anims = [], lamps = [];
  // (the second tower is the lower one: in E its crown rises beside the playfield headframe's strut, under its sheaves, not
  // behind the top truss as the brightest mass of the upper frame)
  for (const [x, h] of [[210, 264], [2550, 232]]){ const s = coolingTower(g, x, hz, h);
    steam.push({ x: s.x, y: s.y, rate: 0.3, tone: [SM[6], SM[7], SM[8]], age: [SM[3], SM[4], SM[5]], ageY: s.y - 12, grow: 0.15, spread: 60, big: true }); }
  // saw-tooth halls: each tooth's steep face glazed (lit or dark), the slope lit; a lit window band in the wall, a plinth
  for (const [x, w] of [[960, 300], [2760, 195]]){
    R(g, x, hz - 78, w, 78, DU[2]); R(g, x, hz - 78, 3, 78, DU[3]); R(g, x + w - 1, hz - 78, 1, 78, DU[1]);
    for (let i = 0; i + 30 <= w; i += 30){ g.fillStyle = DU[3]; poly(g, [x + i, hz - 78, x + i, hz - 102, x + i + 30, hz - 78]); g.fillStyle = DU[4]; line(g, x + i + 1, hz - 102, x + i + 29, hz - 79);
      R(g, x + i, hz - 102, 3, 24, DU[1]); R(g, x + i + 3, hz - 99, 3, 18, rr() < 0.55 ? LA[1] : DU[1]); }
    slits(g, x + 9, hz - 60, x + w - 6, hz - 48, 15, 12, 9, 5, 0.6, LA[1], DU[1], x);
    R(g, x, hz - 39, w, 1, DU[1]); R(g, x, hz - 38, w, 1, DU[3]);
  }
  for (const hf of HEADFRAMES) if (hf[0] === 'midfar'){ const p = placeHeadframe(g, hf, [DU[1], DU[2], DU[3], DU[4], DU[5]]); anims.push(...p.anims); lamps.push(...p.lamps); }
  { const x = 1851; R(g, x, hz - 225, 12, 225, DU[2]); R(g, x, hz - 225, 2, 225, DU[3]); R(g, x + 11, hz - 225, 1, 225, DU[1]); R(g, x - 1, hz - 228, 14, 4, DU[3]); R(g, x - 1, hz - 228, 14, 1, DU[4]);
    for (let y = hz - 200; y < hz - 20; y += 45) R(g, x, y, 12, 2, DU[1]);
    steam.push({ x: x + 6, y: hz - 230, rate: 0.15, tone: [SM[2], SM[3], SM[4]], grow: 0.075 }); lamps.push({ x: x + 5, y: hz - 234 }); }
  R(g, 0, hz, lw, LH - hz, DU[3]); R(g, 0, hz, lw, 1, DU[4]);
  bg.layers.midfar = { c: fogged(c, g, FOG.midfar, 3), lw, f: 0.32, smoke: steam, anims, lamps };
}

// ---------- mid layer (0.60): headframe A, engine house, the familoki of B, the towering colony behind C, the screening house
// behind D, its headframe and conveyor bridge, the water tower and sheds of E ----------
// Where the hero stands, in this layer's px (camera centred on him: mid x = his screen x + 0.6 x camera): A ~147..189 (the heap),
// ~755..1032 (street), B ~1143..1298 (street), ~1359..1401 (the station, in front of the gap between the two houses), ~1854..2121
// (in front of open sky and the fogged colony), C roofs ~2166..2870 (the colony's smog bank lifts the silhouettes behind them), D
// ~2971..3201 (street, open sunset), ~3405..3506 (the belt, in front of the screening house's lit glazing), E ~4080..4382. The
// regime banner of B hangs well clear of the station; the colony stands on gy 610 (the C street dips a row): its cornices and
// string courses keep >= 8 px, its window headers and sills >= 6 px off the C roofs at the camera's three rests there; the B houses (2 storeys, eave 396) keep every horizontal line >= 18 px off
// the cable-car rope (309). lw = 5100: wider than any camera sees (0.6 x 6720 + 960), so the layer never wraps.
function buildMid(){
  const lw = 5100, hz = 594, [c, g] = mk(lw, LH, true), rr = rng(55);
  const anims = [], smoke = [], lamps = [], stK = [ST[1], ST[2], ST[3], ST[5], ST[6]];
  const coal = [SM[2], SM[3], SM[4]];
  // A: headframe with its raking strut, the winding-engine house and its stack
  const hfA = placeHeadframe(g, HEADFRAMES[3], stK); anims.push(...hfA.anims); lamps.push(...hfA.lamps);
  { const x = 711, w = 174, eave = hz - 186;
    brick(g, x, eave, w, hz - eave); R(g, x, eave, 1, hz - eave, MB[3]); R(g, x + 1, eave, 2, hz - eave, MB[2]); R(g, x + w - 1, eave, 1, hz - eave, MB[0]);
    g.fillStyle = SM[3]; poly(g, [x - 6, eave, x + w + 6, eave, x + w / 2, eave - 45]); g.fillStyle = SM[4]; poly(g, [x - 6, eave, x + w / 2, eave - 45, x + w / 2, eave - 39, x + 6, eave]);
    for (let y = eave - 41; y < eave; y += 4){ const k = Math.round((w / 2 + 6) * (y - eave + 45) / 45) - 6; if (k > 0) R(g, x + w / 2 - k, y, 2 * k, 1, SM[2]); }
    R(g, x - 6, eave, w + 12, 3, MB[2]); R(g, x - 6, eave, w + 12, 1, MB[3]); R(g, x - 6, eave + 3, w + 12, 1, MB[0]);
    disc(g, x + w / 2, eave - 18, 7, MB[2]); disc(g, x + w / 2, eave - 18, 5, LA[1]); R(g, x + w / 2 - 5, eave - 18, 11, 1, BN[1]);        // gable oculus
    for (let i = 0; i < 4; i++){ const wx = x + 18 + i * 39;                                                                             // the engine hall's tall windows
      R(g, wx - 2, eave + 30, 25, 3, MB[2]); R(g, wx, eave + 27, 21, 3, MB[2]); R(g, wx + 3, eave + 26, 15, 1, MB[3]); R(g, wx, eave + 33, 21, 90, MB[0]);
      R(g, wx + 2, eave + 30, 17, 93, i === 2 ? SM[0] : LA[1]); if (i !== 2){ R(g, wx + 2, eave + 90, 17, 33, LA[2]); R(g, wx + 2, eave + 30, 4, 93, LA[0]); }
      R(g, wx + 9, eave + 30, 2, 93, WD[0]); for (let y = eave + 45; y < eave + 120; y += 18) R(g, wx + 2, y, 17, 1, WD[0]);
      R(g, wx - 3, eave + 123, 27, 3, MB[2]); R(g, wx - 3, eave + 123, 27, 1, MB[3]); }
    const sx = x + 129; R(g, sx, hz - 348, 21, 162, MB[1]); R(g, sx, hz - 348, 3, 162, MB[2]); R(g, sx, hz - 348, 1, 162, MB[3]); R(g, sx + 20, hz - 348, 1, 162, MB[0]);
    for (let y = hz - 340; y < hz - 195; y += 4) R(g, sx + 3, y, 17, 1, MB[0]); for (const y of [hz - 300, hz - 240]){ R(g, sx - 1, y, 23, 3, MB[0]); R(g, sx - 1, y, 23, 1, MB[2]); }
    R(g, sx - 3, hz - 354, 27, 6, SM[2]); R(g, sx - 3, hz - 354, 27, 1, SM[4]); R(g, sx - 3, hz - 349, 27, 1, SM[1]);
    smoke.push({ x: sx + 10, y: hz - 357, rate: 0.25, tone: coal, grow: 0.1 }); }
  // B: two 2-storey familoki (eave 396, under the sunset band as in the owner's draft), the station's gap between them closed only
  // by a low coal-yard wall, open sky over the guard tower; the second house flies the regime banner from its east end
  for (const [x, w, o] of [[1032, 225, { rh: 42, dormers: 2 }], [1437, 210, { rh: 45, chimneys: [0.3, 0.7], dormers: 1, lit: 0.35 }]]){
    const t = familok(g, x, hz, w, 2, rr, o)[0]; smoke.push({ x: t.x, y: t.y, rate: 0.1, tone: coal, grow: 0.075 }); }   // one flue each smokes
  { const x = 1257, w = 180, y = hz - 87; brick(g, x, y, w, hz - y); R(g, x, y, w, 4, SM[3]); R(g, x, y, w, 1, SM[4]); R(g, x, y + 4, w, 1, SM[1]);
    R(g, x + 66, y + 15, 45, hz - y - 15, WD[1]); R(g, x + 66, y + 15, 45, 1, WD[2]); R(g, x + 66, y + 15, 1, hz - y - 15, WD[2]); R(g, x + 88, y + 15, 1, hz - y - 15, WD[0]);
    for (let j = y + 21; j < hz; j += 6) R(g, x + 67, j, 44, 1, WD[0]); }
  { const bx = 1599, by0 = hz - 2 * ST_H - 9; R(g, bx - 3, by0 - 3, 39, 3, ST[2]); R(g, bx - 3, by0 - 3, 39, 1, ST[4]);
    R(g, bx, by0, 33, 84, BN[2]); R(g, bx, by0, 3, 84, BN[3]); R(g, bx + 30, by0, 3, 84, BN[1]); for (const fy of [by0 + 40, by0 + 62]) R(g, bx + 3, fy, 27, 1, BN[1]);
    emblem(g, bx + 16, by0 + 22, 10); for (let i = 0; i < 33; i += 6) R(g, bx + i, by0 + 84, 3, 3 + (i % 12 ? 4 : 0), BN[2]); R(g, bx + 14, by0 + 39, 6, 45, BN[0]); }
  // C: the towering colony (Nikiszowiec style): three tall narrow houses of 4, 3 and 4 storeys, ~150 px apart so the sunset band
  // shows between them, stepped roofs and a bay; the first turns a blind wall to the street with the KOHLE IST SIEG poster. It
  // ends before D: the street of D (and the C street's end) stands against the open sunset, the plant's frame and the far heaps.
  const C = [[1902, 186, 4, { gable: true, chimneys: [0.5], dormers: 0, rh: 45 }], [2241, 210, 3, { risalit: true, rh: 54, dormers: 2, lit: 0.3, bays: 4 }],
    [2604, 201, 4, { rh: 48, lit: 0.22, hip: 0.5, chimneys: [0.15, 0.6, 0.85], bays: 4 }]];
  C.forEach(([x, w, fl, o]) => { const t = familok(g, x, 610, w, fl, rr, Object.assign({ wo: 35 }, o)).pop(); smoke.push({ x: t.x, y: t.y, rate: 0.12, tone: coal, grow: 0.075 }); });
  { const px = 1933, py = 241, pw = 123, ph = 96;                                // KOHLE IST SIEG high on the blind wall (clear of the street's sign)
    R(g, px - 1, py - 1, pw + 2, ph + 2, WD[1]); R(g, px, py, pw, ph, PA[2]); R(g, px, py, pw, 1, PA[3]); R(g, px, py, 1, ph, PA[3]);
    R(g, px, py, 39, ph, BN[2]); R(g, px, py, 2, ph, BN[3]); R(g, px + 37, py, 2, ph, BN[1]); R(g, px + 82, py + 1, 1, ph - 1, PA[1]);   // red field, paste seam
    emblem(g, px + 19, py + 30, 13);
    midText(g, 'KOHLE', px + 47, py + 15, PA[0], PA[1]); midText(g, 'IST', px + 47, py + 30, PA[0], PA[1]); midText(g, 'SIEG', px + 47, py + 45, BN[2], BN[1]);
    R(g, px + 47, py + 64, 60, 3, BN[2]); R(g, px + 47, py + 67, 60, 1, BN[1]); R(g, px + 47, py + 74, 42, 1, PA[1]); R(g, px + 47, py + 79, 30, 1, PA[1]);
    for (let i = 0; i < 27; i++){ const q = hash(i, 5); R(g, px + 39 + (q * (pw - 39) | 0), py + (hash(5, i) * ph | 0), 1 + (q > 0.8), 1, PA[1]); }     // weathering
    g.fillStyle = MB[1]; poly(g, [px + pw + 1, py - 1, px + pw + 1, py + 20, px + pw - 17, py - 1]); g.fillStyle = PA[1]; line(g, px + pw - 16, py, px + pw, py + 18);   // torn corner
    R(g, px + 4, py + ph - 6, 30, 1, BN[1]); }
  // D: the screening house (Siebhaus) of the shaft, dark across the smog in dusk steel (its steps are not the playfield's steel,
  // so the belt pillars in front keep their read): a corrugated box raised on a braced steel frame, the sunset showing under it,
  // a hopper and chute below; along the box a band of glazing lit by the night shift, evenly: dim amber with warm-dark mullions
  // every 30 px, the hall's lamps and the lit floor under them; no dark pane: the hero's backdrop on the belt. Its vent stack, the
  // shaft headframe east of it and the conveyor bridge between them.
  const hfD = placeHeadframe(g, HEADFRAMES[4], stK); anims.push(...hfD.anims); lamps.push(...hfD.lamps);
  { const x = 3270, w = 360, top = 225, bot = 354;
    for (const lx of [x + 9, x + 126, x + 240, x + w - 12]){ R(g, lx, bot, 3, hz - bot, DS[3]); R(g, lx, bot, 1, hz - bot, DS[5]); R(g, lx + 2, bot, 1, hz - bot, DS[1]); }   // the frame
    g.fillStyle = DS[2];
    for (const [a, b] of [[x + 12, x + 126], [x + 129, x + 240], [x + 243, x + w - 12]]) for (const [y0, y1] of [[bot, 474], [474, hz]]){ line(g, a, y0, b - 1, y1); line(g, b - 1, y0, a, y1); }
    R(g, x + 9, 474, w - 18, 3, DS[3]); R(g, x + 9, 474, w - 18, 1, DS[4]);
    g.fillStyle = DS[2]; poly(g, [x + 255, bot, x + 336, bot, x + 306, bot + 51, x + 285, bot + 51]); g.fillStyle = DS[4]; poly(g, [x + 255, bot, x + 261, bot, x + 288, bot + 51, x + 285, bot + 51]);
    R(g, x + 288, bot + 51, 15, 12, DS[1]); R(g, x + 288, bot + 51, 15, 1, DS[3]);                          // hopper + chute (east of the belt spots)
    R(g, x, top, w, bot - top, DS[2]); for (let i = x + 3; i < x + w; i += 4) R(g, i, top, 1, bot - top, DS[1]);                         // the box
    R(g, x, top, 3, bot - top, DS[4]); R(g, x, top, 1, bot - top, DS[5]); R(g, x + w - 1, top, 1, bot - top, DS[0]); R(g, x, bot - 3, w, 3, DS[0]);
    R(g, x - 4, top - 6, w + 8, 6, DS[3]); R(g, x - 4, top - 6, w + 8, 1, DS[5]); R(g, x - 4, top - 1, w + 8, 1, DS[1]);
    R(g, x + 15, top + 12, w - 30, 105, DS[1]); R(g, x + 16, top + 13, w - 32, 103, LA[0]);                                            // the glazing band:
    // the hall's machines seen through it, one step under the glass and only at its ends (behind the belt spots it stays plain):
    // a vibrating screen on its springs at the west end, a hopper on a frame at the east end
    { const sy = top + 72; g.fillStyle = WD[2]; poly(g, [x + 22, sy, x + 100, sy + 12, x + 100, sy + 19, x + 22, sy + 7]); g.fillStyle = WD[1]; line(g, x + 22, sy + 7, x + 100, sy + 19);
      for (const lx of [x + 30, x + 88]){ const ly = sy + 7 + Math.round((lx - x - 22) * 12 / 78); R(g, lx, ly, 3, top + 105 - ly, WD[2]); for (let j = ly + 2; j < ly + 9; j += 2) R(g, lx - 1, j, 5, 1, WD[1]); }
      R(g, x + 16, sy - 13, 18, 4, WD[2]); g.fillStyle = WD[2]; line(g, x + 33, sy - 10, x + 44, sy + 1); line(g, x + 34, sy - 10, x + 45, sy + 1); }
    { const hx = x + w - 84; g.fillStyle = WD[2]; poly(g, [hx, top + 60, hx + 54, top + 60, hx + 36, top + 88, hx + 18, top + 88]); R(g, hx + 21, top + 88, 12, 6, WD[1]);
      R(g, hx - 2, top + 58, 58, 3, WD[1]); for (const lx of [hx + 3, hx + 48]) R(g, lx, top + 61, 3, 44, WD[2]); R(g, hx + 3, top + 96, 48, 2, WD[2]); }
    for (let i = x + 16 + 30; i < x + w - 18; i += 30) R(g, i, top + 13, 2, 103, WD[2]); R(g, x + 16, top + 46, w - 32, 2, WD[2]);         // mullions, transom
    for (let i = x + 16; i < x + w - 20; i += 30){ const p0 = i === x + 16 ? i : i + 2; R(g, p0 + 2, top + 15, 5, 1, LA[1]); R(g, p0 + 2, top + 16, 1, 3, LA[1]); }   // the panes' glints
    for (let i = x + 30; i < x + w - 21; i += 60){ R(g, i, top + 54, 6, 2, WD[1]); R(g, i + 1, top + 56, 4, 3, LA[2]); R(g, i - 3, top + 59, 12, 1, LA[1]); R(g, i + 2, top + 48, 1, 6, WD[1]); }   // hall lamps
    R(g, x + 16, top + 105, w - 32, 11, LA[1]); R(g, x + 16, top + 105, w - 32, 1, LA[2]);                                           // the lit floor under them
    R(g, x + w - 27, top - 75, 15, 69, DS[3]); R(g, x + w - 27, top - 75, 3, 69, DS[5]); R(g, x + w - 13, top - 75, 1, 69, DS[1]); R(g, x + w - 30, top - 81, 21, 6, DS[2]); R(g, x + w - 30, top - 81, 21, 1, DS[4]);
    smoke.push({ x: x + w - 20, y: top - 84, rate: 0.22, tone: coal, grow: 0.09 }); lamps.push({ x: x + w - 20, y: top - 87 });
    const bx = 3699, by0 = 285, ex = x + w, ey = top + 21;                                                                                  // conveyor bridge (truss)
    g.fillStyle = DS[3]; line(g, bx, by0, ex, ey); line(g, bx, by0 + 12, ex, ey + 12); g.fillStyle = DS[4]; line(g, bx, by0 - 1, ex, ey - 1); g.fillStyle = DS[2];
    for (let i = 0; i <= 4; i++){ const xx = Math.round(bx + (ex - bx) * i / 4), yy = Math.round(by0 + (ey - by0) * i / 4); R(g, xx, yy, 1, 13, DS[2]); if (i < 4) line(g, xx, yy + 12, Math.round(bx + (ex - bx) * (i + 1) / 4), Math.round(by0 + (ey - by0) * (i + 1) / 4)); } }
  // E: the water tower (braced legs, riveted tank, conical roof, ladder), long low sheds in the fog, a boiler-house stack
  { const x = 3894, legT = hz - 144;
    for (const lx of [x + 9, x + 93]){ R(g, lx, legT, 4, 144, DS[3]); R(g, lx, legT, 1, 144, DS[5]); R(g, lx + 3, legT, 1, 144, DS[1]); }
    g.fillStyle = DS[2]; for (let y = legT; y < hz - 30; y += 48){ line(g, x + 13, y, x + 93, y + 48); line(g, x + 93, y, x + 13, y + 48); R(g, x + 13, y, 80, 2, DS[3]); }
    R(g, x, legT - 81, 111, 81, DS[3]); R(g, x, legT - 81, 4, 81, DS[5]); R(g, x + 107, legT - 81, 4, 81, DS[1]); R(g, x + 4, legT - 81, 4, 81, DS[4]); R(g, x, legT - 3, 111, 3, DS[1]);
    for (const y of [legT - 60, legT - 33]){ R(g, x, y, 111, 1, DS[1]); for (let i = x + 3; i < x + 108; i += 6) R(g, i, y - 2, 1, 1, DS[5]); }
    for (let i = x + 15; i < x + 105; i += 27) R(g, i, legT - 78, 1, 75, DS[2]);
    g.fillStyle = SM[3]; poly(g, [x - 6, legT - 81, x + 117, legT - 81, x + 55, legT - 120]); g.fillStyle = SM[4]; poly(g, [x - 6, legT - 81, x + 55, legT - 120, x + 55, legT - 114, x + 6, legT - 81]);
    R(g, x + 53, legT - 126, 4, 7, DS[3]); R(g, x - 6, legT - 82, 123, 1, SM[1]);
    for (let y = legT - 75; y < hz; y += 9) R(g, x + 75, y, 10, 1, DS[2]); R(g, x + 75, legT - 75, 1, hz - legT + 75, DS[2]); R(g, x + 84, legT - 75, 1, hz - legT + 75, DS[2]); }
  // sheds: saw-tooth roofs (each tooth's steep face glazed) over brick, a coping under the teeth, a row of windows (a few lit by
  // the night shift), a sliding door on its rail in place of the third, a plinth, a downpipe at the east end
  for (const [x, w, h] of [[4050, 255, 126], [4326, 330, 105], [4680, 375, 138]]){
    brick(g, x, hz - h, w, h); R(g, x, hz - h, 1, h, MB[3]); R(g, x + 1, hz - h, 1, h, MB[2]); R(g, x + w - 1, hz - h, 1, h, MB[0]);
    for (let i = 0; i + 27 <= w; i += 27){ g.fillStyle = SM[3]; poly(g, [x + i, hz - h, x + i, hz - h - 18, x + i + 27, hz - h]); g.fillStyle = SM[4]; line(g, x + i + 1, hz - h - 18, x + i + 26, hz - h - 1);
      R(g, x + i, hz - h - 18, 3, 18, SM[1]); R(g, x + i + 3, hz - h - 15, 2, 12, rr() < 0.5 ? LA[1] : SM[0]); }
    R(g, x - 2, hz - h, w + 4, 3, MB[2]); R(g, x - 2, hz - h, w + 4, 1, MB[3]); R(g, x - 2, hz - h + 3, w + 4, 1, MB[0]);
    for (let i = x + 15, n = 0; i + 18 < x + w; i += 36, n++){
      if (n !== 2){ midWindow(g, i, hz - h + 30, rr() < 0.25 ? 'lit' : 'dark'); continue; }
      const dx = i - 9, dy = hz - 72;                                                          // the sliding door: planks, a brace, rail, handle
      R(g, dx - 3, dy - 5, 51, 3, DS[3]); R(g, dx - 3, dy - 5, 51, 1, DS[5]); R(g, dx, dy, 45, 72, WD[1]); R(g, dx, dy, 45, 1, WD[2]); R(g, dx, dy, 1, 72, WD[2]);
      for (let j = dx + 5; j < dx + 45; j += 5) R(g, j, dy + 1, 1, 71, WD[0]); g.fillStyle = WD[0]; line(g, dx + 2, dy + 3, dx + 42, dy + 69); R(g, dx + 36, dy + 33, 2, 6, DS[4]); }
    R(g, x, hz - 21, w, 1, MB[2]); R(g, x, hz - 20, w, 1, MB[0]);
    R(g, x + w - 9, hz - h + 4, 3, h - 4, SM[2]); R(g, x + w - 9, hz - h + 4, 1, h - 4, SM[4]); R(g, x + w - 7, hz - h + 4, 1, h - 4, SM[1]); }
  { const sx = 4590; R(g, sx, hz - 315, 18, 315, MB[1]); R(g, sx, hz - 315, 3, 315, MB[2]); R(g, sx, hz - 315, 1, 315, MB[3]); R(g, sx + 17, hz - 315, 1, 315, MB[0]);
    for (let y = hz - 300; y < hz; y += 45){ R(g, sx - 1, y, 20, 3, MB[0]); R(g, sx - 1, y, 20, 1, MB[2]); } R(g, sx - 3, hz - 321, 24, 6, SM[2]); R(g, sx - 3, hz - 321, 24, 1, SM[4]);
    smoke.push({ x: sx + 9, y: hz - 324, rate: 0.18, tone: coal, grow: 0.09 }); lamps.push({ x: sx + 8, y: hz - 327 }); }
  R(g, 0, hz, lw, LH - hz, SM[2]);
  bg.layers.mid = { c: fogged(c, g, FOG.mid), lw, f: 0.6, smoke, anims, lamps };
}

// ---------- foreground (1.35): near-black silhouettes, a 1 px rim where the sky dome lights their top / left ----------
// A chain of alternating links hanging from y0 to y1 at axis x: a ring seen face-on (9 x 15, its hole showing), then one seen
// edge-on (3 x 15), each overlapping the last by 3 px; lit on its left side.
function chain(g, x, y0, y1, k, rimL){
  for (let y = y0, n = 0; y < y1; y += 12, n++){
    if (n & 1){ R(g, x + 3, y, 3, 15, k); R(g, x + 3, y, 1, 15, rimL); }
    else { R(g, x, y, 9, 15, k); R(g, x + 3, y + 3, 3, 9, CO[2]); R(g, x, y + 1, 1, 13, rimL); R(g, x + 1, y, 3, 1, rimL); }
  }
}
// A ring between radii r0 and r1 (pixel centres), each pixel coloured by col(dx, dy).
function ring(g, cx, cy, r0, r1, col){
  for (let dy = -r1; dy <= r1; dy++) for (let dx = -r1; dx <= r1; dx++){ const e = Math.sqrt(dx * dx + dy * dy); if (e >= r0 - 0.5 && e < r1 + 0.5) R(g, cx + dx, cy + dy, 1, 1, col(dx, dy)); }
}
// A forged crane hook hanging from (x, y), the top centre of its shank's end: an eye (eye = true: the ring a chain's last link goes
// through) or the nut that holds it in a hook block, the shank, the bowl (outer radius ro) curving down from it round the right
// (its thick back) and the bottom (the saddle) up the left to a tapered point, the throat between point and shank closed by the
// spring latch. A silhouette in k with a 1 px rim where its faces catch the sky dome: rimT on top (the saddle inside the bowl too),
// rimL on the left; the latch a 1 px line. Returns its bottom row.
function hook(g, x, y, ro, eye, k, rimL, rimT){
  const ri = Math.round(ro * 0.5), cyb = y + (eye ? 7 : 5) + ro, x0 = x - ro - 2, W = 2 * ro + 5, H = cyb + ro - y + 1, m = new Uint8Array(W * H);
  const set = (X, Y) => { X -= x0; Y -= y; if (X >= 0 && Y >= 0 && X < W && Y < H) m[Y * W + X] = 1; }, at = (X, Y) => { X -= x0; Y -= y; return X >= 0 && Y >= 0 && X < W && Y < H && m[Y * W + X]; };
  if (eye){ for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++){ const e = Math.hypot(dx, dy); if (e <= 3.3 && e >= 1.5) set(x + dx, y + 3 + dy); } }
  else for (let j = 0; j < 3; j++) for (let dx = -3; dx <= 3; dx++) set(x + dx, y + j);
  for (let Y = y + (eye ? 6 : 3); Y < cyb - ri; Y++) for (let dx = -1; dx <= 2; dx++) set(x + dx, Y);          // the shank (a hair thicker at its back)
  const tip = 212 * Math.PI / 180;                                                             // the point's angle (clockwise from east)
  for (let dy = -ro; dy <= ro; dy++) for (let dx = -ro; dx <= ro; dx++){
    let a = Math.atan2(dy, dx); if (a < -Math.PI / 2 - 0.12) a += 2 * Math.PI; if (a > tip) continue;   // the throat's gap
    const t = a <= Math.PI / 2 ? 0 : (a - Math.PI / 2) / (tip - Math.PI / 2), out = ro - t * (ro - ri - 1.6), e = Math.hypot(dx, dy);
    if (e >= ri - 0.3 && e <= out + 0.4) set(x + dx, cyb + dy); }
  for (let Y = y; Y < y + H; Y++) for (let X = x0; X < x0 + W; X++) if (at(X, Y)) R(g, X, Y, 1, 1, !at(X, Y - 1) ? rimT : !at(X - 1, Y) ? rimL : k);
  const tx = Math.round(x + Math.cos(tip) * (ri + 1)), ty = Math.round(cyb + Math.sin(tip) * (ri + 1));   // the latch: shank -> point
  g.fillStyle = rimL; line(g, x - 2, cyb - ro + 1, tx + 1, ty - 1);
  return cyb + ro;
}
// The foreground's elements keep to two bands of the world: the overhead ones (girder, hoisted crane hook, hanging chain, slack
// cable) above y 120, over the head of the hero's highest jump from anywhere but the highest roof (the C roof 2: feet 288, apex
// frame top ~75, which the hook and girder clear and the chain's pass is phased away from), and the pipe stand from the street
// band down (y 453..672, on the street spots it is phased away from). FG_LW: the wrap; PIPE_X: the pipe stand's riser; FG_PHASE:
// see the end.
const FG_LW = 4500, FG_PHASE = 4035, PIPE_X = (3095 + FG_PHASE) % FG_LW;
function buildFg(){
  const lw = FG_LW, [c, g] = mk(lw, LH), k = OUTLINE, rimT = CO[4], rimL = CO[3];
  // overhead girder: an I-beam (flanges with rivet rows, a Warren-laced web); the crane trolley with its hook hoisted under it
  { const x = 240, w = 450; R(g, x, 0, w, 27, k); R(g, x, 6, w, 1, CO[2]); R(g, x, 20, w, 1, rimT); R(g, x, 23, w, 1, CO[2]);
    g.fillStyle = CO[2]; for (let i = x + 6; i + 24 <= x + w - 6; i += 24){ line(g, i, 8, i + 12, 18); line(g, i + 12, 18, i + 24, 8); }
    for (let i = x + 4; i < x + w; i += 12){ R(g, i, 3, 1, 1, rimL); R(g, i, 25, 1, 1, CO[2]); }
    R(g, x, 0, 1, 27, rimL); R(g, x + w - 1, 0, 1, 27, CO[1]);
    // the trolley on the bottom flange (wheels on the flange, an axle cap), the two falls of the hoist rope, the hook block (its
    // cheek plate: the sheave's cover ring and pin, four bolt heads, the crosshead under them) and the hook in its nut (its
    // bottom at y 69: over the apex of the highest jump, so it never meets the hero)
    const cxh = 600, by0 = 35;
    R(g, cxh - 18, 27, 37, 6, k); R(g, cxh - 18, 27, 37, 1, rimT); disc(g, cxh - 11, 30, 3, k); disc(g, cxh + 11, 30, 3, k); R(g, cxh - 12, 29, 1, 1, rimL); R(g, cxh + 10, 29, 1, 1, rimL);
    R(g, cxh - 6, 33, 1, 2, rimL); R(g, cxh + 5, 33, 1, 2, rimL);
    R(g, cxh - 11, by0 + 2, 22, 11, k); R(g, cxh - 9, by0, 18, 2, k); R(g, cxh - 10, by0 + 1, 20, 1, k);              // the cheek, its top rounded
    R(g, cxh - 9, by0, 18, 1, rimT); R(g, cxh - 10, by0 + 1, 1, 1, rimT); R(g, cxh - 11, by0 + 2, 1, 1, rimT); R(g, cxh - 11, by0 + 3, 1, 10, rimL);
    ring(g, cxh, by0 + 6, 4, 4, (dx, dy) => dx + dy < -3 ? rimL : CO[2]); R(g, cxh - 1, by0 + 5, 3, 3, CO[2]); R(g, cxh - 1, by0 + 5, 1, 1, rimT);
    for (const [bx, bb] of [[-8, 2], [6, 2], [-8, 9], [6, 9]]){ R(g, cxh + bx, by0 + bb, 2, 2, CO[2]); R(g, cxh + bx, by0 + bb, 1, 1, rimL); }
    R(g, cxh - 11, by0 + 12, 22, 1, CO[1]);
    hook(g, cxh, by0 + 13, 8, false, k, rimL, rimT); }
  // pipe stand: a flanged riser with a hand-wheel valve and a short branch to the left ending in a blind flange, on a saddle
  { const x = PIPE_X, y0 = 495; R(g, x, y0, 66, LH - y0, k); R(g, x, y0, 1, LH - y0, rimL); R(g, x + 1, y0, 64, 1, rimT);
    for (const y of [y0 + 15, y0 + 99]){ R(g, x - 9, y, 84, 12, k); R(g, x - 9, y, 84, 1, rimT); R(g, x - 9, y, 1, 12, rimL); for (let i = x - 5; i < x + 72; i += 13) R(g, i, y + 5, 3, 3, CO[2]); }
    R(g, x - 36, y0 + 60, 36, 33, k); R(g, x - 36, y0 + 60, 36, 1, rimT); R(g, x - 48, y0 + 51, 12, 51, k); R(g, x - 48, y0 + 51, 1, 51, rimL); R(g, x - 48, y0 + 51, 12, 1, rimT);
    for (let j = y0 + 55; j < y0 + 100; j += 11) R(g, x - 46, j, 2, 2, CO[2]);                                                                   // the blind flange's bolts
    const vx = x + 33, vy = y0 - 24;                                                    // the hand-wheel: rim, three spokes, hub, stem
    ring(g, vx, vy, 15, 17, (dx, dy) => dx + dy < -12 && dy < 0 ? rimT : dx < -13 ? rimL : k);
    g.fillStyle = k; for (let a = 0; a < 3; a++){ const an = a * Math.PI / 3 + 0.3, cs = Math.cos(an) * 15, sn = Math.sin(an) * 15; line(g, vx - cs, vy - sn, vx + cs, vy + sn); line(g, vx + 1 - cs, vy - sn, vx + 1 + cs, vy + sn); }
    disc(g, vx, vy, 4, k); R(g, vx - 2, vy - 3, 2, 1, rimT); R(g, vx - 3, vy, 7, 24, k); R(g, vx - 3, vy + 4, 1, 20, rimL);
    R(g, x - 15, LH - 24, 96, 24, k); R(g, x - 15, LH - 24, 96, 1, rimT); }
  // hanging chain from the top, its hook (on an eye through the last link) at y 93..120 (over the mid layer's poster and the B
  // banner, never on them)
  { const x = 2640; chain(g, x - 4, 0, 93, k, rimL); hook(g, x, 93, 9, true, k, rimL, rimT); }
  // a slack cable between two supports over the frame (sagging 60 px, over the Gauturm's banner) with a turnbuckle
  { const x0 = 3120, x1 = 3900, sag = 60, cy = x => Math.round(4 * sag * (x - x0) * (x1 - x) / ((x1 - x0) * (x1 - x0)));
    for (let x = x0; x < x1; x++){ const y = cy(x), y2 = cy(x + 1); R(g, x, Math.min(y, y2), 1, Math.abs(y2 - y) + 2, k); R(g, x, Math.min(y, y2) - 1, 1, 1, rimT); }
    const tx = 3300, ty = cy(tx); R(g, tx - 12, ty - 5, 24, 11, k); R(g, tx - 12, ty - 5, 24, 1, rimT); R(g, tx - 9, ty - 2, 18, 4, CO[1]); }
  // FG_LW, FG_PHASE and PIPE_X (its place against the world is PIPE_X - FG_PHASE) were chosen by scanning wraps, phases and
  // positions: the hero's box over every surface he can stand on (the camera at its rest for him there) and over his jump apex
  // there, and the scene's landmarks at the probe cameras (the mid layer's poster and B banner, the Gauturm's banner, the sign
  // boards, the graffiti anchors) are clear of these silhouettes (the overhead ones at every phase in 3825..4155: FG_PHASE is the
  // one in that range that also keeps the girder between the HUD's two labels at the C roof 2 rest); the pipe stand also keeps
  // off the pits he must read (the A trench, the B chasm, the E shaft) while he walks up to them, and at every rest in D it stays
  // >= 70 px from the D vents' steam, so it never seems to vent (it shows in B and D). Between those spots they pass in front of
  // him.
  bg.layers.fg = { c, lw, f: 1.35, phase: FG_PHASE, smoke: [], anims: [], lamps: [] };
}
bg.build = function(opt = {}){
  HFSPR = opt.headframe || null;
  buildSky(); buildAirship(); buildFar(); buildMidFar(); buildMid(); buildFg();
  for (const id in bg.layers){ const L = bg.layers[id]; L.fy = Math.min(1, L.f); L.phase = L.phase || 0; }
};
bg.offset = (id, cx) => { const L = bg.layers[id]; return Math.floor((((cx * L.f + L.phase) % L.lw) + L.lw) % L.lw); };
bg.offsetY = (id, cy) => id === 'sky' ? 0 : -Math.round(REF + (cy - REF) * bg.layers[id].fy);
// Only the visible window of a wrapping layer: [off, off + VW) of a canvas lw wide (lw > VW: at most two pieces), its top at
// frame y oy, the rows in the frame.
function blit(ctx, L, off, oy){
  const y0 = Math.max(0, -oy), h = Math.min(L.c.height, VH - oy) - y0, w1 = Math.min(VW, L.lw - off); if (h <= 0) return;
  ctx.drawImage(L.c, off, y0, w1, h, 0, oy + y0, w1, h);
  if (w1 < VW) ctx.drawImage(L.c, 0, y0, VW - w1, h, w1, oy + y0, VW - w1, h);
}
// fn(sx) for both wrapped copies of layer x that are near the frame (off: the layer's offset; sx: the frame x)
function each(x, off, L, fn){ for (const lx of [x, x + L.lw]){ const sx = lx - off; if (sx > -120 && sx < VW + 120) fn(sx); } }
// a blinking warning lamp: 3 x 3 signal red with a hot pixel, on the lit frames its 1 px halo ring in the dark red step
function blink(ctx, x, y, on){ if (!on) return; R(ctx, x - 2, y - 1, 1, 3, SG[0]); R(ctx, x + 2, y - 1, 1, 3, SG[0]); R(ctx, x - 1, y - 2, 3, 1, SG[0]); R(ctx, x - 1, y + 2, 3, 1, SG[0]);
  R(ctx, x - 1, y - 1, 3, 3, SG[1]); R(ctx, x - 1, y - 1, 1, 1, SG[2]); }

// The sky: frame rows, it does not move.
bg.drawSky = function(ctx){ ctx.drawImage(sky, 0, 0); };
// The airship, which drifts right and a little against the camera: in front of the far layer (it patrols over the town, nearer
// than the distant works and the Gauturm), behind everything nearer.
function drawShip(ctx, v){
  const t = v.t, X = Math.round(((t * 0.36 - v.cx * 0.04) % 2700 + 2700) % 2700 - 360), Y = Math.round(12 + Math.sin(t * 0.01) * 6);
  if (X < VW + SHIP.beam){                // its searchlight swings up to ~360 px left of the lens: cull by the beam, not the hull
    FX.beam(ctx, X + SHIP.lens[0], Y + SHIP.lens[1], Math.PI / 2 + 0.25 + Math.sin(t * 0.013) * 0.5, 0.07, 540, 0.08, SG[2]);
    ctx.drawImage(ship, X - 1, Y - 1);
    for (const [px, py] of SHIP.props) propeller(ctx, X + px - 1, Y + py, t);
    if ((t >> 5) & 1){ R(ctx, X + SHIP.nav[0], Y + SHIP.nav[1], 3, 3, SG[1]); R(ctx, X + SHIP.nav[0], Y + SHIP.nav[1], 1, 1, SG[2]); }   // port navigation light on the fin
  }
}
bg.drawLayer = function(ctx, id, v){
  const L = bg.layers[id], off = bg.offset(id, v.cx), oy = bg.offsetY(id, v.cy), t = v.t;
  blit(ctx, L, off, oy);
  for (const a of L.anims){ const fw = a.strip.height, i = ((Math.floor(t * a.spin / (Math.PI / 3) * a.n) % a.n) + a.n) % a.n;
    each(a.x, off, L, sx => ctx.drawImage(a.strip, i * fw, 0, fw, fw, sx, a.y + oy, fw, fw)); }
  for (const l of L.lamps) each(l.x, off, L, sx => blink(ctx, sx, l.y + oy, ((t + l.x) >> 5) & 1));
  if (id === 'far'){
    each(L.beacon.x, off, L, sx => blink(ctx, sx, L.beacon.y + oy, (t >> 4) & 1));
    for (const ch of L.chim) each(ch.x, off, L, sx => { blink(ctx, sx, ch.y + oy, ((t + ch.x) >> 5) & 1); blink(ctx, sx, ch.mid + oy, ((t + ch.x + 16) >> 5) & 1); });
    ctx.fillStyle = LA[2]; for (const e of L.embers) if (hash(e.x, t >> 3) > 0.7) each(e.x, off, L, sx => ctx.fillRect(sx, e.y + oy, 1, 1));   // the heap's embers flare
    drawShip(ctx, v);
  }
};
bg.drawFg = function(ctx, v){ blit(ctx, bg.layers.fg, bg.offset('fg', v.cx), bg.offsetY('fg', v.cy)); };
})();
