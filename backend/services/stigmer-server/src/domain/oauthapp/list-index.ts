/**
 * The OAuth app list index (store/list-index.ts): `list` reads one
 * organization's apps newest first, so the declaration needs no key
 * beyond the organization and the creation order every declaration
 * carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import { declareListIndex } from "../../store/list-index.js";

export const oauthAppListIndex = declareListIndex({
  kind: ApiResourceKind.oauth_app,
  schema: OAuthAppSchema,
  revision: 1,
  keys: {},
});
