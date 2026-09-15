/**
 * Transcript of fga/model/agentic/channel_app.fga — a messaging-platform
 * app registration, admin-owned, viewable by its owners and explicit
 * grantees: the same shape as agent_share, kept as its own file so the
 * drift compare reads this file's lines.
 */
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const channelAppDeclaration = declareKind({
  kind: ApiResourceKind.channel_app,
  schema: ChannelAppSchema,
  source: "fga/model/agentic/channel_app.fga",
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
