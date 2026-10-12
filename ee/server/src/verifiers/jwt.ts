/**
 * Shared JWT plumbing for the verifier entries that read a JWT (the
 * federated IdP's, and a host's own, such as a platform token or a direct
 * login): structural decode (claim-or-pass needs a peek at iss before any
 * cryptography), RS256 signature verification over node:crypto, and the aud
 * comparison that accepts both JWT audience forms. Key DISCOVERY for the
 * OIDC-class lanes lives beside this in jwks.ts. Verification POLICY (which
 * issuer, which keys, which failures throw) stays in each verifier — these
 * modules own only the mechanics they must not fork.
 */
import { createVerify, type KeyObject } from "node:crypto";

export interface DecodedJwt {
  readonly header: { readonly alg?: unknown; readonly kid?: unknown };
  readonly payload: Record<string, unknown>;
  readonly signedPart: string;
  readonly signature: Buffer;
}

/**
 * A compact JWT part: unpadded base64url, the only encoding RFC 7515 §2
 * allows. Node's base64url decoder skips any other character, so without
 * this one signed token would have many accepted spellings.
 */
const BASE64URL_PART = /^[A-Za-z0-9_-]*$/;

/**
 * Structurally decodes a compact JWT. Undefined when the string is not a
 * decodable three-part JWT — the claim-or-pass contract's "not ours at
 * all" arm, never an error. A part carrying any character outside the
 * base64url alphabet is not a JWT, so a token has exactly one spelling;
 * the header and the payload must be present, and the signature may be
 * empty (an unsigned token decodes, and signature verification refuses
 * it).
 */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  if (
    rawHeader === "" ||
    rawPayload === "" ||
    !BASE64URL_PART.test(rawHeader) ||
    !BASE64URL_PART.test(rawPayload) ||
    !BASE64URL_PART.test(rawSignature)
  ) {
    return undefined;
  }
  try {
    const header = JSON.parse(
      Buffer.from(rawHeader, "base64url").toString("utf8"),
    ) as DecodedJwt["header"];
    const payload = JSON.parse(
      Buffer.from(rawPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (header === null || typeof header !== "object") {
      return undefined;
    }
    if (payload === null || typeof payload !== "object") {
      return undefined;
    }
    return {
      header,
      payload,
      signedPart: `${rawHeader}.${rawPayload}`,
      signature: Buffer.from(rawSignature, "base64url"),
    };
  } catch {
    return undefined;
  }
}

/** RS256 signature check against one public key. */
export function verifiesRs256(decoded: DecodedJwt, key: KeyObject): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(decoded.signedPart);
  return verifier.verify(key, decoded.signature);
}

/** JWT aud may be a string or an array; either form may name us. */
export function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") {
    return aud === expected;
  }
  return Array.isArray(aud) && aud.includes(expected);
}
