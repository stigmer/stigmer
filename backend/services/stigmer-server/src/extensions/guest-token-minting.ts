/**
 * The guest-token capability: `PlatformClientTokenController.mintGuestToken`,
 * the credential-free mint for anonymous visitors of a shared agent's
 * hosted page. Single instance, registered as `drivers.guestTokenMinting`
 * (the identityFederation shape: a driver point whose absence is a
 * refusal, never a silent no-op).
 *
 * Why a capability and not a second service: open source registers the
 * whole PlatformClientTokenController, because `mintUserToken` is core,
 * and the composition refuses an extension that registers a service the
 * core already routes. Guest sharing — the hosted page, its rate limits,
 * the share resolution, the org's system-managed client and guest
 * account — is an edition's, so the one method that needs it is
 * dispatched here.
 *
 * Absent, the controller answers UNIMPLEMENTED with the edition sentence
 * (domain/platformclient/constants.ts). Present, the capability owns the
 * whole arm: the request has passed the protovalidate interceptor, and
 * `headers` carries the request's `origin` for the embed checks. It signs
 * with the ring its own composition supplied (`signPlatformToken`).
 */
import type {
  MintGuestTokenRequest,
  MintGuestTokenResponse,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";

export interface GuestTokenMinting {
  mintGuestToken(
    request: MintGuestTokenRequest,
    headers: Headers,
  ): Promise<MintGuestTokenResponse>;
}
