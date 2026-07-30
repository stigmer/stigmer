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

/** The `token_type` claim value of a session sandbox token. */
export const TOKEN_TYPE_SANDBOX = "sandbox";

/** The `token_type` claim value of a warm-pool member's pre-claim credential. */
export const TOKEN_TYPE_POOL_SANDBOX = "pool_sandbox";

const CLAIM_TOKEN_TYPE = "token_type";
const CLAIM_SESSION_ID = "session_id";

/**
 * Extract one string claim from a JWT without verifying it.
 *
 * Returns undefined for null/malformed tokens and for tokens without the
 * claim — callers branch on the specific value, so "unknown" and "absent"
 * collapse to the same answer.
 */
function claimOf(
  token: string | null | undefined,
  claim: string,
): string | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const value = payload[claim];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Extract the `token_type` claim (e.g. a user's Auth0 token has none). */
export function tokenTypeOf(token: string | null | undefined): string | undefined {
  return claimOf(token, CLAIM_TOKEN_TYPE);
}

/**
 * Extract the `session_id` claim of a session-scoped token. A claimed pool
 * member reads its post-claim identity from this on restart.
 */
export function sessionIdClaimOf(token: string | null | undefined): string | undefined {
  return claimOf(token, CLAIM_SESSION_ID);
}

/** Whether the token is a bootstrap-minted `embedded_runner` credential. */
export function isEmbeddedRunnerToken(token: string | null | undefined): boolean {
  return tokenTypeOf(token) === TOKEN_TYPE_EMBEDDED_RUNNER;
}
