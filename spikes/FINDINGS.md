# Phase 0 — Spike findings

Measured 2026-09-23. Intel Core i-series TigerLake-LP laptop, Intel Iris Xe Graphics
(TGL GT2), 8 logical cores, Linux 7.0, Node 20.20.2, Python 3.12.3, headless Chromium
via Playwright 1.56, ANGLE over Vulkan 1.4.318 on the Mesa Intel driver.

All three Phase 0 questions are answered. Two answers are better than the design
assumed and one is a real hazard the design did not anticipate.

---

## 1. Travel-time table — works, and is cheap

`irisws/traveltime` was retired 2026-08-26, and probing confirmed there is no public
replacement (see §4). Offline precomputation is therefore the only option, and it is a
good one.

| Measure | Value |
|---|---|
| Grid | 5 phases (P, S, PP, PKP, ScS) × 71 depths (0–700 km, 10 km) × 721 distances (0–180°, 0.25°) |
| Samples | 255,955 |
| File size | **1,000 KiB** as Float32 |
| Build time | **953 s** on 7 worker processes (~35 min single-threaded, ~8 ms per TauP call) |
| Missing arrivals | 124,168 = **48.5%**, encoded as NaN |
| Interpolation error vs ObsPy | **RMS 0.006 s, max 0.079 s** over 207 off-grid samples |

The 48.5% missing fraction is not waste: it is the shadow zones and the distance ranges
where each phase does not exist. PKP exists only beyond ~110°, ScS only to ~90°.

**Bilinear interpolation is far more accurate than needed.** The design would have been
satisfied by 0.5 s RMS; the measured 0.006 s is two orders of magnitude better. The 0.25°
grid could be coarsened to 0.5° — halving both build time and file size — and still sit
comfortably inside 0.1 s RMS. It was left at 0.25° because 1 MB is already negligible.

**Missing arrivals surface as `null`, never `0`.** A bilinear cell whose corners include a
NaN returns `null` in full. Verified directly: P at 120° (deep in the shadow zone) is
`null`, P at 60° is 608.28 s.

### The one subtlety: the null boundary is grid-quantised

Because a cell is null if *any* corner is null, the computed cutoff sits up to one cell
inside the true cutoff. Measured across 400 samples, 4 fell in this band:

```
PP at 27.58°, resolved within 0.25°
S  at  4.98°, resolved within 0.75°
S  at  9.06°, resolved within 0.50°
P  at  5.79°, resolved within 0.50°
```

Worst case **0.75°**, three grid cells — and notably these are at short distances, in the
upper-mantle triplication region, not at the shadow-zone boundary as expected.

**Consequence for Phase 5:** the wavefront glow must be at least 0.75° wide, or the front
will show a visible gap at each phase cutoff. This is recorded as a hard requirement.

### Answer

Ship the table as built: 5 phases, 0.25° × 10 km, Float32, NaN for absent phases,
1 MB. It loads in one request and interpolates to 6 ms accuracy.

---

## 2. Globe render path — display is a solved problem, picking is not

### Display scales past the requirement

| Points | Frame time | Frame rate |
|---|---|---|
| 10,000 | 16.7 ms | 60.0 fps |
| 100,000 | 16.7 ms | 60.0 fps |
| **1,000,000** | **16.7 ms** | **60.0 fps** |

`THREE.Points` with a custom `RawShaderMaterial`, additive blending, depth-write off,
inside a translucent double-sided shell — 1,000,000 hypocenters at true depth, **vsync-
capped at 60 fps on integrated Intel graphics.** The design's target was the M4.5+
catalogue, ~250,000–300,000 rows. There is an order of magnitude of headroom.

This makes the M1.0+ scaling path a data-transport problem exclusively. Rendering is not a
constraint at any catalogue size this project will reach.

### GPU picking works, and costs almost nothing — under one condition

ID-colour encoding into a 1×1 scissored render target round-trips correctly: 8 of 8 probe
positions decoded to a real event index at every point count.

| Points | Median pick | Min | Max (first pick) |
|---|---|---|---|
| 10,000 | 2.00 ms | 1.50 ms | 14.6 ms |
| 100,000 | 2.50 ms | 2.00 ms | 491.6 ms |
| 1,000,000 | 5.70 ms | 4.50 ms | 7093.9 ms |

**But the naive implementation is catastrophic**, and this is the hazard the design did not
anticipate. Issuing the same pick from a `pointermove` handler while an unthrottled
`requestAnimationFrame` loop renders continuously:

| Points | Pick, loop paused | Pick, loop running | Ratio |
|---|---|---|---|
| 100,000 | 2.2 ms | **747 ms** | 340× |
| 1,000,000 | 0.3 ms | **11,495 ms** | 38,000× |

`readRenderTargetPixels` must drain the GPU queue before it can return, and against a
saturated 60 fps loop that queue is deep. The frame time itself degrades in step — 16.7 ms
becomes 3,983 ms at 1M points once picking starts. The whole application stops responding.

**`readRenderTargetPixelsAsync` does not fix this.** Measured 1,766 ms versus 1,852 ms at
100k points — a 5% difference. The cost is the queue drain, not the synchronousness of the
call, so moving the wait off the call stack changes nothing.

### Answer

three.js is confirmed for the globe, with a constraint the design must adopt:

1. **Never read back against a continuously rendering loop.** Render on demand (render only
   when camera, time or data change), or coalesce the pick pass into the frame — issue it
   at the top of the frame and read the result on the following frame.
2. **One pick in flight at a time**, dropping intermediate pointer moves.
3. **Warm the pick target on load.** The first pick at 1M points cost 7 s against a median
   of 5.7 ms; every subsequent pick was fast.
4. **Point-count ceiling: not reached at 1,000,000.** No LOD strategy is needed for the
   M4.5+ catalogue. Revisit only if the catalogue exceeds ~2M rendered points.

---

## 3. Waveform round-trip — works end to end

Raspberry Shake miniSEED → `seisplotjs` → canvas → Web Audio, verified in a real browser.

| Measure | Value |
|---|---|
| Source | `data.raspberryshake.org/fdsnws/dataselect/1/query`, station AM.R0066.00.EHZ |
| Parsed | 1 trace, 156 data records, 100 Hz, 30,150 samples, 0 gap samples |
| Declared for playback | 44,100 Hz |
| Speed-up | **441×** |
| Audio duration | 0.68 s from 5 minutes of ground motion |
| Second fixture | IU.ANMO.00.BHZ, 40 Hz, 24,000 samples → **1,102×** |

The compression trick from the research holds exactly: declaring N samples of 100 Hz
ground motion at 44.1 kHz is a free 441× time compression with no resampling. The ratio
falls out of the two rates, so a 50 Hz or 4.5 Hz Raspberry Shake channel needs no separate
code path — the same function reports 882× or 9,800×.

### Four things that cost time and are worth recording

1. **`seisplotjs` 3.2.7 cannot be imported under Node at all**, and the consequence is
   sharper than it first appears. Its barrel entry evaluates
   `export class SeisPlotDebugElement extends HTMLElement` at module scope, so the import
   throws `ReferenceError: HTMLElement is not defined`. Its `./nodeonly` export — which
   exists precisely to avoid this — fails identically, as does deep-importing
   `dist/miniseed.mjs`, because that pulls in `util.mjs`. Tests must run in a DOM
   environment; `happy-dom` works and is what the spike uses.

   **Consequence, confirmed in Phase 1 and sharper than it first appeared:** marking a
   component `"use client"` is *not* sufficient. Next.js renders client components on the
   server to produce the initial HTML, which evaluates their entire module graph — so the
   event page returned a 500 until the waveform panel was loaded through `next/dynamic`
   with `ssr: false`. And `ssr: false` is only permitted from a client component, so it
   needs a thin client wrapper of its own. Any server-side miniSEED parsing in Phase 5
   needs a DOM shim or a different library.
2. **The parse API is `miniseed.seismogramPerChannel(records)`**, which returns objects
   carrying `networkCode`/`stationCode`/`sampleRate`/`numPoints`/`segments`/`y`. The
   `miniseed.merge(records)` call most tutorials show returns nothing usable at this
   version.
3. **Station identifiers cannot be guessed.** `data.raspberryshake.org` returned 502 once
   and 404 "no metadata found" for an invented station code. The station service
   (`fdsnws/station/1/query?...&format=text&level=station`) is CORS-open and must be
   queried first to find live stations. R0066 and R00DC served data; R01CF did not.
4. **`IU.ANMO.00.BHZ` is 40 Hz, not 20 Hz.** Modern GSN broadband channels vary; the rate
   must be read from the record, never assumed.

### Answer

Viable as specified. Sonification is confirmed as roughly a day's work and belongs in
Phase 1 as planned.

---

## 4. Incidental finding: no public TauP service exists

`seisplotjs` 3.2.7 ships a `taup3` module which looked like a replacement for the retired
`irisws/traveltime`. It is not a public service client: its host constant is
`www.seis.sc.edu` and its path base is `LOCALWS_PATH_BASE`, meaning it targets a **locally
run** TauP web service. Probing `www.seis.sc.edu` at both `/taup3/time/1/` and
`/ws/taup/{1,3}/time` returned 404 with no CORS header.

Its sibling `traveltime` module still points at
`https://service.earthscope.org/irisws/traveltime/1/`, which is the retired endpoint.

**This closes the question.** Offline precomputation is not merely the better option, it is
the only one, and the design's decision is confirmed rather than merely assumed.

---

## Limitations of this measurement

- **One machine, integrated graphics.** The 60 fps at 1M points is a *floor* for
  discrete-GPU visitors and roughly representative for laptop visitors. It says nothing
  about mobile, which the design must measure separately before claiming the globe works
  on phones.
- **Headless Chromium reaches the GPU only with `--use-angle=vulkan`.** Both `--use-gl=egl`
  and `--use-angle=gl-egl` silently fall back to SwiftShader, whose software fill rate
  under additive blending is catastrophically unrepresentative — 35.8 s per frame at 100k
  points, against 16.7 ms on the same machine's GPU. Any future CI measurement must assert
  the renderer string, not merely that a frame rendered.
- **Frame rate is vsync-capped at 60 fps**, so 16.7 ms is an upper bound on the real frame
  cost, not a measurement of it. The true headroom above 1M points is unknown and larger
  than reported.
- **Waveform fixtures are two stations on two networks.** Gap handling is unit-tested
  against synthetic NaN runs, not against a real dropped-packet record, because neither
  captured fixture contained a gap.
- **Audio was verified as constructed and started**, programmatically. Perceptual quality —
  whether the result sounds like an earthquake — is not something a headless test can
  assess.
