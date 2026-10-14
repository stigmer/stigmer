/**
 * The embedding origin guard: a request bearing a user token minted for an
 * organization whose embedding settings list `allowed_origins` must come
 * from one of them. The check needs the request's headers, which a
 * verifier never sees, so it is a caller guard (extensions/caller-guards.ts),
 * open source's own, composed before any extension's.
 *
 * The rule (OrganizationEmbedding.allowed_origins' field doc):
 *   - no `Origin` header, or a blank one: allowed. Only browsers send
 *     Origin, and the control is a browser-context defense against a
 *     leaked token replayed from another site's page. The guard reads
 *     nothing for such a request, so server-to-server callers pay nothing;
 *   - an empty `allowed_origins`: allowed (open mode);
 *   - otherwise the origin must match an entry case-insensitively (RFC 6454
 *     comparison), and the opaque origin "null" never matches.
 * A refusal is PERMISSION_DENIED, logged with the procedure, the minting
 * account and the origin.
 *
 * The settings are the minting service account's organization's, the ones
 * the mint applied: the guard reads the account for its organization, then
 * that organization's row, so an edit applies on the next request. Only
 * the untyped user token is the guard's: its claims are read from the
 * token the verifier chain already verified on this request (the pattern
 * caller-guards.ts prescribes), and any other credential passes
 * untouched. A minting account deleted since the verifier ran is refused
 * the way the verifier refuses it, fail closed.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerGuard } from "../../extensions/caller-guards.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  TOKEN_TYPE_CLAIM,
  decodeVerifiedPlatformTokenPayload,
  stringClaim,
} from "../../platformtoken/envelope.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import {
  DELETED_MINTER_MESSAGE,
  USER_TOKEN_CLAIMS,
  originRefusalMessage,
} from "./constants.js";

/** The opaque-origin serialization, which never matches a listed origin. */
const OPAQUE_ORIGIN = "null";

export interface EmbeddingOriginGuardDeps {
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  readonly store: Pick<Store, "getResource">;
  readonly logger: Logger;
}

export function newEmbeddingOriginGuard(
  deps: EmbeddingOriginGuardDeps,
): CallerGuard {
  return {
    name: "embedding-origin",
    async guard(
      caller: CallerIdentity,
      method: DescMethod,
      headers: Headers,
    ): Promise<void> {
      const origin = headers.get("origin") ?? "";
      if (origin.trim() === "") {
        return;
      }
      const mintedBy = mintingAccountOf(caller);
      if (mintedBy === undefined) {
        return;
      }
      const allowed = await allowedOriginsOf(deps, mintedBy);
      if (originAllowed(origin, allowed)) {
        return;
      }
      deps.logger.warn("origin refusal: origin not in allowed_origins", {
        procedure: `/${method.parent.typeName}/${method.name}`,
        mintedBy,
        origin,
      });
      throw new ConnectError(
        originRefusalMessage(origin),
        Code.PermissionDenied,
      );
    },
  };
}

/** The minting account of an untyped platform user token; undefined for every other credential. */
function mintingAccountOf(caller: CallerIdentity): string | undefined {
  const payload = decodeVerifiedPlatformTokenPayload(caller.rawToken);
  if (
    payload === undefined ||
    stringClaim(payload, TOKEN_TYPE_CLAIM) !== undefined
  ) {
    return undefined;
  }
  return stringClaim(payload, USER_TOKEN_CLAIMS.mintedBy);
}

/** The minting organization's allowed origins, read now. */
async function allowedOriginsOf(
  deps: EmbeddingOriginGuardDeps,
  mintedBy: string,
): Promise<ReadonlyArray<string>> {
  const minter = await deps.accounts.findById(mintedBy);
  const org = minter?.metadata?.org ?? "";
  if (minter === undefined || org === "") {
    throw new ConnectError(DELETED_MINTER_MESSAGE, Code.Unauthenticated);
  }
  try {
    const organization = await deps.store.getResource(
      ApiResourceKind.organization,
      org,
      OrganizationSchema,
    );
    return organization.spec?.embedding?.allowedOrigins ?? [];
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw new ConnectError(DELETED_MINTER_MESSAGE, Code.Unauthenticated);
    }
    throw error;
  }
}

/** The origin rule for a non-blank Origin (see the header). */
function originAllowed(
  origin: string,
  allowed: ReadonlyArray<string>,
): boolean {
  if (allowed.length === 0) {
    return true;
  }
  if (origin === OPAQUE_ORIGIN) {
    return false;
  }
  const presented = origin.toLowerCase();
  return allowed.some((entry) => entry.toLowerCase() === presented);
}
