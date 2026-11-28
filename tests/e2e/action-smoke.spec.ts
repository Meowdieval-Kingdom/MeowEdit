import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { VARIANTS } from "./variants";

const actions = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/e2e/action-inventory.json"), "utf8")) as string[];
const variantsByAction = new Map<string, string>();

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const url of VARIANTS) {
    await page.goto(url);
    await page.waitForSelector("#app [data-action]", { timeout: 10_000 });
    const found = await page.locator("[data-action]").evaluateAll(elements =>
      elements.map(element => (element as HTMLElement).dataset.action).filter(Boolean) as string[]);
    for (const action of found) if (!variantsByAction.has(action)) variantsByAction.set(action, url);
  }
  await page.close();
});

test.describe("interactive control smoke", () => {
  for (const action of actions) {
    test(`${action} responds without a runtime error`, async ({ page }, testInfo) => {
      if (testInfo.project.name !== "desktop") return;
      const url = variantsByAction.get(action);
      expect(url, `no harness page renders ${action}`).toBeTruthy();
      await page.goto(url!);
      await page.waitForSelector("#app [data-action]", { timeout: 10_000 });
      page.on("dialog", dialog => dialog.accept());
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));

      const control = page.locator(`[data-action="${action}"]:visible:not([disabled])`).last();
      // Drawflow nodes are transformed while the graph settles; force those clicks because
      // click-target correctness for the graph is covered by dedicated layout tests.
      const force = ["select-node", "mission-node", "mission-node-tool"].includes(action);
      if (await control.count()) await control.click({ force, timeout: 10_000 });
      // Controls that need prerequisites (e.g. a second floor) are intentionally disabled;
      // their presence in the harness is still verified by the inventory test.
      await expect(page.locator("body")).not.toBeEmpty();
      expect(errors, `${action} threw at runtime`).toEqual([]);
    });
  }
});
