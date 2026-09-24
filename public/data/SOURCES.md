# Data files served by this app

- `traveltime.bin` — iasp91 travel times for P, S, PP, PKP and ScS, built with ObsPy TauP in Phase 0
  (`spikes/traveltime/build_table.py`, format in `spikes/traveltime/FORMAT.md`).
- `slab2.bin` — Slab2 slab-top depths (Hayes, G., 2018, Slab2 — A Comprehensive Subduction Zone
  Geometry Model: U.S. Geological Survey data release, https://doi.org/10.5066/F7PV6JNV; public
  domain), decimated from 0.05° to 0.2° by `scripts/build-slab2.py`. The ScienceBase host sits
  behind an interactive browser challenge, so the 27 unmodified `*_slab2_dep_*.xyz` files were
  taken from the mirror in `gabriellemhobson/SZ_2D_thermal_structure` (`generate_meshes/data/Slab2`)
  and checked for plausibility: each slab lies in its named region, depth ranges match the
  published model, and the 2026 M6.9 Pematangsiantar earthquake (175 km deep) sits about 20 km below
  the Sumatra slab top, where intraslab events belong.
