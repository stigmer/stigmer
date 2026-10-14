// The page iterator every generated client emits beside a paged list:
// schedule's listAll walks next_page_token to the end from the token its
// input names, passes the list's filters on every page, and stops reading
// when the caller stops.
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleListSchema,
  type ListSchedulesRequest,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { ScheduleClient } from "../../gen/schedule.js";

/** Five schedules served two at a time, each request recorded. */
function client() {
  const requests: ListSchedulesRequest[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(ScheduleQueryController, {
      list(req) {
        requests.push(req);
        const start = req.pageToken === "" ? 0 : Number(req.pageToken);
        const end = Math.min(start + 2, 5);
        return create(ScheduleListSchema, {
          entries: Array.from({ length: end - start }, (_, i) =>
            create(ScheduleSchema, { metadata: { id: `sch_${start + i}` } }),
          ),
          nextPageToken: end < 5 ? String(end) : "",
        });
      },
    });
  });
  return { schedules: new ScheduleClient(transport), requests };
}

describe("a generated page iterator", () => {
  it("yields every entry, following each token and keeping the filters", async () => {
    const { schedules, requests } = client();
    const ids: string[] = [];
    for await (const s of schedules.listAll({ org: "acme", labels: { team: "support" }, pageSize: 2 })) {
      ids.push(s.metadata?.id ?? "");
    }
    expect(ids).toEqual(["sch_0", "sch_1", "sch_2", "sch_3", "sch_4"]);
    expect(requests.map((r) => r.pageToken)).toEqual(["", "2", "4"]);
    expect(requests.every((r) => r.org === "acme" && r.labels.team === "support" && r.pageSize === 2)).toBe(true);
  });

  it("starts from the token its input names", async () => {
    const { schedules } = client();
    const ids: string[] = [];
    for await (const s of schedules.listAll({ org: "acme", pageToken: "4" })) ids.push(s.metadata?.id ?? "");
    expect(ids).toEqual(["sch_4"]);
  });

  it("reads no further page once the caller stops", async () => {
    const { schedules, requests } = client();
    for await (const s of schedules.listAll({ org: "acme" })) {
      if (s.metadata?.id === "sch_0") break;
    }
    expect(requests).toHaveLength(1);
  });
});
