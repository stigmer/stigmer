"use client";

import { memo } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { MessageSquare, TriangleAlert, User } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ConversationControl,
  type ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { channelProviderOf } from "../channel/providers.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { conversationLabelOf } from "./conversationPresentation.js";

/** The (channel, key) pair identifying one conversation. */
export interface ConversationIdentity {
  readonly agentChannelId: string;
  readonly conversationKey: string;
}

/** Props for {@link ConversationListPane}. */
export interface ConversationListPaneProps {
  /** Conversations, newest activity first (from `useConversationList`). */
  readonly conversations: readonly ChannelConversation[];
  /** `true` only during the first load. */
  readonly isLoading: boolean;
  /** Error from the list read, or `null`. */
  readonly error: Error | null;
  /** `true` while more conversations exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page. */
  readonly loadMore: () => void;
  /** `true` while the next page is in flight. */
  readonly isLoadingMore: boolean;
  /**
   * The org's channels the caller can view (from
   * `useOrgAgentChannelList`) — the channel filter's options, each
   * row's provider identity, and the honest empty-state distinction
   * (no channel access vs no conversations yet).
   */
  readonly channels: readonly AgentChannel[];
  /** Current channel filter; empty string means all channels. */
  readonly channelFilter: string;
  /** Called when the user picks a channel filter. */
  readonly onChannelFilterChange: (agentChannelId: string) => void;
  /** The open conversation, for row highlighting. `null` when none. */
  readonly selected: ConversationIdentity | null;
  /** Called when the user opens a conversation. */
  readonly onSelect: (conversation: ChannelConversation) => void;
  /** Frozen instant for deterministic hosts (tests, documentation tours). */
  readonly now?: Date;
  /** Additional classes for the pane container. */
  readonly className?: string;
}

/**
 * The conversation inbox pane (channel-conversations T04): every
 * conversation across the org's channels, newest activity first, with
 * control and attention badges.
 *
 * Presentational — pair with `useConversationList` and
 * `useOrgAgentChannelList`, or compose via `ConversationsWorkbench`.
 * No filter tabs for attention on purpose: the list API has no
 * server-side attention filter, and a client-side one would silently
 * lie across pages. Flagged conversations surface through the badge
 * and the activity sort (escalation advances the activity clock by
 * design).
 */
export function ConversationListPane({
  conversations,
  isLoading,
  error,
  hasMore,
  loadMore,
  isLoadingMore,
  channels,
  channelFilter,
  onChannelFilterChange,
  selected,
  onSelect,
  now,
  className,
}: ConversationListPaneProps) {
  const providerById = new Map(
    channels.map((channel) => [
      channel.metadata?.id ?? "",
      channelProviderOf(channel.spec?.providerConfig?.case),
    ]),
  );

  return (
    <div
      aria-label="Conversation list"
      className={cn("flex min-h-0 flex-col", className)}
    >
      {channels.length > 1 && (
        <div className="border-b border-border px-3 py-2">
          <label className="sr-only" htmlFor="stgm-conversation-channel-filter">
            Filter by channel
          </label>
          <select
            id="stgm-conversation-channel-filter"
            value={channelFilter}
            onChange={(e) => onChannelFilterChange(e.target.value)}
            className={cn(
              "w-full rounded-md border border-border bg-background px-2 py-1.5",
              "text-sm text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <option value="">All channels</option>
            {channels.map((channel) => (
              <option key={channel.metadata?.id} value={channel.metadata?.id}>
                {channel.metadata?.name || channel.metadata?.slug}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <ListSkeleton />
        ) : error ? (
          <p className="px-2 py-6 text-center text-sm text-destructive">
            {getUserMessage(error)}
          </p>
        ) : conversations.length === 0 ? (
          channels.length === 0 ? (
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="size-8" />}
              title="No channels to watch"
              description="Conversations arrive through an agent's channels. Connect a channel — or ask a channel owner for access — and customer conversations appear here."
            />
          ) : (
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="size-8" />}
              title="No conversations yet"
              description="When a customer messages one of your channels, their conversation appears here."
            />
          )
        ) : (
          <>
            <ul className="space-y-0.5">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={`${conversation.agentChannelId}:${conversation.conversationKey}`}
                  conversation={conversation}
                  label={conversationLabelOf(
                    conversation,
                    providerById.get(conversation.agentChannelId)?.id ?? null,
                  )}
                  isSelected={
                    selected?.agentChannelId === conversation.agentChannelId &&
                    selected?.conversationKey === conversation.conversationKey
                  }
                  onSelect={onSelect}
                  now={now}
                />
              ))}
            </ul>
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading…" : "Show more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  label,
  isSelected,
  onSelect,
  now,
}: {
  readonly conversation: ChannelConversation;
  readonly label: string;
  readonly isSelected: boolean;
  readonly onSelect: (conversation: ChannelConversation) => void;
  readonly now?: Date;
}) {
  const humanHeld = conversation.control === ConversationControl.control_human;
  const lastActivity = conversation.lastActivityAt
    ? timestampDate(conversation.lastActivityAt)
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(conversation)}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected ? "bg-primary-subtle" : "hover:bg-accent",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground" title={label}>
              {label}
            </p>
            {conversation.needsAttention && (
              <span
                className="shrink-0"
                title={conversation.attentionReason || "Needs attention"}
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="size-3.5 text-destructive"
                />
                <span className="sr-only">
                  {conversation.attentionReason
                    ? `Needs attention: ${conversation.attentionReason}`
                    : "Needs attention"}
                </span>
              </span>
            )}
          </div>
          {humanHeld && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <User aria-hidden="true" className="size-3" />
              Human has the conversation
            </p>
          )}
        </div>
        {lastActivity && (
          <span className="shrink-0 text-xs text-muted-foreground-faint">
            {formatRelativeTime(lastActivity, now)}
          </span>
        )}
      </button>
    </li>
  );
});

function ListSkeleton() {
  return (
    <div className="space-y-1 p-1" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-md bg-muted-faint" />
      ))}
    </div>
  );
}
