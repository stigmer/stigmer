/**
 * The plugin eval list index (store/list-index.ts): `plugin` is the key
 * listByPlugin, the plugin-delete cascade read. The organization and the
 * creation order are every declaration's: listByPlugin answers newest
 * first, and the organization purge reads by organization.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const pluginEvalListIndex = declareListIndex({
  kind: ApiResourceKind.plugin_eval,
  schema: PluginEvalSchema,
  revision: 1,
  keys: {
    plugin: field("spec.plugin_id"),
  },
});
