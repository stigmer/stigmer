/**
 * The API-token identity verifier (O3, 20260827.06) — the first OSS entry
 * on the chassis's verifier chain, the TS rendering of the cloud's
 * OpaqueTokenAuthenticationProvider + RedisApiKeyIntrospector pair minus
 * the cache (lookup.ts carries the no-cache rationale: instant
 * revocation).
 *
 * Claim rule: the `stk_` prefix, case-insensitive (the Java provider's
 * startsWithIgnoreCase). Everything else passes to the next verifier.
 * A recognized token that fails verification THROWS (identity.ts
 * contract) with the wire copy the Java interceptor's classifyAuthError
 * produces for the introspector's failures, byte-pinned:
 *
 *   - unknown/revoked key → "invalid token" (Java: the introspector's
 *     "revoked or unknown" description classifies to the fallback arm);
 *   - expired key → "token has expired" (the "expired" keyword arm).
 *
 * Identity: the key authenticates AS ITS OWNING USER (the verified Java
 * posture — an API-key principal is indistinguishable downstream from a
 * JWT login). The owner is the key's creator,
 * status.audit.spec_audit.created_by (the Java owner extractor's actual
 * read), whose actor row also carries the email/displayName the audit
 * seam wants. Expiry is "expires_at set and past"; never_expires is
 * deliberately not read — Java parity (never-expiring keys leave
 * expires_at unset).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
import { hashApiKey, isApiKeyToken } from "./keymaterial.js";
import { findApiKeyByHash } from "./lookup.js";

/** Java classifyAuthError's fallback arm — the unknown/revoked-key copy. */
export const INVALID_TOKEN_MESSAGE = "invalid token";

/** Java classifyAuthError's "expired" arm. */
export const TOKEN_EXPIRED_MESSAGE = "token has expired";

export function newApiKeyIdentityVerifier(store: Store): IdentityVerifier {
  return {
    name: "apikey",
    async verify(token: string): Promise<CallerIdentity | null> {
      if (!isApiKeyToken(token)) {
        return null;
      }
      const key = await findApiKeyByHash(store, hashApiKey(token));
      if (key === undefined) {
        throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
      }
      const expiresAt = key.spec?.expiresAt;
      if (expiresAt !== undefined && timestampDate(expiresAt) <= new Date()) {
        throw new ConnectError(TOKEN_EXPIRED_MESSAGE, Code.Unauthenticated);
      }
      const owner = key.status?.audit?.specAudit?.createdBy;
      if (owner === undefined || owner.id === "") {
        // A key without creator attribution cannot authenticate as anyone —
        // fail closed with the fallback copy (unreachable for keys created
        // through the pipeline; guards hand-seeded or corrupted rows).
        throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
      }
      return {
        identityId: owner.id,
        callerClass: "user",
        issuer: "",
        rawToken: token,
        ...(owner.email !== "" ? { email: owner.email } : {}),
        ...(owner.displayName !== "" ? { displayName: owner.displayName } : {}),
      };
    },
  };
}
