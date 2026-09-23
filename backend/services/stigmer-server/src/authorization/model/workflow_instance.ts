/**
 * Transcript of fga/model/agentic/workflow_instance.fga — the agent
 * instance's shape plus one relation of its own: `execution_viewer`, the
 * opt-in audience for the instance's RUN history, kept apart from
 * `viewer` so making an instance org-runnable never exposes other
 * people's run inputs and outputs. Consumed by workflow_execution through
 * `execution_viewer from workflow_instance`.
 *
 * `execution_viewer` is derived here from `spec.execution_visibility`
 * (the second rule `kind_meta` cannot express): `organization` derives
 * `#execution_viewer@organization:<org>#viewer` — the organization's full
 * read audience, the shape the file's comment names and the cloud's own
 * store test writes, with `#member` the legacy shape the line still
 * admits — and `private` or unset derives nothing, so each run stays its
 * triggerer's. The cloud has no writer for this tuple today; this
 * edition enforces the field as the contract states it.
 */
import { isMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { defaultOfBlueprint } from "./default-of.js";
import type { DerivedRelation } from "./rewrite.js";
import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
  usersetOf,
} from "./rewrite.js";

const executionViewer: DerivedRelation = (object, row) => {
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

export const workflowInstanceDeclaration = declareKind({
  kind: ApiResourceKind.workflow_instance,
  schema: WorkflowInstanceSchema,
  source: "fga/model/agentic/workflow_instance.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["workflow", direct(objectOf("workflow"))],
    ["default_of", direct(objectOf("workflow"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(
          objectOf("identity_account"),
          usersetOf("organization", "member"),
          usersetOf("organization", "viewer"),
        ),
        computed("owner"),
        from("viewer", "default_of"),
      ),
    ],
    [
      "execution_viewer",
      direct(
        objectOf("identity_account"),
        usersetOf("organization", "member"),
        usersetOf("organization", "viewer"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_execute", computed("can_view")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
  derived: [
    [
      "default_of",
      defaultOfBlueprint({
        kind: ApiResourceKind.workflow,
        schema: WorkflowSchema,
        defaultInstanceIdOf: (workflow) =>
          workflow.status?.defaultInstanceId ?? "",
      }),
    ],
    ["execution_viewer", executionViewer],
  ],
});
