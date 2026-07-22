import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RecordEnvelopeSchema,
  RecordListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useRecordList } from "../useRecordList";

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

const SCOPE = { org: "acme", datastore: "clinic", collection: "bookings" } as const;

describe("useRecordList", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches a page of records", async () => {
    const list = create(RecordListSchema, {
      records: [create(RecordEnvelopeSchema, { id: "dsr_1" })],
      total: 1,
    });
    const findRecords = vi.fn().mockResolvedValue(list);
    const client = { datastore: { findRecords } } as never;

    const { result } = renderHook(() => useRecordList({ ...SCOPE }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.records).toHaveLength(1);
    expect(result.current.total).toBe(1);
    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        datastore: "clinic",
        collection: "bookings",
        partition: "",
        limit: 0, // unset — the server applies its default of 25
        offset: 0,
      }),
    );
  });

  it("skips fetching when params is null", () => {
    const findRecords = vi.fn();
    const client = { datastore: { findRecords } } as never;

    const { result } = renderHook(() => useRecordList(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toEqual([]);
    expect(findRecords).not.toHaveBeenCalled();
  });

  it("surfaces the record-layer denial verbatim", async () => {
    const denial = new Error("you are not allowed to read records in bookings");
    const client = {
      datastore: { findRecords: vi.fn().mockRejectedValue(denial) },
    } as never;

    const { result } = renderHook(() => useRecordList({ ...SCOPE }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(
      "you are not allowed to read records in bookings",
    );
  });
});
