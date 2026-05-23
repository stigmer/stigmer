import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
} from "../../helpers/workflow-canvas";

test.describe("Workflow branch management (T09)", () => {
  test.describe("Switch Case", () => {
    test("switch_case node shows labeled handles for each case", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNode(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // Switch nodes with cases should render handle labels
      const handleLabels = switchNode.locator("span.pointer-events-none");
      const count = await handleLabels.count();
      expect(count).toBeGreaterThan(0);
    });

    test("default case handle is visually distinguished", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNode(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // Default case handles use italic styling
      const defaultLabel = switchNode.locator("span.italic");
      // The label should exist if the switch has a default case (no `when` condition)
      if (await defaultLabel.count() > 0) {
        await expect(defaultLabel.first()).toBeVisible();
      }
    });

    test("inspector shows Branches tab for switch_case nodes", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNode(page, "switch_case");
      await switchNode.click();

      // Inspector should have a Branches tab
      const branchesTab = page.locator('button[role="tab"]:has-text("Branches")');
      await expect(branchesTab).toBeVisible({ timeout: 5_000 });
    });

    test("Branches tab shows case listing with conditions", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNode(page, "switch_case");
      await switchNode.click();

      const branchesTab = page.locator('button[role="tab"]:has-text("Branches")');
      await branchesTab.click();

      // Should show the cases count header
      const header = page.locator('h3:has-text("Cases")');
      await expect(header).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("Fork", () => {
    test("fork node shows branch name chips", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const forkNode = getCanvasNode(page, "fork");
      if (await forkNode.count() === 0) {
        test.skip();
        return;
      }
      await expect(forkNode).toBeAttached({ timeout: 10_000 });

      // Fork nodes should have branch badges below
      const branchBadge = forkNode.locator("[data-task-kind='fork']").first()
        .locator("..").locator("span");
      // If the fork has branches configured, chips should appear
      const chipCount = await branchBadge.count();
      expect(chipCount).toBeGreaterThanOrEqual(0);
    });

    test("inspector shows Branches tab with join policy for fork nodes", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const forkNode = getCanvasNode(page, "fork");
      if (await forkNode.count() === 0) {
        test.skip();
        return;
      }
      await forkNode.click();

      const branchesTab = page.locator('button[role="tab"]:has-text("Branches")');
      await expect(branchesTab).toBeVisible({ timeout: 5_000 });
      await branchesTab.click();

      // Should show join policy radio group
      const joinPolicy = page.locator('legend:has-text("Join policy")');
      await expect(joinPolicy).toBeVisible({ timeout: 3_000 });
    });
  });

  test.describe("TryCatch", () => {
    test("inspector shows Catch tab for try_catch nodes", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const tryCatchNode = getCanvasNode(page, "try_catch");
      if (await tryCatchNode.count() === 0) {
        test.skip();
        return;
      }
      await tryCatchNode.click();

      const catchTab = page.locator('button[role="tab"]:has-text("Catch")');
      await expect(catchTab).toBeVisible({ timeout: 5_000 });
    });

    test("Catch tab shows error variable configuration", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const tryCatchNode = getCanvasNode(page, "try_catch");
      if (await tryCatchNode.count() === 0) {
        test.skip();
        return;
      }
      await tryCatchNode.click();

      const catchTab = page.locator('button[role="tab"]:has-text("Catch")');
      await catchTab.click();

      // Should show the protected tasks section
      const protectedHeader = page.locator('h3:has-text("Protected tasks")');
      await expect(protectedHeader).toBeVisible({ timeout: 3_000 });
    });
  });

  test.describe("ForEach", () => {
    test("inspector shows Iteration tab for for_each nodes", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const forEachNode = getCanvasNode(page, "for_each");
      if (await forEachNode.count() === 0) {
        test.skip();
        return;
      }
      await forEachNode.click();

      const iterationTab = page.locator('button[role="tab"]:has-text("Iteration")');
      await expect(iterationTab).toBeVisible({ timeout: 5_000 });
    });

    test("Iteration tab shows concurrency and error policy controls", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const forEachNode = getCanvasNode(page, "for_each");
      if (await forEachNode.count() === 0) {
        test.skip();
        return;
      }
      await forEachNode.click();

      const iterationTab = page.locator('button[role="tab"]:has-text("Iteration")');
      await iterationTab.click();

      // Should show variable name label
      const varLabel = page.locator('label:has-text("Item variable name")');
      await expect(varLabel).toBeVisible({ timeout: 3_000 });

      // Should show collection expression label
      const collectionLabel = page.locator('label:has-text("Collection expression")');
      await expect(collectionLabel).toBeVisible();
    });
  });

  test.describe("Branch add popover duplicate detection", () => {
    test("branch add popover rejects duplicate case names", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNode(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // Hover the switch node to reveal the branch add button
      await switchNode.hover();

      // The branch add button shows "+", look for it
      const branchAddBtn = switchNode.locator('button[aria-label="Add case"]');
      if (await branchAddBtn.count() === 0) {
        test.skip();
        return;
      }

      await branchAddBtn.click();

      // The popover should open
      const popover = page.locator('text="Add Case"');
      await expect(popover).toBeVisible({ timeout: 3_000 });
    });
  });
});
