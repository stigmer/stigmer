/**
 * Transcript of fga/model/agentic/agent_share.fga — a share link's
 * configuration row, admin-owned; its anonymous visitors are the cloud's
 * `guest` credential on the organization, a class no open-source lane
 * mints, so on this edition a share is visible to its owners and explicit
 * grantees only.
 */
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const agentShareDeclaration = declareKind({
  kind: ApiResourceKind.agent_share,
  schema: AgentShareSchema,
  source: "fga/model/agentic/agent_share.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    [
      "owner",
      union(
        direct(objectOf("identity_account")),
        from("admin", "organization"),
      ),
    ],
    ["viewer", union(direct(objectOf("identity_account")), computed("owner"))],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
