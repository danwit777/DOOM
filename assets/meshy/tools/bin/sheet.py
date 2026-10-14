# Review sheet: each sprite of an atlas (models.png + models.json) standing on a ground line next to the 96 px hero drawn at the sprite's
# layer scale (playfield 1.0: the real hero; a parallax layer: the hero scaled by that layer's factor, nearest), the Meshy thumbnail above
# when given. usage: python3 -I sheet.py <atlas_dir> <out.png> name[:thumb.png] ...   (also writes <out>_x2.png)
import json, sys
from PIL import Image, ImageDraw
atlas_dir, out, items = sys.argv[1], sys.argv[2], sys.argv[3:]
A = Image.open(f'{atlas_dir}/models.png').convert('RGBA'); J = json.load(open(f'{atlas_dir}/models.json'))['sprites']
H = Image.open('/home/user/DOOM/level/hero.png').convert('RGBA'); hf = json.load(open('/home/user/DOOM/level/hero.json'))['anims']['idle']['frames'][0]
hero0 = H.crop((hf['x'], hf['y'], hf['x'] + hf['w'], hf['y'] + hf['h']))
BG, GROUND, FG = (47, 34, 38, 255), (45, 39, 49, 255), (216, 208, 184, 255)
cells = []
for it in items:
    n, _, th = it.partition(':'); s = J[n]; sc = s.get('scale', 1) or 1
    spr = A.crop((s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h']))
    hero = hero0 if abs(sc - 1) < 1e-6 else hero0.resize((max(1, round(hf['w'] * sc)), max(1, round(hf['h'] * sc))), Image.NEAREST)
    hay = round(hf['ay'] * sc)
    w = s['w'] + 16 + hero.width + 8; h = max(s['ay'], hay) + 6
    c = Image.new('RGBA', (max(w, 160), h + 14), BG); gy = h - 6
    ImageDraw.Draw(c).rectangle((0, gy, c.width, h + 14), fill=GROUND)
    c.alpha_composite(spr, (4, gy - s['ay'])); c.alpha_composite(hero, (4 + s['w'] + 12, gy - hay))
    ImageDraw.Draw(c).text((4, h + 1), f"{n} {s['w']}x{s['h']} x{sc:g}", fill=FG)
    t = None
    if th:
        try: t = Image.open(th).convert('RGBA'); t.thumbnail((180, 180))
        except Exception: t = None
    cells.append((c, t))
row_h = max(c.height for c, _ in cells) + 190
W = sum(max(c.width, 180) + 12 for c, _ in cells) + 12
sheet = Image.new('RGBA', (W, row_h), BG); x = 12
for c, t in cells:
    if t: sheet.alpha_composite(t, (x, 4))
    sheet.alpha_composite(c, (x, row_h - c.height)); x += max(c.width, 180) + 12
sheet.save(out); sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(out.replace('.png', '_x2.png')); print(out, sheet.size)
