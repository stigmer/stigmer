/**
 * The `execution_viewer` derived rule of a workflow. The model
 * (fga/model/agentic/workflow.fga) keeps the workflow's RUN audience apart
 * from `viewer`, so making a workflow org-runnable never exposes other
 * people's run inputs and outputs; workflow_execution reads it through
 * `execution_viewer from workflow`.
 *
 * It is derived from `spec.execution_visibility`, which `kind_meta`
 * cannot express: `organization` derives
 * `#execution_viewer@organization:<org>#viewer`, the organization's full
 * read audience, and `private` or unset derives nothing, so each run stays
 * the person's who started it. Pure over the row; no related row is read.
 * Which level names which audience is `executionAudienceShapes`
 * (pipeline/steps/authorization-tuples.ts), the one mapping this
 * derivation and the lifecycle event a tuple-storing edition hears both
 * read, so the two editions cannot disagree about who sees the runs.
 */
import { isMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

import { runAudienceShapes } from "../../pipeline/steps/authorization-tuples.js";

import type { Tuple } from "../tuples.js";

import type { DerivedRelation } from "./rewrite.js";

export const runViewer: DerivedRelation = (object, row) => {
  if (!isMessage(row, WorkflowSchema)) {
    return Promise.resolve([]);
  }
  const level =
    row.spec?.runVisibility ?? WorkflowRunVisibility.unspecified;
  const org = row.metadata?.org ?? "";
  if (org === "") {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    [...runAudienceShapes(level)].map((shape): Tuple => {
      switch (shape) {
        case "org-viewer":
          return {
            object,
            relation: "run_viewer",
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
