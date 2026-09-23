/**
 * The session list index (store/list-index.ts): `agent_instance` is the
 * key `listByAgentInstance` reads, `channel` the one `listByChannel` reads
 * (the channel's id is stamped as a label by the channel lanes, not held
 * in the spec). A session belongs to one organization, which is every
 * declaration's first fact, so `session.list` narrows by it when the
 * request names one.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, label } from "../../store/list-index.js";

/** The label the channel lanes stamp on every session they open. */
export const SESSION_CHANNEL_ID_LABEL = "stigmer.ai/channel-id";

export const sessionListIndex = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 1,
  keys: {
    agent_instance: field("spec.agent_instance_id"),
    channel: label(SESSION_CHANNEL_ID_LABEL),
  },
});
