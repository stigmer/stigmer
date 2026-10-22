/**
 * Lifecycle RPC tests — ports lifecycle_cancel_cascade_test.go,
 * lifecycle_concurrency_test.go, and terminate_existing_workflow_step_test.go,
 * plus the pipeline-level behavior Go asserts through conformance:
 *
 *   - applyLifecyclePhaseTransition: the pure mutation inside the atomic
 *     persist closure — a terminal phase's completed_at and stop cause,
 *     PAUSED non-terminality, recover's error clear, and nothing else of
 *     the run touched (a tool call the turn never finished is read as
 *     stopped from the session's log, never written here);
 *   - the four lifecycle pipelines, and the cancel steps the session's
 *     interrupt runs, over a real SQLite store with a stub engine:
 *     phase refusals, idempotent already-in-target, NotFound, the
 *     disconnected-engine refusal, warn-and-proceed on workflow-not-found,
 *     and recover's full terminate → re-plan → fresh-start chain, the new
 *     source manifest persisted on the run before the fresh workflow
 *     starts, so its runner's fetch reads the vaults as they are now;
 *   - recover records the session's pin on a turn that recorded no agent,
 *     persisted before the values are planned again and handed to the fresh
 *     workflow; a turn that recorded its agent keeps it, and a session
 *     pinning none leaves the turn the built-in assistant's; a caller who
 *     may no longer run the agent is refused before the previous workflow
 *     is terminated, the pre-side-effect slot runs, or anything is written;
 *   - recover runs one at a time per execution (stigmer#1672): a second
 *     concurrent recover waits for the first and then takes the idempotent
 *     arm, a recover queued behind a failed one retries in full, and two
 *     executions never wait on each other. The first recover is released
 *     on whichever comes first, the second entering the serializer or the
 *     second reaching the engine, so no timer decides either outcome;
 *   - one turn of a session at a time (stigmer#2429): resume refuses while
 *     another turn of the session is unfinished, recover also while
 *     messages wait in its queue, each before the engine is touched; a
 *     resume with only its own messages waiting goes ahead; terminate drops
 *     the session's queue;
 *   - the pause/record race: the lifecycle persist rides the row-locked
 *     write, so a concurrent write to the run's file record is never
 *     clobbered (the Go 50-iteration regression).
 */
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import {
  deferred,
  SignallingSerializer,
} from "../../../pipeline/__tests__/race-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunCredentialsSchema,
  RunSchema,
  RunStatusSchema,
  RunValueSourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunPhase,
  RunValueOrigin,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  PauseRunInput,
  RecoverRunInput,
  ResumeRunInput,
  TerminateRunInput,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import {
  PauseRunInputSchema,
  RecoverRunInputSchema,
  ResumeRunInputSchema,
  TerminateRunInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { InterruptSessionInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { RunStatusTransition } from "../../../extensions/status-hooks.js";
import { KeyedSerializer } from "../../../pipeline/keyed-serializer.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { LOADED_EXECUTION_KEY, RequestContext } from "../../../pipeline/request-context.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";

import type { RunValuePlannerDeps } from "../plan-run-values-step.js";
import { newConfigFromEnv } from "../temporal/config.js";
import type {
  ConnectedExecutionEngine,
  ExecutionEngineState,
} from "../engine.js";
import { EngineWorkflowNotFoundError } from "../engine.js";
import type { LifecycleDeps } from "../lifecycle.js";
import {
  applyLifecyclePhaseTransition,
  cancelSteps,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { stubConnectedEngine } from "./engine-stub.js";
import { capturedSet } from "./file-review-seed.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { enqueueMessage } from "../../session/events/queue.js";
import { errorReasonOf } from "../../../pipeline/errors.js";
import { SESSION_TURN_UNFINISHED_REASON } from "../constants.js";
import { LIST_INDEXES } from "../../../boot/list-indexes.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-lifecycle-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// An IN_PROGRESS run carrying every field the transition must leave
// alone beside the ones it sets, so each case asserts both.
function newTransitionFixture(): Run {
  return create(RunSchema, {
    status: {
      phase: RunPhase.RUN_IN_PROGRESS,
      completedAt: "2026-01-01T00:00:00Z",
      error: "preexisting error",
      fileChanges: [capturedSet("run_fixture:0")],
    },
  });
}

describe("applyLifecyclePhaseTransition", () => {
  it("pause: non-terminal, keeps completed_at, error and the file record", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_PAUSED,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(RunPhase.RUN_PAUSED);
    // PAUSED is not terminal; completed_at untouched.
    expect(exec.status?.completedAt).toBe("2026-01-01T00:00:00Z");
    expect(exec.status?.error).toBe("preexisting error");
    expect(exec.status?.stopCause).toBe("");
    expect(exec.status?.fileChanges).toHaveLength(1);
  });

  it("resume: IN_PROGRESS clears completed_at, keeps error", () => {
    const exec = newTransitionFixture();
    exec.status!.phase = RunPhase.RUN_PAUSED;
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_IN_PROGRESS,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(exec.status?.completedAt).toBe("");
    // Resume does not clear error.
    expect(exec.status?.error).toBe("preexisting error");
  });

  it("recover: IN_PROGRESS clears completed_at and error", () => {
    const exec = newTransitionFixture();
    exec.status!.phase = RunPhase.RUN_FAILED;
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_IN_PROGRESS,
      false,
      true,
      "",
    );

    expect(exec.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(exec.status?.completedAt).toBe("");
    expect(exec.status?.error).toBe("");
  });

  it("cancel: terminal sets completed_at and the stop cause, and leaves the record", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_CANCELLED,
      false,
      false,
      "",
    );

    expect(exec.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    expect(exec.status?.completedAt).not.toBe("");
    expect(exec.status?.stopCause).toBe("user");
    // Cancel does not set error.
    expect(exec.status?.error).toBe("preexisting error");
    expect(exec.status?.fileChanges.map((cs) => cs.id)).toEqual(["run_fixture:0"]);
  });

  it("terminate: sets error from reason and completed_at, no stop cause", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_TERMINATED,
      true,
      false,
      "disk full",
    );

    expect(exec.status?.phase).toBe(RunPhase.RUN_TERMINATED);
    expect(exec.status?.completedAt).not.toBe("");
    expect(exec.status?.stopCause).toBe("");
    expect(exec.status?.error).toBe("Terminated: disk full");
    expect(exec.status?.fileChanges).toHaveLength(1);
  });

  it("terminate: empty reason falls back to default error", () => {
    const exec = newTransitionFixture();
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_TERMINATED,
      true,
      false,
      "",
    );
    expect(exec.status?.error).toBe("Terminated by user");
  });

  it("missing status is initialized", () => {
    const exec = create(RunSchema, {});
    applyLifecyclePhaseTransition(
      exec,
      RunPhase.RUN_PAUSED,
      false,
      false,
      "",
    );
    expect(exec.status).toBeDefined();
    expect(exec.status?.phase).toBe(RunPhase.RUN_PAUSED);
  });
});

// ---------------------------------------------------------------------------
// The pipelines over a real store.
// ---------------------------------------------------------------------------

let counter = 0;

/**
 * A session of its own for each recover: one turn of a session works at a
 * time, so turns recovered by earlier cases would hold a shared one.
 */
function freshSession(): string {
  return `ses_lc_${counter + 1}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedExecution(init: {
  phase: RunPhase;
  sessionId?: string;
  agentId?: string;
  error?: string;
}): Promise<string> {
  counter += 1;
  const id = `aexec_lifecycle_${counter}`;
  await store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { id, name: id, org: "acme" },
      spec: {
        target:
          init.sessionId === undefined
            ? { case: undefined }
            : { case: "sessionId", value: init.sessionId },
        message: "hi",
      },
      status: {
        phase: init.phase,
        error: init.error ?? "",
        agentId: init.agentId ?? "",
      },
    }),
  );
  return id;
}

/**
 * The value-planner deps recover consumes, stubbed at the in-process edges
 * (the planner logic itself is real). The store is the shared SQLite
 * store, so schedule label lookups run for real (and find nothing here).
 * The resolver answers one entry, so a test can see the manifest land on
 * the stored run.
 */
function stubPlannerDeps(overrides?: {
  onPlan?: (execution: Run) => void;
  onAgentGet?: (agentId: string) => void;
}): RunValuePlannerDeps {
  const agent: Agent = create(AgentSchema, {
    metadata: { id: "agt_lc", org: "acme", slug: "lc-agent" },
    spec: {},
  });
  const never = async (): Promise<never> => {
    throw new Error("recover plans; it never opens a value or connects");
  };
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async (agentId) => {
        overrides?.onAgentGet?.(agentId);
        return agent;
      },
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          status: { agentId: "agt_lc" },
        }),
    }),
    vaultResolver: {
      planRun: async (input) => {
        overrides?.onPlan?.(input.execution);
        return [plannedSource()];
      },
      openRun: never,
      planConnect: never,
      openConnect: never,
    },
  };
}

/** The one entry the stub resolver plans: a secret by name in a vault. */
function plannedSource() {
  return create(RunValueSourceSchema, {
    key: "LINEAR_API_KEY",
    origin: RunValueOrigin.VAULT,
    vaultId: "vlt_lc",
    entry: "LINEAR_API_KEY",
  });
}

function lifecycleDeps(engineState: ExecutionEngineState): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    recoverSerializer: new KeyedSerializer(),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    engineState: () => engineState,
    runValuePlanner: stubPlannerDeps(),
    gateSteps: new Map(),
    statusObservers: [],
    // The OSS default sandbox posture: lane disabled — the
    // recover chain's EnsureSessionSandbox step short-circuits.
    sandboxLane: { enabled: false },
    temporalConfig: newConfigFromEnv(),
    personAccounts: undefined,
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

/** The cancel input a test names a run by; the session's interrupt names it to the steps directly. */
function cancelInput(id: string): { readonly id: string } {
  return { id };
}

/**
 * The cancel steps as the session's interrupt runs them for one run: in a
 * chain of the interrupt's own, with the run named to the steps.
 */
async function cancelExecution(
  deps: LifecycleDeps,
  input: { readonly id: string },
  identity: CallerIdentity,
): Promise<Run> {
  type InterruptDesc = typeof SessionCommandController.method.interrupt.input;
  const ctx = new RequestContext(
    SessionCommandController.method.interrupt.input,
    create(InterruptSessionInputSchema, { sessionId: "ses_lifecycle" }),
    identity,
    ApiResourceKind.run,
  );
  const builder = newPipeline<InterruptDesc>("agentexecution-cancel", deps.logger);
  for (const step of cancelSteps<InterruptDesc>(deps, () => input.id)) {
    builder.addStep(step);
  }
  await builder.build().execute(ctx);
  return ctx.get(LOADED_EXECUTION_KEY) as Run;
}
function terminateInput(id: string, reason = ""): TerminateRunInput {
  return create(TerminateRunInputSchema, { id, reason });
}
function pauseInput(id: string, reason = ""): PauseRunInput {
  return create(PauseRunInputSchema, { id, reason });
}
function resumeInput(id: string): ResumeRunInput {
  return create(ResumeRunInputSchema, { id });
}
function recoverInput(id: string): RecoverRunInput {
  return create(RecoverRunInputSchema, { id });
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
      phase: RunPhase.RUN_IN_PROGRESS,
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
      phase: RunPhase.RUN_COMPLETED,
    });
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        () =>
          cancelExecution(deps, cancelInput(completed), testCallerIdentity()),
        "cannot cancel execution in phase RUN_COMPLETED; only an unfinished one (PENDING, IN_PROGRESS, WAITING_FOR_APPROVAL or PAUSED) can be cancelled",
      ],
      [
        () =>
          terminateExecution(
            deps,
            terminateInput(completed),
            testCallerIdentity(),
          ),
        "cannot terminate execution in phase RUN_COMPLETED; only PENDING or IN_PROGRESS can be terminated",
      ],
      [
        () => pauseExecution(deps, pauseInput(completed), testCallerIdentity()),
        "cannot pause execution in phase RUN_COMPLETED; only PENDING or IN_PROGRESS can be paused",
      ],
      [
        () =>
          resumeExecution(deps, resumeInput(completed), testCallerIdentity()),
        "cannot resume execution in phase RUN_COMPLETED; only PAUSED executions can be resumed",
      ],
      [
        () =>
          recoverExecution(deps, recoverInput(completed), testCallerIdentity()),
        "cannot recover execution in phase RUN_COMPLETED; only FAILED executions can be recovered",
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
      phase: RunPhase.RUN_CANCELLED,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    expect(engineCalls).toBe(0);
  });

  it("cancel with a connected engine persists CANCELLED", async () => {
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
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(cancelled).toEqual([id]);
    expect(result.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    expect(result.status?.completedAt).not.toBe("");

    const persisted = await store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    expect(persisted.status?.phase).toBe(RunPhase.RUN_CANCELLED);
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
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    const result = await cancelExecution(
      deps,
      cancelInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(RunPhase.RUN_CANCELLED);
  });

  it("terminate stamps the resolved reason into status.error", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    const id = await seedExecution({
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    const result = await terminateExecution(
      deps,
      terminateInput(id, "disk full"),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(RunPhase.RUN_TERMINATED);
    expect(result.status?.error).toBe("Terminated: disk full");
  });

  // The lifecycle persist step is notify
  // site 2 of 4 — the user-initiated terminal transitions the update-status
  // chokepoint never sees MUST reach the composed observers (a billing
  // composition's finalize settles on exactly these).
  it("cancel notifies the composed status observers with the persisted transition", async () => {
    const observed: RunStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    await cancelExecution(deps, cancelInput(id), testCallerIdentity());
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(observed[0]?.newPhase).toBe(RunPhase.RUN_CANCELLED);
    expect(observed[0]?.run.metadata?.id).toBe(id);
    // The observer sees the PERSISTED snapshot (post-merge contract).
    expect(observed[0]?.run.status?.completedAt).not.toBe("");
  });

  it("terminate notifies the composed status observers", async () => {
    const observed: RunStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    await terminateExecution(
      deps,
      terminateInput(id, "disk full"),
      testCallerIdentity(),
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.newPhase).toBe(RunPhase.RUN_TERMINATED);
  });

  it("an idempotent already-in-target cancel notifies nothing (no write, no transition)", async () => {
    const observed: RunStatusTransition[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine())),
      statusObservers: [(t) => void observed.push(t)],
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_CANCELLED,
    });
    await cancelExecution(deps, cancelInput(id), testCallerIdentity());
    expect(observed).toHaveLength(0);
  });

  // The recover chain's slot position — after workflow termination,
  // before re-launch side effects (where a billing composition re-arms).
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
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
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
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    expect(persisted.status?.phase).toBe(RunPhase.RUN_FAILED);
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
    const id = await seedExecution({ phase: RunPhase.RUN_PAUSED });
    const result = await resumeExecution(
      deps,
      resumeInput(id),
      testCallerIdentity(),
    );
    expect(resumed).toEqual([id]);
    expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(result.status?.completedAt).toBe("");
  });

  it("recover runs terminate → re-plan → fresh start → clears error", async () => {
    const terminations: Array<{ executionId: string; reason: string }> = [];
    const starts: string[] = [];
    const plans: Run[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      recoverSerializer: new KeyedSerializer(),
        sessionEventBroker: new SessionEventBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      sandboxLane: { enabled: false },
      temporalConfig: newConfigFromEnv(),
      personAccounts: undefined,
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
      runValuePlanner: stubPlannerDeps({
        onPlan: (execution) => plans.push(execution),
      }),
    };

    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
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
    expect(plans).toHaveLength(1);
    expect(plans[0]?.metadata?.id).toBe(id);
    expect(starts).toEqual([id]);
    expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(result.status?.error).toBe("");
    expect(result.status?.completedAt).toBe("");
  });

  it("recover persists the new manifest on the run before the fresh workflow starts, replacing the old one", async () => {
    let manifestAtStart: string[] | undefined;
    const deps: LifecycleDeps = {
      ...lifecycleDeps(
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {},
            startInvokeWorkflow: async (params) => {
              // What the fresh workflow's runner fetches by.
              const stored = await store.getResource(ApiResourceKind.run, params.executionId, RunSchema);
              manifestAtStart = stored.status?.credentials?.sources.map((entry) => entry.key);
            },
          }),
        ),
      ),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
      error: "runner exploded",
    });
    await store.updateResource(ApiResourceKind.run, id, RunSchema, (loaded) => {
      (loaded.status ??= create(RunStatusSchema)).credentials = create(RunCredentialsSchema, {
        person: "ida_ana",
        sources: [
          create(RunValueSourceSchema, {
            key: "OLD_KEY",
            origin: RunValueOrigin.VAULT,
            vaultId: "vlt_old",
            entry: "OLD_KEY",
          }),
        ],
      });
    });

    const result = await recoverExecution(deps, recoverInput(id), testCallerIdentity());

    expect(manifestAtStart).toEqual(["LINEAR_API_KEY"]);
    expect(result.status?.credentials?.sources.map((entry) => entry.key)).toEqual(["LINEAR_API_KEY"]);
    expect(result.status?.credentials?.person, "the person create recorded stays").toBe("ida_ana");
  });

  it("recover proceeds when the previous workflow is already gone (NotFound = success)", async () => {
    // Go terminate_existing_workflow_step_test.go NotFound_Succeeds: a
    // FAILED execution's workflow has normally already completed; the
    // re-plan + fresh start must still run.
    const starts: string[] = [];
    const plans: Run[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      recoverSerializer: new KeyedSerializer(),
        sessionEventBroker: new SessionEventBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      sandboxLane: { enabled: false },
      temporalConfig: newConfigFromEnv(),
      personAccounts: undefined,
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
      runValuePlanner: stubPlannerDeps({
        onPlan: (execution) => plans.push(execution),
      }),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
      error: "runner exploded",
    });
    const result = await recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    expect(plans).toHaveLength(1);
    expect(starts).toEqual([id]);
    expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("recover aborts when the terminate fails with a real error — nothing re-started", async () => {
    // Go terminate_existing_workflow_step_test.go TerminateFails: the
    // workflow ID must be terminal before the fresh start reuses it, so a
    // genuine terminate failure gates the whole recovery.
    const starts: string[] = [];
    const plans: Run[] = [];
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      recoverSerializer: new KeyedSerializer(),
        sessionEventBroker: new SessionEventBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      sandboxLane: { enabled: false },
      temporalConfig: newConfigFromEnv(),
      personAccounts: undefined,
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
      runValuePlanner: stubPlannerDeps({
        onPlan: (execution) => plans.push(execution),
      }),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
      error: "runner exploded",
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.Internal,
    );
    expect(err.rawMessage).toBe(
      "failed to terminate previous workflow during recovery",
    );
    expect(plans).toHaveLength(0);
    expect(starts).toHaveLength(0);
    // The execution stays FAILED (recover can be retried).
    const persisted = await store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    expect(persisted.status?.phase).toBe(RunPhase.RUN_FAILED);
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
      recoverSerializer: new KeyedSerializer(),
        sessionEventBroker: new SessionEventBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      sandboxLane: { enabled: false },
      temporalConfig: newConfigFromEnv(),
      personAccounts: undefined,
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
      runValuePlanner: stubPlannerDeps({
        onPlan: () => {
          engineCalls += 1;
        },
      }),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_IN_PROGRESS,
      sessionId: freshSession(),
    });
    const result = await recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(engineCalls).toBe(0);
  });

  describe("recover records the agent a turn runs", () => {
    async function storePinnedSession(
      sessionId: string,
      agentId: string,
    ): Promise<void> {
      await store.saveResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          status: { agentId, agentVersionHash: "" },
        }),
      );
    }

    function recordingDeps(record: {
      agentGets: string[];
      startedAgentIds: string[];
    }): LifecycleDeps {
      return {
        ...lifecycleDeps(
          connected(
            stubConnectedEngine({
              startInvokeWorkflow: async (params) => {
                record.startedAgentIds.push(params.agentId);
              },
            }),
          ),
        ),
        runValuePlanner: stubPlannerDeps({
          onAgentGet: (agentId) => record.agentGets.push(agentId),
        }),
      };
    }

    it("stamps an unstamped turn with its session's pin, persisted before the values are planned again", async () => {
      await storePinnedSession("ses_pinned", "agt_lc");
      const record = {
        agentGets: [] as string[],
        startedAgentIds: [] as string[],
      };
      const id = await seedExecution({
        phase: RunPhase.RUN_FAILED,
        sessionId: "ses_pinned",
      });

      const result = await recoverExecution(
        recordingDeps(record),
        recoverInput(id),
        testCallerIdentity(),
      );

      // The context build read the stamp: it loaded the session's agent.
      expect(record.agentGets).toEqual(["agt_lc"]);
      expect(record.startedAgentIds).toEqual(["agt_lc"]);
      expect(result.status?.agentId).toBe("agt_lc");
      const persisted = await store.getResource(
        ApiResourceKind.run,
        id,
        RunSchema,
      );
      expect(persisted.status?.agentId).toBe("agt_lc");
    });

    it("refuses a caller who may no longer run the agent before anything is terminated, charged or written", async () => {
      await storePinnedSession("ses_denied", "agt_lc");
      const terminations: string[] = [];
      const starts: string[] = [];
      const slotRuns: string[] = [];
      // Every check passes but running the agent the turn would rerun.
      const permissive = newPermissiveSingleTeamAuthorizer();
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
        authorizer: {
          authorize: (caller, check) =>
            check.resourceKind === ApiResourceKind.agent
              ? Promise.resolve({ kind: "deny", reason: "" })
              : permissive.authorize(caller, check),
        },
        gateSteps: new Map([
          [
            "agent-execution-recover:pre-side-effect-gate",
            [
              {
                name: "RecordingSlotStep",
                execute: (): void => {
                  slotRuns.push("slot");
                },
              },
            ],
          ],
        ]),
      };
      const id = await seedExecution({
        phase: RunPhase.RUN_FAILED,
        sessionId: "ses_denied",
        error: "runner exploded",
      });

      const err = await expectCode(
        () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
        Code.PermissionDenied,
      );

      expect(err.rawMessage).toBe("unauthorized to run agent 'agt_lc'");
      expect(terminations).toEqual([]);
      expect(slotRuns).toEqual([]);
      expect(starts).toEqual([]);
      const persisted = await store.getResource(
        ApiResourceKind.run,
        id,
        RunSchema,
      );
      expect(persisted.status?.agentId ?? "").toBe("");
      expect(persisted.status?.phase).toBe(RunPhase.RUN_FAILED);
    });

    it("keeps the agent a turn recorded, whatever its session pins now", async () => {
      await storePinnedSession("ses_repointed", "agt_now");
      const record = {
        agentGets: [] as string[],
        startedAgentIds: [] as string[],
      };
      const id = await seedExecution({
        phase: RunPhase.RUN_FAILED,
        sessionId: "ses_repointed",
        agentId: "agt_recorded",
      });

      await recoverExecution(
        recordingDeps(record),
        recoverInput(id),
        testCallerIdentity(),
      );

      expect(record.agentGets).toEqual(["agt_recorded"]);
      expect(record.startedAgentIds).toEqual(["agt_recorded"]);
      const persisted = await store.getResource(
        ApiResourceKind.run,
        id,
        RunSchema,
      );
      expect(persisted.status?.agentId).toBe("agt_recorded");
    });

    it("leaves a turn whose session pins no agent the built-in assistant's", async () => {
      await storePinnedSession("ses_assistant", "");
      const record = {
        agentGets: [] as string[],
        startedAgentIds: [] as string[],
      };
      const id = await seedExecution({
        phase: RunPhase.RUN_FAILED,
        sessionId: "ses_assistant",
      });

      await recoverExecution(
        recordingDeps(record),
        recoverInput(id),
        testCallerIdentity(),
      );

      expect(record.agentGets).toEqual([]);
      expect(record.startedAgentIds).toEqual([""]);
      const persisted = await store.getResource(
        ApiResourceKind.run,
        id,
        RunSchema,
      );
      expect(persisted.status?.agentId ?? "").toBe("");
    });
  });

  it("recover surfaces the inner status code when the re-plan fails (never Internal)", async () => {
    // The re-plan step wraps like Go's %w: a NotFound session load (or a
    // FailedPrecondition refusal of a required key) keeps its code on the
    // wire with the recover prefix — the caller-actionable copy must not
    // collapse into an opaque 500.
    const plannerDeps = stubPlannerDeps();
    const deps: LifecycleDeps = {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      recoverSerializer: new KeyedSerializer(),
        sessionEventBroker: new SessionEventBroker(silentLogger),
      gateSteps: new Map(),
      statusObservers: [],
      sandboxLane: { enabled: false },
      temporalConfig: newConfigFromEnv(),
      personAccounts: undefined,
      engineState: () => connected(stubConnectedEngine()),
      runValuePlanner: {
        ...plannerDeps,
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
      phase: RunPhase.RUN_FAILED,
      sessionId: "ses_gone",
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe(
      `plan the values of recovered execution ${id}: ` +
        "resolve session: load session ses_gone: " +
        "rpc error: code = NotFound desc = session not found: ses_gone",
    );
  });

  it("recover answers a re-plan failure that is not a status as a sanitized Internal", async () => {
    const plannerDeps = stubPlannerDeps();
    const deps: LifecycleDeps = {
      ...lifecycleDeps(connected(stubConnectedEngine({ terminateWorkflow: async () => {} }))),
      runValuePlanner: {
        ...plannerDeps,
        sessionLoader: () => ({
          get: async () => {
            throw new Error("socket hang up");
          },
        }),
      },
    };
    const id = await seedExecution({ phase: RunPhase.RUN_FAILED, sessionId: freshSession() });
    const failure = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.Internal,
    );
    expect(failure.rawMessage).not.toContain("socket hang up");
  });

  it.each([
    ["a run deleted since it was loaded is NotFound", () => new ResourceNotFoundError("run"), Code.NotFound],
    ["any other store failure is a sanitized Internal", () => new Error("SQLITE_BUSY"), Code.Internal],
  ])("recover's write of the new manifest: %s", async (_label, fault, code) => {
    const failing = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "updateResource") {
          return (...args: Parameters<Store["updateResource"]>) => {
            // The re-plan's write is the one that stamps sources.
            const probe = create(RunSchema, {});
            (args[3] as (row: Run) => void)(probe);
            return probe.status?.credentials?.sources.length
              ? Promise.reject(fault())
              : store.updateResource(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const starts: string[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {},
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      ),
      store: failing,
    };
    const id = await seedExecution({ phase: RunPhase.RUN_FAILED, sessionId: freshSession() });
    await expectCode(() => recoverExecution(deps, recoverInput(id), testCallerIdentity()), code);
    expect(starts, "no fresh workflow starts without its manifest").toEqual([]);
  });

  it("recover with a disconnected engine refuses before any side effect", async () => {
    const deps = lifecycleDeps(DISCONNECTED);
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
    });
    const err = await expectCode(
      () => recoverExecution(deps, recoverInput(id), testCallerIdentity()),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe("Temporal is not available");

    const persisted = await store.getResource(
      ApiResourceKind.run,
      id,
      RunSchema,
    );
    expect(persisted.status?.phase).toBe(RunPhase.RUN_FAILED);
  });
});

describe("one turn of a session at a time (stigmer#2429)", () => {
  async function queueIn(sessionId: string): Promise<void> {
    const outcome = await enqueueMessage(
      { store, sessionEventBroker: new SessionEventBroker(silentLogger) },
      { sessionId, org: "acme", sender: "person-a", turn: create(RunSchema, { spec: { message: "and then" } }) },
    );
    expect("queued" in outcome).toBe(true);
  }

  it("resume refuses while another turn of the session works, before the engine is touched", async () => {
    const touched: string[] = [];
    const deps = lifecycleDeps(connected(stubConnectedEngine({ signalResume: async (id) => void touched.push(id) })));
    const paused = await seedExecution({ phase: RunPhase.RUN_PAUSED, sessionId: "ses_one_at_a_time_1" });
    await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_one_at_a_time_1" });
    const err = await expectCode(() => resumeExecution(deps, resumeInput(paused), testCallerIdentity()), Code.FailedPrecondition);
    expect(errorReasonOf(err)).toBe(SESSION_TURN_UNFINISHED_REASON);
    expect(touched).toEqual([]);
  });

  it("resume goes ahead with only its own messages waiting", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    // Queued while the turn worked, before it was paused.
    const paused = await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_one_at_a_time_2" });
    await queueIn("ses_one_at_a_time_2");
    await store.updateResource(ApiResourceKind.run, paused, RunSchema, (run) => {
      run.status!.phase = RunPhase.RUN_PAUSED;
    });
    const result = await resumeExecution(deps, resumeInput(paused), testCallerIdentity());
    expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("recover refuses while another turn works or messages wait for their turn, before the engine is touched", async () => {
    const terminated: string[] = [];
    const deps = lifecycleDeps(
      connected(stubConnectedEngine({ terminateWorkflow: async (id) => void terminated.push(id) })),
    );
    const failed = await seedExecution({ phase: RunPhase.RUN_FAILED, sessionId: "ses_one_at_a_time_3" });
    const working = await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_one_at_a_time_3" });
    const busy = await expectCode(() => recoverExecution(deps, recoverInput(failed), testCallerIdentity()), Code.FailedPrecondition);
    expect(errorReasonOf(busy)).toBe(SESSION_TURN_UNFINISHED_REASON);
    await store.updateResource(ApiResourceKind.run, working, RunSchema, (run) => {
      run.status!.phase = RunPhase.RUN_COMPLETED;
    });
    await queueIn("ses_one_at_a_time_3");
    const queued = await expectCode(() => recoverExecution(deps, recoverInput(failed), testCallerIdentity()), Code.FailedPrecondition);
    expect(errorReasonOf(queued)).toBe(SESSION_TURN_UNFINISHED_REASON);
    expect(terminated).toEqual([]);
  });

  it("terminate drops the session's queued messages, which stay listed, never accepted", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    const working = await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_one_at_a_time_4" });
    await queueIn("ses_one_at_a_time_4");
    await terminateExecution(deps, terminateInput(working), testCallerIdentity());
    expect(await store.sessionEvents.queued("ses_one_at_a_time_4")).toEqual([]);
    const [listed] = await store.sessionEvents.list("ses_one_at_a_time_4", { order: "asc", types: ["user.message"], limit: 1 });
    expect([listed?.runId, listed?.processedAt]).toEqual(["", ""]);
    const [error] = await store.sessionEvents.list("ses_one_at_a_time_4", { order: "asc", types: ["session.error"], limit: 1 });
    expect(error?.runId, "the session says why the messages were not read").toBe("");
  });

  it("terminate of a run already terminated drops nothing and touches nothing", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    const done = await seedExecution({ phase: RunPhase.RUN_TERMINATED, sessionId: "ses_one_at_a_time_7" });
    const result = await terminateExecution(deps, terminateInput(done), testCallerIdentity());
    expect(result.status?.phase).toBe(RunPhase.RUN_TERMINATED);
  });

  it("terminate of a run in no session drops nothing", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));
    const alone = await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS });
    const result = await terminateExecution(deps, terminateInput(alone), testCallerIdentity());
    expect(result.status?.phase).toBe(RunPhase.RUN_TERMINATED);
  });

  it("a fault reading or dropping the session's queue is a sanitized Internal", async () => {
    const queueFails = (deps: LifecycleDeps): LifecycleDeps => ({
      ...deps,
      store: new Proxy(store, {
        get(target, property, receiver) {
          if (property === "writeSessionQueue") {
            return () => Promise.reject(new Error("disk full"));
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const deps = queueFails(lifecycleDeps(connected(stubConnectedEngine())));
    const paused = await seedExecution({ phase: RunPhase.RUN_PAUSED, sessionId: "ses_one_at_a_time_5" });
    const read = await expectCode(() => resumeExecution(deps, resumeInput(paused), testCallerIdentity()), Code.Internal);
    expect(read.rawMessage).toBe("failed to read the session's turns");
    const working = await seedExecution({ phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_one_at_a_time_6" });
    const dropped = await expectCode(() => terminateExecution(deps, terminateInput(working), testCallerIdentity()), Code.Internal);
    expect(dropped.rawMessage).toBe("failed to drop the session's queued messages");
  });
});

describe("recover runs one at a time per execution (stigmer#1672)", () => {
  it("two concurrent recovers of one FAILED execution run one after the other; the second finds it IN_PROGRESS and touches nothing", async () => {
    let runCalls = 0;
    const secondQueued = deferred();
    const firstAtEngine = deferred();
    const secondAtEngine = deferred();
    const releaseFirst = deferred();
    let terminations = 0;
    const starts: string[] = [];
    const plans: Run[] = [];
    const deps: LifecycleDeps = {
      ...lifecycleDeps(
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {
              terminations += 1;
              if (terminations === 1) {
                firstAtEngine.resolve();
                await releaseFirst.promise;
                return;
              }
              secondAtEngine.resolve();
            },
            startInvokeWorkflow: async (params) => {
              starts.push(params.executionId);
            },
          }),
        ),
      ),
      recoverSerializer: new SignallingSerializer(() => {
        runCalls += 1;
        if (runCalls === 2) {
          secondQueued.resolve();
        }
      }),
      runValuePlanner: stubPlannerDeps({
        onPlan: (execution) => plans.push(execution),
      }),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
      error: "runner exploded",
    });

    const first = recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    await firstAtEngine.promise;
    const second = recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    await Promise.race([secondQueued.promise, secondAtEngine.promise]);
    expect(
      terminations,
      "the second recover reached the engine while the first held its turn",
    ).toBe(1);
    releaseFirst.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect(secondResult.status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect(terminations).toBe(1);
    expect(plans).toHaveLength(1);
    expect(starts).toEqual([id]);
  });

  it("a recover that follows a failed one retries in full", async () => {
    const order: string[] = [];
    const firstAtEngine = deferred();
    const secondQueuedOrAtEngine = deferred();
    const releaseFirst = deferred();
    let terminations = 0;
    let startCalls = 0;
    let runCalls = 0;
    const deps: LifecycleDeps = {
      ...lifecycleDeps(
        connected(
          stubConnectedEngine({
            terminateWorkflow: async () => {
              terminations += 1;
              order.push("terminate");
              if (terminations === 1) {
                firstAtEngine.resolve();
                await releaseFirst.promise;
                return;
              }
              secondQueuedOrAtEngine.resolve();
            },
            startInvokeWorkflow: async () => {
              startCalls += 1;
              if (startCalls === 1) {
                order.push("start failed");
                throw new Error("temporal start exploded");
              }
              order.push("start");
            },
          }),
        ),
      ),
      recoverSerializer: new SignallingSerializer(() => {
        runCalls += 1;
        if (runCalls === 2) {
          secondQueuedOrAtEngine.resolve();
        }
      }),
    };
    const id = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
      error: "runner exploded",
    });

    const first = recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    await firstAtEngine.promise;
    const second = recoverExecution(
      deps,
      recoverInput(id),
      testCallerIdentity(),
    );
    await secondQueuedOrAtEngine.promise;
    releaseFirst.resolve();

    const firstError = await expectCode(() => first, Code.Internal);
    expect(firstError.rawMessage).toBe(
      "failed to start fresh Temporal workflow for recovered execution",
    );
    const secondResult = await second;
    expect(secondResult.status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect(secondResult.status?.error).toBe("");
    expect(order).toEqual(["terminate", "start failed", "terminate", "start"]);
  });

  it("recovers of two different executions do not wait on each other", async () => {
    const firstAtEngine = deferred();
    const otherAtEngine = deferred();
    const releaseFirst = deferred();
    const deps: LifecycleDeps = lifecycleDeps(
      connected(
        stubConnectedEngine({
          terminateWorkflow: async (executionId) => {
            if (executionId === held) {
              firstAtEngine.resolve();
              await releaseFirst.promise;
              return;
            }
            otherAtEngine.resolve();
          },
        }),
      ),
    );
    const held = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
    });
    const other = await seedExecution({
      phase: RunPhase.RUN_FAILED,
      sessionId: freshSession(),
    });

    const first = recoverExecution(
      deps,
      recoverInput(held),
      testCallerIdentity(),
    );
    await firstAtEngine.promise;
    const second = recoverExecution(
      deps,
      recoverInput(other),
      testCallerIdentity(),
    );
    // Reached only if the other execution's recover is not queued behind
    // the held one; a shared queue would time the case out instead.
    await otherAtEngine.promise;
    releaseFirst.resolve();

    const results = await Promise.all([first, second]);
    for (const result of results) {
      expect(result.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    }
  });
});

// The lifecycle persist must go through the store's atomic row-locked
// write, never the whole-resource saveResource it replaced (Go
// TestLifecyclePersist_UsesUpdateResource): a saveResource here is the
// regression that lets a concurrent write to the run (its file record, as
// the race test below writes) be clobbered.
// The atomic write is writeResourceAppendingEvents since a transition
// commits with its session's events (session/events/run-writes.ts). The
// mechanism pin complements the race test below — it pinpoints the
// regression without depending on interleaving.
describe("lifecycle persist uses the atomic row-locked write", () => {
  const cases: Array<{
    name: string;
    run: (deps: LifecycleDeps, id: string) => Promise<unknown>;
    fromPhase: RunPhase;
    wantPhase: RunPhase;
  }> = [
    {
      name: "pause",
      run: (deps, id) =>
        pauseExecution(deps, pauseInput(id), testCallerIdentity()),
      fromPhase: RunPhase.RUN_IN_PROGRESS,
      wantPhase: RunPhase.RUN_PAUSED,
    },
    {
      name: "cancel",
      run: (deps, id) =>
        cancelExecution(deps, cancelInput(id), testCallerIdentity()),
      fromPhase: RunPhase.RUN_IN_PROGRESS,
      wantPhase: RunPhase.RUN_CANCELLED,
    },
    {
      name: "terminate",
      run: (deps, id) =>
        terminateExecution(deps, terminateInput(id), testCallerIdentity()),
      fromPhase: RunPhase.RUN_IN_PROGRESS,
      wantPhase: RunPhase.RUN_TERMINATED,
    },
  ];

  for (const tc of cases) {
    it(tc.name, async () => {
      let updateCalls = 0;
      let saveCalls = 0;
      const countingStore = new Proxy(store, {
        get(target, prop, receiver) {
          if (prop === "writeResourceAppendingEvents") {
            return (...args: Parameters<Store["writeResourceAppendingEvents"]>) => {
              updateCalls += 1;
              return target.writeResourceAppendingEvents(...args);
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
        recoverSerializer: new KeyedSerializer(),
            sessionEventBroker: new SessionEventBroker(silentLogger),
        engineState: () => connected(stubConnectedEngine()),
        runValuePlanner: stubPlannerDeps(),
        gateSteps: new Map(),
        statusObservers: [],
        sandboxLane: { enabled: false },
        temporalConfig: newConfigFromEnv(),
        personAccounts: undefined,
      };

      // Seed through the RAW store so the seed write is not counted.
      const id = await seedExecution({ phase: tc.fromPhase });

      await tc.run(deps, id);

      expect(updateCalls, "exactly 1 atomic row-locked write").toBe(1);
      expect(saveCalls, "0 whole-resource saveResource").toBe(0);

      const final = await store.getResource(
        ApiResourceKind.run,
        id,
        RunSchema,
      );
      expect(final.status?.phase).toBe(tc.wantPhase);
    });
  }
});

// The lifecycle path never loses a concurrent write: a pause and a write to
// the run's file record race on the same run. Because the lifecycle persist
// re-reads fresh under the store's write lock, it can never clobber what a
// concurrent writer recorded (Go's 50-iteration regression).
describe("lifecycle pause racing a write to the run's record", () => {
  it("keeps both the record and the pause across 50 races", async () => {
    const deps = lifecycleDeps(connected(stubConnectedEngine()));

    for (let i = 0; i < 50; i++) {
      const id = `aexec_pause_race_${i}`;
      await store.saveResource(
        ApiResourceKind.run,
        id,
        RunSchema,
        create(RunSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Run",
          metadata: { id, name: id },
          spec: {},
          status: { phase: RunPhase.RUN_IN_PROGRESS },
        }),
      );

      await Promise.all([
        pauseExecution(deps, pauseInput(id), testCallerIdentity()),
        store.updateResource(ApiResourceKind.run, id, RunSchema, (loaded) => {
          loaded.status!.fileChanges.push(capturedSet(`${id}:0`));
        }),
      ]);

      const final = await store.getResource(ApiResourceKind.run, id, RunSchema);

      expect(final.status?.fileChanges.map((cs) => cs.id), `iteration ${i}: record lost`).toEqual([`${id}:0`]);
      // The pause transition must also have landed.
      expect(final.status?.phase, `iteration ${i}: phase`).toBe(RunPhase.RUN_PAUSED);
    }
  });
});
