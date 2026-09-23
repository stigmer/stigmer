/**
 * Transcript of fga/model/agentic/mcp_server.fga — a blueprint with three
 * read-side verbs: `can_use`, `can_clone` and `can_connect` (the OAuth
 * connect lane's gate), all `viewer`. `team#member` on `viewer` is the
 * Enterprise team grant, which no open-source tuple ever names.
 */
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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

export const mcpServerDeclaration = declareKind({
  kind: ApiResourceKind.mcp_server,
  schema: McpServerSchema,
  source: "fga/model/agentic/mcp_server.fga",
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
          usersetOf("team", "member"),
        ),
        computed("owner"),
        computed("platform_viewer"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_use", computed("viewer")],
    ["can_clone", computed("viewer")],
    ["can_connect", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
