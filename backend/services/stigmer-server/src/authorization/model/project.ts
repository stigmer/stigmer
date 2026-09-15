/**
 * Transcript of fga/model/tenancy/project.fga — an organization's
 * grouping: admins own it, and `viewer from organization` lets every
 * organization viewer read it without a visibility tuple (projects have
 * no visibility axis in `kind_meta`; the whole organization is their
 * audience by the model's own line).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const projectDeclaration = declareKind({
  kind: ApiResourceKind.project,
  schema: ProjectSchema,
  source: "fga/model/tenancy/project.fga",
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
      "viewer",
      union(
        direct(objectOf("identity_account")),
        computed("owner"),
        from("viewer", "organization"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
