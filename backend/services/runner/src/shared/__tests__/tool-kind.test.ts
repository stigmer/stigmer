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
import { classifyTool, toolApprovalCategory } from "../tool-kind.js";

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

describe("toolApprovalCategory", () => {
  it("collapses write AND edit (both taxonomies) onto 'write'", () => {
    for (const name of ["write", "write_file", "Write", "edit", "edit_file", "StrReplace", "EditNotebook"]) {
      expect(toolApprovalCategory(name)).toBe("write");
    }
  });

  it("maps the delete and shell aliases to their category", () => {
    for (const name of ["delete", "delete_file", "remove_file", "Delete"]) {
      expect(toolApprovalCategory(name)).toBe("delete");
    }
    for (const name of ["shell", "bash", "execute", "execute_command", "run_command", "terminal", "Shell"]) {
      expect(toolApprovalCategory(name)).toBe("shell");
    }
  });

  it("returns undefined for read-only and unknown built-ins (not gated by category)", () => {
    for (const name of ["read", "ls", "glob", "grep", "search", "think", "totally_unknown"]) {
      expect(toolApprovalCategory(name)).toBeUndefined();
    }
  });
});
