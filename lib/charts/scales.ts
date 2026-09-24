export interface Scale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks: number[];
  format(v: number): string;
}

function niceStep(span: number, nTicks: number): number {
  const raw = span / Math.max(1, nTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/** Screen coordinates to 0.01 px. Node and the browser disagree in the last
 *  bits of Math.log10 and Math.pow, and an SVG rendered on the server must
 *  hydrate against identical attributes on the client. */
function px(v: number): number {
  return Math.round(v * 100) / 100;
}

export function linearScale(domain: [number, number], range: [number, number], nTicks = 5): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const f = ((v: number) => px(r0 + ((v - d0) / span) * (r1 - r0))) as Scale;
  const step = niceStep(Math.abs(d1 - d0) || 1, nTicks);
  const ticks: number[] = [];
  for (let t = Math.ceil(Math.min(d0, d1) / step) * step; t <= Math.max(d0, d1) + 1e-9; t += step) {
    ticks.push(Number(t.toFixed(10)));
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  f.domain = domain;
  f.range = range;
  f.ticks = ticks;
  f.format = (v) => v.toFixed(decimals);
  return f;
}

export function logScale(domain: [number, number], range: [number, number]): Scale {
  const floor = 1e-12;
  const l0 = Math.log10(Math.max(floor, domain[0]));
  const l1 = Math.log10(Math.max(floor, domain[1]));
  const span = l1 - l0 || 1;
  const [r0, r1] = range;
  const f = ((v: number) => px(r0 + ((Math.log10(Math.max(floor, v)) - l0) / span) * (r1 - r0))) as Scale;
  const ticks: number[] = [];
  for (let e = Math.ceil(l0 - 1e-9); e <= Math.floor(l1 + 1e-9); e++) ticks.push(10 ** e);
  f.domain = domain;
  f.range = range;
  f.ticks = ticks;
  f.format = (v) => {
    if (v >= 1000) return v.toExponential(0).replace("e+", "e");
    if (v >= 1) return String(Math.round(v));
    return String(Number(v.toPrecision(1)));
  };
  return f;
}

/** Bin edges evenly spaced in log time: an Omori decay is a straight line on
 *  log-log axes only if the rate is measured in log-spaced bins. */
export function logBins(minDays: number, maxDays: number, perDecade = 4): number[] {
  const ratio = 10 ** (1 / perDecade);
  const edges = [minDays];
  while (edges.at(-1)! < maxDays) edges.push(edges.at(-1)! * ratio);
  return edges;
}
