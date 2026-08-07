"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { ChannelConversation } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelSendOutcome } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { channelProviderOf } from "../channel/providers.js";
import { useOrgAgentChannelList } from "../channel/useOrgAgentChannelList.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ConversationAttentionBanner } from "./ConversationAttentionBanner.js";
import { ConversationComposer } from "./ConversationComposer.js";
import { ConversationControlBanner } from "./ConversationControlBanner.js";
import { ConversationListPane, type ConversationIdentity } from "./ConversationListPane.js";
import { ConversationTimelineView } from "./ConversationTimelineView.js";
import {
  authorKindOf,
  conversationContactOf,
  conversationLabelOf,
  isInternalItem,
  outboundItemIdOf,
} from "./conversationPresentation.js";
import { useConversation } from "./useConversation.js";
import { useConversationList } from "./useConversationList.js";
import { useConversationParticipation } from "./useConversationParticipation.js";
import { useConversationTimeline } from "./useConversationTimeline.js";

/** Props for {@link ConversationsWorkbench}. */
export interface ConversationsWorkbenchProps {
  /** Organization whose conversations to show. */
  readonly org: string;
  /**
   * The open conversation. Controlled by the host so selection can live
   * in the URL (deep links, reloads, back button).
   */
  readonly selected: ConversationIdentity | null;
  /** Called when the user opens or leaves a conversation. */
  readonly onSelectionChange: (selection: ConversationIdentity | null) => void;
  /**
   * The signed-in staff member's identity account id, when the host
   * knows it — used only for "You have this conversation" copy.
   */
  readonly currentIdentityAccountId?: string;
  /**
   * Rendered in the open conversation's header (the host's seam for
   * page-level actions — e.g. the channel access panel trigger).
   */
  readonly headerAccessory?: React.ReactNode;
  /** Frozen instant for deterministic hosts (tests, documentation tours). */
  readonly now?: Date;
  /** Additional classes for the workbench container. */
  readonly className?: string;
}

/**
 * The Conversations console surface (channel-conversations T04), fully
 * composed: the org-wide inbox on the left; the open conversation's
 * timeline, participation banners, and staff composer on the right.
 *
 * Everything under it is independently importable — hosts that need a
 * different layout compose `ConversationListPane`,
 * `ConversationTimelineView`, the banners, and the hooks directly.
 */
export function ConversationsWorkbench({
  org,
  selected,
  onSelectionChange,
  currentIdentityAccountId,
  headerAccessory,
  now,
  className,
}: ConversationsWorkbenchProps) {
  const [channelFilter, setChannelFilter] = useState("");

  const { channels } = useOrgAgentChannelList(org || null);
  const list = useConversationList({
    org: org || null,
    agentChannelId: channelFilter,
  });

  const detail = useConversation(
    selected?.agentChannelId ?? "",
    selected?.conversationKey ?? "",
  );
  const timeline = useConversationTimeline(
    selected?.agentChannelId ?? "",
    selected?.conversationKey ?? "",
  );
  const participation = useConversationParticipation({
    agentChannelId: selected?.agentChannelId ?? "",
    conversationKey: selected?.conversationKey ?? "",
    onConversation: detail.applyServerState,
  });

  const selectedChannel = useMemo(
    () =>
      selected
        ? channels.find((c) => c.metadata?.id === selected.agentChannelId) ?? null
        : null,
    [channels, selected],
  );
  const descriptor = channelProviderOf(selectedChannel?.spec?.providerConfig?.case);

  // DD-007 D-e: the handback guard arms when the newest customer-visible
  // item is the customer's own (their message awaits an answer).
  const unansweredCustomer = useMemo(() => {
    for (let i = timeline.items.length - 1; i >= 0; i--) {
      const item = timeline.items[i];
      if (isInternalItem(item)) continue;
      return authorKindOf(item) === "customer";
    }
    return false;
  }, [timeline.items]);

  const composerDisabledReason =
    descriptor && !descriptor.supportsStaffReplies
      ? `Staff replies aren't available on ${descriptor.label} channels yet — the agent keeps serving this conversation.`
      : detail.awaitingCustomer
        ? "The customer hasn't written yet — staff replies unlock with their first message."
        : null;

  const handleSelect = useCallback(
    (conversation: ChannelConversation) =>
      onSelectionChange({
        agentChannelId: conversation.agentChannelId,
        conversationKey: conversation.conversationKey,
      }),
    [onSelectionChange],
  );

  // F-05: an accepted reply's ledger item is only visible once the next
  // timeline read answers, so the composer's busy state must span
  // click-to-visible, not end at the RPC. The settling record names the
  // item the reply output promised (`ob:<outbound_message_id>`) and the
  // selection it belongs to — carrying the selection makes stale state
  // from a previously open conversation structurally inert (the derived
  // id is null there) instead of needing a reset effect.
  const [replySettling, setReplySettling] = useState<{
    readonly selectionKey: string;
    readonly itemId: string;
  } | null>(null);
  const selectionKey = selected
    ? `${selected.agentChannelId}:${selected.conversationKey}`
    : "";
  const settlingItemId =
    replySettling !== null && replySettling.selectionKey === selectionKey
      ? replySettling.itemId
      : null;
  useEffect(() => {
    if (settlingItemId === null) return;
    if (timeline.items.some((item) => item.itemId === settlingItemId)) {
      setReplySettling(null);
    }
  }, [timeline.items, settlingItemId]);

  const handleSend = useCallback(
    async (text: string) => {
      const output = await participation.reply(text);
      // The ledger row is committed before reply answers, so one head
      // refresh renders the REAL item (with its true status) — the SDK
      // never fabricates an optimistic item that might misstate what
      // the provider did. Until that item lands, the composer stays
      // busy; even if this refetch fails, the head poll delivers the
      // item and clears the hold. A refusal never settles: it restores
      // the draft for editing, and holding the composer busy would
      // fight the correction its notice asks for.
      if (
        output.outcome !== ChannelSendOutcome.refused &&
        output.outboundMessageId !== ""
      ) {
        setReplySettling({
          selectionKey,
          itemId: outboundItemIdOf(output.outboundMessageId),
        });
      }
      timeline.refetch();
      return output;
    },
    [participation.reply, timeline.refetch, selectionKey],
  );

  const detailLabel = detail.conversation
    ? conversationLabelOf(detail.conversation, descriptor?.id ?? null)
    : selected?.conversationKey ?? "";
  // The customer's reachable address (e.g. the WhatsApp number a display
  // name hides) — the call-back path belongs beside the channel name.
  const detailContact = detail.conversation
    ? conversationContactOf(detail.conversation, descriptor?.id ?? null)
    : null;

  return (
    <div
      aria-label="Conversations workbench"
      className={cn("flex min-h-0 flex-1", className)}
    >
      <ConversationListPane
        className="w-80 shrink-0 border-r border-border"
        conversations={list.conversations}
        isLoading={list.isLoading}
        error={list.error}
        hasMore={list.hasMore}
        loadMore={list.loadMore}
        isLoadingMore={list.isLoadingMore}
        channels={channels}
        channelFilter={channelFilter}
        onChannelFilterChange={setChannelFilter}
        selected={selected}
        onSelect={handleSelect}
        now={now}
      />

      {selected === null ? (
        <div className="flex min-w-0 flex-1 items-center justify-center p-6">
          <EmptyState
            variant="first-use"
            icon={<MessagesSquare className="size-8" />}
            title="Select a conversation"
            description="Pick a conversation to read its thread, reply as your business, or take over from the agent."
          />
        </div>
      ) : (
        // Keyed by conversation identity (DD-014: `key` remounts are the
        // clean-reset pattern): every open starts a fresh detail column, so
        // auto-scroll opens following at the newest message and the
        // composer's draft and notice can never travel from one customer's
        // conversation into another's (F-22). The data hooks live above
        // this column, so the remount refetches nothing; the inbox pane
        // stays outside it so its scroll position and filter survive.
        // Channel ids never contain ":", so the joined key is unambiguous.
        <div
          key={`${selected.agentChannelId}:${selected.conversationKey}`}
          className="flex min-w-0 flex-1 flex-col"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {detailLabel}
              </h2>
              {(detailContact !== null || selectedChannel) && (
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    detailContact,
                    selectedChannel
                      ? selectedChannel.metadata?.name || selectedChannel.metadata?.slug
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            {headerAccessory}
          </div>

          {detail.conversation && (
            <ConversationAttentionBanner
              conversation={detail.conversation}
              participation={participation}
            />
          )}
          {detail.conversation && (
            <ConversationControlBanner
              conversation={detail.conversation}
              participation={participation}
              unansweredCustomer={unansweredCustomer}
              supportsStaffReplies={descriptor?.supportsStaffReplies ?? true}
              currentIdentityAccountId={currentIdentityAccountId}
            />
          )}

          <ConversationTimelineView
            items={timeline.items}
            isLoading={timeline.isLoading}
            error={timeline.error}
            hasOlder={timeline.hasOlder}
            loadOlder={timeline.loadOlder}
            isLoadingOlder={timeline.isLoadingOlder}
            provider={descriptor?.id ?? null}
            now={now}
          />

          <ConversationComposer
            onSend={handleSend}
            isSending={
              participation.pendingCommands.has("reply") || settlingItemId !== null
            }
            disabledReason={composerDisabledReason}
          />
        </div>
      )}
    </div>
  );
}
