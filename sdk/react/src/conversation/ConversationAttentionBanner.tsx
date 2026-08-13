"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import {
  ConversationControl,
  type ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { Button } from "../button/Button.js";
import type { UseConversationParticipationReturn } from "./useConversationParticipation.js";

/** Props for {@link ConversationAttentionBanner}. */
export interface ConversationAttentionBannerProps {
  /** The conversation's fresh participation state. */
  readonly conversation: ChannelConversation;
  /** The participation commands (from `useConversationParticipation`). */
  readonly participation: UseConversationParticipationReturn;
  /**
   * Whether the channel's provider has a staff send lane — the same
   * fact `ConversationControlBanner` takes. When `false` the banner
   * offers only Dismiss: a takeover would silence the agent with no way
   * to reply, and the control banner beside this one already explains
   * the missing lane, so a disabled Take over here would duplicate it.
   * Defaults to `true` for hosts that only wire providers with staff
   * lanes.
   */
  readonly supportsStaffReplies?: boolean;
  /** Additional classes for the banner container. */
  readonly className?: string;
}

/**
 * The needs-attention banner (channel-conversations DD-008): the
 * escalating agent's reason, verbatim, with the escalation's ANSWER
 * beside its false-alarm dismissal.
 *
 * Take over is the primary action because the human arriving IS the
 * answer to an escalation — taking over clears attention structurally
 * (cloud#266 / F-20: the answer used to live one banner away in
 * equal-weight chrome, so staff read the plea and missed the response).
 * It renders only while the agent holds the conversation on a channel
 * with a staff lane; a human already holding it IS the attention
 * answered, so only Dismiss remains.
 *
 * Dismiss is `clearAttention` — attention clears in place and control
 * never moves. Renders nothing while the conversation is unflagged.
 */
export function ConversationAttentionBanner({
  conversation,
  participation,
  supportsStaffReplies = true,
  className,
}: ConversationAttentionBannerProps) {
  if (!conversation.needsAttention) return null;

  const { takeOver, clearAttention, pendingCommands, commandErrors } = participation;
  // Take over's failure renders on the control banner too — same
  // command, same truth; a rare failure showing twice on the stacked
  // banners beats it hiding beside the button the staffer pressed.
  const error = commandErrors.get("clearAttention") ?? commandErrors.get("takeOver");
  const humanHeld = conversation.control === ConversationControl.control_human;
  const offersTakeOver = !humanHeld && supportsStaffReplies;

  return (
    <div
      className={cn(
        "stg:border-b stg:border-border stg:bg-destructive-subtle stg:px-4 stg:py-2",
        className,
      )}
      role="status"
    >
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2">
        <p className="stg:flex stg:min-w-0 stg:items-start stg:gap-1.5 stg:text-sm stg:text-destructive">
          <TriangleAlert aria-hidden="true" className="stg:mt-0.5 stg:size-4 stg:shrink-0" />
          <span className="stg:min-w-0 stg:break-words">
            The agent asked for a human
            {conversation.attentionReason ? (
              <> — &ldquo;{conversation.attentionReason}&rdquo;</>
            ) : (
              "."
            )}
          </span>
        </p>
        {/* One shrink-proof group, right-aligned even after a wrap
            (ml-auto): under a long reason the actions used to wrap to
            the bottom-LEFT and read as part of the message (F-20). */}
        <div className="stg:ml-auto stg:flex stg:shrink-0 stg:items-center stg:gap-2">
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
          {offersTakeOver && (
            <Button
              variant="primary"
              size="xs"
              onClick={() =>
                void takeOver().catch(() => {
                  // Recorded in commandErrors and rendered below.
                })
              }
              disabled={pendingCommands.has("takeOver")}
            >
              {pendingCommands.has("takeOver") ? "Taking over…" : "Take over"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="stg:mt-1 stg:text-xs stg:text-destructive">{getUserMessage(error)}</p>
      )}
    </div>
  );
}
