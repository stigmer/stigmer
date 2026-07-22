// Tests for the three record mutation hooks and the guarded datastore
// delete. Mutations are imperative: the promise carries the result, the
// hook carries isPending/error, and errors preserve the server's
// relayable message byte-for-byte.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { RecordEnvelopeSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerContext } from "../../context";
import { useInsertRecord } from "../useInsertRecord";
import { useUpdateRecord } from "../useUpdateRecord";
import { useDeleteRecord } from "../useDeleteRecord";
import { useDeleteDatastore } from "../useDeleteDatastore";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

const SCOPE = { org: "acme", datastore: "clinic", collection: "bookings" } as const;

describe("useInsertRecord", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("inserts and resolves with the server-stamped envelope", async () => {
    const stamped = create(RecordEnvelopeSchema, { id: "dsr_new" });
    const insertRecord = vi.fn().mockResolvedValue(stamped);
    const client = { datastore: { insertRecord } } as never;

    const { result } = renderHook(() => useInsertRecord(), { wrapper: wrapper(client) });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.insertRecord({
        ...SCOPE,
        record: { slot_date: "2026-07-22", slot_time: "09:30:00" },
      });
    });

    expect(returned).toBe(stamped);
    expect(insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        datastore: "clinic",
        collection: "bookings",
        partition: "",
        record: { slot_date: "2026-07-22", slot_time: "09:30:00" },
      }),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.isInserting).toBe(false);
  });

  it("threads the partition (DD-010)", async () => {
    const insertRecord = vi.fn().mockResolvedValue(create(RecordEnvelopeSchema, {}));
    const client = { datastore: { insertRecord } } as never;
    const { result } = renderHook(() => useInsertRecord(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.insertRecord({ ...SCOPE, partition: "dr-alt", record: {} });
    });

    expect(insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({ partition: "dr-alt" }),
    );
  });

  it("preserves the constraint violation's message verbatim and rethrows", async () => {
    const violation = new Error("that slot is already booked");
    const client = {
      datastore: { insertRecord: vi.fn().mockRejectedValue(violation) },
    } as never;
    const { result } = renderHook(() => useInsertRecord(), { wrapper: wrapper(client) });

    await act(async () => {
      await expect(
        result.current.insertRecord({ ...SCOPE, record: {} }),
      ).rejects.toThrow("that slot is already booked");
    });

    expect(result.current.error?.message).toBe("that slot is already booked");

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe("useUpdateRecord", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("submits the partial-merge payload including explicit nulls", async () => {
    const updateRecord = vi.fn().mockResolvedValue(create(RecordEnvelopeSchema, {}));
    const client = { datastore: { updateRecord } } as never;
    const { result } = renderHook(() => useUpdateRecord(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.updateRecord({
        ...SCOPE,
        id: "dsr_1",
        fields: { patient_phone: "+15550100", notes: null },
      });
    });

    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dsr_1",
        // Tri-state: dirty value + explicit clear travel; untouched
        // fields are absent from the payload entirely.
        fields: { patient_phone: "+15550100", notes: null },
      }),
    );
  });

  it("surfaces update denials verbatim", async () => {
    const denial = new Error("you are not allowed to update records in bookings");
    const client = {
      datastore: { updateRecord: vi.fn().mockRejectedValue(denial) },
    } as never;
    const { result } = renderHook(() => useUpdateRecord(), { wrapper: wrapper(client) });

    await act(async () => {
      await expect(
        result.current.updateRecord({ ...SCOPE, id: "dsr_1", fields: {} }),
      ).rejects.toThrow();
    });

    expect(result.current.error?.message).toBe(
      "you are not allowed to update records in bookings",
    );
  });
});

describe("useDeleteRecord", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deletes by id and resolves with the final envelope", async () => {
    const last = create(RecordEnvelopeSchema, { id: "dsr_1" });
    const deleteRecord = vi.fn().mockResolvedValue(last);
    const client = { datastore: { deleteRecord } } as never;
    const { result } = renderHook(() => useDeleteRecord(), { wrapper: wrapper(client) });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.deleteRecord({ ...SCOPE, id: "dsr_1" });
    });

    expect(returned).toBe(last);
    expect(deleteRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dsr_1", collection: "bookings" }),
    );
  });
});

describe("useDeleteDatastore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("passes the force acknowledgment through", async () => {
    const deleted = { metadata: { id: "dst_1" } };
    const del = vi.fn().mockResolvedValue(deleted);
    const client = { datastore: { delete: del } } as never;
    const { result } = renderHook(() => useDeleteDatastore(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current.deleteDatastore({ resourceId: "dst_1", force: true });
    });

    expect(del).toHaveBeenCalledWith({ resourceId: "dst_1", force: true });
  });

  it("surfaces guard refusals verbatim — the server stays authoritative", async () => {
    const guard = new Error(
      'datastore "clinic" holds 214 records across 2 collections; pass force to acknowledge their destruction',
    );
    const client = {
      datastore: { delete: vi.fn().mockRejectedValue(guard) },
    } as never;
    const { result } = renderHook(() => useDeleteDatastore(), { wrapper: wrapper(client) });

    await act(async () => {
      await expect(
        result.current.deleteDatastore({ resourceId: "dst_1" }),
      ).rejects.toThrow();
    });

    expect(result.current.error?.message).toBe(guard.message);
    expect(result.current.isDeleting).toBe(false);
  });
});
