"""Throwaway spike: precompute a TauP travel-time table as a Float32 binary.

Necessary because irisws/traveltime was retired 2026-08-26 and no JS TauP
port exists. Build-time only; the browser reads the binary, never ObsPy.
"""
import json
import os
import random
import multiprocessing as mp
import struct
import time

import numpy as np
from obspy.taup import TauPyModel

MAGIC = 0x54545631  # "TTV1"
PHASES = ["P", "S", "PP", "PKP", "ScS"]
DEPTH_MIN, DEPTH_STEP, N_DEPTHS = 0.0, 10.0, 71      # 0..700 km
DIST_MIN, DIST_STEP, N_DIST = 0.0, 0.25, 721         # 0..180 deg
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


_MODEL = None


def _worker_init():
    global _MODEL
    from obspy.taup import TauPyModel as _T
    _MODEL = _T(model="iasp91")


def _row(args):
    """One (phase, depth) row of the grid, vectorised over distance.

    TauP costs ~8 ms per call, so the 256k-call grid is 35 min single-threaded.
    Rows are independent, so a process pool makes it tractable.
    """
    pi, di, phase, depth = args
    out = np.full(N_DIST, np.nan, dtype=np.float32)
    for xi in range(N_DIST):
        arrivals = _MODEL.get_travel_times(
            source_depth_in_km=depth,
            distance_in_degree=DIST_MIN + xi * DIST_STEP,
            phase_list=[phase],
        )
        if arrivals:
            out[xi] = min(a.time for a in arrivals)
    return pi, di, out


def build():
    jobs = [
        (pi, di, phase, DEPTH_MIN + di * DEPTH_STEP)
        for pi, phase in enumerate(PHASES)
        for di in range(N_DEPTHS)
    ]
    table = np.full((len(PHASES), N_DEPTHS, N_DIST), np.nan, dtype=np.float32)
    done = 0
    with mp.Pool(processes=max(1, mp.cpu_count() - 1), initializer=_worker_init) as pool:
        for pi, di, row in pool.imap_unordered(_row, jobs, chunksize=2):
            table[pi, di, :] = row
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{len(jobs)} rows", flush=True)
    from obspy.taup import TauPyModel as _T
    return _T(model="iasp91"), table


def first_arrival(model, depth_km, dist_deg, phase):
    arrivals = model.get_travel_times(
        source_depth_in_km=depth_km,
        distance_in_degree=dist_deg,
        phase_list=[phase],
    )
    if not arrivals:
        return float("nan")
    return float(min(a.time for a in arrivals))


def write_binary(table, path):
    with open(path, "wb") as f:
        f.write(struct.pack("<IIII", MAGIC, len(PHASES), N_DEPTHS, N_DIST))
        f.write(struct.pack("<ffff", DEPTH_MIN, DEPTH_STEP, DIST_MIN, DIST_STEP))
        for phase in PHASES:
            f.write(phase.encode("ascii").ljust(16, b"\x00"))
        f.write(table.astype("<f4").tobytes(order="C"))


def write_ground_truth(model, path, n=400, seed=20260923):
    rng = random.Random(seed)
    samples = []
    for _ in range(n):
        phase = rng.choice(PHASES)
        depth = rng.uniform(DEPTH_MIN, DEPTH_MIN + (N_DEPTHS - 1) * DEPTH_STEP)
        dist = rng.uniform(DIST_MIN, DIST_MIN + (N_DIST - 1) * DIST_STEP)
        t = first_arrival(model, depth, dist, phase)
        samples.append({
            "phase": phase,
            "depthKm": depth,
            "distDeg": dist,
            "timeS": None if np.isnan(t) else t,
        })
    with open(path, "w") as f:
        json.dump({"samples": samples}, f, indent=1)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    wall = time.time()
    model, table = build()
    write_binary(table, os.path.join(OUT_DIR, "traveltime.bin"))
    write_ground_truth(model, os.path.join(OUT_DIR, "ground_truth.json"))
    total = table.size
    missing = int(np.isnan(table).sum())
    size = os.path.getsize(os.path.join(OUT_DIR, "traveltime.bin"))
    print(f"grid {table.shape} = {total} samples, {missing} missing "
          f"({100 * missing / total:.1f}%), {size / 1024:.0f} KiB, "
          f"{time.time() - wall:.0f}s wall")
