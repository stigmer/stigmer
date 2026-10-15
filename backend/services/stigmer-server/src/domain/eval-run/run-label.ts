/**
 * Whether a run belongs to an eval run: a try, or a vote of one of its
 * AI-graded checks, both of which carry the reserved EVAL_RUN_LABEL the
 * eval run's workflow stamps (the guard refuses it from clients). The run
 * compose steps load nothing personal for such a run, as Claude Code's
 * evals load nothing, so a score never depends on who started the eval run
 * or on what the organization's memory holds; the grading observer leaves
 * it to the eval run, which grades its own tries.
 *
 * The label's value is the id of the eval run that ran the case
 * (`evr_…`). A reader that needs the eval run itself asks evalRunOfRun,
 * which reads the kind off the id's prefix (pipeline/apiresource-meta.ts
 * kindByIdPrefix); a value naming another kind names no eval run.
 *
 * Proven beside the judge's skips in domain/run/__tests__/create-steps.test.ts
 * and domain/score/__tests__/grading-observer.test.ts, and by
 * __tests__/run-label.test.ts.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { kindByIdPrefix } from "../../pipeline/apiresource-meta.js";
import { EVAL_RUN_LABEL } from "./constants.js";

/** Whether a run carries the label, whatever its value. */
export function isEvalRun(run: Pick<Run, "metadata"> | undefined): boolean {
  return (run?.metadata?.labels[EVAL_RUN_LABEL] ?? "") !== "";
}

/** The id of the eval run a run belongs to, by its label; undefined for a run of none. */
export function evalRunOfRun(run: Pick<Run, "metadata"> | undefined): string | undefined {
  const id = run?.metadata?.labels[EVAL_RUN_LABEL] ?? "";
  return kindByIdPrefix(id) === ApiResourceKind.eval_run ? id : undefined;
}
