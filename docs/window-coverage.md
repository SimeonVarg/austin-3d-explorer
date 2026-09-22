# Wider apartment window filtering

The desktop daytime filter now also covers The Standard, Villas on Rio and
Yugo Austin Waterloo, using their authored window layouts. Union on 24th and
21 Rio remain included. This is five-building coverage, not citywide acceptance.
Close views, night windows, deep/arched openings and shadows keep their original
geometry. Phone defaults remain off pending physical-device acceptance.

## Memory and lifecycle

The selected facades are collected before texture allocation. A shared resolution
level is chosen so the entire eligible set fits the existing 16 MiB GPU texture
budget, including mipmaps. Each level halves both texture dimensions; exact area
integration preserves average authored colours and glass coverage. Ordering the
buildings differently cannot give earlier buildings more of the budget.

The budget counts GPU texture storage, not total application memory. Authored-cell
staging, retained packed CPU arrays and transient raster/packing allocations are
additional. Staging is released as faces are rasterized. Obsolete per-face CPU
image buffers are cleared after successful texture-array transfer. Texture layers
are still batched by size, and failed allocations retain the authored mesh.

Turning apartments off and back on while loading retains the current build until
it finishes; a second build cannot consume the first build's planned allowance.
Completion applies the latest on/off intent.

## Verification

Evidence pending final full-city comparison; do not treat this document as visual
acceptance until the matched motion report and final results are recorded.

Area coverage, budget fairness, input-order independence, actual deferred tiling,
array batching, impossible budgets, allocation cleanup and desktop/phone switches
are exercised by `scripts/verify/facade-filter.mjs`. Its intentional point-sampling
failure remains detectable. Map lifecycle, material overrides and harness parity
are checked separately.
