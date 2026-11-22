/**
 * How a plugin's files are served (archive/serve-files.ts): where its version's
 * archive is and what it hides. One binding for the plugin's own listFiles and
 * readFile and for the agent's save, which reads a plugin's file index to warn
 * about what an agent without a computer cannot run
 * (domain/agent/skill-warnings.ts).
 */
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ServedArchiveBinding } from "../../archive/serve-files.js";
import { PLUGIN_ARTIFACT_KEY_PREFIX } from "./constants.js";

/** How a plugin's files are served (archive/serve-files.ts). */
export const servedPlugin: ServedArchiveBinding<typeof PluginSchema> = {
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  noun: "plugin",
  headHashOf: (plugin) => plugin.status?.digest ?? "",
  storageKeyOf: (plugin) => plugin.status?.artifactStorageKey ?? "",
  suiteDirOf: (plugin) => plugin.status?.evals?.dir,
  keyForHash: (hash) => `${PLUGIN_ARTIFACT_KEY_PREFIX}${hash}.zip`,
  nameOf: (plugin) => plugin.metadata?.slug || plugin.metadata?.id || "",
};
