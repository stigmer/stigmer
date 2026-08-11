import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileTreeNode } from "../FileTreeNode";
import type { TreeNode } from "../tree-node";

afterEach(cleanup);

const fileNode: TreeNode = { name: "a.ts", path: "src/a.ts" };
const folderNode: TreeNode = {
  name: "src",
  path: "src/",
  children: [fileNode],
};

describe("FileTreeNode — explorer props", () => {
  it("renders an icon before the name when showIcons is set", () => {
    render(
      <ul>
        <FileTreeNode node={fileNode} selectedPath="" onSelect={vi.fn()} depth={0} showIcons />
      </ul>,
    );
    const button = screen.getByText("a.ts").closest("button")!;
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("renders no icon by default (unchanged for existing consumers)", () => {
    render(
      <ul>
        <FileTreeNode node={fileNode} selectedPath="" onSelect={vi.fn()} depth={0} />
      </ul>,
    );
    const button = screen.getByText("a.ts").closest("button")!;
    expect(button.querySelector("svg")).toBeNull();
  });

  it("calls onActivate on double-click of a file", () => {
    const onActivate = vi.fn();
    render(
      <ul>
        <FileTreeNode
          node={fileNode}
          selectedPath=""
          onSelect={vi.fn()}
          onActivate={onActivate}
          depth={0}
        />
      </ul>,
    );
    fireEvent.doubleClick(screen.getByText("a.ts"));
    expect(onActivate).toHaveBeenCalledWith("src/a.ts");
  });

  it("does not call onActivate on a folder double-click", () => {
    const onActivate = vi.fn();
    render(
      <ul>
        <FileTreeNode
          node={folderNode}
          selectedPath=""
          onSelect={vi.fn()}
          onActivate={onActivate}
          depth={0}
        />
      </ul>,
    );
    fireEvent.doubleClick(screen.getByText("src"));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("draws an indent guide on nested groups when indentGuides is set", () => {
    const { container } = render(
      <ul>
        <FileTreeNode
          node={folderNode}
          selectedPath=""
          onSelect={vi.fn()}
          depth={0}
          indentGuides
        />
      </ul>,
    );
    // The nested group carries the guide border class.
    const group = container.querySelector('ul[role="group"]');
    expect(group?.className).toContain("stg:border-l");
  });
});
