/**
 * The PlatformClient origin guard: a request bearing a user token minted by
 * a client that lists `allowed_origins` must come from one of them. The
 * check needs the request's headers, which a verifier never sees, so it is
 * a caller guard (extensions/caller-guards.ts) — open source's own,
 * composed before any extension's.
 *
 * The rule, the cloud's since the Java service (spec.proto's field doc):
 *   - no `Origin` header, or a blank one: allowed — only browsers send
 *     Origin, and the control is a browser-context defense against a
 *     leaked token replayed from another site's page. The guard reads no
 *     client for such a request, so server-to-server callers pay nothing;
 *   - an empty `allowed_origins`: allowed (open mode);
 *   - otherwise the origin must match an entry case-insensitively (RFC 6454
 *     comparison), and the opaque origin "null" never matches.
 * A refusal is PERMISSION_DENIED with the cloud's copy, logged with the
 * procedure, the client and the origin.
 *
 * Only the untyped user token is the guard's: the claims are read from the
 * token the verifier chain already verified on this request (the pattern
 * caller-guards.ts prescribes), and any other credential — an API key, an
 * OIDC token, a typed platform token — passes untouched. Liveness is not
 * re-checked here beyond the one read the origin needs: the verifier
 * refused a deleted client already, and a client deleted since is refused
 * the same way, fail closed.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { CallerGuard } from "../../extensions/caller-guards.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  TOKEN_TYPE_CLAIM,
  decodeVerifiedPlatformTokenPayload,
  stringClaim,
} from "../../platformtoken/envelope.js";
import {
  DELETED_CLIENT_MESSAGE,
  USER_TOKEN_CLAIMS,
  originRefusalMessage,
} from "./constants.js";
import type { PlatformClientStore } from "./store.js";

/** The opaque-origin serialization, which never matches a listed origin. */
const OPAQUE_ORIGIN = "null";

export interface PlatformClientOriginGuardDeps {
  readonly clients: Pick<PlatformClientStore, "findById">;
  readonly logger: Logger;
}

export function newPlatformClientOriginGuard(
  deps: PlatformClientOriginGuardDeps,
): CallerGuard {
  return {
    name: "platform-client-origin",
    async guard(
      caller: CallerIdentity,
      method: DescMethod,
      headers: Headers,
    ): Promise<void> {
      const origin = headers.get("origin") ?? "";
      if (origin.trim() === "") {
        return;
      }
      const platformClientId = mintingClientOf(caller);
      if (platformClientId === undefined) {
        return;
      }
      const procedure = `/${method.parent.typeName}/${method.name}`;
      const client = await deps.clients.findById(platformClientId);
      if (client === undefined) {
        throw new ConnectError(DELETED_CLIENT_MESSAGE, Code.Unauthenticated);
      }
      if (originAllowed(origin, client.spec?.allowedOrigins ?? [])) {
        return;
      }
      deps.logger.warn("origin refusal: origin not in allowed_origins", {
        procedure,
        platformClientId,
        origin,
      });
      throw new ConnectError(originRefusalMessage(origin), Code.PermissionDenied);
    },
  };
}

/** The minting client of an untyped platform user token; undefined for every other credential. */
function mintingClientOf(caller: CallerIdentity): string | undefined {
  const payload = decodeVerifiedPlatformTokenPayload(caller.rawToken);
  if (payload === undefined || stringClaim(payload, TOKEN_TYPE_CLAIM) !== undefined) {
    return undefined;
  }
  return stringClaim(payload, USER_TOKEN_CLAIMS.platformClientId);
}

/** The cloud's origin rule for a non-blank Origin (see the header). */
function originAllowed(origin: string, allowed: ReadonlyArray<string>): boolean {
  if (allowed.length === 0) {
    return true;
  }
  if (origin === OPAQUE_ORIGIN) {
    return false;
  }
  const presented = origin.toLowerCase();
  return allowed.some((entry) => entry.toLowerCase() === presented);
}
