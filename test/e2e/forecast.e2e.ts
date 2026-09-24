import { expect, test } from "@playwright/test";

const RIDGECREST = "usgs:ci38457511";
const SMALL = "usgs:us7000tj1b";

test.describe.configure({ timeout: 240_000 });

/** Wait for the page to settle on a forecast or an honest error, and fail with
 *  that error's text rather than a bare timeout. */
async function settled(page: import("@playwright/test").Page) {
  const outcome = page.locator('[data-testid="forecast-source"], [data-testid="forecast-refused"], [data-testid="forecast-error"]');
  await expect(outcome.first()).toBeVisible({ timeout: 200_000 });
  const error = page.getByTestId("forecast-error");
  if (await error.count()) throw new Error(`page reported: ${await error.textContent()}`);
}

test("where USGS published a forecast, it is shown as theirs and reproduced", async ({ page }) => {
  await page.goto(`/forecast/${encodeURIComponent(RIDGECREST)}`, { timeout: 200_000 });
  await settled(page);
  await expect(page.getByTestId("forecast-source")).toContainText("Published by USGS");
  const repro = (await page.getByTestId("reproduction").textContent()) ?? "";
  const m = repro.match(/within (\d+\.\d+)%/);
  expect(m, repro).not.toBeNull();
  expect(Number(m![1])).toBeLessThan(0.5);
  await expect(page.getByTestId("forecast-table")).toContainText(/%/);
});

test("outside USGS coverage, a forecast is computed with ranges and its model", async ({ page, request }) => {
  // "Recent" cannot be a permanent fixture: pick, at test time, a recent M5.5+
  // that USGS has not forecast.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const feed = await (await request.get(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=5.5&orderby=time&limit=40`)).json();
  const pick = (feed.features as { id: string; properties: { types: string } }[]).find((f) => !f.properties.types.includes(",oaf,"));
  test.skip(!pick, "no recent M5.5+ without a USGS forecast");
  await page.goto(`/forecast/${encodeURIComponent(`usgs:${pick!.id}`)}`, { timeout: 200_000 });
  await settled(page);
  await expect(page.getByTestId("forecast-source")).toContainText("Computed here");
  const table = (await page.getByTestId("forecast-table").textContent()) ?? "";
  expect(table).toMatch(/%/);
  expect(table).toMatch(/events/);
  await expect(page.getByTestId("forecast-larger")).toContainText("typical sequence");
  await expect(page.getByTestId("forecast-model")).toContainText(/a = -?\d\.\d\d ± \d\.\d\d/);
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|Infinity/);
});

test("a small event refuses with a reason", async ({ page }) => {
  await page.goto(`/forecast/${encodeURIComponent(SMALL)}`, { timeout: 200_000 });
  await settled(page);
  await expect(page.getByTestId("forecast-refused")).toContainText(/M 5\.0 and above/);
});

test("forecasts use no alert-style UI and make no prediction", async ({ page }) => {
  let permissionAsked = false;
  await page.exposeFunction("__permissionAsked", () => { permissionAsked = true; });
  await page.addInitScript(() => {
    const w = window as unknown as { Notification?: { requestPermission: () => Promise<string> }; __permissionAsked: () => void };
    if (w.Notification) w.Notification.requestPermission = async () => { w.__permissionAsked(); return "denied"; };
  });
  await page.goto(`/forecast/${encodeURIComponent(RIDGECREST)}`, { timeout: 200_000 });
  await expect(page.getByTestId("forecast-table")).toBeVisible({ timeout: 200_000 });
  // Scoped to the page: Next's own route announcer (a shadow-DOM aria-live
  // region for client navigation) is framework chrome, not forecast UI.
  expect(await page.locator('main [role="alert"], main [aria-live="assertive"]').count()).toBe(0);
  expect(permissionAsked).toBe(false);
  expect(((await page.locator("main").textContent()) ?? "").toLowerCase()).not.toContain("predict");
});

test("the event page links to its forecast", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(RIDGECREST)}`);
  const link = page.getByTestId("forecast-link");
  await expect(link).toBeVisible({ timeout: 60_000 });
  expect(await link.getAttribute("href")).toBe(`/forecast/${encodeURIComponent(RIDGECREST)}`);
});
