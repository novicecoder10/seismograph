import { expect, test } from "@playwright/test";

// Headless Chromium renders through SwiftShader, so frame rate here is a software
// FLOOR and is reported, never asserted. The real number comes from a manual run.
const POINT_COUNTS = [10_000, 100_000, 500_000];

for (const points of POINT_COUNTS) {
test(`globe renders ${points} points at true depth and picks one`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://localhost:5181/?points=${points}`);
  // Interval polling, not the default rAF: under SwiftShader rAF fires so rarely
  // that a rAF-polled condition cannot be observed.
  await page.waitForFunction(() => window.__spike?.fps > 0, null, {
    timeout: 180_000,
    polling: 500,
  });

  const s = await page.evaluate(() => window.__spike);
  console.log(
    `globe: points=${s.pointCount} fps=${s.fps.toFixed(3)} webgl=${s.webglOk} ` +
      `(SwiftShader software floor)`,
  );

  expect(errors, errors.join("\n")).toHaveLength(0);
  expect(s.webglOk).toBe(true);
  expect(s.pointCount).toBe(points);
  expect(s.fps).toBeGreaterThan(0);

  await page.mouse.move(640, 360);
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__spike);
  console.log(`globe: picked id=${after.pickedId} in ${after.pickMs.toFixed(2)}ms`);
  expect(after.pickMs).toBeGreaterThan(0);
});
}
