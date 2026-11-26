/**
 * How a pending sign-in's answer rests in its row: `answered_at` marks the
 * row answered (NULL until the callback page hands the answer back), and
 * then `answered_code` holds the code (sealed by the sign-in, never here)
 * or `answer_error` the refusal's words. One encoding for both drivers, so
 * a row one wrote reads the same through the other.
 *
 * Pinned by the pending oauth state arms of __tests__/store-contract.ts.
 */
import type { PendingSignInAnswer } from "./interface.js";

/** The answer three columns hold, or undefined for a row not answered yet. */
export function pendingSignInAnswerOf(
  answeredCode: string | null,
  answerError: string | null,
  answeredAt: string | number | null,
): PendingSignInAnswer | undefined {
  if (answeredAt === null) return undefined;
  return answeredCode !== null
    ? { kind: "code", code: answeredCode }
    : { kind: "refused", reason: answerError ?? "" };
}
