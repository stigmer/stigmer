/**
 * API-key lookup by stored hash — the ONE read path shared by the
 * getByKeyHash RPC and the identity chassis's apikey verifier (O3,
 * 20260827.06). The verifier deliberately calls this module, never the
 * RPC: an in-process auth hop for every request would be the cloud
 * edition's chicken-and-egg machinery (inProcessChannelAsSystem) ported
 * without its reason — the OSS store is right here.
 *
 * Lookup rides Store.findByField ("spec.keyHash"), the sanctioned
 * secondary-lookup surface: indexability is guaranteed at the interface
 * and physical indexing is the driver's concern (D2 §3). No cache, on
 * purpose — a direct read makes key deletion take effect on the very next
 * request, where the cloud's Redis introspector holds revoked keys for up
 * to its 1h TTL (server-internal posture, not wire contract).
 */
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/**
 * The ApiKey resource whose spec.key_hash equals `keyHash`, or undefined
 * when none exists. Store faults other than the typed not-found rethrow
 * (the ratified store-fault mapping — an infrastructure fault must never
 * read as "unknown key").
 */
export async function findApiKeyByHash(
  store: Store,
  keyHash: string,
): Promise<ApiKey | undefined> {
  try {
    return await store.findByField(
      ApiResourceKind.api_key,
      "spec.keyHash",
      keyHash,
      ApiKeySchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
