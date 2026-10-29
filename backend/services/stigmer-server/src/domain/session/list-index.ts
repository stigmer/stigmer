/**
 * The session list index (store/list-index.ts): `agent` is the key
 * `listByAgent` reads (the pinned agent, status.agent_id, which the server
 * writes; whichever version the conversation runs), `channel` the one
 * `listByChannel` reads
 * (the channel's id is stamped as a label by the channel lanes, not held
 * in the spec). `eval_run` marks an eval run's tries (the reserved label
 * the eval run's workflow stamps, domain/eval-run/constants.ts):
 * `session.list` leaves them out, so the conversation list never fills
 * with an eval run's hundreds of tries, and an eval run's delete finds
 * them through it. Revision 4 renamed the key from `plugin_eval` when the
 * label became `stigmer.ai/eval-run`; the store derives every session's
 * keys again once, at open. A session belongs to one organization, which is every
 * declaration's first fact, so `session.list` narrows by it when the
 * request names one.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, label } from "../../store/list-index.js";
import { EVAL_RUN_LABEL } from "../eval-run/constants.js";

/** The label the channel lanes stamp on every session they open. */
export const SESSION_CHANNEL_ID_LABEL = "stigmer.ai/channel-id";

export const sessionListIndex = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 4,
  keys: {
    agent: field("status.agent_id"),
    channel: label(SESSION_CHANNEL_ID_LABEL),
    eval_run: label(EVAL_RUN_LABEL),
  },
});
