#!/usr/bin/env python3
"""archive_full.py <worktree> [--push]: the full-resolution archive of the Meshy asset library on the orphan branch meshy-models-full.

Reads the repo package's manifest (assets/meshy/manifest.json, written by assemble.py) and syncs the worktree (already on the branch):
  <group>/<asset>/<asset>.glb                the final model's full-resolution Meshy GLB (texture inside); a pilot model from gen/dl
  <group>/<asset>/<asset>__<variant>.glb     a variant's full-resolution Meshy GLB (the variants ship sprites too)
  <group>/<asset>/compact/<file>.glb         compact sprite-source GLBs that are not in the main package (over its 80 MB budget, the
                                             p2new sprite-grade imports, recipe helper models), as the manifest's archive_file says
  <group>/<asset>/<asset>[_<variant>]_rigged_character.glb / .fbx, _walking, _running   each rig task's output (a rig made from a
                                             variant model carries the variant key, e.g. miner_hauer_c0_...)
  <group>/<asset>/<asset>[_<variant>]_anim<n>.glb / .fbx   the animation packs, n = the order of tasks.animations
  g8/<asset>/edited/<file>.glb               the edited animation GLBs the character atlases were rendered from (motion / texture edits)
  README.md                                  the index: every file with its Meshy task id, and the edits
Files that are already there and unchanged are left alone; files no longer produced are removed. Then one commit (and with --push a
push to origin). No signed URLs and no task.json files go in. Never reads .key / .auth_header."""
import json, os, shutil, subprocess, sys, time

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # .../scratchpad/meshy
SP = os.path.dirname(M) + '/'
MAN = '/home/user/DOOM/assets/meshy/manifest.json'
BRANCH = 'meshy-models-full'
TRAILER = ('\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
           'Claude-Session: https://claude.ai/code/session_01BxPhLPzjPdV5FidnLnuZWi')
WT = sys.argv[1]
PUSH = '--push' in sys.argv
m = json.load(open(MAN))
git = lambda *a: subprocess.run(['git', '-C', WT, *a], capture_output=True, text=True)


def src_path(p):
    """a manifest path ('meshy/...') -> the working file."""
    return os.path.join(M, p[len('meshy/'):]) if p.startswith('meshy/') else os.path.join(SP, p)


want = {}                                                   # relpath -> source file


def add(src, rel, rows, note):
    if os.path.exists(src) and rel not in want:
        want[rel] = src
        rows.append((rel, os.path.getsize(src), note))


index = []
for a in m['assets']:
    g, n, t = a['group'], a['name'], a['tasks']
    rows, ids = [], []
    base = '%s/%s/' % (g, n)
    fm = t.get('final_model')
    pilot = 'Pilot model' in (a.get('notes') or '')
    if fm and fm.get('local_copy'):
        d = src_path(fm['local_copy']); ids.append('%s %s' % (fm.get('kind'), fm.get('id')))
        if os.path.exists(os.path.join(d, 'model.glb')):
            add(os.path.join(d, 'model.glb'), base + n + '.glb', rows, 'model (GLB, texture inside)')
        elif os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith(('.obj', '.mtl', '.png')):
                    add(os.path.join(d, f), base + f, rows, 'model (OBJ)')
    elif fm and pilot:
        ids.append('%s %s (pilot)' % (fm.get('kind'), fm.get('id')))
        add(os.path.join(M, 'gen', 'dl', n + '.glb'), base + n + '.glb', rows,
            'pilot model (GLB)' + ('; dropped by the judge, kept for reference only' if a['status'] == 'dropped' else ''))
    for v in t.get('variants', []):
        vt = v.get('task') or {}
        if v.get('full_res_archive_file') and vt.get('local_copy'):
            ids.append('%s %s (variant %s)' % (vt.get('kind'), vt.get('id'), v['key']))
            add(os.path.join(src_path(vt['local_copy']), 'model.glb'), v['full_res_archive_file'], rows,
                'variant %s model (GLB, texture inside)' % v['key'])
        if v.get('archive_file') and v.get('compact_glb'):
            add(src_path(v['compact_glb']), v['archive_file'], rows, 'compact variant GLB (sprite source; over the main package\'s size budget)')
    for sm in a.get('sprite_models') or []:
        if sm.get('archive_file'):
            add(src_path(sm['compact_glb']), sm['archive_file'], rows, 'compact sprite model %s' % sm['model'])
        if sm.get('kit_archive_file'):
            add(src_path(sm['kit_glb']), sm['kit_archive_file'], rows, 'compact Unreal kit piece of %s' % sm['model'])
    vkey = {v['task']['id']: v['key'] for v in t.get('variants', []) if v.get('task')}
    rig_key = {}
    for r in t.get('rig') or []:
        if not r.get('local_copy'):
            continue
        k = '' if r.get('model') == (fm or {}).get('id') else vkey.get(r.get('model'), r['id'][:8])
        rig_key[r['id']] = k
        d = src_path(r['local_copy']); ids.append('rig %s%s' % (r['id'], ' (variant %s)' % k if k else ''))
        stem = n + ('_' + k if k else '')
        for f, note in (('rigged_character.glb', 'rigged (GLB)'), ('rigged_character.fbx', 'rigged (FBX)'), ('walking.glb', 'walk (GLB)'),
                        ('walking.fbx', 'walk (FBX)'), ('running.glb', 'run (GLB)'), ('running.fbx', 'run (FBX)')):
            add(os.path.join(d, f), base + stem + '_' + f, rows, note + (' of variant ' + k if k else ''))
    for i, an in enumerate(t.get('animations') or []):
        if not an.get('local_copy'):
            continue
        k = rig_key.get(an.get('rig'), '')
        d = src_path(an['local_copy']); ids.append('anim %s' % an.get('id'))
        clips = ', '.join(x.get('name', '') for x in (an.get('actions') or []))
        for f in ('animation.glb', 'animation.fbx'):
            add(os.path.join(d, f), base + '%s%s_anim%d%s' % (n, '_' + k if k else '', i + 1, os.path.splitext(f)[1]), rows,
                'animations (unedited Meshy)%s: %s' % (' on variant ' + k if k else '', clips))
    for e in (a.get('character') or {}).get('edited_glbs') or []:
        what = '; '.join('%s (%s, %g-%g s)' % (c['clip'], ', '.join(c['bones']), c['window_s'][0], c['window_s'][1])
                         for c in e['motion_edits'])
        if e['texture_repainted']:
            what = (what + '; ' if what else '') + 'texture repainted'
        add(src_path(e['working_copy']), e['archive_path'], rows,
            'EDITED copy of %s %s %s: %s' % (e['made_from']['kind'], e['made_from']['task'], e['made_from']['file'], what))
    index.append((g, n, a.get('name_pl') or '', a['status'], rows, ids, a))

# sync the tree
have = set()
for dp, dn, fs in os.walk(WT):
    if '.git' in dp.split(os.sep):
        continue
    dn[:] = [x for x in dn if x != '.git']
    for f in fs:
        rel = os.path.relpath(os.path.join(dp, f), WT)
        if rel not in ('README.md', '.git'):
            have.add(rel)
added, changed, removed = 0, 0, 0
for rel, src in sorted(want.items()):
    dst = os.path.join(WT, rel)
    if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src):
        with open(dst, 'rb') as a_, open(src, 'rb') as b_:
            if a_.read() == b_.read():
                continue
        changed += 1
    else:
        added += 0 if os.path.exists(dst) else 1
        changed += 1 if os.path.exists(dst) else 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
for rel in sorted(have - set(want)):
    os.remove(os.path.join(WT, rel)); removed += 1

# README
L = ['# Meshy full-resolution archive (Grube Kattowitz III)', '',
     'Full-resolution outputs of the Meshy asset library: the final model of every asset and of every variant (GLB, texture inside);',
     'for the rigged characters every rig (rigged model, Meshy\'s walk and run) and every animation pack, GLB and FBX; and the edited',
     'animation GLBs the character atlases were rendered from. Meshy keeps image-to-3D, text-to-image, rigging and animation results for',
     '72 hours only; this branch keeps them. `compact/` folders hold the compact sprite-source GLBs that did not fit the main package.',
     'Not here: concepts, previews and the other candidates (their task ids and prompts are in the manifest). The compact models, the',
     'pixel sprites, the manifest (prompts, task ids, judge notes) and the tools are on the main branch in `assets/meshy/`; its README',
     'explains the sprite contract and the Unreal import.', '',
     'Scale: metres as Meshy exported them (see the manifest\'s size_m / height_m for the level\'s real sizes). Unreal: 1 m = 100 uu.', '',
     '## Edited animations', '',
     'The Meshy packs here (`*_anim<n>`, `*_walking`, `*_running`, `*_rigged_character`) are unedited. Some atlas clips were rendered',
     'from edited copies, kept in `g8/<character>/edited/`: an empty arm that a clip thrusts forward or raises with an open hand (the',
     'salute-like silhouette the atlases avoid) is slerped toward a calm pose of the same rig (`armfix.py`), and the courier\'s texture has',
     'her belt painted in (`texpaint.py`). Rig, mesh and clip names are unchanged, so for these clips import the edited GLB instead of',
     'the pack. The tools and specs are in `assets/meshy/tools/edits/` on the main branch.', '',
     '| character | edited file | made from | edit |', '|---|---|---|---|']
for g, n, pl, st, rows, ids, a in index:
    for e in (a.get('character') or {}).get('edited_glbs') or []:
        what = '<br>'.join('`%s` -> atlas %s: %s, %g-%g s, up to %g deg (`%s`)' % (
            c['clip'], ', '.join('`%s`' % r for r in c['atlas_rows']) or '-', ', '.join(c['bones']), c['window_s'][0], c['window_s'][1],
            c['max_change_deg'], ', '.join(os.path.basename(s) for s in c['spec'])) for c in e['motion_edits'])
        if e['texture_repainted']:
            what = (what + '<br>' if what else '') + 'texture repainted (the belt)'
        L.append('| %s | `%s` %.1f MB | %s %s `%s` | %s |' % (n, os.path.relpath(e['archive_path'], g), e['bytes'] / 2 ** 20,
                                                         e['made_from']['kind'], e['made_from']['task'], e['made_from']['file'], what))
L += ['', '## Index', '', '| group | asset | status | files | Meshy tasks |', '|---|---|---|---|---|']
for g, n, pl, st, rows, ids, a in index:
    if rows:
        files = '<br>'.join('`%s` %.1f MB%s' % (os.path.relpath(r[0], g), r[1] / 2 ** 20, ' (edited)' if '/edited/' in r[0] else '')
                            for r in rows)
    elif a.get('repo_files_elsewhere'):
        files = '(the owner\'s model: in the main branch at `%s`)' % a['repo_files_elsewhere'][0]
    else:
        files = '(no full-resolution file)'
    L.append('| %s | %s%s | %s | %s | %s |' % (g, n, ' (' + pl + ')' if pl else '', st, files, '<br>'.join(ids)))
open(os.path.join(WT, 'README.md'), 'w').write('\n'.join(L) + '\n')
tot = sum(os.path.getsize(os.path.join(WT, r)) for r in want)
print('archive: %d files, %.0f MB; added %d, changed %d, removed %d' % (len(want), tot / 2 ** 20, added, changed, removed), flush=True)

git('add', '-A')
if git('status', '--porcelain').stdout.strip():
    msg = sys.argv[sys.argv.index('--message') + 1] if '--message' in sys.argv else 'Meshy full-resolution archive: sync with the manifest'
    c = git('commit', '-q', '-m', msg + TRAILER)
    print('commit', c.returncode, c.stderr[-300:], flush=True)
    if PUSH:
        for i in range(5):
            p = git('push', 'origin', BRANCH)
            if p.returncode == 0:
                print('pushed', flush=True)
                break
            print('push failed, retry', i, p.stderr[-300:], flush=True)
            time.sleep(2 ** (i + 1))
else:
    print('nothing to commit', flush=True)
