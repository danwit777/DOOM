#!/usr/bin/env python3
"""Meshy API client with a hard credit budget and a shared ledger. The only way agents touch the Meshy API.

The key never leaves ../meshy/.key (sent to curl through a 0600 header file; never printed). Every create call is checked
under a file lock: the ledger's spend (actual credits once a task finished, else the estimate) + this call's estimate must
stay under the global cap (caps.json "global") and under --cap for --tag (a group's allowance), and the live balance must
cover it. Failed tasks are refunded by Meshy; `wait` writes the actual consumed_credits back to the ledger.

  mk.py balance                                   live balance (JSON)
  mk.py spent [--tag T]                           ledger spend: total, per tag, per kind
  mk.py t3d   --name N --tag T --cap C --prompt P [--model latest|meshy-6|meshy-6-lite] [--poly 40000] [--seed S] [--pose a-pose|t-pose]
  mk.py refine --name N --tag T --cap C --preview ID [--texture-prompt P] [--tex 2k|4k]
  mk.py t2i   --name N --tag T --cap C --prompt P [--model nano-banana-pro] [--aspect 1:1] [--multi-view] [--remove-bg] [--pose a-pose]
  mk.py i3d   --name N --tag T --cap C (--image-task ID | --image FILE.png) [--texture-prompt P] [--poly 40000] [--pose a-pose] [--geo standard|2k]
  mk.py mi3d  --name N --tag T --cap C --images F1 F2 [F3 F4] [--texture-prompt P] [--poly 40000] [--pose a-pose]
  mk.py rig   --name N --tag T --cap C --task ID [--height 1.8]
  mk.py anim  --name N --tag T --cap C --rig ID --actions 1,2,3        (3 credits per action, max 10)
  mk.py library [--search walk] [--category WalkAndRun]                 (free)
  mk.py wait  ID --kind t3d|refine|t2i|i3d|mi3d|rig|anim --name N [--timeout 3600] [--thumb-only]
        polls until done; downloads into lib/<name>/<kind>-<id8>/ (task.json, model.glb / .obj / .mtl, the base colour
        texture under the name the .mtl uses, thumb.png; images for t2i; rigged / animation GLB + FBX); prints the dir.
Create calls print {"id": ..., "est": ...}. Exit code 3 = refused by the budget, 4 = API error.
"""
import fcntl, json, os, subprocess, sys, time, base64, argparse, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, 'lib'); os.makedirs(LIB, exist_ok=True)
LEDGER, LOCK, CAPS = os.path.join(LIB, 'ledger.jsonl'), os.path.join(LIB, '.lock'), os.path.join(LIB, 'caps.json')
API = 'https://api.meshy.ai/openapi'
EP = {'t3d': '/v2/text-to-3d', 'refine': '/v2/text-to-3d', 't2i': '/v1/text-to-image', 'i3d': '/v1/image-to-3d',
      'mi3d': '/v1/multi-image-to-3d', 'rig': '/v1/rigging', 'anim': '/v1/animations'}
T2I_COST = {'nano-banana': 3, 'nano-banana-2': 6, 'nano-banana-2-lite': 3, 'nano-banana-pro': 9, 'gpt-image-2': 9}


def hdr_file():
    f = os.path.join(HERE, '.auth_header')
    if not os.path.exists(f):
        key = open(os.path.join(HERE, '.key')).read().strip()
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.write(fd, ('Authorization: Bearer ' + key + '\n').encode()); os.close(fd)
    return f


def curl(method, path, body=None, retries=40):
    """JSON API call; retries on 429 (rate: Retry-After; queue full: 20 s) and on transport errors."""
    for attempt in range(retries):
        args = ['curl', '-sS', '-X', method, API + path, '-H', '@' + hdr_file(), '-H', 'Content-Type: application/json',
                '-w', '\n%{http_code}', '-D', '-']
        tmp = None
        if body is not None:
            tmp = tempfile.NamedTemporaryFile('w', delete=False, suffix='.json', dir=LIB); json.dump(body, tmp); tmp.close()
            args += ['--data-binary', '@' + tmp.name]
        p = subprocess.run(args, capture_output=True, text=True)
        if tmp: os.unlink(tmp.name)
        if p.returncode != 0:
            time.sleep(min(60, 2 ** min(attempt, 5))); continue
        out = p.stdout.rsplit('\n', 1); code = int(out[1]) if len(out) == 2 and out[1].isdigit() else 0
        head, _, text = out[0].replace('\r\n', '\n').partition('\n\n')
        while text.startswith('HTTP/'):                      # 100-continue etc.
            head, _, text = text.partition('\n\n')
        try: data = json.loads(text) if text.strip() else {}
        except ValueError: data = {'raw': text[:500]}
        if code == 429:
            ra = [l.split(':', 1)[1].strip() for l in head.split('\n') if l.lower().startswith('retry-after:')]
            wait = float(ra[0]) if ra else 20
            sys.stderr.write(f'429 {data.get("message", "")}: waiting {wait:.0f} s\n'); time.sleep(wait); continue
        if code >= 500:
            time.sleep(min(60, 2 ** min(attempt, 5))); continue
        return code, data
    return 0, {'message': 'gave up after retries'}


def ledger():
    rows, upd = [], {}
    if os.path.exists(LEDGER):
        for l in open(LEDGER):
            r = json.loads(l)
            if r.get('update'): upd[r['id']] = r['actual']
            else: rows.append(r)
    for r in rows:
        if r['id'] in upd: r['actual'] = upd[r['id']]
    return rows


def spend(rows, tag=None):
    return sum((r['actual'] if r.get('actual') is not None else r['est']) for r in rows if tag is None or r['tag'] == tag)


def balance():
    code, d = curl('GET', '/v1/balance')
    return d.get('balance', 0) if code == 200 else 0


def create(kind, name, tag, cap, est, body):
    with open(LOCK, 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        rows = ledger(); caps = json.load(open(CAPS)) if os.path.exists(CAPS) else {}
        g = caps.get('global')
        if g is None: return refuse('no global cap set in lib/caps.json')
        if spend(rows) + est > g: return refuse(f'global cap: spent {spend(rows)} + {est} > {g}')
        if cap is not None and spend(rows, tag) + est > cap: return refuse(f'tag {tag} cap: spent {spend(rows, tag)} + {est} > {cap}')
        b = balance()
        if b < est: return refuse(f'balance {b} < {est}')
        code, d = curl('POST', EP[kind], body)
        if code not in (200, 202) or not d.get('result'):
            print(json.dumps({'error': code, 'detail': d})); sys.exit(4)
        tid = d['result']
        with open(LEDGER, 'a') as f:
            f.write(json.dumps({'t': int(time.time()), 'tag': tag, 'name': name, 'kind': kind, 'id': tid, 'est': est,
                                'body': {k: (v if not (isinstance(v, str) and v.startswith('data:')) else 'data-uri') for k, v in body.items()}}) + '\n')
    print(json.dumps({'id': tid, 'est': est}))


def refuse(msg):
    print(json.dumps({'refused': msg})); sys.exit(3)


def data_uri(path):
    ext = os.path.splitext(path)[1].lower().lstrip('.'); ext = 'jpeg' if ext == 'jpg' else ext
    return f'data:image/{ext};base64,' + base64.b64encode(open(path, 'rb').read()).decode()


def dl(url, path):
    for attempt in range(6):
        p = subprocess.run(['curl', '-sS', '-L', '-o', path, url], capture_output=True)
        if p.returncode == 0 and os.path.getsize(path) > 0: return True
        time.sleep(2 ** attempt)
    return False


def wait(tid, kind, name, timeout, thumb_only=False):
    t0 = time.time()
    while True:
        code, d = curl('GET', EP[kind] + '/' + tid)
        st = d.get('status')
        if st in ('SUCCEEDED', 'FAILED', 'CANCELED'): break
        if time.time() - t0 > timeout: print(json.dumps({'timeout': tid, 'status': st, 'progress': d.get('progress')})); sys.exit(5)
        time.sleep(10)
    with open(LOCK, 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        with open(LEDGER, 'a') as f: f.write(json.dumps({'update': True, 'id': tid, 'actual': d.get('consumed_credits', 0) or 0, 'status': st}) + '\n')
    out = os.path.join(LIB, name, f'{kind}-{tid}'); os.makedirs(out, exist_ok=True)
    json.dump(d, open(os.path.join(out, 'task.json'), 'w'), indent=1)
    if st != 'SUCCEEDED':
        print(json.dumps({'status': st, 'error': d.get('task_error'), 'dir': out})); sys.exit(4)
    files = []
    mu = d.get('model_urls') or {}
    for k, fn in (('glb', 'model.glb'), ('obj', 'model.obj'), ('mtl', 'model.mtl'), ('fbx', 'model.fbx')):
        if mu.get(k) and not thumb_only and (k != 'fbx' or kind in ('rig', 'anim')):
            if dl(mu[k], os.path.join(out, fn)): files.append(fn)
    tex = d.get('texture_urls') or []
    tex = tex[0] if isinstance(tex, list) and tex else (tex if isinstance(tex, dict) else {})
    if tex.get('base_color') and not thumb_only:
        tname = 'texture_0.png'
        mtl = os.path.join(out, 'model.mtl')
        if os.path.exists(mtl):
            for l in open(mtl):
                if l.strip().startswith('map_Kd'): tname = l.strip().split(None, 1)[1]
        if dl(tex['base_color'], os.path.join(out, tname)): files.append(tname)
    if d.get('thumbnail_url') and dl(d['thumbnail_url'], os.path.join(out, 'thumb.png')): files.append('thumb.png')
    for v, u in (d.get('thumbnail_urls') or {}).items():
        if dl(u, os.path.join(out, f'thumb_{v}.png')): files.append(f'thumb_{v}.png')
    for i, u in enumerate(d.get('image_urls') or []):
        if dl(u, os.path.join(out, f'image_{i}.png')): files.append(f'image_{i}.png')
    res = d.get('result') if isinstance(d.get('result'), dict) else d
    for k in ('rigged_character_glb_url', 'rigged_character_fbx_url', 'animation_glb_url', 'animation_fbx_url'):
        if res.get(k):
            fn = k.replace('_url', '').replace('_glb', '.glb').replace('_fbx', '.fbx')
            if dl(res[k], os.path.join(out, fn)): files.append(fn)
    for k, u in (res.get('basic_animations') or {}).items():
        if isinstance(u, str) and u.startswith('http'):
            fn = k.replace('_url', '').replace('_glb', '.glb').replace('_fbx', '.fbx')
            if dl(u, os.path.join(out, fn)): files.append(fn)
    print(json.dumps({'status': st, 'dir': out, 'files': files, 'credits': d.get('consumed_credits')}))


def main():
    a = argparse.ArgumentParser(); a.add_argument('cmd'); a.add_argument('id', nargs='?')
    for o in ('name', 'tag', 'prompt', 'model', 'seed', 'pose', 'preview', 'texture-prompt', 'tex', 'aspect', 'image-task', 'image',
              'task', 'rig', 'actions', 'search', 'category', 'kind', 'geo'):
        a.add_argument('--' + o)
    a.add_argument('--cap', type=float); a.add_argument('--poly', type=int, default=40000); a.add_argument('--height', type=float, default=1.8)
    a.add_argument('--images', nargs='+'); a.add_argument('--multi-view', action='store_true'); a.add_argument('--remove-bg', action='store_true')
    a.add_argument('--timeout', type=float, default=3600); a.add_argument('--thumb-only', action='store_true')
    o = a.parse_args(); c = o.cmd
    need = lambda *ks: [refuse('missing --' + k) for k in ks if getattr(o, k.replace('-', '_')) in (None, '')]
    if c in ('t3d', 'refine', 't2i', 'i3d', 'mi3d', 'rig', 'anim'): need('name', 'tag', 'cap')
    if c == 'balance':
        code, d = curl('GET', '/v1/balance'); print(json.dumps(d))
    elif c == 'spent':
        rows = ledger(); by_tag, by_kind = {}, {}
        for r in rows:
            v = r['actual'] if r.get('actual') is not None else r['est']
            by_tag[r['tag']] = by_tag.get(r['tag'], 0) + v; by_kind[r['kind']] = by_kind.get(r['kind'], 0) + v
        print(json.dumps({'total': spend(rows), 'tag': (spend(rows, o.tag) if o.tag else None), 'by_tag': by_tag, 'by_kind': by_kind,
                          'tasks': len(rows), 'pending': sum(1 for r in rows if r.get('actual') is None)}))
    elif c == 't3d':
        need('prompt'); m = o.model or 'latest'
        body = {'mode': 'preview', 'prompt': o.prompt[:600], 'ai_model': m, 'target_formats': ['glb', 'obj'], 'should_remesh': True,
                'topology': 'triangle', 'target_polycount': o.poly, 'origin_at': 'bottom'}
        if o.seed: body['seed'] = int(o.seed)
        if o.pose: body['pose_mode'] = o.pose
        create('t3d', o.name, o.tag, o.cap, 5 if m in ('meshy-6-lite', 'meshy-t2') else 20, body)
    elif c == 'refine':
        need('preview')
        body = {'mode': 'refine', 'preview_task_id': o.preview, 'texture_resolution': o.tex or '2k', 'enable_pbr': False,
                'target_formats': ['glb', 'obj'], 'origin_at': 'bottom'}
        if o.texture_prompt: body['texture_prompt'] = o.texture_prompt[:600]
        create('refine', o.name, o.tag, o.cap, 15 if o.tex == '8k' else 10, body)
    elif c == 't2i':
        need('prompt'); m = o.model or 'nano-banana-pro'
        body = {'ai_model': m, 'prompt': o.prompt}
        if o.multi_view: body['generate_multi_view'] = True
        elif o.aspect: body['aspect_ratio'] = o.aspect
        if o.remove_bg: body['remove_background'] = True
        if o.pose: body['pose_mode'] = o.pose
        create('t2i', o.name, o.tag, o.cap, T2I_COST.get(m, 9) * (3 if o.multi_view else 1), body)
    elif c in ('i3d', 'mi3d'):
        body = {'ai_model': o.model or 'latest', 'should_texture': True, 'enable_pbr': False, 'should_remesh': True, 'topology': 'triangle',
                'target_polycount': o.poly, 'target_formats': ['glb', 'obj'], 'image_enhancement': True}
        if o.pose: body['pose_mode'] = o.pose
        if o.texture_prompt: body['texture_prompt'] = o.texture_prompt[:800]
        if o.geo and o.geo != 'standard': body['geometry_resolution'] = o.geo
        est = 30 + (5 if o.geo and o.geo != 'standard' else 0)
        if c == 'i3d':
            if o.image_task: body['input_task_id'] = o.image_task
            elif o.image: body['image_url'] = data_uri(o.image)
            else: refuse('--image-task or --image needed')
        else:
            if not o.images or not 1 <= len(o.images) <= 4: refuse('--images: 1 to 4 files')
            body['image_urls'] = [data_uri(f) for f in o.images]
        create(c, o.name, o.tag, o.cap, est, body)
    elif c == 'rig':
        need('task'); create('rig', o.name, o.tag, o.cap, 5, {'input_task_id': o.task, 'height_meters': o.height})
    elif c == 'anim':
        need('rig', 'actions'); ids = [int(x) for x in o.actions.split(',') if x.strip()][:10]
        body = {'rig_task_id': o.rig, 'post_process': {'operation_type': 'change_fps', 'fps': 30}}
        if len(ids) == 1: body['action_id'] = ids[0]
        else: body['action_ids'] = ids
        create('anim', o.name, o.tag, o.cap, 3 * len(ids), body)
    elif c == 'library':
        q = '&'.join(f'{k}={v}' for k, v in (('search', o.search), ('category', o.category)) if v)
        code, d = curl('GET', '/v1/animations/library' + ('?' + q if q else ''))
        items = d if isinstance(d, list) else d.get('result', d.get('data', d))
        print(json.dumps([{k: it.get(k) for k in ('action_id', 'name', 'category', 'sub_category')} for it in items] if isinstance(items, list) else items))
    elif c == 'wait':
        need('kind', 'name'); wait(o.id, o.kind, o.name, o.timeout, o.thumb_only)
    else:
        refuse('unknown command ' + c)


if __name__ == '__main__':
    main()
