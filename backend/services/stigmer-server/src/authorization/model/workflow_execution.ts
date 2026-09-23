/**
 * Transcript of fga/model/agentic/workflow_execution.fga — a run with an
 * owner of its own (the person who triggered it; `kind_meta` attribution
 * DIRECT, unlike agent_execution's inherited owner) and two ways in for
 * others: an explicit per-run grant, or the instance's opt-in run
 * audience through `execution_viewer from workflow_instance`, standing on
 * the `workflow_instance` link the derivation writes from
 * `spec.workflow_instance_id`. No `can_delete`: run history outlives its
 * instance by design. The per-run grant may name an Enterprise team
 * (`team#member`), which no open-source tuple ever does.
 */
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
  usersetOf,
} from "./rewrite.js";

export const workflowExecutionDeclaration = declareKind({
  kind: ApiResourceKind.workflow_execution,
  schema: WorkflowExecutionSchema,
  source: "fga/model/agentic/workflow_execution.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["workflow_instance", direct(objectOf("workflow_instance"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(objectOf("identity_account"), usersetOf("team", "member")),
        computed("owner"),
        from("execution_viewer", "workflow_instance"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
