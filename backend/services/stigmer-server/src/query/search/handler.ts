/**
 * Search handler — ports pkg/query/search/handler/search_handler.go: the
 * plain 4-step CQRS pipeline (validate → criteria → store → response).
 * Deliberately NOT the domain pipeline library — Go's query side doesn't
 * use its pipeline either; queries have no persist/audit lifecycle.
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
import { SearchCriteria } from "./criteria.js";
import type { SearchPagedResult } from "./paged-result.js";
import type { SearchQueryStore } from "./query-store.js";

export class SearchHandler {
  private readonly validator: Validator;

  constructor(
    private readonly store: SearchQueryStore,
    private readonly logger: Logger,
  ) {
    this.validator = createValidator();
  }

  /**
   * Go Handle: validate → build criteria → execute → build response.
   * Errors carry Go's exact wrap prefixes — the controller's error
   * mapping string-matches them (#478 sanitization contract).
   */
  async handle(request: SearchRequest): Promise<SearchResponse> {
    const validation = this.validator.validate(SearchRequestSchema, request);
    if (validation.kind !== "valid") {
      throw new Error(`validation failed: ${validation.error.message}`);
    }

    let criteria: SearchCriteria;
    try {
      criteria = SearchCriteria.create(
        request.kinds,
        request.query,
        request.org,
        request.excludePublic,
        request.crossOrgPublic,
        request.page?.num ?? 0,
        request.page?.size ?? 0,
      );
    } catch (error) {
      throw new Error(
        `build criteria failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    let result: SearchPagedResult;
    try {
      result = await this.store.search(criteria);
    } catch (error) {
      throw new Error(
        `search failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const response = create(SearchResponseSchema, {
      entries: [...result.results],
      countsByKind: { ...result.countsByKind },
      totalCount: result.totalCount,
      totalPages: result.totalPages,
    });

    this.logger.debug("Search completed", {
      results: response.entries.length,
      total: response.totalCount,
      has_query: criteria.hasQuery(),
    });

    return response;
  }
}
