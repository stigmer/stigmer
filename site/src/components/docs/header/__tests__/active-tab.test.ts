import { describe, expect, it } from "vitest";
import type { Option } from "fumadocs-ui/components/layout/root-toggle";
import { selectActiveTab } from "../active-tab";

/**
 * Mirrors the real tabs array built in `app/docs/layout.tsx`: the catch-all
 * Docs tab first, then the root-folder tabs (SDK, CLI) derived from
 * meta.json. The order is load-bearing — see selectActiveTab.
 */
const tabs: Option[] = [
  { title: "Docs", url: "/docs" },
  { title: "SDK", url: "/docs/sdk" },
  { title: "CLI", url: "/docs/cli" },
];

describe("selectActiveTab", () => {
  it("marks Docs active on the docs landing page", () => {
    expect(selectActiveTab(tabs, "/docs")?.url).toBe("/docs");
  });

  it("marks Docs active on pages outside any root folder", () => {
    expect(selectActiveTab(tabs, "/docs/concepts/agents")?.url).toBe("/docs");
  });

  it("marks a root tab active on its landing page", () => {
    expect(selectActiveTab(tabs, "/docs/sdk")?.url).toBe("/docs/sdk");
  });

  it("marks a root tab active on deep links into its subtree", () => {
    expect(selectActiveTab(tabs, "/docs/sdk/react/core")?.url).toBe(
      "/docs/sdk",
    );
    expect(selectActiveTab(tabs, "/docs/cli/commands/apply")?.url).toBe(
      "/docs/cli",
    );
  });

  it("normalizes trailing slashes", () => {
    expect(selectActiveTab(tabs, "/docs/cli/")?.url).toBe("/docs/cli");
  });

  it("returns undefined outside the docs tree", () => {
    expect(selectActiveTab(tabs, "/blog/hello")).toBeUndefined();
  });

  it("resolves the LAST match, so the catch-all Docs tab must stay first", () => {
    // The Docs tab (`/docs` prefix) also matches every SDK URL. findLast
    // lets the more specific SDK tab win — but only because it comes after
    // Docs in the array. This test pins the invariant the layout comment
    // documents; a reordering regression flips the result.
    const reordered = [tabs[1], tabs[0]];
    expect(selectActiveTab(reordered, "/docs/sdk/react")?.url).toBe("/docs");
    expect(selectActiveTab(tabs, "/docs/sdk/react")?.url).toBe("/docs/sdk");
  });
});
