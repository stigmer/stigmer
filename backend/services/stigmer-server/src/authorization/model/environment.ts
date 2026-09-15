/**
 * Transcript of fga/model/agentic/environment.fga — a member's credential
 * store: owner-only writes (no admin arm), an org-visibility axis capped
 * at the organization (`kind_meta` supports_org only — no public
 * wildcard on the viewer line, and the evaluator would ignore one), and
 * `can_read_secrets: creator`, the one verb that stays with the person
 * who typed the values whatever the visibility, standing on the creator
 * tuple `kind_meta` flags with requires_creator_tuple.
 */
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  objectOf,
  union,
  usersetOf,
} from "./rewrite.js";

export const environmentDeclaration = declareKind({
  kind: ApiResourceKind.environment,
  schema: EnvironmentSchema,
  source: "fga/model/agentic/environment.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["creator", direct(objectOf("identity_account"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(
          objectOf("identity_account"),
          usersetOf("organization", "member"),
          usersetOf("organization", "viewer"),
        ),
        computed("owner"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_read_secrets", computed("creator")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
