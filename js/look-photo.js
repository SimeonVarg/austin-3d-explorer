/**
 * look-photo.js — ?look=photo: the look of everything BETWEEN the buildings, moved toward site photographs.
 *
 * DEFAULT OFF. Nothing here runs, and no data file is fetched, without `?look=photo` in the address.
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
  const on = q.get('look') === 'photo';

  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // One leaf tone at three hours: the day tone as measured, the same leaf in a low warm sun, and the night tone,
  // which is today's (js/campus-landscape.js leaf table: dark and a touch green, so it neither glows nor goes black).
  const NIGHT_LEAF = ['#10201a', '#13221a', '#101d18', '#17251c'];
  const LEAF_GAIN = 0.84;   // all day leaf tones below x this: round 1 rendered canopy median (103,117,61) against the photograph's (57,65,38)
  const leaf = (day, i) => {
    const c = rgb(day).map(v => v * LEAF_GAIN);
    return [hex(c), hex([c[0] * 1.06, c[1] * 0.97, c[2] * 0.80]), NIGHT_LEAF[i % NIGHT_LEAF.length]];
  };

  const LOOK = {
    on,

    // ── js/timeofday.js PRESETS (day and golden only) ───────────────────
    // Base colours; the picture shows them lit (the app's sun and grade lift them about 1.1x), so each value is
    // the MEASURED photograph colour divided by that. The measured pairs are in REPORT.md.
    presets: {
      day: {
        canopy: '#3e4a2c', canopyLo: '#5f6a42', canopyHi: '#2a3320',
        ground: '#8f9279',      // beige haze ground between trees and at the horizon   photo ~(110,118,100)  app (178,168,152)
        park: '#7f9a5c',        // lawn
        road: '#5a5e66', roadCasing: '#44474e',
      },
      golden: {
        canopy: '#4a4f2e', canopyLo: '#6b6e3c', canopyHi: '#343b22',
        ground: '#8f8466', park: '#7d8a50',
        road: '#5e5a58', roadCasing: '#48433f',
      },
    },

    // ── js/timeofday.js ROUTES: the day-side horizon (keys p 0 and 0.25) ──
    // The sky near the horizon                       photo (170,195,212) to (174,204,228)   app (203,223,236)
    routes: {
      horizon: ['#b4cadb', '#b9ccdc'],
      fog: ['#b4cadb', '#b9ccdc'],
    },

    // ── js/ground.js SURF (day and golden only) ─────────────────────────
    ground: {
      day: {
        asphalt: '#484c53',     // road surface          photo (66,69,80) to (91,95,101)   app (106,106,108) to (132,126,117)
        concrete: '#928f86',    // sidewalks and lots    photo (123..170)                  app (244,235,209)
        paving: '#9a968a',
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
      spread: { other: 1.2, liveoak: 1.3, oak: 1.25, elm: 1.18, pecan: 1.2, crape: 1.1, magnolia: 1.15, cedar: 1.0, cypress: 0.9, pine: 0.9, palm: 0.85 },   // denser: crowns meet, as in the photographs
      radiusJitter: 0.08,       // each crown this much wider or narrower
      valueJitter: 0.10,        // each crown this much lighter or darker
      minCrownShare: 0.45,      // a crown takes at least this share of the tree's height
    },

    // ── js/outer-trees.js ───────────────────────────────────────────────
    outerTrees: {
      campus: {
        leaf: ['#46522e', '#4b5830', '#424e2d', '#505b32'].map(leaf),
        shade: 0.28,            // the lowest ring of a crown at this share of the top ring's tone
        lobeDepth: 0.30, wave: 0.08,   // rounder, less polygonal outline (round 1: 0.20 / 0.05 read as faceted blobs)
        segments: 8, rings: 4,  // near crown: 48 triangles, 22 fewer than today's outer crown (10 x 4) and about today's stack
      },
      top: {},
    },

    // ── js/campus-landscape.js ──────────────────────────────────────────
    campusLandscape: {
      leaf: ['#46522e', '#4b5830', '#424e2d', '#505b32'].map(leaf),
      shade: 0.45,
    },
  };
  window.LOOK_PHOTO = LOOK;
})();
