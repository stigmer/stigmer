/**
 * ChannelConversation controllers — ports pkg/domain/agentchannel/
 * controller/conversation.go: the conversation surface beside the channel
 * messaging controllers, on the same runtime side of the resource/runtime
 * split. Stateless on the storing edition — no store.
 *
 * The whole surface is posture-split at REGISTRATION (channel-runtime.ts,
 * C3 ruling Q1): with no ChannelRuntime composed the storing bodies below
 * serve byte-identically to before the seam existed; with one composed,
 * EVERY method delegates — on the serving edition even the discovery
 * reads are real store-backed lookups (truthful emptiness is an OUTCOME
 * there, not a stub), and the uniform-miss reads must cover every cause
 * identically, which only the runtime can do.
 *
 * Storing posture — queries answer EMPTY and commands refuse
 * FailedPrecondition, the two established postures side by side
 * (channel-conversations DD-003 D-f): a conversation list is a
 * discovery-shaped read whose truthful storing answer is "none"
 * (conversations are created by the serving channel runtime, which does
 * not run here), while every command asks to DO a cloud-only thing. The
 * single-row reads cannot answer "empty" — getConversation answers
 * NotFound unconditionally, and getMediaDownloadUrl answers the
 * byte-pinned uniform miss (raw copy — the "%s not found: %s" helper
 * shape cannot say it). As in message.ts, there is deliberately NO
 * load-then-NOT_FOUND: probing local stores for conversations this
 * posture never materializes would create an edition divergence, not
 * prevent one.
 *
 * Input validation is Layer-1: the transport interceptor chain validates
 * every request (matching Go's explicit SharedValidator calls), so the
 * INVALID_ARGUMENT contract holds before every refusal AND before every
 * delegation.
 *
 * Proven by agentchannel.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/agentchannel.test.ts.
 */
import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_query_pb";
import {
  ChannelConversationListSchema,
  ConversationTimelineSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import type {
  ChannelConversationList,
  ConversationTimeline,
  GetChannelConversationInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";

import {
  failedPreconditionError,
  notFoundError,
} from "../../pipeline/errors.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import {
  CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
  NO_DOWNLOADABLE_MEDIA_MESSAGE,
} from "./constants.js";

/**
 * Registers both channel-conversation services on the router, in the
 * posture the composition declares: storing bodies with no runtime,
 * whole-method delegation with one.
 */
export function registerChannelConversationServices(
  router: ConnectRouter,
  channelRuntime: ChannelRuntime | undefined,
): void {
  if (channelRuntime === undefined) {
    router.service(ChannelConversationQueryController, {
      // Discovery-shaped reads answer truthful emptiness.
      listConversations: (): ChannelConversationList =>
        create(ChannelConversationListSchema),
      getTimeline: (): ConversationTimeline =>
        create(ConversationTimelineSchema),
      // Single-row reads answer the uniform miss, with no local probing.
      getConversation: (input: GetChannelConversationInput) => {
        throw notFoundError("channel conversation", input.conversationKey);
      },
      getMediaDownloadUrl: () => {
        // Byte-identical with the serving handler's uniform miss (which
        // covers every cause the same way so a prober cannot learn which
        // items exist) — a raw ConnectError because notFoundError's
        // "%s not found: %s" shape cannot express this copy.
        throw new ConnectError(NO_DOWNLOADABLE_MEDIA_MESSAGE, Code.NotFound);
      },
    });
    router.service(ChannelConversationCommandController, {
      // Every command asks to DO a cloud-only thing: staff replies ride the
      // outbound delivery lane; take-over/hand-back/attention are the
      // participation state machine; escalation is ingest — all cloud-only.
      reply: () => {
        throw failedPreconditionError(
          CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
        );
      },
      takeOver: () => {
        throw failedPreconditionError(
          CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
        );
      },
      handBack: () => {
        throw failedPreconditionError(
          CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
        );
      },
      clearAttention: () => {
        throw failedPreconditionError(
          CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
        );
      },
      escalate: () => {
        throw failedPreconditionError(
          CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
        );
      },
    });
    return;
  }

  const { conversations } = channelRuntime;
  router.service(ChannelConversationQueryController, {
    listConversations: (input, ctx) =>
      conversations.listConversations(input, callerIdentityOf(ctx)),
    getConversation: (input, ctx) =>
      conversations.getConversation(input, callerIdentityOf(ctx)),
    getTimeline: (input, ctx) =>
      conversations.getTimeline(input, callerIdentityOf(ctx)),
    getMediaDownloadUrl: (input, ctx) =>
      conversations.getMediaDownloadUrl(input, callerIdentityOf(ctx)),
  });
  router.service(ChannelConversationCommandController, {
    reply: (input, ctx) => conversations.reply(input, callerIdentityOf(ctx)),
    takeOver: (input, ctx) =>
      conversations.takeOver(input, callerIdentityOf(ctx)),
    handBack: (input, ctx) =>
      conversations.handBack(input, callerIdentityOf(ctx)),
    clearAttention: (input, ctx) =>
      conversations.clearAttention(input, callerIdentityOf(ctx)),
    escalate: (input, ctx) =>
      conversations.escalate(input, callerIdentityOf(ctx)),
  });
}
