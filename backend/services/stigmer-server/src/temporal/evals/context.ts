/**
 * What every eval activity reads first: the eval, its plugin, the suite at
 * the eval's stamped digest, and the planned matrix. The matrix is
 * re-planned from the same suite and spec on each read, which is the
 * planner's promise (domain/plugin-eval/matrix.ts: pure, so a retried
 * activity and the load agree on every index). The suite is read from the
 * archive once per worker and digest and kept for the next activities of
 * the same eval (a small cache, by digest, since a digest's bytes never
 * change).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { EvalCase, EvalGrader, EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalMatrix, EvalModelCatalog, PlannedTarget } from "../../domain/plugin-eval/matrix.js";
import { planMatrix } from "../../domain/plugin-eval/matrix.js";
import type { EvalSuiteSource } from "../../domain/plugin-eval/suite.js";
import { loadEvalSuite } from "../../domain/plugin-eval/suite.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/** Suites a worker keeps, by archive digest. */
const SUITE_CACHE_SIZE = 8;

export interface EvalContext {
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

export interface EvalContextDeps {
  readonly store: Store;
  readonly suites: EvalSuiteSource;
  readonly catalog: EvalModelCatalog;
}

export type EvalContextLoader = (evalId: string) => Promise<EvalContext | undefined>;

/**
 * The loader: undefined when the eval or its plugin is gone. A suite that
 * cannot be read throws, and the caller decides what that means.
 */
export function newEvalContextLoader(deps: EvalContextDeps): EvalContextLoader {
  const cache = new Map<string, { readonly files: PluginFiles; readonly suite: EvalSuite }>();
  return async (evalId) => {
    const pluginEval = await loadOrUndefined(deps.store, ApiResourceKind.plugin_eval, evalId, PluginEvalSchema);
    const spec = pluginEval?.spec;
    if (pluginEval === undefined || spec === undefined) {
      return undefined;
    }
    const plugin = await loadOrUndefined(deps.store, ApiResourceKind.plugin, spec.pluginId, PluginSchema);
    if (plugin === undefined) {
      return undefined;
    }
    const digest = spec.pluginDigest !== "" ? spec.pluginDigest : (plugin.status?.digest ?? "");
    let loaded = cache.get(digest);
    if (loaded === undefined) {
      loaded = await loadEvalSuite(deps.suites, spec.pluginId, digest);
      cache.set(digest, loaded);
      while (cache.size > SUITE_CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        cache.delete(oldest);
      }
    }
    return {
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

/** The name the format's `<plugin>` reads as: the manifest's, else the slug. */
export function pluginNameOf(plugin: Plugin): string {
  const name = plugin.spec?.name ?? "";
  return name !== "" ? name : (plugin.metadata?.slug ?? "");
}

/** The workspace paths a case's graders read the content of. */
export function wantedFilesOf(graders: ReadonlyArray<EvalGrader>): string[] {
  const paths: string[] = [];
  for (const grader of graders) {
    const check = grader.check;
    const focus = check.type === "regex" ? check.target : check.type === "llm" ? check.focus : undefined;
    if (focus?.kind === "file" && !paths.includes(focus.path)) {
      paths.push(focus.path);
    }
  }
  return paths;
}

export async function loadRun(store: Store, runId: string): Promise<Run | undefined> {
  return loadOrUndefined(store, ApiResourceKind.run, runId, RunSchema);
}

async function loadOrUndefined<Desc extends DescMessage>(
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
