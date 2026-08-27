/**
 * Pins the five lifecycle RPCs against Go's lifecycle_test.go and
 * terminate_existing_workflow_step_test.go case-for-case: the phase
 * matrices with their byte-pinned FailedPrecondition copy, idempotent
 * target-phase no-ops, the engineless postures, the connected-engine call
 * shapes over the byte-pinned workflow IDs, the workflow-not-found
 * warn-and-proceed arms, terminate's reason/error quirk, and recover's
 * full choreography (terminate both tree members, EC recreate
 * degrade-gracefully, fresh start with recovery_mode, error clear).
 */
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  CancelWorkflowExecutionInputSchema,
  PauseWorkflowExecutionInputSchema,
  RecoverWorkflowExecutionInputSchema,
  ResumeWorkflowExecutionInputSchema,
  TerminateWorkflowExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import {
  childWorkflowId,
  orchestratorWorkflowId,
  TEMPORAL_UNAVAILABLE_CREATOR_MESSAGE,
  TEMPORAL_UNAVAILABLE_MESSAGE,
} from "../constants.js";
import type { WorkflowExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { newWorkflowExecutionConfigFromEnv } from "../temporal/config.js";
import { ENGINE_DISCONNECTED, EngineWorkflowNotFoundError } from "../engine.js";
import type { LifecycleDeps } from "../lifecycle.js";
import {
  applyLifecyclePhaseTransition,
  cancelExecution,
  pauseExecution,
  recoverExecution,
  resumeExecution,
  terminateExecution,
} from "../lifecycle.js";
import { StreamBroker } from "../stream-broker.js";
import { stubConnectedEngine } from "./engine-stub.js";
import type { EngineStub } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: SqliteStore;
let broker: StreamBroker;
let counter = 0;

// Input builders — real proto messages (RequestContext clones through the
// schema, so plain object literals are not acceptable).
type IdReason = { id: string; reason?: string };
const cancelInput = (init: IdReason) =>
  create(CancelWorkflowExecutionInputSchema, init);
const terminateInput = (init: IdReason) =>
  create(TerminateWorkflowExecutionInputSchema, init);
const pauseInput = (init: IdReason) =>
  create(PauseWorkflowExecutionInputSchema, init);
const resumeInput = (init: IdReason) =>
  create(ResumeWorkflowExecutionInputSchema, init);
const recoverInput = (init: IdReason) =>
  create(RecoverWorkflowExecutionInputSchema, init);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-lifecycle-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
  broker = new StreamBroker(silentLogger);
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The EC-builder deps recover consumes; the loaders throw NotFound-ish
 * errors by default, exercising the degrade-gracefully arms. */
function builderDeps(): WorkflowExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    workflowInstanceLoader: () => ({
      get: () =>
        Promise.reject(
          new ConnectError("workflow_instance not found", Code.NotFound),
        ),
    }),
    environmentResolution: {
      resolveByReference: () =>
        Promise.reject(new Error("no environments in this test")),
    } as unknown as WorkflowExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: () => Promise.reject(new Error("unused in this test")),
    }),
  };
}

function deps(engineStub?: EngineStub): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    broker,
    engineState: () => engineStub?.state ?? ENGINE_DISCONNECTED,
    executionContextBuilder: builderDeps(),
    // The OSS default sandbox posture (§6d, O6): lane disabled — the
    // recover ensure short-circuits and the terminal observer no-ops.
    sandboxLane: { enabled: false },
    temporalConfig: newWorkflowExecutionConfigFromEnv(),
    sandboxTerminalObserver: () => {},
    // Empty slots — the OSS shape; the recover chain's
    // sandbox-acquisition:gate splice contributes nothing here (C4).
    gateSteps: new Map(),
  };
}

async function seed(
  phase: ExecutionPhase,
  overrides?: MessageInitShape<typeof WorkflowExecutionSchema>["status"],
): Promise<string> {
  counter += 1;
  const id = `wfx_lc_${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow_execution,
    id,
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { id, name: id, org: "acme" },
      spec: {
        workflowId: `wf_${counter}`,
        workflowInstanceId: `wfi_${counter}`,
      },
      status: { phase, ...overrides },
    }),
  );
  return id;
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(code);
    return error as ConnectError;
  }
  throw new Error(`expected ${Code[code]}, call succeeded`);
}

describe("shared load + validation arms (lifecycle_test.go)", () => {
  it("empty id refuses InvalidArgument; unknown id NotFound", async () => {
    const err = await expectCode(
      () =>
        cancelExecution(deps(), cancelInput({ id: "" }), testCallerIdentity()),
      Code.InvalidArgument,
    );
    expect(err.rawMessage).toBe("execution id is required");
    const missing = await expectCode(
      () =>
        cancelExecution(
          deps(),
          cancelInput({ id: "wfx_missing" }),
          testCallerIdentity(),
        ),
      Code.NotFound,
    );
    expect(missing.rawMessage).toBe(
      "workflow_execution not found: wfx_missing",
    );
  });

  it("phase validators refuse with the pinned copy", async () => {
    const completed = await seed(ExecutionPhase.EXECUTION_COMPLETED);
    const cancelErr = await expectCode(
      () =>
        cancelExecution(
          deps(),
          cancelInput({ id: completed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(cancelErr.rawMessage).toBe(
      "cannot cancel execution in phase EXECUTION_COMPLETED; only PENDING, IN_PROGRESS, or PAUSED can be cancelled",
    );

    const terminateErr = await expectCode(
      () =>
        terminateExecution(
          deps(),
          terminateInput({ id: completed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(terminateErr.rawMessage).toBe(
      "cannot terminate execution in phase EXECUTION_COMPLETED; only PENDING, IN_PROGRESS, or PAUSED can be terminated",
    );

    const paused = await seed(ExecutionPhase.EXECUTION_PAUSED);
    const pauseErr = await expectCode(
      () =>
        pauseExecution(
          deps(),
          pauseInput({ id: completed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(pauseErr.rawMessage).toBe(
      "cannot pause execution in phase EXECUTION_COMPLETED; only PENDING or IN_PROGRESS can be paused",
    );

    const resumeErr = await expectCode(
      () =>
        resumeExecution(
          deps(),
          resumeInput({ id: completed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(resumeErr.rawMessage).toBe(
      "cannot resume execution in phase EXECUTION_COMPLETED; only PAUSED executions can be resumed",
    );
    // PAUSED is resumable — engineless it fails at the ENGINE, not the
    // validator (proving validator pass-through).
    const engineErr = await expectCode(
      () =>
        resumeExecution(
          deps(),
          resumeInput({ id: paused }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(engineErr.rawMessage).toBe(TEMPORAL_UNAVAILABLE_MESSAGE);

    const recoverErr = await expectCode(
      () =>
        recoverExecution(
          deps(),
          recoverInput({ id: completed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(recoverErr.rawMessage).toBe(
      "cannot recover execution in phase EXECUTION_COMPLETED; only FAILED executions can be recovered",
    );
  });

  it("target-phase idempotency succeeds without touching the engine", async () => {
    const cancelled = await seed(ExecutionPhase.EXECUTION_CANCELLED);
    const result = await cancelExecution(
      deps(),
      cancelInput({ id: cancelled }),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);

    const terminated = await seed(ExecutionPhase.EXECUTION_TERMINATED);
    await terminateExecution(
      deps(),
      terminateInput({ id: terminated }),
      testCallerIdentity(),
    );

    const inProgress = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await resumeExecution(
      deps(),
      resumeInput({ id: inProgress }),
      testCallerIdentity(),
    );
    await recoverExecution(
      deps(),
      recoverInput({ id: inProgress }),
      testCallerIdentity(),
    );

    const paused = await seed(ExecutionPhase.EXECUTION_PAUSED);
    await pauseExecution(
      deps(),
      pauseInput({ id: paused }),
      testCallerIdentity(),
    );
  });

  it("engineless postures: FailedPrecondition per pinned copy", async () => {
    const running = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const englessOps = [
      () =>
        cancelExecution(
          deps(),
          cancelInput({ id: running }),
          testCallerIdentity(),
        ),
      () =>
        terminateExecution(
          deps(),
          terminateInput({ id: running }),
          testCallerIdentity(),
        ),
      () =>
        pauseExecution(
          deps(),
          pauseInput({ id: running }),
          testCallerIdentity(),
        ),
    ];
    for (const op of englessOps) {
      const err = await expectCode(op, Code.FailedPrecondition);
      expect(err.rawMessage).toBe(TEMPORAL_UNAVAILABLE_MESSAGE);
    }
    // Recover's first engine touch is the terminate-existing step.
    const failed = await seed(ExecutionPhase.EXECUTION_FAILED);
    const recoverErr = await expectCode(
      () =>
        recoverExecution(
          deps(),
          recoverInput({ id: failed }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(recoverErr.rawMessage).toBe(TEMPORAL_UNAVAILABLE_MESSAGE);
  });
});

describe("connected-engine transitions", () => {
  let engine: EngineStub;
  beforeEach(() => {
    engine = stubConnectedEngine();
  });

  it("cancel: CancelWorkflow on the orchestrator id, CANCELLED persisted with completed_at", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const result = await cancelExecution(
      deps(engine),
      cancelInput({ id }),
      testCallerIdentity(),
    );

    expect(engine.calls).toEqual([
      { method: "cancelWorkflow", args: [orchestratorWorkflowId(id)] },
    ]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
    expect(result.status?.completedAt).not.toBe("");
    // Go time.RFC3339: seconds precision, no fractional part.
    expect(result.status?.completedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    // Cancel writes NO error (quiet terminal, #282).
    expect(result.status?.error).toBe("");
  });

  it("workflow-not-found on the engine is warn-and-proceed (local state still transitions)", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    engine.failures.cancelWorkflow = new EngineWorkflowNotFoundError(
      orchestratorWorkflowId(id),
    );
    const result = await cancelExecution(
      deps(engine),
      cancelInput({ id }),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_CANCELLED);
  });

  it("other engine failures answer Internal with the pinned message", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    engine.failures.cancelWorkflow = new Error("temporal exploded");
    const err = await expectCode(
      () =>
        cancelExecution(
          deps(engine),
          cancelInput({ id }),
          testCallerIdentity(),
        ),
      Code.Internal,
    );
    expect(err.rawMessage).toBe("failed to cancel Temporal workflow");
  });

  it("terminate: reason default + 'Terminated: {reason}' error copy", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const result = await terminateExecution(
      deps(engine),
      terminateInput({ id, reason: "stuck" }),
      testCallerIdentity(),
    );
    expect(engine.calls).toEqual([
      {
        method: "terminateWorkflow",
        args: [orchestratorWorkflowId(id), "stuck"],
      },
    ]);
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(result.status?.error).toBe("Terminated: stuck");

    const defaulted = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const result2 = await terminateExecution(
      deps(engine),
      terminateInput({ id: defaulted }),
      testCallerIdentity(),
    );
    expect(result2.status?.error).toBe("Terminated: Terminated by user");
  });

  it("terminate quirk: workflow-gone termination falls back to 'Terminated by user'", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    engine.failures.terminateWorkflow = new EngineWorkflowNotFoundError(
      orchestratorWorkflowId(id),
    );
    // Go's NotFound arm returns before ReasonKey is recorded — even an
    // explicit reason is lost and the default copy applies.
    const result = await terminateExecution(
      deps(engine),
      terminateInput({ id, reason: "explicit reason" }),
      testCallerIdentity(),
    );
    expect(result.status?.error).toBe("Terminated by user");
  });

  it("pause/resume: the byte-pinned signal names with the reason payload", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const paused = await pauseExecution(
      deps(engine),
      pauseInput({ id }),
      testCallerIdentity(),
    );
    expect(paused.status?.phase).toBe(ExecutionPhase.EXECUTION_PAUSED);
    // PAUSED is not terminal — completed_at stays empty.
    expect(paused.status?.completedAt).toBe("");

    const resumed = await resumeExecution(
      deps(engine),
      resumeInput({ id }),
      testCallerIdentity(),
    );
    expect(resumed.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);

    expect(engine.calls).toEqual([
      {
        method: "signalWorkflow",
        args: [orchestratorWorkflowId(id), "pause", "Paused by user"],
      },
      {
        method: "signalWorkflow",
        args: [orchestratorWorkflowId(id), "resume", undefined],
      },
    ]);
  });

  it("recover: terminates BOTH tree members, starts fresh with recovery_mode, clears error", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_FAILED, {
      error: "boom",
      completedAt: "2026-05-23T10:00:00Z",
    });
    const result = await recoverExecution(
      deps(engine),
      recoverInput({ id }),
      testCallerIdentity(),
    );

    expect(engine.calls[0]).toEqual({
      method: "terminateWorkflow",
      args: [
        orchestratorWorkflowId(id),
        "Recovery: terminating before fresh workflow start",
      ],
    });
    expect(engine.calls[1]).toEqual({
      method: "terminateWorkflow",
      args: [
        childWorkflowId(id),
        "Recovery: terminating before fresh workflow start",
      ],
    });
    expect(engine.calls[2]?.method).toBe("startInvokeWorkflow");
    const startInput = engine.calls[2]?.args[0] as { recoveryMode: boolean };
    expect(startInput.recoveryMode).toBe(true);

    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(result.status?.error, "recover clears the error").toBe("");
    expect(
      result.status?.completedAt,
      "back to IN_PROGRESS clears completed_at",
    ).toBe("");
  });

  it("recover: NOT_FOUND on either tree member is tolerated; orchestrator failure short-circuits the child", async () => {
    const tolerated = await seed(ExecutionPhase.EXECUTION_FAILED);
    engine.failures.terminateWorkflow = new EngineWorkflowNotFoundError("x");
    const result = await recoverExecution(
      deps(engine),
      recoverInput({ id: tolerated }),
      testCallerIdentity(),
    );
    expect(result.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);

    const failing = await seed(ExecutionPhase.EXECUTION_FAILED);
    const hardFail = stubConnectedEngine();
    hardFail.failures.terminateWorkflow = new Error("terminate exploded");
    const err = await expectCode(
      () =>
        recoverExecution(
          deps(hardFail),
          recoverInput({ id: failing }),
          testCallerIdentity(),
        ),
      Code.Internal,
    );
    expect(err.rawMessage).toBe(
      "failed to terminate orchestrator workflow during recovery",
    );
    // The child terminate never ran (short-circuit).
    expect(
      hardFail.calls.filter((c) => c.method === "terminateWorkflow"),
    ).toHaveLength(1);
  });

  it("recover: a fresh-start failure leaves the execution FAILED (user can retry)", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_FAILED, { error: "boom" });
    engine.failures.startInvokeWorkflow = new Error("start exploded");
    const err = await expectCode(
      () =>
        recoverExecution(
          deps(engine),
          recoverInput({ id }),
          testCallerIdentity(),
        ),
      Code.Internal,
    );
    expect(err.rawMessage).toBe(
      "failed to start fresh Temporal workflow for recovered execution",
    );
    const stored = await store.getResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
    );
    expect(stored.status?.phase, "phase update never ran").toBe(
      ExecutionPhase.EXECUTION_FAILED,
    );
    expect(stored.status?.error).toBe("boom");
  });

  it("lifecycle transitions broadcast the persisted state", async () => {
    const id = await seed(ExecutionPhase.EXECUTION_IN_PROGRESS);
    const subscription = broker.subscribe(id);
    try {
      await cancelExecution(
        deps(engine),
        cancelInput({ id }),
        testCallerIdentity(),
      );
      expect(subscription.queue).toHaveLength(1);
      expect(subscription.queue[0].status?.phase).toBe(
        ExecutionPhase.EXECUTION_CANCELLED,
      );
    } finally {
      broker.unsubscribe(id, subscription);
    }
  });
});

describe("applyLifecyclePhaseTransition (the RMW body, exercised directly)", () => {
  it("initializes a missing status and applies the terminal fields", () => {
    const execution = create(WorkflowExecutionSchema, {
      metadata: { id: "wfx_direct" },
    });
    applyLifecyclePhaseTransition(
      execution,
      ExecutionPhase.EXECUTION_TERMINATED,
      true,
      false,
      "why",
    );
    expect(execution.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(execution.status?.error).toBe("Terminated: why");
    expect(execution.status?.completedAt).not.toBe("");
  });
});

describe("recover engineless posture (fresh-start message)", () => {
  it("start-fresh's creator-specific copy is distinct", async () => {
    // Reach StartFreshWorkflow with a connected-then-broken engine is not
    // possible through one provider — instead pin the constant here so a
    // rename breaks loudly (the Class B suite asserts the wire arm once
    // #21 wires a real engine).
    expect(TEMPORAL_UNAVAILABLE_CREATOR_MESSAGE).toBe(
      "Temporal is not available (workflow creator not set)",
    );
  });
});
