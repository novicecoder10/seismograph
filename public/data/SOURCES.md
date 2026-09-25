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

## Streamed at runtime by the globe (Phase 9), not stored here

All free and CORS-open; nothing is proxied, cached server-side or redistributed.

- Day imagery: Sentinel-2 cloudless 2024 by EOX IT Services GmbH (https://s2maps.eu), WMTS `WGS84`
  grid, CC BY-NC-SA 4.0 (non-commercial use, which this hobby and research project is). Contains
  modified Copernicus Sentinel data 2024.
- Labels: EOX `overlay_bright`, rendered by EOX from OpenStreetMap data (© OpenStreetMap
  contributors, ODbL). The shader drops its orange maritime-zone lines.
- Fallback day texture: NASA GIBS `BlueMarble_ShadedRelief_Bathymetry` (public domain), stitched in
  the browser from level-1 tiles.
- Night lights: NASA GIBS `VIIRS_Black_Marble` 2016 (public domain), stitched from level-2 tiles.
- Terrain: Terrain Tiles on AWS (open data; Mapzen "terrarium" encoding, zooms 0–15), compiled
  from SRTM, GMTED2010, ETOPO1, NED and other public sources; see
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md. Heights below sea level are
  drawn at sea level so the imagery's water stays flat.
- Place search: Nominatim (© OpenStreetMap contributors), asked on submit only, per its usage
  policy of at most one request a second.
