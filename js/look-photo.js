/**
 * look-photo.js — ?look=photo: the look of everything BETWEEN the buildings, moved toward site photographs.
 *
 * TWO SWITCHES, both OFF by default (CLAUDE.md rule 5):
 *   ?trees=photo   the rounded crowns, their tones and the data/look_trees.bin file (?trees=stacked is the old stacked octagons,
 *                  once TREES_DEFAULT below is flipped); phones keep the stacked trees (outer trees are off there) in the new tones
 *   ?roads=photo   asphalt, sidewalk, ground and park tones
 *   ?look=photo    both, for comparison sheets
 * Nothing here runs, and no data file is fetched, without one of them in the address.
 *
 * WHY. Side by side with site photographs, the biggest mismatch is not a building: it is
 * the trees, the road and the walls. Photographs show a dark, dense live-oak canopy of rounded crowns, dark
 * asphalt and sunlit warm-white and tan walls. The app drew pale lime stacked discs, wide beige roads and grey
 * walls. These cover more of each frame than all the rebuilt buildings together.
 *
 * WHAT IT CHANGES (every place a hook reads this file is named):
 *   presets    js/timeofday.js   PRESETS.day / PRESETS.golden: canopy, ground, park and road colours
 *   ground     js/ground.js      SURF.day / SURF.golden: asphalt, paving, grass ... (the carriageway, walks, lawns)
 *   trees      js/outer-trees.js the street and park trees as ONE rounded crown each (data/look_trees.bin) in place of
 *                                the stacked octagons of data/trees.geojson, in the same triangle budget
 *   outerTrees js/outer-trees.js the outer city's crowns: colour and crown shape
 *   campusLandscape js/campus-landscape.js  the campus crowns' leaf tones
 *
 * TASTE BLOCK (CLAUDE.md rule 11): every colour and size chosen by eye or by measurement is in this one place. The
 * measured number sits beside each value, as `// photo R,G,B  app R,G,B` (median of the pixels of that class in the
 * photograph and in the app render from the same camera, at the hour named in the REPORT). To overrule a call,
 * change one value here.
 *
 * Sun and shade: the day palette's `canopyLo` is the SUNLIT crown top and `canopyHi` the SHADED underside (the name
 * is the old one: js/app.js TREE_SHADE).
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);
  // TWO DECISIONS, two switches (owner, 2026-10-11: he likes the new trees and has no solid reference for roads yet).
  //   TREES  the rounded crowns and their tones. ?trees=photo | ?trees=stacked (the old stacked octagons). ?look=photo means both
  //          switches on, for the comparison sheets. THE ONE LINE THAT MAKES THE NEW TREES THE DEFAULT: TREES_DEFAULT below.
  //   ROADS  asphalt, sidewalk, ground and park tones. ?roads=photo only; ?look=photo includes it. Off by default.
  const TREES_DEFAULT = false;        // true = the new trees for everyone; ?trees=stacked then brings the old ones back
  const lookAll = q.get('look') === 'photo';
  const treesOn = q.get('trees') === 'stacked' ? false : (lookAll || q.get('trees') === 'photo' || TREES_DEFAULT);
  const roadsOn = lookAll || q.get('roads') === 'photo';
  const on = treesOn || roadsOn;

  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // One leaf tone at three hours: the day tone as measured, the same leaf in a low warm sun, and the night tone,
  // which is today's (js/campus-landscape.js leaf table: dark and a touch green, so it neither glows nor goes black).
  const NIGHT_LEAF = ['#2a4a32', '#2e5036', '#264630', '#35563c'];   // round 2 used today's (#10201a ...) and the crowns went black at night: these are the top ring, the lower rings take 0.28 to 1 of it
  const LEAF_GAIN = 0.84;   // all day leaf tones below x this: round 1 rendered canopy median (103,117,61) against the photograph's (57,65,38)
  const leaf = (day, i) => {
    const c = rgb(day).map(v => v * LEAF_GAIN);
    return [hex(c), hex([c[0] * 1.06, c[1] * 0.97, c[2] * 0.80]), NIGHT_LEAF[i % NIGHT_LEAF.length]];
  };

  const LOOK = {
    on, treesOn, roadsOn,

    // ── js/timeofday.js PRESETS (day and golden only) ───────────────────
    // Base colours; the picture shows them lit (the app's sun and grade lift them about 1.1x), so each value is
    // the MEASURED photograph colour divided by that. The measured pairs are in REPORT.md.
    presets: {
      trees: {
        day: { canopy: '#3e4a2c', canopyLo: '#5f6a42', canopyHi: '#2a3320' },
        golden: { canopy: '#4a4f2e', canopyLo: '#6b6e3c', canopyHi: '#343b22' },
      },
      roads: {
      day: {
        ground: '#7c7f66',      // beige haze ground between trees and at the horizon   photo ~(110,118,100)  app (178,168,152)
        park: '#7f9a5c',        // lawn
        road: '#5a5e66', roadCasing: '#44474e',
      },
      golden: {
        ground: '#8f8466', park: '#7d8a50',
        road: '#5e5a58', roadCasing: '#48433f',
      },
      },
    },

    // ── js/ground.js SURF (day and golden only) ─────────────────────────
    ground: {
      day: {
        asphalt: '#484c53',     // road surface          photo (66,69,80) to (91,95,101)   app (106,106,108) to (132,126,117)
        concrete: '#7e7c76',    // sidewalks and lots    photo (123 shade .. 175 sun)      app (244,235,209) -> (175,169,152) -> aimed at the middle
        paving: '#86837b',
      },
      golden: {
        asphalt: '#4d4a4a',
        concrete: '#8c8374',
        paving: '#92897a',
      },
    },

    // ── the street and park trees: one rounded crown each ───────────────
    trees: {
      crowns: true,
      url: 'data/look_trees.bin',
      // Crown tones by species group, three or four leaf tones a group picked by the tree's own number j.
      groups: {
        dark:  ['#46522e', '#4b5830', '#424e2d', '#505b32'].map(leaf),     // live oak, oak, magnolia, cedar, cypress, pine
        mid:   ['#505c34', '#566337', '#4b5833', '#5b673a'].map(leaf),     // elm, pecan, other
        light: ['#5c6a3a', '#63723d', '#576638', '#6b7a40'].map(leaf),     // crape myrtle, palm
      },
      species: ['other', 'liveoak', 'oak', 'elm', 'pecan', 'crape', 'magnolia', 'cedar', 'cypress', 'pine', 'palm'],   // the order of scripts/bake_look_trees.py SPECIES
      speciesGroup: { other: 'mid', liveoak: 'dark', oak: 'dark', elm: 'mid', pecan: 'mid', crape: 'light', magnolia: 'dark', cedar: 'dark', cypress: 'dark', pine: 'dark', palm: 'light' },
      // Widest tier of the old stack -> the crown's radius, by species.
      spread: { other: 1.1, liveoak: 1.15, oak: 1.12, elm: 1.08, pecan: 1.1, crape: 1.0, magnolia: 1.05, cedar: 0.95, cypress: 0.9, pine: 0.9, palm: 0.85 },   // a little wider than the old stack (round 2 at 1.2 to 1.3 read as hedges)
      // SIZE. A live oak crown here is 8 to 14 m across; the old stack's widest tier reached 20 m, which drew as slabs filling a
      // quarter of a near frame. A crown wider than capRadius is split into a cluster of 2 to clusterMax smaller crowns that
      // keep its area (n x r^2 ~ R^2 x clusterOverlap^2), stood on a ring and a little lower, so there are lit tops and dark gaps.
      capRadius: 6.5,           // metres, 13 m across
      clusterMax: 5, clusterFill: 1.0, clusterOverlap: 1.22, clusterRing: 0.75, clusterDrop: 0.18,
      chunk: 400,               // metres; the finer crown is chosen per chunk (160 m gave 936 chunks and 320 m 464, above the check's 400 with the grid's 144)
      nearMetres: 260,          // beyond this a chunk of recorded crowns draws every 4th tree, twice as wide (the grid trees keep 900): the triangle budget
      maxMetres: 1200,          // beyond this recorded crowns are not drawn at all: the outer city's grid trees (all the way out) carry the far canopy
      closeMetres: 100,         // chunks nearer than this draw the finer crown (outerTrees.campus.closeSegments x closeRings)
      radiusJitter: 0.08,       // each crown this much wider or narrower
      valueJitter: 0.10,        // each crown this much lighter or darker
      minCrownShare: 0.45,      // a crown takes at least this share of the tree's height
    },

    // ── js/outer-trees.js ───────────────────────────────────────────────
    outerTrees: {
      campus: {
        leaf: ['#46522e', '#4b5830', '#424e2d', '#505b32'].map(leaf),
        shade: 0.28,            // the lowest ring of a crown at this share of the top ring's tone
        lobeDepth: 0.30, wave: 0.08,
        lobeTone: 0.35,         // a lobe's crest this much lighter and its hollow darker (sun and shade on the crown's own bumps)
        closeSegments: 10, closeRings: 5,   // the nearest crowns: 10 x 5 = 90 triangles with trunk; beyond closeMetres 8 x 4 = 58   // rounder, less polygonal outline (round 1: 0.20 / 0.05 read as faceted blobs)
        segments: 8, rings: 4,  // near crown: 48 triangles, 22 fewer than today's outer crown (10 x 4) and about today's stack
      },
      top: { nearMetres: 550 },   // the grid trees' near crowns out to 550 m (900 today): the triangle budget
    },

    // ── js/campus-landscape.js ──────────────────────────────────────────
    campusLandscape: {
      leaf: ['#46522e', '#4b5830', '#424e2d', '#505b32'].map(leaf),
      shade: 0.30,
      capRadius: 6.0,           // metres: a campus crown is capped like the recorded ones (its limbs' clusters are already separate crowns)
      facetTone: 0.22,          // each quad of a crown this much lighter or darker, by position: no crown reads as one colour
    },
  };
  window.LOOK_PHOTO = LOOK;
})();
