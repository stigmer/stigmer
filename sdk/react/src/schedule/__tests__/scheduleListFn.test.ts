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

function clientReturning(items: Schedule[], totalCount: number) {
  const list = vi
    .fn()
    .mockResolvedValue(create(ScheduleListSchema, { items, totalCount }));
  return { client: { schedule: { list } }, list };
}

describe("listSchedulesPage", () => {
  it("sends the org and requested page in the query", async () => {
    const { client, list } = clientReturning([], 0);

    await listSchedulesPage(client, "acme", { num: 2, size: 10 });

    expect(list).toHaveBeenCalledOnce();
    const request = list.mock.calls[0][0];
    expect(request.org).toBe("acme");
    expect(request.pageInfo?.num).toBe(2);
    expect(request.pageInfo?.size).toBe(10);
  });

  it("defaults to page 1, size 20", async () => {
    const { client, list } = clientReturning([], 0);

    await listSchedulesPage(client, "acme");

    const request = list.mock.calls[0][0];
    expect(request.pageInfo?.num).toBe(1);
    expect(request.pageInfo?.size).toBe(20);
  });

  // Cloud slices server-side: a response never exceeds the page size.
  it("passes a cloud-shaped page through untouched", async () => {
    const page = schedules(20);
    const { client } = clientReturning(page, 50);

    const result = await listSchedulesPage(client, "acme", { num: 2, size: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.items[0].metadata?.slug).toBe("sched-0");
    expect(result.totalCount).toBe(50);
    expect(result.totalPages).toBe(3);
  });

  it("passes a cloud-shaped final short page through untouched", async () => {
    const { client } = clientReturning(schedules(10), 50);

    const result = await listSchedulesPage(client, "acme", { num: 3, size: 20 });

    expect(result.items).toHaveLength(10);
    expect(result.totalPages).toBe(3);
  });

  // OSS ignores page_info and returns the full org list — an overflowing
  // response is the tell, and only then is the page sliced locally.
  it("slices an OSS-shaped full-list response with absolute indices", async () => {
    const { client } = clientReturning(schedules(50), 50);

    const result = await listSchedulesPage(client, "acme", { num: 2, size: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.items[0].metadata?.slug).toBe("sched-20");
    expect(result.items[19].metadata?.slug).toBe("sched-39");
    expect(result.totalCount).toBe(50);
    expect(result.totalPages).toBe(3);
  });

  it("slices the OSS-shaped final short page correctly", async () => {
    const { client } = clientReturning(schedules(50), 50);

    const result = await listSchedulesPage(client, "acme", { num: 3, size: 20 });

    expect(result.items).toHaveLength(10);
    expect(result.items[0].metadata?.slug).toBe("sched-40");
    expect(result.items[9].metadata?.slug).toBe("sched-49");
  });

  it("returns an empty page with zero totals", async () => {
    const { client } = clientReturning([], 0);

    const result = await listSchedulesPage(client, "acme");

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe("createScheduleListFn", () => {
  it("adapts ListParams to the direct query and back to ListResult", async () => {
    const { client, list } = clientReturning(schedules(3), 3);
    const listFn = createScheduleListFn(client);

    const result = await listFn({
      org: "acme",
      // No server-side text search for schedules — ignored by contract.
      query: "ignored",
      excludePublic: false,
      crossOrgPublic: false,
      page: { num: 1, size: 20 },
    });

    expect(result.totalCount).toBe(3);
    expect(result.totalPages).toBe(1);
    expect(result.entries).toHaveLength(3);
    // Entries are full Schedule protos occupying the SearchResult slot.
    expect((result.entries[0] as unknown as Schedule).metadata?.slug).toBe("sched-0");

    const request = list.mock.calls[0][0];
    expect(request.org).toBe("acme");
    // The query never reaches the wire: ListSchedulesRequest has no
    // text-search field.
    expect("query" in request && request.query).toBeFalsy();
  });
});
