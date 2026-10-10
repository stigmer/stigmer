/**
 * The plugins a run lists: its agent version's `plugins` plus its
 * conversation's, one entry per plugin, the conversation's reference
 * winning when both name one (its version is the one it chose). The runner
 * merges the same two lists the same way at turn start, so what a run is
 * planned for is what it runs.
 *
 * Each reference resolves like a skill reference: its version when set,
 * else the installed one, in the reference's organization or the run's.
 * A plugin that is gone is left out here: the runner resolves the same
 * references for real and refuses the turn naming it, so planning needs
 * only the plugins that exist. Two plugins of one name from two
 * organizations refuse the run: a turn names a plugin's skills, agents and
 * tools by its name, so the two would share every name.
 *
 * Tests: __tests__/run-plugins.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { loadPluginByReference } from "../plugin/versions.js";
import type { RunPlugin } from "../vault/resolve.js";

/** The run's plugin references, each once, keyed by organization and slug. */
export function runPluginReferences(
  agentSpec: AgentSpec | undefined,
  session: Session | undefined,
  executionOrg: string,
): ApiResourceReference[] {
  const merged = new Map<string, ApiResourceReference>();
  const add = (ref: ApiResourceReference): void => {
    if (ref.slug !== "") {
      merged.set(`${ref.org || executionOrg}/${ref.slug}`, ref);
    }
  };
  for (const ref of agentSpec?.plugins ?? []) add(ref);
  // The conversation's reference wins: it is the version the conversation chose.
  for (const ref of session?.spec?.plugins ?? []) add(ref);
  return [...merged.values()];
}

/** Loads each referenced plugin that exists; refuses two plugins of one name. */
export async function loadRunPlugins(
  store: Store,
  refs: readonly ApiResourceReference[],
  executionOrg: string,
): Promise<RunPlugin[]> {
  const plugins: RunPlugin[] = [];
  const byName = new Map<string, Plugin>();
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
    const name = plugin.metadata?.name ?? "";
    const other = byName.get(name);
    if (other !== undefined && other.metadata?.id !== plugin.metadata?.id) {
      throw failedPreconditionError(
        `this conversation uses two plugins named '${name}' (${other.metadata?.org ?? ""}/${other.metadata?.slug ?? ""} and ` +
          `${plugin.metadata?.org ?? ""}/${plugin.metadata?.slug ?? ""}); a turn names a plugin's skills, agents and tools by its name, ` +
          "so remove one of them from the agent or from the conversation",
      );
    }
    byName.set(name, plugin);
    plugins.push({
      id: plugin.metadata?.id ?? "",
      name,
      status: plugin.status ?? create(PluginStatusSchema),
    });
  }
  return plugins;
}
