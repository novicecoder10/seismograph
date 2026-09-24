import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __globeTest?: {
      focusOn(index: number): boolean;
      screenPositionOf(index: number): { x: number; y: number } | null;
    };
    __globeStats?: {
      frames: number;
      renders: number;
      picks: number;
      lastFrameMs: number;
      lastPickMs: number;
      pointCount: number;
      eventCount: number;
    };
  }
}

const waitForGlobe = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(() => (window.__globeStats?.renders ?? 0) > 0, null, {
    timeout: 90_000,
    polling: 250,
  });
};

test("the globe renders on demand, not continuously", async ({ page }) => {
  // This is the Phase 0 finding made into a regression test: a continuous rAF
  // loop makes GPU picking cost seconds, so the absence of the loop is a
  // load-bearing property, not an optimisation.
  await page.goto("/");
  await waitForGlobe(page);
  // Let the initial data arrival and resize settle: those are legitimate
  // changes, and sampling during them measures the wrong thing.
  await page.waitForFunction(() => (window.__globeStats?.eventCount ?? 0) > 0, null, {
    timeout: 90_000,
    polling: 250,
  });
  await page.waitForTimeout(2000);
  const first = await page.evaluate(() => window.__globeStats!.renders);
  await page.waitForTimeout(2000);
  const second = await page.evaluate(() => window.__globeStats!.renders);
  expect(second).toBe(first);
});

test("a burst of pointer moves in one task costs a single pick", async ({ page }) => {
  // Coalescing is what keeps picking off the critical path: the renderer keeps
  // only the last pointer position and services it once per frame. Playwright's
  // awaited mouse.move yields a frame between each call, so the burst has to be
  // dispatched synchronously to exercise the property at all.
  await page.goto("/");
  await waitForGlobe(page);
  const before = await page.evaluate(() => window.__globeStats!.picks);

  await page.evaluate(() => {
    const canvas = document.querySelector("[data-testid=globe-canvas]")!;
    for (let i = 0; i < 60; i++) {
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 500 + i * 4,
          clientY: 320 + (i % 7) * 3,
        }),
      );
    }
  });
  await page.waitForTimeout(600);

  const stats = await page.evaluate(() => window.__globeStats!);
  const picks = stats.picks - before;
  console.log(`60 pointermove events in one task -> ${picks} pick(s)`);
  expect(picks).toBeGreaterThan(0);
  expect(picks).toBeLessThanOrEqual(2);
});

test("picks never outnumber frames", async ({ page }) => {
  // The invariant behind the Phase 0 fix: a pick is serviced inside a frame, so
  // the queue it drains is at most one frame deep.
  await page.goto("/");
  await waitForGlobe(page);
  for (let i = 0; i < 20; i++) await page.mouse.move(480 + i * 9, 300 + i * 6);
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => window.__globeStats!);
  expect(stats.picks).toBeLessThanOrEqual(stats.frames);
});

test("picking stays fast at the live catalogue size", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  // Under a parallel run the feed can arrive after the globe; measuring an empty
  // globe would pass without testing anything.
  await expect
    .poll(() => page.evaluate(() => window.__globeStats?.pointCount ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(480 + i * 18, 300 + i * 9);
    await page.waitForTimeout(120);
    times.push(await page.evaluate(() => window.__globeStats!.lastPickMs));
  }
  const nonZero = times.filter((v) => v > 0);
  const median = nonZero.sort((a, b) => a - b)[Math.floor(nonZero.length / 2)] ?? 0;
  const stats = await page.evaluate(() => window.__globeStats!);
  console.log(
    `pick median ${median.toFixed(2)}ms over ${stats.pointCount} points ` +
      `(frame ${stats.lastFrameMs.toFixed(2)}ms)`,
  );
  // Reported, not asserted against a threshold: hardware varies. What IS
  // asserted is that picking does not blow up the frame time, which is the
  // failure mode Phase 0 found.
  expect(stats.lastFrameMs).toBeLessThan(1000);
});

test("hovering a hypocenter shows its magnitude, depth and place", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await page.waitForFunction(() => (window.__globeStats?.eventCount ?? 0) > 0, null, {
    timeout: 90_000,
    polling: 300,
  });

  // Centre the camera on a known event and hover its projected position, rather
  // than probing a grid of pixels and hoping: the catalogue is sparse and which
  // pixel holds an event depends on today's seismicity.
  const target = await page.evaluate(() => {
    window.__globeTest!.focusOn(0);
    return window.__globeTest!.screenPositionOf(0);
  });
  expect(target, "event 0 did not project onto the canvas").not.toBeNull();

  const box = (await page.locator("[data-testid=globe-canvas]").boundingBox())!;
  const tooltip = page.locator("[data-testid=hover-tooltip]");
  let found = false;
  // A small spiral around the projected point absorbs sub-pixel and point-size
  // differences without degenerating into a blind search.
  for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3]]) {
    await page.mouse.move(box.x + target!.x + dx!, box.y + target!.y + dy!);
    await page.waitForTimeout(120);
    found = await tooltip.isVisible();
    if (found) break;
  }
  expect(found, "no tooltip at the projected position of event 0").toBe(true);

  const text = (await tooltip.textContent()) ?? "";
  expect(text).toMatch(/M\s\d/);
  expect(text).toMatch(/km|depth unknown/);
  expect(text).toMatch(/UTC/);
});

test("a browser without WebGL shows the fallback and the table still works", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  // Break WebGL before any application code runs.
  await ctx.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
      if (id === "webgl" || id === "webgl2") return null;
      // 2D must keep working: the table and any canvas chrome depend on it.
      return (original as never as (i: string) => unknown).call(this, id);
    } as never;
  });
  const page = await ctx.newPage();
  await page.goto("/");
  const fallback = page.locator("[data-testid=webgl-fallback]");
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  await expect(fallback).toContainText(/WebGL/i);

  await page.click("[data-testid=view-table]");
  await expect(page.locator("[data-testid=event-table]")).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("[data-testid=event-row]").count()).toBeGreaterThan(0);
  await ctx.close();
});
