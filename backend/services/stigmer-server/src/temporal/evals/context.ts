/**
 * What every eval run activity reads first: the eval run; its agent at the
 * version it stamped (none on an eval run of a plugin, whose tries run the
 * built-in assistant), read through the version ladder so a save during
 * the eval run changes nothing; every plugin it stamped on its status, each
 * as of the digest its tries run (its servers and skills are that
 * version's, not the head's); the compared plugin, if any; each evaluated
 * plugin's suite at its digest; and one matrix over all their cases, in
 * plugin order, so a case's index is flat and the same on every read.
 *
 * The default target, on an agent with no target named, is the agent as
 * it runs: its engine (native when it names none, as a conversation runs
 * it), and its model as the label, the try naming no model (matrix.ts
 * runsAgentModel). The matrix plans the without arm exactly when a plugin
 * is compared and the ablation is not none (domain/eval-run/steps.ts
 * matrixSpecOf), the rule create counted tries by.
 *
 * The matrix is re-planned from the same suites and spec on each read,
 * which is the planner's promise (domain/eval-run/matrix.ts: pure, so a
 * retried activity and the load agree on every index). A suite is read
 * from the archive once per worker and digest and kept for the next
 * activities (a small cache, by digest, since a digest's bytes never
 * change).
 *
 * The activities read a case's plugin, files and suite through sourceOf,
 * its spec through specOf, and what its try lists and leaves out through
 * attachmentOf (domain/eval-run/arm.ts), so they never ask what the eval
 * run is about.
 *
 * Undefined when the eval run, its spec, its agent version or one of its
 * stamped plugin versions is gone: a try then has nothing it may run as
 * stamped. A store fault, or a suite that cannot be read, throws.
 *
 * Proven by __tests__/context.test.ts.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { EvalCase, EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRunSpec } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentVersionBinding } from "../../domain/agent/versions.js";
import { pluginAttachmentFacts, tryAttachment } from "../../domain/eval-run/arm.js";
import type { AgentAttachmentFacts, ArmAttachment, EvalArm, PluginAttachmentFacts } from "../../domain/eval-run/arm.js";
import type { EvalMatrix, EvalModelCatalog, PlannedTarget } from "../../domain/eval-run/matrix.js";
import { isComparing, matrixSpecOf, planMatrix } from "../../domain/eval-run/matrix.js";
import { subjectOf } from "../../domain/eval-run/subject.js";
import type { EvalSuiteSource, LoadedEvalSuite } from "../../domain/eval-run/suite.js";
import { loadEvalSuite, pluginVersionedBinding } from "../../domain/eval-run/suite.js";
import { agentTargetOf } from "../../domain/eval-run/target.js";
import type { PluginServer, TrySpec } from "../../domain/eval-run/try-run.js";
import { pluginServersOf } from "../../domain/eval-run/try-run.js";
import { writtenServerNames } from "../../domain/eval-run/written-servers.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/** Suites a worker keeps, by archive digest. */
const SUITE_CACHE_SIZE = 8;

/** One plugin's suite in an eval run: the plugin as of the digest its tries run, and its files and cases. */
export interface EvalCaseSource {
  readonly plugin: Plugin;
  readonly digest: string;
  readonly files: PluginFiles;
  readonly suite: EvalSuite;
}

/** One plugin an eval run's tries list, as they list it. */
export interface AttachedPlugin {
  readonly facts: PluginAttachmentFacts;
  /** Its MCP servers as a try names them. */
  readonly servers: ReadonlyArray<PluginServer>;
}

/** An eval run's context (the module header). */
export interface EvalContext {
  readonly evalRun: EvalRun;
  /** The agent at the version the eval run stamped; undefined on an eval run of a plugin. */
  readonly agent: AgentAttachmentFacts | undefined;
  /** Every plugin a try lists, in the eval run's status order. */
  readonly loaded: ReadonlyArray<AttachedPlugin>;
  /** The plugin each case runs with and without; undefined when none is compared. */
  readonly comparedPluginId: string | undefined;
  /** The MCP servers the agent version and its subagents write themselves, as a try names them (`mcp__<name>`). */
  readonly ownServers: ReadonlyArray<PluginServer>;
  /** The plugins whose cases run, each with its index into `loaded` (and the status's plugins). */
  readonly sources: ReadonlyArray<EvalCaseSource & { readonly pluginIndex: number }>;
  /** Each planned case's index into `sources`, by case index. */
  readonly caseSources: ReadonlyArray<number>;
  /** One matrix over every source's cases, in source order. */
  readonly matrix: EvalMatrix;
  /** Whether each case also runs without the compared plugin. */
  readonly twoArms: boolean;
}

/** The spec fields every activity reads. */
export type EvalSpecKnobs = TrySpec & Pick<EvalRunSpec, "maxCostUsd" | "concurrency" | "threshold">;

export interface EvalContextDeps {
  readonly store: Store;
  readonly suites: EvalSuiteSource;
  readonly catalog: EvalModelCatalog;
}

export type EvalContextLoader = (evalRunId: string) => Promise<EvalContext | undefined>;

/** A suite read once per worker and digest (the module header). */
export type CachedSuiteReader = (pluginId: string, digest: string) => Promise<LoadedEvalSuite>;

/** The loader (the module header). */
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
  return (evalRunId) => loadEvalContext(deps, readSuite, evalRunId);
}

async function loadEvalContext(
  deps: EvalContextDeps,
  readSuite: CachedSuiteReader,
  evalRunId: string,
): Promise<EvalContext | undefined> {
  const evalRun = await loadOrUndefined(deps.store, ApiResourceKind.eval_run, evalRunId, EvalRunSchema);
  const spec = evalRun?.spec;
  const subject = subjectOf(spec);
  if (evalRun === undefined || spec === undefined || subject === undefined) {
    return undefined;
  }
  let agent: AgentAttachmentFacts | undefined;
  let agentSpec;
  if (subject.kind === "agent") {
    const version = await versionOrUndefined(() =>
      loadVersion(deps.store, agentVersionBinding, subject.id, spec.agentVersion),
    );
    if (version === undefined) {
      return undefined;
    }
    agentSpec = version.resource.spec;
    agent = {
      org: version.resource.metadata?.org ?? "",
      id: version.resource.metadata?.id ?? "",
      slug: version.resource.metadata?.slug ?? "",
      versionHash: spec.agentVersion,
    };
  }
  const stamped = evalRun.status?.plugins ?? [];
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
  const agentTarget = subject.kind === "agent" ? agentTargetOf(agentSpec) : undefined;
  const planSpec = matrixSpecOf(spec);
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
    const planned = planMatrix(loaded.suite, planSpec, deps.catalog, agentTarget);
    const offset = matrix.cases.length;
    matrix.cases.push(...planned.cases);
    matrix.cells.push(...planned.cells.map((cell) => ({ ...cell, caseIndex: cell.caseIndex + offset })));
    caseSources.push(...planned.cases.map(() => sourceIndex));
  }
  const compared = stamped.find((entry) => entry.compared);
  return {
    evalRun,
    agent,
    loaded: stamped.map((entry, index) => attachedPluginOf(plugins[index]!, entry.pluginDigest)),
    comparedPluginId: compared?.pluginId,
    ownServers:
      agentSpec === undefined
        ? []
        : (await writtenServerNames(deps.store, agentSpec, agent?.org ?? "")).map((name) => ({ slug: name, key: name })),
    sources,
    caseSources,
    matrix,
    twoArms: isComparing(spec) && spec.ablation !== EvalRunAblation.none,
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
  const index = context.caseSources[caseIndex];
  return index === undefined ? undefined : context.sources[index];
}

/**
 * Whether a case's indicators leave its score (domain/eval-run/scoring.ts):
 * only when the case runs in two arms and its own plugin is the compared
 * one, which its without arm leaves out. A case of another plugin the
 * tries load keeps its plugin, skills and mocks in both arms, so every
 * check of it scores in both.
 */
export function indicatorsLeaveScore(context: EvalContext, caseIndex: number): boolean {
  const own = sourceOf(context, caseIndex)?.plugin.metadata?.id;
  return context.twoArms && own !== undefined && own === context.comparedPluginId;
}

/** The eval run's spec; undefined when the stored row carries none. */
export function specOf(context: EvalContext): EvalSpecKnobs | undefined {
  return context.evalRun.spec;
}

/** The organization the eval run runs in. */
export function orgOf(context: EvalContext): string {
  return context.evalRun.metadata?.org ?? "";
}

/** What a try lists and leaves out in its arm (domain/eval-run/arm.ts). */
export function attachmentOf(context: EvalContext, arm: EvalArm): ArmAttachment {
  return tryAttachment(
    {
      agent: context.agent,
      plugins: context.loaded.map((plugin) => plugin.facts),
      comparedPluginId: context.comparedPluginId,
    },
    arm,
  );
}

/**
 * The MCP servers a try runs beside the case's own plugin's, which the try
 * turns off unless the eval run runs real servers (domain/eval-run/
 * try-run.ts tryToolsOf): every other plugin's a try lists, which the case
 * cannot mock, and the servers the agent and its subagents write
 * themselves.
 */
export function otherServersOf(context: EvalContext, caseIndex: number): PluginServer[] {
  const own = context.sources[context.caseSources[caseIndex] ?? -1]?.pluginIndex;
  return [
    ...context.ownServers,
    ...context.loaded.flatMap((plugin, index) => (index === own ? [] : [...plugin.servers])),
  ];
}

/** A listed plugin's facts and servers as a try names them. */
export function attachedPluginOf(plugin: Plugin, digest: string): AttachedPlugin {
  return { facts: pluginAttachmentFacts(plugin, digest), servers: pluginServersOf(plugin) };
}

/** The name the format's `<plugin>` reads as: the manifest's, else the slug. */
export function pluginNameOf(plugin: Plugin): string {
  const name = plugin.spec?.name ?? "";
  return name !== "" ? name : (plugin.metadata?.slug ?? "");
}

/** The workspace paths a case's graders read the content of; a try's run returns them too. */
export { wantedFilesOf } from "../../domain/eval-run/graders/verdict.js";

export async function loadRun(store: Store, runId: string): Promise<Run | undefined> {
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
