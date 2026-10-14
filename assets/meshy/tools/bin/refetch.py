#!/usr/bin/env python3
"""Re-download every candidate into its own dir (lib/<name>/<kind>-<full id>; the old <kind>-<id8> dirs collided for tasks created
in the same minute), rewrite candidates.json and rebuild contact.png labelled by candidate index (c<i>, multi-view c<i>.v<k>).
Free: only GETs and downloads. usage: refetch.py [--only a,b]"""
import json, os, subprocess, sys, glob, shutil, re
from concurrent.futures import ThreadPoolExecutor
M = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); LIB = os.path.join(M, 'lib'); MK = [sys.executable, '-I', os.path.join(M, 'mk.py')]
only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
def fix(name):
    cf = os.path.join(LIB, name, 'candidates.json'); C = json.load(open(cf))
    def w(c):
        p = subprocess.run(MK + ['wait', c['id'], '--kind', c['kind'], '--name', name, '--thumb-only'], capture_output=True, text=True)
        r = json.loads(p.stdout.strip().splitlines()[-1]); return {**c, 'status': r.get('status'), 'dir': r.get('dir'), 'files': r.get('files')}
    with ThreadPoolExecutor(6) as ex: C = list(ex.map(w, C))
    json.dump(C, open(cf, 'w'), indent=1)
    for d in glob.glob(os.path.join(LIB, name, '*-*')):
        if os.path.isdir(d) and re.fullmatch(r'(t3d|t2i)-[0-9a-f]{8}', os.path.basename(d)): shutil.rmtree(d)
    args = []
    for c in C:
        imgs = sorted(f for f in (c.get('files') or []) if f.endswith('.png'))
        for k, f in enumerate(imgs):
            args.append((f"c{c['i']}" + (f'.v{k}' if len(imgs) > 1 else '') + (' (mv)' if c.get('mv') else '' if c.get('i3d_ok', True) else ' (ref)')) + '=' + os.path.join(c['dir'], f))
    subprocess.run([sys.executable, '-I', os.path.join(M, 'bin', 'contact.py'), os.path.join(LIB, name, 'contact.png')] + args, capture_output=True)
    return name, len(C), len(args)
names = [n for n in os.listdir(LIB) if os.path.exists(os.path.join(LIB, n, 'candidates.json')) and (not only or n in only)]
with ThreadPoolExecutor(8) as ex:
    for r in ex.map(fix, names): print(*r, flush=True)
