// The conversation's activity as the frame around it needs it, worked out
// where the turn is: in the session view, which loads as a later chunk with
// the turn derivation (`describeTurnActivity`) it already uses. The frame
// then needs only words and a start time, so its own eager download stays
// free of that derivation.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { activityPhrase, describeTurnActivity, type Turn } from "@stigmer/client";
import type { ChatActivity } from "./chat-activity.js";

/**
 * What the conversation is doing: the working turn's words while one runs,
 * how the last turn ended (with the Files it returned) once it has, else
 * idle.
 */
export function chatActivityOf(
  activeTurn: Turn | null,
  lastTurn: Turn | undefined,
  files: readonly StigmerFile[],
  nowMs: number,
): ChatActivity {
  if (activeTurn !== null) {
    const progress = describeTurnActivity(activeTurn, nowMs);
    return {
      kind: "working",
      phrase: activityPhrase(progress.activity),
      waiting: progress.activity.kind === "waiting_for_you",
      startedAtMs: nowMs - progress.elapsedMs,
    };
  }
  if (lastTurn?.ended && lastTurn.status?.phase !== undefined) {
    return {
      kind: "ended",
      runId: lastTurn.runId,
      phase: lastTurn.status.phase,
      filesMade: files.filter((file) => file.status?.runId === lastTurn.runId).length,
    };
  }
  return { kind: "idle" };
}
