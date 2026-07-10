# Austin 3D Explorer — Project Plan

> A browser-based, flyable low-poly 3D recreation of downtown Austin (UT campus, The Drag, Wampus corridor, Speedway) hosted on GitHub Pages. No install required — anyone with a link can explore it.

> **⚠️ Accuracy strategy update:** See [`RESEARCH.md`](./RESEARCH.md) for the
> research-backed data-and-accuracy plan. It supersedes this doc where they
> disagree — most importantly, heights come from **Overture Maps (LiDAR-derived)**
> with an OSM fallback chain, not from OSM `building:levels` alone, and the data is
> **pre-baked** into `data/austin.pmtiles` by a GitHub Action rather than queried
> live. The concrete pipeline lives in [`scripts/`](./scripts/).

---

## Origin & Vision

This project started from a conversation about what's possible to build entirely from a phone using the Kiro iOS app + GitHub, without ever touching a computer. The goal: create a geographically accurate, stylized low-poly 3D version of the UT Austin area that anyone can fly through in a browser.

### Core Experience
- Fly/walk through Wampus, Speedway, The Drag, UT campus
- See building names, apartment logos, and signs at real locations (Dobie 21, The Castilian, Kinsolving, etc.)
- Accurate street grid and building placement based on real-world data
- Stylized low-poly aesthetic — not photorealistic, but geographically faithful
- Works on desktop and mobile (touch controls)

---

## What We're Building

### Phase 1 — Accurate Geography + All Buildings + Signs
- Real street grid for the UT/Wampus/Speedway area
- Every building as a 3D massed volume at its correct location
- LiDAR-derived heights from Overture Maps, with OSM fallback chain (see `RESEARCH.md`)
- Real terrain (DEM) so the West Campus → Waller Creek slope reads correctly
- Building names and signs as visible labels/billboards
- Trees, parks, Waller Creek
- Flythrough navigation (keyboard + touch)
- Low-poly stylized color palette (warm Austin vibe)

### Phase 2 — Hero Building Detail
Manually model accurate silhouettes and facade features for landmark buildings:
- UT Tower
- Dobie 21 (stepped tower profile)
- McCombs School of Business (angular glass facade)
- Gregory Gym
- The Drag storefronts
- Wampus apartment buildings with recognizable color schemes + logos

---

## Area of Focus

**Primary zone:** UT campus core + Wampus corridor + Speedway + The Drag (Guadalupe St)

Key landmarks to feature:
| Landmark | Notes |
|---|---|
| UT Tower | Iconic silhouette, center of campus |
| Dobie 21 | Stepped tower, student housing |
| The Castilian | Wampus area |
| Kinsolving | UT dorm |
| McCombs (RRH) | Angular modern facade |
| Gregory Gym | Historic building |
| Waller Creek | Natural feature, trail |
| Eastwoods Park | Green space |
| The Drag (Guadalupe) | Storefronts, street life |

---

## Tech Stack (Research-Validated)

### Core Libraries

| Tool | Role |
|---|---|
| **MapLibre GL JS** | WebGL map renderer, 3D building extrusions, game-like navigation |
| **OpenFreeMap** | Free OSM vector tiles — no API key, no billing, CDN-hosted |
| **Overpass API** | Fetch real building names, POIs, signs for UT/Wampus area |
| **Three.js** | Custom 3D layer: signs, logos, hero building detail models |
| **GitHub Pages** | Free hosting — shareable URL, works on any device |

### Why This Stack

**MapLibre GL JS** was chosen over raw Three.js after research revealed it has:
- Built-in game-like flythrough controls (arrow keys, pitch, bearing)
- Automatic 3D building extrusions from OSM height data
- First-person camera mode
- Ability to layer custom Three.js content on top via custom style layers
- Active development (WebGPU support coming)

**OpenFreeMap** (and **Protomaps** as fallback) provides:
- Completely free OSM-based vector tiles
- No API key required
- Works directly from GitHub Pages (static hosting)
- Open Database License (just requires OSM attribution)

**Overpass API** for enrichment:
- Fetch building names, `addr:*` tags, brand names
- Get amenity data (cafes, stores on The Drag)
- Pull natural features (trees, water, parks)

---

## Building Detail: What's Realistic

| Feature | Source | Achievable? |
|---|---|---|
| Accurate street layout | OSM vector tiles | ✅ Automatic |
| Building footprints at real locations | Overture + City of Austin + OSM | ✅ Automatic |
| Accurate height/floors | Overture (LiDAR) → OSM `height` → `building:levels` | ✅ Most buildings, LiDAR-backed |
| Building names as signs | OSM `name`/`brand` + Overpass (verify 2026 names) | ✅ Yes |
| Apartment logos / branding | Manual placement (coded) | ✅ Yes |
| Hero building silhouettes | Manual Three.js geometry | ✅ With effort |
| Window patterns, balcony details | Approximated textures | ⚠️ Stylized |
| Photorealistic facades | Photogrammetry / Street View | ❌ Not feasible |

### Signs & Text Strategy
Signs are flat texture planes (billboards) placed at real GPS coordinates. This is low-cost to render and goes a long way toward making the scene feel authentic. Flying down Wampus and seeing "Dobie 21", "The Castilian", "Kinsolving" at correct locations with recognizable colors makes it feel real even without photographic textures.

---

## Research Findings (July 2026)

### What's Changed in the Ecosystem

1. **MapLibre GL JS** is now the clear best choice for browser 3D city visualization — previously this space was dominated by Mapbox (paid). MapLibre forked it and kept it free and open source. It has a literal ["navigate with game-like controls"](https://maplibre.org/maplibre-gl-js/docs/examples/navigate-the-map-with-game-like-controls/) example in its docs.

2. **OpenFreeMap** emerged as a zero-friction free tile source — no signup, no key, just a URL. Critical for a GitHub Pages project.

3. **Protomaps / PMTiles** is an alternative: entire city tile data can be bundled as a single file hosted on static storage. Good fallback option.

4. **CityGenAgent (2025)** — new AI research framework for procedural 3D city generation from natural language. Outputs to Unreal/Blender, not browser. Not directly usable here but confirms our low-poly + procedural approach is state-of-the-art direction.

5. **map3d** (May 2025) — a browser tool that generates 3D city models from OSM and exports as GLB. Could be useful for getting a base mesh of Austin to refine.

6. **Three.js** remains the best choice for custom WebGL objects in the browser. Still actively maintained, massive community.

### What Didn't Change
- Three.js for custom 3D content in browser = still best choice
- OSM via Overpass API for real-world geodata = still gold standard (free, accurate, open license)
- GitHub Pages as hosting = still perfectly suited for this (static files only, but JS is very powerful)
- Low-poly + signs/labels approach = proven, looks great, performant on mobile

---

## Hosting & Deployment

**GitHub Pages** — free static hosting
- Auto-deploys on push to `main` branch (once configured)
- URL format: `https://SimeonVarg.github.io/austin-3d-explorer`
- Works on mobile browsers — touch controls for fly/walk navigation
- No server required — everything runs client-side in the browser

---

## What This Is NOT

- Not a game engine project (no Unity, Unreal, or app store)
- Not photorealistic (no photogrammetry, no Street View data)
- Not a native app (browser-only)
- Not dependent on any paid APIs

---

## Open Questions / Decisions Needed

- [ ] Color palette / visual style — warm Austin tones? Neon? Minimal white?
- [ ] Time of day — always daytime, or day/night cycle?
- [ ] Navigation style — fly freely, or constrained to streets/sidewalks?
- [ ] Starting point — spawn on The Drag? UT Tower plaza? Wampus?
- [ ] Mobile touch controls — joystick overlay? Swipe to look?
- [ ] Phase 2 priority buildings — which hero buildings first?

---

## Next Steps

1. Run the data pipeline (`.github/workflows/build-data.yml`) to bake
   `data/austin.pmtiles` — Overture footprints + LiDAR heights + OSM names
2. Scaffold the GitHub Pages project (HTML/JS boilerplate)
3. Integrate MapLibre GL JS + OpenFreeMap basemap tiles
4. Load `austin.pmtiles` and render `fill-extrusion` from `final_height`
5. Add terrain (DEM `raster-dem` source) so buildings sit on real elevation
6. Add game-like flythrough controls
7. Place name labels/signs at building locations (verify current 2026 names)
8. Apply low-poly color style
9. Deploy to GitHub Pages
10. Phase 2: hand-model hero buildings as glTF, place via Three.js custom layer

---

*This document was generated during a planning session using the Kiro iOS app, built entirely from a phone without a computer.*
