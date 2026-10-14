#!/usr/bin/env python3
"""assemble.py - builds the Meshy asset library's two deliverables from the files on disk. Re-runnable and deterministic: it reads
everything from disk on every run (plan, verdicts, ledger, lib/, groups/*/result files, atlases, character atlases), so a run after new
clips or re-renders picks them up. Nothing is hard-coded per asset except the Polish texts in bin/assemble_pl.json (with fallbacks).

  python3 -I meshy/bin/assemble.py [--repo DIR] [--gallery DIR] [--skip-repo] [--skip-gallery]

A) the repo package (default /home/user/DOOM/assets/meshy): models/<asset>.glb (the compact GLBs the sprites were rendered from, the
   final pick per asset), sprites/<group>.png + .json (atlases as rendered), characters/<name>.png + .json, tools/, manifest.json,
   README.md. No signed URLs and no keys: the run ends with a leak scan and fails when it finds one.
B) the private gallery (default meshy/gallery): index.html (Polish) + img/ (Meshy thumbnails as JPEG, sprite line-ups next to the hero,
   one clip sheet per character). Download links there are the signed Meshy URLs from each task.json (they expire, the page says when).

Reads (under meshy/): plan/plan.json, plan/inventory.json, verdicts.json, rerolls.txt, lib/ledger.jsonl, lib/<asset>/{candidates,
final*}.json and lib/<asset>/<kind>-<id>/task.json, gen/dl (the pilot), groups/<g>/{result,pass2_result,models}.json, groups/<g>/out/,
groups/g8/library.json (animation names), bin/assemble_pl.json; read-only from the repo: level/hero.png + hero.json, level/sprites/.
Never opens .key or .auth_header.
"""
import argparse, glob, html, io, json, math, os, re, shutil, struct, sys, time, urllib.parse
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone
from PIL import Image

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # .../scratchpad/meshy
SP = os.path.dirname(M)
LIB = os.path.join(M, 'lib')
GROUPS = os.path.join(M, 'groups')
REPO = '/home/user/DOOM'
LEVEL = os.path.join(REPO, 'level')
DEF_REPO_OUT = os.path.join(REPO, 'assets', 'meshy')
DEF_GALLERY = os.path.join(M, 'gallery')
SIZE_BUDGET = 80 * 1000 * 1000
ARCHIVE_BRANCH = 'meshy-models-full'                                   # the full-resolution archive branch on origin
MODEL_KINDS = ('refine', 'i3d', 'mi3d')
KIND_ORDER = ['t2i', 't3d', 'refine', 'i3d', 'mi3d', 'rig', 'anim']
# leak patterns, assembled so this file does not match itself
LEAK_SIG = 'Signa' + 'ture='
LEAK_KP = 'Key-Pair' + '-Id='
LEAK_KEY = 'ms' + 'y_'
LEAK_BEARER = re.compile('Bear' + r'er\s+[A-Za-z0-9_\-\.]{16,}')


# ---------------------------------------------------------------------------------------------------------------------------- io
def load(p, default=None, tries=5):
    """JSON from disk; retries a few times (another agent may be rewriting the file)."""
    if not os.path.exists(p):
        return default
    for i in range(tries):
        try:
            with open(p) as f:
                return json.load(f)
        except (ValueError, OSError):
            if i == tries - 1:
                raise
            time.sleep(1.5)


def absm(p):
    if not p:
        return p
    return p if os.path.isabs(p) else os.path.join(M, p)


def clean(s):
    """Scratchpad paths -> 'meshy/...' (the repo package must not depend on a temp path)."""
    if isinstance(s, str):
        return s.replace(M + '/', 'meshy/').replace(M, 'meshy').replace(SP + '/', '<scratchpad>/')
    if isinstance(s, list):
        return [clean(x) for x in s]
    if isinstance(s, dict):
        return OrderedDict((k, clean(v)) for k, v in s.items())
    return s


def first_sentence(t, n=260):
    t = (t or '').strip().replace('\n', ' ')
    if not t:
        return ''
    m = re.search(r'^(.+?[.!?])(\s|$)', t)
    s = m.group(1) if m else t
    return s if len(s) <= n else s[:n - 1].rstrip() + '…'


def first_sentences(t, n=300, min_len=70):
    """the first sentence, or the first two when the first is a short preamble."""
    t = (t or '').strip().replace('\n', ' ')
    out = ''
    while t and len(out) < min_len:
        m = re.search(r'^(.+?[.!?])(\s+|$)', t)
        s = m.group(1) if m else t
        out = (out + ' ' + s).strip()
        t = t[m.end():] if m else ''
    return out if len(out) <= n else out[:n - 1].rstrip() + '…'


def r2(x):
    return None if x is None else round(float(x), 2)


# ---------------------------------------------------------------------------------------------------------------------------- glb
def glb_json(path):
    with open(path, 'rb') as f:
        head = f.read(20)
        if len(head) < 20 or head[:4] != b'glTF':
            return None
        cl = struct.unpack('<I', head[12:16])[0]
        return json.loads(f.read(cl))


def _node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [0, 0, 0, 1]]
    t = n.get('translation', [0, 0, 0]); s = n.get('scale', [1, 1, 1]); x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[i][0] * s[0], R[i][1] * s[1], R[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def _mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


NORM_DIV = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def glb_info(path):
    """bbox in metres (scene units), triangle count, animation names, skin flag, extensions."""
    j = glb_json(path)
    if not j:
        return None
    lo, hi, tris = [math.inf] * 3, [-math.inf] * 3, 0

    def walk(i, W):
        nonlocal tris
        n = j['nodes'][i]; W = _mul(W, _node_matrix(n))
        if 'mesh' in n:
            for pr in j['meshes'][n['mesh']]['primitives']:
                a = j['accessors'][pr['attributes']['POSITION']]
                mn, mx = a.get('min'), a.get('max')
                ia = pr.get('indices')
                tris += (j['accessors'][ia]['count'] if ia is not None else a['count']) // 3
                if not mn or not mx:
                    continue
                if a.get('normalized'):
                    d = NORM_DIV.get(a['componentType'], 1.0); mn = [v / d for v in mn]; mx = [v / d for v in mx]
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            p = [W[r][0] * cx + W[r][1] * cy + W[r][2] * cz + W[r][3] for r in range(3)]
                            for k in range(3):
                                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
        for c in n.get('children', []):
            walk(c, W)
    I = [[1 if i == k else 0 for k in range(4)] for i in range(4)]
    sc = j.get('scenes', [{}])[j.get('scene', 0)] if j.get('scenes') else {'nodes': list(range(len(j.get('nodes', []))))}
    for i in sc.get('nodes', []):
        walk(i, I)
    size = [round(hi[k] - lo[k], 2) for k in range(3)] if hi[0] > -math.inf else None
    return {'size_m': size, 'min_y': round(lo[1], 3) if size else None, 'tris': tris,
            'centre_xz': [round((hi[0] + lo[0]) / 2, 3), round((hi[2] + lo[2]) / 2, 3)] if size else None,
            'animations': [a.get('name', '') for a in j.get('animations', [])], 'skinned': bool(j.get('skins')),
            'extensions': j.get('extensionsUsed', [])}


def glb_split(path):
    """(json, BIN bytes) of a GLB."""
    with open(path, 'rb') as f:
        b = f.read()
    cl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + cl])
    o = 20 + cl
    binb = b''
    if o + 8 <= len(b):
        bl = struct.unpack('<I', b[o:o + 4])[0]
        binb = b[o + 8:o + 8 + bl]
    return j, binb


def _acc_bytes(j, binb, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return binb[o:o + a['count'] * n * 4], n


def _floats(bs):
    return struct.unpack('<%df' % (len(bs) // 4), bs)


def clip_label(n):
    return re.sub(r'^Armature\|', '', n).replace('|baselayer', '')


def glb_edit_diff(src, dst):
    """what an edited copy of a Meshy animation GLB changed: per clip the bones whose rotation keys differ and the time window of the
    changed keys, plus whether the texture image differs. None when the two do not share the clip list and the node names."""
    js, bs = glb_split(src); jd, bd = glb_split(dst)
    if [a.get('name') for a in js.get('animations', [])] != [a.get('name') for a in jd.get('animations', [])]:
        return None
    if [n.get('name') for n in js.get('nodes', [])] != [n.get('name') for n in jd.get('nodes', [])]:
        return None
    clips = []
    for an_s, an_d in zip(js.get('animations', []), jd.get('animations', [])):
        bones, t0, t1, maxdeg = [], None, None, 0.0
        for ch_s, ch_d in zip(an_s['channels'], an_d['channels']):
            ss, sd = an_s['samplers'][ch_s['sampler']], an_d['samplers'][ch_d['sampler']]
            os_, n = _acc_bytes(js, bs, ss['output']); od, _ = _acc_bytes(jd, bd, sd['output'])
            if os_ == od:
                continue
            T = _floats(_acc_bytes(js, bs, ss['input'])[0]); A = _floats(os_); B = _floats(od)
            ch = []
            for k in range(min(len(T), len(A) // n)):
                qa, qb = A[k * n:(k + 1) * n], B[k * n:(k + 1) * n]
                if qa != qb:
                    ch.append(T[k])
                    if n == 4:
                        d = abs(sum(x * y for x, y in zip(qa, qb)))
                        maxdeg = max(maxdeg, math.degrees(2 * math.acos(min(1.0, d))))
            if ch:
                bones.append('%s.%s' % (jd['nodes'][ch_d['target']['node']].get('name'), ch_d['target']['path']))
                t0 = ch[0] if t0 is None else min(t0, ch[0]); t1 = ch[-1] if t1 is None else max(t1, ch[-1])
        if bones:
            clips.append(OrderedDict([('clip', clip_label(an_d.get('name', ''))), ('channels', bones),
                                      ('window_s', [round(t0, 3), round(t1, 3)]), ('max_change_deg', round(maxdeg, 1))]))
    tex = False
    for ims, imd in zip(js.get('images', []), jd.get('images', [])):
        if 'bufferView' in ims and 'bufferView' in imd:
            vs, vd = js['bufferViews'][ims['bufferView']], jd['bufferViews'][imd['bufferView']]
            a = bs[vs.get('byteOffset', 0):vs.get('byteOffset', 0) + vs['byteLength']]
            b = bd[vd.get('byteOffset', 0):vd.get('byteOffset', 0) + vd['byteLength']]
            tex = tex or a != b
    return {'clips': clips, 'texture': tex}


# ---------------------------------------------------------------------------------------------------------------------------- data
class Data:
    def __init__(self):
        self.pl = load(os.path.join(M, 'bin', 'assemble_pl.json'), {}) or {}
        self.plan = load(os.path.join(M, 'plan', 'plan.json'))
        self.inventory = (load(os.path.join(M, 'plan', 'inventory.json'), {}) or {}).get('items', [])
        self.V = load(os.path.join(M, 'verdicts.json'), {})
        self.load_ledger()
        self.load_tasks()
        self.load_actions()
        self.load_results()
        self.load_atlases()
        self.load_edits()
        self.load_reviews()

    # ledger: one row per task, credits = actual when the task finished, else the estimate
    def load_ledger(self):
        rows, upd = [], {}
        with open(os.path.join(LIB, 'ledger.jsonl')) as f:
            for l in f:
                l = l.strip()
                if not l:
                    continue
                try:
                    r = json.loads(l)
                except ValueError:
                    continue
                if r.get('update'):
                    upd[r['id']] = r
                else:
                    rows.append(r)
        for r in rows:
            u = upd.get(r['id'])
            r['credits'] = u['actual'] if u else r['est']
            r['status'] = u['status'] if u else 'PENDING'
        rows.sort(key=lambda r: (r['t'], r['id']))
        self.ledger = rows
        self.led = {r['id']: r for r in rows}
        self.by_name = defaultdict(list)
        for r in rows:
            self.by_name[r['name']].append(r)

    def load_tasks(self):
        self.task = {}                                         # id -> {kind, dir, json, thumb, pilot}
        for tj in sorted(glob.glob(os.path.join(LIB, '*', '*-*', 'task.json'))):
            d = os.path.dirname(tj); base = os.path.basename(d); kind, _, tid = base.partition('-')
            self.task[tid] = {'kind': kind, 'dir': d, 'json': tj, 'asset': os.path.basename(os.path.dirname(d))}
        self.pilot = {}                                        # asset -> {preview, refine, thumb, credits, prompt}
        for pj in sorted(glob.glob(os.path.join(M, 'gen', 'dl', '*.refine.json'))):
            name = os.path.basename(pj)[:-len('.refine.json')]
            ref = load(pj, {}); pre = load(pj.replace('.refine.json', '.preview.json'), {})
            thumb = pj.replace('.refine.json', '.thumb.png')
            self.pilot[name] = {'refine': ref.get('id'), 'preview': pre.get('id'), 'thumb': thumb if os.path.exists(thumb) else None,
                                'credits': (ref.get('consumed_credits') or 0) + (pre.get('consumed_credits') or 0),
                                'prompt': pre.get('prompt') or ref.get('prompt'), 'texture_prompt': ref.get('texture_prompt', '')}
            if ref.get('id'):
                self.task[ref['id']] = {'kind': 'refine', 'dir': None, 'json': pj, 'asset': name, 'pilot': True}
            if pre.get('id'):
                self.task[pre['id']] = {'kind': 't3d', 'dir': None, 'json': pj.replace('.refine.json', '.preview.json'), 'asset': name,
                                        'pilot': True}
        self._tj = {}

    def tjson(self, tid):
        if tid not in self._tj:
            t = self.task.get(tid)
            self._tj[tid] = load(t['json'], {}) if t else {}
        return self._tj[tid]

    def kind(self, tid):
        r = self.led.get(tid)
        if r:
            return r['kind']
        t = self.task.get(tid)
        return t['kind'] if t else None

    def load_actions(self):
        self.action = {}
        lib = load(os.path.join(GROUPS, 'g8', 'library.json'), []) or []
        for it in lib if isinstance(lib, list) else []:
            if isinstance(it, dict) and 'action_id' in it:
                self.action[int(it['action_id'])] = it.get('name', '')
        for f in sorted(glob.glob(os.path.join(LIB, '*.json'))):
            d = load(f, None)
            items = d.values() if isinstance(d, dict) else (d if isinstance(d, list) else [])
            for it in items:
                if isinstance(it, dict) and 'action_id' in it and int(it['action_id']) not in self.action:
                    self.action[int(it['action_id'])] = it.get('name', '')

    def load_results(self):
        self.gdirs = sorted(d for d in os.listdir(GROUPS) if os.path.exists(os.path.join(GROUPS, d, 'out', 'models.json')))
        self.p1, self.p2 = OrderedDict(), OrderedDict()           # entry name -> (gdir, entry)
        for g in self.gdirs:
            for e in (load(os.path.join(GROUPS, g, 'result.json'), {}) or {}).get('assets', []):
                self.p1.setdefault(e['name'], (g, e))
        for g in self.gdirs:
            for e in (load(os.path.join(GROUPS, g, 'pass2_result.json'), {}) or {}).get('assets', []):
                self.p2.setdefault(e['name'], (g, e))
        self.v1, self.v2 = {}, {}                                 # entry name -> (job key, verdict dict)
        for k in sorted(self.V):
            vv = self.V[k]
            for x in vv.get('verdicts', []):
                (self.v1 if vv.get('pass') == 'pass1' else self.v2).setdefault(x['name'], (k, x))

    def load_atlases(self):
        self.atlas = OrderedDict()                                # key -> {png, json, sprites}
        for g in self.gdirs:
            j = load(os.path.join(GROUPS, g, 'out', 'models.json'))
            self.atlas[g] = {'png': os.path.join(GROUPS, g, 'out', 'models.png'), 'json': os.path.join(GROUPS, g, 'out', 'models.json'),
                             'sprites': j.get('sprites', {})}
        lj = os.path.join(LEVEL, 'sprites', 'models.json')
        if os.path.exists(lj):
            self.atlas['level'] = {'png': os.path.join(LEVEL, 'sprites', 'models.png'), 'json': lj, 'sprites': load(lj).get('sprites', {})}
        self._img = {}

    def load_edits(self):
        """the sprite side's edited copies of Meshy animation GLBs (motion edits by armfix.py, texture repaints by texpaint.py): each is
        matched to the Meshy file it was made from (same clip list and node names, fewest changed channels) and diffed against it."""
        self.edits = []
        self.edit_specs = sorted(glob.glob(os.path.join(GROUPS, 'g8', '*', 'af_*.json')) +
                                 glob.glob(os.path.join(GROUPS, 'g8', '*', 'fix', 'af_*.json')))
        spec_of = defaultdict(list)                               # Meshy clip name -> spec files
        for sf in self.edit_specs:
            for s in load(sf, []) or []:
                spec_of[s.get('clip')].append(sf)
        files = sorted(set(glob.glob(os.path.join(GROUPS, 'g8', '*', 'glb', '*.glb')) +
                           glob.glob(os.path.join(GROUPS, 'g8', '*', 'fix', 'glb', '*.glb'))))
        cands = []
        for p in sorted(glob.glob(os.path.join(LIB, '*', 'anim-*', 'animation.glb')) +
                        glob.glob(os.path.join(LIB, '*', 'rig-*', '*.glb'))):
            j = glb_json(p)
            if j and j.get('animations'):
                cands.append((p, [a.get('name') for a in j['animations']]))
        for f in files:
            jf = glb_json(f)
            if not jf:
                continue
            names = [a.get('name') for a in jf.get('animations', [])]
            best = None
            for p, cn in cands:
                if cn != names:
                    continue
                d = glb_edit_diff(p, f)
                if d is None:
                    continue
                score = sum(len(c['channels']) for c in d['clips']) + (1 if d['texture'] else 0)
                if best is None or score < best[0]:
                    best = (score, p, d)
            if not best:
                continue
            _, p, d = best
            tdir = os.path.basename(os.path.dirname(p)); kind, _, tid = tdir.partition('-')
            asset = os.path.basename(os.path.dirname(os.path.dirname(p)))
            for c in d['clips']:
                raw = next((n for n in names if clip_label(n) == c['clip']), c['clip'])
                sp = spec_of.get(raw, [])
                own = [s for s in sp if re.sub(r'^af_|\.json$', '', os.path.basename(s)) in asset.split('_')]
                c['spec'] = ['tools/edits/' + os.path.basename(s) for s in (own or sp)]
            tools = (['tools/edits/armfix.py'] if d['clips'] else []) + (['tools/edits/texpaint.py', 'tools/edits/glbtex.py']
                                                                           if d['texture'] else [])
            self.edits.append(OrderedDict([('file', f), ('asset', asset), ('source_task', tid), ('source_kind', kind),
                                           ('source_file', os.path.basename(p)), ('bytes', os.path.getsize(f)),
                                           ('clips', d['clips']), ('texture_repainted', d['texture']), ('tools', tools)]))

    def load_reviews(self):
        """later judge rounds recorded only in a job's sink_result.json (fix_round: the judge's must-fix items and what was done)."""
        self.reviews = defaultdict(list)
        for sf in sorted(glob.glob(os.path.join(GROUPS, '*', 'sink_result.json'))):
            d = load(sf, {}) or {}
            fr = d.get('fix_round') or {}
            if not fr:
                continue
            names = {a.get('name') for a in d.get('assets', [])} | {t.get('name') for t in d.get('tasks', [])}
            for n in sorted(x for x in names if x):
                mf = [x for x in fr.get('must_fix', []) if n in x]
                sh = [x for x in fr.get('should_fix', []) if n in x]
                self.reviews[n].append(OrderedDict([('job', d.get('job')), ('score', None), ('source', clean(sf) + ' fix_round'),
                                                    ('must_fix_and_done', mf), ('should_fix_and_done', sh)]))

    def atlas_img(self, key):
        if key not in self._img:
            self._img[key] = Image.open(self.atlas[key]['png']).convert('RGBA')
        return self._img[key]

    def find_sprite(self, name, prefer=()):
        for k in list(prefer) + [k for k in self.atlas if k not in prefer]:
            if k in self.atlas and name in self.atlas[k]['sprites']:
                return k
        return None


# ---------------------------------------------------------------------------------------------------------------------------- tasks
def task_rec(D, tid, role=None):
    r = D.led.get(tid); t = D.task.get(tid, {})
    if not r and not t:
        return {'id': tid, 'role': role}
    tj = D.tjson(tid) if t else {}
    body = (r or {}).get('body', {})
    rec = OrderedDict([('id', tid), ('kind', D.kind(tid)), ('role', role), ('tag', (r or {}).get('tag', 'pilot' if t.get('pilot') else None)),
                       ('credits', (r or {}).get('credits', tj.get('consumed_credits'))), ('status', (r or {}).get('status', tj.get('status')))])
    if body.get('ai_model'):
        rec['ai_model'] = body['ai_model']
    p = body.get('prompt') or tj.get('prompt')
    if p and rec['kind'] in ('t2i', 't3d'):
        rec['prompt'] = p
    tp = body.get('texture_prompt') or tj.get('texture_prompt')
    if tp:
        rec['texture_prompt'] = tp
    for k in ('aspect_ratio', 'remove_background', 'geometry_resolution', 'pose_mode', 'height_meters'):
        if k in body and not isinstance(body[k], (list, dict)):
            rec[k] = body[k]
    if rec['kind'] == 'anim':
        ids = body.get('action_ids') or ([body['action_id']] if 'action_id' in body else [])
        rec['rig'] = body.get('rig_task_id')
        rec['actions'] = [OrderedDict([('id', int(a)), ('name', D.action.get(int(a), ''))]) for a in ids]
    if rec['kind'] == 'rig':
        rec['model'] = body.get('input_task_id')
    if tj.get('expires_at'):
        rec['expires_at'] = datetime.fromtimestamp(tj['expires_at'] / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    if t.get('dir') and role in ('final', 'variant', 'rig', 'anim', 'source'):
        rec['local_copy'] = clean(t['dir']) + '/'
    return rec


def source_of(D, asset, tid):
    r = D.led.get(tid)
    b = (r or {}).get('body', {})
    s = b.get('preview_task_id') or b.get('input_task_id')
    if s:
        return s
    t = D.task.get(tid, {})
    if t.get('pilot'):
        p = D.pilot.get(t['asset'], {})
        return p.get('preview') if p.get('refine') == tid else None
    cands = load(os.path.join(LIB, asset, 'candidates.json'), []) or []
    for f in sorted(glob.glob(os.path.join(LIB, asset, 'final*.json'))):
        for o in (load(f, {}) or {}).get('outputs', []):
            if o.get('id') == tid and o.get('from') is not None:
                for i, c in enumerate(cands):
                    if c.get('i', i) == o['from']:
                        return c.get('id')
    return None


def model_from_entry(D, asset, e):
    """(task id, how): the Meshy model task an entry's compact GLB came from."""
    md = e.get('model_dir') or ''
    m = re.search(r'lib/([^/]+)/(t3d|refine|i3d|mi3d)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', md)
    if m:
        return m.group(3), 'lib'
    if 'gen/dl' in md or (asset in D.pilot and ('/src/' in md or not md) and not e.get('task_ids')):
        p = D.pilot.get(asset)
        if p:
            return p['refine'], 'pilot'
    ids = [t for t in e.get('task_ids', []) if D.kind(t) in MODEL_KINDS]
    if ids:
        return ids[-1], 'kit'
    if (e.get('glb') or '').startswith(LEVEL):
        return None, 'owner'
    return None, 'proc'


def same_bytes(a, b):
    if not a or not b or not os.path.exists(a) or not os.path.exists(b):
        return False
    if os.path.abspath(a) == os.path.abspath(b):
        return True
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, 'rb') as fa, open(b, 'rb') as fb:
        return fa.read() == fb.read()


def sprite_model_glbs(D, sprites, prefer_group=None):
    """abs paths of the compact GLBs the given sprites were rendered from (the atlas 'model' field, every '+' part)."""
    out = OrderedDict()
    for s in sprites or []:
        if '/' in s:
            continue
        k = D.find_sprite(s, [prefer_group] if prefer_group else [])
        if not k or k == 'level':
            continue
        for m in str(D.atlas[k]['sprites'][s].get('model', '')).split('+'):
            p = os.path.join(GROUPS, k, 'models', m + '.glb') if m else ''
            if p and os.path.exists(p):
                out.setdefault(p, []).append(s)
    return out


def final_outputs(asset, files='final.json'):
    out = []
    for f in sorted(glob.glob(os.path.join(LIB, asset, files))):
        for o in (load(f, {}) or {}).get('outputs', []):
            if o.get('kind') in MODEL_KINDS and o.get('status', 'SUCCEEDED') == 'SUCCEEDED':
                out.append(o['id'])
    return out


# ---------------------------------------------------------------------------------------------------------------------------- assets
def build_assets(D):
    plan_idx = OrderedDict()
    for g in D.plan['groups']:
        for a in g['assets']:
            plan_idx[a['name']] = (g['key'], a, g['title'])
    names = list(plan_idx)
    for n in list(D.p1) + list(D.p2) + list(D.v1) + list(D.v2):
        b = n.split('/')[0]
        if b not in names:
            names.append(b)
    assets = []
    for name in names:
        assets.append(build_asset(D, name, plan_idx.get(name)))
    order = {g: i for i, g in enumerate([g['key'] for g in D.plan['groups']] + [g for g in D.gdirs])}
    assets.sort(key=lambda a: (order.get(a['group'], 99), names.index(a['name'])))
    return assets


def build_asset(D, name, planned):
    pl = (D.pl.get('assets', {}) or {}).get(name, {})
    A = OrderedDict(name=name)
    gplan, pa, gtitle = planned if planned else (None, None, None)
    # slots: the main pick and its lettered variants, pass-1 entries replaced by kept pass-2 entries
    slots = OrderedDict()
    for en, (g, e) in D.p1.items():
        if en.split('/')[0] == name:
            key = en.split('/', 1)[1] if '/' in en else ''
            slots[key] = {'entry': e, 'gdir': g, 'pass': 1, 'verdict': D.v1.get(en), 'p1verdict': D.v1.get(en)}
    rejected = []
    replaced_ids = set()
    p2 = D.p2.get(name)
    if p2:
        g2, e2 = p2
        vp2 = D.v2.get(name)
        dropped = (vp2 and vp2[1].get('verdict') == 'drop') or e2.get('status') == 'failed'
        if dropped:
            rejected.append({'entry': e2, 'verdict': vp2, 'gdir': g2})
        else:
            tgt = next((k for k, s in slots.items() if absm(s['entry'].get('glb')) == absm(e2.get('glb'))), '')
            old = slots.get(tgt)
            if old:
                oid, _ = model_from_entry(D, name, old['entry'])
                nid, _ = model_from_entry(D, name, e2)
                if oid and oid != nid:
                    replaced_ids.add(oid)
            slots[tgt] = {'entry': e2, 'gdir': g2, 'pass': 2, 'verdict': vp2, 'p1verdict': (old or {}).get('p1verdict'),
                          'replaced_slot': old}
    group = gplan or (next(iter(slots.values()))['gdir'] if slots else (p2[0] if p2 else None))
    A['group'] = group
    A['pass'] = None
    # the main slot: the best final judge score (ties: the unlettered slot)
    def sc(s):
        v = s.get('verdict')
        return (v[1].get('score') if v and v[1].get('score') is not None else -1, 1 if s is slots.get('') else 0)
    main_key = max(slots, key=lambda k: sc(slots[k])) if slots else None
    main = slots.get(main_key) if slots else None
    # tasks of this asset (the ledger, by name)
    led = D.by_name.get(name, [])
    roles = {}
    mid, how = (model_from_entry(D, name, main['entry']) if main else (None, 'none'))
    if how == 'proc' and main and main.get('replaced_slot'):
        mid, _ = model_from_entry(D, name, main['replaced_slot']['entry'])       # the texture source of a procedural kit
        if mid in replaced_ids:
            replaced_ids.discard(mid)
    is_char = (pa or {}).get('method') == 'CHAR' or any(r['kind'] == 'rig' for r in led)
    A['method'] = ('CHAR' if is_char else 'REUSE' if how in ('pilot', 'owner') else 'PROC' if how == 'proc' else
                   {'refine': 'T3D', 'i3d': 'IMG', 'mi3d': 'MI3D'}.get(D.kind(mid), (pa or {}).get('method')))
    if (pa or {}).get('method') == 'REUSE':
        A['method'] = 'REUSE'
    # pass
    if main:
        tag = (D.led.get(mid) or {}).get('tag', '')
        if main['pass'] == 2:
            A['pass'] = '2' if (str(tag).startswith('p2') or how == 'proc' or not planned) else '1+2'
        else:
            A['pass'] = '1'
    if not planned:
        A['pass'] = '2'
    if is_char and A['pass'] == '1' and any(str(r['tag']).startswith('p2') for r in led if r['kind'] in ('anim', 'rig')):
        A['pass'] = '1+2'                                           # a pass-1 character with pass-2 animation packs
    # final + source
    src = source_of(D, name, mid) if mid else None
    if mid:
        roles[mid] = 'final'
    if src:
        roles.setdefault(src, 'source')
    # variants: other slots, then other outputs of lib/<asset>/final.json
    variants = []
    for k, s in slots.items():
        if s is main:
            continue
        vid, vhow = model_from_entry(D, name, s['entry'])
        variants.append({'key': k or 'a', 'id': vid, 'glb': absm(s['entry'].get('glb')), 'verdict': s.get('verdict'),
                         'sprites': [x for x in s['entry'].get('sprites', []) if '/' not in x], 'pass': s['pass']})
        if vid:
            roles.setdefault(vid, 'variant')
    slot_ids = {model_from_entry(D, name, s['entry'])[0] for s in slots.values()} | {mid}
    now_ids = final_outputs(name)
    hist_ids = (set(final_outputs(name, 'final*.json')) - set(now_ids)) | replaced_ids
    rigs = [r for r in led if r['kind'] == 'rig']
    rigged_models = {r['body'].get('input_task_id') for r in rigs}
    p2_main = any(s.get('pass') == 2 and s is slots.get('') for s in slots.values())      # a kept pass-2 entry took the main slot
    extra, unrigged = [], []
    for o in now_ids:
        if o in slot_ids or o in replaced_ids:
            continue
        if is_char and o not in rigged_models:
            unrigged.append(o)
        elif p2_main and not str(D.led.get(o, {}).get('tag', '')).startswith('p2') and not is_char:
            hist_ids.add(o)                                         # the pass-1 pick a kept pass-2 re-roll replaced
        else:
            extra.append(o)
    main_glb = absm(main['entry'].get('glb')) if main else None
    if main_glb and not re.search(r'/groups/[^/]+/models/|/groups/p2new/kit/', main_glb) and not main_glb.startswith(LEVEL):
        for sp in (main['entry'].get('sprites') or []):              # a kit-only GLB: use the GLB the sprite was rendered from
            k = D.find_sprite(sp, [group])
            mm = str(D.atlas[k]['sprites'][sp].get('model', '')).split('+')[0] if k else ''
            cand = os.path.join(GROUPS, k, 'models', mm + '.glb') if k and mm else ''
            if cand and os.path.exists(cand):
                A['kit_glb'] = main_glb
                main_glb = cand
                break
    # pass-1 sprites under a pass-2 / procedural replacement: the GLB the shipped sprites were rendered from is the replaced slot's
    sprite_glb, sprite_tid = None, None
    if main and main.get('pass') == 2 and main.get('replaced_slot') and main_glb and not is_char:
        og = absm(main['replaced_slot']['entry'].get('glb') or '')
        if og and os.path.exists(og) and og in sprite_model_glbs(D, main['entry'].get('sprites'), group) and \
                not same_bytes(og, main_glb):
            sprite_glb = og
            sprite_tid = model_from_entry(D, name, main['replaced_slot']['entry'])[0]
            if sprite_tid in replaced_ids:
                replaced_ids.discard(sprite_tid)
            if sprite_tid and sprite_tid != mid:
                roles[sprite_tid] = 'sprite_source'
                s0 = source_of(D, name, sprite_tid)
                if s0:
                    roles.setdefault(s0, 'sprite_source_concept')
    A['_sprite_glb'] = sprite_glb
    A['_sprite_tid'] = sprite_tid
    siblings = []
    if main_glb and not is_char and os.path.dirname(main_glb).startswith(GROUPS):
        stem = os.path.splitext(os.path.basename(main_glb))[0]
        prefix = stem.rsplit('_', 1)[0] if '_' in stem else stem
        used = {os.path.splitext(os.path.basename(v['glb'] or ''))[0] for v in variants} | {stem}
        for f in sorted(glob.glob(os.path.join(os.path.dirname(main_glb), prefix + '_*.glb'))):
            st = os.path.splitext(os.path.basename(f))[0]
            if st not in used and st.rsplit('_', 1)[0] == prefix and not re.search(r'_r\d+$', st):
                siblings.append(f)
    char_alts = []
    if is_char and main:
        char_alts = [os.path.splitext(os.path.basename(x))[0] for x in main['entry'].get('sprites', []) if x.endswith('.json')
                     and os.path.splitext(os.path.basename(x))[0] != name]
    kinds_seen = defaultdict(int)
    for i, oid in enumerate(extra):
        if is_char:
            alt = char_alts[0] if len(char_alts) == 1 else None
            variants.append({'key': (alt or oid[:8]).replace(name + '_', ''), 'id': oid, 'glb': None,
                             'verdict': None, 'sprites': [], 'char_atlas': alt, 'pass': 1})
            roles.setdefault(oid, 'variant')
            continue
        gl = siblings[i] if len(siblings) == len(extra) else None
        if gl:
            key = os.path.splitext(os.path.basename(gl))[0][len(prefix) + 1:]
        else:
            kinds_seen[D.kind(oid)] += 1
            key = 'alt-%s%s' % (D.kind(oid), '' if kinds_seen[D.kind(oid)] == 1 else kinds_seen[D.kind(oid)])
        sp = []
        if gl:
            st = os.path.splitext(os.path.basename(gl))[0]
            for k in D.atlas:
                sp += [n for n, j in D.atlas[k]['sprites'].items() if str(j.get('model', '')).split('+')[0] == st]
        variants.append({'key': key, 'id': oid, 'glb': gl, 'verdict': None, 'sprites': sp, 'pass': 1})
        roles.setdefault(oid, 'variant')
    for oid in unrigged:
        roles.setdefault(oid, 'candidate')
    for v in variants:
        if v['id']:
            s = source_of(D, name, v['id'])
            if s:
                roles.setdefault(s, 'variant_source')
    replaced = []
    for oid in sorted(hist_ids - set(roles), key=lambda t: (D.led.get(t, {}).get('t', 0), t)):
        if D.kind(oid) not in MODEL_KINDS:
            continue
        roles[oid] = 'replaced'
        s = source_of(D, name, oid)
        if s:
            roles.setdefault(s, 'replaced_source')
        pv, job = None, None
        for k, sl in slots.items():
            if sl.get('pass') == 2 and sl.get('p1verdict'):
                pv = sl['p1verdict']; job = (sl.get('verdict') or [None])[0]
        if pv is None and p2 and D.led.get(oid, {}).get('tag', '').startswith('g'):
            job = (D.v2.get(name) or [None])[0]
        rr = (pv[1].get('reroll') or '') if pv else ''
        if re.match(r'(?i)\s*(none|not needed|no reroll)', rr):
            rr = ''
        why = first_sentence(rr) if rr else (first_sentence(pv[1].get('fix', '')) if pv and pv[1].get('verdict') != 'ok' else '')
        if job:
            why = ('replaced by the pass-2 re-roll (%s)' % job) + ('; pass-1 judge: ' + why if why else '')
        replaced.append({'id': oid, 'kind': D.kind(oid), 'tag': D.led.get(oid, {}).get('tag'),
                         'pass1_judge': pv[1].get('score') if pv else None, 'why': why or 're-rolled in the pass-1 fix round'})
    for t in (main['entry'].get('task_ids', []) if main and main.get('pass') == 2 else []):
        if t not in roles and planned and not is_char and D.kind(t) in ('t2i', 't3d', 'refine', 'i3d', 'mi3d') and \
                str(D.led.get(t, {}).get('tag', '')).startswith('p2'):
            roles[t] = 'rejected'                                    # a pass-2 try of the kept job that was not used
    for rj in rejected:
        for t in rj['entry'].get('task_ids', []):
            if t not in roles and D.led.get(t, {}).get('tag', '').startswith('p2'):
                roles[t] = 'rejected'
    for r in rigs:
        roles.setdefault(r['id'], 'rig')
    for r in led:
        if r['kind'] == 'anim':
            roles.setdefault(r['id'], 'anim')
    for r in led:
        roles.setdefault(r['id'], 'candidate')
    if mid and how == 'pilot':
        p = D.pilot[name]
        roles.setdefault(p['preview'], 'source')
    A['_roles'] = roles
    # status and judge
    v = main.get('verdict') if main else None
    if v is None and main and main.get('p1verdict'):
        v = main['p1verdict']
    vd = v[1] if v else {}
    sprites = []
    for s in (slots.values() if slots else []):
        for x in s['entry'].get('sprites', []):
            if x not in sprites:
                sprites.append(x)
    if (pa or {}).get('method') == 'REUSE':
        status = 'dropped' if (not [x for x in sprites] and (vd.get('score') or 10) < 6) else 'reuse'
    elif not main:
        status = 'not generated'
    else:
        status = {'ok': 'ok', 'fix': 'fix', 'reroll': 'fix', 'drop': 'dropped'}.get(vd.get('verdict'), 'fix')
    A['status'] = status
    A['judge'] = OrderedDict([('score', vd.get('score')), ('verdict', vd.get('verdict')), ('job', v[0] if v else None),
                              ('group_score', (D.V.get(v[0], {}) if v else {}).get('score')),
                              ('group_first_round', (D.V.get(v[0], {}) if v else {}).get('first')),
                              ('notes', vd.get('fix', '')), ('reroll', vd.get('reroll', ''))])
    hist = []
    if main and main.get('pass') == 2 and main.get('p1verdict') and main['p1verdict'][1] is not vd:
        pv = main['p1verdict'][1]
        hist.append(OrderedDict([('pass', 1), ('job', main['p1verdict'][0]), ('score', pv.get('score')), ('verdict', pv.get('verdict')),
                                 ('reroll', pv.get('reroll', ''))]))
    for rj in rejected:
        vv = rj['verdict'][1] if rj['verdict'] else {}
        hist.append(OrderedDict([('pass', 2), ('job', rj['verdict'][0] if rj['verdict'] else None), ('score', vv.get('score')),
                                 ('verdict', vv.get('verdict')), ('notes', first_sentence(vv.get('fix', ''), 400)),
                                 ('attempt_tasks', rj['entry'].get('task_ids', []))]))
    A['judge_history'] = hist
    # plan facts
    A['layer'] = (pa or {}).get('layer')
    A['size_m'] = (pa or {}).get('size_m')
    A['height_m'] = (pa or {}).get('height_m')
    A['view'] = (pa or {}).get('view')
    A['plan_inventory'] = (pa or {}).get('inv')
    A['plan_title'] = gtitle
    # files
    A['_main'] = main
    A['_mid'] = mid
    A['_how'] = how
    A['_src'] = src
    A['_variants'] = variants
    A['_replaced'] = replaced
    A['_rejected'] = rejected
    A['_sprites'] = sprites
    A['_char'] = is_char
    A['_char_atlases'] = ([name] if is_char and os.path.exists(os.path.join(GROUPS, 'g8', 'out', name + '.json')) else []) + \
        [c for c in char_alts if os.path.exists(os.path.join(GROUPS, 'g8', 'out', c + '.json'))]
    A['_glb'] = main_glb
    A['_plan'] = pa
    A['_pl'] = pl
    A['notes'] = (main['entry'].get('notes') if main else '') or ''
    A['credits'] = sum(r['credits'] for r in led)
    bk = defaultdict(int)
    bt = defaultdict(int)
    for r in led:
        bk[r['kind']] += r['credits']; bt[r['tag']] += r['credits']
    A['credits_by_kind'] = OrderedDict((k, bk[k]) for k in KIND_ORDER if bk.get(k))
    A['credits_by_tag'] = OrderedDict(sorted(bt.items()))
    if how == 'pilot' or (name in D.pilot and A['method'] == 'REUSE'):
        A['pilot_credits'] = D.pilot.get(name, {}).get('credits')
    return A


# ---------------------------------------------------------------------------------------------------------------------------- characters
def char_info(D, A):
    out = OrderedDict()
    led = D.by_name.get(A['name'], [])
    out['rigs'] = [task_rec(D, r['id'], 'rig') for r in led if r['kind'] == 'rig']
    anims = []
    for r in led:
        if r['kind'] != 'anim':
            continue
        rec = task_rec(D, r['id'], 'anim')
        t = D.task.get(r['id'])
        gl = os.path.join(t['dir'], 'animation.glb') if t and t.get('dir') else None
        if gl and os.path.exists(gl):
            gi = glb_info(gl)
            rec['clips_in_glb'] = [re.sub(r'^Armature\|', '', n).replace('|baselayer', '') for n in (gi or {}).get('animations', [])]
        anims.append(rec)
    out['animations'] = anims
    atl = []
    for c in A['_char_atlases']:
        j = load(os.path.join(GROUPS, 'g8', 'out', c + '.json'), {})
        clips = []
        for k, a in (j.get('anims') or {}).items():
            ce = OrderedDict([('name', k), ('frames', len(a.get('frames', []))), ('fps', a.get('fps')), ('loop', a.get('loop')),
                              ('source_clip', (a.get('src') or {}).get('clip'))])
            for x in ('pack', 'needs', 'note', 'lane', 'role'):
                if x in a:
                    ce[x] = a[x]
            clips.append(ce)
        atl.append(OrderedDict([('atlas', c), ('px', j.get('px')), ('pxPerM', j.get('pxPerM')), ('yaw', j.get('yaw')),
                                ('clips', clips), ('left_clips', len((j.get('left') or {}).get('anims', {}))),
                                ('excluded', j.get('excluded', {}))]))
    out['atlases'] = atl
    return out


def _norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def edits_of(D, name):
    """the manifest records of a character's edited GLBs, each with the atlas rows rendered from the edited clips."""
    rows_of = defaultdict(list)
    for c in [name]:
        j = load(os.path.join(GROUPS, 'g8', 'out', c + '.json'), {}) or {}
        for k, a in (j.get('anims') or {}).items():
            rows_of[_norm((a.get('src') or {}).get('clip'))].append(k)
    out = []
    for e in D.edits:
        if e['asset'] != name:
            continue
        clips = []
        for c in e['clips']:
            rows = rows_of.get(_norm(c['clip']), [])
            clips.append(OrderedDict([('clip', c['clip']), ('atlas_rows', rows), ('bones', [b.replace('.rotation', '') for b in c['channels']]),
                                      ('window_s', c['window_s']), ('max_change_deg', c['max_change_deg']), ('spec', c['spec'])]))
        out.append(OrderedDict([('file', os.path.basename(e['file'])), ('archive_path', '%s/%s/edited/%s' % ('g8', name, os.path.basename(e['file']))),
                                ('working_copy', clean(e['file'])), ('bytes', e['bytes']),
                                ('made_from', OrderedDict([('task', e['source_task']), ('kind', e['source_kind']), ('file', e['source_file'])])),
                                ('motion_edits', clips), ('texture_repainted', e['texture_repainted']), ('tools', e['tools'])]))
    return out


def archive_compact(A, path, prefix=''):
    """the archive branch path of a compact GLB that is not in this package."""
    return '%s/%s/compact/%s%s' % (A['group'], A['name'], prefix, os.path.basename(path))


def sprite_models_rec(D, A, repo_files):
    """which compact GLBs the asset's sprites were rendered from, and where each one is: a file of this package (its own, or another
    asset's identical model), or the archive branch's compact/ folder."""
    if A['_char'] or A['_how'] == 'owner':
        return []
    out = []
    shipped = getattr(D, 'shipped', {})
    for p, sps in sprite_model_glbs(D, A['_sprites'], A['group']).items():
        rf, note, extra = None, '', []
        if same_bytes(p, A['_glb']):
            rf = 'models/%s.glb' % A['name']
        elif p == A.get('_sprite_glb'):
            rf = 'models/%s__sprite.glb' % A['name']
            note = ('the pass-1 model the shipped sprites were rendered from; models/%s.glb is the pass-2 %s that replaced it for Unreal'
                    % (A['name'], 'procedural kit mesh' if A['_how'] == 'proc' else 'kit piece'))
        else:
            v = next((v for v in A['_variants'] if v.get('glb') and same_bytes(p, v['glb'])), None)
            other = next((r for src, r in sorted(shipped.items()) if same_bytes(p, src)), None)
            if v and v.get('repo_file'):
                rf = v['repo_file']
            elif other:
                rf = other; note = 'the same compact GLB as %s' % other
            else:
                af = archive_compact(A, p)
                extra.append(('archive_file', af))
                pm = os.path.join(GROUPS, 'p2new', 'models')
                kit = os.path.join(GROUPS, 'p2new', 'kit', os.path.basename(p))
                if v:
                    note = 'a variant GLB over the 80 MB size budget: not in this package, on the archive branch at %s' % af
                elif os.path.dirname(p) == pm and same_bytes(kit, A['_glb']):
                    note = ('the sprite-grade import (quantized) of the same Meshy model whose Unreal kit piece (float32, welded, re-charted '
                            'UVs) ships as models/%s.glb; this import is on the archive branch at %s' % (A['name'], af))
                elif os.path.dirname(p) == pm and os.path.exists(kit):
                    kf = archive_compact(A, kit, 'kit_')
                    extra += [('kit_glb', clean(kit)), ('kit_archive_file', kf)]
                    note = ('the sprite-grade import of a second model of this asset; it and its Unreal kit piece are on the archive branch '
                            '(%s, %s)' % (af, kf))
                elif os.path.dirname(p) == pm:
                    note = ('a sprite-grade part model, welded with the others into the kit piece models/%s.glb; on the archive branch at %s'
                            % (A['name'], af))
                else:
                    note = 'a helper model of the sprite recipe; on the archive branch at %s' % af
        out.append(OrderedDict([('model', os.path.splitext(os.path.basename(p))[0]), ('sprites', sps), ('compact_glb', clean(p)),
                                ('repo_file', rf)] + extra + ([('note', note)] if note else [])))
    return out


# ---------------------------------------------------------------------------------------------------------------------------- manifest
def manifest_asset(D, A, repo_files):
    roles = A['_roles']
    m = OrderedDict()
    for k in ('name', 'group', 'pass', 'method', 'layer', 'size_m', 'height_m', 'status'):
        m[k] = A[k]
    m['name_pl'] = A['_pl'].get('pl')
    gi = glb_info(A['_glb']) if A['_glb'] and os.path.exists(A['_glb']) else None
    if gi:
        m['model_bbox_m'] = gi['size_m']; m['model_triangles'] = gi['tris']
        m['model_quantized'] = 'KHR_mesh_quantization' in gi['extensions']
    j = OrderedDict(A['judge'])
    m['judge'] = j
    if A['judge_history']:
        m['judge_history'] = A['judge_history']
    if D.reviews.get(A['name']):
        j['later_rounds'] = D.reviews[A['name']]
    t = OrderedDict()
    t['final_model'] = task_rec(D, A['_mid'], 'final') if A['_mid'] else None
    t['concept_or_preview'] = task_rec(D, A['_src'], 'source') if A['_src'] else None
    if A.get('_sprite_tid') and A['_sprite_tid'] != A['_mid']:
        t['sprite_model'] = task_rec(D, A['_sprite_tid'], 'sprite_source')
        s0 = source_of(D, A['name'], A['_sprite_tid'])
        if s0:
            t['sprite_model']['concept_or_preview'] = task_rec(D, s0, 'sprite_source_concept')
    t['variants'] = []
    for v in A['_variants']:
        vr = OrderedDict([('key', v['key']), ('task', task_rec(D, v['id'], 'variant') if v['id'] else None)])
        s = source_of(D, A['name'], v['id']) if v['id'] else None
        if s:
            vr['concept_or_preview'] = task_rec(D, s, 'variant_source')
        if v.get('verdict'):
            vr['judge'] = OrderedDict([('score', v['verdict'][1].get('score')), ('verdict', v['verdict'][1].get('verdict')),
                                       ('job', v['verdict'][0])])
        if v.get('char_atlas'):
            vr['character_atlas'] = 'characters/%s.json' % v['char_atlas']
        vr['sprites'] = v['sprites']
        vr['repo_file'] = v.get('repo_file')
        vr['compact_glb'] = clean(v['glb']) if v.get('glb') else None
        if v.get('glb') and not v.get('repo_file'):
            vr['archive_file'] = archive_compact(A, v['glb'])
        if vr.get('task') and vr['task'].get('local_copy') and os.path.exists(os.path.join(D.task[v['id']]['dir'], 'model.glb')):
            vr['full_res_archive_file'] = '%s/%s/%s__%s.glb' % (A['group'], A['name'], A['name'], v['key'])
        t['variants'].append(vr)
    t['replaced'] = [OrderedDict([('task', task_rec(D, r['id'], 'replaced')), ('pass1_judge', r['pass1_judge']), ('why', r['why'])])
                     for r in A['_replaced']]
    t['rejected_pass2_attempt'] = [task_rec(D, i, 'rejected') for i, ro in roles.items() if ro == 'rejected']
    t['candidates'] = [task_rec(D, i, ro) for i, ro in roles.items() if ro in ('candidate', 'variant_source', 'replaced_source')
                       and i != A['_src']]
    m['sprite_models'] = sprite_models_rec(D, A, repo_files)
    if A['_char']:
        ci = char_info(D, A)
        t['rig'] = ci['rigs']
        t['animations'] = ci['animations']
        m['character'] = OrderedDict([('atlases', ci['atlases']),
                                      ('rigged_model', 'no compact rigged GLB: the rig task\'s rigged GLB / FBX + walking / running and '
                                       'every animation pack are on the archive branch %s (%s/%s/) and can be re-fetched by task id'
                                       % (ARCHIVE_BRANCH, A['group'], A['name']))])
        ed = edits_of(D, A['name'])
        if ed:
            m['character']['edited_glbs'] = ed
            m['character']['edited_glbs_note'] = (
                'The atlases were rendered from these edited copies, not from the Meshy files: the Meshy animation packs and FBX files '
                'listed under tasks are unedited, so importing them brings back what the edits removed (an empty arm thrust forward or '
                'raised). For Unreal use the edited GLB (same rig and clip names), or apply the same spec with tools/edits/armfix.py.')
    m['tasks'] = t
    pa = A['_plan'] or {}
    pr = OrderedDict()
    fin = t['final_model'] or {}
    src = t['concept_or_preview'] or {}
    pr['model'] = src.get('prompt') or fin.get('prompt')
    pr['texture'] = fin.get('texture_prompt') or src.get('texture_prompt')
    if A['_how'] == 'pilot':
        pr['model'] = D.pilot[A['name']]['prompt']
    pr['plan'] = pa.get('prompts', [])
    pr['plan_concept'] = pa.get('concept_prompts', [])
    m['prompts'] = pr
    m['credits'] = A['credits']
    m['credits_by_kind'] = A['credits_by_kind']
    m['credits_by_tag'] = A['credits_by_tag']
    if A.get('pilot_credits'):
        m['pilot_credits_before_ledger'] = A['pilot_credits']
    m['sprites'] = [s for s in A['_sprites'] if '/' not in s]
    m['repo_files'] = repo_files
    if A['_how'] == 'owner':
        m['repo_files_elsewhere'] = [os.path.relpath(A['_glb'], REPO), 'level/sprites/models.png', 'level/sprites/models.json']
    if A.get('kit_glb'):
        m['kit_glb_not_in_repo'] = clean(A['kit_glb'])
    notes = A['notes']
    if A['_how'] == 'owner':
        notes = ('The owner\'s own model, already in the repository at %s; reused as it is. ' % os.path.relpath(A['_glb'], REPO)) + notes
    if A['_how'] == 'pilot':
        notes = 'Pilot model (generated before the ledger, gen/dl), %s ' % (
            'dropped by the judge, not shipped.' if A['status'] == 'dropped' else 'reused.') + notes
    if A['_how'] == 'proc':
        notes = 'Procedural kit mesh; the Meshy task listed as final_model is its texture source. ' + notes
    m['notes'] = notes
    return clean(m)


# ---------------------------------------------------------------------------------------------------------------------------- repo
def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)


def dir_size(d):
    tot = 0
    for root, _, files in os.walk(d):
        for f in files:
            tot += os.path.getsize(os.path.join(root, f))
    return tot


def write_repo(D, assets, out):
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    files_of = defaultdict(list)
    # sprites (atlases as rendered) and character atlases
    for g in D.gdirs:
        copy(D.atlas[g]['png'], os.path.join(out, 'sprites', g + '.png'))
        copy(D.atlas[g]['json'], os.path.join(out, 'sprites', g + '.json'))
    atlas_of_sprite = {}
    for g in D.gdirs:
        for s in D.atlas[g]['sprites']:
            atlas_of_sprite.setdefault(s, g)
    for A in assets:
        for c in A['_char_atlases']:
            for ext in ('.png', '.json'):
                copy(os.path.join(GROUPS, 'g8', 'out', c + ext), os.path.join(out, 'characters', c + ext))
                files_of[A['name']].append('characters/' + c + ext)
        used = sorted({atlas_of_sprite[s] for s in A['_sprites'] if s in atlas_of_sprite})
        for g in used:
            files_of[A['name']] += ['sprites/%s.png' % g, 'sprites/%s.json' % g]
    # models: the final pick per asset
    for A in assets:
        if A['status'] in ('dropped', 'excluded', 'not generated') or not A['_glb'] or not os.path.exists(A['_glb']):
            continue
        if A['_how'] == 'owner':
            continue                                               # already in the repo (level/models)
        if A['_char']:
            continue                                               # no compact rigged GLB exists: download via task id
        dst = os.path.join(out, 'models', A['name'] + '.glb')
        copy(A['_glb'], dst)
        files_of[A['name']].insert(0, 'models/%s.glb' % A['name'])
        if A.get('_sprite_glb'):                                   # pass-1 sprites under a pass-2 kit: their own GLB ships too
            copy(A['_sprite_glb'], os.path.join(out, 'models', A['name'] + '__sprite.glb'))
            files_of[A['name']].insert(1, 'models/%s__sprite.glb' % A['name'])
    # tools
    tdir = os.path.join(out, 'tools')
    copy(os.path.join(M, 'mk.py'), os.path.join(tdir, 'mk.py'))
    for f in sorted(glob.glob(os.path.join(M, 'bin', '*.py'))) + [os.path.join(M, 'bin', 'setup_group.sh'),
                                                                   os.path.join(M, 'bin', 'assemble_pl.json'),
                                                                   os.path.join(M, 'bin', 'pilot_recipe_example.json')]:
        if os.path.exists(f):
            copy(f, os.path.join(tdir, 'bin', os.path.basename(f)))
    copy(os.path.join(M, 'pilot', 'ms_pilot.mjs'), os.path.join(tdir, 'ms_pilot.mjs'))
    # the sprite side's GLB edits: armfix.py + its specs (motion), texpaint.py / glbtex.py + the courier's spec (texture)
    efiles = list(D.edit_specs)
    for rel in ('p2e/fix/armfix.py', 'p2e/fix/texpaint.py', 'p2e/fix/glbmesh.py', 'p2e/fix/tp_courier.json', 'p2f/tools/glbtex.py'):
        efiles.append(os.path.join(GROUPS, 'g8', rel))
    seen = set()
    for f in efiles:
        bn = os.path.basename(f)
        if os.path.exists(f) and bn not in seen:
            seen.add(bn)
            copy(f, os.path.join(tdir, 'edits', bn))
    with open(os.path.join(tdir, '.gitignore'), 'w') as f:
        f.write('# mk.py reads the Meshy API key from tools/.key and writes the auth header to tools/.auth_header: never commit them.\n'
                '.key\n.auth_header\n# mk.py creates its ledger and downloads under tools/lib/\nlib/\n__pycache__/\n')
    # variants: their compact GLBs while the package stays under the size budget (best judged first)
    base = dir_size(out) + 400 * 1000                              # + manifest and README
    vlist = []
    for A in assets:
        if A['status'] in ('dropped', 'excluded'):
            continue
        for v in A['_variants']:
            if v.get('glb') and os.path.exists(v['glb']) and absm(v['glb']) != A['_glb']:
                sc = v['verdict'][1].get('score') if v.get('verdict') else 0
                vlist.append((-(sc or 0), 0 if v.get('sprites') else 1, os.path.getsize(v['glb']), A['name'], v))
    vlist.sort(key=lambda x: (x[0], x[1], x[2], x[3], x[4]['key']))
    for _, _, size, an, v in vlist:
        if base + size > SIZE_BUDGET - 1000 * 1000:
            v['repo_file'] = None
            continue
        rf = 'models/%s__%s.glb' % (an, v['key'])
        copy(v['glb'], os.path.join(out, rf))
        v['repo_file'] = rf
        files_of[an].append(rf)
        base += size
    D.shipped = OrderedDict()                                      # compact source GLB -> its file in this package
    for A in assets:
        for rf in files_of.get(A['name'], []):
            if rf.startswith('models/'):
                srcp = (A['_glb'] if rf == 'models/%s.glb' % A['name'] else A.get('_sprite_glb') if rf.endswith('__sprite.glb') else
                        next((v['glb'] for v in A['_variants'] if v.get('repo_file') == rf), None))
                if srcp:
                    D.shipped[srcp] = rf
    man = manifest(D, assets, files_of)
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
        f.write('\n')
    with open(os.path.join(out, 'README.md'), 'w') as f:
        f.write(readme(D, assets, man, out))
    return man


def manifest(D, assets, files_of):
    man = OrderedDict()
    man['library'] = 'Grube Kattowitz III - Meshy asset library'
    man['scale'] = OrderedDict([('px_per_m', 52.5), ('hero_px', 96), ('hero_m', 1.85), ('unreal', '1 m = 100 uu; origins at the base')])
    man['assets'] = [manifest_asset(D, A, files_of.get(A['name'], [])) for A in assets]
    tot = man['totals'] = OrderedDict()
    tot['credits'] = sum(r['credits'] for r in D.ledger)
    tot['tasks'] = len(D.ledger)
    tot['pending_tasks'] = sum(1 for r in D.ledger if r['status'] == 'PENDING')
    bk, bt, bg = defaultdict(int), defaultdict(int), defaultdict(int)
    for r in D.ledger:
        bk[r['kind']] += r['credits']; bt[r['tag']] += r['credits']
    for A in assets:
        bg[A['group']] += A['credits']
    tot['by_kind'] = OrderedDict((k, bk[k]) for k in KIND_ORDER if k in bk)
    tot['by_tag'] = OrderedDict(sorted(bt.items(), key=lambda kv: (not kv[0].startswith('g'), kv[0])))
    tot['by_group'] = OrderedDict((g, bg[g]) for g in sorted(bg, key=lambda g: (g == 'p2new', g)))
    tot['pilot_before_ledger'] = sum(p['credits'] for p in D.pilot.values())
    st = defaultdict(int)
    for A in assets:
        st[A['status']] += 1
    tot['assets'] = len(assets)
    tot['by_status'] = OrderedDict(sorted(st.items()))
    chars = [A for A in assets if A['_char']]
    tot['characters'] = len(chars)
    tot['character_clips'] = sum(len((load(os.path.join(GROUPS, 'g8', 'out', A['name'] + '.json'), {}) or {}).get('anims', {}))
                                 for A in chars if A['_char_atlases'])
    tot['character_clips_all_atlases'] = sum(len((load(os.path.join(GROUPS, 'g8', 'out', c + '.json'), {}) or {}).get('anims', {}))
                                             for A in chars for c in A['_char_atlases'])
    tot['edited_glbs'] = len(D.edits)
    tot['edited_clips'] = sum(len(e['clips']) for e in D.edits)
    tot['animation_tasks'] = sum(1 for r in D.ledger if r['kind'] == 'anim')
    tot['animation_actions'] = sum(len(task_rec(D, r['id']).get('actions', [])) for r in D.ledger if r['kind'] == 'anim')
    # excluded ledger entries (tests) and plan items that were not generated
    named = {A['name'] for A in assets}
    man['excluded'] = [OrderedDict([('name', n), ('status', 'excluded'), ('tag', rs[0]['tag']), ('credits', sum(r['credits'] for r in rs)),
                                    ('tasks', [r['id'] for r in rs]), ('why', 'API smoke test before the library run')])
                       for n, rs in sorted(D.by_name.items()) if n not in named]
    ng = []
    for g in D.plan['groups']:
        for a in g['assets']:
            if not D.by_name.get(a['name']):
                A = next((x for x in assets if x['name'] == a['name']), None)
                src = 'the owner\'s model (level/models)' if A and A['_how'] == 'owner' else 'the pilot model (gen/dl)'
                if a['method'] != 'REUSE':
                    why = 'no Meshy task'
                elif A and A['status'] == 'dropped':
                    why = 'planned as a reuse of %s, then dropped by the judge (not shipped)' % src
                else:
                    why = 'reused: ' + src
                ng.append(OrderedDict([('name', a['name']), ('group', g['key']), ('method', a['method']),
                                       ('status', A['status'] if A else None), ('why', why)]))
    man['plan_items_not_generated'] = ng
    man['archive_branch'] = OrderedDict([
        ('branch', ARCHIVE_BRANCH), ('remote', 'origin'),
        ('holds', 'the full-resolution Meshy output of every asset\'s final model and of every variant (GLB, texture inside), each '
                  'character\'s rigs (rigged model, walk / run) and animation packs (GLB + FBX), the pilot model of the dropped '
                  'ropeway_bucket, the edited animation GLBs the character atlases were rendered from (g8/<character>/edited/) and the '
                  'compact sprite-source GLBs that are not in this package (<group>/<asset>/compact/, as each archive_file says); '
                  'no concepts, previews or other candidates'),
        ('fetch', 'git fetch origin %s && git worktree add ../meshy-full %s' % (ARCHIVE_BRANCH, ARCHIVE_BRANCH))])
    used = set()
    for g in D.plan['groups']:
        for a in g['assets']:
            used |= {int(x) for x in re.findall(r'#(\d+)', a.get('inv', ''))}
    man['inventory_items_not_planned_for_meshy'] = [OrderedDict([('n', i), ('name', it['name']), ('category', it.get('category')),
                                                                 ('layer', it.get('layer'))])
                                                    for i, it in enumerate(D.inventory, 1) if i not in used]
    return clean(man)


def fmt_cr(x):
    return '{:,}'.format(int(x)).replace(',', ' ')


def edit_section(D, assets, man, w):
    """README: the edited animation GLBs behind the character atlases, and the clips cut in the atlas instead."""
    recs = [(ma['name'], e) for ma in man['assets'] for e in ((ma.get('character') or {}).get('edited_glbs') or [])]
    if not recs:
        return
    w('## Edited animations: the atlases do not match the raw Meshy packs\n')
    w('Some character clips were rendered from edited copies of Meshy\'s animation GLBs. An edit keeps Meshy\'s rig, mesh and clip names '
      'and changes only what is listed below. **The Meshy animation packs, rigs and FBX files in the manifest (`tasks.animations`, '
      '`tasks.rig`) are unedited.** Imported into Unreal as they are, these clips bring back what the edits removed: an empty arm '
      'thrust forward, or raised with an open hand at head height (the salute-like silhouette the atlases avoid). For these clips import '
      'the edited GLB from the archive branch (`g8/<character>/edited/<file>`), or re-apply the spec to the Meshy GLB with '
      '`python3 tools/edits/armfix.py <animation.glb> <out.glb> tools/edits/<spec>.json`. The edited GLBs are about %d MB in all, too '
      'big for this package. `character.edited_glbs` in the manifest has the same data.\n' % round(sum(e['bytes'] for _, e in recs) / 1e6))
    w('Motion edits (`armfix.py`): within the window, the listed bones\' rotation keys are slerped toward a calm pose of the same rig '
      '(an arm hanging along the body, or a lowered hold), with smoothstep ramps in and out. The window is the span of changed keys.\n')
    w('| Character | Edited GLB | Made from (Meshy task, file) | Clip -> atlas rows | Bones | Window (s) | Max change | Spec |')
    w('|---|---|---|---|---|---|---|---|')
    for n, e in recs:
        for c in e['motion_edits']:
            w('| `%s` | `%s` | %s `%s`, `%s` | `%s` -> %s | %s | %g-%g | %g deg | %s |' % (
                n, e['file'], e['made_from']['kind'], e['made_from']['task'], e['made_from']['file'], c['clip'],
                ', '.join('`%s`' % r for r in c['atlas_rows']) or '-', ', '.join(c['bones']), c['window_s'][0], c['window_s'][1],
                c['max_change_deg'], ', '.join('`%s`' % os.path.basename(s) for s in c['spec'])))
    tex = [(n, e) for n, e in recs if e['texture_repainted']]
    if tex:
        w('')
        w('Texture edits: the embedded texture is repainted (`texpaint.py` with `tp_courier.json`: the courier\'s belt; `glbtex.py` puts the '
          'same texture into a later pack); mesh, rig and motion are unchanged:\n')
        w('| Character | Edited GLB | Made from (Meshy task, file) |')
        w('|---|---|---|')
        for n, e in tex:
            w('| `%s` | `%s` | %s `%s`, `%s` |' % (n, e['file'], e['made_from']['kind'], e['made_from']['task'], e['made_from']['file']))
    cuts = []
    for A in assets:
        for c in A['_char_atlases']:
            j = load(os.path.join(GROUPS, 'g8', 'out', c + '.json'), {}) or {}
            for k, a in (j.get('anims') or {}).items():
                cu = a.get('cut')
                if isinstance(cu, dict) and cu.get('why'):
                    cuts.append('`%s` `%s` (frames %d-%d of %d kept): %s' % (c, k, min(cu['kept']), max(cu['kept']), cu['of'], cu['why']))
    w('')
    w('Cut in the atlas instead of edited (the Meshy clip still holds the removed part): %s. Clips left out of an atlas altogether are '
      'listed under "What was rejected".\n' % ('; '.join(cuts) if cuts else 'none'))


def readme(D, assets, man, out):
    tot = man['totals']
    L = []
    w = L.append
    w('# Meshy asset library: Grube Kattowitz III\n')
    w('The 3D models, pixel sprites and characters generated with Meshy (the owner\'s Premium account) for the 1957 Upper Silesia level, '
      'in two passes: pass 1 generated %d planned assets in eight groups (and reused %d pilot and owner models), pass 2 re-rolled the '
      'weak ones and added %d new assets and more animation packs. Every asset was judged by an independent reviewer (scores 0-10; '
      'verdict `ok` ships as it is, `fix` ships with the judge\'s open notes, `drop` does not ship). Built by `tools/bin/assemble.py`; '
      '`manifest.json` holds every detail. The full-resolution Meshy files are on the archive branch `%s` (below).\n' % (
          sum(1 for g in D.plan['groups'] for a in g['assets'] if a['method'] != 'REUSE'),
          sum(1 for g in D.plan['groups'] for a in g['assets'] if a['method'] == 'REUSE'),
          sum(1 for A in assets if not A['_plan']), ARCHIVE_BRANCH))
    w('## What is here\n')
    w('| Path | What |')
    w('|---|---|')
    w('| `manifest.json` | One entry per asset: group, pass, method, layer, size, status, judge score and notes, every Meshy task id '
      '(final model, its concept or preview, variants, replaced and rejected tries, candidates, rig, animation packs with action ids and '
      'names), the prompts, the credits, the files here. Plus totals, excluded tests and the plan items that were not generated. |')
    sg = [A['name'] for A in assets if A.get('_sprite_glb') and A['status'] not in ('dropped', 'excluded')]
    w('| `models/<asset>.glb` | The asset\'s final compact GLB (a kept pass-2 re-roll wins over pass 1): the model its sprites were '
      'rendered from, except where pass 2 replaced the model for Unreal and kept the pass-1 sprites (%s; there the GLB is the pass-2 '
      'kit and `models/<asset>__sprite.glb` is the pass-1 GLB the sprites came from) and for the p2new assets (the GLB is the Unreal '
      'kit piece, float32 and welded, built from the same Meshy model as the sprite-grade import the sprites were rendered from). '
      '`sprite_models` in the manifest maps every sprite to its GLB. `models/<asset>__<variant>.glb`: a variant that also ships '
      'sprites, while the package stays under 80 MB. Characters have no file here (see Unreal notes). |' % ', '.join('`%s`' % n for n in sg))
    w('| `sprites/<group>.png` + `.json` | The sprite atlases exactly as the sprite tool wrote them (g1-g8, p2new). |')
    w('| `characters/<name>.png` + `.json` | The NPC atlases: every clip, right and left facing. |')
    w('| `tools/` | `mk.py` (the budget-guarded Meshy client), `bin/` (batch, sheet, palette, refetch, assemble and archive scripts, '
      '`setup_group.sh`), `ms_pilot.mjs` (the library variant of `level/tools/model_sprites.mjs`), `edits/` (the animation GLB edits '
      'behind the character atlases: `armfix.py` and its `af_*.json` specs, `texpaint.py` / `glbtex.py` and the courier\'s spec). |')
    w('')
    nmod = len(glob.glob(os.path.join(out, 'models', '*.glb')))
    w('Size: %.1f MB in %d files (%d GLBs). The full-resolution Meshy models are not here: they are on the archive branch (next '
      'section), and can be fetched again by task id while Meshy still holds them.\n'
      % (dir_size(out) / 1e6, sum(len(fs) for _, _, fs in os.walk(out)), nmod))
    ab = man['archive_branch']
    w('## The full-resolution archive branch\n')
    w('`origin/%s` (an orphan branch, about 1 GB, kept out of the main history) holds %s. Its `README.md` indexes every file with '
      'its Meshy task id. Fetch it on its own:\n' % (ARCHIVE_BRANCH, ab['holds']))
    w('```sh')
    w(ab['fetch'])
    w('```\n')
    w('Layout: `<group>/<asset>/<asset>.glb` (the final model), `<asset>__<variant>.glb` (a variant\'s model; manifest '
      '`tasks.variants[].full_res_archive_file`), `compact/` (the compact GLBs of `sprite_models[].archive_file` and '
      '`tasks.variants[].archive_file`), and for each character `<asset>_rigged_character.glb / .fbx`, `_walking`, `_running`, '
      '`_anim<n>.glb / .fbx` (the animation packs in the order of `tasks.animations`; a variant rig and its packs carry the variant key, '
      'e.g. `miner_hauer_c0_rigged_character.glb`) and `edited/` (see "Edited animations"). Scale: metres as Meshy exported them.\n')
    # status table
    w('## The assets\n')
    w('Status: **ok** ships; **fix** ships with the judge\'s open notes (paint / recipe changes, no credits); **reuse** is a pilot or '
      'owner model (shipped; its judge score and notes still apply); **dropped** is not shipped. Pass `1+2`: a pass-1 model with pass-2 animation packs.\n')
    by_group = OrderedDict()
    for A in assets:
        by_group.setdefault(A['group'], []).append(A)
    titles = {g['key']: g['title'] for g in D.plan['groups']}
    for g, As in by_group.items():
        w('### %s: %s\n' % (g, titles.get(g, 'Pass 2: new assets')))
        w('| Asset | Status | Judge | Pass | Method | Model | Credits |')
        w('|---|---|---|---|---|---|---|')
        for A in As:
            ma = next(x for x in man['assets'] if x['name'] == A['name'])
            mf = next((f for f in ma['repo_files'] if f.startswith('models/') and '__' not in f), None)
            if A['_how'] == 'owner':
                mf = os.path.relpath(A['_glb'], REPO)
            bbox = ma.get('model_bbox_m')
            if A['_char']:
                mf, bbox = None, None
                ri = (ma['tasks'].get('rig') or [{}])[0].get('id')
                mfs = 'rigged: rig task `%s`' % ri if ri else '-'
            w('| `%s` | %s | %s | %s | %s | %s | %s |' % (
                A['name'], A['status'], '' if A['judge']['score'] is None else '%g' % A['judge']['score'], A['pass'] or '',
                A['method'] or '', (('`%s`' % mf if mf else '-') if not A['_char'] else mfs) +
                (' (%s m)' % ' x '.join('%g' % x for x in bbox) if bbox else ''),
                A['credits'] or ('pilot %s' % A.get('pilot_credits') if A.get('pilot_credits') else 0)))
        w('')
    w('## The sprite atlas contract\n')
    w('Each `sprites/<group>.json` is `{ pxPerM, atlas, generator, sprites: { <name>: { x, y, w, h, ax, ay, top, scale, size, pxPerM, '
      'model, view, size_m, outline, layer, ... } } }`, written by the sprite tool (`level/tools/model_sprites.mjs`; the library copy is '
      '`tools/ms_pilot.mjs`), the same contract the level\'s own `level/sprites/models.json` follows:\n')
    w('- `x, y, w, h`: the sprite\'s rectangle in the PNG, its 1 px outline included. The PNG is transparent, alpha only 0 or 255, and every '
      'colour is a step of the level\'s palette ramps (`level/js/style.js` RAMP).')
    w('- `ax, ay`: the anchor, the ground contact. `ax` is the middle of the geometry (or the recipe\'s anchor point), `ay` the row it '
      'stands on (its lowest coloured row + 1; the outline row is drawn over the top row of the ground). Draw the sprite at '
      '`(x_world - ax, y_ground - ay)`. For a wheel the anchor is the axle.')
    w('- `scale`: the parallax layer factor the sprite was rendered for (playfield 1.0; mid 0.6-0.65, midfar 0.32-0.4, far 0.15, '
      'fg 1.35, sky 0.04). `pxPerM` = 52.5 x scale x size. The hero is 96 px = 1.85 m on the playfield, so 52.5 px per metre.')
    w('- `layer`: play / mover / mid / midfar / far / fg / sky. `outline`: `#0b080b` round movers (things you stand on), `sel` (the '
      'darkest step of the touching ramp) round scenery.')
    w('- Extras, when present: `deck {y, x0, x1}` (a mover\'s standing surface), `frames [...]` + `r` + `step` (a turning wheel), '
      '`sheaves [...]`, `feet [[x0, x1)]`, `lamp [x, y]`, `points {...}` and `marks {...}` (named pixels: beam origins, doors, ropes), '
      '`view {yaw, pitch, mirror}`, `size_m` (the rendered extent in metres), `model` (the compact GLB it was rendered from).')
    w('')
    w('Each `characters/<name>.json` follows `level/hero.json`: `{ px, pxPerM, yaw, pitch, anims: { <clip>: { fps, loop, frames: '
      '[{ x, y, w, h, ax, ay, sockets }], src, ... } }, left: { anims }, excluded }`. `anims` faces right, `left.anims` faces left; '
      '`(ax, ay)` is the ground contact; `sockets` are the back, head and hand points (x, y, depth) for props; `src` names the Meshy clip '
      'and the time range sampled; `excluded` lists clips left out on purpose, with the reason. Some clips carry `prop` (per-frame rifle, '
      'pistol or flashlight placement, sprites in `sprites/g8.json`), `needs` (a stool, a chair, low cover) or `note`.\n')
    w('## Fetching the full-resolution models from Meshy\n')
    w('The task ids are in `manifest.json` (`tasks.final_model.id`, `tasks.variants[].task.id`, `tasks.rig[]`, `tasks.animations[]`). '
      'A GET on the task returns fresh signed download URLs (they expire after about three days, so never store them):\n')
    w('```sh')
    w('export MESHY_API_KEY=...            # the owner\'s key; never commit it')
    w('API=https://api.meshy.ai/openapi')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v2/text-to-3d/<id>          # kind t3d / refine: model_urls.glb / .obj / .mtl, texture_urls[0].base_color, thumbnail_url')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/image-to-3d/<id>          # kind i3d: the same fields')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/multi-image-to-3d/<id>    # kind mi3d')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/text-to-image/<id>        # kind t2i: image_urls (the concepts)')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/rigging/<id>              # kind rig: result.rigged_character_glb_url / _fbx_url, result.basic_animations.walking_* / running_*')
    w('curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/animations/<id>           # kind anim: result.animation_glb_url / animation_fbx_url / processed_animation_fps_fbx_url (30 fps)')
    w('```\n')
    w('Or with the library\'s own client: put the key in `tools/.key` (one line, mode 0600; `tools/.gitignore` keeps it and '
      '`.auth_header` out of git) and run `python3 tools/mk.py wait <id> --kind <kind> --name <asset>`, which downloads the GLB, OBJ, MTL, '
      'texture and thumbnail (rig / animation: GLB + FBX) into `tools/lib/<asset>/<kind>-<id>/` (ignored by git). Models were requested '
      'as GLB + OBJ only, so model tasks have no FBX; the rig and animation tasks have GLB and FBX.\n')
    exp = defaultdict(list)
    for r in D.ledger:
        e = task_rec(D, r['id']).get('expires_at')
        if e:
            exp[r['kind']].append(e)
    if exp:
        nrig = sum(1 for r in D.ledger if r['kind'] == 'rig')
        nact = tot['animation_actions']
        allx = [e for v in exp.values() for e in v]
        w('**Most task results expire.** Every image-to-3D, multi-image-to-3D, text-to-image, rigging and animation task reports '
          '`expires_at` = 72 hours after it was made (%s); text-to-3D previews and refines report none. Meshy documents `expires_at` as '
          'the time the task result expires, so download those models, concepts, rigs and animation packs before then (the gallery links '
          'them all; `manifest.json` gives each task\'s `expires_at`). The text-to-3D models (method T3D) stay on the account and can be '
          'fetched by id later. The archive branch `%s` keeps every final and variant model, rig, walk / run and animation pack beyond '
          'those dates (not the concepts and the other candidates).\n' % (
              ', '.join('%s %s to %s' % (k, min(v), max(v)) for k, v in sorted(exp.items(), key=lambda kv: KIND_ORDER.index(kv[0]) if kv[0] in KIND_ORDER else 9)),
              ARCHIVE_BRANCH))
        w('If the rigs and packs are lost they can be rebuilt from the full-resolution GLB: the rigging API also takes a `model_url` '
          '(5 credits a rig; `height_meters` as in `tasks.rig[].height_meters`), then re-run the packs on the new rig (3 credits per action, '
          'ids and names in `tasks.animations[].actions`): about %d credits for all %d rigs and %d actions. The sprite atlases here do not '
          'depend on them.\n' % (nrig * 5 + nact * 3, nrig, nact))
    w('## Unreal import notes\n')
    w('- glTF is Y-up, metres; Unreal is Z-up, centimetres. The glTF / Interchange importer converts: 1 m = 100 uu. Import at scale 1.')
    offs = []
    for f in sorted(glob.glob(os.path.join(out, 'models', '*.glb'))):
        gi = glb_info(f)
        if not gi or not gi['size_m']:
            continue
        c = gi['centre_xz']
        why = []
        if abs(gi['min_y']) > 0.01:
            why.append('lowest point at y = %g m' % gi['min_y'])
        if abs(c[0]) > 0.05 or abs(c[1]) > 0.05:
            why.append('bounding box centred at x = %g, z = %g m' % (c[0], c[1]))
        if why:
            offs.append('`%s` (%s)' % (os.path.basename(f), ', '.join(why)))
    w('- The compact GLBs have their origin at the base: they stand on y = 0 (Unreal z = 0), centred in x and z, so they drop onto the '
      'floor. `model_bbox_m` in the manifest is the size in metres (x wide, y tall, z deep).' + (
          ' Exceptions, check them before placing (an origin at a mount point such as a hinge or a wall plate, or an off-centre part): %s.'
          % '; '.join(offs)
          if offs else ''))
    w('- Sizes are real-world metres: the hero is 1.85 m. In the web level 52.5 px = 1 m on the playfield, and a parallax layer\'s sprite '
      'is that times its `scale`; in Unreal place the same models at depth instead of scaling them.')
    w('- The compact GLBs use `KHR_mesh_quantization` (int16 positions under a node scale), except the p2new kit pieces (float32, welded, '
      're-charted UVs). If an importer rejects quantized meshes, dequantize first (glTF-Transform: `gltf-transform dequantize in.glb '
      'out.glb`) or import the full-resolution Meshy model by task id.')
    w('- Textures: each compact GLB carries one re-baked JPEG atlas at the texel size in `models.json` (sprite-grade). For close-ups use the '
      'Meshy 2k base-colour texture of the final task. Materials are unlit base colour only (no PBR maps were requested).')
    w('- Several kit models were stretched or cut at import to the plan\'s proportions (spreadX / spreadY, clip boxes); the full-resolution '
      'Meshy model is the raw, unstretched mesh. The judge\'s kit notes (`judge.notes`) say where a piece needs work before Unreal.')
    w('- Characters: Meshy rig, 24 joints, no fingers, height set at rigging (1.65-1.85 m). Use the rig task\'s FBX (or the animation '
      'packs\' 30 fps FBX) and retarget to your skeleton with the IK Retargeter. No compact rigged GLB exists, so the characters have '
      'no file under `models/`: the rigged models and packs are on the archive branch, and can be re-fetched by the rig and animation '
      'task ids in the manifest. Mind the edited clips (next section): for those, import the edited GLB, not the Meshy pack.')
    w('')
    edit_section(D, assets, man, w)
    w('## Credits\n')
    w('Total: **%s credits** in %d Meshy tasks (ledger `lib/ledger.jsonl`, actual consumed credits), plus %s credits of the pilot made '
      'before the ledger.\n' % (fmt_cr(tot['credits']), tot['tasks'], fmt_cr(tot['pilot_before_ledger'])))
    w('| Kind | Credits |')
    w('|---|---|')
    names = {'t2i': 'text-to-image concepts', 't3d': 'text-to-3D previews', 'refine': 'text-to-3D refine (texture)', 'i3d': 'image-to-3D',
             'mi3d': 'multi-image-to-3D', 'rig': 'rigging', 'anim': 'animation packs'}
    for k, v in tot['by_kind'].items():
        w('| %s | %s |' % (names.get(k, k), fmt_cr(v)))
    w('')
    w('| Group / job (ledger tag) | Credits |')
    w('|---|---|')
    for k, v in tot['by_tag'].items():
        w('| %s | %s |' % (k, fmt_cr(v)))
    w('')
    w('## What was rejected, and why\n')
    for A in assets:
        lines = []
        for r in A['_replaced']:
            lines.append('replaced `%s` %s (%s): %s' % (r['kind'], r['id'], 'pass-1 judge %g' % r['pass1_judge'] if r['pass1_judge']
                                                         is not None else 'pass 1', r['why']))
        for rj in A['_rejected']:
            vv = rj['verdict'][1] if rj['verdict'] else {}
            lines.append('pass-2 re-roll dropped (judge %s, %s): %s' % (vv.get('score'), rj['verdict'][0] if rj['verdict'] else '',
                                                                       first_sentences(rj['entry'].get('notes', ''))))
        rej = [(i, D.kind(i), D.led.get(i, {}).get('credits', 0)) for i, ro in A['_roles'].items() if ro == 'rejected']
        if rej and not A['_rejected']:
            lines.append('pass-2 tries not used: %s (%d credits)' % (', '.join('`%s` %s' % (k, i) for i, k, _ in rej), sum(c for _, _, c in rej)))
        if A['status'] == 'dropped':
            lines.append('not shipped: ' + first_sentence(A['judge'].get('notes', '')))
        for c in A['_char_atlases']:
            j = load(os.path.join(GROUPS, 'g8', 'out', c + '.json'), {}) or {}
            for k, why in (j.get('excluded') or {}).items():
                lines.append('clip `%s` left out of the `%s` atlas: %s' % (k, c, first_sentence(why, 300)))
        if lines:
            w('- `%s`: %s.' % (A['name'], '; '.join(l.rstrip('. ') for l in lines)))
    if man['excluded']:
        w('- Tests: %s (%s credits), API smoke tests before the library run.' % (', '.join('`%s`' % e['name'] for e in man['excluded']),
                                                                               sum(e['credits'] for e in man['excluded'])))
    w('')
    w('Candidates that were generated but not picked (other previews and concepts) are listed per asset under `tasks.candidates`, with '
      'their prompts. The judges\' full re-roll notes are in `judge.reroll` and `judge_history`.\n')
    w('## Not generated\n')
    ng = man['plan_items_not_generated']
    w('Plan items with no Meshy task: %s.\n' % ', '.join('`%s` (%s)' % (x['name'], x['why']) for x in ng) if ng else 'Every plan item was '
      'generated.\n')
    inv = man['inventory_items_not_planned_for_meshy']
    w('The level inventory has %d more items the plan kept procedural (tiles, fog, fx, UI and the like; listed in '
      '`inventory_items_not_planned_for_meshy`).\n' % len(inv))
    w('## Rebuilding\n')
    w('The scripts in `tools/` expect the library\'s working layout (`meshy/` with `lib/`, `groups/`, `plan/`); `bin/setup_group.sh` '
      'hard-codes that directory in `M=`, so edit it before use.\n')
    w('`tools/bin/assemble.py` rebuilt this directory and the private gallery from the working files (`meshy/` in the scratch area: '
      'plan, verdicts, ledger, lib, groups). It is deterministic and reads everything from disk; the Polish gallery texts are in '
      '`tools/bin/assemble_pl.json`. `tools/bin/archive_full.py <worktree> --push` syncs the archive branch from `manifest.json`. `tools/mk.py` is the only way the library touched the Meshy API: every create call is checked '
      'against a global cap (`lib/caps.json`) and a per-group cap under a file lock, and the ledger records the estimate and then the '
      'actual credits. The key lives in `.key` next to `mk.py` and is never printed.\n')
    return '\n'.join(L)


# ---------------------------------------------------------------------------------------------------------------------------- gallery
PL_MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada',
             'grudnia']
E = html.escape


def pl_date(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    return '%d %s %d, %02d:%02d UTC' % (d.day, PL_MONTHS[d.month - 1], d.year, d.hour, d.minute)


def pl_num(x, dec=1):
    if x is None:
        return '–'
    if float(x).is_integer():
        return '{:,}'.format(int(x)).replace(',', ' ')
    return ('%.*f' % (dec, x)).replace('.', ',')


def url_expiry(u):
    try:
        q = urllib.parse.parse_qs(u.split('?', 1)[1])
        return int(q['Expires'][0])
    except Exception:
        return None


class Gallery:
    def __init__(self, D, assets, man, out):
        self.D, self.assets, self.man, self.out = D, assets, man, out
        self.img = os.path.join(out, 'img')
        self.files = 0
        self.expiries = []
        self.task_expiries = []
        H = Image.open(os.path.join(LEVEL, 'hero.png')).convert('RGBA')
        hf = load(os.path.join(LEVEL, 'hero.json'))['anims']['idle']['frames'][0]
        self.hero = (H.crop((hf['x'], hf['y'], hf['x'] + hf['w'], hf['y'] + hf['h'])), hf['ax'], hf['ay'])
        self.pl = D.pl

    # ---- images
    def save(self, im, name, **kw):
        p = os.path.join(self.img, name)
        im.save(p, **kw)
        self.files += 1
        return 'img/' + name

    def thumb(self, src, name, size=(360, 300)):
        im = Image.open(src).convert('RGBA')
        a = im.getchannel('A')
        bb = a.getbbox() if a.getextrema()[0] < 255 else None
        if bb:
            pad = int(max(bb[2] - bb[0], bb[3] - bb[1]) * 0.06) + 4
            bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(im.width, bb[2] + pad), min(im.height, bb[3] + pad))
            im = im.crop(bb)
        im.thumbnail((size[0] - 12, size[1] - 12), Image.LANCZOS)
        c = Image.new('RGB', size, (204, 198, 189))
        c.paste(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2), im)
        return self.save(c, name, format='JPEG', quality=84, optimize=True)

    def hero_at(self, sc):
        im, ax, ay = self.hero
        if abs(sc - 1) < 1e-6:
            return im, ax, ay
        return (im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.NEAREST), round(ax * sc), round(ay * sc))

    def lineup(self, items, name):
        """items: [(img, ax, ay, scale)] -> one PNG: the sprites by layer scale, each scale group followed by the hero at that scale,
        standing on one ground band."""
        groups = OrderedDict()
        for it in items:
            groups.setdefault(round(it[3], 4), []).append(it)
        place, x = [], 6
        for sc, its in groups.items():
            him, hax, hay = self.hero_at(sc)                       # the hero first, so he is in view before any scrolling
            place.append((him, x, hay)); x += him.width + 12
            for im, ax, ay, _ in its:
                place.append((im, x, ay)); x += im.width + 8
            x += 14
        W = x - 22 + 6
        up = max(p[2] for p in place); down = max(p[0].height - p[2] for p in place)
        gy = 6 + up
        Hh = gy + max(7, down + 2)
        c = Image.new('RGBA', (W, Hh), (0, 0, 0, 0))
        c.paste((54, 44, 52, 255), (0, gy, W, gy + 1))
        c.paste((33, 27, 35, 255), (0, gy + 1, W, Hh))
        for im, px, ay in place:
            c.alpha_composite(im, (px, gy - ay))
        return self.save(c, name, format='PNG', optimize=True), W, Hh

    def sprite_item(self, key, s):
        J = self.D.atlas[key]['sprites'][s]
        A = self.D.atlas_img(key)
        f = J if 'x' in J else (J.get('frames') or [None])[0]
        if not f:
            return None
        im = A.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        ay = f.get('ay', f['h'] - 1)
        if 'r' in J and 'frames' in J:
            ay = f['h'] - 1                                        # a wheel: show it standing
        return (im, f.get('ax', f['w'] // 2), ay, J.get('scale', 1) or 1)

    def char_frame(self, atlas, clip='idle'):
        j = load(os.path.join(GROUPS, 'g8', 'out', atlas + '.json'), {})
        an = j.get('anims', {})
        a = an.get(clip) or next(iter(an.values()))
        f = a['frames'][0]
        im = Image.open(os.path.join(GROUPS, 'g8', 'out', atlas + '.png')).convert('RGBA')
        return (im.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])), f['ax'], f['ay'], 1)

    def frame_cell(self, src, f):
        """a frame as the engine draws it: the figure with its per-frame prop (frames[i].prop: a sprite of the g8 atlas at x / y relative
        to the frame rect, layer over / under) composited; -> (image, ax, ay, prop sprite name or None)."""
        fig = src.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        pr = f.get('prop')
        MJ = self.D.atlas.get('g8', {}).get('sprites', {})
        if not isinstance(pr, dict) or pr.get('sprite') not in MJ:
            return fig, f['ax'], f['ay'], None
        sp = MJ[pr['sprite']]
        P = self.D.atlas_img('g8').crop((sp['x'], sp['y'], sp['x'] + sp['w'], sp['y'] + sp['h']))
        x0, y0 = min(0, pr['x']), min(0, pr['y'])
        x1, y1 = max(f['w'], pr['x'] + sp['w']), max(f['h'], pr['y'] + sp['h'])
        c = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
        if pr.get('layer') == 'under':
            c.alpha_composite(P, (pr['x'] - x0, pr['y'] - y0)); c.alpha_composite(fig, (-x0, -y0))
        else:
            c.alpha_composite(fig, (-x0, -y0)); c.alpha_composite(P, (pr['x'] - x0, pr['y'] - y0))
        return c, f['ax'] - x0, f['ay'] - y0, pr['sprite']

    def clip_sheet(self, atlas, name):
        """two PNGs per character atlas (right and left facing) with one shared geometry: a row per clip, every frame in a fixed cell
        aligned on the anchor, its per-frame prop composited (flashlight, pistol, crate) as the engine draws it."""
        j = load(os.path.join(GROUPS, 'g8', 'out', atlas + '.json'), {})
        src = Image.open(os.path.join(GROUPS, 'g8', 'out', atlas + '.png')).convert('RGBA')
        an = j.get('anims', {})
        lan = (j.get('left') or {}).get('anims', {})
        cells = OrderedDict()
        for k, a in an.items():
            cells[k] = {'right': [self.frame_cell(src, f) for f in a['frames']],
                        'left': [self.frame_cell(src, f) for f in (lan.get(k) or {}).get('frames', [])]}
        allc = [c for v in cells.values() for side in v.values() for c in side]
        up = max(c[2] for c in allc)
        down = max(c[0].height - c[2] for c in allc)
        CH = up + down + 2
        rows = []
        for k, v in cells.items():
            both = v['right'] + v['left']
            L = max(c[1] for c in both) + 1; R = max(c[0].width - c[1] for c in both) + 1
            n = max(len(v['right']), len(v['left']))
            rows.append((k, an[k], v, L, L + R, n))
        # shelf packing (next fit, clip order): a clip's frames stay in one horizontal run, several short clips share a shelf, so the
        # sheet is a few shelves tall instead of one row per clip (a fraction of the decoded size: easier on phones)
        W = max(n * cw for _, _, _, _, cw, n in rows)
        place, x, shelf = [], 0, 0
        for _, _, _, _, cw, n in rows:
            if x and x + n * cw > W:
                shelf += 1; x = 0
            place.append((x, shelf)); x += n * cw
        sheets = {s: Image.new('RGBA', (W, CH * (shelf + 1)), (0, 0, 0, 0)) for s in ('right', 'left')}
        meta = []
        for i, (k, a, v, L, cw, n) in enumerate(rows):
            x0, sh = place[i]
            props = set()
            for side in ('right', 'left'):
                for m_, (im, ax, ay, pn) in enumerate(v[side]):
                    sheets[side].alpha_composite(im, (x0 + m_ * cw + L - ax, sh * CH + 1 + up - ay))
                    if pn:
                        props.add(re.sub(r'_(l|toward|away)$', '', pn))
            meta.append({'clip': k, 'row': sh, 'x0': x0, 'cw': cw, 'n': n, 'fps': a.get('fps') or 8, 'loop': a.get('loop'),
                         'pack': a.get('pack'), 'needs': a.get('needs'), 'src': (a.get('src') or {}).get('clip'),
                         'props': sorted(props), 'rifle': ((a.get('prop') or {}).get('rifle') if isinstance(a.get('prop'), dict) else None)
                         if ((a.get('prop') or {}).get('rifle') if isinstance(a.get('prop'), dict) else None) not in (None, 'none', False) else None,
                         'cut': a.get('cut'), 'nl': len(v['left'])})
        url = self.save(sheets['right'], name, format='PNG', optimize=True)
        url_l = self.save(sheets['left'], name.replace('.png', '_l.png'), format='PNG', optimize=True)
        return url, url_l, W, CH * (shelf + 1), CH, meta, j.get('excluded', {})

    # ---- links
    def links(self, tid):
        tj = self.D.tjson(tid) or {}
        out = []
        mu = tj.get('model_urls') or {}
        for k, lab in (('glb', 'GLB'), ('fbx', 'FBX'), ('obj', 'OBJ'), ('mtl', 'MTL'), ('usdz', 'USDZ')):
            if mu.get(k):
                out.append((lab, mu[k]))
        tex = tj.get('texture_urls') or []
        tex = tex[0] if isinstance(tex, list) and tex else (tex if isinstance(tex, dict) else {})
        for k, lab in (('base_color', 'tekstura'), ('metallic', 'metallic'), ('roughness', 'roughness'), ('normal', 'normalne')):
            if tex.get(k):
                out.append((lab, tex[k]))
        res = tj.get('result') if isinstance(tj.get('result'), dict) else {}
        for k, lab in (('rigged_character_glb_url', 'rig GLB'), ('rigged_character_fbx_url', 'rig FBX'),
                       ('animation_glb_url', 'GLB'), ('animation_fbx_url', 'FBX'), ('processed_animation_fps_fbx_url', 'FBX 30 fps')):
            if res.get(k):
                out.append((lab, res[k]))
        for k, u in (res.get('basic_animations') or {}).items():
            if isinstance(u, str) and u.startswith('http') and 'armature' not in k:
                nm = k.replace('_url', '').replace('_glb', ' GLB').replace('_fbx', ' FBX').replace('walking', 'chód').replace('running', 'bieg')
                out.append((nm, u))
        for _, u in out:
            e = url_expiry(u)
            if e:
                self.expiries.append(e)
        if tj.get('expires_at'):
            self.task_expiries.append(tj['expires_at'] / 1000)
        return out

    def link_html(self, pairs):
        return ' '.join('<a href="%s" target="_blank" rel="noopener">%s</a>' % (E(u, quote=True), E(lab)) for lab, u in pairs)

    # ---- page
    def status_pill(self, st):
        lab = (self.pl.get('status') or {}).get(st, st)
        return '<span class="pill st-%s">%s</span>' % (E(st.replace(' ', '-')), E(lab))

    def score_html(self, s):
        if s is None:
            return ''
        return '<span class="score" title="ocena sędziego 0-10"><b>%s</b><small>/10</small></span>' % pl_num(s)

    def build(self):
        if os.path.exists(self.out):
            shutil.rmtree(self.out)
        os.makedirs(self.img)
        D = self.D
        cards = OrderedDict()
        for A in self.assets:
            cards.setdefault(A['group'], []).append(self.card(A))
        body = self.page(cards)
        with open(os.path.join(self.out, 'index.html'), 'w') as f:
            f.write(body)
        self.files += 1
        return self.files

    def thumb_src(self, A):
        D = self.D
        if A['_how'] == 'pilot':
            return D.pilot[A['name']].get('thumb')
        for tid in (A['_mid'], A['_src']):
            t = D.task.get(tid or '', {})
            if t.get('dir'):
                for fn in ('thumb.png', 'image_0.png'):
                    p = os.path.join(t['dir'], fn)
                    if os.path.exists(p):
                        return p
        return None

    def card(self, A):
        D, pl = self.D, (A['_pl'] or {})
        n = A['name']
        ma = next(x for x in self.man['assets'] if x['name'] == n)
        h = []
        th = self.thumb_src(A)
        timg = self.thumb(th, 't_%s.jpg' % n) if th else None
        # sprites next to the hero
        items, names = [], []
        if A['_char']:
            for c in A['_char_atlases'][:1]:
                items.append(self.char_frame(c)); names.append(c + ': idle')
            for c in A['_char_atlases'][1:]:
                items.append(self.char_frame(c)); names.append(c + ': idle')
        else:
            prefer = [A['group']] + ([os.path.basename(os.path.dirname(os.path.dirname(A['_glb'])))] if A['_glb'] else [])
            if A['_how'] == 'owner':
                prefer = ['level']
            for s in A['_sprites']:
                if '/' in s:
                    continue
                k = D.find_sprite(s, prefer)
                if k:
                    it = self.sprite_item(k, s)
                    if it:
                        items.append(it); names.append(s)
        stage = ''
        span = ''
        if items:
            url, W, Hh = self.lineup(items, 's_%s.png' % n)
            big = Hh > 300
            sc = 1 if big else 2
            span = 'wide' if W * sc > 790 else ('span2' if W * sc > 372 else '')
            stage = ('<figure class="stage"><div class="stage-scroll"><img class="px" src="%s" width="%d" height="%d" data-w="%d" '
                     'data-h="%d" alt="%s" loading="lazy"></div><figcaption><span>%s</span><button type="button" class="zoom" '
                     'aria-label="Przełącz powiększenie">×%d</button></figcaption></figure>' % (
                         url, W * sc, Hh * sc, W, Hh, E('Sprite\'y %s obok bohatera' % n), E(' · '.join(names)) +
                         ' <span class="muted">obok bohatera (96 px = 1,85 m) w skali warstwy</span>', sc))
        else:
            stage = '<p class="nostage">Brak sprite\'a w atlasie.</p>'
        st = A['status']
        cls = 'card' + (' wide' if A['_char'] else (' ' + span if span else '')) + (' char' if A['_char'] else '')
        h.append('<article class="%s" id="a-%s">' % (cls, E(n)))
        h.append('<header class="card-head">')
        if timg:
            h.append('<img class="thumb" src="%s" width="180" height="150" alt="%s" loading="lazy">' % (
                timg, E('Miniatura Meshy: %s' % n)))
        else:
            h.append('<div class="thumb nothumb"><span>%s</span></div>' % ('model właściciela' if A['_how'] == 'owner' else 'brak miniatury'))
        h.append('<div class="head-text"><h3>%s</h3><code class="aname">%s</code><div class="chips">%s%s<span class="chip">pass %s</span>'
                 '<span class="chip">%s</span></div></div>' % (
                     E(pl.get('pl') or n.replace('_', ' ')), E(n), self.status_pill(st), self.score_html(A['judge']['score']),
                     E(A['pass'] or '–'), E(A['method'] or '–')))
        h.append('</header>')
        v = pl.get('v') or self.generic_verdict(A)
        h.append('<p class="verdict">%s</p>' % E(v))
        h.append(stage)
        if A.get('_sprite_glb'):
            pv = (A['_main'] or {}).get('p1verdict')
            s1 = pv[1].get('score') if pv else None
            proc = A['_how'] == 'proc'
            h.append('<p class="srcnote">Sprite\'y pochodzą z modelu z pass 1: <code>models/%s__sprite.glb</code>%s. <code>models/%s.glb</code> '
                     'to %s z pass 2 (ocena %s/10)%s.</p>' % (
                         E(n), (' (ocena w pass 1: %s/10)' % pl_num(s1)) if s1 is not None else '', E(n),
                         'kit do Unreal toczony w Pythonie z teksturą Meshy' if proc else 'nowy model do Unreal',
                         pl_num(A['judge']['score']),
                         '; miniatura i linki to zadanie Meshy z pass 1, z którego kit wziął teksturę, a wymiary modelu to kit' if proc else
                         '; miniatura, wymiary i linki „Model” dotyczą modelu z pass 2'))
        facts = []
        bbox = ma.get('model_bbox_m')
        if A['size_m']:
            facts.append(('Rozmiar w planie', self.pl_size(A['size_m'])))
        if bbox:
            facts.append(('Model', '%s m · %s trójkątów' % (' × '.join(pl_num(x, 2) for x in bbox), pl_num(ma.get('model_triangles')))))
        lay = A['layer']
        if not lay and A['_char']:
            lay = 'playfield 1.0'
        if not lay and items and not A['_char']:
            k = D.find_sprite(names[0], [A['group']]) if names else None
            sj = D.atlas[k]['sprites'].get(names[0], {}) if k else {}
            lay = '%s %s%s' % ({'play': 'playfield', 'mover': 'playfield'}.get(sj.get('layer'), sj.get('layer', '')),
                               ('%.2f' % (sj.get('scale', 1) or 1)).rstrip('0').rstrip('.') if (sj.get('scale', 1) or 1) != 1 else '1.0',
                               ' (mover)' if sj.get('layer') == 'mover' else '') if sj else None
        if lay:
            facts.append(('Warstwa', self.pl_layer(lay)))
        meth = (self.pl.get('methods') or {}).get(A['method'], A['method'])
        facts.append(('Metoda', meth or '–'))
        cr = A['credits']
        crs = '%s kr.' % pl_num(cr) if cr else ('pilot: %s kr.' % pl_num(A.get('pilot_credits')) if A.get('pilot_credits') else '0 (ponowne użycie)')
        if A['credits_by_kind']:
            crs += ' <span class="muted">(%s)</span>' % E(', '.join('%s %s' % (k, pl_num(v)) for k, v in A['credits_by_kind'].items()))
        facts.append(('Kredyty', crs))
        h.append('<dl class="facts">%s</dl>' % ''.join('<div><dt>%s</dt><dd>%s</dd></div>' % (E(a), b if 'span' in str(b) else E(str(b)))
                                                       for a, b in facts))
        # downloads
        dl = []
        if A['_mid']:
            ln = self.links(A['_mid'])
            if ln:
                lab = 'Model' if A['_how'] != 'proc' else 'Źródło tekstury'
                dl.append('<div class="dl-row"><span class="dl-lab">%s <code>%s</code></span>%s</div>' % (
                    lab, E(D.kind(A['_mid']) or ''), self.link_html(ln)))
        if A.get('_sprite_tid') and A['_sprite_tid'] != A['_mid']:
            ln = self.links(A['_sprite_tid'])
            if ln:
                dl.append('<div class="dl-row"><span class="dl-lab">Model sprite\'ów (pass 1) <code>%s</code></span>%s</div>' % (
                    E(D.kind(A['_sprite_tid']) or ''), self.link_html(ln)))
        for vv in A['_variants']:
            if vv.get('id'):
                ln = self.links(vv['id'])
                if ln:
                    vs = vv['verdict'][1].get('score') if vv.get('verdict') else None
                    dl.append('<div class="dl-row"><span class="dl-lab">Wariant %s%s</span>%s</div>' % (
                        E(vv['key']), (' (%s/10)' % pl_num(vs)) if vs is not None else '', self.link_html(ln)))
        if A['_char']:
            ci = char_info(D, A)
            for r in ci['rigs']:
                ln = self.links(r['id'])
                if ln:
                    lab = 'Rig' + (' (wariant)' if r.get('model') != A['_mid'] else '')
                    dl.append('<div class="dl-row"><span class="dl-lab">%s</span>%s</div>' % (lab, self.link_html(ln)))
            for an in ci['animations']:
                ln = self.links(an['id'])
                if ln:
                    clips = an.get('clips_in_glb') or [x['name'] for x in an.get('actions', [])]
                    rig_alt = an.get('rig') and any(r['id'] == an['rig'] and r.get('model') != A['_mid'] for r in ci['rigs'])
                    dl.append('<div class="dl-row"><span class="dl-lab">Animacje %s%s: %d</span>%s<span class="clipnames">%s</span></div>' % (
                        E(an.get('tag') or ''), ' (wariant)' if rig_alt else '', len(clips), self.link_html(ln), E(', '.join(clips))))
        if dl:
            h.append('<div class="downloads"><h4>Pobierz z Meshy (pełna rozdzielczość)</h4>%s</div>' % ''.join(dl))
        elif A['_how'] == 'owner':
            h.append('<div class="downloads"><h4>Model</h4><p class="muted">W repozytorium: <code>%s</code></p></div>' % E(
                os.path.relpath(A['_glb'], REPO)))
        if A['_char']:
            h.append(self.edited_block(A))
            h.append(self.char_block(A))
        # task ids
        rows = []
        t = ma['tasks']
        def tr(lab, rec):
            if rec and rec.get('id'):
                rows.append('<li><span>%s</span> <code>%s</code> <span class="muted">%s%s</span></li>' % (
                    E(lab), E(rec['id']), E(rec.get('kind') or ''), (' · %s kr.' % pl_num(rec['credits'])) if rec.get('credits') else ''))
        tr('model końcowy', t.get('final_model'))
        tr('koncept / podgląd', t.get('concept_or_preview'))
        tr('model sprite\'ów (pass 1)', t.get('sprite_model'))
        tr('jego koncept', (t.get('sprite_model') or {}).get('concept_or_preview'))
        for vr in t.get('variants', []):
            tr('wariant ' + vr['key'], vr.get('task'))
        for r in t.get('replaced', []):
            tr('zastąpiony', r['task'])
        for r in t.get('rejected_pass2_attempt', []):
            tr('odrzucony (pass 2)', r)
        for r in t.get('rig', []) or []:
            tr('rig', r)
        for r in t.get('animations', []) or []:
            tr('animacje', r)
        nc = len(t.get('candidates', []))
        if rows or nc:
            h.append('<details class="ids"><summary>Zadania Meshy (%d + %d kandydatów)</summary><ul>%s</ul>%s</details>' % (
                len(rows), nc, ''.join(rows), ('<p class="muted">Kandydaci: %s</p>' % E(', '.join('%s %s' % (c.get('kind'), c['id'][:13])
                                                                                                 for c in t['candidates']))) if nc else ''))
        h.append('</article>')
        return '\n'.join(h)

    def pl_size(self, s):
        """the plan's size string -> 'w × h × d m' (the English detail in brackets stays in the manifest)."""
        m = re.match(r'\s*([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)', str(s))
        if not m:
            return str(s)
        return '%s × %s × %s m' % tuple(x.replace('.', ',') for x in m.groups())

    def pl_layer(self, s):
        """the plan's layer string in Polish: the phrase table in assemble_pl.json (longest first, whole words), decimal commas."""
        tab = self.pl.get('layers') or {}
        if tab:
            keys = sorted(tab, key=len, reverse=True)
            rx = re.compile(r'(?<![\w-])(' + '|'.join(re.escape(k) for k in keys) + r')(?![\w-])')
            s = rx.sub(lambda mm: tab[mm.group(1)], str(s))
        return re.sub(r'(\d)\.(\d)', r'\1,\2', s)

    def generic_verdict(self, A):
        st = A['status']
        return {'ok': 'Sędzia: gotowe do użycia.', 'fix': 'Sędzia: do użycia, z uwagami do poprawki.', 'reuse': 'Ponownie użyty model.',
                'dropped': 'Odrzucony, nie trafia do gry.'}.get(st, '')

    def char_block(self, A):
        h = []
        props_pl = self.pl.get('props') or {}
        modes_pl = self.pl.get('rifle_modes') or {}
        for i, c in enumerate(A['_char_atlases']):
            url, url_l, SW, SH, CH, meta, excl = self.clip_sheet(c, 'c_%s.png' % c)
            title = 'Klipy' if i == 0 else 'Klipy wariantu %s' % c.replace(A['name'] + '_', '')
            h.append('<div class="clips" data-r="%s" data-l="%s" style="--sheet:url(%s)"><div class="clips-head"><h4>%s: %d</h4>'
                     '<button type="button" class="face" aria-pressed="false">Pokaż stronę lewą</button></div>' % (
                         url, url_l, url, E(title), len(meta)))
            if any(m['props'] for m in meta) or any(m['rifle'] for m in meta):
                h.append('<p class="clip-legend muted">Rekwizyty z atlasu g8 (%s) są dorysowane klatka po klatce, tak jak rysuje je gra. '
                         'Karabin<sup>*</sup> rysuje silnik według trybu klipu, więc na tym podglądzie go nie ma.</p>' % E(', '.join(
                             sorted({props_pl.get(p, p) for m in meta for p in m['props']})) or '–'))
            h.append('<div class="clip-grid">')
            for m in meta:
                dur = m['n'] / float(m['fps'])
                badges = []
                if m.get('pack'):
                    badges.append('<span class="tag">pakiet %s</span>' % E(str(m['pack'])))
                for p in m['props']:
                    badges.append('<span class="tag prop">+ %s</span>' % E(props_pl.get(p, p)))
                if m.get('rifle'):
                    badges.append('<span class="tag eng" title="%s">karabin: %s<sup>*</sup></span>' % (
                        E('Karabin dorysowuje silnik gry (tryb %s); na tym podglądzie go nie ma.' % m['rifle'], quote=True),
                        E(modes_pl.get(m['rifle'], m['rifle']))))
                if m.get('cut'):
                    cu = m['cut']
                    tip = cu.get('why') if isinstance(cu, dict) and cu.get('why') else (
                        'zachowane klatki %s z %s' % (len(cu.get('kept', [])), cu.get('of')) if isinstance(cu, dict) else str(cu))
                    badges.append('<span class="tag" title="%s">skrócony</span>' % E(tip, quote=True))
                h.append('<div class="clip%s"><div class="player" role="img" aria-label="%s" style="--cw:%d;--ch:%d;--n:%d;--row:%d;--x0:%d;--sw:%d;--sh:%d;'
                         '--dur:%.3fs"></div><div class="clip-name">%s</div><div class="clip-meta">%d kl. · %s fps%s</div><div class="badges">%s</div></div>' % (
                             ' span2' if m['cw'] * 2 > 138 else '', E('Animacja %s' % m['clip']), m['cw'], CH, m['n'], m['row'], m['x0'], SW, SH, dur,
                             E(m['clip']), m['n'], pl_num(m['fps']), ' · pętla' if m['loop'] else '', ''.join(badges)))
            h.append('</div>')
            if excl:
                h.append('<p class="excluded">Wyłączone z atlasu: %s</p>' % ', '.join('<code title="%s">%s</code>' % (E(why, quote=True), E(k))
                                                                                      for k, why in excl.items()))
            h.append('<details class="strips"><summary>Pasy klatek (×1)</summary><div class="strip-list">')
            for m in meta:
                h.append('<div class="strip"><span>%s</span><div class="strip-scroll"><div class="strip-img" style="width:%dpx;height:%dpx;'
                         'background-position:-%dpx -%dpx"></div></div></div>' % (E(m['clip']), m['cw'] * m['n'], CH, m['x0'], m['row'] * CH))
            h.append('</div></details></div>')
        return '\n'.join(h)

    def edited_block(self, A):
        """a character's edited animation GLBs: where they are and which clips differ from the Meshy downloads."""
        ma = next(x for x in self.man['assets'] if x['name'] == A['name'])
        ed = (ma.get('character') or {}).get('edited_glbs') or []
        if not ed:
            return ''
        rows = []
        for e in ed:
            what = '; '.join('%s → %s (%s, %s–%s s)' % (c['clip'], ', '.join(c['atlas_rows']) or '–', ', '.join(c['bones']),
                                                        pl_num(c['window_s'][0], 2), pl_num(c['window_s'][1], 2)) for c in e['motion_edits'])
            if e['texture_repainted']:
                what = (what + '; ' if what else '') + 'tekstura z domalowanym paskiem'
            rows.append('<li><code>%s</code> <span class="muted">(z %s <code>%s</code>)</span>: %s</li>' % (
                E(e['archive_path']), E(e['made_from']['kind']), E(e['made_from']['task'][:13]), E(what)))
        motion = any(e['motion_edits'] for e in ed)
        tex = any(e['texture_repainted'] for e in ed)
        why = []
        if motion:
            why.append('w poprawionych klipach puste ramię wychodzi tam do przodu albo w górę')
        if tex:
            why.append('tekstura nie ma domalowanego paska')
        return ('<div class="edited"><h4>Poprawione animacje</h4><p>Część klipów w atlasie wyrenderowano z poprawionych kopii GLB, nie z plików '
                'Meshy. Pakiety do pobrania powyżej są oryginalne (%s). Do Unreal weź poprawione GLB z gałęzi <code>%s</code>:</p>'
                '<ul>%s</ul></div>' % ('; '.join(why), ARCHIVE_BRANCH, ''.join(rows)))

    def page(self, cards):
        D, man, pl = self.D, self.man, self.pl
        tot = man['totals']
        grp_titles = pl.get('groups', {})
        exp_min = min(self.expiries) if self.expiries else None
        kinds = tot['by_kind']
        kmax = max(kinds.values()) if kinds else 1
        knames = pl.get('kinds', {})
        bars = ''.join('<div class="bar" title="%s: %s kredytów"><span class="bar-lab">%s</span><span class="bar-track"><span class="bar-fill" '
                       'style="width:%.1f%%"></span></span><span class="bar-val">%s</span></div>' % (
                           E(knames.get(k, k)), pl_num(v), E(knames.get(k, k)), 100.0 * v / kmax, pl_num(v)) for k, v in kinds.items())
        st = tot['by_status']
        sorder = ['ok', 'fix', 'reuse', 'dropped', 'excluded', 'not generated']
        stat_line = ', '.join('%s %s' % (pl_num(st[k]), (pl.get('status') or {}).get(k, k)) for k in sorted(st, key=lambda k: (sorder.index(k) if k in sorder else 9, k)))
        nchar = tot['characters']; nclips = tot.get('character_clips_all_atlases') or tot['character_clips']
        nvar = nclips - tot['character_clips']
        tiles = [('Kredyty', pl_num(tot['credits']), '+ %s w pilocie, %s zadań Meshy' % (pl_num(tot['pilot_before_ledger']), pl_num(tot['tasks']))),
                 ('Assety', pl_num(tot['assets']), stat_line),
                 ('Postacie', pl_num(nchar), 'z riggiem Meshy'),
                 ('Klipy', pl_num(nclips), '%s%s pakietów animacji, %s akcji' % (
                     ('w tym %s w wariancie górnika c0; ' % pl_num(nvar)) if nvar else '', pl_num(tot['animation_tasks']),
                     pl_num(tot['animation_actions'])))]
        tiles_html = ''.join('<div class="tile"><div class="tile-lab">%s</div><div class="tile-num">%s</div><div class="tile-sub">%s</div></div>'
                             % (E(a), E(b), E(c)) for a, b, c in tiles)
        summ = pl.get('summary', {})
        # task expiry over every ledger task (concepts included, though the page links none of them)
        tx = []
        for r in D.ledger:
            e = (D.tjson(r['id']) or {}).get('expires_at')
            if e:
                tx.append((e / 1000, r['kind']))
        kn = pl.get('kinds', {})
        parts = ['Pełne modele są też w repozytorium, na osobnej gałęzi <code>%s</code> (ok. 1 GB, poza główną historią): model końcowy '
                 'i warianty każdego assetu, a dla postaci rigi, chód, bieg, wszystkie pakiety animacji i poprawione GLB, z których wyrenderowano atlasy. '
                 'Nie ma tam konceptów ani pozostałych kandydatów. Pobranie: <code>git fetch origin %s</code>.' % (ARCHIVE_BRANCH, ARCHIVE_BRANCH)]
        if exp_min:
            parts.append('Linki na tej stronie to podpisane adresy Meshy; pierwsze z nich przestaną działać <b>%s</b>. Nowe linki daje API po '
                         'ID zadania (instrukcja w README pakietu w repozytorium).' % E(pl_date(exp_min)))
        if tx:
            t0, k0 = min(tx); t1 = max(tx)[0]
            parts.append('Same wyniki zadań image-to-3D, konceptów, riggingu i animacji Meshy trzyma tylko 72 godziny: wygasają od <b>%s</b> '
                         '(%s) do <b>%s</b>. Modele text-to-3D (metoda T3D) zostają na koncie i da się je pobrać później po ID zadania.' % (
                             E(pl_date(t0)), E(kn.get(k0, k0)), E(pl_date(t1))))
        exp_html = '<aside class="notice">%s</aside>' % ''.join('<p>%s</p>' % x for x in parts)
        nav = ''.join('<a class="navchip" href="#%s">%s <span>%d</span></a>' % (E(g), E(g), len(cs)) for g, cs in cards.items())
        secs = []
        for g, cs in cards.items():
            As = [A for A in self.assets if A['group'] == g]
            gcr = sum(A['credits'] for A in As)
            gv = D.V.get(g, {})
            judge = ''
            if gv.get('score') is not None:
                judge = ' · ocena grupy %s (pierwsza runda %s)' % (pl_num(gv['score']), pl_num(gv.get('first')))
            secs.append('<section class="group" id="%s"><div class="group-head"><h2><span class="gkey">%s</span> %s</h2><p class="muted">%d assetów · %s kredytów%s</p></div>'
                        '<div class="cards">%s</div></section>' % (
                            E(g), E(g), E(grp_titles.get(g, g)), len(As), pl_num(gcr), judge, '\n'.join(cs)))
        stamp = max(r['t'] for r in D.ledger)
        return TEMPLATE.format(
            css=CSS, tiles=tiles_html, bars=bars, notice=exp_html, nav=nav, sections='\n'.join(secs),
            strong=''.join('<li>%s</li>' % E(s) for s in summ.get('strong', [])),
            weak=''.join('<li>%s</li>' % E(s) for s in summ.get('weak', [])),
            stamp=E(pl_date(stamp)), js=JS)


CSS = r"""
/* Layout: a works ledger. Header with the totals, then one section per asset group: cards with the Meshy render, the pixel sprites
   in a dark "night street" well next to the hero, the judge's verdict and the download links. */
:root{
  --bg:#ece7df; --surface:#f8f5f0; --ink:#1d1a1c; --muted:#655c58; --line:#d6cec3; --soft:#e3dcd2;
  --accent:#a8560f; --accent-fill:#d98a2b; --stage:#2e2328; --stage-ink:#d8d0b8;
  --ok:#2f6b3c; --ok-bg:#dcebdc; --fix:#8a5a00; --fix-bg:#f3e3bf; --bad:#9b3524; --bad-bg:#f2d5cd; --reuse:#3d5a73; --reuse-bg:#d7e2ea;
  --font-display:"Barlow Condensed","Arial Narrow",Arial,sans-serif; --font-body:"Barlow","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#141116; --surface:#1d191f; --ink:#ebe3d6; --muted:#a59a8f; --line:#332c35; --soft:#272128;
  --accent:#f0a646; --accent-fill:#e3943a; --stage:#241b20; --stage-ink:#d8d0b8;
  --ok:#86c992; --ok-bg:#1f3324; --fix:#e8b85c; --fix-bg:#3a2d12; --bad:#ef8a72; --bad-bg:#3e1d17; --reuse:#9cc0dc; --reuse-bg:#1c2a36;
  color-scheme:dark; } }
:root[data-theme="dark"]{
  --bg:#141116; --surface:#1d191f; --ink:#ebe3d6; --muted:#a59a8f; --line:#332c35; --soft:#272128;
  --accent:#f0a646; --accent-fill:#e3943a; --stage:#241b20; --stage-ink:#d8d0b8;
  --ok:#86c992; --ok-bg:#1f3324; --fix:#e8b85c; --fix-bg:#3a2d12; --bad:#ef8a72; --bad-bg:#3e1d17; --reuse:#9cc0dc; --reuse-bg:#1c2a36;
  color-scheme:dark; }
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--font-body);font-size:15px;line-height:1.5;margin:0}
.wrap{max-width:1280px;margin:0 auto;padding-inline:16px;padding-block:20px 48px}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code{font-family:var(--font-mono);font-size:.82em}
.muted{color:var(--muted)}
h1,h2,h3,h4{font-family:var(--font-display);font-weight:600;line-height:1.1;text-wrap:balance;margin:0}
.masthead{display:grid;gap:18px;padding-block:8px 20px;border-bottom:2px solid var(--ink)}
.eyebrow{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.14em;font-size:.82rem;color:var(--accent)}
h1{font-size:clamp(2rem,6vw,3.4rem);letter-spacing:.01em;text-transform:uppercase}
.lede{max-width:68ch;margin:0;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--line);padding:12px 14px}
.tile-lab{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.1em;font-size:.78rem;color:var(--muted)}
.tile-num{font-family:var(--font-display);font-size:2.3rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.05}
.tile-sub{font-size:.84rem;color:var(--muted)}
.overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px;padding-block:20px;border-bottom:1px solid var(--line)}
.overview h2{font-size:1.25rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.bars{display:grid;gap:6px}
.bar{display:grid;grid-template-columns:minmax(0,11rem) 1fr 4rem;gap:10px;align-items:center;font-size:.9rem}
.bar-lab{color:var(--ink);overflow-wrap:anywhere}
.bar-track{height:12px;background:var(--soft)}
.bar-fill{display:block;height:100%;background:var(--accent-fill);border-radius:0 3px 3px 0}
.bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
.summary ul{margin:0;padding-left:1.1em;display:grid;gap:6px}
.summary h3{font-size:1rem;text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;color:var(--muted)}
.notice{border-left:4px solid var(--accent-fill);background:var(--surface);padding:10px 14px;margin-block:16px 0}
.notice p{margin:0;max-width:90ch} .notice p+p{margin-top:6px}
nav.groups{display:flex;flex-wrap:wrap;gap:8px;padding-block:16px}
.navchip{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.08em;text-decoration:none;color:var(--ink);border:1px solid var(--line);padding:4px 10px;background:var(--surface)}
.navchip span{color:var(--muted)}
.group{padding-block:22px 6px;border-top:1px solid var(--line)}
.group-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 18px;margin-bottom:14px}
.group-head h2{font-size:clamp(1.4rem,3.4vw,2rem)}
.group-head p{margin:0}
.gkey{font-family:var(--font-mono);font-size:.62em;color:var(--accent);vertical-align:middle;margin-right:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));grid-auto-flow:row dense;gap:14px;align-items:start}
@media (min-width:820px){.card.span2{grid-column:span 2}}
.card{background:var(--surface);border:1px solid var(--line);padding:14px;display:grid;grid-template-columns:minmax(0,1fr);gap:10px;min-width:0}
.card>*{min-width:0}
.card.wide{grid-column:1/-1}
.card-head{display:flex;gap:12px;align-items:flex-start}
.thumb{width:132px;height:110px;object-fit:cover;flex:none;background:var(--soft)}
.nothumb{display:flex;align-items:center;justify-content:center;text-align:center;font-size:.8rem;color:var(--muted);padding:6px}
.head-text{min-width:0;display:grid;gap:4px}
.card h3{font-size:1.3rem}
.aname{color:var(--muted);overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip,.pill,.tag{font-size:.76rem;padding:1px 7px;border:1px solid var(--line);white-space:nowrap}
.pill{font-weight:600;text-transform:uppercase;letter-spacing:.05em;border:0}
.st-ok{background:var(--ok-bg);color:var(--ok)} .st-fix{background:var(--fix-bg);color:var(--fix)}
.st-dropped,.st-not-generated{background:var(--bad-bg);color:var(--bad)} .st-reuse{background:var(--reuse-bg);color:var(--reuse)}
.st-excluded{background:var(--soft);color:var(--muted)}
.score{font-variant-numeric:tabular-nums} .score b{font-family:var(--font-display);font-size:1.25rem} .score small{color:var(--muted)}
.verdict{margin:0;max-width:75ch}
.stage{margin:0;background:var(--stage);color:var(--stage-ink);min-width:0;max-width:100%}
.stage-scroll{overflow-x:auto;padding:10px 10px 0}
.stage img.px{display:block;max-width:none;image-rendering:pixelated;image-rendering:crisp-edges}
.stage figcaption{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px 8px;font-size:.78rem;color:var(--stage-ink)}
.stage figcaption .muted{color:var(--stage-ink);opacity:.72}
.zoom{font:inherit;font-weight:600;background:transparent;color:var(--stage-ink);border:1px solid currentColor;padding:1px 8px;cursor:pointer;flex:none}
.nostage{margin:0;font-size:.85rem;color:var(--muted)}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:4px 14px;margin:0;font-size:.86rem}
.facts div{min-width:0} .facts dt{font-family:var(--font-display);text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;color:var(--muted)}
.facts dd{margin:0;overflow-wrap:anywhere}
.downloads h4,.clips h4{font-size:.95rem;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}
.dl-row{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:.88rem;padding-block:2px}
.dl-lab{color:var(--muted);min-width:7.5rem}
.clipnames{flex-basis:100%;font-size:.78rem;color:var(--muted)}
.ids{font-size:.82rem} .ids summary{cursor:pointer;color:var(--muted)} .ids ul{margin:6px 0;padding-left:1.1em} .ids p{overflow-wrap:anywhere}
.clips{display:grid;gap:8px}
.clip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.clip{background:var(--stage);color:var(--stage-ink);padding:6px;display:grid;grid-template-columns:minmax(0,1fr);gap:2px;justify-items:center;align-content:start;min-width:0}
.clip.span2{grid-column:span 2}
.clips-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px}
.face{font:inherit;font-size:.8rem;background:var(--soft);color:var(--ink);border:1px solid var(--line);padding:2px 10px;cursor:pointer}
.face[aria-pressed="true"]{background:var(--accent-fill);color:#1d1a1c;border-color:var(--accent-fill)}
.clip-legend{margin:0;font-size:.8rem;max-width:90ch}
.player{width:calc(var(--cw) * 2px);height:calc(var(--ch) * 2px);max-width:100%;background-repeat:no-repeat;image-rendering:pixelated;image-rendering:crisp-edges;background-image:var(--sheet);
  background-size:calc(var(--sw) * 2px) calc(var(--sh) * 2px);background-position:calc(var(--x0) * -2px) calc(var(--row) * var(--ch) * -2px);
  animation:play var(--dur) steps(var(--n)) infinite}
@keyframes play{from{background-position-x:calc(var(--x0) * -2px)}to{background-position-x:calc((var(--x0) + var(--n) * var(--cw)) * -2px)}}
@media (prefers-reduced-motion: reduce){.player{animation:none}}
.clip-name{font-family:var(--font-mono);font-size:.7rem;text-align:center;overflow-wrap:anywhere;line-height:1.25}
.clip-meta{font-size:.68rem;opacity:.75}
.badges{display:flex;flex-wrap:wrap;gap:3px;justify-content:center}
.clip .tag{border-color:currentColor;font-size:.64rem}
.clip .tag.prop{background:var(--accent-fill);color:#1d1a1c;border-color:var(--accent-fill)}
.clip .tag.eng{opacity:.8;border-style:dashed}
.srcnote{margin:0;font-size:.86rem;border-left:3px solid var(--accent-fill);padding-left:8px}
.edited{font-size:.86rem} .edited p{margin:0 0 4px;max-width:90ch} .edited ul{margin:0;padding-left:1.1em} .edited li{overflow-wrap:anywhere}
.edited h4{font-size:.95rem;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}
.excluded{margin:0;font-size:.82rem;color:var(--muted)}
.strips summary{cursor:pointer;color:var(--muted);font-size:.85rem}
.strip-list{display:grid;gap:6px;margin-top:6px}
.strip{display:grid;gap:2px;font-family:var(--font-mono);font-size:.7rem;color:var(--muted)}
.strip-scroll{overflow-x:auto;background:var(--stage)}
.strip-img{image-rendering:pixelated;background-repeat:no-repeat;background-image:var(--sheet)}
footer{border-top:1px solid var(--line);margin-top:24px;padding-top:12px;font-size:.82rem;color:var(--muted)}
@media (max-width:520px){ .thumb{width:104px;height:87px} .card{padding:12px} .bar{grid-template-columns:minmax(0,8.5rem) 1fr 3.4rem} }
"""

JS = r"""
document.querySelectorAll('.clips[data-l]').forEach(function(c){
  var b=c.querySelector('.face'); if(!b) return;
  b.addEventListener('click',function(){
    var left=b.getAttribute('aria-pressed')!=='true';
    c.style.setProperty('--sheet','url('+(left?c.dataset.l:c.dataset.r)+')');
    b.setAttribute('aria-pressed',left?'true':'false'); b.textContent=left?'Pokaż stronę prawą':'Pokaż stronę lewą';
  });
});
document.querySelectorAll('.stage').forEach(function(f){
  var img=f.querySelector('img.px'), b=f.querySelector('.zoom'); if(!img||!b) return;
  b.addEventListener('click',function(){
    var s=b.textContent.indexOf('2')>=0?1:2, w=+img.dataset.w, h=+img.dataset.h;
    img.width=w*s; img.height=h*s; b.textContent='×'+s;
  });
});
"""

TEMPLATE = """<title>Biblioteka Meshy Kattowitz</title>
<style>{css}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Barlow:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400&display=swap">
<div class="wrap">
<header class="masthead">
  <div class="eyebrow">Grube Kattowitz III · Górny Śląsk 1957</div>
  <h1>Biblioteka Meshy</h1>
  <p class="lede">Wszystkie modele 3D, sprite'y i postacie wygenerowane w Meshy dla poziomu: przy każdym assecie render Meshy, sprite w palecie poziomu obok bohatera (96 px = 1,85 m, 52,5 px na metr), ocena niezależnego sędziego i linki do pobrania modeli w pełnej rozdzielczości.</p>
  <div class="tiles">{tiles}</div>
</header>
{notice}
<div class="overview">
  <section><h2>Kredyty według rodzaju zadania</h2><div class="bars">{bars}</div></section>
  <section class="summary"><h2>Podsumowanie</h2><h3>Mocne strony</h3><ul>{strong}</ul><h3>Słabe strony</h3><ul>{weak}</ul></section>
</div>
<nav class="groups" aria-label="Grupy">{nav}</nav>
{sections}
<footer>Stan na {stamp} (ostatnie zadanie w księdze kredytów). Strona zbudowana skryptem assemble.py z plików biblioteki; pakiet dla repozytorium leży w assets/meshy.</footer>
</div>
<script>{js}</script>
"""


# ---------------------------------------------------------------------------------------------------------------------------- checks
def leak_scan(root):
    hits = []
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            if os.path.splitext(f)[1].lower() in ('.png', '.jpg', '.glb'):
                continue
            try:
                t = open(p, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            for pat in (LEAK_SIG, LEAK_KP, LEAK_KEY):
                if pat in t:
                    hits.append((p, pat))
            if LEAK_BEARER.search(t):
                hits.append((p, 'bearer token'))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=DEF_REPO_OUT)
    ap.add_argument('--gallery', default=DEF_GALLERY)
    ap.add_argument('--skip-repo', action='store_true')
    ap.add_argument('--skip-gallery', action='store_true')
    o = ap.parse_args()
    D = Data()
    assets = build_assets(D)
    man = None
    if not o.skip_repo:
        man = write_repo(D, assets, o.repo)
        hits = leak_scan(o.repo)
        size = dir_size(o.repo)
        nfiles = sum(len(fs) for _, _, fs in os.walk(o.repo))
        print(json.dumps({'repo': o.repo, 'files': nfiles, 'MB': round(size / 1e6, 2), 'assets': len(assets),
                          'leaks': [(os.path.relpath(p, o.repo), k) for p, k in hits]}))
        if hits:
            sys.exit('leak scan failed')
    else:
        files_of = defaultdict(list)
        man = manifest(D, assets, files_of)
    if not o.skip_gallery:
        G = Gallery(D, assets, man, o.gallery)
        n = G.build()
        print(json.dumps({'gallery': o.gallery, 'files': n, 'MB': round(dir_size(o.gallery) / 1e6, 2),
                          'link_expiry': pl_date(min(G.expiries)) if G.expiries else None}))
        if n > 240:
            sys.exit('gallery has %d files (> 240)' % n)


if __name__ == '__main__':
    main()
