"""texpaint.py spec.json : repaint texels of a Meshy character's texture by their bind-pose 3D position (sprite side, p2e fix round),
then write copies of the character's GLBs that carry the new texture (PNG, appended as a new bufferView; mesh, rig and clips unchanged).
spec = {"src": glb (mesh + texture), "glbs": {in.glb: out.glb, ...}, "tex_out": png,
        "ops": [{"name", "y": [y0, y1], "x": [x0, x1], "z": [z0, z1], "maxL": lab L (only texels darker than this), "minL",
                 "rgb": [r, g, b] (the new colour; the texel's own value offset from the op's mean is kept, x keep)}]}"""
import sys, json, struct, io, copy
sys.path.insert(0, '/tmp/claude-0/-home-user-DOOM/dfde09f2-3c62-5cd6-b478-4df69e6133b9/scratchpad/meshy/groups/g8/p2e/fix')
import numpy as np
from PIL import Image
from glbmesh import load
S = json.load(open(sys.argv[1])); m = load(S['src']); P, U, I = m['pos'], m['uv'], m['idx']
T = np.asarray(m['tex']).astype(float); H, W = T.shape[:2]; N = T.copy()
lum = 0.2126 * T[..., 0] + 0.7152 * T[..., 1] + 0.0722 * T[..., 2]
for op in S['ops']:
    lo = np.array([op.get('x', [-9, 9])[0], op['y'][0], op.get('z', [-9, 9])[0]]); hi = np.array([op.get('x', [-9, 9])[1], op['y'][1], op.get('z', [-9, 9])[1]])
    tp = P[I]; cand = I[((tp.max(1) >= lo) & (tp.min(1) <= hi)).all(1)]
    mask = np.zeros((H, W), bool)
    for t in cand:
        uv = U[t] * [W, H]; x0, y0 = np.floor(uv.min(0)).astype(int); x1, y1 = np.ceil(uv.max(0)).astype(int)
        x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W - 1, x1), min(H - 1, y1)
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = uv; v0, v1 = b - a, c - a; d = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(d) < 1e-9: continue
        px, py = gx - a[0], gy - a[1]; l1 = (px * v1[1] - v1[0] * py) / d; l2 = (v0[0] * py - px * v0[1]) / d; l0 = 1 - l1 - l2
        ins = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not ins.any(): continue
        pos = l0[..., None] * P[t[0]] + l1[..., None] * P[t[1]] + l2[..., None] * P[t[2]]
        ok = ins & ((pos >= lo) & (pos <= hi)).all(-1)
        mask[y0:y1 + 1, x0:x1 + 1] |= ok
    if 'maxL' in op: mask &= lum < op['maxL']
    if 'minL' in op: mask &= lum > op['minL']
    mean = lum[mask].mean() if mask.any() else 0
    off = (lum - mean) * op.get('keep', 0.6)
    N[mask] = np.clip(np.array(op['rgb'])[None, :] + off[mask][:, None], 0, 255)
    print(op['name'], 'texels', int(mask.sum()), 'mean L', round(float(mean), 1))
img = Image.fromarray(N.astype(np.uint8)); img.save(S['tex_out'])
buf = io.BytesIO(); img.save(buf, 'PNG'); png = buf.getvalue()
for src, dst in S['glbs'].items():
    b = open(src, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L]); BL = struct.unpack('<I', b[20 + L:24 + L])[0]
    bin_ = bytearray(b[28 + L:28 + L + BL]); off0 = (len(bin_) + 3) & ~3; bin_ += b'\0' * (off0 - len(bin_)); bin_ += png
    bin_ += b'\0' * ((-len(bin_)) % 4)
    J['bufferViews'].append({'buffer': 0, 'byteOffset': off0, 'byteLength': len(png)})
    for im in J['images']: im['bufferView'] = len(J['bufferViews']) - 1; im['mimeType'] = 'image/png'
    J['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(dst, 'wb').write(out); print(dst, len(out))
