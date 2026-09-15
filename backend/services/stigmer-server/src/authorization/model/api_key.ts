/**
 * Transcript of fga/model/iam/api_key.fga — a credential, owner-only in
 * every verb: no organization link (`kind_meta` scope OWNER_ONLY) and no
 * admin arm, so the key a person minted is theirs to view, rotate, revoke
 * and use, and nobody else's. `can_rotate`, `can_revoke` and `can_use` are
 * the file's own verbs; the wire vocabulary names only the first three.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import { computed, declareKind, direct, objectOf } from "./rewrite.js";

export const apiKeyDeclaration = declareKind({
  kind: ApiResourceKind.api_key,
  schema: ApiKeySchema,
  source: "fga/model/iam/api_key.fga",
  relations: [
    ["owner", direct(objectOf("identity_account"))],
    ["can_view", computed("owner")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_rotate", computed("owner")],
    ["can_revoke", computed("owner")],
    ["can_use", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("owner")],
  ],
});
