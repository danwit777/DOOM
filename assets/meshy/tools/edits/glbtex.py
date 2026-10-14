"""glbtex.py : (1) 'cmp a.glb b.glb' - are the embedded texture images and the mesh vertex data of two GLBs identical (same rig)?
(2) 'put in.glb tex.png out.glb' - a copy of in.glb whose images all point to tex.png (appended as a new bufferView, as
p2e/fix/texpaint.py writes its copies; mesh, rig and clips byte for byte)."""
import sys, json, struct, hashlib
def parse(f):
    b = open(f, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L]); BL = struct.unpack('<I', b[20 + L:24 + L])[0]
    return b, J, b[28 + L:28 + L + BL]
def view(J, B, i):
    v = J['bufferViews'][i]; o = v.get('byteOffset', 0); return B[o:o + v['byteLength']]
if sys.argv[1] == 'cmp':
    out = []
    for f in sys.argv[2:4]:
        b, J, B = parse(f)
        im = [hashlib.md5(view(J, B, x['bufferView'])).hexdigest() for x in J['images']]
        pa = [hashlib.md5(view(J, B, J['accessors'][p['attributes']['POSITION']]['bufferView'])).hexdigest() for m in J['meshes'] for p in m['primitives']]
        out.append((im, pa)); print(f.rsplit('/', 2)[-2], 'images', im, 'positions', pa)
    print('SAME' if out[0] == out[1] else 'DIFFERENT')
else:
    src, png, dst = sys.argv[2:5]
    b, J, B = parse(src); png = open(png, 'rb').read(); bin_ = bytearray(B)
    off0 = (len(bin_) + 3) & ~3; bin_ += b'\0' * (off0 - len(bin_)); bin_ += png; bin_ += b'\0' * ((-len(bin_)) % 4)
    J['bufferViews'].append({'buffer': 0, 'byteOffset': off0, 'byteLength': len(png)})
    for im in J['images']: im['bufferView'] = len(J['bufferViews']) - 1; im['mimeType'] = 'image/png'
    J['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(dst, 'wb').write(out); print(dst, len(out))
