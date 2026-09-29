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
 * triggerer's. Pure over the row; no related row is read. Which level
 * names which audience is `executionAudienceShapes`
 * (pipeline/steps/authorization-tuples.ts), the one mapping this
 * derivation and the lifecycle event a tuple-storing edition hears both
 * read, so the two editions cannot disagree about who sees the runs.
 */
import { isMessage } from "@bufbuild/protobuf";

import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";

import { executionAudienceShapes } from "../../pipeline/steps/authorization-tuples.js";

import type { Tuple } from "../tuples.js";

import type { DerivedRelation } from "./rewrite.js";

export const executionViewer: DerivedRelation = (object, row) => {
  if (!isMessage(row, WorkflowInstanceSchema)) {
    return Promise.resolve([]);
  }
  const level =
    row.spec?.executionVisibility ?? WorkflowExecutionVisibility.unspecified;
  const org = row.metadata?.org ?? "";
  if (org === "") {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    [...executionAudienceShapes(level)].map((shape): Tuple => {
      switch (shape) {
        case "org-viewer":
          return {
            object,
            relation: "execution_viewer",
            subject: {
              form: "userset",
              object: { type: "organization", id: org },
              relation: "viewer",
            },
          };
        default: {
          const exhaustive: never = shape;
          throw new Error(`unknown execution audience: ${String(exhaustive)}`);
        }
      }
    }),
  );
};
