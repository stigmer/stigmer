/**
 * The PlatformClient user-token verifier: open source's one platform-token
 * lane. It claims a token with `iss: "stigmer"` and NO `token_type` — the
 * user token the mint signs — and passes every other token on:
 *   - a token that is not a platform token is another verifier's (the
 *     OIDC verifier's, an API key's);
 *   - a typed platform token (guest, schedule, channel, the sandbox
 *     family) belongs to the edition that mints it; open source verifies
 *     only its own vocabulary, and on a server with no verifier for that
 *     lane the chain refuses it as unclaimed.
 * A platform token whose signature, expiry, audience or subject fails is
 * refused here with the envelope's pinned copy, whichever lane it names —
 * the refusal the cloud's verifier has always answered for it.
 *
 * Liveness is the verifier's (not a guard's), so every lane that
 * authenticates — the serving chain and the extension HTTP edges that run
 * the verifier chain without guards — refuses a deleted client's tokens on
 * the next request, with the cloud's copy. A store fault propagates as the
 * infrastructure fault it is, never as a revocation.
 *
 * Composed between `apikey` and `oidc`, only under an authentication
 * posture (compose.ts): the OIDC verifier claims every JWT-shaped token and
 * throws on one it cannot verify, so a platform token must be claimed
 * before it gets there (stigmer#1137's lesson).
 *
 * The identity is the account the token was minted for: `sub` IS the
 * account id (the mint signs it), so no account read is needed; class
 * `user`, issuer "stigmer", the token carried (the memory-capture gate and
 * the origin guard read its `platform_client_id`), and the email and name
 * the platform asserted, for display only.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { CallerIdentity, IdentityVerifier } from "../../extensions/identity.js";
import {
  PLATFORM_TOKEN_ISSUER,
  platformTokenRefusalError,
  stringClaim,
  verifyPlatformToken,
} from "../../platformtoken/envelope.js";
import type { PlatformTokenKeyRing } from "../../platformtoken/key-ring.js";
import {
  DELETED_CLIENT_MESSAGE,
  TOKEN_NAMES_NO_CLIENT_MESSAGE,
  USER_TOKEN_CLAIMS,
} from "./constants.js";
import type { PlatformClientStore } from "./store.js";

export interface PlatformClientTokenVerifierDeps {
  readonly keys: PlatformTokenKeyRing;
  readonly clients: Pick<PlatformClientStore, "findById">;
  readonly now?: () => Date;
}

export function newPlatformClientTokenVerifier(
  deps: PlatformClientTokenVerifierDeps,
): IdentityVerifier {
  return {
    name: "platform-client",
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
      const platformClientId = stringClaim(
        verified.payload,
        USER_TOKEN_CLAIMS.platformClientId,
      );
      if (platformClientId === undefined) {
        throw new ConnectError(TOKEN_NAMES_NO_CLIENT_MESSAGE, Code.Unauthenticated);
      }
      if ((await deps.clients.findById(platformClientId)) === undefined) {
        throw new ConnectError(DELETED_CLIENT_MESSAGE, Code.Unauthenticated);
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
      };
    },
  };
}
