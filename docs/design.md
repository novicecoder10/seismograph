# Seismograph — Design

**Date:** 2026-09-23
**Status:** Approved design. Phase 0 complete; Phase 1 pending implementation.
**Supersedes:** `2026-09-23-phase-1-foundation-design.md` (removed; recoverable in git)
**Evidence base:** `2026-09-23-research-findings.md`

---

## 1. What this is

A web application for monitoring, analysing and understanding earthquakes, built from the
existing `quake-tracker` Vite SPA.

### Positioning

Research established that the 3D globe is commodity — at least six free products render
one, two of them well. The empty space is **analysis and inference**: sequences,
forecasts, waveforms, completeness, and honest self-evaluation.

> **The globe is table stakes. The sequence is the product. Honesty is the moat.**

### Guiding principle

**Math predicts. The LLM explains.**

Deterministic earthquake prediction is not scientifically possible and no part of this
application will claim otherwise. Forward-looking statements come only from established
statistical models. The LLM narrates numbers the system computed; it never originates a
forecast. The "Refuse to build" list in §3 of the research findings is binding.

### The three things that make it different

1. **Global aftershock forecasting.** USGS forecasts only US events. The method is public
   and closed-form. Nobody serves the rest of the world.
2. **Public self-scoring.** Forecasts issued with immutable timestamps, scored against
   CSEP-style tests, with the misses shown. No consumer earthquake app does this.
3. **Waveforms and sonification.** ~30,000 open citizen seismometers, and no consumer app
   lets you see or hear the actual ground motion.

---

## 2. Constraints

1. **Zero monetary cost.** Permanent free tiers requiring no payment method.
2. **Hobby and research use only.** No advertising, no subscriptions — keeps Vercel Hobby
   compliant.
3. **No server GPU.** Rendering happens on the visitor's hardware.
4. **Scientific honesty.** No feature may imply deterministic prediction, and no forecast
   may be surfaced through alert-style UX.

### Free-tier budget

| Service | Allowance | Use |
|---|---|---|
| Vercel Hobby | 100 GB bandwidth | Hosting, API routes, proxy endpoints |
| Supabase | 500 MB DB, 5 GB egress, 500k Edge Function calls/mo | Catalogue, forecasts, scoring |
| Data sources | Free, mostly keyless | See research findings §4 |

**Vercel Hobby cron runs once per day maximum** — more frequent expressions fail at deploy
time. Scheduling therefore lives in Supabase `pg_cron`, which supports per-minute
granularity on the free tier and additionally prevents the seven-day inactivity pause.

---

## 3. Architecture

```
  EMSC WebSocket ─────────────────────────────┐
  (true push, CC BY 4.0)                      │
                                              ▼
  USGS feeds ──▶ Supabase Edge Function ──▶ Postgres ──▶ Supabase Realtime ──▶ Browser
  (pg_cron 1/15/60 min)   normalize          + PostGIS                            │
                          dedupe                                                  │
                                                                                  │
  Raspberry Shake / EarthScope miniSEED ──────────────────────────────────────────┤
  ShakeMap, DYFI, PAGER, moment tensors (CORS-open, direct)  ─────────────────────┤
  Precomputed travel-time table, Slab2 meshes, plate boundaries (static) ─────────┘

  ISC, GCMT, NGL GNSS ──▶ Next.js route handler (proxy + cache) ──▶ Browser
```

Because the seismology ecosystem is almost entirely CORS-open, most data reaches the
browser directly. The server exists for four things: scheduled ingestion, a proxy for the
four sources lacking CORS, the forecast engine, and — critically — **immutable storage of
issued forecasts**, which is the integrity mechanism behind self-scoring and cannot be a
cache.

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript strict | |
| 3D | **three.js + react-three-fiber** | Slab2 meshes, beachball shaders and wavefront shaders all need custom shader control that deck.gl's experimental `_GlobeView` resists |
| 2D map | MapLibre GL | Projection toggle |
| Waveforms | `seisplotjs` | TypeScript-native, parses miniSEED 2 and 3 with STEIM decompression. **Browser-only at 3.2.7** — it evaluates `extends HTMLElement` at import time, so server-side parsing needs a DOM shim or another library (`spikes/FINDINGS.md` §3) |
| Audio | Web Audio API | |
| State | Zustand | Shared `t` and selection across globe, charts and audio |
| Data | Supabase Postgres + PostGIS | |
| Styling | Tailwind v4, preserving existing identity | Dark palette, IBM Plex Mono / Space Grotesk, grid motif from `src/App.css` |

### Time as the primary axis

The entire application is a function of a single time value `t`, not a filter applied to a
list. This makes catalogue replay, wavefront animation and audio playback one system
rather than three separate features, and it is structurally painful to retrofit. **Decided
on day one.**

One speed multiplier drives camera, animation and audio pitch together.

---

## 4. Data model

```sql
create table events (
  id            text primary key,          -- "usgs:us7000abcd"
  source        text not null,
  source_id     text not null,
  time          timestamptz not null,
  geom          geography(Point, 4326) not null,
  lat, lon      real not null,             -- denormalised for binary packing
  depth_km      real,
  magnitude     real not null,
  mag_type      text,
  place         text,
  status        text,                      -- automatic | reviewed
  felt, cdi, mmi, alert, tsunami, sig,     -- impact fields
  sequence_id   uuid references sequences(id),
  duplicate_of  text references events(id),
  raw           jsonb,                     -- retained 90 days
  ingested_at, updated_at timestamptz
);

create table event_revisions (           -- "watch the solution converge"
  id bigserial primary key,
  event_id text references events(id),
  observed_at timestamptz not null,
  source text not null,
  magnitude real, depth_km real, lat real, lon real,
  status text
);

create table sequences (
  id uuid primary key,
  mainshock_id text references events(id),
  kind text,                              -- mainshock-aftershock | swarm | isolated
  method text,                            -- gardner-knopoff | zaliapin-nn
  region_center geography(Point, 4326),
  region_radius_km real,
  started_at, last_event_at timestamptz,
  event_count integer,
  omori_k, omori_c, omori_p real,
  b_value, b_sigma, mc real
);

create table forecasts (                  -- IMMUTABLE. Never updated, never regenerated.
  id uuid primary key,
  sequence_id uuid references sequences(id),
  issued_at timestamptz not null,
  window_start, window_end timestamptz not null,
  model text not null,                    -- reasenberg-jones | etas | poisson-baseline
  params jsonb not null,
  predictions jsonb not null,             -- per magnitude bin: expected, p95 range, P(>=1)
  content_hash text not null              -- SHA-256 over params+predictions
);

create table forecast_scores (
  id uuid primary key,
  forecast_id uuid references forecasts(id),
  scored_at timestamptz not null,
  observed_count integer,
  n_test_delta1, n_test_delta2 real,
  log_loss real,
  information_gain_vs_baseline real
);

create table ingest_runs (
  id bigserial primary key,
  started_at, finished_at timestamptz,
  source, feed text,
  fetched, inserted, updated, rejected, duplicates integer,
  error text
);
```

`forecasts` is append-only and enforced so at the database level. A forecast that can be
regenerated at evaluation time is not evidence of anything.

`event_revisions` captures each agency's successive solutions, enabling a view nobody
currently offers: watching magnitude and depth converge over the first hour.

### Deduplication

USGS is canonical. An EMSC event is a duplicate if a USGS event exists within **100 km, 90
seconds and 0.5 magnitude units**. Duplicates are stored with `duplicate_of` set rather
than discarded, preserving the ability to compare agency solutions. Default queries filter
on `duplicate_of is null`.

### Catalogue scope

**M4.5+, all history** — approximately 250,000–300,000 rows, ~70 MB with indexes.

Measured rates (USGS FDSN, 2026-09-23): M4.5+ ~7,400/yr, M2.5+ ~29,500/yr, M1.0+
~104,000/yr.

Sequence analysis additionally pulls the full local catalogue at all magnitudes within a
sequence's space-time window on demand, since aftershock fitting needs completeness below
M4.5. Those events are stored, so the catalogue grows where analysis has happened rather
than uniformly.

**This growth must be bounded or it breaks the storage budget.** A single large sequence
can contain 100k+ events at M1+ — Ridgecrest alone would exceed the M4.5+ global
catalogue. Controls:

- Sequence pulls are capped by radius and duration from the mainshock (Wells & Coppersmith
  rupture-length scaling, not a fixed box) and by a per-sequence row limit.
- Sub-M4.5 sequence events carry `raw = null` and are excluded from the global catalogue
  view.
- A retention job demotes sub-M4.5 events from sequences inactive for 12 months, keeping
  the fitted parameters in `sequences` and discarding the raw events, which are always
  refetchable from FDSN.
- `ingest_runs` tracks total row count so the budget is observable rather than discovered
  at the 500 MB wall.

**Caps, set in Phase 2** (`lib/science/sequence.ts`, `sequenceQueryWindow`):

- Radius: the larger of the Gardner-Knopoff distance window and 1.5 × the Wells &
  Coppersmith surface rupture length, never more than 300 km.
- Duration: 30 days before the mainshock (foreshocks) to the Gardner-Knopoff time window
  after it, never more than 365 days and never past now.
- Magnitude floor: M − 4, never below M1.5.
- Row limit: 20,000 events per sequence, and the page says when it was reached, because a
  truncated catalogue biases every statistic on it.

Measured: Ridgecrest M7.1 under these caps is 1,014 events (73 km, M3.1+, 13 months);
fetch and full analysis, including the O(n²) nearest-neighbour declustering, take about
6 s cold and are cached for ten minutes per sequence.

### Scaling path

M1.0+ globally is ~3M rows, ~1.5 GB in Postgres — over the free tier — but only ~150 MB as
Parquet. Resolution is a storage-engine change, not a paid plan: Postgres keeps a 90-day
hot window; the historical catalogue moves to year-partitioned Parquet on **Hugging Face
Datasets** (free, no payment method, HTTP range requests, native DuckDB `hf://` support),
queried server-side or in-browser via DuckDB-WASM.

**Requirement from day one:** all reads go through `lib/repositories/events.ts` so the
historical backend swaps without touching components.

---

## 5. Phases

Each phase is independently shippable. Phases 1–4 are the defensible core; 5–8 are each
valuable and individually optional.

### Phase 0 — Spike week — **complete, 2026-09-23**

Three unknowns resolved before production code. Throwaway code under `spikes/`; the answers
are in `spikes/FINDINGS.md` and are folded into §11 below. All three came back viable, with
one hazard the design had not anticipated (GPU picking against a live render loop) and one
confirmation that mattered (no public TauP service exists, so offline precomputation is the
only option rather than merely the better one).

1. **Travel-time table.** ObsPy `taup` offline over epicentral distance × source depth for
   P, S, PP, PKP, ScS and surface waves; export as Float32 binary; verify interpolation
   accuracy in TypeScript. Necessary because `irisws/traveltime` was retired in August
   2026 and no JS TauP port exists.
2. **Globe render path.** three.js + react-three-fiber rendering 100k hypocenters at true
   depth inside a translucent Earth, with GPU picking. Measure frame rate and interaction.
3. **Waveform round-trip.** Fetch Raspberry Shake miniSEED, parse with `seisplotjs`,
   render, and play through Web Audio at ~2000× to confirm sonification works end to end.

### Phase 1 — Foundation and globe — **complete, 2026-09-24, except Phase 1b**

Phase 1b (Supabase schema, `pg_cron` ingestion, EMSC WebSocket, Realtime) waits on account
credentials; everything else ships against USGS directly behind the repository boundary.

Next.js + TypeScript migration, Supabase schema, ingestion via `pg_cron` at three cadences
(1 min `all_hour`, 15 min `all_day` for magnitude revisions, daily `all_week` for reviewed
corrections), EMSC WebSocket in the browser, Supabase Realtime for confirmed rows.

Globe with true-depth rendering, 2D/3D toggle, plate boundaries (226 KB drop-in), day/night
terminator, arrival ripples. Hover tooltips, filters, time ranges, table view, URL state.

Event pages built on the **full USGS product tree** — `rupture.json` finite-fault geometry,
`cont_mmi.json` intensity contours, `dyfi_geo_1km.geojson` felt bins, PAGER exposure — not
a pin and a JPEG.

**Basic sonification ships here**, because it is roughly a day's work and is the most
shareable artifact in the project.

*Ships as: a live earthquake globe that already does something no competitor does.*

### Phase 2 — Sequences as first-class objects

Clustering by Gardner-Knopoff **and** Zaliapin-Ben-Zion nearest-neighbour, displayed side
by side so their disagreement is visible rather than hidden.

Sequence pages with permanent URLs. Omori-Utsu fitting with the Ogata transformed-time
residual plot, which reveals secondary bursts and abnormal behaviour at a glance. Sequence
classification. Magnitude-of-completeness dashboard showing `Mc(t)` and `Mc(x,y)`, which
inoculates users against "earthquakes are increasing" (detection is). b-values by Aki-Utsu
with Shi-Bolt uncertainty and van der Elst's b-positive estimator for sequences with
time-varying completeness.

Every b-value renders with its confidence interval. Always.

*Ships as: the only quantitative seismicity analysis tool on the web.*

**Complete, 2026-09-24.** Every statistic above is a pure function in `lib/science/` with
its own tests, including a 120-seed calibration check that Omori-Utsu's reported σ covers
the truth at the stated rate (115/120). Against the literature, the Ridgecrest page gives
Aki-Utsu b = 1.05 ± 0.07 and Omori p = 1.16 ± 0.03, inside the published ranges. Two
findings: ComCat's two-decimal network magnitudes must be binned at 0.1 before MAXC, or the
histogram is mostly empty bins; and b-positive reads higher than Aki-Utsu on Ridgecrest
(1.31 ± 0.08), which the page shows side by side rather than resolving.

### Phase 3 — Global aftershock forecasting

Reasenberg-Jones with Bayesian updating of the productivity parameter, time-varying
completeness handled per Page et al. (2016), generic priors read from USGS `forecast.json`
products for the matching tectonic regime.

**Validation harness first:** reproduce USGS's published forecasts on US events where an
`oaf` product exists, as an automated regression test. Only then extend globally.

Expected counts and P(≥1) for M≥3/4/5/6 over 1 day, 1 week, 1 month, with fractile bands.
Plus the honest answer to "is this a foreshock" — the probability of a larger event, shown
as the small number it is, with the base rate beside it.

Presented on pages the user chooses to open. **Never as a notification.**

*Ships as: aftershock forecasts for the ~90% of the world USGS doesn't cover.*

**Complete, 2026-09-25.** Five published USGS forecasts (one sequence-specific over a
95,445-point grid, four Bayesian) are rebuilt from USGS's own `forecast_data.json` in the
unit suite: posterior means and deviations to 10⁻³, every probability within 0.2%, every
fractile vector exact (§10.6). The same reproduction runs live on every USGS forecast shown;
Ridgecrest agrees within 0.04%. Elsewhere, forecasts use the Garcia regime table and Page et
al. generic parameters that USGS itself uses (both CC0 from OpenSHA; the regime lookup
agrees with USGS's assignment for every one of 22 surveyed events), for mainshocks of M5.0
and above in their first year (§10.7). Findings: USGS now forecasts some large non-US
events itself, sometimes with ETAS, whose inputs it does not publish; those are shown as
USGS's, unrecomputed, and say so. Deep events get an explicit note, since generic
parameters come mostly from shallow sequences. Computed forecasts are not yet stored,
which Phase 4's scoring requires.

### Phase 4 — Public self-scoring

Every forecast hashed and timestamped at issue. Scored after its window with N-test,
log-loss and information gain against a smoothed-seismicity Poisson baseline. A public
scoreboard showing calibration over time, including the failures.

If the model cannot beat smoothed seismicity, the scoreboard says so prominently.

*Ships as: the credibility no competitor has.*

**Built, 2026-09-25; scores accumulate from 2026-09-26.** The ledger is two append-only,
SHA-256-chained JSON Lines files in the repository (`ledger/`), not a database: Phase 1b's
Supabase needs the owner's credentials, and a hash chain in public git history is easier to
audit than a database row. Each forecast stores its posterior support and its baseline (the
20-year Poisson rate of M4.6+ in the same circle, ending 30 days before the mainshock) at
issue. Windows open at the next whole hour, so nothing is scored in hindsight. Only M5+ and
the mainshock's magnitude are scored, since the global catalogue misses smaller events.
Aftershocks of an already-forecast mainshock are not forecast again. The verdict is withheld
below 30 scored forecasts. The first 11 real forecasts were issued on 2026-09-25.
`.github/workflows/ledger.yml` runs issuance hourly and scoring daily at no cost once the
repository is pushed to GitHub; until then, `npm run ledger:issue` and `npm run ledger:score`
do the same by hand. Finding: USGS's FDSN service intermittently takes 5–10 s to connect,
so the unattended runner retries with backoff.

### Phase 5 — Waveforms and wavefronts

Raspberry Shake and EarthScope miniSEED via `seisplotjs`. Click an event, see the
three-component record at the nearest stations with P/S arrivals marked from the
precomputed table. Linked brushing between waveform and globe.

Full sonification with speed control, filter sweep, station selection and azimuth panning,
plus the SeisSound-style VCO channel for long-period energy.

Physics-accurate wavefront propagation: travel-time table as a GPU `DataTexture`, fragment
shader emitting a glow where `|t_now − t_phase(Δ)| < width`. Shadow zones and antipodal
refocusing emerge automatically. **`width` must correspond to at least 0.75° of epicentral
distance**, because the table's null boundary is grid-quantised by up to three cells — a
narrower front shows a visible gap at each phase cutoff (`spikes/FINDINGS.md` §1). Stations flash with real recorded motion as each phase
arrives.

*Ships as: press play and watch and hear an earthquake cross the planet.*

**Complete, 2026-09-25.** `/waves/[id]` runs one clock, in seconds since origin, that drives
three views. The globe draws iasp91 fronts for P, S, PP, PKP and ScS from a float texture of
the Phase 0 table at the event depth, with the glow at least 0.75° wide through the local
slowness. The record section draws real recordings from one Global Seismographic Network
station per 10° band (EarthScope, three components rotated to north/east) plus the nearest
Raspberry Shakes, with the predicted curves over them. Sound pans by azimuth, has a filter
sweep and a long-period VCO tone, and when it plays, the audio is the clock. Hovering the
record section scrubs the globe. On Ridgecrest, 14 of 19 stations return data, and the
recorded P and S line up with the predictions. Findings: `service.iris.edu` now
301-redirects to `service.earthscope.org`, and both services are CORS-open. A NaN from a
Raspberry Shake data gap, passed through to `gl_PointSize`, drew one station as a 25° disc,
so brightness is sanitised at three layers. Traces are shown as recorded, without the
instrument response removed, and are labelled that way.

### Phase 6 — Structure

Slab2 subduction surfaces, decimated offline to glTF, rendered translucent with Wadati-
Benioff hypocenters inside them. 3D focal-mechanism beachballs as shader-shaded spheres
from GCMT and USGS moment tensors. Depth cross-sections.

*Ships as: subduction stops being an abstraction.*

**Complete, 2026-09-25.** All 27 Slab2 surfaces, decimated to 0.2° (362 KB), render at true
depth, shaded in 100 km bands, so Wadati-Benioff hypocenters sit visibly inside their slabs.
Global CMT mechanisms (quick and monthly NDK files, parsed and cached by `/api/mechanisms`,
since GCMT sends no CORS headers) render as shader-shaded focal spheres: each fragment's
normal is rotated into the event's local up/south/east frame and coloured by the sign of
nᵀMn, so they turn with the globe as real focal spheres would. The event page draws a
server-side SVG beachball from the USGS moment tensor. `/section/[id]` cuts 50 years of
M4.5+ seismicity down the dip of the nearest slab. Under the 2026 M6.9 Pematangsiantar
earthquake it shows the Sumatra slab traced from the trench to 200 km, with the event 20 km
below the slab top. Findings: ScienceBase, where Slab2 is published, sits behind an
interactive Cloudflare challenge, so the unmodified grids came from a research mirror and
were checked for plausibility (`public/data/SOURCES.md`). The chart frame had hard-coded its
height, which put the record section's time axis halfway up the chart; it is now a prop.

### Phase 7 — LLM analyst

The comparative sequence explainer (§6).

**Built, 2026-09-25; model rewriting is waiting on the owner's key.** `/compare/[id]` ranks 32
well-studied sequences (1992–2025, in `data/sequences/library.json`, built from ComCat) by
similarity at the same elapsed time. The features are a Reasenberg-Jones productivity index
that cancels out mainshock size and elapsed time, the Båth gap so far, and foreshock activity.
The page states, for each past sequence, what followed to one year, plus how many past
sequences had an earthquake at least as large as the mainshock after the same point. It is
retrospective by construction. Numbers sit in tables beside the prose. The deterministic
template passes its own verifier. The generator (the Anthropic Messages API over `fetch`,
key in `ANTHROPIC_API_KEY`, `.env.local`) rewrites only the template. Every output goes through
the numeral, number-word, name, direction and forbidden-construction checks, is retried once,
and falls back to the template. Results are cached per bundle hash, under a spend guard of
calls per hour. Prediction and safety questions are routed in code before any catalogue or
model work: 22 adversarial questions in the unit suite, plus e2e. Mutation checks confirm the
verifier's tests fail when a check is removed. Comparisons are withheld below M6.0 and after
a year, with reasons. Not yet done: faithfulness benchmarking against live model output
(RAGTruth taxonomy), which needs the key.

### Phase 8 — Export, API, accounts

CSV/TSV, JSON/GeoJSON, QuakeML, KML/KMZ, XLSX, Parquet, chart PNG/SVG, ObsPy snippet
generation, public REST API. Watchlists with non-alarm framing.

**Built, 2026-09-25; accounts are waiting on Phase 1b's credentials.**
- **Exports.** The globe's status bar has an export menu. It builds the loaded catalogue in the
  browser as CSV, TSV, JSON, GeoJSON, QuakeML 1.2, KML, KMZ, XLSX or Parquet, with no server
  round trip. The format code is loaded only on first use. The menu also shows the same query
  as a runnable ObsPy snippet. Every columnar format carries the same eleven columns and the
  attribution.
  - KMZ and XLSX are built by a store-only ZIP writer in `lib/export/zip.ts`.
  - Parquet uses the MIT `hyparquet-writer` and is round-trip tested with `hyparquet`.
  - QuakeML IDs are validated against the BED resource-identifier pattern.
- **Chart downloads.** Every chart, including the record section, offers SVG and 2× PNG of
  itself. The export includes the dark surface and the font name, and strips the crosshair.
- **Public API.** `/api/v1` is CORS-open, needs no key, and is cached. It offers:
  - `events`, with FDSN parameter names, a floor of M4.5, pagination, and json, geojson, csv,
    tsv, quakeml or kml output.
  - `events/{id}`.
  - `sequence/{id}`: the analysis headline, with refusals kept.
  - `forecast/{id}`: USGS with the reproduction error, or the reproduction alone, or a refusal.
    The posterior summary is included but not the grid.
  - `mechanisms` and `scoreboard`.

  Bad queries return 400 with a sentence explaining why. The human-readable documentation is
  at `/api`.
- **Watchlists.** `/watchlist` keeps up to 20 places (centre, radius, minimum magnitude) in
  localStorage only. There are no accounts and no notifications. For each place, the page
  shows what was recorded since it was last marked read, or the past week on a first visit.
  It sets that count against the Poisson 95% range expected from the preceding year, then
  says one of: fewer, within the usual range, or more (with a line explaining that busy
  periods follow large earthquakes). The unit tests check that the copy contains no danger,
  alert or safety words. Event pages link to "Watch this area".


### Phase 9 — A real Earth (added 2026-09-25, after the owner's first look)

The owner expected Google Earth and found a dark wireframe ball. **Built, 2026-09-25.**
- **Imagery.** The globe streams Sentinel-2 cloudless imagery (EOX, 10 m) on a quadtree of sphere
  patches, from the whole planet down to 1.5 km above a city.
  - Each patch is positioned relative to its own centre (sub-metre float precision) and has
    skirts against cracks.
  - A missing tile borrows a sub-rectangle of its nearest loaded ancestor, then falls back to a
    stitched NASA Blue Marble.
  - Loading: 8 requests at a time, with an LRU cache.
- **Lighting and atmosphere.**
  - The Sun is placed from the scrubber's time and is tested against the solstices, the equinox
    and the equation of time. NASA Black Marble city lights show on the night side.
  - Night fades out below about 950 km altitude, so close views are always readable.
  - The atmosphere is a limb glow plus aerial-perspective haze, over a fixed-seed star field.
  - The first view faces the lit side, with the evening terminator in view.
- **Labels.** OpenStreetMap labels come from EOX's overlay, with maritime-zone lines filtered out.
- **Found and fixed: the globe had been drawn mirror-imaged since Phase 0.** The projection
  swapped two ECEF axes, which is a reflection, and without coastlines nobody could see it. It is
  now a rotation. A unit test and an e2e test both check that east appears on screen right.
- **Earthquakes on an opaque planet.**
  - By default, each earthquake is a disc at its epicentre, hidden by an exact horizon test.
    Depth-testing the sprites against the curved ground had cut them in half.
  - **X-ray** fades the ground to translucent and animates every hypocenter down to its true
    depth.
  - Slabs are underground, so showing them turns x-ray on, and leaving x-ray turns them off.
- **Camera (the Google Earth model).**
  - The camera is a target, range, heading and tilt; old three-number `cam=` links still open.
  - Grab-drag rotates about the pole axis and the east axis, so north stays put. Drags have
    inertia.
  - Zoom to cursor, double-click to fly in, right- or Ctrl-drag to turn and tilt (tilt up to 75°,
    only when close), pinch, and keys.
  - Fly-to arcs over long distances. A compass restores north up.
- **Around the globe.**
  - Place search uses Nominatim on submit only, and typed coordinates never leave the page.
  - A HUD shows the cursor's latitude and longitude and the eye altitude.
  - Clicking an earthquake flies to it and opens a card with links to all six analysis pages,
    instead of leaving the globe.
  - The waves page uses the same Earth and controls.
- **Phone widths.** The chrome wraps instead of overflowing (the page is exactly 390 px wide at
  390 px), and the imagery credit collapses to a "© imagery" button.
- **Tests.** Picking stays around 3 ms, and render-on-demand holds once tiles stop arriving.
  Tests cover the tile quadtree, camera, grab, fly path, the Sun, search parsing, the layer rules
  and the URL camera, plus six e2e tests.

- **3D terrain (added the same day, at the owner's request).**
  - Relief comes from AWS Terrain Tiles (open data, Web Mercator). Each geographic tile samples
    the Mercator tiles that cover it on the CPU, so the imagery drapes over the true relief.
  - A tile builds from the best heights cached at every probe point and rebuilds once sharper
    ones arrive; it stays flat until it is fully covered, never half-raised.
  - Edges sample one zoom coarser than interiors, so a same-level neighbour matches exactly and a
    coarser one to within metres. A unit test checks this over kilometres of rugged relief.
    Skirts shaded as shadow cover the remainder. Averaging odd edge vertices was tried and
    measured worse.
  - Hillshading from the terrain normals is lit from the north-west, relative to flat ground.
  - The camera orbits the ground it looks at; the near plane follows height above the ground.
    Ray picks intersect at the local elevation, so grabbing a mountainside keeps it under the
    cursor.
  - Tile culling is padded by Everest's height, so raised ground is never culled from view.
  - The "3D terrain" layer is on by default. An e2e test checks Everest at 7.5–9 km, and that
    it goes flat when the layer is off.
  - Frame time is 2–6 ms on the test GPU.
- **Found and fixed on the way:** once the camera reported changes on every terrain re-seat, the
  page's URL mirroring (`history.replaceState`) clobbered link navigations in flight. The
  scoreboard link e2e caught it. The camera now notifies only on real moves, and the URL write
  is skipped when nothing changed or the page is already leaving; it also keeps Next's history
  state instead of nulling it.

- **Dragging fixed (2026-09-26, reported by the owner as "the map is jumping").** Measured
  before fixing, as the distance between the cursor and the ground point it grabbed:
  30–45 km, 634 m camera jumps per step. Three causes:
  - The inertia of an earlier flick kept being applied on every frame of a drag, so the ground
    ran ahead of the cursor. Inertia now starts only on release, in degrees per second, from
    the pointer's last 100 ms.
  - The camera snapped onto the terrain height between moves. It now eases, rising faster
    than falling, and holds still during a drag.
  - Grab and terrain intersection were first-order: fixed-point refinement does not converge at
    grazing angles. The grab now re-casts and corrects to 2 m, and the terrain intersection
    marches the ray and bisects.

  After: 0.4 px straight down, 0.7 px over plains, 4.4 px tilted 60° over the Alps, and no
  height change during a drag. An e2e test holds these limits.
- **Analyst providers (2026-09-26).** Free first:
  - OpenRouter's `:free` NVIDIA Nemotron models (Ultra, then Super; free endpoints are often
    overloaded).
  - Then Gemini (the owner's AI Studio key).
  - Then Anthropic.

  Keys are sent only in headers. Readers opening the same sequence share one in-flight
  rewrite. Tests set `ANALYST_OFF=1`. Checked live: the M 7.8 near Ende, Indonesia was
  rewritten by Nemotron 3 Ultra with no verifier violations, at no cost, in about 2 minutes.
  The page shows the template meanwhile.

### Photographs (added 2026-09-28, at the owner's request)

Event pages of notable earthquakes show photographs from Wikimedia Commons, free and keyless.
- **Which earthquake.** Wikidata is asked for an earthquake item (Q7944 or a subclass) dated from
  three days before the event to one after, within 250 km. Dates are filtered before distance: a
  radius search over California touches 34,000 items and took 10 s, the date range about 1 s.
  Sequences are dated by their start (P580), so the window reaches back three days.
- **Which photographs.** The item's own images (P18), its Commons category (P373, the Commons
  sitelink, or the category item's), or a category named after it, interleaved with up to six
  subcategories, damage and rescue first. JPEGs only, 500 px wide or more, at most 12 and at most
  2 per photographer, since one uploader often files dozens of near-identical frames together.
- **Left out.** Maps, charts, art, scanned documents, portraits of officials and reaction
  categories, and pictures of the dead, matched on file name, description and subcategory name.
- **Credit.** Every photograph is credited beneath it with its author and licence; the full view
  adds the description, date, licence link and Commons page.
- **Layout.** Justified rows keep each photograph at its own proportions, uncropped. Commons
  serves thumbnails only at standard widths (500, 960, 1280, 1920; 640 and 1600 return 400).
- **Loading.** The section streams in behind a Suspense boundary, so the page never waits on
  Wikimedia: 2–4 s cold, then cached for a day. Most earthquakes have no item, and the section
  is omitted.

---

## 6. The LLM layer

### Architecture

A frozen JSON **evidence bundle** produced by the statistical layer is the only input.
Every numeral in the output must trace to a bundle key. Numbers are pre-formatted as
display strings so the model copies rather than formats.

```
evidence bundle → generator → verifier → UI
                                  │
                                  └─ fail ×2 → deterministic template
```

**The deterministic template always exists and is always shippable.** The LLM is a garnish
on a dish that is complete without it.

### Verifier

1. **Numeral whitelist.** Every numeral, percentage, magnitude, depth, date and place name
   extracted from the output must be a member of the bundle. Zero tolerance.
2. **Direction check.** A closed vocabulary of comparison words checked against the sign of
   the corresponding computed delta.
3. **Forbidden constructions.** Forward-looking modals outside an allow-list.

### Hard prohibitions

The model may not: originate any forecast or figure absent from the bundle; make any
forward-looking claim about a specific future event; offer **reassurance** not present in
the input; perform arithmetic of any kind; choose its own probability adjectives; give
protective-action advice not drawn verbatim from an approved source; interpret folk
precursors; speculate about casualties or damage; answer confidently when the bundle is
stale or partial; or present itself as an authority.

The reassurance prohibition is the load-bearing one. L'Aquila attached manslaughter
liability to falsely reassuring communication, and an LLM's default register is soothing.
The system prompt fights that default explicitly.

### Fixed lexicon

Probability bands map to approved phrases **in code**. The model never selects them.

### Routing

Prediction-seeking intents ("when is the big one," "should I evacuate," "is this a
foreshock") are classified deterministically and never reach the generator.

### Presentation

Numbers sit physically adjacent to every claim; prose is visually secondary; one tap
reveals the raw forecast; provenance and issue time are shown. **No disclaimer badge is
treated as a safety control** — research found disclaimers can increase over-trust.

### Naming

No GPT-ish branding anywhere near forecasts.

### Evaluation

Deterministic numeric fidelity on 100% of outputs in production. Benchmarked faithfulness
against RAGTruth's data-to-text taxonomy. An adversarial set of prediction-eliciting
prompts asserting refusal routing. **Not** BERTScore or embedding similarity — the Met
Office rejected these explicitly, since "north" and "south" score ~82% similar.

### 6.x Where the layer appears (added 2026-09-26)

It appears in four places. Each one has its own evidence bundle, built in `lib/analyst/facts.ts` or `bundle.ts`. Each is checked by the same verifier.

| Surface | Evidence | Template |
|---|---|---|
| Globe selection card | One event: magnitude and type, place, time, depth class, tectonic setting, review status | Server-built on request (`draft: true`) |
| Event page, "In plain words" section, and its Ask box | The same event evidence | Rendered on the server |
| Sequence page, "In plain words" section, and its Ask box | Counts, largest aftershock, Båth gap, Mc, b-value, Omori p, declustering | Rendered on the server |
| Comparison page | The comparison bundle (Phase 7) | Rendered on the server |

How each surface behaves:

- The template shows first, instantly.
- The model rewrite replaces it only if it passes verification.
- Event evidence holds only facts that do not change after review. That keeps the rewrite for an earthquake valid long enough to cache.
- Verified rewrites are kept in `.cache/analyst.json`, keyed by kind and evidence hash. That keeps free-tier quotas enough.
- The provider order is OpenRouter `:free` models, then Gemini free tier, then Anthropic. No paid call is made unless the owner sets that key.

---

## 7. Error handling

| Failure | Behaviour |
|---|---|
| USGS unavailable | Fall back to EMSC server-side; log to `ingest_runs` |
| All feeds unavailable | Serve last known state with "last confirmed HH:MM" banner |
| EMSC WebSocket drops | Backoff; UI shows **delayed**; Supabase Realtime continues |
| Waveform fetch fails | Event page renders without the waveform panel, stating why |
| Rate-limited by Raspberry Shake | Backoff, cache aggressively, surface the limit |
| Insufficient events to fit | **Refuse to produce a forecast.** Say the sequence is too small |
| WebGL unavailable | 2D canvas fallback with a notice |

Degradation is always toward showing something, honestly labelled. The exception is
forecasting: a forecast from insufficient data is worse than no forecast, and the system
declines rather than guesses.

---

## 8. Testing

Test-driven throughout.

**Unit.** Normalization for both feeds against captured fixtures including malformed
payloads — the existing EMSC branch handles four time encodings and three magnitude shapes
and must be pinned before porting. Deduplication matcher. Reasenberg-Jones closed forms
against analytically known values. Omori fitting against synthetic catalogues with known
parameters. b-value and Shi-Bolt uncertainty against published worked examples. Travel-time
interpolation against ObsPy ground truth. miniSEED parsing. Binary packing round-trips.

**Integration.** Ingestion idempotency, upsert-on-revision, cross-source duplicates, cursor
pagination, repository conformance, forecast immutability (attempted updates must fail).

**Scientific validation.** The Phase 3 harness reproducing USGS forecasts is a test suite,
not a one-off — it runs in CI against stored fixtures of real `oaf` products.

**End-to-end.** Globe renders and reaches interactive state; hover tooltips; filter-to-URL
round-trip; simulated WebSocket insert; sequence page loads; audio plays.

Fixtures are captured from live sources and committed, so tests never depend on network
availability or current seismicity.

---

## 9. Project structure

```
app/
  page.tsx, event/[id]/, sequence/[id]/, scoreboard/
  api/events/, api/events/binary/, api/proxy/{isc,gcmt,ngl}/
components/
  globe/        GlobeCanvas, layers, camera, wavefront shader
  charts/       FMD, Omori decay, Ogata residual, rate histogram, Mc(t)
  waveform/     Seismogram, spectrogram, audio transport
  sequence/     SequencePanel, DecayCurve, Classification
  forecast/     ForecastTable, FractileBands, Scoreboard
  chrome/       Header, LiveIndicator, StatusBanner, CommandPalette
lib/
  repositories/ events.ts          ← storage abstraction boundary
  normalize/    usgs.ts, emsc.ts, dedupe.ts
  science/      omori.ts, reasenberg-jones.ts, bvalue.ts, mc.ts,
                decluster.ts, csep.ts, etas.ts
  seismic/      miniseed.ts, traveltime.ts, sonify.ts
  llm/          bundle.ts, generator.ts, verifier.ts, template.ts, lexicon.ts
  store/        time.ts, selection.ts, filters.ts
supabase/
  migrations/, functions/{ingest,forecast,score}/
scripts/
  backfill.ts, build-traveltime-table.ts, build-slab2-meshes.ts, build-gcmt.ts
data/
  traveltime/*.bin, slab2/*.glb, plates/PB2002_boundaries.json
```

`lib/science/` is pure functions over plain data with no I/O, so every algorithm is
testable in isolation against published worked examples.

---

## 10. Success criteria

1. A new earthquake appears within 60 seconds of USGS publication.
2. The globe renders the M4.5+ catalogue at 60 fps with true-depth positioning.
3. Magnitude revisions are reflected within 15 minutes, with revision history visible.
4. Every filter and camera state is a shareable URL that restores exactly.
5. Sequences are detected automatically and have stable permanent URLs.
6. **Forecasts reproduce USGS published values within a stated tolerance on US events.**
7. **Forecasts are issued for events outside USGS coverage.**
8. **The public scoreboard shows calibration including failures, versus a baseline.**
9. Any event with a nearby station shows its waveform and plays as audio.
10. No forecast is ever delivered through alert-style UX.
11. Every displayed statistic carries its uncertainty.
12. Ingestion runs unattended for seven days with no gaps in `ingest_runs`.
13. The LLM layer never emits a numeral absent from its evidence bundle.
14. Total running cost is zero.

---

## 11. Deferred decisions

- ~~Travel-time table resolution and phase list~~ — **resolved.** P, S, PP, PKP, ScS at
  0.25° × 10 km over 0–180° and 0–700 km; 1 MB Float32; interpolation accurate to 0.006 s
  RMS. Missing arrivals are NaN and read back as `null`, and the null boundary is
  grid-quantised to at worst 0.75°, which sets a minimum wavefront glow width in Phase 5.
  See `spikes/FINDINGS.md` §1.
- ~~Globe point-count ceiling and LOD strategy~~ — **resolved.** 1,000,000 hypocenters at
  true depth hold 60 fps on integrated Intel graphics, so no LOD strategy is needed for
  the M4.5+ catalogue and rendering is not a constraint on the M1.0+ scaling path.
  However, GPU picking must **never** read back against a continuously rendering loop:
  measured 0.3 ms with the loop paused against 11,495 ms with it running at 1M points, and
  `readRenderTargetPixelsAsync` does not help. Render on demand, or coalesce the pick into
  the frame. See `spikes/FINDINGS.md` §2.
- **ETAS scope** — temporal-only nightly batch assumed; space-time deferred until Phase 3
  demonstrates the simpler model's limits.
- **LLM key handling** — server-side key supplied by the project owner, with response
  caching, rate limiting and a spend guard. Revisit at Phase 7.
- **Parquet migration trigger** — when the magnitude threshold drops below M2.5.
- **`taup-js` extraction** — the travel-time table and interpolator could be published as a
  standalone MIT package, since none exists. Decide after Phase 5.
