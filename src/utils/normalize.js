// Common schema:
// { id, magnitude, place, time (ms epoch), lat, lon, depth (km), source }

export function normalizeUSGS(geojson) {
  if (!geojson?.features) return [];
  return geojson.features
    .map((f) => {
      const p = f.properties || {};
      let lon = null, lat = null, depth = null;
      if (f.geometry && f.geometry.coordinates) {
        [lon, lat, depth] = f.geometry.coordinates;
      }
      const magnitude = typeof p.mag === 'number' ? p.mag : (p.mag !== undefined ? parseFloat(p.mag) : null);
      const time = typeof p.time === 'number' ? p.time : (p.time !== undefined ? parseFloat(p.time) : null);
      return {
        id: `usgs-${f.id ?? p.unid ?? p.eventid ?? `${lat}-${lon}-${time}`}`,
        magnitude,
        place: p.place || 'Unknown location',
        time,
        lat,
        lon,
        depth,
        source: 'USGS',
      };
    })
    .filter(validQuake);
}

export function normalizeEMSC(geojson) {
  if (!geojson?.features) return [];
  return geojson.features
    .map((f) => {
      const p = f.properties || {};
      let lon = null, lat = null, depth = null;
      if (f.geometry && f.geometry.coordinates) {
        [lon, lat, depth] = f.geometry.coordinates;
      }
      if (lat == null && p.location) {
        lat = typeof p.location.lat === 'number' ? p.location.lat : parseFloat(p.location.lat);
        lon = typeof p.location.lon === 'number' ? p.location.lon : parseFloat(p.location.lon);
      }
      if (depth == null && p.depth !== undefined) {
        depth = typeof p.depth === 'number' ? p.depth : parseFloat(p.depth.depth || p.depth);
      }

      let magnitude = null;
      if (p.magnitude && typeof p.magnitude === 'object') {
        magnitude = typeof p.magnitude.mag === 'number' ? p.magnitude.mag : parseFloat(p.magnitude.mag);
      } else if (p.mag !== undefined) {
        magnitude = typeof p.mag === 'number' ? p.mag : parseFloat(p.mag);
      }

      let time = null;
      if (p.time !== undefined) {
        if (typeof p.time === 'number') {
          time = p.time < 1e11 ? p.time * 1000 : p.time;
        } else if (typeof p.time === 'string') {
          time = Date.parse(p.time);
        } else if (typeof p.time === 'object' && p.time.time !== undefined) {
          const tVal = typeof p.time.time === 'number' ? p.time.time : parseFloat(p.time.time);
          time = tVal < 1e11 ? tVal * 1000 : tVal;
        }
      }
      if ((time == null || isNaN(time)) && p.lastupdate) {
        time = Date.parse(p.lastupdate);
      }

      let place = p.flynn_region || p.place || [p.region].filter(Boolean).join(', ') || 'Unknown location';
      if (typeof place === 'object') {
        place = place.region || place.name || 'Unknown location';
      }

      return {
        id: `emsc-${f.id ?? p.unid ?? p.eventid ?? `${lat}-${lon}-${time}`}`,
        magnitude,
        place,
        time,
        lat,
        lon,
        depth,
        source: 'EMSC',
      };
    })
    .filter(validQuake);
}

function validQuake(q) {
  return (
    typeof q.magnitude === 'number' &&
    !Number.isNaN(q.magnitude) &&
    typeof q.lat === 'number' &&
    !Number.isNaN(q.lat) &&
    typeof q.lon === 'number' &&
    !Number.isNaN(q.lon) &&
    q.time != null &&
    !Number.isNaN(q.time)
  );
}
