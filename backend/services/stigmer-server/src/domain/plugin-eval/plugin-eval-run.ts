/**
 * Whether a run belongs to a plugin eval: a try, or a vote of one of its
 * AI-graded checks, both of which carry the reserved PLUGIN_EVAL_LABEL the
 * eval's workflow stamps (the guard refuses it from clients). The run
 * compose steps load nothing personal for such a run, as Claude Code's
 * evals load nothing, so a score never depends on who started the eval or
 * on what the organization's memory holds; the grading observer leaves it
 * to the eval, which grades its own tries.
 *
 * Proven beside the judge's skips in domain/run/__tests__/create-steps.test.ts
 * and domain/score/__tests__/grading-observer.test.ts.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import { PLUGIN_EVAL_LABEL } from "./constants.js";

export function isPluginEvalRun(run: Pick<Run, "metadata"> | undefined): boolean {
  return (run?.metadata?.labels[PLUGIN_EVAL_LABEL] ?? "") !== "";
}
