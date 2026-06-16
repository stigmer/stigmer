import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  FileChangeSchema,
  FileContentSchema,
  type FileChange,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useSessionFileChanges } from "../useSessionFileChanges";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function inlineSide(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function wholeFile(opts: {
  path: string;
  before?: string;
  after?: string;
  changeType?: FileChangeType;
  renameFrom?: string;
}): FileChange {
  return create(FileChangeSchema, {
    path: opts.path,
    changeType: opts.changeType ?? FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: opts.before !== undefined ? inlineSide(opts.before) : undefined,
    after: opts.after !== undefined ? inlineSide(opts.after) : undefined,
    renameFrom: opts.renameFrom ?? "",
  });
}

function hunkOnly(opts: {
  path: string;
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
  changeType?: FileChangeType;
}): FileChange {
  return create(FileChangeSchema, {
    path: opts.path,
    changeType: opts.changeType ?? FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: opts.unifiedDiff,
    linesAdded: opts.linesAdded,
    linesRemoved: opts.linesRemoved,
  });
}

function toolCallWith(id: string, changes: FileChange[]): ToolCall {
  return create(ToolCallSchema, { id, name: "edit_file", fileChanges: changes });
}

function execWith(opts: {
  id: string;
  toolCalls?: ToolCall[];
  subAgentToolCalls?: ToolCall[];
}): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: opts.id });
  const status = create(AgentExecutionStatusSchema);
  if (opts.toolCalls) {
    status.messages = [
      create(AgentMessageSchema, { toolCalls: opts.toolCalls }),
    ];
  }
  if (opts.subAgentToolCalls) {
    status.subAgentExecutions = [
      create(SubAgentExecutionSchema, {
        id: "sub-1",
        messages: [
          create(AgentMessageSchema, { toolCalls: opts.subAgentToolCalls }),
        ],
      }),
    ];
  }
  exec.status = status;
  return exec;
}

function run(executions: readonly AgentExecution[]) {
  return renderHook(() => useSessionFileChanges(executions)).result.current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionFileChanges", () => {
  it("returns empty for no executions", () => {
    const r = run([]);
    expect(r.hasFileChanges).toBe(false);
    expect(r.fileChangeCount).toBe(0);
    expect(r.fileChanges).toEqual([]);
  });

  it("returns empty when executions have no file changes", () => {
    const r = run([execWith({ id: "e1", toolCalls: [toolCallWith("tc1", [])] })]);
    expect(r.hasFileChanges).toBe(false);
  });

  it("collects a single change from a main-thread tool call", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "a", after: "b" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/a.ts");
  });

  it("collects changes nested in sub-agent tool calls", () => {
    const r = run([
      execWith({
        id: "e1",
        subAgentToolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/sub.ts", before: "x", after: "y" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/sub.ts");
  });

  it("net-diffs multiple edits to the same path: first.before -> last.after", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "v0", after: "v1" })]),
          toolCallWith("tc2", [wholeFile({ path: "src/a.ts", before: "v1", after: "v2" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("reconciles create-then-modify on the same path to CREATE", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "src/new.ts", after: "first", changeType: FileChangeType.CREATE }),
          ]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/new.ts", before: "first", after: "second", changeType: FileChangeType.MODIFY }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.CREATE);
    expect(r.fileChanges[0].after?.body.case === "inline" && r.fileChanges[0].after.body.value).toBe("second");
  });

  it("reconciles modify-then-delete on the same path to DELETE", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/x.ts", before: "a", after: "b" })]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/x.ts", before: "b", changeType: FileChangeType.DELETE }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("groups across main thread and sub-agents by path", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/shared.ts", before: "v0", after: "v1" })]),
        ],
        subAgentToolCalls: [
          toolCallWith("tc2", [wholeFile({ path: "src/shared.ts", before: "v1", after: "v2" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("falls back to HUNK_ONLY when net sides are not both whole-file", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            hunkOnly({ path: "src/h.ts", unifiedDiff: "@@ -1 +1 @@\n-a\n+b", linesAdded: 1, linesRemoved: 1 }),
          ]),
          toolCallWith("tc2", [
            hunkOnly({ path: "src/h.ts", unifiedDiff: "@@ -1 +1 @@\n-b\n+c", linesAdded: 2, linesRemoved: 1 }),
          ]),
        ],
      }),
    ]);
    const net = r.fileChanges[0];
    expect(net.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
    expect(net.unifiedDiff).toBe("@@ -1 +1 @@\n-b\n+c");
    expect(net.linesAdded).toBe(2);
  });

  it("passes through a single change untouched (no synthesis)", () => {
    const original = wholeFile({ path: "src/a.ts", before: "a", after: "b" });
    const r = run([
      execWith({ id: "e1", toolCalls: [toolCallWith("tc1", [original])] }),
    ]);
    expect(r.fileChanges[0]).toBe(original);
  });

  it("sorts modified before created/renamed before deleted, then alpha", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "z-del.ts", before: "x", changeType: FileChangeType.DELETE }),
            wholeFile({ path: "a-new.ts", after: "x", changeType: FileChangeType.CREATE }),
            wholeFile({ path: "m-mod.ts", before: "x", after: "y", changeType: FileChangeType.MODIFY }),
            wholeFile({ path: "b-mod.ts", before: "x", after: "y", changeType: FileChangeType.MODIFY }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges.map((c) => c.path)).toEqual([
      "b-mod.ts",
      "m-mod.ts",
      "a-new.ts",
      "z-del.ts",
    ]);
  });

  it("preserves referential stability across re-renders for the same executions", () => {
    const executions = [
      execWith({
        id: "e1",
        toolCalls: [toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "a", after: "b" })])],
      }),
    ];
    const { result, rerender } = renderHook(
      (e: readonly AgentExecution[]) => useSessionFileChanges(e),
      { initialProps: executions },
    );
    const first = result.current;
    rerender(executions);
    expect(result.current).toBe(first);
  });
});
