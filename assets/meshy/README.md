# Meshy asset library: Grube Kattowitz III

The 3D models, pixel sprites and characters generated with Meshy (the owner's Premium account) for the 1957 Upper Silesia level, in two passes: pass 1 generated 60 planned assets in eight groups (and reused 7 pilot and owner models), pass 2 re-rolled the weak ones and added 8 new assets and more animation packs. Every asset was judged by an independent reviewer (scores 0-10; verdict `ok` ships as it is, `fix` ships with the judge's open notes, `drop` does not ship). Built by `tools/bin/assemble.py`; `manifest.json` holds every detail. The full-resolution Meshy files are on the archive branch `meshy-models-full` (below).

## What is here

| Path | What |
|---|---|
| `manifest.json` | One entry per asset: group, pass, method, layer, size, status, judge score and notes, every Meshy task id (final model, its concept or preview, variants, replaced and rejected tries, candidates, rig, animation packs with action ids and names), the prompts, the credits, the files here. Plus totals, excluded tests and the plan items that were not generated. |
| `models/<asset>.glb` | The asset's final compact GLB (a kept pass-2 re-roll wins over pass 1): the model its sprites were rendered from, except where pass 2 replaced the model for Unreal and kept the pass-1 sprites (`conveyor_bridge_truss`, `industrial_chimney`; there the GLB is the pass-2 kit and `models/<asset>__sprite.glb` is the pass-1 GLB the sprites came from) and for the p2new assets (the GLB is the Unreal kit piece, float32 and welded, built from the same Meshy model as the sprite-grade import the sprites were rendered from). `sprite_models` in the manifest maps every sprite to its GLB. `models/<asset>__<variant>.glb`: a variant that also ships sprites, while the package stays under 80 MB. Characters have no file here (see Unreal notes). |
| `sprites/<group>.png` + `.json` | The sprite atlases exactly as the sprite tool wrote them (g1-g8, p2new). |
| `characters/<name>.png` + `.json` | The NPC atlases: every clip, right and left facing. |
| `tools/` | `mk.py` (the budget-guarded Meshy client), `bin/` (batch, sheet, palette, refetch, assemble and archive scripts, `setup_group.sh`), `ms_pilot.mjs` (the library variant of `level/tools/model_sprites.mjs`), `edits/` (the animation GLB edits behind the character atlases: `armfix.py` and its `af_*.json` specs, `texpaint.py` / `glbtex.py` and the courier's spec). |

Size: 79.1 MB in 130 files (70 GLBs). The full-resolution Meshy models are not here: they are on the archive branch (next section), and can be fetched again by task id while Meshy still holds them.

## The full-resolution archive branch

`origin/meshy-models-full` (an orphan branch, about 1 GB, kept out of the main history) holds the full-resolution Meshy output of every asset's final model and of every variant (GLB, texture inside), each character's rigs (rigged model, walk / run) and animation packs (GLB + FBX), the pilot model of the dropped ropeway_bucket, the edited animation GLBs the character atlases were rendered from (g8/<character>/edited/) and the compact sprite-source GLBs that are not in this package (<group>/<asset>/compact/, as each archive_file says); no concepts, previews or other candidates. Its `README.md` indexes every file with its Meshy task id. Fetch it on its own:

```sh
git fetch origin meshy-models-full && git worktree add ../meshy-full meshy-models-full
```

Layout: `<group>/<asset>/<asset>.glb` (the final model), `<asset>__<variant>.glb` (a variant's model; manifest `tasks.variants[].full_res_archive_file`), `compact/` (the compact GLBs of `sprite_models[].archive_file` and `tasks.variants[].archive_file`), and for each character `<asset>_rigged_character.glb / .fbx`, `_walking`, `_running`, `_anim<n>.glb / .fbx` (the animation packs in the order of `tasks.animations`; a variant rig and its packs carry the variant key, e.g. `miner_hauer_c0_rigged_character.glb`) and `edited/` (see "Edited animations"). Scale: metres as Meshy exported them.

## The assets

Status: **ok** ships; **fix** ships with the judge's open notes (paint / recipe changes, no credits); **reuse** is a pilot or owner model (shipped; its judge score and notes still apply); **dropped** is not shipped. Pass `1+2`: a pass-1 model with pass-2 animation packs.

### g1: A/B: Sperrzone, siding and ropeway props (playfield) + bucket v2 + pilot reuse

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `sign_board_posts` | ok | 8 | 1 | T3D | `models/sign_board_posts.glb` (1.49 x 3.38 x 0.27 m) | 70 |
| `sperrzone_fence_post` | ok | 8 | 2 | IMG | `models/sperrzone_fence_post.glb` (0.73 x 2.35 x 0.42 m) | 89 |
| `trench_revetment_panel` | ok | 8 | 2 | T3D | `models/trench_revetment_panel.glb` (1.83 x 2.74 x 0.32 m) | 70 |
| `rail_track_section` | ok | 8 | 1 | T3D | `models/rail_track_section.glb` (3.66 x 0.28 x 0.8 m) | 50 |
| `ropeway_loading_station` | ok | 8 | 2 | IMG | `models/ropeway_loading_station.glb` (2.74 x 1.83 x 1.59 m) | 112 |
| `searchlight_bracket` | ok | 8 | 1 | T3D | `models/searchlight_bracket.glb` (0.61 x 0.8 x 0.49 m) | 50 |
| `sandbag_nest` | ok | 8 | 1 | T3D | `models/sandbag_nest.glb` (0.63 x 0.29 x 0.32 m) | 90 |
| `guard_tower` | reuse | 7.5 | 1 | REUSE | `models/guard_tower.glb` (3.04 x 7.03 x 3.11 m) | pilot 30 |
| `ropeway_pylon` | reuse | 8 | 1 | REUSE | `models/ropeway_pylon.glb` (1.01 x 4.25 x 0.85 m) | pilot 30 |
| `ropeway_bucket_v2` | ok | 8.5 | 1 | IMG | `models/ropeway_bucket_v2.glb` (1.83 x 3.14 x 0.93 m) | 57 |
| `ropeway_bucket` | dropped | 5 | 1 | REUSE | - (2.07 x 2.4 x 1.97 m) | pilot 30 |

### g2: C: familok facade kit (front-elevation concepts, brick cut flush -> image-to-3D)

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `familok_window_segmental` | ok | 8.4 | 1 | IMG | `models/familok_window_segmental.glb` (1.17 x 1.84 x 0.43 m) | 87 |
| `familok_window_boarded` | ok | 8.2 | 1 | IMG | `models/familok_window_boarded.glb` (1.08 x 1.74 x 0.41 m) | 42 |
| `familok_attic_window` | ok | 8 | 1 | IMG | `models/familok_attic_window.glb` (0.47 x 0.4 x 0.17 m) | 42 |
| `familok_street_door` | ok | 8.3 | 1 | IMG | `models/familok_street_door.glb` (1.74 x 2.47 x 0.42 m) | 87 |
| `familok_cornice_segment` | ok | 8.6 | 1 | IMG | `models/familok_cornice_segment.glb` (2 x 0.34 x 0.3 m) | 42 |
| `familok_string_course` | ok | 8.5 | 1 | IMG | `models/familok_string_course.glb` (2 x 0.17 x 0.12 m) | 36 |
| `familok_stone_plinth` | ok | 8 | 1 | IMG | `models/familok_stone_plinth.glb` (2 x 0.34 x 0.25 m) | 36 |
| `familok_downpipe` | ok | 8.1 | 1 | IMG | `models/familok_downpipe.glb` (0.21 x 3.3 x 0.13 m) | 36 |
| `familok_roof_chimney` | ok | 8 | 1 | IMG | `models/familok_roof_chimney.glb` (0.59 x 1.03 x 0.59 m) | 42 |

### g3: C/D: colony and yard props, access kit (playfield)

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `wooden_crate` | ok | 8 | 1 | T3D | `models/wooden_crate.glb` (0.97 x 0.91 x 1.02 m) | 70 |
| `lattice_catwalk_section` | ok | 8.5 | 2 | IMG | `models/lattice_catwalk_section.glb` (3 x 1.3 x 0.96 m) | 137 |
| `steel_ladder_segment` | ok | 8 | 1 | T3D | `models/steel_ladder_segment.glb` (0.61 x 3.71 x 0.33 m) | 50 |
| `bicycle_roadster` | fix | 7 | 1 | T3D | `models/bicycle_roadster.glb` (1.8 x 1.18 x 0.62 m) | 70 |
| `park_bench` | ok | 8 | 1 | T3D | `models/park_bench.glb` (1.58 x 0.93 x 0.74 m) | 70 |
| `coal_bucket_zinc` | ok | 8 | 1 | T3D | `models/coal_bucket_zinc.glb` (0.43 x 0.38 x 0.42 m) | 50 |
| `coal_sacks_shovel` | fix | 6.5 | 1 | T3D | `models/coal_sacks_shovel.glb` (1.87 x 1 x 1.61 m) | 50 |
| `regime_banner_cloth` | ok | 8 | 1 | T3D | `models/regime_banner_cloth.glb` (1.96 x 3.67 x 0.3 m) | 70 |
| `steam_vent_nozzle` | fix | 7.5 | 1 | T3D | `models/steam_vent_nozzle.glb` (0.24 x 0.45 x 0.24 m) | 50 |
| `street_lamp` | reuse | 8 | 1 | REUSE | `models/street_lamp.glb` (1.42 x 4.23 x 0.82 m) | pilot 30 |

### g4: D/E: mining machinery and the winding-engine house (+ owner models)

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `shaft_cage_foerderkorb` | ok | 8 | 1 | IMG | `models/shaft_cage_foerderkorb.glb` (4.54 x 5.16 x 2.57 m) | 97 |
| `winding_engine_house` | fix | 7 | 1 | IMG | `models/winding_engine_house.glb` (10.84 x 7.6 x 5.22 m) | 106 |
| `winding_drum_engine` | ok | 8 | 1 | IMG | `models/winding_drum_engine.glb` (5.04 x 2.6 x 4.42 m) | 53 |
| `conveyor_head_drive` | fix | 6.5 | 1 | IMG | `models/conveyor_head_drive.glb` (3.61 x 1.2 x 0.91 m) | 101 |
| `conveyor_belt_section` | ok | 8 | 1 | T3D | `models/conveyor_belt_section.glb` (1.83 x 0.54 x 0.67 m) | 50 |
| `steel_belt_post` | ok | 8 | 1 | T3D | `models/steel_belt_post.glb` (1.03 x 2.74 x 1.03 m) | 50 |
| `headframe_sheave_wheel` | ok | 8 | 1 | T3D | `models/headframe_sheave_wheel.glb` (1.49 x 1.49 x 0.24 m) | 50 |
| `shaft_collar_guides` | fix | 7.5 | 2 | IMG | `models/shaft_collar_guides.glb` (5.13 x 2.79 x 0.79 m) | 84 |
| `headframe_owner` | reuse | 9 | 1 | REUSE | `level/models/headframe.glb` (4.13 x 7 x 0.93 m) | 0 |
| `railcar_owner` | reuse | 9 | 1 | REUSE | `level/models/railcar.glb` (2.13 x 1.5 x 0.95 m) | 0 |
| `barrel_owner` | reuse | 9 | 1 | REUSE | `level/models/barrel.glb` (0.54 x 0.88 x 0.54 m) | 0 |

### g5: Mid layer 0.6: colony houses, engine house, Siebhaus and yard

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `mid_familok_house` | fix | 7.8 | 1 | IMG | `models/mid_familok_house.glb` (9.27 x 8.5 x 6.21 m) | 87 |
| `colony_house_c1_tall` | fix | 7.4 | 1 | IMG | `models/colony_house_c1_tall.glb` (4.82 x 14.3 x 6.52 m) | 87 |
| `colony_house_c2_risalit` | fix | 7.6 | 1 | IMG | `models/colony_house_c2_risalit.glb` (8.33 x 12.5 x 4.85 m) | 87 |
| `colony_house_c3_hipped` | fix | 7.8 | 1 | IMG | `models/colony_house_c3_hipped.glb` (6.6 x 14.3 x 4.72 m) | 42 |
| `mid_engine_house_gabled` | ok | 8.2 | 1 | IMG | `models/mid_engine_house_gabled.glb` (7.93 x 11.2 x 7.59 m) | 48 |
| `screening_house_siebhaus` | ok | 8.2 | 1 | MI3D | `models/screening_house_siebhaus.glb` (11.73 x 12.9 x 4.3 m) | 96 |
| `conveyor_bridge_truss` | fix | 7 | 2 | T3D | `models/conveyor_bridge_truss.glb` (6.93 x 1.87 x 1.9 m) | 92 |
| `water_tower_steel` | ok | 8 | 1 | T3D | `models/water_tower_steel.glb` (3.35 x 8.6 x 3.35 m) | 50 |
| `coal_yard_wall_gate` | ok | 8.6 | 1 | T3D | `models/coal_yard_wall_gate.glb` (6.46 x 2.8 x 0.78 m) | 50 |

### g6: Far / midfar skyline: Gauturm, lattice headframes, cooling tower, halls, stacks

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `gauturm` | ok | 8.4 | 1 | IMG | `models/gauturm.glb` (18.09 x 46.5 x 18.09 m) | 87 |
| `lattice_headframe_strut` | ok | 8.3 | 1 | IMG | `models/lattice_headframe_strut.glb` (10.23 x 14 x 4.51 m) | 87 |
| `lattice_headframe_slim` | ok | 8 | 1 | IMG | `models/lattice_headframe_slim.glb` (2.82 x 11.8 x 2.76 m) | 48 |
| `cooling_tower` | ok | 8.5 | 1 | IMG | `models/cooling_tower.glb` (10.9 x 15.7 x 10.91 m) | 73 |
| `sawtooth_hall` | ok | 8 | 2 | IMG | `models/sawtooth_hall.glb` (12 x 6.52 x 6.65 m) | 114 |
| `industrial_chimney` | ok | 8 | 2 | PROC | `models/industrial_chimney.glb` (2.5 x 30.85 x 2.5 m) | 90 |

### g7: Foreground silhouettes (fg 1.35) + the patrol airship

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `patrol_airship` | ok | 8.5 | 1 | IMG | `models/patrol_airship.glb` (15.21 x 3.61 x 3.29 m) | 87 |
| `fg_crane_girder` | fix | 7.5 | 1 | T3D | `models/fg_crane_girder.glb` (6.35 x 0.8 x 0.87 m) | 90 |
| `crane_hook_block` | fix | 7.5 | 1 | T3D | `models/crane_hook_block.glb` (0.43 x 0.9 x 0.25 m) | 50 |
| `fg_pipe_stand_valve` | ok | 8.5 | 1 | T3D | `models/fg_pipe_stand_valve.glb` (1.55 x 3.1 x 0.92 m) | 50 |

### g8: Characters: rigged NPC / enemy cast + weapon prop

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `guard_soldier` | fix | 7.5 | 1+2 | CHAR | rigged: rig task `01a1374f-60a8-755f-8003-747c9dd75b95` | 164 |
| `patrol_soldier` | fix | 7.5 | 1+2 | CHAR | rigged: rig task `01a1374f-70ac-7149-9b2d-e59c8c2af2a8` | 161 |
| `regime_officer` | fix | 7 | 1+2 | CHAR | rigged: rig task `01a1374f-91e6-73e0-95bc-1cf3ea1dd77d` | 161 |
| `miner_hauer` | fix | 6.9 | 1+2 | CHAR | rigged: rig task `01a1374f-811a-70b3-997f-dcc4588e0970` | 187 |
| `civilian_woman` | fix | 7.2 | 1 | CHAR | rigged: rig task `01a13749-b67c-7048-b9dd-d272820b1974` | 80 |
| `civilian_man` | fix | 7.2 | 1+2 | CHAR | rigged: rig task `01a13749-8753-74ed-94a3-9416103a1511` | 110 |
| `rifle_prop` | ok | 8.2 | 1 | T3D | `models/rifle_prop.glb` (1.1 x 0.23 x 0.07 m) | 50 |
| `resistance_courier` | fix | 7.5 | 2 | CHAR | rigged: rig task `01a13820-b97f-7267-b715-d3a00a363123` | 101 |

### p2new: Pass 2: new assets

| Asset | Status | Judge | Pass | Method | Model | Credits |
|---|---|---|---|---|---|---|
| `guard_tower_v2` | ok | 8 | 2 | IMG | `models/guard_tower_v2.glb` (3.31 x 7.28 x 3.35 m) | 62 |
| `checkpoint_boom_barrier` | fix | 7.5 | 2 | T3D | `models/checkpoint_boom_barrier.glb` (4.5 x 1.15 x 0.24 m) | 50 |
| `guard_dog` | ok | 8 | 2 | IMG | `models/guard_dog.glb` (0.25 x 0.84 x 1.09 m) | 39 |
| `siebhaus_vibrating_screen` | fix | 7.5 | 2 | IMG | `models/siebhaus_vibrating_screen.glb` (3.69 x 1.6 x 1.87 m) | 42 |
| `siebhaus_hopper` | ok | 8 | 2 | IMG | `models/siebhaus_hopper.glb` (2.61 x 4.2 x 2.53 m) | 36 |
| `wall_bracket_street_lamp` | fix | 7 | 2 | T3D | `models/wall_bracket_street_lamp.glb` (0.41 x 0.31 x 0.26 m) | 30 |
| `crate_open_broken` | ok | 8 | 2 | T3D | `models/crate_open_broken.glb` (0.97 x 0.91 x 1.02 m) | 30 |

## The sprite atlas contract

Each `sprites/<group>.json` is `{ pxPerM, atlas, generator, sprites: { <name>: { x, y, w, h, ax, ay, top, scale, size, pxPerM, model, view, size_m, outline, layer, ... } } }`, written by the sprite tool (`level/tools/model_sprites.mjs`; the library copy is `tools/ms_pilot.mjs`), the same contract the level's own `level/sprites/models.json` follows:

- `x, y, w, h`: the sprite's rectangle in the PNG, its 1 px outline included. The PNG is transparent, alpha only 0 or 255, and every colour is a step of the level's palette ramps (`level/js/style.js` RAMP).
- `ax, ay`: the anchor, the ground contact. `ax` is the middle of the geometry (or the recipe's anchor point), `ay` the row it stands on (its lowest coloured row + 1; the outline row is drawn over the top row of the ground). Draw the sprite at `(x_world - ax, y_ground - ay)`. For a wheel the anchor is the axle.
- `scale`: the parallax layer factor the sprite was rendered for (playfield 1.0; mid 0.6-0.65, midfar 0.32-0.4, far 0.15, fg 1.35, sky 0.04). `pxPerM` = 52.5 x scale x size. The hero is 96 px = 1.85 m on the playfield, so 52.5 px per metre.
- `layer`: play / mover / mid / midfar / far / fg / sky. `outline`: `#0b080b` round movers (things you stand on), `sel` (the darkest step of the touching ramp) round scenery.
- Extras, when present: `deck {y, x0, x1}` (a mover's standing surface), `frames [...]` + `r` + `step` (a turning wheel), `sheaves [...]`, `feet [[x0, x1)]`, `lamp [x, y]`, `points {...}` and `marks {...}` (named pixels: beam origins, doors, ropes), `view {yaw, pitch, mirror}`, `size_m` (the rendered extent in metres), `model` (the compact GLB it was rendered from).

Each `characters/<name>.json` follows `level/hero.json`: `{ px, pxPerM, yaw, pitch, anims: { <clip>: { fps, loop, frames: [{ x, y, w, h, ax, ay, sockets }], src, ... } }, left: { anims }, excluded }`. `anims` faces right, `left.anims` faces left; `(ax, ay)` is the ground contact; `sockets` are the back, head and hand points (x, y, depth) for props; `src` names the Meshy clip and the time range sampled; `excluded` lists clips left out on purpose, with the reason. Some clips carry `prop` (per-frame rifle, pistol or flashlight placement, sprites in `sprites/g8.json`), `needs` (a stool, a chair, low cover) or `note`.

## Fetching the full-resolution models from Meshy

The task ids are in `manifest.json` (`tasks.final_model.id`, `tasks.variants[].task.id`, `tasks.rig[]`, `tasks.animations[]`). A GET on the task returns fresh signed download URLs (they expire after about three days, so never store them):

```sh
export MESHY_API_KEY=...            # the owner's key; never commit it
API=https://api.meshy.ai/openapi
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v2/text-to-3d/<id>          # kind t3d / refine: model_urls.glb / .obj / .mtl, texture_urls[0].base_color, thumbnail_url
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/image-to-3d/<id>          # kind i3d: the same fields
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/multi-image-to-3d/<id>    # kind mi3d
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/text-to-image/<id>        # kind t2i: image_urls (the concepts)
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/rigging/<id>              # kind rig: result.rigged_character_glb_url / _fbx_url, result.basic_animations.walking_* / running_*
curl -s -H "Authorization: Bearer $MESHY_API_KEY" $API/v1/animations/<id>           # kind anim: result.animation_glb_url / animation_fbx_url / processed_animation_fps_fbx_url (30 fps)
```

Or with the library's own client: put the key in `tools/.key` (one line, mode 0600; `tools/.gitignore` keeps it and `.auth_header` out of git) and run `python3 tools/mk.py wait <id> --kind <kind> --name <asset>`, which downloads the GLB, OBJ, MTL, texture and thumbnail (rig / animation: GLB + FBX) into `tools/lib/<asset>/<kind>-<id>/` (ignored by git). Models were requested as GLB + OBJ only, so model tasks have no FBX; the rig and animation tasks have GLB and FBX.

**Most task results expire.** Every image-to-3D, multi-image-to-3D, text-to-image, rigging and animation task reports `expires_at` = 72 hours after it was made (t2i 2026-10-16T21:51Z to 2026-10-17T02:16Z, i3d 2026-10-16T22:01Z to 2026-10-17T02:18Z, mi3d 2026-10-16T22:02Z to 2026-10-16T22:04Z, rig 2026-10-16T22:02Z to 2026-10-17T01:57Z, anim 2026-10-16T22:03Z to 2026-10-17T04:43Z); text-to-3D previews and refines report none. Meshy documents `expires_at` as the time the task result expires, so download those models, concepts, rigs and animation packs before then (the gallery links them all; `manifest.json` gives each task's `expires_at`). The text-to-3D models (method T3D) stay on the account and can be fetched by id later. The archive branch `meshy-models-full` keeps every final and variant model, rig, walk / run and animation pack beyond those dates (not the concepts and the other candidates).

If the rigs and packs are lost they can be rebuilt from the full-resolution GLB: the rigging API also takes a `model_url` (5 credits a rig; `height_meters` as in `tasks.rig[].height_meters`), then re-run the packs on the new rig (3 credits per action, ids and names in `tasks.animations[].actions`): about 454 credits for all 8 rigs and 138 actions. The sprite atlases here do not depend on them.

## Unreal import notes

- glTF is Y-up, metres; Unreal is Z-up, centimetres. The glTF / Interchange importer converts: 1 m = 100 uu. Import at scale 1.
- The compact GLBs have their origin at the base: they stand on y = 0 (Unreal z = 0), centred in x and z, so they drop onto the floor. `model_bbox_m` in the manifest is the size in metres (x wide, y tall, z deep). Exceptions, check them before placing (an origin at a mount point such as a hinge or a wall plate, or an off-centre part): `checkpoint_boom_barrier.glb` (bounding box centred at x = -1.657, z = 0 m); `ropeway_pylon.glb` (bounding box centred at x = -0.114, z = 0 m); `wall_bracket_street_lamp.glb` (lowest point at y = 0.275 m, bounding box centred at x = 0.055, z = 0 m).
- Sizes are real-world metres: the hero is 1.85 m. In the web level 52.5 px = 1 m on the playfield, and a parallax layer's sprite is that times its `scale`; in Unreal place the same models at depth instead of scaling them.
- The compact GLBs use `KHR_mesh_quantization` (int16 positions under a node scale), except the p2new kit pieces (float32, welded, re-charted UVs). If an importer rejects quantized meshes, dequantize first (glTF-Transform: `gltf-transform dequantize in.glb out.glb`) or import the full-resolution Meshy model by task id.
- Textures: each compact GLB carries one re-baked JPEG atlas at the texel size in `models.json` (sprite-grade). For close-ups use the Meshy 2k base-colour texture of the final task. Materials are unlit base colour only (no PBR maps were requested).
- Several kit models were stretched or cut at import to the plan's proportions (spreadX / spreadY, clip boxes); the full-resolution Meshy model is the raw, unstretched mesh. The judge's kit notes (`judge.notes`) say where a piece needs work before Unreal.
- Characters: Meshy rig, 24 joints, no fingers, height set at rigging (1.65-1.85 m). Use the rig task's FBX (or the animation packs' 30 fps FBX) and retarget to your skeleton with the IK Retargeter. No compact rigged GLB exists, so the characters have no file under `models/`: the rigged models and packs are on the archive branch, and can be re-fetched by the rig and animation task ids in the manifest. Mind the edited clips (next section): for those, import the edited GLB, not the Meshy pack.

## Edited animations: the atlases do not match the raw Meshy packs

Some character clips were rendered from edited copies of Meshy's animation GLBs. An edit keeps Meshy's rig, mesh and clip names and changes only what is listed below. **The Meshy animation packs, rigs and FBX files in the manifest (`tasks.animations`, `tasks.rig`) are unedited.** Imported into Unreal as they are, these clips bring back what the edits removed: an empty arm thrust forward, or raised with an open hand at head height (the salute-like silhouette the atlases avoid). For these clips import the edited GLB from the archive branch (`g8/<character>/edited/<file>`), or re-apply the spec to the Meshy GLB with `python3 tools/edits/armfix.py <animation.glb> <out.glb> tools/edits/<spec>.json`. The edited GLBs are about 81 MB in all, too big for this package. `character.edited_glbs` in the manifest has the same data.

Motion edits (`armfix.py`): within the window, the listed bones' rotation keys are slerped toward a calm pose of the same rig (an arm hanging along the body, or a lowered hold), with smoothstep ramps in and out. The window is the span of changed keys.

| Character | Edited GLB | Made from (Meshy task, file) | Clip -> atlas rows | Bones | Window (s) | Max change | Spec |
|---|---|---|---|---|---|---|---|
| `guard_soldier` | `guard_soldier_p2e_fix.glb` | anim `01a1381e-2b61-75d7-947b-ad3aef733daa`, `animation.glb` | `Arise` -> `arise` | LeftShoulder, LeftArm, LeftForeArm, LeftHand | 0.033-1.333 | 81 deg | `af_guard.json` |
| `patrol_soldier` | `patrol_soldier_p2e_fix.glb` | anim `01a1381e-30cc-7322-977f-1c2b8ed3a500`, `animation.glb` | `Stand_Up1` -> `stand_up` | LeftArm, LeftForeArm, RightArm, RightForeArm | 1.633-2.867 | 74.6 deg | `af_patrol.json` |
| `regime_officer` | `regime_officer_p2e_fix.glb` | anim `01a1381e-3615-72b8-9ce1-fa3e5e5fb51a`, `animation.glb` | `Phone_Conversation` -> `phone_conversation` | RightShoulder, RightArm, RightForeArm, RightHand | 0-4.833 | 102.8 deg | `af_officer.json` |
| `regime_officer` | `regime_officer_p2e_fix.glb` | anim `01a1381e-3615-72b8-9ce1-fa3e5e5fb51a`, `animation.glb` | `Arise` -> `arise` | LeftShoulder, LeftArm, LeftForeArm, LeftHand | 0.033-1.333 | 81 deg | `af_officer.json` |
| `regime_officer` | `regime_officer_p2e_fix.glb` | anim `01a1381e-3615-72b8-9ce1-fa3e5e5fb51a`, `animation.glb` | `Crouch_and_Step_Back` -> `crouch_and_step_back` | RightShoulder, RightArm, RightForeArm, RightHand | 0.533-1.733 | 78.9 deg | `af_officer.json` |
| `miner_hauer` | `miner_hauer_p2f_fix.glb` | anim `01a138b7-ebd4-7503-a711-658d4063ea7d`, `animation.glb` | `Male_Bend_Over_Pick_Up` -> `bend_over_pick_up` | RightShoulder, RightArm, RightForeArm | 1.967-5.667 | 58.6 deg | `af_miner.json` |
| `civilian_man` | `civilian_man_p2f_fix.glb` | anim `01a138b8-003a-703a-a9ad-35e0aa431f27`, `animation.glb` | `Sit_on_Chair_Arms_Crossed` -> `sit_arms_crossed` | LeftShoulder, LeftArm, LeftForeArm, LeftHand, RightShoulder, RightArm, RightForeArm, RightHand | 0.033-0.567 | 92 deg | `af_man.json` |

Texture edits: the embedded texture is repainted (`texpaint.py` with `tp_courier.json`: the courier's belt; `glbtex.py` puts the same texture into a later pack); mesh, rig and motion are unchanged:

| Character | Edited GLB | Made from (Meshy task, file) |
|---|---|---|
| `resistance_courier` | `courier_animation_fix.glb` | anim `01a13821-2a73-746a-9316-e125de6d7244`, `animation.glb` |
| `resistance_courier` | `courier_running_fix.glb` | rig `01a13820-b97f-7267-b715-d3a00a363123`, `running.glb` |
| `resistance_courier` | `courier_walking_fix.glb` | rig `01a13820-b97f-7267-b715-d3a00a363123`, `walking.glb` |
| `resistance_courier` | `courier_animation_p2f_fix.glb` | anim `01a138b8-0411-7409-b9ae-21a5d49fdbde`, `animation.glb` |

Cut in the atlas instead of edited (the Meshy clip still holds the removed part): `patrol_soldier` `phone_call_gesture` (frames 0-33 of 39 kept): frames 34-38 (5.82-6.5 s) removed in the assembly fix round, both facings: a raised open palm at head height in the left facing and a hand at the cap peak in the right one (the p2e judge's salute rule). Clips left out of an atlas altogether are listed under "What was rejected".

## Credits

Total: **4 972 credits** in 302 Meshy tasks (ledger `lib/ledger.jsonl`, actual consumed credits), plus 180 credits of the pilot made before the ledger.

| Kind | Credits |
|---|---|
| text-to-image concepts | 843 |
| text-to-3D previews | 1 485 |
| text-to-3D refine (texture) | 320 |
| image-to-3D | 1 745 |
| multi-image-to-3D | 125 |
| rigging | 40 |
| animation packs | 414 |

| Group / job (ledger tag) | Credits |
|---|---|
| g1 | 490 |
| g2 | 450 |
| g3 | 573 |
| g4 | 549 |
| g5 | 589 |
| g6 | 423 |
| g7 | 237 |
| g8 | 763 |
| p2a | 98 |
| p2b | 86 |
| p2c | 166 |
| p2d | 289 |
| p2e | 173 |
| p2f | 78 |
| test | 8 |

## What was rejected, and why

- `sperrzone_fence_post`: replaced `refine` 01a13772-8d4f-7110-b2a8-a4c72659fd47 (pass-1 judge 5): replaced by the pass-2 re-roll (p2a); pass-1 judge: The kit model is the wrong type: a fluted pilaster with a capital and no cranked arm, 0.22 x 2.69 m.
- `trench_revetment_panel`: replaced `refine` 01a13772-8543-74fa-95bb-31d746c1351c (pass-1 judge 7): replaced by the pass-2 re-roll (p2a); pass-1 judge: Texture only; the geometry is right: 1.83 x 2.74 x 0.32 m, warped planks, two posts, closed; pass-2 tries not used: `refine` 01a13815-db7d-71df-8ac7-57bae8eaf0d9 (10 credits).
- `ropeway_loading_station`: replaced `refine` 01a13772-954e-71d6-aa4a-9baee31c95cc (pass-1 judge 4): replaced by the pass-2 re-roll (p2a); pass-1 judge: The model is the wrong type: a lidded case with hinges and checker plate on its walls; I rendered the GLB to confirm.
- `ropeway_bucket`: not shipped: Retired: the pilot round-kettle bucket is the wrong type for the level and has no sprite.
- `lattice_catwalk_section`: replaced `refine` 01a1377e-352c-7476-8c89-9c714946cbfc (pass-1 judge 5): replaced by the pass-2 re-roll (p2b); pass-1 judge: The model is wrong for the Unreal kit: four legs with knee braces (a table), a closed end rail, and an extra stretch z 0.64 in the import.
- `conveyor_head_drive`: replaced `i3d` 01a13747-6696-779e-b600-110ca2aa6f2f (pass 1): re-rolled in the pass-1 fix round.
- `shaft_collar_guides`: replaced `i3d` 01a13747-6bf7-71dd-8703-dc91751983fb (pass-1 judge 2): replaced by the pass-2 re-roll (p2b); pass-1 judge: The model is wrong for the job: a 1.77 m open-front brick box, not a 4.6 m shaft back wall with the guides; pass-2 tries not used: `t2i` 01a13830-72e7-777a-95fe-07aa99d008ca (6 credits).
- `conveyor_bridge_truss`: pass-2 tries not used: `t3d` 01a13816-9821-7459-9376-4cd9258cff03 (20 credits).
- `sawtooth_hall`: replaced `i3d` 01a13749-66a1-72f9-a4d7-ef0634f96ce8 (pass-1 judge 6): replaced by the pass-2 re-roll (p2c); pass-1 judge: Wrong type: three symmetric pitched gables with fully glazed gable ends, not the plan's 3-tooth saw-tooth, and the mesh is noisy.
- `industrial_chimney`: pass-2 tries not used: `t3d` 01a13816-a2fe-7572-98d5-ce1f6e17c91b, `t3d` 01a13816-b0df-7103-87f7-37c87011599e (40 credits).
- `fg_crane_girder`: pass-2 re-roll dropped (judge 6, p2c): Dropped, as the judge ruled. The pass-2 text-to-3D re-roll failed twice (40 credits: a trestle machine on legs, then a 1.1 : 1 : 1 square frame), and I stopped.
- `guard_soldier`: clip `gunshot_reaction` left out of the `guard_soldier` atlas: excluded (p2e fix round): in the yaw-0.35 profile the flung arm is an empty straight arm thrust forward / up and held for most of its 24 frames - the salute silhouette on a regime uniform.
- `regime_officer`: clip `gunshot_reaction` left out of the `regime_officer` atlas: excluded (p2e fix round): in the yaw-0.35 profile the flung arm is an empty straight arm thrust forward / up and held for most of its 24 frames - the salute silhouette on a regime uniform.
- Tests: `test_cage`, `test_lite` (8 credits), API smoke tests before the library run.

Candidates that were generated but not picked (other previews and concepts) are listed per asset under `tasks.candidates`, with their prompts. The judges' full re-roll notes are in `judge.reroll` and `judge_history`.

## Not generated

Plan items with no Meshy task: `guard_tower` (reused: the pilot model (gen/dl)), `ropeway_pylon` (reused: the pilot model (gen/dl)), `ropeway_bucket` (planned as a reuse of the pilot model (gen/dl), then dropped by the judge (not shipped)), `street_lamp` (reused: the pilot model (gen/dl)), `headframe_owner` (reused: the owner's model (level/models)), `railcar_owner` (reused: the owner's model (level/models)), `barrel_owner` (reused: the owner's model (level/models)).

The level inventory has 49 more items the plan kept procedural (tiles, fog, fx, UI and the like; listed in `inventory_items_not_planned_for_meshy`).

## Rebuilding

The scripts in `tools/` expect the library's working layout (`meshy/` with `lib/`, `groups/`, `plan/`); `bin/setup_group.sh` hard-codes that directory in `M=`, so edit it before use.

`tools/bin/assemble.py` rebuilt this directory and the private gallery from the working files (`meshy/` in the scratch area: plan, verdicts, ledger, lib, groups). It is deterministic and reads everything from disk; the Polish gallery texts are in `tools/bin/assemble_pl.json`. `tools/bin/archive_full.py <worktree> --push` syncs the archive branch from `manifest.json`. `tools/mk.py` is the only way the library touched the Meshy API: every create call is checked against a global cap (`lib/caps.json`) and a per-group cap under a file lock, and the ledger records the estimate and then the actual credits. The key lives in `.key` next to `mk.py` and is never printed.
