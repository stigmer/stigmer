/**
 * Transcript of fga/model/agentic/execution_context.fga — a run's working
 * state, owner-only and unscoped (`kind_meta` OWNER_ONLY): two verbs,
 * both `owner`, and no access list to grant on.
 */
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { computed, declareKind, direct, objectOf } from "./rewrite.js";

export const executionContextDeclaration = declareKind({
  kind: ApiResourceKind.execution_context,
  schema: ExecutionContextSchema,
  source: "fga/model/agentic/execution_context.fga",
  relations: [
    ["owner", direct(objectOf("identity_account"))],
    ["can_view", computed("owner")],
    ["can_edit", computed("owner")],
  ],
});
