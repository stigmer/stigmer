/**
 * The schedule list index (store/list-index.ts): `agent` is the key
 * listByAgent reads, the id the agent target's agent_ref holds, so a
 * schedule of an agent since deleted never lists under a new agent of the
 * same name. A schedule with another target holds no value for it. The
 * organization and the creation order are every declaration's: list
 * answers one organization's schedules newest first.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const routineListIndex = declareListIndex({
  kind: ApiResourceKind.routine,
  schema: RoutineSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent.agent_ref.id"),
  },
});
