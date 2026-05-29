import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { FileTreeNode, FILE_REF_MIME } from "../FileTreeNode";
import type { TreeNode } from "../tree-node";

afterEach(cleanup);

const fileNode: TreeNode = { name: "config.yaml", path: "src/config.yaml" };
const folderNode: TreeNode = {
  name: "src",
  path: "src/",
  children: [fileNode],
};

function renderNode(node: TreeNode, enableDrag = false) {
  return render(
    <ul role="tree">
      <FileTreeNode
        node={node}
        selectedPath=""
        onSelect={vi.fn()}
        depth={0}
        enableDrag={enableDrag}
      />
    </ul>,
  );
}

describe("FileTreeNode drag behavior", () => {
  it("file nodes are NOT draggable by default (enableDrag=false)", () => {
    const { container } = renderNode(fileNode, false);

    const button = container.querySelector("button")!;
    expect(button.getAttribute("draggable")).not.toBe("true");
  });

  it("file nodes become draggable when enableDrag=true", () => {
    const { container } = renderNode(fileNode, true);

    const button = container.querySelector("button")!;
    expect(button.getAttribute("draggable")).toBe("true");
  });

  it("folder nodes are NOT draggable even when enableDrag=true", () => {
    const { container } = renderNode(folderNode, true);

    const buttons = container.querySelectorAll("button");
    const folderButton = buttons[0];
    expect(folderButton.getAttribute("draggable")).not.toBe("true");
  });

  it("onDragStart sets the custom MIME type with correct payload", () => {
    const { container } = renderNode(fileNode, true);

    const button = container.querySelector("button")!;

    const event = new Event("dragstart", { bubbles: true }) as DragEvent;
    const dataStore: Record<string, string> = {};
    Object.defineProperty(event, "dataTransfer", {
      value: {
        setData: (type: string, data: string) => { dataStore[type] = data; },
        set effectAllowed(_v: string) { /* noop in test env */ },
        get effectAllowed() { return "link"; },
      },
    });
    button.dispatchEvent(event);

    expect(dataStore[FILE_REF_MIME]).toBe(
      JSON.stringify({ path: "src/config.yaml" }),
    );
  });

  it("child file nodes in a folder inherit enableDrag from parent", () => {
    const { container } = renderNode(folderNode, true);

    const buttons = container.querySelectorAll("button");
    // buttons[0] is folder, buttons[1] is child file
    const childFileButton = buttons[1];
    expect(childFileButton.getAttribute("draggable")).toBe("true");
  });
});
