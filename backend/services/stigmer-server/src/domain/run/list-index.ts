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
 * the eval and its run name (temporal/evals/case-activities.ts);
 * `schedule` is the schedule label's value (domain/schedule/labels.ts),
 * which a fire reads to find the run an earlier attempt of the same fire
 * created, by the schedule and the fire's deterministic name
 * (temporal/schedule/run-starter.ts);
 * `working_session` is the session while the run is working (pending or
 * in progress), which a write that appends session events counts its
 * session's other working runs by, from the key table alone
 * (domain/session/events/run-writes.ts); `waiting_session` is the session
 * while the run waits for a person's answer, by which the same write finds
 * the session's waiting runs and their open asks; the organization and the
 * creation order are every declaration's. Revision 2 added `grades`,
 * revision 3 `plugin_eval`, revision 4 `working_session`, revision 5
 * `schedule`, and revision 6 took waiting runs out of `working_session`
 * into `waiting_session`: the store derives every existing run's keys
 * again once, at open.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, fieldWhen, label } from "../../store/list-index.js";
import { PLUGIN_EVAL_LABEL } from "../plugin-eval/constants.js";
import { SCHEDULE_ID_LABEL_KEY } from "../schedule/labels.js";
import { GRADES_RUN_LABEL } from "../score/judge/judge-run.js";
import { WAITING_PHASES, WORKING_PHASES } from "./phases.js";

export const agentExecutionListIndex = declareListIndex({
  kind: ApiResourceKind.run,
  schema: RunSchema,
  revision: 6,
  keys: {
    session: field("spec.session_id"),
    grades: label(GRADES_RUN_LABEL),
    plugin_eval: label(PLUGIN_EVAL_LABEL),
    schedule: label(SCHEDULE_ID_LABEL_KEY),
    working_session: fieldWhen("spec.session_id", "status.phase", WORKING_PHASES),
    waiting_session: fieldWhen("spec.session_id", "status.phase", WAITING_PHASES),
  },
});
