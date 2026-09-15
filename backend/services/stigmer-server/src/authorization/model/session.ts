/**
 * Transcript of fga/model/agentic/session.fga — a personal resource: the
 * owner and explicit grantees, and NO admin arm anywhere ("private
 * conversations that admins have no business accessing", the file's own
 * words). Three parent links beside the organization: `agent_instance`,
 * `channel` and `schedule`. None is a `kind_meta` fact — the cloud's
 * channel and schedule lanes write them — so on this edition the
 * derivation produces no such tuple and `viewer from channel` / `viewer
 * from schedule` resolve to nobody; the lines stand in the transcript
 * because they are the model's, and a scheduled run reaches its creator
 * through the fire caller's stamp on the session instead.
 */
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const sessionDeclaration = declareKind({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  source: "fga/model/agentic/session.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["agent_instance", direct(objectOf("agent_instance"))],
    ["channel", direct(objectOf("agent_channel"))],
    ["schedule", direct(objectOf("schedule"))],
    ["owner", direct(objectOf("identity_account"))],
    ["viewer", union(direct(objectOf("identity_account")), computed("owner"))],
    [
      "can_view",
      union(
        computed("viewer"),
        from("viewer", "channel"),
        from("viewer", "schedule"),
      ),
    ],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_create_execution_in", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
