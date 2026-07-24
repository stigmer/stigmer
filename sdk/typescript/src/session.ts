/**
 * Session utilities — hand-written helpers that complement the generated
 * {@link SessionClient} in `./gen/session.ts`.
 *
 * The backend and CLI use a sentinel subject (`"Auto-created session"`) as a
 * placeholder when a session is first created. The {@link GenerateSessionSubject}
 * Temporal activity later replaces it with an LLM-generated title. All display
 * paths must filter this sentinel so it is never shown to end users.
 */

/**
 * Sentinel value the backend writes as a placeholder subject when a session
 * is auto-created. The `GenerateSessionSubject` activity replaces it with an
 * LLM-generated title asynchronously.
 *
 * SDK consumers should never need to reference this directly — the
 * `resolvedSubject` helper and the default in `buildSessionProto` handle it
 * automatically.
 */
export const PENDING_SUBJECT = "Auto-created session";

/**
 * Returns the session subject when it carries a meaningful value, or `null`
 * while it still holds the backend sentinel.
 *
 * All display paths should call this before rendering a session subject so
 * the sentinel is never shown in the UI.
 *
 * Mirrors the Go CLI's `ResolvedSubject` in
 * `client-apps/cli/internal/cli/session/get.go`.
 */
export function resolvedSubject(subject: string | undefined): string | null {
  if (!subject || subject === PENDING_SUBJECT) {
    return null;
  }
  return subject;
}

/**
 * `SessionSpec.metadata` key carrying embedder-supplied session context —
 * standing, per-user context (who the caller is, their experience level,
 * their standing instructions) that the agent runner injects into the
 * system prompt on every turn but the conversation UI never renders
 * (stigmer/stigmer#286).
 *
 * Set it at session creation via `session.create({ metadata })` or the
 * one-call bootstrap's `sessionSpec.metadata`, or use the typed
 * `sessionContext` field on the `@stigmer/react` hooks, which maps onto
 * this key via {@link mergeSessionContext}.
 *
 * Personalization, not authorization: anyone who can create the session
 * can set this value (the same trust level as authoring the first
 * message), so agents treat it as context — never as a credential or a
 * permission grant. It is hidden from the conversation thread, not from
 * the API: `session.get` returns the full spec including this key, so it
 * is not a secrets channel — secrets belong in `runtimeEnv` or
 * Environment resources.
 *
 * Pinned verbatim to `SESSION_CONTEXT_METADATA_KEY` in the runner
 * (`backend/services/runner/src/shared/session-context.ts`), with mirror
 * guard tests on both sides — a drift degrades to the agent simply not
 * receiving the context, never worse.
 */
export const SESSION_CONTEXT_METADATA_KEY = "stigmer.ai/session-context";

/**
 * Fold a typed session-context value into a session's spec metadata map,
 * under {@link SESSION_CONTEXT_METADATA_KEY}.
 *
 * The single owner of the precedence rule: a non-blank `sessionContext`
 * wins over any value already present under the reserved key in
 * `metadata`. A blank/undefined `sessionContext` leaves `metadata`
 * untouched (returned as-is, possibly `undefined` — callers never send
 * an empty map).
 */
export function mergeSessionContext(
  metadata: Record<string, string> | undefined,
  sessionContext: string | undefined,
): Record<string, string> | undefined {
  const context = sessionContext?.trim();
  if (!context) {
    return metadata;
  }
  return { ...metadata, [SESSION_CONTEXT_METADATA_KEY]: context };
}
