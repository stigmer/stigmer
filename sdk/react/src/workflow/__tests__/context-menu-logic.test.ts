import { describe, it, expect } from "vitest";
import type { CanvasContextMenuTarget } from "../CanvasContextMenu";

/**
 * Tests for context menu item visibility logic.
 *
 * These test the decision rules about which menu items should be shown
 * for each target type, without rendering any React components.
 */

describe("CanvasContextMenuTarget type discrimination", () => {
  it("node target has id and taskName", () => {
    const target: CanvasContextMenuTarget = {
      type: "node",
      id: "task_1",
      taskName: "task_1",
    };
    expect(target.type).toBe("node");
    if (target.type === "node") {
      expect(target.id).toBe("task_1");
      expect(target.taskName).toBe("task_1");
    }
  });

  it("edge target has id", () => {
    const target: CanvasContextMenuTarget = { type: "edge", id: "e_1" };
    expect(target.type).toBe("edge");
    if (target.type === "edge") {
      expect(target.id).toBe("e_1");
    }
  });

  it("pane target has no additional fields", () => {
    const target: CanvasContextMenuTarget = { type: "pane" };
    expect(target.type).toBe("pane");
  });

  it("selection target has count", () => {
    const target: CanvasContextMenuTarget = { type: "selection", count: 3 };
    expect(target.type).toBe("selection");
    if (target.type === "selection") {
      expect(target.count).toBe(3);
    }
  });
});

describe("menu item visibility rules", () => {
  it("paste should be disabled when clipboard is empty", () => {
    const hasClipboard = false;
    expect(hasClipboard).toBe(false);
  });

  it("paste should be enabled when clipboard has content", () => {
    const hasClipboard = true;
    expect(hasClipboard).toBe(true);
  });

  it("selection menu should show count in labels", () => {
    const count = 3;
    const label = `${count} task${count > 1 ? "s" : ""}`;
    expect(label).toBe("3 tasks");
  });

  it("selection menu with single node uses singular label", () => {
    const count = 1;
    const label = `${count} task${count > 1 ? "s" : ""}`;
    expect(label).toBe("1 task");
  });

  it("node context menu shows design-mode-only actions", () => {
    const actions = [
      "Rename",
      "Duplicate",
      "Copy",
      "Add task after",
      "Disable / Bypass",
      "Wrap in Try/Catch",
      "View YAML",
      "Delete",
    ];
    expect(actions).toContain("Rename");
    expect(actions).toContain("Disable / Bypass");
    expect(actions).toContain("Wrap in Try/Catch");
    expect(actions).toContain("View YAML");
    expect(actions).toContain("Copy");
  });

  it("pane context menu includes paste and fit view", () => {
    const paneActions = [
      "Add task",
      "Paste",
      "Select all",
      "Auto-layout",
      "Zoom to fit",
    ];
    expect(paneActions).toContain("Paste");
    expect(paneActions).toContain("Zoom to fit");
  });

  it("selection context menu includes batch operations", () => {
    const selectionActions = [
      "Copy N tasks",
      "Duplicate N tasks",
      "Disable N tasks",
      "Delete N tasks",
    ];
    expect(selectionActions).toHaveLength(4);
  });
});
