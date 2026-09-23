import { expect, test } from "@playwright/test";

// Frame rate and pick cost are reported, never asserted: both are hardware
// dependent. Each line prints the renderer string, so a run that silently fell
// back to SwiftShader — whose software fill rate makes its numbers meaningless —
// is identifiable after the fact.
//
// The headline finding: display scales to 1M points at 60fps, but a pick issued
// from pointermove against a continuously rendering loop costs SECONDS, because
// the readback drains a deep frame queue. With the loop paused the same pick
// costs under a millisecond. See FINDINGS.md.
const POINT_COUNTS = [10_000, 100_000, 1_000_000];

for (const points of POINT_COUNTS) {
  test(`globe renders ${points} hypocenters at true depth`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:5181/?points=${points}`);
    await page.waitForFunction(() => window.__spike?.fps > 0, null, {
      timeout: 120_000,
      polling: 300,
    });

    const s = await page.evaluate(() => window.__spike);
    console.log(
      `globe display: points=${s.pointCount} ${s.frameMs.toFixed(1)}ms/frame ` +
        `(${s.fps.toFixed(2)} fps) renderer=${s.renderer}`,
    );
    expect(errors, errors.join("\n")).toHaveLength(0);
    expect(s.webglOk).toBe(true);
    expect(s.pointCount).toBe(points);
    expect(s.fps).toBeGreaterThan(0);
  });

  test(`globe picks a hypocenter by GPU ID at ${points} points`, async ({ page }) => {
    // loop=off isolates the pick pass from render-loop contention. This is the
    // configuration a production implementation must approximate: render on
    // demand, or coalesce the pick into the frame, never read back against a
    // saturated queue.
    await page.goto(`http://localhost:5181/?points=${points}&pick=sync&loop=off`);
    await page.waitForFunction(() => window.__spike?.fps > 0, null, {
      timeout: 120_000,
      polling: 300,
    });

    const times: number[] = [];
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(600 + i * 12, 340 + i * 7);
      await page.waitForFunction(() => window.__spike.pickMs > 0, null, { polling: 50 });
      const r = await page.evaluate(() => {
        const v = { ms: window.__spike.pickMs, id: window.__spike.pickedId };
        window.__spike.pickMs = 0;
        return v;
      });
      times.push(r.ms);
      if (r.id !== null) hits++;
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.log(
      `globe pick: ${points} points, median ${median.toFixed(2)}ms ` +
        `min ${times[0]!.toFixed(2)} max ${times.at(-1)!.toFixed(2)} hits=${hits}/8`,
    );
    // The IDs must round-trip: a hit means the ID-colour encoding decoded to a
    // real index, which is the thing being verified.
    expect(hits).toBeGreaterThan(0);
  });
}
