/**
 * The names MCP tools reach a model under (`shared/mcp-tool-names.ts`):
 * Claude Code's `mcp__<server>__<tool>`, fitted to the providers' 64
 * characters when it is longer, and the index that answers which server and
 * tool an engine name stands for from what the servers listed, never by
 * parsing a name.
 *
 * The longest server segment measured is the shipped catalogue's
 * `plugin_interactive-brokers_interactive-brokers` (`plugins/*\/mcp.json`):
 * its prefix leaves 11 characters for the tool.
 */

import { describe, expect, it } from "vitest";

import { ENGINE_TOOL_NAME_MAX, McpToolIndex, McpToolNameCollisionError, engineToolName, mcpToolName } from "../mcp-tool-names.js";

const LONGEST_SEGMENT = "plugin_interactive-brokers_interactive-brokers";
/** OpenAI's documented function-name alphabet; the hash and both grammars stay inside it. */
const PROVIDER_NAME = /^[a-zA-Z0-9_-]+$/;

describe("mcpToolName", () => {
  it("is Claude Code's name for a server's tool", () => {
    expect(mcpToolName("github", "search_code")).toBe("mcp__github__search_code");
  });
});

describe("engineToolName", () => {
  it("is the canonical name when it fits", () => {
    expect(engineToolName("github", "search_code")).toBe("mcp__github__search_code");
    const exact = "t".repeat(ENGINE_TOOL_NAME_MAX - "mcp__github__".length);
    expect(engineToolName("github", exact), "64 characters fit").toBe(mcpToolName("github", exact));
  });

  it("fits the catalogue's longest segment with a 40-character tool, keeping the tool whole", () => {
    const tool = "get_portfolio_positions_with_cost_basis_".slice(0, 40);
    const name = engineToolName(LONGEST_SEGMENT, tool);
    expect(name.length).toBeLessThanOrEqual(ENGINE_TOOL_NAME_MAX);
    expect(name.startsWith("mcp__plugin_")).toBe(true);
    expect(name.endsWith(`__${tool}`), "the tool is what the model reads").toBe(true);
    expect(name).toMatch(PROVIDER_NAME);
  });

  it("cuts the server segment first, then the tool, and is always within the limit", () => {
    const shortTool = engineToolName(LONGEST_SEGMENT, "get_portfolio_positions");
    expect(shortTool).toMatch(/^mcp__plugin_interactive-brokers_[0-9a-f]{6}__get_portfolio_positions$/);
    for (const toolLength of [1, 11, 12, 30, 49, 50, 51, 64, 200]) {
      const name = engineToolName(LONGEST_SEGMENT, "x".repeat(toolLength));
      expect(name.length, `a ${toolLength}-character tool`).toBeLessThanOrEqual(ENGINE_TOOL_NAME_MAX);
      expect(name).toMatch(PROVIDER_NAME);
    }
    const longTool = engineToolName("docs", "y".repeat(200));
    expect(longTool.length).toBe(ENGINE_TOOL_NAME_MAX);
    expect(longTool.startsWith("mcp__docs_"), "a short segment is kept whole").toBe(true);
  });

  it("never leaves a doubled separator where the segment is cut", () => {
    // 36 characters of segment fit beside a 14-character tool: the cut lands just after its `_`.
    const name = engineToolName(`plugin_${"a".repeat(28)}_${"b".repeat(22)}`, "fourteen_chars");
    expect(name.slice("mcp__".length, name.lastIndexOf("__"))).not.toContain("__");
  });

  it("is the same name on every call, and differs for two tools that cut alike", () => {
    const a = engineToolName(LONGEST_SEGMENT, "z".repeat(60) + "a");
    const b = engineToolName(LONGEST_SEGMENT, "z".repeat(60) + "b");
    expect(engineToolName(LONGEST_SEGMENT, "z".repeat(60) + "a")).toBe(a);
    expect(a).not.toBe(b);
  });
});

describe("McpToolIndex", () => {
  const index = McpToolIndex.of([
    { slug: "github", tools: ["remove", "write_file"] },
    { slug: "notes", tools: ["remove"] },
    { slug: LONGEST_SEGMENT, tools: ["get_portfolio_positions"] },
  ]);

  it("names each server's tool apart, and answers the server and tool of each name", () => {
    expect(index.engineName("github", "remove")).toBe("mcp__github__remove");
    expect(index.engineName("notes", "remove")).toBe("mcp__notes__remove");
    expect(index.ownerOf("mcp__github__remove")).toEqual({ slug: "github", tool: "remove" });
    expect(index.ownerOf("mcp__notes__remove")).toEqual({ slug: "notes", tool: "remove" });
    const fitted = engineToolName(LONGEST_SEGMENT, "get_portfolio_positions");
    expect(index.ownerOf(fitted), "a fitted name maps back without parsing").toEqual({ slug: LONGEST_SEGMENT, tool: "get_portfolio_positions" });
    expect([...index.engineNames()]).toHaveLength(4);
  });

  it("owns no bare name, no built-in and no name it never listed", () => {
    for (const name of ["remove", "write_file", "mcp__github__search", "mcp__other__remove"]) {
      expect(index.ownerOf(name), name).toBeUndefined();
      expect(index.toolOf(name), "a name it does not own is its own tool").toBe(name);
    }
    expect(index.engineName("github", "search")).toBeUndefined();
    expect(index.toolOf("mcp__notes__remove")).toBe("remove");
  });

  it("names tools as Claude Code does, unfitted, when told to", () => {
    const claude = McpToolIndex.of([{ slug: LONGEST_SEGMENT, tools: ["get_portfolio_positions"] }], mcpToolName);
    expect(claude.ownerOf(mcpToolName(LONGEST_SEGMENT, "get_portfolio_positions"))).toEqual({ slug: LONGEST_SEGMENT, tool: "get_portfolio_positions" });
  });

  it("takes a server that lists a tool twice as one tool", () => {
    expect([...McpToolIndex.of([{ slug: "docs", tools: ["search", "search"] }]).engineNames()]).toEqual(["mcp__docs__search"]);
  });

  it("refuses two tools that would take one engine name, naming both", () => {
    // A server whose slug is a fitted name's cut segment and hash: its canonical name is that fitted name.
    const fitted = engineToolName("s".repeat(60), "tool");
    const lookalike = fitted.slice("mcp__".length, fitted.lastIndexOf("__"));
    const servers = [{ slug: "s".repeat(60), tools: ["tool"] }, { slug: lookalike, tools: ["tool"] }];
    expect(mcpToolName(lookalike, "tool")).toBe(fitted);
    expect(() => McpToolIndex.of(servers)).toThrow(McpToolNameCollisionError);
    expect(() => McpToolIndex.of(servers)).toThrow(new RegExp(`'tool' of server '${"s".repeat(60)}'.*'tool' of server '${lookalike}'`));
  });

  it("is empty with no servers", () => {
    expect([...McpToolIndex.EMPTY.engineNames()]).toEqual([]);
    expect(McpToolIndex.EMPTY.ownerOf("mcp__a__b")).toBeUndefined();
  });
});
