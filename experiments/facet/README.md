# experiments/facet

Facet v0: a compiler from a recipe's skin to (1) a generated fragment shader, (2) a baked wall package, and (3) an error budget that says
where the shader wall may replace the geometry. The call to action of `docs/graphics-basics-study-2026-10-10.md` section 8, built.
Nothing here is loaded by the site. It builds on `experiments/facade-shader/` (the fixture, the lab, the scoring).

## The idea in four lines

The recipe JSON stays the only source. `lib/facet.mjs` compiles a skin into an IR (a layered, axis-aligned rectangle program over a wall's own
(s, z): field, strips, floor lines, one opening per bay per floor with a recess) and emits GLSL (closed-form filtered coverage per layer, painter's
order), a JavaScript twin (for tests only), the wall package (one quad per wall) and a budget. Anything it cannot draw it REFUSES, with the reason,
and the building stays geometry.

## Commands (repo root)

```bash
export PATH=~/miniforge3/envs/utx/bin:$PATH
node experiments/facet/facetc.mjs compile       # Dobie tower: recipe -> dist/*.facet.json, *.vert.glsl, *.frag.glsl, *.walls.bin/json
node experiments/facet/facetc.mjs refuse        # which skins of which buildings Facet v0 takes, and why it refuses the rest
node experiments/facet/selftest.mjs             # refusals; IR vs the generator's window rule; compiled maths vs a brute-force oracle; budget logic
# the GPU part, on the AWS runner only:
~/.local/bin/gh workflow run aws-gpu.yml --ref main -f ref=<branch> -f checks=facet-bench.mjs -f max_runtime=30
```

## Files

| file | what |
|---|---|
| `lib/facet.mjs` | recipe -> IR, IR -> GLSL, IR -> JS, the baker, the budget |
| `facetc.mjs` | command line: `compile`, `budget`, `refuse` |
| `selftest.mjs` | tests that need no GPU |
| `page/index.html`, `page/facet-lab.js` | registers arm F (the generated shader) in the facade-shader lab |
| `run.mjs` | the distance sweep on a real GPU: F against A (geometry), B (hand-written shader), A4 (4x MSAA geometry), then the budget and the hybrid |
| `dist/` | the compiler's output for the Dobie tower (committed so the lab and the runner need no build step) |
| `../../scripts/verify/facet-bench.mjs` | the AWS runner entry |

## What the independent truth is

The compiler's own evaluator is NOT the truth (a test that shares the compiler's logic can share its bugs). The truth is the application's own generated
geometry (`experiments/facade-shader/verify-recipe.mjs`: 2,328 windows, 3 mm) and a 4x4-supersampled render of that geometry (the lab). The JS twin and the
brute-force oracle in `selftest.mjs` test only the compiled maths.
