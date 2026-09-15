/**
 * Transcript of fga/model/iam/iam_policy.fga — the access-list row as an
 * object of the model: its organization's admins own and view it. Declared
 * for completeness of the transcript set (the drift compare reads every
 * open-source file); no wire check targets it — the IamPolicy RPCs
 * authorize against the policy's RESOURCE (`can_grant_access` on the
 * organization; `get` loads the row and asks about what it names), and the
 * tuple lifecycle writes nothing for it.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const iamPolicyDeclaration = declareKind({
  kind: ApiResourceKind.iam_policy,
  schema: IamPolicySchema,
  source: "fga/model/iam/iam_policy.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    [
      "owner",
      union(
        direct(objectOf("identity_account")),
        from("admin", "organization"),
      ),
    ],
    ["viewer", from("admin", "organization")],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
