/**
 * The plugin list index (store/list-index.ts): list reads one organization's
 * plugins newest first, so the declaration needs no key beyond the
 * organization and the creation order every declaration carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../store/list-index.js";

export const pluginListIndex = declareListIndex({
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  revision: 1,
  keys: {},
});
