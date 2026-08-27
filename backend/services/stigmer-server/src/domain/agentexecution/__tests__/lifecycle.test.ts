/**
 * Lifecycle RPC tests — ports lifecycle_cancel_cascade_test.go,
 * lifecycle_concurrency_test.go, and terminate_existing_workflow_step_test.go,
 * plus the pipeline-level behavior Go asserts through conformance:
 *
 *   - applyLifecyclePhaseTransition: the pure mutation inside the atomic
 *     persist closure — terminal cascade (sub-agents, tool-call settle
 *     #207, pending clear), PAUSED non-terminality, recover's error clear;
 *   - the five pipelines over a real SQLite store with a stub engine:
 *     phase refusals, idempotent already-in-target, NotFound, the
 *     disconnected-engine refusal, warn-and-proceed on workflow-not-found,
 *     and recover's full terminate → EC-recreate → fresh-start chain;
 *   - the pause/decision-append race: the lifecycle persist rides
 *     store.updateResource under the write lock, so a concurrent approval
 *     append is never clobbered (the Go 50-iteration regression).
 */
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ApprovalEventType,
  ExecutionPhase,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  CancelAgentExecutionInput,
  PauseAgentExecutionInput,
  RecoverAgentExecutionInput,
  ResumeAgentExecutionInput,
  TerminateAgentExecutionInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  CancelAgentExecutionInputSchema,
  PauseAgentExecutionInputSchema,
  RecoverAgentExecutionInputSchema,
  ResumeAgentExecutionInputSchema,
  TerminateAgentExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { AgentExecutionStatusTransition } from "../../../extensions/status-hooks.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { ManagedEnvironmentService } from "../../mcpserver/oauth/managed-env.js";

import {
  ensureApprovalRequests,
  recordDecisionEvent,
} from "../approval/author.js";
import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import type {
  ConnectedExecutionEngine,
  ExecutionEngineState,
} from "../engine.js";
import { EngineWorkflowNotFoundError } from "../engine.js";
import type { LifecycleDeps } from "../lifecycle.js";
import {
  applyLifecyclePhaseTransition,
  cancelInProgressSubAgents,
  cancelExecution,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { StreamBroker } from "../stream-broker.js";
import { stubConnectedEngine } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-lifecycle-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function subAgent(init: {
  id: string;
  status: SubAgentStatus;
  completedAt?: string;
}): SubAgentExecution {
  return create(SubAgentExecutionSchema, init);
}

describe("cancelInProgressSubAgents", () => {
  it("cascades in-flight, preserves terminal and preexisting timestamps", () => {
    const subAgents = [
      subAgent({ id: "a", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS }),
      subAgent({ id: "b", status: SubAgentStatus.SUB_AGENT_PENDING }),
      subAgent({
        id: "c",
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
        completedAt: "2026-01-01T00:00:00Z",
      }),
      subAgent({
        id: "d",
        status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
        completedAt: "preexisting",
      }),
    ];

    cancelInProgressSubAgents(subAgents, "2026-06-05T00:00:00Z");

    // IN_PROGRESS -> CANCELLED, completed_at filled in.
    expect(subAgents[0]?.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(subAgents[0]?.completedAt).toBe("2026-06-05T00:00:00Z");
    // PENDING -> CANCELLED.
    expect(subAgents[1]?.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    // COMPLETED is terminal — untouched.
    expect(subAgents[2]?.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(subAgents[2]?.completedAt).toBe("2026-01-01T00:00:00Z");
    // Cancelled but the preexisting timestamp is preserved.
    expect(subAgents[3]?.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(subAgents[3]?.completedAt).toBe("preexisting");
  });

  it("is safe on an empty list and on undefined elements (Go NilSafe)", () => {
    expect(() =>
      cancelInProgressSubAgents([], "2026-06-05T00:00:00Z"),
    ).not.toThrow();
    expect(() =>
      cancelInProgressSubAgents(
        [undefined] as unknown as SubAgentExecution[],
        "2026-06-05T00:00:00Z",
      ),
    ).not.toThrow();
  });
});

// An IN_PROGRESS execution carrying every field the transition can touch,
// so each case asserts both what changes and what is left alone.
function newTransitionFixture(): AgentExecution {
  return create(AgentExecutionSchema, {
    status: {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      completedAt: "2026-01-01T00:00:00Z",
      error: "preexisting error",
      messages: [
        {
          toolCalls: [
            { id: "tc-running", status: ToolCallStatus.TOOL_CALL_RUNNING },
            { id: "tc-done", status: ToolCallStatus.TOOL_CALL_COMPLETED },
          ],
        },
      ],
      subAgentExecutions: [
        { id: "s1", status: SubAgentStatus.SUB_AGENT_IN_PROGRESS },
        { id: "s2", status: SubAgentStatus.SUB_AGENT_COMPLETED },
      ],
      pendingApprovals: [{}],
    },
  });
}

describe("applyLifecyclePhaseTransition", () => {
  it("pause: non-terminal, keeps completed_at/pending/sub-agents/error", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_PAUSED,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_PAUSED);
    // PAUSED is not terminal; completed_at untouched.
    expect(exec.status?.completedAt).toBe("2026-01-01T00:00:00Z");
    expect(exec.status?.error).toBe("preexisting error");
    // Pending must survive a pause (it can resume).
    expect(exec.status?.pendingApprovals).toHaveLength(1);
    expect(exec.status?.subAgentExecutions[0]?.status).toBe(
      SubAgentStatus.SUB_AGENT_IN_PROGRESS,
    );
    // PAUSED is not terminal; in-flight tool calls untouched.
    expect(exec.status?.messages[0]?.toolCalls[0]?.status).toBe(
      ToolCallStatus.TOOL_CALL_RUNNING,
    );
  });

  it("resume: IN_PROGRESS clears completed_at, keeps error and pending", () => {
    const exec = newTransitionFixture();
    exec.status!.phase = ExecutionPhase.EXECUTION_PAUSED;
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(exec.status?.completedAt).toBe("");
    // Resume does not clear error.
    expect(exec.status?.error).toBe("preexisting error");
    expect(exec.status?.pendingApprovals).toHaveLength(1);
  });

  it("recover: IN_PROGRESS clears completed_at and error", () => {
    const exec = newTransitionFixture();
    exec.status!.phase = ExecutionPhase.EXECUTION_FAILED;
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      false,
      true,
      "",
    );

    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(exec.status?.completedAt).toBe("");
    expect(exec.status?.error).toBe("");
  });

  it("cancel: terminal sets completed_at, cascades, clears pending", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_CANCELLED,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    expect(exec.status?.completedAt).not.toBe("");
    // A terminal execution carries no pending approvals.
    expect(exec.status?.pendingApprovals).toHaveLength(0);
    // In-flight sub-agent cascaded to CANCELLED.
    expect(exec.status?.subAgentExecutions[0]?.status).toBe(
      SubAgentStatus.SUB_AGENT_CANCELLED,
    );
    expect(exec.status?.subAgentExecutions[0]?.completedAt).not.toBe("");
    // Already-COMPLETED sub-agent preserved.
    expect(exec.status?.subAgentExecutions[1]?.status).toBe(
      SubAgentStatus.SUB_AGENT_COMPLETED,
    );
    // Cancel does not set error.
    expect(exec.status?.error).toBe("preexisting error");
    // In-flight tool call settled to INTERRUPTED (#207).
    expect(exec.status?.messages[0]?.toolCalls[0]?.status).toBe(
      ToolCallStatus.TOOL_CALL_INTERRUPTED,
    );
    expect(exec.status?.messages[0]?.toolCalls[0]?.completedAt).not.toBe("");
    // Already-terminal tool call preserved.
    expect(exec.status?.messages[0]?.toolCalls[1]?.status).toBe(
      ToolCallStatus.TOOL_CALL_COMPLETED,
    );
  });

  it("terminate: sets error from reason, cascades, clears pending", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_TERMINATED,
      true,
      false,
      "disk full",
    );

    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(exec.status?.completedAt).not.toBe("");
    expect(exec.status?.pendingApprovals).toHaveLength(0);
    expect(exec.status?.subAgentExecutions[0]?.status).toBe(
      SubAgentStatus.SUB_AGENT_CANCELLED,
    );
    expect(exec.status?.error).toBe("Terminated: disk full");
    // Force-kill settles in-flight tool calls.
    expect(exec.status?.messages[0]?.toolCalls[0]?.status).toBe(
      ToolCallStatus.TOOL_CALL_INTERRUPTED,
    );
  });

  it("terminate: empty reason falls back to default error", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_TERMINATED,
      true,
      false,
      "",
    );
    expect(exec.status?.error).toBe("Terminated by user");
  });

  it("missing status is initialized", () => {
    const exec = create(AgentExecutionSchema, {});
    applyLifecyclePhaseTransition(
      exec,
      ExecutionPhase.EXECUTION_PAUSED,
      false,
      false,
      "",
    );
    expect(exec.status).toBeDefined();
    expect(exec.status?.phase).toBe(ExecutionPhase.EXECUTION_PAUSED);
  });
});

// ---------------------------------------------------------------------------
// The pipelines over a real store.
// ---------------------------------------------------------------------------

let counter = 0;

function gatedExecution(id: string, toolCallId: string): AgentExecution {
  return create(AgentExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: { id, name: id },
    spec: {},
    status: {
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        {
          toolCalls: [
            {
              id: toolCallId,
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              requiresApproval: true,
            },
          ],
        },
      ],
    },
  });
}

async function seedExecution(init: {
  phase: ExecutionPhase;
  sessionId?: string;
  error?: string;
}): Promise<string> {
  counter += 1;
  const id = `aexec_lifecycle_${counter}`;
  await store.saveResource(
    ApiResourceKind.agent_execution,
    id,
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: { id, name: id, org: "acme" },
      spec: { sessionId: init.sessionId ?? "", message: "hi" },
      status: { phase: init.phase, error: init.error ?? "" },
    }),
  );
  return id;
}

/**
 * The EC-builder deps recover consumes, stubbed at the in-process edges
 * (the builder logic itself is real). The store is the shared SQLite
 * store, so schedule/workflow label lookups run for real (and find
 * nothing here).
 */
function stubBuilderDeps(overrides?: {
  onEcCreate?: (ec: ExecutionContext) => void;
}): ExecutionContextBuilderDeps {
  const agent: Agent = create(AgentSchema, {
    metadata: { id: "agt_lc", org: "acme", slug: "lc-agent" },
    spec: {},
  });
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({ get: async () => agent }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: "acme" },
          spec: { agentId: "agt_lc" },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          spec: { agentInstanceId: "agi_lc" },
        }),
    }),
    environmentReader: () => ({
      list: async () => {
        throw new Error("no environments in this test");
      },
      getSecretValue: async () => {
        throw new Error("no secrets in this test");
      },
    }),
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment refs in this test");
      },
      // Only resolveByReference is consumed by the builder.
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        overrides?.onEcCreate?.(ec);
        return ec;
      },
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
  };
}

function lifecycleDeps(engineState: ExecutionEngineState): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker: new StreamBroker(silentLogger),
    engineState: () => engineState,
    executionContextBuilder: stubBuilderDeps(),
    gateSteps: new Map(),
    statusObservers: [],
  };
}

const DISCONNECTED: ExecutionEngineState = { connected: false };

function connected(engine: ConnectedExecutionEngine): ExecutionEngineState {
  return { connected: true, engine };
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(code);
    return connectError;
  }
  throw new Error(`expected code ${Code[code]}, call succeeded`);
}

function cancelInput(id: string): CancelAgentExecutionInput {
  return create(CancelAgentExecutionInputSchema, { id });
}
function terminateInput(id: string, reason = ""): TerminateAgentExecutionInput {
  return create(TerminateAgentExecutionInputSchema, { id, reason });
}
function pauseInput(id: string, reason = ""): PauseAgentExecutionInput {
  return create(PauseAgentExecutionInputSchema, { id, reason });
}
function resumeInput(id: string): ResumeAgentExecutionInput {
  return create(ResumeAgentExecutionInputSchema, { id });
}
function recoverInput(id: string): RecoverAgentExecutionInput {
  return create(RecoverAgentExecutionInputSchema, { id });
}

describe("lifecycle pipelines", () => {
  it("empty id refuses InvalidArgument before any load", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    const err = await expectCode(
      () => cancelExecution(deps, cancelInput(""), testCallerIdentity()),
      Code.InvalidArgument,
    );
    expect(err.rawMessage).toBe("execution id is required");
  });

  it("unknown id answers NotFound", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    await expectCode(
      () =>
        cancelExecution(
          deps,
          cancelInput("aexec_missing"),
          testCallerIdentity(),
        ),
      Code.NotFound,
    );
  });

  it("disconnected engine refuses FailedPrecondition after phase validation", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const err = await expectCode(
      () => cancelExecution(deps, cancelInput(id), testCallerIdentity()),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe("Temporal is not available");
  });

  it("wrong phase refuses FailedPrecondition with the per-verb copy", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    const completed = await seedExecution({
      phase: ExecutionPhase.EXECUTION_COMPLETED,
    });
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        () =>
          cancelExecution(deps, cancelInput(completed), testCallerIdentity()),
        "cannot cancel execution in phase EXECUTION_COMPLETED; only PENDING or IN_PROGRESS can be cancelled",
      ],
      [
        () =>
          terminateExecution(
            deps,
            terminateInput(completed),
            testCallerIdentity(),
          ),
        "cannot terminate execution in phase EXECUTION_COMPLETED; only PENDING or IN_PROGRESS can be terminated",
      ],
      [
        () => pauseExecution(deps, pauseInput(completed), testCallerIdentity()),
        "cannot pause execution in phase EXECUTION_COMPLETED; only PENDING or IN_PROGRESS can be paused",
      ],
      [
        () =>
          resumeExecution(deps, resumeInput(completed), testCallerIdentity()),
        "cannot resume execution in phase EXECUTION_COMPLETED; only PAUSED executions can be resumed",
      ],
      [
        () =>
          recoverExecution(deps, recoverInput(completed), testCallerIdentity()),
        "cannot recover execution in phase EXECUTION_COMPLETED; only FAILED executions can be recovered",
      ],
    ];
    for (const [fn, message] of cases) {
      const err = await expectCode(fn, Code.FailedPrecondition);
      expect(err.rawMessage).toBe(message);
    }
  });

  it("already in target phase is idempotent success without touching the engine", async () => {
    let engineCalls = 0;
    const deps = lifecycleDeps(
      connected(
        stubConnectedEngine({
          cancelWorkflow: async () => {
            engineCalls += 1;
          },
        }),
      ),
    );
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_CANCELLED,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    expect(engineCalls).toBe(0);
  });

  it("cancel with a connected engine persists CANCELLED and broadcasts", async () => {
    const cancelled: string[] = [];
    const deps = lifecycleDeps(
      connected(
        stubConnectedEngine({
          cancelWorkflow: async (executionId) => {
            cancelled.push(executionId);
          },
        }),
      ),
    );
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(cancelled).toEqual([id]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    expect(result.status?.completedAt).not.toBe("");

    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
  });

  it("workflow-not-found is warn-and-proceed: the state update still lands", async () => {
    const deps = lifecycleDeps(
      connected(
        stubConnectedEngine({
          cancelWorkflow: async (executionId) => {
            throw new EngineWorkflowNotFoundError(executionId);
          },
        }),
      ),
    );
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
  });

  it("terminate stamps the resolved reason into status.error", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const result = await terminateExecution(
      deps,
      terminateInput(id, "disk full"),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(result.status?.error).toBe("Terminated: disk full");
  });

  // O4 (20260827.07, ruling Q3): the lifecycle persist step is notify
  // site 2 of 5 — the user-initiated terminal transitions the update-status
  // chokepoint never sees MUST reach the composed observers (the cloud's
  // billing finalize settles on exactly these).
  it("cancel notifies the composed status observers with the persisted transition", async () => {
    const observed: AgentExecutionStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    await cancelExecution(deps, cancelInput(id), testCallerIdentity());
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    expect(observed[0]?.execution.metadata?.id).toBe(id);
    // The observer sees the PERSISTED snapshot (post-merge contract).
    expect(observed[0]?.execution.status?.completedAt).not.toBe("");
  });

  it("terminate notifies the composed status observers", async () => {
    const observed: AgentExecutionStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    await terminateExecution(
      deps,
      terminateInput(id, "disk full"),
      testCallerIdentity(),
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  });

  it("an idempotent already-in-target cancel notifies nothing (no write, no transition)", async () => {
    const observed: AgentExecutionStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_CANCELLED,
    });
    await cancelExecution(deps, cancelInput(id), testCallerIdentity());
    expect(observed).toHaveLength(0);
  });

  // O4: the recover chain's ratified slot position — after workflow
  // termination, before re-launch side effects (the RearmBillingStep
  // ordering, blueprint 03 §3a).
  it("a recover slot gate refuses after termination and before any re-launch side effect", async () => {
    const terminations: string[] = [];
    const starts: string[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(
        connected(
          stubConnectedEngine({
            terminateWorkflow: async (executionId) => {
              terminations.push(executionId);
            },
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      ),
      gateSteps: new Map([
        [
          "agent-execution-recover:pre-side-effect-gate",
          [
            {
              name: "FakeRearmGate",
              execute: (): void => {
                throw new ConnectError(
                  "fake rearm refused",
                  Code.FailedPrecondition,
                );
              },
            },
          ],
        ],
      ]),
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_lc",
      error: "runner exploded",
    });

    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe("fake rearm refused");
    // Position proof: the terminated-workflow side of the boundary ran,
    // the re-launch side did not, and the phase write never happened.
    expect(terminations).toEqual([id]);
    expect(starts).toEqual([]);
    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
  });

  it("resume from PAUSED clears completed_at and returns IN_PROGRESS", async () => {
    const resumed: string[] = [];
    const deps = lifecycleDeps(
      connected(
        stubConnectedEngine({
          signalResume: async (executionId) => {
            resumed.push(executionId);
          },
        }),
      ),
    );
    const id = await seedExecution({ phase: ExecutionPhase.EXECUTION_PAUSED });
    const result = await resumeExecution(
      deps,
      resumeInput(id),
      testCallerIdentity(),
    );
    expect(resumed).toEqual([id]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(result.status?.completedAt).toBe("");
  });

  it("recover runs terminate → EC recreate → fresh start → clears error", async () => {
    const terminations: Array<{ executionId: string; reason: string }> = [];
    const starts: string[] = [];
    const createdEcs: ExecutionContext[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: new StreamBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      engineState: () =>
        connected(
          stubConnectedEngine({
            terminateWorkflow: async (executionId, reason) => {
              terminations.push({ executionId, reason });
            },
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      executionContextBuilder: stubBuilderDeps({
        onEcCreate: (ec) => createdEcs.push(ec),
      }),
    };

    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_lc",
      error: "runner exploded",
    });
    const result = await recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );

    expect(terminations).toEqual([
      {
        executionId: id,
        reason: "Recovery: terminating before fresh workflow start",
      },
    ]);
    expect(createdEcs).toHaveLength(1);
    expect(createdEcs[0]?.spec?.executionId).toBe(id);
    expect(createdEcs[0]?.metadata?.name).toBe(`exec-ctx-${id}`);
    expect(starts).toEqual([id]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(result.status?.error).toBe("");
    expect(result.status?.completedAt).toBe("");
  });

  it("recover proceeds when the previous workflow is already gone (NotFound = success)", async () => {
    // Go terminate_existing_workflow_step_test.go NotFound_Succeeds: a
    // FAILED execution's workflow has normally already completed; the
    // recreate + fresh start must still run.
    const starts: string[] = [];
    const createdEcs: ExecutionContext[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: new StreamBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      engineState: () =>
        connected(
          stubConnectedEngine({
            terminateWorkflow: async (executionId) => {
              throw new EngineWorkflowNotFoundError(executionId);
            },
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      executionContextBuilder: stubBuilderDeps({
        onEcCreate: (ec) => createdEcs.push(ec),
      }),
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_lc",
      error: "runner exploded",
    });
    const result = await recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    expect(createdEcs).toHaveLength(1);
    expect(starts).toEqual([id]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
  });

  it("recover aborts when the terminate fails with a real error — nothing re-started", async () => {
    // Go terminate_existing_workflow_step_test.go TerminateFails: the
    // workflow ID must be terminal before the fresh start reuses it, so a
    // genuine terminate failure gates the whole recovery.
    const starts: string[] = [];
    const createdEcs: ExecutionContext[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: new StreamBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      engineState: () =>
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {
              throw new Error("temporal unavailable");
            },
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      executionContextBuilder: stubBuilderDeps({
        onEcCreate: (ec) => createdEcs.push(ec),
      }),
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_lc",
      error: "runner exploded",
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.Internal,
    );
    expect(err.rawMessage).toBe(
      "failed to terminate previous workflow during recovery",
    );
    expect(createdEcs).toHaveLength(0);
    expect(starts).toHaveLength(0);
    // The execution stays FAILED (recover can be retried).
    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(persisted.status?.error).toBe("runner exploded");
  });

  it("recover already IN_PROGRESS is idempotent success without touching the engine", async () => {
    // Go terminate_existing_workflow_step_test.go
    // SkipsWhenAlreadyInTargetState, driven through the full pipeline.
    let engineCalls = 0;
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: new StreamBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      engineState: () =>
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {
              engineCalls += 1;
            },
            startInvokeWorkflow: async () => {
              engineCalls += 1;
            },
          }),
        ),
      executionContextBuilder: stubBuilderDeps({
        onEcCreate: () => {
          engineCalls += 1;
        },
      }),
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      sessionId: "ses_lc",
    });
    const result = await recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(engineCalls).toBe(0);
  });

  it("recover surfaces the inner status code when the EC rebuild fails (never Internal)", async () => {
    // Go's recreate step wraps with %w: a NotFound session load (or the
    // FailedPrecondition OAuth refusal) keeps its code on the wire with
    // the recover prefix — the caller-actionable copy must not collapse
    // into an opaque 500.
    const builderDeps = stubBuilderDeps();
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: new StreamBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      engineState: () => connected(stubConnectedEngine()),
      executionContextBuilder: {
        ...builderDeps,
        sessionLoader: () => ({
          get: async () => {
            throw new ConnectError(
              "session not found: ses_gone",
              Code.NotFound,
            );
          },
        }),
      },
    };
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_gone",
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe(
      `recreate execution context for recovered execution ${id}: ` +
        "resolve agent instance: load session ses_gone: " +
        "rpc error: code = NotFound desc = session not found: ses_gone",
    );
  });

  it("recover with a disconnected engine refuses before any side effect", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    const id = await seedExecution({
      phase: ExecutionPhase.EXECUTION_FAILED,
      sessionId: "ses_lc",
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe("Temporal is not available");

    const persisted = await store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
    expect(persisted.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
  });
});

// The lifecycle persist must go through the atomic store.updateResource,
// never the whole-resource saveResource it replaced (Go
// TestLifecyclePersist_UsesUpdateResource): a saveResource here is the
// regression that lets a concurrent SubmitApproval append be clobbered.
// The mechanism pin complements the race test below — it pinpoints the
// regression without depending on interleaving.
describe("lifecycle persist uses the atomic updateResource", () => {
  const cases: Array<{
    name: string;
    run: (deps: LifecycleDeps, id: string) => Promise<unknown>;
    fromPhase: ExecutionPhase;
    wantPhase: ExecutionPhase;
  }> = [
    {
      name: "pause",
      run: (deps, id) =>
        pauseExecution(deps, pauseInput(id), testCallerIdentity()),
      fromPhase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      wantPhase: ExecutionPhase.EXECUTION_PAUSED,
    },
    {
      name: "cancel",
      run: (deps, id) =>
        cancelExecution(deps, cancelInput(id), testCallerIdentity()),
      fromPhase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      wantPhase: ExecutionPhase.EXECUTION_CANCELLED,
    },
    {
      name: "terminate",
      run: (deps, id) =>
        terminateExecution(deps, terminateInput(id), testCallerIdentity()),
      fromPhase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      wantPhase: ExecutionPhase.EXECUTION_TERMINATED,
    },
  ];

  for (const tc of cases) {
    it(tc.name, async () => {
      let updateCalls = 0;
      let saveCalls = 0;
      const countingStore = new Proxy(store, {
        get(target, prop, receiver) {
          if (prop === "updateResource") {
            return (...args: Parameters<Store["updateResource"]>) => {
              updateCalls += 1;
              return target.updateResource(...args);
            };
          }
          if (prop === "saveResource") {
            return (...args: Parameters<Store["saveResource"]>) => {
              saveCalls += 1;
              return target.saveResource(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const deps: LifecycleDeps = {
        store: countingStore,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        broker: new StreamBroker(silentLogger),
        engineState: () => connected(stubConnectedEngine()),
        executionContextBuilder: stubBuilderDeps(),
        gateSteps: new Map(),
        statusObservers: [],
      };

      // Seed through the RAW store so the seed write is not counted.
      const id = await seedExecution({ phase: tc.fromPhase });

      await tc.run(deps, id);

      expect(updateCalls, "exactly 1 atomic updateResource").toBe(1);
      expect(saveCalls, "0 whole-resource saveResource").toBe(0);

      const final = await store.getResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
      );
      expect(final.status?.phase).toBe(tc.wantPhase);
    });
  }
});

// The append-only invariant on the lifecycle path: a pause and an
// approval-decision append race on the same gated execution. Because the
// lifecycle persist re-reads fresh under the store's write lock inside
// store.updateResource, it can never clobber a decision a concurrent
// writer appended (Go's 50-iteration regression, appended through the
// same real approval helpers).
describe("lifecycle pause racing a decision append", () => {
  it("keeps both the decision and the pause across 50 races", async () => {
    const toolCallId = "tc-1";
    const deps = lifecycleDeps(connected(stubConnectedEngine()));

    for (let i = 0; i < 50; i++) {
      const id = `aexec_pause_race_${i}`;
      await store.saveResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
        gatedExecution(id, toolCallId),
      );

      // Go seeds WAITING_FOR_APPROVAL; pause requires PENDING/IN_PROGRESS,
      // so flip to IN_PROGRESS while keeping the gated call — the overlap
      // window the plan describes.
      await store.updateResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
        (loaded) => {
          loaded.status!.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;
        },
      );

      await Promise.all([
        pauseExecution(deps, pauseInput(id), testCallerIdentity()),
        store.updateResource(
          ApiResourceKind.agent_execution,
          id,
          AgentExecutionSchema,
          (loaded) => {
            ensureApprovalRequests(loaded.status, id);
            const tc = loaded.status?.messages[0]?.toolCalls[0];
            if (tc === undefined) {
              throw new Error(`tool call ${toolCallId} not found`);
            }
            tc.approvalAction = ApprovalAction.APPROVE;
            tc.approvalDecidedAt = new Date()
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z");
            recordDecisionEvent(loaded.status, tc, "", "");
          },
        ),
      ]);

      const final = await store.getResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
      );

      let requested = 0;
      let approved = 0;
      for (const ev of final.status?.approvalEventStream?.events ?? []) {
        if (ev.approvalRequestId !== toolCallId) {
          continue;
        }
        if (ev.eventType === ApprovalEventType.REQUESTED) {
          requested += 1;
        }
        if (ev.eventType === ApprovalEventType.APPROVED) {
          approved += 1;
        }
      }
      expect(requested, `iteration ${i}: REQUESTED count`).toBe(1);
      expect(approved, `iteration ${i}: APPROVED decision lost`).toBe(1);
      // The pause transition must also have landed.
      expect(final.status?.phase, `iteration ${i}: phase`).toBe(
        ExecutionPhase.EXECUTION_PAUSED,
      );
    }
  });
});
