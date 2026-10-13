/* art/fx.js - atmosphere: smoke and steam particles, ash, the ground fog, light glows and searchlight beams.
 *
 * NATIVE: particles, veils and lights live in the level's own px (the 960 x 540 frame, LVL.map), 1 px smoke and ash.
 *
 * API (called by engine.js; ctx is the VW x VH game canvas, v = view { cx, cy: camera top-left (native, integer), t: frame
 * counter at 60 Hz, reduceMotion }):
 *   fx.update(v)                  one fixed 60 Hz step of every particle system
 *   fx.drawLayerBack(ctx, id, v)  just before parallax layer id ('far' | 'midfar' | 'mid') is drawn: its searchlights and smoke
 *                                 (so chimneys and towers occlude their own plumes and beams)
 *   fx.drawHaze(ctx, id, v)       the veil laid over what is drawn so far: id 'far' after the far layer, 'midfar' after the
 *                                 midfar layer, 'lane' after the mid layer, right behind the playfield (always on). The layers
 *                                 paint their own depth, their own posterised ground fog and the hero's backdrop (art/bg.js), so
 *                                 the veils are only the low ground fog of the frame's bottom (fx.HAZE: zero down to the street,
 *                                 the far / midfar ones only under the far skyline); the 'lane' pass also lays the colony's smog
 *                                 bank (map ENT.smogBank, world space) over the C rooftops, where the hero stands high
 *   fx.drawPlayBack(ctx, v)       playfield, before the hero: vent steam (D), chimney smoke (C), guard-tower searchlight (B, cut
 *                                 off by the ground except over pits, with a light pool where it hits), lamp light pools
 *   fx.drawPlayFront(ctx, v)      playfield, after the hero: sodium lamp glows
 *   fx.drawAsh(ctx, v)            screen-space ash and soot flecks over everything (1 px)
 *   fx.glow(c, x, y, r, col, a), fx.beam(c, ox, oy, ang, spread, len, a, col, rows?)   helpers in the context's px (additive,
 *                                 posterised: a halo of four fading steps with 1 px dithered seams, cached per radius and colour / a
 *                                 cone in three dimming lengths with a brighter core; rows = [y0, y1] limits the beam's rows)
 *   fx.puffs                      the live particle lists { far, midfar, mid, vent, chim } (layer px for the first three, world
 *                                 px for the others; for debugging / tests); fx.HAZE, fx.BANK the veils' and the smog bank's
 *                                 numbers; fx.buildBank() (re)builds the bank's canvas
 * Sources, all in native px, come from the modules that paint them (fx copies no geometry):
 *   LVL.art.bg.layers[id].smoke   [{ x, y, rate, tone, age?, ageY?, grow, spread?, big? }] in that layer's own px (it wraps every
 *                                 layer.lw px); tone = [shadow, body, light], the three ramp steps its plume is shaded with;
 *                                 age = the steps of the plume's older part, used above the row ageY (layer y); the fx's own
 *                                 sources (the C chimneys) may also give life = the frames a puff lives (else 220, big 260);
 *   LVL.art.bg.layers.far.tower   { x, y, lights } the Gauturm's two searchlights, their lenses at (x + lights[i], y);
 *   LVL.art.props.anchors()       { lamps: [{ x, y }], searchlights: [{ x, y }], vents: [{ x, y, phase }], chimneys: [{ x, y }] }
 *                                 in world px.
 * PLUMES are pixel art, not soft discs, and each plume is ONE mass (see drawSmoke): every pixel takes the frontmost puff over it,
 * shaded by that billow's own rounded surface and by the whole plume's silhouette (lit along its upper-left edge, shaded along its
 * lower-right edge), posterised into the source's three steps with hard edges (no dither inside), its older part (above ageY, a
 * row that billows +-10 px along the layer) in the `age` steps behind a 1-row checker seam; a puff is a solid silhouette for the
 * first two thirds of its life, then erodes (its core shrinks behind a 1 px dithered rim keyed to the screen: no alpha ramps, no
 * screen door), and each plume is laid on the frame once at its pass's alpha, so overlapping puffs never stack into new colours.
 * Rasterised in JS into typed buffers, one ImageData upload per plume cluster (cost: see drawSmoke).
 * DETERMINISTIC: every random choice of a particle comes from one seeded stream (rng 1957), so the same sequence of updates draws
 * the same frame (the playtest measures rendered frames).
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, M = LVL.map;
const { RAMP, VW, VH, rng, hash, noise, fbm, mk } = S, NGY = M.GROUND * M.TS;
const fx = LVL.art.fx = {};
const SM = RAMP.smog, LA = RAMP.lamp, DU = RAMP.dusk, CO = RAMP.coal, SG = RAMP.signal;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------- helpers ----------
// Additive halo: four nested discs (GLOWR x r) whose rims are 1 px Bayer seams (half the pixels of the ring a step in), so the halo
// reads as posterised light, not hard concentric circles; each ring holds about half the light of the one inside it (GLOWLV), so
// the halo fades out instead of ending in a disc. Cached as one sprite per (r, col), laid at 3 a.
const GLOWS = new Map(), GLOWR = [1, 0.7, 0.46, 0.26], GLOWLV = [0, 0.08, 0.2, 0.45, 1];
function glowSprite(r, col){
  const key = r + col; let G = GLOWS.get(key); if (G) return G;
  const n = 2 * r + 1, [c, g] = mk(n, n), img = g.createImageData(n, n), d = img.data, v = parseInt(col.slice(1), 16), rad = GLOWR.map(q => q * r);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++){ const e = Math.sqrt(x * x + y * y), b = BAYER[((y + r) & 3) * 4 + ((x + r) & 3)];
    let k = 0; for (const q of rad) if (e <= q - 0.5 || (e <= q + 0.5 && b < 8)) k++;
    if (!k) continue; const i = ((y + r) * n + x + r) * 4, l = GLOWLV[k]; d[i] = (v >> 16 & 255) * l; d[i + 1] = (v >> 8 & 255) * l; d[i + 2] = (v & 255) * l; d[i + 3] = 255; }
  g.putImageData(img, 0, 0); G = c; GLOWS.set(key, G); return G;
}
fx.glow = function(c, x, y, r, col, a){ r = Math.round(r); c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, 3 * a); c.drawImage(glowSprite(r, col), Math.round(x) - r, Math.round(y) - r); c.restore(); };
// Additive searchlight cone from (ox, oy) at angle ang (radians, 0 = right, y down), half-width spread, length len: three lengths
// at a, 0.7 a, 0.4 a (it thins out with distance) and a core cone of 0.4 x the spread on the axis, as integer row spans (the
// rule of style.poly, for convex shapes). The light of the four is summed per pixel in JS (BEAM.lit, in 1/4096ths, the frame's
// px), turned into col x its light (one table per colour) and laid on the context in strips of BEAM.strip rows: per strip one
// putImageData of the span it covers into that strip's own small canvas (BEAM.cs: a canvas the frame may still be reading from is
// only as big as one strip when the next beam writes it), then per strip one additive drawImage (every upload before the first
// composite): a few dozen canvas calls per beam instead of a fillRect per row and cone.
const BEAM = { strip: 24, lit: new Uint16Array(VW * VH), img: new ImageData(VW, VH), x0: new Int16Array(Math.ceil(VH / 24)), x1: new Int16Array(Math.ceil(VH / 24)), tab: new Map() };
BEAM.px = new Uint32Array(BEAM.img.data.buffer); BEAM.cs = Array.from(BEAM.x0, () => mk(VW, BEAM.strip));
// add light v over the convex polygon pts (frame px) within rows ya..yb, widening the strips' spans
function beamFill(pts, v, ya, yb){
  const { strip, lit, x0, x1 } = BEAM, n = pts.length >> 1; let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pts.length; i += 2){ if (pts[i] < lo) lo = pts[i]; if (pts[i] > hi) hi = pts[i]; }
  for (let y = Math.max(ya, Math.round(lo)), ye = Math.min(yb, Math.round(hi)); y <= ye; y++){ const yc = y + 0.5; let xa = Infinity, xb = -Infinity;
    for (let i = 0; i < n; i++){ const j = (i + 1) % n, ay = pts[2 * i + 1], by = pts[2 * j + 1];
      if ((yc < ay) !== (yc < by)){ const x = pts[2 * i] + (yc - ay) / (by - ay) * (pts[2 * j] - pts[2 * i]); if (x < xa) xa = x; if (x > xb) xb = x; } }
    const p = Math.max(0, Math.round(xa)), q = Math.min(VW, Math.round(xb)); if (q <= p) continue;
    for (let x = p, o = y * VW; x < q; x++) lit[o + x] += v;
    const s = y / strip | 0; if (p < x0[s]) x0[s] = p; if (q > x1[s]) x1[s] = q; }
}
fx.beam = function(c, ox, oy, ang, spread, len, a, col, rows){
  const { strip, lit, px, x0, x1 } = BEAM, P = (l, s) => [ox + Math.cos(ang + s) * l, oy + Math.sin(ang + s) * l];
  const ya = Math.max(0, rows ? rows[0] : 0), yb = Math.min(VH - 1, rows ? rows[1] : VH - 1);
  x0.fill(VW); x1.fill(0);
  for (let k = 0; k < 3; k++) beamFill([...P(len * k / 3, -spread), ...P(len * (k + 1) / 3, -spread), ...P(len * (k + 1) / 3, spread), ...P(len * k / 3, spread)], Math.round(a * (1 - k * 0.3) * 4096), ya, yb);
  beamFill([ox, oy, ...P(len * 0.8, -spread * 0.4), ...P(len * 0.8, spread * 0.4)], Math.round(a * 0.6 * 4096), ya, yb);
  let tab = BEAM.tab.get(col); if (!tab){ tab = new Uint32Array(4097); const n = parseInt(col.slice(1), 16);
    for (let l = 1; l <= 4096; l++){ const f = l / 4096; tab[l] = (0xff000000 | Math.round((n & 255) * f) << 16 | Math.round((n >> 8 & 255) * f) << 8 | Math.round((n >> 16) * f)) >>> 0; }
    BEAM.tab.set(col, tab); }
  for (let s = 0; s < x0.length; s++){ if (x1[s] <= x0[s]) continue; const y0 = s * strip, y1 = Math.min(VH, y0 + strip);
    for (let y = y0; y < y1; y++) for (let x = x0[s], o = y * VW; x < x1[s]; x++){ const l = lit[o + x]; px[o + x] = tab[l > 4096 ? 4096 : l]; lit[o + x] = 0; }
    BEAM.cs[s][1].putImageData(BEAM.img, 0, -y0, x0[s], y0, x1[s] - x0[s], y1 - y0); }
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
  for (let s = 0; s < x0.length; s++){ if (x1[s] <= x0[s]) continue; const y0 = s * strip, h = Math.min(VH, y0 + strip) - y0, w = x1[s] - x0[s]; c.drawImage(BEAM.cs[s][0], x0[s], 0, w, h, x0[s], y0, w, h); }
  c.restore();
};
// Additive pool of light lying on a street surface at y = gy: flat rows getting narrower downward over the lit crust.
const POOL = [1, 0.97, 0.9, 0.8, 0.68, 0.55, 0.4, 0.27, 0.15];
function pool(c, cx, gy, hw, a, col){
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.fillStyle = col;
  POOL.forEach((k, i) => { const w = Math.round(hw * k); c.fillRect(Math.round(cx) - w, gy + i, 2 * w, 1); });
  c.restore();
}
// Columns with no floor (pits): a beam may go on down there.
const PITS = []; for (let c0 = 0; c0 < M.MW; c0++) if (M.standRow(c0) >= M.MH && M.standRow(c0 - 1) < M.MH){ let c1 = c0; while (c1 + 1 < M.MW && M.standRow(c1 + 1) >= M.MH) c1++; PITS.push([c0 * M.TS, (c1 + 1) * M.TS]); }

// ---------- particles ----------
const rnd = rng(1957);
const puffs = { far: [], midfar: [], mid: [], vent: [], chim: [] };
// tones of the playfield's own plumes: D vent steam (white, lit), C chimney smoke (coal smoke lit by the sunset smog: the colony's
// smoke is one of the local lifts behind the hero on the rooftops, VALUE rule; a hero's height over its chimney's top, where he
// no longer stands in front of it, it darkens into the smoky top of the sky: SKY rule)
const VENT = [SM[6], SM[7], SM[8]], CHIM = [SM[5], SM[6], SM[7]], CHIM_AGE = [SM[3], SM[4], SM[5]];
// ash and soot flecks over the frame, 1 px each; d = depth (how much faster than the playfield it drifts with the camera); the
// dark (soot) and light (ash) ones in two lists, so a frame sets the colour twice
const ASH = Array.from({ length: 128 }, (_, i) => { const r = rng(i * 31 + 3); return { x: r() * VW, y: r() * VH, vy: 0.45 + r() * 1.05, ph: r() * 6, d: 0.8 + r() * 0.6, dark: r() < 0.35 }; });
const ashL = ASH.filter(a => !a.dark), ashD = ASH.filter(a => a.dark);
// srcs in layer / world px; wrap = the layer's wrap width. A puff remembers its source (its plume: drawSmoke shades plume by plume)
// and m, the plume's light offset (px from a pixel to the open air that makes it an edge of the mass); sw (optional, 1) weighs its
// billow's own rounded surface against a flat body in the shading (rising to 1 as the puff ages: a jet that billows out at its
// top), dr (optional, 0.995) its rise's drag per frame, ax (optional, 0) a sideways push per frame (the jet's top spreading out).
function updSmoke(list, srcs, wrap){
  for (let k = 0; k < srcs.length; k++){ const s = srcs[k]; if (rnd() < s.rate) list.push({ x: s.x + (rnd() - 0.5) * (s.spread || 12), y: s.y, r: s.big ? 12 : 4,
    vx: -0.36 - rnd() * 0.3, vy: -0.54 - rnd() * 0.45, life: 0, max: s.life || (s.big ? 260 : 220), tone: s.tone, age: s.age, ageY: s.ageY, g: s.grow, src: s, m: s.big ? 7 : 4 }); }
  for (let i = list.length - 1; i >= 0; i--){ const q = list[i]; q.vx += q.ax || 0; q.x += q.vx; q.y += q.vy; q.vy *= q.dr || 0.995; q.r += q.g; q.life++; if (wrap && q.x < 0) q.x += wrap; if (q.life > q.max) list.splice(i, 1); }
}
// A puff's dissolve level (0..16): grows in over 3 frames, solid (16) for the first two thirds of its life, then erodes away.
const level = q => Math.max(0, Math.round(16 * Math.min(1, (q.life + 1) / 3, 3 * (1 - q.life / q.max))));

// ---------- plume rasteriser ----------
// Per radius r and dissolve level: the puff's row spans (spans: per row dy = -r..r, the half-width of its solid core [2 (dy + r)]
// and of its rim [2 (dy + r) + 1], -1 = none): a whole puff (level 16) is all core, a hard silhouette; an old one does not thin
// out into a screen door, it ERODES: its core shrinks with the level (radius r x sqrt(level / 16)) behind a 1 px rim drawn where
// the screen's Bayer cell is < 8. And its surface light (nrm: the sphere normal of the billow . the upper-left light, -1..1).
// Built once per (r, level) / r.
const LIT = [-0.5, -0.62, 0.6];
const spanT = new Map(), nrms = new Map();
function spans(r, lv){
  const k = r * 32 + lv; let T = spanT.get(k); if (T) return T;
  const rk = r * Math.sqrt(lv / 16), solid = lv >= 16 ? rk + 0.5 : rk - 0.5; T = new Int16Array(2 * (2 * r + 1)).fill(-1);
  for (let y = -r; y <= r; y++) for (let x = 0; x <= r; x++){ const e = Math.sqrt(x * x + y * y);
    if (e <= solid) T[2 * (y + r)] = x; if (e < rk + 0.5) T[2 * (y + r) + 1] = x; }
  spanT.set(k, T); return T;
}
function nrm(r){
  let N = nrms.get(r); if (N) return N;
  const n = 2 * r + 1, rr = Math.max(1, r); N = new Float32Array(n * n);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++){ const u = x / rr, w = y / rr, z = Math.sqrt(Math.max(0, 1 - u * u - w * w));
    N[(y + r) * n + x + r] = u * LIT[0] + w * LIT[1] + z * LIT[2]; }
  nrms.set(r, N); return N;
}
// The row where a plume turns to its age steps billows along the layer (+-10 px, period 384 px of layer x): not a ruled line.
const AGEW = Int8Array.from({ length: 384 }, (_, i) => Math.round(15 * (noise(i / 19.5, 3) - 0.5) + 7.5 * (noise(i / 7.5, 9) - 0.5)));
// tone triples as packed RGBA words of the ImageData (little endian: 0xAABBGGRR)
const words = new Map();
function word(tone){ let W = words.get(tone); if (!W){ W = new Uint32Array(tone.map(h => { const n = parseInt(h.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; })); words.set(tone, W); } return W; }
// One frame buffer of puff indices (-1 = air) and one of pixels, shared by every pass, and per frame row the span of x the
// cluster being drawn covers; one canvas per pass for the upload (it is written only before that pass's composites, and next
// frame: never while drawn).
const ids = new Int16Array(VW * VH).fill(-1), plume = new ImageData(VW, VH), px = new Uint32Array(plume.data.buffer), rowA = new Int16Array(VH), rowB = new Int16Array(VH);
const passC = {};
// visible puffs of the pass being drawn (screen centre, radius, row spans, cluster, surface light table, tone words, age words, light
// offset m, surface weight sw, the age row on screen or -1e9), their plume rectangles [x0, y0, x1, y1, cluster] and the plume of
// each source (reused: no per-frame allocation)
const VX = [], VY = [], VR = [], VL = [], VC = [], VN = [], VT = [], VA = [], VM = [], VS = [], VG = [], box = [], srcBox = new Map();
// One plume pass: every puff of `list` (layer / world px, scrolled by off and oy; lw = wrap width for the wrapped copy), grouped
// into plumes by source (overlapping plumes merge into one cluster), each cluster rasterised and shaded in its own screen
// rectangle, uploaded into the pass canvas (all uploads before any composite, so no canvas is written while the frame still reads
// it), then laid on ctx at alpha a. key names the pass (its own canvas). Cost: a typed-array fill per row of every visible puff's
// solid core plus a test per pixel of its rim (back to front), one shading step per pixel of each cluster's row spans.
function drawSmoke(ctx, key, list, off, oy, lw, a){
  let n = 0, nb = 0; srcBox.clear();
  for (const q of list){ const lv = level(q); if (lv <= 0) continue; const r = Math.round(q.r);
    for (let w = 0; w < (lw ? 2 : 1); w++){ const cx = Math.round(q.x + w * lw - off), cy = Math.round(q.y + oy);
      if (cx - r >= VW || cx + r < 0 || cy - r >= VH || cy + r < 0) continue;
      let b = srcBox.get(q.src); if (b === undefined){ b = nb++; if (!box[b]) box[b] = []; const B = box[b]; B[0] = VW; B[1] = VH; B[2] = 0; B[3] = 0; B[4] = b; srcBox.set(q.src, b); }
      const B = box[b]; B[0] = Math.min(B[0], cx - r); B[1] = Math.min(B[1], cy - r); B[2] = Math.max(B[2], cx + r + 1); B[3] = Math.max(B[3], cy + r + 1);
      VX[n] = cx; VY[n] = cy; VR[n] = r; VL[n] = spans(r, lv); VC[n] = b; VN[n] = nrm(r); VT[n] = word(q.tone); VA[n] = q.age ? word(q.age) : null;
      VM[n] = q.m; VS[n] = q.sw ? q.sw + (1 - q.sw) * q.life / q.max : 1; VG[n] = q.age ? q.ageY + oy : -1e9; n++; } }
  if (!n) return;
  // merge overlapping plume rectangles until none overlap (box[i][4] = the cluster it was merged into): the clusters are disjoint,
  // so each one's upload never overwrites another's pixels in the pass canvas
  for (let again = true; again;){ again = false;
    for (let i = 0; i < nb; i++) for (let j = i + 1; j < nb; j++){ const A = box[i], B = box[j];
      if (A[4] !== i || B[4] !== j || A[0] >= B[2] || B[0] >= A[2] || A[1] >= B[3] || B[1] >= A[3]) continue;
      A[0] = Math.min(A[0], B[0]); A[1] = Math.min(A[1], B[1]); A[2] = Math.max(A[2], B[2]); A[3] = Math.max(A[3], B[3]); B[4] = i; again = true; } }
  for (let k = 0; k < n; k++){ let b = VC[k]; while (box[b][4] !== b) b = box[b][4]; VC[k] = b; }
  let P = passC[key]; if (!P){ const [c, g] = mk(VW, VH); P = passC[key] = { c, g }; }
  for (let ci = 0; ci < nb; ci++){ const B = box[ci]; if (B[4] !== ci) continue;
    const x0 = Math.max(0, B[0]), y0 = Math.max(0, B[1]), x1 = Math.min(VW, B[2]), y1 = Math.min(VH, B[3]); B[0] = x0; B[1] = y0; B[2] = x1; B[3] = y1;
    if (x1 <= x0 || y1 <= y0){ B[4] = -1; continue; }
    for (let y = y0; y < y1; y++){ ids.fill(-1, y * VW + x0, y * VW + x1); rowA[y] = x1; rowB[y] = x0; }
    // rasterise, back to front (older puffs first: the younger, lower billows are in front): the solid core of each row in one
    // fill, the rim where the Bayer cell is < 8
    for (let k = 0; k < n; k++){ if (VC[k] !== ci) continue;
      const r = VR[k], cx = VX[k], cy = VY[k], T = VL[k], ya = Math.max(y0, cy - r), yb = Math.min(y1 - 1, cy + r);
      for (let y = ya; y <= yb; y++){ const j = 2 * (y - cy + r), w = T[j + 1]; if (w < 0) continue;
        const s = T[j], o = y * VW, bz = (y & 3) << 2, xa = Math.max(x0, cx - w), xb = Math.min(x1 - 1, cx + w); if (xa > xb) continue;
        if (xa < rowA[y]) rowA[y] = xa; if (xb + 1 > rowB[y]) rowB[y] = xb + 1;
        const sa = s < 0 ? cx + 1 : Math.max(xa, cx - s), sb = s < 0 ? cx : Math.min(xb, cx + s);
        if (sa <= sb) ids.fill(k, o + sa, o + sb + 1);
        for (let x = xa; x < Math.min(sa, xb + 1); x++) if (BAYER[bz | (x & 3)] < 8) ids[o + x] = k;
        for (let x = Math.max(sb + 1, xa); x <= xb; x++) if (BAYER[bz | (x & 3)] < 8) ids[o + x] = k; } }
    // shade (within each row's span): billow surface (weighed against a flat body by sw) + the plume's lit upper-left edge /
    // shaded lower-right edge, posterised with hard edges; age steps above ageY (layer y), a 1-row checker seam
    for (let y = y0; y < y1; y++){ const o = y * VW, xa = rowA[y], xb = rowB[y];
      px.fill(0, o + x0, o + x1);
      for (let x = xa; x < xb; x++){ const k = ids[o + x]; if (k < 0) continue;
        const r = VR[k], m = VM[k], g = VG[k];
        let v = (VN[k][(y - VY[k] + r) * (2 * r + 1) + x - VX[k] + r] - 0.3) * VS[k] + 0.3, T = VT[k];
        if (x - m < x0 || y - m < y0 || ids[o - m * VW + x - m] < 0) v += 0.42;
        if (x + m >= x1 || y + m >= y1 || ids[o + m * VW + x + m] < 0) v -= 0.42;
        if (g > -1e8){ const ay = g + AGEW[(x + off) % 384]; if (y < ay || (y === ay && (x & 1))) T = VA[k]; }
        px[o + x] = T[v > 0.66 ? 2 : v < 0.02 ? 0 : 1]; } }
    P.g.putImageData(plume, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
  ctx.globalAlpha = a;
  for (let ci = 0; ci < nb; ci++){ const B = box[ci]; if (B[4] !== ci) continue; ctx.drawImage(P.c, B[0], B[1], B[2] - B[0], B[3] - B[1], B[0], B[1], B[2] - B[0], B[3] - B[1]); }
  ctx.globalAlpha = 1;
}
// plume pass alphas: distant coal smoke is faint, the cooling-tower steam dense
const PASS = { far: 0.5, midfar: 0.75, mid: 0.65, vent: 0.85, chim: 0.75 };

// the C roof chimneys as smoke sources (built once per props.anchors() result: same objects every frame)
let chimSrc = null, chimOf = null;
fx.update = function(v){
  const bg = LVL.art.bg, t = v.t, an = LVL.art.props.anchors();
  for (const id of ['far', 'midfar', 'mid']){ const L = bg.layers[id]; updSmoke(puffs[id], L.smoke, L.lw); }
  // D vents: a 1 s burst every 200 steps, a rising column - each puff keeps rising for its whole life (drag 0.99: still ~40 % of its
  // start speed when it goes, ~3 m up), widens slowly as it rises (r 3 -> ~12) and leans left with the chimney smoke's drift (ax),
  // its top thinning as the oldest puffs erode: no puff stalls under a younger one, so the burst never piles up into a cap
  for (const vt of an.vents){ const ph = (t + vt.phase) % 200;
    if (ph < 60) puffs.vent.push({ x: vt.x + (rnd() - 0.5) * 3, y: vt.y - 3, r: 3, vx: (rnd() - 0.5) * 0.2, ax: -0.004 - rnd() * 0.004, vy: -2.2 - rnd() * 0.8, life: 0, max: 96, tone: VENT, g: 0.1, src: vt, m: 3, sw: 0.4, dr: 0.99 }); }
  updSmoke(puffs.vent, []);
  // C roof chimneys: slow coal smoke drifting left
  if (chimOf !== an){ chimOf = an; chimSrc = an.chimneys.map(c => ({ x: c.x, y: c.y, rate: 0.15, life: 180, tone: CHIM, age: CHIM_AGE, ageY: c.y - S.SCALE.hero, grow: 0.105, spread: 18 })); }
  updSmoke(puffs.chim, chimSrc);
  if (!v.reduceMotion) for (const a of ASH){ a.y += a.vy; a.x += Math.sin(t * 0.02 + a.ph) * 0.6 - 0.45; if (a.y > VH){ a.y = -3; a.x = rnd() * VW; } }
};

// ---------- draw passes ----------
fx.drawLayerBack = function(ctx, id, v){
  const bg = LVL.art.bg, L = bg.layers[id], off = bg.offset(id, v.cx), oy = bg.offsetY(id, v.cy), t = v.t;
  if (id === 'far'){   // Gauturm: its two searchlights sweeping out of sync, the beams behind the tower silhouette
    const T = L.tower, [a, b] = T.lights;
    for (const x of [T.x, T.x + L.lw]){ const sx = x - off; if (sx < -600 || sx > VW + 600) continue;
      fx.beam(ctx, sx + a, T.y + oy, -Math.PI / 2 + Math.sin(t * 0.008) * 0.9, 0.05, 780, 0.07, SG[2]);
      fx.beam(ctx, sx + b, T.y + oy, -Math.PI / 2 + Math.sin(t * 0.006 + 2) * 0.8, 0.05, 780, 0.06, SG[2]); }
  }
  drawSmoke(ctx, id, puffs[id], off, oy, L.lw, PASS[id]);
};
// The veils: the sunset-lit ground fog (dusk[6]) laid over everything drawn so far, in 12 px bands. Each veil is a list of
// [y, alpha] stops (linear between them, flat beyond, alpha quantised to 0.02), in its layer's rows (far, midfar) or the world's
// (lane). The layers paint their own fogged feet (flat posterised steps under a fog line, art/bg.js), so the far / midfar veils
// only touch the rows under the far skyline (hidden by the nearer layers), and the lane veil is the low ground fog of the level's
// bottom ~150 px (pits, the C street dip): the owner's dark upper sky and the sunset band stay exactly as painted (SKY in style.js).
const HAZE = { col: DU[6],
  far:    [[0, 0], [516, 0], [546, 0.04]],
  midfar: [[0, 0], [528, 0], [570, 0.04]],
  lane:   [[0, 0], [504, 0], [552, 0.08], [672, 0.16]] };
fx.HAZE = HAZE;
function hazeAt(stops, y){
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++){ const [y1, a1] = stops[i], [y0, a0] = stops[i - 1]; if (y <= y1) return a0 + (a1 - a0) * (y - y0) / (y1 - y0); }
  return stops[stops.length - 1][1];
}
fx.drawHaze = function(ctx, id, v){
  const st = HAZE[id] || HAZE.lane, top = id === 'far' || id === 'midfar' ? LVL.art.bg.offsetY(id, v.cy) : -v.cy;   // frame y of its rows' 0
  const aAt = y => Math.round(hazeAt(st, y - top + 6) * 50) / 50;
  ctx.fillStyle = HAZE.col;
  for (let y = 0; y < VH;){ const a = aAt(y); let y1 = y + 12; while (y1 < VH && aAt(y1) === a) y1 += 12;     // one rect per run of equal bands
    if (a > 0){ ctx.globalAlpha = a; ctx.fillRect(0, y, VW, Math.min(VH, y1) - y); } y = y1; }
  ctx.globalAlpha = 1;
  if (id === 'lane') drawBank(ctx, v);
};
// The colony's smog bank (map ENT.smogBank, world px): coal smoke from the familok chimneys pooling over the C rooftops in the
// still evening air, where the hero stands highest against the dark sky (the local lift of the VALUE rule up there). It lies on an
// envelope of the roofline (map standRow; curving up where the roofs step up, so it banks against the higher house) and is a
// mound, not a slab: its height over that envelope is BANK.h x k, k easing from 0 at the street gaps and the bank's ends to 1
// BANK.side px inside them; within it the density falls from full (BANK.alpha's last step) at BANK.full x k over the roof to
// nothing at the top, and that falloff is broken into horizontal wisps (fbm stretched 8:1 along x: smoke settles in layers in still
// air). Posterised into BANK.alpha's flat steps of smog[8] (no dither), each wisp's upper edge one step denser (the dome light
// on it). Under each column's own roof it is cut off (it lies behind the houses there). Built once, at first use.
const BANK = { alpha: [0, 0.06, 0.12, 0.19, 0.26, 0.33, 0.4], col: SM[8], h: 132, full: 66, side: 180, wisp: 0.3 };
fx.BANK = BANK;
let bankC = null;
function buildBank(){
  const b = M.ENT.smogBank, X0 = b.c0 * M.TS, W = (b.c1 - b.c0) * M.TS, H = b.y1 - b.y0, [c, g] = mk(W, H), img = g.createImageData(W, H), d = new Uint32Array(img.data.buffer);
  const n = parseInt(BANK.col.slice(1), 16), L = BANK.alpha.length - 1, word = BANK.alpha.map(a => ((Math.round(a * 255) << 24) | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0);
  // per column: the roof under it (a standable row above the street: the familok tops, catwalk and ladder heads), the envelope
  // over the roofs and the distance to the nearest column without one (the street gaps and the bank's ends)
  const raw = Array.from({ length: W }, (_, x) => { const r = M.standRow(Math.floor((X0 + x) / M.TS)) * M.TS; return r < (M.GROUND - 1) * M.TS ? r : null; });
  const env = new Float32Array(W), gap = new Float32Array(W).fill(1e9);
  for (let x = 0; x < W; x++){ let m = Infinity; for (let dx = -160; dx <= 160; dx++){ const q = raw[x + dx]; if (q != null) m = Math.min(m, q + Math.abs(dx) * 0.25 + dx * dx * 0.004); } env[x] = m; }
  for (let x = 0, last = -1e9; x < W; x++){ if (raw[x] === null) last = x; gap[x] = x - last; }
  for (let x = W - 1, last = 1e9; x >= 0; x--){ if (raw[x] === null) last = x; gap[x] = Math.min(gap[x], last - x); }
  const lv = new Uint8Array(W * H);
  for (let x = 0; x < W; x++){
    if (raw[x] === null) continue;
    const u = Math.min(1, gap[x] / BANK.side), k = u * u * (3 - 2 * u), top = BANK.h * k, full = BANK.full * k;
    if (top < 2) continue;
    for (let y = 0; y < H; y++){
      const wy = b.y0 + y, h = env[x] - wy; if (wy >= raw[x] || h >= top) continue;
      const f = h <= full ? 1 : 1 - (h - full) / (top - full), w = (fbm((X0 + x) / 72, wy / 9, 3, 13) - 0.5) * 2 * BANK.wisp;
      lv[y * W + x] = Math.max(0, Math.min(L, Math.round((f + w * Math.min(1, 1.6 * (1 - f))) * L * (0.55 + 0.45 * k))));
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = y * W + x; let l = lv[i]; if (!l) continue;
    if (l < L && y > 0 && lv[i - W] < l && (y < 2 || lv[i - 2 * W] < l)) l++;          // a wisp's upper edge: the dome light on it
    d[i] = word[l]; }
  g.putImageData(img, 0, 0); bankC = c;
}
function drawBank(ctx, v){
  const b = M.ENT.smogBank, x = b.c0 * M.TS - v.cx;
  if (!bankC) buildBank();
  if (x < VW && x + bankC.width > 0) ctx.drawImage(bankC, x, b.y0 - v.cy);
}
fx.buildBank = buildBank;
fx.drawPlayBack = function(ctx, v){
  const t = v.t, an = LVL.art.props.anchors(), cx = v.cx, cy = v.cy;
  for (const l of an.lamps){ const sx = l.x - cx; if (sx > -90 && sx < VW + 90) pool(ctx, sx, M.standRow(Math.floor(l.x / M.TS)) * M.TS - cy, 51, 0.09, LA[2]); }
  drawSmoke(ctx, 'vent', puffs.vent, cx, -cy, 0, PASS.vent);
  drawSmoke(ctx, 'chim', puffs.chim, cx, -cy, 0, PASS.chim);
  // guard searchlight sweeping the ground by the tower: the cone stops at the street (a light pool where its axis meets it) and
  // only goes on down over pits
  for (const s of an.searchlights){ const ox = s.x - cx, oy = s.y - cy; if (ox < -600 || ox > VW + 600) continue;
    const ang = Math.PI / 2 + Math.sin(t * 0.012) * 0.75, spread = 0.09, len = 450, gy = NGY - cy;
    fx.beam(ctx, ox, oy, ang, spread, len, 0.11, LA[4], [-1, gy - 1]);
    for (const [x0, x1] of PITS){ if (x1 - cx < -15 || x0 - cx > VW + 15) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(x0 - cx, gy, x1 - x0, VH); ctx.clip(); fx.beam(ctx, ox, oy, ang, spread, len, 0.11, LA[4], [gy, VH + 1]); ctx.restore(); }
    const tt = (NGY - s.y) / Math.sin(ang), hx = s.x + Math.cos(ang) * tt;
    if (tt < len && !PITS.some(([x0, x1]) => hx >= x0 && hx < x1)) pool(ctx, hx - cx, gy, Math.max(12, Math.round(tt * Math.tan(spread))), 0.16, LA[4]);
  }
};
fx.drawPlayFront = function(ctx, v){
  const t = v.t;
  for (const l of LVL.art.props.anchors().lamps){ const sx = l.x - v.cx;
    if (sx > -120 && sx < VW + 120){ const fl = (hash(l.x, t >> 2) > 0.97) ? 0.03 : 0.1; fx.glow(ctx, sx, l.y - v.cy, 66, LA[2], fl); } }
};
// (screen space; a fleck drifts with the camera (d - 1) x 0.6 faster than the playfield: the nearer ones a little faster)
fx.drawAsh = function(ctx, v){
  const cx = v.cx, cy = v.cy;
  for (const [list, col] of [[ashL, SM[7]], [ashD, CO[1]]]){ ctx.fillStyle = col;
    for (const a of list){ const k = (a.d - 1) * 0.6, x = Math.round((((a.x - cx * k) % VW) + VW) % VW), y = Math.round((((a.y - cy * k) % VH) + VH) % VH); ctx.fillRect(x, y, 1, 1); } }
};
fx.puffs = puffs;
})();
