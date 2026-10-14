// Prop sprites from the owner's 3D models, in the hero's pixel pipeline: 3D model -> low-resolution render -> material classes ->
// light bands through the level's palette ramps (js/style.js RAMP) -> straightened silhouette, bevelled members, inner depth lines,
// hand-placed detail (hoops, rims, stencils, rivets), 1 px outline -> one PNG atlas + JSON, drawn by js/art/models.js.
//
//   node level/tools/model_sprites.mjs render [--only a,b] [--recipe r.json] [--out <dir>] [--preview <dir>]
//   node level/tools/model_sprites.mjs import --model <name> --src <dir or .obj> [--faces N] [--err E] [--texel M] [--jpeg Q]
//   node level/tools/model_sprites.mjs check [--out <dir>]
//
// render  draws every sprite of SPRITES (below) from level/models/<name>.glb and writes <out>/models.png (transparent atlas) and
//         <out>/models.json (default out: level/sprites). --only: a subset (a partial atlas: it needs its own --out, so the shipped
//         one is never cut down); --recipe: a JSON list of extra sprites (same fields; one with a SPRITES name replaces it);
//         --preview <dir>: review sheets there (sheet_x1 / sheet_x4: every sprite on a street-value backdrop over its ground line;
//         classes_x4: the material classes; albedo_x4: the sampled texture).
// import  turns one of the owner's textured OBJ downloads (OBJ + MTL + PNG, e.g. Meshy) into the compact model `render` reads: drops
//         the stray parts MODELS[name].drop names, splits off MODELS[name].parts (named nodes a sprite can hide or recolour),
//         decimates with meshoptimizer (stops at MODELS[name].faces or at the absolute error MODELS[name].err in metres, whichever
//         comes first), rescales to metres (MODELS[name].height, or MODELS[name].unit metres per model unit) standing on the ground
//         at the origin, computes normals with a crease, re-bakes the texture into an atlas of texel-metre texels (JPEG) and writes
//         level/models/<name>.glb (glTF 2.0, KHR_mesh_quantization). The downloads are not kept in the repo, the GLBs are: `render`
//         is reproducible from the repo alone.
// check   tests the atlas against the level's contracts (see check() below); exit code 1 on a failure.
// Libraries: three r128 + its GLTFLoader (page side; THREE_JS / GLTF_LOADER = local files, else the page loads them from their
// CDNs), Playwright's Chromium (PLAYWRIGHT = its index.mjs, else the package `playwright`, else the machine's global install, as
// playtest.mjs finds it), meshoptimizer for import (MESHOPT = its index.module.js, else the package `meshoptimizer` as node
// resolves it). The level's ramps, outline, scale and pixel font come from js/style.js itself.
//
// THE PIPELINE (the hero viewer's, hero3d/index.html, at prop scale):
//  * Orthographic camera, yaw / pitch per sprite, the light fixed in screen space from the UPPER LEFT and a little toward the viewer.
//    SCALE.pxPerM = 52.5 px per metre on the playfield (the hero: 96 px = 1.85 m), times the sprite's layer scale (a parallax layer's
//    SCALE.mid / midfar) and its size (the model built bigger); the world origin lands on a pixel corner, so the ground is a pixel row.
//  * Five passes at SS x SS samples per output pixel: albedo (the texture, mip-blurred: broad patches, not texel noise; or a part's
//    own material), light (n.l with a crease-aware normal: smooth on curved surfaces, flat across hard edges; snap: a wavy plate
//    within that many degrees of a view axis is lit as one plane), depth, and the surface point in the model's own frame (where on
//    the model a pixel is: the hoops, rims and stencils are placed by it).
//  * Each sample's albedo is classified into one of the level's materials by a hue / saturation rule or the nearest prototype colour
//    (CIE Lab) of that sprite's class table (rust, steel, ...); each output pixel takes its majority class (coverage >= cover, else
//    transparent). straight: the silhouette - outer edge and holes - is traced at sample resolution, simplified (Douglas-Peucker)
//    and filled again: the generated mesh's wobble becomes straight runs with even 1:n steps, its holes clean polygons.
//  * Tone = the light band of n.l (deep / dark / mid / light) + the albedo's value against its class mean (painted rust, dirt: at
//    most a step or so, x detail); a lit top-facing silhouette edge goes up to the rim step (the hero's rim rule). bevel: every
//    member's edge (against the sky, a farther surface or another material) facing the light a lit pixel, one facing away a
//    shadow pixel - the hand-pixelled girder; the way an edge faces is read off what breaks within 2 px round it, so a raking edge
//    is one evenly stepped line, its bevel on the outline's step phase. The tone picks a step of the class's ramp (MATERIALS: 5
//    steps per material, all style.js RAMP), so shadows lean violet and lights amber exactly as the level's ramps do.
//  * Clean-up: a lone pixel takes the colour 3 of its 4 neighbours share; small patches of one material / one tone go to what
//    borders them (island). Detail placed by the model's own coordinates (features): hoops (a lit ridge over its shadow), end discs
//    (a flat lid, its lit rim, bungs), lit or painted bands (a stripe, worn at chips), smoothed plates and deliberate dings,
//    stencils (the style.js pixel font). Lines: a pixel next to a clearly nearer one
//    (depth jump > inner px) becomes the inner line tone; the low sun's warm 1 px rim on right-facing silhouette edges near the top
//    of tall props (rim, as style.js LIGHT allows). Rivet heads along a plate's straight edges facing the light (rows, columns and
//    raking runs; a lit head over its shadow) and rust runs under some, clustered at the joints (rivets). Transparent pixels
//    touching the sprite become the 1 px outline (a 1 px slit between two members is sealed with it): style.js OUTLINE (#0b080b)
//    round the movers (things you stand on), 'sel' (the darkest step of the touching pixel's ramp) or a given ramp step round the
//    scenery.
//  * The sheave wheels (the model's top is a bare deck) are painted in 2D, one frame per turn step: a grooved rim lit on its upper
//    left, 8 spokes of a lit and a shadow line, a hub with its bolt heads.
//
// JSON (models.json): { pxPerM, atlas, sprites: { <name>: { x, y, w, h, ax, ay, top, scale, size, pxPerM, model, view, size_m,
//   outline, layer, ... } } } (px)
//   x, y, w, h  the sprite's rect in the atlas (outline included); (ax, ay) its ANCHOR: the GROUND CONTACT, ax = the middle of its
//   geometry or the recipe's anchor point, ay = the row boundary it stands on (its lowest coloured row + 1: the outline row is ay
//   itself, drawn over the top row of the ground, as the hero's sheet does) - or the axle for a wheel. Draw at (x - ax, y - ay).
//   top = rows from the ground up to its highest painted row, its sheaves included. pxPerM = px per model metre (pxPerM x scale x
//   size).
//   Wheels (the sheaves): r, frames [{ x, y, w, h, ax, ay }] (anchor = the axle) and step = the turn per frame (radians,
//   counter-clockwise on screen), the frames covering one period of the wheel (its 8 spokes: pi / 4).
//   Extra: sheaves [{ x, y, r, sprite }] (axles relative to the sprite's top-left, radius; the named wheel sprite turns there),
//   feet [[x0, x1)] (the runs of its lowest row: a frame's legs), deck { y, x0, x1 } (a mover's standing surface), lamp [x, y] (2 px
//   over the top of the member a warning lamp sits on).
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), LEVEL = '/home/user/DOOM/level', MODEL_DIR = process.env.MS_MODEL_DIR || path.join(HERE, 'models');
const argv = process.argv.slice(2), cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'render';
const fail = m => { console.error(m); process.exit(2); };
const opt = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; if (i + 1 >= argv.length) fail('--' + name + ' needs a value'); return argv[i + 1]; };
if (argv.includes('--help') || argv.includes('-h')){ console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 24).join('\n')); process.exit(0); }
const firstFile = (...c) => c.find(f => f && fs.existsSync(f));
const THREE_JS = firstFile(process.env.THREE_JS), GLTF_JS = firstFile(process.env.GLTF_LOADER), STYLE_JS = path.join(LEVEL, 'js/style.js');

// ---------------------------------------------------------------------------------------------------------------------------------
// Level constants, read from js/style.js itself (run in a bare context: it only needs `window`), so the sprites use the page's own
// ramps, outline and scale and nothing has to be kept in sync by hand (the page side loads the same file for its pixel font).
const STYLE = (() => { const w = {}; vm.runInNewContext(fs.readFileSync(STYLE_JS, 'utf8'), { window: w }); return w.LVL.style; })();
const { RAMP, OUTLINE, SCALE } = STYLE, PX_PER_M = SCALE.pxPerM;
// The light, in screen space: the hero's key (hero3d/index.html LIGHT: [-0.45, 0.75, 0.5], from the upper left and a little toward
// the viewer) puts a plane facing the camera exactly on its dark / mid threshold (n.l = 0.50), and props are mostly such planes. So
// the props' light is the same upper-left key a little more frontal, with n.l thresholds [light, mid, dark] that give a box clean
// planes: top light, front and left faces mid, right faces dark, undersides deep (a sprite may override light / bands).
const PROP_LIGHT = [-0.5, 0.8, 0.6], PROP_BANDS = [0.62, 0.3, -0.6];
const MAXCUT = 16;                       // cut boxes a sprite may have (the shader's slots)

// Materials: tone 0 deep, 1 dark, 2 mid, 3 light, 4 rim (lit top edges) -> ramp index. Every colour comes from RAMP. The planes
// that face the camera take the mid step: on the large ones a hero may stand in front of, a VALUE-safe step (style.js: rust[3],
// brick[6], steel[4], sky[5]).
const MATERIALS = {
  rust:   { ramp: 'rust',  steps: [1, 2, 3, 4, 5] },    // red-lead gone to rust: the headframe's members, the drums
  steel:  { ramp: 'steel', steps: [2, 3, 4, 5, 6] },    // bare / galvanised steel, grey-teal: machinery, bearings, cage guides, rims
  iron:   { ramp: 'coal',  steps: [2, 3, 4, 5, 6] },    // dark cast iron and grease: wheels, axle boxes, the chassis
  stone:  { ramp: 'stone', steps: [1, 2, 3, 4, 5] },    // the concrete plinths the headframe's legs stand on
  paint:  { ramp: 'sky',   steps: [3, 4, 5, 6, 6] },    // ochre hazard paint (the drum's band)
  red:    { ramp: 'brick', steps: [4, 5, 6, 7, 7] },    // oxide-red plate of the tubs (mid brick[6]: the hero reads against it)
  coal:   { ramp: 'coal',  steps: [1, 2, 3, 4, 5] },    // the tubs' coal load
  wood:   { ramp: 'wood',  steps: [0, 1, 2, 3, 4] },    // PILOT: weathered planks
  brick:  { ramp: 'brick', steps: [2, 3, 4, 5, 6] },    // PILOT: soot-stained brick
  slate:  { ramp: 'basalt', steps: [1, 2, 3, 4, 5] },   // PILOT: slate / tin roofs
  green:  { ramp: 'paint', steps: [1, 2, 3, 4, 5] },    // PILOT: bottle-green paint
  glass:  { ramp: 'glass', steps: [0, 1, 2, 3, 4] }     // PILOT: unlit panes
};

// ---------------------------------------------------------------------------------------------------------------------------------
// MODELS: how `import` turns each source OBJ into level/models/<name>.glb. drop / parts: predicates on a connected part's bounds in
// SOURCE units ({ n faces, min, max, size, diag }); height: real-world height in metres after the drops (sets the scale).
export const MODELS = {
  // PILOT (Meshy text-to-3D, not shipped): heights from meshy/gen/assets.json
  guard_tower:    { match: /guard_tower/i,    faces: 8000, err: 0.01, texel: 0.025, height: 9.0 },
  ropeway_pylon:  { match: /ropeway_pylon/i,  faces: 8000, err: 0.01, texel: 0.025, height: 10.0 },
  ropeway_bucket: { match: /ropeway_bucket/i, faces: 4000, err: 0.004, texel: 0.01, height: 2.4 },
  shaft_cage:     { match: /shaft_cage/i,     faces: 6000, err: 0.006, texel: 0.015, height: 4.2 },
  engine_house:   { match: /engine_house/i,   faces: 10000, err: 0.015, texel: 0.03, height: 8.0 },
  street_lamp:    { match: /street_lamp/i,    faces: 3000, err: 0.004, texel: 0.01, height: 4.5 },
  // Meshy "Mining Headframe": a strut headframe in side elevation (vertical tower + raking back strut, flat in z). Dropped: a row of
  // floating rods and two specks at the foot (parts under 0.095 units). 7.0 m = 368 px: with its sheaves on the deck it stays
  // under the E street view's frame top (SPRITES: headframe) - the playtest's finale check.
  headframe: { match: /headframe/i, faces: 6000, err: 0.022, texel: 0.03, jpeg: 0.85, height: 7.0, drop: c => c.diag < 0.095 },
  // Meshy "Rusty Barrel": a 200 l drum (0.88 m = 46 px); 258k faces in the source, a 46 px sprite needs ~3k.
  barrel: { match: /barrel/i, faces: 2500, err: 0.0015, texel: 0.006, height: 0.88 },
  // Meshy "Rusty Railcar": two coupled tubs on their wheel sets. Dropped: the two rail bars under the wheels (the level draws its
  // own track). Split off: the pickaxe stuck in the right tub's load (a sprite hides it where the hero stands) and the wheel sets
  // (lumps: the sprites get flanged wheels of their own). Scaled (unit: model units -> metres) so the tub rim stands 1.09 m over
  // the wheel treads: seen from 10 degrees above 56 px, on the B rail head (4 px over the street) SCALE.cart's 60 px.
  railcar: { match: /railcar/i, faces: 1500, err: 0.009, texel: 0.01, unit: 2.143,
    drop: c => c.size[1] < 0.05 && c.size[0] > 0.8,
    parts: { pickaxe: c => c.max[1] > 0.3 && c.min[0] > 0.2, wheels: c => c.max[1] < -0.19 && c.size[0] < 0.3 } }
};

// GENERATED LIBRARY (scratch): MS_MODELS = a JSON file of more import entries { name: { faces, err, texel, height | unit, jpeg,
// drop: { diagLt, nLt, sizeYLt } (stray parts under those bounds, source units) } }; the import reads any .obj in --src.
if (process.env.MS_MODELS && fs.existsSync(process.env.MS_MODELS)){
  for (const [n, e] of Object.entries(JSON.parse(fs.readFileSync(process.env.MS_MODELS, 'utf8')))){
    const d = e.drop || null;
    MODELS[n] = { ...e, match: new RegExp('.'), drop: d ? (c => (d.diagLt !== undefined && c.diag < d.diagLt) || (d.nLt !== undefined && c.n < d.nLt) || (d.sizeYLt !== undefined && c.size[1] < d.sizeYLt)) : undefined, parts: undefined };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Class tables: per material, prototype albedo colours (sRGB, sampled from each model's texture), or a hue / saturation / value
// rule ({ h, s, v } ranges, with optional protos: more colours of that material). An empty list: a material only the recipe's added
// parts use (they name it).
const CLASSES = {};
CLASSES.headframe = {
  // red lead, its rust, the weathered brown-grey steel of the deck, the beams and the machinery: ONE material, so no member is
  // split into patches; steel (sheaves' bearings, cage guides) and stone (plinths) are only the recipe's parts
  rust: { h: [0, 40], s: [0.38, 1], protos: ['#5b4739', '#4b3b2e', '#3a2e26', '#665646', '#76786c', '#5e6a64', '#8a8c80'] },
  steel: [], stone: []
};
CLASSES.barrel = {
  rust: ['#894d2d', '#9d592a', '#6b4631', '#7c543d', '#593621', '#975830', '#9e4e24', '#7c4428', '#351f13', '#2a1a12', '#6a6a6a', '#58585c', '#4f494b', '#574742'],
  paint: []                                                 // the ochre band: painted by the recipe (BARREL: a band feature)
};
CLASSES.railcar = {
  red: ['#331c1b', '#3e2322', '#2a1616', '#4b2d2c', '#5a3432', '#6a4430', '#7a5038'],
  iron: ['#1f1011', '#0f0708', '#181010'],
  coal: ['#7d6c5e', '#9a8a7a', '#b8a898', '#5d544c'],
  steel: []
};

// SPRITES: what `render` draws. Fields (lengths in metres in the first instance's OWN frame - the model as imported, after its
// spread / rake, before its mirror / rotation - unless named otherwise):
//   GEOMETRY  model, or instances [{ model, pos: [x, y, z] (y = its bottom), rot: [x, y, z] deg, hide }]; yaw / pitch (deg; yaw 0
//     = the model's front, +Z); scale (the layer: 1 playfield, SCALE.mid, SCALE.midfar); size (the model built bigger); mirror;
//     hide (parts); spread ([x0, x1, d]: the slab x0..x1 lengthened by d); rake ({ foot, top, hw, band, d: [dFoot, dTop] }: a
//     raking strut - its centre line foot -> top, hw wide either side - leaned out by dFoot at the ground .. dTop from its top up,
//     the model beyond `band` from its inner edge as modelled and the members between lengthened: a wider stance with every
//     member's own width kept); keepX ([x0, x1], null = open: the slice kept); cut ([[x0, y0, x1, y1]], at most MAXCUT: what of
//     the model lies inside goes); add (the recipe's own parts: { box: [x0, y0, z0, x1, y1, z1], rz } (rz: turned that many
//     degrees about its centre, counter-clockwise in the own frame: a raking member) | { plate: [[x, y], ..], z: [z0, z1] } (a flat
//     plate of that outline: a gusset) | { wheel: [x, y, z], r, w, flange } (a flanged wheel facing +Z: tread, flange behind, hub
//     boss) | { heap: [x0, x1, z0, z1], y, h, n, r: [r0, r1], seed } (n lumps heaped to h over y), each with mat: the material it
//     is, keep: true for a part the cut boxes leave (a clean member put where the cut took the model's own) and tone: its own tone
//     offset (a flange in the light, +1, or in shadow, -1)).
//   LOOK  classes (a CLASSES name or a table); materials (per-sprite ramp / step overrides); light / bands (the key and its n.l
//     thresholds); snap; crease; bias (albedo mip bias); detail (texture value gain, per material: { _: default, <material>: k });
//     ss (samples per pixel across); cover (coverage a pixel needs); straight (Douglas-Peucker tolerance in px for the silhouette,
//     0 = off); smooth (1 px silhouette clean-up passes); clean (tone clean-up); island ([n, m]: tone / material patches under n /
//     m px go); bevel ([lit, shade]: tone steps on members' edges facing / away from the light); recess ([z, tone]: surfaces deeper than
//     own-frame z, a tone offset); cast (px: the shadow a nearer member casts down-right); inner (depth-line threshold in px, 0 =
//     off); outline ('OUTLINE' | 'sel' = the darkest step of the ramp it touches | a colour: style.js keeps OUTLINE for the movers,
//     so 'sel' and the inner lines never give it - a ramp whose darkest step is OUTLINE, coal, gives its next one); rim (the low
//     sun's 1 px warm edge { col, top }); rivets ({ mats, pitch, inset, streak, grime, ribs, panels }).
//   FEATURES  features: [{ band: [a0, a1], axis, tone, soft, paint, chips, mats } (a tone offset where the axis coordinate lies in
//     a0..a1, thinning out over `soft` px past its ends; paint: the band painted that material, but at the chips [[x, y, z, r]]) |
//     { end: [a, ..], axis, r, rim, bungs: [[u, v, r]], mats } (flat end discs: a lid of one tone, a lit rim, bungs on the first) |
//     { hoop: a, axis, mats } (a lit ridge over its shadow where the axis coordinate crosses a) | { smooth: [[x0, y0, x1, y1]],
//     mats } (plates the mesh dented: each row one tone, no depth lines) | { dent: [x, y, z], mats } (a 3 px ding) | { wheel: [x,
//     y, z], r, mats } (a wheel's face: lit tread edge, web ring, hub) | { stencil: text, at: [x, y, z], col, mats } (the style.js
//     pixel font centred on the point)], each on the named materials only.
//   POINTS  anchor (the sprite's anchor, else the middle of its geometry on the ground); sheaves ([{ at, sprite }]: wheel axles);
//     deck (two points: a mover's standing surface); lamp (a warning lamp's seat); feet (true: report them); layer (where the level
//     draws it: play | mover, or a parallax layer's id).
//   Wheel sprites: { name, wheel: { r, cols: { outline, groove, dark, mid, lit, hi } }, frames, step, layer }: painted in 2D.
const ST = RAMP.steel;
const SHEAVE_R = SCALE.sheaveR;                               // 39 px on the playfield (style.js SCALE)
// THE PLAYFIELD HEADFRAME (E) over the 5-tile shaft, mirrored so the raking strut leans RIGHT, down toward the winding-engine house
// (the model's leans left). As modelled its strut's foot stands 151 px from its column: the shaft and its cage need 240, so the
// strut is raked out (2.05 m at its foot, 0.9 m at its top: the deck lengthens to carry both sheaves over the shaft) while the
// column, the strut and every member keep their modelled widths. The anchor is the shaft's centre line, 2.36 m (124 px) from the
// column's inner edge (model x 1.575); the plinths under both legs end 2 and 1 px clear of the shaft. Cut: the model's stairs and
// inner post that stood over the shaft (the cage, 3.3 m tall, hides the bay while it is up; when it is down the cage guides show:
// the left one up the column to the deck, the right one up to where the strut crosses it). The two sheaves sit on bearing blocks
// on the deck beam (top 6.42 m), 45 px either side of the shaft line (art/props.js runs the ropes over them), axles 343 px
// over the street (tops at 383: the E street view shows 396, the playtest wants 8 px of sky over them). One rust material, every
// member bevelled; the inner members (behind z 0.05) and what a nearer member shades a step down; above 1.6 m the frame stands
// dark against the sunset (rust[2] fronts), under that its feet take the light of the street lamps and the sunset-lit ground fog
// (rust[3]: the hero walks past the column's and the strut's feet, VALUE rule), the light growing toward the ground through a
// 4-row ordered dither, each member's lit upper-left edge a step over its face on either side of it.
const HF_X = -0.787, HF_AXLE = 6.535, HF_DX = 45 / PX_PER_M, GUIDE = 118 / PX_PER_M;
// THE CLEAN INTERIOR: the generated mesh melts the brackets and wedges between the beams into blobs, and its column and strut are
// pierced by lightening holes each of a different shape. Those bays are cut out, and in their place go straight members of the
// recipe's own (keep: the cuts leave them; one rust material, bevelled and riveted like the rest): under the deck a Pratt truss
// (two posts, a diagonal in each panel) on the second beam; under that the winding gear's housing standing on a third girder
// that runs from the column to the strut, a post under it to the low beam; the low beam itself (the model's is a wobbly casting);
// the column and the strut a solid plate each over the model's (the holes close); the strut's foot a straight base plate on its
// plinth instead of the melted gusset. bar(xa, ya, xb, yb, w, z0, z1, tone): a straight part of width w (m) between two own-frame
// points, from z0 to z1 (its front face), its own tone offset; member(..., w, z): one from -z to z.
const bar = (xa, ya, xb, yb, w, z0, z1, tone = 0) => { const L = Math.hypot(xb - xa, yb - ya), cx = (xa + xb) / 2, cy = (ya + yb) / 2;
  return { box: [cx - w / 2, cy - L / 2, z0, cx + w / 2, cy + L / 2, z1], rz: Math.atan2(-(xb - xa), yb - ya) * 180 / Math.PI, tone, mat: 'rust', keep: true }; };
const member = (xa, ya, xb, yb, w, z = 0.36) => bar(xa, ya, xb, yb, w, -z, z);
const HF_STRUT = [[-3.646, 0.12], [-1.07, 5.0]];                              // the strut's centre line after the rake (foot, top)
const HF_CLEAN = {
  cut: [[-1.62, 5.38, 1.52, 6.27], [-0.75, 3.3, 1.52, 5.07], [-1.9, 2.55, 1.56, 3.45],    // bay under the deck, bay under the second beam,
    [-4.15, 0.12, -2.95, 0.95]],                                                             // the low beam (and its rod stubs), the strut foot
  add: [
    member(0.6, 5.36, 0.6, 6.29, 0.12), member(-0.5, 5.36, -0.5, 6.29, 0.12),                // truss posts
    member(1.5, 6.27, 0.62, 5.38, 0.1), member(0.58, 5.38, -0.48, 6.27, 0.1), member(-0.52, 6.27, -1.58, 5.38, 0.1),   // its diagonals
    member(1.52, 4.11, -1.3, 4.11, 0.22),                                                    // third girder, column to strut
    { box: [0.2, 4.22, -0.32, 1.5, 4.98, 0.3], mat: 'rust', keep: true },                    // the gear housing on it
    member(0.25, 3.0, 0.25, 4.02, 0.14),                                                     // the post under it
    bar(1.58, 2.88, -1.8, 3.2, 0.28, 0.3, 0.38),                                             // the low beam (shallow: no sliver of its top face)
    { box: [1.58, 0.12, -0.3, 2.03, 6.62, 0.41], mat: 'rust', keep: true },                 // the column's plate
    member(...HF_STRUT[0], ...HF_STRUT[1], 0.42, 0.41),                                      // the strut's plate
    { box: [-4.1, 0.12, -0.35, -3.05, 0.3, 0.35], mat: 'rust', keep: true }]                 // its base plate
};
// THE GIRDER FINISH: the big members built up the way the props round them are, all keep parts of the one rust material, so the
// bevel, cast, rivet and rust-run passes draw them (the frame's rust then spans rust[0..5], no flat plate wider than ~20 px):
// along the column and the strut a flange strip down each long edge - on the upper-left one a lit flange (tone +1) standing
// 0.08 m proud (a depth line and a cast shadow on the web beside it, a rivet row on it), on the lower-right one a flush flange in
// shadow (tone -1) -; batten plates across them about every metre (a riveted strap: lit top edge, shadow under it); gusset
// plates at the four main joints (deck and low beam to the column, low beam to the strut, both sides of the strut's foot, each
// overlapping the members it joins so its top edge is one straight line); on the gear housing a riveted border, a seam batten
// down its middle, a hatch with its handle and the winding gear's bearing cap. along(a, b, t): the point t m from a toward b and
// that direction; flanges(a, b, w): the two of a member w wide from a to b; battens(a, b, w, ts): straps across it at ts.
const along = (a, b, t) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; return [a[0] + ux * t, a[1] + uy * t, ux, uy]; };
const flanges = (a, b, w, fw = 0.08) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L, o = w / 2 - fw / 2;
  return [1, -1].map(s => bar(a[0] + s * nx * o, a[1] + s * ny * o, b[0] + s * nx * o, b[1] + s * ny * o, fw, 0.40, s > 0 ? 0.49 : 0.45, s)); };   // own +x: screen left
const battens = (a, b, w, ts) => ts.map(t => { const [x, y, ux, uy] = along(a, b, t), nx = uy, ny = -ux, h = w / 2 + 0.03;
  return bar(x - nx * h, y - ny * h, x + nx * h, y + ny * h, 0.16, 0.45, 0.53); });
const HF_FINISH = [
  ...flanges([1.805, 0.12], [1.805, 6.84], 0.45), ...battens([1.805, 0.12], [1.805, 6.84], 0.45, [0.85, 1.85, 3.4, 4.45, 5.65]),   // column
  ...flanges([-3.087, 1.18], [-1.17, 4.82], 0.42), ...battens(...HF_STRUT, 0.42, [1.2, 2.3, 4.3]),        // strut (its flanges from the lowest batten up)
  ...[[[1.66, 6.46], [1.66, 5.85], [1.03, 6.46]], [[1.66, 2.85], [1.66, 2.3], [1.11, 2.85]], [[-1.77, 3.1], [-2.12, 2.52], [-1.33, 3.1]]]
    .map(t => ({ plate: t, z: [-0.4, 0.46], mat: 'rust', keep: true })),                                  // gussets,
  ...[[[-3.28, 0.3], [-2.98, 0.3], [-3.0, 0.88]], [[-3.82, 0.3], [-4.08, 0.3], [-3.55, 0.78]]]           // the foot's two thicker: they
    .map(t => ({ plate: t, z: [-0.4, 0.52], mat: 'rust', keep: true })),                                  // stand proud of the strut's plate
  ...[[0.2, 4.91, 1.5, 4.98], [0.2, 4.22, 1.5, 4.29], [1.43, 4.22, 1.5, 4.98], [0.2, 4.22, 0.27, 4.98], [0.82, 4.29, 0.88, 4.91], [0.38, 4.38, 0.66, 4.8]]
    .map(([x0, y0, x1, y1]) => ({ box: [x0, y0, 0, x1, y1, 0.39], mat: 'rust', keep: true })),           // the housing's border, seam batten, hatch,
  { box: [0.43, 4.56, 0.36, 0.47, 4.63, 0.44], mat: 'steel', keep: true },                               // its handle,
  { wheel: [1.15, 4.6, 0.6], r: 0.11, w: 0.07, flange: 0.03, mat: 'rust', keep: true }];                // the bearing cap
const HF = { model: 'headframe', mirror: true, pitch: 3, classes: 'headframe', outline: 'sel', inner: 4, smooth: 1, straight: 1.4, clean: true,
  island: [16, 120], detail: 0.08, snap: 25, bevel: [1, -2], recess: [0.05, -1], cast: 3, rivets: { mats: ['rust'], pitch: 7, inset: 3, streak: -1 }, lamp: [1.8, 6.86, 0.3],
  rake: { foot: [-1.46, 0.68], top: [-0.19, 4.96], hw: 0.45, band: 0.6, d: [-2.05, -0.9] },
  features: [{ band: [1.6, 9], axis: 'y', tone: -1, soft: 4, mats: ['rust'] }],     // dark against the sky, its feet lit by the street
  cut: [[-0.05, -0.1, 1.42, 2.62], [1.5, 6.86, 2.2, 7.2],                    // the bay over the shaft; the column's broken top, cut level;
    [-2.6, 6.57, 1.42, 7.6], ...HF_CLEAN.cut],                                 // over the deck: rods and brackets behind the wheels go
  add: [...HF_CLEAN.add, ...HF_FINISH,
    { box: [1.52, 0, -0.56, 2.12, 0.12, 0.56], mat: 'stone' }, { box: [-4.2, 0, -0.56, -3.1, 0.12, 0.56], mat: 'stone' },       // plinths
    ...[-1, 1].map(s => ({ box: [HF_X + s * GUIDE - 0.03, 0, -0.05, HF_X + s * GUIDE + 0.03, s > 0 ? 6.05 : 1.3, 0.05], mat: 'steel' })),   // cage guides
    ...[-1, 1].map(s => ({ box: [HF_X + s * HF_DX - 0.17, 6.4, 0.2, HF_X + s * HF_DX + 0.17, 6.62, 0.6], mat: 'steel' }))],      // bearing blocks
  anchor: [HF_X, 0, 0], feet: true };
const sheavesAt = sprite => [-1, 1].map(s => ({ at: [HF_X + s * HF_DX, HF_AXLE, 0.6], sprite }));
const WHEEL = (name, r, cols, layer) => ({ name, wheel: { r: Math.round(r), cols }, frames: 12, step: Math.PI / 4 / 12, layer });
// THE DRUM: rust a step darker than the headframe's (the drums stand in the street light, not against the sky), the ochre hazard
// stripe between its rolling hoops painted on clean (the texture's band is a blotch), a step over the rust and lit by the same
// light, worn through at a few chips round the drum (each turned drum shows its own); DRUM_R: the body's radius at the stripe.
const DRUM_R = 0.29, chip = (deg, y, r) => [DRUM_R * Math.sin(deg * Math.PI / 180), y, DRUM_R * Math.cos(deg * Math.PI / 180), r];
const BARREL = { model: 'barrel', pitch: 9, classes: 'barrel', outline: 'sel', inner: 3, bands: [0.6, 0.3, -0.6], detail: 0.35,
  materials: { rust: { ramp: 'rust', steps: [0, 1, 2, 3, 4] } }, clean: true, island: [14, 30], bevel: [0, -1],
  features: [{ hoop: 0.296, axis: 'y' }, { hoop: 0.614, axis: 'y' }, { band: [0.335, 0.575], axis: 'y', paint: 'paint', mats: ['rust'],
    chips: [chip(10, 0.36, 0.035), chip(60, 0.55, 0.03), chip(115, 0.45, 0.025), chip(170, 0.355, 0.04), chip(215, 0.56, 0.03), chip(265, 0.42, 0.03), chip(320, 0.555, 0.035)] },
    { end: [0.88, 0], axis: 'y', r: 0.271, rim: 0.03, bungs: [[-0.07, 0.1, 0.035], [0.13, -0.11, 0.025]] }] };
// THE RAILCAR, seen from the side and a little from above (the coal load shows). Each tub gets what the painted hunt had and the
// generated mesh lacks: a rolled steel rim (the deck the hero stands on, a shadow line under it), the coal heaped proud of it, a
// stiffening hoop and the lit upper wall over it, the stencilled pit mark and car number, a chassis bar, axle boxes and flanged
// wheels (the model's wheel sets are lumps: hidden); the lumps at its lower corners are cut off. Under the hoop the side plate is
// smoothed (the mesh's dents drew scribbles there) and takes one deliberate ding. RIM: the side plate's top edge.
const RIM = 1.09;
// one tub x0 .. x1 (own frame): its added parts and features. wx: its wheels' x; num: its car number; seed: its coal heap (none: 0);
// ends: its couplings (-1 left, 1 right). The stencils sit under the hoop, 0.3 m in from the ends (0.2 on a short tub).
const tub = (x0, x1, wx, num, seed, ends) => { const i = x1 - x0 > 1.5 ? 0.3 : 0.2; return {
  add: [{ box: [x0 - 0.02, RIM - 0.07, 0.40, x1 + 0.02, RIM + 0.01, 0.57], mat: 'steel' },                             // rolled rim
    ...(seed ? [{ heap: [x0 + 0.06, x1 - 0.06, -0.36, 0.36], y: RIM - 0.04, h: 0.1, n: Math.round((x1 - x0) * 34), r: [0.05, 0.085], seed, mat: 'coal' }] : []),
    { box: [x0 + 0.08, 0.3, 0.36, x1 - 0.08, 0.37, 0.52], mat: 'iron' },                                                // chassis bar
    ...wx.flatMap(x => [{ wheel: [x, 0.17, 0.4], r: 0.17, w: 0.07, flange: 0.035, mat: 'steel' },
      { box: [x - 0.075, 0.22, 0.47, x + 0.075, 0.33, 0.55], mat: 'iron' }]),                                             // axle box
    ...ends.map(e => ({ box: e < 0 ? [x0 - 0.09, 0.35, 0.3, x0, 0.42, 0.42] : [x1, 0.35, 0.3, x1 + 0.09, 0.42, 0.42], mat: 'iron' }))],   // couplings
  features: [{ hoop: 0.84, axis: 'y', mats: ['red'] }, { band: [0.845, RIM - 0.07], axis: 'y', tone: 1, mats: ['red'] },
    { smooth: [[x0 + 0.04, 0.42, x1 - 0.04, 0.82]], mats: ['red'] }, { dent: [x0 + (x1 - x0) * 0.56, 0.585, 0.45], mats: ['red'] },
    { stencil: num, at: [x0 + i, 0.66, 0.48], col: RAMP.paper[1], mats: ['red'] }, { stencil: 'K3', at: [x1 - i, 0.66, 0.48], col: RAMP.paper[1], mats: ['red'] },
    ...wx.map(x => ({ wheel: [x, 0.17, 0.44], r: 0.17, mats: ['steel'] }))] }; };
const both = (a, b) => ({ add: [...a.add, ...b.add], features: [...a.features, ...b.features] });
const CART = { model: 'railcar', pitch: 10, classes: 'railcar', bands: [0.62, 0.1, -0.6], outline: 'OUTLINE', inner: 2.5, smooth: 1, straight: 0.75,
  clean: true, island: [6, 20], detail: { _: 0.5, red: 0.15 }, bevel: [1, -1], rivets: { mats: ['red'], pitch: 6, inset: 2, streak: RAMP.rust[2], grime: 3, ribs: 26, panels: true } };
// the lumps at the tubs' outer lower corners and the knobs under their ends (cut boxes, left and right end of the car)
const LUMPS_L = [[-1.2, 0.3, -0.985, 0.7], [-1.2, 0.1, -0.9, 0.335]], LUMPS_R = d => [[0.965 + d, 0.3, 1.2 + d, 0.75], [0.84 + d, 0.1, 1.2 + d, 0.335]];
// the mover tub (SCALE.cart: a 108 x 60 px deck): the model's left tub (x -0.98 .. -0.12) lengthened in its middle to a 108 px
// (2.057 m) rim, the right tub cut away; wheels 22 and 84 px from its left end as the painted hunt's, their treads 56 px under the
// rim as seen from a little above (on the B rail head, 4 px over the street: the mover's 60 px); deck = the rim, where the hero stands
const TUB = [-0.98, -0.98 + 108 / PX_PER_M], TUB_D = TUB[1] + 0.12;
// the coupled pair: the model's two tubs (x -0.98 .. -0.12 and -0.04 .. 0.96) with the coupling between them lengthened by 6 px,
// so their deck (both rims and the gap) is the mover's 108 px
const PAIR_D = 108 / PX_PER_M - 1.94;
export const SPRITES = [
  { name: 'headframe', ...HF, rim: { col: RAMP.sky[5], top: 0.6 }, sheaves: sheavesAt('sheave'), layer: 'play' },
  WHEEL('sheave', SHEAVE_R, { outline: ST[0], groove: ST[1], dark: ST[2], mid: ST[4], lit: ST[6], hi: ST[7] }, 'play'),
  { name: 'barrel_a', ...BARREL, rot: [0, 0, 0], layer: 'play' },
  { name: 'barrel_b', ...BARREL, rot: [0, 130, 0], layer: 'play' },
  { name: 'barrel_c', ...BARREL, rot: [0, 250, 0], layer: 'play' },
  { name: 'barrel_lying', ...BARREL, rot: [0, 40, 90], yaw: -25, layer: 'play' },
  { name: 'barrel_stack', ...BARREL, yaw: 28, instances: [
    { model: 'barrel', pos: [-0.3, 0, 0], rot: [90, 200, 0] }, { model: 'barrel', pos: [0.3, 0, 0], rot: [90, 20, 0] },
    { model: 'barrel', pos: [0, 0.505, 0.04], rot: [90, 110, 0] }], layer: 'play' },
  { name: 'cart_tub', ...CART, hide: ['wheels', 'pickaxe'], spread: [-0.56, -0.54, TUB_D], keepX: [null, TUB[1] + 0.06], cut: LUMPS_L,
    ...tub(TUB[0], TUB[1], [TUB[0] + 22 / PX_PER_M, TUB[0] + 84 / PX_PER_M], '17', 17, [-1, 1]), deck: [[TUB[0], RIM, 0.5], [TUB[1], RIM, 0.5]], layer: 'mover' },
  { name: 'cart_pair', ...CART, hide: ['wheels', 'pickaxe'], spread: [-0.1, -0.06, PAIR_D], cut: [...LUMPS_L, ...LUMPS_R(PAIR_D)],
    ...both(tub(-0.98, -0.12, [-0.68, -0.33], '23', 23, [-1]), tub(-0.04 + PAIR_D, 0.96 + PAIR_D, [0.295 + PAIR_D, 0.66 + PAIR_D], '24', 29, [1])),
    deck: [[-0.98, RIM, 0.5], [0.96 + PAIR_D, RIM, 0.5]], layer: 'mover' },
  { name: 'cart_parked', ...CART, outline: 'sel', hide: ['wheels'], cut: [...LUMPS_L, ...LUMPS_R(0)],   // decor: the scenery's outline; its own load: the right tub's mound and the pickaxe
    ...both(tub(-0.98, -0.12, [-0.68, -0.33], '31', 31, [-1]), tub(-0.04, 0.96, [0.295, 0.66], '32', 0, [1])), layer: 'play' }
];

// ---------------------------------------------------------------------------------------------------------------------------------
const { chromium } = await (process.env.PLAYWRIGHT ? import(pathToFileURL(process.env.PLAYWRIGHT).href) : import('playwright'))
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

async function openPage(files){
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 600 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    `<script src="${THREE_JS ? '/three.min.js' : 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'}"></script>` +
    `<script src="${GLTF_JS ? '/GLTFLoader.js' : 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js'}"></script>` +
    '<script src="/style.js"></script><script>' + PAGE + '</script></body></html>';
  await p.route('http://models.local/**', r => { const u = new URL(r.request().url()), f = decodeURIComponent(u.pathname);
    if (f === '/') return r.fulfill({ contentType: 'text/html', body: html });
    if (f === '/three.min.js' && THREE_JS) return r.fulfill({ path: THREE_JS, contentType: 'text/javascript' });
    if (f === '/GLTFLoader.js' && GLTF_JS) return r.fulfill({ path: GLTF_JS, contentType: 'text/javascript' });
    if (f === '/style.js') return r.fulfill({ path: STYLE_JS, contentType: 'text/javascript' });
    if (files[f]) return r.fulfill({ path: files[f] });
    r.fulfill({ status: 404, body: 'not found' }); });
  await p.goto('http://models.local/');
  await p.waitForFunction(() => window.MS_READY, null, { timeout: 60000 }).catch(() => fail('page not ready: ' + errors.join('\n')));
  return { b, p, errors };
}

// ---------- import ----------
function parseOBJ(txt){
  const P = [], UV = [], tri = []; let mtllib = null;
  for (const raw of txt.split('\n')){
    const line = raw.trim(); if (!line || line[0] === '#') continue;
    const sp = line.split(/\s+/), k = sp[0];
    if (k === 'v') P.push(+sp[1], +sp[2], +sp[3]);
    else if (k === 'vt') UV.push(+sp[1], +sp[2]);
    else if (k === 'f'){
      const vs = sp.slice(1).map(s => { const a = s.split('/'); let vi = parseInt(a[0], 10), ti = a[1] ? parseInt(a[1], 10) : 0;
        if (vi < 0) vi = P.length / 3 + vi + 1; if (ti < 0) ti = UV.length / 2 + ti + 1; return [vi - 1, ti - 1]; });
      for (let i = 1; i + 1 < vs.length; i++) tri.push(vs[0], vs[i], vs[i + 1]);
    } else if (k === 'mtllib') mtllib = line.slice(7).trim();
  }
  return { P, UV, tri, mtllib };
}
// connected parts (over welded positions) with their bounds
function partsOf(P, tri){
  const nv = P.length / 3, par = new Int32Array(nv).map((_, i) => i), key = new Map();
  const find = x => { while (par[x] !== x){ par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < nv; i++){ const k = P[i * 3] + ',' + P[i * 3 + 1] + ',' + P[i * 3 + 2]; if (key.has(k)) par[find(i)] = find(key.get(k)); else key.set(k, i); }
  for (let t = 0; t < tri.length; t += 3){ const a = find(tri[t][0]); par[find(tri[t + 1][0])] = a; par[find(tri[t + 2][0])] = a; }
  const comps = new Map(), triComp = new Int32Array(tri.length / 3);
  for (let t = 0; t < tri.length / 3; t++){
    const r = find(tri[t * 3][0]); let c = comps.get(r);
    if (!c){ c = { id: comps.size, n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; comps.set(r, c); }
    c.n++; triComp[t] = c.id;
    for (let k = 0; k < 3; k++){ const v = tri[t * 3 + k][0]; for (let j = 0; j < 3; j++){ c.min[j] = Math.min(c.min[j], P[v * 3 + j]); c.max[j] = Math.max(c.max[j], P[v * 3 + j]); } }
  }
  const list = [...comps.values()]; for (const c of list){ c.size = c.max.map((v, j) => v - c.min[j]); c.diag = Math.hypot(...c.size); }
  return { list, triComp };
}
// Per-corner normals with a crease (auto smooth): a corner averages the area-weighted normals of the faces round its position that
// lie within CREASE degrees of its own face - curved surfaces come out smooth, the edges of a box stay sharp (welded smooth normals
// over a decimated box's long triangles would shade each of its faces with a diagonal ramp).
const CREASE = 40;
function normalsOf(pos, idx){
  const nf = idx.length / 3, fn = new Float32Array(nf * 3), at = new Map(), keyOf = v => pos[v * 3].toFixed(6) + ',' + pos[v * 3 + 1].toFixed(6) + ',' + pos[v * 3 + 2].toFixed(6);
  for (let f = 0; f < nf; f++){
    const [a, b, c] = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]], e1 = [0, 1, 2].map(j => pos[b * 3 + j] - pos[a * 3 + j]), e2 = [0, 1, 2].map(j => pos[c * 3 + j] - pos[a * 3 + j]);
    fn.set([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], f * 3);     // area weighted
    for (const v of [a, b, c]){ const k = keyOf(v); let l = at.get(k); if (!l) at.set(k, l = []); l.push(f); }
  }
  const unit = f => { const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1; return [fn[f * 3] / l, fn[f * 3 + 1] / l, fn[f * 3 + 2] / l]; };
  const cos = Math.cos(CREASE * Math.PI / 180), nrm = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++){ const f = Math.floor(i / 3), u = unit(f), s = [0, 0, 0];
    for (const g of at.get(keyOf(idx[i]))){ const w = unit(g); if (u[0] * w[0] + u[1] * w[1] + u[2] * w[2] >= cos) for (let j = 0; j < 3; j++) s[j] += fn[g * 3 + j]; }
    const l = Math.hypot(...s) || 1; nrm.set([s[0] / l, s[1] / l, s[2] / l], i * 3); }
  return nrm;
}
// The GLB, compact (KHR_mesh_quantization, which three's GLTFLoader reads): every triangle corner is its own vertex (the atlas gives
// each triangle its own cell), drawn without an index buffer; POSITION as int16 in units of 1 / QPOS m (the node scales it back:
// +-16 m at 0.5 mm), NORMAL as normalised int8, TEXCOORD_0 as normalised uint16: 16 bytes a vertex instead of 32 (+ the index).
const QPOS = 2048;
function writeGLB(parts, img, meta){
  const views = [], accessors = [], chunks = []; let off = 0;
  const add = (buf, target, byteStride) => { const pad = (4 - off % 4) % 4; if (pad){ chunks.push(Buffer.alloc(pad)); off += pad; }
    views.push({ buffer: 0, byteOffset: off, byteLength: buf.byteLength, ...(byteStride ? { byteStride } : {}), ...(target ? { target } : {}) });
    chunks.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); off += buf.byteLength; return views.length - 1; };
  const acc = (view, type, count, ct, extra = {}) => { accessors.push({ bufferView: view, componentType: ct, count, type, ...extra }); return accessors.length - 1; };
  const meshes = [], nodes = [];
  for (const pt of parts){
    const nv = pt.pos.length / 3, P = new Int16Array(nv * 4), N = new Int8Array(nv * 4), UV = new Uint16Array(nv * 2), mn = [32767, 32767, 32767], mx = [-32768, -32768, -32768];
    for (let i = 0; i < nv; i++){
      for (let j = 0; j < 3; j++){ const q = Math.round(pt.pos[i * 3 + j] * QPOS); P[i * 4 + j] = q; mn[j] = Math.min(mn[j], q); mx[j] = Math.max(mx[j], q);
        N[i * 4 + j] = Math.round(Math.max(-1, Math.min(1, pt.nrm[i * 3 + j])) * 127); }
      for (let j = 0; j < 2; j++) UV[i * 2 + j] = Math.round(Math.max(0, Math.min(1, pt.uv[i * 2 + j])) * 65535);
    }
    const aP = acc(add(P, 34962, 8), 'VEC3', nv, 5122, { min: mn, max: mx }), aN = acc(add(N, 34962, 4), 'VEC3', nv, 5120, { normalized: true }),
      aT = acc(add(UV, 34962, 4), 'VEC2', nv, 5123, { normalized: true });
    meshes.push({ name: pt.name, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, TEXCOORD_0: aT }, material: 0 }] });
    nodes.push({ name: pt.name, mesh: meshes.length - 1, scale: [1 / QPOS, 1 / QPOS, 1 / QPOS] });
  }
  const iv = add(img);
  const json = { asset: { version: '2.0', generator: 'level/tools/model_sprites.mjs', extras: meta }, extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'], scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: [{ name: 'albedo', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: iv, mimeType: 'image/jpeg' }], accessors, bufferViews: views, buffers: [{ byteLength: 0 }] };
  let bin = Buffer.concat(chunks); bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]); json.buffers[0].byteLength = bin.length;
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ch(bin.length, 0x004E4942), bin]);
}
async function importModel(){
  const name = opt('model'), M = MODELS[name]; if (!M) fail('--model: one of ' + Object.keys(MODELS).join(', '));
  let src = opt('src'); if (!src) fail('--src <dir or .obj> needed');
  if (fs.statSync(src).isDirectory()){ const objs = fs.readdirSync(src).filter(f => f.toLowerCase().endsWith('.obj')), f = objs.find(f => M.match.test(f)) || objs[0]; if (!f) fail('no .obj in ' + src); src = path.join(src, f); }
  const faces = +opt('faces', M.faces), err = +opt('err', M.err);
  const { P, UV, tri, mtllib } = parseOBJ(fs.readFileSync(src, 'utf8'));
  let texFile = null;
  if (mtllib && fs.existsSync(path.join(path.dirname(src), mtllib))){ const m = /^\s*map_Kd\s+(.+)$/m.exec(fs.readFileSync(path.join(path.dirname(src), mtllib), 'utf8')); if (m) texFile = path.join(path.dirname(src), m[1].trim()); }
  if (!texFile || !fs.existsSync(texFile)){ const f = fs.readdirSync(path.dirname(src)).find(f => /\.(png|jpe?g)$/i.test(f)); if (f) texFile = path.join(path.dirname(src), f); }
  if (!texFile) fail('no texture next to ' + src);
  const { list, triComp } = partsOf(P, tri);
  const drop = new Set(list.filter(c => M.drop && M.drop(c)).map(c => c.id));
  const partOf = id => { for (const [pn, f] of Object.entries(M.parts || {})) if (f(list[id])) return pn; return 'main'; };
  // ground + scale from what is kept
  const keep = []; for (let t = 0; t < tri.length / 3; t++) if (!drop.has(triComp[t])) keep.push(t);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of keep) for (let k = 0; k < 3; k++){ const v = tri[t * 3 + k][0]; for (let j = 0; j < 3; j++){ mn[j] = Math.min(mn[j], P[v * 3 + j]); mx[j] = Math.max(mx[j], P[v * 3 + j]); } }
  const s = M.unit || M.height / (mx[1] - mn[1]), cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const { MeshoptSimplifier: MS } = await import(firstFile(process.env.MESHOPT) ? pathToFileURL(process.env.MESHOPT).href : 'meshoptimizer')
    .catch(() => fail('meshoptimizer not found: npm i meshoptimizer, or set MESHOPT to its index.module.js'));
  await MS.ready;
  const toM = vi => [(P[vi * 3] - cx) * s, (P[vi * 3 + 1] - mn[1]) * s, (P[vi * 3 + 2] - cz) * s];
  // 1. weld by position (the UV seams of the source atlas would lock the simplifier: the texture is re-baked below), decimate
  const groups = {}; for (const t of keep){ const g = partOf(triComp[t]); (groups[g] = groups[g] || []).push(t); }
  const parts = []; let total = 0;
  for (const [pn, ts] of Object.entries(groups)){
    const pm = new Map(), pos = [], idx = [];
    for (const t of ts) for (let k = 0; k < 3; k++){ const vi = tri[t * 3 + k][0], key = P[vi * 3] + ',' + P[vi * 3 + 1] + ',' + P[vi * 3 + 2];
      let n = pm.get(key); if (n === undefined){ n = pos.length / 3; pm.set(key, n); pos.push(...toM(vi)); } idx.push(n); }
    const P32 = new Float32Array(pos), target = Math.max(1, Math.round(faces * ts.length / keep.length)) * 3;
    const [I] = idx.length > target ? MS.simplify(new Uint32Array(idx), P32, 3, target, err, ['ErrorAbsolute']) : [new Uint32Array(idx)];
    const used = new Int32Array(P32.length / 3).fill(-1), np = [], ni = [];
    for (let t = 0; t < I.length; t += 3){ const a = I[t], b2 = I[t + 1], c = I[t + 2]; if (a === b2 || b2 === c || a === c) continue;
      for (const v of [a, b2, c]){ if (used[v] < 0){ used[v] = np.length / 3; np.push(P32[v * 3], P32[v * 3 + 1], P32[v * 3 + 2]); } ni.push(used[v]); } }
    const fp = new Float32Array(np), I2 = new Uint32Array(ni);
    parts.push({ name: pn, pos: fp, idx: I2, nrm: normalsOf(fp, I2) }); total += I2.length / 3;
    console.log(`  part ${pn}: ${ts.length} -> ${I2.length / 3} faces`);
  }
  parts.sort((a, b2) => (a.name === 'main' ? -1 : b2.name === 'main' ? 1 : a.name.localeCompare(b2.name)));
  // 2. the source texture (decoded by the browser) and its box-filtered mip chain
  const { b, p } = await openPage({ '/tex': texFile });
  const raw = await p.evaluate(() => window.MS_pixels('/tex'));
  const mips = [{ w: raw.w, h: raw.h, d: Float32Array.from(Buffer.from(raw.data, 'base64')) }];
  while (mips[mips.length - 1].w > 4){ const m = mips[mips.length - 1], w = m.w >> 1, h = m.h >> 1, d = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++){ const i = (y * 2 * m.w + x * 2) * 4 + c; d[(y * w + x) * 4 + c] = (m.d[i] + m.d[i + 4] + m.d[i + m.w * 4] + m.d[i + m.w * 4 + 4]) / 4; }
    mips.push({ w, h, d }); }
  const sampleTex = (u, v, lv) => { const m = mips[Math.max(0, Math.min(mips.length - 1, Math.round(lv)))], f = m.w / raw.w;
    const x = Math.max(0, Math.min(m.w - 1.001, u * f - 0.5)), y = Math.max(0, Math.min(m.h - 1.001, v * f - 0.5)), x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, o = [0, 0, 0];
    for (let c = 0; c < 3; c++){ const i = (y0 * m.w + x0) * 4 + c; o[c] = (m.d[i] * (1 - fx) + m.d[i + 4] * fx) * (1 - fy) + (m.d[i + m.w * 4] * (1 - fx) + m.d[i + m.w * 4 + 4] * fx) * fy; }
    return o; };
  // 3. the source triangles in metres (UVs in texture px), in a uniform grid for closest-point queries
  const texel = +opt('texel', M.texel), R = Math.max(2 * err, 2 * texel), G = 2 * R, O = keep.length;
  const oP = new Float32Array(O * 9), oUV = new Float32Array(O * 6), oN = new Float32Array(O * 3), oL = new Float32Array(O), grid = new Map();
  keep.forEach((t, i) => {
    for (let k = 0; k < 3; k++){ const [vi, ti] = tri[t * 3 + k]; oP.set(toM(vi), i * 9 + k * 3); oUV[i * 6 + k * 2] = ti >= 0 ? UV[ti * 2] * raw.w : 0; oUV[i * 6 + k * 2 + 1] = ti >= 0 ? (1 - UV[ti * 2 + 1]) * raw.h : 0; }
    const q = oP.subarray(i * 9, i * 9 + 9), e1 = [q[3] - q[0], q[4] - q[1], q[5] - q[2]], e2 = [q[6] - q[0], q[7] - q[1], q[8] - q[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], a3 = Math.hypot(...n) || 1e-12; oN.set(n.map(v => v / a3), i * 3);
    const u = oUV.subarray(i * 6, i * 6 + 6), a2 = Math.abs((u[2] - u[0]) * (u[5] - u[1]) - (u[4] - u[0]) * (u[3] - u[1])) || 1e-9;
    oL[i] = Math.log2(Math.max(1, Math.sqrt(a2 / a3) * texel));                  // source texels under one baked texel -> mip level
    const lo = [0, 1, 2].map(j => Math.floor((Math.min(q[j], q[3 + j], q[6 + j]) - R) / G)), hi = [0, 1, 2].map(j => Math.floor((Math.max(q[j], q[3 + j], q[6 + j]) + R) / G));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++){ const key = (x * 4096 + y) * 4096 + z; let c = grid.get(key); if (!c) grid.set(key, c = []); c.push(i); }
  });
  // 4. atlas: every decimated triangle in its own cell, true shape (longest edge along the cell's bottom), 2-texel gutter
  const cells = [];
  for (const pt of parts) for (let t = 0; t < pt.idx.length; t += 3){
    const V = [0, 1, 2].map(k => [...pt.pos.subarray(pt.idx[t + k] * 3, pt.idx[t + k] * 3 + 3)]);
    const L3 = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]), el = [L3(V[0], V[1]), L3(V[1], V[2]), L3(V[2], V[0])];
    const k0 = el.indexOf(Math.max(...el)), ord = [k0, (k0 + 1) % 3, (k0 + 2) % 3], A = V[ord[0]], B = V[ord[1]], C = V[ord[2]];
    const ab = [0, 1, 2].map(j => B[j] - A[j]), ac = [0, 1, 2].map(j => C[j] - A[j]), lab = Math.hypot(...ab) || 1e-9;
    const along = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / lab, cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const w = lab / texel, h = Math.hypot(...cr) / lab / texel;
    cells.push({ pt, t, ord, T2: [[2, 2], [2 + w, 2], [2 + along / texel, 2 + h]], cw: Math.ceil(w) + 4, ch: Math.ceil(h) + 4 });
  }
  cells.sort((x, y) => y.ch - x.ch || y.cw - x.cw);
  const area = cells.reduce((x, c) => x + c.cw * c.ch, 0); let AW = 64; while (AW * AW < area * 1.1) AW *= 2;
  let px = 0, py = 0, rh = 0; for (const c of cells){ if (px + c.cw > AW){ px = 0; py += rh; rh = 0; } c.x = px; c.y = py; px += c.cw; rh = Math.max(rh, c.ch); }
  let AH = 64; while (AH < py + rh) AH *= 2;
  const img = new Uint8ClampedArray(AW * AH * 4), uvs = new Map();
  const cp = (P0, A, B, C) => {          // closest point on triangle ABC to P0 (Ericson), as barycentrics [u, v, w]
    const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    const ab = sub(B, A), ac = sub(C, A), ap = sub(P0, A), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
    const bp = sub(P0, B), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0){ const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
    const cq = sub(P0, C), d5 = dot(ab, cq), d6 = dot(ac, cq); if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0){ const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0){ const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
    const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; return [1 - v - w, v, w];
  };
  const tri3 = i => [[oP[i * 9], oP[i * 9 + 1], oP[i * 9 + 2]], [oP[i * 9 + 3], oP[i * 9 + 4], oP[i * 9 + 5]], [oP[i * 9 + 6], oP[i * 9 + 7], oP[i * 9 + 8]]];
  const bakeAt = (q, n) => {               // the source colour at the surface point closest to q (same-facing surfaces first)
    const cand = grid.get((Math.floor(q[0] / G) * 4096 + Math.floor(q[1] / G)) * 4096 + Math.floor(q[2] / G)) || [];
    let best = null, bd = 1e9, fb = null, fd = 1e9;
    for (const i of cand){ const [A, B, C] = tri3(i), w = cp(q, A, B, C), x = [0, 1, 2].map(j => A[j] * w[0] + B[j] * w[1] + C[j] * w[2]), d = Math.hypot(x[0] - q[0], x[1] - q[1], x[2] - q[2]);
      if (d < fd){ fd = d; fb = [i, w]; }
      if (d < bd && oN[i * 3] * n[0] + oN[i * 3 + 1] * n[1] + oN[i * 3 + 2] * n[2] > -0.2){ bd = d; best = [i, w]; } }
    const hit = best && bd < R ? best : fb; if (!hit) return null;
    const [i, w] = hit, u = oUV.subarray(i * 6, i * 6 + 6);
    return sampleTex(u[0] * w[0] + u[2] * w[1] + u[4] * w[2], u[1] * w[0] + u[3] * w[1] + u[5] * w[2], oL[i]);
  };
  let miss = 0;
  for (const c of cells){
    const V = c.ord.map(k => [...c.pt.pos.subarray(c.pt.idx[c.t + k] * 3, c.pt.idx[c.t + k] * 3 + 3)]);
    const e1 = [0, 1, 2].map(j => V[1][j] - V[0][j]), e2 = [0, 1, 2].map(j => V[2][j] - V[0][j]), nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    c.ord.forEach((k, j) => uvs.set(c.pt.name + ':' + (c.t + k), [(c.x + c.T2[j][0]) / AW, (c.y + c.T2[j][1]) / AH]));
    const T3 = c.T2.map(q => [q[0], q[1], 0]);
    for (let j = 0; j < c.ch; j++) for (let i = 0; i < c.cw; i++){
      const w = cp([i + 0.5, j + 0.5, 0], T3[0], T3[1], T3[2]), Q = [0, 1, 2].map(k => V[0][k] * w[0] + V[1][k] * w[1] + V[2][k] * w[2]);
      const col = bakeAt(Q, nn) || (miss++, [128, 128, 128]), o = ((c.y + j) * AW + c.x + i) * 4;
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255;
    }
  }
  // 5. un-index (every corner has its own atlas UV), encode the atlas as JPEG, write the GLB (writeGLB)
  for (const pt of parts){ const n = pt.idx.length, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++){ const v = pt.idx[i]; pos.set(pt.pos.subarray(v * 3, v * 3 + 3), i * 3); nrm.set(pt.nrm.subarray(i * 3, i * 3 + 3), i * 3); uv.set(uvs.get(pt.name + ':' + i), i * 2); }
    Object.assign(pt, { pos, nrm, uv }); }
  const jpg = Buffer.from((await p.evaluate(([w, h, d, q]) => window.MS_encode(w, h, d, q), [AW, AH, Buffer.from(img.buffer).toString('base64'), +opt('jpeg', M.jpeg || 0.9)])).split(',')[1], 'base64'); await b.close();
  const meta = { source: path.basename(src), sourceFaces: tri.length / 3, droppedParts: drop.size, faces: total, height_m: +((mx[1] - mn[1]) * s).toFixed(3), texel_m: texel, atlas: [AW, AH],
    units: 'metres, standing on y = 0, centred on x = z = 0' };
  fs.mkdirSync(MODEL_DIR, { recursive: true }); const out = path.join(MODEL_DIR, name + '.glb'); const glb = writeGLB(parts, jpg, meta); fs.writeFileSync(out, glb);
  console.log(`${name}: ${tri.length / 3} faces -> ${total} (${drop.size} stray parts dropped), ${((mx[0] - mn[0]) * s).toFixed(2)} x ${((mx[1] - mn[1]) * s).toFixed(2)} x ${((mx[2] - mn[2]) * s).toFixed(2)} m, ` +
    `texture re-baked to a ${AW} x ${AH} atlas (${texel * 100} cm texels${miss ? ', ' + miss + ' texels missed' : ''}) -> ${out} (${(glb.length / 1024).toFixed(0)} KB)`);
}

// ---------- render ----------
async function render(){
  const only = opt('only', ''), outArg = opt('out', ''), prevDir = opt('preview', '');
  if (only && !outArg && !process.env.MS_MODELS) fail('--only renders a partial atlas: give it its own --out <dir> (the shipped level/sprites atlas is always rendered whole)');
  const outDir = path.resolve(outArg || (process.env.MS_MODELS ? path.join(path.dirname(process.env.MS_MODELS), 'out') : path.join(LEVEL, 'sprites')));
  const extra = opt('recipe', '') ? JSON.parse(fs.readFileSync(opt('recipe'), 'utf8')) : [];      // ad-hoc sprites (JSON list, same fields; a name overrides)
  const all = process.env.MS_MODELS ? extra : SPRITES.filter(s => !extra.some(e => e.name === s.name)).concat(extra);   // a library group: its recipe only
  const list = all.filter(s => !only || only.split(',').includes(s.name)).map(s => typeof s.classes === 'string' ? { ...s, classes: CLASSES[s.classes] } : s);
  if (!list.length) fail('no sprites selected');
  for (const s of list) if ((s.cut || []).length > MAXCUT) fail(s.name + ': at most ' + MAXCUT + ' cut boxes (the shader has ' + MAXCUT + ' slots)');
  const files = {}; for (const f of fs.readdirSync(MODEL_DIR)) if (f.endsWith('.glb')) files['/models/' + f] = path.join(MODEL_DIR, f);
  const { b, p, errors } = await openPage(files);
  const wheelR = Object.fromEntries(all.filter(s => s.wheel).map(s => [s.name, s.wheel.r]));          // the headframes' sheaves: their wheels' radii
  const res = await p.evaluate(cfg => window.MS_renderAll(cfg), { sprites: list, RAMP, MATERIALS, PROP_LIGHT, PROP_BANDS, PX_PER_M, OUTLINE, wheelR, preview: !!prevDir });
  if (errors.length){ console.error('page errors:\n' + errors.join('\n')); }
  await b.close();
  fs.mkdirSync(outDir, { recursive: true });
  const w64 = (f, d) => fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
  w64(path.join(outDir, 'models.png'), res.atlas);
  const json = { pxPerM: PX_PER_M, atlas: 'models.png', generator: 'tools/model_sprites.mjs', sprites: res.meta };
  fs.writeFileSync(path.join(outDir, 'models.json'), JSON.stringify(json, null, 1).replace(/\n\s+(-?[\d.]+|"[^"]*")(,?)(?=\n)/g, ' $1$2').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']') + '\n');
  if (prevDir){ fs.mkdirSync(prevDir, { recursive: true }); for (const [k, d] of Object.entries(res.previews)) w64(path.join(prevDir, k + '.png'), d); }
  for (const [n, m] of Object.entries(res.meta)){
    const f = m.frames ? m.frames[0] : m, size = m.frames ? `${f.w} x ${f.h} x ${m.frames.length} frames` : `${m.w} x ${m.h}`;
    console.log(n.padEnd(18), size.padEnd(22), 'anchor', f.ax, f.ay, m.top !== undefined ? 'top ' + m.top : 'r ' + m.r, m.sheaves ? 'sheaves ' + JSON.stringify(m.sheaves) : '',
      m.feet ? 'feet ' + JSON.stringify(m.feet) : '', m.deck ? 'deck ' + JSON.stringify(m.deck) : '');
  }
  console.log('wrote', path.join(outDir, 'models.png'), path.join(outDir, 'models.json'), prevDir ? '+ previews in ' + prevDir : '');
}

// ---------- check ----------
// The atlas (level/sprites, or --out) against the level's contracts, the checks the playtest can take over once models.js is wired:
// every rect inside the atlas, only alpha 0 / 255 and style.js colours (RAMP steps, OUTLINE), each headframe's wheels present, the
// playfield headframe's feet outside the shaft (map.js ENT.shaft; its anchor on the shaft's centre line) and its top >= 8 px under
// the E street view's frame top, the movers' decks SCALE.cart wide, OUTLINE on the movers' contour only, no 1 px see-through
// slits. Exit code 1 on any failure.
async function check(){
  const dir = path.resolve(opt('out', path.join(LEVEL, 'sprites'))), J = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')).sprites;
  const w = {}, ctx = vm.createContext({ window: w }); for (const f of ['js/style.js', 'js/map.js']) vm.runInContext(fs.readFileSync(path.join(LEVEL, f), 'utf8'), ctx);
  const M = w.LVL.map, { b, p } = await openPage({ '/atlas.png': path.join(dir, 'models.png') }), img = await p.evaluate(() => window.MS_pixels('/atlas.png')); await b.close();
  const d = Buffer.from(img.data, 'base64'), cols = new Set([OUTLINE, ...Object.values(RAMP).flat()]), res = [];
  const ok = (name, pass, info = '') => { res.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ': ' + info : '')); };
  const rects = Object.entries(J).flatMap(([n, s]) => (s.frames || [s]).map(r => [n, r]));
  ok('rects inside the atlas', rects.every(([, r]) => r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h), img.w + ' x ' + img.h);
  let alpha = true; const off = new Set();
  for (let i = 0; i < d.length; i += 4){ if (d[i + 3] && d[i + 3] < 255) alpha = false; if (!d[i + 3]) continue;
    const h = '#' + [0, 1, 2].map(k => d[i + k].toString(16).padStart(2, '0')).join(''); if (!cols.has(h)) off.add(h); }
  ok('alpha 0 / 255 only', alpha); ok('every colour a style.js step', !off.size, [...off].join(' '));
  for (const [n, s] of Object.entries(J)) if (s.sheaves) ok(n + ': its wheels', s.sheaves.every(q => J[q.sprite] && J[q.sprite].frames));
  const hf = J.headframe, half = (M.ENT.shaft.c1 - M.ENT.shaft.c0 + 1) * M.TS / 2, street = M.GROUND * M.TS - (M.LH - w.LVL.style.VH);
  ok('headframe feet outside the shaft', hf.feet.every(([a, e]) => e - hf.ax <= -half || a - hf.ax >= half), JSON.stringify(hf.feet.map(([a, e]) => [a - hf.ax, e - hf.ax])) + ' vs +-' + half);
  ok('headframe top >= 8 px under the E street view', street - hf.top >= 8, 'top ' + hf.top + ' px over the street at frame y ' + street);
  for (const [n, s] of Object.entries(J)) if (s.layer === 'mover') ok(n + ': deck ' + SCALE.cart[0] + ' px', s.deck.x1 - s.deck.x0 === SCALE.cart[0], JSON.stringify(s.deck));
  // OUTLINE (style.js) marks the movers, the things you stand on: no other sprite has it on its outer contour (an opaque pixel next
  // to a transparent one or the rect's edge)
  const OL = parseInt(OUTLINE.slice(1), 16), at = (x, y) => (y * img.w + x) * 4, isOL = i => (d[i] << 16 | d[i + 1] << 8 | d[i + 2]) === OL;
  const scenery = rects.filter(([n]) => J[n].layer !== 'mover'), bad = new Set();
  for (const [n, r] of scenery) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++){ const i = at(x, y); if (!d[i + 3] || !isOL(i)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < r.x || Y < r.y || X >= r.x + r.w || Y >= r.y + r.h || !d[at(X, Y) + 3]; })) bad.add(n); }
  ok('no OUTLINE on the scenery\'s contour (it is the movers\')', !bad.size, [...bad].join(' '));
  // no 1 px see-through slit inside a rendered sprite (a transparent pixel opaque on both sides across or up and down: what stands
  // behind would show through it as a hairline); the painted wheels' open web is theirs (a spoke's root steps past the hub)
  const slit = new Map(), A = (x, y) => d[at(x, y) + 3];
  for (const [n, r] of rects.filter(([n]) => !J[n].frames)) for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++)
    if (!A(x, y) && (A(x - 1, y) && A(x + 1, y) || A(x, y - 1) && A(x, y + 1))) slit.set(n, (slit.get(n) || 0) + 1);
  ok('no 1 px see-through slits', !slit.size, JSON.stringify(Object.fromEntries(slit)));
  if (res.some(r => !r)) process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The page side (runs in Chromium; three r128 + GLTFLoader; js/style.js for its hash and pixel font).
const PAGE = String.raw`
(function(){
const T = THREE, D = Math.PI / 180, LS = LVL.style;
const renderer = new T.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1);
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function hsv(r, g, b){ const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, mx ? d / mx : 0, mx / 255]; }
function lab(r, g, b){
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
window.MS_pixels = async url => {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768));
  return { w: c.width, h: c.height, data: btoa(s) };
};
window.MS_encode = (w, h, b64, q) => {
  const bin = atob(b64), d = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(d, w, h), 0, 0); return c.toDataURL('image/jpeg', q);
};

// ---- the passes: 0 albedo (alpha: 255 = sort by colour, else 1 + the material a part names), 1 n.l + normal, 2 depth (24 bit),
// 3 / 4 the surface point in the instance's own frame (x, y / z at 12 bits over +-8 m) and the instance ----
const VS = 'uniform mat4 uLoc; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vL;\n' +
  'void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = (uLoc * vec4(position, 1.0)).xyz;\n' +
  '  vec4 mv = viewMatrix * w; vV = mv.xyz; gl_Position = projectionMatrix * mv; }';
const FS = 'uniform sampler2D map; uniform float uHasMap; uniform vec3 uColor; uniform float uCls; uniform float uInst; uniform float uMode; uniform vec3 uL;\n' +
  'uniform float uCrease; uniform float uBias; uniform vec2 uZ; uniform vec4 uClip[2]; uniform vec4 uCut[${MAXCUT}]; uniform float uSnap; uniform float uKeep;\n' +
  'varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vL;\n' +
  'vec3 pack12(float a, float b){ float A = floor(clamp(a, 0.0, 0.9999) * 4096.0), B = floor(clamp(b, 0.0, 0.9999) * 4096.0);\n' +
  '  return vec3(floor(A / 16.0), mod(A, 16.0) * 16.0 + floor(B / 256.0), mod(B, 256.0)) / 255.0; }\n' +
  'void main(){\n' +
  '  for (int i = 0; i < 2; i++) if (dot(vec4(vW, 1.0), uClip[i]) < 0.0) discard;\n' +
  '  if (uKeep < 0.5) for (int i = 0; i < ${MAXCUT}; i++) if (vW.x > uCut[i].x && vW.x < uCut[i].z && vW.y > uCut[i].y && vW.y < uCut[i].w) discard;\n' +
  '  vec3 nf = normalize(cross(dFdx(vV), dFdy(vV)));\n' +                       // flat normal: always faces the camera
  '  vec3 ns = normalize(vN); if (dot(ns, nf) < 0.0) ns = -ns;\n' +           // smooth normal, turned to the visible side
  '  vec3 n = dot(nf, ns) > uCrease ? ns : nf;\n' +                            // curved surfaces smooth, hard edges flat
  '  vec3 a = abs(n);\n' +                                                    // within uSnap of a view axis: that axis (a wavy plate lit as one plane)
  '  if (a.x > uSnap) n = vec3(sign(n.x), 0.0, 0.0); else if (a.y > uSnap) n = vec3(0.0, sign(n.y), 0.0); else if (a.z > uSnap) n = vec3(0.0, 0.0, sign(n.z));\n' +
  '  if (uMode < 0.5){ vec3 c = uHasMap > 0.5 ? texture2D(map, vUv, uBias).rgb : uColor; gl_FragColor = vec4(c, uCls > 0.5 ? uCls / 255.0 : 1.0); }\n' +
  '  else if (uMode < 1.5) gl_FragColor = vec4(dot(n, uL) * 0.5 + 0.5, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, 1.0);\n' +
  '  else if (uMode < 2.5){ float z = clamp((-vV.z - uZ.x) / (uZ.y - uZ.x), 0.0, 0.99999); vec3 e = fract(z * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0); gl_FragColor = vec4(e, 1.0); }\n' +
  '  else if (uMode < 3.5) gl_FragColor = vec4(pack12((vL.x + 8.0) / 16.0, (vL.y + 8.0) / 16.0), 1.0);\n' +
  '  else gl_FragColor = vec4(pack12((vL.z + 8.0) / 16.0, (uInst + 0.5) / 4096.0), 1.0);\n' +
  '}';
const U = { uMode: { value: 0 }, uL: { value: new T.Vector3() }, uCrease: { value: 0.82 }, uBias: { value: 0 }, uZ: { value: new T.Vector2(0, 1) },
  uClip: { value: [0, 1].map(() => new T.Vector4(0, 0, 0, 1)) }, uCut: { value: Array.from({ length: ${MAXCUT} }, () => new T.Vector4(0, 0, -1, -1)) }, uSnap: { value: 2 } };
// a material per mesh: its texture or a flat colour, k >= 0 = it IS material k of the class table (the recipe's parts); keep: the
// cut boxes leave it; tone: a part's own tone offset, carried in its flat colour's red channel (128 + 16 x tone)
function shaderMat(map, k, keep = false, tone = 0){
  return new T.ShaderMaterial({ uniforms: { map: { value: map || null }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new T.Color(0.5 + tone / 16, 0.5, 0.5) },
    uCls: { value: k >= 0 ? k + 1 : 0 }, uInst: { value: 0 }, uLoc: { value: new T.Matrix4() }, uKeep: { value: keep ? 1 : 0 },
    uMode: U.uMode, uL: U.uL, uCrease: U.uCrease, uBias: U.uBias, uZ: U.uZ, uClip: U.uClip, uCut: U.uCut, uSnap: U.uSnap },
    vertexShader: VS, fragmentShader: FS, side: T.DoubleSide, blending: T.NoBlending, extensions: { derivatives: true } });
}
const cache = {};
function loadModel(name){
  if (!cache[name]) cache[name] = new Promise((res, rej) => new T.GLTFLoader().load('/models/' + name + '.glb', g => res(g.scene), undefined, e => rej(new Error('model ' + name + ': ' + e))));
  return cache[name];
}
// a part of the recipe's own (sprite fields: add), in the model's own frame, drawn as material k
function partMesh(a, k){
  const mat = shaderMat(null, k, !!a.keep, a.tone), g = new T.Group(), H = LS.hash;
  if (a.box){ const [x0, y0, z0, x1, y1, z1] = a.box, m = new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);   // rz: turned
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.rotation.z = (a.rz || 0) * D; g.add(m); }                     // about its centre
  else if (a.plate){       // a flat plate of any outline (a gusset): the polygon [[x, y], ..] extruded from z[0] to z[1]
    const s = new T.Shape(a.plate.map(([x, y]) => new T.Vector2(x, y))), m = new T.Mesh(new T.ExtrudeGeometry(s, { depth: a.z[1] - a.z[0], bevelEnabled: false }), mat);
    m.position.z = a.z[0]; g.add(m); }
  else if (a.wheel){       // tread, the flange behind it (rail side), the hub boss in front
    const [x, y, z] = a.wheel, cyl = (r, w, dz) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, w, 32), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z + dz); g.add(m); };
    cyl(a.r, a.w, 0); cyl(a.r + a.flange, a.w * 0.4, -a.w * 0.7); cyl(a.r * 0.32, a.w * 0.5, a.w * 0.6); }
  else if (a.heap){        // lumps (icosahedra, sizes and spin from the hash) on a mound: highest in the middle, low at its ends
    const [x0, x1, z0, z1] = a.heap;
    for (let i = 0; i < a.n; i++){ const u = H(i, a.seed), v = H(a.seed, i + 77), r = a.r[0] + (a.r[1] - a.r[0]) * H(i + 31, a.seed);
      const m = new T.Mesh(new T.IcosahedronGeometry(r, 0), mat), mound = Math.sin(Math.PI * u) * Math.cos((v - 0.5) * Math.PI * 0.9);
      m.position.set(x0 + (x1 - x0) * u, a.y + a.h * mound, z0 + (z1 - z0) * v); m.rotation.set(H(i, 5) * 6.3, H(i, 6) * 6.3, H(i, 7) * 6.3); g.add(m); } }
  return g;
}

// ---- deformations, in the model's own frame (metres). spread [x0, x1, d]: x past x1 moves d, x between x0 and x1 in
// proportion (a slab of the model lengthened by d). rake { foot, top, hw, band, d }: the strut whose centre line runs foot ->
// top (vertical above its top), hw either side, moves out by d[0] at the ground .. d[1] at its top and above; past its inner edge
// the move fades out over band (the beams there lengthen), the rest stays as modelled ----
const spreadX = (x, sp) => !sp ? x : x <= sp[0] ? x : x >= sp[1] ? x + sp[2] : x + sp[2] * (x - sp[0]) / (sp[1] - sp[0]);
function rakeX(x, y, rk){
  if (!rk) return x;
  const [fx, fy] = rk.foot, [tx, ty] = rk.top, xs = fx + (tx - fx) * Math.min(1, (y - fy) / (ty - fy)), o = Math.sign(rk.d[0]);
  const d = rk.d[1] + (rk.d[0] - rk.d[1]) * Math.max(0, 1 - y / ty), xin = xs - o * rk.hw;
  return x + d * Math.max(0, Math.min(1, 1 + o * (x - xin) / rk.band));
}
function deformMesh(o, ins){
  o.updateMatrix(); const a = o.geometry.attributes.position, m = o.matrix, mi = m.clone().invert(), v = new T.Vector3(), f = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++){ v.fromBufferAttribute(a, i).applyMatrix4(m);
    v.x = rakeX(spreadX(v.x, ins.spread), v.y, ins.rake); v.applyMatrix4(mi); f[i * 3] = v.x; f[i * 3 + 1] = v.y; f[i * 3 + 2] = v.z; }
  o.geometry = o.geometry.clone(); o.geometry.setAttribute('position', new T.BufferAttribute(f, 3));
}
// The scene: each instance deformed, rotated (y: spin about its own axis first, then x / z tip it over), mirrored,
// its visible geometry centred on its pos and standing on pos y; the recipe's parts join the first instance in its own frame.
// Every mesh learns its instance's own frame (uLoc) for passes 3 / 4.
async function buildScene(sp, mats){
  const scene = new T.Scene(), objs = [];
  const clsOf = m => { const k = mats.indexOf(m); if (k < 0) throw new Error(sp.name + ': material ' + m + ' is not in its class table'); return k; };
  const insts = sp.instances || [{ model: sp.model, rot: sp.rot, hide: sp.hide, mirror: sp.mirror, spread: sp.spread, rake: sp.rake }];
  for (let n = 0; n < insts.length; n++){
    const ins = insts[n], hide = ins.hide || [], obj = (await loadModel(ins.model)).clone(true);
    obj.traverse(o => { if (o.isMesh){ o.material = shaderMat(o.material.map, -1); if (hide.includes(o.name)) o.visible = false; } });
    if (ins.spread || ins.rake) obj.traverse(o => { if (o.isMesh) deformMesh(o, ins); });
    const holder = new T.Group(); holder.add(obj);
    const rot = ins.rot || [0, 0, 0]; obj.rotation.set(rot[0] * D, rot[1] * D, rot[2] * D, 'ZXY');
    obj.scale.set(ins.mirror ? -1 : 1, 1, 1);
    holder.updateMatrixWorld(true);
    const bb = new T.Box3(); obj.traverse(o => { if (o.isMesh && o.visible){ o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    obj.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    if (!n) for (const a of sp.add || []) obj.add(partMesh(a, clsOf(a.mat)));
    const pos = ins.pos || [0, 0, 0]; holder.position.set(pos[0], pos[1], pos[2]);
    scene.add(holder); objs.push(obj);
  }
  scene.updateMatrixWorld(true);
  objs.forEach((obj, n) => { const inv = obj.matrixWorld.clone().invert();
    obj.traverse(o => { if (o.isMesh){ o.material.uniforms.uLoc.value.multiplyMatrices(inv, o.matrixWorld); o.material.uniforms.uInst.value = n; } }); });
  return { scene, objs };
}
function readRT(rt, w, h){ const buf = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); return buf; }
const unpack12 = (r, g, b) => [((r << 4) | (g >> 4)) + 0.5, (((g & 15) << 8) | b) + 0.5];

// ---- the silhouette, straightened: the boundary of the covered samples traced into closed loops (outer edges and holes; at a
// saddle the loop stays with its own sample, so diagonal neighbours stay apart), each simplified (Douglas-Peucker, tolerance in
// samples) and filled again (even-odd at pixel centres) ----
function traceLoops(m, w, h){
  const out = new Map(), key = (x, y) => y * (w + 1) + x, edges = [];
  const add = (x0, y0, x1, y1, p) => { const e = { x0, y0, x1, y1, p, used: false }, k = key(x0, y0); edges.push(e); const l = out.get(k); if (l) l.push(e); else out.set(k, [e]); };
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ if (!m[y * w + x]) continue; const p = y * w + x;
    if (!at(x, y - 1)) add(x + 1, y, x, y, p); if (!at(x - 1, y)) add(x, y, x, y + 1, p);
    if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1, p); if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y, p); }
  const loops = [];
  for (const e0 of edges){ if (e0.used) continue; const L = []; let e = e0;
    for (;;){ e.used = true; L.push([e.x0, e.y0]); const c = out.get(key(e.x1, e.y1)), nx = c.length > 1 ? c.find(q => q.p === e.p) : c[0];
      if (!nx || nx.used) break; e = nx; }
    loops.push(L); }
  return loops;
}
function simplifyLoop(L, tol){
  const n = L.length; if (n < 8) return L;
  const P = []; for (let i = 0; i < n; i++){ const a = L[(i + n - 1) % n], b = L[i], c = L[(i + 1) % n]; if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) P.push(b); }   // corners only
  const m = P.length; if (m < 4) return P;
  let far = 0, fd = -1; for (let i = 1; i < m; i++){ const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd){ fd = d; far = i; } }
  const keep = new Uint8Array(m + 1); keep[0] = keep[far] = keep[m] = 1;
  const at = i => P[i % m], stack = [[0, far], [far, m]];
  while (stack.length){ const [i, j] = stack.pop(); if (j - i < 2) continue; const a = at(i), b = at(j), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let k = -1, dm = tol; for (let q = i + 1; q < j; q++){ const p = at(q), d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len; if (d > dm){ dm = d; k = q; } }
    if (k >= 0){ keep[k] = 1; stack.push([i, k], [k, j]); } }
  const R = []; for (let i = 0; i < m; i++) if (keep[i]) R.push(P[i]); return R;
}
function fillLoops(loops, W, H){
  const inn = new Uint8Array(W * H), xs = [];
  for (let y = 0; y < H; y++){ const yc = y + 0.5; xs.length = 0;
    for (const L of loops) for (let i = 0; i < L.length; i++){ const a = L[i], b = L[(i + 1) % L.length]; if ((yc < a[1]) !== (yc < b[1])) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2){ const x1 = Math.min(W, Math.ceil(xs[k + 1] - 0.5)); for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < x1; x++) inn[y * W + x] = 1; } }
  return inn;
}

async function renderSprite(sp, C){
  const SS = sp.ss || 4, ppm = C.PX_PER_M * (sp.scale || 1) * (sp.size || 1), table = sp.classes, mats = Object.keys(table);
  const { scene, objs } = await buildScene(sp, mats);
  // camera basis from yaw / pitch (looking at the origin)
  const yaw = (sp.yaw || 0) * D, pitch = (sp.pitch || 0) * D;
  const dir = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  cam.position.copy(dir.clone().multiplyScalar(100)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const world = q => new T.Vector3(q[0], q[1], q[2]).applyMatrix4(objs[0].matrixWorld);          // own-frame point -> world
  // keepX [x0, x1] (null = open): the clip planes keeping that slice of the own frame's x; cut boxes -> world boxes
  const clips = [];
  if (sp.keepX) sp.keepX.forEach((x, i) => { if (x === null) return; const a = world([x, 0, 0]), d = Math.sign(world([x + 1, 0, 0]).x - a.x) * (i ? -1 : 1); clips.push([d, 0, 0, -d * a.x]); });
  const cutW = (sp.cut || []).map(c => { const q = [[c[0], c[1]], [c[2], c[1]], [c[0], c[3]], [c[2], c[3]]].map(p => world([p[0], p[1], 0]));
    return [Math.min(...q.map(v => v.x)), Math.min(...q.map(v => v.y)), Math.max(...q.map(v => v.x)), Math.max(...q.map(v => v.y))]; });
  // projected bounds of the visible geometry, in output px (screen x right, y up), world origin at (0, 0)
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9; const v = new T.Vector3();
  scene.traverse(o => { if (!o.isMesh || !o.visible) return; let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false; if (!vis) return;
    const a = o.geometry.attributes.position, keep = o.material.uniforms.uKeep.value > 0;
    for (let i = 0; i < a.count; i++){ v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      if (clips.some(c => c[0] * v.x + c[1] * v.y + c[2] * v.z + c[3] < 0)) continue;
      if (!keep && cutW.some(c => v.x > c[0] && v.x < c[2] && v.y > c[1] && v.y < c[3])) continue;
      const sx = v.dot(right) * ppm, sy = v.dot(up) * ppm, sz = v.dot(dir); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); z0 = Math.min(z0, sz); z1 = Math.max(z1, sz); } });
  const M = 3, L = Math.floor(x0) - M, R = Math.ceil(x1) + M, B = Math.floor(y0) - M, Tp = Math.ceil(y1) + M, W = R - L, H = Tp - B;
  cam.left = L / ppm; cam.right = R / ppm; cam.bottom = B / ppm; cam.top = Tp / ppm; cam.near = 100 - z1 - 1; cam.far = 100 - z0 + 1; cam.updateProjectionMatrix();
  U.uZ.value.set(cam.near, cam.far);
  const l = new T.Vector3(...(sp.light || C.PROP_LIGHT)).normalize(); U.uL.value.copy(l); const BANDS = sp.bands || C.PROP_BANDS;
  U.uBias.value = sp.bias ?? 1.0; U.uCrease.value = Math.cos((sp.crease ?? 35) * D); U.uSnap.value = sp.snap ? Math.cos(sp.snap * D) : 2;
  for (let i = 0; i < 2; i++) U.uClip.value[i].set(...(clips[i] || [0, 0, 0, 1]));
  for (let i = 0; i < ${MAXCUT}; i++) U.uCut.value[i].set(...(cutW[i] || [0, 0, -1, -1]));
  const SW = W * SS, SH = H * SS, rt = new T.WebGLRenderTarget(SW, SH, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, format: T.RGBAFormat, type: T.UnsignedByteType, depthBuffer: true });
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0);
  const pass = m => { U.uMode.value = m; renderer.clear(); renderer.render(scene, cam); return readRT(rt, SW, SH); };
  const A = pass(0), Lb = pass(1), Db = pass(2), Pb = pass(3), Qb = pass(4);
  renderer.setRenderTarget(null); rt.dispose();
  // ---- per sample: class (a part's own, the rule it meets, or the nearest prototype), value ----
  const protos = [], rules = [];
  mats.forEach((m, k) => { const e = table[m]; (Array.isArray(e) ? e : e.protos || []).forEach(h => protos.push([k, lab(...hex(h))])); if (!Array.isArray(e)) rules.push([k, e]); });
  const N = SW * SH, cls = new Int8Array(N).fill(-1), val = new Float32Array(N).fill(NaN), sumV = new Float64Array(mats.length), cntV = new Float64Array(mats.length);
  const ptone = new Int8Array(N);                                                     // a part's own tone offset (shaderMat)
  for (let s = 0; s < N; s++){
    const al = A[s * 4 + 3]; if (!al) continue;
    if (al < 255){ cls[s] = al - 1; ptone[s] = Math.round((A[s * 4] - 128) / 16); continue; }
    const q = lab(A[s * 4], A[s * 4 + 1], A[s * 4 + 2]); let best = 1e9, k = -1;
    if (rules.length){ const [hh, ss, vv] = hsv(A[s * 4], A[s * 4 + 1], A[s * 4 + 2]);
      for (const [rk, r] of rules) if ((!r.h || (r.h[0] <= r.h[1] ? hh >= r.h[0] && hh <= r.h[1] : hh >= r.h[0] || hh <= r.h[1])) && (!r.s || (ss >= r.s[0] && ss <= r.s[1])) && (!r.v || (vv >= r.v[0] && vv <= r.v[1]))){ k = rk; best = 0; break; } }
    if (k < 0) for (const [pk, p] of protos){ const d = (q[0] - p[0]) ** 2 * 0.5 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < best){ best = d; k = pk; } }
    if (k < 0) continue;
    cls[s] = k; val[s] = q[0]; sumV[k] += q[0]; cntV[k]++;
  }
  const meanV = Array.from(sumV, (s, k) => s / Math.max(1, cntV[k]));
  const toneOf = d => d > BANDS[1] ? 2 + (d - BANDS[1]) / (BANDS[0] - BANDS[1]) : d > BANDS[2] ? 1 + (d - BANDS[2]) / (BANDS[1] - BANDS[2]) : Math.max(0, 1 + (d - BANDS[2]) / 0.15);
  const MAT = mats.map(m => ({ ...C.MATERIALS[m], ...(sp.materials && sp.materials[m]) }));     // per-sprite ramp / step overrides
  const detK = mats.map(m => typeof sp.detail === 'object' && sp.detail ? (sp.detail[m] ?? sp.detail._ ?? 1) : (sp.detail ?? 1));
  // ---- per output pixel (row 0 = top): majority class, mean tone and normal, nearest depth, the surface point of its central sample ----
  const P = W * H, pc = new Int8Array(P).fill(-1), pt = new Float32Array(P), pl = new Float32Array(P), pz = new Float32Array(P).fill(2), pny = new Float32Array(P), pnz = new Float32Array(P), pnx = new Float32Array(P);
  const ploc = new Float32Array(P * 3), pins = new Int8Array(P), palb = new Array(P);
  const cover = sp.cover ?? 0.5, cnt = new Int32Array(mats.length), order = [];
  for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) order.push([i, j]);
  order.sort((a, b) => Math.hypot(a[0] - (SS - 1) / 2, a[1] - (SS - 1) / 2) - Math.hypot(b[0] - (SS - 1) / 2, b[1] - (SS - 1) / 2));
  const sAt = (x, y, i, j) => (SH - 1 - (y * SS + j)) * SW + x * SS + i;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    cnt.fill(0); let cov = 0, zmin = 2;
    for (const [i, j] of order){ const s = sAt(x, y, i, j); if (cls[s] < 0) continue; cov++; cnt[cls[s]]++;
      const z = Db[s * 4] / 255 + Db[s * 4 + 1] / 65025 + Db[s * 4 + 2] / 16581375; if (z < zmin) zmin = z; }
    if (cov < cover * SS * SS) continue;
    let k = 0; for (let c = 1; c < mats.length; c++) if (cnt[c] > cnt[k]) k = c;
    let t = 0, tl = 0, nxs = 0, ny = 0, nz = 0, n = 0, ar = 0, ag = 0, ab = 0, first = -1;
    for (const [i, j] of order){ const s = sAt(x, y, i, j); if (cls[s] !== k) continue; if (first < 0) first = s;
      const d = Lb[s * 4] / 255 * 2 - 1, nx = Lb[s * 4 + 1] / 255 * 2 - 1, nyy = Lb[s * 4 + 2] / 255 * 2 - 1;
      tl += toneOf(d) + ptone[s]; t += isNaN(val[s]) ? 0 : (val[s] - meanV[k]) / 22 * detK[k]; ar += A[s * 4]; ag += A[s * 4 + 1]; ab += A[s * 4 + 2]; nxs += nx; ny += nyy; nz += Math.sqrt(Math.max(0, 1 - nx * nx - nyy * nyy)); n++; }
    const p = y * W + x; palb[p] = [ar / n, ag / n, ab / n]; pc[p] = k; pl[p] = tl / n; pt[p] = (t + tl) / n; pz[p] = zmin * (cam.far - cam.near); pnx[p] = nxs / n; pny[p] = ny / n; pnz[p] = nz / n;
    const [lx, ly] = unpack12(Pb[first * 4], Pb[first * 4 + 1], Pb[first * 4 + 2]), [lz, li] = unpack12(Qb[first * 4], Qb[first * 4 + 1], Qb[first * 4 + 2]);
    ploc[p * 3] = lx / 256 - 8; ploc[p * 3 + 1] = ly / 256 - 8; ploc[p * 3 + 2] = lz / 256 - 8; pins[p] = Math.floor(li);
  }
  const copyPx = (p, q) => { pc[p] = pc[q]; pt[p] = pt[q]; pl[p] = pl[q]; pz[p] = pz[q]; pnx[p] = pnx[q]; pny[p] = pny[q]; pnz[p] = pnz[q]; palb[p] = palb[q]; pins[p] = pins[q]; ploc.copyWithin(p * 3, q * 3, q * 3 + 3); };
  const N4 = (p, x, y) => [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1].filter(q => q >= 0);
  // ---- straight (tolerance px): the silhouette straightened; a pixel it adds copies a neighbour, one it drops goes unless the
  // new silhouette has nothing at all round it (a 1 - 2 px rod the simplification would lose) ----
  if (sp.straight){
    const m = new Uint8Array(SW * SH); for (let Y = 0; Y < SH; Y++) for (let X = 0; X < SW; X++) if (cls[(SH - 1 - Y) * SW + X] >= 0) m[Y * SW + X] = 1;
    const loops = traceLoops(m, SW, SH).map(lp => simplifyLoop(lp, sp.straight * SS).map(q => [q[0] / SS, q[1] / SS]));
    const inn = fillLoops(loops, W, H), was = pc.slice(), set = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const p = y * W + x, nb = N4(p, x, y);
      if (inn[p] && was[p] < 0){ const q = nb.find(q => was[q] >= 0) ?? [p - W - 1, p - W + 1, p + W - 1, p + W + 1].find(q => q >= 0 && q < P && was[q] >= 0); if (q !== undefined) set.push([p, q]); }
      else if (!inn[p] && was[p] >= 0 && [...nb, p - W - 1, p - W + 1, p + W - 1, p + W + 1].some(q => q >= 0 && q < P && inn[q])) set.push([p, -1]); }
    for (const [p, q] of set) if (q < 0) pc[p] = -1; else copyPx(p, q);
  }
  // ---- smooth (passes): a pixel sticking out of an edge (3 of its 4 neighbours empty) goes, a notch in an edge (3 of 4 filled)
  // takes the pixel beside / above it ----
  for (let pass = 0; pass < (sp.smooth || 0); pass++){
    const set = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x, f = [p - 1, p + 1, p - W, p + W].filter(q => pc[q] >= 0);
      if (pc[p] >= 0 && f.length <= 1) set.push([p, -1]);
      else if (pc[p] < 0 && f.length >= 3) set.push([p, f[0]]); }
    for (const [p, q] of set) if (q < 0) pc[p] = -1; else copyPx(p, q);
  }
  // ---- posterise: tone step 0..3, the hero's top-edge rim (+1) where a lit surface faces up at the silhouette ----
  const step = new Int8Array(P);
  for (let p = 0; p < P; p++){ if (pc[p] < 0) continue; let t = Math.max(0, Math.min(3, Math.floor(pt[p])));
    if (pny[p] > 0.35 && pnz[p] < 0.55 && t >= 2) t = 4;
    step[p] = t; }
  // ---- despeckle: a lone pixel takes the (class, step) that 3 of its 4 neighbours share ----
  const key = p => pc[p] * 8 + step[p];
  for (let pass = 0; pass < 2; pass++){
    const nk = new Int16Array(P).fill(-1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x; if (pc[p] < 0) continue;
      const nb = [p - 1, p + 1, p - W, p + W]; if (nb.some(q => pc[q] < 0)) continue; const kk = nb.map(key), me = key(p);
      if (kk.includes(me)) continue;
      for (const c of kk) if (kk.filter(v => v === c).length >= 3){ nk[p] = c; break; } }
    for (let p = 0; p < P; p++) if (nk[p] >= 0){ pc[p] = nk[p] >> 3; step[p] = nk[p] & 7; }
  }
  // ---- cluster clean-up (sp.clean): a pixel whose 8 neighbours mostly (>= 6) share another tone of its material takes it ----
  if (sp.clean) for (let pass = 0; pass < 2; pass++){
    const nk = new Int16Array(P).fill(-1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x; if (pc[p] < 0) continue; const cnt8 = {};
      for (const q of [p - W - 1, p - W, p - W + 1, p - 1, p + 1, p + W - 1, p + W, p + W + 1]) if (pc[q] === pc[p] && step[q] !== step[p]) cnt8[step[q]] = (cnt8[step[q]] || 0) + 1;
      for (const [st, c] of Object.entries(cnt8)) if (c >= 6) nk[p] = +st; }
    for (let p = 0; p < P; p++) if (nk[p] >= 0) step[p] = nk[p];
  }
  // ---- islands (sp.island = [n, m]): a patch of one material smaller than m px, then a patch of one (material, tone) smaller than
  // n px, takes what borders it most - the texture's specks and blotches and the mesh's stray facets go, the deliberate shapes
  // (planes, long 1 px edges) stay ----
  const islands = (keyOf, n, apply) => {
    const seen = new Uint8Array(P), stack = [];
    for (let p0 = 0; p0 < P; p0++){ if (pc[p0] < 0 || seen[p0]) continue;
      const k0 = keyOf(p0), comp = [], border = new Map(); seen[p0] = 1; stack.push(p0);
      while (stack.length){ const p = stack.pop(), x = p % W; comp.push(p);
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]){ if (q < 0 || q >= P || pc[q] < 0) continue;
          const kq = keyOf(q); if (kq === k0){ if (!seen[q]){ seen[q] = 1; stack.push(q); } } else border.set(q, kq); } }
      if (comp.length >= n || !border.size) continue;
      const votes = new Map(); for (const kq of border.values()) votes.set(kq, (votes.get(kq) || 0) + 1);
      let bq = -1, bn = 0; for (const [q, kq] of border) if (votes.get(kq) > bn){ bn = votes.get(kq); bq = q; }
      for (const p of comp) apply(p, bq);
    }
  };
  if (sp.island){
    islands(p => pc[p], sp.island[1], (p, q) => { pc[p] = pc[q]; });
    islands(key, sp.island[0], (p, q) => { pc[p] = pc[q]; step[p] = step[q]; });
  }
  // depth order: q lies clearly in front of p (a jump over inner px, beyond what a surface tilted away gains per px anyway)
  const innerDz = (sp.inner || 3) / ppm;
  const nearer = (p, q, dx, dy) => pc[q] >= 0 && pz[q] < pz[p] - innerDz - Math.min(12, Math.abs(dx * pnx[p] + dy * pny[p]) / Math.max(0.08, pnz[p])) / ppm;
  // ---- edges: a member's edge pixel (one of its 4 neighbours is the sky, a surface behind it or another material) and the way it
  // faces, the outward normal (enx, eny) of what breaks round it within 2 px - smooth along a raking edge, so every pixel of one
  // straight edge, at every step of its staircase, faces the same way (a pixel's own 4 neighbours alone would alternate up / right
  // at each step and bead the edge) ----
  const brk = (p, q, dx, dy) => q < 0 || pc[q] < 0 || pc[q] !== pc[p] || nearer(q, p, -dx, -dy);
  const edge = new Uint8Array(P), enx = new Float32Array(P), eny = new Float32Array(P);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const p = y * W + x; if (pc[p] < 0) continue;
    if (!(brk(p, y > 0 ? p - W : -1, 0, -1) || brk(p, y < H - 1 ? p + W : -1, 0, 1) || brk(p, x > 0 ? p - 1 : -1, -1, 0) || brk(p, x < W - 1 ? p + 1 : -1, 1, 0))) continue;
    let sx = 0, sy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++){ if (!dx && !dy) continue; const X = x + dx, Y = y + dy;
      if (brk(p, X < 0 || Y < 0 || X >= W || Y >= H ? -1 : Y * W + X, dx, dy)){ const w = 1 / (dx * dx + dy * dy); sx += dx * w; sy += dy * w; } }
    const l = Math.hypot(sx, sy); edge[p] = 1; if (l > 0.25){ enx[p] = sx / l; eny[p] = sy / l; } }
  // ---- bevel [lit, shade]: an edge facing the light (upper left) a lit pixel, one facing away a shadow pixel; an edge square to
  // the light (a 45-degree diagonal, a top-right corner) lit if it faces up; a 1 px member (no clear way it faces) keeps its tone ----
  if (sp.bevel) for (let p = 0; p < P; p++){ if (!edge[p] || (!enx[p] && !eny[p])) continue;
    const s = -(enx[p] + eny[p]) * Math.SQRT1_2, lit = Math.abs(s) > 0.15 ? s > 0 : eny[p] < 0;
    step[p] = Math.max(0, Math.min(4, step[p] + sp.bevel[lit ? 0 : 1])); }
  // ---- recess [z, tone]: what lies deeper than the own frame's z (the inner members, behind the front plane) a tone down; cast (px):
  // a pixel with a clearly nearer surface up to that many px up-left of it (toward the light) lies in its shadow, a tone down ----
  if (sp.recess) for (let p = 0; p < P; p++) if (pc[p] >= 0 && ploc[p * 3 + 2] < sp.recess[0]) step[p] = Math.max(0, Math.min(4, step[p] + sp.recess[1]));
  if (sp.cast){ const sh = new Uint8Array(P);
    for (let y = 1; y < H; y++) for (let x = 1; x < W; x++){ const p = y * W + x; if (pc[p] < 0) continue;
      for (let k = 1; k <= sp.cast && k <= x && k <= y; k++) if (nearer(p, p - k * (W + 1), -k, -k)){ sh[p] = 1; break; } }
    for (let p = 0; p < P; p++) if (sh[p]) step[p] = Math.max(0, step[p] - 1); }
  // ---- features, placed by the surface point (ploc: the instance's own frame) ----
  const AXI = { x: 0, y: 1, z: 2 }, axisOf = (n, ax) => { const a = new T.Vector3(...[0, 1, 2].map(i => i === AXI[ax] ? 1 : 0)).transformDirection(objs[n].matrixWorld); return [a.dot(right), a.dot(up), a.dot(dir)]; };
  const feats = sp.features || [], inMats = (f, p) => pc[p] >= 0 && (!f.mats || f.mats.includes(mats[pc[p]]));
  const ndot = (p, a) => Math.abs(pnx[p] * a[0] + pny[p] * a[1] + pnz[p] * a[2]);       // 1: the surface faces along the axis (an end disc)
  const axes = f => objs.map((o, n) => axisOf(n, f.axis)), loc = (p, k) => ploc[p * 3 + k];
  const proj = q => { const w = world(q); return [w.dot(right) * ppm - L, Tp - w.dot(up) * ppm]; };     // own-frame point -> pixel-corner coordinates
  // bands: the tone offset inside a0..a1; soft (px): past each end it thins out over that many rows, an ordered (style.js BAYER)
  // dither keyed to the sprite's pixels - at the d-th row out (soft + 1 - d) / (soft + 1) of the pixels keep it. paint: the band
  // is painted that material (a stripe round a drum: its tone the light's alone, the texture's blotches under it gone) but where a
  // chip [x, y, z, r] (an own-frame point and its radius, m) let the paint flake off
  const post = t => Math.max(0, Math.min(3, Math.floor(t)));
  for (const f of feats.filter(f => f.band)){ const k = AXI[f.axis], ax = axes(f), soft = f.soft || 0, pk = f.paint ? mats.indexOf(f.paint) : -1;
    for (let p = 0; p < P; p++){ if (!inMats(f, p) || ndot(p, ax[pins[p]]) >= 0.6) continue;
      const a = loc(p, k), d = Math.ceil(Math.max(f.band[0] - a, a - f.band[1], 0) * ppm - 1e-6);       // rows out of the band (0: in it)
      if (d > soft || (d > 0 && LS.BAYER[(Math.floor(p / W) & 3) * 4 + (p % W & 3)] >= 16 * (soft + 1 - d) / (soft + 1))) continue;
      if (pk >= 0){ if ((f.chips || []).some(([x, y, z, r]) => Math.hypot(loc(p, 0) - x, loc(p, 1) - y, loc(p, 2) - z) < r)) continue;
        step[p] += post(pl[p]) - post(pt[p]); pc[p] = pk; }
      step[p] = Math.max(0, Math.min(4, step[p] + (f.tone || 0))); } }
  // end discs: the lid one flat tone (the median of what the light gave it), its rim (the chime, and the body's last px under it) a
  // step up, the bungs a step down with a lit pixel on their upper left
  const flat = new Uint8Array(P);                                                       // end-disc pixels: no depth lines across a lid
  for (const f of feats.filter(f => f.end)){ const k = AXI[f.axis], ax = axes(f), [ku, kv] = [0, 1, 2].filter(i => i !== k);
    f.end.forEach((e, ei) => { for (let n = 0; n < objs.length; n++){
      const disc = []; for (let p = 0; p < P; p++) if (pins[p] === n && inMats(f, p) && Math.abs(loc(p, k) - e) < 0.035 && (ndot(p, ax[n]) > 0.6 || Math.hypot(loc(p, ku), loc(p, kv)) > f.r - f.rim)) disc.push(p);
      if (!disc.length) continue;
      const lid = disc.filter(p => Math.hypot(loc(p, ku), loc(p, kv)) <= f.r - f.rim), onLid = new Set(lid), st = lid.map(p => step[p]).sort((a, b) => a - b), mid = st.length ? st[st.length >> 1] : 2;
      for (const p of disc){ step[p] = onLid.has(p) ? mid : Math.min(4, mid + 1); flat[p] = 1; }
      if (!ei) for (const [u, w, r] of f.bungs || []){ const bp = lid.filter(p => Math.hypot(loc(p, ku) - u, loc(p, kv) - w) < r);
        bp.forEach(p => { step[p] = Math.max(0, mid - 1); }); if (bp.length > 1) step[bp.reduce((a, p) => (p % W + (p / W | 0)) < (a % W + (a / W | 0)) ? p : a)] = Math.min(4, mid + 1); }
    } }); }
  // smooth: patches [x0, y0, x1, y1] of the first instance's own frame (x, y: a plate the generated mesh dented) - every screen row
  // of a patch takes the median tone of its pixels there (the light's bands across the plate stay, the dents' strokes go), and no
  // depth line crosses it; dents [x, y, z]: a deliberate ding instead, 3 px at the point - its upper left in shadow, a lit lower rim
  for (const f of feats.filter(f => f.smooth)) for (const [x0, y0, x1, y1] of f.smooth){ const rows = new Map();
    for (let p = 0; p < P; p++){ const x = loc(p, 0), y = loc(p, 1); if (!inMats(f, p) || pins[p] || x < x0 || x > x1 || y < y0 || y > y1) continue;
      const r = (p / W) | 0; if (!rows.has(r)) rows.set(r, []); rows.get(r).push(p); }
    for (const ps of rows.values()){ const st = ps.map(p => step[p]).sort((a, b) => a - b); for (const p of ps){ step[p] = st[st.length >> 1]; flat[p] = 1; } } }
  for (const f of feats.filter(f => f.dent)){ const [x, y] = proj(f.dent).map(Math.floor);
    for (const [dx, dy, t] of [[0, 0, -1], [1, 0, -1], [1, 1, 1]]){ const p = (y + dy) * W + x + dx; if (inMats(f, p)) step[p] = Math.max(0, Math.min(4, step[p] + t)); } }
  // hoops: where the axis coordinate crosses f.hoop between two pixels of the body (along the axis' screen direction), the upper /
  // left one a step lit (the ridge), the other a step down (its shadow)
  for (const f of feats.filter(f => f.hoop !== undefined)){ const k = AXI[f.axis], ax = axes(f), set = [];
    for (let p = 0; p < P; p++){ if (!inMats(f, p) || ndot(p, ax[pins[p]]) >= 0.6) continue;
      const a = ax[pins[p]], q = Math.abs(a[1]) >= Math.abs(a[0]) ? p + W : (p % W < W - 1 ? p + 1 : -1);
      if (q < 0 || q >= P || !inMats(f, q) || pins[q] !== pins[p] || ndot(q, a) >= 0.6) continue;
      if ((loc(p, k) - f.hoop) * (loc(q, k) - f.hoop) <= 0 && loc(p, k) !== loc(q, k)) set.push(p, q); }
    for (let i = 0; i < set.length; i += 2){ step[set[i]] = Math.min(4, step[set[i]] + 1); step[set[i + 1]] = Math.max(0, step[set[i + 1]] - 1); } }
  // wheels (wheel: its centre, r): the face one tone, the tread's edge lit on its upper left and dark on its lower right, the web's
  // ring a step down, the hub a step up with its lit corner
  for (const f of feats.filter(f => f.wheel)){ const [cx, cy] = proj(f.wheel), rp = f.r * ppm; let hub = -1;
    for (let y = Math.floor(cy - rp - 1); y <= cy + rp + 1; y++) for (let x = Math.floor(cx - rp - 1); x <= cx + rp + 1; x++){ const p = y * W + x;
      if (x < 0 || y < 0 || x >= W || y >= H || !inMats(f, p)) continue; const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), lt = d ? -(dx + dy) / (d * Math.SQRT2) : 0;
      if (d > rp + 0.5) continue;
      step[p] = d > rp - 1.5 ? (lt > 0.3 ? 3 : lt < -0.3 ? 0 : 1) : Math.abs(d - rp * 0.55) < 0.5 ? 1 : d <= 1.5 ? 3 : 2;
      if (d <= 1.5 && (hub < 0 || x + y < hub % W + (hub / W | 0))) hub = p; }
    if (hub >= 0) step[hub] = 4; }
  // ---- colours ----
  const rampOf = k => C.RAMP[MAT[k].ramp], col = new Array(P).fill(null);
  for (let p = 0; p < P; p++) if (pc[p] >= 0){ const m = MAT[pc[p]]; col[p] = rampOf(pc[p])[m.steps[step[p]]]; }
  // ---- the low sun's warm rim (style.js LIGHT): 1 px on right-facing silhouette edges of tall props, sparingly (an edge facing
  // right within ~35 degrees, raking ones whole: not its top-right corner) ----
  if (sp.rim) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x;
    if (edge[p] && enx[p] > 0.8 && (pc[p + 1] < 0 || pc[p - W] < 0 || pc[p + W] < 0) && pnx[p] > (sp.rim.nx ?? 0.3) && y < H * (sp.rim.top ?? 0.7) && step[p] >= 1) col[p] = sp.rim.col; }
  // ---- inner depth lines: a pixel next to a clearly nearer one, in the step under its material's darkest ----
  const line = new Uint8Array(P);
  if (sp.inner) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const p = y * W + x; if (pc[p] < 0 || flat[p]) continue;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]){ const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      if (nearer(p, Y * W + X, dx, dy)){ line[p] = 1; break; } } }
  const dark = k => { const r = rampOf(k); return r[0] === C.OUTLINE ? 1 : 0; };              // OUTLINE is the movers' alone
  for (let p = 0; p < P; p++) if (line[p]) col[p] = rampOf(pc[p])[Math.max(dark(pc[p]), MAT[pc[p]].steps[0] - 1)];
  // ---- finish (sp.rivets = { mats, pitch, inset, streak, grime, ribs, panels }): rivet heads along the straight edges of a plate
  // facing the camera, inset px in from its top and left edges (another material, a depth line or the outline end a plate), every
  // pitch px: a head one tone up over its shadow one tone down; under some heads of a top row a run of rust, most near the plate's
  // joints (streak: its colour, or a tone offset: the run that much darker than the plate it runs down); grime: the foot of every
  // plate a tone darker; ribs: upright stiffeners, panels: the plate between them pressed ----
  if (sp.rivets){
    const RV = sp.rivets, solid = q => q >= 0 && q < P && pc[q] >= 0 && !line[q];
    const run = (p, dx, dy, max) => { let x = p % W, y = (p / W) | 0; for (let d = 1; d <= max; d++){ x += dx; y += dy;     // px to the plate's edge
      if (x < 0 || y < 0 || x >= W || y >= H || !solid(y * W + x) || pc[y * W + x] !== pc[p]) return d; } return max + 1; };
    const tone = (p, k) => rampOf(pc[p])[MAT[pc[p]].steps[Math.max(0, Math.min(4, step[p] + k))]], heads = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x;
      if (!solid(p) || !RV.mats.includes(mats[pc[p]]) || pnz[p] < 0.8) continue;
      const i = RV.inset, top = run(p, 0, -1, i + 1) === i && run(p, 0, 1, i + 2) > i + 1, left = run(p, -1, 0, i + 1) === i && run(p, 1, 0, i + 2) > i + 1;
      const row = top && x % RV.pitch === 0 && [-2, 2].every(d => solid(p + d) && run(p + d, 0, -1, i + 1) === i);
      const col2 = left && y % RV.pitch === 0 && [-2, 2].every(d => solid(p + d * W) && run(p + d * W, -1, 0, i + 1) === i);
      if (row || col2) heads.push([p, row]); }
    // raking edges (a strut, a gusset's free edge) facing the light: each straight run of edge pixels facing one way (8-connected,
    // within ~20 degrees) at least two pitches long gets a head every pitch px along it, inset px in from the plate's edge along
    // its normal (edge, enx / eny above)
    const runOf = new Uint8Array(P), lit = p => -(enx[p] + eny[p]) * Math.SQRT1_2 > 0.15 && Math.abs(enx[p]) < 0.94 && Math.abs(eny[p]) < 0.94;
    for (let p0 = 0; p0 < P; p0++){
      if (!edge[p0] || runOf[p0] || !solid(p0) || !RV.mats.includes(mats[pc[p0]]) || pnz[p0] < 0.8 || !lit(p0)) continue;
      const run = [p0]; runOf[p0] = 1;
      for (let i = 0; i < run.length; i++){ const q = run[i], x = q % W, y = (q / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const X = x + dx, Y = y + dy, r = Y * W + X;
          if (X < 0 || Y < 0 || X >= W || Y >= H || runOf[r] || !edge[r] || pc[r] !== pc[p0] || enx[r] * enx[p0] + eny[r] * eny[p0] < 0.94) continue;
          runOf[r] = 1; run.push(r); } }
      const nx = enx[p0], ny = eny[p0], u = q => (q % W) * -ny + ((q / W) | 0) * nx, us = run.map(u), u0 = Math.min(...us), u1 = Math.max(...us);
      if (u1 - u0 < 2 * RV.pitch) continue;
      for (let t = u0 + (u1 - u0) % RV.pitch / 2 + RV.pitch / 2; t < u1 - RV.pitch / 4; t += RV.pitch){
        const e = run.reduce((a, q) => Math.abs(u(q) - t) < Math.abs(u(a) - t) ? q : a), ex = e % W, ey = (e / W) | 0;
        const X = Math.round(ex - nx * (RV.inset - 1)), Y = Math.round(ey - ny * (RV.inset - 1)), q = Y * W + X;
        const deep = Math.round(X - nx * 2) + Math.round(Y - ny * 2) * W;                          // the plate goes on past it
        if (solid(q) && !edge[q] && pc[q] === pc[e] && solid(deep) && pc[deep] === pc[e]) heads.push([q, true]); } }
    // grime (RV.grime px): the lowest rows of every plate a tone down, under a ragged edge (2 px up or down, keyed to the column)
    if (RV.grime) for (let x = 0; x < W; x++) for (let y = H - 2; y > 0; y--){ const p = y * W + x;
      if (!solid(p) || !RV.mats.includes(mats[pc[p]]) || solid(p + W) && pc[p + W] === pc[p] && !line[p + W]) continue;      // a plate's foot
      const n = RV.grime + Math.floor(LS.hash(x >> 1, 91) * 3) - 1;
      for (let k = 0, q = p; k < n && solid(q) && pc[q] === pc[p]; k++, q -= W) col[q] = tone(q, -1); }
    // ribs (RV.ribs px apart): upright stiffeners across a plate - a lit column and its shadow beside it, from under the top
    // rivet row down to the plate's foot, none within 4 px of the plate's sides; panels: the plate between two ribs is pressed
    // (it bulges a little under the load), so past the rib's shadow its left column catches the light too
    if (RV.ribs) for (let y = 1; y < H - 1; y++) for (let x = 2; x < W - 2; x++){ const p = y * W + x;
      if (x % RV.ribs || !solid(p) || !RV.mats.includes(mats[pc[p]]) || pnz[p] < 0.8 || run(p, 0, -1, RV.inset + 2) <= RV.inset + 1) continue;
      if (run(p, -1, 0, 5) <= 4 || run(p, 1, 0, 6) <= 5) continue;
      col[p] = tone(p, 1); col[p + 1] = tone(p + 1, -1);
      if (RV.panels && solid(p + 2) && pc[p + 2] === pc[p]) col[p + 2] = tone(p + 2, 1); }
    // the rust runs: water stands and the rust bleeds where a plate meets another member (a strap, a joint, its end), so a head
    // within two pitches of its row's end runs more often and longer; along the open plate the runs come in loose clusters (value
    // noise along the row: neighbours share their fate, long clean stretches between), and a third of them is only a 1 px stain
    // under the head - no even ticks along a long beam
    for (const [p, row] of heads){ const lit = tone(p, 1), sh = tone(p, -1), x = p % W, y = (p / W) | 0; col[p] = lit; if (solid(p + W)) col[p + W] = sh;
      if (!row || !RV.streak) continue;
      const joint = Math.min(run(p, -1, 0, 2 * RV.pitch), run(p, 1, 0, 2 * RV.pitch)) <= 2 * RV.pitch;
      if (LS.hash(x, y) >= (joint ? 0.6 : 0.5 * LS.noise(x / (3.5 * RV.pitch), y / RV.pitch, 5))) continue;
      const h = LS.hash(p, 7), n = h < 0.33 ? 1 : 2 + Math.floor((h - 0.33) / 0.67 * (joint ? 5 : 3));
      for (let k = 2; k < 2 + n && solid(p + k * W) && pc[p + k * W] === pc[p]; k++) col[p + k * W] = typeof RV.streak === 'number' ? tone(p + k * W, RV.streak) : RV.streak; }
  }
  // ---- stencils: the style.js pixel font centred on the projected point, on the named materials only, every glyph whole ----
  for (const f of feats.filter(f => f.stencil)){ const [sx, sy] = proj(f.at), tw = LS.tw(null, f.stencil), c = document.createElement('canvas');
    c.width = tw + 2; c.height = 12; const cg = c.getContext('2d'); LS.txt(cg, f.stencil, 1, 2, '#ffffff');
    const d = cg.getImageData(0, 0, c.width, c.height).data, ox = Math.round(sx - tw / 2) - 1, oy = Math.round(sy) - 5;
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++){ if (!d[(j * c.width + i) * 4 + 3]) continue; const X = ox + i, Y = oy + j, p = Y * W + X;
      if (X < 0 || Y < 0 || X >= W || Y >= H || !inMats(f, p) || line[p]) continue; col[p] = f.col; } }
  // ---- outline: transparent pixels that touch the sprite ----
  const oc = sp.outline === 'OUTLINE' ? C.OUTLINE : sp.outline;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const p = y * W + x; if (pc[p] >= 0) continue; let src = -1;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]){ const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; if (pc[Y * W + X] >= 0){ src = Y * W + X; break; } }
    if (src < 0 || !sp.outline) continue;
    col[p] = oc === 'sel' ? rampOf(pc[src])[dark(pc[src])] : oc; }
  // ---- seal: a 1 px see-through slit inside the sprite (a transparent pixel painted on both sides across or up and down: two
  // members' outlines a pixel apart, the gear housing under the beam, a guide beside the column) takes the outline tone of its
  // neighbour (every pixel next to a member is outline by now); otherwise whatever stands behind would show through it as a
  // hairline. Again until none is left: a sealed pixel can close the next one of a stepped slit ----
  if (sp.outline){ let seal;
    do { seal = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++){ const p = y * W + x; if (col[p]) continue;
        const q = col[p - 1] && col[p + 1] ? p - 1 : col[p - W] && col[p + W] ? p - W : -1; if (q >= 0) seal.push([p, q]); }
      for (const [p, q] of seal) col[p] = col[q];
    } while (seal.length); }
  // ---- crop to the coloured pixels (+ outline) and anchors ----
  let cx0 = W, cx1 = -1, cy0 = H, cy1 = -1, low = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const p = y * W + x; if (!col[p]) continue; cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); if (pc[p] >= 0) low = Math.max(low, y); }
  const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1, rgba = new Uint8ClampedArray(w * h * 4), clsImg = new Uint8ClampedArray(w * h * 4), albImg = new Uint8ClampedArray(w * h * 4);
  const dbg = { rust: '#e05030', steel: '#70a0b0', iron: '#404048', stone: '#c0c0c0', paint: '#f0d040', red: '#b02040', coal: '#202020' };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const p = (y + cy0) * W + x + cx0, o = (y * w + x) * 4; if (!col[p]) continue;
    const c = hex(col[p]); rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    const d = pc[p] >= 0 ? hex(dbg[mats[pc[p]]] || '#ff00ff') : [0, 0, 0]; clsImg[o] = d[0]; clsImg[o + 1] = d[1]; clsImg[o + 2] = d[2]; clsImg[o + 3] = 255;
    if (palb[p]){ albImg[o] = palb[p][0]; albImg[o + 1] = palb[p][1]; albImg[o + 2] = palb[p][2]; albImg[o + 3] = 255; } }
  const pr = q => { const [a, b] = proj(q); return [a - cx0, b - cy0]; };                       // own-frame point -> sprite px
  const meta = { w, h, scale: sp.scale || 1, size: sp.size || 1, pxPerM: ppm, model: sp.instances ? sp.instances.map(i => i.model).join('+') : sp.model,
    view: { yaw: sp.yaw || 0, pitch: sp.pitch || 0, mirror: !!sp.mirror }, size_m: [+(w / ppm).toFixed(2), +(h / ppm).toFixed(2)], outline: oc || 'none' };
  // anchor: the recipe's point, else the middle of the visible geometry; ay = the ground row
  meta.ax = Math.round(sp.anchor ? pr(sp.anchor)[0] : (x0 + x1) / 2 - L - cx0); meta.ay = low - cy0 + 1;
  // top: px from the ground row up to the highest painted row (its sheaves' rims and outline included)
  meta.top = meta.ay;
  if (sp.sheaves){ meta.sheaves = sp.sheaves.map(s => { const c = pr(s.at).map(Math.round); return { x: c[0], y: c[1], r: C.wheelR[s.sprite], sprite: s.sprite }; }).sort((a, b) => a.x - b.x);
    for (const s of meta.sheaves) meta.top = Math.max(meta.top, meta.ay - s.y + s.r + 1); }
  // feet: the runs [x0, x1) of the lowest coloured row (where a frame meets the ground: the headframe's legs either side of the shaft)
  if (sp.feet){ meta.feet = []; const y = low; for (let x = cx0; x <= cx1; x++) if (pc[y * W + x] >= 0 && (x === cx0 || pc[y * W + x - 1] < 0)){ let e = x; while (e <= cx1 && pc[y * W + e] >= 0) e++; meta.feet.push([x - cx0, e - cx0]); } }
  if (sp.deck){ const a = pr(sp.deck[0]), b2 = pr(sp.deck[1]); meta.deck = { y: Math.round(a[1]), x0: Math.round(a[0]), x1: Math.round(b2[0]) }; }
  // lamp: the recipe's point (the top of a member), as the pixel 2 px over it: where a warning lamp sits
  if (sp.lamp){ const q = pr(sp.lamp).map(Math.round); meta.lamp = [q[0], q[1] - 2]; }
  if (sp.layer) meta.layer = sp.layer;
  return { name: sp.name, w, h, rgba, clsImg, albImg, meta };
}

// A sheave wheel (Seilscheibe) of radius r px turned to ang (radians; screen y down), painted in 2D (cols: outline, groove, dark,
// mid, lit, hi): its rim's outer lip lit on the upper left and in shadow on the lower right, the rope groove a dark ring inside it,
// the inner lip (r >= 30: and the rim's inner face) under that; 8 spokes, each a lit line (its top / left face) beside a shadow line
// (2 px; under r 30 one mid line); the hub lit on its upper left, a bolt head at each spoke's root, the boss; the outline round
// the rim only (the sky shows between the spokes). Anchor: the axle, (r + 2, r + 2).
function paintSheave(r, ang, cols){
  const N = 2 * r + 5, c = r + 2, out = new Array(N * N).fill(null), big = r >= 30;
  const set = (x, y, h) => { if (x >= 0 && y >= 0 && x < N && y < N) out[y * N + x] = h; };
  const lit = (dx, dy, d) => d ? -(dx + dy) / (d * Math.SQRT2) : 0;          // the outward normal toward the upper-left light
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){ const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), f = lit(dx, dy, d);
    if (d > r + 0.5 && d <= r + 1.5) set(x, y, cols.outline);
    else if (d > r - 0.5 && d <= r + 0.5) set(x, y, f > 0.35 ? cols.lit : f < -0.35 ? cols.dark : cols.mid);
    else if (d > r - 1.5 && d <= r - 0.5) set(x, y, cols.groove);
    else if (d > r - 2.5 && d <= r - 1.5) set(x, y, f > 0.35 ? cols.mid : cols.dark);
    else if (big && d > r - 3.5 && d <= r - 2.5) set(x, y, f < -0.35 ? cols.mid : cols.dark); }
  const rh = Math.max(2, Math.round(r * 0.14)), rr = r - (big ? 3 : 2);
  const bres = (xa, ya, xb, yb, h) => { xa = Math.round(xa); ya = Math.round(ya); xb = Math.round(xb); yb = Math.round(yb);
    const ddx = Math.abs(xb - xa), sx = xa < xb ? 1 : -1, ddy = -Math.abs(yb - ya), sy = ya < yb ? 1 : -1; let e = ddx + ddy;
    for (;;){ set(xa, ya, h); if (xa === xb && ya === yb) break; const e2 = 2 * e; if (e2 >= ddy){ e += ddy; xa += sx; } if (e2 <= ddx){ e += ddx; ya += sy; } } };
  for (let k = 0; k < 8; k++){ const a = ang + k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), xa = c + ca * (rh + 1), ya = c + sa * (rh + 1), xb = c + ca * rr, yb = c + sa * rr;
    if (!big){ bres(xa, ya, xb, yb, cols.mid); continue; }
    const flat = Math.abs(ca) >= Math.abs(sa), ox = flat ? 0 : 1, oy = flat ? 1 : 0;              // the second line below / right of the first
    bres(xa + ox, ya + oy, xb + ox, yb + oy, cols.dark); bres(xa, ya, xb, yb, cols.lit); }
  for (let y = c - rh - 1; y <= c + rh + 1; y++) for (let x = c - rh - 1; x <= c + rh + 1; x++){ const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), f = lit(dx, dy, d);
    if (d <= rh + 0.5) set(x, y, d > rh - 0.5 ? (f > 0.3 ? cols.lit : f < -0.3 ? cols.dark : cols.mid) : cols.mid); }
  if (rh >= 4) for (let k = 0; k < 8; k++){ const a = ang + k * Math.PI / 4; set(Math.round(c + Math.cos(a) * (rh - 1.5)), Math.round(c + Math.sin(a) * (rh - 1.5)), cols.hi); }
  set(c, c, cols.dark); set(c - 1, c - 1, cols.hi); set(c, c - 1, cols.dark); set(c - 1, c, cols.dark);
  const rgba = new Uint8ClampedArray(N * N * 4); out.forEach((h, i) => { if (!h) return; const v = hex(h); rgba.set([v[0], v[1], v[2], 255], i * 4); });
  return { w: N, h: N, rgba, clsImg: rgba, albImg: rgba, meta: { ax: c, ay: c } };
}

function canvasOf(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }
function putRGBA(g, r, x, y, img){ g.putImageData(new ImageData(img, r.w, r.h), x, y); }

window.MS_renderAll = async C => {
  const out = [];
  for (const sp of C.sprites){
    if (sp.wheel){                                    // a turning wheel: one frame per step, counter-clockwise on screen
      const fr = []; for (let i = 0; i < sp.frames; i++) fr.push(paintSheave(sp.wheel.r, -i * sp.step, sp.wheel.cols));
      out.push({ name: sp.name, frames: fr, w: fr[0].w, h: fr[0].h, meta: { r: sp.wheel.r, step: sp.step, layer: sp.layer } });
    } else out.push(await renderSprite(sp, C));
  }
  // atlas: shelf packing, tallest first, 1 px gap
  const items = []; for (const r of out){ if (r.frames) r.frames.forEach((f, i) => items.push({ r, f, i })); else items.push({ r, f: r }); }
  items.sort((a, b) => b.f.h - a.f.h);
  const AW = Math.max(512, ...items.map(it => it.f.w + 2)); let x = 0, y = 0, rowH = 0;
  for (const it of items){ if (x + it.f.w + 1 > AW){ x = 0; y += rowH + 1; rowH = 0; } it.x = x; it.y = y; x += it.f.w + 1; rowH = Math.max(rowH, it.f.h); }
  const AH = y + rowH; const [ac, ag] = canvasOf(AW, AH);
  const meta = {};
  for (const it of items){ putRGBA(ag, it.f, it.x, it.y, it.f.rgba);
    const m = meta[it.r.name] = meta[it.r.name] || Object.assign({}, it.r.meta);
    if (it.r.frames) (m.frames = m.frames || [])[it.i] = { x: it.x, y: it.y, w: it.f.w, h: it.f.h, ax: it.f.meta.ax, ay: it.f.meta.ay };
    else Object.assign(m, { x: it.x, y: it.y, w: it.f.w, h: it.f.h }); }
  for (const r of out){ const m = meta[r.name]; meta[r.name] = r.frames ? m : Object.assign({ x: m.x, y: m.y, w: m.w, h: m.h }, m); }
  const res = { atlas: ac.toDataURL('image/png'), meta, previews: {} };
  if (C.preview){
    // review sheets: every sprite on a mid backdrop (the street value) over its ground line (at ay)
    const pad = 10, cells = out.map(r => r.frames ? r.frames[0] : r);
    const SW = cells.reduce((s, c) => s + c.w + pad * 2, 0), SH = Math.max(...cells.map(c => c.h)) + pad * 2;
    for (const [nm, sc, key] of [['sheet_x1', 1, 'rgba'], ['sheet_x4', 4, 'rgba'], ['classes_x4', 4, 'clsImg'], ['albedo_x4', 4, 'albImg']]){
      const [c, g] = canvasOf(SW * sc, SH * sc); g.fillStyle = '#6e5048'; g.fillRect(0, 0, c.width, c.height);
      let X = 0;
      cells.forEach(cel => { const [tc, tg] = canvasOf(cel.w, cel.h); putRGBA(tg, cel, 0, 0, cel[key]);
        const gy = pad + (SH - pad * 2 - cel.h) + cel.meta.ay;
        g.fillStyle = '#3b2a2e'; g.fillRect(X * sc, gy * sc, (cel.w + pad * 2) * sc, (SH - gy) * sc);
        g.drawImage(tc, (X + pad) * sc, (SH - pad - cel.h) * sc, cel.w * sc, cel.h * sc); X += cel.w + pad * 2; });
      res.previews[nm] = c.toDataURL('image/png');
    }
  }
  return res;
};
window.MS_READY = true;
})();
`;

if (cmd === 'import') await importModel();
else if (cmd === 'render') await render();
else if (cmd === 'check') await check();
else fail('unknown command ' + cmd + ' (render | import | check)');
