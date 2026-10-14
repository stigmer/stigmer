/**
 * The platform client list index (store/list-index.ts): the open-source
 * adapter's `pageByOrg` (resource-store.ts) reads one organization's
 * clients newest first, so the declaration needs no key beyond the
 * organization and the creation order every declaration carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { declareListIndex } from "../../store/list-index.js";

export const platformClientListIndex = declareListIndex({
  kind: ApiResourceKind.platform_client,
  schema: PlatformClientSchema,
  revision: 1,
  keys: {},
});
