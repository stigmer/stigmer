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
 *   - update keeps the stored level whatever the request carried.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  ExecutionVisibilityChangedEvent,
  ResourceAuthorizationLifecycle,
} from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
  newCreateExecutionVisibilityTuplesStep,
  newPreserveExecutionVisibilityStep,
  newUpdateExecutionVisibilityTuplesStep,
} from "../execution-visibility.js";
import { workflowVersionHash } from "../steps.js";

const ORG = "org_acme";

function workflow(
  level: WorkflowExecutionVisibility,
  env: Record<string, { isSecret: boolean }> = {
    SLACK_WEBHOOK: { isSecret: true },
  },
): Workflow {
  return create(WorkflowSchema, {
    metadata: { id: "wfl_nightly", org: ORG, slug: "nightly" },
    spec: {
      description: "nightly triage",
      env,
      executionVisibility: level,
      tasks: [{ name: "seed", kind: 1, taskConfig: { variables: { a: "1" } } }],
    },
  });
}

/** A driver that records each run-audience event, and throws when told to. */
function recordingLifecycle(fail = false): {
  lifecycle: ResourceAuthorizationLifecycle;
  events: ExecutionVisibilityChangedEvent[];
} {
  const events: ExecutionVisibilityChangedEvent[] = [];
  const lifecycle: ResourceAuthorizationLifecycle = {
    onResourceCreated: () => Promise.resolve(),
    onResourceDeleted: () => Promise.resolve(),
    onVisibilityChanged: () => Promise.resolve(),
    onExecutionVisibilityChanged: (event) => {
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
    const privateRuns = workflow(WorkflowExecutionVisibility.private).spec!;
    const orgRuns = workflow(WorkflowExecutionVisibility.organization).spec!;
    expect(workflowVersionHash(orgRuns)).toBe(workflowVersionHash(privateRuns));

    const edited = workflow(WorkflowExecutionVisibility.private, {
      SLACK_WEBHOOK: { isSecret: true },
      API_TOKEN: { isSecret: true },
    }).spec!;
    expect(workflowVersionHash(edited)).not.toBe(
      workflowVersionHash(privateRuns),
    );
  });

  it("never mutates the spec it hashes", () => {
    const spec = workflow(WorkflowExecutionVisibility.organization).spec!;
    workflowVersionHash(spec);
    expect(spec.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
  });
});

describe("CreateExecutionVisibilityTuples", () => {
  it("tells the driver an ORGANIZATION audience as the workflow's event", async () => {
    const { lifecycle, events } = recordingLifecycle();
    await newCreateExecutionVisibilityTuplesStep(lifecycle).execute(
      workflowCtx(workflow(WorkflowExecutionVisibility.organization)),
    );
    expect(events).toEqual([
      { workflowId: "wfl_nightly", orgId: ORG, shapes: ["org-viewer"] },
    ]);
  });

  it("fires nothing for a private or unset level", async () => {
    const { lifecycle, events } = recordingLifecycle();
    for (const level of [
      WorkflowExecutionVisibility.private,
      WorkflowExecutionVisibility.unspecified,
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
        workflowCtx(workflow(WorkflowExecutionVisibility.organization)),
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
      WorkflowExecutionVisibility.organization,
      WorkflowExecutionVisibility.private,
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

describe("PreserveExecutionVisibility", () => {
  it("keeps the stored level over whatever the request carried", () => {
    const ctx = workflowCtx(workflow(WorkflowExecutionVisibility.private));
    ctx.set(
      EXISTING_RESOURCE_KEY,
      workflow(WorkflowExecutionVisibility.organization),
    );
    newPreserveExecutionVisibilityStep().execute(ctx);
    expect(ctx.newState.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
  });
});
