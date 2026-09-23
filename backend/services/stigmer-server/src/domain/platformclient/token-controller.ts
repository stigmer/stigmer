/**
 * PlatformClientTokenController — the two public token RPCs, registered in
 * every composition so the service has one owner (the routes stage refuses
 * an extension that registers it again, boot/route-shadowing.ts):
 *
 *   - mintUserToken: the PlatformClient mint (mint.ts). Public on the wire
 *     — the client authenticates with its credentials in the body, not a
 *     bearer token — so there is no annotation to evaluate; the mint never
 *     reads the chain's caller.
 *   - mintGuestToken: the credential-free mint for anonymous visitors of a
 *     shared agent's hosted page, dispatched to the composed guest-token
 *     capability (extensions/guest-token-minting.ts). Without one — open
 *     source hosts no shared-agent pages — it answers UNIMPLEMENTED with
 *     the edition sentence, the identityFederation absent shape.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";

import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";

import type { GuestTokenMinting } from "../../extensions/guest-token-minting.js";
import { GUEST_MINT_UNIMPLEMENTED_MESSAGE } from "./constants.js";
import { mintUserToken } from "./mint.js";
import type { PlatformClientMintDeps } from "./mint.js";

export interface PlatformClientTokenControllerDeps {
  readonly mint: PlatformClientMintDeps;
  /** The composed capability; undefined = mintGuestToken refuses UNIMPLEMENTED. */
  readonly guestTokenMinting: GuestTokenMinting | undefined;
}

/** Registers the token service on the router (routes stage). */
export function registerPlatformClientTokenService(
  router: ConnectRouter,
  deps: PlatformClientTokenControllerDeps,
): void {
  router.service(PlatformClientTokenController, {
    mintUserToken: (request) => mintUserToken(deps.mint, request),
    mintGuestToken: (request, ctx) => {
      if (deps.guestTokenMinting === undefined) {
        throw new ConnectError(GUEST_MINT_UNIMPLEMENTED_MESSAGE, Code.Unimplemented);
      }
      return deps.guestTokenMinting.mintGuestToken(request, ctx.requestHeader);
    },
  });
}
