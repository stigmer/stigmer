/**
 * Transcript of fga/model/agentic/workflow.fga — the agent's shape
 * without `can_create_instance` (a workflow instance is created through
 * the workflow-instance lane, gated by the organization). Kept as its own
 * transcript, not a shared "blueprint" helper, so the file-by-file drift
 * compare sees exactly this file's lines.
 */
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
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

export const workflowDeclaration = declareKind({
  kind: ApiResourceKind.workflow,
  schema: WorkflowSchema,
  source: "fga/model/agentic/workflow.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    [
      "owner",
      union(
        direct(objectOf("identity_account")),
        from("admin", "organization"),
      ),
    ],
    [
      "platform_viewer",
      direct(usersetOf("identity_provider", "platform_user")),
    ],
    [
      "viewer",
      union(
        direct(
          objectOf("identity_account"),
          usersetOf("organization", "member"),
          usersetOf("organization", "viewer"),
        ),
        computed("owner"),
        computed("platform_viewer"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_execute", computed("viewer")],
    ["can_clone", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
