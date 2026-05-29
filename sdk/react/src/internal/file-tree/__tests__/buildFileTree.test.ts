import { describe, it, expect } from "vitest";
import { buildFileTree, type TreeNode } from "../tree-node";

function names(nodes: TreeNode[]): string[] {
  return nodes.map((n) => n.name);
}

describe("buildFileTree", () => {
  it("returns an empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("places root-level files as top-level nodes without children", () => {
    const tree = buildFileTree([
      { path: "README.md" },
      { path: "package.json" },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children === undefined)).toBe(true);
    expect(names(tree)).toEqual(["package.json", "README.md"]);
  });

  it("synthesizes intermediate folder nodes for nested paths", () => {
    const tree = buildFileTree([{ path: "src/index.ts" }]);
    expect(tree).toHaveLength(1);

    const src = tree[0];
    expect(src.name).toBe("src");
    expect(src.path).toBe("src/");
    expect(src.children).toHaveLength(1);
    expect(src.children![0]).toEqual({ name: "index.ts", path: "src/index.ts" });
  });

  it("groups files under the same parent folder", () => {
    const tree = buildFileTree([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(names(tree[0].children!)).toEqual(["a.ts", "b.ts"]);
  });

  it("handles deeply nested paths", () => {
    const tree = buildFileTree([{ path: "a/b/c/d.ts" }]);
    expect(tree[0].name).toBe("a");
    expect(tree[0].children![0].name).toBe("b");
    expect(tree[0].children![0].children![0].name).toBe("c");
    expect(tree[0].children![0].children![0].children![0]).toEqual({
      name: "d.ts",
      path: "a/b/c/d.ts",
    });
  });

  it("sorts files lexicographically regardless of input order", () => {
    const tree = buildFileTree([
      { path: "z.ts" },
      { path: "a.ts" },
      { path: "m.ts" },
    ]);
    expect(names(tree)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("sorts files and folders together deterministically", () => {
    const tree = buildFileTree([
      { path: "src/index.ts" },
      { path: "README.md" },
      { path: "docs/guide.md" },
    ]);
    expect(names(tree)).toEqual(["docs", "README.md", "src"]);
  });

  it("handles a single-file input", () => {
    const tree = buildFileTree([{ path: "only.txt" }]);
    expect(tree).toEqual([{ name: "only.txt", path: "only.txt" }]);
  });

  it("accepts objects with extra properties (minimal contract)", () => {
    const tree = buildFileTree([
      { path: "a.ts", size: 100, isDirectory: false } as { path: string },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a.ts");
  });

  it("mixes root files and nested files correctly", () => {
    const tree = buildFileTree([
      { path: "config.json" },
      { path: "src/app.ts" },
      { path: "src/utils/helper.ts" },
    ]);
    expect(names(tree)).toEqual(["config.json", "src"]);

    const src = tree[1];
    expect(names(src.children!)).toEqual(["app.ts", "utils"]);
    expect(src.children![1].children![0].name).toBe("helper.ts");
  });

  it("does not mutate the input array", () => {
    const input = [{ path: "b.ts" }, { path: "a.ts" }];
    const frozen = [...input];
    buildFileTree(input);
    expect(input).toEqual(frozen);
  });
});
