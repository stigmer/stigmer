// Golden-line tests for the NDJSON renderer: event type strings, payload shape,
// and Go-parity payload cleaning (empty strings dropped, false/0 kept).

import { describe, expect, it } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StreamEvent, ToolCallInfo } from "./events.js";
import { NdjsonRenderer } from "./render-ndjson.js";

const FIXED_TS = "2026-01-01T00:00:00.000Z";

function buffer(): {
  writer: { write(s: string): void };
  raw: () => string;
  lines: () => Array<Record<string, unknown>>;
} {
  let raw = "";
  return {
    writer: { write: (s: string) => void (raw += s) },
    raw: () => raw,
    lines: () =>
      raw
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function renderer(defaultAction = ApprovalAction.SKIP) {
  const data = buffer();
  const status = buffer();
  const r = new NdjsonRenderer({ data: data.writer, status: status.writer, defaultAction, now: () => FIXED_TS });
  return { r, data, status };
}

function toolInfo(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return { id: "", name: "read", status: "running", args: undefined, result: "", error: "", durationMs: 0, ...overrides };
}

function render(events: StreamEvent[], defaultAction = ApprovalAction.SKIP) {
  const ctx = renderer(defaultAction);
  for (const e of events) ctx.r.render(e);
  return ctx;
}

describe("envelope", () => {
  it("wraps each event as {type, ts, payload} and strips empty payload fields", () => {
    const { data } = render([{ kind: "aiStreamDelta", content: "", subAgentId: "" }]);
    const [line] = data.lines();
    expect(line.type).toBe("ai_stream_delta");
    expect(line.ts).toBe(FIXED_TS);
    expect(line.payload).toEqual({});
  });

  it("keeps boolean false and present strings", () => {
    const { data } = render([
      { kind: "approvalNeeded", toolCallId: "t1", toolName: "delete", argsPreview: "", message: "ok", fromSubAgent: false, subAgentName: "" },
    ]);
    const [line] = data.lines();
    expect(line.type).toBe("approval_needed");
    expect(line.payload).toEqual({ tool_call_id: "t1", tool_name: "delete", message: "ok", from_sub_agent: false });
  });
});

describe("tool events", () => {
  it("emits tool_running with only the meaningful fields", () => {
    const { data } = render([
      { kind: "toolRunning", toolCallId: "t1", subAgentId: "", toolCall: toolInfo({ id: "t1", result: "out", durationMs: 42 }) },
    ]);
    expect(data.lines()[0]).toMatchObject({
      type: "tool_running",
      payload: { tool_call_id: "t1", tool_name: "read", status: "running", result: "out", duration_ms: 42 },
    });
  });

  it("includes tool_calls in ai_stream_end, omits when empty", () => {
    const { data } = render([
      { kind: "aiStreamEnd", content: "done", subAgentId: "", toolCalls: [toolInfo({ id: "t1", status: "completed" })] },
      { kind: "aiMessage", content: "x", subAgentId: "", toolCalls: [] },
    ]);
    const [end, msg] = data.lines();
    expect((end.payload as Record<string, unknown>).tool_calls).toEqual([{ name: "read", status: "completed", id: "t1" }]);
    expect((msg.payload as Record<string, unknown>).tool_calls).toBeUndefined();
  });
});

describe("done", () => {
  it("drops an empty error but keeps a present one", () => {
    const { data } = render([
      { kind: "done", phase: "completed", error: "" },
      { kind: "done", phase: "failed", error: "boom" },
    ]);
    const [ok, fail] = data.lines();
    expect(ok.payload).toEqual({ phase: "completed" });
    expect(fail.payload).toEqual({ phase: "failed", error: "boom" });
  });
});

describe("approval policy", () => {
  it("honors the configured default action without warning", () => {
    const { r, status } = renderer(ApprovalAction.APPROVE);
    const action = r.resolveApproval({
      kind: "approvalNeeded", toolCallId: "t1", toolName: "delete", argsPreview: "", message: "", fromSubAgent: false, subAgentName: "",
    });
    expect(action).toBe(ApprovalAction.APPROVE);
    expect(status.lines()).toHaveLength(0);
  });

  it("auto-skips with a stderr warning when no default is set", () => {
    const { r, status } = renderer(ApprovalAction.UNSPECIFIED);
    const action = r.resolveApproval({
      kind: "approvalNeeded", toolCallId: "t1", toolName: "delete", argsPreview: "", message: "", fromSubAgent: false, subAgentName: "",
    });
    expect(action).toBe(ApprovalAction.SKIP);
    expect(status.raw()).toContain("auto-skipping approval for delete");
  });
});
