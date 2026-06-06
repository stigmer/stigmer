import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolKind } from "@stigmer/sdk";
import { useToolPresentation, registerToolPresenter } from "../tool-presenter";

function makeToolCall(opts: {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  mcpServerSlug?: string;
  status?: ToolCallStatus;
}) {
  return create(ToolCallSchema, {
    id: opts.name,
    name: opts.name,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    mcpServerSlug: opts.mcpServerSlug ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

describe("useToolPresentation", () => {
  it("classifies a Cursor PascalCase edit tool (the bug this fixes)", () => {
    const tc = makeToolCall({
      name: "StrReplace",
      args: { path: "/x.ts", old_string: "a", new_string: "b" },
      result: '{"status":"success","value":{"linesAdded":1,"linesRemoved":1}}',
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe(ToolKind.FILE_EDIT);
    expect(result.current.category).toBe("edit");
    expect(result.current.label).toBe("Edit");
    expect(result.current.result.type).toBe("diff");
    expect(result.current.resultSummary).toBe("+1 -1");
  });

  it("summarizes a failed shell exit code", () => {
    const tc = makeToolCall({
      name: "Shell",
      args: { command: "false" },
      result: "oops\n[Command failed with exit code 3]",
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe(ToolKind.SHELL);
    expect(result.current.result.type).toBe("terminal");
    expect(result.current.resultSummary).toBe("exit 3");
  });

  it("extracts the primary argument", () => {
    const tc = makeToolCall({ name: "Shell", args: { command: "ls -la" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.primaryArg).toBe("ls -la");
  });

  it("honors a registered custom presenter override and restores on dispose", () => {
    const dispose = registerToolPresenter(ToolKind.SHELL, {
      label: () => "Run command",
    });
    try {
      const tc = makeToolCall({ name: "Shell", args: { command: "ls" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.label).toBe("Run command");
    } finally {
      dispose();
    }

    // After dispose, the default label is restored — no global leakage.
    const tc = makeToolCall({ name: "Shell", args: { command: "ls" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.label).toBe("Shell");
  });
});
