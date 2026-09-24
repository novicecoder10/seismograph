/** Formatting shared by the tooltip, the table and the event page. Seismic times
 *  are always shown in UTC with an explicit label: a seismic timestamp rendered
 *  in local time without saying so is a defect, not a convenience. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

export function formatMagnitude(magnitude: number, magType: string | null): string {
  // Magnitude scales are not interchangeable, so the type is part of the value.
  const m = `M ${magnitude.toFixed(1)}`;
  return magType === null ? m : `${m} ${magType}`;
}

export function formatDepth(depthKm: number | null): string {
  // An unknown depth is not zero. Rendering it as "0 km" would assert something
  // the agency did not.
  if (depthKm === null) return "depth unknown";
  return `${depthKm.toFixed(1)} km`;
}

export function formatAgo(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return "in the future";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  return `${day} d ago`;
}
