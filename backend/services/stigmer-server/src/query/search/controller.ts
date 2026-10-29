/**
 * Search controller: the thin adapter
 * between ConnectRPC and the SearchHandler, owning the error-to-status
 * mapping.
 *
 * The mapping is a string-contains heuristic (toGrpcError): handler texts containing "validation failed", "invalid",
 * or "exceeds maximum" answer InvalidArgument CARRYING the wrapped text;
 * everything else is sanitized to Internal "search failed"
 * (stigmer/stigmer#478 — the raw error is server internals, logged here
 * at the boundary, never on the wire). The conformance suite pins the
 * codes only; the texts depend on protovalidate-es's wording.
 *
 * SearchService carries no api_resource_kind option and
 * is_skip_authorization (cross-aggregate CQRS read) — the apiresource
 * interceptor injects nothing and the auth slot is a pass-through, both
 * verified.
 *
 * Proven by search.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/handler.test.ts's mapping arms.
 */
import type { ConnectRouter } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchService } from "@stigmer/apis/ai/stigmer/search/v1/query_pb";
import type {
  SearchRequest,
  SearchResponse,
} from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import { Code, ConnectError } from "@connectrpc/connect";
import type { SearchHandler } from "./handler.js";

export interface SearchControllerDeps {
  readonly handler: SearchHandler;
  readonly logger: Logger;
}

/** Registers the SearchService on the router (routes stage). */
export function registerSearchServices(
  router: ConnectRouter,
  deps: SearchControllerDeps,
): void {
  router.service(SearchService, {
    search: (request, ctx) => search(deps, request, callerIdentityOf(ctx)),
  });
}

async function search(
  deps: SearchControllerDeps,
  request: SearchRequest,
  identity: CallerIdentity,
): Promise<SearchResponse> {
  deps.logger.debug("SearchService.Search called", {
    kinds: request.kinds.map((kind) => ApiResourceKind[kind] ?? String(kind)),
    query: request.query,
    org: request.org,
  });

  try {
    return await deps.handler.handle(request, identity);
  } catch (error) {
    deps.logger.error("Search failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw toGrpcError(error);
  }
}

/**
 * Substring-matches validation texts to InvalidArgument
 * (carrying the wrapped text), default everything else to the sanitized
 * Internal (#478) — the call site above has already logged the full
 * error.
 */
function toGrpcError(error: unknown): ConnectError {
  // The page token's refusal is already the wire's answer (list-page.ts).
  if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
    return error;
  }
  const text = error instanceof Error ? error.message : String(error);
  if (
    text.includes("validation failed") ||
    text.includes("invalid") ||
    text.includes("exceeds maximum")
  ) {
    return invalidArgumentError(text);
  }
  return internalError(error, "search failed");
}
