**Throwaway spike code. Nothing here is imported by production code.**

Phase 0 of `docs/superpowers/specs/2026-09-23-seismograph-design.md` resolves three
unknowns before production code is written. Each spike answers one question and its
answer is recorded in `FINDINGS.md`.

| Spike | Question | Run |
|---|---|---|
| `traveltime/` | Can a TauP table be precomputed offline and interpolated accurately in TypeScript? `irisws/traveltime` was retired 2026-08-26. | `.venv/bin/python traveltime/build_table.py` then `npm test -- traveltime` |
| `globe/` | Does three.js hold 100k hypocenters at true depth at 60fps, with GPU picking? | `npm run dev:globe` |
| `waveform/` | Does Raspberry Shake miniSEED parse, render and sonify end to end? | `npm run dev:waveform` then `npm test -- waveform sonify` |

Setup:

```bash
npm install
npx playwright install chromium
python3 -m venv .venv && .venv/bin/pip install -r traveltime/requirements.txt
```

Headless measurement of the two browser spikes: `npm run e2e` with both dev servers up.
Headless Chromium renders through SwiftShader, so its frame rate is a **floor**, not a
real-GPU number.
