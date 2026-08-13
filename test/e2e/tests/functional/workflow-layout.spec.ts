import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  getEditorCanvas,
  navigateToVisualEditor,
} from "../../helpers/workflow-canvas";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/**
 * Workflow layout E2E tests.
 *
 * Verifies the auto-layout button and layout-related UX behaviors on the
 * visual canvas editor, against a seeded multi-kind workflow (the
 * pre-oss#571 version discovered "any existing workflow" from the
 * library, which is vacuous on a fresh stack).
 *
 * @since T03 (ELK Layout Pipeline)
 */

/** The canvas toolbar's auto-layout action (visible-text + aria-label). */
function getAutoLayoutButton(page: Page) {
  return page.getByRole("button", { name: "Auto-layout" });
}

/**
 * Node locator scoped to the EDITOR canvas — the page mounts a second
 * (read-only) canvas in the Overview tabpanel, and Code mode renders a
 * third preview canvas, so bare `.react-flow__node` counts lie.
 */
function getEditorNodes(page: Page) {
  return getEditorCanvas(page).locator(".react-flow__node");
}

test.describe("Workflow canvas layout", () => {
  test("auto-layout button exists on the canvas", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    await expect(getAutoLayoutButton(page)).toBeVisible({ timeout: 10_000 });
  });

  test("auto-layout produces non-overlapping nodes", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const autoLayoutButton = getAutoLayoutButton(page);
    await expect(autoLayoutButton).toBeVisible({ timeout: 10_000 });
    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const nodes = await getEditorNodes(page).all();
    expect(nodes.length).toBeGreaterThanOrEqual(2);

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

  test("auto-layout is stable (running twice produces same positions)", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const autoLayoutButton = getAutoLayoutButton(page);
    await expect(autoLayoutButton).toBeVisible({ timeout: 10_000 });
    await autoLayoutButton.click();
    await page.waitForTimeout(1000);

    const getPositions = async () => {
      const nodes = await getEditorNodes(page).all();
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

  test("Ctrl+Z after auto-layout undoes the layout", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const autoLayoutButton = getAutoLayoutButton(page);
    await expect(autoLayoutButton).toBeVisible({ timeout: 10_000 });

    const getFirstNodePos = async () => {
      const firstNode = getEditorNodes(page).first();
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
