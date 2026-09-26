/**
 * The `execution_viewer` derived rule of a workflow instance. The model
 * (fga/model/agentic/workflow_instance.fga) keeps the instance's RUN
 * history audience apart from `viewer`, so making an instance
 * org-runnable never exposes other people's run inputs and outputs;
 * workflow_execution reads it through `execution_viewer from
 * workflow_instance`.
 *
 * It is derived from `spec.execution_visibility`, which `kind_meta`
 * cannot express: `organization` derives
 * `#execution_viewer@organization:<org>#viewer`, the organization's full
 * read audience (the relation also admits `#member`, the legacy shape),
 * and `private` or unset derives nothing, so each run stays its
 * triggerer's. Pure over the row; no related row is read.
 */
import { isMessage } from "@bufbuild/protobuf";

import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";

import type { DerivedRelation } from "./rewrite.js";

export const executionViewer: DerivedRelation = (object, row) => {
  if (!isMessage(row, WorkflowInstanceSchema)) {
    return Promise.resolve([]);
  }
  const level =
    row.spec?.executionVisibility ?? WorkflowExecutionVisibility.unspecified;
  switch (level) {
    case WorkflowExecutionVisibility.organization: {
      const org = row.metadata?.org ?? "";
      return Promise.resolve(
        org === ""
          ? []
          : [
              {
                object,
                relation: "execution_viewer",
                subject: {
                  form: "userset",
                  object: { type: "organization", id: org },
                  relation: "viewer",
                },
              },
            ],
      );
    }
    case WorkflowExecutionVisibility.private:
    case WorkflowExecutionVisibility.unspecified:
      return Promise.resolve([]);
    default: {
      const exhaustive: never = level;
      throw new Error(`unknown execution visibility: ${String(exhaustive)}`);
    }
  }
};
