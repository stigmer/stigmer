"use client";

import { create } from "@bufbuild/protobuf";
import type {
  ChannelConversation,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import {
  ConversationControlInputSchema,
  GetChannelConversationInputSchema,
  ReplyToConversationInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import type { SendChannelMessageOutput } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { useCallback, useMemo } from "react";
import { useStigmer } from "../hooks.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";

/** The four staff-facing participation commands. */
export type ConversationCommand = "reply" | "takeOver" | "handBack" | "clearAttention";

/** Options for {@link useConversationParticipation}. */
export interface UseConversationParticipationOptions {
  /** AgentChannel the conversation belongs to. */
  readonly agentChannelId: string;
  /** Conversation key within the channel. */
  readonly conversationKey: string;
  /**
   * Receives the fresh conversation row every command answers with —
   * wire it to {@link useConversation}'s `applyServerState` so banners
   * and controls adopt server truth immediately. Called for reply too
   * (via a follow-up row read): a staff reply implicitly takes over
   * BEFORE the send, unconditionally, so control has moved even when
   * the send itself was refused.
   */
  readonly onConversation?: (fresh: ChannelConversation) => void;
}

/** Return value of {@link useConversationParticipation}. */
export interface UseConversationParticipationReturn {
  /**
   * Send a staff text reply. Resolves with the truthful outcome of the
   * inline attempt: `accepted` (with `outboundMessageId` — the item will
   * appear on the timeline as `ob:<that id>`), `queued`, or `refused`.
   * A `refused` outcome WITHOUT an `outboundMessageId` left no ledger
   * row and no timeline item will ever exist for it.
   */
  readonly reply: (text: string) => Promise<SendChannelMessageOutput>;
  /**
   * Take the conversation over: the agent goes quiet until handBack.
   * Resolves with the fresh row — for the LOSER of a concurrent
   * takeover too (success-with-the-winner's-state, never an error), so
   * compare `controlledBy` against the caller rather than assuming the
   * transition won.
   */
  readonly takeOver: () => Promise<ChannelConversation>;
  /** Hand the conversation back to the agent. */
  readonly handBack: () => Promise<ChannelConversation>;
  /** Dismiss the needs-attention flag in place; control is untouched. */
  readonly clearAttention: () => Promise<ChannelConversation>;
  /** Commands currently in flight. */
  readonly pendingCommands: ReadonlySet<ConversationCommand>;
  /** Per-command failures, cleared when that command is retried. */
  readonly commandErrors: ReadonlyMap<ConversationCommand, Error>;
  /** Reset every recorded command error. */
  readonly clearErrors: () => void;
}

/**
 * Behavior hook for the participation commands on one conversation
 * (channel-conversations DD-005/DD-007/DD-008/DD-009): reply, takeOver,
 * handBack, clearAttention — each keyed independently so a slow reply
 * and a takeover can be in flight at once with attributable spinners
 * and errors.
 *
 * Every command re-throws its failure after recording it in
 * {@link UseConversationParticipationReturn.commandErrors}, so callers
 * choose the propagation (await-and-toast, or ignore and render the
 * keyed error inline).
 */
export function useConversationParticipation(
  options: UseConversationParticipationOptions,
): UseConversationParticipationReturn {
  const { agentChannelId, conversationKey, onConversation } = options;
  const stigmer = useStigmer();
  const submission = useKeyedSubmission<unknown>();
  const { run } = submission;

  const controlInput = useCallback(
    () => create(ConversationControlInputSchema, { agentChannelId, conversationKey }),
    [agentChannelId, conversationKey],
  );

  const takeOver = useCallback(
    () =>
      run("takeOver", async () => {
        const fresh = await stigmer.agentChannel.takeOver(controlInput());
        onConversation?.(fresh);
        return fresh;
      }) as Promise<ChannelConversation>,
    [run, stigmer, controlInput, onConversation],
  );

  const handBack = useCallback(
    () =>
      run("handBack", async () => {
        const fresh = await stigmer.agentChannel.handBack(controlInput());
        onConversation?.(fresh);
        return fresh;
      }) as Promise<ChannelConversation>,
    [run, stigmer, controlInput, onConversation],
  );

  const clearAttention = useCallback(
    () =>
      run("clearAttention", async () => {
        const fresh = await stigmer.agentChannel.clearAttention(controlInput());
        onConversation?.(fresh);
        return fresh;
      }) as Promise<ChannelConversation>,
    [run, stigmer, controlInput, onConversation],
  );

  const reply = useCallback(
    (text: string) =>
      run("reply", async () => {
        const output = await stigmer.agentChannel.reply(
          create(ReplyToConversationInputSchema, {
            agentChannelId,
            conversationKey,
            payload: { kind: { case: "text", value: { body: text } } },
          }),
        );
        // The implicit takeover flipped control BEFORE the send ran —
        // even a refused reply moved it — but reply answers the send
        // outcome, not the row. One follow-up read keeps the control
        // banner honest without waiting a poll tick. Best-effort: a
        // failed read only delays the banner until the next poll.
        if (onConversation) {
          try {
            onConversation(
              await stigmer.agentChannel.getConversation(
                create(GetChannelConversationInputSchema, {
                  agentChannelId,
                  conversationKey,
                }),
              ),
            );
          } catch {
            // The reply itself succeeded; the poll will catch the row up.
          }
        }
        return output;
      }) as Promise<SendChannelMessageOutput>,
    [run, stigmer, agentChannelId, conversationKey, onConversation],
  );

  return useMemo(
    () => ({
      reply,
      takeOver,
      handBack,
      clearAttention,
      // The submission primitive keys by string; this hook only ever
      // submits the four command names, so the narrowing is sound.
      pendingCommands: submission.submittingKeys as ReadonlySet<ConversationCommand>,
      commandErrors: submission.errorsByKey as ReadonlyMap<ConversationCommand, Error>,
      clearErrors: submission.clearErrors,
    }),
    [
      reply,
      takeOver,
      handBack,
      clearAttention,
      submission.submittingKeys,
      submission.errorsByKey,
      submission.clearErrors,
    ],
  );
}
