/**
 * Pins the workflow-execution run-target resolver (P1 sp.run-gate): the
 * chain's own precedence — an explicit workflow_instance_id fully names
 * the target (CreateDefaultInstanceIfNeeded returns early on it), else
 * workflow_id names the blueprint whose default instance the chain will
 * resolve — each with its own byte-pinned deny copy. Neither set has no
 * target (ValidateWorkflowOrInstance refuses that shape as INVALID_ARGUMENT
 * before this step runs).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  runWorkflowDeniedMessage,
  runWorkflowInstanceDeniedMessage,
} from "../constants.js";
import { workflowExecutionRunTarget } from "../run-target.js";

describe("workflowExecutionRunTarget", () => {
  it("workflow_instance_id → workflow_instance#can_execute", () => {
    expect(
      workflowExecutionRunTarget(
        create(WorkflowExecutionSchema, {
          spec: { workflowInstanceId: "wfi_01abc" },
        }),
      ),
    ).toEqual({
      permission: IamPermission.can_execute,
      resourceKind: ApiResourceKind.workflow_instance,
      resourceId: "wfi_01abc",
      deniedMessage: runWorkflowInstanceDeniedMessage("wfi_01abc"),
    });
    expect(runWorkflowInstanceDeniedMessage("wfi_01abc")).toBe(
      "unauthorized to run workflow instance 'wfi_01abc'",
    );
  });

  it("workflow_id → workflow#can_execute", () => {
    expect(
      workflowExecutionRunTarget(
        create(WorkflowExecutionSchema, { spec: { workflowId: "wf_01abc" } }),
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

  it("precedence is the chain's: the explicit instance wins over the blueprint", () => {
    const target = workflowExecutionRunTarget(
      create(WorkflowExecutionSchema, {
        spec: { workflowId: "wf_01abc", workflowInstanceId: "wfi_01abc" },
      }),
    );
    expect(target?.resourceKind).toBe(ApiResourceKind.workflow_instance);
    expect(target?.resourceId).toBe("wfi_01abc");
  });

  it("answers no target when neither reference is set", () => {
    expect(
      workflowExecutionRunTarget(create(WorkflowExecutionSchema, {})),
    ).toBeUndefined();
    expect(
      workflowExecutionRunTarget(
        create(WorkflowExecutionSchema, {
          spec: { workflowId: "", workflowInstanceId: "" },
        }),
      ),
    ).toBeUndefined();
  });
});
