/**
 * The score list index (store/list-index.ts): `run` is the key the run's
 * list, the one-per-person rule and the run-delete cascade read; `session`
 * is the key the conversation's list reads, so a session view asks once
 * for every score of every run in it. `agent` is the scored run's agent
 * (status.agent_id, which the create chain stamps from the run), the key
 * an agent's quality report and flagged list read; `eval_run` marks a
 * score on an eval run's try (the reserved label the create chain copies
 * from the run), which those reads leave out, as both conversation lists
 * leave out the tries' sessions. Revision 3 renamed the key from
 * `plugin_eval` with its label (store/eval-kinds-retired.ts). The organization and
 * the creation order are every declaration's.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, label } from "../../store/list-index.js";
import { EVAL_RUN_LABEL } from "../eval-run/constants.js";

export const scoreListIndex = declareListIndex({
  kind: ApiResourceKind.score,
  schema: ScoreSchema,
  revision: 3,
  keys: {
    run: field("spec.run_id"),
    session: field("spec.session_id"),
    agent: field("status.agent_id"),
    eval_run: label(EVAL_RUN_LABEL),
  },
});
