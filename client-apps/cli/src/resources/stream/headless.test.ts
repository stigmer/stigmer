// Tests for the headless stream driver: terminal result propagation, approval
// auto-resolution + submission, submit-failure → stream_error, clean abort.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalNeededEvent, StreamEvent } from "./events.js";
import { type HeadlessRenderer, runHeadlessStream } from "./headless.js";

function snapshot(phase: ExecutionPhase, opts: { waiting?: boolean } = {}): AgentExecution {
  const toolCalls = opts.waiting
    ? [create(ToolCallSchema, { id: "t1", name: "delete", status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL })]
    : [];
  return create(AgentExecutionSchema, {
    status: create(AgentExecutionStatusSchema, {
      phase,
      messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "hi", toolCalls })],
      pendingApprovals: opts.waiting ? [create(PendingApprovalSchema, { toolCallId: "t1", toolName: "delete" })] : [],
    }),
  });
}

function source(snapshots: AgentExecution[]): (signal: AbortSignal) => AsyncIterable<AgentExecution> {
  return async function* (signal: AbortSignal) {
    for (const s of snapshots) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      yield s;
    }
  };
}

class RecordingRenderer implements HeadlessRenderer {
  readonly kinds: string[] = [];
  constructor(private readonly action: ApprovalAction = ApprovalAction.SKIP) {}
  render(event: StreamEvent): void {
    this.kinds.push(event.kind);
  }
  resolveApproval(_event: ApprovalNeededEvent): ApprovalAction {
    return this.action;
  }
}

describe("runHeadlessStream", () => {
  it("drives to a terminal done and returns the phase", async () => {
    const renderer = new RecordingRenderer();
    const result = await runHeadlessStream({
      subscribe: source([snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS), snapshot(ExecutionPhase.EXECUTION_COMPLETED)]),
      submitApproval: async () => {},
      renderer,
      sessionId: "ses_1",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ phase: "completed", error: "" });
    expect(renderer.kinds).toContain("done");
  });

  it("resolves and submits an approval, then completes", async () => {
    const renderer = new RecordingRenderer(ApprovalAction.SKIP);
    const submitted: Array<{ id: string; action: ApprovalAction }> = [];
    const result = await runHeadlessStream({
      subscribe: source([
        snapshot(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, { waiting: true }),
        snapshot(ExecutionPhase.EXECUTION_COMPLETED),
      ]),
      submitApproval: async (id, action) => void submitted.push({ id, action }),
      renderer,
      sessionId: "ses_1",
      signal: new AbortController().signal,
    });
    expect(submitted).toEqual([{ id: "t1", action: ApprovalAction.SKIP }]);
    expect(renderer.kinds).toContain("approvalNeeded");
    expect(result.phase).toBe("completed");
  });

  it("renders a stream_error and stops when submission fails permanently", async () => {
    const renderer = new RecordingRenderer();
    const result = await runHeadlessStream({
      subscribe: source([
        snapshot(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, { waiting: true }),
        snapshot(ExecutionPhase.EXECUTION_COMPLETED),
      ]),
      submitApproval: async () => {
        throw new ConnectError("nope", Code.InvalidArgument);
      },
      renderer,
      sessionId: "ses_9",
      signal: new AbortController().signal,
    });
    expect(renderer.kinds).toContain("streamError");
    expect(result.error).toContain("Failed to submit approval");
    expect(result.error).toContain("stigmer resume ses_9");
  });

  it("exits cleanly when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runHeadlessStream({
      subscribe: source([snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS)]),
      submitApproval: async () => {},
      renderer: new RecordingRenderer(),
      sessionId: "",
      signal: controller.signal,
    });
    expect(result).toEqual({ phase: "", error: "" });
  });
});
