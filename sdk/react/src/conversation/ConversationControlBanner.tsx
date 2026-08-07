"use client";

import { useState } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import {
  ConversationControl,
  type ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { Button } from "../button/Button.js";
import type { UseConversationParticipationReturn } from "./useConversationParticipation.js";

/** Props for {@link ConversationControlBanner}. */
export interface ConversationControlBannerProps {
  /** The conversation's fresh participation state. */
  readonly conversation: ChannelConversation;
  /** The participation commands (from `useConversationParticipation`). */
  readonly participation: UseConversationParticipationReturn;
  /**
   * `true` when the newest customer-visible item is an unanswered
   * customer message — computed from the timeline read. Arms the
   * handback confirm guard (channel-conversations DD-007 D-e): handing
   * back runs NO turn, so the agent stays quiet until the customer
   * next speaks, and the unanswered state must be unmissable.
   */
  readonly unansweredCustomer: boolean;
  /**
   * Whether the channel's provider has a staff send lane. Senderless
   * providers disable takeover with the reason — a takeover there would
   * silence the agent while no human reply could reach the customer,
   * which is exactly what the server refuses.
   */
  readonly supportsStaffReplies: boolean;
  /**
   * The signed-in staff member's identity account id, when the host
   * knows it — lets the banner attribute a human hold: "You have this
   * conversation" when it matches, "A teammate has this conversation"
   * when it differs. When omitted the banner only states that a human
   * holds it — the holder may be the viewer themself, so "a teammate"
   * would be a guess. Optional: the SDK never assumes a host's auth
   * state.
   */
  readonly currentIdentityAccountId?: string;
  /** Additional classes for the banner container. */
  readonly className?: string;
}

/**
 * Who may speak to the customer, and the controls that move it: take
 * over (the agent goes quiet) and hand back (the agent resumes, with
 * the context it missed injected on its next turn).
 *
 * Truth rules: state renders from the conversation row the server
 * answered — a takeover that lost its race renders the WINNER's hold,
 * because that is what happened. Failures render verbatim beside the
 * control that caused them.
 */
export function ConversationControlBanner({
  conversation,
  participation,
  unansweredCustomer,
  supportsStaffReplies,
  currentIdentityAccountId,
  className,
}: ConversationControlBannerProps) {
  const [confirmingHandBack, setConfirmingHandBack] = useState(false);

  const humanHeld = conversation.control === ConversationControl.control_human;
  const heldByMe =
    humanHeld &&
    currentIdentityAccountId !== undefined &&
    conversation.controlledBy === currentIdentityAccountId;

  const { takeOver, handBack, pendingCommands, commandErrors } = participation;
  const error = commandErrors.get("takeOver") ?? commandErrors.get("handBack");

  const requestHandBack = () => {
    if (unansweredCustomer) {
      setConfirmingHandBack(true);
      return;
    }
    void handBack().catch(() => {
      // Recorded in commandErrors and rendered below.
    });
  };

  return (
    <div
      className={cn(
        "border-b border-border px-4 py-2",
        humanHeld ? "bg-primary-subtle" : "bg-muted-faint",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-foreground">
          {humanHeld ? (
            <>
              <User aria-hidden="true" className="size-4 text-muted-foreground" />
              {heldByMe
                ? "You have this conversation — the agent is quiet until you hand it back."
                : currentIdentityAccountId !== undefined
                  ? "A teammate has this conversation — the agent is quiet until handback."
                  : // Without the host's identity the holder may be the
                    // viewer themself — claiming "a teammate" would be a
                    // guess. State only what the row proves: a human
                    // holds it (channel-conversations F-01).
                    "This conversation is with a human — the agent is quiet until handback."}
            </>
          ) : (
            <>
              <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
              The agent is serving this conversation.
            </>
          )}
        </p>

        {confirmingHandBack ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">
              The customer&apos;s last message has no reply — the agent stays
              quiet until they write again.
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setConfirmingHandBack(false);
                void handBack().catch(() => {
                  // Recorded in commandErrors and rendered below.
                });
              }}
              disabled={pendingCommands.has("handBack")}
            >
              Hand back anyway
            </Button>
            <Button
              variant="primary"
              size="xs"
              onClick={() => setConfirmingHandBack(false)}
            >
              Keep the conversation
            </Button>
          </div>
        ) : humanHeld ? (
          <Button
            variant="outline"
            size="xs"
            onClick={requestHandBack}
            disabled={pendingCommands.has("handBack")}
          >
            {pendingCommands.has("handBack") ? "Handing back…" : "Hand back to agent"}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {!supportsStaffReplies && (
              // Visible text, never a native title (F-18): a disabled
              // Button swallows hover (disabled:pointer-events-none) and
              // leaves the tab order, so a title on it is unreachable by
              // every input method. Kept short — the composer's own
              // notice already explains the missing staff reply lane.
              <span className="text-xs text-muted-foreground">
                This channel&apos;s provider has no staff send lane yet — a
                takeover would silence the agent with no way to reply.
              </span>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                void takeOver().catch(() => {
                  // Recorded in commandErrors and rendered below.
                })
              }
              disabled={!supportsStaffReplies || pendingCommands.has("takeOver")}
            >
              {pendingCommands.has("takeOver") ? "Taking over…" : "Take over"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-destructive">{getUserMessage(error)}</p>
      )}
    </div>
  );
}
