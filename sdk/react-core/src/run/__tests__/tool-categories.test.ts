/**
 * Presentation metadata from a kind the caller already holds
 * (`resolveToolCategoryFromKind`): a known kind decides the label and the
 * primary argument whatever the tool is called, and the kind `unknown`
 * falls back to the name (and MCP slug) the way `resolveToolCategory` does.
 */
import { describe, it, expect } from "vitest";
import { resolveToolCategory, resolveToolCategoryFromKind } from "../tool-categories";

describe("resolveToolCategoryFromKind", () => {
  it("honors a known kind over the tool's name", () => {
    expect(resolveToolCategoryFromKind("shell", "run_it")).toEqual({
      category: "shell",
      label: "Shell",
      primaryArgField: "command",
      fallbackArgFields: [],
      intentArgField: "description",
    });
    expect(resolveToolCategoryFromKind("mcp", "apply_mcp_server", "stigmer").label).toBe("Apply MCP Server");
  });

  it("resolves the kind `unknown` by name and MCP slug", () => {
    expect(resolveToolCategoryFromKind("unknown", "read_file").category).toBe("read");
    expect(resolveToolCategoryFromKind("unknown", "read_file")).toEqual(resolveToolCategory("read_file"));
    expect(resolveToolCategoryFromKind("unknown", "lookup", "tools")).toEqual(resolveToolCategory("lookup", "tools"));
    expect(resolveToolCategoryFromKind("unknown", "lookup", "tools").category).toBe("mcp");
    expect(resolveToolCategoryFromKind("unknown", "made_up").category).toBe("unknown");
  });
});
