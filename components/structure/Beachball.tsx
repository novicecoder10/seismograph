import type { NodalPlane } from "@/lib/structure/mechanism";
import { polarity, rayForStereonet, tensorFromPlane } from "@/lib/structure/mechanism";

const N = 48;

/**
 * Lower-hemisphere equal-area beachball for a double couple, rendered as runs of
 * compressional cells per row: an SVG of a few hundred rectangles, drawn on the
 * server, with no canvas and no client JavaScript.
 */
export function Beachball({ plane, size = 88, label }: { plane: NodalPlane; size?: number; label: string }) {
  const m = tensorFromPlane(plane);
  const cell = 2 / N;
  const rects: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j < N; j++) {
    const y = 1 - (j + 0.5) * cell;
    let start: number | null = null;
    for (let i = 0; i <= N; i++) {
      const x = -1 + (i + 0.5) * cell;
      const v = i < N ? rayForStereonet(x, y) : null;
      const comp = v !== null && polarity(m, v) > 0;
      if (comp && start === null) start = i;
      if (!comp && start !== null) {
        rects.push({ x: start, y: j, w: i - start });
        start = null;
      }
    }
  }
  const s = size / N;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ display: "block" }}>
      <defs>
        <clipPath id={`bb-${plane.strike}-${plane.dip}-${plane.rake}`}>
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} />
        </clipPath>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="#e7ebee" />
      <g clipPath={`url(#bb-${plane.strike}-${plane.dip}-${plane.rake})`} fill="#d95926">
        {rects.map((r, k) => (
          <rect key={k} x={r.x * s} y={r.y * s} width={r.w * s + 0.4} height={s + 0.4} />
        ))}
      </g>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="none" stroke="#12161a" strokeWidth={1.5} />
    </svg>
  );
}
