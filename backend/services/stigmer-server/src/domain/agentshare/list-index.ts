/**
 * The agent share list index (store/list-index.ts): `agent` is the key
 * listByAgent reads, the id spec.agent_ref holds, so a share of an agent
 * since deleted never lists under a new agent of the same name. The
 * organization and the creation order are every declaration's: list
 * answers one organization's shares newest first.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const agentShareListIndex = declareListIndex({
  kind: ApiResourceKind.agent_share,
  schema: AgentShareSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent_ref.id"),
  },
});
