import { expect, test } from "@playwright/test";

test("the scoreboard states its verdict and the ledger's integrity", async ({ page }) => {
  await page.goto("/scoreboard");
  const verdict = page.getByTestId("scoreboard-verdict");
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  // One of the five honest states, never a blank.
  await expect(verdict).toContainText(/No forecast has been scored yet|too few to judge|beats the long-term baseline|does not beat|has not been shown to beat|No forecast has been issued/);
  await expect(page.getByTestId("scoreboard-integrity")).toContainText(/Ledger intact/);
  await expect(page.getByTestId("chart-reliability").locator("svg")).toBeVisible();
  await expect(page.getByTestId("scoreboard-failures")).toBeVisible();
  const body = (await page.locator("main").textContent()) ?? "";
  expect(body).not.toMatch(/NaN|undefined|Infinity/);
});

test("the header links to the scoreboard", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("scoreboard-link").click();
  await expect(page).toHaveURL(/\/scoreboard$/);
});
