import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

test("the globe's export menu downloads the loaded catalogue and shows the ObsPy query", async ({ page }) => {
  await page.goto("/");
  const button = page.getByTestId("export-button");
  await expect(button).toBeEnabled({ timeout: 60_000 });
  const n = Number(((await button.textContent()) ?? "").replace(/[^\d]/g, ""));
  expect(n).toBeGreaterThan(0);

  await button.click();
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  expect(csv.suggestedFilename()).toMatch(/^seismograph-\d{4}-\d\d-\d\d-\d+-events\.csv$/);
  const text = readFileSync((await csv.path())!, "utf8");
  expect(text.split("\r\n")[0]).toBe("id,time_utc,latitude,longitude,depth_km,magnitude,mag_type,place,status,source,url");
  expect(text.trim().split("\r\n")).toHaveLength(n + 1);

  await button.click();
  const [pq] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-parquet").click()]);
  const bytes = readFileSync((await pq.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("PAR1");

  await button.click();
  await page.getByTestId("export-obspy").click();
  await expect(page.getByTestId("obspy-snippet")).toContainText('Client("USGS")');
});

test("every chart offers SVG and PNG of itself", async ({ page }) => {
  await page.goto("/sequence/usgs%3Aci38457511", { timeout: 150_000 });
  const svgButton = page.locator("[data-testid$='-download-svg']").first();
  await expect(svgButton).toBeVisible({ timeout: 120_000 });
  const [svg] = await Promise.all([page.waitForEvent("download"), svgButton.click()]);
  const doc = readFileSync((await svg.path())!, "utf8");
  expect(doc).toMatch(/^<\?xml/);
  expect(doc).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(doc).not.toContain("data-export");
  const [png] = await Promise.all([page.waitForEvent("download"), page.locator("[data-testid$='-download-png']").first().click()]);
  expect(readFileSync((await png.path())!).subarray(1, 4).toString()).toBe("PNG");
});

test("the v1 API is CORS-open, FDSN-shaped, and explains its errors", async ({ request }) => {
  const index = await request.get("/api/v1");
  expect(index.headers()["access-control-allow-origin"]).toBe("*");
  expect((await index.json()).endpoints.events).toContain("/api/v1/events");

  const r = await request.get("/api/v1/events?starttime=2019-07-04&endtime=2019-07-12&minlatitude=35&maxlatitude=36.5&minlongitude=-118.2&maxlongitude=-117&minmagnitude=5");
  const j = await r.json();
  expect(r.status(), JSON.stringify(j).slice(0, 300)).toBe(200);
  expect(j.attribution).toMatch(/USGS/);
  expect(j.events.map((e: { id: string }) => e.id)).toContain("usgs:ci38457511");
  expect(j.events[0].links.forecast).toContain("/api/v1/forecast/");

  const csv = await request.get("/api/v1/events?starttime=2019-07-04&endtime=2019-07-12&minmagnitude=6.4&format=csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).startsWith("id,time_utc")).toBe(true);

  const bad = await request.get("/api/v1/events?format=xlsx");
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatch(/format must be one of/);

  const missing = await request.get("/api/v1/events/usgs%3Anonexistent000");
  expect([404, 502]).toContain(missing.status());

  const f = await (await request.get("/api/v1/forecast/usgs%3Aci38457511", { timeout: 120_000 })).json();
  expect(f.kind).toBe("usgs");
  expect(f.note).toMatch(/not a prediction/);

  const sb = await (await request.get("/api/v1/scoreboard")).json();
  expect(sb).toHaveProperty("verdict");

  const pre = await request.fetch("/api/v1/events", { method: "OPTIONS" });
  expect(pre.status()).toBe(204);
});

test("the API documentation page lists every endpoint", async ({ page }) => {
  await page.goto("/api");
  await expect(page.getByTestId("api-endpoints").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("api-terms")).toContainText("no key");
});

test("a watchlist lives in the browser, reads as a digest, and survives a reload", async ({ page }) => {
  await page.goto("/watchlist?lat=35.68&lon=139.69&name=Tokyo");
  await expect(page.getByTestId("watchlist-name")).toHaveValue("Tokyo");
  await page.getByTestId("watchlist-radiusKm").fill("5");
  await page.getByTestId("watchlist-add").click();
  await expect(page.getByTestId("watchlist-form-error")).toContainText("radius");
  await page.getByTestId("watchlist-radiusKm").fill("400");
  await page.getByTestId("watchlist-add").click();

  const digest = page.getByTestId("watchlist-digest");
  await expect(digest).toBeVisible({ timeout: 60_000 });
  await expect(digest).toHaveAttribute("data-usual", /fewer|usual|more|no-reference/);
  await expect(page.getByTestId("watchlist-since")).toContainText("First visit");
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|danger|alert!/i);

  await page.reload();
  await expect(page.getByTestId("watchlist-place")).toHaveCount(1);
  await page.getByTestId("watchlist-mark-seen").click();
  await expect(page.getByTestId("watchlist-since")).toContainText("Since you last marked this read");
  await page.getByTestId("watchlist-remove").click();
  await expect(page.getByTestId("watchlist-place")).toHaveCount(0);
});

test("the event page links to watching its area", async ({ page }) => {
  await page.goto("/event/usgs%3Aci38457511", { timeout: 120_000 });
  await expect(page.getByTestId("watch-link")).toHaveAttribute("href", /\/watchlist\?lat=35\.\d+&lon=-117\.\d+&name=/);
});
