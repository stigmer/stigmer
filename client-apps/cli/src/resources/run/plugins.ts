// The plugins a new conversation uses, from `stigmer run --plugin <ref>`.
//
// A conversation that lists a plugin gets its skills, its agents, its MCP
// servers' tools and its hooks, as an agent that lists it does; with no
// agent, the built-in assistant runs with them. Each reference resolves by
// the one rule every run flag naming resources shares (references.ts), and
// names the installed version: the server reads the plugin at each turn.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { resolveRunReferences } from "./references.js";

/** The plugin reads an id lookup needs, injectable for tests. */
export type PluginReader = Pick<Stigmer, "plugin">;

/**
 * Resolve each `--plugin` reference to the reference the conversation
 * stores, in order, a reference written twice once. An empty or malformed
 * reference is a usage error.
 */
export function resolveRunPlugins(
  client: PluginReader,
  refs: readonly string[],
  org: string,
): Promise<ApiResourceReference[]> {
  return resolveRunReferences(
    { flag: "--plugin", noun: "plugin", kind: ApiResourceKind.plugin, get: (id) => client.plugin.get(id) },
    refs,
    org,
  );
}
