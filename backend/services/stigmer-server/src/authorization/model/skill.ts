/**
 * Transcript of fga/model/agentic/skill.fga — a blueprint whose verbs are
 * `can_use` and `can_clone` rather than `can_execute`. Only `can_view`,
 * `can_edit`, `can_delete`, `can_grant_access` and `can_view_access` are
 * in the wire's IamPermission vocabulary; the others are the model's and
 * are carried so the transcript is the file.
 */
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
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

export const skillDeclaration = declareKind({
  kind: ApiResourceKind.skill,
  schema: SkillSchema,
  source: "fga/model/agentic/skill.fga",
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
    ["can_clone", computed("viewer")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
