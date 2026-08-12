/**
 * Turn-recovery digest: the platform's recorded transcript of the current
 * turn, rendered as prompt context for a fresh agent that replaced one whose
 * conversation state was lost mid-turn (issue #366).
 *
 * A HITL-paused turn can lose its agent two ways — the stored handle fails
 * to resume when the approval lands, or the resumed handle turns out to be
 * poisoned mid-send. Either way the replacement agent starts with an EMPTY
 * conversation, so the approval decisions alone read as instructions with no
 * story: the agent no longer knows what it was doing. This module rebuilds
 * that story from `status.messages` — the persisted execution transcript
 * seeded on every re-invocation — which is the platform's durable record of
 * the turn AND exactly what the user watched happen (introspecting the dead
 * agent's own conversation is best-effort at most; the handle is the thing
 * that failed).
 *
 * Doctrine (mirrors `ChannelRolloverBridgeComposer`, cloud DD-013 — the
 * platform's reference for conversation digests):
 * - Content here, presentation framing separate: {@link composeTurnRecoveryDigest}
 *   emits bare `Assistant:` / `Tool:` / `System:` lines;
 *   {@link formatTurnRecoveryText} adds the behavioral preamble; the prompt
 *   builder wraps the section tag (the context-bridge / conversation-catchup
 *   split).
 * - Oldest-first reading order; over budget, the OLDEST lines drop first
 *   (recency wins) and the drop is disclosed.
 * - Best-effort by contract: composition never throws — a failed digest
 *   degrades to recovery-without-transcript, never a failed recovery.
 *
 * Scope: the CURRENT turn only. Prior turns live in other execution records
 * and are not recoverable runner-side (that is the rollover bridge's domain,
 * composed cloud-side); the enhanced prompt's standing-context sections carry
 * whatever the session already had.
 */

import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Per-line text budget; longer texts are cut with an ellipsis (DD-013 twin). */
const MAX_LINE_CHARS = 400;

/**
 * Args-preview budget inside a tool line — the `describeApproval` precedent
 * (prompt-builder.ts), so tool renderings are bounded the same way on both
 * surfaces that describe them.
 */
const MAX_ARGS_CHARS = 200;

/**
 * Whole-digest budget (DD-013 twin). Enforced by dropping the OLDEST lines
 * first — recency wins, matching how a human skims their own recent work
 * before continuing it.
 */
const MAX_DIGEST_CHARS = 4000;

const ELLIPSIS = "\u2026";

/** Disclosed in place of the dropped prefix so the record never lies by omission. */
const OMISSION_NOTICE = `[${ELLIPSIS} earlier activity in this turn omitted for length]`;

/**
 * How the transcript is introduced to the model. Establishes the three facts
 * the replacement agent must hold: the work below is its OWN (continue, don't
 * restart), completed actions are DONE (don't redo them), and the workspace —
 * not this summary — is the source of truth for exact current state.
 */
const TURN_RECOVERY_PREAMBLE =
  "You had already started working on the user's request above, but the " +
  "session holding that conversation was lost, so you do not remember it. " +
  "Below is the platform's recorded transcript of your progress in this " +
  "turn, oldest first. Treat it as work YOU already did: do not start the " +
  "task over, do not redo actions shown as completed, and check the " +
  "workspace's current state where exact details matter.";

/**
 * Fallback framing when the turn produced no renderable transcript (or
 * composition failed): the state-loss disclosure still matters — without it,
 * the appended approval decisions read as reactions to proposals this agent
 * never made.
 */
const TURN_RECOVERY_NO_TRANSCRIPT =
  "You had already started working on the user's request above, but the " +
  "session holding that conversation was lost, so you do not remember it " +
  "and no transcript of your progress is available. Check the workspace's " +
  "current state to see what you already did before continuing.";

/**
 * Render the turn's persisted transcript as bare digest lines, or undefined
 * when there is nothing worth carrying. Never throws.
 *
 * Human messages are skipped — the turn's user message is already rendered
 * in the enhanced prompt's `<user_request>`, and duplicating it here would
 * dilute the budget. Thinking content is skipped as model-internal (the
 * replacement agent forms its own). System notices are kept: platform
 * messages like budget warnings or degradation notices are turn context the
 * agent acted under.
 */
export function composeTurnRecoveryDigest(
  messages: readonly AgentMessage[],
): string | undefined {
  try {
    const lines: string[] = [];
    for (const message of messages) {
      lines.push(...messageLines(message));
    }
    if (lines.length === 0) return undefined;

    // Oldest-first; drop from the FRONT when over budget so the newest work
    // always survives, and disclose the drop (DD-013 enforcement shape). The
    // notice participates in the budget so the result never overshoots.
    let first = 0;
    while (first < lines.length && totalLength(lines, first) > MAX_DIGEST_CHARS) {
      first++;
    }
    if (first >= lines.length) {
      // Degenerate case: even the newest line alone busts the budget (it is
      // already line-truncated, so this would take a pathological budget/line
      // ratio) — keep that one line rather than rendering nothing.
      first = lines.length - 1;
    }
    const kept = lines.slice(first);
    if (first > 0) kept.unshift(OMISSION_NOTICE);
    return kept.join("\n");
  } catch (err) {
    console.warn("Turn-recovery digest composition failed — recovering without a transcript:", err);
    return undefined;
  }
}

/**
 * The framed recovery body (preamble + digest), ready for section wrapping.
 * Accepts an absent digest: the state-loss disclosure is load-bearing even
 * when there is no transcript to show (see {@link TURN_RECOVERY_NO_TRANSCRIPT}).
 */
export function formatTurnRecoveryText(digest: string | undefined): string {
  if (digest === undefined || digest.trim() === "") {
    return TURN_RECOVERY_NO_TRANSCRIPT;
  }
  return `${TURN_RECOVERY_PREAMBLE}\n\n${digest.trim()}`;
}

/** The digest lines one transcript message contributes (possibly none). */
function messageLines(message: AgentMessage): string[] {
  const lines: string[] = [];
  const text = message.content.trim();
  switch (message.type) {
    case MessageType.MESSAGE_AI:
      if (text) lines.push(`Assistant: ${truncate(text, MAX_LINE_CHARS)}`);
      // Tool calls ride AI messages (message.proto contract); render them
      // even when the surrounding text is blank.
      for (const toolCall of message.toolCalls) {
        lines.push(toolCallLine(toolCall));
      }
      return lines;
    case MessageType.MESSAGE_SYSTEM:
      if (text) lines.push(`System: ${truncate(text, MAX_LINE_CHARS)}`);
      return lines;
    default:
      // Human (already in <user_request>), thinking (model-internal), tool
      // results (each ToolCall line already carries its outcome), unknown.
      return lines;
  }
}

/**
 * One bounded line per tool call: what was attempted and how it ended.
 * Prefers the resolved approval message where one exists — the same
 * human-meaningful description the user approved against
 * (the `describeApproval` convention).
 */
function toolCallLine(toolCall: ToolCall): string {
  const action = toolCall.approvalMessage
    ? toolCall.approvalMessage
    : toolCall.argsPreview
      ? `${toolCall.name}(${truncate(toolCall.argsPreview, MAX_ARGS_CHARS)})`
      : toolCall.name;
  return `Tool: ${truncate(action, MAX_LINE_CHARS)} — ${outcome(toolCall)}`;
}

function outcome(toolCall: ToolCall): string {
  switch (toolCall.status) {
    case ToolCallStatus.TOOL_CALL_COMPLETED:
      return "completed";
    case ToolCallStatus.TOOL_CALL_FAILED:
      return toolCall.error
        ? `failed: ${truncate(toolCall.error, MAX_ARGS_CHARS)}`
        : "failed";
    case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
      return "paused for user approval";
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "skipped";
    default:
      // PENDING / RUNNING / unknown: in flight when the session was lost.
      return "interrupted before it finished";
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}${ELLIPSIS}`;
}

/** Joined length of lines[first..] plus the omission notice when one would render. */
function totalLength(lines: readonly string[], first: number): number {
  let total = first > 0 ? OMISSION_NOTICE.length + 1 : 0;
  for (let i = first; i < lines.length; i++) {
    total += lines[i].length + 1;
  }
  return total;
}
