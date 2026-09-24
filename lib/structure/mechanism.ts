/**
 * Focal mechanisms from the Global CMT catalogue (Dziewonski et al. 1981;
 * Ekström et al. 2012), NDK format: five lines per event.
 * https://www.ldeo.columbia.edu/~gcmt/projects/CMT/catalog/allorder.ndk_explained
 */

export interface NodalPlane { strike: number; dip: number; rake: number }

export interface Mechanism {
  id: string;
  time: number;
  lat: number;
  lon: number;
  depthKm: number;
  mw: number;
  /** Moment tensor in (r, t, p) = (up, south, east), dyne-cm / 10^exponent. */
  m: { rr: number; tt: number; pp: number; rt: number; rp: number; tp: number };
  planes: [NodalPlane, NodalPlane];
  region: string;
}

const nums = (s: string) => (s.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

export function parseNdk(text: string): Mechanism[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: Mechanism[] = [];
  for (let i = 0; i + 4 < lines.length; i += 5) {
    const [l1, l2, l3, l4, l5] = lines.slice(i, i + 5) as [string, string, string, string, string];
    if (!l3.startsWith("CENTROID")) {
      // Out of step (a blank or truncated record): resynchronise on the next CENTROID line.
      const next = lines.findIndex((l, k) => k > i && l.startsWith("CENTROID"));
      if (next < 0) break;
      i = next - 2 - 5;
      continue;
    }
    const date = l1.slice(5, 15).trim().replace(/\//g, "-");
    const time = l1.slice(16, 26).trim();
    const hypoMs = Date.parse(`${date}T${time.length === 10 ? time : time.padStart(10, "0")}Z`);
    const c = nums(l3.slice(9));
    const t = nums(l4);
    const v = nums(l5.slice(3));
    if (c.length < 8 || t.length < 13 || v.length < 16 || !Number.isFinite(hypoMs)) continue;
    const exp = t[0]!;
    const m0 = v[9]! * 10 ** exp;
    out.push({
      id: l2.slice(0, 16).trim(),
      time: Math.round(hypoMs + c[0]! * 1000),
      lat: c[2]!, lon: c[4]!, depthKm: c[6]!,
      mw: (2 / 3) * (Math.log10(m0) - 16.1),
      m: { rr: t[1]!, tt: t[3]!, pp: t[5]!, rt: t[7]!, rp: t[9]!, tp: t[11]! },
      planes: [
        { strike: v[10]!, dip: v[11]!, rake: v[12]! },
        { strike: v[13]!, dip: v[14]!, rake: v[15]! },
      ],
      region: l1.slice(56).trim(),
    });
  }
  return out;
}

const R = Math.PI / 180;

/** Double-couple moment tensor (Aki & Richards convention, unit moment) in
 *  (r, t, p) = (up, south, east) from strike, dip and rake. */
export function tensorFromPlane(p: NodalPlane): Mechanism["m"] {
  const s = p.strike * R, d = p.dip * R, l = p.rake * R;
  // North-East-Down components (Aki & Richards 2002, Box 4.4).
  const mxx = -(Math.sin(d) * Math.cos(l) * Math.sin(2 * s) + Math.sin(2 * d) * Math.sin(l) * Math.sin(s) ** 2);
  const mxy = Math.sin(d) * Math.cos(l) * Math.cos(2 * s) + 0.5 * Math.sin(2 * d) * Math.sin(l) * Math.sin(2 * s);
  const mxz = -(Math.cos(d) * Math.cos(l) * Math.cos(s) + Math.cos(2 * d) * Math.sin(l) * Math.sin(s));
  const myy = Math.sin(d) * Math.cos(l) * Math.sin(2 * s) - Math.sin(2 * d) * Math.sin(l) * Math.cos(s) ** 2;
  const myz = -(Math.cos(d) * Math.cos(l) * Math.sin(s) - Math.cos(2 * d) * Math.sin(l) * Math.cos(s));
  const mzz = Math.sin(2 * d) * Math.sin(l);
  // x = north, y = east, z = down  ->  r = -z, t = -x, p = y
  return { rr: mzz, tt: mxx, pp: myy, rt: mxz, rp: -myz, tp: -mxy };
}

/** First-motion polarity for a ray leaving the source in direction (up, south,
 *  east): positive is compressional. */
export function polarity(m: Mechanism["m"], v: [number, number, number]): number {
  const [r, t, p] = v;
  return m.rr * r * r + m.tt * t * t + m.pp * p * p + 2 * (m.rt * r * t + m.rp * r * p + m.tp * t * p);
}

/** Lower-hemisphere equal-area (Schmidt) projection: the ray direction for a
 *  point (x east, y north) in the unit disc, or null outside it. */
export function rayForStereonet(x: number, y: number): [number, number, number] | null {
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  const takeoff = 2 * Math.asin(rho / Math.SQRT2); // from vertical down
  const az = Math.atan2(x, y);
  const h = Math.sin(takeoff);
  return [-Math.cos(takeoff), -h * Math.cos(az), h * Math.sin(az)];
}
