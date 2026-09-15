/**
 * Transcript of fga/model/agentic/agent_execution.fga — a run is its
 * session's: no owner tuple of its own (`kind_meta` attribution
 * INHERITED), every relation a hop through `session`, which the
 * derivation writes from `spec.session_id`. `can_view: viewer or
 * can_view from session` walks a parent PERMISSION whose own arms include
 * the session's channel and schedule hops; the evaluator resolves those
 * on the session's declaration, so this file needs no knowledge of them.
 */
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const agentExecutionDeclaration = declareKind({
  kind: ApiResourceKind.agent_execution,
  schema: AgentExecutionSchema,
  source: "fga/model/agentic/agent_execution.fga",
  relations: [
    ["session", direct(objectOf("session"))],
    ["owner", from("owner", "session")],
    ["viewer", union(from("viewer", "session"), computed("owner"))],
    ["can_view", union(computed("viewer"), from("can_view", "session"))],
    ["can_edit", computed("owner")],
  ],
});
