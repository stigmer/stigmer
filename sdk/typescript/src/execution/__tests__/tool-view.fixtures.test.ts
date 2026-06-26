// Validates the tool-view layer against the shared cross-language contract in
// test/fixtures/tool-view/. The Go CLI runs the same fixtures, so the two
// surfaces cannot drift in classification or result interpretation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind, resolveToolKindByName, normalizeToolResult } from "../tool-view";

const here = dirname(fileURLToPath(import.meta.url));
// sdk/typescript/src/execution/__tests__ -> repo root is five levels up.
const fixtureDir = resolve(here, "../../../../../test/fixtures/tool-view");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as T;
}

describe("classification fixtures", () => {
  const { cases } = loadFixture<{
    cases: { name: string; mcpServerSlug: string; toolKind: string }[];
  }>("classification.json");

  it("loads the fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    const expected = ToolKind[c.toolKind.replace(/^TOOL_KIND_/, "") as keyof typeof ToolKind];
    it(`classifies ${c.name || "(empty)"}${c.mcpServerSlug ? ` @${c.mcpServerSlug}` : ""}`, () => {
      expect(resolveToolKindByName(c.name, c.mcpServerSlug)).toBe(expected);
    });
  }
});

describe("result-view fixtures", () => {
  interface ResultCase {
    name: string;
    toolName: string;
    mcpServerSlug: string;
    args: Record<string, unknown>;
    result: string;
    error?: string;
    status?: string;
    expected: {
      type: string;
      path?: string;
      exitCode?: number;
      command?: string;
      count?: number;
      mcpServerSlug?: string;
      linesAdded?: number;
      linesRemoved?: number;
    };
  }

  const { cases } = loadFixture<{ cases: ResultCase[] }>("result-views.json");

  it("loads the fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`normalizes ${c.name} -> ${c.expected.type}`, () => {
      const status =
        c.status === "TOOL_CALL_FAILED"
          ? ToolCallStatus.TOOL_CALL_FAILED
          : ToolCallStatus.TOOL_CALL_COMPLETED;

      const toolCall = create(ToolCallSchema, {
        id: c.name,
        name: c.toolName,
        mcpServerSlug: c.mcpServerSlug,
        result: c.result,
        error: c.error ?? "",
        status,
        args: c.args as JsonObject,
      });

      const view = normalizeToolResult(toolCall);
      expect(view.type).toBe(c.expected.type);

      // Only deterministic facts are part of the shared contract.
      if (c.expected.path !== undefined && view.type === "diff") {
        expect(view.path).toBe(c.expected.path);
      }
      if (c.expected.path !== undefined && view.type === "file") {
        expect(view.path).toBe(c.expected.path);
      }
      if (c.expected.exitCode !== undefined && view.type === "terminal") {
        expect(view.exitCode).toBe(c.expected.exitCode);
      }
      if (c.expected.command !== undefined && view.type === "terminal") {
        expect(view.command).toBe(c.expected.command);
      }
      if (c.expected.count !== undefined && view.type === "search") {
        expect(view.count).toBe(c.expected.count);
      }
      if (c.expected.count !== undefined && view.type === "list") {
        expect(view.count).toBe(c.expected.count);
      }
      if (c.expected.mcpServerSlug !== undefined && view.type === "contentBlocks") {
        expect(view.mcpServerSlug).toBe(c.expected.mcpServerSlug);
      }
      if (c.expected.linesAdded !== undefined && view.type === "diff") {
        expect(view.linesAdded).toBe(c.expected.linesAdded);
      }
      if (c.expected.linesRemoved !== undefined && view.type === "diff") {
        expect(view.linesRemoved).toBe(c.expected.linesRemoved);
      }
    });
  }
});

describe("resolveToolKind wire field precedence", () => {
  it("prefers the wire tool_kind over the name fallback", () => {
    const toolCall = create(ToolCallSchema, {
      name: "some_unknown_name",
      toolKind: ToolKind.SHELL,
    });
    // resolveToolKind is exercised indirectly via normalizeToolResult routing.
    const view = normalizeToolResult(
      create(ToolCallSchema, {
        name: "some_unknown_name",
        toolKind: ToolKind.SHELL,
        result: "done\n[Command succeeded]",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
      }),
    );
    expect(view.type).toBe("terminal");
    expect(toolCall.toolKind).toBe(ToolKind.SHELL);
  });

  it("degrades unknown results to json or text", () => {
    const jsonView = normalizeToolResult(
      create(ToolCallSchema, { name: "mystery", result: '{"a":1}', status: ToolCallStatus.TOOL_CALL_COMPLETED }),
    );
    expect(jsonView.type).toBe("json");

    const textView = normalizeToolResult(
      create(ToolCallSchema, { name: "mystery", result: "plain", status: ToolCallStatus.TOOL_CALL_COMPLETED }),
    );
    expect(textView.type).toBe("text");
  });
});
