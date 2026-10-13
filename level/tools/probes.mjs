// Measurement probes shared by playtest.mjs (and handy on their own from any Playwright script that has the level page open).
//
// contrastProbe(page, spots) - the VALUE rule of js/style.js, measured. For each spot [name, column, high?] the hero is stood on the
// first standable row of that column with the camera centred on him across and at its rest for him up and down (engine.js
// CAMERA: the one view his surface settles to when he arrives there, as after a respawn; in E the landmark view; high: the
// highest view the camera's dead zone allows there instead, his feet at the band's foot - one he passes through dropping onto the
// roof from above, before the camera settles), the frame is rendered twice (with him, then with him moved off the level:
// LVL.engine.render() without advancing the simulation), and the pixels that differ are his silhouette. Reported per spot:
//   heroL  mean relative luminance of his pixels (WCAG), ringL  mean of the background in a ring 6 draft px (x K) wide around him,
//   underL  mean of the background he covers, crRing / crUnder  contrast ratios (max + 0.05) / (min + 0.05), box  his bounding
//   box in the frame. The ring is what the eye compares his contour with; 1.6 is the rule's target.
// (32 spots: every beat's street, props and lamps, and the C rooftops at their middles and edges, where he stands highest; those
// of the first roof and the catwalk also at the top of the camera's dead zone)
export const SPOTS = [
  ['A_start', 3], ['A_wire', 18], ['A_lamp', 26.2], ['B_cart1', 35.4], ['B_lamp', 34.2], ['B_station', 39], ['B_sandbags', 61.2], ['B_tower', 56.2],
  ['C_sign', 60], ['C_wall', 64], ['C_roof1_edge', 67], ['C_roof1', 70], ['C_roof1_mid', 74], ['C_catwalk', 79], ['C_roof2_edge', 83], ['C_roof2', 87],
  ['C_roof2_mid', 90], ['C_street', 95], ['C_roof1_edge_hi', 67, true], ['C_roof1_hi', 70, true], ['C_roof1_mid_hi', 74, true], ['C_catwalk_hi', 79, true],
  ['D_lamp', 96.2], ['D_crate', 101], ['D_belt', 110], ['D_under', 112], ['D_block', 124], ['E_sign', 134], ['E_lamp', 139.2], ['E_edge', 142.5], ['E_house', 152], ['E_far', 157]
];
export async function contrastProbe(page, spots){
  const out = [];
  for (const [name, col, high] of spots){
    out.push({ name, col, ...await page.evaluate(([col, high]) => {
      const D = LVL.debug, M = LVL.map, P = LVL.engine.P, TS = M.TS, W = LVL.style.VW, H = LVL.style.VH, RG = 6 * LVL.style.K, ST = 2 * LVL.style.K;
      const c = Math.floor(col), row = M.standRow(c);
      D.place(col * TS - P.W / 2 + TS / 2, row * TS); LVL.engine.player.face = 1; D.step(1);
      D.cam(Math.max(0, Math.min(M.LW - W, col * TS - W / 2)), high ? Math.max(0, Math.min(M.LH - H, Math.round(row * TS - D.CAM.band[1] * H))) : undefined);
      const g = document.getElementById('cv').getContext('2d');
      LVL.engine.render(); const A = g.getImageData(0, 0, W, H).data;
      const p = LVL.engine.player, oy = p.y; p.y = 10 * M.LH; LVL.engine.render(); const B = g.getImageData(0, 0, W, H).data; p.y = oy; LVL.engine.render();
      const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (d, i) => 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
      const mask = new Uint8Array(W * H); let n = 0, sH = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (let i = 0; i < W * H; i++){ const j = i * 4; if (A[j] !== B[j] || A[j + 1] !== B[j + 1] || A[j + 2] !== B[j + 2]){ mask[i] = 1; n++; sH += lum(A, j);
        const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
      if (!n) return { n: 0 };
      let m = 0, sR = 0, k = 0, sU = 0;
      for (let y = y0 - RG; y <= y1 + RG; y++) for (let x = x0 - RG; x <= x1 + RG; x++){
        if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x;
        if (mask[i]){ k++; sU += lum(B, i * 4); continue; }
        let hit = false; for (let dy = -RG; dy <= RG && !hit; dy += ST) for (let dx = -RG; dx <= RG && !hit; dx += ST){ const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && mask[Y * W + X]) hit = true; }
        if (hit){ m++; sR += lum(B, i * 4); } }
      const LH = sH / n, LR = sR / m, LU = sU / k, cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { n, cy: D.state().cy, box: [x0, y0, x1, y1], heroL: +LH.toFixed(4), ringL: +LR.toFixed(4), underL: +LU.toFixed(4), crRing: +cr(LH, LR).toFixed(2), crUnder: +cr(LH, LU).toFixed(2) };
    }, [col, high]) });
  }
  return out;
}
