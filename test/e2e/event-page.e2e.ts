import { expect, test } from "@playwright/test";

// us7000tiqc is the M6.4 Papua New Guinea event whose full product tree is the
// rich fixture. Using a real, permanent event id keeps the test honest about
// what the page does with live data.
const RICH = "usgs:us7000tiqc";

test("an event page renders the product tree it actually has", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(RICH)}`);
  await expect(page.locator("h2")).toContainText(/M\s6\.\d/, { timeout: 60_000 });

  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).toContain("Contributing solutions");
  expect(body).toMatch(/ShakeMap|Did You Feel It|PAGER/);
  // Every displayed statistic carries its uncertainty (spec §10.11).
  expect(body).toMatch(/±/);
  expect(body).toMatch(/UTC/);
});

test("an event page omits absent products rather than rendering empty panels", async ({
  page,
}) => {
  // A small event with only origin and phase-data products.
  await page.goto("/event/usgs%3Aus7000tj1b");
  await expect(page.locator("h2")).toBeVisible({ timeout: 60_000 });
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).toContain("Contributing solutions");
  expect(body).not.toContain("Did You Feel It?");
  expect(body).not.toContain("PAGER exposure");
});

test("an unknown event id explains itself instead of crashing", async ({ page }) => {
  await page.goto("/event/usgs%3Anot-a-real-event");
  await expect(page.locator("main")).toContainText(/could be retrieved/i, { timeout: 60_000 });
});

test("no page in this build makes a forward-looking claim", async ({ page }) => {
  // Spec §2.4 and §10.12: Phase 1 ships no forecast and no prediction.
  for (const url of ["/", `/event/${encodeURIComponent(RICH)}`]) {
    await page.goto(url);
    await page.waitForTimeout(2500);
    const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    for (const banned of ["forecast for", "will occur", "probability of a", "predicted"]) {
      expect(body, `"${banned}" appeared on ${url}`).not.toContain(banned);
    }
  }
});
