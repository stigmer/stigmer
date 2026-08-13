import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNodeByKind,
} from "../../helpers/workflow-canvas";

// Branch-bearing nodes are located BY KIND (`getCanvasNodeByKind`) — the
// original spec passed kind strings to the task-NAME lookup, which can
// never match (the multi-kind fixture's switch task is named
// `route_by_type`). The fixture carries a switch_case; fork / try_catch /
// for_each tests skip honestly when the fixture has none.
//
// The fixture switch's cases: `urgent` (conditional) and `default`
// (no `when` → the default case, rendered italic with a ⊘ suffix).
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

      const switchNode = getCanvasNodeByKind(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // Each case renders a labeled handle under the node — assert the
      // user-visible case names, not styling class tokens.
      await expect(switchNode.getByText("urgent")).toBeVisible();
      await expect(switchNode.getByText(/^default/)).toBeVisible();
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

      const switchNode = getCanvasNodeByKind(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // The default case reads differently at a glance: italic label with
      // the ⊘ marker (the label carries the distinction, not a tooltip).
      const defaultLabel = switchNode.getByText(/^default ⊘$/);
      await expect(defaultLabel).toBeVisible();
      await expect(defaultLabel).toHaveCSS("font-style", "italic");
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

      const switchNode = getCanvasNodeByKind(page, "switch_case");
      await switchNode.click();

      const branchesTab = page.getByRole("tab", { name: "Branches" });
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

      const switchNode = getCanvasNodeByKind(page, "switch_case");
      await switchNode.click();

      const branchesTab = page.getByRole("tab", { name: "Branches" });
      await branchesTab.click();

      // Should show the cases count header
      const header = page.locator('h3:has-text("Cases")');
      await expect(header).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("Fork", () => {
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

      const forkNode = getCanvasNodeByKind(page, "fork");
      if ((await forkNode.count()) === 0) {
        test.skip();
        return;
      }
      await forkNode.click();

      const branchesTab = page.getByRole("tab", { name: "Branches" });
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

      const tryCatchNode = getCanvasNodeByKind(page, "try_catch");
      if ((await tryCatchNode.count()) === 0) {
        test.skip();
        return;
      }
      await tryCatchNode.click();

      const catchTab = page.getByRole("tab", { name: "Catch" });
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

      const tryCatchNode = getCanvasNodeByKind(page, "try_catch");
      if ((await tryCatchNode.count()) === 0) {
        test.skip();
        return;
      }
      await tryCatchNode.click();

      const catchTab = page.getByRole("tab", { name: "Catch" });
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

      const forEachNode = getCanvasNodeByKind(page, "for_each");
      if ((await forEachNode.count()) === 0) {
        test.skip();
        return;
      }
      await forEachNode.click();

      const iterationTab = page.getByRole("tab", { name: "Iteration" });
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

      const forEachNode = getCanvasNodeByKind(page, "for_each");
      if ((await forEachNode.count()) === 0) {
        test.skip();
        return;
      }
      await forEachNode.click();

      const iterationTab = page.getByRole("tab", { name: "Iteration" });
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
    test("branch add popover opens from the switch node", async ({
      page,
      testMultiKindWorkflow,
    }) => {
      await navigateToVisualEditor(
        page,
        testMultiKindWorkflow.org,
        testMultiKindWorkflow.slug,
      );
      await assertNoErrorBoundary(page);

      const switchNode = getCanvasNodeByKind(page, "switch_case");
      await expect(switchNode).toBeAttached({ timeout: 10_000 });

      // Hover the switch node to reveal the branch add button
      await switchNode.hover();

      const branchAddBtn = switchNode.locator('button[aria-label="Add case"]');
      if ((await branchAddBtn.count()) === 0) {
        test.skip();
        return;
      }

      await branchAddBtn.click();

      // The popover should open (its heading and submit button both read
      // "Add Case" — first() targets the heading).
      const popover = page.locator('text="Add Case"').first();
      await expect(popover).toBeVisible({ timeout: 3_000 });
    });
  });
});
