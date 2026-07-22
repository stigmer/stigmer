import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { DatastoreDescriptionSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useDatastoreDescription } from "../useDatastoreDescription";

function createMockStigmer(overrides: {
  describeDatastore?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    datastore: {
      describeDatastore:
        overrides.describeDatastore ?? vi.fn().mockResolvedValue(null),
    },
  } as never;
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

describe("useDatastoreDescription", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the description and passes org + datastore through", async () => {
    const description = create(DatastoreDescriptionSchema, {
      datastore: "clinic",
      partitions: ["default", "dr-alt"],
    });
    const describeDatastore = vi.fn().mockResolvedValue(description);
    const client = createMockStigmer({ describeDatastore });

    const { result } = renderHook(() => useDatastoreDescription("acme", "clinic"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.description).toBe(description);
    expect(describeDatastore).toHaveBeenCalledWith(
      expect.objectContaining({ org: "acme", datastore: "clinic" }),
    );
  });

  it("always offers the default partition even when the catalog is empty", async () => {
    // The catalog materializes with the first record write; an empty
    // datastore reports no partitions but "default" is always addressable.
    const description = create(DatastoreDescriptionSchema, {
      datastore: "clinic",
      partitions: [],
    });
    const client = createMockStigmer({
      describeDatastore: vi.fn().mockResolvedValue(description),
    });

    const { result } = renderHook(() => useDatastoreDescription("acme", "clinic"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.partitions).toEqual(["default"]);
  });

  it("prepends default when the catalog holds only named partitions", async () => {
    const description = create(DatastoreDescriptionSchema, {
      datastore: "clinic",
      partitions: ["dr-alt"],
    });
    const client = createMockStigmer({
      describeDatastore: vi.fn().mockResolvedValue(description),
    });

    const { result } = renderHook(() => useDatastoreDescription("acme", "clinic"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.partitions).toEqual(["default", "dr-alt"]);
  });

  it("does not duplicate default when the catalog already carries it", async () => {
    const description = create(DatastoreDescriptionSchema, {
      datastore: "clinic",
      partitions: ["default", "dr-alt"],
    });
    const client = createMockStigmer({
      describeDatastore: vi.fn().mockResolvedValue(description),
    });

    const { result } = renderHook(() => useDatastoreDescription("acme", "clinic"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.partitions).toEqual(["default", "dr-alt"]);
  });

  it("skips fetching when org or datastore is null", () => {
    const describeDatastore = vi.fn();
    const client = createMockStigmer({ describeDatastore });

    const { result } = renderHook(() => useDatastoreDescription(null, "clinic"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.description).toBeNull();
    expect(result.current.partitions).toEqual(["default"]);
    expect(describeDatastore).not.toHaveBeenCalled();
  });

  it("surfaces PERMISSION_DENIED as error — the defensive denied-state branch", async () => {
    // A reach-level denial must be catchable and rendered as the
    // Records-tab denied panel, never a page-level failure.
    const denial = new Error("unauthorized to use records in this datastore");
    const client = createMockStigmer({
      describeDatastore: vi.fn().mockRejectedValue(denial),
    });

    const { result } = renderHook(() => useDatastoreDescription("acme", "clinic"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe(
      "unauthorized to use records in this datastore",
    );
    expect(result.current.description).toBeNull();
  });
});
