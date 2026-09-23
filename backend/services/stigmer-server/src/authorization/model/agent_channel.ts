/**
 * Transcript of fga/model/agentic/agent_channel.fga — a channel binding,
 * admin-owned like a blueprint, with `participant` as the one relation
 * between owner and viewer: the conversation-participation role
 * (reply and takeover without configuration authority), grantable as a
 * role on this kind alone. Every owner participates; every participant
 * views. Both grantable relations may name an Enterprise team
 * (`team#member`), which no open-source tuple ever does.
 */
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
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

export const agentChannelDeclaration = declareKind({
  kind: ApiResourceKind.agent_channel,
  schema: AgentChannelSchema,
  source: "fga/model/agentic/agent_channel.fga",
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
      "participant",
      union(
        direct(objectOf("identity_account"), usersetOf("team", "member")),
        computed("owner"),
      ),
    ],
    [
      "viewer",
      union(
        direct(objectOf("identity_account"), usersetOf("team", "member")),
        computed("participant"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_participate", computed("participant")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
