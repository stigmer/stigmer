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
 * that story from the run's events in the session's log — the platform's
 * durable record of the turn AND exactly what the user watched happen —
 * folded by `@stigmer/session-log` as every client folds them (introspecting
 * the dead agent's own conversation is best-effort at most; the handle is
 * the thing that failed). The events are read only when a digest is
 * needed ({@link readTurnRecoveryDigest}), through the turn's
 * `TurnInput.readRunEvents`; what the agent did since the turn's last write
 * to the log is not in it yet.
 *
 * Doctrine (mirrors the rollover context bridge's composer — the
 * platform's reference for conversation digests):
 * - Content here, presentation framing separate: {@link composeTurnRecoveryDigest}
 *   emits bare `Assistant:` / `Tool:` / `System:` lines;
 *   {@link formatTurnRecoveryText} adds the behavioral preamble; the prompt
 *   builder wraps the section tag (the context-bridge / conversation-catchup
 *   split).
 * - Oldest-first reading order; over budget, the OLDEST lines drop first
 *   (recency wins) and the drop is disclosed.
 * - Best-effort by contract: neither the read nor the composition ever
 *   throws — a failed digest degrades to recovery-without-transcript, never
 *   a failed recovery.
 *
 * Scope: the CURRENT turn only, its primary thread. Prior turns live in
 * other runs and are not recoverable runner-side (that is the rollover
 * bridge's domain, composed cloud-side); the enhanced prompt's
 * standing-context sections carry whatever the session already had.
 */

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { foldSession, turnOf, type TurnItem, type ToolUse } from "@stigmer/session-log";

/** Per-line text budget; longer texts are cut with an ellipsis (as the bridge does). */
const MAX_LINE_CHARS = 400;

/**
 * Args-preview budget inside a tool line — the `describeApproval` precedent
 * (prompt-builder.ts), so tool renderings are bounded the same way on both
 * surfaces that describe them.
 */
const MAX_ARGS_CHARS = 200;

/**
 * Whole-digest budget (as the bridge's). Enforced by dropping the OLDEST lines
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
 * Render run `runId`'s events as bare digest lines, or undefined when there
 * is nothing worth carrying. Never throws.
 *
 * The person's message is skipped — the turn's user message is already
 * rendered in the enhanced prompt's `<user_request>`, and duplicating it
 * here would dilute the budget. Thinking is skipped as model-internal (the
 * replacement agent forms its own). The platform's notes are kept: lines
 * like budget warnings or degradation notices are turn context the agent
 * acted under.
 */
export function composeTurnRecoveryDigest(events: readonly SessionEvent[], runId: string): string | undefined {
  try {
    const lines = (turnOf(foldSession(events), runId)?.items ?? []).flatMap(itemLines);
    if (lines.length === 0) return undefined;

    // Oldest-first; drop from the FRONT when over budget so the newest work
    // always survives, and disclose the drop (the bridge's enforcement shape). The
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
 * Read the run's events and compose its digest. Never throws: a log that
 * cannot be read degrades to recovery-without-transcript, as a failed
 * composition does.
 */
export async function readTurnRecoveryDigest(
  readRunEvents: () => Promise<readonly SessionEvent[]>,
  runId: string,
): Promise<string | undefined> {
  let events: readonly SessionEvent[];
  try {
    events = await readRunEvents();
  } catch (err) {
    console.warn("Turn-recovery digest: the run's events could not be read — recovering without a transcript:", err);
    return undefined;
  }
  return composeTurnRecoveryDigest(events, runId);
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

/** The digest lines one item of the turn's primary thread contributes (possibly none). */
function itemLines(item: TurnItem): string[] {
  switch (item.kind) {
    case "message": {
      const text = item.text.trim();
      return text ? [`Assistant: ${truncate(text, MAX_LINE_CHARS)}`] : [];
    }
    case "note": {
      const text = item.text.trim();
      return text ? [`System: ${truncate(text, MAX_LINE_CHARS)}`] : [];
    }
    case "tool_use":
      return [toolUseLine(item)];
    default:
      // Thinking (model-internal) and a compaction marker.
      return [];
  }
}

/**
 * One bounded line per tool use: what was attempted and how it ended.
 * Prefers the message its ask showed where one exists — the same
 * human-meaningful description the user approved against (the
 * `describeApproval` convention).
 */
function toolUseLine(tool: ToolUse): string {
  const preview = tool.ask?.argsPreview || (Object.keys(tool.input).length > 0 ? JSON.stringify(tool.input) : "");
  const action = tool.ask?.message
    ? tool.ask.message
    : preview
      ? `${tool.name}(${truncate(preview, MAX_ARGS_CHARS)})`
      : tool.name;
  return `Tool: ${truncate(action, MAX_LINE_CHARS)} — ${outcome(tool)}`;
}

/**
 * How a tool use stands. A call that asked and has not run since reads as
 * paused for approval whatever the answer (the prompt carries the
 * decisions beside the digest), as its row still waited when the turn
 * resumed; a call a person or a rule refused reads as skipped.
 */
function outcome(tool: ToolUse): string {
  if (tool.result !== undefined) {
    if (!tool.result.isError) return "completed";
    const error = tool.result.text.trim();
    return error ? `failed: ${truncate(error, MAX_ARGS_CHARS)}` : "failed";
  }
  if (tool.ask !== undefined && tool.confirmation?.result !== "deny") return "paused for user approval";
  if (tool.state === "denied") return "skipped";
  // Running, or stopped: in flight when the session was lost.
  return "interrupted before it finished";
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
