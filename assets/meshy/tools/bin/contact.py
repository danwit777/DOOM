# Contact sheet for picking candidates: python3 -I contact.py out.png img1 [img2 ...]  (each cell 384 px, labelled with its parent dir)
import sys, os
from PIL import Image, ImageDraw
out, fs = sys.argv[1], sys.argv[2:]
lab = [f.split('=', 1)[0] if '=' in f else None for f in fs]; fs = [f.split('=', 1)[1] if '=' in f else f for f in fs]   # 'label=path' args
C = 384; cols = min(4, len(fs)); rows = (len(fs) + cols - 1) // cols
s = Image.new('RGB', (cols * C, rows * (C + 18)), (24, 22, 26)); d = ImageDraw.Draw(s)
for i, f in enumerate(fs):
    im = Image.open(f).convert('RGBA'); bg = Image.new('RGBA', im.size, (40, 38, 44, 255)); bg.alpha_composite(im); im = bg.convert('RGB')
    im.thumbnail((C, C)); x, y = (i % cols) * C, (i // cols) * (C + 18)
    s.paste(im, (x + (C - im.width) // 2, y + (C - im.height) // 2))
    d.text((x + 4, y + C + 3), (lab[i] + ': ' if lab[i] else f'{i}: ') + os.path.basename(os.path.dirname(f))[-14:] + '/' + os.path.basename(f), fill=(220, 210, 190))
s.save(out); print(out, s.size)
