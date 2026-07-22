// Tests for the record write surface (DD-008 SD-4): required gating,
// partial-merge with explicit-null clears, verbatim constraint-error
// placement, and read-only system fields.

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { create } from "@bufbuild/protobuf";
import {
  CollectionDeclarationSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { RecordEnvelopeSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerContext } from "../../context";
import { RecordFormPanel } from "../RecordFormPanel";

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

const COLLECTION = create(CollectionDeclarationSchema, {
  name: "bookings",
  fields: [
    { name: "slot_date", type: FieldType.date, required: true },
    { name: "patient_phone", type: FieldType.string },
    { name: "notes", type: FieldType.string },
  ],
  uniques: [
    {
      name: "one_confirmed_per_slot",
      fields: ["slot_date"],
      message: "that slot is already booked",
    },
  ],
});

const SCOPE = {
  org: "acme",
  datastore: "clinic",
  collection: "bookings",
  partition: "default",
} as const;

function renderPanel(overrides: {
  insertRecord?: (...args: unknown[]) => Promise<unknown>;
  updateRecord?: (...args: unknown[]) => Promise<unknown>;
  record?: ReturnType<typeof create<typeof RecordEnvelopeSchema>> | null;
  onSaved?: (envelope: unknown) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const client = {
    datastore: {
      insertRecord: overrides.insertRecord ?? vi.fn(),
      updateRecord: overrides.updateRecord ?? vi.fn(),
    },
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    );
  }
  return render(
    <RecordFormPanel
      open
      onOpenChange={overrides.onOpenChange ?? vi.fn()}
      scope={SCOPE}
      collection={COLLECTION}
      record={overrides.record ?? null}
      onSaved={overrides.onSaved}
    />,
    { wrapper: Wrapper },
  );
}

describe("RecordFormPanel — insert", () => {
  it("gates the submit on required fields (error prevention)", () => {
    renderPanel({});
    const submit = screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Required: slot_date/)).toBeTruthy();
  });

  it("submits only the fields the operator set", async () => {
    const user = userEvent.setup();
    const insertRecord = vi.fn().mockResolvedValue(create(RecordEnvelopeSchema, { id: "dsr_1" }));
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    renderPanel({ insertRecord, onSaved, onOpenChange });

    await user.type(screen.getByLabelText(/^slot_date/), "2026-07-22");
    await user.type(screen.getByLabelText("patient_phone"), "+15550100");
    await user.click(screen.getByRole("button", { name: "Insert" }));

    await waitFor(() => expect(insertRecord).toHaveBeenCalled());
    expect(insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        record: { slot_date: "2026-07-22", patient_phone: "+15550100" },
        partition: "default",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("places a unique-constraint violation next to its declared fields, verbatim", async () => {
    const user = userEvent.setup();
    const violation = new ConnectError(
      "that slot is already booked",
      Code.AlreadyExists,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "datastore.stigmer.ai",
            reason: "CONSTRAINT_VIOLATION",
            metadata: { constraint: "one_confirmed_per_slot" },
          },
        },
      ],
    );
    renderPanel({ insertRecord: vi.fn().mockRejectedValue(violation) });

    await user.type(screen.getByLabelText(/^slot_date/), "2026-07-22");
    await user.click(screen.getByRole("button", { name: "Insert" }));

    // Field-adjacent: the message renders as the slot_date field's error,
    // byte-for-byte — not as a form-level banner.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("that slot is already booked");
    const slotDateControl = screen.getByLabelText(/^slot_date/);
    expect(
      slotDateControl.parentElement?.textContent,
    ).toContain("that slot is already booked");
  });

  it("renders an unmapped violation as a form-level banner, verbatim", async () => {
    const user = userEvent.setup();
    const violation = new ConnectError(
      "bookings must be within opening hours",
      Code.FailedPrecondition,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "datastore.stigmer.ai",
            reason: "CONSTRAINT_VIOLATION",
            metadata: { constraint: "within_hours" }, // a check — no field mapping
          },
        },
      ],
    );
    renderPanel({ insertRecord: vi.fn().mockRejectedValue(violation) });

    await user.type(screen.getByLabelText(/^slot_date/), "2026-07-22");
    await user.click(screen.getByRole("button", { name: "Insert" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("bookings must be within opening hours");
  });
});

describe("RecordFormPanel — edit (partial merge)", () => {
  const record = create(RecordEnvelopeSchema, {
    id: "dsr_1",
    fields: {
      slot_date: "2026-07-22",
      patient_phone: "+15550100",
      notes: "call first",
    } as never,
  });

  it("shows read-only system fields", () => {
    renderPanel({ record });
    expect(screen.getByText("dsr_1")).toBeTruthy();
    // The envelope columns are display-only — no input is named "id".
    expect(screen.queryByLabelText("id")).toBeNull();
  });

  it("submits only dirty fields; explicit clear travels as null", async () => {
    const user = userEvent.setup();
    const updateRecord = vi.fn().mockResolvedValue(create(RecordEnvelopeSchema, { id: "dsr_1" }));
    renderPanel({ record, updateRecord });

    // Dirty one field…
    const phone = screen.getByLabelText("patient_phone");
    await user.clear(phone);
    await user.type(phone, "+15550199");
    // …and clear another.
    await user.click(screen.getByRole("button", { name: "Clear notes" }));

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dsr_1",
        // slot_date untouched — absent from the payload entirely.
        fields: { patient_phone: "+15550199", notes: null },
      }),
    );
  });

  it("closes without a request when nothing is dirty", async () => {
    const user = userEvent.setup();
    const updateRecord = vi.fn();
    const onOpenChange = vi.fn();
    renderPanel({ record, updateRecord, onOpenChange });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateRecord).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
