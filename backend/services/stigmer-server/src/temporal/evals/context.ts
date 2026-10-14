/**
 * What every eval activity reads first: the eval, the plugin suites its
 * cases come from at the versions it stamped, and the planned matrix. An
 * eval id names its kind (domain/plugin-eval/plugin-eval-run.ts
 * evalKindOf), so one loader serves both:
 *
 *   - a plugin eval: the eval, its plugin, the suite at the eval's stamped
 *     digest, the matrix, and whether it compares with and without the
 *     plugin;
 *   - an agent eval (agent-context.ts): the eval, the agent at its stamped
 *     version, every plugin it attaches at its stamped digest, each
 *     evaluated plugin's suite, and one matrix over all their cases, in
 *     plugin order.
 *
 * The matrix is re-planned from the same suites and spec on each read,
 * which is the planner's promise (domain/plugin-eval/matrix.ts: pure, so a
 * retried activity and the load agree on every index). A suite is read
 * from the archive once per worker and digest and kept for the next
 * activities (a small cache, by digest, since a digest's bytes never
 * change).
 *
 * The activities read a case's plugin, files and suite through sourceOf,
 * its spec through specOf, and what its try attaches through
 * attachmentOf, so they never ask which kind of eval they run.
 *
 * Proven by __tests__/context.test.ts and __tests__/agent-context.test.ts.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { EvalCase, EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { PluginEvalSpec } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentAttachment, armAttachment, pluginAttachmentFacts } from "../../domain/plugin-eval/arm.js";
import type { AgentAttachmentFacts, ArmAttachment, EvalArm, PluginAttachmentFacts } from "../../domain/plugin-eval/arm.js";
import type {
  EvalMatrix,
  EvalModelCatalog,
  PlannedTarget,
} from "../../domain/plugin-eval/matrix.js";
import { planMatrix } from "../../domain/plugin-eval/matrix.js";
import { evalKindOf } from "../../domain/plugin-eval/plugin-eval-run.js";
import type { EvalSuiteSource, LoadedEvalSuite } from "../../domain/plugin-eval/suite.js";
import { loadEvalSuite } from "../../domain/plugin-eval/suite.js";
import type { PluginServer, TrySpec } from "../../domain/plugin-eval/try-run.js";
import { pluginServersOf } from "../../domain/plugin-eval/try-run.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { loadAgentEvalContext } from "./agent-context.js";
import { AGENT_EVAL_CASE_WORKFLOW_PREFIX, PLUGIN_EVAL_CASE_WORKFLOW_PREFIX } from "./names.js";

/** Suites a worker keeps, by archive digest. */
const SUITE_CACHE_SIZE = 8;

/** A plugin eval's context. */
export interface PluginEvalContext {
  readonly kind: "plugin";
  readonly pluginEval: PluginEval;
  readonly plugin: Plugin;
  /** The archive digest the eval runs. */
  readonly digest: string;
  readonly files: PluginFiles;
  readonly suite: EvalSuite;
  readonly matrix: EvalMatrix;
  /** Whether the eval compares with and without the plugin. */
  readonly twoArms: boolean;
}

/** One plugin's suite in an eval: the plugin as of the digest its tries run, and its files and cases. */
export interface EvalCaseSource {
  readonly plugin: Plugin;
  readonly digest: string;
  readonly files: PluginFiles;
  readonly suite: EvalSuite;
}

/** One plugin an agent eval's tries attach, as they attach it. */
export interface AttachedPlugin {
  readonly facts: PluginAttachmentFacts;
  /** Its MCP servers as a try names them. */
  readonly servers: ReadonlyArray<PluginServer>;
}

/** An agent eval's context (agent-context.ts). */
export interface AgentEvalContext {
  readonly kind: "agent";
  readonly agentEval: AgentEval;
  /** The agent at the version the eval stamped. */
  readonly agent: AgentAttachmentFacts;
  /** Every plugin the agent version attaches, in the eval's status order. */
  readonly attached: ReadonlyArray<AttachedPlugin>;
  /** The MCP servers the agent version writes itself, as a try names them (`mcp__<name>`). */
  readonly ownServers: ReadonlyArray<PluginServer>;
  /** The plugins whose cases run, each with its index into `attached` (and the status's plugins). */
  readonly sources: ReadonlyArray<EvalCaseSource & { readonly pluginIndex: number }>;
  /** Each planned case's index into `sources`, by case index. */
  readonly caseSources: ReadonlyArray<number>;
  /** One matrix over every source's cases, in source order. */
  readonly matrix: EvalMatrix;
  readonly twoArms: false;
}

export type EvalContext = PluginEvalContext | AgentEvalContext;

/** The spec fields every activity reads, which both kinds' specs share by name. */
export type EvalSpecKnobs = TrySpec & Pick<PluginEvalSpec, "maxCostUsd" | "concurrency" | "threshold">;

export interface EvalContextDeps {
  readonly store: Store;
  readonly suites: EvalSuiteSource;
  readonly catalog: EvalModelCatalog;
}

export type EvalContextLoader = (
  evalId: string,
) => Promise<EvalContext | undefined>;

/** A suite read once per worker and digest (the module header). */
export type CachedSuiteReader = (pluginId: string, digest: string) => Promise<LoadedEvalSuite>;

/**
 * The loader: undefined when the eval, its plugin or its agent is gone, or
 * the id names no eval. A suite that cannot be read throws, and the caller
 * decides what that means.
 */
export function newEvalContextLoader(deps: EvalContextDeps): EvalContextLoader {
  const cache = new Map<string, LoadedEvalSuite>();
  const readSuite: CachedSuiteReader = async (pluginId, digest) => {
    let loaded = cache.get(digest);
    if (loaded === undefined) {
      loaded = await loadEvalSuite(deps.suites, pluginId, digest);
      cache.set(digest, loaded);
      for (const oldest of cache.keys()) {
        if (cache.size <= SUITE_CACHE_SIZE) {
          break;
        }
        cache.delete(oldest);
      }
    }
    return loaded;
  };
  return async (evalId) => {
    if (evalKindOf(evalId) === "agent") {
      return loadAgentEvalContext(deps, readSuite, evalId);
    }
    const pluginEval = await loadOrUndefined(
      deps.store,
      ApiResourceKind.plugin_eval,
      evalId,
      PluginEvalSchema,
    );
    const spec = pluginEval?.spec;
    if (pluginEval === undefined || spec === undefined) {
      return undefined;
    }
    const plugin = await loadOrUndefined(
      deps.store,
      ApiResourceKind.plugin,
      spec.pluginId,
      PluginSchema,
    );
    if (plugin === undefined) {
      return undefined;
    }
    const digest =
      spec.pluginDigest !== ""
        ? spec.pluginDigest
        : (plugin.status?.digest ?? "");
    const loaded = await readSuite(spec.pluginId, digest);
    return {
      kind: "plugin",
      pluginEval,
      plugin,
      digest,
      files: loaded.files,
      suite: loaded.suite,
      matrix: planMatrix(loaded.suite, spec, deps.catalog),
      twoArms: spec.ablation !== PluginEvalAblation.none,
    };
  };
}

/** One cell's case and target, or undefined when the plan has no such cell. */
export function cellOf(
  context: EvalContext,
  caseIndex: number,
  targetIndex: number,
): { readonly evalCase: EvalCase; readonly target: PlannedTarget } | undefined {
  const planned = context.matrix.cases[caseIndex];
  const target = planned?.targets[targetIndex];
  if (planned === undefined || target === undefined) {
    return undefined;
  }
  return { evalCase: planned.evalCase, target };
}

/** The plugin a case comes from, with its files and suite; undefined when the plan has no such case. */
export function sourceOf(context: EvalContext, caseIndex: number): EvalCaseSource | undefined {
  if (context.kind === "plugin") {
    return { plugin: context.plugin, digest: context.digest, files: context.files, suite: context.suite };
  }
  const index = context.caseSources[caseIndex];
  return index === undefined ? undefined : context.sources[index];
}

/** The eval's spec; undefined when the stored row carries none. */
export function specOf(context: EvalContext): EvalSpecKnobs | undefined {
  return context.kind === "plugin" ? context.pluginEval.spec : context.agentEval.spec;
}

/** The organization the eval runs in. */
export function orgOf(context: EvalContext): string {
  return (context.kind === "plugin" ? context.pluginEval.metadata?.org : context.agentEval.metadata?.org) ?? "";
}

/** The prefix of the eval's tries' workflow ids. */
export function caseWorkflowPrefixOf(context: EvalContext): string {
  return context.kind === "plugin" ? PLUGIN_EVAL_CASE_WORKFLOW_PREFIX : AGENT_EVAL_CASE_WORKFLOW_PREFIX;
}

/** What a try of the case attaches in its arm (domain/plugin-eval/arm.ts). */
export function attachmentOf(context: EvalContext, arm: EvalArm, source: EvalCaseSource): ArmAttachment {
  if (context.kind === "plugin") {
    return armAttachment(arm, pluginAttachmentFacts(source.plugin, source.digest));
  }
  return agentAttachment(context.agent, context.attached.map((plugin) => plugin.facts));
}

/**
 * The MCP servers a try runs beside the case's own plugin's, which the try
 * turns off unless the eval runs real servers (domain/plugin-eval/try-run.ts
 * tryToolsOf): none in a plugin eval; in an agent eval the agent's own
 * servers, which no case mocks, and every other attached plugin's.
 */
export function otherServersOf(context: EvalContext, caseIndex: number): PluginServer[] {
  if (context.kind === "plugin") {
    return [];
  }
  const own = context.sources[context.caseSources[caseIndex] ?? -1]?.pluginIndex;
  return [
    ...context.ownServers,
    ...context.attached.flatMap((plugin, index) => (index === own ? [] : [...plugin.servers])),
  ];
}

/** The attached plugin's servers as a try names them. */
export function attachedPluginOf(plugin: Plugin, digest: string): AttachedPlugin {
  return { facts: pluginAttachmentFacts(plugin, digest), servers: pluginServersOf(plugin) };
}

/** The name the format's `<plugin>` reads as: the manifest's, else the slug. */
export function pluginNameOf(plugin: Plugin): string {
  const name = plugin.spec?.name ?? "";
  return name !== "" ? name : (plugin.metadata?.slug ?? "");
}

/** The workspace paths a case's graders read the content of; a try's run returns them too. */
export { wantedFilesOf } from "../../domain/plugin-eval/graders/verdict.js";

export async function loadRun(
  store: Store,
  runId: string,
): Promise<Run | undefined> {
  return loadOrUndefined(store, ApiResourceKind.run, runId, RunSchema);
}

export async function loadOrUndefined<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  id: string,
  schema: Desc,
): Promise<MessageShape<Desc> | undefined> {
  if (id === "") {
    return undefined;
  }
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
