#!/usr/bin/env python3
"""Stage A: every asset's CANDIDATES from the plan, all at once (Meshy runs up to 30 tasks; mk.py waits on 429).
  T3D       one text-to-3D preview per prompt (prompts[:candidates]); thumbnails only
  IMG       one text-to-image concept per concept prompt (concept_prompts[:candidates]); model = concept_models[i] or t2i_model;
            --aspect = the asset's aspect (default 1:1); --remove-bg when remove_bg; plus one MULTI-VIEW set per mv_prompts entry
            (model mv_model or t2i_model; 3 images each; candidates get mv: true; they feed mi3d in stage C)
  MIMG      every concept prompt as a multi-view set (3 views per concept)
  CHAR      A-pose concepts (pose_mode a-pose) with the asset's aspect / remove_bg; mv_prompts -> A-pose multi-view sets
  REUSE     nothing
Each candidate records i3d_ok (its index is in the asset's i3d_concepts: a three-quarter view, or a flat kit piece). On an API error
(e.g. a model that does not take an aspect ratio, or pose + multi-view), the request is retried once without aspect / remove-bg / pose.
Writes lib/<name>/candidates.json ([{i, kind, id, dir, prompt, mv, i3d_ok}]) and lib/<name>/contact.png; skips an asset whose
candidates.json exists (re-run safe). usage: batch_a.py plan.json [--only a,b] [--workers 24]"""
import json, os, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); MK = [sys.executable, '-I', os.path.join(M, 'mk.py')]
LIB = os.path.join(M, 'lib')
T2I_MODELS = {'nano-banana', 'nano-banana-2', 'nano-banana-2-lite', 'nano-banana-pro', 'gpt-image-2'}
plan = json.load(open(sys.argv[1])); only = None; workers = 24
if '--only' in sys.argv: only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
if '--workers' in sys.argv: workers = int(sys.argv[sys.argv.index('--workers') + 1])
print_lock = threading.Lock()
def log(*a):
    with print_lock: print(*a, flush=True)

def run(args):
    p = subprocess.run(MK + args, capture_output=True, text=True)
    try: return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])
    except Exception: return p.returncode, {'raw': p.stdout[-300:], 'err': p.stderr[-300:]}

def t2i_req(a, meth, i, pr, mv):
    """(kind, prompt, args, fallback_args, mv) for one concept; fallback drops aspect / remove-bg / pose."""
    cm = a.get('concept_models') or []
    model = (a.get('mv_model') if mv else (cm[i] if i < len(cm) and cm[i] else None)) or a.get('t2i_model') or 'nano-banana-pro'
    if model not in T2I_MODELS: raise ValueError(f"{a['name']}: '{model}' is not a text-to-image model id")
    base = ['t2i', '--prompt', pr, '--model', model]; opt = []
    if mv or meth == 'MIMG': base += ['--multi-view']
    else: opt += ['--aspect', a.get('aspect') or '1:1']
    if meth == 'CHAR': opt += ['--pose', 'a-pose']
    if a.get('remove_bg'): opt += ['--remove-bg']
    keep = ['--pose', 'a-pose'] if (meth == 'CHAR' and not mv) else []      # a single A-pose concept keeps its pose on the retry
    return ('t2i', pr, base + opt, base + keep if opt else None, mv)

def job(g, a):
    name, meth = a['name'], a['method'].upper()
    out = os.path.join(LIB, name); os.makedirs(out, exist_ok=True)
    if os.path.exists(os.path.join(out, 'candidates.json')): log(name, 'candidates exist'); return
    n = int(a.get('candidates') or 0); tag, cap = g['key'], str(g['cap'])
    reqs = []
    if meth == 'T3D':
        for i, pr in enumerate((a.get('prompts') or [])[:n]): reqs.append(('t3d', pr, ['t3d', '--prompt', pr], None, False))
    elif meth in ('IMG', 'MIMG', 'CHAR'):
        try:
            for i, pr in enumerate((a.get('concept_prompts') or [])[:n]): reqs.append(t2i_req(a, meth, i, pr, False))
            for pr in (a.get('mv_prompts') or []): reqs.append(t2i_req(a, meth, 0, pr, True))
        except ValueError as e: log('PLAN ERROR', e); return
    else:
        log(name, meth, 'nothing to generate'); return
    created = []
    ok_idx = set(a.get('i3d_concepts') if a.get('i3d_concepts') is not None else range(n))
    for k, (kind, pr, args, fb, mv) in enumerate(reqs):
        rc, r = run(args + ['--name', name, '--tag', tag, '--cap', cap])
        if 'id' not in r and fb and rc == 4:
            log(name, 'retry without options', json.dumps(r)[:200]); rc, r = run(fb + ['--name', name, '--tag', tag, '--cap', cap])
        if 'id' in r: created.append({'kind': kind, 'id': r['id'], 'prompt': pr, 'mv': mv, 'i3d_ok': (not mv) and k in ok_idx})
        else: log(name, 'CREATE FAILED', rc, json.dumps(r)[:300])
    res = []
    def w(c):
        rc, r = run(['wait', c['id'], '--kind', c['kind'], '--name', name, '--thumb-only', '--timeout', '5400'])
        return {**c, 'status': r.get('status'), 'dir': r.get('dir'), 'files': r.get('files'), 'error': r.get('error')}
    with ThreadPoolExecutor(len(created) or 1) as ex: res = list(ex.map(w, created))
    for i, r in enumerate(res): r['i'] = i
    json.dump(res, open(os.path.join(out, 'candidates.json'), 'w'), indent=1)
    imgs = []
    for r in res:
        if r.get('status') != 'SUCCEEDED': continue
        for f in (r.get('files') or []):
            if f.endswith('.png'): imgs.append(os.path.join(r['dir'], f))
    if imgs: subprocess.run([sys.executable, '-I', os.path.join(M, 'bin', 'contact.py'), os.path.join(out, 'contact.png')] + imgs, capture_output=True)
    log(name, meth, f'{sum(1 for r in res if r.get("status") == "SUCCEEDED")}/{len(reqs)} candidates')

jobs = [(g, a) for g in plan['groups'] for a in g['assets'] if not only or a['name'] in only]
with ThreadPoolExecutor(workers) as ex: list(ex.map(lambda ga: job(*ga), jobs))
log('spent', run(['spent'])[1])
