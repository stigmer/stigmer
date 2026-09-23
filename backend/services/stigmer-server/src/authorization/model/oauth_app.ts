/**
 * Transcript of fga/model/iam/oauth_app.fga — an organization-scoped kind
 * whose `owner` has NO admin arm while its `viewer` does (platform_client
 * shares the shape, for the same reason): the file's
 * "administrative visibility" for the organization's admins over a
 * registration that holds vendor client credentials, with change and
 * deletion the creator's (or an explicit grant's) alone, and no public
 * level at all.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const oauthAppDeclaration = declareKind({
  kind: ApiResourceKind.oauth_app,
  schema: OAuthAppSchema,
  source: "fga/model/iam/oauth_app.fga",
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
