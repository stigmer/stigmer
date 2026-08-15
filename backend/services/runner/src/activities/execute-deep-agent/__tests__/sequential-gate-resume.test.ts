/**
 * Regression: two SEQUENTIAL approval gates under the ephemeral memory
 * checkpointer (the OSS local / desktop default — config.ts resolves
 * `checkpointerType: "memory"`).
 *
 * Unlike the durable (http) checkpointer — which resumes via Command(resume) and
 * re-emits only post-checkpoint events — the memory checkpointer is recreated
 * empty every invocation (factory.ts), so the Temporal workflow's post-approval
 * re-invocation REPLAYS the graph from scratch. The langgraph input is just the
 * original user message (setup.ts), and the blind-FIFO mock LLM advances exactly
 * one gate per invocation, so the replay reaches the NEXT gate (gate B) directly.
 *
 * The defect this pins: on that gate-B re-invocation the live checkpoint is
 * empty, so a status rebuilt from an empty proto emits a transcript that holds
 * ONLY gate B and silently drops gate A's already-committed tool-call id. The
 * server's append-only-at-identity guard (update_status.go
 * nonTerminalTranscriptRegression) then rejects the update and keeps the old
 * messages, but projects pending_approvals from those kept messages — gate A is
 * already decided, so pending=0, and WAITING_FOR_APPROVAL + pending=0 makes the
 * workflow auto-resume, skipping gate B. The fix seeds the status from the
 * persisted transcript whenever the execution already has history, so gate B's
 * update is a superset of gate A rather than a replacement.
 *
 * This test exercises BOTH invocations through the real activity, asserting the
 * gate-A tool call survives into the gate-B update — the single behavior that,
 * if regressed, reintroduces the silent skip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { create, clone } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";
import type { Config } from "../../../config.js";
import type { SetupResult } from "../setup.js";

// The Temporal activity context is unavailable outside a worker.
vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      // A real AbortSignal: the workspace-lock wait registers abort listeners
      // on it, which a bare `{ aborted: false }` stub cannot satisfy.
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
      info: { taskQueue: "test-queue" },
    }),
  },
  CancelledFailure: class CancelledFailure extends Error {},
}));

vi.mock("../../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

// Capture every persisted status (the gRPC chokepoint) for assertions.
const { persistedStatuses } = vi.hoisted(() => ({
  persistedStatuses: [] as AgentExecutionStatus[],
}));

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn(async (_id: string, status: AgentExecutionStatus) => {
      // Snapshot point-in-time: persistStatus mutates the same object in place.
      persistedStatuses.push(clone(AgentExecutionStatusSchema, status));
      return { signal: 0 };
    }),
    getExecution: vi.fn(),
  })),
}));

// performSetup is mocked per-invocation to return a fake memory-replay SetupResult.
vi.mock("../setup.js", () => ({ performSetup: vi.fn() }));

import { createDeepAgentActivities } from "../index.js";
import { performSetup } from "../setup.js";

const GATE_A_ID = "toolu_gate_a";
const GATE_B_ID = "toolu_gate_b";

function v3Event(
  seq: number,
  method: string,
  data: unknown,
  namespace: string[] = [],
): V3ProtocolEvent {
  return {
    type: "event",
    seq,
    method,
    params: { namespace, timestamp: Date.now(), data },
  };
}

/**
 * Events for a replayed turn that proposes a gated tool but pauses BEFORE
 * execution. The model turn commits no transcript message (no text/tool deltas);
 * the gated tool call is authored downstream by the activity from the pending
 * interrupt, matching the live e2e's single-tool gate update. Two events keep the
 * v3 loop from erroring on an empty stream.
 */
function gateTurnEvents(): V3ProtocolEvent[] {
  return [
    v3Event(0, "messages", { event: "message-start", run_id: "g1" }),
    v3Event(1, "messages", { event: "message-finish", run_id: "g1" }),
  ];
}

function mockV3Run(events: V3ProtocolEvent[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    output: Promise.resolve({ messages: [] }),
    abort: vi.fn(),
    signal: new AbortController().signal,
  };
}

/** The empty live checkpoint a freshly-recreated MemorySaver reports pre-stream. */
const EMPTY_REPLAY_STATE = { values: { messages: [] as unknown[] }, tasks: [] };

/** The paused graph state after the replayed stream reaches the next gate. */
function gatedGraphState(toolCallId: string, toolName: string, filePath: string) {
  return {
    values: {
      messages: [{
        role: "assistant",
        content: "",
        tool_calls: [{ id: toolCallId, name: toolName, args: { file_path: filePath, content: "x\n" } }],
      }],
    },
    tasks: [{
      id: "task-gate",
      interrupts: [{
        value: {
          tool_call_id: toolCallId,
          tool_name: toolName,
          message: `Execute ${toolName}`,
        },
        resumeValue: undefined,
      }],
    }],
  };
}

/**
 * A memory-checkpointer invocation that replays from scratch and re-pauses at a
 * single gate: getState reports an empty live checkpoint before the stream and a
 * pending interrupt after it.
 */
function fakeMemoryGateSetup(opts: {
  gateId: string;
  gateName: string;
  filePath: string;
  executionStatus: AgentExecutionStatus;
}): SetupResult {
  let streamed = false;
  const gated = gatedGraphState(opts.gateId, opts.gateName, opts.filePath);

  const agentGraph = {
    getState: vi.fn(async () => (streamed ? gated : EMPTY_REPLAY_STATE)),
    streamEvents: vi.fn(async () => {
      streamed = true;
      return mockV3Run(gateTurnEvents());
    }),
  };

  return {
    agentGraph,
    langgraphConfig: { configurable: { thread_id: "thread-seq" } },
    langgraphInput: { messages: [{ role: "user", content: "Write A then B" }] },
    execution: {
      spec: { message: "Write file A, then write file B." },
      status: opts.executionStatus,
    },
    agent: {},
    session: { spec: { workspaceEntries: [] } },
    workspaceBackend: {
      // Unique per test file: the workspace turn lock keys on this path, and a
      // path shared across files would serialize parallel test workers for real.
      rootDir: "/tmp/stigmer-test-ws-seq-gate",
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ""),
    },
    mcpConnection: null,
    mergedEnvVars: {},
    secretKeys: new Set<string>(),
    modelName: "claude-sonnet",
    gracefulStop: undefined,
    artifactStorage: makeInMemoryArtifactStorage({ urlBase: "https://artifacts.local/" }).storage,
    provisionResults: [],
    approvalPolicies: new Map(),
    toolServerMap: new Map(),
    leasedCategories: new Set(),
    globalBypass: false,
    hasStructuredOutput: false,
    streamVersion: "v3",
  } as unknown as SetupResult;
}

/** Run-1 transcript persisted on the execution, with the user's APPROVE recorded. */
function approvedGateAStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    startedAt: "2026-06-20T00:00:00.000Z",
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "",
        timestamp: "2026-06-20T00:00:01.000Z",
        toolCalls: [
          create(ToolCallSchema, {
            id: GATE_A_ID,
            name: "write_file",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalMessage: "Execute write_file",
            // The user approved gate A; SubmitApproval records the decision on
            // the persisted transcript (status stays WAITING_APPROVAL until the
            // resumed tool runs), which is what re-invokes the activity.
            approvalAction: ApprovalAction.APPROVE,
          }),
        ],
      }),
    ],
  });
}

const memoryConfig: Config = {
  taskQueue: "test-queue",
  temporalAddress: "localhost:7233",
  temporalNamespace: "default",
  stigmerBackendEndpoint: "http://localhost:7234",
  mcpBridgeEndpoint: null,
  stigmerToken: null,
  cursorApiKey: "",
  workspaceRootDir: "/tmp/test",
  mode: "local",
  proxyEndpoint: null,
  maxConcurrentActivities: 5,
  idleTimeoutSeconds: null,
  cloudModeEnabled: false,
  checkpointerType: "memory",
  checkpointerProxyEndpoint: null,
  primaryModel: "claude-sonnet",
  cursorStreamStallTimeoutMs: 180000,
  agentResolveTimeoutMs: 120000,
  workspaceLockTimeoutMs: 900000,
};

function toolCallIds(status: AgentExecutionStatus): string[] {
  return status.messages.flatMap(m => m.toolCalls).map(tc => tc.id);
}

describe("ExecuteDeepAgent — sequential gates under the memory checkpointer", () => {
  beforeEach(() => {
    persistedStatuses.length = 0;
    vi.mocked(performSetup).mockReset();
  });

  it("preserves gate A's committed tool call when resuming into gate B", async () => {
    const activities = createDeepAgentActivities(memoryConfig);

    // ── Invocation 1: first run reaches gate A (no prior history to seed). ──
    vi.mocked(performSetup).mockResolvedValueOnce(
      fakeMemoryGateSetup({
        gateId: GATE_A_ID,
        gateName: "write_file",
        filePath: "a.txt",
        executionStatus: create(AgentExecutionStatusSchema, {}),
      }),
    );
    await activities.ExecuteDeepAgent("exec-seq", "thread-seq");

    const afterGateA = persistedStatuses.at(-1)!;
    expect(afterGateA.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    expect(toolCallIds(afterGateA)).toContain(GATE_A_ID);

    // ── User approves gate A; the server records the decision on the persisted
    //    transcript. The next invocation re-invocation reads this status. ──
    const approved = clone(AgentExecutionStatusSchema, afterGateA);
    for (const m of approved.messages) {
      for (const tc of m.toolCalls) {
        if (tc.id === GATE_A_ID) tc.approvalAction = ApprovalAction.APPROVE;
      }
    }

    // ── Invocation 2: re-invoked after approval. The memory checkpointer replays
    //    from scratch (empty live checkpoint) and the mock serves gate B. ──
    persistedStatuses.length = 0;
    vi.mocked(performSetup).mockResolvedValueOnce(
      fakeMemoryGateSetup({
        gateId: GATE_B_ID,
        gateName: "write_file",
        filePath: "b.txt",
        executionStatus: approved,
      }),
    );
    await activities.ExecuteDeepAgent("exec-seq", "thread-seq");

    const afterGateB = persistedStatuses.at(-1)!;
    const ids = toolCallIds(afterGateB);

    // Gate B is the new pending approval.
    expect(afterGateB.phase).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    expect(ids.filter(id => id === GATE_B_ID)).toHaveLength(1);

    // The regression guard: gate A's committed tool call survives the resume.
    // Dropping it lets the server guard reject the update and project pending=0,
    // which auto-resumes the workflow and silently skips gate B.
    expect(ids).toContain(GATE_A_ID);
  });

  /** A status that is a strict superset of the persisted transcript is what the
   *  server's append-only-at-identity guard accepts (no committed id dropped). */
  it("emits a gate-B transcript that is a superset of the persisted gate-A transcript", async () => {
    const activities = createDeepAgentActivities(memoryConfig);

    const approved = approvedGateAStatus();
    const priorIds = toolCallIds(approved);

    vi.mocked(performSetup).mockResolvedValueOnce(
      fakeMemoryGateSetup({
        gateId: GATE_B_ID,
        gateName: "write_file",
        filePath: "b.txt",
        executionStatus: approved,
      }),
    );
    await activities.ExecuteDeepAgent("exec-seq", "thread-seq");

    const afterGateB = persistedStatuses.at(-1)!;
    const ids = new Set(toolCallIds(afterGateB));

    // Every previously-committed tool-call id is still present (no drop), and the
    // transcript did not shrink — exactly the two regressions the server guard
    // rejects (update_status.go nonTerminalTranscriptRegression).
    for (const id of priorIds) {
      expect(ids.has(id)).toBe(true);
    }
    expect(afterGateB.messages.length).toBeGreaterThanOrEqual(approved.messages.length);
  });
});
