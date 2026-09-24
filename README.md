# Seismograph

A web application for monitoring, analysing and understanding earthquakes.

**Research and hobby use only.** No advertising, no subscriptions, no accounts, and no
running cost.

## What this build does

- A 3D globe rendering hypocenters at **true depth** inside a translucent Earth, coloured
  by depth, driven by the live USGS catalogue.
- **Time is the primary axis**, not a filter. One scrubber and one rate multiplier drive
  the whole view; every state is a shareable URL that restores exactly.
- Event pages built on the **full USGS product tree** — every contributing agency solution
  with its uncertainties, moment tensor nodal planes, ShakeMap intensity contours, DYFI
  felt reports, PAGER exposure and ground-failure alerts. Absent products are omitted, not
  rendered empty.
- **Ground motion you can see and hear.** The nearest open citizen seismometer's recording,
  drawn and played back at a few hundred times real time, because ground motion is below
  human hearing.
- A table view that works with no GPU at all.

## What this build does not do

**It makes no forward-looking claim of any kind.** Deterministic earthquake prediction is
not scientifically possible and no part of this application will ever imply otherwise.
Aftershock forecasting arrives in Phase 3, from published statistical models
(Reasenberg-Jones, Omori-Utsu), presented on pages you choose to open and never as an
alert — and every forecast will be scored in public afterwards, including the misses.

An e2e test asserts that no page in this build contains forward-looking language.

## Running it

```bash
npm install
npm run dev
```

**No credentials are needed.** Every data source is public and CORS-open.

```bash
npm test          # unit and component tests
npm run e2e       # browser tests (needs a dev server; Playwright starts one)
npm run typecheck # tsc --noEmit, strict
npm run build
```

## Data sources and licences

| Source | Use | Licence |
|---|---|---|
| [USGS FDSN event service](https://earthquake.usgs.gov/fdsnws/event/1/) | Catalogue, event detail, product tree | Public domain |
| [USGS summary feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/) | The live window | Public domain |
| [EMSC](https://www.emsc-csem.org/) | Normalization support; ingestion in Phase 1b | CC BY 4.0 |
| [Raspberry Shake](https://raspberryshake.org/) | Citizen-seismometer waveforms | Per Raspberry Shake's terms |

## Architecture

Every read goes through `lib/repositories/events.ts`. Phase 1 implements that interface
against USGS directly; Phase 1b implements it against Supabase and must satisfy the same
conformance suite, unchanged. No component knows where events come from.

`lib/science/` — pure functions over plain data, no I/O — arrives with the sequence work in
Phase 2.

## Documents

- `docs/superpowers/specs/2026-09-23-seismograph-design.md` — the design.
- `docs/superpowers/specs/2026-09-23-research-findings.md` — the evidence behind it.
- `docs/superpowers/plans/` — implementation plans, one per phase.
- `spikes/FINDINGS.md` — what the Phase 0 spike week measured. Two of its findings are
  load-bearing: the globe never renders continuously, and `seisplotjs` never reaches the
  server.
