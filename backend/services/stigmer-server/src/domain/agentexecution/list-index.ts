/**
 * The agent-execution list index (store/list-index.ts): the kind whose
 * rows are the fattest in the store (every message and tool call of a run
 * rides the row), so a lane that decodes the whole kind to keep one
 * session's runs pays for every run on the platform. `session` is the key
 * `listBySession` reads; the organization and the creation order are
 * every declaration's.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const agentExecutionListIndex = declareListIndex({
  kind: ApiResourceKind.agent_execution,
  schema: AgentExecutionSchema,
  revision: 1,
  keys: {
    session: field("spec.session_id"),
  },
});
