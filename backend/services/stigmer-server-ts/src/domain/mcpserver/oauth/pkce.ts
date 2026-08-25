/**
 * PKCE pair generation — ports pkg/domain/mcpserver/oauth/pkce.go.
 * Always S256: RFC 7636 and OAuth 2.1 require it, and initiate refuses
 * authorization servers that do not support it (discovery.ts).
 */
import { createHash, randomBytes } from "node:crypto";

/** A PKCE code verifier and its corresponding S256 challenge. */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Creates a cryptographically random PKCE pair using the S256 method.
 *
 * The code verifier is a 32-byte random value encoded as base64url (no
 * padding). The code challenge is the SHA-256 hash of the verifier, also
 * base64url-encoded.
 */
export function generatePkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");
  return { codeVerifier: verifier, codeChallenge: challenge };
}
