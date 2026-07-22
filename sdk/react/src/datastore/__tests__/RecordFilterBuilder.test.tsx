// Tests for the filter builder (DD-008 SD-3): chips, draft-then-apply,
// and the structurally-enforced operator matrix.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  CollectionDeclarationSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { RecordConditionOp } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { StigmerProvider } from "../../provider";
import { RecordFilterBuilder } from "../RecordFilterBuilder";
import type { RecordConditionDraft } from "../recordFilter";

afterEach(() => cleanup());

const COLLECTION = create(CollectionDeclarationSchema, {
  name: "bookings",
  fields: [
    { name: "slot_date", type: FieldType.date, required: true },
    { name: "status", type: FieldType.string, enumValues: ["confirmed", "cancelled"] },
    { name: "notes", type: FieldType.json },
  ],
});

function renderBuilder(
  conditions: readonly RecordConditionDraft[],
  onChange = vi.fn(),
) {
  render(
    <StigmerProvider client={{} as never}>
      <RecordFilterBuilder
        collection={COLLECTION}
        conditions={conditions}
        onChange={onChange}
      />
    </StigmerProvider>,
  );
  return onChange;
}

describe("RecordFilterBuilder — chips", () => {
  it("renders active conditions as removable chips", () => {
    const onChange = renderBuilder([
      { field: "status", op: RecordConditionOp.eq, value: "confirmed" },
      { field: "slot_date", op: RecordConditionOp.gte, value: "2026-07-01" },
    ]);

    expect(screen.getByText("status = confirmed")).toBeTruthy();
    expect(screen.getByText("slot_date ≥ 2026-07-01")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter status = confirmed" }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { field: "slot_date", op: RecordConditionOp.gte, value: "2026-07-01" },
    ]);
  });

  it("offers clear-all only with more than one condition", () => {
    renderBuilder([{ field: "status", op: RecordConditionOp.is_null }]);
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();

    cleanup();
    const onChange = renderBuilder([
      { field: "status", op: RecordConditionOp.is_null },
      { field: "slot_date", op: RecordConditionOp.eq, value: "2026-07-01" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("RecordFilterBuilder — draft-then-apply popover", () => {
  it("offers only filterable fields and the per-type operator matrix", async () => {
    renderBuilder([]);
    fireEvent.click(screen.getByRole("button", { name: /Add filter/ }));

    const fieldSelect = (await screen.findByLabelText(/Field/)) as HTMLSelectElement;
    const fieldNames = Array.from(fieldSelect.options).map((o) => o.value);
    // json is structurally unofferable; system fields are present.
    expect(fieldNames).toEqual(["", "slot_date", "status", "id", "created_at", "updated_at"]);

    // A date field offers range operators only — no in/not_in, and no
    // null tests because it is required.
    fireEvent.change(fieldSelect, { target: { value: "slot_date" } });
    const opSelect = (await screen.findByLabelText(/Operator/)) as HTMLSelectElement;
    const ops = Array.from(opSelect.options)
      .map((o) => o.textContent)
      .filter((t) => t !== "— Select —");
    expect(ops).toEqual(["=", "≠", ">", "≥", "<", "≤"]);
  });

  it("applies a complete draft and closes; incomplete drafts cannot apply", async () => {
    const onChange = renderBuilder([]);
    fireEvent.click(screen.getByRole("button", { name: /Add filter/ }));

    const fieldSelect = (await screen.findByLabelText(/Field/)) as HTMLSelectElement;
    fireEvent.change(fieldSelect, { target: { value: "status" } });
    const opSelect = (await screen.findByLabelText(/Operator/)) as HTMLSelectElement;
    fireEvent.change(opSelect, { target: { value: String(RecordConditionOp.eq) } });

    // No value yet — Apply is disabled (draft-then-apply: nothing fires).
    const apply = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Filter value for status"), {
      target: { value: "confirmed" },
    });
    expect(apply.disabled).toBe(false);

    fireEvent.click(apply);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { field: "status", op: RecordConditionOp.eq, value: "confirmed", values: undefined },
      ]),
    );
  });

  it("value-less operators apply without a value control", async () => {
    const onChange = renderBuilder([]);
    fireEvent.click(screen.getByRole("button", { name: /Add filter/ }));

    fireEvent.change(await screen.findByLabelText(/Field/), {
      target: { value: "status" },
    });
    fireEvent.change(await screen.findByLabelText(/Operator/), {
      target: { value: String(RecordConditionOp.is_null) },
    });

    expect(screen.queryByLabelText("Filter value for status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { field: "status", op: RecordConditionOp.is_null, value: undefined, values: undefined },
      ]),
    );
  });
});
