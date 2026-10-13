// Headless playtest of "Grube Kattowitz III": a bot plays the whole level start to finish and must win (ride the cage down).
//
//   node level/tools/playtest.mjs [outDir=./playtest-out]
//
// How: the page is served over http (tools/serve.mjs), the simulation is put in manual mode (LVL.debug.manual) and advanced one
// fixed 60 Hz step at a time, so the run is deterministic and fast. The bot "presses keys" by dispatching KeyboardEvents on window,
// i.e. through the game's real input handler (keydown / keyup -> keys, edges, Shift, auto-run). It holds Right and hops walls and
// gaps it sees ahead (A, D), and plays the beats that need judgement with explicit waits: B boards the cable-car bucket only when
// it is docked, C climbs both ladders, E steps into the cage only while it rests at the top.
// Every length is the level's own (LVL.map.TS, LVL.style.K x the first draft's px, LVL.engine.P): the same test at any tile size.
// Also checked: the map's HEADROOM rule (3 free tiles over every standable surface), the CAMERA (it follows the hero both ways and
// keeps his whole drawn frame in the frame: statically, a full jump's apex from every standable cell stays inside the level's top;
// played, full jumps from every kind of surface, the highest roof included and right after climbing onto it, walking, running,
// jumping and run-jumping into either end of the level (P.END), and every frame of a 20 000-frame fuzz; the street is the camera's
// lowest view, the roofs lift it, the cage descent takes it down; no 1 px flicker across or up and down; walking off an edge he
// never rises on screen while he falls (the camera never moves down faster than he falls; catwalk into ladder 81 - and it holds
// while he hangs there -, off both roofs, the belt-end jump); one rest per surface however he arrives there (climbed, dropped,
// jumped onto, respawned); at a roof edge, facing the drop, it looks down until the landing street shows, and a few taps the other
// way do not bob it; standing or walking with his feet on one floor he moves on screen at most CAM.pan px a step - all along the
// route, in the fuzz, walking down the A steps from the start (where he never rises on screen more than that and a 1-tile step
// moves the camera a tile at most), jumping back up the heap, from a crate onto the belt, at both look-downs and into and out of E;
// a respawn snaps it; the parallax layers leave no gap at the top or bottom of the frame at any camera height; a hop in place -
// after a climb, on the belt mid-pan, at a roof edge looking down - changes no view), the E finale (the owner's model headframe
// drawn - props.headframe() - over the shaft, filling the map's box; the camera frames it while he waits for the cage, its top >= 8
// px under the frame's top with the street no lower than 85 % of the frame, the view held into the cage descent; and a taller one,
// props.headframe() stubbed to the 64 px design's 438 px box: the view lifts to y 82, the top 8 px in, the street ~83 % down), the
// owner's models wired (the atlas loaded, the hunts and the story props drawn from it, none of those props near a spot he stands
// at), NO SOFTLOCK (the hero is rested on every standable cell and driven by walk / run / jump / hop / ladder / drop macros through
// the real key handler: every spot he can reach from the start must still lead to the cage win or to a death), jump height / reach
// at walk and run, a walking jump clears the A trench, a full-speed run jump with coyote time can NOT clear the E shaft; the hero
// sheet: every state plays its own clip, facing left draws the left set rendered from the 3D model (pauldron on his left shoulder,
// lit from the upper left - not a mirror), the air clips of a jump follow the vertical speed (rise -> top -> fall, in order) while
// walking off an edge goes straight to fall (and stepping off a hunt stays in the walk cycle), a turnaround on the ground never
// flashes idle, land plays only straight out of the air (no late squash after walking on), the climb's frames advance with the
// distance climbed (dy), its hands sit on the ladder's axis and both facings draw it at the same place (measured on the drawn
// pixels, not from the sheet's lx); ladders (walk off at the foot after climbing down, no hop over the top), the A steps stay in
// the ground cycle, the rider keeps a constant pixel offset on the bucket / cart, the movers' front parts (the cage's bars, the
// bucket's near wall) are drawn under him outside the mover and over him straddling it or inside, a jump in place in the moving
// bucket lands back in it (platform carry) and the hair stops under its yoke, a jump under the belt stops under the belt, a respawn
// puts the camera on the hero at once, the win needs the cage going DOWN; the VALUE rule (hero vs background contrast at every beat
// spot, tools/probes.mjs) and the SKY rule (sunset band brighter than the top of the sky at five cameras, at the street view and at
// the camera's top), measured in a page of their own that opens with the simulation stopped (index.html?manual) and Math.random
// seeded, so the smoke and ash behind the hero and thus the numbers repeat exactly from run to run, and renders without the HUD
// (LVL.debug.hud: UI over the art, not the art they measure); sign boards above head height and clear of ladders and houses, fx
// anchors sitting on the painted lamps / lens / nozzles; the display (DPR-aware integer scale, 1920 x 1080 shows x2 edge to edge,
// 1920 x 950 shows the street on play, the full-screen button shows the stage alone, phones in portrait AND landscape show canvas +
// touch pad together and the pad drives the hero, a 390 px portrait phone fits its column (x1 would draw the hero 32 CSS px tall)
// while the landscape one keeps a crisp x2 and a 412 px one at dpr 2.625 its crisp x1 (the fit would be < 8 % wider), a thumb
// slides from one pad button to the next, a 320 px phone keeps both pad groups on one row, keys are not captured once the stage is
// scrolled away, a click on a layer checkbox or the grid button leaves the keys to the game, Space on a checkbox reached with Tab
// toggles it instead of jumping: how high Space made him rise is recorded in the page, from the keydown on).
// Real-time checks (the rAF loop, trusted keys, touch, page scrolling) wait for a number of the game's fixed steps
// (LVL.debug.state().frame) or poll for the condition they test (the scroll position, a button's rect), never for wall-clock time,
// so a loaded machine that renders few frames a second still gives the hero the same time to move and the page time to scroll.
// Writes to outDir: beat_<A..E>_1x.png (canvas pixels) and beat_<..>_2x.png (the page's own 2x integer display at 1920 x 1080),
// route.png (the whole playfield with the bot's path), contrast.json, layout_*.png, playtest.json (log + measurements). Exit code 1
// on any failed assertion.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), levelDir = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || 'playtest-out'); fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const { serve } = await import(path.join(here, 'serve.mjs'));
const { contrastProbe, SPOTS } = await import(path.join(here, 'probes.mjs'));
const srv = await serve(levelDir);
const NAV = { timeout: 180000 };   // page loads: a heavily loaded machine can take far longer than Playwright's default 30 s
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });      // the x2 integer display, edge to edge
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.goto(srv.url, NAV);
const LOADED = () => window.LVL && LVL.ready && LVL.sheet && (LVL.sheet.ok || LVL.sheet.err);
await page.waitForFunction(LOADED, null, { timeout: 60000 });
// the level's units, for the thresholds below: K (native px per draft px), TS (tile), the frame
const { K, TS, VW, VH, LH } = await page.evaluate(() => ({ K: LVL.style.K, TS: LVL.map.TS, VW: LVL.style.VW, VH: LVL.style.VH, LH: LVL.map.LH }));
const fails = [], report = { checks: {}, snaps: [], log: [] };
const check = (name, ok, info) => { report.checks[name] = { ok: !!ok, info }; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); if (!ok) fails.push(name); };
// waitSteps(pg, n): resolves once the live loop has run n more fixed steps (60 per game second), whatever the wall clock says
// (gives up after 60 s of no progress, so a stalled page fails its check instead of hanging the run)
const waitSteps = (pg, n) => pg.evaluate(n => new Promise(res => { const f0 = LVL.debug.state().frame, t0 = performance.now();
  const t = () => { const f = LVL.debug.state().frame; if (f >= f0 + n || performance.now() - t0 > 60000) res(f - f0); else requestAnimationFrame(t); }; t(); }), n);

// ---------- NO SOFTLOCK: every spot the hero can reach must still lead to the cage win or to a death ----------
// A graph of rest states, searched with the real controls. Node = where the hero comes to rest: G:col:row (standing still on a tile
// surface; col of the hitbox centre, row of the feet), L:col:halfRow (hanging still on a ladder, feet in half-tile steps), M:id
// (standing on a mover), and the ends WIN / DEATH. Seeds: the start and EVERY standable cell (a surface with room for the hitbox),
// and the two carts. From a node the hero is placed (two spots in the cell, or straddling its edges when neither stays; on a
// ladder's axis; on a cart's middle) and each macro is played through the key handler (keydown / keyup on window); then the keys
// are let go and the run ends where he rests again: an edge. Macros, both ways: walk 10 / 40 steps, run, jump after 0 / 16 steps
// of walking held 22 / 6 steps (full / short), run-jump, hop, leap off a ladder; in place: jump, Up, Down, a tap of Down (catwalk
// drop), wait (the belt's carry). A placement that does not stay put (a ladder top, a ladder foot) is an edge to where it settles.
// The movers are parked so the graph is static (bucket mid-chasm, the cage at the bottom: the shaft is a pit, the shunting cart at
// its start) and their rides are added as edges that the route bot and the probes play for real: either loading station <->
// bucket (it docks at both); the shaft edges, both sides <-> cage (it rests flush with them at the top: step in, walk across)
// -> WIN (riding it down). The search runs in REACH_WORKERS pages of its own, in rounds (the seeds, then the nodes they found),
// alongside the rest of the playtest; the verdict is checked before the VALUE rule.
const REACH_WORKERS = 3;
// in-page (a worker): window.__reach = { seeds(), explore(nodes) -> { graph: { node: { next: [macro@offset...] } }, stuck, sims } }
const installReach = () => {
  const D = LVL.debug, E = LVL.engine, M = LVL.map, TS = M.TS, Z = LVL.style.K, P = E.P, pl = E.player, mv = E.movers; D.manual = true;
  const held = new Set(), key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  const down = c => { if (!held.has(c)){ held.add(c); key(c, true); } }, up = c => { if (held.has(c)){ held.delete(c); key(c, false); } };
  const upAll = () => [...held].forEach(up), tap = c => { up(c); down(c); };
  let d0 = 0, w0 = 0;
  const ended = () => E.stats.deaths !== d0 || E.stats.wins !== w0;
  const nodeOf = () => {
    if (E.stats.deaths !== d0) return 'DEATH'; if (E.stats.wins !== w0) return 'WIN';
    if (pl.on) return 'M:' + pl.on.id;
    const c = Math.floor((pl.x + P.W / 2) / TS);
    if (pl.climb) return 'L:' + c + ':' + Math.round((pl.y + P.H) / (TS / 2));
    return pl.ground ? 'G:' + c + ':' + Math.round((pl.y + P.H) / TS) : 'AIR';
  };
  const run = n => { for (let i = 0; i < n && !ended(); i++) E.update(); };
  // in the air: let go of jump after h steps, keep the held direction until the feet land (or 150 steps)
  const air = h => { for (let i = 0; i < 150 && !ended(); i++){ if (i === h) up('Space'); E.update(); if (i > 2 && (pl.ground || pl.climb)) break; } };
  const settle = () => { for (let i = 0; i < 240 && !ended(); i++){ if ((pl.ground && Math.abs(pl.vx) < 1) || (pl.climb && pl.vy === 0)) return; E.update(); } };
  const K = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', Dn: 'ArrowDown', J: 'Space', S: 'ShiftLeft' };
  const macros = [];
  for (const d of ['L', 'R']){
    for (const k of [10, 40]) macros.push([d + 'walk' + k, () => { down(K[d]); run(k); }]);
    macros.push([d + 'run', () => { down(K.S); down(K[d]); run(50); }]);
    for (const k of [0, 16]) for (const h of [22, 6]) macros.push([d + 'jump' + k + 'h' + h, () => { down(K[d]); run(k); down(K.J); air(h); }]);
    macros.push([d + 'runjump', () => { down(K.S); down(K[d]); run(40); down(K.J); air(22); }]);
    macros.push([d + 'hop', () => { down(K[d]); down(K.J); run(3); up(K.J); air(0); }]);
    macros.push([d + 'ladderleap', () => { down(K.U); run(30); up(K.U); down(K[d]); tap(K.J); air(22); }]);
  }
  macros.push(['jumpUp', () => { down(K.J); run(22); up(K.J); run(40); }], ['up', () => { down(K.U); run(200); }], ['down', () => { down(K.Dn); run(200); }],
    ['downTap', () => { tap(K.Dn); run(4); up(K.Dn); run(60); }], ['wait', () => run(120)]);
  const bucket = mv.find(m => m.kind === 'bucket'), cage = mv.find(m => m.kind === 'cage'), cart2 = mv.find(m => m.id === 'cart2');
  const park = () => { for (const m of mv){ m.dx = m.dy = 0; m.waitT = 1e9; } bucket.x = 45 * TS; cage.y = cage.max; cart2.x = cart2.min; };
  const reset = () => { D.spawn(4); park(); upAll(); d0 = E.stats.deaths; w0 = E.stats.wins; };
  const place = (n, off) => {
    const [t, a, b] = n.split(':'); reset();
    if (t === 'G') D.place(+a * TS + off, +b * TS);
    else if (t === 'L'){ D.place(+a * TS + (TS - P.W) / 2, +b * TS / 2); Object.assign(pl, { climb: true, ground: false }); }
    else { const m = mv.find(m => m.id === a); D.place(m.x + m.w / 2 - P.W / 2 + off - 6 * Z, m.y); }
    E.update(); return nodeOf();
  };
  window.__reach = {
    seeds(){
      reset(); D.spawn(0); park(); settle(); const start = nodeOf(), standable = [];
      for (let c = 0; c < M.MW; c++) for (let r = 1; r < M.MH; r++)
        if ((M.isSolid(c, r) || M.isOneWay(c, r)) && !M.isSolid(c, r - 1) && !M.isSolid(c, r - 2)) standable.push('G:' + c + ':' + r);
      return { start, standable };
    },
    explore(nodes){
      const graph = {}, stuck = []; let sims = 0;
      for (const n of nodes){
        const out = graph[n] = {};
        // two spots in the cell (its left and right part), else straddling its edges; a ladder or mover: one (draft px x Z = K)
        const offs = (n[0] === 'G' ? [[1, 11], [-9, 20]] : [[6]]).map(o => o.map(d => d * Z).filter(off => place(n, off) === n)).find(o => o.length);
        if (!offs){ out[place(n, (n[0] === 'G' ? 1 : 6) * Z)] = ['comes to rest there']; continue; }
        for (const off of offs) for (const [name, f] of macros){
          if (place(n, off) !== n) continue;
          f(); upAll(); settle(); sims++;
          let m = nodeOf(); if (m === 'AIR'){ m = 'AIR@' + Math.round(pl.x) + ',' + Math.round(pl.y); stuck.push(n + ' ' + name + '@' + off + ' -> ' + m); }
          if (m !== n) (out[m] = out[m] || []).push(name + '@' + off);
        }
      }
      upAll(); return { graph, stuck, sims };
    }
  };
};
async function reachSearch(){
  const t0 = Date.now(), explorable = n => /^(G|L|M:cart)/.test(n);
  const W = await Promise.all(Array.from({ length: REACH_WORKERS }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } }), pg = await ctx.newPage(); pg.on('pageerror', e => errors.push('reach worker: ' + e.message));
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await pg.goto(srv.url, NAV);
    await pg.waitForFunction(LOADED, null, { timeout: 60000 });
    await pg.evaluate(installReach); return { ctx, pg }; }));
  const { start, standable } = await W[0].pg.evaluate(() => __reach.seeds());
  const graph = {}, seen = new Set([start, ...standable, 'M:cart1', 'M:cart2']), stuck = []; let frontier = [...seen], sims = 0, rounds = 0;
  while (frontier.length){
    rounds++;
    const res = await Promise.all(W.map((w, i) => w.pg.evaluate(ns => __reach.explore(ns), frontier.filter((_, j) => j % W.length === i))));
    frontier = [];
    for (const r of res){ sims += r.sims; stuck.push(...r.stuck);
      for (const [n, out] of Object.entries(r.graph)){ graph[n] = out; for (const m of Object.keys(out)) if (explorable(m) && !seen.has(m)){ seen.add(m); frontier.push(m); } } }
  }
  await Promise.all(W.map(w => w.ctx.close()));
  // the movers' rides
  const nodes = Object.keys(graph), add = (a, b, how) => { (graph[a] = graph[a] || {})[b] = [how]; };
  for (const n of nodes.filter(n => /^G:(3[89]|40|49|5[01]):9$/.test(n))){ add(n, 'M:bucket', 'board it docked'); add('M:bucket', n, 'step out at its dock'); }
  for (const n of nodes.filter(n => /^G:(14[23]|149|150):11$/.test(n))){ add(n, 'M:cage', 'step in while it rests at the top'); add('M:cage', n, 'step out while it rests at the top'); }
  add('M:cage', 'WIN', 'ride it down');
  const succ = n => Object.keys(graph[n] || {}).filter(m => !m.startsWith('AIR'));
  const R = new Set([start]), q = [start]; while (q.length){ const n = q.shift(); for (const m of succ(n)) if (!R.has(m)){ R.add(m); q.push(m); } }
  const pred = {}; for (const n in graph) for (const m of succ(n)) (pred[m] = pred[m] || []).push(n);
  const back = ends => { const s = new Set(ends), q = [...ends]; while (q.length){ const n = q.shift(); for (const m of pred[n] || []) if (!s.has(m)){ s.add(m); q.push(m); } } return s; };
  const escape = back(['WIN', 'DEATH']), toWin = back(['WIN']), traps = [...R].filter(n => !escape.has(n));
  return { start, nodes: Object.keys(graph).length, standable: standable.length, sims, rounds, workers: W.length, seconds: Math.round((Date.now() - t0) / 1000),
    reachable: R.size, winReachable: R.has('WIN'),
    traps: traps.map(t => ({ node: t, from: Object.entries(graph).filter(([n, e]) => e[t] && R.has(n) && !traps.includes(n)).map(([n, e]) => n + ' via ' + e[t].slice(0, 3).join(',')) })),
    deathOnly: [...R].filter(n => explorable(n) && !toWin.has(n)),
    stuck: stuck.filter(e => R.has(e.split(' ')[0])), pocketReached: [...R].filter(n => /^G:10[4-7]:11$/.test(n)),
    unreachedStandable: standable.filter(n => !R.has(n)) };
}
const reachRun = reachSearch().catch(e => ({ error: String(e && e.stack || e) }));

// ---------- VALUE / SKY measurements: a page of their own, reproducible ----------
// What lies behind the hero changes with the step (the guard tower's searchlight sweeps past B_tower, the vents puff over D_under:
// each reads ~1.55 to ~2.0 over a cycle) and with Math.random (the fx module's smoke puffs and ash), so measured in the main page,
// at whatever step its real-time checks left it, the numbers moved from run to run. This page opens as index.html?manual (no step
// runs before the first tick) with Math.random replaced by a seeded generator (mulberry32), runs 10 s of steps (the smoke reaches
// the steady state the player sees: a puff lives <= 260 steps) and then measures: every run gets the same pixels (one fixed
// moment of the sweeps - a snapshot, as before, not their worst case).
async function valueAndSky(){
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { let a = 1957; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const pg = await ctx.newPage(); pg.on('pageerror', e => errors.push('value page: ' + e.message));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await pg.goto(srv.url + '?manual', NAV);
  await pg.waitForFunction(LOADED, null, { timeout: 60000 });
  // (the HUD off: it is UI laid over the frame, not the art these rules are about - the tour's banner sits in the sky's top band)
  const pre = await pg.evaluate(() => { const f0 = LVL.debug.state().frame; LVL.debug.hud = false; LVL.debug.tick(600); LVL.debug.setPlay(true); return { manualAtLoad: LVL.debug.manual, frameAtLoad: f0 }; });
  const cpSpots = await pg.evaluate(() => LVL.map.CHECK.map((c, i) => ['CP' + i, c + 0.5]));
  const con = await contrastProbe(pg, [...SPOTS, ...cpSpots]), V = await pg.evaluate(() => LVL.style.VALUE);
  // SKY rule: the sunset band (SKY.horizon) stays brighter than the top of the sky (SKY.top), hero off the level, at five cameras
  // along it (the draft's 0 / 960 / 2000 / 3000 / 4000 x K), at the street view (the camera's lowest) and at its top
  const sky = await pg.evaluate(() => {
    const D = LVL.debug, S = LVL.style, SK = S.SKY, W = S.VW, H = S.VH, LOW = LVL.map.LH - H, out = []; D.setPlay(false);
    const p = LVL.engine.player, y0 = p.y; p.y = 10 * LVL.map.LH;
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    for (const cy of [LOW, 0]) for (const cx of [0, 960, 2000, 3000, 4000].map(x => x * S.K)){ D.cam(cx, cy); D.tick(1); LVL.engine.render();
      const d = document.getElementById('cv').getContext('2d').getImageData(0, 0, W, H).data;
      const band = ([a, b]) => { let s = 0, n = 0; for (let y = a; y < b; y++) for (let x = 0; x < W; x++){ const i = (y * W + x) * 4; s += 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]); n++; } return s / n; };
      const top = band(SK.top), hor = band(SK.horizon); out.push({ cx, cy, ratio: +((hor + 0.05) / (top + 0.05)).toFixed(2), top: +top.toFixed(3), horizon: +hor.toFixed(3) }); }
    p.y = y0; return { min: SK.minRatio, cams: out }; });
  await ctx.close(); return { pre, con, V, sky };
}
const valueRun = valueAndSky().catch(e => ({ error: String(e && e.stack || e) }));
check('sheet loaded', await page.evaluate(() => LVL.sheet.ok), await page.evaluate(() => LVL.sheet.err || Object.keys(LVL.sheet.anims)));
{ const d = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { scale: LVL.scale, dscale: LVL.dscale, bleed: document.getElementById('stage').classList.contains('bleed'), left: r.left, w: r.width, h: r.height, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }; });
  check('1920 x 1080: the canvas at an integer x2, edge to edge (1920 px, no gutters, no horizontal scroll)', d.scale === 2 && d.dscale === 2 && d.bleed && d.left === 0 && d.w === 1920 && d.h === 1080 && d.scrollW <= d.innerW, d); }
// real (trusted) keyboard in real time: a key press leaves the tour, Right walks then runs the hero along the first steps
{
  const x0 = await page.evaluate(() => LVL.debug.state().x);
  await page.keyboard.down('ArrowRight'); await waitSteps(page, 72); await page.keyboard.up('ArrowRight'); await waitSteps(page, 18);
  const s = await page.evaluate(() => LVL.debug.state());
  check('real keyboard: starts play and moves the hero (rAF loop)', s.playing && s.x - x0 > 60 * K, { moved: Math.round(s.x - x0), playing: s.playing });
}
// a click on a layer checkbox / the grid button while playing must not take the keyboard: arrows still move him, Space jumps
// (and does not toggle the control back). How high a Space made him rise is recorded IN THE PAGE (the live loop keeps running
// while the test's own round trips are under way, ~10-20 steps on a loaded machine, and a jump is in the air 37): a capture
// listener on window notes the step of each Space keydown and his hitbox y then, and a rAF sampler (after the game's own loop)
// the lowest y he reaches in the 60 steps after it.
{
  await page.evaluate(() => { const R = window.__rise = { frame: null, y0: 0, minY: 0 };
    addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat){ const s = LVL.debug.state(); Object.assign(R, { frame: s.frame, y0: s.y, minY: s.y }); } }, true);
    const t = () => { if (R.frame !== null){ const s = LVL.debug.state(); if (s.frame <= R.frame + 60) R.minY = Math.min(R.minY, s.y); } requestAnimationFrame(t); }; t(); });
  // Space held 9 steps after its keydown (as the page counts them), then the steps of a whole jump: how far he rose (px)
  const spaceRise = async () => {
    await page.evaluate(() => { __rise.frame = null; }); await page.keyboard.down('Space');
    await page.waitForFunction(() => __rise.frame !== null && LVL.debug.state().frame >= __rise.frame + 9, null, { timeout: 60000, polling: 'raf' });
    await page.keyboard.up('Space');
    await page.waitForFunction(() => LVL.debug.state().frame >= __rise.frame + 45, null, { timeout: 60000, polling: 'raf' });
    return Math.round(await page.evaluate(() => __rise.y0 - __rise.minY)); };
  const st = () => page.evaluate(() => ({ s: LVL.debug.state(), ash: document.getElementById('ly-ash').checked, grid: document.getElementById('grid').getAttribute('aria-pressed'), focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
  const res = {};
  for (const [name, sel] of [['checkbox', '#ly-ash'], ['gridButton', '#grid']]){
    await page.evaluate(() => { LVL.debug.spawn(4); });
    await page.click(sel); await waitSteps(page, 6);
    const a = await st(); await page.keyboard.down('ArrowRight'); await waitSteps(page, 48); await page.keyboard.up('ArrowRight');
    const b = await st(), rose = await spaceRise(), d = await st();
    res[name] = { focusAfterClick: a.focus, moved: Math.round(b.s.x - a.s.x), roseOnSpace: rose, toggledByClick: name === 'checkbox' ? a.ash === false : a.grid === 'true',
      unchangedBySpace: name === 'checkbox' ? d.ash === a.ash : d.grid === a.grid };
    await page.click(sel); await waitSteps(page, 3);              // restore the layer / grid
  }
  check('a click on a layer checkbox or the grid button leaves the keys to the game (arrows move, Space jumps, no re-toggle)',
    Object.values(res).every(r => r.moved > 40 * K && r.roseOnSpace > 10 * K && r.toggledByClick && r.unchangedBySpace), res);
  // keyboard users: Tab onto a layer checkbox, Space toggles it (and does not jump: no rise at all in the steps after it), the
  // focus stays there, the arrows still move him; a second Space toggles it back
  await page.evaluate(() => { LVL.debug.spawn(4); }); await page.focus('#ly-fg'); await page.keyboard.press('Tab'); await waitSteps(page, 6);
  const a = await st(), rose = await spaceRise(), c = await st();
  await page.keyboard.down('ArrowRight'); await waitSteps(page, 48); await page.keyboard.up('ArrowRight'); const d = await st();
  await page.keyboard.press('Space'); await waitSteps(page, 3); const e = await st();
  const kb = { focusAfterTab: a.focus, toggled: a.ash !== c.ash, roseOnSpace: rose, focusAfterSpace: c.focus, arrowsMoved: Math.round(d.s.x - c.s.x), toggledBack: e.ash === a.ash };
  check('Space on a layer checkbox reached with Tab toggles it (no jump, the focus stays, the arrows still move him)',
    kb.focusAfterTab === 'ly-ash' && kb.toggled && kb.roseOnSpace === 0 && kb.focusAfterSpace === 'ly-ash' && kb.arrowsMoved > 40 * K && kb.toggledBack, kb);
}
const headroom = await page.evaluate(() => LVL.debug.headroom());
check('HEADROOM: 3 free tiles over every standable surface', headroom.length === 0, headroom.slice(0, 8));
// the CAMERA's guarantee, statically: from every standable cell (a ladder's top included) the apex of a full jump keeps the top of
// his tallest air frame CAM.margin under the level's top, where the camera (clamped at 0) can still frame it - so a surface added
// too high fails here even where no played jump goes
{ const cb = await page.evaluate(() => { const M = LVL.map, TS = M.TS, P = LVL.engine.P, m = LVL.debug.CAM.margin;
    const ay = Math.max(...[LVL.sheet.sets[1], LVL.sheet.sets[-1]].filter(Boolean).flatMap(s => ['jump_up', 'jump_apex', 'fall'].flatMap(n => s[n] ? s[n].frames.map(f => f.ay) : [])));
    let hi = M.MH; const bad = [];
    for (let c = 0; c < M.MW; c++) for (let r = 1; r < M.MH; r++) if ((M.isSolid(c, r) || M.isOneWay(c, r)) && !M.isSolid(c, r - 1) && !M.isSolid(c, r - 2)){
      hi = Math.min(hi, r); if (r * TS - P.JUMP_H - ay < m) bad.push(c + ':' + r); }
    return { tallestAirFrameAy: ay, highestRow: hi, apexFrameTop: Math.round(hi * TS - P.JUMP_H - ay), margin: m, bad: bad.slice(0, 8) }; });
  check('CAMERA, statically: a full jump from every standable cell keeps his tallest air frame inside the level\'s top (the camera can frame it)', cb.bad.length === 0, cb); }
// ---------- in-page bot ----------
await page.evaluate(() => {
  const D = LVL.debug, M = LVL.map, TS = M.TS, K = LVL.style.K, VW = LVL.style.VW, VH = LVL.style.VH, P = LVL.engine.P; D.manual = true;
  const held = new Set();
  const offFrame = window.__offFrame = r => r.y < 0 || r.x < 0 || r.x + r.w > VW;     // his drawn frame's box past the frame's top or sides
  const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  const B = window.__bot = {
    seen: {}, path: [], jumpT: 0, hop: false, frames: 0, camOut: [], cyRange: {}, descent: [], hf: LVL.art.props.headframe(),
    route: false, prev: null, pan: { px: 0 }, rec: null,
    down(code){ if (!held.has(code)){ held.add(code); key(code, true); } },
    up(code){ if (held.has(code)){ held.delete(code); key(code, false); } },
    upAll(){ [...held].forEach(c => B.up(c)); B.jumpT = 0; },
    jump(hold = 20){ B.up('Space'); B.down('Space'); B.jumpT = hold; },        // press Space and keep it down `hold` steps
    tick(){
      if (B.jumpT > 0 && --B.jumpT === 0) B.up('Space');
      const s = D.tick(1); B.frames++;
      const k = s.anim + ' > ' + s.clip + (s.safety ? ' (safety net)' : ''); B.seen[k] = (B.seen[k] || 0) + 1;
      // the camera's guarantee, every step he is alive in the level: his drawn frame inside the frame, his feet over its bottom
      if (s.sprite && !s.winT && !s.deathT && s.y + P.H <= M.LH && (offFrame(s.sprite) || s.screen[1] > VH) && B.camOut.length < 20)
        B.camOut.push({ frame: B.frames, x: Math.round(s.x), feet: Math.round(s.y + P.H), cx: s.cx, cy: s.cy, box: s.sprite, feetY: s.screen[1] });
      // the camera's range per beat (and in E: E_hf with his centre over the headframe's base, off the cage) and, riding the cage
      // down, [feet, cy] per step
      if (s.playing && !s.winT && !s.deathT){ const seg = M.SEGS.filter(q => s.x / TS >= q[0]).pop()[1], ks = [seg], c = s.x + P.W / 2;
        if (seg === 'E' && s.on !== 'cage' && c >= B.hf.x && c <= B.hf.x1) ks.push('E_hf');
        for (const k of ks){ const r = B.cyRange[k] || (B.cyRange[k] = [1e9, -1e9]); r[0] = Math.min(r[0], s.cy); r[1] = Math.max(r[1], s.cy); } }
      if (s.on === 'cage' && s.movers.cage.dir > 0 && s.movers.cage.y > M.GROUND * TS + 0.01 && !s.winT) B.descent.push([Math.round(s.y + P.H), s.cy]);
      // the camera's speed with his feet on one floor (or mover): his largest move on screen from one step to the next, on the
      // route (B.pan); and a scenario's record while one is kept (B.rec, see watch)
      const q = B.prev; B.prev = s;
      if (B.route && q && sameFloor(q, s)){ const d = Math.abs(s.screen[1] - q.screen[1]); if (d > B.pan.px) B.pan = { px: d, frame: B.frames, x: Math.round(s.x), feet: Math.round(s.y + P.H), cy: [q.cy, s.cy] }; }
      if (B.rec) B.rec.push({ feet: s.y + P.H, sy: s.screen[1], cy: s.cy, g: s.ground, cl: s.climb, on: s.on, vy: s.vy, dead: !!(s.winT || s.deathT) });
      if (B.frames % 6 === 0) B.path.push([Math.round(s.x + P.W / 2), Math.round(s.y + P.H)]);
      if (B.hop) B.autoHop(s);
      return s;
    },
    // Grounded and moving right: jump if a solid tile is right ahead at body height, or there is no floor under the leading foot.
    autoHop(s){
      if (!s.ground || s.on || s.climb || B.jumpT > 0) return;
      const feet = s.y + P.H, row = Math.floor((feet + 1) / TS), ahead = Math.floor((s.x + P.W + 20 * K) / TS), toe = Math.floor((s.x + P.W + 6 * K) / TS);
      const wall = [s.y + 2 * K, s.y + P.H / 2, feet - 2 * K].some(y => M.isSolid(ahead, Math.floor(y / TS)));
      const floor = M.isSolid(toe, row) || M.isOneWay(toe, row);
      if (wall || !floor) B.jump(22);
    },
    until(cond, max, label){
      let s = D.state();
      for (let i = 0; i < max; i++){ if (cond(s)) return s; s = B.tick(); }
      if (cond(s)) return s;
      throw new Error('timeout: ' + label + ' ' + JSON.stringify({ x: s.x, y: s.y, vx: s.vx, ground: s.ground, climb: s.climb, on: s.on, anim: s.anim, movers: s.movers }));
    }
  };
  // two successive states with his feet on the same floor or mover, alive, not on a ladder
  const sameFloor = window.__sameFloor = (q, s) => q.ground && s.ground && !q.climb && !s.climb && q.on === s.on && q.y === s.y && !q.winT && !s.winT && !q.deathT && !s.deathT;
  const W = P.W, feet = s => s.y + P.H;
  window.__route = (function* (){
    D.spawn(0); B.route = true; B.until(() => true, 1);
    // A · HAŁDA: down the slag steps, over the trench (cols 21-22)
    B.hop = true; B.down('ArrowRight');
    B.until(s => !s.ground && s.x > 20.2 * TS && s.x < 21.6 * TS, 900, 'A: jumping the trench'); yield 'A';
    B.until(s => s.ground && s.x > 23 * TS, 200, 'A: landed past the trench');
    // B · BOCZNICA: up onto the loading station, wait for the docked bucket, ride it, step off on the far station
    B.until(s => s.ground && feet(s) === 9 * TS && s.x >= 39.4 * TS, 900, 'B: on the loading station'); B.hop = false; B.up('ArrowRight');
    B.until(s => s.vx === 0, 60, 'B: stopped');
    B.until(s => s.movers.bucket.x <= 41 * TS + 0.01 && s.movers.bucket.waitT > 0.35, 900, 'B: bucket docked');
    B.down('ArrowRight'); B.until(s => s.x >= 41 * TS + 12 * K, 120, 'B: stepping in'); B.up('ArrowRight');
    B.until(s => s.on === 'bucket' && s.vx === 0, 60, 'B: standing in the bucket');
    B.until(s => s.movers.bucket.x > 44 * TS, 400, 'B: riding'); yield 'B';
    B.until(s => s.movers.bucket.x >= LVL.engine.movers.find(m => m.id === 'bucket').max - 0.01 && s.on === 'bucket', 400, 'B: bucket at the far station');
    B.hop = true; B.down('ArrowRight');
    B.until(s => s.ground && !s.on && s.x > 52 * TS, 300, 'B: off the far station');
    // C · KOLONIE GIESCHE: down the step into the colony street, up the ladder (col 65) to the first roof (row 8), across the
    // catwalk, catch the ladder (col 81), up to the second roof (row 6), drop to the street (row 12), hop the step up into D
    B.hop = false; B.until(s => s.x >= 64.4 * TS && s.vx === 0, 900, 'C: at the first ladder'); B.up('ArrowRight');
    B.down('ArrowUp'); B.until(s => s.climb, 30, 'C: grabbed ladder 65');
    B.until(s => s.climb && feet(s) < 10 * TS, 200, 'C: climbing'); yield 'C';
    B.until(s => !s.climb && s.ground && feet(s) === 8 * TS, 300, 'C: on the first roof'); B.up('ArrowUp');
    B.down('ArrowRight'); B.until(s => s.climb, 600, 'C: caught ladder 81'); B.up('ArrowRight');
    B.down('ArrowUp'); B.until(s => !s.climb && s.ground && feet(s) === 6 * TS, 300, 'C: on the second roof'); B.up('ArrowUp');
    B.down('ArrowRight'); B.until(s => s.ground && feet(s) >= 11 * TS && s.x > 93.5 * TS, 600, 'C: back on the street');
    // D · SORTOWNIA: crates up to the belt, ride / run along it, jump off, hop the steel block
    B.hop = true;
    B.until(s => s.ground && feet(s) === 7 * TS && s.x > 106 * TS, 900, 'D: on the belt'); yield 'D';
    B.until(s => s.ground && s.x > 127.5 * TS, 900, 'D: past the steel block');
    // E · SCHACHT III: wait at the shaft for the cage to rest at the top, step in, ride it down
    B.hop = false; B.until(s => s.x >= 142 * TS, 900, 'E: at the shaft'); B.up('ArrowRight');
    B.until(s => s.vx === 0, 60, 'E: stopped');
    B.waitView = B.until(s => s.movers.cage.y <= M.GROUND * TS + 0.01 && s.movers.cage.waitT > 1.2, 1200, 'E: cage resting at the top');   // (his view then)
    B.down('ArrowRight'); B.until(s => s.x >= 145.9 * TS, 120, 'E: stepping in'); B.up('ArrowRight');
    B.until(s => s.on === 'cage', 60, 'E: in the cage');
    B.until(s => s.movers.cage.y > M.GROUND * TS + 30 * K, 600, 'E: descending'); yield 'E';
    B.until(s => s.stats.wins >= 1, 300, 'E: win'); B.tick(); yield 'win';
    B.upAll(); B.route = false;
  })();
});

const snap = async name => {
  const d = await page.evaluate(() => { LVL.engine.render(); return document.getElementById('cv').toDataURL(); });
  fs.writeFileSync(`${out}/beat_${name}_1x.png`, Buffer.from(d.split(',')[1], 'base64'));
  await page.locator('#cv').screenshot({ path: `${out}/beat_${name}_2x.png` });
  report.snaps.push(name);
};
let routeErr = null;
try {
  for (;;){
    const r = await page.evaluate(() => { const it = __route.next(); return { done: it.done, value: it.value, s: LVL.debug.state(), frames: __bot.frames }; });
    if (r.done) break;
    report.log.push({ snap: r.value, frame: r.frames, x: Math.round(r.s.x), y: Math.round(r.s.y), screen: r.s.screen, anim: r.s.anim, clip: r.s.clip, cp: r.s.cp });
    console.log(`  ${r.value}: frame ${r.frames} (${(r.frames / 60).toFixed(1)} s)  x ${Math.round(r.s.x)} y ${Math.round(r.s.y)}  ${r.s.anim} -> ${r.s.clip}  cp ${r.s.cp}`);
    await snap(r.value);
  }
} catch (e){ routeErr = e.message; }
const end = await page.evaluate(() => ({ s: LVL.debug.state(), seen: __bot.seen, path: __bot.path, frames: __bot.frames, camOut: __bot.camOut, cyRange: __bot.cyRange,
  waitView: __bot.waitView && { cx: __bot.waitView.cx, cy: __bot.waitView.cy }, hf: LVL.art.props.headframe(), descent: __bot.descent, pan: __bot.pan,
  modelHf: (g => g && { x: g.x, x1: g.x1, top: g.top })(LVL.art.models.headframeGeo('play', (LVL.map.ENT.shaft.c0 + LVL.map.ENT.shaft.c1 + 1) / 2 * LVL.map.TS, LVL.map.GROUND * LVL.map.TS)),
  ent: { hf: LVL.map.ENT.headframe, shaft: LVL.map.ENT.shaft, landmark: LVL.map.ENT.landmark, ground: LVL.map.GROUND, frameTop: LVL.debug.CAM.frameTop, margin: LVL.debug.CAM.margin,
    street: LVL.debug.CAM.street, pan: LVL.debug.CAM.pan } }));
check('bot completed the level (rode the cage down = win)', !routeErr && end.s.stats.wins >= 1, routeErr || { frames: end.frames, seconds: +(end.frames / 60).toFixed(1) });
check('every checkpoint reached in order', end.s.stats.cps.map(c => c.i).join(',') === '1,2,3,4', end.s.stats.cps);
check('no deaths on the route', end.s.stats.deaths === 0, end.s.stats.log);
{ const R = end.cyRange, low = LH - VH;
  check('CAMERA on the route: his drawn frame never leaves the frame; the street keeps the lowest view, the C roofs and the D belt lift it, the cage descent ends at the bottom',
    end.camOut.length === 0 && R.B && R.B[1] === low && R.C && R.C[0] <= low - 2 * TS && R.D && R.D[0] <= low - TS && R.E && R.E[1] === low, { out: end.camOut, cyByBeat: R, lowest: low });
  check(`CAMERA on the route: with his feet on one floor (or mover) he never moves more than CAM.pan = ${end.ent.pan} px on screen in a step`, end.pan.px <= end.ent.pan, end.pan);
  // E, the landmark. The headframe drawn is the owner's model sprite (art/models.js, anchored on the shaft's centre line), and the
  // map's box (ENT.headframe) is its extent - the fallback fills the same box. The camera frames the headframe that is drawn
  // (props.headframe(): its sides and its top) while he waits for the cage: its top CAM.frameTop px under the frame's top, no
  // lower (the street as low in the frame as that allows: this one fits the street view, the camera's lowest), unless that would
  // put the street under CAM.street of the frame's height - then the street sits there and a headframe that tall loses its top -,
  // its sides inside; where it fits, its top stays >= that far in at every camera with him over its base; riding the cage down,
  // the camera holds that view while his feet are over the frame's bottom margin, then follows him down the shaft to the bottom
  // (the check above). (A taller one lifts the view: the probe that stubs props.headframe() with a 438 px box checks that.)
  const hf = end.hf, w = end.waitView, E = end.ent, cyS = Math.max(0, E.ground * TS - Math.floor(E.street * VH)), fits = hf.top - E.frameTop >= cyS;
  const cyE = Math.min(LH - VH, Math.max(hf.top - E.frameTop, cyS)), d = end.descent, mh = end.modelHf;
  const box = { x: E.hf.x, x1: E.hf.x + E.hf.w, top: E.ground * TS - E.hf.h };
  const held = d.filter(([f]) => f <= cyE + VH - E.margin - 2), holdBad = held.filter(([, cy]) => Math.abs(cy - cyE) > 1), share = w && (E.ground * TS - w.cy) / VH;
  check('E finale: the owner\'s headframe (the model sprite on the shaft, the map\'s box its extent) framed while he waits for the cage - its top >= 8 px under the frame top (the street no lower than 85 %), its sides inside - its top in the frame wherever he stands over its base when it fits, the view held into the cage descent',
    mh && hf.x === mh.x && hf.x1 === mh.x1 && hf.top === mh.top && box.x === hf.x && box.x1 === hf.x1 && box.top === hf.top &&
    w && Math.abs(w.cy - cyE) <= 1 && hf.top - w.cy >= E.frameTop && hf.x >= w.cx && hf.x1 <= w.cx + VW && share <= E.street + 0.002 &&
    (!fits || (R.E_hf && hf.top - R.E_hf[1] >= E.frameTop)) && d.length > 30 && holdBad.length === 0,
    { box, headframe: hf, model: mh, fits, waitCam: w, landmarkView: cyE, topFrameY: w && hf.top - w.cy, streetFrameY: w && E.ground * TS - w.cy, streetShare: w && +share.toFixed(3),
      lowestCamOverBase: R.E_hf && R.E_hf[1], descent: { steps: d.length, heldSteps: held.length, offHold: holdBad.slice(0, 5), first: d[0], last: d[d.length - 1] } }); }

// route.png: the whole playfield (static layer) at 1/2 size with the bot's path
const routePng = await page.evaluate(pathPts => {
  const g0 = LVL.engine.game(), c = document.createElement('canvas'); c.width = g0.width / 2; c.height = g0.height / 2;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#241b20'; g.fillRect(0, 0, c.width, c.height); g.drawImage(g0, 0, 0, c.width, c.height);
  g.fillStyle = '#ffb84a'; for (const [x, y] of pathPts) g.fillRect(Math.round(x / 2) - 1, Math.round(y / 2) - 1, 2, 2);
  g.fillStyle = '#e8dcc0'; g.font = '8px monospace'; for (const [c0, l] of LVL.map.SEGS) g.fillText(l, c0 * LVL.map.TS / 2 + 3, 10);
  return c.toDataURL();
}, end.path);
fs.writeFileSync(`${out}/route.png`, Buffer.from(routePng.split(',')[1], 'base64'));

// ---------- physics probes (fresh runs on flat ground in E, cols 132-143) ----------
const probe = await page.evaluate(() => {
  const D = LVL.debug, B = __bot, M = LVL.map, TS = M.TS, K = LVL.style.K, VW = LVL.style.VW, VH = LVL.style.VH, P = LVL.engine.P, gy = M.GROUND * TS, feet = s => s.y + P.H;
  B.hop = false; B.upAll();
  const res = {};
  // where the camera was against its rest for the hero where he is (both axes: snap() puts it there)
  const rest = s => { const c = D.snap(); return { x: Math.round(s.x), was: [+s.camX.toFixed(2), +s.camY.toFixed(2)], rest: [+c.camX.toFixed(2), +c.camY.toFixed(2)] }; };
  // after the bot's win the hero respawns at the start: the camera must be there at once (no smear across the level)
  { let s = D.state(), n = 0; while (s.winT > 0 && n++ < 400) s = B.tick(); s = B.tick(); res.respawnCam = { win: rest(s) }; }
  const jumpRun = (run, preFrames) => {
    D.spawn(4); D.place(132 * TS + 4 * K, gy); B.tick();
    if (run) B.down('ShiftLeft'); B.down('ArrowRight');
    for (let i = 0; i < preFrames; i++) B.tick();
    const s0 = D.state(), x0 = s0.x, v0 = s0.vx; B.jump(40); let apex = 0, s;
    for (let i = 0; i < 120; i++){ s = B.tick(); apex = Math.max(apex, gy - (s.y + P.H)); if (i > 2 && s.ground) break; }
    B.upAll(); return { speed: Math.round(v0), apex: +apex.toFixed(1), dist: Math.round(s.x - x0), gapTiles: +((s.x - x0 + P.W) / TS).toFixed(2) };
  };
  res.walkJump = jumpRun(false, 20);
  res.runJump = jumpRun(true, 60);
  // ladder / catwalk / belt mechanics the route does not need
  const cx = c => c * TS + (TS - P.W) / 2;
  const CST = 12 * TS;     // the C street (the dip)
  D.spawn(2); D.place(cx(65), 8 * TS); B.tick(); B.down('ArrowDown'); let st = D.state(), climbed = false;
  for (let i = 0; i < 300 && !(st.ground && st.y + P.H === CST); i++){ st = B.tick(); if (st.climb) climbed = true; } B.upAll();
  res.ladderDownFromTop = { climbed, reachedStreet: st.ground && st.y + P.H === CST };
  D.spawn(2); D.place(cx(79), 8 * TS); B.tick(); B.down('ArrowDown'); for (let i = 0; i < 90; i++) st = B.tick(); B.upAll();
  res.catwalkDropThrough = { feet: st.y + P.H, ground: st.ground };
  D.spawn(3); D.place(cx(110), 7 * TS); B.tick(); B.down('ArrowDown'); for (let i = 0; i < 30; i++) st = B.tick(); B.upAll();
  res.beltNoDrop = { feet: st.y + P.H, ground: st.ground };
  D.spawn(2); D.place(cx(65), CST); B.tick(); B.down('ArrowUp'); for (let i = 0; i < 40; i++) st = B.tick(); const midLadder = st.climb;
  B.up('ArrowUp'); B.down('ArrowLeft'); B.jump(20); let left = false; for (let i = 0; i < 60; i++){ st = B.tick(); if (!st.climb && st.vy < 0) left = true; } B.upAll();
  res.ladderLeap = { wasClimbing: midLadder, leapt: left, x: Math.round(st.x) };
  // standing jump straight up (lands without moving: plays 'land')
  D.spawn(4); D.place(132 * TS + 4 * K, gy); B.tick(); B.jump(40); let landed = false;
  for (let i = 0; i < 80; i++){ const s = B.tick(); if (i > 2 && s.ground && s.anim === 'land') landed = true; if (landed && s.anim === 'idle') break; }
  res.standingJumpLands = landed;
  // short hop: tap jump for 4 steps
  D.spawn(4); D.place(132 * TS + 4 * K, gy); B.tick(); B.jump(4); let ap = 0; for (let i = 0; i < 80; i++){ const s = B.tick(); ap = Math.max(ap, gy - (s.y + P.H)); if (i > 2 && s.ground) break; }
  res.shortHop = +ap.toFixed(1);
  // A trench (cols 21-22) at WALK speed: start 2 tiles before it, jump at the edge
  D.spawn(0); D.place(19.6 * TS, gy); B.tick(); B.down('ArrowRight'); let s = D.state(), deaths0 = s.stats.deaths;   // < 0.6 s of holding: still walking
  for (let i = 0; i < 120 && s.x + P.W < 21 * TS - 2 * K; i++) s = B.tick();
  res.trenchTakeoffSpeed = Math.round(s.vx); B.jump(30); for (let i = 0; i < 90; i++) s = B.tick(); B.upAll();
  res.trenchWalkJump = { landedX: Math.round(s.x), ground: s.ground, died: s.stats.deaths > deaths0 };
  // E shaft (cols 144-148), cage parked at the bottom: full run (Shift), jump 0..5 steps after the feet leave the edge (inside and
  // just past the coyote window); the farthest any attempt gets must stay short of the far side
  const cg = LVL.engine.movers.find(m => m.kind === 'cage'), saved = { y: cg.y, dir: cg.dir, waitT: cg.waitT };
  const tries = [];
  for (let k = 0; k <= 5; k++){
    Object.assign(cg, { y: cg.max, dir: -1, waitT: 99 });
    D.spawn(4); D.place(137 * TS, gy); B.tick(); deaths0 = D.state().stats.deaths; B.down('ShiftLeft'); B.down('ArrowRight');
    let leftAt = null, best = 0, jumped = false, missedBy = null;
    for (let i = 0; i < 300; i++){
      s = B.tick();
      if (!s.ground && leftAt === null){ leftAt = s.x; for (let j = 0; j < k; j++) s = B.tick(); B.jump(40); s = B.tick(); jumped = s.vy < -300 * K; }
      if (leftAt !== null) best = Math.max(best, s.x + P.W);
      if (missedBy === null && s.x + P.W >= 149 * TS - 0.5) missedBy = Math.round(s.y + P.H - gy);   // feet below the far ledge top
      if (s.deathT > 0 || s.stats.deaths > deaths0) break;
    }
    B.upAll(); tries.push({ delay: k, jumped, leftEdgeAt: Math.round(leftAt), farthestRightEdge: Math.round(best), feetBelowLedgeAtWall: missedBy, died: D.state().stats.deaths > deaths0 || D.state().deathT > 0 });
  }
  Object.assign(cg, saved);
  const hits = tries.filter(t => t.feetBelowLedgeAtWall !== null);
  res.shaftRunJump = { farSideStartsAt: 149 * TS, coyoteJumps: tries.filter(t => t.jumped).length, farthestRightEdge: Math.max(...tries.map(t => t.farthestRightEdge)),
    closestMissPx: hits.length ? Math.min(...hits.map(t => t.feetBelowLedgeAtWall)) : null, allDied: tries.every(t => t.died), tries };

  // ladder foot: climb down to the street holding Down, let go, wait, then walk away with Left (ladder 65 from the first roof;
  // ladder 81 from mid-height, as after catching it when falling off the catwalk)
  const foot = (ladCol, startFeet, wait) => {
    D.spawn(2); D.place(cx(ladCol), startFeet); B.tick(); B.down('ArrowDown'); let s = D.state();
    for (let i = 0; i < 400 && !(s.ground && feet(s) === CST); i++) s = B.tick();
    for (let i = 0; i < 4; i++) s = B.tick();
    B.up('ArrowDown'); for (let i = 0; i < wait; i++) s = B.tick();
    const x0 = s.x, climbAtRest = s.climb; B.down('ArrowLeft'); const anims = new Set();
    for (let i = 0; i < 60; i++){ s = B.tick(); anims.add(s.anim); } B.upAll();
    return { reachedStreet: feet(s) === CST, climbAtRest, movedLeft: Math.round(x0 - s.x), climbAfter: s.climb, anims: [...anims] };
  };
  res.ladderFoot = { l65_from_roof: foot(65, 8 * TS, 10), l65_wait1: foot(65, 8 * TS, 1), l81_mid: foot(81, 9 * TS, 10) };
  // catch ladder 81 by walking off the catwalk, climb down, walk off
  D.spawn(2); D.place(cx(79), 8 * TS); B.tick(); B.down('ArrowRight'); st = D.state(); let caught = false;
  for (let i = 0; i < 120 && !st.climb; i++) st = B.tick(); caught = st.climb; B.up('ArrowRight'); B.down('ArrowDown');
  for (let i = 0; i < 300 && !(st.ground && feet(st) === CST); i++) st = B.tick(); B.up('ArrowDown'); for (let i = 0; i < 10; i++) st = B.tick();
  { const x0 = st.x; B.down('ArrowLeft'); for (let i = 0; i < 60; i++) st = B.tick(); B.upAll(); res.ladderFoot.l81_caught = { caught, movedLeft: Math.round(x0 - st.x), climbAfter: st.climb }; }
  // ladder top: climb ladder 65 from the street to the roof holding Up; after the climb ends the hero must stand on the roof at once
  // (no frame in the air, feet never above the roof line), the state going climb -> idle
  D.spawn(2); D.place(cx(65), CST); B.tick(); B.down('ArrowUp'); st = D.state(); const topSeq = []; let ended = null, minFeet = 1e9, airAfter = 0;
  for (let i = 0; i < 400; i++){ st = B.tick();
    if (ended === null && !st.climb && feet(st) <= 8 * TS + 2 * K) ended = i;
    if (ended !== null){ minFeet = Math.min(minFeet, feet(st)); if (!st.ground) airAfter++; if (topSeq[topSeq.length - 1] !== st.anim) topSeq.push(st.anim); if (i - ended > 30) break; }
    else if (topSeq[topSeq.length - 1] !== st.anim) topSeq.push(st.anim); }
  B.upAll(); res.ladderTop = { ended: ended !== null, airFramesAfter: airAfter, riseAboveRoofPx: +(8 * TS - minFeet).toFixed(2), seq: topSeq };
  // A slag steps: hold Right from the start (no jumps): the three 1-tile step-downs keep the walk / run cycle
  D.spawn(0); B.tick(); B.down('ArrowRight'); st = D.state(); const stepSeq = []; let stepAir = 0;
  for (let i = 0; i < 300 && st.x < 15 * TS; i++){ st = B.tick(); if (!st.ground) stepAir++; const k = st.anim + '>' + st.clip; if (stepSeq[stepSeq.length - 1] !== k) stepSeq.push(k); }
  B.upAll(); res.steps = { airFrames: stepAir, seq: stepSeq, airPoses: stepSeq.filter(k => /^(jump_up|jump_apex|fall)/.test(k)).length };
  // the air arc by vertical speed (standing jump, running jump, a short hop, a left-facing jump): the drawn (clip#frame) sequence in
  // the air must run forward only - jump_up's frames, then jump_apex's, then fall - and stay in the facing's own set
  const ORDER = ['jump_up', 'jump_apex', 'fall'];
  const airArc = (dir, run, hold) => { D.spawn(4); D.place(137 * TS, gy); B.tick(); const k = dir < 0 ? 'ArrowLeft' : 'ArrowRight';
    if (run){ B.down('ShiftLeft'); B.down(k); for (let i = 0; i < 30; i++) B.tick(); }
    B.jump(hold); const seq = [], sets = new Set(); let back = 0, last = -1;
    for (let i = 0; i < 90; i++){ const s = B.tick(); if (ORDER.includes(s.anim)){ const key = s.clip + '#' + s.fi; if (seq[seq.length - 1] !== key) seq.push(key); sets.add(s.set);
        const rank = ORDER.indexOf(s.anim) * 100 + (s.anim === 'fall' ? 0 : s.fi); if (rank < last) back++; last = Math.max(last, rank); }
      if (i > 3 && s.ground) break; }
    B.upAll(); return { seq, back, sets: [...sets], clips: ORDER.filter(a => seq.some(k => k.startsWith(a + '#'))) }; };
  res.airArc = { standing: airArc(1, false, 40), running: airArc(1, true, 40), shortHop: airArc(1, false, 4), left: airArc(-1, true, 40) };
  // land: a standing jump lands into 'land' at once; walking off during it ends it for good. A running jump that lands moving and
  // then stops shows no land at all (the late squash: the old timer kept running under the walk and played it once he stopped)
  { D.spawn(4); D.place(137 * TS, gy); B.tick(); B.jump(40); let s, landAt = null; const after = [];
    for (let i = 0; i < 90; i++){ s = B.tick(); if (landAt === null && i > 3 && s.ground){ landAt = s.anim; B.tick(); B.down('ArrowRight'); for (let j = 0; j < 12; j++) after.push(B.tick().anim); B.up('ArrowRight'); for (let j = 0; j < 40; j++) after.push(B.tick().anim); break; } }
    B.upAll(); const w = after.indexOf('walk');
    res.landWalkOff = { firstGroundAnim: landAt, walkedAt: w, landAfterWalk: w >= 0 && after.slice(w).includes('land') }; }
  { D.spawn(4); D.place(133 * TS, gy); B.tick(); B.down('ShiftLeft'); B.down('ArrowRight'); for (let i = 0; i < 40; i++) B.tick(); B.jump(40); let s; const after = [];
    for (let i = 0; i < 90; i++){ s = B.tick(); if (i > 3 && s.ground){ B.upAll(); for (let j = 0; j < 40; j++) after.push(B.tick().anim); break; } }
    B.upAll(); res.landRunStop = { after: [...new Set(after)], land: after.includes('land') }; }
  // climb: up ladder 65 from the street; the clip's frame index must follow the distance climbed / dy (hands planted on the rungs),
  // the hands' midpoint (the sheet's lx) drawn on the ladder's axis; the same facing left; hanging still holds the frame. And,
  // not trusting lx: the drawn frame's own pixels - the centroid of its top 40 % (raised arms, gloves, the head between them) on
  // screen against the axis; both facings show the same back view (the exporter poses the climb toward its camera), so a facing
  // drawn 1 px off the other shows here
  const sheetPx = (() => { const im = LVL.sheet.img, c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height); })();
  const upperCx = f => { let s = 0, n = 0; for (let y = 0; y < Math.floor(f.h * 0.4); y++) for (let x = 0; x < f.w; x++)
    if (sheetPx.data[((f.y + y) * sheetPx.width + f.x + x) * 4 + 3]){ s += x + 0.5; n++; } return n ? s / n : f.ax; };
  const climbSync = face => { D.spawn(2); D.place(cx(65), 12 * TS); B.tick(); LVL.engine.player.face = face; B.down('ArrowUp');
    let s, y0 = null, worst = 0, n = 0, off = 0; const sets = new Set(), upper = [];
    for (let i = 0; i < 60; i++){ s = B.tick(); if (s.anim !== 'climb') continue; sets.add(s.set);
      if (y0 === null){ y0 = s.y; continue; }                                     // the climb's first frame: frame 0 at y0
      const C = LVL.sheet.sets[s.set === 'left' ? -1 : 1].climb, m = C.frames.length, want = (Math.floor((y0 - s.y) / C.dy + 1e-6) % m + m) % m;
      worst = Math.max(worst, Math.min((s.fi - want + m) % m, (want - s.fi + m) % m)); n++;
      if (i > 30){ const axis = 65 * TS + TS / 2 - s.cx; off = Math.max(off, Math.abs(s.sprite.x + C.frames[0].ax + C.lx - axis)); upper.push(s.sprite.x + upperCx(C.frames[s.fi]) - axis); } }
    B.up('ArrowUp'); const fHold = D.state().fi; for (let i = 0; i < 20; i++) s = B.tick(); B.upAll();
    return { samples: n, worstFrameOff: worst, heldStill: s.fi === fHold && s.climb, handsOffAxisPx: +off.toFixed(2), sets: [...sets],
      drawnUpperOffAxisPx: +(upper.reduce((a, b) => a + b, 0) / upper.length).toFixed(2) }; };
  res.climbSync = { right: climbSync(1), left: climbSync(-1) };
  // walking off an edge (no jump) goes from the ground cycle straight to fall, never through a jump's rise or top: off the C high
  // roof (row 6, a 5-6 tile drop: he runs on over the dip and lands on the step up into D); stepping off the parked hunt (a 40 px
  // drop) stays in the walk cycle all the way down
  const walkOff = (cp, x, feetY, key, steps) => { D.spawn(cp); D.place(x, feetY); B.tick(); B.down(key); const seq = []; let s, air = 0;
    for (let i = 0; i < steps; i++){ s = B.tick(); if (!s.ground) air++; if (seq[seq.length - 1] !== s.anim) seq.push(s.anim); } B.upAll();
    return { seq, airFrames: air, feet: s.y + P.H, ground: s.ground }; };
  const cart1 = LVL.engine.movers.find(m => m.id === 'cart1');
  res.walkOff = { roof: walkOff(2, 91 * TS + 6 * K, 6 * TS, 'ArrowRight', 150), cart: walkOff(1, cart1.x + 40 * K, cart1.y, 'ArrowLeft', 90) };
  // a turnaround on the ground (walking, running) shows no idle frame between the two directions; pushing against a wall (the D
  // steel block) idles, he does not walk on the spot
  const turn = run => { D.spawn(4); D.place(137 * TS, gy); B.tick(); if (run) B.down('ShiftLeft'); B.down('ArrowRight'); for (let i = 0; i < 40; i++) B.tick();
    B.up('ArrowRight'); B.down('ArrowLeft'); const seq = []; let s;
    for (let i = 0; i < 30; i++){ s = B.tick(); if (seq[seq.length - 1] !== s.anim) seq.push(s.anim); } B.upAll(); return { seq, vx: Math.round(s.vx) }; };
  res.turn = { walk: turn(false), run: turn(true) };
  { D.spawn(3); D.place(124 * TS, gy); B.tick(); B.down('ArrowRight'); const seq = []; let s;
    for (let i = 0; i < 90; i++){ s = B.tick(); if (seq[seq.length - 1] !== s.anim) seq.push(s.anim); } B.upAll();
    res.turn.wall = { seq, x: Math.round(s.x), blockAt: 126 * TS - P.W }; }
  // rider: board the docked bucket from a few fractional offsets; while it moves (and he stands still in it), the hero's screen x
  // minus the bucket's must be ONE value (no 1 px shimmer); the same on the shunting cart
  const bk = LVL.engine.movers.find(m => m.id === 'bucket'), c2 = LVL.engine.movers.find(m => m.id === 'cart2');
  res.rider = {};
  for (const off of [3.37, 7.81, 0.5]){
    D.spawn(1); for (let i = 0; i < 1500; i++){ B.tick(); if (bk.x <= 41 * TS + 0.01 && bk.waitT > 0.6) break; }
    D.place(39 * TS + off, 9 * TS); B.tick(); B.down('ArrowRight'); let s;
    for (let i = 0; i < 200; i++){ s = B.tick(); if (s.x > 41 * TS + 14.3 * K){ B.up('ArrowRight'); break; } }
    const rel = {}; for (let i = 0; i < 400; i++){ s = B.tick(); if (s.on === 'bucket' && bk.dx && s.vx === 0){ const d = s.screen[0] - (Math.round(bk.x) - s.cx); rel[d] = (rel[d] || 0) + 1; } }
    B.upAll(); res.rider['bucket_off' + off] = rel;
  }
  { D.spawn(1); Object.assign(c2, { x: c2.min, dir: 1, waitT: 0.3 }); D.place(c2.x + 18.37 * K, c2.y); B.tick(); const rel = {}; let s;
    for (let i = 0; i < 300; i++){ s = B.tick(); if (s.on === 'cart2' && c2.dx && s.vx === 0){ const d = s.screen[0] - (Math.round(c2.x) - s.cx); rel[d] = (rel[d] || 0) + 1; } }
    res.rider.cart2 = rel; }
  // win only when riding the cage DOWN: fall into the shaft onto the cage while it rises below the screen -> no win until it has
  // come up, rested and gone down again
  { const cg2 = LVL.engine.movers.find(m => m.kind === 'cage'); D.spawn(4); const w0 = D.state().stats.wins;
    Object.assign(cg2, { y: 480 * K, dir: -1, waitT: 0 }); D.place(146 * TS, 400 * K); B.tick(); let s = D.state(), onRising = false, winWhileRising = false, winAt = null;
    for (let i = 0; i < 900; i++){ s = B.tick(); if (s.on === 'cage' && cg2.dir < 0) onRising = true; if (s.stats.wins > w0 && winAt === null){ winAt = i; winWhileRising = cg2.dir < 0; } if (winAt !== null) break; }
    res.cageWin = { landedOnRisingCage: onRising, won: winAt !== null, winWhileRising, frames: winAt }; }
  // camera: while walking / running on flat ground the hero's frame x must not flicker (a +1 step followed by a -1 step), nor his
  // frame y while he climbs a ladder (65, from the street) with the camera following him up
  const flips = st => { let n = 0; for (let i = 1; i < st.length; i++) if (st[i] !== st[i - 1]) n++; return { steps: st.length, flips: n }; };
  const camFlicker = run => { D.spawn(4); D.place(132 * TS + 2 * K, gy); B.tick(); if (run) B.down('ShiftLeft'); B.down('ArrowRight'); for (let i = 0; i < 45; i++) B.tick();
    const st = []; let prev = null; for (let i = 0; i < 40; i++){ const s = B.tick(); if (prev !== null && s.screen[0] !== prev) st.push(Math.sign(s.screen[0] - prev)); prev = s.screen[0]; } B.upAll();
    return flips(st); };
  const climbFlicker = () => { D.spawn(2); D.place(cx(65), 12 * TS); B.tick(); B.down('ArrowUp'); const st = [], cys = []; let prev = null;
    for (let i = 0; i < 150; i++){ const s = B.tick(); if (!s.climb) continue; cys.push(s.cy); if (prev !== null && s.screen[1] !== prev) st.push(Math.sign(s.screen[1] - prev)); prev = s.screen[1]; } B.upAll();
    return Object.assign(flips(st), { camMovedUp: cys.length ? cys[0] - Math.min(...cys) : 0 }); };
  res.camera = { walk: camFlicker(false), run: camFlicker(true), climb: climbFlicker() };
  // camera on walk-offs: while he falls, his frame y (feet) never rises more than 1 px from one step to the next (the camera never
  // moves down faster than he falls) and a step that drops him <= 1 px moves the camera <= 3 px. Off the catwalk's end into
  // ladder 81 (after climbing ladder 65 and walking across, as the route does; then he hangs there 60 steps: the camera holds),
  // off roof 2's right edge and roof 1's left one to the street, off roof 2's left edge onto the catwalk, and a walking jump off
  // the belt's end (over its apex)
  const settle = n => { for (let i = 0; i < n; i++) B.tick(); };
  const fallCam = (setup, done, after) => { setup(); let s = D.state(), prev = s, n = 0, rise = 0, camOnSmall = 0;
    for (let i = 0; i < 400 && !done(s); i++){ s = B.tick();
      if (!s.ground && !s.climb && s.vy > 0){ n++; rise = Math.max(rise, prev.screen[1] - s.screen[1]); if (s.y - prev.y <= 1) camOnSmall = Math.max(camOnSmall, Math.abs(s.cy - prev.cy)); }
      prev = s; }
    B.upAll(); return Object.assign({ fallSteps: n, maxRisePx: rise, camOnSmallDropPx: camOnSmall, end: { feet: Math.round(feet(s)), climb: s.climb, cy: s.cy } }, after ? after() : {}); };
  const landedAt = (row, pred = () => true) => s => s.ground && feet(s) === row * TS && pred(s);
  const face = f => { LVL.engine.player.face = f; };            // (a climb keeps it: facing right, no drop ahead at either ladder's top)
  const hang = () => { const cys = []; for (let i = 0; i < 60; i++){ const s = B.tick(); if (s.climb) cys.push(s.cy); } return { hang: { steps: cys.length, cy: [Math.min(...cys), Math.max(...cys)] } }; };
  res.fallCam = {
    catwalkIntoLadder81: fallCam(() => { D.spawn(2); D.place(cx(65), CST); B.tick(); B.down('ArrowUp'); B.until(s => !s.climb && s.ground && feet(s) === 8 * TS, 400, 'roof 1');
      B.up('ArrowUp'); settle(30); B.down('ArrowRight'); }, s => s.climb, hang),
    roof2Right: fallCam(() => { D.spawn(2); D.place(cx(91), 6 * TS); settle(60); B.down('ArrowRight'); }, landedAt(11)),
    roof1Left: fallCam(() => { D.spawn(2); D.place(cx(67), 8 * TS); settle(60); B.down('ArrowLeft'); }, s => s.ground && feet(s) > 8 * TS),   // (walking, he clears the 2-tile dip: row 11)
    roof2LeftToCatwalk: fallCam(() => { D.spawn(2); D.place(cx(84), 6 * TS); settle(60); B.down('ArrowLeft'); }, landedAt(8)),
    beltEndJump: fallCam(() => { D.spawn(3); D.place(cx(118), 7 * TS); D.snap(); B.down('ArrowRight'); B.until(s => s.x > 119.6 * TS, 120, 'belt end'); B.jump(22); }, landedAt(11)) };
  // ONE camera rest per surface: the view he settles to is the same however he arrived - the first roof after climbing ladder 65,
  // after dropping onto the catwalk from roof 2 and walking back onto it, and as a respawn would snap it; roof 2 after climbing
  // ladder 81 and snapped; the belt after jumping up onto it from the crates and snapped. And the look-down: at roof 2's right
  // edge and roof 1's left one, facing the drop, the street he would land on shows >= CAM.peek - 1 px over the frame's bottom;
  // facing away, the view is the roof's rest
  { const C = D.CAM, restAt = (c, row) => { D.place(cx(c), row * TS); B.tick(); return D.snap().camY; }, cyAfter = n => { settle(n); return D.state().cy; };
    const roof1 = { climbed: (D.spawn(2), D.place(cx(65), CST), face(1), B.down('ArrowUp'), B.until(s => !s.climb && s.ground && feet(s) === 8 * TS, 400, 'roof 1'), B.up('ArrowUp'), cyAfter(120)) };
    D.spawn(2); D.place(cx(84), 6 * TS); settle(30); B.down('ArrowLeft'); B.until(landedAt(8, s => s.x < 80 * TS), 300, 'catwalk'); B.until(s => s.x < 72 * TS, 300, 'roof 1 from the catwalk'); B.upAll();
    roof1.fromRoof2 = cyAfter(120); roof1.snapped = restAt(72, 8);
    const roof2 = { climbed: (D.spawn(2), D.place(cx(81), CST), face(1), B.down('ArrowUp'), B.until(s => !s.climb && s.ground && feet(s) === 6 * TS, 400, 'roof 2'), B.up('ArrowUp'), cyAfter(120)), snapped: restAt(87, 6) };
    D.spawn(3); D.place(cx(103), 9 * TS); settle(30); B.down('ArrowRight'); B.jump(22); B.until(landedAt(7), 120, 'belt'); B.upAll();
    const belt = { jumpedUp: cyAfter(90) }; belt.snapped = restAt(Math.floor((D.state().x + P.W / 2) / TS), 7);
    const look = (c, row, face, land) => { D.spawn(2); D.place(cx(c), row * TS); LVL.engine.player.face = face; D.snap(); settle(90); const cy = D.state().cy; return { cy, landingOverBottom: VH - (land - cy) }; };
    res.camRest = { roof1, roof2, belt, peek: C.peek,
      lookDown: { roof2RightFacing: look(93, 6, 1, CST), roof2RightAway: look(93, 6, -1, CST), roof1LeftFacing: look(66, 8, -1, CST), roof1LeftAway: look(66, 8, 1, CST) } };
    // a hop in place changes no view: a jump straight up right after climbing onto roof 1 (the settle to its rest still running)
    // ends at the roof's rest; one on the belt while the camera pans up to its rest still gets there; one at roof 2's right edge
    // with the look-down on keeps the look (cy over the whole hop)
    const hop = (n = 22) => { B.jump(n); B.until(s => !s.ground, 20, 'hop: up'); return B.until(s => s.ground, 120, 'hop: down'); };
    D.spawn(2); D.place(cx(65), CST); face(1); B.down('ArrowUp'); B.until(s => !s.climb && s.ground && feet(s) === 8 * TS, 400, 'roof 1'); B.up('ArrowUp'); settle(10);
    const climb = { landedFeet: Math.round(feet(hop())), cy: cyAfter(150), rest: Math.round(roof1.snapped) };
    D.spawn(3); D.place(cx(103), 9 * TS); settle(30); B.down('ArrowRight'); B.jump(22); B.until(landedAt(7), 120, 'belt'); B.upAll(); settle(20);
    const beltHop = { cyAtHop: D.state().cy, landedFeet: Math.round(feet(hop())), cy: cyAfter(150), rest: Math.round(belt.snapped) };
    D.spawn(2); D.place(cx(89), 6 * TS); face(1); D.snap(); settle(60); B.down('ArrowRight'); B.until(s => s.x + P.W > 93.6 * TS, 200, 'roof 2 edge'); B.upAll(); settle(120);
    const lookCy = D.state().cy, cys = [lookCy]; B.jump(6); for (let i = 0; i < 90; i++){ const st = B.tick(); cys.push(st.cy); }
    res.camHop = { climb, belt: beltHop, edge: { lookCy, cy: [Math.min(...cys), Math.max(...cys)], landedFeet: Math.round(feet(D.state())) } }; }
  // The camera's SPEED with his feet on one floor: from one step to the next his frame y moves CAM.pan px at most (the settling
  // after an arrival, the look-downs, E's framing are slow pans; nothing after a step down slides him up the screen). watch(f):
  // the steps f plays, recorded; panStats: the largest such move (groundPx), the largest rise on screen of any step (risePx: a
  // jump's own rise counts) and of a falling one (fallRisePx), the camera y first and last. Walking down the A steps from the
  // start - no jump: he never rises on screen more than CAM.pan, and each 1-tile step moves the camera a tile at most (its y where
  // he leaves each floor, and settled on the street) -, jumping back up onto the heap, from the top crate onto the belt, up to
  // roof 2's right edge and roof 1's left one (the look-downs) - then a few taps the other way at the edge do not bob it, and
  // walking away it comes back -, into E and out of it
  const watch = f => { B.rec = []; f(); const r = B.rec; B.rec = null; return r; };
  const panStats = r => { let ground = 0, rise = 0, fallRise = 0;
    for (let i = 1; i < r.length; i++){ const a = r[i - 1], b = r[i]; if (a.dead || b.dead) continue;
      if (a.g && b.g && !a.cl && !b.cl && a.on === b.on && a.feet === b.feet) ground = Math.max(ground, Math.abs(b.sy - a.sy));
      if (!b.g && !b.cl && b.vy > 0) fallRise = Math.max(fallRise, a.sy - b.sy);
      rise = Math.max(rise, a.sy - b.sy); }
    return { steps: r.length, groundPx: ground, risePx: rise, fallRisePx: fallRise, cy: [r[0].cy, r[r.length - 1].cy] }; };
  { const pan = res.groundPan = {}, run = (name, f) => { const r = watch(f); pan[name] = panStats(r); return r; };
    const aw = run('A_walkDown', () => { D.spawn(0); settle(30); B.down('ArrowRight'); B.until(s => s.x > 15 * TS, 600, 'A: down the steps'); B.upAll(); settle(90); });
    const floors = []; for (const e of aw) if (e.g){ if (!floors.length || floors[floors.length - 1].feet !== e.feet) floors.push({ feet: e.feet, cy: e.cy }); else floors[floors.length - 1].cy = e.cy; }
    pan.A_walkDown.floors = floors.map(f => [f.feet, f.cy]); pan.A_walkDown.cyPerStep = floors.slice(1).map((f, i) => f.cy - floors[i].cy);
    run('A_heapUp', () => { D.spawn(0); D.place(cx(7), 9 * TS); D.snap(); settle(60); B.down('ArrowLeft'); B.jump(20); B.until(landedAt(8), 200, 'A: back on the heap'); B.upAll(); settle(90); });
    run('D_crateToBelt', () => { D.spawn(3); D.place(cx(103), 9 * TS); D.snap(); settle(60); B.down('ArrowRight'); B.jump(22); B.until(landedAt(7), 200, 'D: on the belt'); B.upAll(); settle(120); });
    run('C_roof2Edge', () => { D.spawn(2); D.place(cx(89), 6 * TS); face(1); D.snap(); settle(60); B.down('ArrowRight'); B.until(s => s.x + P.W > 93.6 * TS, 200, 'roof 2 edge'); B.upAll(); settle(120); });
    const taps = watch(() => { for (let k = 0; k < 3; k++){ B.down('ArrowLeft'); settle(5); B.up('ArrowLeft'); settle(4); B.down('ArrowRight'); settle(4); B.up('ArrowRight'); settle(4); } settle(10); });
    pan.C_roof2Taps = { cy: [Math.min(...taps.map(e => e.cy)), Math.max(...taps.map(e => e.cy))], lookCy: pan.C_roof2Edge.cy[1] };
    run('C_roof2Away', () => { B.down('ArrowLeft'); settle(40); B.upAll(); settle(120); });
    run('C_roof1Edge', () => { D.spawn(2); D.place(cx(70), 8 * TS); face(-1); D.snap(); settle(60); B.down('ArrowLeft'); B.until(s => s.x < 66.3 * TS, 200, 'roof 1 edge'); B.upAll(); settle(120); });
    run('E_in', () => { D.spawn(3); D.place(cx(128), gy); D.snap(); settle(60); B.down('ArrowRight'); B.until(s => s.x >= 142 * TS, 900, 'E: at the shaft'); B.upAll(); settle(90); });
    run('E_out', () => { B.down('ArrowLeft'); B.until(s => s.x < 130 * TS, 900, 'E: out'); B.upAll(); settle(60); }); }
  // E with a headframe taller than the street view shows (props.headframe() stubbed to the 64 px design's box x K, 480 x 438 on
  // the shaft, its top at y 90): while he waits for the cage the view lifts to the box's top CAM.frameTop px under the frame's
  // top (y 82), the street ~83 % down, the base inside; riding down it holds that view until it has to follow him; entering and
  // leaving E it pans CAM.pan px a step at most
  { const props = LVL.art.props, own = props.headframe, E = { x: 146.5 * TS - 160 * K, w: 320 * K, h: 292 * K }, top = gy - E.h;
    props.headframe = () => ({ x: E.x, x1: E.x + E.w, top });
    try {
      let w = null; const inE = watch(() => { D.spawn(3); D.place(cx(128), gy); D.snap(); settle(60); B.down('ArrowRight'); B.until(s => s.x >= 142 * TS, 900, 'E box: at the shaft'); B.upAll();
        B.until(s => s.vx === 0, 60, 'E box: stopped'); w = B.until(s => s.movers.cage.y <= gy + 0.01 && s.movers.cage.waitT > 1.2, 1500, 'E box: cage resting at the top'); });
      B.down('ArrowRight'); B.until(s => s.x >= 145.9 * TS, 120, 'E box: stepping in'); B.upAll(); B.until(s => s.on === 'cage', 60, 'E box: in the cage');
      const desc = []; for (let i = 0; i < 900; i++){ const s = B.tick(); if (s.winT) break; if (s.on === 'cage' && s.movers.cage.dir > 0 && s.movers.cage.y > gy + 0.01) desc.push([Math.round(feet(s)), s.cy]); }
      const outE = watch(() => { D.spawn(4); D.place(cx(140), gy); D.snap(); settle(60); B.down('ArrowLeft'); B.until(s => s.x < 130 * TS, 900, 'E box: out'); B.upAll(); settle(60); });
      const C = D.CAM, view = Math.max(top - C.frameTop, gy - Math.floor(C.street * VH)), held = desc.filter(([f]) => f <= view + VH - C.margin - 2);
      res.landmarkBox = { top, view, wait: { cx: w.cx, cy: w.cy, topFrameY: top - w.cy, streetShare: +((gy - w.cy) / VH).toFixed(3), baseInside: E.x >= w.cx && E.x + E.w <= w.cx + VW },
        descent: { steps: desc.length, held: held.length, offHold: held.filter(([, cy]) => Math.abs(cy - view) > 1).slice(0, 5), last: desc[desc.length - 1] }, panIn: panStats(inE), panOut: panStats(outE) };
    } finally { props.headframe = own; } }
  // fuzz: random key states from every checkpoint (fixed seed); the hitbox must never overlap a solid tile, nothing may go NaN
  { let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft'], f = { frames: 0, overlap: 0, nan: 0, camOut: 0, groundPanPx: 0, anims: {} }, on = {};
    for (let cp = 0; cp < M.CHECK.length; cp++){ D.spawn(cp); let q = null;
      for (let i = 0; i < 4000; i++){ if (rnd() < 0.08){ const c = codes[(rnd() * codes.length) | 0]; on[c] = !on[c]; on[c] ? B.down(c) : B.up(c); }
        const s = B.tick(); f.frames++; if (!isFinite(s.x) || !isFinite(s.y)) f.nan++; f.anims[s.anim] = (f.anims[s.anim] || 0) + 1;
        if (q && __sameFloor(q, s)) f.groundPanPx = Math.max(f.groundPanPx, Math.abs(s.screen[1] - q.screen[1])); q = s;
        if (s.winT === 0 && s.deathT === 0){ const c0 = Math.floor(s.x / TS), c1 = Math.floor((s.x + P.W - 0.01) / TS), r0 = Math.floor(s.y / TS), r1 = Math.floor((s.y + P.H - 0.01) / TS);
          for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) if (M.isSolid(c, r)){ f.overlap++; c = c1 + 1; break; }
          if (s.sprite && s.y + P.H <= M.LH && (__offFrame(s.sprite) || s.screen[1] > VH)) f.camOut++; } }
      B.upAll(); for (const c of codes) on[c] = false; }
    res.fuzz = f; }
  // ... and after a death (fall into the B chasm -> respawn at checkpoint 1)
  { D.spawn(1); D.place(44 * TS, 300 * K); let s = D.state(), was = false, at = null;
    for (let i = 0; i < 200; i++){ s = B.tick(); if (s.deathT > 0) was = true; else if (was){ at = rest(s); break; } }
    res.respawnCam.death = at; }
  // CAMERA, played: from every kind of surface he can stand on (the start heap, a loading station, the C roofs and the catwalk, the
  // highest roof, a crate, the belt, the street) a full jump standing and running off both ways, the camera settled on him first:
  // his drawn frame stays inside the frame ([its lowest top, its feet's lowest frame y] per jump); and climbing ladder 81 onto the
  // highest roof with a full jump the moment he stands there (the camera still easing up)
  { const surf = [['heap', 0, 3, 8], ['station', 1, 39, 9], ['roof1', 2, 70, 8], ['catwalk', 2, 79, 8], ['roof2', 2, 87, 6], ['crate', 3, 103, 9], ['belt', 3, 110, 7], ['street', 4, 137, 11]];
    const out = {}, arc = () => { let top = 1e9, low = -1e9;
      for (let i = 0; i < 150; i++){ const s = B.tick(); if (s.sprite && !s.deathT && s.y + P.H <= M.LH){ top = Math.min(top, s.sprite.y); low = Math.max(low, s.screen[1]); } if (i > 3 && s.ground && !s.on) break; }
      B.upAll(); return [top, low]; };
    for (const [name, cp, c, r] of surf){ const o = out[name] = {};
      for (const [k, dir] of [['stand', 0], ['runR', 1], ['runL', -1]]){
        D.spawn(cp); D.place(cx(c), r * TS); for (let i = 0; i < 90; i++) B.tick();
        if (dir){ B.down('ShiftLeft'); B.down(dir > 0 ? 'ArrowRight' : 'ArrowLeft'); B.tick(); }
        B.jump(40); o[k] = arc(); } }
    { D.spawn(2); D.place(cx(79), 8 * TS); for (let i = 0; i < 90; i++) B.tick(); B.down('ArrowRight'); let s = D.state(), top = 1e9, low = -1e9;
      const seen = () => { if (s.sprite){ top = Math.min(top, s.sprite.y); low = Math.max(low, s.screen[1]); } };
      for (let i = 0; i < 120 && !s.climb; i++){ s = B.tick(); seen(); } B.up('ArrowRight'); B.down('ArrowUp');
      for (let i = 0; i < 400 && !(s.ground && !s.climb); i++){ s = B.tick(); seen(); }
      B.up('ArrowUp'); const onRoof = s.ground && s.y + P.H === 6 * TS; B.jump(40);
      for (let i = 0; i < 70; i++){ s = B.tick(); seen(); if (i > 3 && s.ground) break; } B.upAll();
      out.climbThenJump = { onRoof, top, low }; }
    res.camJumps = out; }
  // the top of his HEAD as drawn, in world px: the frame's first opaque row over the middle half of the hitbox (raised hands, out to
  // the sides at take-off, are not the head)
  const headTop = s => { const set = s.set === 'left' ? LVL.sheet.sets[-1] : LVL.sheet.anims, f = set[s.clip].frames[s.fi], hw = P.W / 4;
    for (let y = 0; y < f.h; y++) for (let x = Math.ceil(f.ax - hw); x <= f.ax + hw; x++) if (sheetPx.data[((f.y + y) * sheetPx.width + f.x + x) * 4 + 3]) return s.sprite.y + s.cy + y;
    return Infinity; };
  // jump in place in the moving bucket: the carry keeps him over the tub, he lands back in it, his hair stops under the yoke
  { const bk = LVL.engine.movers.find(m => m.id === 'bucket'), ceil = bk.ceil; D.spawn(1); const d0 = D.state().stats.deaths;
    for (let i = 0; i < 1500; i++){ B.tick(); if (bk.x <= 41 * TS + 0.01 && bk.waitT > 0.6) break; }
    D.place(39 * TS + 4 * K, 9 * TS); B.tick(); B.down('ArrowRight'); let s;
    for (let i = 0; i < 200; i++){ s = B.tick(); if (s.x > 41 * TS + 14.3 * K){ B.up('ArrowRight'); break; } }
    for (let i = 0; i < 300 && !(s.on === 'bucket' && bk.dx > 0 && bk.x > 43 * TS); i++) s = B.tick();
    const bx0 = bk.x; let air = 0, clear = 1e9, back = false; B.jump(30);
    for (let i = 0; i < 60; i++){ s = B.tick(); if (!s.ground) air++; if (s.sprite) clear = Math.min(clear, headTop(s) - (Math.round(bk.y) + ceil.y)); if (i > 3 && s.on === 'bucket'){ back = true; break; } }
    B.upAll(); res.bucketJump = { startedAt: Math.round(bx0), airFrames: air, landedBackInBucket: back, hairUnderYokePx: clear, died: D.state().stats.deaths > d0 }; }
  // jump under the belt (D, col 105): the hair stops under the belt (its row ends at y = 8 * TS)
  { D.spawn(3); D.place(cx(105), gy); B.tick(); B.jump(40); let top = 1e9; for (let i = 0; i < 60; i++){ const s = B.tick(); if (s.sprite) top = Math.min(top, headTop(s)); }
    B.upAll(); res.underBelt = { headTop: top, beltBottom: 8 * TS }; }
  // fx anchors sit on what props painted: the lamp glass, the guard tower's lens, the nozzle bores (static playfield pixels)
  { const an = LVL.art.props.anchors(), g = LVL.engine.game().getContext('2d'), hex = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); };
    res.anchors = { lamps: an.lamps.map(a => hex(a.x, a.y)), searchlights: an.searchlights.map(a => hex(a.x, a.y)), vents: an.vents.map(a => hex(a.x, a.y)), nLamps: an.lamps.length, nMapLamps: M.ENT.lamps.length,
      chimneys: an.chimneys.length, nMapChimneys: M.ENT.chimneys.length }; }
  // foreground silhouettes (fg, 1.35 x camera across) over the hero's box (a tile wide, his sprite tall), the camera at its rest
  // for him there: per column (street, roofs, and the cage at the top of the shaft); the shaft edge and the cage (cols 140-149),
  // where he times the cage, must stay clear
  { const bg = LVL.art.bg, L = bg.layers.fg, d = L.c.getContext('2d').getImageData(0, 0, L.c.width, L.c.height).data, occ = {}, hp = LVL.sheet.px;
    for (let c = 1; c < M.MW - 1; c++){ const row = M.standRow(c) < M.MH ? M.standRow(c) : (c >= M.ENT.shaft.c0 && c <= M.ENT.shaft.c1 ? M.GROUND : null); if (row === null) continue;
      D.place(cx(c), row * TS); const cam = D.snap(), x = c * TS + TS / 2, feet = row * TS, vx = Math.round(cam.camX), vy = Math.round(cam.camY);
      const off = bg.offset('fg', vx), oy = bg.offsetY('fg', vy), sx = x - vx; let n = 0;
      for (let y = feet - vy - hp; y < feet - vy; y++){ const ly = y - oy; if (ly < 0 || ly >= L.c.height) continue;
        for (let X = sx - TS / 2; X < sx + TS / 2; X++){ const u = ((off + X) % L.lw + L.lw) % L.lw; if (d[(ly * L.c.width + u) * 4 + 3] > 0) n++; } }
      if (n) occ[c] = n; }
    res.fgOcclusion = occ; }
  // sign boards: bottom edge >= 80 draft px over their street (above the hero's head), and no tile inside the board (ladders, houses)
  res.signs = LVL.art.props.signs().map(b => { const tilesIn = new Set();
    for (let c = Math.floor(b.x / TS); c <= Math.floor((b.x + b.w - 1) / TS); c++) for (let r = Math.floor(b.y / TS); r <= Math.floor((b.y + b.h - 1) / TS); r++){ const t = M.tile(c, r); if (t !== '.') tilesIn.add(t); }
    return { text: b.text, cols: [+(b.x / TS).toFixed(1), +((b.x + b.w) / TS).toFixed(1)], bottomOverStreet: b.street - (b.y + b.h), tilesIn: [...tilesIn] }; });
  // parallax: at the camera's top, middle and lowest view, along the level, no pixel of the frame is left at the clear colour
  // (#0c0a0c, in no ramp): every layer covers the frame's top and bottom wherever it scrolls
  { const g = document.getElementById('cv').getContext('2d'), low = M.LH - VH, gaps = []; D.setPlay(false);
    for (const cy of [0, Math.round(low / 2), low]) for (let cx = 0; cx <= M.LW - VW; cx += 13 * TS){ D.cam(cx, cy); LVL.engine.render();
      const d = g.getImageData(0, 0, VW, VH).data; let n = 0, y0 = VH, y1 = -1;
      for (let i = 0; i < d.length; i += 4) if (d[i] === 12 && d[i + 1] === 10 && d[i + 2] === 12){ n++; const y = (i >> 2) / VW | 0; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (n) gaps.push({ cx, cy, n, rows: [y0, y1] }); }
    D.setPlay(true); res.gaps = gaps; }
  // the level's two ends (P.END): walking, running, a jump and a run-jump into either end, from 4 tiles off it (one jump on the
  // way, one pressed against the end: the jump apex's outstretched hand is his widest frame) keep his drawn frame's box inside
  // the frame: per run [its leftmost x, its rightmost x + w] and where he stopped
  { const out = {};
    for (const [side, cp, c, key] of [['L', 0, 4, 'ArrowLeft'], ['R', 4, M.MW - 5, 'ArrowRight']]) for (const how of ['walk', 'run', 'jump', 'runJump']){
      D.spawn(cp); D.place(cx(c), M.standRow(c) * TS); D.snap(); for (let i = 0; i < 30; i++) B.tick();
      if (how.startsWith('run')) B.down('ShiftLeft'); B.down(key);
      let lo = 1e9, hi = -1e9, s = D.state();
      for (let i = 0; i < 150; i++){ if (how.includes('ump') && (i === 6 || i === 90)) B.jump(40); s = B.tick();
        if (s.sprite && !s.deathT){ lo = Math.min(lo, s.sprite.x); hi = Math.max(hi, s.sprite.x + s.sprite.w); } }
      B.upAll(); for (let i = 0; i < 40; i++) B.tick();
      out[side + '_' + how] = { box: [lo, hi], stopX: +s.x.toFixed(1) }; }
    res.ends = { END: P.END, W: P.W, LW: M.LW, runs: out }; }
  // a mover's front parts (the cage's bars and posts, the bucket's near wall) go over the hero only while his hitbox is inside the
  // mover's span: outside it (at the shaft's lip, on the loading station) they are drawn under him, his face in front of the post;
  // straddling its edge or inside it, over him. Which pass draws each, for the cage at the top and the bucket docked at the B
  // station: before fx.drawPlayBack (the pass right before the hero: under him) or after it (over him)
  { const props = LVL.art.props, fx = LVL.art.fx, own = [props.drawMoverFront, fx.drawPlayBack], log = [], out = {};
    props.drawMoverFront = function(ctx, m, v){ log.push(m.id); return own[0].call(this, ctx, m, v); };
    fx.drawPlayBack = function(ctx, v){ log.push('|'); return own[1].call(this, ctx, v); };
    try {
      const mv = id => LVL.engine.movers.find(m => m.id === id), cg = mv('cage'), bk = mv('bucket');
      for (const [m, cp, park, feet] of [[cg, 4, { y: cg.min }, cg.min], [bk, 1, { x: bk.min }, 9 * TS]]){
        D.spawn(cp); Object.assign(m, park);
        for (const [k, x] of [['outside', m.x - P.W - 6], ['straddling', m.x - P.W / 2], ['inside', m.x + (m.w - P.W) / 2]]){
          D.place(x, feet); D.snap(); log.length = 0; LVL.engine.render();
          const i = log.indexOf(m.id), j = log.indexOf('|'); out[m.id + '_' + k] = i < 0 ? 'none' : i < j ? 'under' : 'over'; } }
    } finally { props.drawMoverFront = own[0]; fx.drawPlayBack = own[1]; }
    res.moverFront = out; }
  return res;
});
report.probe = probe;
const seen = report.seen = await page.evaluate(() => __bot.seen);
const states = ['idle', 'walk', 'run', 'jump_up', 'jump_apex', 'fall', 'land', 'climb'];
const used = Object.fromEntries(states.map(st => [st, Object.keys(seen).filter(k => k.startsWith(st + ' >')).map(k => k.split(' > ')[1])]));
check('all 8 animation states played, each with its own sheet clip (no safety net)', states.every(st => used[st].length && used[st].every(c => c === st)), used);
console.log('  probes', JSON.stringify(probe));
const P = await page.evaluate(() => { const P = LVL.engine.P; return { JUMP_H: P.JUMP_H, WALK: P.WALK }; });
check('jump apex ~2.35 tiles (P.JUMP_H)', Math.abs(probe.runJump.apex - P.JUMP_H) < 3 * K && Math.abs(probe.walkJump.apex - P.JUMP_H) < 3 * K && Math.abs(P.JUMP_H / TS - 2.34) < 0.02, { walk: probe.walkJump.apex, run: probe.runJump.apex, tiles: P.JUMP_H / TS });
check('run speed ~1.6x walk', Math.abs(probe.runJump.speed / probe.walkJump.speed - 1.6) < 0.05, { walk: probe.walkJump.speed, run: probe.runJump.speed });
check('releasing jump early gives a short hop', probe.shortHop < 40 * K, probe.shortHop);
check('a walking jump clears ~2.8 tiles, a running one ~4.2 (gap from the take-off edge)', Math.abs(probe.walkJump.gapTiles - 2.8) < 0.15 && Math.abs(probe.runJump.gapTiles - 4.2) < 0.2, { walk: probe.walkJump.gapTiles, run: probe.runJump.gapTiles });
check('walking jump clears the A trench', probe.trenchTakeoffSpeed <= Math.round(P.WALK) && probe.trenchWalkJump.ground && !probe.trenchWalkJump.died && probe.trenchWalkJump.landedX > 23 * TS - 20 * K, probe.trenchWalkJump);
check('run jump + coyote time cannot clear the E shaft (5 tiles) - nor the 8-tile chasm, wider still', probe.shaftRunJump.allDied && probe.shaftRunJump.coyoteJumps >= 4 && probe.shaftRunJump.farthestRightEdge <= 149 * TS,
  { farthestRightEdge: probe.shaftRunJump.farthestRightEdge, farSide: 149 * TS, feetBelowFarLedgeAtBest: probe.shaftRunJump.closestMissPx, coyoteJumps: probe.shaftRunJump.coyoteJumps });
const LF = probe.ladderFoot;
check('ladder foot: after climbing down and letting go, Left walks away (ladders 65 and 81)', ['l65_from_roof', 'l65_wait1', 'l81_mid'].every(k => LF[k].reachedStreet && LF[k].movedLeft > 60 * K && !LF[k].climbAfter) && LF.l81_caught.caught && LF.l81_caught.movedLeft > 60 * K, LF);
check('ladder top: climbing out stands on the roof at once (no hop, no air frame)', probe.ladderTop.ended && probe.ladderTop.airFramesAfter === 0 && probe.ladderTop.riseAboveRoofPx <= 0.01 && !probe.ladderTop.seq.some(a => /jump|fall/.test(a)), probe.ladderTop);
check('A slag steps keep the ground cycle (no air pose on a 1-tile step down)', probe.steps.airFrames > 0 && probe.steps.airPoses === 0, probe.steps);
{ const A = probe.airArc, full = a => a.back === 0 && a.clips.join() === 'jump_up,jump_apex,fall';
  check('the air clips follow the vertical speed: jump_up -> jump_apex -> fall, frames only forward (a short hop skips the tuck)',
    full(A.standing) && full(A.running) && full(A.left) && A.shortHop.back === 0 && !A.shortHop.seq.includes('jump_up#2') && A.shortHop.clips.includes('jump_apex'), A);
  check('facing left plays the left set (no mirroring); facing right the right set', A.left.sets.join() === 'left' && A.standing.sets.join() === 'right' && A.running.sets.join() === 'right', { left: A.left.sets, right: A.running.sets }); }
// The left set is the 3D model seen from the other side, not a mirror. The pauldron (its bright orange) sits on his LEFT shoulder:
// facing left that is the near shoulder, so it shows in every frame of the left set (near the body's axis in the near-profile game
// view: no more than 3 px behind the anchor however far he leans into a run); facing right it is the far one, hidden in many frames
// and, where it peeks out, screen right of the anchor; on the ladder (seen from behind) it is screen left in both. A mirror of the
// right set would show it only in the frames where the right set does. And both are lit from the upper left: over all frames the
// silhouette's left-edge pixels (inside the black contour) are brighter than its right-edge ones (a mirror flips the sign).
{ const look = await page.evaluate(() => {
    const S = LVL.sheet, img = S.img, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width;
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = i => 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
    const out = {};
    for (const [k, set] of [['right', S.sets[1]], ['left', S.sets[-1]]]){
      if (!set){ out[k] = null; continue; }
      const o = out[k] = { pauldron: {} }; let ev = 0, en = 0;
      for (const [name, clip] of Object.entries(set)){
        const xs = [];
        for (const fr of clip.frames){ let sx = 0, n = 0;
          for (let y = 0; y < fr.h; y++){ const row = [];
            for (let x = 0; x < fr.w; x++){ const i = ((fr.y + y) * W + fr.x + x) * 4; if (!d[i + 3]) continue;
              if (d[i] > 150 && d[i + 1] > 60 && d[i + 1] < 170 && d[i + 2] < 90 && d[i] - d[i + 2] > 100){ sx += x + 0.5 - fr.ax; n++; }
              if (d[i] + d[i + 1] + d[i + 2] >= 30) row.push(lum(i)); }
            if (row.length >= 6){ ev += (row[0] + row[1] - row[row.length - 1] - row[row.length - 2]) / 2; en++; } }
          if (n) xs.push(sx / n); }
        o.pauldron[name] = { frames: xs.length, of: clip.frames.length, meanX: xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null };
      }
      o.leftMinusRightEdgeL = +(ev / en).toFixed(4);
    }
    return out; });
  const onLeftShoulder = (set, near) => Object.entries(set.pauldron).every(([n, p]) => (near ? p.frames === p.of : true) && (p.frames === 0 || (n === 'climb' ? p.meanX < 0 : p.meanX > (near ? -3 : 0))));
  check('the left set is rendered from the 3D model, not mirrored: pauldron on his LEFT shoulder in both sets, both lit from the upper left',
    look.left && onLeftShoulder(look.left, true) && onLeftShoulder(look.right, false) && look.left.leftMinusRightEdgeL > 0 && look.right.leftMinusRightEdgeL > 0, look); }
check('land plays straight out of a hard landing and only then (walking on ends it; a landing on the move shows none: no late squash)',
  probe.landWalkOff.firstGroundAnim === 'land' && probe.landWalkOff.walkedAt >= 0 && !probe.landWalkOff.landAfterWalk && !probe.landRunStop.land, { walkOff: probe.landWalkOff, runStop: probe.landRunStop });
check('the climb advances its frames with the distance climbed (dy: hands planted), holds still when he hangs, hands on the ladder axis',
  ['right', 'left'].every(k => { const c = probe.climbSync[k]; return c.samples > 30 && c.worstFrameOff === 0 && c.heldStill && c.handsOffAxisPx <= 1 && c.sets.join() === k; }), probe.climbSync);
{ const R = probe.climbSync.right.drawnUpperOffAxisPx, L = probe.climbSync.left.drawnUpperOffAxisPx;
  check('the climb is drawn on the ladder axis in both facings, at the same pixel (measured on the drawn pixels, not the sheet\'s lx)',
    Math.abs(R) <= 1.5 && Math.abs(L) <= 1.5 && Math.abs(R - L) <= 0.5, { right: R, left: L }); }
{ const W = probe.walkOff;
  check('walking off an edge goes straight to fall (no jump rise / top); stepping off the hunt stays in the walk cycle',
    W.roof.seq.includes('fall') && !W.roof.seq.some(a => a === 'jump_up' || a === 'jump_apex') && W.roof.ground && W.roof.airFrames > 15 &&
    W.cart.airFrames > 0 && W.cart.seq.every(a => ['idle', 'walk', 'run'].includes(a)) && W.cart.ground && W.cart.feet === 11 * TS, W); }
check('a turnaround on the ground shows no idle frame (walk / run one way, then the other); pushing against a wall idles',
  ['walk', 'run'].every(k => !probe.turn[k].seq.includes('idle') && probe.turn[k].vx < -50 * K) && probe.turn.wall.x === probe.turn.wall.blockAt && probe.turn.wall.seq[probe.turn.wall.seq.length - 1] === 'idle', probe.turn);
check('rider keeps one pixel offset on the moving bucket and cart', Object.values(probe.rider).every(r => Object.keys(r).length === 1 && Object.values(r)[0] > 30), probe.rider);
check('fuzz: 20 000 random-input frames never put the hitbox in a solid tile (no NaN) nor his drawn frame out of the frame', probe.fuzz.overlap === 0 && probe.fuzz.nan === 0 && probe.fuzz.camOut === 0 && probe.fuzz.frames === 20000, probe.fuzz);
check('camera: the hero does not flicker 1 px in the frame while walking / running, nor while climbing with the camera following him up',
  probe.camera.walk.flips === 0 && probe.camera.run.flips === 0 && probe.camera.climb.flips === 0 && probe.camera.climb.steps > 20 && probe.camera.climb.camMovedUp > TS, probe.camera);
{ const F = probe.fallCam, L81 = F.catwalkIntoLadder81, H = L81.hang;
  check('camera on walk-offs: while he falls his frame y never rises > 1 px a step, a <= 1 px drop moves it <= 3 px (catwalk into ladder 81, roof 2 right / left, roof 1 left, the belt-end jump); hanging on ladder 81 after the catch, it holds',
    Object.values(F).every(f => f.fallSteps > 0 && f.maxRisePx <= 1 && f.camOnSmallDropPx <= 3) && L81.end.climb && H.steps === 60 && H.cy[0] === H.cy[1] && H.cy[0] === L81.end.cy, F); }
{ const H = probe.camHop;
  check('camera: a hop in place changes no view - right after climbing onto roof 1 it still settles to the roof\'s rest, on the belt mid-pan it still reaches the belt\'s, at roof 2\'s edge the look-down holds through the hop',
    H.climb.landedFeet === 8 * TS && Math.abs(H.climb.cy - H.climb.rest) <= 1 && H.belt.landedFeet === 7 * TS && H.belt.cyAtHop > H.belt.rest + TS / 2 && Math.abs(H.belt.cy - H.belt.rest) <= 1 &&
    H.edge.landedFeet === 6 * TS && H.edge.cy[1] - H.edge.cy[0] <= 1 && Math.abs(H.edge.cy[0] - H.edge.lookCy) <= 1, H); }
{ const C = probe.camRest, same = (a, b) => Math.abs(a - b) <= 1, L = C.lookDown;
  check('camera: one rest per surface, however he got there (roof 1 climbed / from roof 2 / snapped, roof 2 climbed / snapped, belt jumped onto / snapped); facing the drop at a roof edge it looks down until the landing street shows',
    same(C.roof1.climbed, C.roof1.snapped) && same(C.roof1.fromRoof2, C.roof1.snapped) && same(C.roof2.climbed, C.roof2.snapped) && same(C.belt.jumpedUp, C.belt.snapped) &&
    L.roof2RightFacing.landingOverBottom >= C.peek - 1 && L.roof1LeftFacing.landingOverBottom >= C.peek - 1 && same(L.roof2RightAway.cy, C.roof2.snapped) && same(L.roof1LeftAway.cy, C.roof1.snapped), C); }
{ const G = probe.groundPan, pan = await page.evaluate(() => LVL.debug.CAM.pan), A = G.A_walkDown, T = G.C_roof2Taps, LB = probe.landmarkBox;
  const scen = Object.entries(G).filter(([, g]) => 'groundPx' in g);
  check(`camera speed: with his feet on one floor he moves at most CAM.pan = ${pan} px on screen a step (A's first steps down, the heap jumped back up, crate to belt, both roof-edge look-downs and away, E in and out - with a taller 438 px headframe too -, the fuzz)`,
    scen.length === 8 && scen.every(([, g]) => g.groundPx <= pan) && probe.fuzz.groundPanPx <= pan && LB.panIn.groundPx <= pan && LB.panOut.groundPx <= pan,
    { ...Object.fromEntries(scen.map(([k, g]) => [k, { groundPx: g.groundPx, cy: g.cy }])), fuzz: probe.fuzz.groundPanPx, boxIn: LB.panIn.groundPx, boxOut: LB.panOut.groundPx });
  check('A steps from the start: walking down to the street he never rises on screen more than CAM.pan px a step, and each 1-tile step moves the camera a tile at most',
    A.risePx <= pan && A.floors.map(f => f[0]).join() === [8, 9, 10, 11].map(r => r * TS).join() && A.cyPerStep.every(d => Math.abs(d) <= TS + 1), A);
  check('look-down: at roof 2\'s edge a few taps away from the drop and back keep the look (no bob); walking away, it comes back to the roof\'s rest',
    T.cy[1] - T.cy[0] <= 1 && Math.abs(T.cy[0] - T.lookCy) <= 1 && T.lookCy > Math.round(probe.camRest.roof2.snapped) + TS / 2 && Math.abs(G.C_roof2Away.cy[1] - Math.round(probe.camRest.roof2.snapped)) <= 1,
    { taps: T, away: G.C_roof2Away.cy, roof2Rest: probe.camRest.roof2.snapped });
  check('E with a taller headframe (props.headframe() stubbed to a 438 px box): while he waits for the cage the view lifts to y 82 - its top 8 px in, the street 82-85 % down, the base inside - held into the cage descent',
    LB.view === 82 && Math.abs(LB.wait.cy - LB.view) <= 1 && LB.wait.topFrameY >= 7 && LB.wait.streetShare >= 0.82 && LB.wait.streetShare <= 0.85 && LB.wait.baseInside &&
    LB.descent.steps > 30 && LB.descent.held > 10 && LB.descent.offHold.length === 0, { top: LB.top, view: LB.view, wait: LB.wait, descent: LB.descent }); }
check('win only while riding the cage down (falling onto it as it rises is not a win)', probe.cageWin.landedOnRisingCage && probe.cageWin.won && !probe.cageWin.winWhileRising, probe.cageWin);
{ const J = probe.camJumps, arcs = Object.entries(J).filter(([n]) => n !== 'climbThenJump').flatMap(([, o]) => Object.values(o)), C = J.climbThenJump;
  check('CAMERA: a full jump (standing, running either way) from every kind of surface - the highest roof too, and right after climbing onto it - keeps his whole drawn frame in the frame',
    arcs.length === 24 && arcs.every(([top, low]) => top >= 0 && low <= VH) && C.onRoof && C.top >= 0 && C.low <= VH, J); }
check('a jump in place in the moving bucket lands back in it (platform carry), the hair stops under the yoke', probe.bucketJump.landedBackInBucket && !probe.bucketJump.died && probe.bucketJump.hairUnderYokePx >= 0 && probe.bucketJump.airFrames > 0, probe.bucketJump);
check('a jump under the belt stops under it (no head through the belt)', probe.underBelt.headTop >= probe.underBelt.beltBottom, probe.underBelt);
check('a respawn (win, death) puts the camera on the hero at once (both axes at their rest)', ['win', 'death'].every(k => { const r = probe.respawnCam[k]; return r && Math.abs(r.was[0] - r.rest[0]) < 0.01 && Math.abs(r.was[1] - r.rest[1]) < 0.01; }), probe.respawnCam);
check('foreground silhouettes stay off the hero at the E shaft edge and in the cage (cols 140-149)', Object.entries(probe.fgOcclusion).every(([c, n]) => c < 140 || c > 149 || n < 50 * K * K), probe.fgOcclusion);
check('parallax: no gap at the top or bottom of the frame at the camera\'s top, middle and lowest view, all along the level', probe.gaps.length === 0, probe.gaps.slice(0, 8));
check('level ends: walking, running, a jump and a run-jump into either end (P.END) keep his whole drawn frame inside the frame',
  Object.values(probe.ends.runs).every(r => r.box[0] >= 0 && r.box[1] <= VW) && probe.ends.runs.L_walk.stopX === probe.ends.END && probe.ends.runs.R_walk.stopX === probe.ends.LW - probe.ends.W - probe.ends.END, probe.ends);
check('mover fronts: the cage\'s bars and the bucket\'s near wall go under the hero outside the mover (his face in front of the post at the lip), over him straddling its edge and inside it',
  ['cage', 'bucket'].every(id => probe.moverFront[id + '_outside'] === 'under' && probe.moverFront[id + '_straddling'] === 'over' && probe.moverFront[id + '_inside'] === 'over'), probe.moverFront);
// the owner's models (art/models.js): the atlas loaded and drawn - the E headframe (the E finale check), each hunt its model sprite,
// every story prop of map ENT.models in the atlas - and those props clear of the hero: >= 1 tile off his hitbox (across, and up and
// down off his body) wherever he stands still for long (the VALUE spots, the checkpoints), off the sign and lamp posts and the
// hunts' paths
{ const mw = await page.evaluate(spots => {
    const MD = LVL.art.models, M = LVL.map, E = M.ENT, TS = M.TS, P = LVL.engine.P, gy = M.GROUND * TS, out = { ready: MD.ready, err: MD.err, clash: [], missing: [] };
    out.carts = E.movers.filter(m => m.kind === 'cart').map(m => [m.id, m.sprite, !!MD.get(m.sprite)]);
    const at = [...spots.map(([n, c]) => [n, c]), ...M.CHECK.map((c, i) => ['cp' + i, c])].map(([n, c]) => { const x = c * TS + TS / 2, f = M.standRow(Math.floor(c)) * TS;   // his centre, his feet
      return { n, x0: x - P.W / 2 - TS, x1: x + P.W / 2 + TS, y0: f - P.H - TS, y1: f + TS }; });
    const posts = [...LVL.art.props.signs().flatMap(b => [[b.x, b.x + 18], [b.x + b.w - 18, b.x + b.w]]), ...E.lamps.map(c => [c * TS + 18, c * TS + 30])];
    const paths = E.movers.filter(m => m.kind === 'cart').map(m => [m.min, m.max + m.w]);
    for (const d of E.models){ const s = MD.get(d.sprite); if (!s){ out.missing.push(d.sprite); continue; }
      const x = Math.round(d.c * TS), a = x - s.ax, e = a + s.w, top = gy - s.ay, bot = gy;
      for (const q of at) if (a < q.x1 && e > q.x0 && top < q.y1 && bot > q.y0) out.clash.push(d.sprite + ' @' + d.c + ' near ' + q.n);
      for (const [p0, p1] of posts) if (a < p1 && e > p0) out.clash.push(d.sprite + ' @' + d.c + ' on a post at ' + p0);
      for (const [p0, p1] of paths) if (a < p1 && e > p0) out.clash.push(d.sprite + ' @' + d.c + ' in a hunt\'s path'); }
    return out; }, SPOTS);
  check('the owner\'s models are wired: the atlas loaded, both hunts and every story prop (drums, the parked car) drawn from it, the props clear of where he stands, the posts and the hunts\' paths',
    mw.ready && mw.carts.every(c => c[2]) && !mw.missing.length && !mw.clash.length, mw); }
check('sign boards hang >= 80 draft px over the street and cover no ladder or house', probe.signs.every(b => b.bottomOverStreet >= 80 * K && b.tilesIn.length === 0), probe.signs);
{ const an = probe.anchors, lampHex = await page.evaluate(() => LVL.style.PAL.lamp);
  check('fx anchors sit on the painted lamp glass, searchlight lens and nozzle bores (and every chimney smokes)', an.nLamps === an.nMapLamps && an.lamps.every(h => h === lampHex) && an.searchlights.every(h => h === '#e8d8a0') && an.vents.every(h => h === '#141216') && an.chimneys === an.nMapChimneys, an); }

// ---------- NO SOFTLOCK (the search started at the top, in its own pages) ----------
const reach = await reachRun;
report.reach = reach;
if (reach.error) console.log('  no-softlock search failed: ' + reach.error);
else console.log(`  no-softlock search: ${reach.sims} runs from ${reach.nodes} nodes (${reach.standable} standable cells), ${reach.rounds} rounds in ${reach.workers} pages, ${reach.seconds} s; ${reach.reachable} reachable`);
check('NO SOFTLOCK: from every spot reachable from the start the cage win or a death is still reachable (and the win is)',
  !reach.error && reach.winReachable && reach.traps.length === 0 && reach.stuck.length === 0, reach.error || { traps: reach.traps, stuck: reach.stuck.slice(0, 10), deathOnly: reach.deathOnly });
check('the D belt pocket (cols 104-107 under the belt, the old softlock) is out of reach', !reach.error && reach.pocketReached.length === 0, reach.error || { pocketReached: reach.pocketReached, unreachedStandable: reach.unreachedStandable });

// ---------- VALUE rule: hero vs background contrast at every beat spot and checkpoint; SKY rule (their own page, started above) ----------
{
  const vs = await valueRun;
  if (vs.error){ console.log('  VALUE / SKY page failed: ' + vs.error); check('VALUE / SKY page measured', false, vs.error); }
  else {
    const { pre, con, V, sky } = vs;
    check('VALUE / SKY page: opened stopped (?manual: no step before the first tick), Math.random seeded: reproducible numbers', pre.manualAtLoad && pre.frameAtLoad === 0, pre);
    fs.writeFileSync(`${out}/contrast.json`, JSON.stringify(con, null, 1));
    report.contrast = con;
    console.log('  contrast (hero vs his ring, 6 draft px wide): ' + con.map(c => `${c.name} ${c.crRing}`).join('  '));
    const by = Object.fromEntries(con.map(c => [c.name, c.crRing])), sorted = con.map(c => c.crRing).sort((a, b) => a - b);
    check('VALUE rule: the sky-backed C roofs and catwalk reach 1.5', by.C_roof1 >= 1.5 && by.C_roof2 >= 1.5 && by.C_catwalk >= 1.5, { C_roof1: by.C_roof1, C_roof2: by.C_roof2, C_catwalk: by.C_catwalk });
    check(`VALUE rule: no spot under ${V.floor}, median >= ${V.medianMin}`, sorted[0] >= V.floor && sorted[sorted.length >> 1] >= V.medianMin, { min: sorted[0], median: sorted[sorted.length >> 1], under1_6: con.filter(c => c.crRing < 1.6).map(c => c.name + ' ' + c.crRing) });
    report.sky = sky;
    check(`SKY rule: the sunset band is >= ${sky.min} x the top of the sky at every camera`, sky.cams.every(c => c.ratio >= sky.min), sky.cams);
  }
}

// page layout: integer 1x on a laptop width, fit-to-width with 16 px gutters and no horizontal scroll on a phone
for (const [w, h, name] of [[1300, 900, 'desktop'], [375, 812, 'phone']]){
  await page.setViewportSize({ width: w, height: h });
  await page.waitForFunction(([w, VW]) => innerWidth === w && Math.abs(document.getElementById('cv').getBoundingClientRect().width - (w >= VW + 36 ? VW * Math.floor((w - 36) / VW) : w - 36)) < 1, [w, VW], { timeout: 20000, polling: 50 }).catch(() => {});   // resize -> fit() settled
  const L = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { scale: LVL.scale, w: r.width, left: r.left, right: innerWidth - r.right, scrollW: document.documentElement.scrollWidth, innerW: innerWidth }; });
  if (name === 'desktop') check(`1300 px wide page shows the canvas at exactly 1x (${VW} px)`, L.w === VW && L.scrollW <= L.innerW, L);
  else check('phone: canvas fits the width inside 16 px gutters, no horizontal scroll', L.scrollW <= L.innerW && L.left >= 16 && L.right >= 16 && L.w > 300, L);
  await page.screenshot({ path: `${out}/page_${name}.png` });
}
check('Down on a ladder top climbs down to the street', probe.ladderDownFromTop.climbed && probe.ladderDownFromTop.reachedStreet, probe.ladderDownFromTop);
check('Down on a catwalk drops through it', probe.catwalkDropThrough.ground && probe.catwalkDropThrough.feet === 12 * TS, probe.catwalkDropThrough);
check('the belt is not drop-through', probe.beltNoDrop.ground && probe.beltNoDrop.feet === 7 * TS, probe.beltNoDrop);
check('jump leaps off a ladder', probe.ladderLeap.wasClimbing && probe.ladderLeap.leapt, probe.ladderLeap);

// ---------- display + input on other screens (fresh browser contexts) ----------
const lay = report.layout = {};
async function openCtx(opt){
  const ctx = await browser.newContext(opt), pg = await ctx.newPage(); pg.on('pageerror', e => errors.push(e.message));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); await pg.goto(srv.url, NAV);
  await pg.waitForFunction(LOADED, null, { timeout: 60000 }); await waitSteps(pg, 12);
  return { ctx, pg };
}
const geom = pg => pg.evaluate(() => { const c = document.getElementById('cv').getBoundingClientRect(), pad = document.getElementById('pad'), p = pad.getBoundingClientRect();
  return { dpr: devicePixelRatio, scale: LVL.scale, dscale: LVL.dscale, crisp: LVL.crisp, smooth: document.getElementById('cv').classList.contains('smooth'),
    cv: { top: +c.top.toFixed(2), bottom: +c.bottom.toFixed(2), left: +c.left.toFixed(2), w: +c.width.toFixed(2), h: +c.height.toFixed(2) }, devLeft: +((c.left + scrollX) * devicePixelRatio).toFixed(3), devTop: +((c.top + scrollY) * devicePixelRatio).toFixed(3),
    pad: getComputedStyle(pad).display === 'none' ? null : { top: Math.round(p.top), bottom: Math.round(p.bottom) }, innerW: innerWidth, innerH: innerHeight, scrollW: document.documentElement.scrollWidth, playing: LVL.debug.state().playing }; });
// desktops: crisp integer device scale; a key press brings the whole canvas (street included) into the window - at 1920 x 1080
// the x2 canvas fills it exactly
for (const [name, w, h, dpr] of [['full_1920x1080', 1920, 1080, 1], ['desk_1920x950', 1920, 950, 1], ['win125_1536x730', 1536, 730, 1.25], ['win150_1280x620', 1280, 620, 1.5], ['mac_1440x800_dpr2', 1440, 800, 2]]){
  const { ctx, pg } = await openCtx({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const before = await geom(pg); await pg.keyboard.press('ArrowRight'); await waitSteps(pg, 15); const after = await geom(pg);
  lay[name] = { before, after };
  if (name.startsWith('full') || name.startsWith('desk')) await pg.screenshot({ path: `${out}/layout_${name}_afterkey.png` });
  const feetY = await pg.evaluate(() => { const c = document.getElementById('cv').getBoundingClientRect(), s = LVL.debug.state(); return c.top + (s.y + LVL.engine.P.H - s.cy) * LVL.scale; });
  check(`display ${name}: integer device px per pixel, snapped, whole canvas in view after a key`, after.crisp && Number.isInteger(after.dscale) && after.dscale >= 1 && Math.abs(after.devLeft - Math.round(after.devLeft)) < 0.05 && Math.abs(after.devTop - Math.round(after.devTop)) < 0.05 && after.cv.top >= -0.5 && after.cv.bottom <= after.innerH + 0.5 && feetY < after.innerH && after.playing,
    { dscale: after.dscale, cssW: after.cv.w, top: after.cv.top, bottom: after.cv.bottom, innerH: after.innerH, heroFeetScreenY: Math.round(feetY), devLeft: after.devLeft, devTop: after.devTop });
  // the full-screen button (a maximised window on a 1080p screen is x1; full screen gives fit() the whole screen: there x2): the
  // stage alone, the canvas centred and crisp, the keys still the game's; leaving it restores the page (headless keeps the window
  // size, so this checks the mode and the fit, not the screen's x2, which the 1920 x 1080 case above shows)
  if (name === 'desk_1920x950'){
    const fsg = () => pg.evaluate(() => { const c = document.getElementById('cv').getBoundingClientRect(); return { fs: document.fullscreenElement && document.fullscreenElement.id, pressed: document.getElementById('fs').getAttribute('aria-pressed'),
      mid: [Math.round(c.left + c.width / 2 - innerWidth / 2), Math.round(c.top + c.height / 2 - innerHeight / 2)], dscale: LVL.dscale, crisp: LVL.crisp, focus: document.activeElement && document.activeElement.id }; });
    await pg.click('#fs'); await pg.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 20000, polling: 50 }).catch(() => {}); await waitSteps(pg, 6);
    const on = await fsg(), x0 = await pg.evaluate(() => LVL.debug.state().x); await pg.keyboard.down('ArrowRight'); await waitSteps(pg, 30); await pg.keyboard.up('ArrowRight');
    const moved = Math.round(await pg.evaluate(() => LVL.debug.state().x) - x0);
    // leaving: wait for the page's fullscreenchange handler too (it sets aria-pressed and re-runs the fit), not only the mode
    await pg.evaluate(() => document.exitFullscreen()); await pg.waitForFunction(() => !document.fullscreenElement && document.getElementById('fs').getAttribute('aria-pressed') === 'false', null, { timeout: 20000, polling: 50 }).catch(() => {});
    await waitSteps(pg, 6); const off = await fsg(); lay.fullscreen = { on, moved, off };
    check('the full-screen button shows the stage alone, the canvas centred and crisp, the arrows still move him; leaving it restores the page',
      on.fs === 'stage' && on.pressed === 'true' && Math.abs(on.mid[0]) <= 1 && Math.abs(on.mid[1]) <= 1 && on.crisp && Number.isInteger(on.dscale) && moved > 20 * K && !off.fs && off.pressed === 'false', lay.fullscreen);
  }
  await ctx.close();
}
check(`1920 x 1080 shows x2 (${2 * VW} px, edge to edge), 1920 x 950 x1; MacBook 1440 x 800 @2x: 2 device px per pixel (${VW} CSS px)`,
  lay.full_1920x1080.after.dscale === 2 && lay.full_1920x1080.after.cv.w === 2 * VW && lay.full_1920x1080.after.cv.left === 0 && lay.desk_1920x950.after.dscale === 1 &&
  lay.mac_1440x800_dpr2.after.dscale === 2 && Math.abs(lay.mac_1440x800_dpr2.after.cv.w - VW) < 0.01, { full: lay.full_1920x1080.after.cv, desk: lay.desk_1920x950.after.cv, mac: lay.mac_1440x800_dpr2.after.cv });
// keys belong to the page once the stage is scrolled away: Space scrolls, the game does not start. scrollTo is instant (the page
// sets no smooth scrolling), Space's own scroll is animated: poll until the page has moved (or 20 s), then let the game run a few
// steps before asking whether it started
{ const { ctx, pg } = await openCtx({ viewport: { width: 1300, height: 700 } });
  const y0 = await pg.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); return scrollY; });
  const y1 = await pg.evaluate(() => { scrollTo(0, scrollY - 400); return scrollY; });
  await pg.keyboard.press('Space');
  await pg.waitForFunction(y => scrollY > y, y1, { timeout: 20000, polling: 50 }).catch(() => {}); await waitSteps(pg, 6);
  const r = await pg.evaluate(() => ({ y: scrollY, playing: LVL.debug.state().playing }));
  lay.keysAway = { y0, y1, after: r };
  check('keys are not captured with the stage scrolled away (Space scrolls the design sheet)', !r.playing && r.y > y1, lay.keysAway);
  await ctx.close(); }
// phones (touch): canvas + pad on screen together in portrait and landscape; holding the pad's right arrow walks, then auto-runs
for (const [name, w, h, dpr] of [['phone_390x844_dpr3', 390, 844, 3], ['phone_375x667_dpr2', 375, 667, 2], ['phone_320x640_dpr2', 320, 640, 2], ['landscape_844x390_dpr3', 844, 390, 3], ['landscape_667x375_dpr2', 667, 375, 2]]){
  const { ctx, pg } = await openCtx({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(pg);
  const btn = async k => pg.evaluate(k => { const b = document.querySelector(`#pad [data-k="${k}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, k);
  let b = await btn('right'); const x0 = await pg.evaluate(() => LVL.debug.state().x);
  if (b.y > h || b.y < 0){ await pg.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'end' }));     // (poll: the pad on screen)
    await pg.waitForFunction(h => { const r = document.querySelector('#pad [data-k="right"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= h; }, h, { timeout: 20000, polling: 50 }).catch(() => {});
    b = await btn('right'); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1 }] });
  const samples = []; for (let i = 0; i < 6; i++){ await waitSteps(pg, 12); samples.push(await pg.evaluate(() => { const s = LVL.debug.state(); return [Math.round(s.x), Math.round(s.vx), s.anim]; })); }
  const g = await geom(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await waitSteps(pg, 12);
  const keysAfter = await pg.evaluate(() => Object.entries(LVL.debug.keys).filter(([, v]) => v).map(([k]) => k));
  await pg.screenshot({ path: `${out}/layout_${name}.png` });
  lay[name] = { g, samples, keysAfter, movedPx: samples[samples.length - 1][0] - Math.round(x0) };
  const inView = g.cv.top >= -0.5 && g.cv.bottom <= h + 0.5 && g.pad && g.pad.top >= -0.5 && g.pad.bottom <= h + 0.5;
  check(`touch ${name}: canvas and pad on screen together, the pad walks the hero, no horizontal scroll`, inView && lay[name].movedPx > 100 * K && keysAfter.length === 0 && g.scrollW <= g.innerW && g.cv.left >= 15.5,
    { cv: g.cv, pad: g.pad, innerH: h, moved: lay[name].movedPx, maxVx: Math.max(...samples.map(s => s[1])), dscale: g.dscale, crisp: g.crisp, smooth: g.smooth, keysAfter });
  // pad layout: one row, the two groups on opposite sides (jump under the right thumb, arrows under the left)
  const pl = await pg.evaluate(() => { const r = k => document.querySelector(`#pad [data-k="${k}"]`).getBoundingClientRect();
    return Object.fromEntries(['left', 'right', 'run', 'down', 'up', 'jump'].map(k => { const b = r(k); return [k, { x: Math.round(b.left + b.width / 2), top: Math.round(b.top), w: Math.round(b.width) }]; })); });
  const tops = new Set(Object.values(pl).map(b => b.top));
  lay[name].pad = pl;
  check(`touch ${name}: pad on one row, arrows left of centre, jump right of centre`, tops.size === 1 && pl.left.x < w / 2 && pl.right.x < w / 2 && pl.jump.x > w / 2 && pl.up.x > w / 2, pl);
  // a thumb slides from ◀ to ▶ without lifting: the hero turns and walks right (on the open E street: no wall within his reach)
  if (name === 'phone_390x844_dpr3'){
    const L = await btn('left'), Rb = await btn('right');
    await pg.evaluate(() => LVL.debug.spawn(4)); await waitSteps(pg, 3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: L.x, y: L.y, id: 2 }] }); await waitSteps(pg, 30);
    const a = await pg.evaluate(() => LVL.debug.state());
    for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: L.x + (Rb.x - L.x) * i / 4, y: L.y, id: 2 }] });
    await waitSteps(pg, 42); const b = await pg.evaluate(() => ({ s: LVL.debug.state(), keys: Object.entries(LVL.debug.keys).filter(([, v]) => v).map(([k]) => k) }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await waitSteps(pg, 9);
    const after = await pg.evaluate(() => Object.entries(LVL.debug.keys).filter(([, v]) => v).map(([k]) => k));
    lay.slide = { leftPhaseVx: Math.round(a.vx), afterSlide: { vx: Math.round(b.s.vx), face: b.s.face, keys: b.keys }, keysAfterLift: after };
    check('touch: a thumb slides from ◀ to ▶ without lifting (the key follows the finger)', a.vx < -50 * K && b.s.vx > 50 * K && b.keys.join() === 'right' && after.length === 0, lay.slide);
  }
  await ctx.close();
}
// the portrait phone whose crisp x1 would draw the hero 32 CSS px tall fits its column instead (a non-integer scale, still
// pixelated on its dense screen); the landscape one keeps the crisp x2 (the hero 64 CSS px)
{ const P3 = lay.phone_390x844_dpr3.g, L3 = lay.landscape_844x390_dpr3.g, hero = g => +(2 * TS * g.scale).toFixed(1);
  check('touch: a 390 px portrait phone fits the canvas to its column (hero > the 32 CSS px of a crisp x1, nearest neighbour), the 844 x 390 landscape keeps the crisp x2',
    !P3.crisp && !P3.smooth && Math.abs(P3.cv.w - (P3.innerW - 36)) <= 1 && hero(P3) > 2 * TS / P3.dpr && L3.crisp && L3.dscale === 2,
    { portrait: { cssW: P3.cv.w, crisp: P3.crisp, smooth: P3.smooth, heroCssPx: hero(P3) }, landscape: { cssW: L3.cv.w, crisp: L3.crisp, dscale: L3.dscale, heroCssPx: hero(L3) } }); }
// ... but only for a real gain: a 412 px phone at dpr 2.625 keeps its crisp x1 (366 CSS px; the full-width fit, 376, is < 8 % wider)
{ const { ctx, pg } = await openCtx({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }), g = await geom(pg); await ctx.close();
  lay.phone_412x915_dpr2_625 = { g };
  check('touch: a 412 px portrait phone at dpr 2.625 keeps the crisp x1 (its full-width fit would be < 8 % wider)', g.crisp && g.dscale === 1 && g.scrollW <= g.innerW,
    { cssW: g.cv.w, crisp: g.crisp, dscale: g.dscale, innerW: g.innerW }); }

check('no page errors', errors.length === 0, errors);
report.errors = errors;
fs.writeFileSync(`${out}/playtest.json`, JSON.stringify(report, null, 1));
await browser.close(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
