import { expect, test, type Page } from "@playwright/test";

type Cam = { lon: number; lat: number; altitude: number; heading: number; tilt: number };
type Stats = { tilesDrawn: number; tilesPending: number; tileLevel: number; animating: boolean; eventCount: number; renders: number };
const stats = (page: Page) => page.evaluate(() => (window as unknown as { __globeStats: Stats }).__globeStats);

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __globeStats?: Stats }).__globeStats;
    return !!s && s.tilesDrawn > 0 && s.tilesPending === 0 && !s.animating;
  }, null, { timeout: 90_000, polling: 250 });
}

const camera = (page: Page) => page.evaluate(() => (window as unknown as { __globeTest: { camera(): Cam } }).__globeTest.camera());

test.describe.configure({ timeout: 180_000 });

test("the globe is the real Earth, drawn the right way round", async ({ page }) => {
  await page.goto("/?cam=0.0000,0.0000,3.000000");
  await settle(page);
  const box = (await page.locator("[data-testid=globe-canvas]").boundingBox())!;
  const probe = (dx: number, dy: number) =>
    page.evaluate(([x, y]) => (window as unknown as { __globeTest: { groundAt(x: number, y: number): { lat: number; lon: number } | null } }).__globeTest.groundAt(x!, y!), [box.width / 2 + dx, box.height / 2 + dy]);
  // Looking down at 0°N 0°E: east is to the right, north is up. The globe was
  // mirror-imaged before Phase 9, which a dark wireframe hid.
  expect((await probe(120, 0))!.lon).toBeGreaterThan(5);
  expect((await probe(0, -120))!.lat).toBeGreaterThan(5);
  const s = await stats(page);
  expect(s.tilesDrawn).toBeGreaterThan(4);
});

test("zooming in streams sharper imagery", async ({ page }) => {
  await page.goto("/?cam=139.7000,35.6000,3.000000");
  await settle(page);
  const far = (await stats(page)).tileLevel;
  const rendersBefore = (await stats(page)).renders;
  await page.evaluate(() => (window as unknown as { __globeTest: { setCamera(c: Cam): void } }).__globeTest.setCamera({ lon: 139.7, lat: 35.6, altitude: 1.002, heading: 0, tilt: 0 }));
  // settle() alone could read the stats of the frame before the move.
  await expect.poll(async () => (await stats(page)).renders, { timeout: 10_000 }).toBeGreaterThan(rendersBefore);
  await settle(page);
  const near = (await stats(page)).tileLevel;
  expect(near).toBeGreaterThanOrEqual(far + 6);
  await expect(page.getByTestId("hud-altitude")).toContainText("km");
});

test("the wheel zooms toward the cursor and the compass restores north", async ({ page }) => {
  await page.goto("/?cam=20.0000,10.0000,3.000000");
  await settle(page);
  const box = (await page.locator("[data-testid=globe-canvas]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
  const cam = await camera(page);
  expect(cam.altitude).toBeLessThan(3);
  // Zooming toward a point east of centre moves the target east.
  expect(cam.lon).toBeGreaterThan(20);

  await page.evaluate(() => (window as unknown as { __globeTest: { setCamera(c: Cam): void } }).__globeTest.setCamera({ lon: 20, lat: 10, altitude: 1.01, heading: 90, tilt: 40 }));
  await page.getByTestId("compass").click();
  await expect.poll(async () => { const c = await camera(page); return Math.round(c.tilt) + Math.round(Math.min(c.heading, 360 - c.heading)); }, { timeout: 10_000 }).toBe(0);
});

test("searching coordinates flies there", async ({ page }) => {
  await page.goto("/?cam=0.0000,0.0000,3.000000");
  await settle(page);
  await page.getByTestId("place-search").fill("-33.87, 151.21");
  await page.getByTestId("place-search").press("Enter");
  await expect.poll(async () => { const c = await camera(page); return Math.abs(c.lat + 33.87) + Math.abs(c.lon - 151.21); }, { timeout: 15_000 }).toBeLessThan(0.05);
});

test("clicking an earthquake flies to it and opens its card, without leaving the globe", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => ((window as unknown as { __globeStats?: Stats }).__globeStats?.eventCount ?? 0) > 0, null, { timeout: 90_000 });
  await settle(page);
  const target = await page.evaluate(() => {
    const t = (window as unknown as { __globeTest: { focusOn(i: number): boolean; screenPositionOf(i: number): { x: number; y: number } | null } }).__globeTest;
    t.focusOn(0);
    return t.screenPositionOf(0);
  });
  expect(target).not.toBeNull();
  const box = (await page.locator("[data-testid=globe-canvas]").boundingBox())!;
  await page.mouse.click(box.x + target!.x, box.y + target!.y);
  await expect(page.getByTestId("selection-card")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("selection-event-link")).toHaveAttribute("href", /^\/event\//);
  await expect(page).toHaveURL(/sel=/);
  expect(page.url()).not.toContain("/event/");
  await page.getByTestId("selection-close").click();
  await expect(page.getByTestId("selection-card")).toHaveCount(0);
});

test("x-ray shows the slabs and says so", async ({ page }) => {
  await page.goto("/?cam=145.0000,-5.0000,2.200000");
  await settle(page);
  await page.getByTestId("layer-slabs").click();
  await expect(page.getByTestId("layer-xray")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("globe-hud")).toContainText("x-ray");
  await page.getByTestId("layer-xray").click();
  await expect(page.getByTestId("layer-slabs")).toHaveAttribute("aria-pressed", "false");
});

test("3D terrain puts Everest at its real height, and turns off to a smooth sphere", async ({ page }) => {
  await page.goto("/?cam=86.9250,27.9500,1.005494,15.0,70.0");
  await settle(page);
  const elevation = () => page.evaluate(() => (window as unknown as { __globeTest: { elevationAt(la: number, lo: number): number } }).__globeTest.elevationAt(27.9881, 86.925));
  // The summit is 8,849 m; the DEM at tile resolution smooths the peak a little.
  const h = await elevation();
  expect(h).toBeGreaterThan(7500);
  expect(h).toBeLessThan(9000);
  await page.getByTestId("layer-terrain").click();
  await expect.poll(elevation, { timeout: 10_000 }).toBe(0);
});
