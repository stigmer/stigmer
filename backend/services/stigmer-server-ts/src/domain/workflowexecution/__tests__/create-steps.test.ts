/**
 * Pins the create-pipeline steps against Go case-for-case:
 * pin_workflow_version_step_test.go (direct id, instance-only resolution,
 * the graceful skips), normalize_workflow_ref_step_test.go (resolve from
 * instance, no-op when set, graceful skips), the default-instance
 * resolution paths of create.go (status id, slug self-heal + status
 * backfill, create + backfill), and StartWorkflow's failure posture
 * (execution marked FAILED with the error text and persisted —
 * recoverable via Recover).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";

import {
  newCreateDefaultInstanceIfNeededStep,
  newStartWorkflowStep,
  newValidateWorkflowOrInstanceStep,
} from "../create-steps.js";
import { newNormalizeWorkflowRefStep } from "../normalize-workflow-ref-step.js";
import { newPinWorkflowVersionStep } from "../pin-workflow-version-step.js";
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
  init: MessageInitShape<typeof WorkflowExecutionSchema>,
): RequestContext<typeof WorkflowExecutionSchema> {
  return new RequestContext(
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, init),
    ApiResourceKind.workflow_execution,
  );
}

async function seedWorkflow(overrides?: {
  versionHash?: string;
  defaultInstanceId?: string;
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
      status: {
        versionHash: overrides?.versionHash ?? "",
        defaultInstanceId: overrides?.defaultInstanceId ?? "",
      },
    }),
  );
  return id;
}

async function seedInstance(workflowId: string, slug: string): Promise<string> {
  counter += 1;
  const id = `wfi_cs_${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow_instance,
    id,
    WorkflowInstanceSchema,
    create(WorkflowInstanceSchema, {
      metadata: { id, name: slug, slug, org: "acme" },
      spec: { workflowId },
    }),
  );
  return id;
}

describe("ValidateWorkflowOrInstance (the #196 InvalidArgument contrast)", () => {
  it("refuses when neither reference is provided", () => {
    const ctx = executionCtx({ metadata: { name: "x" }, spec: {} });
    try {
      newValidateWorkflowOrInstanceStep().execute(ctx);
      expect.unreachable("expected InvalidArgument");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
      expect((error as ConnectError).rawMessage).toBe(
        "either workflow_id or workflow_instance_id must be provided",
      );
    }
  });

  it("passes with either reference", () => {
    newValidateWorkflowOrInstanceStep().execute(
      executionCtx({ spec: { workflowId: "wf_x" } }),
    );
    newValidateWorkflowOrInstanceStep().execute(
      executionCtx({ spec: { workflowInstanceId: "wfi_x" } }),
    );
  });
});

describe("CreateDefaultInstanceIfNeeded (create.go resolution paths)", () => {
  function stepDeps(created?: WorkflowInstance) {
    const calls: WorkflowInstance[] = [];
    return {
      calls,
      deps: {
        store,
        logger: silentLogger,
        workflowInstanceCreator: () => ({
          createAsSystem: async (instance: WorkflowInstance) => {
            calls.push(instance);
            return (
              created ??
              create(WorkflowInstanceSchema, {
                metadata: { id: "wfi_created", name: "n", slug: "s" },
              })
            );
          },
        }),
      },
    };
  }

  it("skips when workflow_instance_id is provided", async () => {
    const { deps, calls } = stepDeps();
    const ctx = executionCtx({ spec: { workflowInstanceId: "wfi_given" } });
    await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
    expect(calls).toHaveLength(0);
    expect(ctx.newState.spec?.workflowInstanceId).toBe("wfi_given");
  });

  it("unknown workflow answers NotFound", async () => {
    const { deps } = stepDeps();
    const ctx = executionCtx({ spec: { workflowId: "wf_missing" } });
    try {
      await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
      expect.unreachable("expected NotFound");
    } catch (error) {
      expect((error as ConnectError).code).toBe(Code.NotFound);
      expect((error as ConnectError).rawMessage).toBe(
        "Workflow not found: wf_missing",
      );
    }
  });

  it("uses status.default_instance_id when set", async () => {
    const workflowId = await seedWorkflow({ defaultInstanceId: "wfi_status" });
    const { deps, calls } = stepDeps();
    const ctx = executionCtx({ spec: { workflowId } });
    await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
    expect(ctx.newState.spec?.workflowInstanceId).toBe("wfi_status");
    expect(calls).toHaveLength(0);
  });

  it("self-heals from the deterministic slug and backfills the workflow status", async () => {
    const workflowId = await seedWorkflow({ slug: "healme" });
    const instanceId = await seedInstance(workflowId, "healme-default");
    const { deps, calls } = stepDeps();
    const ctx = executionCtx({ spec: { workflowId } });
    await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
    expect(ctx.newState.spec?.workflowInstanceId).toBe(instanceId);
    expect(calls, "no create when the instance already exists").toHaveLength(0);

    const workflow = await store.getResource(
      ApiResourceKind.workflow,
      workflowId,
      WorkflowSchema,
    );
    expect(
      workflow.status?.defaultInstanceId,
      "the failed status write is healed",
    ).toBe(instanceId);
  });

  it("creates the instance via the in-process edge and backfills", async () => {
    const workflowId = await seedWorkflow({ slug: "fresh" });
    const { deps, calls } = stepDeps();
    const ctx = executionCtx({ spec: { workflowId } });
    await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
    expect(calls).toHaveLength(1);
    expect(ctx.newState.spec?.workflowInstanceId).toBe("wfi_created");
    const workflow = await store.getResource(
      ApiResourceKind.workflow,
      workflowId,
      WorkflowSchema,
    );
    expect(workflow.status?.defaultInstanceId).toBe("wfi_created");
  });

  it("a failing in-process create surfaces the inner code (goWrappedStatusError)", async () => {
    const workflowId = await seedWorkflow({ slug: "collide" });
    const deps = {
      store,
      logger: silentLogger,
      workflowInstanceCreator: () => ({
        createAsSystem: () =>
          Promise.reject(
            new ConnectError("slug already exists", Code.AlreadyExists),
          ),
      }),
    };
    const ctx = executionCtx({ spec: { workflowId } });
    try {
      await newCreateDefaultInstanceIfNeededStep(deps).execute(ctx);
      expect.unreachable("expected AlreadyExists");
    } catch (error) {
      // The %w-wrapped inner code survives to the wire (oss#852 pattern).
      expect((error as ConnectError).code).toBe(Code.AlreadyExists);
      expect((error as ConnectError).rawMessage).toContain(
        "failed to create default workflow instance",
      );
    }
  });
});

describe("NormalizeWorkflowRef (normalize_workflow_ref_step_test.go)", () => {
  it("resolves workflow_id from the instance", async () => {
    const workflowId = await seedWorkflow();
    const instanceId = await seedInstance(workflowId, `ref-${counter}`);
    const ctx = executionCtx({ spec: { workflowInstanceId: instanceId } });
    await newNormalizeWorkflowRefStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.spec?.workflowId).toBe(workflowId);
  });

  it("no-ops when workflow_id is already set", async () => {
    const ctx = executionCtx({
      spec: { workflowId: "wf_set", workflowInstanceId: "wfi_ignored" },
    });
    await newNormalizeWorkflowRefStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.spec?.workflowId).toBe("wf_set");
  });

  it("gracefully skips a missing instance id and a failed instance load", async () => {
    const noInstance = executionCtx({ spec: {} });
    await newNormalizeWorkflowRefStep(store, silentLogger).execute(noInstance);
    expect(noInstance.newState.spec?.workflowId).toBe("");

    const badInstance = executionCtx({
      spec: { workflowInstanceId: "wfi_missing" },
    });
    await newNormalizeWorkflowRefStep(store, silentLogger).execute(badInstance);
    expect(badInstance.newState.spec?.workflowId).toBe("");
  });
});

describe("PinWorkflowVersion (pin_workflow_version_step_test.go)", () => {
  it("pins from a direct workflow_id", async () => {
    const workflowId = await seedWorkflow({ versionHash: "h".repeat(64) });
    const ctx = executionCtx({ spec: { workflowId } });
    await newPinWorkflowVersionStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.status?.workflowVersionHash).toBe("h".repeat(64));
  });

  it("resolves through the instance when only instance is set", async () => {
    const workflowId = await seedWorkflow({ versionHash: "i".repeat(64) });
    const instanceId = await seedInstance(workflowId, `pin-${counter}`);
    const ctx = executionCtx({ spec: { workflowInstanceId: instanceId } });
    await newPinWorkflowVersionStep(store, silentLogger).execute(ctx);
    expect(ctx.newState.status?.workflowVersionHash).toBe("i".repeat(64));
  });

  it("skips when nothing is resolvable, on load failure, and on empty hash", async () => {
    const noId = executionCtx({ spec: {} });
    await newPinWorkflowVersionStep(store, silentLogger).execute(noId);
    expect(noId.newState.status?.workflowVersionHash ?? "").toBe("");

    const missing = executionCtx({ spec: { workflowId: "wf_missing" } });
    await newPinWorkflowVersionStep(store, silentLogger).execute(missing);
    expect(missing.newState.status?.workflowVersionHash ?? "").toBe("");

    const noHash = executionCtx({
      spec: { workflowId: await seedWorkflow({ versionHash: "" }) },
    });
    await newPinWorkflowVersionStep(store, silentLogger).execute(noHash);
    expect(noHash.newState.status?.workflowVersionHash ?? "").toBe("");
  });
});

describe("StartWorkflow failure posture (create.go startWorkflowStep)", () => {
  it("marks the execution FAILED with the error text, persists, and answers Internal", async () => {
    counter += 1;
    const executionId = `wfx_start_${counter}`;
    // The step runs post-persist: seed the record first, like the
    // pipeline's Persist step just did.
    const execution: WorkflowExecution = create(WorkflowExecutionSchema, {
      metadata: { id: executionId, name: executionId, org: "acme" },
      spec: { workflowId: "wf_x", workflowInstanceId: "wfi_x" },
      status: { phase: ExecutionPhase.EXECUTION_PENDING },
    });
    await store.saveResource(
      ApiResourceKind.workflow_execution,
      executionId,
      WorkflowExecutionSchema,
      execution,
    );

    const engine = stubConnectedEngine();
    engine.failures.startInvokeWorkflow = new Error("queue unreachable");
    const ctx = new RequestContext(
      WorkflowExecutionSchema,
      execution,
      ApiResourceKind.workflow_execution,
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
      ApiResourceKind.workflow_execution,
      executionId,
      WorkflowExecutionSchema,
    );
    expect(stored.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(stored.status?.error).toBe(
      "Failed to start Temporal workflow: queue unreachable",
    );
  });

  it("passes the slim input with recovery_mode false on success", async () => {
    const engine = stubConnectedEngine();
    const ctx = executionCtx({
      metadata: { id: "wfx_ok", name: "wfx_ok", org: "acme" },
      spec: { workflowId: "wf_x", workflowInstanceId: "wfi_x" },
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
      workflowInstanceId: "wfi_x",
      orgId: "acme",
      recoveryMode: false,
    });
  });
});
