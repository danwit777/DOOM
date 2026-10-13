// Hero sprite-sheet exporter: renders the 3D hero (hero3d/index.html) in headless Chromium and packs the level's sprite sheet.
//
//   node level/tools/export_hero.mjs [--hero <index.html>] [--out <dir>] [--px 96] [--yaw 0.35] [--clips idle,walk,...]
//                                    [--three <three.min.js>] [--gltf <GLTFLoader.js>] [--frames <dir>]
//   (each option also reads an environment variable: HERO_HTML, HERO_OUT, HERO_PX, HERO_YAW, HERO_CLIPS, THREE_JS, GLTF_LOADER,
//    HERO_FRAMES; the defaults are this repo's hero3d/index.html, this repo's level/, the level's hero height - SCALE.hero of
//    level/js/style.js -, yaw 0.35 (the game view, the hero page's SIDE_YAW) and every clip)
//
// Writes <out>/hero.png (transparent atlas, one row per animation, frames packed left to right) and <out>/hero.json:
//   { "px": 96, "yaw": 0.35, "anims": { "<name>": { "fps", "loop", "frames": [ { "x", "y", "w", "h", "ax", "ay" } ] } },
//     "left": { "yaw": 2.7916, "anims": { ...the same clips... } } }
// TWO FACINGS. "anims" face RIGHT: the camera at yaw sees the hero nearly in profile, turned a little toward the viewer, walking toward screen right. "left" holds the
// same clips facing LEFT, rendered from the model itself by a camera at pi - yaw (the hero seen walking toward screen left) - not
// mirrored: the character shader's key light is fixed in view space (upper left), so both facings are lit from the upper left, and
// the pauldron stays on his LEFT shoulder (the far one facing right, the near one facing left), where a mirror would light him from
// the upper right and move it to the other shoulder. Every facing is its own run of the whole simulation from a freshly loaded page
// (deterministic: fixed sub-steps from the same start), so frame i of a clip is the same instant of the motion in both. The climb is
// posed toward the camera (the hero page turns it by S.view, which follows the camera), so both facings show him from behind, the
// pauldron on the screen-left shoulder. A reader that only knows "anims" may still mirror them for left (the old contract).
// x, y, w, h: the frame's rect in the atlas; (ax, ay): the ground anchor, in pixels from the frame's top-left - the point on the
// ground under the hips, between the feet (a pixel-edge coordinate: the boots stand on the row boundary ay, their 1 px outline is the
// row just below it). Every clip is rendered by the same fixed camera with the hero at the origin, so the anchor is one world point in
// every frame: airborne clips keep it too (it is where the feet would stand; the legs may tuck above it or reach below it) and the
// game can draw any frame at the body's ground point without a jump between clips. The ground clips (idle, walk, run, land) are
// then snapped onto it: ay is their lowest boot row, so a clip whose 3D feet never quite reach the floor (the walk, by ~1 px) does
// not float or bob when the game switches clips. Frames of one animation (per facing) share w, h, ax, ay (the union of their bounds
// + 1 transparent pixel, so nothing bleeds between neighbours).
// The climb's anchor is on the ladder's centre line (the gripping hands' midpoint) and its entry carries two extra fields a plain
// reader may ignore: "dy", how many pixels the body rises per frame while the hands grip - the game should climb at dy * fps px/s
// (at 96 px: 3.69 px per frame, ~29.5 px/s; 0.6 m/s) or advance the frames by the distance climbed / dy, so the hands stay planted
// on the rungs instead of sliding - and "lx", the gloves' midpoint relative to ax as DRAWN in that facing's own frames (the centroid
// of the opaque pixels within 0.1 m of each projected hand bone). Drawn, not projected: the world origin falls on a pixel centre
// (the frame canvas is odd-sized) and the hero page rounds that tie to the anchor column one way for one camera and the other way
// for the other, so the two facings' near-identical climb images sit 1 px apart from their anchors - which only the pixels show.
// Both are also printed with the summary.
// The hero page must have the platformer clips (window.HERO.CLIPS: jump_up, jump_apex, fall, land, climb); a page without them is
// refused with a message before anything is rendered.
//
// The clips are simulated in one continuous run, sub-stepped at 1/120 s, so the coat's secondary motion carries over the way it does
// in the game: idle / walk / run after a warm-up (walk / run: one cycle, the period read off the foot path); jump_up straight from a
// settled idle, jump_apex where the rise ends, fall after it has fluttered for a while (one loop), land straight out of the fall;
// climb after a warm-up. The non-looping clips (jump_up, jump_apex, land) are their key poses; their coat comes from the arc they
// stand for (the hero page feeds the coat the jump's vertical speed / acceleration, the hero itself stays in place). Between two keys
// the simulation runs one sprite interval - or, in free flight, the arc's own time between their speeds (|dvy| / g): the apex's
// second key is the fall setting in (~0.4 s past the top), so its coat has started to lift and the fall's flared coat does not pop in.
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
const ALL = ['idle', 'walk', 'run', 'jump_up', 'jump_apex', 'fall', 'land', 'climb'];
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
  const lacks = await p.evaluate(want => { const C = window.HERO.CLIPS; return C ? want.filter(n => !['idle', 'walk', 'run'].includes(n) && !C[n]) : null; }, want);
  if (!lacks) await bail(`the hero page has no platformer clips (HERO.CLIPS): pass --hero <a hero page with them> (got ${htmlPath})`);
  if (lacks.length) await bail(`the hero page lacks the clips ${lacks.join(', ')} (HERO.CLIPS): pass --hero <a page with them> or --clips without them`);
  return p.evaluate(async ([px, yaw, want]) => {
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
    const take = (name, fps, loop, times) => {   // times: seconds to advance before each frame
      const fr = [], hands = []; for (const dt of times){ run(dt); fr.push(grab()); hands.push([spr('hand_r'), spr('hand_l')]); }
      clips[name] = { fps, loop, frames: fr, hands, gx: H.post.uniforms.shC.value.x, gy: H.post.uniforms.groundY.value };
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
    // crop every clip to the union of its frames (+1 px)
    const out = [], notes = [];
    for (const name of want){
      const c = clips[name]; let x0 = F, y0 = F, x1 = -1, y1 = -1;
      for (const f of c.frames){ const d = f.getContext('2d').getImageData(0, 0, F, F).data;
        for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (d[(y*F + x)*4 + 3]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      // the ground row: the projected world origin; a ground clip stands its lowest boot outline on it (y1: the lowest opaque row)
      let gr = F - c.gy; if (['idle', 'walk', 'run', 'land'].includes(name) && y1 !== gr){ notes.push(`${name}: feet ${gr - y1} px above the ground plane, ay snapped to them`); gr = y1; }
      x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, ax = c.gx - x0;
      // the climb: rise per frame (the clip's own number, checked against the gripping hands' slide) and the gloves' midpoint as drawn
      // (the ladder): per frame and hand, the centroid of the opaque pixels within 0.1 m of the projected hand bone (canvas: the world
      // origin projects to F / 2 across and F / 2 + cy * ppu down; pixel centres at +0.5), less the anchor gx (see the header: each
      // facing gets its own number; the bone itself stands in where a glove has no pixel near it)
      let extra = {};
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
      out.push({ name, fps: +c.fps.toFixed(3), loop: c.loop, extra, w, h, ax, ay: gr - y0,
        frames: c.frames.map(f => { const k = document.createElement('canvas'); k.width = w; k.height = h; k.getContext('2d').drawImage(f, x0, y0, w, h, 0, 0, w, h); return k.toDataURL('image/png'); }) });
    }
    return { clips: out, notes };
  }, [px, camYaw, want]);
}
const facings = [['right', yaw, await renderFacing(yaw)], ['left', yawLeft, await renderFacing(yawLeft)]];
if (errors.length) await bail('page errors');

// pack the atlas: one row per clip, the right-facing clips first, then the left-facing ones (each row its clip's frames, left to right)
const atlas = await p.evaluate(async rows => {
  const imgs = await Promise.all(rows.map(r => Promise.all(r.frames.map(u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; })))));
  const W = Math.max(...rows.map(r => r.w * r.frames.length)), Ht = rows.reduce((s, r) => s + r.h, 0);
  const at = document.createElement('canvas'); at.width = W; at.height = Ht; const g = at.getContext('2d'); g.imageSmoothingEnabled = false;
  let y = 0; const rects = rows.map((r, k) => { const fr = imgs[k].map((im, i) => { g.drawImage(im, i * r.w, y); return { x: i * r.w, y, w: r.w, h: r.h, ax: r.ax, ay: r.ay }; }); y += r.h; return fr; });
  return { png: at.toDataURL('image/png'), rects };
}, facings.flatMap(([, , f]) => f.clips.map(c => ({ w: c.w, h: c.h, ax: c.ax, ay: c.ay, frames: c.frames }))));
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
console.log('wrote', path.join(outDir, 'hero.png'), 'and hero.json:');
for (const [side, y, f] of facings){
  console.log(`  ${side} (camera yaw ${y}):`);
  for (const c of f.clips) console.log(`    ${c.name.padEnd(10)} ${String(c.frames.length).padStart(2)} frames  ${String(c.fps).padStart(6)} fps  ${c.loop ? 'loop' : 'once'}  ${c.w}x${c.h}  anchor ${c.ax},${c.ay}`);
  for (const m of f.notes) console.log('    ' + m);
}
