# Night reference package

Written 2026-09-19 for whoever builds the integrated night renderer (Codex owns it). This page answers
one question: **what does Austin actually look like after dark, in numbers a renderer can hit?**
The companion plan is `docs/night-implementation-plan.md`.

How to read the tags:
- **MEASURED**: a number read off pixels. For the owner's photos that means the HEIC converted from
  Display-P3 to sRGB.
- **OBSERVED**: seen by eye in a credited web photo. Qualitative only; nobody measured it.
- **RULE**: the target proposed for the renderer, taken from the evidence next to it. It is a proposal,
  not an implemented behaviour.

No photograph is committed with this page. The owner's photos are private and stay on the local
machine. The web photos are cited by URL and credit.

---------------------------------------------------------------------------------------------------

## 1. Sources

### 1.1 Owner phone photos (private, local only; never commit or upload them)

- Originals: `C:/Users/simip/Projects/austin-reference-images/_owner-phone/originals/IMG_99xx.HEIC`
  (iPhone 16 Pro, Display-P3). `jpg/` holds metadata-stripped copies, and `contact-all.jpg` is a thumbnail sheet.
- **Do not sample the `jpg/` copies.** They hold P3 values with no colour profile attached. Every
  number on this page was taken from the HEIC after a proper P3→sRGB conversion.
- Full analysis, with per-photo measurements, method and raw numbers:
  `austin-reference-images/_owner-phone/analysis/owner-photos.md`, plus `probe.json`, `profiles.json` and
  `accents.json` alongside it.
- Annotated images: `austin-reference-images/_owner-phone/analysis/annotated/IMG_99xx_annot.jpg`. Every
  measured box is labelled with its Y and hex. `facade_*.jpg` are the window-occupancy overlays.
- The analysis file names the viewpoint of the elevated series. That is personal context. It stays in
  the local file and must not be copied into any tracked file, commit or PR.

| id | local time | sun | regime | subject (what the photo is evidence for) |
|---|---|---|---|---|
| 9962 | 19:23 | +1.2° | golden hour | downtown towers, telephoto: west faces lit, shaded faces cool. Haze and digital zoom smear it |
| 9963 | 19:27 | +0.2° | sunset | The Otis / AC Hotel: curtain wall mirroring the sunset, signs already lit |
| 9964 | 20:36 | −14.5° | early night | elevated view over West Campus: Union on 24th, Icon crown, rooftop amenities, red roof points |
| 9965 | 20:36 | −14.6° | early night | Torre: LED pool, cool garage podium under a warm tower, retail base |
| 9966 | 20:36 | −14.6° | early night | Lark Austin east face (182 windows counted), 21 Rio, Villas on Rio, antenna beacons |
| 9967 | 20:38 | −15.0° | early night | brick courtyard block, an arterial with a lamp pool, billboard. Night-mode light trails |
| 9968 | 20:38 | −15.1° | early night | Ion from above: LED pool, sign wash on its pier, lobby glazing |
| 9969 | 20:39 | −15.2° | early night | San Antonio St canyon, Icon crown, festoon patio |
| 9970 | 20:55 | −18.7° | full night | The Castilian, street level: 160 window units counted, cool amenity band, retail |
| 9971–72 | 21:30 | −26° | full night | an apartment amenity court shot **through window glass**: festoons, uplights, pavers against turf |
| 9977–79 | 03:05 | −50° | deep night | Villas on 24th at Rio Grande × W 24th: lobby, lamps, damp asphalt, late occupancy |
| 9980–81 | 03:06 | −50° | deep night | Zalat Pizza and its garage at Rio Grande × W 23rd: the garage outshines the shop |

**Gap:** nothing was shot between 19:27 and 20:36, so the owner has **no blue-hour sample**. There is also
no late-night frame of the Icon crown.

### 1.2 Web photos (local copies under `C:/Users/simip/Projects/austin-reference-images/_night/`)

There are 46 retained files: 19 downtown, 14 West Campus/campus and 13 landmarks/street. 43 are unique,
because three Commons files were collected twice (Cutrer 2012 full night, Kotipalli 2013-06-10 and the Drag
2009). Each folder has `sources.json` (URL, credit, licence, date, regime, processing flags, evidence),
`notes.md` and `contact-sheet.jpg`.

- Licences: most are CC BY / BY-SA from Wikimedia Commons, and two are public domain.
- `the-independent…` is **CC BY-NC-ND**, so it is reference only.
- The three rambleratx.com property photos (Torre, Rambler, Waterloo) have **unknown licence**: reference
  only, do not redistribute.
- None of the 46 is committed.

Regime tags are as each gatherer judged them **by looking**. Several EXIF clocks and captions were wrong
(section 2).

**Which regimes the corpus actually covers, and what that means for the harness.** Counting the tags in
the three `sources.json` files: blue hour and full night are well covered; **twilight has exactly two
photographs** (`dobie-center-pool-twilight` and `ut-tower-all-seeing`, and the second is heavily HDR, so
§2 forbids calibrating on it), and two more are hedged "twilight / blue hour" (`torre`, `rambler`). There
is **no web photograph at all of early night at sun −15°** — that regime is carried entirely by the
owner's IMG_9964–9969, and only by them.

`scripts/verify/night-routes.json` binds one reference per route per regime, leaving the row empty where
the corpus has nothing. An empty cell in that file is a fact about this corpus. A wrong one is a lie
about the sky.

**Rewritten 2026-09-20.** This paragraph used to say the file binds each photograph "to the regime its
own entry above is tagged with", and offered that as the guarantee. It is the wrong guarantee, and it was
not even true: §1.2's table tags `rambler-nueces-twilight` flatly **blue hour** while the file had it on
`wc-street`'s **twilight** row (sun −12.1°). The deeper problem is that a tag is a *word somebody wrote
down* and a row is a *sun elevation*, and binding one to the other cannot be checked by agreeing with
yourself.

So it is checked against the sun instead. `scripts/verify/night-refmeasure.py --sun` computes the solar
elevation at Austin from each photograph's own stated capture time and prints it beside the word and
beside the row. **Run for the first time on 2026-09-20, over 46 photographs (24 with a usable clock), it
found:**

- **`lady-bird-lake-reflection-night__hargup` bound to `lady-bird-lake`'s `night` row while its own
  timestamp (21:29, 2015-07-09) puts the sun at −10.8° — nautical twilight, 29° off the row.** Moved to
  `twilight`. This was the worst binding in the file and nothing but arithmetic would have found it.
- **`texas-capitol__congress-ave-bluehour-predawn` bound to the `blue` row of TWO routes
  (`congress-street`, `capitol`) with a sky that measures median linear Y 0.0011 — sRGB code 3, black.**
  Its camera clock says 06:06 (sun −10.8°, a sky that is not black); its photographer's caption says 5AM
  (sun ≈ −21°, a sky that is). The pixels and the caption agree and the clock is wrong. Both rows are now
  empty: the corpus has **no blue-hour photograph of the Capitol or of Congress Avenue**.
- **`rambler-nueces` unbound from `wc-street`/`twilight`.** No clock, so this one was settled by looking
  properly: direct orange solar glow on the right horizon, pink-lit cirrus, a bright blue zenith (sky
  median linear Y 0.553) and a facade legible in ambient light — the sun at roughly 0 to −3°, about 10°
  off the row. Its own source site called it golden hour and was closer to right than we were.
- **Three tags in `sources.json` are wrong by the clock and are corrected in the table below**:
  `skyline-dusk-wide-pano__dimas` (tagged blue hour; 19:08 on 2016-11-23 is 1 h 37 m after sunset, sun
  **−20.9°**, full night), and **both Kotipalli dawn frames** (tagged blue hour; their EXIF puts the sun
  at **+3.1° and +3.6°, above the horizon**). The Kotipalli pair is the interesting case: the pixels are
  unmistakably blue hour, so it is the *clock* that is suspect — most likely a camera left an hour off,
  which at 05:51 gives −7.8° and fits the frame. That conflict is recorded, not silently resolved, and
  the landmarks-street gatherer had already flagged it independently.

Two clock-vs-pixel conflicts remain open by design (the Kotipalli pair, and the 2019-08-11 Capitol
shoot whose caption beats its EXIF). Where they conflict, **the pixels win and the reason is written
down** — that is what §2 already says about this corpus's clocks, now applied to the bindings as well.

**Downtown and the lake** (`_night/downtown/`)

| file (short) | regime | evidence | credit, licence | source |
|---|---|---|---|---|
| skyline-full-night__congress-view__cutrer 23:20 | full night | same tripod as the 20:34 frame: far more windows lit, accents on, sodium pools | Jonathan Cutrer, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Texas_Downtown_Skyline_at_Night_(10555159946).jpg) |
| skyline-blue-hour__congress-view__cutrer 20:34 | blue hour | minority of windows lit; Austonian chevron and Frost crown already on | Jonathan Cutrer, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Skyline_at_Dusk_(10555259063).jpg) |
| skyline-full-night__mrlaugh 18:48 | full night | foreground block about ⅓ lit; motel sign dominates exposure. HDR-ish | Steve (mrlaugh), CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Texas_skyline,_December_2023_-_Night.jpg) |
| skyline-blue-hour__mrlaugh 17:55 | blue hour | same spot 53 min earlier: meaningful window counts already. HDR-ish | Steve (mrlaugh), CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Texas_skyline,_December_2023_-_Evening.jpg) |
| skyline-full-night__city-lights__seeger | full night | amber Austonian, blue Frost crown, purple uplight. **Long exposure** (glassy water, boat trail) | Stuart Seeger, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_City_Lights.jpg) |
| skyline-full-night__schipul | full night | accent towers as coloured reflection columns; bridge lamps as continuous lines. Long exposure | Ed Schipul, CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_at_night_2011.jpg) |
| skyline-full-night__wikidiculous | full night | mirror reflection; diffraction stars. **Long exposure, small aperture** | Wikidiculous, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Night_Skyline.jpg) |
| skyline-predawn-wide__pellesten 04:15 | full night | Congress Ave: sodium pools, office windows still lit at 4 am. Light trails, fog | Pelle Sten, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_by_night.jpg) |
| lady-bird-lake-reflection-night__hargup | full night | **handheld**: midrise about half lit; rippled, broken reflection (not glassy) | Hargup, CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Lady_bird_lake_night.jpg) |
| skyline-predawn-wide__maxxparten | predawn | window and reflection colour only. **Heavy HDR; the sky is graded** | Maxx Parten, public domain | [Commons](https://commons.wikimedia.org/wiki/File:Myworld_-_Flickr_-_Night_Photo.jpg) |
| skyline-fullnight-wide__zykov 03:42 | full night | dry pavement reflecting lamp colour; Capitol dome white. One diffraction star | Aleksandr Zykov, CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_(8095571690).jpg) |
| sixthstreet-fullnight-streetview__payravi | full night | **key street frame**: warm ground floors — and upstairs is lit too, in two colours. Corrected 2026-09-20 by opening the frame: the brick pub's second-floor arched windows read violet/blue (interior club lighting) and the tan building beside it has several warm amber upper-floor windows. What is dark is the **office tower behind**, not the low-rise bar fronts | Kevin Payravi, CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Sixth_Street_(Austin)_at_night.jpg) |
| sixthstreet-fullnight-crowd2__spawnzilla | full night | festoons over the street, cool marquee. **Long exposure**: crowd erased, trails | Spawnzilla, CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:Sixth_Street_20160907224459.jpg) |
| congressbridge-fullnight-view__mayer | blue hour / early night | hotel near 100% lit, office tower partial; Frost blue crown | Daniel Mayer, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_from_Congress_Bridge-at_night.JPG) |
| skyline-dusk-wide-pano__dimas 19:08 | blue hour | cleanest blue-hour colour: skyline silhouetted, moderate occupancy | J Dimas, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Texas_skyline_at_dusk_in_2016.jpg) |
| townlake-dawn-reflection__kotipalli | blue hour (dawn) | cyan Austonian lantern, green/purple accents as reflection bars. Long exposure | N. Kotipalli, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:View_from_Town_lake_01.jpg) |
| townlake-dawn-reflection2__kotipalli | blue hour (dawn) | wider: the road-bridge lamp line doubled in the water. Long exposure | N. Kotipalli, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:View_from_Town_lake_03.jpg) |
| raineyst-foodtruck-dusk__whitehouse | dusk / early night | warm globe strings under a canopy; red neon OPEN | Phil Whitehouse, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:South_Bites_(51936098916).jpg) |
| austin-evening-ladybirdlake-boardwalk__argash | blue hour | irregular office/hotel occupancy; a blue accent strip as a solid reflection column | Argash, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Austin_Evening.jpg) |

**West Campus and campus** (`_night/westcampus-campus/`)

| file (short) | regime | evidence | credit, licence | source |
|---|---|---|---|---|
| ut-tower-burnt-orange-full_2006 | full night | floodlit stone is a receiver; one centre column of windows lit, flanks dark | BlazerMan, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT-Tower-BurntOrange.jpg) |
| ut-tower-orange-wide_2006 | full night | fountain uplit from the basin. Long exposure (silky water) | BlazerMan, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT_Tower_(1).jpg) |
| ut-tower-orange-one_2006 | blue hour | green tree uplights; same window pattern against a blue sky | M1kmurph1, CC BY-SA 4.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT_Tower-1_061.jpg) |
| ut-tower-burnt-orange-commencement_2012 | full night | Main Building arches glow gold (lobby scale); stone dark but readable | Commons contributor (see page), CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT_Main_Building_Burnt_Orange_01.JPG) |
| ut-tower-white-orange-top_2007 | full night | **everyday white state**: shaft white, crown orange | tom dube, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT_Tower_lit_white_with_orange_top.jpg) |
| ut-tower-flawn-academic-night_2009 | full night | Flawn arcade lit bright, pierced screens above dark, plaza lamp pools. Paving glossy (wet not confirmed) | Matthew Rutledge, public domain | [Commons](https://commons.wikimedia.org/wiki/File:Ut-tower-flawn-academic-night.jpg) |
| ut-campus-deankeeton-night_2005 | blue hour | irregular dorm occupancy (mostly dark); sodium pools with falloff | Eagleamn, CC BY-SA 2.5 | [Commons](https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_campus_(night_view).jpg) |
| drag-guadalupe-night_2009 | full night | lit Co-op storefront under a dark upper floor; one cobra-head pool; **dry** | bigbirdz, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:The_drag,_austin,_texas_(3233745166).jpg) |
| dobie-center-pool-twilight_2014 | twilight | per-unit colour variety (warm/cool/pink) on a real West Campus residential curtain wall, plus unlit glass reading dark navy and reflective (not black), a warm podium soffit and a lit pool. **Corrected 2026-09-20: the tower was NOT demolished.** Dobie Center (1972, 2021 Guadalupe St) was renovated and rebranded Dobie Twenty21 and UT bought it in 2021 — this is the same building that stands today, and it is valid West Campus evidence ([Wikipedia](https://en.wikipedia.org/wiki/Dobie_Center), [Austin Monthly](https://www.austinmonthly.com/dobie-twenty21-by-the-numbers/)) | Joshm560, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:2021_Guadalupe_Street-print-048-Pool_Twilight_09-4168x2702-300dpi.jpg) |
| ut-tower-all-seeing_2014 | twilight | arch brightness only. **Heavy HDR: halos are processing** | Peter Hansen, CC BY 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:The_All_Seeing_Tower_(69275597).jpeg) |
| ut-tower-full-orange_2007 | full night | third independent confirmation of the centre-column pattern | Allison Fang, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:UT_tower_lit_entirely_in_orange.jpg) |
| torre-westcampus-twilight | blue hour | bright lobby, lit glazed amenity box, mixed unit occupancy, rooftop strings. Real-estate grading | unattributed, **licence unknown** | [rambleratx](https://www.rambleratx.com/resources/best-apartments-in-west-campus-near-ut-austin/) |
| rambler-nueces-twilight | **sunset (~0 to −3°)** [OBSERVED 2026-09-20; was tagged "blue hour"] | bright retail base, lit/dark checkerboard, bay windows reflect dusk. Trails | unattributed, **licence unknown** | same page |
| waterloo-westcampus-duskblue | blue hour | unlit glass reads dark blue and reflective, not black; warm retail | unattributed, **licence unknown** | same page |

**Landmarks and street** (`_night/landmarks-street/`)

| file (short) | regime | evidence | credit, licence | source |
|---|---|---|---|---|
| texas-capitol__dome-floodlit-full-night-bw | full night (B&W) | dome blown white, portico dimmer; lamps as separate pools | Jonathan Cutrer, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Texas_Capitol_at_Night_(48547579281).jpg) |
| texas-capitol__dome-hdr-tonemapped | full night | **what NOT to do**: tone mapping flattens dome against sky; orange halos around windows | Malachite36, CC BY-SA 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:TexasCapitolHDR.jpg) |
| texas-capitol__glass-reflection-law-center | full night | dome mirrored in dark curtain wall: dimmer, broken by mullions; lamp-local ground | "Matt 4", CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Reflections_(50311122052).jpg) |
| texas-capitol__congress-ave-bluehour-predawn | blue hour (predawn) | navy sky; signals are the brightest colour; **damp** street with soft streaks | Jonathan Cutrer, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Looking_up_Congress_towards_the_Capitol_(48547579171).jpg) |
| frost-tower__crown-dusk-preillumination | dusk | crown not yet lit (reflects sky) while some office windows are already on | Trey Perry, CC BY 3.0 | [Commons](https://commons.wikimedia.org/wiki/File:Frost_Bank_Building_at_Dusk.jpg) |
| frost-tower__full-tower-bw-full-night | full night (B&W) | medallions blown white, facets dimmer; the two faces differ in occupancy | Andrew Poynton, public domain | [Commons](https://commons.wikimedia.org/wiki/File:Frost_bank_tower.jpg) |
| downtown-skyline__wide-multitower-full-night | full night | Austonian amber chevron, blue-white pinnacle beacons, cyan setback lines. Capitol smaller and dimmer than the towers | Jonathan Cutrer, CC BY 2.0 | (same file as the Cutrer 23:20 row) |
| downtown-skyline__town-lake-water-reflection-bluehour | blue hour | Austonian cyan lantern; rippled, elongated reflections | N. Kotipalli, CC BY-SA 3.0 | (same file as Kotipalli 01) |
| the-independent__crown-and-podium-garage | full night | patchy residential grid (about ⅓ dark, some blue/magenta); garage podium lit warm through bands | Randy von Liski, **CC BY-NC-ND 2.0** | [Flickr](https://www.flickr.com/photos/myoldpostcards/51744570571/) |
| guadalupe-drag__storefronts-full-night | full night | (same file as the Drag above) | bigbirdz, CC BY 2.0 | (same) |
| signage__former-safeway-sxsw | full night | temporary event gels, **not** normal retail. Long exposure | Matthew Rutledge, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Former_Safeway,_Austin,_TX,_night.jpg) |
| signage__ms-ps-food-trailer-neon | full night | neon emitter vs a spill-lit paper sign; polished steel smears the neon colour | Lars Plougmann, CC BY-SA 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:Ms_P%27s_Electric_Cock.jpg) |
| street__north-lamar-transit-center | full night | **proxy** for a garage soffit: linear tubes under a canopy, flat backlit sign | Matthew Rutledge, CC BY 2.0 | [Commons](https://commons.wikimedia.org/wiki/File:North_Lamar_transit_center_at_night.jpg) |

---------------------------------------------------------------------------------------------------

## 2. What the camera did, and must not be copied

| artefact | where | what to do |
|---|---|---|
| **Night-mode brightening.** EXIF puts the scene at 0.2–0.4 cd/m² at 20:36 and 190–240 cd/m² at sunset. That is about 9.5 stops of scene difference, shown as about 2 stops on screen. | every owner night frame | Copy **ratios**, not absolute levels. How far to lift the absolute night level is a taste call (plan §8). |
| Local tone mapping: lifts black roofs, keeps lit windows from clipping, squeezes dusk sky/shade to about 20:1 | 9963, all night frames | Unlit-surface ratios are probably compressed. Treat the wall/sky ratios as lower bounds on contrast. |
| Auto white balance set warm (about 4–4.5 kK) | all owner frames | Cool-white LEDs render bluish (8–10 kK) and 2700–3000 K interiors render cream. Colours are relative to that. |
| Multi-frame car light trails, lifted noise-free skies | 9967 (also 9965, 9969) | Not a real-time appearance. |
| Through-glass capture: silhouette, **doubled downlight** (two panes), reflected railing, magenta veil, haze | 9971, 9972 | Only the court's pavers, turf, festoons and uplights are usable. |
| Telephoto digital zoom, haze, window-frame occlusion | 9962 | Use it for sunlit and shaded colour only. |
| Ultra-wide distortion, handheld blur | 9971, 9979, 9980; 9978 | Geometry is not usable. |
| Clipped sources (clip > 5%) | crowns, lamps, signs, lobbies | The quoted hex is a **floor**, not the source colour. |
| **Long exposure**: glassy mirror water, smooth fountains, light trails, erased crowds | seeger, schipul, wikidiculous, pellesten, spawnzilla, both kotipalli, blazerman-wide, rambler, safeway | Water is **rippled** in real time (hargup, the handheld one). Do not render mirror-flat water or trails. |
| Small-aperture **diffraction stars** | wikidiculous, zykov, kotipalli, the law-center reflection | A lens property. A renderer should not draw spikes. |
| **HDR / tone-mapped** | capitol-hdr, ut-tower-all-seeing, maxxparten sky, mrlaugh pair; rambleratx grading | Their halos, flattened dome-vs-sky and graded skies are processing. Never calibrate bloom on them. |
| **Black-and-white** captures | capitol-bw, frost-bw | Pattern and contrast only, no hue. |
| **Wrong clocks**: EXIF or caption time does not match the sky | transit-center (17:49 in March, plainly night), kotipalli (06:51), others | The regime was judged by looking. |
| **Era: sodium street lights** | every web photo 2005–2013 shows orange HPS pools | Austin Energy had converted "more than 13,000" of 56,000 streetlights to LED by 2014 and replaced globe fixtures with flat-glass full-cutoff heads ([Austin Monitor, 2014-09-16](https://www.austinmonitor.com/stories/whispers/austin-energy-automates-streetlight-system/)). The owner's 2026 photos show white heads. **Use the owner's 2026 frames for lamp colour, not the orange of older photos.** |
| Temporary lighting | safeway (SXSW gels), commencement "12" windows, orange Tower states | These are special occasions, not the baseline. The Tower's everyday state is white shaft, orange crown. |
| ~~A demolished building~~ **struck 2026-09-20: it was never demolished** | dobie-center-pool-twilight | The tower at 2021 Guadalupe was renovated as Dobie Twenty21, not replaced. This row used to discount the frame to "generic glass-tower behaviour only", and §1.2 said "since rebuilt" while this row said "demolished" — two different wrong claims about the same picture, each of them throwing away the corpus's **only** evidence of per-unit colour variety. Read it as West Campus. What it does carry from 2014 is an older curtain wall and an older occupancy, so use the colour VARIETY and the unlit-glass behaviour, not the lit-unit share. |

---------------------------------------------------------------------------------------------------

## 3. Regimes

The slider is `p`, and the sun track is `js/sky.js:49-56`. Clock times are for Austin in September.

| regime | sun elevation | slider p | owner evidence | web evidence |
|---|---|---|---|---|
| golden hour | +6° → 0° | .50 → .56 | 9962, 9963 (MEASURED) | frost dusk |
| **blue hour** (civil twilight) | 0° → −6° | .56 → .622 | **none (gap)** | **mrlaugh 17:55 (−5.9°, the only clock-confirmed one)**, waterloo, argash, mayer, tower-orange-one, dean-keeton, torre. Corrected out 2026-09-20 by `night-refmeasure.py --sun`: cutrer 20:34 is **−2.6°** (sunset), dimas is **−20.9°** (full night), kotipalli ×2 read **+3.1/+3.6°** (clock suspect, see §1.2), capitol predawn measures a **black sky** (deep night), rambler is a **sunset** frame |
| twilight / early night (nautical to astronomical) | −6° → −18° | .622 → .756 | 9964–9969 at −14.5…−15.2° (MEASURED) | dobie-pool, all-seeing (HDR) |
| full night | below −18° | > .756 | 9970 (−18.7°), 9971–72 (−26°) | most full-night rows |
| deep night (late, occupancy decayed) | about −40…−50° | 1.00 (sun −40°) | 9977–9981 at 03:05 (MEASURED) | pellesten 04:15, zykov 03:42 |

The slider is not a clock. The same sun elevation happens at 21:30 and at 02:30. This package reads
p .69→1.0 as **early night → 3 am**, which is how the owner's photos are ordered. The plan (D6) says what
that means for occupancy.

---------------------------------------------------------------------------------------------------

## 4. Lighting behaviour, annotated

Y is linear relative luminance (Rec.709) of the **rendered** photo pixel, 0..1. "sRGB" is the matching
8-bit display value. Conversions used below: Y .002→7, .0066→19, .0135→31, .025→44, .044→59, .07→75,
.11→93, .19→121, .24→134, .42→173, .57→199.

### 4.1 Emitters and receivers

Every bright thing in a night photo is either an **emitter** or a **receiver**.
- An emitter is a window interior, a lobby, a lamp head, a sign, an LED strip, a pool light or a beacon.
- A receiver is a surface lit by a nearby emitter, such as a pavement under a lamp or a wall above a lobby.

| class | example (evidence) | what makes it bright |
|---|---|---|
| lit window | Lark, Icon, Castilian, Villas on 24th (MEASURED) | the interior behind the glass |
| lobby / retail | Villas on 24th lobby Y .57, Torre base, Drag, 6th St (MEASURED + OBSERVED) | the interior; it spills onto the pavement in front |
| garage / amenity band | Torre podium, Castilian level 11, Zalat deck (MEASURED) | ceiling fixtures behind a screen |
| crown / rooftop | Icon crown clipped white fins, Villas on 24th glass box (MEASURED) | LEDs on the structure, plus a lit lounge |
| accent LED | purple strip `#290cea` (9964); Austonian chevron, Frost crown, cyan setback lines (OBSERVED) | the strip itself |
| sign | Castilian `#bcdaee`, ion `#c2e7f0`, Otis `#e8f2dc` (MEASURED) | the sign; it **washes the pier around it** 4–6× across 3–4 floors (ion, 9968) |
| lamp head | Villas on 24th heads `#eeeed9`, clipped (MEASURED) | the luminaire at 4–9 m |
| floodlit landmark (receiver) | UT Tower shaft, Capitol dome (OBSERVED) | fixtures aimed at stone. The stone is a receiver, and the tower windows remain separate emitters |
| receivers | pavement under a lamp, walls lit from below, turf, roofs | albedo × the light that reaches them |

**RULE:**
- Only emitters are exempt from the scene's night light colour.
- A receiver brightens only when a named emitter is near it.
- The receiver takes on that emitter's tint: warm near lobbies and windows, cool near LED podiums and
  signs (MEASURED: the green pool tints Torre's wall `#3c6642`; cool planter uplights scallop the court
  walls `#607380`).

### 4.2 Window occupancy

**MEASURED (owner):**

| facade | time (sun) | openings | bright | dim | counted by |
|---|---|---|---|---|---|
| Lark, east face | 20:36 (−14.6°) | 182 | **43%** | 25% | rectified grid |
| Icon, south face | 20:36 (−14.5°) | 144 | **37–39%** (auto 29%) | ~20% | eye and automatic grid |
| "Tradition" building | 20:38 | ~84 | ~30% | — | eye |
| Castilian, left / right wing | 20:55 (−18.7°) | 80 / 80 units | **43% / 29%** (lower bounds) | 20% / 6% | blob detection |
| Villas on 24th, right / left face | 03:05 (−50°) | ~75 / ~120 | **12% / 4%** | 8% / 6% | eye |

**Structure (MEASURED):**
- **Windows cluster by apartment.** On Icon, complete three-window groups are lit 9 times against 2.6
  expected by chance at p = .38.
- **Whole floors cluster too.** On Lark the lit share per floor runs 14–93%: an SD of .26, about 2× a
  coin flip.
- Adjacency on its own is weak: 1.0–1.3× chance.
- **The top floor can be entirely dark** (both Castilian wings).
- At 03:05 the brightest lit units sit at the top of the corner glass column (Villas on 24th).

**OBSERVED (web):**
- The downtown dusk→night pairs show the same towers going from "a minority lit" at blue hour (cutrer
  20:34) to "far more lit" at 23:20. Interior lights come on **before** crown accents dominate (frost
  dusk). None of these were counted.
- A hotel block reads near 100% lit and evenly spread; an office tower beside it reads partial (mayer).
- Office windows are still irregularly lit at 04:15 (pellesten).
- The UT Tower lights one centre column per face, probably a stair or corridor, not residents: three
  photographers, 2006–2007.
- Dean Keeton dorm: mostly dark, a scattered few lit. The Independent: about ⅓ dark. The Frost faces
  differ from each other.

**Colour and level (MEASURED):**
- Typical lit window: median `#a29671`–`#b09b78` (Y .19–.24). Bright centres reach `#d2bd9c`–`#e9d6ab`.
- Brightness across lit windows varies **3–4×** (10–90% range Y .11–.50).
- Lit windows **almost never clip** (median clip 0–0.7%).
- **Dim windows (blinds or curtains)** are `#5d523e`–`#898474`, about ¼–⅓ of a bright one.
- Colour mix, from Lark's rendered CCT: 18% warm, 72% neutral/cream, 10% cool-white.
- **Accents** (TV blue `#0287de`/`#595dae`, LED purple `#941eff`/`#8b50d2`, red `#be614b`/`#e65f48`, green
  `#50784f`) make up 2–7% of lit windows, 1–3 per facade. Their share rises late at night: 2 of about 27
  lit at 03:05 were purple.
- OBSERVED: the old Dobie tower shows warm, cool and pink units side by side.

**RULE** (targets):
1. Decide lit/unlit **per unit** (a group of 2–3 bays; both faces of a corner unit share one roll). Add a
   per-floor bias of about ±0.25 and allow a dark top floor. Never decide per pane.
2. Each unit gets **one** tone and one brightness. Do not mix incandescent, fluorescent and TV-blue within
   one unit.
3. Occupancy follows the hour:
   - Rise from blue hour (web: a minority lit) to early night (**35–45% bright + 15–25% dim**).
   - Decay to **4–12% bright + 5–8% dim** at 03:00.
   - Blue hour has no owner sample: 15–25% bright is an **interpolation**, and should be labelled as one.
4. By building type:
   - Hotels: high and even.
   - Office floors: lit by **floor bands** in the evening, a few floors at 3–4 am.
   - Student residential: the table above.
5. Lit windows are emitters at the table's colours. **They do not bloom** (they do not clip).

### 4.3 Lobbies and storefronts against upstairs

**MEASURED (owner):**

| scene | ground floor | upstairs lit windows | ratio |
|---|---|---|---|
| Villas on 24th, 03:05 | lobby `#e5c37f`, Y .57 (24% clipped, a floor) | brightest upstairs `#beac87`, Y .42 | **≥ 1.4×** (≈ 2.4–3× the median window) |
| Torre, 20:36 | retail `#d7be98`, p95 .94 | tower p95 .27 | **≈ 3.5×** |
| Lark, 20:36 | podium lobby, p95 .785 | upper facade p95 .33 | **≈ 2.4×** |
| Castilian, 20:55 | retail Y .18 median | lit window about .31 | **≈ 0.6–1×**: lobbies do not always win |

- Lobbies and retail glow as **continuous full-height warm volumes** (Villas on 24th), not as a row of windows.
- Spill onto the pavement directly in front: sidewalk Y .35–.47 in front of the Villas on 24th lobby, against
  .47–.60 under a lamp. That is 0.6–1.0× the brightest lamp pool.

**OBSERVED (web):**
- The Drag: a lit Co-op storefront directly under a completely dark upper floor.
- 6th St (**re-read from the frame 2026-09-20; the earlier note here was wrong**): warm arched ground
  floors, and **upstairs is lit too**. On the brick pub the second-floor arched windows read violet/blue
  from interior club lighting; on the tan building next door several upper-floor windows are warm amber.
  What is dark is the office tower BEHIND the bar fronts. The useful rule for a bar street is not
  "dark upstairs with one rooftop exception" — it is **low-rise bar buildings lit on every floor, in
  more than one hue, against dark towers behind**.
- Main Building arches and the Flawn arcade: lit ground floors under dark screens.
- Torre, Rambler, Waterloo: bright bases.

**RULE:**
- Lobbies and open retail: 1.5–4× the median lit window, warm `#e5c37f`–`#f6d792`, one continuous volume,
  with a pavement spill pool.
- Closed shops fall to a lit-window level or dark.
- Upstairs is usually dimmer on a residential or office block — but **on an entertainment street it is
  lit, and coloured** (club light through upper windows). Do not model 6th Street or the Rainey
  district as a dark box with a bright ground floor.
- Closing time should come from the business, not a coin flip: `data/places.geojson` already carries an
  `open` flag and a category (plan W4).

### 4.4 Parking decks and amenity bands

- **MEASURED:**
  - Torre's garage podium is cool LED, peak `#869aae`, rendered about 9800 K: **a cool band under a warm
    tower**.
  - The Castilian's level-11 amenity band is `#8399a2` (about 8600 K). Its fin screen is backlit, peak
    `#8e8d84`.
  - **Zalat's garage deck outshines the shop below it**: deck median `#988e7a` (Y .27), peak `#f3e9dc`,
    against a storefront of Y .20. It has an edge-lit top fascia line and clipped soffit downlights.
- **OBSERVED:**
  - The Independent's garage podium is lit warm through open bands, with parked cars readable.
  - The transit canopy (proxy) shows linear tubes under a soffit and a flat backlit sign brighter than any
    one tube.
- **RULE:** decks are horizontal emissive bands, lit all night, cool-white (or warm on older decks). They are
  as bright as a lit window up to ~1.4× a storefront, with fixture points visible on the soffit. Never a thin
  edge line on a dark box.

### 4.5 Street lamps: pools, spill, falloff

- **MEASURED (owner, 2026):**
  - Heads are neutral white `#f0f0d8` / `#eeeed9` (rendered about 5.5–5.8 kK, **clipped**, so the colour is
    unreliable). The pools on pavement are warm-neutral (lit pavement `#9c8d73`).
  - **Sidewalk under the lamps Y .47–.60; midway between lamps .09–.12: about 5×.**
  - Under a pedestrian globe lamp (Zalat): .064 against .025 near the camera, **2.6×**.
  - The arterial pool (9967) peaks at `#d8d3a5`.
  - Distant older neighbourhoods: sparse **warm-orange points** `#d27e4d` on near-black ground.
- **OBSERVED (web):** discrete pools under each lamp with dark pavement between them (Congress: pellesten,
  zykov, mayer; the Drag; Dean Keeton; capitol-bw). At a distance a row of bridge lamps reads as one
  continuous line (schipul).
- **Fixture type:** flat-glass full-cutoff heads throw light **down**. Expect little wall wash above head
  height from the lamp itself ([Austin Monitor 2014](https://www.austinmonitor.com/stories/whispers/austin-energy-automates-streetlight-system/)).
- **Colour:** the owner frames show a warm-neutral white. `HANDOFF.md` §44 records Austin Energy's
  conversion as 3000 K; that was not re-checked here. Sodium orange appears only in pre-2014 photos.
- **Wall spill that does exist** comes from lobbies and signs:
  - The Villas on 24th white frame reads Y .045–.049 at 03:05, warm-grey, **lit from below by lamps and the
    lobby**.
  - The ion sign washes its pier 4–6× over 3–4 floors.
  - Street-facing brick is **3.4×** its side face (9967).
- **RULE:**
  - Pools fall about 5× from under-head to midway, with the half-intensity edge at about half the spacing.
  - Light **adds** where pools overlap, and it multiplies the surface's albedo (4.9).
  - The head is a small bright emitter at fixture height.
  - Kerbs and pavements are lit, not only the carriageway.
  - Place lamps where lamps are: mapped poles, kerb lines.

### 4.6 Landmark floodlighting and accents

- **UT Tower** (OBSERVED, 9 photos):
  - The everyday state is a **white shaft with an orange crown**; all-orange is for occasions.
  - The crown is brighter and warmer than the shaft.
  - One lit centre window column per face.
  - Green tree uplights at blue hour; the fountain is uplit from the basin.
  - The repo's `js/tower.js` already models the floods as named circuits. Keep that model.
- **Capitol** (OBSERVED): the dome is **blown white against a black sky**, with the portico lit but clearly
  dimmer. In the skyline the dome is **smaller and dimmer than the towers** around it. It mirrors in dark
  curtain walls nearby (law center: dimmer, broken by mullions).
- **Downtown towers** (OBSERVED):
  - Austonian: amber chevron band, blue-white pinnacle beacons, cyan lantern at blue hour.
  - Frost: blue crown and two white medallions.
  - An unnamed stepped tower: cyan lines on each setback.
  - Accents are **already on at blue hour** (cutrer 20:34), and interior windows come on first (frost dusk).
- **West Campus crowns** (MEASURED 20:36):
  - **4 of 5 towers in 9964 had lit rooftop features.**
  - Icon's crown: white LED fins at median Y .91 (49% clipped) over a warm lounge (`#f2e2ba`). 39% of the
    crown is clipped.
  - Its **spill raises the top 2–3 floors' wall by ~25%**.
  - A faint haze of **~2× the sky out to ≥ 4°**.
  - At 03:05 the Villas on 24th crown showed only a thin, faint lit edge.
- **Pools and roofs** (MEASURED):
  - Torre's LED pool is green `#00c644` and tints the pavilion wall `#3c6642`.
  - Ion's pool is green (`#709e5b`) with a purple spa (`#914fc4`).
  - Rooftop red lamps `#e0523c`.
  - Antenna masts on the western hills carry vertical strings of 4–7 **red beacons `#e30015`**.
  - Several roof corners carry small red points.
- **RULE:** a crown or accent is an emitter with its own colour, and switches on at dusk. Big crowns get
  +25% spill on the floors below and a faint 2×-sky skirt within 4°. Tall roofs get 1–4 red points. Pools
  are LED-coloured and tint the adjacent wall.

### 4.7 Bloom: restrained

- **MEASURED (owner radial profiles):**
  - Lamp cores are 5–10 px (0.25–0.54°).
  - The halo is **about 3–4× the core radius and drops about 10× across it** (9979: Y .67 at 8–12 px, .11 at
    16–24 px, .02 beyond 32 px).
  - **There is no wide soft glow.** The one exception is the large crown's 2×-sky skirt.
  - **Lit windows show no halo** (they do not clip).
- **OBSERVED:**
  - Diffraction stars appear only in long-exposure / small-aperture frames.
  - HDR frames show fake halos (capitol-hdr: orange halos bleed around every window, which is the "don't"
    example).
  - A bare point with **no** halo undersells a lamp.
- **RULE:** small emitters (lamp heads, festoon bulbs, beacons, sign letters) and crowns get a compact halo
  of ≤ 4× the core radius with a 10× drop. Windows, lobbies and walls get none. **More bloom is not the fix
  for anything in this package.**

### 4.8 Dark but readable unlit surfaces, and the sky

**MEASURED (owner):**

| scene | sky (zenith) | unlit wall | unlit glass | wall ÷ sky (linear) |
|---|---|---|---|---|
| 9964, 20:36, elevated | Y .0135 `#1c1f24` (sRGB 31) | Y .052 `#483f32` (sRGB 63) | ~.019 | **3.9×** |
| 9966, 20:36, elevated | Y .0066 `#10131e` (19) | Y .044 `#453a2b` (59) | .027 | **6.7×** |
| 9970, 20:55, street | Y .0033 `#080b10` (11) | piers .03 `#2f3038` (48) | — | **~9×** |
| 9977, 03:05, street | Y .0003–.002 (≤ 7) | Y .045–.049 `#453d34` (59–61) | — | **~25–30×** |

- **The unlit facade holds at Y .03–.07 (sRGB about 48–74), warm-grey, in every night photo. Only the sky
  moves.**
- The horizon is **~1.9× the zenith** at 20:36 (`#2b2d30`–`#3a3d44`).
- The sky is slate/neutral grey, not blue. The inventory records the owner's 20:36 sky as neutral grey
  with no visible stars.
- Unlit glass is **0.4–0.6× the wall**; do not paint dark windows black.
- Albedo decides what reads:
  - pale pavers Y .19 against turf .013 **under the same court lights (15×)**;
  - a black roof stays at about .004 with lit neighbours;
  - dark brick (Callaway) about .003.

**OBSERVED (web):**
- Unlit downtown facades are dark grey or blue-black but you can **still read the mullions and massing**
  (schipul, zykov).
- Waterloo's unlit glass is dark blue and reflective, not black.
- Main Building stone is dark but readable.

**RULE:**
- Unlit receivers sit 4–7× the zenith sky at early night and about 20–30× at deep night. They are always
  readable, and warm-grey unless a cool emitter is near.
- The sky darkens with the sun: slate with a brighter horizon early, near-black late.
- **At blue hour the order flips:** the sky is the brightest broad surface (section 4.12 and the web blue-hour
  frames). Unlit walls read as silhouettes against it.

### 4.9 Glass reflections

- **MEASURED:**
  - At dusk glass **mirrors whatever sky it faces at 0.4–0.7× that sky's luminance**.
  - The Otis south curtain wall is 0.71× the low sunset sky (`#fdb66a`). Its east return is 0.39× the zenith
    (`#6886ad`).
  - The ratio rises toward grazing angles.
  - At night, unlit glass carries faint reflections of lit neighbours (Icon's dark windows).
- **OBSERVED:**
  - The Capitol dome mirrors in the law center's dark curtain wall: colour-preserving, dimmer, broken per
    pane by mullions.
  - Rambler's bay windows reflect the dusk sky.
  - Polished steel smears neon colour across a curved surface (food trailer).
- **RULE:** reflection mixes **with** interior light rather than replacing it. A lit pane stays lit at dusk,
  and an unlit pane reflects. The owner likes the current sunlight and window glare (PR #267); keep its
  daytime behaviour.

### 4.10 Water

- **OBSERVED** (10 of 19 downtown frames are lake views; no owner water frame exists):
  - The handheld frame (hargup) shows **rippled, broken vertical streaks**.
  - The long exposures show glass-flat mirrors, which is an **artefact of shutter time**.
  - Accent-lit towers reflect as **coloured vertical columns** (schipul, argash, kotipalli).
  - Bridge lamp rows double as lines.
  - At blue hour the water carries the sky's colour.
- **RULE:**
  - Water is dark at night, with elongated, rippled, colour-preserving streaks under bright emitters and a
    sky-coloured surface.
  - At dusk it is **never brighter than the sky above it**.
  - No mirror-flat skyline.

### 4.11 Wet against dry streets

- **MEASURED (owner, 03:05, damp):**
  - Diffuse asphalt `#86776a` (Y .19, lifted by the phone).
  - Looking toward headlights and lamps there is a **glossy lobe about 1.6× the diffuse road** (the 9979
    band is 3× the near road) with **cool-white sparkle `#b8d4e4`**.
  - **No mirror images of buildings.**
  - The concrete crosswalk and patches stay matte.
- **OBSERVED:**
  - Most web frames are **dry**.
  - The Drag is the confirmed-dry reference (sharp, local reflections under one lamp).
  - The Capitol predawn frame is damp, with soft colour streaks under the signals.
  - Dean Keeton and Flawn are glossy but not confirmed wet.
- **RULE:** dry by default. An optional damp mode adds a view-dependent lobe of ~1.6× the diffuse road
  toward bright sources, with sparkle, on asphalt only.

### 4.12 Golden hour and blue hour (continuity)

- **MEASURED (golden, sun +0–1°, azimuth ≈271°):**
  - Only west faces are lit: `#f7a749` down to deep `#ec831c`, **as bright as the hazy sky** (`#b3aca4`,
    Y ≈ .42).
  - Shaded faces are **0.12–0.45× the sky** and go cool and bluish (`#2a333e`, `#626e78`).
  - Curtain walls mirror the sky they face at 0.4–0.7×.
  - Signs are already on.
- **OBSERVED (blue hour, web only):**
  - The sky is the brightest broad surface; towers silhouette against it.
  - A minority of windows lit, accents already on.
  - Lamps on.
- **RULE:** at blue hour, unlit walls, ground and water stay below the horizon sky (≤ ~0.5×). The city does not
  outshine its sky until the sky itself goes dark.

---------------------------------------------------------------------------------------------------

## 5. Luminance ladders (targets as ratios; the display levels are the phone's, see §2)

**Tagged per row from 2026-09-20.** This table and §6 were the only ones in the package without
MEASURED/OBSERVED/RULE marks, which let `< ~0.5` read as a measurement when it was an impression. The
last column now says where each row comes from. **The absolute `sky zenith` column is MEASURED only for
the rows that carry it from the owner's phone at known settings — a web photograph's sRGB level is a
function of the exposure the photographer chose, not of the sky, and no level in this package may be
read off one.** Ratios inside one frame survive that; levels do not.

| regime | sky zenith | horizon ÷ zenith | unlit wall ÷ sky | unlit glass ÷ wall | lit window ÷ wall | lobby ÷ median window | under-lamp ÷ mid-span pavement | hot sources | **source of this row** |
|---|---|---|---|---|---|---|---|---|---|
| golden | Y ≈ .42 (hazy) | — | shaded 0.12–0.45 | reflects 0.4–0.7 of the sky it faces | — | — | — | sunlit west faces ≈ sky | **MEASURED** — owner 9962, 9963 |
| blue hour | brightest broad surface | > 1 | **< ~0.5** | reflects the sky | interpolated | ≥ 1.5 | ~5 | lamps, signs, accents | **the wall ratio is MEASURED 2026-09-20** at **0.12–0.23** over three web frames (`night-refmeasure.py`, regions in `night-ref-regions.json`); the rest of the row is **OBSERVED**, and the owner has no blue-hour frame at all (§1.1) |
| early night (−12…−19°) | Y .013 (sRGB 31) | ~1.9 | **4–7** | 0.4–0.6 | ~4–6 | 1.5–4 | ~5 | crowns clip; beacons | **MEASURED** — owner 9964–9969 at −14.5…−15.2° |
| full night (−19…−26°) | Y .003 (11) | — | ~9 | 0.4–0.6 | ~10 (Castilian ~.31 vs piers .03) | 0.6–4 | ~5 | lamps clip | **MEASURED** — owner 9970, 9971–72 |
| deep night (03:00) | Y ≤ .002 (≤ 7) | — | **~25–30** | — | ~9 (bright) | ≥ 1.4 (vs brightest) | ~5 | lobbies, lamps, garages | **MEASURED** — owner 9977–9981 at 03:05. NOTE: the plan's A3 used to gate on this row's ratio; at 8 bits it cannot be measured on our frames (plan §7.2) |

Water, measured 2026-09-20 and not previously in this table: **water ÷ the sky above it at blue hour is
0.220, 0.254 and 0.266** across three independent web frames — about a **quarter**, not the "≤ 1" the
plan's A1 asked for. [MEASURED]

## 6. Palette (sRGB, after the phone's warm white balance)

**Tagged per row from 2026-09-20** (see the note at the top of §5 for why). This whole table comes from
the owner's phone — that is what the heading's "after the phone's warm white balance" means — so every
hex was sampled off the HEIC originals after a P3→sRGB conversion. Which frame each colour came from is
in `austin-reference-images/_owner-phone/analysis/owner-photos.md`, which is where to go before quoting
one; it is not repeated per row here, because a per-row attribution written from memory rather than from
that file would be worse than none.

**These are hues and relationships, not levels.** §2 says the display values are phone-lifted, so a hex
here is what to aim the colour at, and how bright to make it is the §8 question.

| thing | colour | source |
|---|---|---|
| lit window, median | `#a29671`–`#b09b78`; bright `#d2bd9c`–`#e9d6ab`; dim/blinds `#5d523e`–`#898474` | MEASURED — owner phone frames |
| lobby / retail | `#e5c37f`–`#f6d792`, `#d7be98` | MEASURED — owner phone frames |
| crown / rooftop glass | clipped white fins; warm interior `#f2e2ba`, `#e5d3b5`, `#d4c19f`; glass box `#dfeedb` | MEASURED — owner phone frames |
| signage | `#bcdaee`, `#c2e7f0`, `#e8f2dc` | MEASURED — owner phone frames |
| garage / amenity LED | `#869aae`, `#8399a2` | MEASURED — owner phone frames |
| street lamps | heads `#eeeed9`–`#f0f0d8`; lit pavement `#9c8d73`; far old neighbourhoods `#d27e4d` | MEASURED — owner phone frames |
| festoons | `#917b41`–`#a4915c`, clipped core | MEASURED — owner phone frames |
| pool LEDs | green `#00c644` / `#709e5b`, purple `#914fc4` | MEASURED — owner phone frames |
| beacons | `#e30015`; rooftop red `#e0523c` | MEASURED — owner phone frames |
| accents | purple `#7464b1` `#941eff` `#8b50d2` `#290cea`; blue `#0287de` `#3b6d9f` `#595dae`; red `#e65f48` | MEASURED — owner phone frames (the accent hues are West Campus tower accents in the elevated series) |
| unlit walls | warm-grey `#453a2b` `#483f32` `#453d34` `#39342b`; cool `#2f3038` beside cool LEDs | MEASURED — owner phone frames |
| sky | `#1c1f24`/`#272c34` (20:36), `#080b10` (20:55), `#04050c`/black (03:05) | MEASURED — owner phone frames at the three stated clock times; these are phone DISPLAY levels (§2), not absolute sky luminance |

## 7. Gaps (nothing below exists as evidence; do not invent it silently)

- **No measured blue hour FROM THE OWNER.** He has no frame between 19:27 and 20:36. Narrowed
  2026-09-20: eight web frames now carry numbers (`scripts/verify/night-refmeasure.py`, regions in
  `scripts/verify/night-ref-regions.json`), which is enough to settle A1's two ratios and nothing else.
  What is still missing is an **unlit wall at a clock-confirmed blue hour**: the only frames with a
  genuinely unlit broad wall are the two rambleratx property photos, which carry no clock at all, and
  Cutrer's 20:34, which its own clock puts at −2.6° — sunset, not blue hour. So A1's wall ratio rests on
  three frames, none of them both clock-confirmed and cleanly unlit. One owner frame at 19:50 would close
  this gap outright and is the single most valuable photograph he could take.
- No night photo of the Pfluger, First Street or Lamar bridges.
- No licensed Rainey St bar or porch photo, and nothing for the 2nd Street District.
- No real parking garage (only the transit-canopy proxy and the owner's Zalat and Torre podiums), no gas
  station, no Moody Center, no 360 Condominiums. The West Mall is also uncovered. The one real lit garage
  podium in the corpus, `the-independent__crown-and-podium-garage`, is **CC BY-NC-ND**, so it cannot be
  composited into a comparison sheet (a sheet is a derivative) and is therefore not wired into
  `night-routes.json`. It was wired in until 2026-09-20. Open it directly instead; the harness's
  `parking-structure` route binds the CC BY transit-canopy proxy and says why.
- **No twilight photograph of most subjects** and none at all of early night (−15°) except the owner's.
  See the coverage note under §1.2 before reading an empty reference cell as an oversight.
- No licensed colour photo of the Frost crown fully lit at full night.
- One damp-street sample (owner 03:05) and one predawn damp frame. No rain.
- No late-night frame of the Icon crown.
- Window counts exist for four facades only. Web occupancy is qualitative.
- ~~**Nobody measured the web photos.**~~ **Partly closed 2026-09-20.** Eight now carry numbers
  (`night-refmeasure.py`, above); the other 38 do not. What a web photograph can give is a **ratio inside
  one frame**, because the camera chose an exposure and both regions moved with it. It cannot give a
  level: the zykov deep-night frame measures a sky at sRGB 50–62 against §5's full-night 11, because it
  was shot at ISO 3200 f/2 to make the street legible. Quote ratios from these; never levels.
- **Nobody has cross-checked the corpus's regime WORDS against the sun** — now done for the 24
  photographs that state a capture time (`night-refmeasure.py --sun`, results in §1.2). **22 of the 46
  state no time at all**, so their regime remains one person's judgement by eye, and the three bindings
  that were corrected were all found among the 24 that do.
