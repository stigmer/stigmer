import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleListSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { createScheduleListFn, listSchedulesPage } from "../scheduleListFn";

function schedules(count: number): Schedule[] {
  return Array.from({ length: count }, (_, i) =>
    create(ScheduleSchema, {
      metadata: { id: `sch_${i}`, name: `sched-${i}`, slug: `sched-${i}`, org: "acme" },
    }),
  );
}

function clientReturning(entries: Schedule[], nextPageToken: string) {
  const list = vi
    .fn()
    .mockResolvedValue(create(ScheduleListSchema, { entries, nextPageToken }));
  return { client: { schedule: { list } }, list };
}

describe("listSchedulesPage", () => {
  it("sends the org, the page size and the token in the query", async () => {
    const { client, list } = clientReturning([], "");

    await listSchedulesPage(client, "acme", { pageSize: 10, pageToken: "tok_2" });

    expect(list).toHaveBeenCalledOnce();
    const request = list.mock.calls[0][0];
    expect(request.org).toBe("acme");
    expect(request.pageSize).toBe(10);
    expect(request.pageToken).toBe("tok_2");
  });

  it("defaults to the first page of 20", async () => {
    const { client, list } = clientReturning([], "");

    await listSchedulesPage(client, "acme");

    const request = list.mock.calls[0][0];
    expect(request.pageSize).toBe(20);
    expect(request.pageToken).toBe("");
  });

  it("answers the server's page and its token", async () => {
    const { client } = clientReturning(schedules(20), "tok_next");

    const result = await listSchedulesPage(client, "acme", { pageSize: 20 });

    expect(result.entries).toHaveLength(20);
    expect(result.entries[0].metadata?.slug).toBe("sched-0");
    expect(result.nextPageToken).toBe("tok_next");
  });

  it("answers an empty last page with no token", async () => {
    const { client } = clientReturning([], "");

    const result = await listSchedulesPage(client, "acme");

    expect(result.entries).toEqual([]);
    expect(result.nextPageToken).toBe("");
  });
});

describe("createScheduleListFn", () => {
  it("adapts a workbench page request to the direct query and back", async () => {
    const { client, list } = clientReturning(schedules(3), "");
    const listFn = createScheduleListFn(client);

    const result = await listFn({
      org: "acme",
      // No server-side text search for schedules — ignored by contract.
      query: "ignored",
      pageSize: 20,
      pageToken: "",
    });

    expect(result.nextPageToken).toBe("");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].metadata?.slug).toBe("sched-0");

    const request = list.mock.calls[0][0];
    expect(request.org).toBe("acme");
    // The query never reaches the wire: ListSchedulesRequest has no
    // text-search field.
    expect("query" in request && request.query).toBeFalsy();
  });
});
