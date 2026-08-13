"use client";

import { createContext, useContext } from "react";

/**
 * App-level approval defaults for interactive sessions (#302).
 *
 * These are the *host's* defaults, not the platform's: an embedding product
 * that has judged its whole surface trusted — e.g. a desktop app whose
 * sessions operate on the user's own local folder, where the apply-then-
 * review file ledger is the safety net — can pre-arm what a user would
 * otherwise opt into at the first approval gate. The user always keeps the
 * last word: the session UI shows its "Auto-approving tool calls" notice
 * from the first render, with the same "Turn off" affordance as a
 * gate-armed preference.
 */
export interface ApprovalDefaults {
  /**
   * Start interactive sessions with the session-scoped auto-approve
   * preference armed, and create their bootstrap executions with
   * `auto_approve_all` set.
   *
   * Equivalent to the user clicking "Approve & don't ask again" before the
   * first gate, applied as a product decision. Defaults to off — omitting
   * the provider prop keeps today's fail-closed behavior exactly.
   */
  readonly autoApproveAll?: boolean;
}

/**
 * React context for app-level approval defaults.
 *
 * Separated from the provider to mirror the `ExecutionTargetContext`
 * pattern and avoid circular imports.
 *
 * `undefined` means the host configured nothing — every approval default
 * stays platform-standard (fail-closed gates, opt-in at the gate).
 */
export const ApprovalDefaultsContext = createContext<
  ApprovalDefaults | undefined
>(undefined);

/**
 * Read the app-level approval defaults from the nearest `StigmerProvider`.
 *
 * Consumed by the interactive-session surface only: `useNewSessionFlow`
 * (bootstrap execution create) and `useSessionPageFlow` (session-scoped
 * preference initializer). Deliberately NOT consumed by the lower-level
 * `useCreateSession` / `useCreateAgentExecution` primitives — those are
 * shared by specialized flows (workflow architect/explain/diagnose) and by
 * headless callers, which pass `autoApproveAll` explicitly when they mean
 * it.
 */
export function useApprovalDefaults(): ApprovalDefaults | undefined {
  return useContext(ApprovalDefaultsContext);
}
