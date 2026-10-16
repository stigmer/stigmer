/**
 * TokenService — the two token RPCs, registered in every composition so
 * the service has one owner (the routes stage refuses an extension that
 * registers it again, boot/route-shadowing.ts):
 *
 *   - mintUserToken: a service account's key mints a user token for one of
 *     its organization's people (mint.ts), authorized by the method's
 *     annotation like any other RPC.
 *   - mintGuestToken: the credential-free mint for anonymous visitors of a
 *     shared agent's hosted page, dispatched to the composed guest-token
 *     capability (extensions/guest-token-minting.ts). Without one (open
 *     source hosts no shared-agent pages) it answers UNIMPLEMENTED with
 *     the edition sentence.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";

import { TokenService } from "@stigmer/apis/ai/stigmer/iam/token/v1/token_pb";

import type { GuestTokenMinting } from "../../extensions/guest-token-minting.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { GUEST_MINT_UNIMPLEMENTED_MESSAGE } from "./constants.js";
import { mintUserToken } from "./mint.js";
import type { UserTokenMintDeps } from "./mint.js";

export interface TokenServiceDeps {
  readonly mint: UserTokenMintDeps;
  /** The composed capability; undefined = mintGuestToken refuses UNIMPLEMENTED. */
  readonly guestTokenMinting: GuestTokenMinting | undefined;
}

/** Registers the token service on the router (routes stage). */
export function registerTokenService(
  router: ConnectRouter,
  deps: TokenServiceDeps,
): void {
  router.service(TokenService, {
    mintUserToken: (request, ctx) =>
      mintUserToken(deps.mint, request, callerIdentityOf(ctx)),
    mintGuestToken: (request, ctx) => {
      if (deps.guestTokenMinting === undefined) {
        throw new ConnectError(
          GUEST_MINT_UNIMPLEMENTED_MESSAGE,
          Code.Unimplemented,
        );
      }
      return deps.guestTokenMinting.mintGuestToken(request, ctx.requestHeader);
    },
  });
}
