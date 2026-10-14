/**
 * The user-token verifier: open source's one platform-token lane. It
 * claims a token with `iss: "stigmer"` and NO `token_type` (the user token
 * the mint signs) and passes every other token on:
 *   - a token that is not a platform token is another verifier's (the
 *     OIDC verifier's, an API key's);
 *   - a typed platform token (guest, schedule, channel, the sandbox
 *     family) belongs to the edition that mints it; open source verifies
 *     only its own vocabulary, and on a server with no verifier for that
 *     lane the chain refuses it as unclaimed.
 * A platform token whose signature, expiry, audience or subject fails is
 * refused here with the envelope's pinned copy, whichever lane it names.
 *
 * Liveness is the verifier's (not a guard's), so every lane that
 * authenticates (the serving chain and the extension HTTP edges that run
 * the verifier chain without guards) refuses a token whose minting service
 * account is gone on the next request. Deleting the account is how an
 * organization signs out everyone its key let in; rotating the account's
 * key leaves them signed in, because the token names the account, not the
 * key. A store fault propagates as the infrastructure fault it is, never
 * as a revocation.
 *
 * Composed between `apikey` and `oidc`, only under an authentication
 * posture (compose.ts), so a platform token is claimed by its own lane
 * whatever issuer an operator configures (stigmer#1137's lesson).
 *
 * The identity is the account the token was minted for: `sub` IS the
 * account id (the mint signs it), so no read of that account is needed;
 * class `user`, issuer "stigmer", the token carried (the memory-capture
 * gate and the origin guard read its `minted_by`, guards decoding their own
 * skip logic from the raw token as extensions/caller-guards.ts
 * prescribes), the email and name the product asserted, for display only,
 * and the minting service account as `mintedBy` for the audit-actor seam,
 * so every resource an app user writes names the machine that let them in.
 *
 * Every user token is bound to the organization its `org` claim names
 * (`boundOrg`; authorization/credential-binding.ts): the mint writes the
 * minting account's organization there, or one of its child
 * organizations, so an app user works in that organization only. A token
 * with no `org` claim, one whose minter is not a service account, or one
 * that names an organization that is neither the minter's nor a child of
 * it (one read of the named row) is refused: the mint never signs any of
 * them, and a token that names no organization must never fall back to
 * speaking for the person everywhere.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../extensions/identity.js";
import {
  PLATFORM_TOKEN_ISSUER,
  platformTokenRefusalError,
  stringClaim,
  verifyPlatformToken,
} from "../../platformtoken/envelope.js";
import type { PlatformTokenKeyRing } from "../../platformtoken/key-ring.js";
import type { Store } from "../../store/interface.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import { isChildOf } from "../organization/children.js";
import {
  DELETED_MINTER_MESSAGE,
  TOKEN_NAMES_NO_MINTER_MESSAGE,
  TOKEN_ORGANIZATION_MISMATCH_MESSAGE,
  USER_TOKEN_CLAIMS,
} from "./constants.js";

export interface UserTokenVerifierDeps {
  readonly keys: PlatformTokenKeyRing;
  /** Where the minting service account is read, on every request. */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  /** Where a child organization a token names is read. */
  readonly store: Pick<Store, "getResource">;
  readonly now?: () => Date;
}

export function newUserTokenVerifier(
  deps: UserTokenVerifierDeps,
): IdentityVerifier {
  return {
    name: "user-token",
    async verify(token: string): Promise<CallerIdentity | null> {
      const result = verifyPlatformToken(deps.keys, token, deps.now?.());
      switch (result.outcome) {
        case "foreign":
          return null;
        case "refused":
          throw platformTokenRefusalError(result.refusal);
        case "verified":
          break;
        default: {
          const exhaustive: never = result;
          throw new Error(`unknown verification ${JSON.stringify(exhaustive)}`);
        }
      }
      const verified = result.token;
      if (verified.tokenType !== undefined) {
        return null;
      }
      const mintedBy = stringClaim(verified.payload, USER_TOKEN_CLAIMS.mintedBy);
      if (mintedBy === undefined || mintedBy === "") {
        throw new ConnectError(
          TOKEN_NAMES_NO_MINTER_MESSAGE,
          Code.Unauthenticated,
        );
      }
      const minter = await deps.accounts.findById(mintedBy);
      if (
        minter === undefined ||
        minter.spec?.provisioningMode !==
          IdentityAccountProvisioningMode.service_account
      ) {
        throw new ConnectError(DELETED_MINTER_MESSAGE, Code.Unauthenticated);
      }
      const boundOrg = stringClaim(verified.payload, USER_TOKEN_CLAIMS.org);
      const minterOrg = minter.metadata?.org ?? "";
      if (
        boundOrg === undefined ||
        boundOrg === "" ||
        (boundOrg !== minterOrg &&
          !(await isChildOf(deps.store, boundOrg, minterOrg)))
      ) {
        throw new ConnectError(
          TOKEN_ORGANIZATION_MISMATCH_MESSAGE,
          Code.Unauthenticated,
        );
      }
      const email = stringClaim(verified.payload, USER_TOKEN_CLAIMS.email);
      const displayName = stringClaim(verified.payload, USER_TOKEN_CLAIMS.name);
      return {
        identityId: verified.subject,
        callerClass: "user",
        issuer: PLATFORM_TOKEN_ISSUER,
        rawToken: token,
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        mintedBy,
        boundOrg,
      };
    },
  };
}
