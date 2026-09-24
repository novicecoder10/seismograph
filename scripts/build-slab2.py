#!/usr/bin/env python3
"""Decimate Slab2 depth grids (Hayes 2018, USGS, public domain) to a compact binary.

Usage: build-slab2.py <dir of *_slab2_dep_*.xyz> <out.bin> [step_deg]

Input: Slab2 `*_slab2_dep_*.xyz` files (lon 0-360, lat, depth km negative down, NaN
outside the slab), sampled every 0.05 degrees. Output format SLB1, little-endian:
  "SLB1" | uint32 nSlabs | per slab:
    char[4] code (NUL-padded) | float32 lonMin latMin step | uint32 nLon nLat |
    int16[nLat][nLon] depth in 0.1 km, positive down, -32768 where absent
"""
import glob, os, struct, sys

src, out = sys.argv[1], sys.argv[2]
step = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
k = round(step / 0.05)
slabs = []
for fn in sorted(glob.glob(os.path.join(src, "*_slab2_dep_*.xyz"))):
    code = os.path.basename(fn)[:3]
    pts = {}
    for line in open(fn):
        a = line.strip().split(",")
        if len(a) < 3 or a[2] == "NaN":
            continue
        i, j = round(float(a[0]) * 20), round(float(a[1]) * 20)
        if i % k or j % k:
            continue
        pts[(i // k, j // k)] = -float(a[2])
    if not pts:
        continue
    i0 = min(p[0] for p in pts); i1 = max(p[0] for p in pts)
    j0 = min(p[1] for p in pts); j1 = max(p[1] for p in pts)
    nlon, nlat = i1 - i0 + 1, j1 - j0 + 1
    grid = []
    for j in range(j0, j1 + 1):
        for i in range(i0, i1 + 1):
            d = pts.get((i, j))
            grid.append(-32768 if d is None else max(-32767, min(32767, round(d * 10))))
    slabs.append((code, i0 * step, j0 * step, nlon, nlat, grid))
    print(f"{code}: {len(pts)} points, {nlon}x{nlat}", file=sys.stderr)

with open(out, "wb") as f:
    f.write(b"SLB1" + struct.pack("<I", len(slabs)))
    for code, lon0, lat0, nlon, nlat, grid in slabs:
        f.write(code.encode().ljust(4, b"\0") + struct.pack("<fffII", lon0, lat0, step, nlon, nlat))
        f.write(struct.pack(f"<{len(grid)}h", *grid))
print(f"wrote {out}: {os.path.getsize(out)} bytes, {len(slabs)} slabs", file=sys.stderr)
