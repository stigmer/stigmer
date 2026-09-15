/**
 * Transcript of fga/model/iam/identity_account.fga — a person's own
 * record: every verb is `owner`, and the owner is the account itself
 * (`kind_meta` attribution SELF, so the derivation writes
 * `identity_account:<id>#owner@identity_account:<id>`). No organization
 * link and no admin arm: an admin manages members through IamPolicy rows
 * on the organization, never through the account row.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { computed, declareKind, direct, objectOf } from "./rewrite.js";

export const identityAccountDeclaration = declareKind({
  kind: ApiResourceKind.identity_account,
  schema: IdentityAccountSchema,
  source: "fga/model/iam/identity_account.fga",
  relations: [
    ["owner", direct(objectOf("identity_account"))],
    ["can_view", computed("owner")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("owner")],
  ],
});
