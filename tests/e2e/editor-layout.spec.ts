import { expect, test } from "@playwright/test";

test("guided step stays near the top and does not move vertically when context folds", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await page.goto("/tests/e2e/harness-editor.html?type=missions&mode=guided");
  const step = page.locator(".mission-guided-screen");
  await expect(step).toBeVisible();
  const before = await step.boundingBox();
  expect(before!.y).toBeLessThan(400);

  await page.locator('[data-action="toggle-context"]').first().click();
  await expect(page.locator(".app-layout.context-collapsed")).toHaveCount(1);
  const after = await step.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(10);
});

test("switching tabs keeps their order and marks the active context branch", async ({ page }) => {
  await page.goto("/tests/e2e/harness-editor.html");
  await expect(page.locator(".editor-tab")).toHaveCount(4);
  await page.locator('.editor-tab[data-key="find-key"]').click();
  await expect(page.locator(".editor-tab").first()).toHaveAttribute("data-key", "elder-intro");
  await expect(page.locator('.editor-tab[data-key="find-key"]')).toHaveClass(/is-active/);
  await expect(page.locator('.context-toggle[data-group="missions"]')).toHaveClass(/has-active/);
});

test("mobile context starts folded and opens as an overlay", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "mobile") return;
  await page.goto("/tests/e2e/harness-editor.html?type=missions&mode=guided");
  await expect(page.locator(".app-layout.context-collapsed")).toHaveCount(1);
  const sidebar = page.locator(".context-sidebar");
  expect(await sidebar.boundingBox()).toBeNull();
  await page.locator('[data-action="toggle-context"]').first().click();
  await expect(page.locator(".app-layout.context-collapsed")).toHaveCount(0);
  const opened = await sidebar.boundingBox();
  expect(opened).not.toBeNull();
  expect(opened!.x).toBeGreaterThanOrEqual(0);
});

test("clicking a context leaf does not fold its group", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await page.goto("/tests/e2e/harness-editor.html");
  const group = page.locator('[data-context-group="missions"]');
  await expect(group).toBeVisible();
  await page.locator('.context-item').filter({ hasText: "Village Guards" }).first().click();
  await expect(page.locator('.context-toggle[data-group="missions"]')).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeVisible();
});
