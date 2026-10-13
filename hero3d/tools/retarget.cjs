// Offline retargeter: animation clips (Meshy GLB, BVH / FBX mocap) -> the hero rig (hero.glb, UE-mannequin-like bone names) -> anims.json.
// three.js r128 in plain Node (no browser, no GL). Run from the repository root:
//   NODE_PATH=<dir with three@0.128 in node_modules> MESHY_DIR=<the downloaded Meshy GLBs> node hero3d/tools/retarget.cjs hero3d/tools/anims_spec.json
// MESHY_DIR: the GLBs the Meshy API returned for the owner's animation tasks on the hero's own rig (batch1..4.glb, several library clips
// each, by the clip names in the spec). The raw sources are never committed (licences: ../CREDITS.md); only the baked JSON ships.
//
// Method: per mapped bone, the source's WORLD rotation delta from its own rest pose is applied to the hero bone's bind world rotation,
// after a per-bone rest "swing" alignment (absorbs T- vs A-pose and different bone rolls / axis conventions); the target local rotations
// are then rebuilt top-down (unmapped bones - the fingers for Meshy's 24-joint rig - keep their bind rotation relative to the parent; the
// page lays its own hand poses over them). Root: hips position scaled by the leg-length ratio (Meshy rigged hero.glb's own mesh: k ~ 1),
// heading turned onto the hero's +Z, dropped onto the floor (5th percentile of the lowest body part; skin offsets in CONTACT), forward
// travel split off as root motion: loops get a constant speed (m/s) with the pelvis kept in place, one-shots a per-frame curve rm[] (m,
// from frame 0) with the pelvis kept in place horizontally. Vertical motion stays in the pose (a ladder mount ends higher than it starts;
// 'rise' says how much higher the feet end, for the game to move its anchor), except for climbing loops ('riseLoop'): there the climb per
// cycle is taken out linearly and stored as 'rise' (m per cycle).
// Usage: node retarget.cjs <spec.json> [--only a,b]
//   spec: { target, out, fps, clips:[{ name, src, clip?, map, source, from?, to?, loop?, autoLoop?:{min,max}, pingpong?, hold?:{at,n},
//           riseLoop?, still?, hands?(m), yaw?(deg), faceLock?, faceLockWin?(s), faceKeep?, faceAway?, keepRoot?, keepSide?, axes?:'zup', note? }] }
//   still: a loop that stands (speed 0).
//   legs: { straight?, center?, lock?, plant?, lift?(m), stride?, pin?, narrow?, swingLift?(m), posture?:{ pitch?, neck?, headDown? }(deg), tol?(m), lockRamp?, plantRamp? } - a leg pass after the retarget (2-bone IK of
//     thigh + calf onto new ankle targets, the clip's knee direction and foot orientation kept): straight - each foot's stance path is
//     turned about its own centre so the planted foot travels straight back (a bladed clip trimmed by 'yaw' faces ahead, but its feet
//     would still travel along the source's diagonal); center - the two stances are centred under the hips sideways; lock - a planted
//     foot holds still on the ground at the loop's speed (no skate); plant - each foot's lowest point touches the floor during its
//     stance (no hovering, no toe through the floor); lift - the hips raised (a taller gait out of a crouched one, the legs straighter);
//     stride - the steps scaled fore-aft by that factor about the gait's centre (the loop's speed with them; a sneak's shorter steps);
//     pin - a standing loop: each foot held where it stands on average, flat on the floor (no shuffle), narrow: its width scaled;
//     swingLift (m) - each foot's swing raised by up to that mid-way (a crouched walk's low swing brushes the floor);
//     posture.pitch - the trunk turned back toward upright about the hips; posture.neck - the neck back toward vertical, the head
//     turned forward by as much (minus headDown) so the gaze stays.
//     The loop's speed becomes the straightened planted-foot speed. On a one-shot (with lock): every stretch a foot is down holds
//     its ball still in the world (against the clip's root motion rm).
//   holdOf: { clip, frame, n? } - a held pose: frame 'frame' of a clip baked earlier in this spec (after its leg pass), n frames; with
//     legs.plant both feet are put on the floor.
//   phase (0..1): a loop's frames rotated so it starts that far into its cycle (the ladder loop starts where the mount ends).
//   handLock: { spacing?, v?, ramp? } (climbing loops): the gripping hands held still on rungs (see handLock); the clip then carries
//     rungs: { spacing, phase } (m: rungs at phase + k spacing above the loop's floor at its first frame) for the page / game to draw.
//   edits: [{ bone, axis, deg, from, to, ramp }] - a bone turned about an axis of the chest over a time window (see boneEdit).
//   armDamp (0..1): the arms' swing calmed - every arm bone pulled toward its mean rotation over the clip by that fraction.
//   flatFeet ([from, ramp] s, one-shots): the feet flat on the floor from 'from' on (a roll's get-up), see flatFeet.
//   floor (m, one-shots): nothing of the body below the floor - the hips raised wherever the lowest skinned vertex (coat panels aside)
//     would be under 'floor' m (a roll's forearm / shoulder / boots).
//   rmFeet: a one-shot's root motion rebuilt from what touches the ground (a planted foot / hand holds still in the world while it is
//     down; elsewhere the hips' travel).
//   src: a path; ${VAR} is replaced by the environment variable VAR (MESHY_DIR, MOCAP_DIR). target / out: relative to the spec file.
//   from / to (s): the slice of the source used. pingpong: the slice is played forward then back (a loop out of a settling motion);
//     pingpong { half (s) }: each way stretched to 'half' s on a cosine time curve, so the motion eases to a stop at both turns.
//   hold: { at (s), n }: a held pose - frame 'at' of the source repeated n frames (the page breathes over it).
//   hands (m): place the clip vertically by its hands instead of its feet (mean wrist height over the clip = hands): hanging poses.
//   yaw (deg): the source heading that becomes the hero's +Z (a bladed clip - the body turned to one side as it walks - is trimmed by
//   its mean hips heading so it faces ahead). faceLock: per-frame heading from the hips (below).
// Output (compact): { format:'hero-anims/1', fps, qs, ps, bones[], clips:{ name:{ fps, n, dur, loop, speed, rise, rm, src, source, note,
//   tracks:[bone index...], q: base64 int16 [n][tracks][4] (/ qs), p: base64 int16 [n][3] (pelvis position, / ps), rm (one-shots) } } }
//   Bones that never leave their bind rotation get no track (the page leaves them at bind).
const fs = require('fs'), path = require('path');
const THREE = require('three'); global.THREE = THREE; global.window = global; global.self = global;
global.TextDecoder = require('util').TextDecoder;
THREE.ImageLoader.prototype.load = function (u, onLoad) { const img = { width: 1, height: 1 }; setTimeout(() => onLoad && onLoad(img), 0); return img; };
THREE.TextureLoader.prototype.load = function (u, onLoad) { const t = new THREE.Texture(); t.image = { width: 1, height: 1 }; if (onLoad) setTimeout(() => onLoad(t), 0); return t; };
global.URL.createObjectURL = () => 'blob:x'; global.URL.revokeObjectURL = () => {};
const EX = p => fs.readFileSync(require.resolve('three/examples/js/' + p), 'utf8');
eval(EX('loaders/GLTFLoader.js')); eval(EX('loaders/BVHLoader.js'));
{ const module = { exports: {} }; const exports = module.exports; eval(EX('libs/fflate.min.js')); global.fflate = module.exports && module.exports.unzlibSync ? module.exports : (global.fflate || module.exports); }
eval(EX('loaders/FBXLoader.js'));
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const QS = 32767, PS = 8192;   // int16 scales: quaternion components; metres (+-4 m at 0.12 mm)

// ---- bone maps: target name -> source name (as three.js names them: GLTFLoader strips ':' etc., so 'mixamorig:Hips' -> 'mixamorigHips') ----
// '#' in a key expands to l / r; in a value to Left / Right, '%' to L / R, '&' to l / r
const SIDES = (o) => { const r = {}; const sub = (v, a, b, c) => typeof v === 'string' ? v.replace('#', a).replace('%', b).replace('&', c) : v;
  for (const [k, v] of Object.entries(o)) { if (k.includes('#')) { r[k.replace('#', 'l')] = sub(v, 'Left', 'L', 'l'); r[k.replace('#', 'r')] = sub(v, 'Right', 'R', 'r'); } else r[k] = v; } return r; };
const MAPS = {
  // Meshy auto-rig (24 joints, no fingers; Hips > Spine02 > Spine01 > Spine is bottom-up, so Spine02 is the lowest). The owner's Meshy
  // account rigged hero.glb's own mesh, so its rest proportions are the hero's and the delta transfer is almost exact.
  meshy: SIDES({ pelvis:'Hips', spine_01:'Spine02', spine_02:'Spine01', spine_03:'Spine', neck_01:'neck', head:'Head',
    'clavicle_#':'#Shoulder', 'upperarm_#':'#Arm', 'lowerarm_#':'#ForeArm', 'hand_#':'#Hand', 'thigh_#':'#UpLeg', 'calf_#':'#Leg', 'foot_#':'#Foot', 'ball_#':'#ToeBase' }),
  // Mesh2Motion / Quaternius UAL (CC0): the hero's own naming
  ue: SIDES({ pelvis:'pelvis', spine_01:'spine_01', spine_02:'spine_02', spine_03:'spine_03', neck_01:'neck_01', head:'head',
    'clavicle_#':'clavicle_&', 'upperarm_#':'upperarm_&', 'lowerarm_#':'lowerarm_&', 'hand_#':'hand_&', 'thigh_#':'thigh_&', 'calf_#':'calf_&', 'foot_#':'foot_&', 'ball_#':'ball_&',
    'middle_01_#':'middle_01_&', 'middle_02_#':'middle_02_&', 'middle_03_#':'middle_03_&' }),
  // CMU (cgspeed BVH conversion)
  cmu: SIDES({ pelvis:'Hips', spine_01:'LowerBack', spine_02:'Spine', spine_03:'Spine1', neck_01:'Neck', head:'Head',
    'clavicle_#':'#Shoulder', 'upperarm_#':'#Arm', 'lowerarm_#':'#ForeArm', 'hand_#':'#Hand', 'thigh_#':'#UpLeg', 'calf_#':'#Leg', 'foot_#':'#Foot', 'ball_#':'#ToeBase' }),
  // 100STYLE (CC BY 4.0)
  style100: SIDES({ pelvis:'Hips', spine_01:'Chest', spine_02:'Chest2', spine_03:'Chest4', neck_01:'Neck', head:'Head',
    'clavicle_#':'#Collar', 'upperarm_#':'#Shoulder', 'lowerarm_#':'#Elbow', 'hand_#':'#Wrist', 'thigh_#':'#Hip', 'calf_#':'#Knee', 'foot_#':'#Ankle', 'ball_#':'#Toe' }),
  // Motifect Locomotion BVH (AI-generated; TEMPORARY - see ../CREDITS.md)
  motifect: SIDES({ pelvis:'Hips', spine_01:'Spine1', spine_02:'Spine2', spine_03:'Chest', neck_01:'Neck1', head:'Head',
    'clavicle_#':'#Shoulder', 'upperarm_#':'#Arm', 'lowerarm_#':'#ForeArm', 'hand_#':'#Hand', 'thigh_#':'#Leg', 'calf_#':'#Shin', 'foot_#':'#Foot', 'ball_#':'#ToeBase',
    'middle_01_#':'#HandMiddle1', 'middle_02_#':'#HandMiddle2', 'middle_03_#':'#HandMiddle3' })
};
MAPS.ual = Object.assign({}, MAPS.ue, { head: 'Head' });   // Quaternius UAL2 file: 'Head' capitalised
// the joint each target bone points at (rest swing alignment); zero-length source segments are skipped down the chain
const AIM = SIDES({ pelvis:'spine_01', spine_01:'spine_02', spine_02:'spine_03', spine_03:'neck_01', neck_01:'head', 'clavicle_#':'upperarm_&', 'upperarm_#':'lowerarm_&',
  'lowerarm_#':'hand_&', 'hand_#':'middle_01_&', 'thigh_#':'calf_&', 'calf_#':'foot_&', 'foot_#':'ball_&', 'middle_01_#':'middle_02_&', 'middle_02_#':'middle_03_&' });
const NOSWING = new Set(['pelvis']);      // keep the hips' full rest frame (both rests face +Z, left on +X)
// body parts that can touch the floor, with their distance from joint to skin surface (m) - for the ground fix
const CONTACT = SIDES({ 'ball_#': 0.037, 'foot_#': 0.10, 'calf_#': 0.07, 'hand_#': 0.03, 'lowerarm_#': 0.05, pelvis: 0.13, spine_03: 0.14, head: 0.11 });

const expand = s => s.replace(/\$\{(\w+)\}/g, (m, v) => { if (!process.env[v]) throw new Error('set ' + v + ' (used by ' + s + ')'); return process.env[v]; });
function loadGLB(file) {
  return new Promise((res, rej) => { const b = fs.readFileSync(file); new THREE.GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej); });
}
async function loadSource(c, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.bvh') {
    const r = new THREE.BVHLoader().parse(fs.readFileSync(file, 'utf8'));
    const root = new THREE.Group(); root.add(r.skeleton.bones[0]);
    const rn = r.skeleton.bones[0].name;
    const tracks = r.clip.tracks.filter(t => t.name.endsWith('.quaternion') || t.name === '.bones[' + rn + '].position')
      .map(t => { t.name = t.name.replace(/^\.bones\[(.*)\]\./, '$1.'); return t; });
    return { root, clip: new THREE.AnimationClip(c.name, -1, tracks) };
  }
  if (ext === '.glb' || ext === '.gltf') {
    const g = await loadGLB(file); const clip = g.animations.find(a => a.name === c.clip);
    if (!clip) throw new Error('no clip ' + c.clip + ' in ' + file + ': ' + g.animations.map(a => a.name).join(','));
    return { root: g.scene, clip };
  }
  if (ext === '.fbx') {
    const b = fs.readFileSync(file); const g = new THREE.FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    return { root: g, clip: c.clip ? g.animations.find(a => a.name === c.clip) : g.animations[0] };
  }
  throw new Error('unknown source ' + file);
}
function boneIndex(root) { const m = {}; root.traverse(o => { if (!m[o.name] || (o.isBone && !m[o.name].isBone)) m[o.name] = o; }); return m; }
const wq = o => o.getWorldQuaternion(Q()), wp = o => o.getWorldPosition(V());
const yawQ = a => new THREE.Quaternion().setFromAxisAngle(UP, a);
const b64 = arr => Buffer.from(new Int16Array(arr).buffer).toString('base64');
const clampI16 = v => Math.max(-32767, Math.min(32767, Math.round(v)));

async function main() {
  const specPath = path.resolve(process.argv[2]), specDir = path.dirname(specPath);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const oi = process.argv.indexOf('--only'), only = oi > 0 ? new Set(process.argv[oi + 1].split(',')) : null;
  const tg = await loadGLB(path.resolve(specDir, spec.target)); const T = tg.scene; T.updateMatrixWorld(true);
  const TB = {}; const names = []; T.traverse(o => { if (o.isBone) { TB[o.name] = o; names.push(o.name); } });   // parents before children
  const tRest = {}; for (const n of names) tRest[n] = { p: TB[n].position.clone(), q: TB[n].quaternion.clone(), wq: wq(TB[n]), wp: wp(TB[n]) };
  const tLeg = tRest.thigh_l.wp.distanceTo(tRest.calf_l.wp) + tRest.calf_l.wp.distanceTo(tRest.foot_l.wp);
  const fps = spec.fps || 30;
  const outPath = path.resolve(specDir, spec.out);
  const prev = only && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  const out = { format: 'hero-anims/1', fps, qs: QS, ps: PS, bones: names, clips: {} };
  const FK = (q, p) => { names.forEach((n, j) => TB[n].quaternion.copy(q[j])); TB.pelvis.position.copy(p); T.updateMatrixWorld(true); };
  const BAKED = {};   // name -> { q, p } after the leg pass (holdOf reads it)
  const BALL_R = CONTACT.ball_l;   // ball joint to the sole (m)
  const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // set a bone's world rotation (parents already posed)
  const setWQ = (b, w) => { b.parent.updateWorldMatrix(true, false); b.quaternion.copy(wq(b.parent).invert().multiply(w)); b.updateMatrixWorld(true); };
  // 2-bone leg IK: thigh + calf onto the ankle target, the knee in the plane of the hip-ankle line and the pole; the foot keeps footW
  function legIK(s, target, pole, footW) {
    const th = TB['thigh_' + s], ca = TB['calf_' + s], ft = TB['foot_' + s];
    const a = tRest['thigh_' + s].wp.distanceTo(tRest['calf_' + s].wp), b = tRest['calf_' + s].wp.distanceTo(tRest['foot_' + s].wp);
    const H = wp(th), d = target.clone().sub(H); const raw = d.length(), dist = Math.min(Math.max(raw, 0.05), (a + b) * 0.9995); d.normalize();
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pp = pole.clone().addScaledVector(d, -pole.dot(d)); if (pp.lengthSq() < 1e-8) pp.set(0, 0, 1); pp.normalize();
    const E = H.clone().addScaledVector(d, a * cosA).addScaledVector(pp, a * sinA);
    const rot = (bone, child, to) => { const f = wp(child).sub(wp(bone)).normalize(); setWQ(bone, Q().setFromUnitVectors(f, to.clone().normalize()).multiply(wq(bone))); };
    rot(th, ca, E.clone().sub(H));
    rot(ca, ft, H.clone().addScaledVector(d, dist).sub(wp(ca)));
    setWQ(ft, footW);
    return raw / (a + b);
  }
  // 2-bone arm IK: upper arm + forearm onto the wrist target, the elbow in the plane of the shoulder-wrist line and the pole; the hand
  // keeps its world orientation
  function armIK(s, target, pole) {
    const up = TB['upperarm_' + s], lo = TB['lowerarm_' + s], ha = TB['hand_' + s], hq = wq(ha);
    const a = tRest['upperarm_' + s].wp.distanceTo(tRest['lowerarm_' + s].wp), b = tRest['lowerarm_' + s].wp.distanceTo(tRest['hand_' + s].wp);
    const S0 = wp(up), d = target.clone().sub(S0), dist = Math.min(Math.max(d.length(), 0.05), (a + b) * 0.9995); d.normalize();
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pp = pole.clone().addScaledVector(d, -pole.dot(d)); if (pp.lengthSq() < 1e-8) pp.set(0, -1, 0); pp.normalize();
    const E = S0.clone().addScaledVector(d, a * cosA).addScaledVector(pp, a * sinA);
    const rot = (bone, child, to) => { const f = wp(child).sub(wp(bone)).normalize(); setWQ(bone, Q().setFromUnitVectors(f, to.clone().normalize()).multiply(wq(bone))); };
    rot(up, lo, E.clone().sub(S0));
    rot(lo, ha, S0.clone().addScaledVector(d, dist).sub(wp(lo)));
    setWQ(ha, hq);
  }
  // handLock (spec, climbing loops: { spacing?, v?, ramp? }): the gripping hands held on rungs. The source's hands slide down the rails
  // while they hold on; here every stretch a hand holds (its height in the world - the climb per cycle added back - rising slower than
  // v m/s for at least 4 frames) is held at one height: the nearest rung of a ladder with rungs every 'spacing' m (default: half the
  // climb per cycle, one rung per hand step), the rungs' phase fitted to the grips. Eased in / out over 'ramp' frames either side; the
  // arm re-solved (the elbow kept in its plane, the hand's orientation kept). Returns { spacing, phase, info } (rungs at
  // phase + k spacing above the clip's floor at its first frame).
  function handLock(L, q, p, rise) {
    const n = q.length, sp = L.spacing || rise / 2, vMax = L.v !== undefined ? L.v : 0.35, R = L.ramp || 3, P = { l: [], r: [] };
    for (let i = 0; i < n; i++) { FK(q[i], p[i]); for (const s of ['l', 'r']) P[s].push(wp(TB['hand_' + s])); }
    const Y = (s, i) => P[s][((i % n) + n) % n].y + rise * i / n;   // the hand's height in the world (i may run past the cycle)
    const segs = [];
    for (const s of ['l', 'r']) {
      const on = []; for (let i = 0; i < n; i++) on.push((Y(s, i + 1) - Y(s, i)) * fps < vMax && (Y(s, i) - Y(s, i - 1)) * fps < vMax);
      for (let i = 0; i < n; i++) if (on[i] && !on[(i - 1 + n) % n]) { let j = i; while (j < i + n && on[j % n]) j++; if (j - i >= 4) segs.push({ s, i0: i, i1: j - 1 }); }
    }
    let cx = 0, cy = 0;
    for (const g of segs) { let m = 0; for (let i = g.i0; i <= g.i1; i++) m += Y(g.s, i); g.m = m / (g.i1 - g.i0 + 1);
      const a = 2 * Math.PI * g.m / sp, w = g.i1 - g.i0 + 1; cx += w * Math.cos(a); cy += w * Math.sin(a); }
    const ph = (((Math.atan2(cy, cx) / (2 * Math.PI)) * sp) % sp + sp) % sp;
    const W = { l: new Array(n).fill(0), r: new Array(n).fill(0) }, TY = { l: new Array(n).fill(0), r: new Array(n).fill(0) };
    let maxFix = 0, maxSlide = 0;
    for (const g of segs) {
      g.y = ph + Math.round((g.m - ph) / sp) * sp;
      for (let i = g.i0; i <= g.i1; i++) maxSlide = Math.max(maxSlide, Math.abs(Y(g.s, i) - Y(g.s, g.i0)));
      for (let i = g.i0 - R; i <= g.i1 + R; i++) {
        const w = i < g.i0 ? smooth01((i - g.i0 + R + 1) / (R + 1)) : i > g.i1 ? smooth01((g.i1 + R + 1 - i) / (R + 1)) : 1, f = ((i % n) + n) % n;
        if (w > W[g.s][f]) { W[g.s][f] = w; TY[g.s][f] = g.y - rise * i / n; }   // (the rung less the climb so far: the pose's own height)
      }
    }
    for (let f = 0; f < n; f++) {
      if (!W.l[f] && !W.r[f]) continue;
      FK(q[f], p[f]); q[f] = q[f].slice();
      for (const s of ['l', 'r']) { if (!W[s][f]) continue;
        const h = wp(TB['hand_' + s]), yT = TY[s][f], tgt = h.clone(); tgt.y += (yT - h.y) * W[s][f];
        maxFix = Math.max(maxFix, Math.abs(yT - h.y) * W[s][f]);
        armIK(s, tgt, wp(TB['lowerarm_' + s]).sub(wp(TB['upperarm_' + s])));
        for (const nm of ['upperarm_' + s, 'lowerarm_' + s, 'hand_' + s]) q[f][names.indexOf(nm)] = TB[nm].quaternion.clone();
      }
    }
    return { spacing: sp, phase: ph, info: `hands held on rungs every ${(sp * 100).toFixed(0)}cm: ${segs.length} grips, slide was up to ${(maxSlide * 100).toFixed(1)}cm, moved up to ${(maxFix * 100).toFixed(1)}cm` };
  }
  // the leg pass (spec 'legs', see the usage notes above). q / p: the clip's frames (a loop: cyclic). Returns the new loop speed.
  function legPass(L, q, p, isLoop, rmIn) {
    const n = q.length, R = [];
    for (let i = 0; i < n; i++) { FK(q[i], p[i]); const r = {};
      for (const s of ['l', 'r']) r[s] = { A: wp(TB['foot_' + s]), Bl: wp(TB['ball_' + s]), K: wp(TB['calf_' + s]), H: wp(TB['thigh_' + s]), FQ: wq(TB['foot_' + s]) };
      R.push(r); }
    const tgt = {}, st = {}, info = []; let vS = 0, vN = 0;
    const low = (r, s) => Math.min(r[s].Bl.y - BALL_R, r[s].A.y - BALL_R);   // the foot's lowest joint, as a sole height (ball 0.037 = 0)
    for (const s of ['l', 'r']) {
      tgt[s] = R.map(r => r[s].Bl.clone());   // (the ball: what stays on the ground; the ankle follows it with the foot's own orientation)
      if (!isLoop) {   // a one-shot (rmIn: its root motion): every stretch on the ground (>= 3 frames) holds the ball still in the world
        const ys = R.map(r => low(r, s)), on = ys.map(y => y < (L.tol || 0.03)), A = tgt[s], R0 = L.lockRamp !== undefined ? L.lockRamp : 2;
        let segs = 0;
        for (let i = 0; i < n;) { if (!on[i]) { i++; continue; } let j = i; while (j < n && on[j]) j++; const m = j - i;
          if (m >= 3 && L.lock) { let gx = 0, gz = 0; for (let k = i; k < j; k++) { gx += A[k].x; gz += A[k].z + rmIn[k]; } gx /= m; gz /= m;
            for (let k = i; k < j; k++) { const w = smooth01(Math.min((k - i + 1) / (R0 + 1), j >= n ? 1 : (j - k) / (R0 + 1)));   // (down to the last frame: held to the end)
              A[k].x += (gx - A[k].x) * w; A[k].z += (gz - rmIn[k] - A[k].z) * w; } segs++; }
          i = j; }
        info.push(`${s} ${segs} contact(s) held`); continue;
      }
      if (L.hold) { const dy = -low(R[0], s); tgt[s].forEach(a => { a.y += dy; }); info.push(`${s} plant ${(dy * 100).toFixed(1)}cm`); continue; }
      if (L.pin) {   // a standing loop: each foot held still where it stands on average, its lowest point on the floor every frame (no
        // shuffle); narrow: the stance width scaled about the hips
        const c = V(); tgt[s].forEach(a => c.add(a)); c.divideScalar(n);
        const hx = tRest.pelvis.wp.x, cx = hx + (c.x - hx) * (L.narrow || 1);
        tgt[s].forEach((a, i) => { a.x = cx; a.z = c.z; a.y -= low(R[i], s); });
        info.push(`${s} pinned` + (L.narrow ? ` narrow x${L.narrow}` : '')); continue;
      }
      const ys = R.map(r => low(r, s)), mn = Math.min(...ys), mask = ys.map(y => y < mn + (L.tol || 0.025));
      let best = null;
      for (let i = 0; i < n; i++) { if (!mask[i] || (mask[(i - 1 + n) % n] && mask.some(m => !m))) continue;
        let k = 0; while (k < n && mask[(i + k) % n]) k++; if (!best || k > best.len) best = { s0: i, len: k }; }
      const idx = []; for (let k = 0; k < best.len; k++) idx.push((best.s0 + k) % n);
      st[s] = { idx, ys };
      // straight: the stance path's direction (least squares over the stance) turned onto -Z about the stance centre
      const A = tgt[s], m = idx.length, km = (m - 1) / 2;
      const c = new THREE.Vector3(); idx.forEach(i => c.add(A[i])); c.divideScalar(m);
      let sx = 0, sz = 0, sk = 0; idx.forEach((i, k) => { sx += (k - km) * (A[i].x - c.x); sz += (k - km) * (A[i].z - c.z); sk += (k - km) * (k - km); });
      let vx = sk ? sx / sk * fps : 0, vz = sk ? sz / sk * fps : 0, ang = 0;
      if (L.straight && vz < -0.05) { ang = Math.max(-0.8, Math.min(0.8, Math.atan(vx / vz))); const co = Math.cos(ang), si = Math.sin(ang);
        for (const a of A) { const x = a.x - c.x, z = a.z - c.z; a.x = c.x + x * co - z * si; a.z = c.z + x * si + z * co; }
        const x = vx * co - vz * si, z = vx * si + vz * co; vx = x; vz = z; }
      st[s].v = Math.hypot(vx, vz); vS += st[s].v; vN++;
      info.push(`${s} stance ${m}/${n} path ${(ang * 180 / Math.PI).toFixed(0)}deg v ${st[s].v.toFixed(2)}`);
    }
    if (!isLoop) { /* one-shot: no stance centring / loop lock / plant */ }
    else if (!L.hold && !L.pin && L.center) {   // the stances centred under the hips (sideways)
      const cx = s => st[s].idx.reduce((a, i) => a + tgt[s][i].x, 0) / st[s].idx.length;
      const sh = tRest.pelvis.wp.x - (cx('l') + cx('r')) / 2; for (const s of ['l', 'r']) tgt[s].forEach(a => { a.x += sh; });
      info.push(`center ${(sh * 100).toFixed(1)}cm`);
    }
    let v = vN ? vS / vN : 0;
    if (isLoop && !L.hold && !L.pin && L.stride && L.stride !== 1) {   // shorter (or longer) steps: each foot's fore-aft path scaled about the gait's
      // centre; the loop's ground speed scales with it (the cadence stays the clip's)
      let zc = 0, nz = 0; for (const s of ['l', 'r']) tgt[s].forEach(a => { zc += a.z; nz++; }); zc /= nz;
      for (const s of ['l', 'r']) tgt[s].forEach(a => { a.z = zc + (a.z - zc) * L.stride; });
      v *= L.stride; info.push(`stride x${L.stride}`);
    }
    if (!L.hold && !L.pin && isLoop) for (const s of ['l', 'r']) {
      const { idx, ys } = st[s], A = tgt[s], m = idx.length, km = (m - 1) / 2;
      if (L.lock && m < n) {   // the planted foot holds still on the ground (in place it travels back at the loop's speed) through the
        // whole stance, eased into / out of over lockRamp frames of the swing on either side
        const R0 = L.lockRamp !== undefined ? L.lockRamp : 3, xc = idx.reduce((a, i) => a + A[i].x, 0) / m, zc = idx.reduce((a, i) => a + A[i].z, 0) / m;
        const at = new Map();   // frame -> the stance-relative step k with the strongest lock (the ramps may overlap round the cycle)
        for (let k = -R0; k < m + R0; k++) { const i = ((idx[0] + k) % n + n) % n, w = k < 0 ? smooth01((k + R0 + 1) / (R0 + 1)) : k >= m ? smooth01((m + R0 - k) / (R0 + 1)) : 1;
          if (!at.has(i) || w > at.get(i).w) at.set(i, { k, w }); }
        for (const [i, { k, w }] of at) { A[i].x += (xc - A[i].x) * w; A[i].z += (zc - v * (k - km) / fps - A[i].z) * w; }
      }
      if (L.plant) {   // its lowest point on the floor through the stance, eased back to the clip's height over the swing
        const dy = -Math.min(...idx.map(i => ys[i])), Rv = L.plantRamp !== undefined ? L.plantRamp : 5, inS = new Set(idx);
        for (let i = 0; i < n; i++) { let d = 0; if (!inS.has(i)) { d = n; for (const j of idx) { const e = Math.abs(i - j), dd = Math.min(e, n - e); if (dd < d) d = dd; } }
          const w = d === 0 ? 1 : d > Rv ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / (Rv + 1)));
          A[i].y += dy * w; const y = ys[i] + dy * w; if (y < -0.002) A[i].y += -0.002 - y; }   // (never through the floor)
        info.push(`${s} plant ${(dy * 100).toFixed(1)}cm`);
      }
      if (L.swingLift && m < n) {   // the swing raised by up to swingLift m mid-way (a half sine from toe-off to touch-down): a low
        // crouched swing would brush the floor
        const sw = n - m, s0 = (idx[m - 1] + 1) % n;
        for (let k = 0; k < sw; k++) A[(s0 + k) % n].y += L.swingLift * Math.sin(Math.PI * (k + 1) / (sw + 1));
        info.push(`${s} swing +${(L.swingLift * 100).toFixed(0)}cm`);
      }
    }
    // solve: the hips (lifted), then each leg onto its ankle target with its own knee direction and foot orientation
    let reach = 0;
    const jT = { l: ['thigh_l', 'calf_l', 'foot_l'].map(nm => names.indexOf(nm)), r: ['thigh_r', 'calf_r', 'foot_r'].map(nm => names.indexOf(nm)) };
    const PO = L.posture || {}, X = new THREE.Vector3(1, 0, 0);
    const jP = ['pelvis', 'neck_01', 'head'].map(nm => names.indexOf(nm));
    for (let i = 0; i < n; i++) {
      if (L.lift) p[i] = p[i].clone().setY(p[i].y + L.lift);
      FK(q[i], p[i]); q[i] = q[i].slice();
      // posture: the trunk turned back toward upright about the hips (pitch, deg; the legs are re-solved below); the neck back toward
      // vertical with the head turned forward by as much (neck, deg: the gaze stays where the clip looks)
      if (PO.pitch) setWQ(TB.pelvis, Q().setFromAxisAngle(X, -PO.pitch * Math.PI / 180).multiply(wq(TB.pelvis)));
      if (PO.neck) { const hw = wq(TB.head); setWQ(TB.neck_01, Q().setFromAxisAngle(X, -PO.neck * Math.PI / 180).multiply(wq(TB.neck_01)));
        setWQ(TB.head, Q().setFromAxisAngle(X, (PO.headDown || 0) * Math.PI / 180).multiply(hw)); }
      if (PO.pitch || PO.neck) jP.forEach(j => { q[i][j] = TB[names[j]].quaternion.clone(); });
      for (const s of ['l', 'r']) {
        const r = R[i][s]; reach = Math.max(reach, legIK(s, tgt[s][i].clone().sub(r.Bl).add(r.A), r.K.clone().sub(r.H), r.FQ));
        jT[s].forEach(j => { q[i][j] = TB[names[j]].quaternion.clone(); });
      }
    }
    info.push(`reach ${(reach * 100).toFixed(0)}%` + (L.lift ? ` lift ${L.lift}m` : ''));
    return { speed: L.hold ? 0 : v, info: info.join(', ') };
  }
  // floor (spec 'floor': pad m): nothing of the body through the floor - per frame the lowest skinned vertex of the mesh (the coat's
  // own panels left out: the page simulates them and lays them on the floor) is found, and the hips are raised by what it lacks to
  // stay 'pad' above it. The lift is spread (dilated +-2 frames, smoothed) so it eases in and out, and never less than needed.
  const SKIN = []; T.traverse(o => { if (o.isSkinnedMesh) SKIN.push(o); });
  function meshLow() {
    let lo = Infinity; const v = V();
    for (const sm of SKIN) { const g = sm.geometry, n = g.attributes.position.count, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bs = sm.skeleton.bones;
      if (!sm.userData.body) { sm.userData.body = new Uint8Array(n);   // vertices not dominated by a coat bone
        for (let i = 0; i < n; i++) { let bw = -1, bi = 0; for (let k = 0; k < 4; k++) { const w = SW.getComponent ? SW.getComponent(i, k) : [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)][k]; if (w > bw) { bw = w; bi = [SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)][k]; } }
          sm.userData.body[i] = /^coat/.test(bs[bi].name) ? 0 : 1; } }
      const body = sm.userData.body;
      for (let i = 0; i < n; i++) { if (!body[i]) continue; sm.boneTransform(i, v); v.applyMatrix4(sm.matrixWorld); if (v.y < lo) lo = v.y; } }
    return lo;
  }
  function floorPass(q, p, pad) {
    const n = q.length, need = [];
    for (let i = 0; i < n; i++) { FK(q[i], p[i]); need.push(Math.max(0, pad - meshLow())); }
    const dil = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - 2), i + 3)));
    const lift = dil.map((_, i) => { const w = dil.slice(Math.max(0, i - 2), i + 3); return Math.max(need[i], w.reduce((a, b) => a + b, 0) / w.length); });
    for (let i = 0; i < n; i++) p[i] = p[i].clone().setY(p[i].y + lift[i]);
    return `floor: lift max ${(Math.max(...lift) * 100).toFixed(1)}cm over ${lift.filter(x => x > 1e-4).length}/${n}f`;
  }
  // flatFeet (spec [from, ramp] s, one-shots): from 'from' on (eased in over 'ramp') the feet go flat on the floor - each foot turned to its
  // rest orientation, its ankle at its standing height where the clip has it across the floor, the leg re-solved with the clip's own
  // knee direction (a roll's get-up stands on pointed toes otherwise, and the floor pass would lift the body onto their tips)
  function flatFeet(q, p, from, ramp) {
    const jT = { l: ['thigh_l', 'calf_l', 'foot_l'].map(nm => names.indexOf(nm)), r: ['thigh_r', 'calf_r', 'foot_r'].map(nm => names.indexOf(nm)) };
    for (let i = 0; i < q.length; i++) {
      const w = smooth01((i / fps - from) / ramp); if (w <= 0) continue;
      FK(q[i], p[i]); q[i] = q[i].slice();
      for (const s of ['l', 'r']) {
        const ft = TB['foot_' + s], fq = wq(ft).slerp(tRest['foot_' + s].wq, w), a = wp(ft);
        a.y += (tRest['foot_' + s].wp.y - a.y) * w;
        legIK(s, a, wp(TB['calf_' + s]).sub(wp(TB['thigh_' + s])), fq);
        jT[s].forEach(j => { q[i][j] = TB[names[j]].quaternion.clone(); });
      }
    }
  }
  // calm the arm swing: every arm bone toward its mean rotation over the clip
  function armDamp(q, k) {
    for (const nm of ['clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']) {
      const j = names.indexOf(nm); if (j < 0) continue; const m = new THREE.Vector4(), r = q[0][j];
      for (const f of q) { const s = f[j].dot(r) < 0 ? -1 : 1; m.x += s * f[j].x; m.y += s * f[j].y; m.z += s * f[j].z; m.w += s * f[j].w; }
      const mq = new THREE.Quaternion(m.x, m.y, m.z, m.w).normalize();
      for (let i = 0; i < q.length; i++) { q[i] = q[i].slice(); q[i][j] = q[i][j].clone().slerp(mq, k); }
    }
  }
  // a bone turned over a time window (spec 'edits': { bone, axis [x,y,z] in the chest's frame (model axes at rest: +X his left, +Y up,
  // +Z forward), deg, from, to (s, clip time), ramp (s) }): e.g. an arm swung out of the coat where the clip tucks it in
  function boneEdit(q, p, e) {
    const j = names.indexOf(e.bone), ax0 = new THREE.Vector3(...e.axis).normalize(), n = q.length, ch = 'spine_03';
    for (let i = 0; i < n; i++) {
      const t = i / fps, r = e.ramp || 0.1, w = smooth01(Math.min((t - e.from + r) / r, (e.to + r - t) / r));
      if (w <= 0) continue;
      FK(q[i], p[i]); const b = TB[e.bone];
      const ax = ax0.clone().applyQuaternion(wq(TB[ch]).multiply(tRest[ch].wq.clone().invert()));
      setWQ(b, Q().setFromAxisAngle(ax, e.deg * Math.PI / 180 * w).multiply(wq(b)));
      q[i] = q[i].slice(); q[i][j] = b.quaternion.clone();
    }
  }
  // the clip as stored: only bones that leave their bind rotation get a track
  function emit(c, q, p, o) {
    const n = q.length, tracks = [];
    // (the angle from the rest taken from the vector part of the difference - acos of a dot near 1 turns float noise into ~1e-3 rad)
    const ri = {}; names.forEach(nm => { ri[nm] = tRest[nm].q.clone().invert(); });
    const off = (a, nm) => { const d = ri[nm].clone().multiply(a); return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)); };
    names.forEach((nm, j) => { if (q.some(fr => off(fr[j], nm) > 2e-4)) tracks.push(j); });
    const qi = [], pi = [];
    for (let i = 0; i < n; i++) {
      for (const j of tracks) { let qq = q[i][j]; if (i > 0) { const pr = q[i - 1][j]; if (qq.dot(pr) < 0) qq = new THREE.Quaternion(-qq.x, -qq.y, -qq.z, -qq.w); q[i][j] = qq; }
        qi.push(clampI16(qq.x * QS), clampI16(qq.y * QS), clampI16(qq.z * QS), clampI16(qq.w * QS)); }
      pi.push(clampI16(p[i].x * PS), clampI16(p[i].y * PS), clampI16(p[i].z * PS));
    }
    out.clips[c.name] = { fps, n, dur: +(n / fps).toFixed(4), loop: o.loop, speed: o.speed === null ? null : +o.speed.toFixed(3), rise: o.rise === null ? null : +o.rise.toFixed(3),
      src: o.src, source: c.source || '', note: c.note || '', tracks, q: b64(qi), p: b64(pi), rm: o.loop ? [] : o.rm };
    if (o.rungs) out.clips[c.name].rungs = o.rungs;
    return tracks.length;
  }
  // one-shot root motion from the ground contacts: while a foot / hand is down (and was last frame) the travel keeps it still
  function rmFromContacts(q, p, rm0) {
    const n = q.length, parts = ['ball_l', 'ball_r', 'foot_l', 'foot_r', 'hand_l', 'hand_r'], P = [];
    for (let i = 0; i < n; i++) { FK(q[i], p[i]); const r = {}; for (const b of parts) r[b] = wp(TB[b]); P.push(r); }
    const h = (r, b) => r[b].y - (CONTACT[b] || 0.03), rm = [0];
    for (let i = 1; i < n; i++) {
      let best = null; for (const b of parts) { const y0 = h(P[i - 1], b), y1 = h(P[i], b); if (y0 < 0.02 && y1 < 0.02 && (!best || y1 < best.y)) best = { b, y: y1 }; }
      rm.push(rm[i - 1] + (best ? -(P[i][best.b].z - P[i - 1][best.b].z) : rm0[i] - rm0[i - 1]));
    }
    return rm.map(v => +v.toFixed(4));
  }
  for (const c of spec.clips) {
    if (only && !only.has(c.name)) { if (prev && prev.clips[c.name]) out.clips[c.name] = prev.clips[c.name]; continue; }
    if (c.holdOf) {
      const B0 = BAKED[c.holdOf.clip]; if (!B0) throw new Error(c.name + ': bake ' + c.holdOf.clip + ' first (in the same run)');
      const f = c.holdOf.frame, nH = c.holdOf.n || 2, q = [], p = [];
      for (let i = 0; i < nH; i++) { q.push(B0.q[f].map(x => x.clone())); p.push(B0.p[f].clone()); }
      const r = c.legs ? legPass(Object.assign({}, c.legs, { hold: true }), q, p, true) : { info: '' };
      const nt = emit(c, q, p, { loop: true, speed: 0, rise: null, rm: [], src: B0.src + ` frame ${f} hold` });
      console.log(`${c.name.padEnd(12)} ${('hold of ' + c.holdOf.clip).padEnd(38)} ${nH}f tracks ${nt} ${r.info}`);
      names.forEach(nn => { TB[nn].position.copy(tRest[nn].p); TB[nn].quaternion.copy(tRest[nn].q); });
      continue;
    }
    const file = expand(c.src);
    const S = await loadSource(c, file); const map = MAPS[c.map]; const SB = boneIndex(S.root);
    const pairs = Object.entries(map).filter(([t, s]) => TB[t] && SB[s]);
    const missing = Object.entries(map).filter(([t, s]) => TB[t] && !SB[s]).map(([t, s]) => t + '<-' + s);
    const M = Object.fromEntries(pairs);
    S.root.updateMatrixWorld(true);
    const sRest = {}; for (const [t, s] of pairs) sRest[t] = { wq: wq(SB[s]), wp: wp(SB[s]) };
    const aimOf = t => { let a = AIM[t]; while (a && M[a] && sRest[a].wp.distanceTo(sRest[t].wp) < 1e-4) a = AIM[a]; return a && M[a] ? a : null; };
    const k = tLeg / (sRest.thigh_l.wp.distanceTo(sRest.calf_l.wp) + sRest.calf_l.wp.distanceTo(sRest.foot_l.wp));
    const C = Q(); if (c.axes === 'zup') C.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const Ci = C.clone().invert();
    // rest swing alignment
    const Ainv = {};
    for (const [t] of pairs) {
      Ainv[t] = Q(); const a = aimOf(t); if (NOSWING.has(t) || !a || !TB[a]) continue;
      const ds = sRest[a].wp.clone().sub(sRest[t].wp).applyQuaternion(C).normalize(), dt = tRest[a].wp.clone().sub(tRest[t].wp).normalize();
      Ainv[t] = new THREE.Quaternion().setFromUnitVectors(ds, dt).invert();
    }
    // sample the source (LoopOnce + clamp: BVH frame times like 0.033333 make the duration a hair short of n/fps)
    const mixer = new THREE.AnimationMixer(S.root); const act = mixer.clipAction(S.clip); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
    const t0 = c.hold ? c.hold.at : (c.from || 0), t1 = c.hold ? c.hold.at : Math.min(c.to || S.clip.duration, S.clip.duration);
    // frame times: a loop's last frame is one period after its first, so it is sampled (it gives the cycle's travel / rise) and dropped
    let times = [];
    if (c.hold) times = new Array(c.hold.n).fill(t0);
    else if (c.pingpong && c.pingpong.half) {   // eased ping-pong: each way takes 'half' s and slows to a stop at both ends (cosine time)
      const N1 = Math.max(2, Math.round(c.pingpong.half * fps) + 1);
      for (let i = 0; i < N1; i++) times.push(Math.min(t0 + (t1 - t0) * (1 - Math.cos(Math.PI * i / (N1 - 1))) / 2, S.clip.duration - 1e-5));
    }
    else { const N = Math.max(2, Math.round((t1 - t0) * fps) + 1); for (let i = 0; i < N; i++) times.push(Math.min(t0 + i / fps, S.clip.duration - 1e-5)); }
    if (c.pingpong) { const back = times.slice(1, -1).reverse(); times = times.concat(back); times.push(times[0]); }   // ... + the wrap frame
    const N = times.length;
    const F = [];
    for (let i = 0; i < N; i++) {
      mixer.setTime(times[i]); S.root.updateMatrixWorld(true);
      const f = {}; for (const [t, s] of pairs) f[t] = { wq: wq(SB[s]), wp: wp(SB[s]).applyQuaternion(C) }; F.push(f);
    }
    // ---- heading: fixed (yaw, deg; the Meshy clips face +Z like the hero) or from the travel / the hips' facing ----
    const hipH = i => { const p = F[i].pelvis.wp; return new THREE.Vector2(p.x, p.z); };
    const trav = hipH(N - 1).sub(hipH(0));
    let mode, yaw0 = 0;
    if (c.yaw !== undefined) { yaw0 = c.yaw * Math.PI / 180; mode = 'fixed'; }
    else if (trav.length() * k > 0.25) { yaw0 = Math.atan2(trav.x, trav.y); mode = 'travel'; }
    else { const fw = V(); for (const f of F) fw.add(new THREE.Vector3(0, 0, 1).applyQuaternion(C.clone().multiply(f.pelvis.wq).multiply(sRest.pelvis.wq.clone().invert()).multiply(Ci))); yaw0 = Math.atan2(fw.x, fw.z); mode = 'facing'; }
    const face = c.faceAway ? Math.PI : 0;
    // faceLock: a per-frame heading that keeps the hips facing +Z (a clip that turns the body round - the ladder mount's half turn, the
    // dodge roll's diagonal start - plays facing straight ahead). Taken from the hips' left-right axis, which stays level through a
    // forward roll (the forward axis flips when the body is upside down); unwrapped and smoothed over +-faceLockWin s.
    const yawI = new Array(N).fill(yaw0);
    if (c.faceLock) {
      const raw = []; let prev = null;
      for (let i = 0; i < N; i++) {
        const qd = C.clone().multiply(F[i].pelvis.wq).multiply(sRest.pelvis.wq.clone().invert()).multiply(Ci);
        const lat = new THREE.Vector3(1, 0, 0).applyQuaternion(qd), fw = V().crossVectors(lat, UP);
        let a = Math.atan2(fw.x, fw.z); if (prev !== null) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; } raw.push(prev = a);
      }
      const w = Math.round((c.faceLockWin || 0.15) * fps);
      for (let i = 0; i < N; i++) { let sm = 0, nn = 0; for (let j = Math.max(0, i - w); j <= Math.min(N - 1, i + w); j++) { sm += raw[j]; nn++; } yawI[i] = sm / nn; }
      // faceKeep: the fraction of the clip's own turn that stays (0.5: the ladder mount's half turn becomes a quarter turn - from facing
      // along the floor into the ladder); the last frame faces +Z either way
      const kp = c.faceKeep || 0, yEnd = yawI[N - 1];
      for (let i = 0; i < N; i++) yawI[i] = yawI[i] - kp * (yawI[i] - yEnd) + yaw0;
      mode += '+faceLock ' + (raw[0] * 180 / Math.PI).toFixed(0) + '..' + (raw[N - 1] * 180 / Math.PI).toFixed(0) + 'deg';
    }
    // ---- retarget every frame ----
    const qOut = [], pOut = [];
    let pAcc = null;
    for (let i = 0; i < N; i++) {
      const Y = yawQ(-yawI[i] + face);
      const f = F[i], W = {}, qf = [];
      for (const n of names) {
        const par = TB[n].parent, pw = par && par.isBone ? W[par.name] : (par ? wq(par) : Q());
        let w;
        if (f[n]) w = Y.clone().multiply(C).multiply(f[n].wq).multiply(sRest[n].wq.clone().invert()).multiply(Ci).multiply(Ainv[n]).multiply(tRest[n].wq);
        else w = pw.clone().multiply(tRest[n].q);
        W[n] = w; qf.push(pw.clone().invert().multiply(w));
      }
      qOut.push(qf);
      const hp = f.pelvis.wp.clone();
      if (i === 0) pAcc = hp.clone().applyQuaternion(Y);
      else { const d = hp.clone().sub(F[i - 1].pelvis.wp); d.y = 0; pAcc.add(d.applyQuaternion(Y)); pAcc.y = hp.y; }
      pOut.push(pAcc.clone().multiplyScalar(k));
    }
    // ---- FK pass: floor contact + direction error vs the source ----
    let eSum = 0, eN = 0, eMax = 0; const low = [], hands = [];
    for (let i = 0; i < N; i++) {
      FK(qOut[i], pOut[i]); const Y = yawQ(-yawI[i] + face);
      low.push(Math.min(...Object.entries(CONTACT).filter(([n]) => TB[n]).map(([n, r]) => wp(TB[n]).y - r)));
      hands.push((wp(TB.hand_l).y + wp(TB.hand_r).y) / 2);
      for (const [t] of pairs) { const a = aimOf(t); if (!a) continue;
        const dS = F[i][a].wp.clone().sub(F[i][t].wp).applyQuaternion(Y).normalize(), dT = wp(TB[a]).sub(wp(TB[t])).normalize();
        const e = dT.angleTo(dS) * 180 / Math.PI; eSum += e; eN++; eMax = Math.max(eMax, e); }
    }
    const lowS = low.slice().sort((a, b) => a - b);
    const g = c.hands !== undefined ? hands.reduce((s, v) => s + v, 0) / N - c.hands : lowS[Math.floor(lowS.length * 0.05)];
    for (const p of pOut) p.y -= g;
    // ---- loop cut: best (i, j) with j - i in [min, max] s, by local rotations + hip height + hip velocity ----
    const isLoop = !!(c.loop || c.autoLoop || c.pingpong);
    let a0 = 0, a1 = N - 1;           // frames a0 .. a1-1 are kept; a1 is the next cycle's first frame (for a loop)
    if (!isLoop) a1 = N;
    if (c.autoLoop) {
      const Lmin = Math.round(c.autoLoop.min * fps), Lmax = Math.round(c.autoLoop.max * fps); let best = Infinity;
      const mapped = names.map((n, j) => M[n] ? j : -1).filter(j => j >= 0);
      const dist = (i, j) => { let d = 0; for (const b of mapped) d += 2 * Math.acos(Math.min(1, Math.abs(qOut[i][b].dot(qOut[j][b]))));
        d += 10 * Math.abs(pOut[i].y - pOut[j].y);
        if (i > 0 && j > 0) d += 4 * pOut[i].clone().sub(pOut[i - 1]).sub(pOut[j].clone().sub(pOut[j - 1])).length() * fps / 10; return d; };
      for (let i = 1; i + Lmin < N; i++) for (let L = Lmin; L <= Lmax && i + L < N; L++) { const d = dist(i, i + L) + 0.002 * L; if (d < best) { best = d; a0 = i; a1 = i + L; } }
    }
    const q = qOut.slice(a0, a1), p = pOut.slice(a0, a1); const n = q.length;
    // ---- feet: lowest ball joint per frame (for the planted-foot speed and the rise) ----
    const balls = []; for (let i = a0; i <= Math.min(a1, N - 1); i++) { FK(qOut[i], pOut[i]); balls.push({ l: wp(TB.ball_l), r: wp(TB.ball_r) }); }
    // in-place walking speed of a loop: median ground speed of a planted foot (within 2.5 cm of its lowest height), forward = +Z
    let footSpeed = null;
    if (isLoop && !c.riseLoop) {
      // (per foot, then the mean of the two: a clip's feet can push off at different speeds)
      const med = []; for (const s of ['l', 'r']) { const mn = Math.min(...balls.map(b => b[s].y)), sp = [];
        for (let i = 1; i < balls.length; i++) if (balls[i][s].y < mn + 0.025 && balls[i - 1][s].y < mn + 0.025) sp.push(-(balls[i][s].z - balls[i - 1][s].z) * fps);
        sp.sort((x, y) => x - y); if (sp.length > 2) med.push(sp[sp.length >> 1]); }
      footSpeed = med.length ? med.reduce((a, b) => a + b, 0) / med.length : 0;
    }
    // ---- root motion ----
    const z0 = p[0].z, x0 = p[0].x;
    const travelled = (isLoop ? pOut[Math.min(a1, N - 1)].z : p[n - 1].z) - z0, period = n / fps;
    // (a loop that does not walk - a hold, a hang, a climb - has speed 0: its feet are not on the ground)
    let speed = null;
    if (isLoop) speed = c.hold || c.keepRoot || c.riseLoop || c.still ? 0 : Math.abs(travelled) > 0.05 ? travelled / period : (footSpeed || 0);
    // climbing loop: the rise over one cycle (hips at the next cycle's first frame), taken out linearly
    let rise = null;
    if (c.riseLoop) { rise = pOut[Math.min(a1, N - 1)].y - p[0].y; for (let i = 0; i < n; i++) p[i] = p[i].clone().setY(p[i].y - rise * i / n); }
    else if (!isLoop) { const lo = b => Math.min(b.l.y, b.r.y); rise = lo(balls[balls.length - 1]) - lo(balls[0]); }
    const rm = [];
    for (let i = 0; i < n; i++) {
      const dz = p[i].z - z0; rm.push(+dz.toFixed(4));
      // (a climbing loop's drift along its facing over the cycle - toward the ladder and back - is taken out linearly like its rise,
      // so the cycle closes without a jump at the seam)
      p[i].z = tRest.pelvis.wp.z + (c.riseLoop ? dz - travelled * i / n : isLoop && Math.abs(travelled) > 0.05 ? dz - speed * i / fps : (c.keepRoot ? dz : 0));
      p[i].x = tRest.pelvis.wp.x + (c.keepSide ? p[i].x - x0 : 0);
    }
    // loop seam: a loop whose last frame does not quite meet its first is eased into it over the last few frames (not for ping-pong /
    // hold, which close exactly)
    if (isLoop && !c.pingpong && !c.hold) { const L = Math.min(4, n >> 2); for (let j = 0; j < L; j++) { const i = n - L + j, u = Math.pow((j + 1) / (L + 1), 2);
      q[i] = q[i].map((qq, b) => qq.clone().slerp(q[0][b], u)); p[i] = p[i].clone().lerp(p[0], u); } }
    let legInfo = '', rungs = null;
    if (c.handLock && c.riseLoop) { const r = handLock(c.handLock, q, p, rise); rungs = { spacing: +r.spacing.toFixed(4), phase: r.phase }; legInfo = ' | ' + r.info; }
    if (c.legs && isLoop) { const r = legPass(c.legs, q, p, isLoop); if (!c.hold) speed = r.speed; legInfo = ' | legs: ' + r.info; }
    if (c.armDamp) armDamp(q, c.armDamp);
    if (c.edits) for (const e of c.edits) boneEdit(q, p, e);
    if (c.phase && isLoop) {   // the loop starts this far into its cycle (frames rotated; the climb was taken out, so it still wraps)
      const sh = Math.round(c.phase * n) % n; const rq = q.slice(sh).concat(q.slice(0, sh)), rp = p.slice(sh).concat(p.slice(0, sh));
      for (let i = 0; i < n; i++) { q[i] = rq[i]; p[i] = rp[i]; }
      // (the rungs as seen from the new first frame: the climb up to it is no longer added)
      if (rungs) rungs.phase = ((rungs.phase - rise * sh / n) % rungs.spacing + rungs.spacing) % rungs.spacing;
    }
    if (rungs) rungs.phase = +rungs.phase.toFixed(4);
    if (c.flatFeet && !isLoop) flatFeet(q, p, c.flatFeet[0], c.flatFeet[1]);
    let rmOut = rm;
    if (c.rmFeet && !isLoop) rmOut = rmFromContacts(q, p, rm);
    if (c.legs && !isLoop) { const r = legPass(c.legs, q, p, false, rmOut); legInfo = ' | legs: ' + r.info; }
    if (c.floor !== undefined) legInfo += ' | ' + floorPass(q, p, c.floor);
    // foot skate: ground-relative speed of a planted ball joint, in px per frame of a 64 px sprite (1.95 m)
    let skate = 0;
    { let sk = 0, nk = 0; const prevB = {};
      for (let i = 0; i < n; i++) {
        FK(q[i], p[i]); const off = isLoop && speed ? speed * i / fps : (!isLoop ? rmOut[i] : 0);
        for (const b of ['ball_l', 'ball_r']) { const w = wp(TB[b]); w.z += off;
          if (prevB[b] && w.y < 0.057 && prevB[b].y < 0.057) { sk += Math.hypot(w.x - prevB[b].x, w.z - prevB[b].z); nk++; } prevB[b] = w; } }
      skate = nk ? (sk / nk) * fps : 0; }
    BAKED[c.name] = { q: q.map(f => f.map(x => x.clone())), p: p.map(x => x.clone()),
      src: (c.clip || path.basename(file)) + ((c.from !== undefined || c.to !== undefined) ? `@${(t0 + a0 / fps).toFixed(2)}-${(t0 + a1 / fps).toFixed(2)}s` : '') };
    const ntr = emit(c, q, p, { loop: isLoop, speed, rise, rm: rmOut, rungs,
      src: (c.clip || path.basename(file)) + (c.hold ? `@${t0.toFixed(2)}s hold` : (c.from !== undefined || c.to !== undefined) ? `@${(t0 + a0 / fps).toFixed(2)}-${(c.pingpong ? t1 : t0 + a1 / fps).toFixed(2)}s` : '') + (c.pingpong ? (c.pingpong.half ? ' eased ping-pong' : ' ping-pong') : '') });
    console.log(`${c.name.padEnd(12)} ${(c.clip || path.basename(file)).padEnd(38)} ${n}f (${(n / fps).toFixed(2)}s) k ${k.toFixed(3)} ${mode} ${(yaw0 * 180 / Math.PI).toFixed(0)}deg` +
      `${speed !== null ? ' speed ' + speed.toFixed(2) + 'm/s' : ' travel ' + (rmOut[n - 1] || travelled).toFixed(2) + 'm'}${rise !== null ? ' rise ' + rise.toFixed(2) + 'm' : ''} dirErr ${(eSum / eN).toFixed(2)}/${eMax.toFixed(1)}deg` +
      ` skate ${(skate / (1.95 / 64) / fps).toFixed(2)}px/f tracks ${ntr}${missing.length ? ' MISSING ' + missing.join(' ') : ''}${legInfo}`);
    names.forEach(nn => { TB[nn].position.copy(tRest[nn].p); TB[nn].quaternion.copy(tRest[nn].q); });
  }
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log('wrote', outPath, (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB');
}
main().catch(e => { console.error(e); process.exit(1); });
