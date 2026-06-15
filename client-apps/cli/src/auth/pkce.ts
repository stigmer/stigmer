// PKCE (RFC 7636) helpers for the authorization-code flow.
//
// The verifier is a high-entropy random string; its SHA-256 hash (the
// "challenge", S256 method) is sent on /authorize, and the raw verifier is sent
// on /token. Auth0 checks they correspond, proving the same client that started
// the flow is completing it — without ever transmitting a client secret.

import { createHash, randomBytes } from "node:crypto";

// 32 random bytes -> 43-char base64url string, within RFC 7636's 43–128 range.
const VERIFIER_BYTES = 32;

/** Generate a cryptographically random PKCE code_verifier (base64url). */
export function generateVerifier(): string {
  return randomBytes(VERIFIER_BYTES).toString("base64url");
}

/** Derive the S256 code_challenge for a verifier: base64url(sha256(verifier)). */
export function challengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Generate a random OAuth `state` value for CSRF protection. */
export function generateState(): string {
  return randomBytes(VERIFIER_BYTES).toString("base64url");
}
