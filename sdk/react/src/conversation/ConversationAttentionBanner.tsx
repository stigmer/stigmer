"use client";

import { Hand } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import {
  ConversationControl,
  type ChannelConversation,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { Notice } from "../internal/surface/Notice.js";
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
 * The needs-attention notice, in the paused tone (a person asked for is
 * not a failure): the escalating agent's reason, verbatim, with the
 * escalation's ANSWER beside its false-alarm dismissal.
 *
 * Take over is the primary action because the human arriving IS the
 * answer to an escalation — taking over clears attention structurally
 * (an answer one banner away in equal-weight chrome is missed: staff read
 * the plea and not the response).
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
    // A person asked for is not a failure: the paused tone, one Take over
    // (the control strip beside it offers none while this shows), Dismiss.
    <Notice
      tone="paused"
      icon={<Hand aria-hidden="true" className="stg:size-4" />}
      headline="The agent asked for a person."
      act={
        offersTakeOver
          ? {
              label: pendingCommands.has("takeOver") ? "Taking over…" : "Take over",
              busy: pendingCommands.has("takeOver"),
              onClick: () =>
                void takeOver().catch(() => {
                  // Recorded in commandErrors and rendered below.
                }),
            }
          : undefined
      }
      actSize="xs"
      link={{
        label: pendingCommands.has("clearAttention") ? "Dismissing…" : "Dismiss",
        // A link has no disabled state: a second press while the first is in
        // flight sends nothing.
        onClick: () => {
          if (pendingCommands.has("clearAttention")) return;
          void clearAttention().catch(() => {
            // Recorded in commandErrors and rendered below.
          });
        },
      }}
      className={cn("stg:mx-4 stg:mt-3", className)}
    >
      {conversation.attentionReason && (
        <p className="stg:m-0 stg:break-words">&ldquo;{conversation.attentionReason}&rdquo;</p>
      )}
      {!humanHeld && (
        <p className="stg:m-0 stg:text-muted-foreground">
          The agent is still serving the conversation until someone takes over.
        </p>
      )}
      {error && <p className="stg:m-0 stg:text-xs stg:text-status-failed">{getUserMessage(error)}</p>}
    </Notice>
  );
}
