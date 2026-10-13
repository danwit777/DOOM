/* engine.js - loop, input, camera, physics, movers, the player (our hero from the sprite sheet), HUD and layer compositing.
 *
 * Loaded last; it only talks to the other files through LVL.style, LVL.map and the art modules' documented APIs.
 *
 * HERO SPRITE SHEET (hero.png + hero.json, next to the page, loaded with <img> and fetch, both relative URLs; tools/export_hero.mjs):
 *   { "px": 96, "yaw": 0.35, "anims": { "<name>": { "fps", "loop", "frames": [ { "x", "y", "w", "h", "ax", "ay", "opaque" } ] } },
 *     "left": { "yaw": 2.79, "anims": { ...the same clips... } } }
 *   x, y, w, h = frame rect in the atlas; (ax, ay) = ground anchor between the feet, px from the frame's top-left; opaque = [x0, y0,
 *   x1, y1], the box of the frame's opaque pixels (the drawn silhouette: its height, how far it reaches ahead and behind; a sheet
 *   without it: the rect). "anims" face RIGHT; "left" holds the same clips facing LEFT, rendered from the 3D model by a camera at
 *   pi - yaw (lit from the upper left like the right set, the pauldron on his left shoulder); a sheet without "left" is mirrored
 *   for left (lit from the upper right then). Clips used: idle, walk, run, jump_up, jump_apex, fall, land, climb and the tactical
 *   moves (CONTROLS below): crouch_in, crouch, crouch_out, crouchwalk, sneak, lowrun, roll, alert, alert_in, alert_out. Optional per
 *   clip: "speed" = the ground speed in px/s the clip was animated for (the moves' gaits carry it; else walk 1.4 m/s and run 4.0 m/s
 *   of the 3D model, at px per 1.85 m); climb: "dy" = how far the body rises per frame (its frames advance by the distance climbed
 *   / dy, so the gripping hands stay on their rungs) and "lx" = the hands' midpoint from ax (that point is put on the ladder's
 *   axis); roll: "tx" = per frame, how far the body has travelled along his facing since frame 0 (px, tx[0] = 0: the clip's root
 *   motion; the roll moves him by it, interpolated between frames), "travel" = its last value, "commit" = s from frame 0 until his
 *   feet are under him again (over the tumble). ay may differ from frame to frame within a clip (the moves with a boot planted in
 *   every frame, and the roll's frames on the floor, stand each frame's lowest row on the ground). Safety net only: a clip missing
 *   from the sheet shows idle's first frame (and a missing land or way in / out of a stance is skipped; a roll without its clip
 *   travels P.ROLL's numbers from its start), so a broken export still plays.
 *
 * CONTROLS. Keyboard: Left / Right (A / D) walk, held AUTORUN s or with Shift they run; Space / Z / W / Up jump (a short press, a
 * short hop); Down / S crouch (held): with Left / Right the crouch walk (P.CROUCH), with Shift too the low run (P.LOWRUN); C (held)
 * sneaks: the half-crouched walk (P.SNEAK), standing still the guard (alert); X / K roll forward from standing, walking, running,
 * the low run, a sneak or a crouch (Left / Right held at the press turn him first - unless he is moving the other way faster than
 * P.MOVE_V: a run is not reversed in one step, that roll goes the way he runs -; pressed up to BUFFER s before he is on his feet, it
 * rolls then). Touch pad: the same keys (▼ crouch, ↻ roll), BIEG and SKRAD are toggles (one at a time); a thumb sliding from ▼
 * onto ⤒ holds both (the catwalk drop), ↻ takes no part in slides, and a thumb that went down on ⤒ never picks up ▼ on its way.
 * STANCES: the crouch is gone into and out of on the spot, through its ways (crouch_in / crouch_out: the boots planted): Down
 * pressed standing, on guard, sneaking or walking no faster than P.SNEAK, or let go crouched or crouch-walking, he stays where he is
 * while the way plays (he may turn: p.spot), then moves on in the new stance - Down and a direction pressed together crouch him
 * first, then he crouch-walks; both let go, he stops and stands up. Faster than that he changes on the move, through the low run
 * (animate: its height lies between the crouch's and the upright gaits'; at least P.TWEEN s of it). No switch between the ground
 * stances changes his drawn height by more than P.POP px (the playtest plays every pair).
 * THE ROLL needs room: facing a wall (the level's ends among them) so close that its frames, reaching from the frame it would start
 * at, would stop it before it has gone P.ROLL_ROOM of its travel, the press does nothing (no dive into the wall, no backing off it,
 * no tumble on the spot: rollPlan). It starts at the frame of the clip's set-off that matches his pose (rollEntry): standing still
 * at its start (the boots planted), from a crouch at its crouched frame, on the move P.ROLL_DIP px x his speed / P.WALK under his
 * pose at least (no standing frame first; a run dives in deeper than a walk), the body where the clip has it at that frame (the
 * root motion of the frames skipped on at once: the set-off's boots, still where they stood at its start, stay where his were), and
 * it keeps his speed along his facing: the clip's clock runs up to P.ROLL_RATE x faster through the set-off until its root motion
 * catches up with him (the boots stay planted; no brake to a stand). Before its commit point it takes no input: it rolls on, stops
 * short of a wall by its frames' reach and stays there for the rest of the roll (p.rollStop: the get-up does not creep him on), off
 * a ledge it tumbles on in a fall at the speed he left with (at most the run's, no jump) and lands rolling - or, still in the air
 * at its end, falls on (the fall clip after its last, upright frame). It never moves him back against his facing (only the belt or
 * a mover carry him so), but at the level's two ends, which push the frame drawn now back off them (the camera shows nothing past
 * them). Past the commit point, on the ground: a jump ends it at once, and so does the roll key (pressed now or buffered) with the
 * new roll's room ahead (rollPlan; without it the press does nothing and the roll goes on); a held direction, Down or Up once the
 * get-up has him within P.POP px of the pose that key leads to (rollUp: never a pop from the curled get-up to an upright frame);
 * with nothing pressed it plays out, and he stays on guard (alert) P.ALERT s standing still (riding the cage out of the level
 * too: a roll he boarded it in plays out on the spot).
 * Precedence, highest first: the roll (above); on a ladder Up / Down climb and a jump leaps off; on the ground Down at a ladder's
 * top climbs down (also when crouch-walking onto it), Down + a jump on a catwalk drops through it (a fall at once; Down alone
 * crouches there too; on the belt, which is not drop-through, Down + a jump is a jump), a jump from a crouch or a sneak stands him
 * up and jumps (a normal jump at the speed he had: never further than a run jump); crouched, Shift makes the low run (the auto-run
 * does not: holding a direction while crouched or sneaking keeps the slow gait, and only upright walking counts toward AUTORUN);
 * the sneak key outranks running, Down outranks the sneak; landing with Down held he is crouched at once. Ctrl / Alt / Cmd chords
 * are left to the browser (Ctrl + W, Ctrl + C...). The hitbox is the same in every move: every surface he can stand on has 3 free
 * tiles over it (map.js HEADROOM), so a lower crouch hitbox would open no passage, and keeping it means he can always stand up
 * again (no state where a ceiling holds him crouched) and every jump, landing and camera rule stays as it is.
 *
 * FIXED STEP: the simulation runs at 60 Hz (DT); speeds are px/s, accelerations px/s2, times in seconds; the art modules'
 * animations still count frames (v.t). Lengths are the first draft's (32 px tiles, a 64 px hero) x style.js K, so the level plays
 * as it did, in tiles and seconds.
 *
 * CAMERA. The frame (VW x VH) shows 20 x 11.25 of the level's 160 x 14 tiles, so the camera follows the hero both ways; v = { cx,
 * cy } is its integer top-left. Across: the hero at CAM.x of the width (looking ahead to the right), with a lag. Up and down it
 * eases (CAM.rateY) toward a target (camTargetY) set by what he does, around a dead zone: his feet anywhere in the band CAM.band
 * of the frame's height leave it still.
 *   Standing (on the ground or a mover): after an ARRIVAL - a climb ending on a floor, a landing CAM.arrive (1.5 tiles) or more
 *   above or below the ground he left, a respawn - it settles to the surface's REST, a function of his feet alone (restY): the
 *   street view - the camera's lowest, LH - VH - wherever that shows his feet in the band, else his feet at the band's middle. So
 *   the first roof and the catwalk, the second roof and the belt each have one view however he got there (climbed, dropped, jumped
 *   onto, respawned). After a STEP or a HOP of a tile (the A steps, the crates, a hunt) it keeps the dead zone instead: a 1-tile
 *   step moves the camera a tile at most (the rests of neighbouring surfaces can lie further apart than that: the A heap's top
 *   rests at 41, the step under it in the street view, 132). A hop in place - back onto the floor he took off from - changes
 *   nothing: a settle to the rest still running (after a climb, a jump onto the belt) goes on, and so does a look-down and its
 *   hold (the hold runs down only while he stands). Facing a drop whose landing lies under the frame (roof 2's right edge, roof
 *   1's left one) within CAM.peekReach of his leading edge, it looks down until that landing shows CAM.peek px over the frame's
 *   bottom, and keeps looking CAM.peekHold s after he turns away (lining up at the edge with a few taps does not bob it).
 *   Climbing: the dead zone on a point CAM.look past his feet (the roof he climbs to comes into view first).
 *   In the air: rising it holds. Falling it looks ahead to the view he will have on the floor he lands on (its rest when that
 *   landing is an arrival, else the dead zone on it; over a pit, the level's bottom), up as well as down - a jump onto the belt
 *   pans while he comes down onto it, not all after he lands - except when a ladder at body height will catch him (ladderCatch,
 *   stepPlayer's own test: it holds) and when he comes back down onto the floor he took off from (it holds: a hop in place).
 *   E, the landmark zone (map ENT.landmark: the street at the shaft, the shaft and the cage descent): the headframe whole, its top
 *   (props.headframe(): whatever paints it, the model sprite or the procedural fallback) CAM.frameTop px under the frame's top,
 *   but the street never lower than CAM.street of the frame's height (a headframe too tall for that loses its top instead of
 *   pushing the hero to the frame's bottom edge).
 *   SPEED: a step moves it at most CAM.pan px up or down - standing, walking, riding and rising, the settling after an arrival,
 *   the look-down and the E zone's entry and exit are slow pans (he never slides on screen faster than that) - except climbing
 *   (it follows him up and down the ladder) and falling, when it moves down at most as far as he fell this step (he never rises
 *   on screen while he falls: a walk-off's look-ahead eases in with his fall) and up at most CAM.pan.
 * On top of that ease it GUARANTEES that his whole drawn frame stays in the frame - a full jump's apex from the highest roof
 * included - and his feet over its bottom edge while he is in the level (map.js CAMERA; the playtest plays it): riding the cage
 * down, that is what finally takes the camera off the landmark, down the shaft with him. Across, the camera stops at the level's
 * ends and P.END stops him short of them by the farthest his drawn silhouette reaches, so there too he stays in (a roll stops
 * itself short of them by its frames' reach: the ends are walls). A respawn snaps both axes onto the target; the parallax layers
 * scroll vertically by their factors (art/bg.js offsetY), the playfield 1:1.
 *
 * TEST HOOKS (window.LVL.debug): hud (false = render without the HUD: what the art paints, for measurements of it), manual (true =
 * the rAF loop renders but does not advance; call step(n) / tick(n); index.html?manual opens with it already true, so not one step
 * runs before the first tick: with Math.random seeded, a measurement is then a pure function of the steps taken), step(n) (n fixed
 * steps, then one render), tick(n) (n fixed steps, no render: fast bots), state() (the player - among it the moves' crouch and
 * spot, the roll's clock rollT, its first frame rollK, kept speed rollV and rollStop, alertT -, anim + the clip, frame (fi; af: the
 * clip's frame clock) and set drawn - right, left or mirror -, movers, camera: camX / camY its smooth position, cx / cy the integer
 * one drawn, camRest = it settles to his surface's rest (after an arrival) rather than the dead zone, frame = the fixed-step
 * counter, stats; screen = the hero's anchor, sprite = the rect his frame is drawn in and drawn = the box of its opaque pixels,
 * frame px), spawn(i) (respawn at checkpoint i and start play), place(x, feetY) (put the hero's hitbox there, grounded), cam(x, y)
 * (camera position, stops the tour; y left out: the camera's target for the hero where he is, as after a respawn - standing: his
 * surface's rest, or the landmark view in E), snap() (the camera onto that target, both axes, as a respawn), roll() (the roll's
 * timing: fps, n, tx, commit, dur, dive), setPlay(v), keys (the live key state), P (tuning), CAM, movers, player, headroom() (the
 * map's HEADROOM rule violations), fit() (re-run the display fit).
 * LVL.ready once built (after the model sprites' atlas: art/models.js); LVL.sheet: .ok / .err once the sheet loaded or failed,
 * then .img (the atlas), .px (sprite height), .anims (the right-facing clips), .sets ({ 1: right clips, -1: left clips or null =
 * mirrored }); LVL.scale = CSS px per canvas px, LVL.dscale = device px per canvas px (an integer when the display is crisp).
 */
(() => {
'use strict';
const LVL = window.LVL, S = LVL.style, M = LVL.map, A = LVL.art;
const { VW, VH, K, R, txt, tw, mk, PIX16, OUTLINE } = S;
const { TS, LW, LH } = M;
const DT = 1 / 60;
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- tuning (native px, seconds): the draft's lengths x K ----------
const P = {
  W: 20 * K, H: 58 * K,         // hitbox 30 x 87; the sprite is ~40-60 x 96 (hair, coat tails and swinging hands may overhang it)
  HEAD: 6 * K,                  // the sprite's hair rises this far above the hitbox: thin ceilings (belt, yoke) stop the HAIR
  WALK: 115 * K, RUN: 184 * K,  // ground speeds (run = 1.6 x walk); a walking jump from the toes still clears a 2-tile gap
  CROUCH: 27 * K, SNEAK: 36 * K, LOWRUN: 138 * K,   // the moves' ground speeds: crouch walk, sneak (~1.25 x their mocap's: brisker
                                // than the clip, as a game wants, still a stalk), low run (under the run: a jump from it is a run jump
                                // at most)
  AUTORUN: 0.6,                 // holding one direction this long turns walking into running (Shift runs at once)
  ACC: 1400 * K, DEC: 1800 * K, TURN: 2600 * K, AIR_ACC: 1100 * K, AIR_DEC: 400 * K,
  JUMP_H: 75 * K, JUMP_T: 0.30, // jump apex (2.35 tiles: clears a 2-tile step, not a 3-tile wall) and time to reach it
  CUT: 0.45,                    // letting go of jump while rising keeps this share of the upward speed (short hops)
  MAXFALL: 640 * K,
  COYOTE: 0.08,                 // a jump still works this long after walking off an edge
  BUFFER: 0.12,                 // a jump pressed this long before landing fires on landing
  CLIMB: 80 * K,                // ladder speed: the climb clip (dy ~3.7 px a frame at 96 px) at ~32 frames/s
  LADDER_LEAP: 0.72, REGRAB: 0.25,   // jump off a ladder at 0.72 x launch speed; no re-grab for 0.25 s
  BELT: 84 * K,                 // conveyor push (art/tiles.js moves its stripes at the same speed)
  DROP: 0.2,                    // Down + a jump on a catwalk drops through it: catwalks are ignored for this long
  // air clips of a jump by vertical speed, as a share of the launch speed (s = -vy / V0: 1 at take-off, 0 at the top, < 0
  // falling): jump_up while s > AIR_UP, jump_apex down to s = -AIR_FALL (the top, then tipping over), fall below it
  AIR_UP: 0.45, AIR_FALL: 0.8,
  AIR_GRACE: 0.1, STEP_DROP: 41 * K, // walking off an edge keeps the ground cycle this long, or while the drop is under 1.28 tiles
                                 // (a 1-tile step, the parked hunt's height)
  LAND_V: 380 * K,              // landing faster than this plays 'land' (its clip length), straight out of the air
  MOVE_V: 30 * K,               // ground speed over which the feet walk (under it, with no direction held: idle / land)
  END: 31,                      // the level's two ends stop the hitbox this far inside them, so his whole drawn frame stays in
                                // the frame, which can show nothing past the level: the farthest his drawn silhouette reaches from
                                // its anchor (the roll's tumble behind it, 46 px; its dive ahead stops at walls by itself: the
                                // ends are walls) less half the hitbox. Set from the sheet when it loads (endOf); 31 is the shipped
                                // sheet's
  ANIM_SYNC: 0.6,               // walk / run rate = (speed / clip speed) ^ ANIM_SYNC: 1 = feet locked to the ground, 0 = fixed fps
  MOVE_SYNC: 1,                 // ... the same for the moves' gaits: their clips' speeds are their real ones, the feet stay planted
  ALERT: 2,                     // after a roll he stays on guard (the alert stance) this long standing still, then relaxes
  TWEEN: 4 / 60,                // the low run between the crouch and an upright gait on the move (STANCES) shows this long at least
  POP: 12,                      // the most any switch between the ground stances changes his drawn height (px; STANCES), out of the
                                // roll too (rollUp)
  // the roll (CONTROLS): on the move it starts at a frame at least ROLL_DIP px x his speed / WALK lower than his pose (a walk at its
  // frame 3, leaning in; a run at 3-4, bent); its clock runs up to ROLL_RATE x faster through the set-off while he comes in faster
  // than its root motion; it needs room for at least ROLL_ROOM of the clip's travel from the frame it starts at (less, and it would
  // tumble on the spot for a second: the key does nothing)
  ROLL_DIP: 10, ROLL_RATE: 3, ROLL_ROOM: 1 / 3,
  ROLL: { fps: 18, n: 23, travel: 126, commit: 0.954 }   // a roll without its sheet clip: the shipped clip's timing, its travel
                                // on a smoothstep (rollOf)
};
P.G = 2 * P.JUMP_H / (P.JUMP_T * P.JUMP_T);      // 2500 px/s2
// Launch speed solved for the discrete 60 Hz integrator (vy += G dt, then y += vy dt), whose apex is V0^2 / 2G + V0 dt / 2:
// the continuous formula 2H / T would overshoot by ~6 px. -> ~729 px/s, apex exactly JUMP_H.
P.V0 = P.G * (Math.sqrt(DT * DT / 4 + 2 * P.JUMP_H / P.G) - DT / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);

// ---------- hero sprite sheet ----------
// sheet.sets: the clips per facing (1 = right, -1 = left; null for left = mirror the right set)
const sheet = LVL.sheet = { ok: false, err: null, img: null, anims: null, sets: null, px: S.SCALE.hero };
// A frame's drawn silhouette (its "opaque" box; a sheet without one: the frame's rect): up = its top's height over the anchor, ahead /
// behind = how far it reaches past the anchor along / against his facing (left: a frame of the left set, drawn as it is; a mirrored
// one faces right in the sheet like the right set's)
function silhouette(f, left){ const o = f.opaque || [0, 0, f.w, f.h], r = o[2] - f.ax, l = f.ax - o[0]; return { up: f.ay - o[1], ahead: left ? l : r, behind: left ? r : l }; }
// the clips drawn for a facing (a sheet without a left set: the right set's, mirrored) and whether they are the left set
const setFor = face => face < 0 && sheet.sets[-1] || sheet.anims, ownLeft = face => face < 0 && !!sheet.sets[-1];
// P.END for a sheet: the farthest any frame's silhouette reaches from its anchor, to either side (the roll's only behind him: ahead
// it stops short of walls by itself, rollLimit), in either facing, less half the hitbox (the anchor is the hitbox's centre)
const endOf = sets => Math.ceil(Math.max(P.W / 2, ...[1, -1].filter(s => sets[s]).flatMap(s => Object.entries(sets[s]).flatMap(([n, c]) =>
  (c.frames || []).map(f => { const r = silhouette(f, s < 0); return n === 'roll' ? r.behind : Math.max(r.ahead, r.behind); })))) - P.W / 2);
function loadSheet(){
  const img = new Image();
  const pImg = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('hero.png not found')); });
  img.src = 'hero.png';
  const pJson = fetch('hero.json').then(r => { if (!r.ok) throw new Error('hero.json ' + r.status); return r.json(); });
  return Promise.all([pImg, pJson]).then(([, js]) => {
    sheet.img = img; sheet.anims = js.anims || {}; sheet.px = js.px || S.SCALE.hero;
    sheet.sets = { 1: sheet.anims, [-1]: js.left && js.left.anims || null };
    P.END = endOf(sheet.sets); roll = rollOf(sheet.anims.roll); sheet.ok = true;
  }).catch(e => { sheet.err = String(e && e.message || e); console.warn('hero sheet:', sheet.err, '- drawing a placeholder hero'); });
}
const hasClip = (set, name) => !!(set && set[name] && set[name].frames && set[name].frames.length);
// The clip a state plays in a facing: { name, clip, mirror (drawn flipped: a sheet without a left set), safety (the state's own clip
// is missing: idle's first frame stands in) }.
function resolveClip(state, face){
  if (!sheet.ok) return null;
  const left = face < 0 && sheet.sets[-1], set = left || sheet.anims, mirror = face < 0 && !left;
  if (hasClip(set, state)) return { name: state, clip: set[state], mirror, safety: false };
  const any = hasClip(set, 'idle') ? 'idle' : Object.keys(set).find(n => hasClip(set, n));
  return any ? { name: any, clip: set[any], mirror, safety: true } : null;
}
const NOMINAL = { walk: 1.4, run: 4.0 };   // m/s the 3D clips stand for (a sheet without "speed"; the moves' gaits always carry it)
function clipSpeed(clip, name){ return clip.speed || (NOMINAL[name] || 1.4) * sheet.px / 1.85; }
// The roll's timing (the physics' and the animation's): fps, n frames, tx (the body's travel at each frame, px along his facing),
// commit (s), dur = n / fps (the last frame shows one frame long), dive (the frame its root motion is fastest from: the frames
// before it are the set-off a roll may start at, rollEntry). From the sheet's right-facing clip (the left one is the same
// instants); without one, P.ROLL's numbers with the travel on a smoothstep.
function rollOf(c){
  const R = P.ROLL, ok = c && c.tx && c.tx.length === c.frames.length;
  const tx = ok ? c.tx : Array.from({ length: R.n }, (_, i) => { const u = i / (R.n - 1); return R.travel * u * u * (3 - 2 * u); }), n = tx.length;
  let dive = 0; for (let i = 1; i < n - 1; i++) if (tx[i + 1] - tx[i] > tx[dive + 1] - tx[dive]) dive = i;
  return ok ? { fps: c.fps, n, tx, commit: c.commit ?? R.commit, dur: n / c.fps, dive } : { fps: R.fps, n, tx, commit: R.commit, dur: n / R.fps, dive };
}
let roll = rollOf(null);
// how far the roll has moved the body by its clock t (s; px along his facing; linear between the frames' instants, held after)
function rollTx(t){ const f = clamp(t * roll.fps, 0, roll.n - 1), i = Math.min(roll.n - 2, Math.floor(f)); return roll.tx[i] + (roll.tx[i + 1] - roll.tx[i]) * (f - i); }
// the clock at which its root motion has moved him x px (rollTx's inverse; past the travel, its last frame's instant)
function rollAt(x){ const T = roll.tx; for (let i = 0; i < roll.n - 1; i++) if (T[i + 1] >= x){ const d = T[i + 1] - T[i]; return (i + (d > 0 ? (x - T[i]) / d : 0)) / roll.fps; }
  return (roll.n - 1) / roll.fps; }
// the roll's frame drawn at its clock t, and that frame's silhouette in a facing (null without the sheet's clip)
const rollFrame = t => clamp(Math.floor(t * roll.fps), 0, roll.n - 1);
function rollSil(face, i){ const c = sheet.ok && setFor(face).roll; return c && c.frames.length === roll.n ? silhouette(c.frames[i], ownLeft(face)) : null; }
// The roll's first frame for the pose he is in (the frame drawn now), facing face: the first one of the set-off no taller than it
// less dip px (on the move he dives straight in: its standing start, the boots planted, is for a roll from standing still), else the
// set-off's last (a roll chained from the get-up's crouch); 0 without the sheet's clip or with a stand-in frame
function rollEntry(p, face, dip){
  const r = p.clip; if (!r || r.safety || !rollSil(face, 0)) return 0;
  const h = silhouette(r.clip.frames[p.fi % r.clip.frames.length]).up - dip;
  for (let k = 0; k < roll.dive; k++) if (rollSil(face, k).up <= h) return k;
  return Math.max(0, roll.dive - 1);
}
// The pose a held key leads to when the roll gives way, as the clip it shows first (frame 0): crouched the crouch or the crouch walk,
// with the sneak key the alert or the sneak, else idle or the walk (the gait's speed starts low: the walk, not the run)
const rollExitTo = dir => keys.down ? (dir ? 'crouchwalk' : 'crouch') : keys.sneak ? (dir ? 'sneak' : 'alert') : dir ? 'walk' : 'idle';
// The get-up has him up to that pose: the roll's frame drawn now within P.POP px of its height (no sheet: at once)
function rollUp(p, to){
  const s = rollSil(p.face, rollFrame(p.rollT)), c = setFor(p.face)[to];
  return !s || !hasClip(setFor(p.face), to) || s.up >= silhouette(c.frames[0]).up - P.POP;
}
// How far ahead of the anchor the roll's frame i reaches in a facing, and the farthest any from it on does (px; 0 without the clip)
function rollReach(face, i){ let a = 0; for (let k = i; k < roll.n; k++){ const s = rollSil(face, k); if (s) a = Math.max(a, s.ahead); }
  const s = rollSil(face, i); return { now: s ? s.ahead : 0, rest: a }; }
// The nearest wall ahead (facing f) in the rows his hitbox spans that a frame reaching reach px ahead of his anchor would overlap
// once he has moved on up to more px: { x: the hitbox x at which that frame just touches it, end: it is one of the level's two
// ends }, or null. Walls are solid tiles and the belt's slab (its ends are walls, like the X pass's); the scan starts past the
// columns the hitbox spans (a wall he overlaps - never in play - is not one ahead). Off his feet (off a ledge, down a step) the rows
// run on down to the floor he will land on (landFeet: floorBelow, or a mover's top under him): a wall's side down there - a step up
// from the street he drops into - stops the roll while its frames are still clear of it, not once he has fallen past its top and
// they already reach into it.
const wallAt = (c, r) => M.isSolid(c, r) || M.tile(c, r) === 'T';
function landFeet(p){ const feet = p.y + P.H; let y = floorBelow(p, feet);
  for (const m of movers) if (p.x + P.W > m.x && p.x < m.x + m.w && m.y >= feet - 0.01) y = Math.min(y, m.y); return y; }
function rollLimit(p, f, reach, more = 0){
  const a = reach - P.W / 2, r0 = Math.floor(p.y / TS), front = f > 0 ? p.x + P.W : p.x;
  const r1 = Math.floor(((p.ground ? p.y + P.H : Math.max(p.y + P.H, landFeet(p))) - 0.001) / TS);
  if (a + more <= 0) return null;
  for (let c = Math.floor((front - f * 0.001) / TS) + f, end = Math.floor((front + f * (a + more)) / TS); f > 0 ? c <= end : c >= end; c += f)
    for (let r = r0; r <= r1; r++) if (wallAt(c, r)) return { x: f > 0 ? c * TS - a - P.W : (c + 1) * TS + a, end: c < 0 || c >= M.MW };
  return null;
}

// ---------- movers ----------
const movers = M.ENT.movers.map(m => Object.assign({}, m, { dir: 1, waitT: m.wait || 0, dx: 0, dy: 0 }));
const cage = movers.find(m => m.kind === 'cage');
function updMovers(dt){
  for (const m of movers){
    m.dx = m.dy = 0; if (!m.speed) continue; if (m.waitT > 0){ m.waitT -= dt; continue; }
    const k = m.axis, old = m[k]; m[k] += m.dir * m.speed * dt;
    if (m[k] >= m.max){ m[k] = m.max; m.dir = -1; m.waitT = m.pause; } else if (m[k] <= m.min){ m[k] = m.min; m.dir = 1; m.waitT = m.pause; }
    if (k === 'x') m.dx = m[k] - old; else m.dy = m[k] - old;
  }
}

// ---------- input ----------
const keys = { left: false, right: false, up: false, down: false, jump: false, run: false, sneak: false, roll: false };
const edge = { jump: false, up: false, roll: false, cut: false };     // presses / releases since the last fixed step
// (CONTROLS in the header; C and X / K sit next to Z, the other jump key)
const KM = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', ShiftLeft: 'run', ShiftRight: 'run', KeyC: 'sneak', KeyX: 'roll', KeyK: 'roll' };
const stage = document.getElementById('stage'), root = document.documentElement;
function press(k){ if (!keys[k]){ if (k in edge) edge[k] = true; } keys[k] = true; }
function release(k){ if (keys[k] && (k === 'jump' || k === 'up')) edge.cut = true; keys[k] = false; }
function releaseAll(){
  for (const k in keys) keys[k] = false; toggleBtns.forEach(b => b.setAttribute('aria-pressed', 'false')); fingers.clear(); for (const k in keyFingers) keyFingers[k] = 0; }
// The keyboard belongs to the game only while the stage is on screen (at least 30 % of what fits in the window): then the arrows /
// Space are captured and the first key starts play; scrolled down to the design sheet, they scroll the page as usual.
function stageInView(){ const r = stage.getBoundingClientRect(), vis = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); return vis >= 0.3 * Math.min(r.height, innerHeight); }
// Fields that type text keep their keys. Space also activates whatever control has the focus, so the game takes it only while the
// canvas (or nothing) has it: a layer checkbox or button reached with Tab toggles on Space as usual (Z / W / Up still jump, the
// arrows still move), while a pointer click on one hands the focus straight back to the canvas when playing (refocus below).
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]), textarea, select, [contenteditable]:not([contenteditable=false])';
const gameFocus = a => !a || a === cv || a === document.body || a === root;
addEventListener('keydown', e => {
  const k = KM[e.code]; if (!k || e.ctrlKey || e.metaKey || e.altKey) return;      // (a chord is the browser's: Ctrl + W, Ctrl + C...)
  const a = document.activeElement; if (a && a.matches && a.matches(TYPING)) return;
  if (e.code === 'Space' && !gameFocus(a)) return;
  if (!stageInView()){ releaseAll(); return; }
  e.preventDefault(); if (!playing && k !== 'run') setPlay(true); press(k);
});
addEventListener('keyup', e => { const k = KM[e.code]; if (k) release(k); });
addEventListener('blur', releaseAll);
// Touch pad: a finger holds the key of the button it went down on (its pointer is captured by that button, so scrolling or sliding
// off does not drop it) and a thumb may SLIDE to another hold button of the same group without lifting (◀ to ▶, ▲ to ⤒): the key
// follows the button under the finger - but a finger that went down on ▼ and slides onto ⤒ holds Down too (Down + a jump: the
// catwalk drop with one thumb; ▼ sits next to ⤒ in both layouts). Keys are counted per finger, so two fingers on one key release
// it only when both lift. The run and sneak buttons (TOGGLES) are toggles instead, since a third finger is too much to ask; one at
// a time (switching one on switches the other off). The roll (↻) is held like the others but takes no part in slides (NOSLIDE: a
// thumb drifting onto it from ⤒ or ▼ does not start a committed roll, nor does one on it slide away), and a thumb that went down
// on ⤒ never picks up ▼ (landscape ▲ ↻ ▼ ⤒: one drifting from ⤒ toward ↻ would cross ▼ and crouch him).
const TOGGLES = ['run', 'sneak'], NOSLIDE = [...TOGGLES, 'roll'], toggleBtns = [...document.querySelectorAll('#pad .btn')].filter(b => TOGGLES.includes(b.dataset.k));
const fingers = new Map(), keyFingers = {};      // pointerId -> { from: the key it went down on, keys: the keys it holds }; key -> fingers on it
function padHold(id, from, ks){
  const old = fingers.has(id) ? fingers.get(id).keys : []; fingers.set(id, { from, keys: ks });
  for (const k of ks) if (!old.includes(k)){ keyFingers[k] = (keyFingers[k] || 0) + 1; if (!playing) setPlay(true); press(k); }
  for (const k of old) if (!ks.includes(k)) liftKey(k);
}
function liftKey(k){ if (--keyFingers[k] <= 0){ keyFingers[k] = 0; release(k); } }
function padLift(id){ const f = fingers.get(id); if (!f) return; fingers.delete(id); f.keys.forEach(liftKey); }
document.querySelectorAll('#pad .btn').forEach(b => { const k = b.dataset.k;
  b.addEventListener('contextmenu', e => e.preventDefault());
  if (TOGGLES.includes(k)){ b.addEventListener('pointerdown', e => { e.preventDefault(); const on = !keys[k];
    for (const t of toggleBtns){ const me = t === b; keys[t.dataset.k] = me && on; t.setAttribute('aria-pressed', String(me && on)); } }); return; }
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_){} padHold(e.pointerId, k, [k]); });
  b.addEventListener('pointermove', e => { const f = fingers.get(e.pointerId); if (!f || NOSLIDE.includes(f.from)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), t = el && el.closest && el.closest('#pad .btn'), to = t && t.dataset.k;
    if (t && !NOSLIDE.includes(to) && !(f.from === 'jump' && to === 'down') && t.parentElement === b.parentElement) padHold(e.pointerId, f.from, f.from === 'down' && to === 'jump' ? ['down', 'jump'] : [to]); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, e => padLift(e.pointerId)));
});

// ---------- player ----------
const player = { x: 0, y: 0, vx: 0, vy: 0, face: 1, ground: false, climb: false, on: null, cp: 0,
  coyT: 0, bufT: 0, rbufT: 0, dropT: 0, regrabT: 0, holdDir: 0, holdT: 0, runLatch: false, jumping: false, landT: 0,
  airT: 0, airY: 0,                      // time since the feet last touched ground, and the feet's y then (for the step-down grace)
  cvx: 0,                                // carry: the x speed of the platform he left (jumped or walked off), kept until he lands
  crouch: false,                         // Down held on his feet (CONTROLS): the crouch / crouch walk / low run
  rollT: null, rollK: 0, rollV: 0,      // the roll's clock (s of the clip; null: not rolling), the frame it began at, his speed then
                                         // while its set-off still runs faster (0: the root motion caught up)
  rollStop: false,                       // a wall stopped this roll: it plays out where it is
  spot: false,                           // a crouch way is done on the spot (STANCES): he does not move
  animT: 0,                              // s the anim shown has lasted (the low run's P.TWEEN)
  alertT: 0,                             // the guard kept after a roll (P.ALERT)
  anim: 'idle', af: 0, clip: null, fi: 0,
  animY: 0 };                            // the hitbox y at the last animation step (the climb's frames follow the distance climbed)
const stats = { deaths: 0, wins: 0, cps: [], log: [] };
function spawnAt(i){
  const p = player, cl = M.CHECK[i], r = M.standRow(cl);
  Object.assign(p, { x: cl * TS + (TS - P.W) / 2, y: r * TS - P.H, vx: 0, vy: 0, ground: true, climb: false, on: null,
    coyT: 0, bufT: 0, rbufT: 0, dropT: 0, regrabT: 0, jumping: false, landT: 0, airT: 0, airY: r * TS, cvx: 0, crouch: false, rollT: null, rollV: 0, alertT: 0,
    rollStop: false, spot: false, anim: 'idle', af: 0, animT: 0 });
}
// ---------- camera (CAMERA in the header) ----------
// x: the hero's share of the frame's width; rate: the x ease per step; band: the dead zone his feet may rest in, as shares of the
// frame's height (its foot under the street view's 0.733, so the street always gets that, the lowest view); rateY: the y ease;
// pan: the most it moves up or down in a step (px; not climbing, and falling only up: SPEED in the header); arrive: a landing at
// least this far above or below the ground he left is an arrival; look: how far a climb looks ahead; peek / peekReach / peekHold:
// the look-down at a drop (its landing that many px over the frame's bottom / the drop at most that far ahead of his leading
// edge / s it is kept after the drop is no longer ahead); frameTop / street: the E landmark's top that far under the frame's top,
// the street at most that share of the frame's height down; margin: the guarantee's px.
const CAM = { x: 0.42, rate: 0.14, band: [0.55, 0.72], rateY: 0.12, pan: 2, arrive: 1.5 * TS, look: 2 * TS, peek: TS / 2, peekReach: 1.5 * TS,
  peekHold: 0.4, frameTop: 8, street: 0.85, margin: 4 * K };
// What the vertical camera remembers: rest = the last arrival settles it to his surface's rest (else the dead zone); peekY /
// peekT = the landing of the last drop he faced and how much longer the look-down at it is kept.
const vcam = { rest: true, peekY: 0, peekT: 0 };
const camTarget = () => clamp(player.x + P.W / 2 - VW * CAM.x, 0, LW - VW);
const standable = (c, r) => M.isSolid(c, r) || M.isOneWay(c, r);
// The floor right under the hero's hitbox at or below y (a pit: the level's bottom).
function floorBelow(p, y){
  const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS);
  for (let r = Math.ceil(y / TS - 0.001); r < M.MH; r++) for (let c = c0; c <= c1; c++) if (standable(c, r)) return r * TS;
  return LH;
}
// The camera y that puts ref in the dead zone, from the camera y cur: cur while ref sits in the band, else the band's nearer edge.
function deadZone(cur, ref){
  const s = ref - cur, a = CAM.band[0] * VH, b = CAM.band[1] * VH;
  return clamp(s < a ? ref - a : s > b ? ref - b : cur, 0, LH - VH);
}
// A surface's rest: the camera y for a hero standing with his feet at y = feet - the street view where it has them in the band,
// else his feet at the band's middle.
function restY(feet){
  const low = LH - VH, s = feet - low;
  if (s >= CAM.band[0] * VH && s <= CAM.band[1] * VH) return low;
  return clamp(Math.round(feet - (CAM.band[0] + CAM.band[1]) / 2 * VH), 0, low);
}
// Facing a drop: the y of the floor past the edge ahead of the standing hero (his facing way, within CAM.peekReach of his leading
// edge), when it lies 2 tiles or more under his feet (a pit: the level's bottom); else null. A wall ahead, a step down of one tile
// or a ladder he would grab ends the look (null). Movers are skipped (they carry him; their own edges are not drops).
function dropAhead(p){
  if (!p.ground || p.on) return null;
  const f = p.face, r = Math.round((p.y + P.H) / TS), lead = f > 0 ? p.x + P.W - 0.001 : p.x;
  for (let c = Math.floor(lead / TS), end = Math.floor((lead + f * CAM.peekReach) / TS); c !== end + f; c += f){
    if (M.isSolid(c, r - 1) || M.isSolid(c, r - 2) || M.isLadder(c, r - 1)) return null;
    if (standable(c, r)) continue;                                                           // the same floor goes on
    let rr = r + 1; while (rr < M.MH && !standable(c, rr) && !M.isLadder(c, rr)) rr++;
    return (rr < M.MH && M.isLadder(c, rr)) || rr - r < 2 ? null : rr * TS;
  }
  return null;
}
// The landing y of the drop the standing hero faces now (d = dropAhead()), else of the last one he faced while its look-down is
// still kept (vcam.peekT); null when there is none.
const lookDown = d => d !== null ? d : vcam.peekT > 0 ? vcam.peekY : null;
// An arrival: feet coming to rest at y = feet CAM.arrive or more above or below from, the ground he left (p.airY: -Infinity
// after a climb, so the end of every climb is one).
const arrival = (from, feet) => Math.abs(feet - from) >= CAM.arrive;
// The ladder catch of a falling hero - a ladder at his feet or mid-body in his column, not with Down held, not in the re-grab pause
// after a leap, not in a roll (committed: off a ledge it tumbles on): stepPlayer grabs it, and the camera holds for it (ahead: also
// the cell right under his feet, the one that will catch him next step), so the hold can never drift from the real catch.
function ladderCatch(p, ahead = false){
  if (keys.down || p.regrabT > 0 || p.rollT !== null) return false;
  const c = Math.floor((p.x + P.W / 2) / TS), feet = p.y + P.H;
  return [feet - 1, p.y + P.H / 2, ...(ahead ? [feet + 1] : [])].some(y => M.isLadder(c, Math.floor(y / TS)));
}
// E, the landmark zone: the camera y that frames the headframe whole (its top CAM.frameTop px under the frame's top), the street
// at most CAM.street of the frame's height down, while the hero's centre is in map ENT.landmark's columns; null elsewhere.
function landmarkY(p){
  const z = M.ENT.landmark, c = (p.x + P.W / 2) / TS;
  if (c < z.c0 || c >= z.c1 + 1) return null;
  return clamp(A.props.headframe().top - CAM.frameTop, Math.max(0, M.GROUND * TS - Math.floor(CAM.street * VH)), LH - VH);
}
// The camera y the ease aims at, from the camera y cur (CAMERA in the header); drop: dropAhead() this step (update() has it).
function camTargetY(cur, drop = dropAhead(player)){
  const p = player, feet = p.y + P.H, lm = landmarkY(p);
  if (lm !== null) return lm;
  if (p.climb) return deadZone(cur, feet + Math.sign(p.vy) * CAM.look);
  if (p.ground){ const base = vcam.rest ? restY(feet) : deadZone(cur, feet), look = lookDown(drop);
    return look === null ? base : clamp(look + CAM.peek - VH, base, LH - VH); }
  if (p.vy <= 0 || ladderCatch(p, true)) return cur;
  const floor = floorBelow(p, feet);
  if (floor === p.airY) return cur;                       // a hop in place: back onto the floor he left, the view he had there
  return arrival(p.airY, floor) ? restY(floor) : deadZone(cur, floor);
}
// The guarantee: the hero's drawn frame inside the frame (its top CAM.margin under the frame's top), his feet over its bottom.
function camGuard(y){
  const h = heroFrame(0, 0), top = h ? h.y : player.y - P.HEAD, feet = player.y + P.H;
  return clamp(Math.max(Math.min(y, top - CAM.margin), feet - VH + CAM.margin), 0, LH - VH);
}
// The camera y for the hero where he is as if he had just arrived there (a respawn: his surface's rest, from the street view).
function arrivedY(){ vcam.rest = true; vcam.peekT = 0; return camGuard(camTargetY(LH - VH)); }
// A respawn puts the camera on the hero at once (no smear across the level).
function snapCam(){ camX = camTarget(); camY = arrivedY(); }
// True when the feet rest exactly on the top of a floor cell (solid or one-way) under the hitbox: the ladder code's own ground test
// (p.ground is only refreshed by a downward move, and a hero hanging still on a ladder does not move).
function floorUnder(p){
  const feet = p.y + P.H, r = Math.round(feet / TS); if (Math.abs(feet - r * TS) > 0.5) return false;
  const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS);
  for (let c = c0; c <= c1; c++) if (M.isSolid(c, r) || M.isOneWay(c, r)) return true;
  return false;
}
function inSolid(p){
  const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS), r0 = Math.floor(p.y / TS), r1 = Math.floor((p.y + P.H - 0.001) / TS);
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (M.isSolid(c, r)) return true;
  return false;
}
function standsOnDropThrough(p, row){
  const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS); let any = false;
  for (let c = c0; c <= c1; c++){ if (M.isDropThrough(c, row)) any = true; else if (M.isSolid(c, row) || M.isOneWay(c, row)) return false; }
  return any;
}
// Walking off an edge he did not jump from: for AIR_GRACE s, and while the drop is under STEP_DROP, he is still on his feet (the
// ground cycle and a crouch, a sneak or a roll go on: a 1-tile step down is a stair, not a fall)
const stepGrace = p => !p.ground && !p.climb && !p.jumping && (p.airT < P.AIR_GRACE || p.y + P.H - p.airY < P.STEP_DROP);
// The roll the roll key would start now (CONTROLS): { f: its facing - a held direction, unless he moves the other way faster than
// P.MOVE_V -, k: its first frame, the set-off's that matches his pose (rollEntry) }, or null when it has no room: a wall ahead
// (the level's ends among them) would stop it - its frames reaching from k on, the body tx[k] on at once (startRoll) - before it
// has gone P.ROLL_ROOM of the clip's travel from k (rollLimit)
function rollPlan(p, dir){
  const f = dir && p.vx * dir >= -P.MOVE_V ? dir : p.face, sp = Math.abs(p.vx), k = rollEntry(p, f, sp > P.MOVE_V ? P.ROLL_DIP * sp / P.WALK : 0);
  const room = P.ROLL_ROOM * (roll.tx[roll.n - 1] - roll.tx[k]), w = rollLimit(p, f, rollReach(f, k).rest, roll.tx[k] + room);
  return w && f * (w.x - p.x) < roll.tx[k] + room ? null : { f, k };
}
// A roll begins if it has room (rollPlan; false: the key does nothing), his speed along the new facing kept while the set-off's
// root motion is slower (rollV). Begun at frame k, it goes on from where the clip has the body then: tx[k] on from where he stood,
// so the boots, which the set-off keeps where they stood at frame 0, stay where his were (no skid back by the root motion skipped)
function startRoll(p, dir){
  const r = rollPlan(p, dir); if (!r) return false;
  p.face = r.f; p.rollK = r.k; p.rollT = r.k / roll.fps; p.rollV = Math.max(0, p.vx * r.f); p.rollStop = false; p.x += r.f * roll.tx[r.k];
  p.bufT = p.rbufT = 0; p.crouch = false; return true;
}
// a roll ends (its clip played out, or input past its commit point): he stays on guard a while
function endRoll(p){ p.rollT = null; p.rollV = 0; p.alertT = P.ALERT; }
function stepPlayer(dt){
  const p = player, onAtStart = p.on;
  if (p.on){ p.x += p.on.dx; p.y += p.on.dy; }                       // ride the platform
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const ccol = Math.floor((p.x + P.W / 2) / TS);
  const feetRow = Math.floor((p.y + P.H - 1) / TS), midRow = Math.floor((p.y + P.H / 2) / TS), belowRow = Math.floor((p.y + P.H + 1) / TS);
  const onLad = M.isLadder(ccol, feetRow) || M.isLadder(ccol, midRow), ladBelow = M.isLadder(ccol, belowRow);
  // jump and roll requests, buffered: the jump key always, Up only away from a ladder (on a ladder Up climbs); the roll key
  const jumpPress = edge.jump || (edge.up && !onLad);
  p.bufT = jumpPress ? P.BUFFER : Math.max(0, p.bufT - dt); p.rbufT = edge.roll ? P.BUFFER : Math.max(0, p.rbufT - dt);
  const footed = p.ground || stepGrace(p);
  // a roll past its commit point, on the ground: a jump ends it at once, so does the roll key (pressed now or buffered) when the new
  // roll has room (rollPlan; else the press is not taken - dropped, not kept for a roll from whatever pose the get-up hands over to -
  // and the roll goes on); a held direction, Down or Up once the get-up has him up to the pose it leads to (rollUp: no pop to a
  // taller frame) (CONTROLS); in the air - down a step too - it rolls on (and plays out into the fall)
  if (p.rollT !== null && p.rollT >= roll.commit && p.ground){
    if (p.rbufT > 0 && !rollPlan(p, dir)) p.rbufT = 0;
    if (p.bufT > 0 || p.rbufT > 0 || ((dir || keys.down || keys.up) && rollUp(p, rollExitTo(dir)))) endRoll(p); }
  let rolling = p.rollT !== null;
  // run = Shift, or the same direction held for AUTORUN walking upright on the ground (not crouched, sneaking, rolling or held on the
  // spot by a crouch way: those keep their gait however long it is held); decided on the ground and kept through a jump (a walking
  // jump stays a walking jump), dropped when the direction is released or reversed. Crouched only Shift runs (the low run); sneaking
  // nothing does
  if (dir !== 0 && dir === p.holdDir){ if (p.ground && !rolling && !p.spot && !keys.down && !keys.sneak) p.holdT += dt; } else { p.holdDir = dir; p.holdT = 0; p.runLatch = false; }
  if ((p.ground || p.climb) && !rolling) p.runLatch = dir !== 0 && (keys.down ? keys.run : !keys.sneak && (keys.run || p.holdT >= P.AUTORUN));
  const running = dir !== 0 && p.runLatch;
  p.dropT = Math.max(0, p.dropT - dt); p.regrabT = Math.max(0, p.regrabT - dt);

  // ladders: grab with Up, step down onto one from its top with Down, catch one when falling past it (not in a roll: Up / Down end
  // one only once he is up again, above)
  if (!p.climb && p.regrabT <= 0 && !rolling){
    if (onLad && keys.up) p.climb = true;
    else if (ladBelow && keys.down && p.ground){ p.climb = true; p.y += 2 * K; if (inSolid(p)) p.x = ccol * TS + (TS - P.W) / 2; }   // (from a roof edge: onto the axis at once, never into the wall)
    else if (!p.ground && p.vy > 0 && ladderCatch(p)) p.climb = true;
    if (p.climb){ p.vx = 0; p.vy = 0; p.jumping = false; p.bufT = 0; p.on = null; p.cvx = 0; }
  }
  if (p.climb){
    if (!onLad && !(ladBelow && keys.down)){                                            // left the ladder: out over the top, or off its end
      p.climb = false;
      // Out over the top: the feet just passed the top of the ladder's top cell (a one-way ledge). Stand on it now, at rest, so the
      // state goes straight from climb to idle / walk (keeping the climb speed would toss him ~4 px up into a short air pose).
      const r = Math.round((p.y + P.H) / TS);
      if (p.vy < 0 && Math.abs(p.y + P.H - r * TS) < 2 * K && M.isOneWay(ccol, r)){ p.y = r * TS - P.H; p.vy = 0; p.ground = true; }
    } else if (!keys.up && floorUnder(p)) p.climb = false;                               // feet on a floor (the foot): stand, walk off
  }
  // the roll key (pressed now, or up to BUFFER s before he is on his feet) starts a roll if it has room; it begins this very step
  if (!p.climb && !rolling && p.rbufT > 0 && footed && startRoll(p, dir)) rolling = true;
  // the crouch: Down held on his feet (a ladder top under him climbed down instead, above); off his feet he stands (a jump from
  // a crouch is a standing jump). STANCES: while a crouch way plays, or is about to (Down pressed in an upright stance no faster than
  // the sneak, let go in the crouch or the crouch walk), he stays on the spot - not when the sheet lacks that way
  p.crouch = !p.climb && !rolling && footed && keys.down;
  p.spot = !p.climb && !rolling && footed && sheetHas(p.crouch ? 'crouch_in' : 'crouch_out') && (p.anim === 'crouch_in' || p.anim === 'crouch_out' ||
    (Math.abs(p.vx) <= P.SNEAK && (p.crouch ? STAND : CROUCHED).has(p.anim)));
  if (!footed || dir || p.crouch || rolling) p.alertT = 0; else p.alertT = Math.max(0, p.alertT - dt);
  if (p.climb){
    p.vx = 0; p.vy = ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)) * P.CLIMB;
    p.airT = P.AIR_GRACE; p.airY = -Infinity;                                          // leaving a ladder mid-air is a fall, not a step
    p.x += (ccol * TS + (TS - P.W) / 2 - p.x) * Math.min(1, 15 * dt);                 // slide onto the ladder's axis
    if (edge.jump){ p.climb = false; p.vy = -P.V0 * P.LADDER_LEAP; p.vx = dir * P.WALK; p.jumping = true; p.regrabT = P.REGRAB; p.bufT = 0; if (dir) p.face = dir; }
  } else if (rolling){
    // the clip's clock: he came in faster than its set-off's root motion (rollV, his speed at the press), so it runs ahead - up to
    // ROLL_RATE x - by as much as keeps him at that speed (the boots still planted), until the clip's own root motion is as fast
    let t1 = p.rollT + dt;
    if (p.rollV){ if (rollTx(t1) - rollTx(p.rollT) >= p.rollV * dt) p.rollV = 0; else t1 = clamp(rollAt(rollTx(p.rollT) + p.rollV * dt), t1, p.rollT + P.ROLL_RATE * dt); }
    const step = (rollTx(t1) - rollTx(p.rollT)) / dt;
    // the body: the clip's root motion (roll.tx) along his facing on the ground, at most the run's speed down a step (the step
    // grace); off a ledge a fall at the speed he left with, the clip tumbling on (no coyote jump out of it: it was committed); a
    // wall stops the body short of its frames' reach (the X pass) for the rest of the roll (rollStop), the clip plays on
    if (p.ground) p.vx = p.rollStop ? 0 : p.face * step; else if (footed) p.vx = p.rollStop ? 0 : p.face * Math.min(step, P.RUN);
    if (!p.ground) p.coyT = 0;
    p.rollT = t1; p.vy = Math.min(P.MAXFALL, p.vy + P.G * dt);
    if (p.rollT >= roll.dur) endRoll(p);
  } else {
    // (on the spot he stands still at once: a crouch way starts no faster than the sneak, and a speed left over from a braking step
    // would show the upright gait he is leaving - crouch_out leads to a stance, not a gait)
    const gait = p.crouch ? (running ? P.LOWRUN : P.CROUCH) : keys.sneak && footed ? P.SNEAK : running ? P.RUN : P.WALK;
    const a = p.ground ? (!dir ? P.DEC : p.vx * dir < 0 ? P.TURN : P.ACC) : (dir ? P.AIR_ACC : P.AIR_DEC);
    p.vx = p.spot ? 0 : approach(p.vx, dir * gait, a * dt);
    if (dir) p.face = dir;
    p.vy = Math.min(P.MAXFALL, p.vy + P.G * dt);
    if (edge.cut && p.jumping && p.vy < 0) p.vy *= P.CUT;
    // Down + a jump on a catwalk drops through it (the jump is spent on that; a fall at once, no step grace); anywhere else a jump,
    // crouched or not
    if (jumpPress && keys.down && p.ground && !p.on && !ladBelow && standsOnDropThrough(p, belowRow)){
      p.dropT = P.DROP; p.ground = false; p.y += 1; p.bufT = 0; p.crouch = false; p.airT = P.AIR_GRACE; p.airY = -Infinity; }
    else if (p.bufT > 0 && p.coyT > 0){ p.vy = -P.V0; p.jumping = true; p.bufT = 0; p.coyT = 0; p.ground = false; p.on = null; p.crouch = false; }
  }
  // conveyor: pushes whoever stands on it (not the own velocity: the hero can stand still and be carried)
  let belt = 0;
  if (p.ground && !p.on && !p.climb){ const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS); for (let c = c0; c <= c1; c++) if (M.tile(c, belowRow) === 'T') belt = P.BELT; }

  // X: move (own speed + belt push + the carry of a platform left this jump; a platform he still stands on already moved him),
  // then push out of walls in the rows the hitbox spans: solid tiles, and the belt's slab, which is one-way only from above - its
  // ends are walls (standing on it the hitbox ends at its top, so it never spans the belt's row), so no hop slips the body into
  // the belt row and down into the space under it
  const mvx = p.vx + belt + (onAtStart ? 0 : p.cvx), x0 = p.x;
  p.x += mvx * dt;
  const r0 = Math.floor(p.y / TS), r1 = Math.floor((p.y + P.H - 0.001) / TS), wallIn = c => { for (let r = r0; r <= r1; r++) if (wallAt(c, r)) return true; return false; };
  if (mvx > 0){ const cl = Math.floor((p.x + P.W - 0.001) / TS); if (wallIn(cl)){ p.x = cl * TS - P.W; p.vx = Math.min(0, p.vx); p.cvx = Math.min(0, p.cvx); } }
  else if (mvx < 0){ const cl = Math.floor(p.x / TS); if (wallIn(cl)){ p.x = (cl + 1) * TS; p.vx = Math.max(0, p.vx); p.cvx = Math.max(0, p.cvx); } }
  if (p.x < P.END){ p.x = P.END; p.vx = Math.max(0, p.vx); p.cvx = Math.max(0, p.cvx); }
  else if (p.x > LW - P.W - P.END){ p.x = LW - P.W - P.END; p.vx = Math.min(0, p.vx); p.cvx = Math.min(0, p.cvx); }
  // Rolling, his frames reach further ahead than the hitbox (the dive, the tumble), and no frame drawn may overlap a wall: moving on,
  // he stops short of one (rollLimit: the level's ends among them) by the farthest the frames still to come reach, so he never has
  // to back off it (a roll without that room does not begin: rollPlan), and stays stopped (rollStop) - never moved back behind where
  // he was this step. Off his feet the rows run down to the floor he will land on (rollLimit), so a wall's side down there stops him
  // before he falls past its top; only one that comes into them as the floor under him changes may find his frames over it already
  // (they are not snapped back off it). The level's two ends alone push the frame drawn now back off them (the camera can show
  // nothing past them).
  if (p.rollT !== null){ const f = p.face, r = rollReach(f, rollFrame(p.rollT)), w = rollLimit(p, f, r.rest);
    if (w && mvx * f > 0 && f * (p.x - w.x) > 0){ p.x = f > 0 ? Math.max(Math.min(x0, p.x), w.x) : Math.min(Math.max(x0, p.x), w.x); p.vx = 0; p.rollStop = true; }
    const e = rollLimit(p, f, r.now); if (e && e.end && f * (p.x - e.x) > 0){ p.x = e.x; p.vx = 0; } }

  // Y: move, land on solids / one-way ledges crossed this step, bump heads on solids, on the belt's underside and on a mover's
  // ceiling (the bucket's yoke); thin ceilings stop the hair (P.HEAD over the hitbox), so the sprite never pokes through them
  const prevB = p.y + P.H, prevT = p.y, wasGround = p.ground, wasOn = p.on, vyIn = p.vy;
  p.y += p.vy * dt; p.ground = false; p.on = null;
  const c0 = Math.floor(p.x / TS), c1 = Math.floor((p.x + P.W - 0.001) / TS);
  if (p.vy > 0){
    const rb = Math.floor((p.y + P.H - 0.001) / TS); let land = Infinity;
    for (let cl = c0; cl <= c1; cl++){
      if (M.isSolid(cl, rb)) land = Math.min(land, rb * TS);
      if (!p.climb) for (let r = Math.floor(prevB / TS); r <= rb; r++)
        if (M.isOneWay(cl, r) && !(p.dropT > 0 && M.isDropThrough(cl, r)) && prevB <= r * TS + 0.01 && p.y + P.H >= r * TS) land = Math.min(land, r * TS);
    }
    if (land < Infinity){ p.y = land - P.H; p.vy = 0; p.ground = true; }
  } else if (p.vy < 0){
    const rt = Math.floor(p.y / TS), rh = Math.floor((p.y - P.HEAD) / TS);
    for (let cl = c0; cl <= c1; cl++){
      if (M.isSolid(cl, rt)){ p.y = (rt + 1) * TS; p.vy = 0; break; }
      if (M.tile(cl, rh) === 'T' && prevT - P.HEAD >= (rh + 1) * TS - 0.01){ p.y = (rh + 1) * TS + P.HEAD; p.vy = 0; break; }
    }
    for (const m of movers) if (m.ceil && p.vy < 0){ const yb = m.y + m.ceil.y + P.HEAD;
      if (p.x + P.W > m.x + m.ceil.x0 && p.x < m.x + m.ceil.x1 && prevT >= yb - 0.01 && p.y < yb && p.y + P.H > yb){ p.y = yb; p.vy = 0; } }
  }
  // moving platforms: solid from above only. Boarding one snaps the hero to a whole-pixel offset from it, so rider and platform
  // round to the screen together (drawPlayer draws him relative to the mover) and he never shimmers 1 px against it.
  if (!p.climb && p.vy >= 0) for (const m of movers)
    if (p.x + P.W > m.x + 1 && p.x < m.x + m.w - 1 && prevB <= m.y + Math.max(0, m.dy) + 1.01 && p.y + P.H >= m.y){
      p.y = m.y - P.H; p.vy = 0; p.ground = true; if (wasOn !== m || p.vx === 0) p.x = m.x + Math.round(p.x - m.x); p.on = m; }   // (and again once he stands still on it)
  // Platform momentum: leaving a moving platform (a jump, walking off its end) keeps its x speed as a carry until he lands, so a
  // jump in place in the bucket or on the shunting cart comes down where the platform is, not 40 px behind it in the chasm.
  if (p.on) p.cvx = 0; else if (onAtStart && !p.climb && onAtStart.axis === 'x') p.cvx = onAtStart.dx / dt;
  if (p.ground){ if (!p.on) p.cvx = 0; if (!wasGround && vyIn > P.LAND_V) p.landT = landTime(); p.coyT = P.COYOTE; p.jumping = false; p.airT = 0; p.airY = p.y + P.H; }
  else { p.coyT = Math.max(0, p.coyT - dt); p.airT += dt; }
  // landing with Down held he is crouched at once (not one standing step first), unless a ladder's top is under him (Down climbs it)
  if (p.ground && !wasGround && keys.down && !p.climb && p.rollT === null && !M.isLadder(Math.floor((p.x + P.W / 2) / TS), Math.floor((p.y + P.H + 1) / TS))) p.crouch = true;
}
function landTime(){ const c = sheet.ok && sheet.anims.land; return c ? c.frames.length / c.fps : 0; }

// ---------- animation state machine ----------
// idle / walk / run on the ground (by OWN speed: the speed of the feet against what they stand on; on the belt that is a treadmill,
// so running against it at P.RUN shows run although he only gains RUN - BELT, and a hero standing on it idles while it carries him;
// while a direction is held he walks at any speed but 0, so a turnaround - his speed passing through 0 - never flashes an idle
// frame between walking one way and the other, while pushing against a wall, held at 0, idles), jump_up / jump_apex / fall in the
// air of a jump by vertical speed (s = -vy / V0 against P.AIR_UP / AIR_FALL), fall straight away off an edge he walked off, a
// catwalk he dropped through or a ladder he let go of (no rise or top to show), land straight out of a hard landing (anything else
// - walking, running, a jump, a ladder - cancels it, so it never squashes him late, after he has walked on), climb on ladders; the
// moves (CONTROLS): crouchwalk / lowrun crouched (by the same own speed against the midpoint of P.CROUCH and P.LOWRUN), sneak with
// the sneak key, crouch crouched and still, alert still with the sneak key or for P.ALERT s after a roll, roll while one lasts. The
// stances' ways in and out (WAYS; STANCES in the header): crouch_in from an upright stance or slow gait into the crouch or the
// crouch walk, crouch_out from them back up (both played on the spot: stepPlayer holds him, p.spot), alert_in from idle (or the end
// of crouch_out) into the guard, alert_out from it back to idle (the arms come up / down over 4 frames, not in one), each played to
// its end unless something else is wanted (a walk, a jump...), and one reversed half way enters the other at the mirrored frame;
// the roll ends in its own guard (no way). On the move (not on the spot) between the crouch and an upright gait the low run shows
// instead (its height between theirs), and once shown it lasts P.TWEEN s at least. A gait entered from another clip starts at its
// first frame with a boot on the ground line (footDown: the low run's frame 0 is in flight). Frames: idle, land, fall, alert, the
// crouch and the ways play at their fps; walk / run at theirs scaled toward the ground speed (walk <-> run keeps the cycle phase),
// the moves' gaits at theirs x speed / the clip's speed (MOVE_SYNC: the planted foot stays put); the roll shows the frame of its
// time (rollT x fps: the instant its travel moved him to); jump_up and jump_apex show the key pose of the current vertical speed
// (their frames spread over their band of s: take-off push, knee drive, tuck; the top, tipping over), so a short hop or a ladder
// leap enters the rise part-way and the arc never runs ahead of the body; climb advances by the distance climbed / the clip's dy
// (backwards climbing down, still while he hangs). Both facings play the same frame index (the sheet's two sets are the same
// instants).
// Step-down grace (stepGrace): walking off an edge you did not jump from keeps the ground cycle for AIR_GRACE s, and for as long as
// the drop is under STEP_DROP (a 1-tile step, a hunt), so the A slag steps read as a staircase, not three little falls.
const walkish = a => a === 'walk' || a === 'run', GAIT = new Set(['walk', 'run', 'crouchwalk', 'sneak', 'lowrun']);
// the upright anims the crouch's way in starts from (climb: let go at a ladder's foot with Down held), the crouched ones its way out
// starts from, the upright gaits the low run links to them on the move, and the ground stances its P.TWEEN holds back
const STAND = new Set(['idle', 'alert', 'land', 'alert_in', 'alert_out', 'walk', 'run', 'sneak', 'climb']), CROUCHED = new Set(['crouch', 'crouchwalk']);
const UPGAIT = new Set(['walk', 'run', 'sneak']), GROUNDED = new Set([...UPGAIT, ...CROUCHED, 'idle', 'alert']);
// the ways: the anims each starts from, the stances it leads to, and the way that undoes it
const WAYS = { crouch_in: { from: [...STAND], to: [...CROUCHED], back: 'crouch_out' },
  crouch_out: { from: [...CROUCHED], to: ['idle', 'alert'], back: 'crouch_in' },
  alert_in: { from: ['idle', 'land', 'crouch_out'], to: ['alert'], back: 'alert_out' },
  alert_out: { from: ['alert'], to: ['idle'], back: 'alert_in' } };
const sheetHas = name => sheet.ok && hasClip(sheet.anims, name);
// a clip's first frame with its lowest row on the ground line (a frame without "opaque": 0)
function footDown(c){ const low = f => f.opaque ? f.opaque[3] - f.ay : 0, g = Math.max(...c.frames.map(low)); return Math.max(0, c.frames.findIndex(f => low(f) === g)); }
function animate(dt){
  const p = player, moved = p.y - p.animY; p.animY = p.y;
  const s = -p.vy / P.V0, held = keys.left !== keys.right, sp = Math.abs(p.vx);
  let want;
  if (p.climb) want = 'climb';
  else if (p.rollT !== null) want = 'roll';
  else if (!p.ground && !stepGrace(p)) want = !p.jumping ? 'fall' : s > P.AIR_UP ? 'jump_up' : s >= -P.AIR_FALL ? 'jump_apex' : 'fall';
  else if (sp > P.MOVE_V || (held && p.vx !== 0)) want = p.crouch ? (sp > (P.CROUCH + P.LOWRUN) / 2 ? 'lowrun' : 'crouchwalk') : keys.sneak ? 'sneak'
    : sp > (P.WALK + P.RUN) / 2 ? 'run' : 'walk';
  else if (p.crouch) want = 'crouch';
  else if (p.landT > 0) want = 'land';
  else want = keys.sneak || p.alertT > 0 ? 'alert' : 'idle';
  p.landT = want === 'land' ? Math.max(0, p.landT - dt) : 0;
  const was = p.anim;
  // the stances' ways in / out (WAYS; af0: the frame a reversed one enters the other at): one on its way to the stance wanted plays
  // on to its end; else on the move between the crouch and an upright gait the low run (P.TWEEN s of it at least); else the way from
  // the anim shown to the stance wanted starts (a reversed one at the mirrored frame)
  let af0 = null;
  if (WAYS[was] && WAYS[was].to.includes(want) && sheetHas(was) && p.af < sheet.anims[was].frames.length) want = was;
  else if (!p.spot && sheetHas('lowrun') && GROUNDED.has(want) && ((UPGAIT.has(was) && CROUCHED.has(want)) || (CROUCHED.has(was) && UPGAIT.has(want)) ||
    (was === 'lowrun' && p.animT < P.TWEEN - dt / 2))) want = 'lowrun';
  else for (const w in WAYS){ const d = WAYS[w]; if (!d.to.includes(want) || !sheetHas(w)) continue;
    if (was === d.back){ want = w; af0 = Math.max(0, sheet.anims[w].frames.length - 1 - p.fi); break; }
    if (d.from.includes(was)){ want = w; break; } }
  const r = p.clip = resolveClip(want, p.face);
  if (want !== was){ if (!(walkish(want) && walkish(was))) p.af = af0 ?? (r && !r.safety && GAIT.has(want) ? footDown(r.clip) : 0); p.anim = want; p.animT = dt; } else p.animT += dt;
  if (!r) return;
  const c = r.clip, n = c.frames.length;
  if (r.safety) p.fi = 0;
  else if (want === 'jump_up') p.fi = clamp(Math.floor((1 - s) / (1 - P.AIR_UP) * n), 0, n - 1);
  else if (want === 'jump_apex') p.fi = clamp(Math.floor((P.AIR_UP - s) / (P.AIR_UP + P.AIR_FALL) * n), 0, n - 1);
  else if (want === 'roll') p.fi = clamp(Math.floor(p.rollT * c.fps), 0, n - 1);
  else {
    if (want === 'climb'){ if (was === 'climb') p.af -= moved / (c.dy || P.CLIMB / c.fps); }
    else p.af += dt * c.fps * (GAIT.has(want) ? clamp(Math.pow(sp / clipSpeed(c, want), walkish(want) ? P.ANIM_SYNC : P.MOVE_SYNC), 0.5, 2.2) : 1);
    p.fi = c.loop === false ? Math.min(n - 1, Math.floor(p.af)) : ((Math.floor(p.af) % n) + n) % n;
  }
}
// Frame anchor of the hero (between the feet) for the camera (cx, cy). Riding a mover, he is placed at a whole-pixel offset from the
// mover's own rounded position, so both step on the same frames.
function heroAnchor(cx, cy){
  const p = player, m = p.on;
  if (m) return [Math.round(m.x) + Math.round(p.x + P.W / 2 - m.x) - cx, Math.round(m.y) + Math.round(p.y + P.H - m.y) - cy];
  return [Math.round(p.x + P.W / 2) - cx, Math.round(p.y + P.H) - cy];
}
// The frame drawn now and its top-left in the frame for the camera (cx, cy) (null without a sheet). A frame of the facing's own set
// is drawn as it is; a mirrored one (no left set) is flipped about its anchor. On a ladder the hands' midpoint (ax + lx) goes on
// the ladder's axis.
function heroFrame(cx, cy){
  const p = player, r = p.clip; if (!sheet.ok || !r) return null;
  const [ax, ay] = heroAnchor(cx, cy), f = r.clip.frames[p.fi % r.clip.frames.length];
  const lx = p.anim === 'climb' && !r.safety ? Math.round(r.clip.lx || 0) : 0;
  return { f, flip: r.mirror, x: r.mirror ? ax + f.ax - f.w + lx : ax - f.ax - lx, y: ay - f.ay };
}
// The rectangle the hero's current frame is drawn in, and the box of its drawn (opaque) pixels in it (frame px; null without a
// sheet): tests use them for the camera's guarantee (the frame's transparent margin - a clip's frames share its union box - may
// pass the level's ends; what is drawn may not).
function heroRect(cx, cy){ const h = heroFrame(cx, cy); return h && { x: h.x, y: h.y, w: h.f.w, h: h.f.h }; }
function heroDrawn(cx, cy){ const h = heroFrame(cx, cy); if (!h) return null; const f = h.f, o = f.opaque || [0, 0, f.w, f.h];
  return { x: h.x + (h.flip ? f.w - o[2] : o[0]), y: h.y + o[1], w: o[2] - o[0], h: o[3] - o[1] }; }
function drawPlayer(c, cx, cy){
  const h = heroFrame(cx, cy);
  if (!h){   // no sheet (e.g. opened from file://): a coat-coloured stand-in of the hitbox size
    const [ax, ay] = heroAnchor(cx, cy);
    R(c, ax - P.W / 2 - 1, ay - P.H - 1, P.W + 2, P.H + 2, OUTLINE); R(c, ax - P.W / 2, ay - P.H + 12 * K, P.W, P.H - 12 * K, '#343027');
    R(c, ax - 5 * K, ay - P.H, 10 * K, 12 * K, '#8d5245'); R(c, ax - 5 * K, ay - P.H, 10 * K, 4 * K, '#9a958a'); return;
  }
  const f = h.f;
  if (h.flip){ c.save(); c.translate(h.x + f.w, h.y); c.scale(-1, 1); c.drawImage(sheet.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h); c.restore(); }
  else c.drawImage(sheet.img, f.x, f.y, f.w, f.h, h.x, h.y, f.w, f.h);
}

// ---------- state / UI ----------
const LAYERS = [
  { id: 'sky', name: 'Niebo' }, { id: 'far', name: 'Hałdy 0.15' }, { id: 'midfar', name: 'Chłodnie 0.32' },
  { id: 'mid', name: 'Szyby 0.60' }, { id: 'game', name: 'Plansza 1.00' }, { id: 'fg', name: 'Pierwszy plan 1.35 / 1.00' }, { id: 'ash', name: 'Pył' }
];
const vis = Object.fromEntries(LAYERS.map(l => [l.id, true]));
document.getElementById('layers').innerHTML = LAYERS.map(l => `<label class="chk"><input type="checkbox" id="ly-${l.id}" checked> ${l.name}</label>`).join('');
// While playing, a POINTER click on a toggle gives the focus straight back to the canvas: the next Space is a jump, not a re-toggle.
// A toggle worked from the keyboard (Tab, Space) keeps the focus, so Tab goes on through the controls. viaPointer: the last
// press came from a pointer (mouse, pen, touch), not a key.
let viaPointer = false;
addEventListener('pointerdown', () => { viaPointer = true; }, true);
addEventListener('keydown', () => { viaPointer = false; }, true);
const refocus = () => { if (playing && viaPointer) cv.focus({ preventScroll: true }); };
LAYERS.forEach(l => document.getElementById('ly-' + l.id).addEventListener('change', e => { vis[l.id] = e.target.checked; refocus(); }));
document.getElementById('swatches').innerHTML = S.SWATCH.map(([n, c]) => `<div class="sw"><i style="background:${c}"></i><span>${n}</span><code>${c}</code></div>`).join('');
let playing = false, showGrid = false, camX = 0, camY = LH - VH, tourDir = 1, frame = 0, winT = 0, deathT = 0;
const modeBtn = document.getElementById('mode'), gridBtn = document.getElementById('grid');
// Starting play brings the whole stage into the window (the street must not sit below the fold while the arrows and Space are
// captured): the smallest scroll that shows it, or its top when it is taller than the window.
function bringStageIntoView(){
  const r = stage.getBoundingClientRect(), h = innerHeight; let dy = 0;
  if (r.height > h || r.top < 0) dy = r.top - Math.max(0, Math.min(8, (h - r.height) / 2)); else if (r.bottom > h) dy = r.bottom - h + Math.min(8, h - r.height);
  if (Math.abs(dy) >= 1) scrollBy(0, Math.round(dy));
}
function setPlay(v){ playing = v; modeBtn.setAttribute('aria-pressed', v); modeBtn.textContent = v ? 'Zwiedzaj' : 'Graj';
  if (v){ cv.focus({ preventScroll: true }); bringStageIntoView(); } else releaseAll(); }
modeBtn.addEventListener('click', () => setPlay(!playing));
gridBtn.addEventListener('click', () => { showGrid = !showGrid; gridBtn.setAttribute('aria-pressed', showGrid); refocus(); });
// Full screen: the stage alone on the whole screen (Esc leaves it), so a 1080p screen gets the x2 picture edge to edge without the
// browser's own F11 (a maximised window is ~950 px tall: x1); fit() re-runs on the change. Hidden where the page may not use it.
const fsBtn = document.getElementById('fs');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen().catch(() => {}); });
document.addEventListener('fullscreenchange', () => { fsBtn.setAttribute('aria-pressed', String(document.fullscreenElement === stage)); fit(); if (playing) cv.focus({ preventScroll: true }); });

// ---------- display size ----------
// Crisp means a whole number of DEVICE pixels per canvas pixel, so the scale k is chosen in device px (devicePixelRatio aware: at
// 125 % / 150 % Windows scaling a CSS-integer scale would draw columns 1 and 2 device px wide). k = the largest integer for which
// VW k x VH k device px fit the width (16 px gutters, 2 px border) and the window height (4 % overflow allowed: a strip of ground).
// Where the whole window width allows one step more - 1920 x 1080 at x2 - the stage bleeds to the window's edges instead (no
// gutters, no border: .stage.bleed) and takes it. On touch screens the integer size must also cover 90 % of the size that fits
// and draw the hero at least HERO_CSS CSS px tall, else the canvas fits the space exactly (a phone should not show a 266 px game
// in a 354 px column; a 390 px phone in portrait at dpr 3 would get x1 = 320 CSS px, the hero 32 px tall: the full column gives
// him 35, while the 844 x 390 one in landscape keeps its crisp x2, the hero 64 px) - but only for a real gain, the fit at least
// FIT_GAIN x the integer width (a 412 px phone at dpr 2.625 keeps its crisp x1, 366 CSS px: the fit, 376, is not worth a
// non-integer scale). Desktops always take the integer scale. A non-integer fit stays pixelated (nearest neighbour) on dense
// screens (devicePixelRatio >= 2: an uneven column is a third of a CSS px, invisible) and from 2 device px per canvas px up; it is
// smoothed (image-rendering: auto) only below 1 device px per canvas px (a downscale would drop whole columns) or on a 1x screen
// under 2x. The canvas is also nudged (position: relative) onto whole device pixels, as the header above it can end on a fraction.
const coarse = matchMedia('(pointer:coarse)'), HERO_CSS = 40, FIT_GAIN = 1.08;
function fit(){
  const dpr = devicePixelRatio || 1, winW = root.clientWidth;
  const availW = Math.max(120, winW - 32 - 4), availH = Math.max(120, innerHeight - 8);
  const fitW = Math.min(availW, availH * VW / VH);                                   // the largest CSS width that fits both ways
  const kH = availH * dpr / VH + 0.04, kB = Math.floor(Math.min(winW * dpr / VW, kH));
  let k = Math.floor(Math.min(availW * dpr / VW, kH));
  const bleed = !coarse.matches && kB > k; if (bleed) k = kB;
  stage.classList.toggle('bleed', bleed);
  const intW = VW * k / dpr;                                                          // the integer size, CSS px
  const crisp = k >= 1 && (!coarse.matches || fitW < FIT_GAIN * intW || (intW >= 0.9 * fitW && S.SCALE.hero * k / dpr >= HERO_CSS));
  const wDev = crisp ? VW * k : Math.max(100, Math.floor(fitW * dpr)), hDev = Math.round(wDev * VH / VW);   // device px
  const cssW = wDev / dpr, cssH = hDev / dpr;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  cv.classList.toggle('smooth', !crisp && (wDev / VW < 1 || (wDev / VW < 2 && dpr < 2)));
  root.style.setProperty('--stage-w', Math.ceil(cssW + (bleed ? 0 : 4)) + 'px');
  LVL.scale = cssW / VW; LVL.dscale = wDev / VW; LVL.crisp = crisp; HUD.k = LVL.scale < 0.5 ? 4 : 3;
  // snap the canvas's top-left onto the device pixel grid (document coordinates, so scrolling keeps it)
  cv.style.left = cv.style.top = '0px';
  const b = cv.getBoundingClientRect(), x = (b.left + scrollX) * dpr, y = (b.top + scrollY) * dpr;
  cv.style.left = (Math.round(x) - x) / dpr + 'px'; cv.style.top = (Math.round(y) - y) / dpr + 'px';
}
addEventListener('resize', fit); coarse.addEventListener('change', fit);
// zoom / moving the window to a screen with another pixel ratio: re-fit (one-shot listener on the current ratio, re-armed)
(function watchDpr(){ const mq = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`); const h = () => { mq.removeEventListener('change', h); fit(); watchDpr(); }; mq.addEventListener('change', h); })();
// anything above the stage changing height (web fonts arriving, the lead re-wrapping) shifts it: re-snap
if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(document.querySelector('header') || document.body);

// ---------- update ----------
function update(){
  frame++; updMovers(DT);
  const p = player, y0 = p.y, wasGround = p.ground, wasClimb = p.climb, from = p.airY;
  // ride the cage down out of the level (a roll he rode in on plays out on the spot: its clock runs on, into its guard)
  if (winT > 0){ if (cage.dy > 0) p.y += cage.dy; if (p.rollT !== null && (p.rollT += DT) >= roll.dur) endRoll(p); if (--winT === 0){ p.cp = 0; spawnAt(0); snapCam(); } }
  if (deathT > 0){ if (--deathT === 0){ spawnAt(p.cp); snapCam(); } }
  if (playing && winT === 0 && deathT === 0){
    stepPlayer(DT);
    for (let i = M.CHECK.length - 1; i > p.cp; i--) if (p.x > M.CHECK[i] * TS){ p.cp = i; stats.cps.push({ i, frame }); break; }
    if (p.on === cage && cage.dir > 0 && cage.y > LH - 4 * K){ winT = 220; p.vx = 0; stats.wins++; stats.log.push({ win: frame }); }   // riding it DOWN (standing)
    else if (p.y > LH + 16 * K){ deathT = 50; stats.deaths++; stats.log.push({ death: frame, x: Math.round(p.x) }); }   // out of the level
  }
  animate(DT);
  if (playing){
    camX += (camTarget() - camX) * CAM.rate;
    // feet back on a floor (a landing, the end of a climb): an arrival settles the camera to the surface's rest, a step or a hop
    // leaves it to the dead zone, and a hop in place (back onto the floor he took off from) keeps what he had there - the settle
    // to the rest still running after a climb or a jump onto the belt, the look-down at a roof edge; that hold runs down only
    // while he stands with no drop ahead (in the air it is kept)
    if (p.ground && (!wasGround || wasClimb)) vcam.rest = arrival(from, p.y + P.H) || (vcam.rest && p.y + P.H === from);
    const drop = dropAhead(p);
    if (drop !== null){ vcam.peekY = drop; vcam.peekT = CAM.peekHold; } else if (p.ground) vcam.peekT = Math.max(0, vcam.peekT - DT);
    // y: the ease toward the target, CAM.pan px a step at most (SPEED in the header); falling, never further down than he fell
    // this step (he never rises on screen); climbing, free
    let dy = (camTargetY(camY, drop) - camY) * CAM.rateY;
    if (!p.climb) dy = clamp(dy, -CAM.pan, !p.ground && p.vy > 0 ? Math.max(0, p.y - y0) : CAM.pan);
    camY = camGuard(camY + dy);
  }
  else if (!reduceMotion && tourDir){ camX += tourDir * 84 * K * DT; if (camX > LW - VW){ camX = LW - VW; tourDir = -1; } if (camX < 0){ camX = 0; tourDir = 1; } }
  A.fx.update({ cx: viewX(), cy: viewY(), t: frame, reduceMotion });
  edge.jump = edge.up = edge.roll = edge.cut = false;
}

// Integer camera for drawing. While playing, it is derived from the hero: his frame x is round(heroX - camX) (unrounded hero x),
// which only changes when the camera's lag changes, and the world is shifted to match his whole-pixel position; so he does not
// flicker 1 px against the frame while the world scrolls under him (rounding hero and camera separately does, at any speed that
// is not a whole number of px per frame). The same for y (his feet).
function viewX(){
  if (!playing) return Math.round(camX);
  const p = player, hx = heroAnchor(0, 0)[0];
  return clamp(hx - Math.round(p.x + P.W / 2 - camX), 0, LW - VW);
}
function viewY(){
  if (!playing) return Math.round(camY);
  const p = player, hy = heroAnchor(0, 0)[1];
  return clamp(hy - Math.round(p.y + P.H - camY), 0, LH - VH);
}

// ---------- render: layer compositing, back to front ----------
let game = null;      // static playfield (LW x LH): pit backs, props behind, tiles, props in front
function buildGame(){ const [c, g] = mk(LW, LH); A.tiles.drawBack(g); A.props.drawBack(g); A.tiles.draw(g); A.props.drawFront(g); game = c; }
function render(){
  const v = { cx: viewX(), cy: viewY(), t: frame, reduceMotion };
  ctx.fillStyle = '#0c0a0c'; ctx.fillRect(0, 0, VW, VH);
  if (vis.sky) A.bg.drawSky(ctx, v);                                               // 0.00 (+ airship 0.04)
  for (const id of ['far', 'midfar', 'mid']) if (vis[id]){                         // 0.15 / 0.32 / 0.60, each farther one under more smog
    A.fx.drawLayerBack(ctx, id, v); A.bg.drawLayer(ctx, id, v); if (id !== 'mid') A.fx.drawHaze(ctx, id, v); }
  A.fx.drawHaze(ctx, 'lane', v);                                                   // ground fog + the colony's smog bank: always on
  if (vis.game){                                                                   // 1.00
    ctx.drawImage(game, v.cx, v.cy, VW, VH, 0, 0, VW, VH);
    A.tiles.drawAnim(ctx, v);
    A.props.drawDynamic(ctx, v, cage);
    // a mover's front parts (the cage's bars and posts, the bucket's near wall) go over the hero while his hitbox is inside its
    // span, else behind him (at the shaft's lip his face is in front of the cage's post)
    const inside = m => player.x + P.W > m.x && player.x < m.x + m.w;
    for (const m of movers){ A.props.drawMover(ctx, m, v); if (!inside(m)) A.props.drawMoverFront(ctx, m, v); }
    A.fx.drawPlayBack(ctx, v);
    if (deathT === 0 || (deathT & 4)) drawPlayer(ctx, v.cx, v.cy);
    for (const m of movers) if (inside(m)) A.props.drawMoverFront(ctx, m, v);
    A.fx.drawPlayFront(ctx, v);
  }
  if (vis.fg) A.bg.drawFg(ctx, v);                                                 // 1.35 across, 1.00 up and down
  if (vis.ash) A.fx.drawAsh(ctx, v);                                               // screen space
  if (showGrid) drawGrid(v.cx, v.cy);
  if (LVL.debug.hud) drawHud(v.cx);
}
function drawGrid(cx, cy){
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffb84a';
  for (let cl = Math.floor(cx / TS); cl <= Math.floor((cx + VW) / TS); cl++) ctx.fillRect(cl * TS - cx, 0, 1, VH);
  for (let r = 0; r <= M.MH; r++) ctx.fillRect(0, r * TS - cy, VW, 1);
  ctx.globalAlpha = 1;
  for (let cl = Math.ceil(cx / TS / 10) * 10; cl * TS < cx + VW; cl += 10){ R(ctx, cl * TS - cx, 0, 1, VH, '#ffb84a'); txt(ctx, String(cl), cl * TS - cx + 4, VH - 20, '#ffb84a', PIX16); }
  for (const s of M.SEGS){ const x = s[0] * TS - cx; if (x > -4 && x < VW){ R(ctx, x, 0, 2, VH, '#c06a3a'); txt(ctx, s[1], x + 6, 40, '#e8dcc0', PIX16); } }
  for (const c of M.CHECK){ const x = c * TS - cx; if (x > -TS && x < VW){ ctx.globalAlpha = 0.6; R(ctx, x, 0, TS, 4, '#7c8a86'); ctx.globalAlpha = 1; } }
}
// HUD text: style.js's baked font at HUD.k x its pixel (3 x 3 px: caps 15 px tall, 1/36 of the frame's height - 15 CSS px on a
// laptop's x1 page, 30 at x2 in 1080p; 4 x 4 when the frame is shown under half size, a phone in portrait: caps ~8 CSS px there
// instead of ~5, fit() sets it): txt()'s cached 1 px bitmap drawn through a whole-pixel scale (no smoothing). HUD.m: the panels'
// distance from the frame's edges; HUD.px / HUD.py: the text's padding in its panel.
const HUD = { k: 3, m: 16, px: 14, py: 10 };
const hudW = s => tw(null, s) * HUD.k;
function hudText(s, x, y, col){                         // the em box's top-left at (x, y): caps from y + k to y + 6 k
  ctx.setTransform(HUD.k, 0, 0, HUD.k, Math.round(x), Math.round(y)); txt(ctx, s, 0, 0, col); ctx.setTransform(1, 0, 0, 1, 0, 0);
}
// A label in a dark panel whose top-left is (x, y).
function hudLabel(s, x, y, col){
  R(ctx, x, y, hudW(s) + 2 * HUD.px, 5 * HUD.k + 2 * HUD.py, 'rgba(12,8,10,.75)'); hudText(s, x + HUD.px, y + HUD.py - HUD.k, col);
}
function drawHud(cx){
  const mid = (cx + VW / 2) / TS; let seg = M.SEGS[0]; for (const s of M.SEGS) if (mid >= s[0]) seg = s;
  hudLabel(seg[1] + ' · ' + seg[2], HUD.m, HUD.m, '#e8dcc0');
  if (!playing){ const m = 'ZWIEDZANIE · KLAWISZ = GRA'; hudLabel(m, VW - HUD.m - hudW(m) - 2 * HUD.px, HUD.m, '#ffb84a'); }
  if (winT > 0){                                       // two lines over the frame's centre (he sinks into the shaft under it)
    const a = 'ZJAZD NA POZIOM 620 M', b = 'KONIEC PLANSZY', w = Math.max(hudW(a), hudW(b)) + 16 * HUD.k, lh = 5 * HUD.k, h = 5 * lh, y = VH / 2 - h;
    R(ctx, (VW - w) / 2, y, w, h, 'rgba(12,8,10,.88)'); R(ctx, (VW - w) / 2, y, w, HUD.k, '#ffb84a');
    hudText(a, (VW - hudW(a)) / 2, y + lh - HUD.k, '#ffb84a'); hudText(b, (VW - hudW(b)) / 2, y + 3 * lh - HUD.k, '#e8dcc0');
  }
}

// ---------- loop ----------
let last = performance.now(), acc = 0;
function loop(now){
  acc += Math.min(100, now - last); last = now;
  if (LVL.debug.manual) acc = 0; else while (acc >= 1000 / 60){ update(); acc -= 1000 / 60; }
  render(); requestAnimationFrame(loop);
}

// ---------- test / debug hooks ----------
LVL.debug = {
  manual: /[?&]manual(=|&|$)/.test(location.search),
  hud: true,                                                                          // false: render() leaves the HUD out
  step(n = 1){ for (let i = 0; i < n; i++) update(); render(); return this.state(); },
  tick(n = 1){ for (let i = 0; i < n; i++) update(); return this.state(); },        // like step, without rendering (fast bots)
  state(){ const p = player; return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, cvx: p.cvx, ground: p.ground, climb: p.climb, on: p.on && p.on.id, face: p.face,
    crouch: p.crouch, spot: p.spot, rollT: p.rollT, rollK: p.rollK, rollV: p.rollV, rollStop: p.rollStop, alertT: p.alertT,
    anim: p.anim, clip: p.clip && p.clip.name, set: p.clip && (p.clip.mirror ? 'mirror' : p.face < 0 ? 'left' : 'right'), safety: p.clip && p.clip.safety,
    fi: p.fi, af: p.af, jumping: p.jumping, cp: p.cp, frame, winT, deathT, playing, camX, camY, camRest: vcam.rest,
    cx: viewX(), cy: viewY(), screen: heroAnchor(viewX(), viewY()), sprite: heroRect(viewX(), viewY()), drawn: heroDrawn(viewX(), viewY()),   // integer camera, the hero's anchor, frame rect and drawn box in the frame
    movers: Object.fromEntries(movers.map(m => [m.id, { x: m.x, y: m.y, dir: m.dir, waitT: m.waitT }])), stats }; },
  spawn(i){ player.cp = i; spawnAt(i); winT = deathT = 0; setPlay(true); snapCam(); },
  cam(x, y){ camX = x; camY = y === undefined ? arrivedY() : y; tourDir = 0; },
  snap(){ snapCam(); return { camX, camY }; },
  place(x, feetY){ Object.assign(player, { x, y: feetY - P.H, vx: 0, vy: 0, ground: true, climb: false, on: null, coyT: 0, bufT: 0, rbufT: 0, jumping: false,
    landT: 0, airT: 0, airY: feetY, cvx: 0, crouch: false, rollT: null, rollV: 0, alertT: 0, rollStop: false, spot: false, anim: 'idle', af: 0, animT: 0 }); },
  roll: () => roll,                                                                   // the roll's timing (rollOf)
  setPlay, keys, P, CAM, movers, player, headroom: () => M.checkHeadroom(), fit
};
LVL.engine = { P, DT, update, render, movers, player, spawnAt, stats, game: () => game };

// ---------- boot ----------
function boot(){
  if (LVL.ready) return;
  A.bg.build(); A.props.build(); buildGame();
  spawnAt(0); camX = 0; fit(); render(); requestAnimationFrame(loop);
  LVL.ready = true;
}
LVL.sheetLoad = loadSheet();
// The build bakes the owner's model sprites into the static canvases (art/models.js, LOAD CONTRACT), so it waits for their atlas
// (a few ms; load() never rejects and gives up on a hung request: without it every caller paints its fallback); canvas text is
// style.js's baked pixel font. Until then the stage shows a loading line, not a blank canvas (a hung request: models.js
// LOAD_TIMEOUT).
fit(); ctx.fillStyle = '#0c0a0c'; ctx.fillRect(0, 0, VW, VH); hudLabel('ŁADOWANIE...', HUD.m, HUD.m, '#e8dcc0');
A.models.load().then(boot);
})();
