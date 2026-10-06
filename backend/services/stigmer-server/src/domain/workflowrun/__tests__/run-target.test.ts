/**
 * Pins the workflow-execution run-target resolver: a run's workflow_id
 * names its one target, asked as workflow#can_execute with its byte-pinned
 * deny copy. A run naming no workflow has no target (ValidateProto refuses
 * that shape as INVALID_ARGUMENT before this step runs).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { runWorkflowDeniedMessage } from "../constants.js";
import { workflowExecutionRunTarget } from "../run-target.js";

describe("workflowExecutionRunTarget", () => {
  it("workflow_id → workflow#can_execute", () => {
    expect(
      workflowExecutionRunTarget(
        create(WorkflowRunSchema, { spec: { workflowId: "wf_01abc" } }),
      ),
    ).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.workflow,
      resourceId: "wf_01abc",
      deniedMessage: runWorkflowDeniedMessage("wf_01abc"),
    });
    expect(runWorkflowDeniedMessage("wf_01abc")).toBe(
      "unauthorized to run workflow 'wf_01abc'",
    );
  });

  it("answers no target when the run names no workflow", () => {
    expect(
      workflowExecutionRunTarget(create(WorkflowRunSchema, {})),
    ).toBeUndefined();
    expect(
      workflowExecutionRunTarget(
        create(WorkflowRunSchema, { spec: { workflowId: "" } }),
      ),
    ).toBeUndefined();
  });
});
