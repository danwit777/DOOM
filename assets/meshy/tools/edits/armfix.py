"""armfix.py in.glb out.glb spec.json : a motion edit of Meshy animation GLBs (sprite side, fix round of p2e).
spec = [{"clip": "Arise", "bones": ["RightArm", "RightForeArm"], "ref": 0.0, "win": [ta, tb], "ramp": [ri, ro]}, ...]
For each listed bone of the clip, the rotation keys in the window are slerped toward the bone's own local rotation at time ref
(e.g. the arm lying along the body), with weight 0 -> 1 over ramp ri after ta and 1 -> 0 over ramp ro before tb (smoothstep):
an empty arm that the clip throws forward / up is kept down along the torso. Only those rotation keys change; the mesh, the rig and
the other clips are copied byte for byte."""
import json, struct, sys
import numpy as np
src, dst, spec = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
b = bytearray(open(src, 'rb').read())
L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L]); B0 = 20 + L + 8          # BIN chunk data start
names = [n.get('name') for n in J['nodes']]
def acc(i):
    a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    assert a['componentType'] == 5126 and v.get('byteStride', n * 4) == n * 4
    o = B0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return o, np.frombuffer(bytes(b[o:o + a['count'] * n * 4]), dtype='<f4').reshape(a['count'], n).copy()
def slerp(p, q, t):
    if np.dot(p, q) < 0: q = -q
    d = min(1.0, float(np.dot(p, q)))
    if d > 0.9995: r = p + t * (q - p); return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1 - t) * th) * p + np.sin(t * th) * q) / np.sin(th)
def sstep(x): x = min(1, max(0, x)); return x * x * (3 - 2 * x)
def sample(T, Q, t):
    if t <= T[0]: return Q[0]
    if t >= T[-1]: return Q[-1]
    k = int(np.searchsorted(T, t)) - 1; u = (t - T[k]) / (T[k + 1] - T[k]); return slerp(Q[k], Q[k + 1], u)
log = []
for s in spec:
    an = [a for a in J['animations'] if a['name'] == s['clip']][0]
    ta, tb = s['win']; ri, ro = s.get('ramp', [0.15, 0.25])
    for ch in an['channels']:
        bn = names[ch['target']['node']]
        if bn not in s['bones'] or ch['target']['path'] != 'rotation': continue
        sm = an['samplers'][ch['sampler']]; _, T = acc(sm['input']); o, Q = acc(sm['output']); T = T[:, 0]
        ref = s.get('refq', {}).get(bn); qr = np.array(ref, dtype=float) if ref else sample(T, Q, s['ref'])
        mx = 0
        for k, t in enumerate(T):
            w = sstep((t - ta) / ri) * sstep((tb - t) / ro) if ta <= t <= tb else 0.0
            if w <= 0: continue
            q = slerp(Q[k].astype(float), qr, w); mx = max(mx, w); Q[k] = q
        b[o:o + Q.size * 4] = Q.astype('<f4').tobytes(); log.append((s['clip'], bn, len(T), round(mx, 2)))
open(dst, 'wb').write(b); print(dst, log)
