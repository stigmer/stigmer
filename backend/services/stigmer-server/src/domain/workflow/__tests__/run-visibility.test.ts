/**
 * Pins a workflow's run audience outside the wire (execution-visibility.ts)
 * and its place outside the version (steps.ts `workflowVersionHash`):
 *   - the version hash ignores the run audience and nothing else: two
 *     specs that differ only in it hash the same, a declared-env edit moves
 *     the hash, and hashing never mutates the spec it reads;
 *   - create tells a composed tuple driver the audience only when the
 *     level names one, as `{ workflowId, orgId, shapes }`, and a driver
 *     fault fails the request with the create lane's copy;
 *   - the update door tells the driver the target audience every time, the
 *     empty one included, so a transition away from ORGANIZATION converges
 *     without knowing the old level;
 *   - update keeps the stored level whatever the request carried, and a
 *     chain that reaches it with no stored row is a wiring fault (Internal);
 *   - the targeted update's persist fault is Internal, and its reindex is
 *     best-effort: a row the extractor cannot index, or an index write that
 *     fails, never fails the change.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  RunVisibilityChangedEvent,
  ResourceAuthorizationLifecycle,
} from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import {
  UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
  newCreateExecutionVisibilityTuplesStep,
  newIndexWorkflowAfterExecutionVisibilityUpdateStep,
  newPersistWorkflowForExecutionVisibilityUpdateStep,
  newPreserveExecutionVisibilityStep,
  newUpdateExecutionVisibilityTuplesStep,
} from "../run-visibility.js";
import { workflowVersionHash } from "../steps.js";

const ORG = "org_acme";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A store whose one write of the kind named fails; reads are untouched. */
function writeFailingStore(op: "saveResource" | "upsertSearchIndex"): {
  store: Store;
  calls: string[];
} {
  const calls: string[] = [];
  const store = {
    [op]: () => {
      calls.push(op);
      return Promise.reject(new Error("SQLITE_BUSY: database is locked"));
    },
  } as unknown as Store;
  return { store, calls };
}

async function errorOfStep(run: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(run)
    .then(() => undefined)
    .catch((e: unknown) => e);
}

function workflow(
  level: WorkflowRunVisibility,
  env: Record<string, { isSecret: boolean }> = {
    SLACK_WEBHOOK: { isSecret: true },
  },
): Workflow {
  return create(WorkflowSchema, {
    metadata: { id: "wfl_nightly", org: ORG, slug: "nightly" },
    spec: {
      description: "nightly triage",
      env,
      runVisibility: level,
      tasks: [{ name: "seed", kind: 1, taskConfig: { variables: { a: "1" } } }],
    },
  });
}

/** A driver that records each run-audience event, and throws when told to. */
function recordingLifecycle(fail = false): {
  lifecycle: ResourceAuthorizationLifecycle;
  events: RunVisibilityChangedEvent[];
} {
  const events: RunVisibilityChangedEvent[] = [];
  const lifecycle: ResourceAuthorizationLifecycle = {
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: () => Promise.resolve(),
    onVisibilityChanged: () => Promise.resolve(),
    onRunVisibilityChanged: (event) => {
      events.push(event);
      return fail
        ? Promise.reject(new Error("tuple store unavailable"))
        : Promise.resolve();
    },
  };
  return { lifecycle, events };
}

function workflowCtx(row: Workflow): RequestContext<typeof WorkflowSchema> {
  return new RequestContext(
    WorkflowSchema,
    row,
    testCallerIdentity(),
    ApiResourceKind.workflow,
  );
}

describe("workflowVersionHash", () => {
  it("ignores the run audience, and only it", () => {
    const privateRuns = workflow(WorkflowRunVisibility.private).spec!;
    const orgRuns = workflow(WorkflowRunVisibility.organization).spec!;
    expect(workflowVersionHash(orgRuns)).toBe(workflowVersionHash(privateRuns));

    const edited = workflow(WorkflowRunVisibility.private, {
      SLACK_WEBHOOK: { isSecret: true },
      API_TOKEN: { isSecret: true },
    }).spec!;
    expect(workflowVersionHash(edited)).not.toBe(
      workflowVersionHash(privateRuns),
    );
  });

  it("never mutates the spec it hashes", () => {
    const spec = workflow(WorkflowRunVisibility.organization).spec!;
    workflowVersionHash(spec);
    expect(spec.runVisibility).toBe(
      WorkflowRunVisibility.organization,
    );
  });
});

describe("CreateExecutionVisibilityTuples", () => {
  it("tells the driver an ORGANIZATION audience as the workflow's event", async () => {
    const { lifecycle, events } = recordingLifecycle();
    await newCreateExecutionVisibilityTuplesStep(lifecycle).execute(
      workflowCtx(workflow(WorkflowRunVisibility.organization)),
    );
    expect(events).toEqual([
      { workflowId: "wfl_nightly", orgId: ORG, shapes: ["org-viewer"] },
    ]);
  });

  it("fires nothing for a private or unset level", async () => {
    const { lifecycle, events } = recordingLifecycle();
    for (const level of [
      WorkflowRunVisibility.private,
      WorkflowRunVisibility.unspecified,
    ]) {
      await newCreateExecutionVisibilityTuplesStep(lifecycle).execute(
        workflowCtx(workflow(level)),
      );
    }
    expect(events).toEqual([]);
  });

  it("a driver fault fails the create with its copy", async () => {
    const { lifecycle } = recordingLifecycle(true);
    const error = await Promise.resolve(
      newCreateExecutionVisibilityTuplesStep(lifecycle).execute(
        workflowCtx(workflow(WorkflowRunVisibility.organization)),
      ),
    )
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe(
      "failed to create authorization tuples",
    );
  });
});

describe("UpdateExecutionVisibilityTuples", () => {
  it("tells the driver the target audience every time, the empty one included", async () => {
    const { lifecycle, events } = recordingLifecycle();
    for (const level of [
      WorkflowRunVisibility.organization,
      WorkflowRunVisibility.private,
    ]) {
      const ctx = workflowCtx(workflow(level));
      ctx.set(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY, workflow(level));
      await newUpdateExecutionVisibilityTuplesStep<typeof WorkflowSchema>(
        lifecycle,
      ).execute(ctx);
    }
    expect(events.map((event) => event.shapes)).toEqual([["org-viewer"], []]);
  });
});

describe("UpdateExecutionVisibilityTuples with no workflow stashed", () => {
  it("fires nothing", async () => {
    const { lifecycle, events } = recordingLifecycle();
    await newUpdateExecutionVisibilityTuplesStep<typeof WorkflowSchema>(
      lifecycle,
    ).execute(workflowCtx(workflow(WorkflowRunVisibility.organization)));
    expect(events).toEqual([]);
  });
});

describe("the targeted update's persist and reindex", () => {
  function stashed(row: Workflow): RequestContext<typeof WorkflowSchema> {
    const ctx = workflowCtx(row);
    ctx.set(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY, row);
    return ctx;
  }

  it("a persist fault is a sanitized Internal", async () => {
    const { store } = writeFailingStore("saveResource");
    const error = await errorOfStep(() =>
      newPersistWorkflowForExecutionVisibilityUpdateStep<typeof WorkflowSchema>(
        store,
      ).execute(stashed(workflow(WorkflowRunVisibility.organization))),
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("failed to save workflow");
  });

  it("a failing index write never fails the change", async () => {
    const { store, calls } = writeFailingStore("upsertSearchIndex");
    await newIndexWorkflowAfterExecutionVisibilityUpdateStep<
      typeof WorkflowSchema
    >(store, silentLogger).execute(
      stashed(workflow(WorkflowRunVisibility.organization)),
    );
    expect(calls).toEqual(["upsertSearchIndex"]);
  });

  it("a row the extractor cannot index is skipped without a write", async () => {
    const { store, calls } = writeFailingStore("upsertSearchIndex");
    const row = workflow(WorkflowRunVisibility.organization);
    row.metadata = undefined;
    await newIndexWorkflowAfterExecutionVisibilityUpdateStep<
      typeof WorkflowSchema
    >(store, silentLogger).execute(stashed(row));
    expect(calls).toEqual([]);
  });
});

describe("PreserveExecutionVisibility", () => {
  it("a chain that reaches it with no stored row is a wiring fault (Internal)", async () => {
    const error = await errorOfStep(() =>
      newPreserveExecutionVisibilityStep().execute(
        workflowCtx(workflow(WorkflowRunVisibility.private)),
      ),
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("keeps the stored level over whatever the request carried", () => {
    const ctx = workflowCtx(workflow(WorkflowRunVisibility.private));
    ctx.set(
      EXISTING_RESOURCE_KEY,
      workflow(WorkflowRunVisibility.organization),
    );
    newPreserveExecutionVisibilityStep().execute(ctx);
    expect(ctx.newState.spec?.runVisibility).toBe(
      WorkflowRunVisibility.organization,
    );
  });
});
