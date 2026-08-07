"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ChannelConversation } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { Button } from "../button/Button.js";
import type { UseConversationParticipationReturn } from "./useConversationParticipation.js";

/** Props for {@link ConversationAttentionBanner}. */
export interface ConversationAttentionBannerProps {
  /** The conversation's fresh participation state. */
  readonly conversation: ChannelConversation;
  /** The participation commands (from `useConversationParticipation`). */
  readonly participation: UseConversationParticipationReturn;
  /** Additional classes for the banner container. */
  readonly className?: string;
}

/**
 * The needs-attention banner (channel-conversations DD-008): the
 * escalating agent's reason, verbatim, with the false-alarm dismissal.
 *
 * Dismiss is `clearAttention` — attention clears in place and control
 * never moves (taking over also clears it, structurally, because the
 * human arriving IS the answer to an escalation). Renders nothing while
 * the conversation is unflagged.
 */
export function ConversationAttentionBanner({
  conversation,
  participation,
  className,
}: ConversationAttentionBannerProps) {
  if (!conversation.needsAttention) return null;

  const { clearAttention, pendingCommands, commandErrors } = participation;
  const error = commandErrors.get("clearAttention");

  return (
    <div
      className={cn(
        "border-b border-border bg-destructive-subtle px-4 py-2",
        className,
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-start gap-1.5 text-sm text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            The agent asked for a human
            {conversation.attentionReason ? (
              <> — &ldquo;{conversation.attentionReason}&rdquo;</>
            ) : (
              "."
            )}
          </span>
        </p>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void clearAttention().catch(() => {
              // Recorded in commandErrors and rendered below.
            })
          }
          disabled={pendingCommands.has("clearAttention")}
        >
          {pendingCommands.has("clearAttention") ? "Dismissing…" : "Dismiss"}
        </Button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive">{getUserMessage(error)}</p>
      )}
    </div>
  );
}
