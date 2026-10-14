"""glbmesh.py: read a Meshy GLB's single skinned mesh (positions, uvs, indices, joints, weights), its texture and node names."""
import json, struct, io
import numpy as np
from PIL import Image
def load(f):
    b = open(f, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L]); B0 = 20 + L + 8
    def acc(i):
        a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]; sz = np.dtype(dt).itemsize
        st = v.get('byteStride', n * sz); o = B0 + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        if st == n * sz: return np.frombuffer(b[o:o + a['count'] * n * sz], dtype=dt).reshape(a['count'], n)
        return np.array([np.frombuffer(b[o + k * st:o + k * st + n * sz], dtype=dt) for k in range(a['count'])])
    p = J['meshes'][0]['primitives'][0]; at = p['attributes']
    m = {'pos': acc(at['POSITION']).astype(float), 'uv': acc(at['TEXCOORD_0']).astype(float), 'idx': acc(p['indices']).reshape(-1, 3),
         'joints': acc(at['JOINTS_0']).astype(int), 'weights': acc(at['WEIGHTS_0']).astype(float)}
    sk = J['skins'][0]; m['jnames'] = [J['nodes'][j].get('name') for j in sk['joints']]
    im = J['images'][0]; v = J['bufferViews'][im['bufferView']]; o = B0 + v.get('byteOffset', 0)
    m['tex'] = Image.open(io.BytesIO(b[o:o + v['byteLength']])).convert('RGB'); m['J'] = J; m['raw'] = b
    return m
