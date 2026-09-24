/**
 * Two numerical tools, written out rather than imported: every number on a
 * sequence page should be traceable to arithmetic a reader can check.
 */

/** Nelder-Mead simplex maximisation. Small, derivative-free, robust enough for
 *  a smooth two- or three-parameter likelihood. */
export function nelderMeadMax(
  f: (x: number[]) => number,
  start: number[],
  step: number[],
  opts: { maxIter?: number; tol?: number } = {},
): { x: number[]; value: number } {
  const maxIter = opts.maxIter ?? 400;
  const tol = opts.tol ?? 1e-10;
  const dim = start.length;
  const neg = (x: number[]) => {
    const v = f(x);
    return Number.isFinite(v) ? -v : Infinity;
  };

  let simplex: { x: number[]; v: number }[] = [{ x: start, v: neg(start) }];
  for (let i = 0; i < dim; i++) {
    const x = [...start];
    x[i] = x[i]! + step[i]!;
    simplex.push({ x, v: neg(x) });
  }

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.v - b.v);
    const best = simplex[0]!;
    const worst = simplex[dim]!;
    if (Math.abs(worst.v - best.v) < tol * (Math.abs(best.v) + tol)) break;

    const centroid = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) centroid[j]! += simplex[i]!.x[j]! / dim;
    const along = (t: number) => centroid.map((c, j) => c + t * (worst.x[j]! - c));

    const reflected = along(-1);
    const vr = neg(reflected);
    if (vr < best.v) {
      const expanded = along(-2);
      const ve = neg(expanded);
      simplex[dim] = ve < vr ? { x: expanded, v: ve } : { x: reflected, v: vr };
    } else if (vr < simplex[dim - 1]!.v) {
      simplex[dim] = { x: reflected, v: vr };
    } else {
      const contracted = along(0.5);
      const vc = neg(contracted);
      if (vc < worst.v) simplex[dim] = { x: contracted, v: vc };
      else {
        simplex = simplex.map((s, i) =>
          i === 0 ? s : { x: s.x.map((xj, j) => best.x[j]! + 0.5 * (xj - best.x[j]!)), v: 0 },
        );
        for (let i = 1; i <= dim; i++) simplex[i]!.v = neg(simplex[i]!.x);
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  return { x: simplex[0]!.x, value: -simplex[0]!.v };
}

/** Central-difference Hessian. */
export function numericalHessian(f: (x: number[]) => number, x: number[], h: number[]): number[][] {
  const n = x.length;
  const H: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const at = (di: number, dj: number, i: number, j: number) => {
    const y = [...x];
    y[i] = y[i]! + di * h[i]!;
    y[j] = y[j]! + dj * h[j]!;
    return f(y);
  };
  const f0 = f(x);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let v: number;
      if (i === j) {
        const y1 = [...x];
        const y2 = [...x];
        y1[i] = y1[i]! + h[i]!;
        y2[i] = y2[i]! - h[i]!;
        v = (f(y1) - 2 * f0 + f(y2)) / (h[i]! * h[i]!);
      } else {
        v = (at(1, 1, i, j) - at(1, -1, i, j) - at(-1, 1, i, j) + at(-1, -1, i, j)) / (4 * h[i]! * h[j]!);
      }
      H[i]![j] = v;
      H[j]![i] = v;
    }
  }
  return H;
}

/** Gauss-Jordan inverse; null when singular. */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-14) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const d = a[col]![col]!;
    for (let j = 0; j < 2 * n; j++) a[col]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= factor * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}
