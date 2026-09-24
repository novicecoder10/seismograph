import { expect, test } from "@playwright/test";

const RIDGECREST = "usgs:ci38457511";
test.describe.configure({ timeout: 240_000 });

test("the waves page draws a record section from real stations and a globe that follows the clock", async ({ page }) => {
  await page.goto(`/waves/${encodeURIComponent(RIDGECREST)}`, { timeout: 200_000 });
  const section = page.getByTestId("record-section");
  await expect(section).toBeVisible({ timeout: 120_000 });

  // Real data arrives from at least a few stations (EarthScope GSN, Raspberry Shake).
  await expect.poll(async () => {
    const t = (await page.locator("text=/\\d+ of \\d+ stations with data/").textContent().catch(() => "")) ?? "";
    return Number(t.match(/(\d+) of/)?.[1] ?? 0);
  }, { timeout: 150_000 }).toBeGreaterThanOrEqual(5);

  // Hovering the record section scrubs the shared clock: linked brushing.
  const box = (await section.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.getByTestId("waves-clock")).toContainText(/^(9|10|11) min/);

  const stations = await page.evaluate(() => (window as unknown as { __waves: { stations(): { count: number; brightness: number[] } } }).__waves.stations());
  expect(stations.count).toBeGreaterThan(10);
  expect(stations.brightness.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);

  // Play advances the clock.
  await page.getByTestId("waves-play").click();
  const before = await page.getByTestId("waves-clock").textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId("waves-clock").textContent()).not.toBe(before);
  await page.getByTestId("waves-play").click();

  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|Infinity/);
  expect(body).toContain("instrument response is not removed");
});

test("the event page links to the waves page", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(RIDGECREST)}`);
  const link = page.getByTestId("waves-link");
  await expect(link).toBeVisible({ timeout: 60_000 });
  expect(await link.getAttribute("href")).toBe(`/waves/${encodeURIComponent(RIDGECREST)}`);
});
