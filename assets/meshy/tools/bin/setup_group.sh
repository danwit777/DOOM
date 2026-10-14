#!/bin/bash
# setup_group.sh <key>: a producer's workspace meshy/groups/<key>/ with its own copy of the sprite tool (ms.mjs: edit MATERIALS / CLASSES
# there freely), models/ (its compact GLBs), models.json (MS_MODELS import entries), recipe.json (its sprites), out/, review/; prints env.
M=/tmp/claude-0/-home-user-DOOM/dfde09f2-3c62-5cd6-b478-4df69e6133b9/scratchpad/meshy; SP=$(dirname $M); G=$M/groups/$1
mkdir -p $G/models $G/out $G/review $G/src; [ -f $G/ms.mjs ] || cp $M/pilot/ms_pilot.mjs $G/ms.mjs; [ -f $G/models.json ] || echo '{}' > $G/models.json; [ -f $G/recipe.json ] || echo '[]' > $G/recipe.json
echo "export THREE_JS=$SP/node_modules/three/build/three.min.js GLTF_LOADER=$SP/GLTFLoader.js MESHOPT=$SP/msprites/npm/node_modules/meshoptimizer/index.module.js MS_MODELS=$G/models.json MS_MODEL_DIR=$G/models"
