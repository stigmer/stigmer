"use client";

import { memo, useCallback, useRef } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { MessageSquare, TriangleAlert, User } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListFilter,
  ConversationControl,
  type ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { channelProviderOf } from "../channel/providers.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../internal/tooltip.js";
import {
  awaitingIndicatorOf,
  conversationContactOf,
  conversationLabelOf,
} from "./conversationPresentation.js";

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
  /**
   * The server-evaluated predicate filter currently applied to the list
   * (DD-011 D-g — the same predicate the nav badge counts, so the
   * filtered list always matches the number that opened it). Defaults
   * to unspecified (all conversations).
   */
  readonly filter?: ChannelConversationListFilter;
  /**
   * Called when the user picks a predicate filter. The control renders
   * only when this is wired — a dead toggle over an unfiltered list
   * would lie.
   */
  readonly onFilterChange?: (filter: ChannelConversationListFilter) => void;
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
 * control, attention, and awaiting-reply indicators.
 *
 * Presentational — pair with `useConversationList` and
 * `useOrgAgentChannelList`, or compose via `ConversationsWorkbench`.
 * The wants-human filter is SERVER-evaluated (DD-011 D-g closed the API
 * gap that T04 D1 cited): a client-side tab over one fetched page would
 * silently lie across pages, so the pane only reports the choice and the
 * list hook sends it to the server.
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
  filter = ChannelConversationListFilter.channel_conversation_list_filter_unspecified,
  onFilterChange,
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
      className={cn("stg:flex stg:min-h-0 stg:flex-col", className)}
    >
      {(onFilterChange !== undefined || channels.length > 1) && (
        <div className="stg:flex stg:flex-col stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2">
          {onFilterChange !== undefined && (
            <ConversationFilterToggle value={filter} onChange={onFilterChange} />
          )}
          {channels.length > 1 && (
            <>
              <label className="stg:sr-only" htmlFor="stgm-conversation-channel-filter">
                Filter by channel
              </label>
              <select
                id="stgm-conversation-channel-filter"
                value={channelFilter}
                onChange={(e) => onChannelFilterChange(e.target.value)}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-2 stg:py-1.5",
                  "stg:text-sm stg:text-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                <option value="">All channels</option>
                {channels.map((channel) => (
                  <option key={channel.metadata?.id} value={channel.metadata?.id}>
                    {channel.metadata?.name || channel.metadata?.slug}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:p-2">
        {isLoading ? (
          <ListSkeleton />
        ) : error ? (
          <p className="stg:px-2 stg:py-6 stg:text-center stg:text-sm stg:text-destructive">
            {getUserMessage(error)}
          </p>
        ) : conversations.length === 0 ? (
          channels.length === 0 ? (
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="stg:size-8" />}
              title="No channels to watch"
              description="Conversations arrive through an agent's channels. Connect a channel — or ask a channel owner for access — and customer conversations appear here."
            />
          ) : filter === ChannelConversationListFilter.filter_wants_human ? (
            // Its own empty state on purpose: under the filter, "No
            // conversations yet — when a customer messages…" would lie
            // to an org with a full inbox and nothing needing a person.
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="stg:size-8" />}
              title="Nothing needs a human right now"
              description="Conversations appear here when the agent asks for attention, or when a human-held conversation has a customer message awaiting a reply."
            />
          ) : (
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="stg:size-8" />}
              title="No conversations yet"
              description="When a customer messages one of your channels, their conversation appears here."
            />
          )
        ) : (
          <>
            {/* One context-only provider arms every row's attention
                tooltip (the WorkspaceSidebar recents-list precedent). */}
            <TooltipProvider>
              <ul className="stg:space-y-0.5">
                {conversations.map((conversation) => (
                  <ConversationRow
                    key={`${conversation.agentChannelId}:${conversation.conversationKey}`}
                    conversation={conversation}
                    label={conversationLabelOf(
                      conversation,
                      providerById.get(conversation.agentChannelId)?.id ?? null,
                    )}
                    contact={conversationContactOf(
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
            </TooltipProvider>
            {hasMore && (
              <div className="stg:flex stg:justify-center stg:py-2">
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

const FILTER_OPTIONS: readonly {
  readonly value: ChannelConversationListFilter;
  readonly label: string;
  readonly ariaLabel: string;
}[] = [
  {
    value: ChannelConversationListFilter.channel_conversation_list_filter_unspecified,
    label: "All",
    ariaLabel: "All conversations",
  },
  {
    value: ChannelConversationListFilter.filter_wants_human,
    label: "Needs human",
    ariaLabel: "Conversations where a human action is wanted",
  },
];

/**
 * Segmented control for the server-evaluated list filter. Renders as a
 * WAI-ARIA Radio Group with roving tabindex and arrow-key navigation —
 * the `ScopeToggle` pattern (its second sighting; extract a shared
 * primitive if a third segmented control appears).
 *
 * "Needs human" is exactly the nav badge's predicate (DD-011 D-f/D-g),
 * so the number on the badge and the list this control opens can never
 * disagree.
 */
function ConversationFilterToggle({
  value,
  onChange,
}: {
  readonly value: ChannelConversationListFilter;
  readonly onChange: (filter: ChannelConversationListFilter) => void;
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleSelect = useCallback(
    (next: ChannelConversationListFilter) => {
      if (next !== value) onChange(next);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % FILTER_OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + FILTER_OPTIONS.length) % FILTER_OPTIONS.length;
      }
      if (nextIndex !== null) {
        optionRefs.current[nextIndex]?.focus();
        handleSelect(FILTER_OPTIONS[nextIndex].value);
      }
    },
    [handleSelect],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Conversation filter"
      className="stg:inline-flex stg:self-start stg:rounded-md stg:bg-muted stg:p-0.5"
    >
      {FILTER_OPTIONS.map((option, index) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.ariaLabel}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => handleSelect(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "stg:inline-flex stg:cursor-pointer stg:items-center stg:rounded-sm stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              isSelected
                ? "stg:bg-background stg:text-foreground stg:shadow-sm"
                : "stg:text-muted-foreground stg:hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  label,
  contact,
  isSelected,
  onSelect,
  now,
}: {
  readonly conversation: ChannelConversation;
  readonly label: string;
  /**
   * The customer's reachable address when the label hides it
   * (`conversationContactOf`) — `null` when the label already shows it.
   */
  readonly contact: string | null;
  readonly isSelected: boolean;
  readonly onSelect: (conversation: ChannelConversation) => void;
  readonly now?: Date;
}) {
  const humanHeld = conversation.control === ConversationControl.control_human;
  const awaiting = awaitingIndicatorOf(conversation);
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
          "stg:flex stg:w-full stg:items-center stg:gap-2.5 stg:rounded-md stg:px-2.5 stg:py-2 stg:text-left",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          isSelected ? "stg:bg-primary-subtle" : "stg:hover:bg-accent",
        )}
      >
        <div className="stg:min-w-0 stg:flex-1">
          <div className="stg:flex stg:items-center stg:gap-1.5">
            {/* No truncation title on the label (F-18): the full name
                renders in the open conversation's header, so a native
                tooltip here added noise without adding reach. */}
            <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{label}</p>
            {conversation.needsAttention && (
              // The reason rides the house tooltip (F-18). The trigger
              // renders as a span — it sits INSIDE the row button, so a
              // default (button) trigger would nest buttons — and stays
              // out of the tab order; the sr-only text remains the
              // accessible name. The full reason is also always visible
              // in the open conversation's attention banner.
              <Tooltip>
                <TooltipTrigger render={<span className="stg:shrink-0" />}>
                  <TriangleAlert
                    aria-hidden="true"
                    className="stg:size-3.5 stg:text-destructive"
                  />
                  <span className="stg:sr-only">
                    {conversation.attentionReason
                      ? `Needs attention: ${conversation.attentionReason}`
                      : "Needs attention"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {conversation.attentionReason || "Needs attention"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {contact !== null && (
            <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground-faint">
              {contact}
            </p>
          )}
          {humanHeld && (
            <p className="stg:mt-0.5 stg:flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground">
              <User aria-hidden="true" className="stg:size-3" />
              Human has the conversation
            </p>
          )}
        </div>
        {(lastActivity !== null || awaiting !== null) && (
          <span className="stg:flex stg:shrink-0 stg:flex-col stg:items-end stg:gap-1">
            {lastActivity && (
              <span className="stg:text-xs stg:text-muted-foreground-faint">
                {formatRelativeTime(lastActivity, now)}
              </span>
            )}
            {awaiting && (
              // The WhatsApp inbox convention: an awaiting conversation
              // carries a dot under its timestamp. Strength maps the
              // holder (DD-011 D-a): strong when a human holds it — the
              // agent will not answer, a person must — muted when the
              // agent does. No tooltip and no tab stop (the F-18
              // discipline); the sr-only text is the accessible meaning.
              <span className="stg:flex">
                <span
                  aria-hidden="true"
                  className={cn(
                    "stg:size-2 stg:rounded-full",
                    awaiting === "strong" ? "stg:bg-primary" : "stg:bg-muted-foreground",
                  )}
                />
                <span className="stg:sr-only">
                  {awaiting === "strong"
                    ? "Customer awaiting reply — the conversation is human-held"
                    : "Customer awaiting reply"}
                </span>
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
});

function ListSkeleton() {
  return (
    <div className="stg:space-y-1 stg:p-1" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="stg:h-11 stg:animate-pulse stg:rounded-md stg:bg-muted-faint" />
      ))}
    </div>
  );
}
