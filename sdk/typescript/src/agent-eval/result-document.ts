// An agent eval as a result document: the agent and its version, the
// eval's totals, and one block per plugin the agent attaches, each block in
// the shape of a plugin eval's result document (plugin-eval/result-document.ts)
// for that plugin's cases, so a script that gates on a plugin eval's file
// gates on `plugins[i]` unchanged. An agent eval has one arm: no case has
// `delta` or `arms.without`, and no block has `meanDelta`.
//
// A plugin whose cases did not run (not selected, or none at the version
// the agent attaches) has a block with no cases and its `notRunReason`.
// A block's `costUsd` is what its own tries spent; its `durationSeconds` is
// the eval's, since the plugins' tries ran interleaved.
//
// Pure: no I/O, no clock unless the caller passes none and the eval has no
// start time. Pinned by `__tests__/result-document.test.ts`.

import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEvalPlugin } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";

import {
  durationOf,
  partialReasonOf,
  resultBlockOf,
  type PluginEvalResultDocument,
  type ResultDocumentOptions,
  type ResultPartialReason,
} from "../plugin-eval/result-document.js";

/** One plugin's block: the plugin, and the format's fields for its cases. */
export interface AgentEvalPluginResult extends Omit<PluginEvalResultDocument, "evalId" | "provisionalDelta"> {
  readonly plugin: {
    readonly id: string;
    readonly slug: string;
    /** The plugin version every try ran. */
    readonly digest: string;
  };
  /** Why none of the plugin's cases ran; `null` when they ran. */
  readonly notRunReason: string | null;
}

/** An agent eval's result document. */
export interface AgentEvalResultDocument {
  readonly schemaVersion: 1;
  readonly evalId: string;
  readonly agent: {
    readonly id: string;
    /** The agent's slug, when the caller knows it; empty otherwise. */
    readonly slug: string;
    /** The agent version every try ran. */
    readonly versionHash: string;
  };
  readonly partial: boolean;
  readonly partialReason: ResultPartialReason | null;
  readonly aggregates: {
    readonly overallScore: number;
    readonly casesPassed: number;
    readonly casesTotal: number;
  };
  readonly plugins: readonly AgentEvalPluginResult[];
  readonly costUsd: number;
  readonly durationSeconds: number;
}

/** Options for {@link toAgentEvalResultDocument}. */
export interface AgentEvalResultDocumentOptions extends ResultDocumentOptions {
  /** The agent's slug, for the document's `agent.slug`. */
  readonly agentSlug?: string;
}

/** Builds the result document for an agent eval, finished or not. */
export function toAgentEvalResultDocument(
  agentEval: AgentEval,
  opts: AgentEvalResultDocumentOptions = {},
): AgentEvalResultDocument {
  const status = agentEval.status;
  const partialReason = partialReasonOf(status, opts.interrupted === true);
  const durationSeconds = opts.durationSeconds ?? durationOf(status, opts.nowMs ?? Date.now());
  const specTargets = agentEval.spec?.targets ?? [];
  return {
    schemaVersion: 1,
    evalId: agentEval.metadata?.id ?? "",
    agent: {
      id: agentEval.spec?.agentId ?? "",
      slug: opts.agentSlug ?? "",
      versionHash: versionHashOf(agentEval),
    },
    partial: partialReason !== null,
    partialReason,
    aggregates: {
      overallScore: status?.aggregates?.overallScore ?? 0,
      casesPassed: status?.aggregates?.casesPassed ?? 0,
      casesTotal: status?.aggregates?.casesTotal ?? 0,
    },
    plugins: (status?.plugins ?? []).map((plugin) => pluginResultOf(plugin, specTargets, partialReason, durationSeconds)),
    costUsd: status?.costUsd ?? 0,
    durationSeconds,
  };
}

function pluginResultOf(
  plugin: AgentEvalPlugin,
  specTargets: NonNullable<AgentEval["spec"]>["targets"],
  partialReason: ResultPartialReason | null,
  durationSeconds: number,
): AgentEvalPluginResult {
  const block = resultBlockOf(plugin.cases, specTargets, plugin.aggregates);
  return {
    plugin: { id: plugin.pluginId, slug: plugin.pluginSlug, digest: plugin.pluginDigest },
    notRunReason: plugin.notRunReason === "" ? null : plugin.notRunReason,
    schemaVersion: 1,
    partial: partialReason !== null,
    partialReason,
    ...block,
    costUsd: plugin.cases.reduce(
      (sum, evalCase) =>
        sum +
        evalCase.targets.reduce(
          (inner, target) => inner + (target.withPlugin?.tries ?? []).reduce((tries, attempt) => tries + attempt.costUsd, 0),
          0,
        ),
      0,
    ),
    durationSeconds,
  };
}

/** The version the tries ran: the status's stamp, or the spec's before the status carries one. */
function versionHashOf(agentEval: AgentEval): string {
  const stamped = agentEval.status?.agentVersionHash ?? "";
  return stamped !== "" ? stamped : (agentEval.spec?.agentVersion ?? "");
}
