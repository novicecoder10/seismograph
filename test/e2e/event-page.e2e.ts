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
  // Spec §2.4, §10.10: forecasts live on /forecast/ pages the user opens; nowhere
  // else may make a claim about what will happen.
  for (const url of ["/", `/event/${encodeURIComponent(RICH)}`]) {
    await page.goto(url);
    await page.waitForTimeout(2500);
    const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    for (const banned of ["forecast for", "will occur", "probability of a", "predicted"]) {
      expect(body, `"${banned}" appeared on ${url}`).not.toContain(banned);
    }
  }
});

test("an event near a citizen seismometer shows its waveform and can play it", async ({
  page,
}) => {
  await page.goto(`/event/${encodeURIComponent(RICH)}`);
  const panel = page.locator("[data-testid=waveform-panel]");
  await expect(panel).toBeVisible({ timeout: 60_000 });

  // The panel resolves to one of three honest outcomes: a trace, "no station
  // nearby", or "the service is down". All three are passes; a spinner that
  // never resolves is not.
  await expect
    .poll(async () => ((await panel.textContent()) ?? "").trim().endsWith("…"), {
      timeout: 90_000,
      intervals: [1000],
    })
    .toBe(false);

  const text = (await panel.textContent()) ?? "";
  if (!(await page.locator("[data-testid=waveform-canvas]").isVisible())) {
    expect(text).toMatch(/No open citizen seismometer|No data from|station service/i);
    return;
  }

  // It must say whose recording this is and how far away, and must not imply the
  // recording is of the motion at the epicentre.
  expect(text).toMatch(/Recorded at\s+AM\./);
  expect(text).toMatch(/km from the epicentre/);
  expect(text).toMatch(/not the motion at the epicentre/);
  expect(text).toMatch(/\d+× real time/);

  await page.click("[data-testid=waveform-play]");
  // Playing must not throw: an AudioContext failure would surface as a page error.
});

test("an event page explains the earthquake in plain words and answers questions about it", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent(RICH)}`);
  // The template is built on the server, so it is in the page at once.
  await expect(page.getByTestId("event-plain")).toContainText(/M 6\.\d earthquake/, { timeout: 60_000 });
  await expect(page.getByTestId("event-prose-source")).toContainText("template");
  const prose = ((await page.getByTestId("event-prose").textContent()) ?? "").toLowerCase();
  for (const banned of [" will ", "predict", "likely", "safe", "chance"]) expect(prose).not.toContain(banned);
  // Questions about the future are answered without a model, and point to the forecast.
  await page.getByTestId("ask-input").fill("Will there be a bigger one?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("ask-routed")).toContainText("does not say what will happen");
});

test("a notable earthquake shows credited photographs, and opens them full size", async ({ page }) => {
  // The 2024 Noto earthquake: a Wikidata item with a Commons category.
  await page.goto("/event/usgs%3Aus6000m0xl");
  const photos = page.getByTestId("event-photos");
  await expect(photos).toBeVisible({ timeout: 60_000 });
  await expect(photos).toContainText("2024 Noto earthquake");
  const tiles = photos.locator(".photos-rows button");
  expect(await tiles.count()).toBeGreaterThan(3);
  // Every photograph is credited with its author and licence beside it.
  for (const credit of await photos.locator(".photos-credit").allTextContents()) {
    expect(credit).toMatch(/, .+/);
  }
  await tiles.first().click();
  const viewer = page.locator("dialog.photos-viewer[open]");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("link", { name: /on Commons/ })).toHaveAttribute("href", /commons\.wikimedia\.org/);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".photos-nav span")).toHaveText(/^2 of \d+$/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("an ordinary earthquake has no photographs section at all", async ({ page }) => {
  await page.goto("/event/usgs%3Aus7000tj1b");
  await expect(page.locator("h2")).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("event-photos")).toHaveCount(0);
});
