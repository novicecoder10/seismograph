# Research Findings — Competitive, Scientific and Data Landscape

**Date:** 2026-09-23
**Status:** Evidence base for the Seismograph design
**Method:** Five parallel research agents; live product pages and API probes preferred over
secondary sources. Claims that could not be verified are marked.

---

## 1. Why this document exists

An earlier design proposed a 3D globe with true-depth hypocenters as the differentiating
feature, with forecasting deferred to a later phase. Research showed that framing was
wrong. This document records what was found so the design's reversals are traceable to
evidence rather than opinion.

---

## 2. Competitive landscape

### Saturated — do not rebuild

2D maps and event lists, magnitude/time/region filtering, catalogue export, push
notifications, and felt-report crowdsourcing are all done well by multiple incumbents
(USGS, EMSC, GeoNet, JMA, INGV, GFZ, VolcanoDiscovery, EarthquakeTrack).

### Foolish to compete with

| System | Why |
|---|---|
| USGS PAGER | Loss modelling needs population, building inventory and decades of calibration |
| USGS ShakeMap / JMA shindo | Requires the real-time strong-motion network |
| ShakeAlert / MyShake / JMA EEW | Regulatory, licensed, life-safety liability; MyShake is free and government-backed |
| EMSC LastQuake | Flashsourcing depends on EMSC's own traffic and a decade of user base |
| VolcanoDiscovery (volcanoes) | Genuine editorial and database moat |
| ObsPy / PyGMT | Be the interactive layer they lack, not a competing analysis library |

### Contested — the 3D globe is commodity

At least six products render 3D globes of recent earthquakes. Two are good and free:

- **World Earthquake Labs** — claims USGS+ISC+JMA merged, ~2.97M deduplicated events from
  1900, true-depth "4D" globe, six chart families, CSV export. AdSense-supported.
  (Claims are from its own marketing; not independently verified.)
- **Earthquake Animator** — rotatable 3D globe, cross-section view through the Earth,
  WebGPU renderer with WebGL fallback, plate/fault/volcano overlays, USGS+EMSC merged.

**EarthScope IEB** remains the most capable catalogue explorer: up to 25,000 events, a
rotatable 3D viewer for 5,000, depth exaggeration ×1–20, CSV export. Dated UI, rich
function.

**TectoView** is the strongest scientific cross-section tool on the web — client-side,
QuakeML/CSV import, Schmidt-projection beachballs, 900 DPI PNG and SVG export. But it is
bring-your-own-data with no live catalogue or discovery layer.

### Absent — nobody does these

1. **Sequences as first-class objects.** Every tool treats earthquakes as independent
   dots. Nothing groups a mainshock with its foreshocks and aftershocks into a named,
   trackable entity with its own page, decay curve, migration path and forecast — despite
   that being how seismologists and journalists actually think.
2. **Aftershock forecasting in any consumer tool.** USGS publishes it as a static text
   block on selected event pages only.
3. **Quantitative seismicity analysis on the web.** b-value, magnitude of completeness,
   declustering and rate-change analysis exist only in ZMAP — unmaintained MATLAB
   requiring a paid licence. No web equivalent exists.
4. **Map and waveform fusion.** The waveform world and the map world are entirely
   disjoint. No consumer map lets you see the seismogram that recorded an event, despite
   `seisplotjs` making it free and straightforward.
5. **Watching a solution converge.** Only EMSC pushes over WebSocket; everyone else polls.
   Nobody maintains one event identity updating in place as agencies revise magnitude and
   depth, with revision history visible.
6. **Any production LLM feature.** Zero found across institutional, consumer and research
   tools.
7. **Permalinked analysis state.** Only TectoView exports a config.
8. **Structural context in 3D.** Nothing renders Slab2 subduction geometry against
   hypocenters.

### Cautionary precedent

**Quake Hunter** (NASA WebWorldWind) shipped true-depth 3D with auto-generated histograms
and time-series charts in 2016. Abandoned; last commit ten years ago. The idea was never
the hard part — maintenance was.

---

## 3. Forecasting science

Epistemic tags: **[ESTABLISHED]** operational and peer-reviewed; **[ACTIVE RESEARCH]**
published but contested; **[FRINGE]** unsupported.

### The core opportunity

USGS runs Operational Aftershock Forecasting correctly and publishes it openly — but only
for **M≥4.0 in the continental US** and **M≥5.0 in US territories**. There is no automatic
forecast for Chile, Indonesia, Turkey, Japan, Greece, Iran, Mexico or the Philippines. The
2025 M7.1 Tibet event carries 13 USGS products and no forecast among them.

The method is public and closed-form.

### Reasenberg-Jones [ESTABLISHED]

Rate of aftershocks of magnitude ≥ M at time t days after a mainshock of magnitude Mmain:

```
λ(t, M) = 10^(a + b(Mmain − M)) · (t + c)^(−p)
```

Expected count over a window integrates analytically:

```
N(≥M, T1, T2) = 10^(a + b(Mmain − M)) · I(T1,T2)

I = [ (T2+c)^(1−p) − (T1+c)^(1−p) ] / (1 − p)      for p ≠ 1
I = ln( (T2+c) / (T1+c) )                           for p = 1

P(≥1) = 1 − exp(−N)
```

USGS integrates over a posterior on the productivity parameter `a` rather than using plain
Poisson, producing fatter tails. The Bayesian update multiplies a generic prior by the
Poisson likelihood of aftershocks observed so far; typically only `a` is updated early,
with `p`, `c`, `b` held at regional generic values.

Critically, magnitude of completeness is **elevated and time-varying** immediately after a
mainshock. Page et al. (2016) model `Mc(t) = Mmain/2 − G − H·log10(t)`. Fitting without
this biases both `p` and `a` low.

**Implementation: LOW difficulty.** A few hundred lines of TypeScript, milliseconds, no
GPU. **Defensibility: 9/10** — this is the operational method.

### Parameters without guesswork

Rather than hardcoding a table, query ComCat for past events in the same tectonic regime
and read the `model` block from their published `forecast.json`. That yields USGS's own
current priors per regime, for free.

### Validation strategy

USGS publishes its forecasts as machine-readable products including the parameters used.
An implementation can therefore be validated **against USGS's own numbers** on US events,
giving both a regression test and a credibility claim no competitor can make.

### ETAS [ESTABLISHED]

```
λ(t,x,y | H_t) = μ·u(x,y) + Σ_{i: t_i<t} K0·e^{α(m_i−m0)}·(t−t_i+c)^(−p)·f(x−x_i, y−y_i; m_i)
```

Likelihood is O(N²) naive. Temporal-only ETAS with N ≤ ~10k fits comfortably in a
serverless budget; space-time MLE at scale does not. Recommendation: Reasenberg-Jones
live, ETAS as a cached nightly batch. Reference implementation: `github.com/lmizrahi/etas`.

### Declustering and background rates

- **Gardner-Knopoff (1974)** — deterministic windows, crude but universally understood.
- **Zaliapin & Ben-Zion nearest-neighbour** — `η_ij = t_ij · (r_ij)^d · 10^(−b·m_i)`. The
  distribution of log η is bimodal, separating background from clustered events in a
  data-driven way, and yields cluster topology (mainshock-aftershock vs swarm).

Methods disagree by tens of percent. Showing that disagreement honestly is itself a
differentiator.

For anomaly claims: background seismicity is overdispersed relative to Poisson, so a
**negative binomial** null is more defensible. With many regions tested, apply
Benjamini-Hochberg FDR or state the false-alarm budget explicitly. Better still, report
the **ETAS residual** — observed versus model-expected — rather than a p-value.

### b-value

Aki-Utsu MLE (never least-squares on the cumulative FMD):

```
b̂ = log10(e) / ( M̄ − (Mc − ΔM/2) )
σ_b = 2.30 · b̂² · sqrt( Σ(M_i − M̄)² / (n(n−1)) )      [Shi & Bolt 1982]
```

**van der Elst (2021) b-positive** uses only positive differences between successive
magnitudes, making it robust to the time-varying incompleteness that ruins b-values after
a mainshock. This is under-exploited and should be the default for sequences.

**b-value as precursor is contested.** Gulia & Wiemer's Foreshock Traffic Light System
(*Nature* 2019) was challenged by Dascher-Cousineau et al. (*Nature* 2020) for deviating
from its own published method; the authors conceded it is "too early to use... routinely
for making decisions about civil protection and public communications." Displaying b with
honest uncertainty is fine. Alerting on it is not.

### Machine learning

**Works [ESTABLISHED]:** phase picking (PhaseNet, EQTransformer, GPD), denoising, catalogue
densification. These are signal-processing wins, not prediction wins.

**Does not work:** the 2018 *Nature* deep-learning aftershock paper was matched by a
**two-parameter logistic regression** (Mignan & Broccardo 2019); independent critiques
found train/test leakage and a misleading metric for an imbalanced problem. A
meta-analysis of 77 neural-network prediction studies (2020) found reported skill scales
with methodological freedom rather than anything physical.

### Foreshocks

Both cascade-triggering and pre-slip nucleation occur; **neither is reliably identifiable
prospectively**. What *is* defensible is the probability that any given earthquake is
followed by a larger one — roughly 5% of M≥3 within 3 days and 10 km, falling with time.
ETAS gives this natively, and it is what USGS's `aboveMainshockMag` block reports.

### CSEP self-evaluation

Forecasts registered in advance, evaluated prospectively. N-test (count consistency),
L/S/M-tests (likelihood, spatial, magnitude), information gain per earthquake, Molchan
diagrams. Reference: `pycsep`, docs at docs.cseptesting.org.

The tests are easy to reimplement; the discipline is the hard part — **publish forecasts
with a timestamp and immutable hash before the evaluation window**, and always include a
smoothed-seismicity baseline to beat.

**Defensibility: 10/10. No consumer earthquake app does this.**

### Refuse to build

1. Deterministic prediction of time, place and magnitude.
2. "Overdue" countdowns — the seismic gap hypothesis failed prospective testing.
3. b-value alerts.
4. Lunar, tidal or planetary-alignment indicators.
5. Radon, ionospheric TEC, VAN signals, animal behaviour, earthquake weather.
6. Teleconnection narratives drawing lines between distant earthquakes.
7. Any ML model trained on a catalogue to predict earthquakes.
8. Anything resembling early warning built on polled feeds — latency is 1–5 minutes,
   which is useless as protection and dangerous as a habit.
9. Redistributing ShakeAlert or JMA EEW without a licence.
10. Personalised daily risk scores.
11. Alert-style UX on any computed forecast. Even a correct 12% figure delivered as a push
    notification reads as a prediction.
12. Hiding uncertainty. **The confidence interval is the product.**

---

## 4. Data sources

Probed live 2026-09-23. "CORS ✅" means `Access-Control-Allow-Origin: *` was returned —
fetchable directly from the browser with no proxy.

### Headline: the ecosystem is almost entirely CORS-open

USGS, EMSC, EarthScope, ORFEUS, NCEDC, SCEDC, INGV, GeoNet, Raspberry Shake, JMA and NOAA
all verified open. Proxy required only for **ISC**, **Nevada Geodetic Lab**, **GCMT** and
**NDBC**.

### Breaking change

`irisws/timeseries` and `irisws/traveltime` were **retired 2026-08-26**. Both return HTTP
404 with `This service has been retired`, on both `service.iris.edu` and
`service.earthscope.org`.

Consequences: no server-side waveform rendering, no server-side travel-time computation,
and `seisplotjs`'s traveltime module plus most online tutorials are currently broken.
Travel times must be precomputed offline (ObsPy `taup`) into a lookup table over
epicentral distance × source depth and interpolated client-side. A 181×71 grid per phase
is ~51 KB; all needed phases fit under 1 MB. No MIT-licensed `taup-js` package exists.

### Verified endpoints

| Source | Endpoint | CORS | Notes |
|---|---|---|---|
| USGS feeds | `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/*.geojson` | ✅ | ~1 min updates |
| USGS FDSN | `earthquake.usgs.gov/fdsnws/event/1/query` | ✅ | 20k event cap; `producttype=oaf` |
| EMSC WebSocket | `wss://www.seismicportal.eu/standing_order/websocket` | — | CC BY 4.0, true push |
| EMSC REST | `www.seismicportal.eu/fdsnws/event/1/query` | ✅ | |
| GeoNet | `api.geonet.org.nz` | ✅ | CC BY 3.0 NZ; per-station PGA/PGV |
| JMA | `www.jma.go.jp/bosai/quake/data/list.json` | ✅ | Undocumented; terms unverified |
| EarthScope waveforms | `service.earthscope.org/fdsnws/dataselect/1/query` | ✅ | miniSEED |
| **Raspberry Shake** | `data.raspberryshake.org/fdsnws/dataselect/1/query` | ✅ | **Verified: 108 KB real miniSEED, no key** |
| Raspberry Shake stations | `data.raspberryshake.org/fdsnws/station/1/query` | ✅ | 28,154 station-epoch rows |
| Plate boundaries | `raw.githubusercontent.com/fraxen/tectonicplates/.../PB2002_boundaries.json` | ✅ | 226 KB, drop-in |
| NOAA tsunamis | `ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events` | ✅ | Back to 2000 BC |
| ISC | `isc.ac.uk/fdsnws/event/1/query` | ❌ | Proxy; ~24-month latency |
| GCMT | `ldeo.columbia.edu/~gcmt/.../qcmt.ndk` | ❌ | Bake at build time; NDK parser ~60 lines |
| NGL GNSS | `geodesy.unr.edu/gps_timeseries/IGS20/rapids/IGS20/{STA}.tenv3` | ❌ | 12 KB/station, ~11-day latency |

### Raspberry Shake specifics

No key, no account, no payment method. Rate limits 5 req/s and 30 req/min; throttled after
200 MB to one IP; max 24 h per request; data is T-minus-30-minutes. Archive to 2016.
Station coordinates are deliberately fuzzed to ~1 km for homeowner privacy and must not be
presented as exact. No event service, no public SeedLink or WebSocket.

Volume: ~54 KB/min/channel at 100 sps. A 5-minute single-channel window is ~270 KB — fine
for a browser fetch.

### USGS product tree — richer than commonly used

From the event detail GeoJSON, `properties.products.*[0].contents[<name>].url`:

- **ShakeMap:** `cont_mmi.json`, `cont_pga.json` (contour polygons as GeoJSON, tens of KB),
  `rupture.json` (finite-fault geometry), `coverage_mmi_*_res.covjson`,
  `attenuation_curves.json`, `info.json`
- **DYFI:** `dyfi_geo_1km.geojson`, `dyfi_geo_10km.geojson`, `dyfi_plot_atten.json`
- **PAGER:** `exposures.json`, `alerts.json`, `losses.json`, `historical_earthquakes.json`
- **Moment tensor:** `quakeml.xml` with Mrr/Mtt/Mpp/Mrt/Mrp/Mtp, nodal planes, principal axes
- **OAF:** `forecast.json`, `forecast_data.json`

Always read the `.url` field; never hand-build product paths — the timestamp segment
varies and guessed paths return 403.

Most apps render the ShakeMap JPEG and a flat pin. The GeoJSON contours and the actual
rupture polygon sit in the same tree, free.

### Most underused free sources

1. **Raspberry Shake dataselect** — ~30,000 citizen seismometers, open, unclaimed.
2. **ShakeMap contours + rupture + DYFI bins** — everyone uses the JPEG instead.
3. **USGS Slab2** — complete 3D subduction geometry, public domain. 0.05° NetCDF grids are
   hundreds of MB raw; decimated to glTF they are a few MB and render beautifully.
4. **Nevada Geodetic Lab rapid GNSS** — free daily ground displacement for ~20k stations
   globally. Shows the ground physically moving; no earthquake app does this.
5. **EMSC WebSocket + NOAA tsunami API** — true push, and 4,000 years of tsunami history.

---

## 5. Visualization precedent

### Sonification

Seismograms recorded at 20–100 Hz played back ~1000–2000× land in the audible range. P
arrivals become sharp pops, S waves lower thuds, surface waves long descending whooshes
(dispersion heard as a downward glissando), aftershocks a crackling.

The implementation trick: declare a 20 Hz waveform as a 44.1 kHz `AudioBuffer` and the
speed-up is free — no resampling. `playbackRate` gives a continuous speed control.

Prior art: IRIS **SeisSound** (stereo — one channel time-compressed, one a VCO driven by
the low-frequency envelope) and Lamont-Doherty's **Seismodome**, a 24-channel planetarium
show. **No browser implementation exists.**

### Wavefront propagation

IRIS **Ground Motion Visualization** — stations flashing red/blue as real waves sweep
across them — is the most-shared visual in seismology and ships **only as pre-rendered
MP4s for USArray**.

Interactive implementation: ship the precomputed travel-time table as a GPU `DataTexture`,
and in a fragment shader compute each point's angular distance from the epicenter, look up
`t_P(Δ)`, `t_S(Δ)`, `t_surface(Δ)`, and emit a glow where `|t_now − t_phase(Δ)| < width`.
~40 lines of GLSL, zero CPU cost, and shadow zones and triplications fall out
automatically because they are baked into the table. The surface wave refocuses at the
antipode — a striking moment nobody shows.

### Structure and mechanisms

**Slab2** as translucent shaded surfaces with Wadati-Benioff hypocenters inside them exists
**nowhere on the web**. Depth alone is meaningless to users; depth *relative to the slab*
is a story.

**Beachballs:** no JavaScript library exists. The pixel-shader formulation — fill where
`sign(r·M·r) > 0` over a lower-hemisphere equal-area projection — is ~30 lines and avoids
the degenerate cases that make analytic nodal-curve tracing painful. Rendering them as
shader-shaded spheres rather than flat sprites, so orbiting reveals true fault
orientation, would be a first. ~60k free mechanisms from GCMT back to 1976.

### Cross-domain patterns worth taking

| Source | Pattern |
|---|---|
| Flightradar24 | Click-to-dossier without leaving the map; coverage transparency builds trust |
| Windy / Ventusky | **Time as the primary axis** — the whole app is a function of `t`, not a filter |
| zoom.earth | Continuous zoom across orders of magnitude with no modal transitions |
| NASA Eyes | One speed multiplier driving camera, animation and audio together |
| Grafana / Datadog | Linked brushing and a shared crosshair across all panels |
| Bloomberg | Keyboard-first command palette; sparklines in list rows, not just detail views |

**Time as architecture is a day-one decision.** It makes replay, wavefront animation and
sonification one system instead of three toys, and retrofitting it is painful.

### Rendering stack

**three.js over deck.gl.** deck.gl's `_GlobeView` is experimental and resists custom
shaders, volumetrics and arbitrary meshes — all of which Slab2 surfaces, beachball spheres
and wavefront shaders require. A single `THREE.Points` with a custom shader holds ~1M
hypocenters at 60 fps. MapLibre remains available for a 2D projection mode.

---

## 6. LLM layer

### The principle is correct and standard

"Math predicts, the LLM explains" is what every serious production system converged on.
Honeycomb's rule is the pattern: **architecturally deny the model the capability** rather
than instructing it not to.

### Cautionary precedent

- **Grok told users tsunami alerts were cancelled during the July 2025 M8.8 Kamchatka
  earthquake, while those alerts were live.** An LLM adjacent to real-time hazard data,
  answering confidently, negated an official life-safety message.
- **L'Aquila (2009):** seven people convicted of manslaughter — not for failing to predict,
  but for "inexact, incomplete and contradictory" communication and falsely reassuring
  statements. **Liability attached to reassurance.** An LLM's default register is soothing
  and agreeable; that default is the precise failure mode. The system prompt must fight it.
- **Bloomberg:** ≥36 corrections to AI summaries in three months. Their defence, "99% meet
  our editorial standards," is the lesson — 1% of a high-volume numeric feed is many wrong
  numbers.
- **EBU/BBC study** across 22 organisations: 45% of AI answers had at least one significant
  issue; 20% major accuracy issues.
- **Met Office**, fine-tuning on a narrow templated forecast-text task with national
  weather service data, achieved a **38–48% error rate** and did not ship unsupervised.
- **The transparency trap:** research found some people read AI disclaimers as evidence of
  self-awareness and honesty, *increasing* trust. **A disclaimer badge is not a safety
  control.**

### Controls that actually work

**Architectural, in order of strength:**

1. **Slot-filled skeleton, LLM polish.** Compute and format every number in code; the model
   rewrites prose that already contains correct numerals.
2. **Numeral whitelisting.** Extract every numeral, percentage, magnitude and date from the
   output; assert membership in the input bundle; reject and regenerate on violation. The
   only hard guarantee that generalises.
3. **Constrained decoding for structure**, free text inside fields. Note that format
   restriction can degrade reasoning quality, so do not use it to force numerals.
4. **Deny the capability.** No tool, retrieval path or prompt affordance that could produce
   an unhandled forecast.

**Probabilistic mitigation:** per-sentence citation to bundle keys (doubles as an eval
signal), chain-of-verification, an LLM-as-judge faithfulness gate, deterministic intent
routing so prediction-seeking questions never reach the generator.

**Insufficient alone:** prompt instructions, RAG without verification, low temperature,
disclaimers.

### The fixed lexicon requirement

Interpretation of verbal probability phrases varies widely between people, worst in the
20–80% band, and statisticians themselves disagree on their meaning. **The model may not
choose its own probability adjectives.** Bands map to approved phrases in code.

### Comprehension research

Low-to-moderate probabilities are frequently read as "no risk," and expert-objective terms
interpreted subjectively can *reduce* preparedness. The Canterbury study found that
understanding **sequence behaviour** is foundational to public sense-making when a large
aftershock arrives — which is to say the thing people most need is not the probability
number but a mental model of what a sequence is.

### The strongest application

A **comparative sequence explainer**: *this sequence at 72 hours in looks most like
Ridgecrest 2019 and least like Canterbury 2010–11; here is what happened next in each, and
here is why the comparison is imperfect.*

Every hard part is computable — elapsed-time-matched windows, Omori fits, normalised rate
curves, nearest-neighbour matching against a historical sequence library. The LLM narrates
a similarity ranking and a set of caveats it was handed. It is retrospective, so it is
structurally incapable of being a prediction, yet it answers what people actually mean
when they ask "is this going to get worse."

Runner-up: conversational chart explanation grounded in underlying data plus view context,
which doubles as genuine accessibility infrastructure for blind and low-vision users.

### Naming trap

**QuakeGPT** already exists as a USGS-seminar nowcasting model. Any GPT-ish branding near
forecasts invites conflation between "LLM that explains" and "AI that predicts" — the
single largest reputational risk in the project.

### Where precedent is thin

No agency anywhere does public-facing LLM hazard narration; USGS uses human-authored
templates. Shipping this means being ahead of the agencies, and carrying risk they have
declined to carry.
