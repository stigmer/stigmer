import { ChannelConversationListFilter } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_query_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import {
  ALL_CONVERSATIONS,
  WANTS_HUMAN_CONVERSATIONS,
  conversationByKey,
  supportLineChannel,
  timelineByKey,
} from "../fixtures";

function conversationsFor(filter: ChannelConversationListFilter) {
  return filter === ChannelConversationListFilter.filter_wants_human
    ? WANTS_HUMAN_CONVERSATIONS
    : ALL_CONVERSATIONS;
}

/**
 * The five read RPCs the workbench's hooks call, over the fixture cast.
 * Every handler is a pure function of its input — `getConversation` and
 * `listTimeline` key on the conversation, `list` and `countConversations`
 * honor the server-evaluated Needs-human predicate — so each beat's
 * selection fetches the state it depicts. Command RPCs (takeOver, reply, …)
 * stay unregistered on purpose: the tour depicts states, never drives
 * them, and the workbench subtree is inert.
 */
export const PreviewProviders = createStigmerPreview((router) => {
  router.service(AgentChannelQueryController, {
    list: () => ({ entries: [supportLineChannel()], nextPageToken: "" }),
  });
  router.service(ChannelConversationQueryController, {
    list: (input) => ({ entries: [...conversationsFor(input.filter)], nextPageToken: "" }),
    countConversations: (input) => ({ count: conversationsFor(input.filter).length }),
    getConversation: (input) => conversationByKey(input.conversationKey),
    listTimeline: (input) => ({
      entries: timelineByKey(input.conversationKey),
      nextPageToken: "",
    }),
  });
});
