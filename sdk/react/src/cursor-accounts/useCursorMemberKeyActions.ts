"use client";

import { useCallback, useState } from "react";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Input for adding one member key. */
export interface AddCursorMemberKeyInput {
  readonly accountId: string;
  /**
   * Plaintext user-scoped Cursor API key. The server identifies it via
   * Cursor's `/v1/me` and binds it to its owning team member; admin and
   * service-account keys are rejected with Cursor's own explanation —
   * surface the error verbatim.
   */
  readonly apiKey: string;
  /** Optional operator label. */
  readonly label?: string;
}

/** Input for removing one member key. */
export interface RemoveCursorMemberKeyInput {
  readonly accountId: string;
  readonly keyId: string;
  /**
   * Removal is refused while live sessions are pinned to this key.
   * `force: true` overrides; prefer disabling (always safe).
   */
  readonly force?: boolean;
}

/** Return value of {@link useCursorMemberKeyActions}. */
export interface UseCursorMemberKeyActionsReturn {
  /** Add one execution-capable member key. Returns the redacted account. */
  readonly addKey: (input: AddCursorMemberKeyInput) => Promise<CursorAccount>;
  /** Remove one member key (live-pin guarded). */
  readonly removeKey: (input: RemoveCursorMemberKeyInput) => Promise<CursorAccount>;
  /** Enable/disable one key for NEW-session selection (pins unaffected). */
  readonly setKeyEnabled: (
    accountId: string,
    keyId: string,
    enabled: boolean,
  ) => Promise<CursorAccount>;
  /** `true` while any key mutation is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook bundling the member-key mutations of one Cursor account —
 * add, remove, enable/disable. One hook because the console's key panel
 * performs all three and they share submit/error surfaces.
 *
 * Rotation is deliberately remove + add (no in-place key swap), so the
 * server-side `/v1/me` identity binding can never go stale.
 */
export function useCursorMemberKeyActions(): UseCursorMemberKeyActionsReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (op: () => Promise<CursorAccount>): Promise<CursorAccount> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await op();
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const addKey = useCallback(
    (input: AddCursorMemberKeyInput) =>
      run(() => stigmer.cursorAccounts.addMemberKey(input)),
    [run, stigmer.cursorAccounts],
  );

  const removeKey = useCallback(
    (input: RemoveCursorMemberKeyInput) =>
      run(() => stigmer.cursorAccounts.removeMemberKey(input)),
    [run, stigmer.cursorAccounts],
  );

  const setKeyEnabled = useCallback(
    (accountId: string, keyId: string, enabled: boolean) =>
      run(() =>
        stigmer.cursorAccounts.setMemberKeyEnabled({ accountId, keyId, enabled }),
      ),
    [run, stigmer.cursorAccounts],
  );

  const clearError = useCallback(() => setError(null), []);

  return { addKey, removeKey, setKeyEnabled, isSubmitting, error, clearError };
}
