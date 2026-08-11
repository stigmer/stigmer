import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  effectiveEnabledTools,
  filterToolsByEnabledTools,
  enabledToolsBySlug,
} from "../mcp-enabled-tools.js";

describe("effectiveEnabledTools", () => {
  it("uses the usage's non-empty enabled_tools verbatim", () => {
    expect(effectiveEnabledTools(["a", "b"], ["c"])).toEqual(["a", "b"]);
  });

  it("falls back to default_enabled_tools when the usage list is empty", () => {
    expect(effectiveEnabledTools([], ["c", "d"])).toEqual(["c", "d"]);
  });

  it("falls back to default_enabled_tools when the usage list is absent", () => {
    expect(effectiveEnabledTools(undefined, ["c"])).toEqual(["c"]);
  });

  it("returns undefined (unrestricted) when both lists are empty or absent", () => {
    expect(effectiveEnabledTools([], [])).toBeUndefined();
    expect(effectiveEnabledTools(undefined, undefined)).toBeUndefined();
    expect(effectiveEnabledTools([], undefined)).toBeUndefined();
  });

  it("returns copies, never the caller's arrays", () => {
    const usage = ["a"];
    const result = effectiveEnabledTools(usage, undefined)!;
    result.push("b");
    expect(usage).toEqual(["a"]);
  });
});

describe("filterToolsByEnabledTools", () => {
  const tool = (name: string) => ({ name });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("passes every tool through untouched when unrestricted (undefined)", () => {
    const tools = [tool("a"), tool("b")];
    expect(filterToolsByEnabledTools("srv", tools, undefined)).toEqual(tools);
  });

  it("keeps only the tools on the allow-list (exact bare-name match)", () => {
    const tools = [tool("read"), tool("write"), tool("delete")];
    expect(
      filterToolsByEnabledTools("srv", tools, ["read"]).map((t) => t.name),
    ).toEqual(["read"]);
  });

  it("warns and intersects when an enabled name is not among the discovered tools", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = [tool("read"), tool("write")];

    const filtered = filterToolsByEnabledTools("srv", tools, ["read", "reed"]);

    // The restriction still holds (intersection), the run is not failed,
    // and the operator gets a loud pointer at the mismatched name.
    expect(filtered.map((t) => t.name)).toEqual(["read"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reed"));
  });

  it("yields an empty toolset when no enabled name matches (restriction over availability)", () => {
    const tools = [tool("read")];
    expect(filterToolsByEnabledTools("srv", tools, ["ghost"])).toEqual([]);
  });
});

describe("enabledToolsBySlug", () => {
  it("collects only restricted servers, keyed by slug", () => {
    const map = enabledToolsBySlug([
      { slug: "restricted", enabledTools: ["a"] },
      { slug: "open" },
    ]);
    expect(map).toEqual({ restricted: ["a"] });
  });

  it("returns an empty object when nothing is restricted (the common case)", () => {
    expect(enabledToolsBySlug([{ slug: "open" }])).toEqual({});
  });
});
