// Pins ALLOW_TOOL_PATTERN (eval-run/allow-tools.ts) to the pattern the eval
// run spec carries: it is read from the proto and compared byte for byte,
// so a change to one copy without the other fails here; and a few entries
// each side of the rule.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOW_TOOL_PATTERN } from "../allow-tools.js";

function protoPattern(relative: string): string {
  const proto = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  const match = /allow_tools[\s\S]*?pattern: "((?:[^"\\]|\\.)*)"/.exec(proto);
  if (match?.[1] === undefined) throw new Error(`no allow_tools pattern in ${relative}`);
  return match[1].replaceAll("\\\\", "\\");
}

describe("ALLOW_TOOL_PATTERN", () => {
  it("is the pattern the eval run spec carries", () => {
    expect(ALLOW_TOOL_PATTERN.source).toBe(protoPattern("../../../../../apis/ai/stigmer/agentic/evalrun/v1/spec.proto"));
  });

  it("accepts Claude tools, specifiers and both MCP forms, and refuses anything else", () => {
    for (const ok of ["Write", "Bash(npm test *)", "Skill", "mcp__*", "mcp__plugin_thermos_github__*", "mcp__tracker__create"]) {
      expect(ALLOW_TOOL_PATTERN.test(ok), ok).toBe(true);
    }
    for (const bad of ["write", "Bash(", "mcp__", "mcp__Tracker__x", ""]) {
      expect(ALLOW_TOOL_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
