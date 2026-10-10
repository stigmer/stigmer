"use client";

/**
 * What the reader may do in a conversation, asked of the server: send
 * messages into it (`can_create_run_in`, its owners and participants) and
 * decide on its runs (`can_edit`, its owners: stopping, approvals and file
 * decisions are `run#can_edit`, which is the session owner's).
 *
 * Pass `null` to ask nothing (a guest's or an observer's presentation is
 * already decided). Both checks fail open, so a transient error never
 * hides a control; the server refuses whatever the answer misses.
 */
import { useMemo } from "react";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/** Return value of {@link useSessionAccess}. */
export interface UseSessionAccessReturn {
  /** Whether the reader may send messages into the conversation. */
  readonly canSend: boolean;
  /** Whether the reader may stop its runs and make their decisions. */
  readonly canDecide: boolean;
}

/**
 * Self-checks on a conversation for the console's presentation of it.
 *
 * @param sessionId - The conversation to ask about, or `null` to skip.
 */
export function useSessionAccess(sessionId: string | null): UseSessionAccessReturn {
  const resource = useMemo(
    () => (sessionId ? { kind: "session", id: sessionId } : null),
    [sessionId],
  );
  const { allowed: canSend } = useCheckPermission(resource, "can_create_run_in");
  const { allowed: canDecide } = useCheckPermission(resource, "can_edit");
  return useMemo(() => ({ canSend, canDecide }), [canSend, canDecide]);
}
