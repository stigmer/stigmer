/**
 * The agent eval list index (store/list-index.ts): `agent` is the key
 * listByAgent and the agent-delete cascade read. The organization and the
 * creation order are every declaration's: listByAgent answers newest
 * first, and the organization purge reads by organization.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const agentEvalListIndex = declareListIndex({
  kind: ApiResourceKind.agent_eval,
  schema: AgentEvalSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent_id"),
  },
});
