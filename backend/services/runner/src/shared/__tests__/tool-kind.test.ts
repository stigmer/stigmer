/**
 * Tool classification tests.
 *
 * Validates classifyTool against the shared cross-language contract in
 * test/fixtures/tool-view/classification.json, so the runner, the SDK fallback
 * resolver, and the Go CLI cannot drift apart.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyTool } from "../tool-kind.js";

const here = dirname(fileURLToPath(import.meta.url));
// runner/src/shared/__tests__ -> repo root is five levels up.
const fixturePath = resolve(
  here,
  "../../../../../../test/fixtures/tool-view/classification.json",
);

interface ClassificationCase {
  name: string;
  mcpServerSlug: string;
  toolKind: keyof typeof ToolKind;
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: ClassificationCase[];
};

describe("classifyTool", () => {
  it("loads the shared classification fixture", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`classifies ${c.name || "(empty)"}${c.mcpServerSlug ? ` @${c.mcpServerSlug}` : ""} as ${c.toolKind}`, () => {
      // Fixture uses the proto enum value name (TOOL_KIND_FILE_EDIT); the
      // generated TS enum strips the prefix (FILE_EDIT), so map across.
      const expected = ToolKind[c.toolKind.replace(/^TOOL_KIND_/, "") as keyof typeof ToolKind];
      expect(classifyTool(c.name, c.mcpServerSlug)).toBe(expected);
    });
  }

  it("returns UNSPECIFIED for an unknown built-in with no slug", () => {
    expect(classifyTool("totally_unknown")).toBe(ToolKind.UNSPECIFIED);
  });

  it("returns MCP for an unknown tool with a slug", () => {
    expect(classifyTool("totally_unknown", "planton")).toBe(ToolKind.MCP);
  });

  it("prefers a built-in name over a slug", () => {
    expect(classifyTool("read", "planton")).toBe(ToolKind.FILE_READ);
  });
});
