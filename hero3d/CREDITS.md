# Credits: hero animation data

`anims.json` holds animation clips retargeted onto the hero's rig by `tools/retarget.cjs` (spec: `tools/anims_spec.json`).
Only this baked JSON is in the repository. The source files (GLB / BVH / FBX) are never committed.

## Used in `anims.json` now

### Meshy animation library

- What: the tactical moves `alert`, `sneak`, `lowrun`, `crouch`, `crouchwalk`, `ladder_on`, `ladder`, `ladder_off`, `hang` and `roll`.
- Source: the Meshy animation library, generated through the Meshy API on the owner's Meshy account (Premium plan).
  Meshy rigged the hero's own mesh (`hero.glb`), and the clips were applied to that rig.
- Terms: used under Meshy's terms of service for that account. The project's licence notes record that this paid plan needs no
  attribution. Meshy is listed here so the data can be traced. On Meshy's free plan, generated assets are CC BY 4.0, and they would
  need the credit "Animations: Meshy (meshy.ai)".
- Clips, from the library's names (slices and edits are in `tools/anims_spec.json`):

  | State | Meshy clip | Edits |
  |---|---|---|
  | `alert` | `Alert` | heading trimmed 12°; the feet pinned flat where they stand (the clip shuffles the left foot), the stance 20% narrower; in the page: the upper back un-rounded, a slight forward lean, the head up, guard hands |
  | `sneak` | `Cautious_Crouch_Walk_Forward_inplace` | the same walk as `crouchwalk` with the hips 10 cm higher, steps 25% shorter, the trunk 18° and the neck 35° more upright (a half-crouched walk); feet as in `crouchwalk`; in the page: the upper back un-rounded, the head up, guard hands, played at 0.8× |
  | `lowrun` | `Lean_Forward_Sprint_inplace` | planted feet locked to the ground, the hovering foot put down, the arm swing calmed by 35%; in the page: the hips 11 cm lower (the legs re-solved onto the same footfalls), the upper back un-rounded, the head up, the arms bent; played at 0.85× |
  | `crouch` | `Cautious_Crouch_Walk_Forward_inplace` (frame 20 of the baked `crouchwalk`) | held pose, both feet on the floor; in the page: the hips 24 cm lower (about 75% of the standing height), the upper back un-rounded, the head up, guard hands, breathing |
  | `crouchwalk` | `Cautious_Crouch_Walk_Forward_inplace` | heading trimmed 35°; each foot's path turned straight ahead, the stances centred under the hips, planted feet locked to the ground, the steps 32% shorter; the trunk 10° and the neck 30° more upright; in the page: the upper back un-rounded, the head up, guard hands, the hips 14 cm lower, played at 0.65× (the slowest gait) |
  | `ladder_on` | `Ladder_Mount_Start`, from 0.25 s | the clip's half turn reduced to a quarter turn |
  | `ladder` | `Ladder_Climb_Loop` | the climb per cycle and the drift toward the ladder taken out (in place); the gripping hands held still on rungs one hand step (22 cm) apart (the source slides them down the rails) |
  | `ladder_off` | `Ladder_Climb_Finish`, to 3.4 s | in the page: the arms let go of the rails and hang at the end |
  | `hang` | `Grab_Wall_Midair_Idle`, 1.7–1.97 s, eased ping-pong | the nearly settled end of the clip, slowed to 1 s each way and eased to a stop at both turns; placed by the hands, 14 cm under the ledge top; in the page: the grips fixed on the ledge, held off the wall (the body behind the ledge's face, the swing damped, the legs hanging straighter, the fingers hooked over the top), a slow look round |
  | `roll` | `Roll_Dodge`, from 0.33 s | facing locked straight ahead; the arms swung forward out of the coat for a moment (right 0.38–1.04 s, left 0.1–0.4 s); the knees tucked toward the chest while he goes over (0.45–0.97 s); the feet flat on the floor from 1.0 s and held where they land; the body raised where it would go through the floor; root motion taken from the planted feet / hands; in the page: played at 1.2×, the boots held where they stood until the clip lifts them, it ends in a guard, head up; the coat is carried round with the legs while the hips are upside down |

  All of them use the Meshy rig's 24 joints. The rig has no fingers, so the page lays its own hand poses over the clips.

### Made for this project

- `ledge_up` is keyed by hand in `index.html` (`CLIPS.ledge_up`). Neither the Meshy library nor the open sets has a climb from a
  dead hang onto a ledge. The Meshy candidates were baked onto the rig and rendered in profile: `climbing_up_wall` climbs a flat wall
  face hand over hand and never tops out, `Hang_and_Climb_Left` / `_Rght` shimmy sideways along the edge (they rise 3 cm),
  `Jump_and_Grab_Wall` jumps up to a hang, and `Wall_Support_to_Step_Down` climbs down.
- The hand poses, the guard, and the posture corrections are procedural (`MOVES` in `index.html`). No third-party data is involved.

## If clips from these sources are added

`tools/retarget.cjs` also reads these sources. None of them is in `anims.json` now. When a clip from one of them is added, put its
text below in the game's credits.

- 100STYLE (required): "Motion capture: 100STYLE Dataset – Ian Mason, Sebastian Starke, Taku Komura (2022),
  https://zenodo.org/records/8127870, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Retargeted, trimmed and modified."
- ACCAD (required): "Motion capture data: "Open Motion Project" by ACCAD / The Ohio State University
  (https://accad.osu.edu/research/motion-lab/mocap-system-and-data), CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
  Retargeted and edited."
  - Download only from accad.osu.edu. The copy of ACCAD inside AMASS is under a non-commercial licence.
- CMU (recommended, not required): "Motion capture data from the CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu),
  created with funding from NSF EIA-0196217. BVH conversion by Bruce Hahne (cgspeed)."
  - The data must not be sold on its own, converted or not.
- Mesh2Motion and Quaternius UAL2 Standard: CC0, no obligations.
- Motifect Locomotion: allowed only TEMPORARILY (AI-generated). Attribution is not required, and the raw files must not be shared.
  Mark every state that uses it as temporary, here and in a code comment, so it can be swapped later.
