/**
 * The scoring readers' shared view of one turn, read from its session's
 * events: the fold `@stigmer/session-log` gives every client, the turn's
 * primary-thread tool uses in order with their states, and a tool use's
 * call id. The three readers (the checks' actions, checks/actions.ts; the
 * judge's subject, judge/subject.ts; a plugin eval's trace, eval/trace.ts)
 * build their own views from it.
 *
 * A tool use's state is the fold's: completed, failed, denied (a person
 * or a rule refused it), stopped (its turn ended before it returned),
 * waiting (for a person's answer) or running. The log states an error
 * rather than why a call did not run, so a call the runner skipped with
 * no one's denial reads as failed.
 *
 * Proven through each reader's tests and __tests__/transcript-from-events.test.ts.
 */
import { foldSession, turnOf } from "@stigmer/session-log";
import type { ToolUse, Turn } from "@stigmer/session-log";

import type { RunTranscript } from "../session/events/run-events.js";

/** The run's turn, folded from its events; undefined when the log holds none of it. */
export function turnOfTranscript(transcript: RunTranscript): Turn | undefined {
  return turnOf(
    foldSession(transcript.events),
    transcript.run.metadata?.id ?? "",
  );
}

/** The turn's primary-thread tool uses, in order. */
export function toolUsesOf(turn: Turn | undefined): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const item of turn?.items ?? []) {
    if (item.kind === "tool_use") {
      uses.push(item);
    }
  }
  return uses;
}

/**
 * The provider's call id a tool use was named by: its event id after the
 * run's (`<run>.<call id>`, session/events/ids.ts), or the hashed form the
 * runner wrote for a call id the contract's pattern does not admit.
 */
export function callIdOf(use: ToolUse): string {
  const prefix = `${use.runId}.`;
  return use.id.startsWith(prefix) ? use.id.slice(prefix.length) : use.id;
}

/** The turn's last message with text on its primary thread; "" when it wrote none. */
export function lastMessageOf(turn: Turn | undefined): string {
  const items = turn?.items ?? [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item?.kind === "message" && item.text !== "") {
      return item.text;
    }
  }
  return "";
}
