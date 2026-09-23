/**
 * Transcript of fga/model/iam/platform_client.fga — relation for relation
 * the oauth_app shape: organization-scoped, an `owner` with no admin arm
 * and a `viewer` that has one. A platform client holds credential material,
 * so the model is restricted: its creator (the owner) edits, deletes,
 * rotates and grants; the organization's admins may view it; ordinary
 * members have no access at all, which is why listByOrg narrows through
 * the list read scope. There is no public level.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { computed, declareKind, direct, from, objectOf, union } from "./rewrite.js";

export const platformClientDeclaration = declareKind({
  kind: ApiResourceKind.platform_client,
  schema: PlatformClientSchema,
  source: "fga/model/iam/platform_client.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(objectOf("identity_account")),
        computed("owner"),
        from("admin", "organization"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
