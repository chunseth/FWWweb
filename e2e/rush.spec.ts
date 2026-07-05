import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * Core browser flow for 5-minute mini Rush.
 * Covers: mouse/touch drag from rack to board, invalid drop return,
 * tap-to-remove, and refresh-mid-turn resume.
 */

const startRun = async (page: Page) => {
  // Skip the one-time username + combo-explainer gates.
  await page.addInitScript(() => {
    localStorage.setItem(
      "fwwweb.profile.v1",
      JSON.stringify({ username: "E2ePlayer", verified: false, savedAtMs: 1 })
    );
    localStorage.setItem("fwwweb.comboExplained.v1", "1");
  });
  await page.goto("/");
  const start = page.getByRole("button", { name: /start rush/i });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator(".cell")).toHaveCount(121);
};

const cellCenter = async (page: Page, row: number, col: number) => {
  const board = page.locator(".board");
  const box = (await board.boundingBox())!;
  const cell = box.width / 11;
  return {
    x: box.x + col * cell + cell / 2,
    y: box.y + row * cell + cell / 2,
  };
};

const dragTo = async (page: Page, from: Locator, x: number, y: number) => {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Multiple steps so pointermove fires and the drag engages.
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
};

const draftTileOnBoard = (page: Page) => page.locator(".board .tile--draft");

test("drags a rack tile onto the board with the mouse", async ({ page }) => {
  await startRun(page);
  const firstTile = page.locator("[data-rack-tile]").first();
  const target = await cellCenter(page, 5, 5);
  await dragTo(page, firstTile, target.x, target.y);
  await expect(draftTileOnBoard(page)).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator("[data-rack-tile]")).toHaveCount(6);
});

test("returns the tile to the rack on an invalid drop", async ({ page }) => {
  await startRun(page);
  const firstTile = page.locator("[data-rack-tile]").first();
  // Drop far outside the board and rack.
  await dragTo(page, firstTile, 5, 5);
  await expect(draftTileOnBoard(page)).toHaveCount(0);
  await expect(page.locator("[data-rack-tile]")).toHaveCount(7);
});

test("tapping a draft board tile returns it to the rack", async ({ page }) => {
  await startRun(page);
  const firstTile = page.locator("[data-rack-tile]").first();
  const target = await cellCenter(page, 5, 5);
  await dragTo(page, firstTile, target.x, target.y);
  await expect(draftTileOnBoard(page)).toHaveCount(1);

  await draftTileOnBoard(page).click();
  await expect(draftTileOnBoard(page)).toHaveCount(0);
  await expect(page.locator("[data-rack-tile]")).toHaveCount(7);
});

test("shows a live points preview for a draft placement", async ({ page }) => {
  await startRun(page);
  const firstTile = page.locator("[data-rack-tile]").first();
  const target = await cellCenter(page, 5, 5);
  await dragTo(page, firstTile, target.x, target.y);
  // One tile is never a playable word, but the preview chip must appear
  // (either invalid, or valid with points) without shifting the layout.
  await expect(page.locator(".score-preview__chip")).toBeVisible();
});

test("pauses the timer from the menu and starts a new game", async ({ page }) => {
  await startRun(page);
  await page.getByRole("button", { name: /menu/i }).click();
  await expect(page.getByText(/paused/i)).toBeVisible();
  await page.getByRole("button", { name: /new game/i }).click();
  await expect(page.locator(".cell")).toHaveCount(121);
  await expect(page.getByRole("timer")).toHaveText("5:00");
});

test("resumes a run with draft placements after a refresh", async ({ page }) => {
  await startRun(page);
  const firstTile = page.locator("[data-rack-tile]").first();
  const target = await cellCenter(page, 5, 5);
  await dragTo(page, firstTile, target.x, target.y);
  await expect(draftTileOnBoard(page)).toHaveCount(1);

  // Let the debounced draft autosave land, then refresh.
  await page.waitForTimeout(600);
  await page.reload();

  const resume = page.getByRole("button", { name: /resume run/i });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await resume.click();
  await expect(page.locator(".cell")).toHaveCount(121);
  await expect(draftTileOnBoard(page)).toHaveCount(1);
});
