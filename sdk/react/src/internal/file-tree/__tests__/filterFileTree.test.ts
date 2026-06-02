import { describe, it, expect } from "vitest";
import type { TreeNode } from "../tree-node";
import { filterFileTree } from "../filterFileTree";

function names(nodes: readonly TreeNode[]): string[] {
  return nodes.map((n) => n.name);
}

const SAMPLE_TREE: TreeNode[] = [
  {
    name: "src",
    path: "src/",
    children: [
      { name: "index.ts", path: "src/index.ts" },
      {
        name: "utils",
        path: "src/utils/",
        children: [
          { name: "helper.ts", path: "src/utils/helper.ts" },
          { name: "format.ts", path: "src/utils/format.ts" },
        ],
      },
      { name: "App.tsx", path: "src/App.tsx" },
    ],
  },
  { name: "README.md", path: "README.md" },
  { name: "package.json", path: "package.json" },
  {
    name: "docs",
    path: "docs/",
    children: [
      { name: "guide.md", path: "docs/guide.md" },
    ],
  },
];

describe("filterFileTree", () => {
  it("returns the original reference for an empty query", () => {
    const result = filterFileTree(SAMPLE_TREE, "");
    expect(result).toBe(SAMPLE_TREE);
  });

  it("returns the original reference for a whitespace-only query", () => {
    const result = filterFileTree(SAMPLE_TREE, "   ");
    expect(result).toBe(SAMPLE_TREE);
  });

  it("matches leaf files by name substring", () => {
    const result = filterFileTree(SAMPLE_TREE, "helper");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].name).toBe("utils");
    expect(result[0].children![0].children).toHaveLength(1);
    expect(result[0].children![0].children![0].name).toBe("helper.ts");
  });

  it("is case-insensitive", () => {
    const result = filterFileTree(SAMPLE_TREE, "README");
    expect(names(result)).toContain("README.md");

    const lower = filterFileTree(SAMPLE_TREE, "readme");
    expect(names(lower)).toContain("README.md");

    const mixed = filterFileTree(SAMPLE_TREE, "ReAdMe");
    expect(names(mixed)).toContain("README.md");
  });

  it("returns an empty array when nothing matches", () => {
    const result = filterFileTree(SAMPLE_TREE, "nonexistent-xyz");
    expect(result).toEqual([]);
  });

  it("preserves parent folders for deeply nested matches", () => {
    const result = filterFileTree(SAMPLE_TREE, "format");
    expect(result).toHaveLength(1);

    const src = result[0];
    expect(src.name).toBe("src");
    expect(src.children).toHaveLength(1);

    const utils = src.children![0];
    expect(utils.name).toBe("utils");
    expect(utils.children).toHaveLength(1);
    expect(utils.children![0].name).toBe("format.ts");
  });

  it("includes a matching folder with all its original children", () => {
    const result = filterFileTree(SAMPLE_TREE, "utils");
    expect(result).toHaveLength(1);

    const src = result[0];
    expect(src.name).toBe("src");
    expect(src.children).toHaveLength(1);

    const utils = src.children![0];
    expect(utils.name).toBe("utils");
    expect(utils.children).toHaveLength(2);
    expect(names(utils.children!)).toEqual(["helper.ts", "format.ts"]);
  });

  it("matches multiple items across different branches", () => {
    const result = filterFileTree(SAMPLE_TREE, ".md");
    expect(names(result)).toContain("README.md");
    expect(names(result)).toContain("docs");

    const docs = result.find((n) => n.name === "docs");
    expect(docs?.children).toHaveLength(1);
    expect(docs?.children![0].name).toBe("guide.md");
  });

  it("matches root-level files directly", () => {
    const result = filterFileTree(SAMPLE_TREE, "package");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("package.json");
    expect(result[0].children).toBeUndefined();
  });

  it("does not mutate the original tree", () => {
    const originalLength = SAMPLE_TREE.length;
    const originalSrcChildren = SAMPLE_TREE[0].children!.length;
    filterFileTree(SAMPLE_TREE, "helper");
    expect(SAMPLE_TREE).toHaveLength(originalLength);
    expect(SAMPLE_TREE[0].children).toHaveLength(originalSrcChildren);
  });

  it("handles an empty tree", () => {
    const result = filterFileTree([], "query");
    expect(result).toEqual([]);
  });

  it("handles a tree with only root-level files", () => {
    const flat: TreeNode[] = [
      { name: "a.ts", path: "a.ts" },
      { name: "b.ts", path: "b.ts" },
    ];
    const result = filterFileTree(flat, "a");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a.ts");
  });
});
