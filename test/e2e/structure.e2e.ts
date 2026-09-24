import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 240_000 });
const INDONESIA = "usgs:us6000tkyk"; // M6.9, 175 km deep, beneath Sumatra

test("focal mechanisms load onto the globe from Global CMT", async ({ page }) => {
  await page.goto("/?range=30d");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __globeStats?: { pointCount: number } }).__globeStats?.pointCount ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.getByTestId("range-month").click();
  await page.getByTestId("layer-mechanisms").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __globeStats?: { mechanismCount: number } }).__globeStats?.mechanismCount ?? 0), { timeout: 120_000 }).toBeGreaterThan(5);
  await expect(page.getByTestId("layer-mechanisms")).toHaveAttribute("aria-pressed", "true");
});

test("the mechanisms route returns parsed solutions", async ({ request }) => {
  const to = Date.now(), from = to - 30 * 86_400_000;
  const res = await request.get(`/api/mechanisms?from=${from}&to=${to}`, { timeout: 120_000 });
  expect(res.ok()).toBe(true);
  const j = await res.json();
  expect(j.mechanisms.length).toBeGreaterThan(0);
  const m = j.mechanisms[0];
  expect(m.planes).toHaveLength(2);
  expect(m.mw).toBeGreaterThan(4);
  expect((await request.get("/api/mechanisms?from=5&to=1")).status()).toBe(400);
});

test("a cross-section cuts the slab down-dip and places the event on it", async ({ page }) => {
  await page.goto(`/section/${encodeURIComponent(INDONESIA)}`, { timeout: 200_000 });
  await expect(page.getByTestId("chart-section").locator("svg")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("main")).toContainText("down the dip of the Sumatra-Java slab");
  await expect(page.locator("main")).toContainText(/\d+ earthquakes\./);
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|Infinity/);
});

test("the event page shows a beachball and links to its cross-section", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(INDONESIA)}`);
  await expect(page.getByTestId("section-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('svg[aria-label^="Focal mechanism"]').first()).toBeVisible();
});
