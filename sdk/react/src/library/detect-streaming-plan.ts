import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Turn } from "@stigmer/client";

/**
 * A plan being written by a live Plan-mode turn, detected mid-stream so
 * the UI can promote it to a document surface (panel plan tab + compact thread
 * card) instead of letting it dump into the chat as a giant streaming bubble.
 */
export interface StreamingPlan {
  /** The id of the plan's message among the turn's items. */
  readonly messageId: string;
  /**
   * The plan text to render on document surfaces: the message content with
   * any enclosing plan fence stripped, streaming-tolerantly (an unterminated
   * opening fence is stripped too — see {@link findStreamingPlan}). Purely a
   * display projection; the stored message is never mutated.
   */
  readonly displayText: string;
}

/**
 * Opening line of a whole-message plan fence: ``` with no language tag, or
 * tagged `markdown`/`md`. Any other tag (```python …) means the message opens
 * with a genuine code block, not a wrapped plan, and is never unwrapped —
 * mirroring `unwrapEnclosingMarkdownFence`'s tag rules.
 */
const OPENING_PLAN_FENCE_RE = /^(`{3,})(?:markdown|md)?[ \t]*\r?\n/;

/** A streaming plan message qualifies when it opens with an `# H1` title. */
const LEADING_H1_RE = /^#[ \t]/;

/**
 * Streaming-tolerant unwrap of a whole-message plan fence.
 *
 * `unwrapEnclosingMarkdownFence` deliberately no-ops until the closing fence
 * arrives (transcripts must stay faithful while a genuine code block is still
 * open). A plan surface can't wait: mid-stream the closing fence hasn't
 * streamed yet, and rendering the fence as-is turns the whole live plan into
 * one giant code block. Because Plan mode's output IS a markdown document by
 * contract, a message that OPENS with a bare/markdown fence is a wrapped plan
 * — so this strips the opening fence immediately and the closing fence
 * whenever it shows up as the final line.
 */
function unwrapStreamingPlanFence(content: string): string {
  const trimmed = content.trim();
  const open = OPENING_PLAN_FENCE_RE.exec(trimmed);
  if (!open) return content;
  const body = trimmed.slice(open[0].length);
  // Strip the closing fence only when it is the final line (same backtick
  // run); a fence anywhere else belongs to a code block inside the plan.
  const close = new RegExp(`(?:^|\\r?\\n)${open[1]}[ \\t]*$`);
  const closeMatch = close.exec(body);
  return closeMatch ? body.slice(0, closeMatch.index) : body;
}

/**
 * Detects the plan a live Plan-mode turn is currently writing, or
 * `undefined` when the turn has no recognizable plan in flight.
 *
 * This is the third leg of the plan convention, alongside the runner's prompt
 * directive ("your FINAL message IS the plan, starting with a single `#`
 * title" — `plan-mode-prompt.ts`) and the completion-time artifact detection
 * by filename ({@link isPlanArtifact}). Completion makes the plan unambiguous
 * (the published `plan.md` artifact); mid-stream it must be inferred, and the
 * directive's mandated shape is the inference:
 *
 * - the turn's run runs in Plan mode and the turn has **not ended** (a
 *   completed turn is owned by the artifact path; a stopped/failed turn has
 *   no live plan),
 * - the candidate is the turn's **last content-bearing agent message** (live
 *   or stored) — the exact selection rule the runner's `extractFinalPlanText`
 *   and the thread's plan-message rule share, so all three stay in lockstep,
 * - and that candidate opens with an `# H1` title (after tolerating an
 *   enclosing plan fence, see {@link unwrapStreamingPlanFence}) — the shape
 *   the directive mandates and narration essentially never has.
 *
 * Degradation is graceful by design: a model that ignores the directive
 * simply streams its plan in the thread as before, and the completion-time
 * pipeline is unaffected either way. Only the LAST content-bearing agent
 * message is ever considered — an earlier message is settled narration, and
 * falling back to it would promote the wrong text.
 *
 * @param turn - The turn, from the session's fold.
 * @param run - The turn's run (its spec says the interaction mode).
 */
export function findStreamingPlan(
  turn: Turn | null | undefined,
  run: Run | null | undefined,
): StreamingPlan | undefined {
  if (!turn || turn.ended || run?.spec?.interactionMode !== InteractionMode.PLAN) {
    return undefined;
  }
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i]!;
    if (item.kind !== "message" || item.text.trim().length === 0) continue;
    const displayText = unwrapStreamingPlanFence(item.text);
    return LEADING_H1_RE.test(displayText.trimStart())
      ? { messageId: item.id, displayText }
      : undefined;
  }
  return undefined;
}
