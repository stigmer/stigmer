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
