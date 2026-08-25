/**
 * Pins the controllers' error mapping (Go search_controller.go
 * toGRPCError + activity_controller.go): the string-contains
 * InvalidArgument arms CARRY the wrapped handler text, everything else
 * sanitizes to the static Internal copy (#478) — including the
 * deliberately-quirky Go arm where a store error containing "invalid"
 * answers InvalidArgument with its raw text. Driven through
 * createRouterTransport so the mapping is proven at the ConnectRPC
 * boundary, not by calling private functions.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ListRecentActivityRequestSchema } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";
import { SearchRequestSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import { ActivityHandler } from "../../activity/handler.js";
import { registerActivityServices } from "../../activity/controller.js";
import { registerSearchServices } from "../controller.js";
import { SearchHandler } from "../handler.js";
import type { SearchQueryStore } from "../query-store.js";
import { emptyResult } from "../paged-result.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});

function searchClientOver(store: SearchQueryStore) {
  const transport = createRouterTransport((router) => {
    registerSearchServices(router, {
      handler: new SearchHandler(store, silentLogger),
      logger: silentLogger,
    });
  });
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
    // No interceptor chain rides createRouterTransport here, so the
    // HANDLER's own validate — Go's step 1, wire-unreachable behind the
    // real chain — answers. The wrapped "validation failed: ..." text
    // string-matches to InvalidArgument.
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

describe("activity error mapping", () => {
  it("sanitizes a storage failure to Internal 'failed to list recent activity' (#478)", async () => {
    // A CLOSED store's reads throw — the handler's only failure mode,
    // reached without stubbing the wide Store interface.
    const temp: TempStore = tempStore();
    await temp.store.close();

    const transport = createRouterTransport((router) => {
      registerActivityServices(router, {
        handler: new ActivityHandler(temp.store, silentLogger),
        logger: silentLogger,
      });
    });
    const client = createClient(ActivityQueryController, transport);

    const error = await grpcError(
      client.listRecentActivity(
        create(ListRecentActivityRequestSchema, { pageSize: 10 }),
      ),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to list recent activity");
    await temp.cleanup();
  });
});
