/**
 * What an eval run's try attaches, per arm: the one place that decides
 * what "with the plugin" and "without the plugin" mean.
 *
 * Both arms' sessions are the same. A try's session runs the eval run's
 * agent pinned to the version it stamped, through the session's
 * `agent_ref` (none on an eval run of a plugin: the built-in assistant),
 * and lists every plugin a try loads (the eval run's `status.plugins`) at
 * the archive it stamped, the compared plugin included. An arm is its
 * exclusion: the with arm's run excludes nothing; the without arm's run
 * excludes the compared plugin (`RunSpec.excluded_plugin_ids`), which run
 * planning and the runner leave out of the whole turn, from the agent's
 * plugins, the conversation's and every subagent's (domain/run/
 * run-plugins.ts, the runner's blueprint resolver). On an eval run of a
 * plugin this is the assistant with the plugin, against the assistant
 * with it listed and left out: the assistant alone.
 *
 * A conversation's own plugin reference wins over its agent's at run
 * planning and in the runner, and an open conversation keeps its agent's
 * version, so a plugin pushed or the agent saved during the eval run moves
 * none of its tries. A subagent's own plugin references are its own: one
 * that names no version resolves to the version installed when its turn
 * starts, as in any conversation of the agent; one naming the compared
 * plugin is left out of the without arm all the same, since the exclusion
 * matches resolved ids.
 *
 * Proven by __tests__/arm.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { toolServerSegment } from "@stigmer/plugin-package";

/** A try's arm. */
export type EvalArm = "with" | "without";

/** What the arms need to know of a plugin a try loads. */
export interface PluginAttachmentFacts {
  /** The plugin's organization. */
  readonly org: string;
  /** The plugin's id, which its reference holds and the without arm excludes by. */
  readonly id: string;
  /** The plugin's slug. */
  readonly slug: string;
  /** The archive the eval run stamped, which the reference pins. */
  readonly digest: string;
  /**
   * Each of the plugin's MCP servers as a turn names it,
   * `plugin_<plugin>_<server>` (`toolServerSegment`), in entry order: the
   * names a try's lists turn the servers off by, and the ones its trace
   * reads.
   */
  readonly serverSegments: ReadonlyArray<string>;
}

/** The agent an eval run's tries run: its organization, id, slug and the version the eval run stamped. */
export interface AgentAttachmentFacts {
  readonly org: string;
  readonly id: string;
  readonly slug: string;
  /** The agent version's hash, which the session's agent reference pins. */
  readonly versionHash: string;
}

/** What a try's session attaches, and what its run leaves out. */
export interface ArmAttachment {
  /** The agent the session runs, pinned to a version; absent runs the built-in assistant. */
  readonly agentRef?: ApiResourceReference;
  /** The plugins the session lists, the same in both arms. */
  readonly plugins: ReadonlyArray<ApiResourceReference>;
  /** The plugin ids the try's run leaves out of its turn: the compared plugin's in the without arm, else none. */
  readonly excludedPluginIds: ReadonlyArray<string>;
}

/** What an eval run's tries load: the agent (none on an eval run of a plugin), every plugin, and the one compared. */
export interface TryLoad {
  readonly agent: AgentAttachmentFacts | undefined;
  readonly plugins: ReadonlyArray<Pick<PluginAttachmentFacts, "org" | "id" | "slug" | "digest">>;
  /** The id of the plugin each case runs with and without; undefined when none is compared. */
  readonly comparedPluginId: string | undefined;
}

/** A try's attachment in its arm (the module header). */
export function tryAttachment(load: TryLoad, arm: EvalArm): ArmAttachment {
  return {
    ...(load.agent === undefined
      ? {}
      : {
          agentRef: create(ApiResourceReferenceSchema, {
            org: load.agent.org,
            kind: ApiResourceKind.agent,
            id: load.agent.id,
            version: load.agent.versionHash,
          }),
        }),
    plugins: load.plugins.map((plugin) =>
      create(ApiResourceReferenceSchema, {
        org: plugin.org,
        kind: ApiResourceKind.plugin,
        id: plugin.id,
        version: plugin.digest,
      }),
    ),
    excludedPluginIds: excludedIn(load.comparedPluginId, arm),
  };
}

/** The plugin ids an arm leaves out: the compared plugin's in the without arm. */
export function excludedIn(comparedPluginId: string | undefined, arm: EvalArm): string[] {
  return arm === "without" && comparedPluginId !== undefined ? [comparedPluginId] : [];
}

/** Whether a plugin is loaded in an arm: every plugin is, but the compared one in the without arm. */
export function loadedIn(pluginId: string, comparedPluginId: string | undefined, arm: EvalArm): boolean {
  return !excludedIn(comparedPluginId, arm).includes(pluginId);
}

/** A plugin's facts, from the row the eval run loaded at the digest it stamped. */
export function pluginAttachmentFacts(plugin: Plugin, digest: string): PluginAttachmentFacts {
  const name = plugin.metadata?.name ?? "";
  return {
    org: plugin.metadata?.org ?? "",
    id: plugin.metadata?.id ?? "",
    slug: plugin.metadata?.slug ?? "",
    digest,
    serverSegments: (plugin.status?.mcpServers ?? []).map((server) => toolServerSegment(name, server.name)),
  };
}
