/**
 * The routine list index (store/list-index.ts): `agent` is the key
 * listByAgent and the agent's delete cascade read, the id the routine's
 * agent_ref holds, so a routine of an agent since deleted never lists
 * under a new agent of the same name. The organization and the creation
 * order are every declaration's: list answers one organization's routines
 * newest first.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const routineListIndex = declareListIndex({
  kind: ApiResourceKind.routine,
  schema: RoutineSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent.agent_ref.id"),
  },
});
