/**
 * Whether a run belongs to an eval: a try, or a vote of one of its
 * AI-graded checks, both of which carry the reserved PLUGIN_EVAL_LABEL the
 * eval's workflow stamps (the guard refuses it from clients). The run
 * compose steps load nothing personal for such a run, as Claude Code's
 * evals load nothing, so a score never depends on who started the eval or
 * on what the organization's memory holds; the grading observer leaves it
 * to the eval, which grades its own tries.
 *
 * The label's value is the id of the eval that ran the case: a plugin
 * eval's (`pev_…`) or an agent eval's (`aev_…`), since every agent eval try
 * also runs a plugin's eval case. A reader that needs the eval itself asks
 * evalOfRun, which reads the kind off the id's prefix
 * (pipeline/apiresource-meta.ts kindByIdPrefix); a value naming neither
 * kind names no eval.
 *
 * Proven beside the judge's skips in domain/run/__tests__/create-steps.test.ts
 * and domain/score/__tests__/grading-observer.test.ts, and by
 * __tests__/plugin-eval-run.test.ts.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { kindByIdPrefix } from "../../pipeline/apiresource-meta.js";
import { PLUGIN_EVAL_LABEL } from "./constants.js";

export function isPluginEvalRun(run: Pick<Run, "metadata"> | undefined): boolean {
  return (run?.metadata?.labels[PLUGIN_EVAL_LABEL] ?? "") !== "";
}

/** The two kinds of eval whose tries carry the label. */
export type EvalKind = "plugin" | "agent";

/** The kind of eval an id names, by its prefix; undefined when it names neither. */
export function evalKindOf(evalId: string): EvalKind | undefined {
  switch (kindByIdPrefix(evalId)) {
    case ApiResourceKind.plugin_eval:
      return "plugin";
    case ApiResourceKind.agent_eval:
      return "agent";
    default:
      return undefined;
  }
}

/** The eval a run belongs to, by its label; undefined for a run of no eval. */
export function evalOfRun(
  run: Pick<Run, "metadata"> | undefined,
): { readonly kind: EvalKind; readonly id: string } | undefined {
  const id = run?.metadata?.labels[PLUGIN_EVAL_LABEL] ?? "";
  const kind = evalKindOf(id);
  return kind === undefined ? undefined : { kind, id };
}
