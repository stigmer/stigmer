/**
 * The plugins a run lists: its agent version's `plugins` plus its
 * conversation's, one entry per plugin, the conversation's reference
 * winning when both name one (its version is the one it chose), then each
 * subagent's (run-subagents.ts) for a plugin neither already names, the
 * first subagent's winning. The runner merges the same lists the same way
 * at turn start, so what a run is planned for is what it runs, and a
 * subagent that lists a plugin the conversation also lists runs it at the
 * conversation's version.
 *
 * Each reference resolves like a skill reference: its version when set,
 * else the installed one, in the reference's organization or the run's.
 * A plugin that is gone is left out here: the runner resolves the same
 * references for real and refuses the turn naming it, so planning needs
 * only the plugins that exist. Two plugins of one name from two
 * organizations refuse the run: a turn names a plugin's skills, agents and
 * tools by its name, so the two would share every name.
 *
 * A run's `excluded_plugin_ids` (set only by the server's evals; the
 * create guard GuardExcludedPlugins) leaves those plugins out after they
 * load, matched on the loaded plugin's id, because a reference may still
 * name a plugin by slug alone. The merge above already holds each
 * subagent's copy, so a plugin left out is left out of the whole run; the
 * runner leaves the same plugins out of the turn (blueprint-resolver.ts).
 *
 * Tests: __tests__/run-plugins.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { toolServerSegment } from "@stigmer/plugin-package";

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { loadPluginByReference } from "../plugin/versions.js";
import type { RunPlugin } from "../vault/resolve.js";
import type { RunSubagent } from "./run-subagents.js";

/** The run's plugin references, each once, keyed by organization and id (or the slug a reference still written by a name nothing held carries). */
export function runPluginReferences(
  agentSpec: AgentSpec | undefined,
  session: Session | undefined,
  executionOrg: string,
  subagents: readonly RunSubagent[] = [],
): ApiResourceReference[] {
  const merged = new Map<string, ApiResourceReference>();
  const keyOf = (ref: ApiResourceReference): string =>
    `${ref.org || executionOrg}/${ref.id !== "" ? `#${ref.id}` : ref.slug}`;
  const named = (ref: ApiResourceReference): boolean =>
    ref.id !== "" || ref.slug !== "";
  const add = (ref: ApiResourceReference): void => {
    if (named(ref)) {
      merged.set(keyOf(ref), ref);
    }
  };
  for (const ref of agentSpec?.plugins ?? []) add(ref);
  // The conversation's reference wins: it is the version the conversation chose.
  for (const ref of session?.spec?.plugins ?? []) add(ref);
  for (const subagent of subagents) {
    for (const ref of subagent.spec.plugins) {
      // A subagent's own plugin reference names its organization's plugin.
      const own = ref.org === "" ? { ...ref, org: subagent.org } : ref;
      if (named(own) && !merged.has(keyOf(own))) {
        merged.set(keyOf(own), own);
      }
    }
  }
  return [...merged.values()];
}

/** Loads each referenced plugin that exists and is not excluded; refuses two plugins of one name. */
export async function loadRunPlugins(
  store: Store,
  refs: readonly ApiResourceReference[],
  executionOrg: string,
  excludedIds: readonly string[] = [],
): Promise<RunPlugin[]> {
  const excluded = new Set(excludedIds);
  const plugins: RunPlugin[] = [];
  const byName = new Map<string, Plugin>();
  // Each server's name in a turn, `plugin_<plugin>_<server>`, and whose it
  // is: `.` and `_` read alike, so two plugins can name one server the same.
  const bySegment = new Map<string, string>();
  for (const ref of refs) {
    let plugin: Plugin;
    try {
      plugin = await loadPluginByReference(store, ref, executionOrg);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
    if (excluded.has(plugin.metadata?.id ?? "")) {
      continue;
    }
    const name = plugin.metadata?.name ?? "";
    const other = byName.get(name);
    if (other !== undefined && other.metadata?.id !== plugin.metadata?.id) {
      throw failedPreconditionError(
        `this conversation uses two plugins named '${name}' (${other.metadata?.org ?? ""}/${other.metadata?.slug ?? ""} and ` +
          `${plugin.metadata?.org ?? ""}/${plugin.metadata?.slug ?? ""}); a turn names a plugin's skills, agents and tools by its name, ` +
          "so remove one of them from the agent, one of its subagents or the conversation",
      );
    }
    byName.set(name, plugin);
    if (other === undefined) {
      for (const server of plugin.status?.mcpServers ?? []) {
        const segment = toolServerSegment(name, server.name);
        const holder = bySegment.get(segment);
        if (holder !== undefined) {
          throw failedPreconditionError(
            `this conversation uses two MCP servers a turn would both name '${segment}' (${holder} and ` +
              `plugin '${name}' server '${server.name}'); remove one of their plugins from the agent, one of its subagents or the conversation`,
          );
        }
        bySegment.set(segment, `plugin '${name}' server '${server.name}'`);
      }
    }
    plugins.push({
      id: plugin.metadata?.id ?? "",
      name,
      status: plugin.status ?? create(PluginStatusSchema),
    });
  }
  return plugins;
}
