/**
 * Normalize an unknown caught value into an {@link Error}.
 *
 * SDK client methods always throw {@link StigmerError} (which extends
 * `Error`), so the `instanceof` branch covers all normal RPC failures.
 * The fallback handles edge cases where non-Error values are thrown
 * (e.g., a rejected promise with a string).
 *
 * Preserves the original error identity — callers can still use
 * `classifyError`, `getUserMessage`, and `getRpcMetadata` from
 * `@stigmer/sdk` on the returned value.
 *
 * @internal
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  return new Error("An unexpected error occurred");
}
