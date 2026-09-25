import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 240_000 });

async function recentLargeEvent(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const since = new Date(Date.now() - 300 * 86_400_000).toISOString().slice(0, 10);
  const feed = await (await request.get(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${since}&minmagnitude=6.5&orderby=magnitude&limit=1`)).json();
  return `usgs:${feed.features[0].id}`;
}

test("the comparison shows its numbers, names past sequences, and keeps prose secondary", async ({ page, request }) => {
  const id = await recentLargeEvent(request);
  await page.goto(`/compare/${encodeURIComponent(id)}`, { timeout: 200_000 });
  await expect(page.getByTestId("compare-facts")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId("compare-most").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("compare-least").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("compare-prose-source")).toContainText(/fixed template|language model/);
  const prose = ((await page.getByTestId("compare-prose").textContent()) ?? "").toLowerCase();
  for (const banned of [" will ", "predict", "likely", "safe", "chance"]) expect(prose).not.toContain(banned);
  expect(await page.locator("main").textContent()).not.toMatch(/NaN|undefined|Infinity/);
});

test("prediction and safety questions are routed, never generated", async ({ page, request }) => {
  const id = await recentLargeEvent(request);
  await page.goto(`/compare/${encodeURIComponent(id)}`, { timeout: 200_000 });
  await expect(page.getByTestId("ask-input")).toBeVisible({ timeout: 150_000 });
  await page.getByTestId("ask-input").fill("When will the next big one hit?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("ask-routed")).toContainText("does not say what will happen");
  await page.getByTestId("ask-input").fill("Is it safe to go home?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("ask-routed")).toContainText("civil-protection");
});

test("the analyst route routes before doing any work, and needs a key to generate", async ({ request }) => {
  const routed = await (await request.post("/api/analyst", { data: { eventId: "usgs:nonexistent", question: "is this a foreshock?" } })).json();
  expect(routed.kind).toBe("routed");
  const r = await request.post("/api/analyst", { data: { eventId: "usgs:ci38457511", question: "What does productivity mean?" } });
  const j = await r.json();
  if (!process.env.ANTHROPIC_API_KEY) expect(j).toMatchObject({ kind: "answer", mode: "template", reason: "no-key" });
});

test("a sequence older than a year is not compared", async ({ page }) => {
  await page.goto(`/compare/${encodeURIComponent("usgs:ci38457511")}`, { timeout: 200_000 });
  await expect(page.getByTestId("compare-limited")).toContainText("more than a year old", { timeout: 150_000 });
});

test("the event page links to the comparison", async ({ page }) => {
  await page.goto(`/event/${encodeURIComponent("usgs:ci38457511")}`);
  await expect(page.getByTestId("compare-link")).toBeVisible({ timeout: 60_000 });
});
