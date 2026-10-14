# dominant albedo colours of a Meshy base colour texture (opaque texels only): 12 clusters, share, hex, hsv
import sys, colorsys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((256, 256))
q = im.quantize(colors=int(sys.argv[2]) if len(sys.argv) > 2 else 12, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette(); cnt = sorted(q.getcolors(), reverse=True); tot = sum(c for c, _ in cnt)
for c, i in cnt:
    r, g, b = pal[i * 3:i * 3 + 3]; h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if r + g + b < 6 and c / tot > 0.2: continue          # the atlas background
    print(f"{c / tot:5.1%} #{r:02x}{g:02x}{b:02x}  h{h * 360:4.0f} s{s:4.2f} v{v:4.2f}")
