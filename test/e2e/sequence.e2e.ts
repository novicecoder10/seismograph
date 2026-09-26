import { expect, test } from "@playwright/test";

// Ridgecrest 2019-07-06 M7.1: a permanent, well-studied sequence whose b-value
// (~0.8-1.0) and Omori p (~1.0-1.2) are published, so the page is checked
// against the literature rather than against itself.
const RIDGECREST = "usgs:ci38457511";
// An offshore M4.5 with almost nothing around it in ComCat.
const ISOLATED = "usgs:us7000tj1b";

test.describe.configure({ timeout: 180_000 });

test("the Ridgecrest sequence matches the published statistics, with uncertainties", async ({ page }) => {
  await page.goto(`/sequence/${encodeURIComponent(RIDGECREST)}`, { timeout: 150_000 });
  await expect(page.locator("h2")).toContainText(/M\s7\.1/, { timeout: 150_000 });
  await expect(page.getByTestId("classification")).toContainText(/mainshock-aftershock/i);
  await expect(page.getByTestId("sequence-plain")).toContainText(/the catalogue records \d+ earthquakes/);
  await expect(page.getByTestId("sequence-prose-source")).toContainText("template");
  await expect(page.getByTestId("ask-input")).toBeVisible();

  const b = (await page.getByTestId("stat-b-aki-utsu").textContent()) ?? "";
  const bm = b.match(/b = (\d\.\d\d) ± (\d\.\d\d)/);
  expect(bm).not.toBeNull();
  expect(Number(bm![1])).toBeGreaterThanOrEqual(0.7);
  expect(Number(bm![1])).toBeLessThanOrEqual(1.2);

  const p = (await page.getByTestId("stat-omori-p").textContent()) ?? "";
  const pm = p.match(/p = (\d\.\d\d) ± (\d\.\d\d)/);
  expect(pm).not.toBeNull();
  expect(Number(pm![1])).toBeGreaterThanOrEqual(0.8);
  expect(Number(pm![1])).toBeLessThanOrEqual(1.4);

  for (const id of ["chart-fmd", "chart-decay", "chart-ogata", "chart-mc-time"]) {
    await expect(page.getByTestId(id).locator("svg").first()).toBeVisible();
  }
  const d = (await page.getByTestId("declustering").textContent()) ?? "";
  expect(d).toContain("Gardner-Knopoff");
  expect(d).toContain("Zaliapin");
});

test("an isolated event refuses its statistics with reasons, never NaN", async ({ page }) => {
  await page.goto(`/sequence/${encodeURIComponent(ISOLATED)}`, { timeout: 150_000 });
  await expect(page.getByTestId("classification")).toContainText(/isolated/i, { timeout: 150_000 });
  await expect(page.getByTestId("stat-b-aki-utsu")).toContainText(/Only \d+ event/);
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|Infinity/);
});

test("the event page links to its sequence", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(RIDGECREST)}`);
  const link = page.getByTestId("sequence-link");
  await expect(link).toBeVisible({ timeout: 60_000 });
  expect(await link.getAttribute("href")).toBe(`/sequence/${encodeURIComponent(RIDGECREST)}`);
});

test("the sequence page makes no forward-looking claim", async ({ page }) => {
  await page.goto(`/sequence/${encodeURIComponent(RIDGECREST)}`, { timeout: 150_000 });
  await expect(page.locator("h2")).toBeVisible({ timeout: 150_000 });
  const body = ((await page.locator("main").textContent()) ?? "").toLowerCase();
  for (const banned of ["will occur", "forecast", "predict", "expected in the next"]) {
    expect(body).not.toContain(banned);
  }
});
