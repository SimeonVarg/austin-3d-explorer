# Lossless first-load cuts

Core authored models remain full-detail on every graphics preset. Transport whitespace is not needed by their consumers. After authoring or rebaking a core model, run:

    python scripts/compact_models.py
    python scripts/compact_models.py --check
    node scripts/verify/model-compaction.mjs

The formatter reads data/apartments/index.json and changes only whitespace outside quoted strings. It retains numeric spellings, coordinates, property order and metadata. It does not round coordinates or rewrite geometry. Set PYTHON to a Python executable when it is not on PATH; the regression check uses python3 on non-Windows hosts.

Reusing a completed MapLibre source may remove a duplicate download, but it needs source-shape and retirement-isolation tests plus the complete six-view check before implementation. MapLibre 5.24 wraps object data under _data.geojson. A mutable consumer registry must not modify the producer's source.

Network verification must count both page and MapLibre worker requests with browser cache disabled. Separate controlled application responses from varying basemap/PMTiles ranges. Raw bytes and gzip/Brotli estimates are not interchangeable: Vercel compresses text, while a local static server may send identity bodies. Do not use content length to charge cached requests or call a page-scoped CDP trace a complete byte measurement.

Follow scripts/verify/README.md for real-city camera checks. Compare second screenshots at fixed campus, West Campus and downtown poses, by day and night; inspect images in addition to calculating exact pixel differences. Sparse shadow/raster differences should be reported rather than described as zero pixels. These transport changes must not alter authored counts, geometry, materials or normal application defaults.
