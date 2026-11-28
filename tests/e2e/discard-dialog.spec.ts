import { expect, test } from "@playwright/test";

test("the discard toggle can be clicked without navigating away", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("meowedit.content.session.author-1", JSON.stringify({
      help: false, savedAt: null, setId: "published-set", lastEdited: null, recent: [],
      pending: [{ setId: "published-set", workspace: "published-set", section: "missions", key: "first-mission", label: "First Mission" }],
      unpublished: [], tabs: {}
    }));
  });
  await page.goto("/tests/e2e/harness-app.html");
  await page.locator('[data-open="published-set"]').click();
  await expect(page.locator("[data-back-browser]")).toBeVisible();
  await expect(page.locator("[data-discard-all]")).toBeEnabled();

  await page.locator("[data-discard-all]").click();
  const dialog = page.locator("#discard-dialog");
  await expect(dialog).toBeVisible();
  const toggle = dialog.locator("[data-discard-unpublished]");
  await toggle.check({ timeout: 5000 });
  await expect(toggle).toBeChecked();
  // The set dashboard must still be on screen: no editor opened from the checkbox click.
  await expect(page.locator("[data-back-browser]")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
});
