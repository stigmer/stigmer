"use client";

import { useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  ConfirmToolUseInputSchema,
  GrantPermissionInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useKeyedState } from "../internal/useKeyedState.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";

/**
 * A person's answer to a tool use that waits for one:
 *
 * - `"allow"` runs this one call (`confirmToolUse` with `allow`);
 * - `"deny"` refuses it, with an optional message the agent reads
 *   (`confirmToolUse` with `deny`);
 * - `"grant"` runs it and every call of its class for the rest of the turn
 *   (`grantPermission`): its MCP server's tools, or its built-in category,
 *   or what the hook that asked covers.
 */
export type ToolUseAnswer = "allow" | "deny" | "grant";

/** Return value of {@link useAnswerToolUse}. */
export interface UseAnswerToolUseReturn {
  /**
   * Answer a waiting tool use of a session. Resolves when the server
   * recorded the answer; the session's events then carry it (the tool use's
   * `confirmation` and `grant`). `denyMessage` is read only with `"deny"`.
   * Rejects with the server's error, which is also kept per tool use.
   */
  readonly answerToolUse: (
    sessionId: string,
    toolUseId: string,
    answer: ToolUseAnswer,
    denyMessage?: string,
  ) => Promise<void>;
  /**
   * The tool uses whose answer is in flight, by id: one gate's spinner
   * never blocks another's while several wait at once.
   */
  readonly submittingToolUseIds: ReadonlySet<string>;
  /**
   * Each tool use's last failed answer, keyed like
   * {@link submittingToolUseIds}, so a failure shows beside the one gate it
   * belongs to. Cleared for a tool use when it is answered again.
   */
  readonly errorsByToolUseId: ReadonlyMap<string, Error>;
  /**
   * The most recent failure, or `null`: a single value for a headless
   * consumer (a banner, the terminal surface). The map is authoritative.
   *
   * With the hook bound to a session (`useAnswerToolUse(sessionId)`), only
   * the failures of answers for that session, made while it is the bound
   * one: another session starts clean, and an answer that fails after the
   * switch, or answers another session, never shows here. Unbound, the
   * failure of any answer.
   */
  readonly error: Error | null;
  /** Reset every answer error (both {@link errorsByToolUseId} and {@link error}). */
  readonly clearError: () => void;
}

/**
 * Behavior hook that answers the tool uses a session waits on, through the
 * session's own methods (`confirmToolUse`, `grantPermission`), with
 * per-tool-use loading and error state.
 *
 * Platform builders who render their own approval UI use this hook
 * directly; {@link ApprovalCard} takes the answer callback it produces.
 *
 * @param sessionId - The conversation on screen, whose failures
 *   {@link UseAnswerToolUseReturn.error} shows. Pass it when the hook stays
 *   mounted while the person moves between conversations, so one
 *   conversation's failed answer never shows on the next. Omit it to show
 *   the failure of any answer. Each answer still names its own session.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function AskButtons({ sessionId, ask }: { sessionId: string; ask: ToolUse }) {
 *   const { answerToolUse, submittingToolUseIds } = useAnswerToolUse();
 *   const busy = submittingToolUseIds.has(ask.id);
 *   return (
 *     <>
 *       <button disabled={busy} onClick={() => answerToolUse(sessionId, ask.id, "allow")}>Allow</button>
 *       <button disabled={busy} onClick={() => answerToolUse(sessionId, ask.id, "deny", "Use the staging database instead")}>Deny</button>
 *     </>
 *   );
 * }
 * ```
 */
export function useAnswerToolUse(sessionId?: string | null): UseAnswerToolUseReturn {
  const stigmer = useStigmer();
  const keyed = useKeyedSubmission<void>();
  // The scalar belongs to the bound session, visit by visit; an answer
  // writes it only when it names that session (stigmer/stigmer#3226).
  const boundId = sessionId ?? "";
  const [error, setError] = useKeyedState<Error | null>(boundId, null);

  const clearError = useCallback(() => {
    keyed.clearErrors();
    setError(null);
  }, [keyed.clearErrors, setError]);

  const answerToolUse = useCallback(
    async (
      sessionId: string,
      toolUseId: string,
      answer: ToolUseAnswer,
      denyMessage?: string,
    ): Promise<void> => {
      const shown = boundId === "" || sessionId === boundId;
      if (shown) setError(null);
      try {
        await keyed.run(toolUseId, async () => {
          if (answer === "grant") {
            await stigmer.session.grantPermission(
              create(GrantPermissionInputSchema, { sessionId, toolUseId }),
            );
            return;
          }
          await stigmer.session.confirmToolUse(
            create(ConfirmToolUseInputSchema, {
              sessionId,
              toolUseId,
              result: answer,
              denyMessage: answer === "deny" ? (denyMessage ?? "") : "",
            }),
          );
        });
      } catch (err) {
        if (shown) setError(toError(err));
        throw err;
      }
    },
    [stigmer, keyed.run, boundId, setError],
  );

  return useMemo(
    () => ({
      answerToolUse,
      submittingToolUseIds: keyed.submittingKeys,
      errorsByToolUseId: keyed.errorsByKey,
      error,
      clearError,
    }),
    [answerToolUse, keyed.submittingKeys, keyed.errorsByKey, error, clearError],
  );
}
