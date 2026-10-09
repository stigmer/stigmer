/**
 * The score list index (store/list-index.ts): `run` is the key the run's
 * list, the one-per-person rule and the run-delete cascade read; `session`
 * is the key the conversation's list reads, so a session view asks once
 * for every score of every run in it. The organization and the creation
 * order are every declaration's.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const scoreListIndex = declareListIndex({
  kind: ApiResourceKind.score,
  schema: ScoreSchema,
  revision: 1,
  keys: {
    run: field("spec.run_id"),
    session: field("spec.session_id"),
  },
});
