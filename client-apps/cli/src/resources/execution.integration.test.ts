// In-process integration test for the `execution` group resources.
//
// Stands up a real Connect backend over h2c serving the agent + workflow
// execution query and command controllers (including the server-streaming
// subscribe / subscribeEvents methods), points an SDK node client at it, and
// drives the resource layer end to end: lifecycle control, approval submission
// (asserting D-EX-1 comment carry + D-EX-2 reviewer-unset), trace rendering, and
// log streaming (workflow event stream + agent snapshot diffing).

import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  GetEventLogResponseSchema,
  type SubmitWorkflowTaskApprovalInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveAgentToolCall, approveWorkflowTask } from "./execution-approve.js";
import { cancelExecution, pauseExecution, resumeExecution, terminateExecution } from "./execution-control.js";
import { streamExecutionLogs } from "./execution-logs.js";
import { traceExecution } from "./execution-trace.js";

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

// Spies for the command-side calls, reset per test.
let agentControl: { verb: string; id: string; reason: string }[] = [];
let workflowControl: { verb: string; id: string; reason: string }[] = [];
let agentApproval: SubmitApprovalInput[] = [];
let workflowApproval: SubmitWorkflowTaskApprovalInput[] = [];

beforeEach(() => {
  agentControl = [];
  workflowControl = [];
  agentApproval = [];
  workflowApproval = [];
});

// A workflow execution with two tasks (one done, one failed) for the trace view.
const workflowExec = create(WorkflowExecutionSchema, {
  metadata: { id: "wex_1", name: "Deploy" },
  status: {
    phase: WorkflowExecutionPhase.EXECUTION_COMPLETED,
    startedAt: "2026-06-12T10:00:00Z",
    completedAt: "2026-06-12T10:01:30Z",
    tasks: [
      { taskName: "build", status: 3, taskType: 1, startedAt: "2026-06-12T10:00:00Z", completedAt: "2026-06-12T10:00:30Z" },
      { taskName: "ship", status: 4, taskType: 1, error: "registry down" },
    ],
  },
});

// An agent execution carrying two messages for the agent log + trace views.
const agentExec = create(AgentExecutionSchema, {
  metadata: { id: "aex_1", name: "Reviewer" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    startedAt: "2026-06-12T10:00:00Z",
    completedAt: "2026-06-12T10:00:20Z",
    messages: [
      { type: MessageType.MESSAGE_HUMAN, content: "do it" },
      { type: MessageType.MESSAGE_AI, content: "done", toolCalls: [{ name: "Shell", result: "ok" }] },
    ],
  },
});

function controlResult(phase: ExecutionPhase) {
  return create(AgentExecutionSchema, { metadata: { id: "aex_1" }, status: { phase } });
}
function workflowControlResult(phase: WorkflowExecutionPhase) {
  return create(WorkflowExecutionSchema, { metadata: { id: "wex_1" }, status: { phase } });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentExecutionQueryController, {
      get: () => agentExec,
      subscribe: async function* () {
        yield create(AgentExecutionSchema, {
          metadata: { id: "aex_1" },
          status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS, messages: [{ type: MessageType.MESSAGE_AI, content: "thinking" }] },
        });
        yield create(AgentExecutionSchema, {
          metadata: { id: "aex_1" },
          status: {
            phase: ExecutionPhase.EXECUTION_COMPLETED,
            messages: [
              { type: MessageType.MESSAGE_AI, content: "thinking" },
              { type: MessageType.MESSAGE_AI, content: "final answer" },
            ],
          },
        });
      },
    });
    router.service(AgentExecutionCommandController, {
      cancel: (req) => (agentControl.push({ verb: "cancel", id: req.id, reason: req.reason }), controlResult(ExecutionPhase.EXECUTION_CANCELLED)),
      terminate: (req) => (agentControl.push({ verb: "terminate", id: req.id, reason: req.reason }), controlResult(ExecutionPhase.EXECUTION_TERMINATED)),
      pause: (req) => (agentControl.push({ verb: "pause", id: req.id, reason: req.reason }), controlResult(ExecutionPhase.EXECUTION_PAUSED)),
      resume: (req) => (agentControl.push({ verb: "resume", id: req.id, reason: "" }), controlResult(ExecutionPhase.EXECUTION_IN_PROGRESS)),
      submitApproval: (req) => (agentApproval.push(req), agentExec),
    });

    router.service(WorkflowExecutionQueryController, {
      get: () => workflowExec,
      getEventLog: () =>
        create(GetEventLogResponseSchema, {
          hasMore: true,
          events: [
            create(WorkflowExecutionEventSchema, {
              eventType: WorkflowEventType.execution_started,
              occurredAt: "2026-06-12T10:00:00Z",
              payload: { case: "executionStarted", value: {} as never },
            }),
          ],
        }),
      subscribeEvents: async function* () {
        yield create(WorkflowExecutionEventSchema, {
          eventType: WorkflowEventType.task_started,
          occurredAt: "2026-06-12T10:00:01Z",
          taskName: "build",
          payload: { case: "taskStarted", value: {} as never },
        });
        yield create(WorkflowExecutionEventSchema, {
          eventType: WorkflowEventType.task_completed,
          occurredAt: "2026-06-12T10:00:05Z",
          taskName: "other",
          payload: { case: "taskCompleted", value: {} as never },
        });
      },
    });
    router.service(WorkflowExecutionCommandController, {
      cancel: (req) => (workflowControl.push({ verb: "cancel", id: req.id, reason: req.reason }), workflowControlResult(WorkflowExecutionPhase.EXECUTION_CANCELLED)),
      terminate: (req) => (workflowControl.push({ verb: "terminate", id: req.id, reason: req.reason }), workflowControlResult(WorkflowExecutionPhase.EXECUTION_TERMINATED)),
      pause: (req) => (workflowControl.push({ verb: "pause", id: req.id, reason: req.reason }), workflowControlResult(WorkflowExecutionPhase.EXECUTION_PAUSED)),
      resume: (req) => (workflowControl.push({ verb: "resume", id: req.id, reason: "" }), workflowControlResult(WorkflowExecutionPhase.EXECUTION_IN_PROGRESS)),
      submitWorkflowTaskApproval: (req) => (workflowApproval.push(req), workflowExec),
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

describe("lifecycle control", () => {
  it("cancels an agent execution and reports the phase", async () => {
    const result = await cancelExecution(client, "aex_1", "no longer needed");
    expect(result).toEqual({ type: "agent", phase: "cancelled" });
    expect(agentControl).toEqual([{ verb: "cancel", id: "aex_1", reason: "no longer needed" }]);
  });

  it("terminates / pauses an agent execution", async () => {
    expect((await terminateExecution(client, "aex_1", "stuck")).phase).toBe("terminated");
    expect((await pauseExecution(client, "aex_1", "")).phase).toBe("paused");
    expect(agentControl.map((c) => c.verb)).toEqual(["terminate", "pause"]);
  });

  it("cancels / resumes a workflow execution", async () => {
    expect((await cancelExecution(client, "wex_1", "")).phase).toBe("cancelled");
    expect((await resumeExecution(client, "wex_1")).phase).toBe("running");
    expect(workflowControl.map((c) => c.verb)).toEqual(["cancel", "resume"]);
  });
});

describe("approval submission", () => {
  it("carries --comment onto the agent SubmitApprovalInput (D-EX-1)", async () => {
    await approveAgentToolCall(client, { executionId: "aex_1", toolCallId: "tc_1", action: "deny", comment: "unsafe" });
    expect(agentApproval).toHaveLength(1);
    expect(agentApproval[0].comment).toBe("unsafe");
    expect(agentApproval[0].toolCallId).toBe("tc_1");
    // "deny" maps to REJECT (3).
    expect(agentApproval[0].action).toBe(3);
  });

  it("leaves the workflow reviewer unset (D-EX-2 — server-attributed)", async () => {
    await approveWorkflowTask(client, { executionId: "wex_1", taskName: "review", outcome: "approve", comment: "lgtm" });
    expect(workflowApproval).toHaveLength(1);
    expect(workflowApproval[0].reviewer).toBe("");
    expect(workflowApproval[0].comment).toBe("lgtm");
    expect(workflowApproval[0].outcome).toBe("approve");
  });
});

describe("trace", () => {
  function capture() {
    const chunks: string[] = [];
    return { streams: { write: (t: string) => chunks.push(t), colorize: false }, text: () => chunks.join("") };
  }

  it("renders a workflow task table", async () => {
    const cap = capture();
    await traceExecution(client, "wex_1", "table", cap.streams);
    const text = cap.text();
    expect(text).toContain("Workflow: Deploy (completed, 1m 30s)");
    expect(text).toContain("[done] build");
    expect(text).toContain("[fail] ship");
    expect(text).toContain("registry down");
  });

  it("renders the agent tool-call timeline", async () => {
    const cap = capture();
    await traceExecution(client, "aex_1", "table", cap.streams);
    expect(cap.text()).toContain("Agent: Reviewer (completed, 20s)");
    expect(cap.text()).toContain("[done] Shell");
  });

  it("emits the full proto envelope for json", async () => {
    const cap = capture();
    await traceExecution(client, "wex_1", "json", cap.streams);
    const json = JSON.parse(cap.text());
    expect(json.metadata.id).toBe("wex_1");
    expect(json.status.tasks).toHaveLength(2);
  });
});

describe("logs", () => {
  function capture() {
    const lines: string[] = [];
    return { streams: { out: { write: (l: string) => lines.push(l) }, colorize: false }, lines };
  }
  const never = new AbortController().signal;

  it("prints the workflow event log with a more-available notice", async () => {
    const cap = capture();
    await streamExecutionLogs(client, { executionId: "wex_1", follow: false }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("execution started");
    expect(text).toContain("more events available");
  });

  it("drains the workflow event stream on --follow with a task filter", async () => {
    const cap = capture();
    await streamExecutionLogs(client, { executionId: "wex_1", follow: true, task: "build" }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("task started: build");
    // "other" task is filtered out.
    expect(text).not.toContain("task completed: other");
    expect(text).toContain("--- stream ended ---");
  });

  it("prints agent messages from a single snapshot when not following", async () => {
    const cap = capture();
    await streamExecutionLogs(client, { executionId: "aex_1", follow: false }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("[human] do it");
    expect(text).toContain("[ai] done");
  });

  it("diffs agent snapshots on --follow and stops on the terminal phase", async () => {
    const cap = capture();
    await streamExecutionLogs(client, { executionId: "aex_1", follow: true }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("[ai] thinking");
    expect(text).toContain("[ai] final answer");
    expect(text).toContain("[end] execution completed");
  });
});
