/**
 * The agent-execution list index (store/list-index.ts): the kind whose
 * rows are the fattest in the store (every message and tool call of a run
 * rides the row), so a lane that decodes the whole kind to keep one
 * session's runs pays for every run on the platform. `session` is the key
 * `listBySession` reads; `grades` is the judge label's value, which the
 * grading workflow's start reads to find the judge run an earlier attempt
 * created (temporal/grading/judge-activities.ts); `plugin_eval` is the
 * reserved plugin eval label's value (domain/plugin-eval/constants.ts),
 * which a try's start and the spend read take to find the try's run by
 * the eval and its run name (temporal/evals/case-activities.ts); the
 * organization and the creation order are every declaration's. Revision 2
 * added `grades` and revision 3 `plugin_eval`: the store derives a new key
 * for every existing run once, at open.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, label } from "../../store/list-index.js";
import { PLUGIN_EVAL_LABEL } from "../plugin-eval/constants.js";
import { GRADES_RUN_LABEL } from "../score/judge/judge-run.js";

export const agentExecutionListIndex = declareListIndex({
  kind: ApiResourceKind.run,
  schema: RunSchema,
  revision: 3,
  keys: {
    session: field("spec.session_id"),
    grades: label(GRADES_RUN_LABEL),
    plugin_eval: label(PLUGIN_EVAL_LABEL),
  },
});
