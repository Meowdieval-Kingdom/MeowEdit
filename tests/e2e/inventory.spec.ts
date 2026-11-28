import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { VARIANTS } from "./variants";

const baselinePath = path.resolve(process.cwd(), "tests/e2e/action-inventory.json");

test.describe("interactive control inventory", () => {
  test("every rendered data-action is accounted for", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") return;
    const found = new Set<string>();
    for (const url of VARIANTS) {
      await page.goto(url);
      await expect(page.locator("#app")).toBeVisible();
      const actions = await page.locator("[data-action]").evaluateAll(elements =>
        elements.map(element => (element as HTMLElement).dataset.action).filter(Boolean) as string[]);
      actions.forEach(action => found.add(action));
    }
    const sorted = [...found].sort();
    if (process.env.INVENTORY_GENERATE === "1" || !existsSync(baselinePath))
      writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + "\n");
    expect(sorted).toEqual(JSON.parse(readFileSync(baselinePath, "utf8")));
  });
});
