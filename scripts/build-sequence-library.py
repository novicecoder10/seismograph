#!/usr/bin/env python3
"""Build the historical sequence library for the comparative explainer (Phase 7).

For each curated sequence: resolve the ComCat event near the given time, place and size,
then store every M4.5+ event within the Wells-Coppersmith radius (clipped 30-300 km) from
30 days before to 365 days after, as (days after mainshock, magnitude, depth).
Usage: build-sequence-library.py data/sequences/library.json
"""
import json, math, sys, time, urllib.parse, urllib.request

LIB = [
    ("Landers", "1992-06-28", 34.20, -116.44, 7.3),
    ("Northridge", "1994-01-17", 34.21, -118.54, 6.7),
    ("Kobe", "1995-01-16", 34.58, 135.02, 6.9),
    ("Izmit", "1999-08-17", 40.75, 29.86, 7.6),
    ("Chi-Chi", "1999-09-20", 23.77, 120.98, 7.7),
    ("Hector Mine", "1999-10-16", 34.59, -116.27, 7.1),
    ("Denali", "2002-11-03", 63.52, -147.44, 7.9),
    ("Sumatra-Andaman", "2004-12-26", 3.30, 95.98, 9.1),
    ("Nias", "2005-03-28", 2.09, 97.11, 8.6),
    ("Kashmir", "2005-10-08", 34.54, 73.59, 7.6),
    ("Wenchuan", "2008-05-12", 31.00, 103.32, 7.9),
    ("L'Aquila", "2009-04-06", 42.33, 13.33, 6.3),
    ("Maule", "2010-02-27", -36.12, -72.90, 8.8),
    ("Darfield (Canterbury)", "2010-09-03", -43.52, 172.17, 7.0),
    ("Tohoku foreshock", "2011-03-09", 38.44, 142.84, 7.3),
    ("Tohoku", "2011-03-11", 38.30, 142.37, 9.1),
    ("Iquique", "2014-04-01", -19.61, -70.77, 8.2),
    ("Napa", "2014-08-24", 38.22, -122.31, 6.0),
    ("Gorkha", "2015-04-25", 28.23, 84.73, 7.8),
    ("Illapel", "2015-09-16", -31.57, -71.67, 8.3),
    ("Kumamoto foreshock", "2016-04-14", 32.74, 130.81, 6.2),
    ("Amatrice", "2016-08-24", 42.72, 13.19, 6.2),
    ("Kaikoura", "2016-11-13", -42.74, 173.05, 7.8),
    ("Anchorage", "2018-11-30", 61.35, -149.96, 7.1),
    ("Ridgecrest foreshock", "2019-07-04", 35.71, -117.50, 6.4),
    ("Ridgecrest", "2019-07-06", 35.77, -117.60, 7.1),
    ("Puerto Rico", "2020-01-07", 17.92, -66.81, 6.4),
    ("Kahramanmaras", "2023-02-06", 37.23, 37.02, 7.8),
    ("Al Haouz (Morocco)", "2023-09-08", 31.06, -8.39, 6.8),
    ("Noto", "2024-01-01", 37.49, 137.27, 7.5),
    ("Hualien", "2024-04-02", 23.82, 121.56, 7.4),
    ("Kamchatka", "2025-07-29", 52.50, 160.30, 8.8),
]
FDSN = "https://earthquake.usgs.gov/fdsnws/event/1/query"
DAY = 86400000

def get(params):
    url = FDSN + "?" + urllib.parse.urlencode({**params, "format": "geojson"})
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(url, timeout=90))
        except Exception as e:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(url)

def radius_km(m):
    return min(300.0, max(30.0, 10 ** (-3.22 + 0.69 * m)))

def gc(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(a)))

out = []
for name, date, lat, lon, mag in LIB:
    t = time.strptime(date, "%Y-%m-%d")
    t0 = int(time.mktime(t) - time.timezone) * 1000
    q = get({"starttime": time.strftime("%Y-%m-%d", time.gmtime((t0 - DAY) / 1000)), "endtime": time.strftime("%Y-%m-%d", time.gmtime((t0 + 2 * DAY) / 1000)),
             "latitude": lat, "longitude": lon, "maxradiuskm": 150, "minmagnitude": mag - 0.35, "orderby": "magnitude", "limit": 5})
    cands = [f for f in q["features"] if abs(f["properties"]["mag"] - mag) <= 0.35]
    if not cands:
        print(f"!! {name}: not found", file=sys.stderr); continue
    f = cands[0]
    p, g = f["properties"], f["geometry"]["coordinates"]
    main = {"id": "usgs:" + f["id"], "name": name, "time": p["time"], "lat": g[1], "lon": g[0], "depthKm": g[2], "mag": p["mag"], "place": p["place"]}
    R = radius_km(main["mag"])
    ev = get({"starttime": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime((main["time"] - 30 * DAY) / 1000)),
              "endtime": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime((main["time"] + 365 * DAY) / 1000)),
              "latitude": main["lat"], "longitude": main["lon"], "maxradiuskm": R, "minmagnitude": 4.5, "orderby": "time-asc", "limit": 20000})
    events = []
    for e in ev["features"]:
        if e["id"] == f["id"]: continue
        c = e["geometry"]["coordinates"]
        events.append([round((e["properties"]["time"] - main["time"]) / DAY, 5), e["properties"]["mag"], None if c[2] is None else round(c[2], 1)])
    main["radiusKm"] = round(R, 1)
    main["events"] = events
    out.append(main)
    print(f"{name}: {main['id']} M{main['mag']} {len(events)} events, radius {R:.0f} km", file=sys.stderr)
    time.sleep(0.5)

json.dump({"source": "USGS ComCat via FDSN, M4.5+ within the Wells-Coppersmith radius (30-300 km), 30 days before to 365 days after", "built": time.strftime("%Y-%m-%d"), "sequences": out},
          open(sys.argv[1], "w"), separators=(",", ":"))
