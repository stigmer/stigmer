/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveWorkflowInstanceCreateTargets): a personal instance asks
 * can_execute on the parent workflow with the Java handler's copy; a
 * default instance the server composed in-process for the parent's
 * organization asks nothing; the same label from the wire or for another
 * organization takes the bar; a missing parent throws.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
} from "../../../pipeline/apiresource-labels.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  PARENT_WORKFLOW_KEY,
  WORKFLOW_INSTANCE_PARENT_DENIED_MESSAGE,
  resolveWorkflowInstanceCreateTargets,
} from "../steps.js";

const parent = create(WorkflowSchema, {
  metadata: { id: "wf_01parent", name: "nightly", org: "acme" },
});

function ctxFor(
  org: string,
  caller: CallerIdentity,
  labels: Record<string, string> = {},
  stashParent = true,
) {
  const ctx = new RequestContext(
    WorkflowInstanceSchema,
    create(WorkflowInstanceSchema, {
      metadata: { name: "mine", org, labels },
      spec: { workflowId: parent.metadata!.id },
    }),
    caller,
    ApiResourceKind.workflow_instance,
  );
  if (stashParent) {
    ctx.set(PARENT_WORKFLOW_KEY, parent);
  }
  return ctx;
}

const DEFAULT_LABELS = { [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE };

describe("resolveWorkflowInstanceCreateTargets", () => {
  it("a personal instance asks can_execute on the parent workflow", () => {
    expect(
      resolveWorkflowInstanceCreateTargets(
        ctxFor("acme", testCallerIdentity()),
      ),
    ).toEqual([
      {
        permission: IamPermission.can_execute,
        resourceKind: ApiResourceKind.workflow,
        resourceId: "wf_01parent",
        deniedMessage: WORKFLOW_INSTANCE_PARENT_DENIED_MESSAGE,
      },
    ]);
  });

  it("a default instance the server composed in-process for the parent's organization asks nothing", () => {
    expect(
      resolveWorkflowInstanceCreateTargets(
        ctxFor(
          "acme",
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toEqual([]);
  });

  it("the label from the wire, or for another organization, takes the bar", () => {
    expect(
      resolveWorkflowInstanceCreateTargets(
        ctxFor("acme", testCallerIdentity(), DEFAULT_LABELS),
      ),
    ).toHaveLength(1);
    expect(
      resolveWorkflowInstanceCreateTargets(
        ctxFor(
          "other-org",
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toHaveLength(1);
  });

  it("a missing parent is a broken chain invariant and throws", () => {
    expect(() =>
      resolveWorkflowInstanceCreateTargets(
        ctxFor("acme", testCallerIdentity(), {}, false),
      ),
    ).toThrow("parent workflow not found in context");
  });
});
