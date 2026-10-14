/**
 * Search handler — ports pkg/query/search/handler/search_handler.go: the
 * plain 4-step CQRS pipeline (validate → criteria → store → response).
 * Deliberately NOT the domain pipeline library — Go's query side doesn't
 * use its pipeline either; queries have no persist/audit lifecycle.
 *
 * Pages follow the relevance order, which has no keyset, so a page token
 * carries the rank position the next page starts at and the request's
 * fingerprint, through the token codec every list uses (list-page.ts): a
 * token is refused for a request other than the one it was issued to.
 *
 * Step 1's protovalidate run is Go's defensive twin: the interceptor
 * chain has already validated the request on every wire and in-process
 * path (chain position 3; Go server.go:246 "protovalidate runs first"),
 * so this arm is unreachable from the wire — ported because Go carries
 * it, and because the handler contract ("Handle validates") must not
 * silently depend on the caller's chain.
 *
 * Proven by __tests__/handler.test.ts and search.conformance.test.ts on
 * local.
 */
import { create } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { Validator } from "@bufbuild/protovalidate";

import {
  SearchRequestSchema,
  SearchResponseSchema,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type {
  SearchRequest,
  SearchResponse,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import {
  decodeListPageToken,
  encodeListPageToken,
  listPageFingerprint,
} from "../../pipeline/steps/list-page.js";
import type { ListPageTokenCursor } from "../../pipeline/steps/list-page.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import { SearchCriteria } from "./criteria.js";
import type { SearchPagedResult } from "./paged-result.js";
import type { SearchQueryStore } from "./query-store.js";

export class SearchHandler {
  private readonly validator: Validator;

  constructor(
    private readonly store: SearchQueryStore,
    private readonly logger: Logger,
    private readonly listReadScope: ListReadScope | undefined,
  ) {
    this.validator = createValidator();
  }

  /**
   * Go Handle: validate → build criteria → execute → build response.
   * Errors carry Go's exact wrap prefixes — the controller's error
   * mapping string-matches them (#478 sanitization contract).
   *
   * With a composed ListReadScope the
   * store read ALWAYS carries a per-effective-kind authorized-id map —
   * the Java SearchHandler's QueryAuthorizedIds step. There is no request
   * shape that skips the scope: the one that did (the retired public
   * level's cross-organization discovery, which the engine filtered by
   * visibility with FGA never consulted) left with the level. A scope
   * failure propagates — the controller's default arm answers the
   * sanitized Internal, never a silently unscoped result.
   */
  async handle(
    request: SearchRequest,
    identity: CallerIdentity,
  ): Promise<SearchResponse> {
    const validation = this.validator.validate(SearchRequestSchema, request);
    if (validation.kind !== "valid") {
      throw new Error(`validation failed: ${validation.error.message}`);
    }

    const fingerprint = listPageFingerprint({
      kinds: request.kinds,
      query: request.query,
      org: request.org,
    });
    // A token's refusal is the codec's own InvalidArgument, raised before
    // the criteria so it is never wrapped (controller.ts passes it on).
    const offset =
      request.pageToken === ""
        ? 0
        : positionOf(decodeListPageToken(request.pageToken, fingerprint));

    let criteria: SearchCriteria;
    try {
      criteria = SearchCriteria.create(
        request.kinds,
        request.query,
        request.org,
        offset,
        request.pageSize,
      );
    } catch (error) {
      throw new Error(
        `build criteria failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    let authorizedIdsByKind: Map<string, ReadonlySet<string>> | undefined;
    if (this.listReadScope !== undefined) {
      authorizedIdsByKind = new Map<string, ReadonlySet<string>>();
      for (const kind of criteria.effectiveKinds()) {
        authorizedIdsByKind.set(
          apiResourceKindName(kind),
          await this.listReadScope.authorizedResourceIds(identity, kind),
        );
      }
    }

    let result: SearchPagedResult;
    try {
      result = await this.store.search(criteria, authorizedIdsByKind);
    } catch (error) {
      throw new Error(
        `search failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const next = criteria.offset() + criteria.pageSize();
    const response = create(SearchResponseSchema, {
      entries: [...result.results],
      countsByKind: { ...result.countsByKind },
      nextPageToken:
        next < result.totalCount
          ? encodeListPageToken(NO_CURSOR, fingerprint, next)
          : "",
    });

    this.logger.debug("Search completed", {
      results: response.entries.length,
      total: result.totalCount,
      has_query: criteria.hasQuery(),
    });

    return response;
  }
}

/**
 * A search token's cursor: the relevance order has no row cursor, so the
 * token's cursor fields are empty and its position is the rank.
 */
const NO_CURSOR = { createdAt: "", id: "" } as const;

/** The rank a search token carries; a token with no position is not one of search's. */
function positionOf(token: ListPageTokenCursor): number {
  if (token.position === undefined) {
    throw invalidArgumentError("invalid page_token");
  }
  return token.position;
}
