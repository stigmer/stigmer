// Tests for the records-specific filter model — typed 1:1 against
// RecordConditionOp, structurally unable to express anything
// findRecords cannot serve (DD-008 invariant 2).

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CollectionDeclarationSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { RecordConditionOp } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import {
  buildRecordFilter,
  filterableFields,
  formatConditionChip,
  isConditionComplete,
} from "../recordFilter.js";

const COLLECTION = create(CollectionDeclarationSchema, {
  name: "bookings",
  fields: [
    { name: "slot_date", type: FieldType.date, required: true },
    { name: "status", type: FieldType.string, enumValues: ["confirmed", "cancelled"] },
    { name: "notes", type: FieldType.json },
  ],
});

describe("filterableFields", () => {
  it("offers declared filterable fields plus the filterable system fields", () => {
    const names = filterableFields(COLLECTION).map((f) => f.name);
    expect(names).toEqual(["slot_date", "status", "id", "created_at", "updated_at"]);
  });

  it("excludes json fields — not filterable", () => {
    const names = filterableFields(COLLECTION).map((f) => f.name);
    expect(names).not.toContain("notes");
  });

  it("system fields carry the server's operator sets", () => {
    const fields = filterableFields(COLLECTION);
    const id = fields.find((f) => f.name === "id")!;
    expect(id.operators).toEqual([RecordConditionOp.eq, RecordConditionOp.is_in]);
    const createdAt = fields.find((f) => f.name === "created_at")!;
    expect(createdAt.operators).toEqual([
      RecordConditionOp.gt,
      RecordConditionOp.gte,
      RecordConditionOp.lt,
      RecordConditionOp.lte,
    ]);
  });

  it("required fields get no null tests; optional ones do", () => {
    const fields = filterableFields(COLLECTION);
    const slotDate = fields.find((f) => f.name === "slot_date")!;
    expect(slotDate.operators).not.toContain(RecordConditionOp.is_null);
    const status = fields.find((f) => f.name === "status")!;
    expect(status.operators).toContain(RecordConditionOp.is_null);
  });
});

describe("isConditionComplete", () => {
  it("value-less operators are complete without a value", () => {
    expect(
      isConditionComplete({ field: "status", op: RecordConditionOp.is_null }),
    ).toBe(true);
  });

  it("scalar operators need a value", () => {
    expect(isConditionComplete({ field: "status", op: RecordConditionOp.eq })).toBe(false);
    expect(
      isConditionComplete({ field: "status", op: RecordConditionOp.eq, value: "confirmed" }),
    ).toBe(true);
  });

  it("list operators need at least one value", () => {
    expect(
      isConditionComplete({ field: "status", op: RecordConditionOp.is_in, values: [] }),
    ).toBe(false);
    expect(
      isConditionComplete({
        field: "status",
        op: RecordConditionOp.is_in,
        values: ["confirmed"],
      }),
    ).toBe(true);
  });

  it("an unspecified operator is never complete", () => {
    expect(
      isConditionComplete({
        field: "status",
        op: RecordConditionOp.record_condition_op_unspecified,
        value: "x",
      }),
    ).toBe(false);
  });
});

describe("buildRecordFilter", () => {
  it("returns undefined for no complete conditions (absent filter, not empty)", () => {
    expect(buildRecordFilter([])).toBeUndefined();
    expect(
      buildRecordFilter([{ field: "status", op: RecordConditionOp.eq }]),
    ).toBeUndefined();
  });

  it("builds proto conditions with scalar values", () => {
    const filter = buildRecordFilter([
      { field: "status", op: RecordConditionOp.eq, value: "confirmed" },
    ])!;
    expect(filter.conditions).toHaveLength(1);
    expect(filter.conditions[0].field).toBe("status");
    expect(filter.conditions[0].op).toBe(RecordConditionOp.eq);
    expect(filter.conditions[0].value?.kind).toEqual({
      case: "stringValue",
      value: "confirmed",
    });
  });

  it("builds list values for is_in", () => {
    const filter = buildRecordFilter([
      {
        field: "status",
        op: RecordConditionOp.is_in,
        values: ["confirmed", "cancelled"],
      },
    ])!;
    expect(filter.conditions[0].values).toHaveLength(2);
  });

  it("leaves the value unset for null tests", () => {
    const filter = buildRecordFilter([
      { field: "status", op: RecordConditionOp.not_null },
    ])!;
    expect(filter.conditions[0].value).toBeUndefined();
    expect(filter.conditions[0].values).toHaveLength(0);
  });
});

describe("formatConditionChip", () => {
  it("formats scalar, list, and value-less conditions", () => {
    expect(
      formatConditionChip({ field: "status", op: RecordConditionOp.eq, value: "confirmed" }),
    ).toBe("status = confirmed");
    expect(
      formatConditionChip({
        field: "status",
        op: RecordConditionOp.not_in,
        values: ["a", "b"],
      }),
    ).toBe("status not in [a, b]");
    expect(formatConditionChip({ field: "notes", op: RecordConditionOp.is_null })).toBe(
      "notes is empty",
    );
  });
});
