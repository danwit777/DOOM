#!/usr/bin/env python3
"""Usage: python3 -I score.py <render.png> <reference.png> [overlay_out.png]

Compares a rendered frame with a hand-drawn reference sprite at native pixel size.
Both are cropped to their opaque bbox and aligned at the feet (bottom edge, feet centre x).
Prints a JSON summary plus a per-row width table (every 2nd row) so proportions can be read off.

score      = 0.5*silhouette IoU + 0.5*class accuracy
class acc. = share of reference pixels whose colour class (skin / navy / olive / orange / hair / coat tones...)
             matches the render at the same aligned position.
Overlay (optional): 3 panels at 8x: reference | render | diff
   diff: grey = same class, yellow = both opaque but different class, red = reference only, cyan = render only.
"""
import sys, json
from PIL import Image

PAL = {  # colour -> class
 (0,0,0):'black', (24,23,18):'coat_dark', (52,48,39):'coat_mid', (92,86,70):'coat_light', (124,112,98):'coat_light',
 (26,25,10):'olive', (46,44,18):'olive', (73,71,28):'olive',
 (20,25,50):'navy', (35,43,82):'navy',
 (141,82,69):'skin', (177,132,101):'skin', (94,32,26):'skin_dark', (39,23,19):'skin_dark', (100,38,15):'skin_dark',
 (49,61,57):'hair', (71,71,71):'hair', (19,26,26):'hair',
 (235,127,28):'orange', (235,163,87):'orange', (255,206,135):'orange',
}
PK = list(PAL.keys())

def cls(p):
    r,g,b,a = p
    if a < 128: return None
    best = min(PK, key=lambda c: (c[0]-r)**2+(c[1]-g)**2+(c[2]-b)**2)
    return PAL[best]

def load(path):
    im = Image.open(path).convert('RGBA')
    bb = im.getbbox()
    if not bb: raise SystemExit(f'{path}: empty image')
    im = im.crop(bb)
    w,h = im.size; px = im.load()
    grid = [[cls(px[x,y]) for x in range(w)] for y in range(h)]
    return im, grid

def feet_center(grid):
    h = len(grid); xs = []
    for y in range(h-6, h):
        xs += [x for x,c in enumerate(grid[y]) if c]
    return (sum(xs)/len(xs)) if xs else len(grid[0])/2

def main():
    if len(sys.argv) < 3: raise SystemExit(__doc__)
    rimg, R = load(sys.argv[1]); fimg, F = load(sys.argv[2])
    rh, rw = len(R), len(R[0]); fh, fw = len(F), len(F[0])
    # align: bottom edges, feet centre x
    dx = round(feet_center(F) - feet_center(R))      # render x + dx -> reference x
    dy = fh - rh                                     # render y + dy -> reference y
    H = max(fh, rh + max(dy,0) - min(dy,0));
    inter = union = match = 0
    cls_stats = {}
    rows = {}
    ymin = min(0, dy); ymax = max(fh, rh+dy)
    xmin = min(0, dx); xmax = max(fw, rw+dx)
    for y in range(ymin, ymax):
        for x in range(xmin, xmax):
            f = F[y][x] if 0<=y<fh and 0<=x<fw else None
            ry, rx = y-dy, x-dx
            r = R[ry][rx] if 0<=ry<rh and 0<=rx<rw else None
            if f or r: union += 1
            if f and r:
                inter += 1
                if f == r: match += 1
            if f:
                s = cls_stats.setdefault(f, {'ref':0,'render':0,'hit':0}); s['ref'] += 1
                if r == f: s['hit'] += 1
            if r:
                s = cls_stats.setdefault(r, {'ref':0,'render':0,'hit':0}); s['render'] += 1
    ref_px = sum(1 for row in F for c in row if c)
    iou = inter/union if union else 0
    acc = match/ref_px if ref_px else 0
    out = {
      'score': round(0.5*iou + 0.5*acc, 4), 'silhouette_iou': round(iou,4), 'class_accuracy': round(acc,4),
      'reference_size': [fw, fh], 'render_size': [rw, rh], 'offset_render_to_ref': [dx, dy],
      'classes': {k: {'ref_px':v['ref'], 'render_px':v['render'], 'recall': round(v['hit']/v['ref'],3) if v['ref'] else None}
                  for k,v in sorted(cls_stats.items())}
    }
    print(json.dumps(out, indent=1))
    # row profile (reference coordinates, y from top of the reference)
    print('\nrow  ref: x0-x1 (w)   render: x0-x1 (w)   [reference frame coords; render shifted by offset]')
    for y in range(0, fh, 2):
        fx = [x for x,c in enumerate(F[y]) if c]
        ry = y-dy
        rx = [x+dx for x,c in enumerate(R[ry]) if c] if 0<=ry<rh else []
        fs = f'{min(fx):2d}-{max(fx):2d} ({len(fx):2d})' if fx else '   --      '
        rs = f'{min(rx):2d}-{max(rx):2d} ({len(rx):2d})' if rx else '   --      '
        print(f'{y:3d}  {fs}        {rs}')
    if len(sys.argv) > 3:
        S = 8
        W = max(fw, rw, xmax-xmin); Hh = max(fh, rh, ymax-ymin)
        ov = Image.new('RGBA', ((W*3+8)*S, Hh*S), (70,90,110,255))
        def put(panel, x, y, col):
            for yy in range(S):
                for xx in range(S): ov.putpixel(((panel*(W+4)+x)*S+xx, y*S+yy), col)
        fpx = fimg.load(); rpx = rimg.load()
        for y in range(fh):
            for x in range(fw):
                if F[y][x]: put(0, x-xmin, y-ymin, fpx[x,y])
        for y in range(rh):
            for x in range(rw):
                if R[y][x]: put(1, x+dx-xmin, y+dy-ymin, rpx[x,y])
        for y in range(ymin, ymax):
            for x in range(xmin, xmax):
                f = F[y][x] if 0<=y<fh and 0<=x<fw else None
                ry, rx = y-dy, x-dx
                r = R[ry][rx] if 0<=ry<rh and 0<=rx<rw else None
                if f and r: put(2, x-xmin, y-ymin, (150,150,150,255) if f==r else (230,210,40,255))
                elif f: put(2, x-xmin, y-ymin, (220,40,40,255))
                elif r: put(2, x-xmin, y-ymin, (40,200,220,255))
        ov.save(sys.argv[3]); print('\noverlay written:', sys.argv[3])

main()
