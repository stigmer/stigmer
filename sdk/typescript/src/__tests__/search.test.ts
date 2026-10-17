// Wire-shape tests for SearchClient: a router transport fakes the search
// service in-process. `query` maps its params onto the request and answers
// the entries, the per-kind counts and the next token; `queryAll` follows
// every token from the one its params name.
import { describe, expect, it } from "vitest";
import { createRouterTransport, type Transport } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchService } from "@stigmer/apis/ai/stigmer/search/v1/query_pb";
import { SearchClient } from "../search.js";

interface Seen {
  readonly kinds: ApiResourceKind[];
  readonly query: string;
  readonly org: string;
  readonly pageSize: number;
  readonly pageToken: string;
}

function searchTransport(seen: Seen[]): Transport {
  return createRouterTransport(({ service }) => {
    service(SearchService, {
      search: (req) => {
        seen.push({ kinds: req.kinds, query: req.query, org: req.org, pageSize: req.pageSize, pageToken: req.pageToken });
        return req.pageToken === ""
          ? { entries: [{ id: "agt_1" }, { id: "agt_2" }], countsByKind: { agent: 3 }, nextPageToken: "page-2" }
          : { entries: [{ id: "agt_3" }], countsByKind: { agent: 3 }, nextPageToken: "" };
      },
    });
  });
}

describe("SearchClient", () => {
  it("sends the query's params and answers the page, the counts and the token", async () => {
    const seen: Seen[] = [];
    const page = await new SearchClient(searchTransport(seen)).query({
      kinds: [ApiResourceKind.agent],
      org: "acme",
      query: "review",
      pageSize: 2,
    });
    expect(page.entries.map((entry) => entry.id)).toEqual(["agt_1", "agt_2"]);
    expect(page.countsByKind).toEqual({ agent: 3 });
    expect(page.nextPageToken).toBe("page-2");
    expect(seen).toEqual([
      { kinds: [ApiResourceKind.agent], query: "review", org: "acme", pageSize: 2, pageToken: "" },
    ]);
  });

  it("walks every result across the pages", async () => {
    const seen: Seen[] = [];
    const ids: string[] = [];
    for await (const result of new SearchClient(searchTransport(seen)).queryAll({
      kinds: [ApiResourceKind.agent],
      org: "acme",
      query: "review",
      pageSize: 2,
    })) {
      ids.push(result.id);
    }
    expect(ids).toEqual(["agt_1", "agt_2", "agt_3"]);
    expect(seen.map((req) => req.pageToken)).toEqual(["", "page-2"]);
  });
});
