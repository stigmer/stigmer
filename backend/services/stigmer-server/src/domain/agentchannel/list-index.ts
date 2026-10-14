/**
 * The agent channel list index (store/list-index.ts): `agent` is the key
 * listByAgent reads, the id spec.agent_ref holds, so a channel of an
 * agent since deleted never lists under a new agent of the same name. The
 * organization and the creation order are every declaration's: list
 * answers one organization's channels newest first.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const agentChannelListIndex = declareListIndex({
  kind: ApiResourceKind.agent_channel,
  schema: AgentChannelSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent_ref.id"),
  },
});
