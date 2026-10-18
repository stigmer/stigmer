/**
 * The Environment list index (store/list-index.ts): `list` reads one
 * organization's Environments newest first, so the declaration needs no key
 * beyond the organization and the creation order every declaration
 * carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../store/list-index.js";

export const environmentListIndex = declareListIndex({
  kind: ApiResourceKind.environment,
  schema: EnvironmentSchema,
  revision: 1,
  keys: {},
});
