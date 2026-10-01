// Tests for the headless stream driver: terminal result propagation, approval
// auto-resolution + submission, submit-failure → stream_error, clean abort, and
// the subscription cancelled on every way out (#1522).

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { ApprovalNeededEvent, StreamEvent } from "../events.js";
import { type HeadlessRenderer, runHeadlessStream, SUBSCRIPTION_DRAIN_GRACE_MS } from "../headless.js";

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

  // The subscription's signal is what cancels the call, and so what releases
  // the HTTP/2 stream a terminal snapshot leaves unread (#1522). Recorded for
  // each way out: a terminal snapshot, a permanent submit failure, a stream
  // that ends without one.
  it.each([
    ["a terminal snapshot", [snapshot(ExecutionPhase.EXECUTION_COMPLETED)], false],
    [
      "a permanent submit failure",
      [snapshot(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, { waiting: true })],
      true,
    ],
    ["a stream that ends first", [snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS)], false],
  ])("cancels the subscription once the drive ends on %s", async (_label, snapshots, submitFails) => {
    let given: AbortSignal | undefined;
    const inner = source(snapshots);
    await runHeadlessStream({
      subscribe: (signal) => {
        given = signal;
        return inner(signal);
      },
      submitApproval: async () => {
        if (submitFails) throw new ConnectError("nope", Code.InvalidArgument);
      },
      renderer: new RecordingRenderer(),
      sessionId: "ses_1",
      signal: new AbortController().signal,
    });
    expect(given?.aborted).toBe(true);
  });

  it("reads the stream to its end after the terminal snapshot, rendering nothing more", async () => {
    const renderer = new RecordingRenderer();
    let readToEnd = false;
    const result = await runHeadlessStream({
      subscribe: async function* () {
        yield snapshot(ExecutionPhase.EXECUTION_COMPLETED);
        yield snapshot(ExecutionPhase.EXECUTION_COMPLETED);
        readToEnd = true;
      },
      submitApproval: async () => {},
      renderer,
      sessionId: "ses_1",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ phase: "completed", error: "" });
    expect(readToEnd).toBe(true);
    expect(renderer.kinds.filter((kind) => kind === "done")).toHaveLength(1);
  });

  describe("a server that keeps the stream open after the terminal phase", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is cancelled after the grace period, and the terminal result stands", async () => {
      vi.useFakeTimers();
      let given: AbortSignal | undefined;
      const running = runHeadlessStream({
        subscribe: async function* (signal) {
          given = signal;
          yield snapshot(ExecutionPhase.EXECUTION_COMPLETED);
          await new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
          );
        },
        submitApproval: async () => {},
        renderer: new RecordingRenderer(),
        sessionId: "ses_1",
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_DRAIN_GRACE_MS - 1);
      expect(given?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await running).toEqual({ phase: "completed", error: "" });
      expect(given?.aborted).toBe(true);
    });
  });

  it("passes the caller's abort through to the subscription", async () => {
    const controller = new AbortController();
    let given: AbortSignal | undefined;
    const running = runHeadlessStream({
      subscribe: async function* (signal) {
        given = signal;
        yield snapshot(ExecutionPhase.EXECUTION_IN_PROGRESS);
        await new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
        );
      },
      submitApproval: async () => {},
      renderer: new RecordingRenderer(),
      sessionId: "ses_1",
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(given?.aborted).toBe(false);
    controller.abort();
    expect(await running).toEqual({ phase: "", error: "" });
    expect(given?.aborted).toBe(true);
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
