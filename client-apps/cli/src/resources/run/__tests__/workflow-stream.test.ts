// In-process test for live `run workflow` streaming.
//
// Stands up a real Connect backend serving workflowExecution.subscribeEvents
// (the canonical event stream) plus get + submitApproval, points an SDK node
// client at it, and drives streamWorkflowExecution end to end: NDJSON vs inline
// rendering (D-WF-1), policy-driven approval submission on approval_requested,
// terminal-event stop, and the final-Get epilogue summary. Then, against a
// scripted event source, that the subscription never outlives the stream: it
// is read to its end after the terminal event, cancelled when a server keeps
// it open past the grace period, and its signal aborted on every way out
// (#1625, the agent path's #1522).

import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  type WorkflowExecutionEvent,
  WorkflowExecutionEventSchema,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { SubmitWorkflowApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBSCRIPTION_DRAIN_GRACE_MS } from "../../stream/headless.js";
import { streamWorkflowExecution, type WorkflowStreamStreams } from "../workflow-stream.js";

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();
let approvals: SubmitWorkflowApprovalInput[] = [];

beforeEach(() => {
  approvals = [];
});

// Final state returned by the epilogue Get: one task done, one failed.
const finalExec = create(WorkflowExecutionSchema, {
  metadata: { id: "wex_1", name: "Deploy" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    startedAt: "2026-06-12T10:00:00Z",
    completedAt: "2026-06-12T10:01:30Z",
    tasks: [
      { taskName: "build", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
      { taskName: "ship", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED },
    ],
  },
});

function event(type: WorkflowEventType, payload: WorkflowExecutionEvent["payload"], taskName = "") {
  return create(WorkflowExecutionEventSchema, { eventType: type, occurredAt: "2026-06-12T10:00:01Z", taskName, payload });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(WorkflowExecutionQueryController, {
      get: () => finalExec,
      subscribeEvents: async function* () {
        yield event(WorkflowEventType.execution_started, { case: "executionStarted", value: {} as never });
        yield event(WorkflowEventType.task_started, { case: "taskStarted", value: {} as never }, "build");
        yield event(
          WorkflowEventType.approval_requested,
          { case: "approvalRequested", value: { toolCallId: "tc_99", prompt: "delete prod?" } as never },
          "ship",
        );
        yield event(WorkflowEventType.execution_completed, { case: "executionCompleted", value: {} as never });
      },
    });
    router.service(WorkflowExecutionCommandController, {
      submitApproval: (req) => (approvals.push(req), finalExec),
    });
  };

  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

function capture(): { streams: WorkflowStreamStreams; data: () => string; status: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: { data: (l) => out.push(l), status: (l) => err.push(l), colorize: false },
    data: () => out.join(""),
    status: () => err.join("\n"),
  };
}

describe("live run workflow streaming", () => {
  it("renders inline plaintext, auto-resolves approval, and prints the epilogue", async () => {
    const cap = capture();
    const result = await streamWorkflowExecution(
      { client, executionId: "wex_1", outputMode: "inline", defaultAction: ApprovalAction.APPROVE },
      cap.streams,
    );

    const data = cap.data();
    expect(data).toContain("execution started");
    expect(data).toContain("task started: build");
    expect(data).toContain("approval requested: ship — delete prod?");
    expect(data).toContain("execution completed");

    // Policy resolved the approval: one submit with the right tool call + action.
    expect(approvals).toHaveLength(1);
    expect(approvals[0].toolCallId).toBe("tc_99");
    expect(approvals[0].action).toBe(ApprovalAction.APPROVE);
    expect(cap.status()).toContain("Approval auto-resolved (approve) for tc_99");

    // Epilogue summary from the final Get.
    expect(cap.status()).toContain("Workflow completed");
    expect(cap.status()).toContain("1 completed");
    expect(cap.status()).toContain("1 failed");
    expect(result.metadata?.id).toBe("wex_1");
  });

  it("emits NDJSON event envelopes with canonical type names (D-WF-1)", async () => {
    const cap = capture();
    await streamWorkflowExecution(
      { client, executionId: "wex_1", outputMode: "json", defaultAction: ApprovalAction.APPROVE },
      cap.streams,
    );

    const lines = cap.data().trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((e) => e.type)).toEqual([
      "execution_started",
      "task_started",
      "approval_requested",
      "execution_completed",
    ]);
    const approval = lines.find((e) => e.type === "approval_requested");
    expect(approval.payload.task).toBe("ship");
  });

  it("leaves the approval for the user when no policy is configured", async () => {
    const cap = capture();
    await streamWorkflowExecution(
      { client, executionId: "wex_1", outputMode: "inline", defaultAction: ApprovalAction.UNSPECIFIED },
      cap.streams,
    );

    expect(approvals).toHaveLength(0);
    expect(cap.status()).toContain("stigmer execution approve wex_1 --tool-call tc_99 --action approve");
  });
});

/** A client whose event stream is `events(signal)`, with the final Get the epilogue reads. */
function scriptedClient(events: (signal: AbortSignal) => AsyncIterable<WorkflowExecutionEvent>): Stigmer {
  const workflowExecution = {
    subscribeEvents: (_request: unknown, signal: AbortSignal) => events(signal),
    get: async () => finalExec,
    submitApproval: async () => finalExec,
  };
  return { workflowExecution } as unknown as Stigmer;
}

const started = () => event(WorkflowEventType.execution_started, { case: "executionStarted", value: {} as never });
const completed = () => event(WorkflowEventType.execution_completed, { case: "executionCompleted", value: {} as never });

describe("the subscription never outlives the stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the stream to its end after the terminal event, rendering nothing more", async () => {
    const cap = capture();
    let readToEnd = false;
    const client = scriptedClient(async function* () {
      yield started();
      yield completed();
      yield event(WorkflowEventType.task_started, { case: "taskStarted", value: {} as never }, "late");
      readToEnd = true;
    });
    await streamWorkflowExecution({ client, executionId: "wex_1", outputMode: "json", defaultAction: ApprovalAction.UNSPECIFIED }, cap.streams);
    expect(readToEnd).toBe(true);
    expect(cap.data().trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["execution_started", "execution_completed"]);
    expect(cap.status()).toContain("Workflow completed");
  });

  it("is cancelled when the server keeps it open past the grace period, and the run's summary stands", async () => {
    vi.useFakeTimers();
    const cap = capture();
    let given: AbortSignal | undefined;
    const client = scriptedClient(async function* (signal) {
      given = signal;
      yield completed();
      await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
      );
    });
    const running = streamWorkflowExecution(
      { client, executionId: "wex_1", outputMode: "inline", defaultAction: ApprovalAction.UNSPECIFIED },
      cap.streams,
    );
    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_DRAIN_GRACE_MS - 1);
    expect(given?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await running;
    expect(given?.aborted).toBe(true);
    expect(result.metadata?.id).toBe("wex_1");
    expect(cap.status()).toContain("Workflow completed");
  });

  it.each([
    ["a terminal event", () => [started(), completed()]],
    ["a stream that ends first", () => [started()]],
  ])("aborts its signal once the stream ends on %s", async (_label, script) => {
    let given: AbortSignal | undefined;
    const client = scriptedClient(async function* (signal) {
      given = signal;
      yield* script();
    });
    await streamWorkflowExecution({ client, executionId: "wex_1", outputMode: "json", defaultAction: ApprovalAction.UNSPECIFIED }, capture().streams);
    expect(given?.aborted).toBe(true);
  });

  it("still fails on a stream error before the terminal event", async () => {
    const client = scriptedClient(async function* () {
      yield started();
      throw new Error("the stream dropped");
    });
    await expect(
      streamWorkflowExecution({ client, executionId: "wex_1", outputMode: "json", defaultAction: ApprovalAction.UNSPECIFIED }, capture().streams),
    ).rejects.toThrow("the stream dropped");
  });
});
