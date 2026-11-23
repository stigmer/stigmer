/**
 * The run credential's wire vocabulary — the key a dispatch carries it under,
 * and its one reader.
 *
 * A run credential is the token the control plane mints for ONE execution at
 * dispatch (`execution_context_token` on the workflow input, 2026-09-16) so
 * that the runner — one long-lived process keyed with one operator's API key,
 * serving every member's runs — can act as the run's own human on that run's
 * RPCs. Under a server with sign-in on, the credential's bearer IS the run's
 * person for as long as the run lives; a dispatch with no credential (the
 * cloud's) leaves the runner on its process credential. The runner never decodes
 * or judges the credential: it presents, the server judges
 * (`client/token-claims.ts`).
 *
 * The server's dispatches — the Execute* turn activities and
 * GenerateSessionSubject — carry it on the activity INPUT under
 * {@link RUN_CREDENTIAL_INPUT_KEY}, the same key the workflow input uses (a
 * cross-component wire contract; the server's
 * temporal/agentexecution/workflows/invoke-agent-execution.ts builds it).
 *
 * A turn sent to a runner shared by many organizations carries it sealed
 * instead, under {@link SEALED_RUN_CREDENTIAL_INPUT_KEY}: the server seals it
 * with its payload key so its workflow history never shows it in the clear,
 * and the runner opens it with the same key (`@stigmer/temporal-codecs`
 * `openSealedString`). At most one of the two keys is present.
 *
 * One reader: `interceptors/run-credential-activity.ts` enters the store
 * (`run-credential-store.ts`) at the activity boundary, opening a sealed
 * credential first, and the control plane's clients read it per request
 * (`run-credential-store.ts` names them). No activity body touches a
 * credential.
 */

/**
 * The snake_case key under which a dispatch's input object carries the run
 * credential. Byte-pinned: the same name on the invoke workflow input, on
 * `ExecuteActivityInput`, on `GenerateSessionSubjectInput` and on the connect
 * lane's input (where it names a DIFFERENT, clocked token that this reader
 * never sees — that lane hands its token per call).
 */
export const RUN_CREDENTIAL_INPUT_KEY = "execution_context_token" as const;

/**
 * The run credential an activity input carries, or `undefined` when the
 * argument is not an object carrying a non-empty string under the key —
 * positional string arguments (EnsureThread's), the connect lane's camelCase
 * input, and a credential-less dispatch's object all answer `undefined`.
 */
export function readRunCredentialFromInput(arg: unknown): string | undefined {
  if (arg === null || typeof arg !== "object") {
    return undefined;
  }
  const value = (arg as Record<string, unknown>)[RUN_CREDENTIAL_INPUT_KEY];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The snake_case key under which a dispatch to a shared runner carries the
 * run credential sealed (the module header). Byte-pinned: the server's
 * invoke workflow writes it on `ExecuteActivityInput` and
 * `GenerateSessionSubjectInput`.
 */
export const SEALED_RUN_CREDENTIAL_INPUT_KEY = "sealed_execution_context_token" as const;

/** The sealed run credential an activity input carries, by the same rule as {@link readRunCredentialFromInput}. */
export function readSealedRunCredentialFromInput(arg: unknown): string | undefined {
  if (arg === null || typeof arg !== "object") {
    return undefined;
  }
  const value = (arg as Record<string, unknown>)[SEALED_RUN_CREDENTIAL_INPUT_KEY];
  return typeof value === "string" && value !== "" ? value : undefined;
}
