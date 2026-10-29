// The page iterator every generated client emits beside a paged list:
// schedule's listAll walks next_page_token to the end from the token its
// input names, passes the list's filters on every page, and stops reading
// when the caller stops.
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineListSchema,
  type ListRoutinesRequest,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { RoutineClient } from "../../gen/routine.js";

/** Five schedules served two at a time, each request recorded. */
function client() {
  const requests: ListRoutinesRequest[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(RoutineQueryController, {
      list(req) {
        requests.push(req);
        const start = req.pageToken === "" ? 0 : Number(req.pageToken);
        const end = Math.min(start + 2, 5);
        return create(RoutineListSchema, {
          entries: Array.from({ length: end - start }, (_, i) =>
            create(RoutineSchema, { metadata: { id: `rtn_${start + i}` } }),
          ),
          nextPageToken: end < 5 ? String(end) : "",
        });
      },
    });
  });
  return { schedules: new RoutineClient(transport), requests };
}

describe("a generated page iterator", () => {
  it("yields every entry, following each token and keeping the filters", async () => {
    const { schedules, requests } = client();
    const ids: string[] = [];
    for await (const s of schedules.listAll({ org: "acme", labels: { team: "support" }, pageSize: 2 })) {
      ids.push(s.metadata?.id ?? "");
    }
    expect(ids).toEqual(["rtn_0", "rtn_1", "rtn_2", "rtn_3", "rtn_4"]);
    expect(requests.map((r) => r.pageToken)).toEqual(["", "2", "4"]);
    expect(requests.every((r) => r.org === "acme" && r.labels.team === "support" && r.pageSize === 2)).toBe(true);
  });

  it("starts from the token its input names", async () => {
    const { schedules } = client();
    const ids: string[] = [];
    for await (const s of schedules.listAll({ org: "acme", pageToken: "4" })) ids.push(s.metadata?.id ?? "");
    expect(ids).toEqual(["rtn_4"]);
  });

  it("reads no further page once the caller stops", async () => {
    const { schedules, requests } = client();
    for await (const s of schedules.listAll({ org: "acme" })) {
      if (s.metadata?.id === "rtn_0") break;
    }
    expect(requests).toHaveLength(1);
  });
});
