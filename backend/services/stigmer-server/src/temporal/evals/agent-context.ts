/**
 * An agent eval's context (context.ts): the eval; the agent at the version
 * the eval stamped (spec.agent_version, a hash once created), read through
 * the version ladder so a save during the eval changes nothing; every
 * plugin the eval stamped on its status, each as of the digest its tries
 * run (its servers and skills are that version's, not the head's); each
 * evaluated plugin's suite at that digest; and one matrix over all their
 * cases, in plugin order, so a case's index is flat and the same on every
 * read.
 *
 * The default target, when the eval names none, is the agent as it runs:
 * its engine (native when it names none, as a conversation runs it), and
 * its model as the label, the try naming no model (matrix.ts
 * runsAgentModel).
 *
 * Undefined when the eval, its spec, its agent version or one of its
 * plugin versions is gone: a try then has nothing it may run as stamped. A
 * store fault, or a suite that cannot be read, throws.
 *
 * Proven by __tests__/agent-context.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentVersionBinding } from "../../domain/agent/versions.js";
import { agentTargetOf } from "../../domain/agent-eval/target.js";
import type { EvalMatrix } from "../../domain/plugin-eval/matrix.js";
import { planMatrix } from "../../domain/plugin-eval/matrix.js";
import { pluginVersionedBinding } from "../../domain/plugin-eval/suite.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import type {
  AgentEvalContext,
  CachedSuiteReader,
  EvalCaseSource,
  EvalContextDeps,
} from "./context.js";
import { attachedPluginOf, loadOrUndefined } from "./context.js";

export async function loadAgentEvalContext(
  deps: EvalContextDeps,
  readSuite: CachedSuiteReader,
  evalId: string,
): Promise<AgentEvalContext | undefined> {
  const agentEval = await loadOrUndefined(deps.store, ApiResourceKind.agent_eval, evalId, AgentEvalSchema);
  const spec = agentEval?.spec;
  if (agentEval === undefined || spec === undefined) {
    return undefined;
  }
  const agent = await versionOrUndefined(() =>
    loadVersion(deps.store, agentVersionBinding, spec.agentId, spec.agentVersion),
  );
  if (agent === undefined) {
    return undefined;
  }
  const stamped = agentEval.status?.plugins ?? [];
  const plugins: Plugin[] = [];
  for (const entry of stamped) {
    const plugin = await versionOrUndefined(() =>
      loadVersion(deps.store, pluginVersionedBinding, entry.pluginId, entry.pluginDigest),
    );
    if (plugin === undefined) {
      return undefined;
    }
    plugins.push(plugin.resource);
  }
  const agentSpec = agent.resource.spec;
  const agentTarget = agentTargetOf(agentSpec);
  const sources: Array<EvalCaseSource & { readonly pluginIndex: number }> = [];
  const caseSources: number[] = [];
  const matrix: EvalMatrix = { cases: [], cells: [] };
  for (const [pluginIndex, entry] of stamped.entries()) {
    if (entry.notRunReason !== "") {
      continue;
    }
    const loaded = await readSuite(entry.pluginId, entry.pluginDigest);
    const sourceIndex = sources.length;
    sources.push({
      plugin: plugins[pluginIndex]!,
      digest: entry.pluginDigest,
      files: loaded.files,
      suite: loaded.suite,
      pluginIndex,
    });
    const planned = planMatrix(loaded.suite, spec, deps.catalog, agentTarget);
    const offset = matrix.cases.length;
    matrix.cases.push(...planned.cases);
    matrix.cells.push(...planned.cells.map((cell) => ({ ...cell, caseIndex: cell.caseIndex + offset })));
    caseSources.push(...planned.cases.map(() => sourceIndex));
  }
  return {
    kind: "agent",
    agentEval,
    agent: {
      org: agent.resource.metadata?.org ?? "",
      id: agent.resource.metadata?.id ?? "",
      slug: agent.resource.metadata?.slug ?? "",
      versionHash: spec.agentVersion,
    },
    attached: stamped.map((entry, index) => attachedPluginOf(plugins[index]!, entry.pluginDigest)),
    sources,
    caseSources,
    matrix,
    twoArms: false,
  };
}

/** A version read, or undefined when the resource or the version is gone. */
async function versionOrUndefined<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return undefined;
    }
    throw error;
  }
}
