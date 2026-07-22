import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RecordConditionOp,
  RecordEnvelopeSchema,
  RecordFilterSchema,
  RecordListSchema,
  RecordSortDirection,
  type FindRecordsRequest,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useRecordCollection, type RecordColumnDef } from "../useRecordCollection";

function envelope(id: string, fields: Record<string, unknown> = {}) {
  return create(RecordEnvelopeSchema, { id, fields: fields as never });
}

function recordList(records: ReturnType<typeof envelope>[], total: number) {
  return create(RecordListSchema, { records, total, limit: 25, offset: 0 });
}

function createMockStigmer(findRecords: (req: FindRecordsRequest) => Promise<unknown>) {
  return { datastore: { findRecords } } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const COLUMNS: readonly RecordColumnDef[] = [
  { id: "slot_date", header: "Date", cell: (r) => String(r.fields?.["slot_date"] ?? "") },
  { id: "status", header: "Status", cell: (r) => String(r.fields?.["status"] ?? ""), sortable: true },
];

const SCOPE = { org: "acme", datastore: "clinic", collection: "bookings" } as const;

describe("useRecordCollection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches records and reports totals", async () => {
    const findRecords = vi
      .fn()
      .mockResolvedValue(recordList([envelope("dsr_1"), envelope("dsr_2")], 51));
    const { result } = renderHook(
      () => useRecordCollection({ ...SCOPE, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.records).toHaveLength(2);
    expect(result.current.total).toBe(51);
    expect(result.current.totalPages).toBe(3); // 51 records at page size 25
    expect(result.current.currentPage).toBe(1);
  });

  it("translates page/pageSize into RPC limit/offset", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    renderHook(
      () => useRecordCollection({ ...SCOPE, page: 3, pageSize: 10, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });

  it("caps the page size at the RPC max of 100 — one surface, one limit", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    renderHook(
      () => useRecordCollection({ ...SCOPE, pageSize: 500, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    expect(findRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it("threads the partition into every fetch (DD-010)", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    renderHook(
      () => useRecordCollection({ ...SCOPE, partition: "dr-alt", columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({ partition: "dr-alt" }),
    );
  });

  it("passes the typed proto filter through without adding grammar", async () => {
    const filter = create(RecordFilterSchema, {
      conditions: [
        { field: "status", op: RecordConditionOp.eq, value: { kind: { case: "stringValue", value: "confirmed" } } },
      ],
    });
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    renderHook(
      () => useRecordCollection({ ...SCOPE, filter, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    const request = findRecords.mock.calls[0][0] as FindRecordsRequest;
    expect(request.filter?.conditions).toHaveLength(1);
    expect(request.filter?.conditions[0].field).toBe("status");
  });

  it("builds RecordOrderBy from the controlled sort", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    renderHook(
      () =>
        useRecordCollection({
          ...SCOPE,
          sort: { id: "slot_date", direction: "desc" },
          columns: COLUMNS,
        }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    const request = findRecords.mock.calls[0][0] as FindRecordsRequest;
    expect(request.orderBy?.field).toBe("slot_date");
    expect(request.orderBy?.direction).toBe(RecordSortDirection.desc);
  });

  it("reports header sort clicks through onSortChange", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([envelope("dsr_1")], 1));
    const onSortChange = vi.fn();
    const { result } = renderHook(
      () => useRecordCollection({ ...SCOPE, sort: null, onSortChange, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const statusColumn = result.current.table!
      .getHeaderGroups()[0]
      .headers.find((h) => h.id === "status")!;
    act(() => statusColumn.column.toggleSorting(false));

    expect(onSortChange).toHaveBeenCalledWith({ id: "status", direction: "asc" });
  });

  it("produces a table keyed by envelope id", async () => {
    const findRecords = vi
      .fn()
      .mockResolvedValue(recordList([envelope("dsr_a"), envelope("dsr_b")], 2));
    const { result } = renderHook(
      () => useRecordCollection({ ...SCOPE, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.table!.getRowModel().rows.map((r) => r.id)).toEqual([
      "dsr_a",
      "dsr_b",
    ]);
  });

  it("returns a null table when no columns are provided", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    const { result } = renderHook(() => useRecordCollection({ ...SCOPE }), {
      wrapper: wrapper(createMockStigmer(findRecords)),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.table).toBeNull();
  });

  it("skips fetching when the scope is incomplete", () => {
    const findRecords = vi.fn();
    const { result } = renderHook(
      () =>
        useRecordCollection({
          org: "acme",
          datastore: "clinic",
          collection: null,
          columns: COLUMNS,
        }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(findRecords).not.toHaveBeenCalled();
  });

  it("surfaces the record-layer denial verbatim — never a silently empty grid", async () => {
    const denial = new Error("you are not allowed to read records in bookings");
    const findRecords = vi.fn().mockRejectedValue(denial);
    const { result } = renderHook(
      () => useRecordCollection({ ...SCOPE, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(
      "you are not allowed to read records in bookings",
    );
  });

  it("refetch re-runs the current query", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([envelope("dsr_1")], 1));
    const { result } = renderHook(
      () => useRecordCollection({ ...SCOPE, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(findRecords).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(findRecords).toHaveBeenCalledTimes(2));
  });

  it("re-fetches when the filter changes", async () => {
    const findRecords = vi.fn().mockResolvedValue(recordList([], 0));
    const { rerender } = renderHook(
      ({ filter }: { filter?: ReturnType<typeof create<typeof RecordFilterSchema>> }) =>
        useRecordCollection({ ...SCOPE, filter, columns: COLUMNS }),
      { wrapper: wrapper(createMockStigmer(findRecords)), initialProps: {} },
    );

    await waitFor(() => expect(findRecords).toHaveBeenCalledTimes(1));

    rerender({
      filter: create(RecordFilterSchema, {
        conditions: [{ field: "status", op: RecordConditionOp.is_null }],
      }),
    });

    await waitFor(() => expect(findRecords).toHaveBeenCalledTimes(2));
  });
});
