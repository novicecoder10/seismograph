import { expect, test } from "@playwright/test";

test("waveform parses, renders and builds an audio buffer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:5182/");
  await page.waitForFunction(
    () => window.__wave?.sampleCount > 0 || window.__wave?.error,
    null,
    { timeout: 60_000, polling: 500 },
  );
  const s = await page.evaluate(() => window.__wave);
  expect(s.error, String(s.error)).toBeNull();
  console.log(
    `waveform: traces=${s.traceCount} samples=${s.sampleCount} src=${s.sourceRate}Hz ` +
      `out=${s.sampleRate}Hz speedUp=${s.speedUp.toFixed(0)}x dur=${s.durationS.toFixed(2)}s`,
  );
  expect(s.traceCount).toBeGreaterThan(0);
  expect(s.sourceRate).toBe(100);
  expect(s.speedUp).toBeGreaterThan(100);

  await page.click("#play");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__wave.played)).toBe(true);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("switching to the 40 Hz broadband fixture reports its own speed-up", async ({ page }) => {
  await page.goto("http://localhost:5182/");
  await page.waitForFunction(() => window.__wave?.sampleCount > 0, null, { polling: 500 });
  await page.selectOption("#pick", "iu-anmo-bhz.mseed");
  await page.waitForFunction(() => window.__wave?.sourceRate === 40, null, { polling: 500 });
  const s = await page.evaluate(() => window.__wave);
  console.log(`waveform: 40Hz fixture speedUp=${s.speedUp.toFixed(0)}x`);
  expect(s.speedUp).toBeCloseTo(1102.5, 0);
});
