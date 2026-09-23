/**
 * Transcript of fga/model/agentic/agent.fga — a blueprint: owned by its
 * creator and by the organization's admins (`admin from organization`),
 * read by whoever the visibility axis lets in. The `organization#member`
 * and `organization#viewer` usersets on `viewer` are the org-visibility
 * tuple's two shapes (the cloud writes `#viewer` since cloud#257; `#member`
 * is the legacy shape it still honours), and `platform_viewer` is an
 * identity-provider userset no open-source tuple ever names. `team#member`
 * is the Enterprise team grant; open source serves no team, so no tuple
 * here ever names one.
 */
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
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

export const agentDeclaration = declareKind({
  kind: ApiResourceKind.agent,
  schema: AgentSchema,
  source: "fga/model/agentic/agent.fga",
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
    ["can_execute", computed("viewer")],
    ["can_create_instance", computed("can_execute")],
    ["can_clone", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
