"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { AnswerCustomToolUseInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";

/** How an answer to one of the app's own tools is sent. */
export interface CustomToolAnswerOptions {
  /**
   * The tool failed, or the person cancelled: the agent reads the text as
   * the tool's error and can try again or say so. Default `false`.
   */
  readonly isError?: boolean;
}

/** Return value of {@link useAnswerCustomToolUse}. */
export interface UseAnswerCustomToolUseReturn {
  /**
   * Answer a call of one of the app's own tools (a session's
   * `custom_tools`), by its id (`ToolUse.id`, the `agent.custom_tool_use`
   * event's id). The text is what the agent reads as the tool's result.
   *
   * Resolves when the server recorded the answer; the turn resumes on the
   * session's stream once every call and approval it waits on is answered.
   * The same answer sent again resolves (the server replays its first
   * event); a different one rejects, since a call is answered once.
   * Rejects with the server's error, which is also kept per call.
   */
  readonly answerCustomToolUse: (
    sessionId: string,
    customToolUseId: string,
    text: string,
    options?: CustomToolAnswerOptions,
  ) => Promise<void>;
  /** The calls whose answer is in flight, by id. */
  readonly submittingIds: ReadonlySet<string>;
  /**
   * Each call's last failed answer, keyed like {@link submittingIds}.
   * Cleared for a call when it is answered again.
   */
  readonly errorsById: ReadonlyMap<string, Error>;
  /** The most recent failure, or `null`; the map is authoritative. */
  readonly error: Error | null;
  /** Reset every answer error (both {@link errorsById} and {@link error}). */
  readonly clearError: () => void;
}

/**
 * Behavior hook that answers the calls of an app's own tools
 * (`answerCustomToolUse`), with per-call loading and error state. The
 * twin of `useAnswerToolUse`, which answers approvals: an answer here is
 * content the agent reads, never a verdict.
 *
 * Hosts drawing their own screen use it directly; the session viewer binds
 * it for its tool cards and its `onCustomToolUse` callback.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function RegisterButton({ sessionId, call }: { sessionId: string; call: ToolUse }) {
 *   const { answerCustomToolUse, submittingIds } = useAnswerCustomToolUse();
 *   return (
 *     <button
 *       disabled={submittingIds.has(call.id)}
 *       onClick={() => answerCustomToolUse(sessionId, call.id, "Registered as acct_7Q2F")}
 *     >
 *       Register
 *     </button>
 *   );
 * }
 * ```
 */
export function useAnswerCustomToolUse(): UseAnswerCustomToolUseReturn {
  const stigmer = useStigmer();
  const keyed = useKeyedSubmission<void>();
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    keyed.clearErrors();
    setError(null);
  }, [keyed.clearErrors]);

  const answerCustomToolUse = useCallback(
    async (sessionId: string, customToolUseId: string, text: string, options?: CustomToolAnswerOptions): Promise<void> => {
      setError(null);
      try {
        await keyed.run(customToolUseId, async () => {
          await stigmer.session.answerCustomToolUse(
            create(AnswerCustomToolUseInputSchema, {
              sessionId,
              customToolUseId,
              content: [{ type: "text", text }],
              isError: options?.isError === true,
            }),
          );
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      }
    },
    [stigmer, keyed.run],
  );

  return useMemo(
    () => ({
      answerCustomToolUse,
      submittingIds: keyed.submittingKeys,
      errorsById: keyed.errorsByKey,
      error,
      clearError,
    }),
    [answerCustomToolUse, keyed.submittingKeys, keyed.errorsByKey, error, clearError],
  );
}
