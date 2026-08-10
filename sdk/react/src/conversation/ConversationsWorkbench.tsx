"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListFilter,
  type ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
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
  conversationContactOf,
  conversationLabelOf,
  outboundItemIdOf,
  serviceWindowOf,
} from "./conversationPresentation.js";
import { useConversation } from "./useConversation.js";
import { useConversationList } from "./useConversationList.js";
import { useConversationParticipation } from "./useConversationParticipation.js";
import { useConversationTimeline } from "./useConversationTimeline.js";

/**
 * Context handed to a function-form
 * {@link ConversationsWorkbenchProps.headerAccessory}.
 */
export interface ConversationHeaderContext {
  /**
   * The open conversation's channel, once the org's channel list
   * answers — `null` while it loads. Carries the channel's name (for
   * scope-explicit accessories like the "Channel access" trigger) and
   * `spec.agent_ref` (for navigation), so hosts never re-fetch what the
   * workbench already holds.
   */
  readonly channel: AgentChannel | null;
}

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
   * page-level actions — e.g. the channel access panel trigger). The
   * function form receives {@link ConversationHeaderContext} so the
   * accessory can name the channel it acts on.
   */
  readonly headerAccessory?:
    | React.ReactNode
    | ((context: ConversationHeaderContext) => React.ReactNode);
  /**
   * Maps the open conversation's channel to the host's channel surface
   * — the owning agent's Channels tab (channels have no standalone
   * page). When provided, the header's channel name renders as a link;
   * `null` for a specific channel keeps it plain text. The SDK never
   * assumes a routing scheme (DD-004).
   */
  readonly channelHref?: (channel: AgentChannel) => string | null;
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
  channelHref,
  now,
  className,
}: ConversationsWorkbenchProps) {
  const [channelFilter, setChannelFilter] = useState("");
  const [listFilter, setListFilter] = useState(
    ChannelConversationListFilter.channel_conversation_list_filter_unspecified,
  );

  const { channels } = useOrgAgentChannelList(org || null);
  const list = useConversationList({
    org: org || null,
    agentChannelId: channelFilter,
    filter: listFilter,
  });

  const detail = useConversation(
    selected?.agentChannelId ?? "",
    selected?.conversationKey ?? "",
  );
  const timeline = useConversationTimeline(
    selected?.agentChannelId ?? "",
    selected?.conversationKey ?? "",
  );
  // DD-012 D-a: a command answer is fresher than any in-flight poll on
  // BOTH surfaces rendering this conversation — fan it out to the detail
  // seam (banners, composer state) and the list seam (the inbox row), so
  // your own takeover never lags the inbox (F-06).
  const detailApply = detail.applyServerState;
  const listApply = list.applyServerState;
  const adoptConversation = useCallback(
    (fresh: ChannelConversation) => {
      detailApply(fresh);
      listApply(fresh);
    },
    [detailApply, listApply],
  );
  const participation = useConversationParticipation({
    agentChannelId: selected?.agentChannelId ?? "",
    conversationKey: selected?.conversationKey ?? "",
    onConversation: adoptConversation,
  });

  const selectedChannel = useMemo(
    () =>
      selected
        ? channels.find((c) => c.metadata?.id === selected.agentChannelId) ?? null
        : null,
    [channels, selected],
  );
  const descriptor = channelProviderOf(selectedChannel?.spec?.providerConfig?.case);

  // DD-007 D-e: the handback guard arms on the row's server-derived
  // awaiting_reply fact — bounce-aware since T08 (a staff reply the
  // provider later failed does NOT count as an answer), and platform
  // acknowledgments never stamp it. Never re-derive this from timeline
  // authorship: that derivation read a bounced staff reply as "answered"
  // and went silent in exactly the scenario the guard exists for (F-28)
  // — the client-side twin of the re-derivation DD-011 A-1 removed
  // server-side. No loading gap: the Hand back button renders from this
  // same row, so the guard and the control it protects appear together.
  const unansweredCustomer = detail.conversation?.awaitingReply ?? false;

  const composerDisabledReason =
    descriptor && !descriptor.supportsStaffReplies
      ? `Staff replies aren't available on ${descriptor.label} channels yet — the agent keeps serving this conversation.`
      : detail.awaitingCustomer
        ? "The customer hasn't written yet — staff replies unlock with their first message."
        : null;

  // DD-014 D-b/D-e: the closed-window forecast, computed fresh on EVERY
  // render — deliberately NOT memoized on [detail.conversation]: the
  // row's reference is intentionally stable across identical polls
  // (DD-010) while the window is wall-clock-anchored, so a memo keyed on
  // the row would freeze this warning forever on a quiet conversation.
  // The 5s detail poll's re-render is the refresh cadence; the workbench
  // test "the 5s detail poll alone carries the advisory over the
  // boundary" is the guard. The advisory names the rule (DD-014 D-c's
  // one home for it); the failed tick relays the provider's verdict.
  const serviceWindow = detail.conversation
    ? serviceWindowOf(detail.conversation, descriptor?.id ?? null, now ?? new Date())
    : null;
  const composerAdvisory =
    serviceWindow === "closed" && descriptor
      ? `${descriptor.label} closes free-form replies 24 hours after the customer's last message — a reply sent now will probably fail. The window reopens when the customer writes again.`
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
  const channelName = selectedChannel
    ? selectedChannel.metadata?.name || selectedChannel.metadata?.slug
    : null;
  const selectedChannelHref =
    selectedChannel && channelHref ? channelHref(selectedChannel) : null;
  const headerAccessoryNode =
    typeof headerAccessory === "function"
      ? headerAccessory({ channel: selectedChannel })
      : headerAccessory;

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
        filter={listFilter}
        onFilterChange={setListFilter}
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
              {(detailContact !== null || channelName) && (
                <p className="truncate text-xs text-muted-foreground">
                  {detailContact}
                  {detailContact !== null && channelName && " · "}
                  {channelName &&
                    // The path from a conversation to its channel (F-11):
                    // the channel name links to the host's channel surface
                    // when a route exists.
                    (selectedChannelHref ? (
                      <a
                        href={selectedChannelHref}
                        className="hover:text-foreground hover:underline"
                      >
                        {channelName}
                      </a>
                    ) : (
                      channelName
                    ))}
                </p>
              )}
            </div>
            {headerAccessoryNode}
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
            agentChannelId={selected.agentChannelId}
            conversationKey={selected.conversationKey}
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
            advisory={composerAdvisory}
          />
        </div>
      )}
    </div>
  );
}
