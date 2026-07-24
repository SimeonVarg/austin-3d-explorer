# Union on 24th — Surrounding-Buildings Dossier

> Research pass (2026-07-18, cloud agent) covering **every building around Union
> on 24th** so the desktop image-analysis workflow has real material to model
> from. Companion files in this folder:
>
> - `buildings.json` — the machine-readable version of everything below, incl.
>   per-building image-source pages (drives the imagery fetcher).
> - `neighbors.geojson` — all 130 baked footprints within 300 m of Union, with
>   distance + centroid, straight from the 2026-07-11 snapshot.
> - `imagery/` — filled by the **Fetch Union-24th reference imagery** GitHub
>   Action (aerial nadir crops per building, marketing/architect/press photos,
>   Wikimedia, KartaView). See `imagery/INDEX.json` for source + angle of every
>   file.
> - `streetview_shotlist.md` — 8 standard angles (N→NW) per building as
>   ready-made Google Street View links for **manual desktop capture** (no free
>   API path exists; the links + screenshots are the legit route).

## How to use on the desktop

1. Run/refresh the **fetch-reference-imagery** Action (Actions tab → "Fetch
   Union-24th reference imagery" → Run workflow on this branch) if
   `imagery/` looks stale, then pull.
2. Feed `imagery/web/<slug>/` + `imagery/aerial/<slug>_nadir_*.jpg` into the
   image-analysis system per building.
3. For facades the web photos miss, open `streetview_shotlist.md`, capture the
   8 ring shots per building, name them `<slug>_<bearing>.png`, analyze.
4. Licensing: aerials are Esri (attribution required if ever displayed);
   marketing/press photos are **private modeling reference only — never ship
   them in the app**. Wikimedia/KartaView entries carry their license in
   `INDEX.json`.

## The neighborhood in one picture

Union on 24th (29 fl, 2024) no longer stands alone — it anchors a new
**three-tower cluster** on the 23rd/24th blocks, with low-rise Greek/co-op/
retail fabric north and east. Street grid (verified against confirmed
addresses + footprints): W→E **Leon, San Gabriel, Pearl, Rio Grande, Nueces,
San Antonio**; W-street numbering steps 900/800/700/600/500 at those streets.

```
        W 25th St ──────────────────────────────────────────────────
   Block on 25th W/E (8-9 fl)     Delta Gamma(2419 RG)  Whitehall co-op
        ── W 24½ ──  ΦΚΣ, retail strip, Shell (N side of 24th)
        W 24th St ──────────────────────────────────────────────────
  HillTop │ Regents West at 24th │██ UNION ON 24TH ██│ Villas on │2400
  8fl 2020│ 6 fl 2012, courtyard │  (29 fl, subject) │ 24th 30fl │Nueces
  W of San│ (mislabeled "The     │───────────────────│ NEW 2025  │S-bars
  Gabriel │  Mark" in the data)  │ THE STANDARD 17fl │ E side of │2 pools
          │ The Mark 17fl (23rd) │  (podium at Pearl)│ Rio Grande│
        W 23rd St ──────────────────────────────────────────────────
     2200 block: Twenty Two 15 (2215 RG), unidentified ~12 fl tower+garage,
     Hardin House complex, Seneca Falls + New Guild co-ops
```

**Key relationships (all verified):** The Standard shares **Union's own
block** (Union fronts 24th, Standard fronts 23rd, podium corner at 23rd &
Pearl). Villas on 24th faces Union **directly across Rio Grande St**. Across
Pearl to the west: Regents West (north half, fronting 24th) and The Mark
(south half, fronting 23rd). HillTop is NW at 24th & San Gabriel.

Skyline context farther out (already curated in `hero_designs.json`): Skyloft,
Moontower, Inspire on 22nd, The Castilian, 21 Rio, Rise.

---

## Subject recap — Union on 24th

- **701 W 24th St**; south side of W 24th, Rio Grande → Pearl (north half of
  the block it shares with The Standard).
- **29 stories, ~310 ft (94.5 m)** — baked height 97.5 m is essentially right.
- Opened **2024**; **Greystar** developed + built ($262 M, 552 units/1,448
  beds); design **Perkins&Will** with Greystar's Austin studio.
- Light gray/white panels + floor-to-ceiling glass on a podium.
  `hero_designs.json` palette is marked *inferred* — the fetched photos are the
  chance to upgrade it to *known*.

## Tier 1 — the buildings touching Union's blocks

### The Standard at Austin ★ user-flagged priority
- **715 W 23rd St** — **the south half of Union's own block** (Rio
  Grande↔Pearl); its podium corner sits at 23rd & Pearl (street sign visible
  in `humphreys_00.jpg`).
- **17 stories**, completed **Fall 2021**; **Humphreys & Partners** for
  **Landmark Properties**; 287 units / 989 beds; won Student Housing Business
  "Best Architecture & Design" 2022.
- ⚠ **Baked height 20.5 m is wrong** (pre-2021 LiDAR caught the old site).
  True ≈ **57 m** → needs `hero_overrides` entry + a `hero_designs` palette.
- Facade materials/colors: derive from `imagery/web/the-standard-at-austin/`
  (Humphreys + Landmark pages have pro shots from multiple angles).

### Villas on 24th (the new tower next door)
- **2313 Rio Grande St** — directly **E across Rio Grande St** from Union;
  its snapshot footprint is the excavation-with-crane site in the ~2023
  aerial (assignment verified).
- **30 stories** (2 below-grade parking, 3 above-grade parking, 25
  residential), 275k sf, 199 units / 670 beds; opened **Fall 2025**; design
  **RHODE Partners**; acquired by Core Spaces (largest single-asset student
  housing trade of 2025).
- Signature look: **geometric prefabricated panel facade** (Sika Parex
  panelization) with strong shadow play; rooftop basketball "sky court".
- ⚠ **Baked height 8 m (class default) — the single worst error in the area.**
  True ≈ **100 m**. From Union's windows this is the dominant neighbor; it must
  be fixed for the scene to read right.

### Regents West at 24th
- **2401 San Gabriel St** — **W across Pearl** from Union: the north half of
  the Pearl↔San Gabriel block, fronting 24th. **6 stories, 2012**, 233 units.
- ✔ **Mislabel confirmed visually:** the snapshot footprint here is labeled
  "The Mark Austin", but the aerial shows a 6-story full-block courtyard
  building with pool — Regents West's massing, not a 17-story tower. Fix the
  label; baked ~18 m height is fine.

### The Mark Austin
- **812 W 23rd St** — south half of the same Pearl↔San Gabriel block,
  fronting 23rd. **17 stories, 2023**, studio–6BR. The 25.3 m footprint at
  (-97.7467, 30.2871) with the furnished roof-amenity deck is its podium;
  LiDAR caught the tower mid-construction → true ≈ **55 m**, needs override.

### HillTop Austin
- **2400 San Gabriel St** — NW of Union, W side of San Gabriel at 24th.
  **8 stories, built 2020** (≈26 m; nearby baked heights are stale/pre-2020).
- ✔ Facade verified from the drone shot (`web/hilltop-austin/rambleratx_00`):
  white/cream body, dark bronze vertical tower feature, rust-orange recessed
  balconies, 2-story red-brick retail podium with 2nd-level pool deck; a
  historic limestone/wood storefront survives next door on 24th.

### North side of W 24th (Union's front door)
- **Shell station** (fuel canopy, 5.4 m) + an unnamed **10.8 m retail strip**.
- **Phi Kappa Sigma** house (~3 fl, 9.4 m) per OSM sits just NW of the Shell;
  alumni sources say the chapter house is 2402 Rio Grande — identity uncertain,
  check photos.
- **Yugo Austin Rio** (620 W 24th, 4-fl walk-up) and **Yugo Austin Waterloo**
  (2400 Seton Ave, ~3 fl, 1960s fabric) to the NE.

## Tier 2 — the rest of the 300 m ring (see buildings.json for full entries)

- **2400 Nueces** — UT-affiliated, built 2013, **10 stepped "bars" in an
  S-shape, each bar a different material/color**, reflective rainscreen.
  Snapshot pin location and 21.2 m height both look off vs the 16-story claim —
  the bars vary in height; use the aerial crop to sort it out. Architect-mag
  gallery in the fetch list is excellent reference.
- **Twenty Two 15** (8 fl, 27 m), **Quarters/Hardin House** complex (women's
  dorm since 1937), **Block on 25th East/West** (8–9 fl), sorority houses
  (**Delta Gamma "The Deeg", Kappa Delta, Alpha Chi Omega, Pi Beta Phi**),
  ICC co-ops (**Seneca Falls, New Guild, Whitehall** — Whitehall confirmed
  2500 Nueces, big 2-story house), retail row on the 900-block of W 24th
  (**Arab Cowboy** 901, **Cain & Abel's** 907 — moved here 2023 from the old
  2313 Rio Grande corner, which is now the Villas on 24th site), **Victory
  Lap**, and UT's **San Antonio Garage** (23 m).
- **Sorority addresses confirmed:** Delta Gamma 2419 Rio Grande, Kappa Delta
  2315 Nueces, Pi Beta Phi 2300 San Antonio. **Twenty Two 15 = 2215 Rio
  Grande** (confirmed). **2400 Nueces's label is correct** — the aerial shows
  its S-shaped bars and both courtyard pools exactly as the architecture
  press describes.
- **Two unidentified mid-rises remain** (`unidentified-36m-2200-block`: a
  ~12-story tower + parking deck mid-block behind The Standard, candidates
  2222 Rio Grande/"Karnes"/The Ruckus/a Quarters property;
  `unidentified-30m-23rd`) — ID them from the shot-list captures.

## Data corrections queue (feed into scripts/hero_overrides.json when confirmed)

| Building | Baked | True (est) | Why wrong |
|---|---|---|---|
| Villas on 24th | 8.0 m | **~100 m** (30 fl) | Opened fall 2025, post-LiDAR |
| The Standard at Austin | 20.5 m | **~57 m** (17 fl) | Built 2021, post-LiDAR |
| The Mark Austin | 25.3 m | **~55 m** (17 fl) | Built 2023, post-LiDAR |
| "The Mark Austin" label | — | is **Regents West at 24th** | OSM mislabel, confirmed from aerial |
| HillTop Austin | ~10-13 m (stale) | **~26 m** (8 fl) | Built 2020, post-LiDAR |
| 2400 Nueces | 21.2 m | stepped bars vary | label verified; per-bar heights from photos |
| Rise at West Campus | 18 m (default) | verify | class default |

Union itself (97.5 m baked vs 310 ft actual) is fine.

## Image-verified observations (from the fetched imagery, 2026-07-18)

Spot-checks of `imagery/` already settle a few things:

- **Union on 24th's facade is NOT light gray-white.** The RHODE aerial photo
  (`web/villas-on-24th/rhodepartners_00.jpg`) catches Union at the right edge
  ("UNION" podium sign visible): the tower reads **dark bronze-brown panel
  grid with prominent cream/white boxed window surrounds**, dark podium. The
  `hero_designs.json` entry (marked *inferred*) needs replacing after the
  desktop color pass.
- **The Standard at Austin** (`web/the-standard-at-austin/humphreys_00.jpg`,
  street-corner shot with signage): **5-story podium** wrapping a 17-story
  tower; palette = charcoal-gray panel + cream/limestone panels laid in a
  dashed/striped pattern, **rust-orange accent bands** at the balconies, glass
  corner bays, rooftop terrace rail. Multiple angles in the folder.
- **Villas on 24th**: white geometric precast grid with irregular window
  rhythm, glass-crowned top floors, dark faceted podium — the same photo shows
  its true scale vs Union (they're near-twins in height, confirming ~100 m).
- **Aerial vintage:** the Esri tiles show Union topped-out and the Villas site
  still under construction with a crane — so the nadir crops are ~2023-24
  flights. Fine for footprints/roofs of everything older; do not use them to
  judge Villas on 24th's finished roof.

## Open questions for the desktop pass

Resolved this session: Regents West vs The Mark vs HillTop footprints (see
above), 2400 Nueces label, Twenty Two 15 address, sorority addresses.

Still open (needs street-level captures / desktop):
1. Identity of the two unnamed mid-rises south of 23rd
   (`unidentified-36m-2200-block`, `unidentified-30m-23rd`).
2. ΦΚΣ house footprint (OSM pin vs alumni-corp address 2402 Rio Grande).
3. Per-bar colors of 2400 Nueces (Architect Magazine gallery should settle it).
4. Facade palettes (wall/trim/roof/night-window) for: The Standard, Villas on
   24th, The Mark, Regents West, HillTop → new `hero_designs.json` entries,
   plus fixing Union's own palette (dark bronze, not light gray).
