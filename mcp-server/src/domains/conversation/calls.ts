// Conversation RPC invocations for the escalate_to_human tool — a 1:1
// projection of ChannelConversationCommandController.escalate
// (channel-conversations DD-008: the tool layer adds no semantics; the
// reach, the idempotent writer, and the attention projection all live
// in the cloud handler, and the OSS edition refuses with the documented
// FAILED_PRECONDITION).
//
// The channels-domain calls.ts shape, with one deliberate divergence:
// the RPC's ChannelConversation response is DISCARDED instead of
// marshaled back as proto JSON. A15 rules the tool's answer is fixed
// behavioral copy (tools.ts owns it) — the row's control state,
// timestamps, and conversation key give the model nothing actionable,
// and reflecting them would only invite the model to narrate internal
// state to the customer.

import { create } from "@bufbuild/protobuf";
import {
  ChannelConversationCommandController,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_command_pb";
import {
  EscalateConversationInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { withClient } from "../client.js";

/**
 * Flag the calling session's conversation for human attention. The input
 * carries only the reason: the conversation identity derives server-side
 * from the session-scoped credential's channel labels (the DD-003
 * identity doctrine), so there is nothing else a caller could
 * legitimately send.
 */
export async function escalateConversation(
  serverAddress: string,
  token: string,
  reason: string,
): Promise<void> {
  const request = create(EscalateConversationInputSchema, { reason });
  await withClient(ChannelConversationCommandController, serverAddress, token,
    (client, opts) => client.escalate(request, opts),
  );
}
