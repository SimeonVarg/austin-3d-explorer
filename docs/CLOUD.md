# Do we need a cloud GPU?

**Short answer: no. The laptop already has a good graphics card — we were telling
Chrome not to use it.** Turning that off made the test suite nearly twice as fast
for free, and a rented cloud GPU would not have fixed the part that is still slow.

Written 2026-08-01. Every number below is either measured on the Acer that day or
carries the source and date it was read from.

---

## 1. What was believed, and what is actually true

The question was: "~50-60% of every rendering pass is headless Chromium in
software rendering, which pins my laptops. Rent a cloud GPU."

Three things in that turned out to be wrong.

**The laptop has a graphics card.** Windows reports an **NVIDIA GeForce RTX 3050
Ti Laptop GPU, 4 GB**, plus AMD integrated graphics. There was never a hardware
problem.

**We were switching it off on purpose.** `scripts/verify/chrome.mjs` passed
`--use-angle=swiftshader --enable-unsafe-swiftshader` to every browser it
launched. SwiftShader is a software renderer — it draws using the CPU instead of
the graphics card. The comment above those flags said, accurately, that they
"make WebGL work **without** a GPU". That was written for a machine that needed
it, and then it became the default for everything.

**It is not 50-60% of a pass. It is nearly all of it.** Measured with
`scripts/verify/where-time-goes.mjs`: 91% of a run is rendering rather than
startup.

## 2. What removing three flags did

Same scene, same camera, same machine, 2026-08-01:

| | frames per second | renderer |
|---|---|---|
| with the SwiftShader flags | **3.7** | SwiftShader (CPU) |
| without them | **34.6** | AMD Radeon, D3D11 |
| without them + `--force_high_performance_gpu` | **35.3** | NVIDIA RTX 3050 Ti, D3D11 |

**9.4× faster rendering, for deleting three flags.**

Worth noting: the discrete NVIDIA card is barely faster than the integrated one
(35.3 vs 34.6). The win is hardware-versus-software, not which chip. Without that
last flag a laptop hands headless Chrome the integrated graphics.

### The honest end-to-end number

Frames per second is not what you care about — you care how long a pass takes.
The real script, `shot.mjs`, three camera poses:

| | wall clock |
|---|---|
| SwiftShader | **189 s** |
| hardware GL | **98 s** |

**1.9× faster.** Real, free, and already committed.

### Why 9× faster rendering only makes the pass 2× faster

Because rendering was never the whole cost. Timed from inside the browser, one
camera pose is:

```
jumpTo() itself              5-14 ms
main thread free after        1-4 ms
map settles (tiles) after  0.6-3.9 s
```

Under four seconds of real work. The rest is fixed overhead — starting Chrome,
loading the page, fetching and parsing the GeoJSON, tiling it in a worker, and
the deliberate fixed waits the scripts use to let things settle. **None of that
is graphics work, so no graphics card of any price shortens it.**

> A wrong measurement nearly sent us shopping. The first version of
> `where-time-goes.mjs` reported "60 s per camera move" and I believed it. It was
> the test harness measuring its own overhead and blaming whatever command came
> next. Timing the same work from inside the browser gave under 4 s. That is the
> difference between a $10,000 decision and a free one.

## 3. What was already changed

`scripts/verify/chrome.mjs` now has two rendering modes:

- **`swiftshader` — still the default.** Roughly a hundred scripts assert *exact
  pixel colours* at named points. Software and hardware renderers genuinely
  disagree about edges and blending. Measured: switching backends changes
  **26-42% of pixels** in a frame, worst channel difference **192 out of 255**.
  Switching those scripts to the GPU would silently break the entire suite.
- **`hardware` — opt in, for anything timing- or screenshot-shaped**, where exact
  pixels do not matter and wall clock does.

```bash
VERIFY_GL=hardware node scripts/verify/shot.mjs myshots shots-labels.json
```

It also fixed a real bug: `launch()` did `opts.args || GL_ARGS`, so any script
that asked for a **visible window** but did not also hand over its own flags got
the SwiftShader set anyway. **17 of the 21 `*-perf` timing scripts were in that
state**, including `perf.mjs`, whose own header opens *"1. RUN ON A REAL GPU"* and
then does exactly that. Every frame-time comparison those scripts ever printed
was measuring a CPU renderer. A headed run now defaults to hardware, because
there is no other honest reading of asking for a window to measure frames in.

## 4. So what would money actually buy?

Very little, and that is the point.

- A cloud **NVIDIA T4** (`g4dn.xlarge`) is a 2018 inference card. For drawing a
  map it is not clearly better than the RTX 3050 Ti already in the laptop.
- The remaining time is loading and waiting, which no GPU touches.
- The one genuine benefit — *getting the work off your machine so it stops
  freezing* — is available **free**.

### Free option, if the laptop being pinned is the real problem

**GitHub Actions.** This repo is public, so GitHub-hosted runners are free with
unlimited minutes (4 vCPU / 16 GB, docs.github.com, read 2026-08-01). You already
have `build-data.yml` with the comment *"Phone-friendly: trigger this from Kiro /
the GitHub mobile UI"* — the same button, a new workflow, and the suite runs on
somebody else's computer while yours stays free.

The runners have no graphics card, so each individual script would be back to
SwiftShader speed. What you gain is **parallelism** — many scripts at once — and
the thing you actually asked for: **a job cannot be left running.** It starts,
finishes, and dies. There is nothing to forget and nothing to bill.

**That parallelism is also the answer to "why did that response take 30 minutes?",
and the first draft of this document under-sold it.** A verification pass is
roughly ten browser runs at 1.5–3.5 minutes each, and they are run **one at a
time on purpose** — eight headless Chromes at once is precisely what left 38
orphaned processes on this laptop and pinned it at 100% CPU and memory. So the
serialisation is not caution, it is a hard constraint of running on the machine
the user is sitting at.

Move the runs somewhere with no user sitting at it and the constraint goes away:
wall clock becomes the slowest single script instead of the sum. A GPU makes *one*
pass ~1.9× faster and that finding stands — but concurrency is the bigger lever
for a session's turnaround, and unlike the GPU it is free.

### If you ever do want a cloud box anyway

Prices read 2026-08-01. AWS figures come from four aggregators (vantage.sh,
cloudprice.net, economize.cloud, doit.com) which agreed to the cent; AWS's own
pricing page could not be read programmatically, so **confirm in the console
before spending**. The Azure figure came from Azure's own price API.

| option | per hour | note |
|---|---|---|
| AWS `g4dn.xlarge` on demand | **$0.526** | 1× T4. The default choice. |
| AWS `g4dn.xlarge` spot | $0.21-0.34 | Can be taken away mid-run. Fine for screenshots, wrong for timing. |
| Azure `NV6ads_A10_v5` | **$0.45** ($0.08 spot) | Cheapest real GPU in either cloud — Azure sells fractional GPUs, AWS does not. |
| A big CPU box instead | $0.71-1.43 | *More* than the GPU box, and more cores do not fix a software renderer. Ruled out. |

**The number that should calm you down:** if you started one `g4dn.xlarge` and
forgot about it for a **whole month**, the bill is **$378**. That is 3.8% of one
credit pool. You would have to make that exact mistake, uninterrupted, for about
26 months to exhaust $10,000. You cannot burn this money with this workload.

**Do this before touching an instance, not after:** in the EC2 console, on the
instance, *Manage CloudWatch alarms → Stop*, metric CPUUtilization, average,
period 900 s, 4 periods, threshold ≤5%. That shuts the box down after an hour of
genuine idleness. On Azure it is one toggle: *VM → Operations → Auto-shutdown*.

Two hard rules if it ever happens:

- **Never register a self-hosted GitHub runner on this repo.** It is public, so a
  stranger's pull request could run code on your machine. GitHub's own docs
  advise against it.
- **Never remove the watchdog or the reaper in `chrome.mjs`.** They exist because
  38 orphaned Chrome processes once took a laptop to 100% CPU and memory.

## 5. Can any of this make the site faster for a *visitor*?

Separate question from everything above, and the answer is **no — but not
because the tools are bad.**

**The site has no server.** A visitor opens the link, their browser downloads the
data, and *their own device* draws the city. There is nothing running anywhere
for a cloud service to speed up. Credits cannot render frames for somebody else's
phone.

The one architecture where they could is **pixel streaming** — render on a server
farm and send video, the way cloud gaming works. Technically possible with the
GPU credits. It is the wrong shape for this: you would pay per simultaneous
viewer, forever, for a link that is about to be pointed at a large audience, and
the thing loses its "it runs in your browser" story, which is most of why it is
interesting.

**So the visitor's experience is governed by one number: how many bytes they have
to download before anything appears.** Measured 2026-08-01: **26.4 MB across 26
files**, 3.8 MB gzipped. Largest single file `trees.geojson` at 9.13 MB.

That is also the honest answer to *"what if I want to add more detail?"* Right
now more detail means a slower site for everyone, because every file is the whole
city whether the camera can see it or not. **Vector tiles remove that trade** —
cut the data into tiles up front, and the browser fetches only what is under the
camera. Detail stops costing load time.

`scripts/tile.sh` already builds one (`austin.pmtiles`, 0.61 MB) on every data
run, and **no code in the repo references it.** That is QUEUE item 1, and it is
the highest-value thing on the list. It is engineering, not a purchase — no
credit on the YC page helps.

## 6. The YC catalogue, properly this time

First pass saw 16 of the 27 deals; the rest were behind a sign-in wall. Corrected:

Most of the catalogue is irrelevant to a static site with pre-baked map data — no
database, no runtime AI calls, no phone calls. What survives:

- **Firecrawl** — a one-off scrape of UT's official building directory as a name
  source. `scripts/name_buildings.py` already exhausted every offline source in
  the repo and recovered only 32 names for 2,069 unnamed buildings. OpenStreetMap
  is mined dry; a different source is the only way forward. The free tier covers
  it. The real work is matching directory entries to footprints, which no tool
  does for you.
- **Greptile** — a year free. **This reverses the first pass, which ruled it out
  as "built for a team's pull-request volume".** That missed the actual setup:
  two AI lanes both edit `js/app.js`, and Simeon merges pull requests he cannot
  fully read. An independent reviewer on every PR is a real second pair of eyes.
  QUEUE item 7.
- **Deepgram — $15,000, not the $200 stated in the first pass.** Off by 75×. Still
  only captions for the reel here, but worth knowing the size of it.
- **Blaxel** — "sandboxes for AI agents". The paid analogue of QUEUE item 6:
  somewhere other than the laptop to run browser passes concurrently. GitHub
  Actions does the same job free on a public repo, so this is a fallback, not a
  plan.

**Explicitly not: Tavus and sync.** Both generate or lip-sync a person's face and
voice. The Kiro reel is a testimonial in your own voice with you on camera. Using
either to generate, dub, or re-sync any part of it would put words in your mouth
that you did not say. Off the table regardless of how good they are.

Ruled out with reasons: Roboflow (the roof and canopy detection already works and
is calibrated; a new model means labelling a training set from scratch for an
unproven gain), Cursor (an AI editor — this workflow already has one), Browser Use
and Gumloop (less precise than the existing Python fetchers, which handle
Overpass's specific rate-limit behaviour), Google's $2k Gemini + Cloud, Microsoft
Azure for Startups, OpenAI and Anthropic credits (a third, fourth and fifth pool
for a workload that needs none of the first two), and Supabase, Langfuse,
AgentMail, Fireworks AI, Sarvam AI, Razorpay, écentic, Vapi, Bolna and Coinbase —
nothing here needs them.

## 7. What I could not verify

- **Real frame rates for this scene on a cloud T4 or A10.** Nobody has ever run
  this harness on cloud GPU hardware. Any claim about it is an expectation.
- **GPU quota.** Both clouds default new accounts to zero GPU capacity and
  require a request that can take days and is occasionally refused. Nobody has
  checked these specific accounts. If Phase 2 ever looks likely, file that
  request early — it is the one step that can blow a deadline for a reason that
  has nothing to do with engineering.
- **Whether headless GPU Chrome on Linux needs an X server.** Sources conflict.
  Plan to run under `xvfb-run -a` regardless; it costs nothing.
- **Whether the 15 scripts currently crashing with "page is not defined"** would
  pass in CI. That regression is the Mac lane's to fix, and wiring broken scripts
  into an automated run just teaches you to ignore red builds.

## 8. The recommendation, in order

1. **Done already** — hardware GL is available and the timing scripts no longer
   lie. Nearly 2× on any screenshot pass, $0.
2. **The one that changes what the project can become** — vector tiles, so more
   detail stops meaning a slower site. `scripts/tile.sh` already builds the
   archive and nothing loads it. QUEUE item 1. Also $0.
3. **Worth doing next** — a GitHub Actions workflow so a full pass runs off your
   machine, triggered from your phone. Free, it cannot be left on, and the
   concurrency is what shortens a session.
4. **Probably never** — a cloud GPU. If it ever comes up, spend **one hour and
   about 53 cents** proving it renders this scene faster than the laptop *before*
   building anything on top of it.
