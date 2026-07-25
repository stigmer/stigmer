import { describe, expect, it } from "vitest";
import type * as PageTree from "fumadocs-core/page-tree";
import { buildBreadcrumbItems } from "../breadcrumb";

function page(url: string, name: string): PageTree.Item {
  return { type: "page", url, name };
}

/**
 * Mirrors the real page tree's shapes:
 *
 * - The Docs tab is the tree itself (no folder node) with separators, direct
 *   page entries, link entries, and collapsible folders that own an `index`.
 * - SDK/CLI are `root: true` folders whose meta lists `"index"` explicitly,
 *   so the index appears as a plain child page and `folder.index` stays
 *   unset (the shape behind the original "SDK > SDK" duplication).
 */
const tree: PageTree.Root = {
  name: "Docs",
  children: [
    { type: "separator", name: "Get Started" },
    // "[Welcome](/docs)" link entry from docs/meta.json.
    page("/docs", "Welcome"),
    page("/docs/concepts/agents", "Agents"),
    {
      type: "folder",
      name: "Sharing",
      index: page("/docs/guides/sharing", "Sharing overview"),
      children: [page("/docs/guides/sharing/share-links", "Share links")],
    },
    {
      type: "folder",
      name: "SDK",
      root: true,
      children: [
        page("/docs/sdk", "SDK Overview"),
        {
          type: "folder",
          name: "React SDK",
          index: page("/docs/sdk/react", "React SDK"),
          children: [page("/docs/sdk/react/core", "Core")],
        },
      ],
    },
    {
      type: "folder",
      name: "CLI",
      root: true,
      children: [
        page("/docs/cli", "CLI"),
        {
          type: "folder",
          name: "Commands",
          children: [
            page("/docs/cli/commands", "Overview"),
            page("/docs/cli/commands/run", "stigmer run"),
          ],
        },
      ],
    },
  ],
};

describe("buildBreadcrumbItems", () => {
  it("prefixes docs-tab pages with a Docs root crumb", () => {
    expect(buildBreadcrumbItems(tree, "/docs/concepts/agents")).toEqual([
      { name: "Docs", url: "/docs" },
      { name: "Agents", url: "/docs/concepts/agents" },
    ]);
  });

  it("includes collapsible folders with their index URL", () => {
    expect(
      buildBreadcrumbItems(tree, "/docs/guides/sharing/share-links"),
    ).toEqual([
      { name: "Docs", url: "/docs" },
      { name: "Sharing", url: "/docs/guides/sharing" },
      { name: "Share links", url: "/docs/guides/sharing/share-links" },
    ]);
  });

  it("collapses a folder into its own index page", () => {
    expect(buildBreadcrumbItems(tree, "/docs/guides/sharing")).toEqual([
      { name: "Docs", url: "/docs" },
      { name: "Sharing overview", url: "/docs/guides/sharing" },
    ]);
  });

  it("roots SDK pages at the SDK tab without a duplicate folder crumb", () => {
    expect(buildBreadcrumbItems(tree, "/docs/sdk/react/core")).toEqual([
      { name: "SDK", url: "/docs/sdk" },
      { name: "React SDK", url: "/docs/sdk/react" },
      { name: "Core", url: "/docs/sdk/react/core" },
    ]);
  });

  it("renders explicitly-indexed folders as unlinked middle crumbs", () => {
    // cli/commands/meta.json lists "index" explicitly, so the folder itself
    // has no URL — the crumb is a plain label, a standard breadcrumb pattern.
    expect(buildBreadcrumbItems(tree, "/docs/cli/commands/run")).toEqual([
      { name: "CLI", url: "/docs/cli" },
      { name: "Commands", url: undefined },
      { name: "stigmer run", url: "/docs/cli/commands/run" },
    ]);
  });

  it("hides the breadcrumb on the welcome page", () => {
    expect(buildBreadcrumbItems(tree, "/docs")).toEqual([]);
  });

  it("hides the breadcrumb on tab landing pages", () => {
    expect(buildBreadcrumbItems(tree, "/docs/sdk")).toEqual([]);
    expect(buildBreadcrumbItems(tree, "/docs/cli")).toEqual([]);
  });

  it("falls back to the root crumb for pages absent from the tree", () => {
    // The generated task-type pages are valid routes but not sidebar entries
    // (DD-01 §5 file+folder shadowing) — they keep a bare "Docs" crumb.
    expect(
      buildBreadcrumbItems(tree, "/docs/guides/workflows/task-types/http-call"),
    ).toEqual([{ name: "Docs", url: "/docs" }]);
  });
});
