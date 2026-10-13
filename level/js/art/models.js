/* art/models.js - the owner's three 3D models (a mining headframe, a rusty 200 l drum, a car of two mine tubs) as pixel sprites,
 * for the playfield and its movers (the parallax layers keep art/bg.js's painted lattice headframes: tall and slender against the
 * sunset, they read better at that distance than this squat strut frame scaled down; they are painted in this model's materials,
 * rust steelwork and teal sheaves, seen through the smog: style.js's headframes track).
 *
 * The sprites are rendered offline from level/models/*.glb by tools/model_sprites.mjs in the hero's pipeline: an orthographic
 * render at SCALE.pxPerM (52.5 px per metre), the texture sorted into material classes, the light from the upper left posterised
 * into the bands of the style.js ramps (violet shadows, amber lights), the silhouette straightened, every member bevelled (lit top /
 * left edge, shadowed bottom / right edge), inner depth lines, hand-placed detail (hoops, rims, stencils, rivets), a 1 px outline:
 * style.js OUTLINE round the movers (things you stand on), the darkest step of the ramp it touches round the scenery. They come as
 * ONE atlas, sprites/models.png, described by sprites/models.json. This module only loads and draws them (and the headframe's
 * warning lamp): the sprites look exactly as rendered. Where they stand: map ENT (the headframe over the shaft, the hunts' movers,
 * the story props ENT.models), drawn by art/props.js.
 *
 * SPRITES (models.json: per name { x, y, w, h: atlas rect, ax, ay: anchor, top, layer, ... }; px):
 *   headframe            the E playfield Fördergerüst (334 x 364): its anchor is the SHAFT's centre line on the street; its legs
 *                        stand on concrete plinths either side of the 5-tile shaft (feet: the runs of its lowest row, 2 and 1 px
 *                        clear of it), its raking strut leans right, down toward the winding-engine house; a cage guide runs up the
 *                        shaft's left edge to the deck; top = 382 px over the street, its sheaves' rims included (the E street view
 *                        shows 396: the playtest wants the top >= 8 px under the frame's); lamp = the top of its column. The model's
 *                        stairs and inner post that stood over the shaft are cut out up to 2.6 m: the cage (3.3 m) covers that bay
 *                        while it is up. Its interior is the recipe's own straight members where the generated mesh melted (a truss
 *                        under the deck, the gear housing on a third girder, the low beam, solid column and strut, a base plate
 *                        under the strut), built up like the props round it: flanges (lit and proud on the upper left, in shadow on
 *                        the lower right), riveted batten straps about every metre, gusset plates at the main joints (the strut
 *                        foot's two thick enough to stand proud of it), the housing's riveted panels, hatch and bearing cap, rust
 *                        runs under some rivets, most at the joints; no see-through slit between two members (the outline seals
 *                        them). Above 1.6 m the frame stands dark against the sunset, under it its feet take the street's light,
 *                        through a 4-row dither (VALUE).
 *   sheave               its sheave wheel (r 39): 12 frames over one spoke period (8 spokes: pi / 4), each frame's anchor its axle;
 *                        the headframe lists its wheels left to right: sheaves [{ x, y, r, sprite }] (the axle relative to its
 *                        top-left)
 *   barrel_a, barrel_b, barrel_c        a 200 l drum (0.88 m: 46 px + outline) upright, turned three ways: two rolling hoops (a lit
 *                        ridge over its shadow), the ochre hazard stripe between them (worn through at a few chips), the lit chime
 *                        round its lid, its bungs; barrel_lying (on its side: the end a flat disc with its rim and bung);
 *                        barrel_stack (two lying, one on top)
 *   cart_tub             the cart MOVER (SCALE.cart): one tub of the model, lengthened in its middle to a 108 px rolled rim (deck
 *                        { y, x0, x1 } = the rim the hero stands on, the coal heaped a few px proud of it), its stiffening hoop and
 *                        the lit upper wall, the stencilled car number and pit mark (17, K3) on a smooth plate with one ding,
 *                        rivets, ribs with the pressed plate between them catching the light, the chassis bar, axle boxes, flanged
 *                        wheels: their treads 56 px under the rim (on the B rail head, 4 px over the street: the mover's 60 px)
 *   cart_pair            both tubs of the model, coupled (the coupling 6 px longer), as a mover: its deck spans both rims, 108 px
 *   cart_parked          the whole car as modelled, the pickaxe in its load: a prop, not solid (its anchor is under its wheel
 *                        treads: on a rail head, 4 px over the street, as the movers' wheels)
 * The anchor (ax, ay) is the point the sprite stands on: the ground row boundary under its middle (its outline row lies on the top
 * row of the ground, as the hero's does), the shaft line for the headframe, the axle for a wheel. The movers (layer 'mover') are
 * outlined in style.js OUTLINE, the things you stand on; everything else in the darkest step of the ramp it touches (never OUTLINE).
 *
 * LOAD CONTRACT. The headframe and the props are baked into the static playfield and props.headframe() / the ropes / the playtest
 * read headframeGeo, all at build time, so the build must run AFTER the sprites are in: engine.js boots with
 * `LVL.art.models.load().then(boot)` (load() never rejects: on a missing or broken atlas, or none within LOAD_TIMEOUT - a hung
 * request must not keep the first frame from ever drawing; an atlas arriving later is ignored, so nothing switches mid-game -
 * models.err is set, one console warning, get() stays null and every caller builds its painted fallback, or - the story props -
 * draws nothing).
 *
 * API (native px; integer positions; nothing is drawn before models.ready):
 *   models.load()                    -> Promise (once): fetches models.json and the atlas (relative URLs); then models.ready = true,
 *                                       or models.err = the message (also after LOAD_TIMEOUT ms without both)
 *   models.get(name)                 the sprite's entry (see SPRITES) or null (not loaded, or no such sprite)
 *   models.draw(g, name, x, y, frame)   the sprite with its anchor at (x, y) (a wheel: frame, wrapped)
 *   models.headframe(id)             the headframe sprite of a layer, id 'play' (the playfield) -> its name
 *   models.headframeGeo(id, x, gy)   where that headframe is with its anchor at (x, gy): { x, x1 (its sprite's left / right), top (its
 *                                       highest painted row, its sheaves included), feet [[x0, x1)] (its legs on the ground),
 *                                       sheaves [{ x, y, r }] (axles, left to right), lamp { x, y } } - world px for the ropes and
 *                                       the cage (art/props.js), the warning lamp and the camera / the playtest (props.headframe())
 *   models.drawHeadframe(g, id, x, gy)   the frame, without its wheels (static: into the playfield, behind the tiles)
 *   models.drawSheaves(ctx, id, x, gy, ang)   its wheels turned to ang (screen radians, clockwise positive, as props.drawDynamic
 *                                       turns them: the rope's travel / r), or ang = [one angle per wheel] (a phase); x, gy already
 *                                       in the target's px (camera off)
 *   models.drawLamp(ctx, id, x, gy, on)   its warning lamp (signal ramp: the lamp, its hot pixel and, lit, the halo ring), blinking
 *                                       with on; x, gy as drawSheaves
 *   models.drawCart(ctx, name, m, v)  a mover sprite (cart_tub, cart_pair: layer 'mover', the ones with a deck) for the cart mover
 *                                       m = { x, y, w } (the deck's left end and height, world px): the sprite's deck (its rim) on
 *                                       the mover's deck, centred on it; v = { cx, cy } the camera. Any other name draws nothing.
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, SG = S.RAMP.signal;
const models = LVL.art.models = { ready: false, err: null };
let atlas = null, J = null, loading = null;

const LOAD_TIMEOUT = 15000;           // ms
models.load = function(){
  if (loading) return loading;
  const img = new Image(), fail = e => { if (!models.ready && !models.err){ models.err = String(e && e.message || e); console.warn('model sprites:', models.err); } };
  const pImg = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('sprites/models.png not found')); });
  img.src = 'sprites/models.png';
  const pJson = fetch('sprites/models.json').then(r => { if (!r.ok) throw new Error('sprites/models.json ' + r.status); return r.json(); });
  return loading = new Promise(done => {
    const t = setTimeout(() => { fail(new Error('no atlas after ' + LOAD_TIMEOUT + ' ms')); done(); }, LOAD_TIMEOUT);
    Promise.all([pImg, pJson]).then(([, js]) => { if (!js || !js.sprites) throw new Error('sprites/models.json: no sprites');
      if (!models.err){ atlas = img; J = js.sprites; models.ready = true; } })
      .catch(fail).then(() => { clearTimeout(t); done(); });
  });
};
models.get = name => (models.ready && J[name]) || null;

// the atlas rect + anchor of a sprite (a wheel: frame f, wrapped)
function rectOf(s, f){ if (!s.frames) return s; const n = s.frames.length; return s.frames[((Math.floor(f) % n) + n) % n]; }
models.draw = function(g, name, x, y, frame = 0){
  const s = models.get(name); if (!s) return;
  const r = rectOf(s, frame);
  g.drawImage(atlas, r.x, r.y, r.w, r.h, Math.round(x) - r.ax, Math.round(y) - r.ay, r.w, r.h);
};

const HF = { play: 'headframe' };
models.headframe = id => HF[id];
models.headframeGeo = function(id, x, gy){
  const s = models.get(HF[id]); if (!s) return null;
  const x0 = Math.round(x) - s.ax, y0 = Math.round(gy) - s.ay;
  return { x: x0, x1: x0 + s.w, top: Math.round(gy) - s.top, feet: (s.feet || []).map(([a, b]) => [x0 + a, x0 + b]),
    sheaves: s.sheaves.map(w => ({ x: x0 + w.x, y: y0 + w.y, r: w.r })), lamp: s.lamp && { x: x0 + s.lamp[0], y: y0 + s.lamp[1] } };
};
models.drawHeadframe = (g, id, x, gy) => models.draw(g, HF[id], x, gy);
// The wheels' frames turn counter-clockwise on screen by `step` each (the renderer's turn): a clockwise angle is frames backwards.
models.drawSheaves = function(ctx, id, x, gy, ang){
  const s = models.get(HF[id]); if (!s) return;
  const x0 = Math.round(x) - s.ax, y0 = Math.round(gy) - s.ay;
  s.sheaves.forEach((w, i) => { const a = Array.isArray(ang) ? ang[i] : ang; models.draw(ctx, w.sprite, x0 + w.x, y0 + w.y, Math.floor(-a / models.get(w.sprite).step)); });
};
models.drawLamp = function(ctx, id, x, gy, on){
  const s = models.get(HF[id]); if (!s || !s.lamp) return;
  const lx = Math.round(x) - s.ax + s.lamp[0], ly = Math.round(gy) - s.ay + s.lamp[1];
  if (on){ ctx.fillStyle = SG[0]; ctx.fillRect(lx - 2, ly - 1, 1, 3); ctx.fillRect(lx + 2, ly - 1, 1, 3); ctx.fillRect(lx - 1, ly - 2, 3, 1); ctx.fillRect(lx - 1, ly + 2, 3, 1); }
  ctx.fillStyle = on ? SG[1] : SG[0]; ctx.fillRect(lx - 1, ly - 1, 3, 3);
  if (on){ ctx.fillStyle = SG[2]; ctx.fillRect(lx - 1, ly - 1, 1, 1); }
};
models.drawCart = function(ctx, name, m, v){
  const s = models.get(name); if (!s || !s.deck) return;
  const x = Math.round(m.x + (m.w - (s.deck.x1 - s.deck.x0)) / 2) - s.deck.x0 - v.cx, y = Math.round(m.y) - s.deck.y - v.cy;
  if (x > S.VW || x + s.w < 0) return;
  ctx.drawImage(atlas, s.x, s.y, s.w, s.h, x, y, s.w, s.h);
};
})();
