#!/usr/bin/env python3
"""Stage C: turn the picked candidates into textured models, all at once. picks.json = [{name, tag, cap, action, ...}]:
  {action: 'refine', pick: i, texture_prompt?}                 text-to-3D refine of candidate i (a T3D preview)
  {action: 'i3d', picks: [i, j], mi3d_pick?: k, texture_prompt?}
                                                               image-to-3D from concept i (and j: a second model); mi3d_pick k
                                                               also runs multi-image-to-3D on multi-view candidate k (its images)
  {action: 'mi3d', pick: i, texture_prompt?}                   multi-image-to-3D from multi-view concept i (its 3 images)
  {action: 'char', pick: i, height: 1.8, actions: [ids]}       image-to-3D (A-pose) -> rig -> animation pack (<= 10 action ids)
  {action: 'char', picks: [i, j], mi3d_pick?: k}               two A-pose models (I3D from concepts i, j; MI3D from the multi-view
                                                               set k) - then a pick, then char_rig
  {action: 'char_rig', model: k, height, actions: [ids]}       rig final.json's output k and animate it (writes final_rig.json)
  {action: 'none'}                                             nothing (all candidates rejected; pass 2 decides)
The PLAN (--plan, default meshy/plan/plan.json) supplies per asset: geo ('2k' -> --geo 2k on i3d / mi3d; never for characters),
texture_prompt (used for 'refine' when the pick has none; for i3d / mi3d / char ONLY the pick's own texture_prompt is sent, because a
texture prompt makes Meshy texture from the text instead of the concept image), height_m (rig height when the pick has none) and
actions (when the pick has none). A concept whose candidate has i3d_ok false (a front / side elevation kept as the judge's reference, or
a multi-view set) is refused for i3d / char. Writes lib/<name>/final.json ({action, outputs: [{kind, id, dir, files, from}]}); skips
names whose final.json exists unless --force. usage: batch_c.py picks.json [--plan plan.json] [--only a,b] [--force] [--workers 24]"""
import json, os, subprocess, sys, threading, glob
from concurrent.futures import ThreadPoolExecutor

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); MK = [sys.executable, '-I', os.path.join(M, 'mk.py')]; LIB = os.path.join(M, 'lib')
picks = json.load(open(sys.argv[1])); only = None; force = '--force' in sys.argv; workers = 24
if '--only' in sys.argv: only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
if '--workers' in sys.argv: workers = int(sys.argv[sys.argv.index('--workers') + 1])
PLAN = sys.argv[sys.argv.index('--plan') + 1] if '--plan' in sys.argv else os.path.join(M, 'plan', 'plan.json')
_pl = json.load(open(PLAN)) if os.path.exists(PLAN) else {'groups': []}
ASSET = {a['name']: a for g in (_pl['groups'] if isinstance(_pl, dict) else _pl) for a in g['assets']}
pl = threading.Lock()
def log(*a):
    with pl: print(*a, flush=True)
def run(args):
    p = subprocess.run(MK + args, capture_output=True, text=True)
    try: return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])
    except Exception: return p.returncode, {'raw': p.stdout[-300:], 'err': p.stderr[-300:]}
def make(name, tag, cap, kind, args, wait_kind=None, fallback=None):
    rc, r = run([kind] + args + ['--name', name, '--tag', tag, '--cap', str(cap)])
    if 'id' not in r and fallback is not None and rc == 4:
        log(name, kind, 'retry without', json.dumps(r)[:200]); rc, r = run([kind] + fallback + ['--name', name, '--tag', tag, '--cap', str(cap)])
    if 'id' not in r: log(name, kind, 'CREATE FAILED', json.dumps(r)[:300]); return None
    rc, w = run(['wait', r['id'], '--kind', wait_kind or kind, '--name', name, '--timeout', '7200'])
    out = {'kind': kind, 'id': r['id'], 'status': w.get('status'), 'dir': w.get('dir'), 'files': w.get('files'), 'error': w.get('error')}
    log(name, kind, out['status'], out['dir']); return out

def job(p):
    name = p['name']; d = os.path.join(LIB, name); fin = os.path.join(d, 'final.json'); a = ASSET.get(name, {})
    if os.path.exists(fin) and not force and p.get('action') != 'char_rig': log(name, 'final exists'); return
    cands = json.load(open(os.path.join(d, 'candidates.json'))) if os.path.exists(os.path.join(d, 'candidates.json')) else []
    C = lambda i: cands[i]
    tag, cap, act = p['tag'], p['cap'], p['action']
    tp_pick = ['--texture-prompt', p['texture_prompt']] if p.get('texture_prompt') else []
    tp_plan = ['--texture-prompt', a['texture_prompt']] if a.get('texture_prompt') else []
    geo = ['--geo', '2k'] if a.get('geo') == '2k' else []
    height = str(p.get('height') or a.get('height_m') or 1.8)
    actions = p.get('actions') or a.get('actions') or []
    def view_ok(i):
        c = C(i)
        if c.get('mv') or c.get('i3d_ok') is False:
            log(name, f'REFUSED concept {i}: an elevation (judge reference only) or a multi-view set - pick a three-quarter concept'); return False
        return True
    def mv_images(k):
        c = C(k)
        if not c.get('mv'): log(name, f'note: mi3d_pick {k} is not a multi-view candidate (using its images anyway)')
        return sorted(glob.glob(os.path.join(c['dir'], 'image_*.png')))[:4]
    outs = []
    if act == 'refine':
        o = make(name, tag, cap, 'refine', ['--preview', C(p['pick'])['id']] + (tp_pick or tp_plan)); outs.append({**(o or {}), 'from': p['pick']})
    elif act == 'i3d' or (act == 'char' and (p.get('picks') or p.get('mi3d_pick') is not None)):
        ch = act == 'char'; pose = ['--pose', 'a-pose'] if ch else []
        ids = [i for i in (p.get('picks') or ([p['pick']] if p.get('pick') is not None else [])) if view_ok(i)]
        tasks = [('i3d', i, ['--image-task', C(i)['id']] + pose + ([] if ch else geo) + tp_pick, None) for i in ids]
        if p.get('mi3d_pick') is not None:
            k = p['mi3d_pick']; base = ['--images'] + mv_images(k) + ([] if ch else geo) + tp_pick
            tasks.append(('mi3d', k, base + pose, base if pose else None))
        with ThreadPoolExecutor(4) as ex:
            rs = list(ex.map(lambda t: make(name, tag, cap, t[0], t[2], fallback=t[3]), tasks))
        outs += [{**(o or {}), 'from': t[1]} for o, t in zip(rs, tasks)]
    elif act == 'mi3d':
        o = make(name, tag, cap, 'mi3d', ['--images'] + mv_images(p['pick']) + geo + tp_pick); outs.append({**(o or {}), 'from': p['pick']})
    elif act == 'char_rig':                                    # rig output `model` of final.json's runs, then its animation pack
        prev = json.load(open(fin_char)) if os.path.exists(fin_char := os.path.join(d, 'final.json')) else None
        if not prev: log(name, 'char_rig: no final.json (run the char picks first)'); return
        o = prev['outputs'][p['model']]; fin = os.path.join(d, 'final_rig.json')
        if os.path.exists(fin) and not force: log(name, 'final_rig exists'); return
        rg = make(name, tag, cap, 'rig', ['--task', o['id'], '--height', height]); outs.append({**(rg or {}), 'model': p['model']})
        if (not rg or rg.get('status') != 'SUCCEEDED') and o.get('kind') == 'mi3d':
            log(name, 'rig of the MI3D model failed: rig an I3D output instead (char_rig with its model index)')
        if rg and rg['status'] == 'SUCCEEDED' and actions:
            ids = [int(x) for x in actions][:10]
            an = make(name, tag, cap, 'anim', ['--rig', rg['id'], '--actions', ','.join(map(str, ids))]); outs.append({**(an or {}), 'actions': ids})
    elif act == 'char':
        if not view_ok(p['pick']): return
        o = make(name, tag, cap, 'i3d', ['--image-task', C(p['pick'])['id'], '--pose', 'a-pose'] + tp_pick); outs.append({**(o or {}), 'from': p['pick']})
        if o and o['status'] == 'SUCCEEDED':
            rg = make(name, tag, cap, 'rig', ['--task', o['id'], '--height', height]); outs.append(rg or {})
            if rg and rg['status'] == 'SUCCEEDED' and actions:
                ids = [int(x) for x in actions][:10]
                an = make(name, tag, cap, 'anim', ['--rig', rg['id'], '--actions', ','.join(map(str, ids))]); outs.append({**(an or {}), 'actions': ids})
    json.dump({'action': act, 'pick': p, 'outputs': outs}, open(fin, 'w'), indent=1)

todo = [p for p in picks if p.get('action') != 'none' and (not only or p['name'] in only)]
with ThreadPoolExecutor(workers) as ex: list(ex.map(job, todo))
log('spent', run(['spent'])[1])
