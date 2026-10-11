// Usage: node render.mjs <index.html> <outdir> [specs=idle:rifle,aim:rifle,aim:pistol] [px=64] [yaw=file]
// Renders each spec (anim:weapon) to <outdir>/<anim>_<weapon>.png on a transparent background, native pixels.
// yaw "file" keeps the SIDE_YAW from index.html; a number overrides it (radians).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
const SP = '/tmp/claude-0/-home-user-DOOM/dfde09f2-3c62-5cd6-b478-4df69e6133b9/scratchpad';
const [,, htmlPath, outDir, specArg='idle:rifle,aim:rifle,aim:pistol', pxArg='64', yawArg='file'] = process.argv;
if (!htmlPath || !outDir) { console.error('usage: node render.mjs <index.html> <outdir> [specs] [px] [yaw]'); process.exit(2); }
fs.mkdirSync(outDir, {recursive:true});
const html = fs.readFileSync(htmlPath,'utf8');
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1200,height:820}});
let errors = [];
p.on('pageerror',e=>errors.push(e.message));
await p.route('**/three.min.js', r=>r.fulfill({path:SP+'/node_modules/three/build/three.min.js', contentType:'text/javascript'}));
await p.route('**/fonts.googleapis.com/**', r=>r.abort());
await p.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');
await p.waitForTimeout(600);
if (errors.length){ console.error('PAGE ERRORS:\n'+errors.join('\n')); await b.close(); process.exit(1); }
const px = +pxArg, yaw = yawArg==='file' ? null : +yawArg;
for (const sp of specArg.split(',')){
  const [anim,weapon] = sp.split(':');
  const d = await p.evaluate(([anim,weapon,yaw,px])=>{
    window.__manual = true; const H = window.HERO; const F = Math.max(128, Math.ceil(px*2.2)); H.frame(F,F,px); H.setAnim(anim); H.setWeapon(weapon);
    if (yaw!==null) H.S.yaw = yaw;
    H.S.t=0; for (let i=0;i<90;i++) H.update(1/60); H.S.shotT=9; H.update(1/60); H.render(true);
    return document.getElementById('c').toDataURL('image/png');
  },[anim,weapon,yaw,px]);
  const out = path.join(outDir, `${anim}_${weapon}.png`);
  fs.writeFileSync(out, Buffer.from(d.split(',')[1],'base64'));
  console.log('wrote', out);
}
if (errors.length){ console.error('PAGE ERRORS:\n'+errors.join('\n')); }
await b.close();
