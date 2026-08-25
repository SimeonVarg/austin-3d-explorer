/**
 * schedconfirm.js — what counts as unsure, and the screen that asks.
 *
 * `js/schedimg.js` reads a photograph of a schedule. This file decides how much
 * to believe it, and puts everything it does not believe in front of the student
 * as a tap. Those are two jobs and they live in two files on purpose: the
 * threshold below is an argument that has to be re-run against a corpus every
 * time somebody changes it, and a reader that also grades itself can never be
 * re-graded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * OCR misreads. RLP and RLM differ by one stroke at 9 pt; 8:00 and 3:00 swap on
 * a photograph of a screen; a dropped period turns 2.122 into 2122. None of
 * those is a crash and none of them looks wrong on screen — that is exactly the
 * problem. A confident wrong room walks a student to the far side of campus and
 * they find out when the door is locked.
 *
 * So: NOTHING THIS APP IS NOT SURE OF IS EVER WRITTEN DOWN SILENTLY. It is shown
 * to the student, with the piece of their own picture it came from, and the two
 * or three things it might be, as buttons. One tap. The whole design follows
 * from one asymmetry — "unsure" costs one tap, "confidently wrong" costs a
 * missed class — and the only way to get it wrong in the other direction is to
 * ask about everything, so the line below is measured rather than chosen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LINE IS TWO LINES, AND THAT IS THE ONE REAL DESIGN DECISION HERE
 *
 * A single threshold forces two different questions to share one answer:
 *
 *   "am I sure enough to save this without asking?"     -> CONF.askBelow
 *   "am I sure enough to put this in the button?"       -> CONF.trustBelow
 *
 * They are not the same question. At 0.55 the reading is probably right and
 * offering it as the first, pre-selected option saves a tap. At 0.15 offering it
 * first is a TRAP: a student tapping the top button on a list of five is
 * confirming a wrong answer this file put under their thumb. Below trustBelow
 * the reading is still shown — it is the only evidence there is — but it is not
 * first, nothing is pre-selected, and the question is phrased as a question
 * ("Which building is this?") rather than as a check ("Is this GDC?").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CROSS-CHECK AGAINST WHAT THE APP ALREADY KNOWS, NOT AGAINST A VIBE
 *
 * A building code that is not in UT's own 198-code register is not a
 * low-confidence read, it is a WRONG read, and the app ships the register. So
 * the checks below are all against data this repo actually has:
 *
 *   - the building lexicon (data/ut_buildings.json + wayfind's own extras)
 *   - the OTHER rooms read in the same building on the same picture, which is
 *     where the dotted/undotted convention comes from
 *   - the other classes on the same day, because nobody is in two rooms at once
 *   - the campus walking graph, through js/walkgraph.js: five minutes between
 *     two classes fifteen minutes apart on foot means one of the two readings
 *     is wrong. ON BY DEFAULT via prepare(); silent when the graph is missing.
 *   - the clock: a class is 20-240 minutes long and starts on a real UT hour
 *
 * AND THE ONE THAT MATTERS MOST, BECAUSE IT IS THE HOLE THE ROUND BEFORE THIS
 * ONE COULD NOT SEE. Every check in the list above asks "IS this a building?".
 * Thirteen pairs of REAL codes in the app's own 209-code lexicon are one
 * confusable stroke apart — MEZ (Mezes Hall, the South Mall) and NEZ (the North
 * End Zone Building, inside the stadium, 803 m away) among them — so a misread
 * from one onto the other scores 1.00 on every one of them and is saved in
 * silence. `neighbourDoubt()` asks the other question, "is this the RIGHT
 * building?", with the only two witnesses this repo has: the walking graph read
 * through the rest of the student's own day, and UT's own printed name for the
 * building (nobody is taught in the 27th Street Garage).
 *
 * WHAT IS NOT HERE, AND WHY. The brief asked for a floor check — a room starting
 * with 9 in a four-storey building is suspect — and it is a good check. This
 * repo does not have the data for it. Measured, not assumed: joining
 * data/entrances.geojson (147 code->building ids) to data/places.geojson's
 * heights yields EIGHT buildings, and it gives JES — a 27-storey dormitory — a
 * height of 5.35 m, so the join is wrong as well as sparse. OpenStreetMap's
 * cache in data/osm_cache carries building:levels with a UT ref on 26 features,
 * none of them the academic buildings classes are in. A floor table assembled
 * from that would be a guess wearing a number, and guessing is the failure this
 * file exists to prevent. When somebody bakes a real one, `CONF.room.floorOver`
 * and `roomFloorSuspect()` below are the two places it plugs into.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING ABOUT THE STUDENT LEAVES THE DEVICE, AND OCR TEXT IS NEVER HTML
 *
 * No upload, no worker, no analytics, no image anywhere but a <canvas> cut from
 * the one js/schedimg.js already made on this device.
 *
 * prepare() below does fetch, and the distinction matters enough to write out:
 * it GETs two static files this repo ships — data/ut_buildings.json, which the
 * reader was already using, and data/walk_graph.json, which the app's own
 * walking feature reads. Same origin, no query, no body, and nothing about the
 * schedule is in either request. The promise is not "this file never fetches";
 * it is that IMPORTING A SCHEDULE ADDS NO DESTINATION, and the gate's §4 proves
 * that by measuring the hosts the page used before the image was handed over
 * and failing on one new one.
 *
 * Every string that came off the student's picture reaches the DOM through
 * textContent and never through innerHTML — that is a safety property, not a
 * style preference: the text is arbitrary bytes from an image, and this screen
 * is the one place it is drawn.
 *
 * Lazy by construction, exactly like js/schedimg.js: not referenced from
 * index.html, reached by a dynamic import() at the moment a student picks an
 * image, and its stylesheet is inside this file so it costs the cold load zero.
 *
 * EVERY TASTE AND THRESHOLD VALUE IS IN `CONF` BELOW, ONE EDIT EACH.
 */

/* ════════════════════════════════════════════════════════════════════════════
   CONF — the line, the weights, and every number this file leans on.
   ════════════════════════════════════════════════════════════════════════════ */
export const CONF = {
  /* ── THE TWO LINES ──────────────────────────────────────────────────────── */
  // Below this, the class is shown to the student to confirm rather than
  // accepted. Chosen by measurement on the fifteen-image corpus — see
  // scripts/verify/confirm-line.mjs and docs/img-confidence.md. Moving it up
  // costs taps; moving it down lets readings through unasked.
  askBelow: 0.72,
  // Below this, the reading is not pre-selected and not offered first.
  trustBelow: 0.34,
  // Below this the class is not proposed at all if the student never answers:
  // leaving a reading this weak in the schedule because a screen was closed is
  // the silent-wrong-answer failure by another route.
  keepUnansweredAbove: 0.34,

  /* ── the engine's own confidence, and how little it turned out to be worth ─ */
  //
  // MEASURED, AND IT CHANGED THE DESIGN. The first version of this file used
  // Tesseract's word confidence as the BASE of every field, mapped 15 -> 0 and
  // 95 -> 1. On the fifteen-image corpus that asked about 48 of 136 correct
  // classes — 35% of a set with no wrong answers in it — and caught 4 of the 39
  // wrong answers the loose pass produced. Expensive AND blind.
  //
  // The reason is in the numbers: on this corpus the engine's confidence has no
  // discriminating power at all. Every correct reading spans 41..96, and every
  // wrong reading in the loose pass is a GEOMETRIC error (a block's painted
  // bottom read five minutes short) carried at confidence 90+. Word confidence
  // was measuring how crisp the type was, and the errors were not about type.
  //
  // So it is no longer the base. The base is 1.0 — the reading is what the
  // picture says — and confidence only bites at the bottom, where the engine is
  // saying it could barely see the word at all. `zero` is js/schedimg.js's own
  // noise floor (TUNE.ocr.minWordConf = 26); `full` is 62, because nothing on
  // this corpus read above 55 and was wrong.
  ocr: { zero: 26, full: 62 },
  // A field is a phrase and its confidence is its WORST word, never its mean —
  // three confident words must not carry a fourth the engine did not believe.
  // (js/schedimg.js's worstConf does this; the constant is here for the case
  // where a field has no words at all.)
  noWords: 0.5,

  /* ── building ───────────────────────────────────────────────────────────── */
  building: {
    lexicon: 1.00,        // on UT's own register, exactly as read
    repaired: 0.62,       // one confusable character, and exactly one real code
    unknownShape: 0.30,   // code-shaped, not a code this build knows (MER-like)
    ambiguous: 0.12,      // two or more real codes fit -> always a question
    cutOff: 0.10,         // a word cut by the edge of a crop is half a word

    // ── A REAL CODE THAT IS STILL THE WRONG ONE ────────────────────────────
    // All five values above answer "is this a building?". These two answer the
    // question that hole is shaped like: "is this the RIGHT building?". Both
    // are RELATIONAL — there is nothing wrong with the four characters, they
    // are a real code, so the reading stays in the first button and the reason
    // is printed under it. See `neighbourDoubt()`.
    //
    // Both sit at or below 0.70 by construction, so each asks on its own and
    // the 0.70/0.85 plateau that puts the line at 0.72 is unchanged.
    walkNeighbour: 0.55,  // a one-stroke neighbour makes the day walkable and
                          // this reading does not
    nearerNeighbour: 0.62, // ..or merely fits the rest of the day far better
    venueNeighbour: 0.62,  // UT's own name for this one is a car park, and a
                           // one-stroke neighbour is an ordinary building
  },

  /* ── room ───────────────────────────────────────────────────────────────── */
  room: {
    dotMismatch: 0.55,    // other rooms in THIS building on THIS page are dotted
    fourDigits: 0.62,     // "2122" where UT writes "2.122" — a dropped period is
                          // the commonest OCR error on a room number
    strayChars: 0.45,     // "2.2%" — characters UT room numbers do not contain
    grammar: 0.60,        // no shape a UT room takes
    joined: 0.80,         // "WEL2.224" came back as one word
    borrowed: 0.55,       // nothing read here; taken from the same class's twin
    agreed: 1.15,         // ..but read the SAME on another day: two witnesses
    floorOver: 0.45,      // RESERVED: floor digit above the building's storeys.
                          // Inactive — this repo has no floor table. See header.
    cutOff: 0.10,
  },

  /* ── day ────────────────────────────────────────────────────────────────── */
  day: {
    column: 1.00,         // the column it was drawn in. Geometry, not reading.
    letters: 1.00,        // somebody's "MWF" had to be read; OCR carries it
    repairedRun: 0.55,    // "MWE" allowed back to "MWF" by one letter
  },

  /* ── time ───────────────────────────────────────────────────────────────── */
  time: {
    axisAgrees: 1.00,     // the calendar's ruler and the caption say the same
    axisAlone: 0.92,      // the ruler, unchallenged
    disagree: 0.45,       // the ruler and the caption say different things
    noMeridiem: 0.50,     // no am/pm printed anywhere; the half-day is a guess
    // A start time not on a real UT class hour. It has to land clearly BELOW
    // askBelow rather than on it: at 0.72 exactly, a 9:07 start with four
    // otherwise-perfect fields scores 0.72 and the test is `< askBelow`, so the
    // one signal saying the clock misread would decide nothing.
    offGrid: 0.70,
    // AN END TIME THAT IS NOT A CLASS END TIME, and the single most valuable
    // number in this file. THIRTY-SEVEN of the thirty-nine wrong answers the
    // loose pass produces are one shape — 10:55 for 11:00, 12:25 for 12:30,
    // 13:55 for 14:00 — because a calendar paints a gap between touching events
    // and a block's bottom edge is a few minutes short of the hour it ends on.
    // The first version of this file checked only the START and forgave all
    // thirty-seven. Nothing at UT ends at five to.
    endOffGrid: 0.55,
    oddLength: 0.85,      // a length nothing is taught in
    // TWO OVERLAPS, NOT ONE, AND THE CORPUS IS WHY. Schedule s3 in the
    // benchmark's own answer key has C S 429 at 10:00-11:00 MWF and HIS 315K at
    // 10:30-11:30 MW — a real 30-minute clash, marked `required`, on three
    // images. A student CAN carry one of those (you leave early, or the section
    // is hybrid); what a student cannot carry is two classes at the same hour
    // in two buildings, which is a misread every time. Treating both alike cost
    // six false questions on correct data.
    collidesExactly: 0.30,
    overlapsPartly: 0.85,
    // NOT ENOUGH MINUTES TO WALK IT, per the campus graph — and this number
    // moved from 0.55 to 0.85 the moment the graph was actually switched on,
    // which is the most useful thing the measurement did this round.
    //
    // WHAT HAPPENED. With a real graph behind it this fired on TWELVE of the
    // forty-nine meetings in the benchmark's own ANSWER KEY — every one of them
    // a correct reading. They are all the same shape: `RLP 0.106` 9:30-11:00
    // followed by `CMA 6.146` at 11:00. A printed university schedule is
    // written in BLOCKS, so back-to-back is what a real timetable looks like;
    // the passing period is inside the block, and a student who has that pair
    // knows perfectly well they leave early. Calling it a contradiction told
    // four schedules in a row that their own timetable was impossible.
    //
    // AND THE QUESTION IT PRODUCED COULD NOT BE ANSWERED. This file's own rule
    // is that a question whose options do not contain the truth costs a tap and
    // fixes nothing. "There is not enough time to walk this" has no candidate
    // correction at all: the buttons are the reading and nothing else, so the
    // only possible answer is "yes, that is what my schedule says".
    //
    // So it moved into the CORROBORATING band — at or above 0.85, it can never
    // put a class under the 0.72 line on its own, and it still adds its weight
    // to a reading something else already doubts. The campus graph did not stop
    // being the strongest thing this app knows; it stopped being asked the
    // wrong question. Where it DOES have a candidate answer — a one-stroke
    // neighbour that makes the walk fit — it asks about the BUILDING, at
    // `building.walkNeighbour`, and there the buttons contain the fix.
    tooTight: 0.85,
    cutOff: 0.10,
  },

  /* ── what a real UT class time looks like ───────────────────────────────── */
  clock: {
    // Class starts land on the hour or the half hour; the quarter is rare but
    // real (some labs), and anything else is an OCR artefact.
    goodStartMins: [0, 30],
    okStartMins: [15, 45],
    // And ends land where a 50-, 60-, 75-, 80- or 90-minute class puts them.
    // The corpus's answer key uses only :00 and :30; the other four are in the
    // "ok" list because a real UT MWF 9:00-9:50 and TTh 9:30-10:45 do exist and
    // this corpus does not happen to contain one. Not overfitting to fifteen
    // images is the whole reason for the split.
    goodEndMins: [0, 30],
    okEndMins: [15, 20, 45, 50],
    // 50 MWF, 75 TTh, 80/110/170 labs and studios. Plus or minus `lenTol`.
    goodLengths: [50, 60, 75, 80, 90, 110, 120, 150, 170, 180],
    // 4 and not 6: at 6 an 85-minute class is "90 minutes near enough", which
    // is precisely the five-minute error above wearing a disguise.
    lenTol: 4,
    dayFirstHour: 7,
    dayLastHour: 22,
  },

  /* ── the walking cross-check, against the app's own campus graph ────────── */
  walk: {
    on: true,
    // A gap this much shorter than the walk is a contradiction, not a hurry.
    slackMin: 2,

    // ── THE CONFUSABLE-NEIGHBOUR CHECK, and why it needed building at all ──
    //
    // Every other check in this file asks "is this a building?". Thirteen pairs
    // of REAL codes in the app's own 209-code lexicon are one confusable
    // character apart, so when the engine reads one of a pair AS the other,
    // every one of those checks answers yes and the wrong room is saved in
    // silence. MEZ is Mezes Hall on the South Mall; NEZ is the North End Zone
    // Building inside the football stadium, 803 m away. The benchmark corpus's
    // own schedule s3 puts a real class in MEZ 1.306.
    //
    // The graph is the only witness this app has that can tell those two apart,
    // and it does it by looking at the REST OF THE DAY: swap MEZ for NEZ and
    // every walk around it gets longer.
    neighbour: true,

    // How many minutes of walking a swap has to save before it is worth a tap.
    //
    // DERIVED FROM THE REGISTER, NOT FITTED TO THE CORPUS. Of the thirteen
    // confusable pairs, four have both members in the walk graph, and the
    // closest of those — PAI (Painter Hall) and PAT (Patterson Labs) — are
    // 2 minutes and 250 m apart. A class has at most two adjacent walks (the
    // one in and the one out), so by the triangle inequality no PAI/PAT swap
    // can ever gain more than 2 x 2 = 4 minutes on any schedule. 5 is therefore
    // the first value the pair the graph CANNOT resolve can never reach, which
    // makes this the line between "the graph can tell these two apart" and
    // "it cannot" rather than a number that made a corpus go green.
    gainMin: 5,
  },

  /* ── what UT's own register calls a building ────────────────────────────── */
  //
  // The graph can only separate a confusable pair that is far apart. Two of the
  // thirteen pairs are close together on the map and still trivially separable
  // by a human, because one of them is a CAR PARK: TSC is the swimming centre
  // and TSG is the 27th Street Garage; GRE is Gregory Gym and GRF is the
  // Gregory Aquatic Food Service Building. Nobody is taught in either.
  //
  // This is UT's own printed name out of `data/ut_buildings.json`, matched
  // against a deliberately SHORT list of things that are not rooms with desks
  // in them. It is used ONLY to raise a question with the reading still in the
  // first button — never to rewrite a code — because a student really could
  // have a lab in a strange place and this app does not get to overrule their
  // own picture.
  venue: {
    on: true,
    // NOT in this list, on purpose: stadiums, gyms and residence halls. UT
    // really does teach in all three — NEZ, the case this whole check exists
    // for, is itself inside the stadium — and a check that fires on a real
    // classroom is worse than no check.
    unlikely: /\b(GARAGE|PARKING|FOOD SERVICE|RANCH|WAREHOUSE|CHILLING|POWER PLANT|SERVICE CENTER|UTILITY|STORAGE|GREENHOUSE)\b/,
  },

  /* ── how many taps a question is allowed to be ──────────────────────────── */
  ask: {
    maxOptions: 4,        // beyond this it is a list, not a choice
    maxQuestionsPerClass: 2,  // ask about the two worst fields and no more; a
                              // class needing three answers is a class to
                              // re-photograph, and the screen says so
  },

  /* ── the screen ─────────────────────────────────────────────────────────── */
  ui: {
    cropH: 96,            // px of the student's own picture above each question
    cropPadX: 0.55,       // padding around the field box, in multiples of its
    cropPadY: 1.10,       // ..own width / height
    // Never crop tighter than this much of the page: four characters on their
    // own are unrecognisable. A FRACTION and not a pixel count, because a
    // rectified page is 1200 px wide for a phone screenshot and 3200 for a
    // photographed table, and a fixed 220 px means two different things on
    // those two pages.
    cropMinCtxFrac: 0.20,
    cropMinCtxPx: 220,    // ...with an absolute floor, for a very small page
    optionH: 48,          // thumb target. 44 is the floor; 48 is comfortable.
    maxDpr: 2,            // cap the crop's backing store; 3x costs memory for
                          // detail nobody can see at 96 px tall
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   SMALL SHARED PARTS
   ════════════════════════════════════════════════════════════════════════════ */

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** "09:30" -> 570. Anything else -> null. */
export function minutesOf(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 570 -> "09:30". */
export function hhmmOf(min) {
  if (min == null) return null;
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** 570 -> "9:30 am" — what a student reads, not what a file stores. */
export function clockOf(min) {
  if (min == null) return '';
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return h + ':' + String(mm).padStart(2, '0') + (h24 < 12 ? ' am' : ' pm');
}

/** Tesseract's 0..100 onto this file's 0..1 — see CONF.ocr for why it is flat
 *  above `full` rather than linear all the way to 100. */
export function fromOcr(conf) {
  if (conf == null) return CONF.noWords;
  const { zero, full } = CONF.ocr;
  return clamp01((conf - zero) / Math.max(1, full - zero));
}

/* ════════════════════════════════════════════════════════════════════════════
   THE CROSS-CHECKS

   Each one answers a question about ONE field using something the app already
   knows, and each returns a multiplier and a plain-words sentence. Multiplying
   rather than adding, because the checks are near-independent and any one of
   them failing has to be able to drag a field under the line on its own — an
   averaged score lets three clean fields carry a room that is not a room.
   ════════════════════════════════════════════════════════════════════════════ */

// UT room numbers, as UT actually writes them. The letter prefix is not
// decoration: `JES A121A` is a real room and the first version of this file,
// which had `^\d{3,4}[A-Z]?$`, called it "not a shape UT room numbers take" and
// asked the student about a perfectly correct reading. Measured on corpus
// image 15.
const ROOM_DOTTED = /^\d\.\d{2,4}[A-Z]?$/;
const ROOM_PLAIN = /^[A-Z]{0,2}\d{2,4}[A-Z]?$/;
const ROOM_ANY = /^[A-Z]{0,2}\d{1,4}(\.\d{1,4})?[A-Z]?$/;

/**
 * RESERVED, AND DELIBERATELY INERT. A room whose floor digit is above the
 * building's storey count is a wrong read, and this is where that check goes.
 * It returns "no opinion" today because this repo has no floor table and the
 * two joins that look like one are measured wrong in the file header. A
 * `floors` map arriving through opts turns it on with no other change.
 */
export function roomFloorSuspect(code, room, floors) {
  if (!floors || !code || !room) return null;
  const n = floors[String(code).toUpperCase()];
  if (!n) return null;
  const m = /^(\d)\./.exec(String(room)) || /^(\d)\d{2,3}$/.exec(String(room));
  if (!m) return null;
  return +m[1] > n ? { floor: +m[1], storeys: n } : null;
}

/** Rooms read for the same building elsewhere on this picture. */
function siblingRooms(classes, cls) {
  const out = [];
  for (const c of classes) {
    if (c === cls || c.building !== cls.building) continue;
    if (c.room && out.indexOf(c.room) < 0) out.push(c.room);
  }
  return out;
}

/**
 * Two classes of one student's, on one day, at one time. Nobody is in two
 * rooms at once, so one of the two readings is wrong and BOTH are suspect —
 * this file has no way to know which, and pretending it does is the whole
 * failure mode it exists to prevent.
 */
function collidesWith(classes, cls) {
  const s = minutesOf(cls.start), e = minutesOf(cls.end);
  if (s == null || e == null) return null;
  let partial = null;
  for (const o of classes) {
    if (o === cls || o.day !== cls.day) continue;
    const os = minutesOf(o.start), oe = minutesOf(o.end);
    if (os == null || oe == null) continue;
    if (!(s < oe && os < e)) continue;
    // Same hour in two buildings is a misread. A partial clash is a real thing
    // that a real schedule contains — see CONF.time.overlapsPartly — so it is
    // reported, weakly, and the exact one wins if both are present.
    if (Math.abs(os - s) <= 5 && Math.abs(oe - e) <= 5) return Object.assign({}, o, { __exact: true });
    if (!partial) partial = Object.assign({}, o, { __exact: false });
  }
  return partial;
}

/**
 * THE CAMPUS GRAPH AS A CLOCK CHECK. Two classes twelve minutes apart in
 * buildings nineteen minutes apart on foot is not a tight passing period, it is
 * a contradiction — and this app is the one thing on the student's phone that
 * can measure the second number. Inactive unless a route function is supplied,
 * because a check that silently does nothing when its data is missing is worse
 * than one that says so: `active` is reported out of review().
 */
function tooTightToWalk(classes, cls, routeMinutes, ctx) {
  if (!routeMinutes || !CONF.walk.on) return null;
  const e = minutesOf(cls.end), s = minutesOf(cls.start);
  if (s == null || e == null) return null;
  let worst = null;
  for (const o of classes) {
    if (o === cls || o.day !== cls.day || !o.building || !cls.building) continue;
    if (o.building === cls.building) continue;
    const os = minutesOf(o.start), oe = minutesOf(o.end);
    if (os == null || oe == null) continue;
    let gap = null, from = null, to = null;
    if (os >= e) { gap = os - e; from = cls.building; to = o.building; }
    else if (s >= oe) { gap = s - oe; from = o.building; to = cls.building; }
    if (gap == null) continue;
    let need = null;
    try { need = routeMinutes(from, to); } catch (err) { need = null; }
    if (need == null || !isFinite(need)) continue;
    if (gap + CONF.walk.slackMin < need &&
        (!worst || need - gap > worst.need - worst.gap)) {
      worst = { other: o, gap, need: Math.round(need), from, to, blame: o };
    }
  }
  // WHEN THE APP CAN NAME WHICH OF THE TWO IS WRONG, IT MUST NOT ASK BOTH.
  // A contradiction is a fact about a PAIR, so without more evidence both
  // classes are suspect and both get asked. But if a one-stroke neighbour of
  // either building turns the walk back into one that fits, the app has a
  // specific culprit, and the innocent half of the pair gets its clock
  // questioned for nothing — a tap that can only be answered "yes". See
  // `neighbourDoubt()`; the guilty half carries the doubt on its BUILDING.
  if (worst && ctx && ctx.neighbours && resolvableByNeighbour(classes, cls, worst, ctx)) {
    return null;
  }
  return worst;
}

/** Does swapping either end of a too-tight walk for a one-stroke neighbour of
 *  that building make the walk fit? */
function resolvableByNeighbour(classes, cls, tight, ctx) {
  const rm = ctx.routeMinutes;
  if (!rm) return false;
  const ends = [[cls.building, tight.other.building], [tight.other.building, cls.building]];
  for (const pair of ends) {
    for (const alt of (ctx.neighbours(String(pair[0] || '').toUpperCase()) || [])) {
      let m = null;
      try { m = rm(alt, pair[1]); } catch (e) { m = null; }
      if (m != null && isFinite(m) && tight.gap + CONF.walk.slackMin >= m) return true;
    }
  }
  return false;
}

/**
 * The two walks a student actually makes around one class: the one in, from
 * whichever class ended last before it, and the one out, to whichever starts
 * first after it. Never every class on the day — a walk to a class four hours
 * later is not a walk anybody takes, and counting it would let a distant
 * afternoon lab decide what a morning building is called.
 */
function adjacentLegs(classes, cls) {
  const s = minutesOf(cls.start), e = minutesOf(cls.end);
  if (s == null || e == null) return [];
  let before = null, after = null;
  for (const o of classes) {
    if (o === cls || o.day !== cls.day || !o.building) continue;
    const os = minutesOf(o.start), oe = minutesOf(o.end);
    if (os == null || oe == null) continue;
    if (oe <= s && (!before || oe > minutesOf(before.end))) before = o;
    if (os >= e && (!after || os < minutesOf(after.start))) after = o;
  }
  const out = [];
  if (before) out.push({ other: before, gap: s - minutesOf(before.end), dir: 'in' });
  if (after) out.push({ other: after, gap: minutesOf(after.start) - e, dir: 'out' });
  return out;
}

/**
 * THE HOLE THE PREVIOUS ROUND OF THIS FILE COULD NOT SEE, AND THE TWO WITNESSES
 * THAT CAN SEE INTO IT.
 *
 * Everything above asks "is this a building?" — the lexicon, the room grammar,
 * the clock. Thirteen pairs of REAL codes in this app's own 209-code lexicon
 * are one confusable character apart, and when the engine reads one of a pair
 * AS the other, every one of those checks answers YES. `building.lexicon` gives
 * it 1.00 and it is written into a student's schedule in silence. MEZ is Mezes
 * Hall on the South Mall. NEZ is the North End Zone Building, inside the
 * football stadium, 803 m and nine minutes away. The benchmark corpus's own
 * schedule s3 puts a real class in MEZ 1.306, so this is not hypothetical.
 *
 * Two things in this repo can tell a real code from the wrong real code:
 *
 *   1. THE CAMPUS WALKING GRAPH, read through the rest of the student's own
 *      day. A wrong building changes every distance around it. If swapping the
 *      reading for its one-stroke neighbour turns a walk that does not fit into
 *      one that does — or merely saves `CONF.walk.gainMin` minutes across both
 *      adjacent walks — that neighbour is worth one tap.
 *   2. UT'S OWN PRINTED NAME for the building. `TSG` is "27TH STREET GARAGE"
 *      and `TSC` is the swimming centre. Nobody is taught in a car park.
 *
 * IT ASKS. IT NEVER REWRITES. The four characters are a real code and there is
 * nothing wrong with the reading, so this is a RELATIONAL doubt in the sense
 * §2 of this file uses the word: the reading stays in the first button, the
 * neighbour goes second, and the reason is printed underneath. A student who
 * genuinely has a class in the North End Zone Building pays exactly one tap for
 * that, which is the trade this whole file is built on.
 *
 * Returns null — SILENTLY — when the graph is not loaded, when either code has
 * no door in it, or when the class has no neighbour on its day. A check with no
 * data guesses at nothing; `review()` reports whether it was live.
 */
function neighbourDoubt(cls, classes, ctx) {
  if (!CONF.walk.neighbour) return null;
  const code = String(cls.building || '').toUpperCase();
  if (!code || !ctx.neighbours) return null;
  const alts = ctx.neighbours(code) || [];
  if (!alts.length) return null;

  // ── 1. THE VENUE. Cheapest, needs no graph, and catches the pairs the graph
  //       cannot separate because they are next door to each other.
  if (CONF.venue.on && ctx.registerName) {
    const mine = ctx.registerName(code);
    if (mine && CONF.venue.unlikely.test(String(mine).toUpperCase())) {
      const ordinary = alts.filter(a => {
        const n = ctx.registerName(a);
        return n && !CONF.venue.unlikely.test(String(n).toUpperCase());
      });
      if (ordinary.length) {
        return {
          kind: 'venue',
          factor: CONF.building.venueNeighbour,
          options: ordinary,
          resolves: false,
          why: code + ' is ' + titleish(mine) + ', and ' + ordinary.join(' or ') +
            ' is one stroke away',
        };
      }
    }
  }

  // ── 2. THE WALK, read through the rest of the day.
  const rm = ctx.routeMinutes;
  if (!rm || !CONF.walk.on) return null;
  const legs = adjacentLegs(classes, cls);
  if (!legs.length) return null;
  // Every leg has to be measurable under EVERY candidate or the comparison is
  // between two different questions. A partial answer here is not a smaller
  // answer, it is a wrong one.
  const cost = (c) => {
    let sum = 0, impossible = 0;
    for (const l of legs) {
      let m = null;
      try { m = rm(l.other.building, c); } catch (err) { m = null; }
      if (m == null || !isFinite(m)) return null;
      sum += m;
      if (l.gap + CONF.walk.slackMin < m) impossible++;
    }
    return { sum, impossible };
  };
  const mine = cost(code);
  if (!mine) return null;
  let best = null;
  for (const a of alts) {
    const c = cost(a);
    if (!c) continue;
    // A swap earns a question two ways: it makes an impossible day possible,
    // or it saves real walking. The first is much the stronger claim, so it
    // wins outright over any amount of saved minutes.
    const fixes = c.impossible < mine.impossible;
    const nearer = c.impossible === mine.impossible &&
      mine.sum - c.sum >= CONF.walk.gainMin;
    if (!fixes && !nearer) continue;
    const rank = (fixes ? 1000 : 0) + (mine.sum - c.sum);
    if (!best || rank > best.rank) best = { code: a, c, fixes, rank };
  }
  if (!best) return null;
  const saved = Math.round(mine.sum - best.c.sum);
  return {
    kind: best.fixes ? 'walk-fixes' : 'walk-nearer',
    factor: best.fixes ? CONF.building.walkNeighbour : CONF.building.nearerNeighbour,
    options: [best.code],
    // When the neighbour makes an impossible day possible, the BUILDING is the
    // likely misread and the clock is probably fine. score() uses this to move
    // the question off the time and onto the building rather than asking twice
    // about one line of a picture.
    resolves: best.fixes,
    why: best.fixes
      ? 'there is not enough time to walk to ' + code + ' here, but ' +
        best.code + ' — one stroke away — fits'
      : best.code + ' is one stroke from ' + code + ' and is ' + saved +
        ' minutes closer to the classes either side of it',
  };
}

/** "27TH STREET GARAGE" -> "27th Street Garage". The register shouts. */
function titleish(name) {
  return String(name).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

/* ════════════════════════════════════════════════════════════════════════════
   THE SCORE
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * score(cls, ctx) -> { overall, fields, notes }
 *
 * `overall` is the MINIMUM of the four fields, not their average. A class is
 * only as trustworthy as its worst field, because a class with a wrong room is
 * a wrong class no matter how certain the other three are — and an average lets
 * a perfect time and a perfect day hide a room nobody could read.
 */
export function score(cls, ctx = {}) {
  const ev = cls.ev || {};
  const f = ev.flags || {};
  const conf = ev.conf || {};
  const from = ev.from || {};
  const classes = ctx.classes || [];
  const notes = { building: [], room: [], day: [], time: [] };
  // TWO KINDS OF DOUBT, AND THEY LEAD TO DIFFERENT QUESTIONS.
  //
  // A DEFECT is something wrong with the READING: a code that is not a code, a
  // room with a percent sign in it, an end time nothing ends at. When the app
  // can NAME what is wrong with what it read, it must not put what it read
  // under the student's thumb as the first button — that is how a wrong answer
  // gets confirmed by a person who is skimming.
  //
  // A SOFT doubt is everything else: a clash with a neighbour ("this is at the
  // very same hour as your history class"), or a defect this file has ALREADY
  // CORRECTED — a code read as PAL and repaired to PAI is shown as PAI, and
  // there is nothing wrong with PAI. Those are reasons to ask; they are not
  // reasons to move the answer out of the first button.
  const defect = { building: false, room: false, day: false, time: false };
  const mul = (bag, m, why, soft) => {
    if (why) { notes[bag].push(why); if (!soft) defect[bag] = true; }
    return m;
  };

  /* ── building ─────────────────────────────────────────────────────────── */
  let b = fromOcr(conf.building);
  const cands = (ev.candidates && ev.candidates.building) || [];
  if (f.edge && f.edge.building) {
    b *= mul('building', CONF.building.cutOff, 'the code runs off the edge of the picture');
  } else if (from.building === 'lexicon' || f.knownCode) {
    b *= CONF.building.lexicon;
  } else if (cands.length >= 2) {
    b *= mul('building', CONF.building.ambiguous,
      'it could be ' + cands.slice(0, 3).join(' or ') + ' — one letter apart');
  } else if (f.repaired || from.building === 'repaired') {
    // SOFT: the button says PAI and PAI is a real building. The doubt is real
    // and it is why we are asking, but there is no second candidate to lead
    // with — repairCode() only ever repairs when EXACTLY ONE real code fits.
    b *= mul('building', CONF.building.repaired,
      'read as "' + (f.rawCode || '?') + '"; the only real code it can be is ' + cls.building, true);
  } else {
    b *= mul('building', CONF.building.unknownShape,
      '"' + (cls.building || '?') + '" is not a building code this app knows');
  }
  // A REAL CODE THAT MAY STILL BE THE WRONG REAL CODE. Soft, always: the four
  // characters are a real building and nothing is wrong with them, so the
  // reading keeps the first button and this is printed as the reason for
  // asking. `extraCodes` rides out on the score so buildQuestion() can put the
  // neighbour in the second button without recomputing any of this.
  const nb = neighbourDoubt(cls, classes, ctx);
  if (nb) {
    b *= mul('building', nb.factor, nb.why, true);
  }

  /* ── room ─────────────────────────────────────────────────────────────── */
  let r = fromOcr(conf.room);
  const room = String(cls.room || '').toUpperCase();
  if (f.edge && f.edge.room) {
    r *= mul('room', CONF.room.cutOff, 'the room runs off the edge of the picture');
  }
  if (f.joined) r *= mul('room', CONF.room.joined, 'the building and room were run together');
  if (from.room === 'agreed-across-days') {
    r *= f.borrowed && !conf.room
      ? mul('room', CONF.room.borrowed, 'nothing read here; this is the same class on another day')
      : mul('room', CONF.room.agreed, null);
  }
  if (room && !ROOM_ANY.test(room)) {
    r *= mul('room', CONF.room.strayChars, '"' + room + '" has characters a room number does not');
  } else if (room && !ROOM_DOTTED.test(room) && !ROOM_PLAIN.test(room)) {
    r *= mul('room', CONF.room.grammar, '"' + room + '" is not a shape UT room numbers take');
  }
  const sibs = siblingRooms(classes, cls);
  if (room && !/\./.test(room) && sibs.some(s => /\./.test(s))) {
    r *= mul('room', CONF.room.dotMismatch,
      'every other room in ' + cls.building + ' on this picture has a dot in it');
  } else if (/^\d{4}$/.test(room)) {
    // A DROPPED PERIOD IS THE COMMONEST WAY A ROOM NUMBER GOES WRONG, and it is
    // invisible: "2122" is a plausible-looking room and "2.122" is the real
    // one. This does not rewrite it — it asks.
    r *= mul('room', CONF.room.fourDigits,
      'UT writes this room as ' + room[0] + '.' + room.slice(1) + ' — the dot may not have read');
  }
  const fl = roomFloorSuspect(cls.building, room, ctx.floors);
  if (fl) {
    r *= mul('room', CONF.room.floorOver,
      cls.building + ' has ' + fl.storeys + ' floors, so there is no floor ' + fl.floor);
  }

  /* ── day ──────────────────────────────────────────────────────────────── */
  let d = from.day === 'column' ? 1 : fromOcr(conf.day);
  if (from.day === 'column') {
    notes.day.push('taken from the column it is drawn in, not from reading it');
    d *= CONF.day.column;
  } else {
    d *= CONF.day.letters;
    if (f.repairedDay) d *= mul('day', CONF.day.repairedRun, 'the day letters needed repairing');
    if (d < CONF.askBelow) {
      notes.day.push('the day letters came off the picture faintly — the engine itself ' +
        'was only ' + Math.round((conf.day == null ? 50 : conf.day)) + '% sure of them');
    }
  }

  /* ── time ─────────────────────────────────────────────────────────────── */
  let t;
  if (from.time === 'axis') {
    t = f.axisAgrees === true
      ? mul('time', CONF.time.axisAgrees, null)
      : (f.axisAgrees === false
        ? CONF.time.axisAlone * mul('time', CONF.time.disagree,
          'the calendar draws it at one time and its own caption says another')
        : mul('time', CONF.time.axisAlone, null));
  } else {
    t = fromOcr(conf.time);
  }
  if (f.edge && f.edge.time) {
    t *= mul('time', CONF.time.cutOff, 'the time runs off the edge of the picture');
  }
  if (f.noMeridiem) {
    t *= mul('time', CONF.time.noMeridiem, 'no am or pm was printed, so morning or afternoon is a guess');
  }
  const s = minutesOf(cls.start), e = minutesOf(cls.end);
  if (s != null) {
    const mm = s % 60;
    if (CONF.clock.goodStartMins.indexOf(mm) < 0 && CONF.clock.okStartMins.indexOf(mm) < 0) {
      t *= mul('time', CONF.time.offGrid, 'classes do not start at ' + clockOf(s));
    }
  }
  if (e != null) {
    const mm = e % 60;
    if (CONF.clock.goodEndMins.indexOf(mm) < 0 && CONF.clock.okEndMins.indexOf(mm) < 0) {
      t *= mul('time', CONF.time.endOffGrid, 'nothing ends at ' + clockOf(e) +
        ' — a calendar draws a gap between classes and the block stops short of the hour');
    }
  }
  if (s != null && e != null) {
    const len = e - s;
    const okLen = CONF.clock.goodLengths.some(g => Math.abs(g - len) <= CONF.clock.lenTol);
    if (!okLen) t *= mul('time', CONF.time.oddLength, 'a ' + len + '-minute class is an unusual length');
  }
  const hit = collidesWith(classes, cls);
  if (hit) {
    const exact = hit.__exact;
    t *= mul('time', exact ? CONF.time.collidesExactly : CONF.time.overlapsPartly,
      exact
        ? 'this is at the very same hour as ' +
          (hit.course || (hit.building + ' ' + hit.room)) + ', on the same ' + cls.day
        : 'this overlaps ' + (hit.course || (hit.building + ' ' + hit.room)) +
          ' on the same ' + cls.day, true);
  }
  // ONE QUESTION, ABOUT THE THING THAT IS ACTUALLY LIKELY WRONG. When a
  // one-stroke neighbour turns the impossible walk into a possible one, the
  // BUILDING is the misread and the clock is fine — asking about both would
  // spend a second tap teaching the student that this screen does not know
  // what it is asking. The doubt has already been charged to the building
  // above; charging it again here would double-count one piece of evidence.
  const tight = (nb && nb.resolves) ? null : tooTightToWalk(classes, cls, ctx.routeMinutes, ctx);
  if (tight) {
    t *= mul('time', CONF.time.tooTight,
      'only ' + tight.gap + ' minutes between this and ' + tight.to + ', which is a ' +
      tight.need + '-minute walk', true);
  }

  const fields = { building: clamp01(b), room: clamp01(r), day: clamp01(d), time: clamp01(t) };
  // How well the CHARACTERS came off the page, with no cross-check applied.
  // Used only to decide what goes in the first button — see `defect` above.
  const legible = {
    building: fromOcr(conf.building), room: fromOcr(conf.room),
    day: from.day === 'column' ? 1 : fromOcr(conf.day),
    time: from.time === 'axis' ? 1 : fromOcr(conf.time),
  };
  return {
    fields, notes, defect, legible,
    // The one-stroke neighbours worth offering, and why — carried out of the
    // score so the question can be built without re-running the graph.
    extraCodes: nb ? nb.options : [],
    neighbour: nb ? { kind: nb.kind, resolves: nb.resolves } : null,
    overall: Math.min(fields.building, fields.room, fields.day, fields.time),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE QUESTIONS — "here are the two it might be", never a text field first

   A text field is the wrong control for this. The student is looking at a
   photograph of their own schedule on a 390 px screen with one thumb; typing
   "GDC 2.216" is eleven keystrokes and a chance to typo, and the reader already
   knows the answer is one of two things. So every question is buttons, with a
   keyboard behind a "Type it" escape hatch for the case where it genuinely is
   none of them.
   ════════════════════════════════════════════════════════════════════════════ */

// Digits Tesseract genuinely swaps at these sizes, on the hour of a clock.
// Narrower than js/schedimg.js's CONFUSE because this list writes CANDIDATES
// for a student to pick from, and a list of six is not a choice.
const DIGIT_SWAP = {
  0: '68', 1: '7', 2: '7', 3: '8', 4: '9', 5: '6', 6: '58', 7: '12', 8: '30', 9: '4',
};

/** The nearest minute-of-the-hour a real class starts or ends on, or null. */
function snapTo(min, good, ok, maxMove) {
  if (min == null) return null;
  const mm = min % 60;
  if (good.indexOf(mm) >= 0 || ok.indexOf(mm) >= 0) return null;
  let best = null;
  for (const g of good.concat(ok)) {
    for (const base of [min - mm - 60, min - mm, min - mm + 60]) {
      const cand = base + g;
      const d = Math.abs(cand - min);
      if (d <= maxMove && (!best || d < Math.abs(best - min))) best = cand;
    }
  }
  return best;
}

function timeVariants(cls) {
  const s = minutesOf(cls.start), e = minutesOf(cls.end);
  if (s == null || e == null) return [];
  const len = e - s;
  const out = [];
  // `targeted` = this variant is the FIX for a defect that was actually named,
  // not a guess. It is the whole basis of what goes in the first button when
  // the question is open — see buildQuestion().
  const push = (start, end, why, targeted) => {
    if (start == null || end == null || (start === s && end === e)) return;
    if (start < CONF.clock.dayFirstHour * 60 || start > CONF.clock.dayLastHour * 60) return;
    if (!(end > start)) return;
    if (out.some(o => o.start === start && o.end === end)) return;
    out.push({ start, end, why, targeted: !!targeted });
  };
  // THE OPTIONS HAVE TO CONTAIN THE RIGHT ANSWER OR THE QUESTION IS A TAX.
  // Measured: with only the variants below, the one wrong-and-asked class on
  // the corpus whose truth was NOT among the buttons was `09:30-10:55` against
  // a real `09:30-11:00` — the five-minute seam. Snapping each end to the
  // nearest hour a class really starts or ends on puts it in the list, and it
  // goes FIRST because it is by far the likeliest correction.
  const C = CONF.clock;
  const se = snapTo(e, C.goodEndMins, C.okEndMins, 12);
  const ss = snapTo(s, C.goodStartMins, C.okStartMins, 12);
  if (se != null || ss != null) {
    push(ss == null ? s : ss, se == null ? e : se,
      'on the hour the calendar really draws', true);
  }
  // The half-day flip — but ONLY where no am/pm was printed. A 9:30 with "am"
  // beside it on the page is not a candidate for 9:30 at night, and offering it
  // pushes the answer that IS a candidate down the list.
  if (cls.ev && cls.ev.flags && cls.ev.flags.noMeridiem) {
    const flip = s < 12 * 60 ? s + 12 * 60 : s - 12 * 60;
    push(flip, flip + len, 'the other half of the day', true);
  }
  // One confusable digit in the hour.
  const h = Math.floor(s / 60), mm = s % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  for (const alt of (DIGIT_SWAP[String(h12).slice(-1)] || '')) {
    const cand = +(String(h12).length === 2 ? String(h12)[0] + alt : alt);
    if (!cand || cand > 12) continue;
    const pm = h >= 12;
    const h24 = cand % 12 + (pm ? 12 : 0);
    // NOT targeted: nothing said the hour digit was wrong, this is a guess at
    // what it could have been. It goes BELOW the reading.
    push(h24 * 60 + mm, h24 * 60 + mm + len,
      'the hour digit read as ' + h12 + ' and ' + cand + ' look alike', false);
  }
  return out;
}

function roomVariants(cls, classes) {
  const room = String(cls.room || '').toUpperCase();
  const out = [];
  const push = (v, why, targeted) => {
    if (!v || v === room || out.some(o => o.room === v)) return;
    out.push({ room: v, why, targeted: !!targeted });
  };
  if (/^\d{4}$/.test(room)) push(room[0] + '.' + room.slice(1), 'with the dot UT writes it with', true);
  if (/^\d{3}$/.test(room)) push(room[0] + '.' + room.slice(1), 'with the dot UT writes it with', true);
  if (/^\d\.\d{3}$/.test(room)) push(room.replace('.', ''), 'without the dot', true);
  // NOT targeted: another room in the same building is a plausible answer, not
  // a correction for anything that was named. It goes below the reading.
  for (const s of siblingRooms(classes, cls)) push(s, 'another room read in ' + cls.building, false);
  return out;
}

/** "Mon","Wed","Fri" -> "Mon, Wed and Fri" — a sentence, not a token. */
function daysPhrase(days) {
  const d = (days || []).slice().sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  if (!d.length) return '';
  if (d.length === 1) return d[0];
  return d.slice(0, -1).join(', ') + ' and ' + d[d.length - 1];
}

/**
 * One question, about one READING — never about one meeting.
 *
 * A Tuesday/Thursday course is two rows in `classes` and ONE line of the
 * picture. Asking twice is one question wearing two hats, and asking "is this
 * on Tuesday?" about a TTh reading is worse than useless: the honest question
 * is "which days is this on?", and the honest control for it is a set of day
 * chips, not a list of single days where picking one silently deletes the
 * other.
 *
 * `options[0]` is the reading itself UNLESS a cross-check NAMED a defect in it,
 * or the characters themselves came off the page below CONF.trustBelow. In
 * either of those cases the correction leads and the wording becomes an open
 * question rather than a check — see `defect` in score().
 */
function buildQuestion(group, field, ctx, idx) {
  const cls = group.lead;
  const ev = cls.ev || {};
  const conf = group.score.fields[field];
  // THE READING LEADS ONLY WHEN NOTHING NAMED A DEFECT IN IT. See `defect` in
  // score(): "this overlaps your history class" is a reason to ask and not a
  // reason to doubt these four characters; "nothing ends at 10:55" is both.
  const trusted = !group.score.defect[field] &&
    group.score.legible[field] >= CONF.trustBelow;
  const boxes = ev.boxes || {};
  let ask, current, kind = 'pick';
  // THREE BUCKETS, ASSEMBLED IN ONE ORDER AT THE END.
  //
  //   fix   a candidate that is the ANSWER to a defect that was actually named:
  //         the hour the calendar really draws, the dot UT writes the room
  //         with, the two real codes a bad code is one character from.
  //   read  what the picture says.
  //   also  plausible alternatives nobody asked for — a confusable hour digit,
  //         another room in the same building.
  //
  // Trusted:   read, fix, also.
  // Untrusted: fix, read, also.
  //
  // The second line of that is the one worth writing down. An earlier version
  // put EVERY variant above the reading whenever the question was open, and on
  // corpus image 10 that offered "7:00 pm" as the leading answer to a class the
  // picture says is at 2 — because the calendar's ruler and its caption
  // disagreed, which is a defect with no candidate fix. A guess is never a
  // better first button than the reading.
  const fix = [], also = [];
  const read = [];

  if (field === 'building') {
    current = cls.building;
    const cands = ((ev.candidates && ev.candidates.building) || []).filter(c => c !== current);
    ask = trusted
      ? 'Is this building ' + current + '?'
      : (cands.length ? 'Which building is this?' : 'What building is this?');
    if (current) read.push({ value: current, label: current, note: 'what the picture reads' });
    for (const c of cands) {
      fix.push({ value: c, label: c, note: ctx.buildingName ? ctx.buildingName(c) : null });
    }
    // THE ONE-STROKE NEIGHBOUR OF A CODE THAT IS ITSELF REAL. `cands` above is
    // empty in this case by construction — codeCandidates() returns just the
    // code when the code is on the register — which is exactly why the previous
    // round of this file had nothing to offer here and the misread went through
    // in silence. This is the button that closes it.
    for (const c of (group.score.extraCodes || [])) {
      if (c === current || cands.indexOf(c) >= 0) continue;
      fix.push({ value: c, label: c, note: ctx.buildingName ? ctx.buildingName(c) : null });
    }
  } else if (field === 'room') {
    current = cls.room;
    ask = trusted ? 'Is the room ' + current + '?' : 'Which room is this?';
    if (current) read.push({ value: current, label: current, note: 'what the picture reads' });
    for (const v of roomVariants(cls, ctx.classes || [])) {
      (v.targeted ? fix : also).push({ value: v.room, label: v.room, note: v.why });
    }
  } else if (field === 'time') {
    const s = minutesOf(cls.start), e = minutesOf(cls.end);
    current = cls.start + '-' + cls.end;
    const lab = (a, b) => clockOf(a) + ' to ' + clockOf(b);
    ask = trusted ? 'Is this ' + clockOf(s) + ' to ' + clockOf(e) + '?' : 'When is this class?';
    read.push({ value: current, label: lab(s, e), note: 'what the picture reads' });
    for (const v of timeVariants(cls)) {
      (v.targeted ? fix : also).push({
        value: hhmmOf(v.start) + '-' + hhmmOf(v.end),
        label: lab(v.start, v.end), note: v.why,
      });
    }
  } else {
    kind = 'days';
    current = group.days.join(',');
    ask = trusted
      ? 'Is this on ' + daysPhrase(group.days) + '?'
      : 'Which days is this on?';
    // The chips ARE the options — one per weekday, pre-selected to the reading.
    // Order is the week, so no bucket applies.
    for (const d of DAY_ORDER.slice(0, 5)) {
      read.push({ value: d, label: d === 'Thu' ? 'Th' : d[0], note: null,
        on: group.days.indexOf(d) >= 0 });
    }
  }
  const ordered = trusted ? read.concat(fix, also) : fix.concat(read, also);
  let options = kind === 'days' ? read : ordered.slice(0, CONF.ask.maxOptions);
  // THE READING MUST SURVIVE THE CAP. It is the only option that is certainly
  // on the student's picture; a list of four guesses with the actual reading
  // trimmed off the end is a screen that has stopped showing them their own
  // schedule.
  if (kind !== 'days' && read.length && !options.some(o => o.value === read[0].value)) {
    options = options.slice(0, CONF.ask.maxOptions - 1).concat(read[0]);
  }

  return {
    id: 'q' + idx,
    field, kind, groupId: group.id, classKey: cls.__key, ask, current,
    confidence: conf, trusted,
    why: (group.score.notes[field] || []).join('; ') || null,
    options: kind === 'days' ? options : options.slice(0, CONF.ask.maxOptions),
    box: boxes[field] || boxes.all || null,
    context: boxes.all || boxes.block || null,
    answer: null,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   review() — the whole judgement, in one call
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * review(out, opts) -> {
 *   classes:   every proposal, each with .score and .ask
 *   questions: what the screen asks, in the order it asks it
 *   recover:   items js/schedimg.js REFUSED that a tap could still rescue
 *   counts, walkCheck, line
 * }
 *
 * `out` is exactly what js/schedimg.js's extract() returned.
 */
export function review(out, opts = {}) {
  const classes = (out && out.classes ? out.classes : []).map((c, i) =>
    Object.assign({}, c, { __key: 'c' + i }));
  const ctx = {
    classes,
    routeMinutes: opts.routeMinutes || null,
    floors: opts.floors || null,
    buildingName: opts.buildingName || null,
    // code -> the OTHER real codes it is one confusable stroke from, and UT's
    // own printed name for a code. Both come from prepare() below, so the
    // caller gets them without knowing they exist.
    neighbours: opts.neighbours || null,
    registerName: opts.registerName || null,
  };
  // ── ONE READING, NOT ONE MEETING, IS THE UNIT EVERYWHERE BELOW ──────────
  // A Tuesday/Thursday course is two rows in `classes` and ONE line of the
  // picture; js/schedimg.js hands both rows the SAME evidence object by
  // reference, which is what makes them identifiable as one reading here.
  const groups = [];
  for (const c of classes) {
    let g = c.ev ? groups.find(x => x.ev === c.ev) : null;
    if (!g) {
      g = { id: 'g' + groups.length, ev: c.ev || null, members: [], days: [], lead: c };
      groups.push(g);
    }
    g.members.push(c);
    if (g.days.indexOf(c.day) < 0) g.days.push(c.day);
    c.__group = g.id;
  }
  const questions = [];
  for (const g of groups) {
    // Scored per MEETING — a collision and a too-tight walk are facts about one
    // day, not about a line of type — and the reading is as good as its worst
    // meeting, for the same reason a class is as good as its worst field.
    for (const c of g.members) c.score = score(c, ctx);
    g.score = g.members.reduce((a, c) => (a && a.overall <= c.score.overall ? a : c.score),
      null);
    g.days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
    g.ask = g.score.overall < CONF.askBelow;
    for (const c of g.members) c.ask = g.ask;
    if (!g.ask) continue;
    // The two worst fields, worst first. A reading needing three answers is a
    // line to re-photograph, and the summary says so rather than asking six
    // questions about one row of a picture.
    const fields = ['building', 'room', 'time', 'day']
      .filter(f => g.score.fields[f] < CONF.askBelow)
      .sort((a, b) => g.score.fields[a] - g.score.fields[b]);
    g.tooManyDoubts = fields.length > CONF.ask.maxQuestionsPerClass;
    for (const f of fields.slice(0, CONF.ask.maxQuestionsPerClass)) {
      questions.push(buildQuestion(g, f, ctx, questions.length));
    }
  }
  // Worst first: the answer most likely to be wrong is the one worth a tap.
  const merged = questions.sort((a, b) => a.confidence - b.confidence);
  merged.forEach((q, i) => { q.id = 'q' + i; });

  // WHAT WAS REFUSED IS NOT ALWAYS UNANSWERABLE. js/schedimg.js correctly
  // declines to write down a code that could be two real buildings — but it
  // knows which two, and the student can tell them apart in one look. These are
  // offered after the confirmations, never mixed in with them, and none of them
  // is ever added to a schedule without a tap.
  const recover = [];
  for (const u of (out && out.unsure ? out.unsure : [])) {
    const ev = u.ev;
    if (!ev) continue;
    const cands = (ev.candidates && ev.candidates.building) || [];
    if (!u.room || !u.day || !u.start || !u.end) continue;
    if (!cands.length && u.reason !== 'cut-off') continue;
    recover.push({
      course: u.course || null, building: u.building || null, room: u.room,
      day: u.day, days: u.days || [u.day], start: u.start, end: u.end,
      why: u.why, reason: u.reason || null,
      options: (cands.length ? cands : [u.building]).filter(Boolean)
        .slice(0, CONF.ask.maxOptions).map(c => ({ value: c, label: c })),
      box: (ev.boxes && (ev.boxes.all || ev.boxes.block)) || null,
      answer: null,
    });
  }

  const asked = classes.filter(c => c.ask).length;
  return {
    classes, groups, questions: merged, recover,
    sheet: (out && out.sheet) || null,
    counts: {
      total: classes.length,
      accepted: classes.length - asked,
      asked,
      readings: groups.length,
      readingsAsked: groups.filter(g => g.ask).length,
      // THE NUMBER THAT MATTERS TO A STUDENT: how many times they have to
      // touch the screen, not how many rows were doubted.
      questions: merged.length,
      recoverable: recover.length,
      seenNotRead: (out && out.seen && out.seen.onlySeen) || 0,
    },
    // WHETHER THE CROSS-CHECKS WERE LIVE, reported rather than assumed. A check
    // that silently does nothing when its data is missing is worse than one
    // that says so, and this is the line a gate reads to prove the strongest
    // check in the file is not inert.
    walkCheck: {
      active: !!(opts.routeMinutes && CONF.walk.on),
      neighbours: !!(opts.neighbours && CONF.walk.neighbour),
      venue: !!(opts.registerName && CONF.venue.on),
      source: opts.walkSource || null,
    },
    line: { askBelow: CONF.askBelow, trustBelow: CONF.trustBelow },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   prepare() — the cross-checks, loaded, so that nobody has to know they exist

   THIS IS THE FIX FOR THE WORST THING ABOUT THE PREVIOUS ROUND OF THIS FILE.
   The campus-graph check was built, tested and INERT, because it needed a
   `routeMinutes` the caller had to supply and the only router in the repo is
   `window.wayfindRoute` — which is async, drives the UI and draws a ribbon
   across the city, so it cannot be used as a quiet probe behind a confirm
   screen. The check protected nobody.

   `js/walkgraph.js` is that probe: the same `data/walk_graph.json`, the same
   cost model out of the same file, no DOM and no side effects. So the default
   is now ON, and a caller who passes no options at all still gets every
   cross-check this file has.

   Everything it loads is same-origin, lazy and optional: a failure returns a
   ctx with that check switched off rather than throwing, and `review()`'s
   `walkCheck` says which ones were live.
   ════════════════════════════════════════════════════════════════════════════ */

export async function prepare(opts = {}) {
  const out = { walkSource: null };
  // The lexicon and the register. js/schedimg.js has already fetched this file
  // by the time anybody is looking at a result, so this is a cache hit.
  if (opts.neighbours === undefined || opts.registerName === undefined ||
      opts.buildingName === undefined) {
    try {
      const si = await import('./schedimg.js');
      const reg = await si.buildingRegister();
      const codes = new Set(reg.keys());
      if (opts.neighbours === undefined) {
        out.neighbours = (c) => si.codeNeighbours(c, codes);
      }
      if (opts.registerName === undefined) out.registerName = (c) => reg.get(c) || null;
      if (opts.buildingName === undefined) {
        out.buildingName = (c) => (reg.get(c) ? titleish(reg.get(c)) : null);
      }
    } catch (e) { /* no register -> the neighbour and venue checks stay off */ }
  }
  // The walking graph.
  if (opts.routeMinutes === undefined && CONF.walk.on) {
    try {
      const wg = await import('./walkgraph.js');
      const probe = await wg.walkProbe();
      if (probe) {
        out.routeMinutes = (a, b) => probe.minutes(a, b);
        out.walkSource = 'walk_graph.json' + (probe.asOf ? ' @ ' + probe.asOf : '');
        out.walkProbe = probe;
      }
    } catch (e) { /* no graph -> the walk check stays silent, never guesses */ }
  }
  return Object.assign(out, opts);
}

/**
 * The whole seam, in one call: a file a student picked -> the confirm screen on
 * screen -> the classes they confirmed.
 *
 *     const { classes } = await confirmFromFile(file, host);
 *
 * `js/schedimg.js` and `js/schedconfirm.js` and `js/walkgraph.js` are all
 * dynamic imports underneath this, so an app that never calls it pays nothing
 * for it. Resolves when the student presses "Use these" or closes the screen;
 * closing gives back an empty list, never a half-confirmed one.
 */
export async function confirmFromFile(file, host, opts = {}) {
  const si = await import('./schedimg.js');
  const out = await si.extract(file, Object.assign({ keepSheet: true }, opts.extract || {}));
  const ctx = await prepare(opts);
  const rev = review(out, ctx);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const ui = mount(host, rev, Object.assign({}, opts, {
      onDone: (res) => { finish(res || apply(rev)); if (opts.onDone) opts.onDone(res); },
      onCancel: () => { finish({ classes: [], dropped: [] }); if (opts.onCancel) opts.onCancel(); },
    }));
    ui.review = rev;
  });
}

/**
 * apply(rev) -> { classes, dropped }
 *
 * Every answer is written onto EVERY copy of the class it belongs to, which is
 * what makes a Tuesday/Thursday course one question. A question the student
 * never answered keeps its reading only if the reading was above
 * `keepUnansweredAbove` — closing this screen must not be a way to save a
 * reading nothing believed.
 */
/**
 * One reading, with the student's answers written in -> the meetings it
 * becomes, or a reason it becomes none. Shared by apply() and the summary
 * screen so the list a student presses "Use these" under is built by the same
 * code that produces what gets used.
 */
export function applyGroup(rev, g) {
  if (g.dropped) return { classes: [], why: 'left out by the student' };
  const qs = rev.questions.filter(q => q.groupId === g.id);
  const answered = qs.filter(q => q.answer != null);
  const unanswered = qs.length - answered.length;
  // A reading nothing believed, that nobody confirmed, does not get into the
  // schedule because a screen was closed. That is the silent wrong answer by
  // another route, and it is the one thing this file exists to prevent.
  if (unanswered > 0 && g.score.overall < CONF.keepUnansweredAbove) {
    return { classes: [], why: 'not confirmed, and too unclear to keep' };
  }
  const patch = {};
  let days = g.days.slice();
  for (const q of answered) {
    if (q.field === 'time') {
      const parts = String(q.answer).split('-');
      patch.start = parts[0]; patch.end = parts[1];
    } else if (q.field === 'day') {
      days = String(q.answer).split(',').filter(Boolean);
    } else { patch[q.field] = q.answer; }
  }
  if (!days.length) return { classes: [], why: 'no day left after your answer' };
  const classes = [];
  for (const day of days) {
    const from = g.members.find(m => m.day === day) || g.lead;
    const copy = Object.assign({}, from, patch, {
      day, days: [day],
      confirmed: qs.length > 0 && unanswered === 0,
      needsConfirm: unanswered > 0,
    });
    delete copy.ev; delete copy.__key; delete copy.__group; delete copy.score;
    classes.push(copy);
  }
  return { classes, why: null };
}

export function apply(rev) {
  const out = [], dropped = [];
  for (const g of rev.groups) {
    const res = applyGroup(rev, g);
    if (!res.classes.length) { dropped.push({ cls: g.lead, why: res.why }); continue; }
    for (const c of res.classes) out.push(c);
  }
  for (const r of (rev.recover || [])) {
    if (!r.answer) continue;
    for (const day of (r.days || [r.day])) {
      out.push({
        course: r.course, building: r.answer, room: r.room, day, days: [day],
        start: r.start, end: r.end, confirmed: true, needsConfirm: false,
        why: 'confirmed by you from the picture',
      });
    }
  }
  return { classes: out, dropped };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE SCREEN

   ONE QUESTION AT A TIME, ON A PHONE, WITH ONE THUMB.

   A list of seven classes each with two flags is a form, and a form is what a
   student abandons. A stepper is not: it shows one crop, one sentence and two
   or three buttons, and it tells you how many are left. Every control that ends
   a step sits in the BOTTOM half of the panel, which on a 390x844 phone is
   where a thumb is; the crop and the question sit above them, which is where
   eyes are. The panel is the import screen's twin — same glass, same radius,
   same corner — because it is the same job continuing, not a new surface.
   ════════════════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'wf-cfm-style';

// No backtick may appear inside this literal — a CSS comment containing one
// has broken a file in this repo before.
const CSS = `
#wf-cfm{
  --cfm-crop:96px;
  --cfm-opt:48px;
  --cfm-ink:var(--wf-ink,#f8ead0);
  --cfm-dim:var(--wf-dim,rgba(248,234,208,.60));
  --cfm-dimmer:var(--wf-dimmer,rgba(248,234,208,.42));
  --cfm-accent:var(--wf-accent,#ffc663);
  --cfm-edge:var(--wf-edge-soft,rgba(255,190,90,.12));
  --cfm-warn:#ffb4a0;
  --cfm-warn-bg:rgba(255,120,80,.10);
  position:absolute;top:68px;left:16px;z-index:32;width:344px;
  max-width:calc(100vw - 32px);max-height:calc(100vh - 110px);
  background:var(--wf-glass-solid,rgba(20,17,14,.92));
  backdrop-filter:blur(14px) saturate(1.1);
  border:1px solid rgba(255,190,90,.18);border-radius:var(--wf-radius,16px);
  box-shadow:var(--wf-shadow,0 18px 50px rgba(0,0,0,.55));
  color:var(--cfm-ink);font-size:12.5px;overflow:hidden;
  display:flex;flex-direction:column;
  font-family:inherit;-webkit-font-smoothing:antialiased}
#wf-cfm.hidden{display:none}
#wf-cfm *{box-sizing:border-box}

.cfm-head{display:flex;align-items:center;gap:10px;flex:none;
  padding:10px 10px 8px 14px;border-bottom:1px solid var(--cfm-edge)}
.cfm-title{font-size:11px;font-weight:700;letter-spacing:.17em;
  text-transform:uppercase;color:var(--cfm-dim);flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cfm-count{font-size:11px;color:var(--cfm-dimmer);flex:none;
  font-variant-numeric:tabular-nums}
.cfm-x{background:none;border:none;color:inherit;opacity:.6;cursor:pointer;
  width:30px;height:30px;flex:none;border-radius:8px;font-size:16px;line-height:1;
  padding:0;font-family:inherit}
.cfm-x:hover{opacity:1;background:rgba(255,255,255,.07)}

/* THE PROGRESS RULE. Four questions with no end in sight is why people quit
   forms; the bar is the promise that this stops. */
.cfm-bar{height:2px;background:rgba(255,255,255,.07);flex:none}
.cfm-bar-fill{height:100%;background:var(--cfm-accent);transition:width .18s ease}

.cfm-body{flex:1 1 auto;min-height:0;overflow-y:auto;
  -webkit-overflow-scrolling:touch;padding:12px 14px 2px;--cfm-fade:16px}
/* AN EDGE THAT IS CUT MUST NOT LOOK LIKE AN EDGE THAT IS FINISHED. Same rule
   and same mask as the import screen's body: without it the last row of a long
   summary reads as the last row, and a student stops scrolling with two of
   their classes still below the line. */
.cfm-body.cut-bot{
  -webkit-mask-image:linear-gradient(to top,transparent 0,#000 var(--cfm-fade));
  mask-image:linear-gradient(to top,transparent 0,#000 var(--cfm-fade))}
.cfm-body.cut-top{
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--cfm-fade));
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--cfm-fade))}
.cfm-body.cut-top.cut-bot{
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--cfm-fade),
    #000 calc(100% - var(--cfm-fade)),transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,#000 var(--cfm-fade),
    #000 calc(100% - var(--cfm-fade)),transparent 100%)}

/* THE STUDENT'S OWN PICTURE. Not a redrawing of it, not the grey plane the
   engine read — the pixels they photographed, upright, with the four characters
   in doubt ringed. Checking an answer against a picture you took two taps ago
   is a glance; hunting for the same row in the original is a chore, and a chore
   is where a student stops confirming and starts tapping yes. */
.cfm-crop{position:relative;height:var(--cfm-crop);border-radius:10px;
  overflow:hidden;background:#0d0b09;border:1px solid var(--cfm-edge);
  display:block;width:100%}
.cfm-crop canvas{display:block;width:100%;height:100%;object-fit:cover}
/* THE LABEL SITS UNDER THE CROP, NOT ON IT. As a floating chip it covered a
   row of the student's own table — and the entire point of the crop is that
   every pixel of it is theirs to read. */
.cfm-crop-cap{font-size:9px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--cfm-dimmer);margin:5px 0 0 2px}
.cfm-crop-none{display:grid;place-items:center;height:var(--cfm-crop);
  border-radius:10px;border:1px dashed var(--cfm-edge);color:var(--cfm-dimmer);
  font-size:10.5px;text-align:center;padding:0 16px;line-height:1.5}

.cfm-who{margin:11px 0 2px;font-size:13px;font-weight:600;letter-spacing:.01em}
.cfm-when{font-size:10.5px;color:var(--cfm-dimmer);margin-bottom:10px}
.cfm-ask{font-size:14.5px;line-height:1.35;font-weight:600;margin-bottom:6px}
.cfm-why{font-size:10.5px;line-height:1.5;color:var(--cfm-dim);
  background:var(--cfm-warn-bg);border:1px solid rgba(255,140,100,.20);
  border-radius:9px;padding:8px 10px;margin-bottom:11px}

.cfm-opts{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.cfm-opt{display:flex;align-items:center;gap:10px;width:100%;
  min-height:var(--cfm-opt);padding:8px 12px;text-align:left;
  background:rgba(255,255,255,.055);border:1px solid var(--cfm-edge);
  border-radius:11px;color:var(--cfm-ink);font:inherit;cursor:pointer;
  transition:background .12s,border-color .12s}
.cfm-opt:hover,.cfm-opt:focus-visible{background:var(--wf-hot,rgba(245,166,35,.30));
  border-color:rgba(245,166,35,.5);outline:none}
.cfm-opt.lead{border-color:rgba(245,166,35,.38);background:rgba(245,166,35,.13)}
.cfm-opt-v{font-size:15px;font-weight:700;letter-spacing:.02em;flex:none}
.cfm-opt-n{font-size:10px;color:var(--cfm-dimmer);line-height:1.35;flex:1;
  min-width:0;text-align:right}

/* DAY CHIPS. Five targets across 316 px is 56 px each with the gaps — wider
   than the 44 px floor, and a thumb can hit any of them without moving the
   hand. */
.cfm-chips{display:flex;gap:6px;margin-bottom:10px}
.cfm-chip{flex:1;min-width:0;height:var(--cfm-opt);border-radius:11px;
  background:rgba(255,255,255,.055);border:1px solid var(--cfm-edge);
  color:var(--cfm-dim);font:inherit;font-size:13px;font-weight:700;cursor:pointer;
  padding:0}
.cfm-chip.on{background:rgba(245,166,35,.24);border-color:rgba(245,166,35,.5);
  color:#fff3d4}
.cfm-wide{width:100%;margin-bottom:10px}

/* 44 px IS THE FLOOR ON EVERY CONTROL THAT ENDS A STEP, not only on the ones
   that answer. "Type it" and "Leave it out" were 38 px and the gate caught it:
   a secondary control that is hard to hit is not secondary, it is a mis-tap
   waiting to land on the primary one next to it. */
.cfm-alt{display:flex;gap:8px;margin-bottom:12px}
.cfm-alt button{flex:1;min-height:44px;background:none;
  border:1px solid var(--cfm-edge);border-radius:10px;color:var(--cfm-dim);
  font:inherit;font-size:11.5px;cursor:pointer;padding:0 8px}
.cfm-alt button:hover{background:rgba(255,255,255,.07);color:var(--cfm-ink)}
.cfm-type{display:flex;gap:8px;margin-bottom:12px}
.cfm-type input{flex:1;min-width:0;height:42px;padding:0 12px;
  background:rgba(255,255,255,.055);border:1px solid var(--cfm-edge);
  border-radius:10px;color:var(--cfm-ink);font:inherit;font-size:14px;
  letter-spacing:.04em}
.cfm-type input:focus{outline:none;border-color:rgba(245,166,35,.55)}
.cfm-type button{flex:none;padding:0 16px;height:42px;border-radius:10px;
  background:rgba(245,166,35,.22);border:1px solid rgba(245,166,35,.42);
  color:#fff3d4;font:inherit;font-weight:700;cursor:pointer}

.cfm-foot{flex:none;padding:9px 14px 12px;border-top:1px solid var(--cfm-edge);
  display:flex;align-items:center;gap:8px}
.cfm-back{background:none;border:none;color:var(--cfm-dimmer);font:inherit;
  font-size:11.5px;cursor:pointer;padding:8px 10px;min-height:44px}
.cfm-back:hover{color:var(--cfm-ink)}
.cfm-foot .cfm-spacer{flex:1}
.cfm-go{min-height:42px;padding:0 18px;border-radius:11px;
  background:rgba(245,166,35,.22);border:1px solid rgba(245,166,35,.42);
  color:#fff3d4;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.cfm-go:hover{background:rgba(245,166,35,.32)}
.cfm-go[disabled]{opacity:.45;cursor:default}

/* THE SUMMARY. Only the doubt is coloured — a class that read cleanly gets the
   same warm ink everything else that worked gets, so the eye lands on the
   thing that still needs a person. */
.cfm-sum{display:flex;flex-direction:column;gap:7px;margin-bottom:10px}
.cfm-row{display:flex;align-items:flex-start;gap:9px;padding:8px 10px;
  border-radius:10px;background:rgba(255,255,255,.04);
  border:1px solid var(--cfm-edge)}
.cfm-row.out{opacity:.45}
.cfm-row.flag{border-color:rgba(255,140,100,.24);background:var(--cfm-warn-bg)}
.cfm-row-m{flex:1;min-width:0}
.cfm-row-a{font-size:12.5px;font-weight:600;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.cfm-row-b{font-size:10.5px;color:var(--cfm-dimmer);margin-top:2px;line-height:1.4}
.cfm-row.flag .cfm-row-b{color:var(--cfm-warn)}
.cfm-row-x{flex:none;background:none;border:1px solid var(--cfm-edge);
  border-radius:8px;color:var(--cfm-dimmer);font:inherit;font-size:10.5px;
  min-height:32px;padding:0 9px;cursor:pointer}
.cfm-row-x:hover{color:var(--cfm-ink);background:rgba(255,255,255,.07)}
.cfm-note{font-size:10.5px;line-height:1.55;color:var(--cfm-dimmer);
  margin:2px 0 12px}
.cfm-priv{font-size:9.5px;line-height:1.5;color:var(--cfm-dimmer);
  padding:0 14px 10px;flex:none}
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

/** el('div', 'cls', 'text') — textContent only, never innerHTML. See header. */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Cut one field's neighbourhood out of the rectified page.
 *
 * NEVER THE FIELD ALONE. Four characters on their own are unrecognisable and
 * unverifiable — the student needs the row around them to know which class they
 * are looking at — so the crop is padded to at least `cropMinCtxPx` of page
 * width and the field itself is ringed inside it.
 */
export function cropInto(canvas, sheet, box, context) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!sheet || !sheet.canvas || !box) return false;
  const dpr = Math.min(CONF.ui.maxDpr,
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cssW = canvas.clientWidth || 316, cssH = canvas.clientHeight || CONF.ui.cropH;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));

  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  let x0 = box.x0 - bw * CONF.ui.cropPadX, x1 = box.x1 + bw * CONF.ui.cropPadX;
  let y0 = box.y0 - bh * CONF.ui.cropPadY, y1 = box.y1 + bh * CONF.ui.cropPadY;
  if (context) {
    x0 = Math.min(x0, context.x0 - bw * 0.2); x1 = Math.max(x1, context.x1 + bw * 0.2);
    y0 = Math.min(y0, context.y0); y1 = Math.max(y1, context.y1);
  }
  const wantW = Math.max(CONF.ui.cropMinCtxPx,
    sheet.w * CONF.ui.cropMinCtxFrac, x1 - x0);
  const cx = (x0 + x1) / 2;
  x0 = cx - wantW / 2; x1 = cx + wantW / 2;
  // Match the destination aspect so the crop is not squashed.
  const aspect = cssW / cssH;
  let h = x1 - x0 <= 0 ? 1 : (x1 - x0) / aspect;
  if (h < y1 - y0) { h = y1 - y0; const w = h * aspect; x0 = cx - w / 2; x1 = cx + w / 2; }
  const cy = (y0 + y1) / 2;
  y0 = cy - h / 2; y1 = cy + h / 2;

  const sx = Math.max(0, x0), sy = Math.max(0, y0);
  const sw = Math.min(sheet.w, x1) - sx, sh = Math.min(sheet.h, y1) - sy;
  if (!(sw > 0 && sh > 0)) return false;
  const scale = canvas.width / (x1 - x0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sheet.canvas, sx, sy, sw, sh,
    (sx - x0) * scale, (sy - y0) * scale, sw * scale, sh * scale);
  // The ring. Drawn last, in the app's own accent, so it reads as this app
  // pointing rather than as something that was on the picture.
  ctx.strokeStyle = 'rgba(255,198,99,.95)';
  ctx.lineWidth = Math.max(2, 2 * dpr);
  ctx.strokeRect((box.x0 - x0) * scale - 3, (box.y0 - y0) * scale - 3,
    bw * scale + 6, bh * scale + 6);
  return true;
}

/**
 * mount(host, rev, opts) -> { destroy, state }
 *
 * `opts.onDone(applied)`  the student pressed the final button
 * `opts.onCancel()`       they closed it; nothing is saved
 */
export function mount(host, rev, opts = {}) {
  const doc = host.ownerDocument || document;
  ensureStyle(doc);
  const root = el('div');
  root.id = 'wf-cfm';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Check what was read from your picture');
  host.appendChild(root);

  const state = { step: 0, typing: false, done: false };
  const steps = rev.questions.length + rev.recover.length;

  function currentItem() {
    if (state.step < rev.questions.length) {
      return { kind: 'q', q: rev.questions[state.step] };
    }
    const i = state.step - rev.questions.length;
    if (i < rev.recover.length) return { kind: 'r', r: rev.recover[i] };
    return { kind: 'summary' };
  }

  function groupOf(q) { return rev.groups.find(g => g.id === q.groupId); }

  function advance() {
    state.step++;
    state.typing = false;
    render();
  }

  function head(titleText, countText) {
    const h = el('div', 'cfm-head');
    h.appendChild(el('div', 'cfm-title', titleText));
    if (countText) h.appendChild(el('div', 'cfm-count', countText));
    const x = el('button', 'cfm-x', '×');
    x.setAttribute('aria-label', 'Close without saving');
    x.onclick = () => { destroy(); if (opts.onCancel) opts.onCancel(); };
    h.appendChild(x);
    return h;
  }

  function progress() {
    const b = el('div', 'cfm-bar');
    const f = el('div', 'cfm-bar-fill');
    f.style.width = (steps ? Math.round((state.step / steps) * 100) : 100) + '%';
    b.appendChild(f);
    return b;
  }

  function cropFor(box, context, tag) {
    if (!rev.sheet || !box) {
      return el('div', 'cfm-crop-none',
        'The picture is no longer in memory, so there is nothing to show beside this one.');
    }
    const holder = el('div');
    const wrap = el('div', 'cfm-crop');
    const cv = doc.createElement('canvas');
    cv.style.width = '100%';
    cv.style.height = CONF.ui.cropH + 'px';
    wrap.appendChild(cv);
    holder.appendChild(wrap);
    if (tag) holder.appendChild(el('div', 'cfm-crop-cap', tag));
    // The canvas has to be in the document before clientWidth is real.
    setTimeout(() => { try { cropInto(cv, rev.sheet, box, context); } catch (e) {} }, 0);
    return holder;
  }

  function optionButton(label, note, lead, onPick) {
    const b = el('button', 'cfm-opt' + (lead ? ' lead' : ''));
    b.appendChild(el('span', 'cfm-opt-v', label));
    if (note) b.appendChild(el('span', 'cfm-opt-n', note));
    b.onclick = onPick;
    return b;
  }

  function renderQuestion(q) {
    const g = groupOf(q);
    const cls = g.lead;
    root.appendChild(head('Check this one', (state.step + 1) + ' of ' + steps));
    root.appendChild(progress());
    const body = el('div', 'cfm-body');

    body.appendChild(cropFor(q.box, q.context, 'from your picture'));
    body.appendChild(el('div', 'cfm-who',
      cls.course || (cls.building + ' ' + cls.room)));
    body.appendChild(el('div', 'cfm-when',
      daysPhrase(g.days) + ' · ' + clockOf(minutesOf(cls.start)) + ' – ' +
      clockOf(minutesOf(cls.end)) + ' · ' + cls.building + ' ' + cls.room));
    body.appendChild(el('div', 'cfm-ask', q.ask));
    if (q.why) body.appendChild(el('div', 'cfm-why', q.why));

    if (q.kind === 'days') {
      // A MULTI-SELECT NEEDS A MULTI-SELECT CONTROL. Five chips, pre-filled
      // with what was read, and one button to accept them — because the honest
      // question about "MWF" is which days, and a list of single days where
      // picking Wednesday silently deletes Monday and Friday is a trap.
      const on = new Set(String(q.answer || q.current).split(',').filter(Boolean));
      const chips = el('div', 'cfm-chips');
      for (const o of q.options) {
        const b = el('button', 'cfm-chip' + (on.has(o.value) ? ' on' : ''), o.label);
        b.setAttribute('aria-pressed', on.has(o.value) ? 'true' : 'false');
        b.setAttribute('aria-label', o.value);
        b.onclick = () => {
          if (on.has(o.value)) on.delete(o.value); else on.add(o.value);
          q.answer = DAY_ORDER.filter(d => on.has(d)).join(',');
          render();
        };
        chips.appendChild(b);
      }
      body.appendChild(chips);
      const ok = el('button', 'cfm-go cfm-wide',
        on.size ? 'Yes — ' + daysPhrase(DAY_ORDER.filter(d => on.has(d))) : 'Pick at least one day');
      ok.disabled = !on.size;
      ok.onclick = () => {
        q.answer = DAY_ORDER.filter(d => on.has(d)).join(',');
        advance();
      };
      body.appendChild(ok);
      const alt0 = el('div', 'cfm-alt');
      const drop0 = el('button', null, 'Leave it out');
      drop0.onclick = () => { g.dropped = true; advance(); };
      alt0.appendChild(drop0);
      body.appendChild(alt0);
      root.appendChild(body);
      root.appendChild(foot(true));
      return;
    }

    if (state.typing) {
      const wrap = el('div', 'cfm-type');
      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'cfm-in';
      input.value = q.current || '';
      input.setAttribute('aria-label', q.ask);
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      const ok = el('button', null, 'Set');
      const take = () => {
        const v = String(input.value || '').trim().toUpperCase();
        if (!v) return;
        q.answer = q.field === 'day' ? v.slice(0, 1) + v.slice(1).toLowerCase() : v;
        advance();
      };
      ok.onclick = take;
      input.onkeydown = (e) => { if (e.key === 'Enter') take(); };
      wrap.appendChild(input); wrap.appendChild(ok);
      body.appendChild(wrap);
      setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);
    } else {
      const opts2 = el('div', 'cfm-opts');
      q.options.forEach((o, i) => {
        opts2.appendChild(optionButton(o.label, o.note, q.trusted && i === 0, () => {
          q.answer = o.value;
          advance();
        }));
      });
      body.appendChild(opts2);
      const alt = el('div', 'cfm-alt');
      const t = el('button', null, 'Type it');
      t.onclick = () => { state.typing = true; render(); };
      const drop = el('button', null, 'Leave it out');
      drop.onclick = () => { g.dropped = true; advance(); };
      alt.appendChild(t); alt.appendChild(drop);
      body.appendChild(alt);
    }
    root.appendChild(body);
    root.appendChild(foot(true));
  }

  function renderRecover(r) {
    root.appendChild(head('One it could not name', (state.step + 1) + ' of ' + steps));
    root.appendChild(progress());
    const body = el('div', 'cfm-body');
    body.appendChild(cropFor(r.box, r.box, 'from your picture'));
    body.appendChild(el('div', 'cfm-who', r.course || ('Room ' + r.room)));
    body.appendChild(el('div', 'cfm-when',
      r.day + ' · ' + clockOf(minutesOf(r.start)) + ' – ' + clockOf(minutesOf(r.end))));
    body.appendChild(el('div', 'cfm-ask',
      r.options.length > 1 ? 'Which building is this?' : 'Is this building right?'));
    body.appendChild(el('div', 'cfm-why', r.why));
    const opts2 = el('div', 'cfm-opts');
    for (const o of r.options) {
      opts2.appendChild(optionButton(o.label,
        opts.buildingName ? opts.buildingName(o.value) : null, false, () => {
          r.answer = o.value;
          advance();
        }));
    }
    body.appendChild(opts2);
    const alt = el('div', 'cfm-alt');
    const skip = el('button', null, 'Skip this one');
    skip.onclick = advance;
    alt.appendChild(skip);
    body.appendChild(alt);
    root.appendChild(body);
    root.appendChild(foot(true));
  }

  function renderSummary() {
    const res = apply(rev);
    root.appendChild(head('Your schedule', null));
    const body = el('div', 'cfm-body');
    const kept = res.classes.length;
    body.appendChild(el('div', 'cfm-note', kept
      ? kept + (kept === 1 ? ' class' : ' classes') + ' ready' +
        (res.dropped.length ? ', ' + res.dropped.length + ' left out' : '') + '.'
      : 'Nothing is ready to save yet.'));
    const list = el('div', 'cfm-sum');
    // Built from the READINGS, not from the flat list, so every row still knows
    // which reading it came from and can be taken back out with one tap. A
    // student who spots a wrong class here should not have to start again.
    const rows = [];
    for (const g of rev.groups) {
      for (const c of applyGroup(rev, g).classes) rows.push({ c, g });
    }
    rows.sort((a, b) =>
      (DAY_ORDER.indexOf(a.c.day) - DAY_ORDER.indexOf(b.c.day)) ||
      ((minutesOf(a.c.start) || 0) - (minutesOf(b.c.start) || 0)));
    for (const { c, g } of rows) {
      const row = el('div', 'cfm-row' + (c.needsConfirm ? ' flag' : ''));
      const m = el('div', 'cfm-row-m');
      m.appendChild(el('div', 'cfm-row-a',
        (c.course ? c.course + ' · ' : '') + c.building + ' ' + c.room));
      m.appendChild(el('div', 'cfm-row-b',
        c.day + ' · ' + clockOf(minutesOf(c.start)) + ' – ' +
        clockOf(minutesOf(c.end)) + (c.needsConfirm ? ' · not checked' : '')));
      row.appendChild(m);
      const x = el('button', 'cfm-row-x', 'Remove');
      x.setAttribute('aria-label', 'Leave out ' + (c.course || c.building + ' ' + c.room));
      x.onclick = () => { g.dropped = true; render(); };
      row.appendChild(x);
      list.appendChild(row);
    }
    body.appendChild(list);
    if (rev.counts.seenNotRead) {
      body.appendChild(el('div', 'cfm-note',
        rev.counts.seenNotRead + ' more ' +
        (rev.counts.seenNotRead === 1 ? 'class was' : 'classes were') +
        ' visible on the picture but could not be read. Try again with the camera ' +
        'square on to the screen, or send it as a screenshot.'));
    }
    root.appendChild(body);
    root.appendChild(el('div', 'cfm-priv',
      'Read on this phone. The picture was never uploaded and is deleted when you close this.'));
    const f = el('div', 'cfm-foot');
    if (steps) {
      const back = el('button', 'cfm-back', '‹ Back');
      back.onclick = () => { state.step = Math.max(0, state.step - 1); render(); };
      f.appendChild(back);
    }
    f.appendChild(el('div', 'cfm-spacer'));
    const go = el('button', 'cfm-go',
      kept ? 'Use ' + (kept === 1 ? 'this class' : 'these ' + kept + ' classes') : 'Close');
    go.onclick = () => { state.done = true; destroy(); if (opts.onDone) opts.onDone(res); };
    f.appendChild(go);
    root.appendChild(f);
  }

  function foot(withBack) {
    const f = el('div', 'cfm-foot');
    if (withBack && state.step > 0) {
      const back = el('button', 'cfm-back', '‹ Back');
      back.onclick = () => { state.step = Math.max(0, state.step - 1); state.typing = false; render(); };
      f.appendChild(back);
    }
    f.appendChild(el('div', 'cfm-spacer'));
    const skip = el('button', 'cfm-back', 'Skip the rest');
    skip.onclick = () => { state.step = steps; render(); };
    f.appendChild(skip);
    return f;
  }

  function markCuts() {
    const body = root.querySelector('.cfm-body');
    if (!body) return;
    const over = body.scrollHeight - body.clientHeight;
    body.classList.toggle('cut-top', body.scrollTop > 2);
    body.classList.toggle('cut-bot', over > 2 && body.scrollTop < over - 2);
  }

  function render() {
    while (root.firstChild) root.removeChild(root.firstChild);
    const it = currentItem();
    if (it.kind === 'q') renderQuestion(it.q);
    else if (it.kind === 'r') renderRecover(it.r);
    else renderSummary();
    const body = root.querySelector('.cfm-body');
    if (body) body.addEventListener('scroll', markCuts, { passive: true });
    // After layout, not during it: scrollHeight is a lie until the browser has
    // measured the rows.
    setTimeout(markCuts, 0);
  }

  function destroy() {
    // THE PICTURE GOES WITH THE SCREEN. A schedule photograph has no business
    // outliving the screen that was reading it, so the canvas is emptied rather
    // than merely dropped: an emptied backing store cannot be recovered by
    // anything that kept a reference to the object.
    try {
      if (rev.sheet && rev.sheet.canvas) {
        rev.sheet.canvas.width = 1; rev.sheet.canvas.height = 1;
        rev.sheet.canvas = null;
      }
    } catch (e) {}
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  render();
  return { root, state, destroy, render };
}

export default { CONF, review, score, apply, mount, cropInto, prepare, confirmFromFile };

if (typeof window !== 'undefined') {
  window.SCHEDCONFIRM = { CONF, review, score, apply, applyGroup, mount, cropInto,
    prepare, confirmFromFile, minutesOf, hhmmOf, clockOf, fromOcr, roomFloorSuspect };
}
