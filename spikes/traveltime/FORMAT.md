# TTV1 travel-time table format

Little-endian throughout. Built by `build_table.py`; read by `interpolate.ts`.

## Header

| Offset | Type | Field |
|---|---|---|
| 0 | uint32 | magic `0x54545631` ("TTV1") |
| 4 | uint32 | `nPhases` |
| 8 | uint32 | `nDepths` |
| 12 | uint32 | `nDist` |
| 16 | float32 | `depthMinKm` |
| 20 | float32 | `depthStepKm` |
| 24 | float32 | `distMinDeg` |
| 28 | float32 | `distStepDeg` |
| 32 | 16 bytes × `nPhases` | phase names, ASCII, NUL-padded |

## Body

`float32` travel times in seconds, C order, indexed `[phase][depth][distance]`.

**A missing arrival is `NaN`, never `0.0`.** The P-wave shadow zone (roughly 103°–143°) has
no direct P arrival at all, and a zero there would render as an instantaneous arrival. The
TypeScript reader turns any NaN-touching interpolation cell into `null`.

## As built, 2026-09-23

| | |
|---|---|
| Model | `iasp91` |
| Phases | P, S, PP, PKP, ScS |
| Depths | 71 × 10 km, 0–700 km |
| Distances | 721 × 0.25°, 0–180° |
| Samples | 255,955 |
| Missing (NaN) | 124,168 = 48.5% |
| File size | 1,000 KiB (1,023,932 bytes) |
| Build time | 953 s on 7 worker processes |

Interpolation accuracy against ObsPy on 207 off-grid samples: RMS 0.006 s, max 0.079 s.
The null boundary is grid-quantised to at worst 0.75°. See `../FINDINGS.md` §1.
