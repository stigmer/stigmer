/**
 * Pins the controllers' error mapping (Go search_controller.go
 * toGRPCError + activity_controller.go): the string-contains
 * InvalidArgument arms CARRY the wrapped handler text, everything else
 * sanitizes to the static Internal copy (#478) — including the
 * deliberately-quirky Go arm where a store error containing "invalid"
 * answers InvalidArgument with its raw text — and the rank token: a walk
 * reads every match once, and a token from another query, a list's row
 * token with no rank, or none at all is the codec's InvalidArgument,
 * passed through unwrapped. Driven through
 * createRouterTransport so the mapping is proven at the ConnectRPC
 * boundary, not by calling private functions.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ListRecentActivityRequestSchema } from "@stigmer/apis/ai/stigmer/activity/v1/io_pb";
import { ActivityQueryController } from "@stigmer/apis/ai/stigmer/activity/v1/query_pb";
import {
  SearchRequestSchema,
  SearchResultSchema,
} from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/apis/ai/stigmer/search/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import {
  encodeListPageToken,
  listPageFingerprint,
} from "../../../pipeline/steps/list-page.js";
import {
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import { ActivityHandler } from "../../activity/handler.js";
import { registerActivityServices } from "../../activity/controller.js";
import { registerSearchServices } from "../controller.js";
import { SearchHandler } from "../handler.js";
import type { SearchQueryStore } from "../query-store.js";
import { emptyResult, newSearchPagedResult } from "../paged-result.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});

// No scope is composed here, so the handler reads no rows.
const unreadRows = {
  queryResources: () => Promise.reject(new Error("no rows are read unscoped")),
  getResource: () => Promise.reject(new Error("no rows are read unscoped")),
};

function searchClientOver(store: SearchQueryStore) {
  // The zero-verifier chain stamps the trusted-local identity — the
  // controller reads it for the (scope-less here) list-read seam.
  const transport = createRouterTransport(
    (router) => {
      registerSearchServices(router, {
        handler: new SearchHandler({
          store,
          rows: unreadRows,
          organizationDirectory: undefined,
          listReadScope: undefined,
          logger: silentLogger,
        }),
        logger: silentLogger,
      });
    },
    {
      router: {
        interceptors: [createVerifierChainInterceptor([], [], silentLogger)],
      },
    },
  );
  return createClient(SearchService, transport);
}

async function grpcError(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to reject");
}

describe("search error mapping (Go toGRPCError)", () => {
  it("sanitizes an unmatched store failure to Internal 'search failed' (#478)", async () => {
    const client = searchClientOver({
      search: () => Promise.reject(new Error("disk exploded at /var/lib")),
      rebuildIndex: () => Promise.resolve(0),
    });
    const error = await grpcError(
      client.search(create(SearchRequestSchema, { query: "x" })),
    );
    expect(error.code).toBe(Code.Internal);
    // The raw text stays off the wire — only the static copy crosses.
    expect(error.rawMessage).toBe("search failed");
  });

  it("maps a store error containing 'invalid' to InvalidArgument WITH the wrapped text (Go's string-contains quirk)", async () => {
    const client = searchClientOver({
      search: () => Promise.reject(new Error("invalid cursor state")),
      rebuildIndex: () => Promise.resolve(0),
    });
    const error = await grpcError(
      client.search(create(SearchRequestSchema, { query: "x" })),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("search failed: invalid cursor state");
  });

  it("answers the handler's defensive protovalidate arm as InvalidArgument", async () => {
    // Only the identity interceptor rides this transport (no
    // protovalidate), so the HANDLER's own validate — Go's step 1,
    // wire-unreachable behind the real chain — answers. The wrapped
    // "validation failed: ..." text string-matches to InvalidArgument.
    const client = searchClientOver({
      search: () => Promise.resolve(emptyResult()),
      rebuildIndex: () => Promise.resolve(0),
    });
    const error = await grpcError(
      client.search(create(SearchRequestSchema, { query: "x".repeat(501) })),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain("validation failed");
  });
});

describe("search pages by a rank token", () => {
  const ids = ["r0", "r1", "r2", "r3", "r4"];
  const ranked: SearchQueryStore = {
    search: (criteria) =>
      Promise.resolve(
        newSearchPagedResult(
          ids
            .slice(criteria.offset(), criteria.offset() + criteria.pageSize())
            .map((id) => create(SearchResultSchema, { id })),
          { agent: ids.length },
          ids.length,
        ),
      ),
    rebuildIndex: () => Promise.resolve(0),
  };

  it("walks every match once, in rank order, and the last page carries no token", async () => {
    const client = searchClientOver(ranked);
    const pages: string[][] = [];
    let pageToken = "";
    do {
      const page = await client.search(
        create(SearchRequestSchema, { query: "x", pageSize: 2, pageToken }),
      );
      pages.push(page.entries.map((entry) => entry.id));
      expect(page.countsByKind).toEqual({ agent: 5 });
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    expect(pages).toEqual([["r0", "r1"], ["r2", "r3"], ["r4"]]);
  });

  it("refuses a token issued for another query, and a token that is not one", async () => {
    const client = searchClientOver(ranked);
    const first = await client.search(
      create(SearchRequestSchema, { query: "x", pageSize: 2 }),
    );
    const other = await grpcError(
      client.search(
        create(SearchRequestSchema, {
          query: "y",
          pageSize: 2,
          pageToken: first.nextPageToken,
        }),
      ),
    );
    expect([other.code, other.rawMessage]).toEqual([
      Code.InvalidArgument,
      "page_token was issued for a different request",
    ]);
    const garbage = await grpcError(
      client.search(
        create(SearchRequestSchema, { query: "x", pageToken: "not-a-token" }),
      ),
    );
    expect([garbage.code, garbage.rawMessage]).toEqual([
      Code.InvalidArgument,
      "invalid page_token",
    ]);
    // A list's row token for the same request carries no rank position.
    const rowToken = encodeListPageToken(
      { createdAt: "", id: "r1" },
      listPageFingerprint({ kinds: [], query: "x", org: "" }),
    );
    const notSearch = await grpcError(
      client.search(
        create(SearchRequestSchema, { query: "x", pageToken: rowToken }),
      ),
    );
    expect([notSearch.code, notSearch.rawMessage]).toEqual([
      Code.InvalidArgument,
      "invalid page_token",
    ]);
  });
});

describe("activity error mapping", () => {
  it("sanitizes a storage failure to Internal 'failed to list recent activity' (#478)", async () => {
    // A CLOSED store's reads throw — the handler's only failure mode,
    // reached without stubbing the wide Store interface.
    const temp: TempStore = tempStore();
    try {
      await temp.store.close();

      const transport = createRouterTransport(
        (router) => {
          registerActivityServices(router, {
            handler: new ActivityHandler(temp.store, silentLogger, undefined),
            logger: silentLogger,
          });
        },
        {
          router: {
            interceptors: [
              createVerifierChainInterceptor([], [], silentLogger),
            ],
          },
        },
      );
      const client = createClient(ActivityQueryController, transport);

      const error = await grpcError(
        client.listRecentActivity(
          create(ListRecentActivityRequestSchema, { pageSize: 10 }),
        ),
      );
      expect(error.code).toBe(Code.Internal);
      expect(error.rawMessage).toBe("failed to list recent activity");
    } finally {
      await temp.cleanup();
    }
  });
});
