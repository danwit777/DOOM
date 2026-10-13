// Hero sprite-sheet exporter: renders the 3D hero (hero3d/index.html) in headless Chromium and packs the level's sprite sheet.
//
//   node level/tools/export_hero.mjs [--hero <index.html>] [--out <dir>] [--px 96] [--yaw 0.35] [--clips idle,walk,...]
//                                    [--three <three.min.js>] [--gltf <GLTFLoader.js>] [--frames <dir>]
//   (each option also reads an environment variable: HERO_HTML, HERO_OUT, HERO_PX, HERO_YAW, HERO_CLIPS, THREE_JS, GLTF_LOADER,
//    HERO_FRAMES; the defaults are this repo's hero3d/index.html, this repo's level/, the level's hero height - SCALE.hero of
//    level/js/style.js -, yaw 0.35 (the game view, the hero page's SIDE_YAW) and every clip: the platformer clips idle, walk, run,
//    jump_up, jump_apex, fall, land, climb and the tactical moves crouch_in, crouch, crouch_out, crouchwalk, sneak, lowrun, roll,
//    alert, alert_in, alert_out)
//
// Writes <out>/hero.png (transparent atlas, ATLAS_W px wide: every frame shelf-packed, the clips tallest first, each clip's frames
// left to right, a new shelf when the next frame does not fit) and <out>/hero.json:
//   { "px": 96, "yaw": 0.35, "anims": { "<name>": { "fps", "loop", ["speed" | "dy", "lx" | "tx", "travel", "commit",] "frames": [
//       { "x", "y", "w", "h", "ax", "ay", "opaque" } ] } }, "left": { "yaw": 2.7916, "anims": { ...the same clips... } } }
// TWO FACINGS. "anims" face RIGHT: the camera at yaw sees the hero nearly in profile, turned a little toward the viewer, walking
// toward screen right. "left" holds the same clips facing LEFT, rendered from the model itself by a camera at pi - yaw (the hero
// seen walking toward screen left) - not mirrored: the character shader's key light is fixed in view space (upper left), so both
// facings are lit from the upper left, and the pauldron stays on his LEFT shoulder (the far one facing right, the near one facing
// left), where a mirror would light him from the upper right and move it to the other shoulder. Every facing is its own run of the
// whole simulation from a freshly loaded page (deterministic: fixed sub-steps from the same start), so frame i of a clip is the
// same instant of the motion in both. The climb is posed toward the camera (the hero page turns it by S.view, which follows the
// camera), so both facings show him from behind, the pauldron on the screen-left shoulder. A reader that only knows "anims" may
// still mirror them for left (the old contract).
// x, y, w, h: the frame's rect in the atlas; (ax, ay): the ground anchor, in pixels from the frame's top-left - the point on the
// ground under the hips, between the feet (a pixel-edge coordinate: the boots stand on the row boundary ay, their 1 px outline is the
// row just below it); "opaque": [x0, y0, x1, y1], the frame's opaque pixels' bounding box in frame px (x1, y1 exclusive: what the
// game needs of the drawn silhouette - its height over the anchor, how far it reaches ahead of and behind it). Every clip is rendered
// by the same fixed camera with the hero at the origin, so the anchor is one world point in every frame: airborne clips keep it too
// (it is where the feet would stand; the legs may tuck above it or reach below it) and the game can draw any frame at the body's
// ground point without a jump between clips. The ground clips (idle, walk, run, land) are then snapped onto it: ay is their lowest
// boot row, so a clip whose 3D feet never quite reach the floor (the walk, by ~1 px) does not float or bob when the game switches
// clips; so are the moves (MOVES below) - the PLANTED ones (a boot on the floor in every frame: the crouch, the alert, their
// transitions, the crouch walk, the sneak) frame by frame, each frame's ay its own lowest row (the hero page's blend into the crouch
// dips the boots up to ~4 px through its floor; one shared ay would float the other frames), and the roll's frames on the floor
// (every one but the dive's: the set-off, the tumble over his back and the get-up stand their lowest row - boots, shoulders, back -
// on the ground line; the dive, its frames lifted more than ROLL_SNAP px from the first one on, keeps the shared ay: off the floor).
// Frames of one animation (per facing) share w, h, ax and, but for those, ay (the union of their bounds + 1 transparent pixel, so
// nothing bleeds between neighbours).
// The climb's anchor is on the ladder's centre line (the gripping hands' midpoint) and its entry carries two extra fields a plain
// reader may ignore: "dy", how many pixels the body rises per frame while the hands grip - the game should climb at dy * fps px/s
// (at 96 px: 3.69 px per frame, ~29.5 px/s; 0.6 m/s) or advance the frames by the distance climbed / dy, so the hands stay planted
// on the rungs instead of sliding - and "lx", the gloves' midpoint relative to ax as DRAWN in that facing's own frames (the centroid
// of the opaque pixels within 0.1 m of each projected hand bone). Drawn, not projected: the world origin falls on a pixel centre
// (the frame canvas is odd-sized) and the hero page rounds that tie to the anchor column one way for one camera and the other way
// for the other, so the two facings' near-identical climb images sit 1 px apart from their anchors - which only the pixels show.
// Both are also printed with the summary.
// The hero page must have the platformer clips (window.HERO.CLIPS: jump_up, jump_apex, fall, land, climb) and, for the moves, the
// tactical moves (window.HERO.moves, from the anims.json next to it); a page without what --clips asks for is refused with a message
// before anything is rendered.
// MOVES (the hero page's MGS-style mocap, HERO.MOVES / HERO.moves; played as the page plays them, setAnim(name) blending from the
// stance before, at each move's own rate). Screen numbers: a metre of travel along his facing is |cos(yaw)| x ppu px across the
// screen (the orthographic camera foreshortens it; ppu = px / the page's CHAR_H), the same in both facings.
//   crouch_in / crouch_out: TRANS.n frames at TRANS.fps of the page's blend from a settled idle into the held crouch / back; once.
//   crouch: the held crouch (a pose, breathing at 2.1 rad/s and looking slowly round at 0.7: the page's moveBody / moveHead), TRANS.held
//     frames over one look-round (3 breaths); loop.
//   alert_in / alert_out: the same of the guard (alert): from a settled idle into it / from its loop back to idle; once.
//   crouchwalk, sneak, lowrun: one cycle of the in-place loop (the clip's duration at its rate), GAITS frames; loop. "speed": the
//     ground speed in px/s the frames stand for (HERO.moves speed x the projection above): moving the body at speed while the frames
//     play at fps keeps the planted foot still on the ground; at another speed the game scales the frame rate by speed / that.
//   roll: ROLL_N frames from the switch (a settled idle; the boots held where they stood until the clip lifts them: MOVES plant) to
//     the end of the clip, at fps = (ROLL_N - 1) / its duration; once. The hips stay over the anchor: the clip's root motion (HERO.moves
//     rm) is the game's to add - "tx": per frame, how far the body has travelled along his facing since frame 0 (px, at that frame's
//     instant, so tx[0] = 0; the game interpolates it between frames), "travel": its last value, "commit": s from frame 0 to the
//     page's commit point (MOVES commit / rate: over the tumble, his feet under him again; the page queues any other anim asked for
//     before it).
//   alert: ALERT_N frames over its loop (the guard up, a slow look round); loop.
//
// The clips are simulated in one continuous run, sub-stepped at 1/120 s, so the coat's secondary motion carries over the way it does
// in the game: idle / walk / run after a warm-up (walk / run: one cycle, the period read off the foot path); jump_up straight from a
// settled idle, jump_apex where the rise ends, fall after it has fluttered for a while (one loop), land straight out of the fall;
// climb after a warm-up; then the moves (MOVES above), each from a settled stance. The non-looping clips (jump_up, jump_apex, land)
// are their key poses; their coat comes from the arc they stand for (the hero page feeds the coat the jump's vertical speed /
// acceleration, the hero itself stays in place). Between two keys the simulation runs one sprite interval - or, in free flight, the
// arc's own time between their speeds (|dvy| / g): the apex's second key is the fall setting in (~0.4 s past the top), so its coat has
// started to lift and the fall's flared coat does not pop in. The moves come after the rest, so adding them left every other clip's
// pixels as they were.
//
// Needs Playwright (Chromium) - by default the global install under /opt/node22; set PLAYWRIGHT to its index.mjs elsewhere.
// three.js r128 and its GLTFLoader are served from local copies when there are any (offline): --three / --gltf, else the npm package
// 'three' as Node finds it from this repo or the current directory (node_modules, NODE_PATH); otherwise the page loads them from
// its CDN.
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { createRequire } from 'module'; import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
// the 'three' package's directory, if Node finds one from the repo or the current directory ('' if not)
const THREE_PKG = [REPO, process.cwd()].map(d => { try { return path.dirname(createRequire(path.join(d, 'x.js')).resolve('three/package.json')); } catch (e){ return ''; } }).find(Boolean) || '';
const argv = process.argv.slice(2), fail = m => { console.error(m); process.exit(2); };
const opt = (name, env, def) => { const i = argv.indexOf('--' + name);
  if (i < 0) return process.env[env] ?? def;
  if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) fail('--' + name + ' needs a value'); return argv[i + 1]; };
const num = (name, env, def, lo, hi) => { const s = opt(name, env, def), v = Number(s);
  if (s === '' || !Number.isFinite(v) || v < lo || v > hi) fail(`--${name} (${env}): expected a number in [${lo}, ${hi}], got "${s}"`); return v; };
if (argv.includes('--help') || argv.includes('-h')){ console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 6).join('\n')); process.exit(0); }
const htmlPath = path.resolve(opt('hero', 'HERO_HTML', path.join(REPO, 'hero3d/index.html')));
const outDir = path.resolve(opt('out', 'HERO_OUT', path.join(REPO, 'level')));
// the level's hero height: SCALE.hero of level/js/style.js (evaluated: it touches no DOM while it loads)
const levelHero = () => { const w = {}; try { vm.runInNewContext(fs.readFileSync(path.join(REPO, 'level/js/style.js'), 'utf8'), { window: w }); return String(w.LVL.style.SCALE.hero); }
  catch (e){ fail('could not read SCALE.hero from level/js/style.js (' + e.message + '): pass --px'); } };
const pxGiven = argv.includes('--px') || process.env.HERO_PX !== undefined;
const px = Math.round(num('px', 'HERO_PX', pxGiven ? '' : levelHero(), 16, 512)), yaw = num('yaw', 'HERO_YAW', '0.35', -Math.PI, Math.PI);
const yawLeft = +(Math.PI - yaw).toFixed(4);            // the left-facing camera: the same view of the hero turned the other way
const THREE_JS = opt('three', 'THREE_JS', THREE_PKG && path.join(THREE_PKG, 'build/three.min.js')), GLTF = opt('gltf', 'GLTF_LOADER', THREE_PKG && path.join(THREE_PKG, 'examples/js/loaders/GLTFLoader.js'));
const framesDir = opt('frames', 'HERO_FRAMES', '');
// the platformer clips (HERO.CLIPS + the GLB's walk / run) and the tactical moves (HERO.moves: anims.json next to the hero page)
const BASE = ['idle', 'walk', 'run', 'jump_up', 'jump_apex', 'fall', 'land', 'climb'];
const MOVES = ['crouch_in', 'crouch', 'crouch_out', 'crouchwalk', 'sneak', 'lowrun', 'roll', 'alert', 'alert_in', 'alert_out'];
const ALL = [...BASE, ...MOVES];
// frames per move: crouch_in / crouch_out (and alert_in / alert_out) n frames at fps (the page's blend between the stance and the
// crouch / the guard), the held crouch 'held' frames over one look-round; the gaits [name, frames per cycle]; the roll ROLL_N frames
// from its first to its last pose; the alert ALERT_N frames over its loop
const TRANS = { n: 4, fps: 12.5, held: 24 }, GAITS = [['crouchwalk', 12], ['sneak', 12], ['lowrun', 8]], ROLL_N = 23, ALERT_N = 16;
// the moves with a boot on the floor in every frame (both, or one planted while the other steps): each frame stands its own lowest
// row on the ground line (the page's blend into and out of the crouch dips the boots up to ~4 px through its floor, the held crouch
// 2 px; a shared ay would float the others). The low run (flight phases) keeps the shared one, like the run; the roll snaps every
// frame but its dive's (the first run of frames lifted more than ROLL_SNAP px over its lowest row: the 3D body lies ~1 px over the
// floor on its back, the flip over the shoulders lifts it ~5 px, the dive itself ~4 px).
const PLANTED = ['crouch_in', 'crouch', 'crouch_out', 'crouchwalk', 'sneak', 'alert', 'alert_in', 'alert_out'], ROLL_SNAP = 2;
// the atlas's width (px): about square for the sheet at 96 px, ~1.8 Mpx at 95 % use (one row per clip would be 6.4 Mpx at 26 %)
const ATLAS_W = 1024;
const want = opt('clips', 'HERO_CLIPS', ALL.join(',')).split(',').filter(Boolean);
for (const c of want) if (!ALL.includes(c)) fail('unknown clip: ' + c + ' (known: ' + ALL.join(', ') + ')');
if (!want.length) fail('no clips to export');
if (!fs.existsSync(htmlPath)) fail('hero page not found: ' + htmlPath);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs').href);

const dir = path.dirname(htmlPath), page = path.basename(htmlPath);
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 820 } });
const errors = []; p.on('pageerror', e => errors.push(e.message));
if (fs.existsSync(THREE_JS)) await p.route('**/three.min.js', r => r.fulfill({ path: THREE_JS, contentType: 'text/javascript' }));
if (fs.existsSync(GLTF)) await p.route('**/GLTFLoader.js', r => r.fulfill({ path: GLTF, contentType: 'text/javascript' }));
await p.route('**/fonts.googleapis.com/**', r => r.abort());
// the page's directory is served at http://hero.local/ (it fetches its model, hero.json / hero.glb, next to itself)
await p.route('http://hero.local/**', r => { const u = new URL(r.request().url()), f = path.join(dir, decodeURIComponent(u.pathname));
  if (u.pathname === '/' + page) r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(f, 'utf8') + '</body></html>' });
  else if (fs.existsSync(f) && fs.statSync(f).isFile()) r.fulfill({ path: f }); else r.fulfill({ status: 404, body: 'not found' }); });
// manual from the first frame: the page's own requestAnimationFrame loop would otherwise step the hero (and its coat) on wall-clock
// time before the export takes over, and every run would start from a slightly different coat
await p.addInitScript(() => { window.__manual = true; });
const bail = async m => { console.error(m + (errors.length ? ':\n' + errors.join('\n') : '')); await b.close(); process.exit(1); };

// One facing: load the page afresh, simulate every clip, crop each clip to the union of its frames (+1 px). Returns per clip its
// fps / loop / extra fields, the shared rect size and anchor, and the frames as PNG data URLs (packed into the atlas below).
async function renderFacing(camYaw){
  await p.goto('http://hero.local/' + page);
  try { await p.waitForFunction(() => window.HERO && window.HERO_READY !== false, null, { timeout: 120000 }); }
  catch (e){ await bail('the hero page did not load'); }
  const lacks = await p.evaluate(([want, base]) => { const C = window.HERO.CLIPS; return C ? want.filter(n => base.includes(n) && !['idle', 'walk', 'run'].includes(n) && !C[n]) : null; }, [want, BASE]);
  if (!lacks) await bail(`the hero page has no platformer clips (HERO.CLIPS): pass --hero <a hero page with them> (got ${htmlPath})`);
  if (lacks.length) await bail(`the hero page lacks the clips ${lacks.join(', ')} (HERO.CLIPS): pass --hero <a page with them> or --clips without them`);
  // a move is the hero page's HERO.moves entry of its name (crouch_in / crouch_out: of crouch); the page loads them from anims.json
  const noMoves = await p.evaluate(([want, mv]) => want.filter(n => mv.includes(n) && !(window.HERO.moves || {})[n.replace(/_(in|out)$/, '')]), [want, MOVES]);
  if (noMoves.length) await bail(`the hero page has no tactical moves ${noMoves.join(', ')} (HERO.moves: anims.json next to the page): pass --clips without them`);
  return p.evaluate(async ([px, yaw, want, { MOVES, TRANS, GAITS, ROLL_N, ALERT_N, PLANTED, ROLL_SNAP }]) => {
    const H = window.HERO, T = H.T, S = H.S, CL = H.CLIPS, cv = document.getElementById('c');
    const F = Math.max(128, Math.ceil(px * 2.2)); H.frame(F, F, px);
    H.setWeapon('none'); S.yaw = yaw; S.view = yaw; S.spin = false;      // S.view: the camera the climb pose turns toward
    const H0 = 1/120;
    // (never update(0): three.js' mixer only writes a track whose value changed, and update() resets the bones to the bind pose first,
    // so a zero step would drop the walk / run clip's pose for that frame)
    const run = secs => { if (secs <= 0) return; let n = Math.max(1, Math.round(secs / H0)); const h = secs / n; while (n--) H.update(h); };
    // one frame: render on a transparent background, copy the pixels out of the WebGL canvas
    const grab = () => { H.render(true); const c = document.createElement('canvas'); c.width = F; c.height = F;
      const x = c.getContext('2d'); x.drawImage(cv, 0, 0); return c; };
    const clips = {};
    // a bone's sprite position: pixels right of / below the anchor (the world origin; orthographic camera at yaw)
    const R = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), spr = n => { const w = H.B[n].getWorldPosition(new T.Vector3()); return [w.dot(R)*S.ppu, -w.y*S.ppu]; };
    const take = (name, fps, loop, times) => {   // times: seconds to advance before each frame (ts: the page clock at each frame)
      const fr = [], hands = [], ts = []; for (const dt of times){ run(dt); fr.push(grab()); hands.push([spr('hand_r'), spr('hand_l')]); ts.push(S.t); }
      clips[name] = { fps, loop, frames: fr, hands, ts, extra: {}, gx: H.post.uniforms.shC.value.x, gy: H.post.uniforms.groundY.value };
    };
    const evenly = (n, period) => Array.from({ length: n }, (_, i) => i ? period / n : 0);
    // foot-path period of a cycle (smallest lag that repeats the left foot's path)
    const cyclePeriod = () => { const s = []; for (let i = 0; i < 360; i++){ H.update(1/120); s.push(H.B.foot_l.getWorldPosition(new T.Vector3()).toArray()); }
      let best = 1e9, lag = 60; for (let L = 40; L < 240; L++){ let e = 0; for (let i = 0; i + L < s.length; i++) e += (s[i][0]-s[i+L][0])**2 + (s[i][1]-s[i+L][1])**2 + (s[i][2]-s[i+L][2])**2;
        e /= (s.length - L); if (e < best){ best = e; lag = L; } } return lag / 120; };
    const has = n => want.includes(n);
    S.t = 0;
    if (has('idle')){ H.setAnim('idle', true); run(3); const per = 2 * Math.PI / 2.1; take('idle', 8 / per, true, evenly(8, per)); }
    for (const name of ['walk', 'run']) if (has(name)){ H.setAnim(name, true); run(2); const per = cyclePeriod(); take(name, 8 / per, true, evenly(8, per)); }
    // the jump, in one go: idle (settled coat) -> jump_up -> rest of the rise -> jump_apex -> fall (fluttering) -> land
    if (['jump_up', 'jump_apex', 'fall', 'land'].some(has)){
      H.setAnim('idle', true); run(2.5);
      const free = k => Math.abs(k.ay + 9.8) < 0.5;
      const keyed = name => { const C = CL[name], K = C.keys; H.setAnim(name, true);
        take(name, C.fps, C.loop, K.map((k, i) => !i ? 1/240 : Math.max(1 / C.fps, free(k) && free(K[i-1]) ? Math.abs(k.vy - K[i-1].vy) / 9.8 : 0))); };
      keyed('jump_up'); run(0.12);
      keyed('jump_apex'); run(1 / CL.jump_apex.fps);
      H.setAnim('fall', true); run(1.2); take('fall', CL.fall.fps, true, evenly(CL.fall.n, CL.fall.dur));
      keyed('land');
      for (const n of ['jump_up', 'jump_apex', 'fall', 'land']) if (!has(n)) delete clips[n];
    }
    if (has('climb')){ H.setAnim('idle', true); run(1); H.setAnim('climb', true); run(2); take('climb', CL.climb.fps, true, evenly(CL.climb.n, CL.climb.dur)); }
    // the tactical moves (MOVES in the header), each from a settled stance through the page's own blend (setAnim without a cut)
    const MV = H.moves || {}, mvRun = MOVES.filter(has);
    // screen px per metre of travel along his facing (world +X): the orthographic camera at yaw sees it foreshortened by cos(yaw)
    const proj = Math.abs(Math.cos(yaw)) * S.ppu;
    if (mvRun.some(n => n.startsWith('crouch_') || n === 'crouch')){
      H.setAnim('idle'); run(2.5);
      H.setAnim('crouch'); take('crouch_in', TRANS.fps, false, Array(TRANS.n).fill(1 / TRANS.fps));
      run(1.5); const per = 2 * Math.PI / 0.7; take('crouch', TRANS.held / per, true, evenly(TRANS.held, per));
      H.setAnim('idle'); take('crouch_out', TRANS.fps, false, Array(TRANS.n).fill(1 / TRANS.fps));
    }
    for (const [name, n] of GAITS) if (has(name)){
      const m = MV[name]; H.setAnim(name); run(2.5); take(name, n / m.dur, true, evenly(n, m.dur)); clips[name].extra = { speed: +(m.speed * proj).toFixed(2) }; }
    if (has('roll')){
      const m = MV.roll, v = H.MV.roll, fps = (ROLL_N - 1) / m.dur;
      H.setAnim('idle'); run(2.5); H.setAnim('roll'); take('roll', fps, false, Array.from({ length: ROLL_N }, (_, i) => i ? 1 / fps : 1 / 240));
      // root motion at each frame's clip time (m.rm: metres per clip frame at m.fps, the hips held in place), as screen px
      const rm = t => { const f = Math.min(m.rm.length - 1, Math.max(0, t * m.fps)), i = Math.min(m.rm.length - 2, Math.floor(f)); return m.rm[i] + (m.rm[i + 1] - m.rm[i]) * (f - i); };
      const ts = clips.roll.ts, tx = ts.map(t => +((rm(t - v.t0) - rm(ts[0] - v.t0)) * proj).toFixed(2));
      clips.roll.extra = { tx, travel: tx[tx.length - 1], commit: +(H.MOVES.roll.commit / v.d.rate - (ts[0] - v.t0)).toFixed(3) };
    }
    // the guard: its loop from a settled stance, then back to idle from it (alert_out), then into it again from a settled idle
    if (mvRun.some(n => n.startsWith('alert'))){ const m = MV.alert, tr = Array(TRANS.n).fill(1 / TRANS.fps);
      H.setAnim('idle'); run(1); H.setAnim('alert'); run(2.5); take('alert', ALERT_N / m.dur, true, evenly(ALERT_N, m.dur));
      H.setAnim('idle'); take('alert_out', TRANS.fps, false, tr); run(2.5); H.setAnim('alert'); take('alert_in', TRANS.fps, false, tr); }
    for (const n of MOVES) if (!has(n)) delete clips[n];
    // crop every clip to the union of its frames (+1 px)
    const out = [], notes = [];
    // a signed distance in words (the boots over / under the ground plane)
    const off = d => d < 0 ? `${-d} px below` : d > 0 ? `${d} px above` : 'on', span = (a, b) => a === b ? off(a) : `${off(a)} .. ${off(b)}`;
    for (const name of want){
      const c = clips[name]; let x0 = F, y0 = F, x1 = -1, y1 = -1; const low = [], box = [];
      for (const f of c.frames){ const d = f.getContext('2d').getImageData(0, 0, F, F).data, b = [F, F, -1, -1];
        for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (d[(y*F + x)*4 + 3]){ if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; b[3] = y; }
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); low.push(b[3]); box.push(b); }
      // the ground row: the projected world origin; a ground clip stands its lowest boot outline on it (y1: the lowest opaque row); a
      // planted one (PLANTED) each frame's own lowest row; the roll every frame's own but the dive's (the first run of frames lifted
      // more than ROLL_SNAP px over its lowest row)
      let gr = F - c.gy; const planted = PLANTED.includes(name);
      if (planted && low.some(l => l !== gr)) notes.push(`${name}: feet ${span(Math.min(...low.map(l => gr - l)), Math.max(...low.map(l => gr - l)))} the ground plane, each frame's ay snapped to them`);
      else if (!['jump_up', 'jump_apex', 'fall', 'climb'].includes(name) && y1 !== gr){ notes.push(`${name}: feet ${off(gr - y1)} the ground plane, ay snapped to them`); gr = y1; }
      const lift = low.map(l => gr - l > ROLL_SNAP), d0 = lift.indexOf(true); let d1 = d0; while (d1 >= 0 && lift[d1]) d1++;
      const dive = i => name === 'roll' && i >= d0 && i < d1 && d0 >= 0, lows = planted ? low : name === 'roll' ? low.map((l, i) => dive(i) ? gr : l) : null;
      const up = low.map((l, i) => dive(i) ? 0 : gr - l).filter(d => d > 0);
      if (name === 'roll') notes.push(`roll: the dive (frames ${d0}..${d1 - 1}) off the floor; ${up.length} frames on it ${up.length ? span(Math.min(...up), Math.max(...up)) : 'on'} its lowest row, each one's ay snapped to them`);
      x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, ax = c.gx - x0;
      // the climb: rise per frame (the clip's own number, checked against the gripping hands' slide) and the gloves' midpoint as drawn
      // (the ladder): per frame and hand, the centroid of the opaque pixels within 0.1 m of the projected hand bone (canvas: the world
      // origin projects to F / 2 across and F / 2 + cy * ppu down; pixel centres at +0.5), less the anchor gx (see the header: each
      // facing gets its own number; the bone itself stands in where a glove has no pixel near it)
      let extra = c.extra;
      if (name === 'climb'){
        const n = c.frames.length, dy = CL.climb.rise / n * S.ppu, slide = [];
        for (let i = 0; i < n; i++) for (const k of [0, 1]){ const d = c.hands[(i + 1) % n][k][1] - c.hands[i][k][1]; if (d > 0) slide.push(d); }
        const rad = 0.1 * S.ppu, ox = F / 2, oy = F / 2 + S.cy * S.ppu;
        const glove = (d, [hx, hy]) => { const X = ox + hx, Y = oy + hy; let s = 0, m = 0;
          for (let y = Math.floor(Y - rad); y <= Math.ceil(Y + rad); y++) for (let x = Math.floor(X - rad); x <= Math.ceil(X + rad); x++)
            if (x >= 0 && y >= 0 && x < F && y < F && d[(y * F + x) * 4 + 3] && (x + 0.5 - X) ** 2 + (y + 0.5 - Y) ** 2 <= rad * rad){ s += x + 0.5; m++; }
          return m ? s / m : X; };
        const bones = c.hands.map(h => (h[0][0] + h[1][0]) / 2), mids = c.frames.map((f, i) => { const d = f.getContext('2d').getImageData(0, 0, F, F).data;
          return (glove(d, c.hands[i][0]) + glove(d, c.hands[i][1])) / 2 - c.gx; });
        extra = { dy: +dy.toFixed(2), lx: +(mids.reduce((s, v) => s + v, 0) / n).toFixed(1) };
        notes.push(`climb: rise ${extra.dy} px/frame = ${(dy * CL.climb.fps).toFixed(1)} px/s (${(CL.climb.rise / CL.climb.dur).toFixed(2)} m/s); gripping hands slide ` +
          `${Math.min(...slide).toFixed(2)}..${Math.max(...slide).toFixed(2)} px/frame; gloves' midpoint drawn ${Math.min(...mids).toFixed(1)}..${Math.max(...mids).toFixed(1)} px ` +
          `from ax (lx ${extra.lx}; the bones' ${(bones.reduce((s, v) => s + v, 0) / n + ox - c.gx).toFixed(1)})`);
      }
      out.push({ name, fps: +c.fps.toFixed(3), loop: c.loop, extra, w, h, ax, ay: gr - y0, ays: lows && lows.map(l => l - y0),
        opaque: box.map(b => [b[0] - x0, b[1] - y0, b[2] + 1 - x0, b[3] + 1 - y0]),
        frames: c.frames.map(f => { const k = document.createElement('canvas'); k.width = w; k.height = h; k.getContext('2d').drawImage(f, x0, y0, w, h, 0, 0, w, h); return k.toDataURL('image/png'); }) });
    }
    return { clips: out, notes };
  }, [px, camYaw, want, { MOVES, TRANS, GAITS, ROLL_N, ALERT_N, PLANTED, ROLL_SNAP }]);
}
const facings = [['right', yaw, await renderFacing(yaw)], ['left', yawLeft, await renderFacing(yawLeft)]];
if (errors.length) await bail('page errors');

// pack the atlas (ATLAS_W wide): the clips of both facings, tallest first (a shelf then holds frames of about one height), each
// clip's frames left to right, a new shelf when the next frame does not fit; rects come back in the clips' own order
const atlas = await p.evaluate(async ([rows, W]) => {
  const imgs = await Promise.all(rows.map(r => Promise.all(r.frames.map(u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; })))));
  const order = rows.map((r, k) => k).sort((a, b) => rows[b].h - rows[a].h || a - b), rects = [];
  let x = 0, y = 0, sh = 0;
  for (const k of order){ const r = rows[k];
    rects[k] = r.frames.map((u, i) => { if (x + r.w > W){ x = 0; y += sh; sh = 0; } const q = { x, y, w: r.w, h: r.h, ax: r.ax, ay: r.ays ? r.ays[i] : r.ay, opaque: r.opaque[i] };
      x += r.w; sh = Math.max(sh, r.h); return q; }); }
  const at = document.createElement('canvas'); at.width = W; at.height = y + sh; const g = at.getContext('2d'); g.imageSmoothingEnabled = false;
  rows.forEach((r, k) => imgs[k].forEach((im, i) => g.drawImage(im, rects[k][i].x, rects[k][i].y)));
  return { png: at.toDataURL('image/png'), rects, size: [at.width, at.height] };
}, [facings.flatMap(([, , f]) => f.clips.map(c => ({ w: c.w, h: c.h, ax: c.ax, ay: c.ay, ays: c.ays, opaque: c.opaque, frames: c.frames }))), ATLAS_W]);
await b.close();

const anims = [];
{ let k = 0; for (const [, , f] of facings) anims.push(Object.fromEntries(f.clips.map(c => [c.name, { fps: c.fps, loop: c.loop, ...c.extra, frames: atlas.rects[k++] }]))); }
const J = { px, yaw, anims: anims[0], left: { yaw: yawLeft, anims: anims[1] } };
const png = s => Buffer.from(s.split(',')[1], 'base64');
fs.writeFileSync(path.join(outDir, 'hero.png'), png(atlas.png));
// compact JSON: one frame per line
const block = (A, ind) => { const L = [];
  Object.entries(A).forEach(([n, a], i, all) => {
    const ext = Object.entries(a).filter(([k]) => !['fps', 'loop', 'frames'].includes(k)).map(([k, v]) => `, "${k}": ${JSON.stringify(v)}`).join('');
    L.push(`${ind}"${n}": { "fps": ${a.fps}, "loop": ${a.loop}${ext}, "frames": [`);
    a.frames.forEach((f, k) => L.push(ind + '  ' + JSON.stringify(f).replace(/,/g, ', ').replace(/:/g, ': ') + (k < a.frames.length - 1 ? ',' : '')));
    L.push(ind + '] }' + (i < all.length - 1 ? ',' : ''));
  }); return L; };
const lines = ['{', `  "px": ${J.px}, "yaw": ${J.yaw},`, '  "anims": {', ...block(J.anims, '    '), '  },',
  `  "left": { "yaw": ${J.left.yaw}, "anims": {`, ...block(J.left.anims, '    '), '  } }', '}'];
fs.writeFileSync(path.join(outDir, 'hero.json'), lines.join('\n') + '\n');
if (framesDir){ fs.mkdirSync(framesDir, { recursive: true });
  for (const [side, , f] of facings) for (const c of f.clips) c.frames.forEach((d, i) => fs.writeFileSync(path.join(framesDir, `${c.name}${side === 'left' ? '_l' : ''}_${i}.png`), png(d))); }
console.log('wrote', path.join(outDir, 'hero.png'), `(${atlas.size.join(' x ')} px) and hero.json:`);
for (const [side, y, f] of facings){
  console.log(`  ${side} (camera yaw ${y}):`);
  for (const c of f.clips) console.log(`    ${c.name.padEnd(10)} ${String(c.frames.length).padStart(2)} frames  ${String(c.fps).padStart(6)} fps  ${c.loop ? 'loop' : 'once'}  ${c.w}x${c.h}  anchor ${c.ax},` +
    (c.ays ? Math.min(...c.ays) + (Math.max(...c.ays) > Math.min(...c.ays) ? '..' + Math.max(...c.ays) : '') : c.ay) + (c.extra.speed ? `  ${c.extra.speed} px/s` : '') + (c.extra.travel ? `  travel ${c.extra.travel} px, commit ${c.extra.commit} s` : ''));
  for (const m of f.notes) console.log('    ' + m);
}
