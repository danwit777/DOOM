#!/usr/bin/env python3
"""Usage: python3 -I turn_score.py <render.png> <sheet_view.png> [overlay.png] [--match=height|feet]

Compares a T-pose render (front / side / back view) with one view cut from the owner's turnaround sheet.
The sheet view is scaled so its figure height (head top to sole) equals the render's, then both are aligned at
the soles and at the horizontal centre of the feet (bottom 8% of rows). Prints JSON (silhouette IoU, sizes, scale)
and a row table every 4% of the height: x-extents of both silhouettes in render pixels (the arms make the widest rows).
overlay: sheet (scaled) | render | diff (grey both, red sheet only, cyan render only), 3x nearest.
Note: the sheet's back view is mirrored for the shoulder armour (the armour is on the character's LEFT shoulder:
viewer's right in the FRONT view, viewer's LEFT in a correct back view); silhouette-wise this matters little.
"""
import sys, json
from PIL import Image
import numpy as np

def load(p):
    im = Image.open(p).convert('RGBA')
    bb = im.getbbox(); im = im.crop(bb)
    return im

def feet_cx(mask):
    h = mask.shape[0]; rows = mask[int(h*0.92):]
    ys, xs = np.nonzero(rows)
    return xs.mean() if len(xs) else mask.shape[1]/2

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2: raise SystemExit(__doc__)
    r = load(args[0]); s = load(args[1])
    scale = r.height / s.height
    s2 = s.resize((max(1,round(s.width*scale)), r.height), Image.LANCZOS)
    R = np.array(r)[:,:,3] > 127; S = np.array(s2)[:,:,3] > 127
    dx = round(feet_cx(R) - feet_cx(S))          # sheet x + dx -> render x
    x0 = min(0, dx); x1 = max(R.shape[1], S.shape[1]+dx); W = x1-x0; H = R.shape[0]
    A = np.zeros((H,W),bool); B = np.zeros((H,W),bool)
    A[:, -x0:-x0+R.shape[1]] = R
    B[:, dx-x0:dx-x0+S.shape[1]] = S
    inter = (A&B).sum(); union = (A|B).sum()
    out = {'silhouette_iou': round(inter/union,4), 'render_size':[r.width,r.height], 'sheet_size':[s.width,s.height],
           'sheet_scaled':[s2.width,s2.height], 'scale':round(scale,4),
           'width_ratio_render_over_sheet': round(R.shape[1]/S.shape[1],3)}
    print(json.dumps(out, indent=1))
    print('\nrow(%h)  sheet x0-x1 (w)     render x0-x1 (w)')
    for k in range(0,100,4):
        y = min(H-1, int(H*k/100))
        bs = np.nonzero(B[y])[0]; as_ = np.nonzero(A[y])[0]
        f = lambda v: f'{v.min():4d}-{v.max():4d} ({len(v):3d})' if len(v) else '      --        '
        print(f'{k:3d}%     {f(bs)}    {f(as_)}')
    if len(args) > 2:
        Z = 3
        sh = np.array(s2); rr = np.array(r)
        canvas = Image.new('RGBA', (W*3+40, H), (70,90,110,255))
        a = Image.new('RGBA',(W,H),(0,0,0,0)); a.paste(Image.fromarray(sh), (dx-x0,0))
        b = Image.new('RGBA',(W,H),(0,0,0,0)); b.paste(Image.fromarray(rr), (-x0,0))
        canvas.alpha_composite(a,(0,0)); canvas.alpha_composite(b,(W+20,0))
        d = np.zeros((H,W,4),np.uint8)
        d[A&B] = (150,150,150,255); d[B&~A] = (220,40,40,255); d[A&~B] = (40,200,220,255)
        canvas.alpha_composite(Image.fromarray(d),(2*W+40,0))
        canvas.resize((canvas.width*Z, canvas.height*Z), Image.NEAREST).save(args[2])
        print('\noverlay written:', args[2])

main()
