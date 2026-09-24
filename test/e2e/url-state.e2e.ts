import { expect, test } from "@playwright/test";

test("filter state round-trips through the URL", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-testid=filter-panel]");

  await page.click("[data-testid=range-day]");
  await page.waitForFunction(() => window.location.search.includes("from="), null, {
    polling: 200,
    timeout: 30_000,
  });
  await page.click("[data-testid=view-table]");
  await page.waitForFunction(() => window.location.search.includes("view=table"), null, {
    polling: 200,
    timeout: 30_000,
  });

  const shared = page.url();
  const reloaded = await page.context().newPage();
  await reloaded.goto(shared);
  await expect(reloaded.locator("[data-testid=event-table]")).toBeVisible({ timeout: 60_000 });
  // The restored URL must be the same state, not merely a page that loads.
  expect(new URL(reloaded.url()).searchParams.get("view")).toBe("table");
  await reloaded.close();
});

test("a hostile query string does not produce a blank screen or a frozen clock", async ({
  page,
}) => {
  await page.goto("/?t=NaN&rate=-5&view=<script>&bbox=a,b,c,d&from=999999999999999&to=-1");
  await expect(page.locator("[data-testid=time-readout]")).toBeVisible({ timeout: 30_000 });
  const readout = (await page.locator("[data-testid=time-readout]").textContent()) ?? "";
  expect(readout).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  expect(readout).not.toMatch(/NaN|Invalid/);
  // An unknown view falls back to the globe, never to nothing.
  await expect(page.locator("[data-testid=globe-canvas]")).toBeVisible();
});

test("playback advances t and pausing stops it", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-testid=play-toggle]");
  const readout = page.locator("[data-testid=time-readout]");
  const before = await readout.textContent();

  await page.selectOption("[data-testid=rate-select]", "86400");
  await page.click("[data-testid=play-toggle]");
  await page.waitForTimeout(1200);
  const during = await readout.textContent();
  expect(during).not.toBe(before);

  await page.click("[data-testid=play-toggle]");
  const afterPause = await readout.textContent();
  await page.waitForTimeout(800);
  expect(await readout.textContent()).toBe(afterPause);
});
