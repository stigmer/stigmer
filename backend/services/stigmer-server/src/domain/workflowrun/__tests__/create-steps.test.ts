/**
 * Pins the create-pipeline steps: PinWorkflowVersion (the one workflow
 * load of a create — it pins the head's hash, keeps the loaded row for the
 * ExecutionContext build, leaves the pin empty for a workflow with no
 * hash, and refuses an unknown workflow NOT_FOUND naming it), and
 * StartWorkflow's failure posture (execution marked FAILED with the error
 * text and persisted — recoverable via Recover, a run with no status given
 * one) and its slim input, which carries no instance key; and
 * SetInitialPhase's PENDING stamp, on a run with or without a status.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import {
  newSetInitialPhaseStep,
  newStartWorkflowStep,
} from "../create-steps.js";
import {
  PINNED_WORKFLOW_KEY,
  newPinWorkflowVersionStep,
  pinnedWorkflowOf,
} from "../pin-workflow-version-step.js";
import { stubConnectedEngine } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: SqliteStore;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-create-steps-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function executionCtx(
  init: MessageInitShape<typeof WorkflowRunSchema>,
): RequestContext<typeof WorkflowRunSchema> {
  return new RequestContext(
    WorkflowRunSchema,
    create(WorkflowRunSchema, init),
    testCallerIdentity(),
    ApiResourceKind.workflow_run,
  );
}

async function seedWorkflow(overrides?: {
  versionHash?: string;
  slug?: string;
}): Promise<string> {
  counter += 1;
  const id = `wf_cs_${counter}`;
  const slug = overrides?.slug ?? `flow-${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow,
    id,
    WorkflowSchema,
    create(WorkflowSchema, {
      metadata: { id, name: slug, slug, org: "acme" },
      status: { versionHash: overrides?.versionHash ?? "" },
    }),
  );
  return id;
}

describe("PinWorkflowVersion", () => {
  it("pins the head's hash and keeps the row it loaded for the context build", async () => {
    const workflowId = await seedWorkflow({ versionHash: "h".repeat(64) });
    const ctx = executionCtx({ spec: { workflowId } });
    await newPinWorkflowVersionStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.status?.workflowVersionHash).toBe("h".repeat(64));
    expect(pinnedWorkflowOf(ctx).metadata?.id).toBe(workflowId);
  });

  it("leaves the pin empty for a workflow with no hash, and still keeps the row", async () => {
    const workflowId = await seedWorkflow({ versionHash: "" });
    const ctx = executionCtx({ spec: { workflowId } });
    await newPinWorkflowVersionStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.status?.workflowVersionHash ?? "").toBe("");
    expect((ctx.get(PINNED_WORKFLOW_KEY) as Workflow).metadata?.id).toBe(
      workflowId,
    );
  });

  it("refuses an unknown workflow NOT_FOUND naming it, and keeps nothing", async () => {
    const ctx = executionCtx({ spec: { workflowId: "wfl_missing" } });
    try {
      await newPinWorkflowVersionStep(store, silentLogger).execute(ctx);
      expect.unreachable("expected NotFound");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.NotFound);
      expect((error as ConnectError).rawMessage).toBe(
        "Workflow not found: wfl_missing",
      );
    }
    expect(ctx.get(PINNED_WORKFLOW_KEY)).toBeUndefined();
  });

  it("answers Internal when the context build reads a row no pin loaded", () => {
    const ctx = executionCtx({ spec: { workflowId: "wfl_x" } });
    expect(() => pinnedWorkflowOf(ctx)).toThrowError(
      expect.objectContaining({ code: Code.Internal }),
    );
  });
});

describe("SetInitialPhase", () => {
  it("gives a run with no status a PENDING one", async () => {
    const ctx = executionCtx({ metadata: { id: "wfx_phase" } });

    await newSetInitialPhaseStep().execute(ctx);

    expect(ctx.newState.status?.phase).toBe(RunPhase.RUN_PENDING);
  });

  it("stamps PENDING over a caller's phase and keeps the rest of the status", async () => {
    const ctx = executionCtx({
      metadata: { id: "wfx_phase" },
      status: { phase: RunPhase.RUN_COMPLETED, error: "kept" },
    });

    await newSetInitialPhaseStep().execute(ctx);

    expect(ctx.newState.status?.phase).toBe(RunPhase.RUN_PENDING);
    expect(ctx.newState.status?.error).toBe("kept");
  });
});

describe("StartWorkflow failure posture (create.go startWorkflowStep)", () => {
  it("marks the execution FAILED with the error text, persists, and answers Internal", async () => {
    counter += 1;
    const executionId = `wfx_start_${counter}`;
    // The step runs post-persist: seed the record first, like the
    // pipeline's Persist step just did.
    const execution: WorkflowRun = create(WorkflowRunSchema, {
      metadata: { id: executionId, name: executionId, org: "acme" },
      spec: { workflowId: "wf_x" },
      status: { phase: RunPhase.RUN_PENDING },
    });
    await store.saveResource(
      ApiResourceKind.workflow_run,
      executionId,
      WorkflowRunSchema,
      execution,
    );

    const engine = stubConnectedEngine();
    engine.failures.startInvokeWorkflow = new Error("queue unreachable");
    const ctx = new RequestContext(
      WorkflowRunSchema,
      execution,
      testCallerIdentity(),
      ApiResourceKind.workflow_run,
    );
    const step = newStartWorkflowStep({
      store,
      logger: silentLogger,
      engineState: () => engine.state,
    });
    try {
      await step.execute(ctx);
      expect.unreachable("expected Internal");
    } catch (error) {
      expect((error as ConnectError).code).toBe(Code.Internal);
      expect((error as ConnectError).rawMessage).toBe(
        "failed to start workflow",
      );
    }
    const stored = await store.getResource(
      ApiResourceKind.workflow_run,
      executionId,
      WorkflowRunSchema,
    );
    expect(stored.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(stored.status?.error).toBe(
      "Failed to start Temporal workflow: queue unreachable",
    );
  });

  it("gives a run with no status a FAILED one when the engine dropped after the gate", async () => {
    counter += 1;
    const executionId = `wfx_start_${counter}`;
    const execution: WorkflowRun = create(WorkflowRunSchema, {
      metadata: { id: executionId, name: executionId, org: "acme" },
      spec: { workflowId: "wf_x" },
    });
    await store.saveResource(
      ApiResourceKind.workflow_run,
      executionId,
      WorkflowRunSchema,
      execution,
    );
    const step = newStartWorkflowStep({
      store,
      logger: silentLogger,
      engineState: () => ({ connected: false }),
    });

    const ctx = new RequestContext(
      WorkflowRunSchema,
      execution,
      testCallerIdentity(),
      ApiResourceKind.workflow_run,
    );
    await expect(async () => step.execute(ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof ConnectError && e.code === Code.Internal,
    );
    const stored = await store.getResource(
      ApiResourceKind.workflow_run,
      executionId,
      WorkflowRunSchema,
    );
    expect(stored.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(stored.status?.error).toBe(
      "Failed to start Temporal workflow: workflow engine disconnected after the create gate",
    );
  });

  it("passes the slim input, with no instance key and recovery_mode false, on success", async () => {
    const engine = stubConnectedEngine();
    const ctx = executionCtx({
      metadata: { id: "wfx_ok", name: "wfx_ok", org: "acme" },
      spec: { workflowId: "wf_x" },
    });
    await newStartWorkflowStep({
      store,
      logger: silentLogger,
      engineState: () => engine.state,
    }).execute(ctx);
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0].args[0]).toMatchObject({
      executionId: "wfx_ok",
      workflowId: "wf_x",
      orgId: "acme",
      recoveryMode: false,
    });
    expect(engine.calls[0].args[0]).not.toHaveProperty("workflowInstanceId");
  });
});
