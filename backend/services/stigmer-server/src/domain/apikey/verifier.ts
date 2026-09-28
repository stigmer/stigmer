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
 *
 * The stamp is then resolved the way the OIDC lane resolves `sub`
 * (20260911.11, T01_1_review.md A6; domain/identityaccount/resolve.ts):
 * a key minted before its owner was provisioned carries the raw subject
 * and answers the owner's ACCOUNT id once one exists, so no write over a
 * legacy key mints a raw-subject stamp again; a stamp that is already an
 * account id is kept — one primary-key read either way, no cache. Only
 * identityId changes on a hit: email/displayName stay the stamp's, the
 * actor the key recorded at minting. The credential checks run first, so
 * a revoked or expired key never reaches the account store.
 *
 * An accepted key's use is then recorded on its status.last_used_at
 * (identity/credential-use.ts): at most once a resolution, judged from the
 * row this read already holds, written atomically through
 * Store.updateResource so it can never undo a concurrent update of the
 * key, and best-effort — a failed stamp is logged and the request
 * proceeds. A refused key records nothing (stigmer/stigmer#1255).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema, ApiKeyStatusSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../extensions/identity.js";
import { recordCredentialUse } from "../../identity/credential-use.js";
import type { Store } from "../../store/interface.js";
import { identityIdForSubject } from "../identityaccount/resolve.js";
import type { AccountsBySubject } from "../identityaccount/resolve.js";
import { hashApiKey, isApiKeyToken } from "./keymaterial.js";
import { findApiKeyByHash } from "./lookup.js";

/** Java classifyAuthError's fallback arm — the unknown/revoked-key copy. */
export const INVALID_TOKEN_MESSAGE = "invalid token";

/** Java classifyAuthError's "expired" arm. */
export const TOKEN_EXPIRED_MESSAGE = "token has expired";

export interface ApiKeyVerifierDeps {
  /** Where the keys live — the generic Store, by hash (lookup.ts). */
  readonly store: Store;
  /** The identity-account domain's subject lookup the creator stamp resolves through (A6). */
  readonly accounts: AccountsBySubject;
  /** Where a failed last-use stamp is reported. */
  readonly logger: Logger;
  /** The clock both the expiry check and the last-use stamp read. */
  readonly now: () => Date;
}

export function newApiKeyIdentityVerifier(
  deps: ApiKeyVerifierDeps,
): IdentityVerifier {
  const { store, accounts, logger } = deps;
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
      const now = deps.now();
      const expiresAt = key.spec?.expiresAt;
      if (expiresAt !== undefined && timestampDate(expiresAt) <= now) {
        throw new ConnectError(TOKEN_EXPIRED_MESSAGE, Code.Unauthenticated);
      }
      const owner = key.status?.audit?.specAudit?.createdBy;
      if (owner === undefined || owner.id === "") {
        // A key without creator attribution cannot authenticate as anyone —
        // fail closed with the fallback copy (unreachable for keys created
        // through the pipeline; guards hand-seeded or corrupted rows).
        throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
      }
      const identityId = await identityIdForSubject(accounts, owner.id);
      await recordKeyUse(store, logger, key, now);
      return {
        identityId,
        callerClass: "user",
        issuer: "",
        rawToken: token,
        ...(owner.email !== "" ? { email: owner.email } : {}),
        ...(owner.displayName !== "" ? { displayName: owner.displayName } : {}),
      };
    },
  };
}

/** Stamps the accepted key's last use on its own row, atomically. */
function recordKeyUse(
  store: Store,
  logger: Logger,
  key: ApiKey,
  now: Date,
): Promise<void> {
  const id = key.metadata?.id ?? "";
  return recordCredentialUse({
    credential: "api key",
    id,
    lastUsedAt: key.status?.lastUsedAt,
    now,
    logger,
    write: (stamp) =>
      store.updateResource(ApiResourceKind.api_key, id, ApiKeySchema, (live) => {
        live.status ??= create(ApiKeyStatusSchema);
        stamp(live.status);
      }),
  });
}
