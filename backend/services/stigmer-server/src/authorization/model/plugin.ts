/**
 * Transcript of fga/model/agentic/plugin.fga — the unit of install, shaped
 * exactly like a skill: an organization-owned blueprint whose owner is the
 * installer (and, through the organization, its admins), whose viewers are
 * the org's members and viewers and the platform viewer. Its verbs are the blueprint set: `can_view`, `can_edit`
 * (visibility), `can_delete` (uninstall), `can_grant_access`,
 * `can_view_access`; `can_use` is carried as the model's word for
 * "install from" though no wire permission names it yet.
 *
 * The members a plugin materialises are NOT reached through this type:
 * each is an ordinary skill, MCP server, agent or workflow with its own
 * tuples, written by its own chain as the installing caller.
 */
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
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

export const pluginDeclaration = declareKind({
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  source: "fga/model/agentic/plugin.fga",
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
    ["can_use", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
