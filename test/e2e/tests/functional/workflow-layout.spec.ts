import { test, expect } from "@playwright/test";

/**
 * Workflow layout E2E tests (functional tier — no backend required).
 *
 * These tests verify the auto-layout button and layout-related UX behaviors
 * on the visual canvas editor. They require at least one workflow to exist
 * in the local dev environment with a visual editor tab.
 *
 * @since T03 (ELK Layout Pipeline)
 */
test.describe("Workflow canvas layout", () => {
  let editorUrl: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const firstCard = page.locator('[role="listitem"]').first();
    const firstRow = page.locator("table tbody tr").first();

    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
    } else if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
    } else {
      await page.close();
      return;
    }

    await page.waitForLoadState("networkidle");

    const editorTab = page.locator('[role="tab"]:has-text("Editor")');
    if (await editorTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editorTab.click();
      await page.waitForTimeout(2000);
      editorUrl = page.url();
    }

    await page.close();
  });

  test("auto-layout button exists on the canvas", async ({ page }) => {
    test.skip(!editorUrl, "No workflow editor available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualTab = page.locator('[role="tab"]:has-text("Visual")');
    if (await visualTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await visualTab.click();
      await page.waitForTimeout(2000);
    }

    const autoLayoutButton = page.locator(
      'button:has-text("Auto-layout"), button[aria-label*="layout"], button[title*="layout"]',
    );
    await expect(autoLayoutButton.first()).toBeVisible({ timeout: 10_000 });
  });

  test("auto-layout produces non-overlapping nodes", async ({ page }) => {
    test.skip(!editorUrl, "No workflow editor available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualTab = page.locator('[role="tab"]:has-text("Visual")');
    if (await visualTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await visualTab.click();
      await page.waitForTimeout(2000);
    }

    const autoLayoutButton = page.locator(
      'button:has-text("Auto-layout"), button[aria-label*="layout"], button[title*="layout"]',
    ).first();

    if (!await autoLayoutButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Auto-layout button not found");
      return;
    }

    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const nodes = await page.locator(".react-flow__node").all();
    if (nodes.length < 2) {
      test.skip(true, "Fewer than 2 nodes on canvas");
      return;
    }

    const boxes = await Promise.all(
      nodes.map(async (node) => {
        const box = await node.boundingBox();
        return box;
      }),
    );

    const validBoxes = boxes.filter((b): b is NonNullable<typeof b> => b !== null);

    for (let i = 0; i < validBoxes.length; i++) {
      for (let j = i + 1; j < validBoxes.length; j++) {
        const a = validBoxes[i];
        const b = validBoxes[j];
        const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(
          overlapX && overlapY,
          `Nodes at indices ${i} and ${j} overlap after auto-layout`,
        ).toBe(false);
      }
    }
  });

  test("auto-layout is stable (running twice produces same positions)", async ({ page }) => {
    test.skip(!editorUrl, "No workflow editor available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualTab = page.locator('[role="tab"]:has-text("Visual")');
    if (await visualTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await visualTab.click();
      await page.waitForTimeout(2000);
    }

    const autoLayoutButton = page.locator(
      'button:has-text("Auto-layout"), button[aria-label*="layout"], button[title*="layout"]',
    ).first();

    if (!await autoLayoutButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Auto-layout button not found");
      return;
    }

    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const getPositions = async () => {
      const nodes = await page.locator(".react-flow__node").all();
      return Promise.all(
        nodes.map(async (node) => {
          const box = await node.boundingBox();
          return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null;
        }),
      );
    };

    const positions1 = await getPositions();

    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const positions2 = await getPositions();

    expect(positions1).toEqual(positions2);
  });

  test("Ctrl+Z after auto-layout undoes the layout", async ({ page }) => {
    test.skip(!editorUrl, "No workflow editor available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualTab = page.locator('[role="tab"]:has-text("Visual")');
    if (await visualTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await visualTab.click();
      await page.waitForTimeout(2000);
    }

    const autoLayoutButton = page.locator(
      'button:has-text("Auto-layout"), button[aria-label*="layout"], button[title*="layout"]',
    ).first();

    if (!await autoLayoutButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Auto-layout button not found");
      return;
    }

    const getFirstNodePos = async () => {
      const firstNode = page.locator(".react-flow__node").first();
      const box = await firstNode.boundingBox();
      return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null;
    };

    const positionBefore = await getFirstNodePos();

    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const positionAfterLayout = await getFirstNodePos();

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(500);

    const positionAfterUndo = await getFirstNodePos();

    if (positionBefore && positionAfterLayout && positionAfterUndo) {
      if (positionBefore.x !== positionAfterLayout.x || positionBefore.y !== positionAfterLayout.y) {
        expect(positionAfterUndo).toEqual(positionBefore);
      }
    }
  });
});
