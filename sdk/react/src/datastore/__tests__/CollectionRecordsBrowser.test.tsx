// Tests for the records browser (DD-008 SD-3): the two denied-state
// branches, verb-gated write affordances, typed grid rendering, and the
// partition picker fed by the describe projection unioned with default.

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  DatastoreSpecSchema,
  DatastoreVerb,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import {
  DatastoreDescriptionSchema,
  RecordEnvelopeSchema,
  RecordListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CollectionRecordsBrowser } from "../CollectionRecordsBrowser";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => cleanup());
beforeEach(() => vi.restoreAllMocks());

const SPEC = create(DatastoreSpecSchema, {
  collections: [
    {
      name: "bookings",
      fields: [
        { name: "slot_date", type: 6 /* date */, required: true },
        { name: "status", type: 1 /* string */, enumValues: ["confirmed", "cancelled"] },
      ],
    },
  ],
});

function fullAccessDescription(partitions: string[] = []) {
  return create(DatastoreDescriptionSchema, {
    datastore: "clinic",
    partitions,
    collections: [
      {
        name: "bookings",
        access: [
          { verb: DatastoreVerb.read },
          { verb: DatastoreVerb.insert },
          { verb: DatastoreVerb.update },
          { verb: DatastoreVerb.delete },
        ],
      },
    ],
  });
}

function renderBrowser(client: {
  describeDatastore: (...a: unknown[]) => Promise<unknown>;
  findRecords?: (...a: unknown[]) => Promise<unknown>;
  deleteRecord?: (...a: unknown[]) => Promise<unknown>;
}) {
  const stigmer = {
    datastore: {
      describeDatastore: client.describeDatastore,
      findRecords: client.findRecords ?? vi.fn().mockResolvedValue(create(RecordListSchema, {})),
      deleteRecord: client.deleteRecord ?? vi.fn(),
      insertRecord: vi.fn(),
      updateRecord: vi.fn(),
    },
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(
    <CollectionRecordsBrowser org="acme" datastoreSlug="clinic" spec={SPEC} />,
    { wrapper: Wrapper },
  );
}

describe("CollectionRecordsBrowser — denied states (first-class renders)", () => {
  it("renders the denied panel on empty access lists — the primary branch", async () => {
    // Deny-by-default renders as empty access, never an error: a viewer
    // with no record grants gets a successful describe with no verbs.
    const describeDatastore = vi.fn().mockResolvedValue(
      create(DatastoreDescriptionSchema, {
        datastore: "clinic",
        collections: [{ name: "bookings", access: [] }],
      }),
    );
    const findRecords = vi.fn();
    renderBrowser({ describeDatastore, findRecords });

    await waitFor(() =>
      expect(
        screen.getByText(/You do not have record access to “bookings”/),
      ).toBeTruthy(),
    );
    // Operator guidance, not a silently empty grid.
    expect(screen.getByText(/default_role/)).toBeTruthy();
    // No query is fired without read access.
    expect(findRecords).not.toHaveBeenCalled();
  });

  it("renders the denied panel on a reach-level PERMISSION_DENIED — the defensive branch", async () => {
    const denial = new StigmerError(
      "permission-denied",
      "unauthorized to use records in this datastore",
      Code.PermissionDenied,
      {
        cause: new ConnectError(
          "unauthorized to use records in this datastore",
          Code.PermissionDenied,
        ),
      },
    );
    const describeDatastore = vi.fn().mockRejectedValue(denial);
    renderBrowser({ describeDatastore });

    await waitFor(() =>
      expect(
        screen.getByText("unauthorized to use records in this datastore"),
      ).toBeTruthy(),
    );
  });
});

describe("CollectionRecordsBrowser — grid and affordances", () => {
  it("renders typed cells and verb-gated write affordances", async () => {
    const describeDatastore = vi.fn().mockResolvedValue(fullAccessDescription());
    const findRecords = vi.fn().mockResolvedValue(
      create(RecordListSchema, {
        records: [
          create(RecordEnvelopeSchema, {
            id: "dsr_1",
            fields: { slot_date: "2026-07-22", status: "confirmed" } as never,
          }),
        ],
        total: 1,
      }),
    );
    renderBrowser({ describeDatastore, findRecords });

    await waitFor(() => expect(screen.getByText("2026-07-22")).toBeTruthy());
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert record" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit record dsr_1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete record dsr_1" })).toBeTruthy();
  });

  it("hides write affordances the caller's verbs do not include", async () => {
    const describeDatastore = vi.fn().mockResolvedValue(
      create(DatastoreDescriptionSchema, {
        datastore: "clinic",
        collections: [
          { name: "bookings", access: [{ verb: DatastoreVerb.read }] },
        ],
      }),
    );
    const findRecords = vi.fn().mockResolvedValue(
      create(RecordListSchema, {
        records: [create(RecordEnvelopeSchema, { id: "dsr_1" })],
        total: 1,
      }),
    );
    renderBrowser({ describeDatastore, findRecords });

    await waitFor(() => expect(findRecords).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Insert record" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit record dsr_1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete record dsr_1" })).toBeNull();
  });

  it("offers the partition catalog unioned with default and threads the selection", async () => {
    const describeDatastore = vi
      .fn()
      .mockResolvedValue(fullAccessDescription(["dr-alt"]));
    const findRecords = vi.fn().mockResolvedValue(create(RecordListSchema, {}));
    renderBrowser({ describeDatastore, findRecords });

    const picker = (await screen.findByLabelText(/Partition/)) as HTMLSelectElement;
    const options = Array.from(picker.options).map((o) => o.value);
    expect(options).toEqual(["default", "dr-alt"]);
  });

  it("renders the filtered-empty state distinctly from the no-records state", async () => {
    const describeDatastore = vi.fn().mockResolvedValue(fullAccessDescription());
    const findRecords = vi.fn().mockResolvedValue(create(RecordListSchema, {}));
    renderBrowser({ describeDatastore, findRecords });

    await waitFor(() =>
      expect(screen.getByText(/No records in “bookings” yet/)).toBeTruthy(),
    );
  });
});
