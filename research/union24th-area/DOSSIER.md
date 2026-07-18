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

Union on 24th (29 fl, 2024) no longer stands alone — it's the NW anchor of a
new **three-tower cluster** on the 23rd/24th blocks between Rio Grande and San
Gabriel, with low-rise Greek/co-op/retail fabric to the north and east:

```
        W 25th St ─────────────────────────────────────────────
   Block on 25th W/E (8-9 fl)      Delta Gamma   Whitehall co-op
        ── W 24½ ──   ΦΚΣ, retail strip, Shell
        W 24th St ─────────────────────────────────────────────
   HillTop│Regents W  ██ UNION ON 24TH ██   │Villas on │ Yugo Rio/
   (24th &│ at 24th   (29 fl, subject)      │24th (30fl│ Waterloo (3-4 fl)
   San Gab│ (6 fl)                          │ NEW 2025)│ 2400 Nueces (E)
        W 23rd St ─────────────────────────────────────────────
   The Mark (17 fl, 2023)   THE STANDARD (17 fl, 2021)   New Guild co-op
        ── 2200 block: Twenty Two 15 (8 fl), unidentified ~12 fl tower,
           Hardin House complex, Seneca Falls co-op
```

Skyline context farther out (already curated in `hero_designs.json`): Skyloft,
Moontower, Inspire on 22nd, The Castilian, 21 Rio, Rise.

---

## Subject recap — Union on 24th

- **701 W 24th St**; south side of W 24th, Pearl → San Gabriel.
- **29 stories, ~310 ft (94.5 m)** — baked height 97.5 m is essentially right.
- Opened **2024**; **Greystar** developed + built ($262 M, 552 units/1,448
  beds); design **Perkins&Will** with Greystar's Austin studio.
- Light gray/white panels + floor-to-ceiling glass on a podium.
  `hero_designs.json` palette is marked *inferred* — the fetched photos are the
  chance to upgrade it to *known*.

## Tier 1 — the buildings touching Union's blocks

### The Standard at Austin ★ user-flagged priority
- **715 W 23rd St** — one block S of Union (same Pearl→San Gabriel block).
- **17 stories**, completed **Fall 2021**; **Humphreys & Partners** for
  **Landmark Properties**; 287 units / 989 beds; won Student Housing Business
  "Best Architecture & Design" 2022.
- ⚠ **Baked height 20.5 m is wrong** (pre-2021 LiDAR caught the old site).
  True ≈ **57 m** → needs `hero_overrides` entry + a `hero_designs` palette.
- Facade materials/colors: derive from `imagery/web/the-standard-at-austin/`
  (Humphreys + Landmark pages have pro shots from multiple angles).

### Villas on 24th (the new tower next door)
- **2313 Rio Grande St**, block bounded by W 24th / Pearl / Rio Grande —
  directly **E across Pearl** from Union.
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
- **2401 San Gabriel St** — directly **W across San Gabriel**. **6 stories,
  2012**, 233 units, mid-rise; baked 18 m ≈ fine.
- ⚠ The snapshot labels this block **"The Mark Austin" — mislabel** (The Mark
  is at 812 W 23rd). Confirm from aerial crops and fix the sign/label data.

### The Mark Austin
- **812 W 23rd St** (San Gabriel → Leon block, SW of Union). **17 stories,
  2023**, studio–6BR. Baked 25.3 m is the pre-2023 site → true ≈ **55 m**,
  needs override once the right footprint is confirmed.

### HillTop Austin
- **2400 San Gabriel St** — NW corner 24th & San Gabriel, diagonal from Union.
  Luxury student mid-rise; stories unconfirmed — resolve from imagery.

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
- **Two unidentified mid-rises** flagged in `buildings.json`
  (`unidentified-36m-2200-block`, `unidentified-30m-23rd`) — ID them from the
  aerial crops + shot-list captures.

## Data corrections queue (feed into scripts/hero_overrides.json when confirmed)

| Building | Baked | True (est) | Why wrong |
|---|---|---|---|
| Villas on 24th | 8.0 m | **~100 m** (30 fl) | Opened fall 2025, post-LiDAR |
| The Standard at Austin | 20.5 m | **~57 m** (17 fl) | Built 2021, post-LiDAR |
| The Mark Austin | 25.3 m | **~55 m** (17 fl) | Built 2023, post-LiDAR |
| "The Mark Austin" label | — | is **Regents West at 24th** | OSM mislabel |
| 2400 Nueces | 21.2 m | 16-fl claim, stepped bars | verify visually |
| Rise at West Campus | 18 m (default) | verify | class default |

Union itself (97.5 m baked vs 310 ft actual) is fine.

## Open questions for the desktop pass

1. Which footprint is Regents West vs The Mark vs HillTop on the west side?
2. Identity of the two unnamed mid-rises south of 23rd.
3. ΦΚΣ house address/footprint.
4. Per-bar colors of 2400 Nueces (Architect Magazine gallery should settle it).
5. Facade palettes (wall/trim/roof/night-window) for: The Standard, Villas on
   24th, The Mark, Regents West, HillTop → new `hero_designs.json` entries.
