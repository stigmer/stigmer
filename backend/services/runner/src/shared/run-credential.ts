/**
 * The run credential's wire vocabulary — the two places a dispatch can carry
 * it, and the one reader of both.
 *
 * A run credential is the token the control plane mints for ONE execution at
 * dispatch (`execution_context_token` on the workflow input, 2026-09-16) so
 * that the runner — one long-lived process keyed with one operator's API key,
 * serving every member's runs — can act as the run's own human on that run's
 * RPCs. Under a server with sign-in on, the credential's bearer IS the run's
 * person for as long as the run lives; on an older server no credential
 * arrives and the runner behaves exactly as before. The runner never decodes
 * or judges the credential: it presents, the server judges
 * (`client/token-claims.ts`).
 *
 * Two hops carry it, one channel each:
 *
 *   - The SERVER's dispatches — the Execute* turn activities and
 *     GenerateSessionSubject — carry it on the activity INPUT under
 *     {@link RUN_CREDENTIAL_INPUT_KEY}, the same key the workflow inputs use
 *     (a cross-component wire contract; the server's
 *     temporal/agentexecution/workflows/invoke-agent-execution.ts builds it).
 *   - The RUNNER's own dispatches — every activity the serverless-workflow
 *     engine schedules from `workflows/execute-from-execution.ts` — carry it
 *     as a Temporal activity HEADER, {@link RUN_CREDENTIAL_HEADER}, stamped by
 *     the workflow interceptor in `workflows/interceptors/run-credential.ts`.
 *     Headers, not arguments: the engine hands `execution_id` to ten local
 *     activities positionally, and a credential threaded the same way is a
 *     field every future activity has to remember. A header reaches all of
 *     them, and the next one, with no signature learning the word.
 *
 * One reader for both: `interceptors/run-credential-activity.ts` enters the
 * store (`run-credential-store.ts`) at the activity boundary, and
 * `client/stigmer-client.ts` reads it per request. No activity body touches
 * a credential.
 *
 * ISOLATE-SAFE BY CONTRACT: this module is imported by workflow code that
 * runs inside Temporal's deterministic V8 sandbox. It must import nothing
 * from Node and hold no mutable state; the store lives in its own module for
 * exactly that reason.
 */

/**
 * The snake_case key under which a dispatch's input object carries the run
 * credential. Byte-pinned: the same name on both invoke workflow inputs, on
 * `ExecuteActivityInput`, on `GenerateSessionSubjectInput` and on the connect
 * lane's input (where it names a DIFFERENT, clocked token that this reader
 * never sees — that lane hands its token per call).
 */
export const RUN_CREDENTIAL_INPUT_KEY = "execution_context_token" as const;

/**
 * The Temporal activity header the runner's own workflow stamps on every
 * activity it schedules for a run. Byte-pinned wire vocabulary: a rename
 * strands every in-flight run's activities on the process credential.
 */
export const RUN_CREDENTIAL_HEADER = "stigmer-run-credential" as const;

/**
 * The run credential an activity input carries, or `undefined` when the
 * argument is not an object carrying a non-empty string under the key —
 * positional string arguments, the connect lane's camelCase input, and an
 * older server's credential-less object all answer `undefined`.
 */
export function readRunCredentialFromInput(arg: unknown): string | undefined {
  if (arg === null || typeof arg !== "object") {
    return undefined;
  }
  const value = (arg as Record<string, unknown>)[RUN_CREDENTIAL_INPUT_KEY];
  return typeof value === "string" && value !== "" ? value : undefined;
}
