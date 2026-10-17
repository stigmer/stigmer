/**
 * The agent list index (store/list-index.ts): list reads one organization's
 * agents newest first, so the declaration needs no key beyond the
 * organization and the creation order every declaration carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../store/list-index.js";

export const agentListIndex = declareListIndex({
  kind: ApiResourceKind.agent,
  schema: AgentSchema,
  revision: 1,
  keys: {},
});
