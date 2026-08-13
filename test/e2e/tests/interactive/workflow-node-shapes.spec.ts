import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
  getCanvasNodeByKind,
  getEditorCanvas,
  getNodeVisualClass,
} from "../../helpers/workflow-canvas";

test.describe("Workflow node visual classes (T01)", () => {
  test("canvas nodes have data-visual-class attributes", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // Scoped: the Overview tabpanel mounts a second canvas whose nodes
    // would inflate a page-wide count.
    const nodesWithVisualClass = getEditorCanvas(page).locator("[data-visual-class]");
    await expect(nodesWithVisualClass.first()).toBeVisible({ timeout: 10_000 });

    const count = await nodesWithVisualClass.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("set_vars node has task-card visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const visualClass = await getNodeVisualClass(page, "init_vars");
    expect(visualClass).toBe("task-card");
  });

  test("agent_call node has task-card visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const visualClass = await getNodeVisualClass(page, "classify_input");
    expect(visualClass).toBe("task-card");
  });

  test("switch_case node has decision-diamond visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const visualClass = await getNodeVisualClass(page, "route_by_type");
    expect(visualClass).toBe("decision-diamond");
  });

  test("human_input node has gate-octagon visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const visualClass = await getNodeVisualClass(page, "approval_gate");
    expect(visualClass).toBe("gate-octagon");
  });

  test("wait node has event-circle visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const visualClass = await getNodeVisualClass(page, "cooldown");
    expect(visualClass).toBe("event-circle");
  });

  test("sentinel nodes have terminal-pill visual class", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    // Anchor on the semantic node ids. Since oss#581 (PR #586) sentinels
    // carry an honest contract: terminal-pill visual class and NO
    // data-task-kind (that attribute means "real workflow task kind").
    const canvas = getEditorCanvas(page);
    for (const sentinelId of ["__start__", "__end__"]) {
      const sentinel = canvas
        .locator(`[data-id="${sentinelId}"]`)
        .locator('[data-visual-class="terminal-pill"]');
      await expect(sentinel.first()).toBeVisible({ timeout: 10_000 });
      await expect(sentinel.first()).not.toHaveAttribute("data-task-kind");
    }
  });

  test("node ARIA labels include display name and task name", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const agentNode = getCanvasNode(page, "classify_input");
    await expect(agentNode).toBeVisible({ timeout: 10_000 });

    const label = await agentNode.getAttribute("aria-label");
    expect(label).toContain("Agent Call");
    expect(label).toContain("classify_input");
    expect(label).toContain("shape");
  });

  test("node ARIA labels include shape for accessibility", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const switchNode = getCanvasNode(page, "route_by_type");
    await expect(switchNode).toBeVisible({ timeout: 10_000 });

    const label = await switchNode.getAttribute("aria-label");
    expect(label).toContain("diamond shape");
  });

  test("data-task-kind attributes are present on nodes", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    await expect(getCanvasNodeByKind(page, "agent_call")).toBeVisible({
      timeout: 10_000,
    });
    await expect(getCanvasNodeByKind(page, "switch_case")).toBeVisible();
    await expect(getCanvasNodeByKind(page, "human_input")).toBeVisible();
    await expect(getCanvasNodeByKind(page, "wait")).toBeVisible();
    await expect(getCanvasNodeByKind(page, "set_vars")).toBeVisible();
  });
});

test.describe("Workflow node shape rendering (T02)", () => {
  test("decision-diamond renders an SVG shape element", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const switchNode = getCanvasNode(page, "route_by_type");
    await expect(switchNode).toBeVisible({ timeout: 10_000 });

    // The shape background svg specifically — kind icons are svgs too,
    // so a bare `svg` locator is a strict-mode violation.
    const svg = switchNode.locator('[data-cursor-target="node-shape"]');
    await expect(svg).toBeVisible();

    const path = svg.locator("path");
    await expect(path).toBeVisible();
    const d = await path.getAttribute("d");
    expect(d).toBeTruthy();
    expect(d).toContain("L");
    expect(d).toContain("Z");
  });

  test("gate-octagon renders an SVG shape element", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const humanNode = getCanvasNode(page, "approval_gate");
    await expect(humanNode).toBeVisible({ timeout: 10_000 });

    const svg = humanNode.locator('[data-cursor-target="node-shape"]');
    await expect(svg).toBeVisible();

    const path = svg.locator("path");
    const d = await path.getAttribute("d");
    expect(d).toBeTruthy();
    expect(d).toContain("Z");
  });

  test("event-circle renders an SVG shape element", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const waitNode = getCanvasNode(page, "cooldown");
    await expect(waitNode).toBeVisible({ timeout: 10_000 });

    const svg = waitNode.locator('[data-cursor-target="node-shape"]');
    await expect(svg).toBeVisible();

    const path = svg.locator("path");
    const d = await path.getAttribute("d");
    expect(d).toBeTruthy();
    expect(d).toContain("A");
  });

  test("task-card does NOT render an SVG shape background", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const cardNode = getCanvasNode(page, "classify_input");
    await expect(cardNode).toBeVisible({ timeout: 10_000 });

    // Task cards render a CSS shell — no shape background svg. (Bare
    // svg counting is meaningless: kind icons are svgs on every shell.)
    const svg = cardNode.locator('[data-cursor-target="node-shape"]');
    await expect(svg).toHaveCount(0);
  });

  test("non-rectangular nodes have explicit width and height", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const switchNode = getCanvasNode(page, "route_by_type");
    await expect(switchNode).toBeVisible({ timeout: 10_000 });

    const shellDiv = switchNode.locator(".stgm").first();
    const style = await shellDiv.getAttribute("style");
    expect(style).toContain("width");
    expect(style).toContain("height");
  });

  test("clicking a non-rectangular node shows selection ring", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const switchNode = getCanvasNode(page, "route_by_type");
    await expect(switchNode).toBeVisible({ timeout: 10_000 });

    await switchNode.click();

    // The selection ring token is prefix-scoped (`stg:ring-2`) —
    // auto-retrying regex match instead of a raced getAttribute.
    const shellDiv = switchNode.locator(".stgm").first();
    await expect(shellDiv).toHaveClass(/ring-2/);
  });
});
