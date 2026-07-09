/**
 * Read-only claim inspection for the runner's own credentials.
 *
 * The runner never verifies signatures — the server does that. It only needs
 * to look at its own token's `token_type` claim to decide which credential
 * flow applies (e.g. "do I hold an unscoped bootstrap credential that must be
 * exchanged for a scoped one before an ExecutionContext read?"). Claim names
 * and values mirror the server's single source of truth,
 * `StigmerTokenType` (stigmer-cloud, api-authentication).
 */

/** The `token_type` claim value of a bootstrap-minted embedded runner token. */
export const TOKEN_TYPE_EMBEDDED_RUNNER = "embedded_runner";

const CLAIM_TOKEN_TYPE = "token_type";

/**
 * Extract the `token_type` claim from a JWT without verifying it.
 *
 * Returns undefined for null/malformed tokens and for tokens without the
 * claim (e.g. a user's Auth0 token) — callers branch on the specific value,
 * so "unknown" and "absent" collapse to the same answer.
 */
export function tokenTypeOf(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const tokenType = payload[CLAIM_TOKEN_TYPE];
    return typeof tokenType === "string" ? tokenType : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the token is a bootstrap-minted `embedded_runner` credential. */
export function isEmbeddedRunnerToken(token: string | null | undefined): boolean {
  return tokenTypeOf(token) === TOKEN_TYPE_EMBEDDED_RUNNER;
}
