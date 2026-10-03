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
 * The stamp is then resolved to the owner's account through the
 * identity-account domain's `accountForStamp`
 * (domain/identityaccount/resolve.ts), the read the runner-subject and
 * schedule-fire lanes make of a row's creator: by account id (the stamp
 * of every key a provisioned owner mints), then as the raw issuer subject
 * a key minted before its owner was provisioned carries, so no write over a legacy key
 * mints a raw-subject stamp again. One primary-key read for an
 * account-id stamp, hit or miss (no account carries an `ida_` as its
 * subject, so no subject read follows a miss); a raw-subject stamp costs
 * a second. No cache. On a hit the caller is the account's principal
 * (domain/identityaccount/actor.ts `principalOf`): its id, and the email
 * and display name the row carries, the stamp's own standing in where
 * the row says nothing (actor.ts has the rule). A key minted over a
 * session whose token carried no profile claims recorded an empty actor,
 * and passing that on left
 * every resource created with the key naming an id and nothing else
 * (stigmer/stigmer#1226). The credential checks run first, so a revoked
 * or expired key never reaches the account store.
 *
 * An account-id stamp that names no account is a key whose owner was
 * deleted, and it is refused with the unknown-key copy, "invalid token"
 * (stigmer/stigmer#1765): nothing deletes a key with its owner, and
 * admitting it would let a deleted person's credential act as their old
 * id with whatever grants outlived them. The check lives here, not in a
 * caller guard, because this is where the owner's row is already read;
 * the hosted edition guarded it one layer up only while open source had
 * no account domain. The refusal is logged with the key's id and the
 * owner's account id, never the token, and records no use. It holds only
 * while no account answers for the id: a direct account's id is derived
 * from its issuer subject, so the same person signing up again brings
 * the id, and these keys, back (stigmer/stigmer#1771). A raw-subject
 * stamp that names no account is different: its owner has not been
 * provisioned yet, and is admitted idp-shaped exactly as the OIDC lane
 * admits that subject.
 *
 * One stamp names nobody by construction: the operator's from before
 * sign-in was turned on (stigmer/stigmer#1169). A key created while the
 * server trusted every caller carries the operator's email, or "system",
 * and once sign-in is on the operator is a different account, derived
 * from the issuer's subject. Carrying the key to either account was
 * weighed and refused. Carried to the pre-sign-in account, it would be a
 * live credential no signed-in person could see or revoke, since only a
 * key's owner may. Carried to the signed-in account, a credential would
 * change hands on an email match. So such a key is refused by name:
 * UNAUTHENTICATED, API_KEY_CREATED_BEFORE_SIGN_IN_MESSAGE and the
 * API_KEY_CREATED_BEFORE_SIGN_IN reason, which the CLI turns into the two
 * commands that fix it. The alternative, admitting a bare email, made
 * every later check fail as a misleading "Permission denied". The
 * question is asked only of a stamp that is not an account id and
 * resolved to nobody, through the identity-account domain's
 * `isPreSignInOperatorStamp`. This verifier is composed only under an
 * authentication posture (boot/compose.ts), so a server that trusts every
 * caller never reaches the refusal. The reason is documented where a
 * key's authentication is (apis/ai/stigmer/iam/apikey/v1/README.md): it
 * can refuse any RPC, so no single RPC comment owns it.
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
import { unauthenticatedWithReasonError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { principalOf } from "../identityaccount/actor.js";
import { isAccountIdShaped } from "../identityaccount/constants.js";
import {
  accountForStamp,
  isPreSignInOperatorStamp,
} from "../identityaccount/resolve.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import { hashApiKey, isApiKeyToken } from "./keymaterial.js";
import { findApiKeyByHash } from "./lookup.js";

/** Java classifyAuthError's fallback arm — the unknown/revoked-key copy. */
export const INVALID_TOKEN_MESSAGE = "invalid token";

/** Java classifyAuthError's "expired" arm. */
export const TOKEN_EXPIRED_MESSAGE = "token has expired";

/**
 * The ErrorInfo reason a key created before sign-in was turned on is
 * refused with (stigmer/stigmer#1169). Wire contract, no metadata.
 */
export const API_KEY_CREATED_BEFORE_SIGN_IN = "API_KEY_CREATED_BEFORE_SIGN_IN";

/** The copy of that refusal: what happened and what to do. */
export const API_KEY_CREATED_BEFORE_SIGN_IN_MESSAGE =
  "this API key was created before sign-in was turned on and no longer authenticates anyone; sign in and create a new key";

export interface ApiKeyVerifierDeps {
  /** Where the keys live — the generic Store, by hash (lookup.ts). */
  readonly store: Store;
  /** The identity-account domain's reads the creator stamp resolves through: by id, then by subject. */
  readonly accounts: AccountsByCaller;
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
      const stamped = {
        identityId: owner.id,
        ...(owner.email !== "" ? { email: owner.email } : {}),
        ...(owner.displayName !== "" ? { displayName: owner.displayName } : {}),
      };
      const account = await accountForStamp(accounts, owner.id);
      if (account === undefined) {
        if (isAccountIdShaped(owner.id)) {
          logger.info(
            "API key refused: its owner's identity account no longer exists",
            {
              keyId: key.metadata?.id ?? "",
              identityId: owner.id,
            },
          );
          throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
        }
        if (await isPreSignInOperatorStamp(accounts, owner.id)) {
          throw unauthenticatedWithReasonError(
            API_KEY_CREATED_BEFORE_SIGN_IN_MESSAGE,
            { reason: API_KEY_CREATED_BEFORE_SIGN_IN },
          );
        }
      }
      await recordKeyUse(store, logger, key, now);
      return {
        ...(account === undefined ? stamped : principalOf(account, stamped)),
        callerClass: "user",
        issuer: "",
        rawToken: token,
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
