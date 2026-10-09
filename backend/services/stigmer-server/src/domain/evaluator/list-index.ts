/**
 * The evaluator list index (store/list-index.ts): `agent` is the key the
 * agent's lookup (getByAgent, the judge planner), the one-per-agent rule
 * and the agent-delete cascade read. The organization and the creation
 * order are every declaration's, which the organization purge reads.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const evaluatorListIndex = declareListIndex({
  kind: ApiResourceKind.evaluator,
  schema: EvaluatorSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent_id"),
  },
});
