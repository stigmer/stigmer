// Tests for the client-side projection of the DD-004 canonical value
// contract. The cases mirror the authoritative Go schema tests
// (pkg/domain/datastore/schema) so a drift between projection and
// enforcement shows up here first.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FieldDeclarationSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { RecordConditionOp } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import {
  buildUpdateFields,
  coerceFieldValue,
  formatFieldValue,
  formatSystemTimestamp,
  isListOperator,
  isSortableField,
  isValuelessOperator,
  operatorsForField,
  RESERVED_FIELD_NAMES,
  SYSTEM_FIELD_OPERATORS,
} from "../recordValues.js";

function field(overrides: {
  name?: string;
  type: FieldType;
  required?: boolean;
  enumValues?: string[];
}) {
  return create(FieldDeclarationSchema, {
    name: overrides.name ?? "f",
    type: overrides.type,
    required: overrides.required ?? false,
    enumValues: overrides.enumValues ?? [],
  });
}

describe("coerceFieldValue", () => {
  it("passes explicit null through for every type (tri-state clear)", () => {
    for (const type of [
      FieldType.string,
      FieldType.integer,
      FieldType.number,
      FieldType.bool,
      FieldType.timestamp,
      FieldType.date,
      FieldType.time,
      FieldType.json,
    ]) {
      expect(coerceFieldValue(field({ type }), null)).toEqual({ ok: true, value: null });
    }
  });

  describe("string", () => {
    it("accepts a plain string", () => {
      expect(coerceFieldValue(field({ type: FieldType.string }), "hello")).toEqual({
        ok: true,
        value: "hello",
      });
    });

    it("rejects non-strings", () => {
      const r = coerceFieldValue(field({ name: "note", type: FieldType.string }), 5);
      expect(r).toEqual({ ok: false, error: 'field "note" must be a string' });
    });

    it("enforces enum_values membership", () => {
      const f = field({
        name: "status",
        type: FieldType.string,
        enumValues: ["confirmed", "cancelled"],
      });
      expect(coerceFieldValue(f, "confirmed")).toEqual({ ok: true, value: "confirmed" });
      expect(coerceFieldValue(f, "pending")).toEqual({
        ok: false,
        error: 'field "status" must be one of [confirmed cancelled]',
      });
    });
  });

  describe("integer", () => {
    it("accepts integral numbers", () => {
      expect(coerceFieldValue(field({ type: FieldType.integer }), 42)).toEqual({
        ok: true,
        value: 42,
      });
      expect(coerceFieldValue(field({ type: FieldType.integer }), -7)).toEqual({
        ok: true,
        value: -7,
      });
      expect(coerceFieldValue(field({ type: FieldType.integer }), 0)).toEqual({
        ok: true,
        value: 0,
      });
    });

    it("rejects fractional, non-numeric, and unsafe values", () => {
      const f = field({ name: "n", type: FieldType.integer });
      expect(coerceFieldValue(f, 1.5)).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "3")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, Number.MAX_SAFE_INTEGER + 2)).toMatchObject({ ok: false });
    });
  });

  describe("number", () => {
    it("accepts finite numbers", () => {
      expect(coerceFieldValue(field({ type: FieldType.number }), 3.14)).toEqual({
        ok: true,
        value: 3.14,
      });
    });

    it("rejects non-numbers and non-finite values", () => {
      const f = field({ name: "n", type: FieldType.number });
      expect(coerceFieldValue(f, "3.14")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, Number.NaN)).toMatchObject({ ok: false });
    });
  });

  describe("bool", () => {
    it("accepts booleans and rejects everything else", () => {
      const f = field({ name: "b", type: FieldType.bool });
      expect(coerceFieldValue(f, true)).toEqual({ ok: true, value: true });
      expect(coerceFieldValue(f, false)).toEqual({ ok: true, value: false });
      expect(coerceFieldValue(f, "true")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, 1)).toMatchObject({ ok: false });
    });
  });

  describe("timestamp", () => {
    const f = field({ name: "at", type: FieldType.timestamp });

    it("accepts RFC 3339 UTC and offset forms", () => {
      expect(coerceFieldValue(f, "2026-07-21T04:30:00Z")).toEqual({
        ok: true,
        value: "2026-07-21T04:30:00Z",
      });
      expect(coerceFieldValue(f, "2026-07-21T04:30:00.123Z")).toMatchObject({ ok: true });
      expect(coerceFieldValue(f, "2026-07-21T10:00:00+05:30")).toMatchObject({ ok: true });
    });

    it("rejects date-only, missing zone, and garbage", () => {
      expect(coerceFieldValue(f, "2026-07-21")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "2026-07-21T04:30:00")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "yesterday")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, 1721536200)).toMatchObject({ ok: false });
    });
  });

  describe("date", () => {
    const f = field({ name: "day", type: FieldType.date });

    it("accepts valid YYYY-MM-DD", () => {
      expect(coerceFieldValue(f, "2026-07-21")).toEqual({ ok: true, value: "2026-07-21" });
      expect(coerceFieldValue(f, "2024-02-29")).toMatchObject({ ok: true }); // leap day
    });

    it("rejects impossible dates and other shapes", () => {
      expect(coerceFieldValue(f, "2026-02-30")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "2026-13-01")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "2023-02-29")).toMatchObject({ ok: false }); // not a leap year
      expect(coerceFieldValue(f, "21-07-2026")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "2026-7-1")).toMatchObject({ ok: false }); // unpadded
    });
  });

  describe("time", () => {
    const f = field({ name: "slot", type: FieldType.time });

    it("canonicalizes HH:MM to HH:MM:SS", () => {
      expect(coerceFieldValue(f, "09:30")).toEqual({ ok: true, value: "09:30:00" });
    });

    it("passes HH:MM:SS through", () => {
      expect(coerceFieldValue(f, "23:59:59")).toEqual({ ok: true, value: "23:59:59" });
    });

    it("rejects unpadded, out-of-range, and garbage input", () => {
      expect(coerceFieldValue(f, "9:30")).toMatchObject({ ok: false }); // unpadded
      expect(coerceFieldValue(f, "24:00")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "12:60")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "12:00:60")).toMatchObject({ ok: false });
      expect(coerceFieldValue(f, "noon")).toMatchObject({ ok: false });
    });
  });

  describe("json", () => {
    it("passes any JSON value through untouched", () => {
      const f = field({ type: FieldType.json });
      const nested = { a: [1, "two", { three: true }] };
      expect(coerceFieldValue(f, nested)).toEqual({ ok: true, value: nested });
      expect(coerceFieldValue(f, [1, 2])).toMatchObject({ ok: true });
      expect(coerceFieldValue(f, "plain")).toMatchObject({ ok: true });
    });
  });

  it("rejects unspecified field types", () => {
    expect(
      coerceFieldValue(field({ type: FieldType.field_type_unspecified }), "x"),
    ).toMatchObject({ ok: false });
  });
});

describe("formatFieldValue", () => {
  it("renders null/undefined as empty", () => {
    expect(formatFieldValue(FieldType.string, null)).toBe("");
    expect(formatFieldValue(FieldType.integer, undefined)).toBe("");
  });

  it("trims the stored timestamp's zero fraction", () => {
    expect(formatFieldValue(FieldType.timestamp, "2026-07-21T04:30:00.000000000Z")).toBe(
      "2026-07-21T04:30:00Z",
    );
    // Non-zero fractions carry information and stay.
    expect(formatFieldValue(FieldType.timestamp, "2026-07-21T04:30:00.500000000Z")).toBe(
      "2026-07-21T04:30:00.500000000Z",
    );
  });

  it("stringifies json values compactly", () => {
    expect(formatFieldValue(FieldType.json, { a: 1 })).toBe('{"a":1}');
  });

  it("renders scalars canonically", () => {
    expect(formatFieldValue(FieldType.bool, true)).toBe("true");
    expect(formatFieldValue(FieldType.integer, 42)).toBe("42");
    expect(formatFieldValue(FieldType.date, "2026-07-21")).toBe("2026-07-21");
  });

  it("formats system timestamps the same way", () => {
    expect(formatSystemTimestamp("2026-07-21T04:30:00.000000000Z")).toBe(
      "2026-07-21T04:30:00Z",
    );
  });
});

describe("operator matrix", () => {
  it("string fields get equality operators", () => {
    expect(operatorsForField(field({ type: FieldType.string, required: true }))).toEqual([
      RecordConditionOp.eq,
      RecordConditionOp.neq,
      RecordConditionOp.is_in,
      RecordConditionOp.not_in,
    ]);
  });

  it("bool fields get eq/neq only", () => {
    expect(operatorsForField(field({ type: FieldType.bool, required: true }))).toEqual([
      RecordConditionOp.eq,
      RecordConditionOp.neq,
    ]);
  });

  it("numeric and temporal fields get range operators", () => {
    for (const type of [
      FieldType.integer,
      FieldType.number,
      FieldType.timestamp,
      FieldType.date,
      FieldType.time,
    ]) {
      expect(operatorsForField(field({ type, required: true }))).toEqual([
        RecordConditionOp.eq,
        RecordConditionOp.neq,
        RecordConditionOp.gt,
        RecordConditionOp.gte,
        RecordConditionOp.lt,
        RecordConditionOp.lte,
      ]);
    }
  });

  it("json fields are not filterable — even optional ones get no null tests", () => {
    expect(operatorsForField(field({ type: FieldType.json }))).toEqual([]);
  });

  it("optional fields additionally get null tests", () => {
    const ops = operatorsForField(field({ type: FieldType.string, required: false }));
    expect(ops).toContain(RecordConditionOp.is_null);
    expect(ops).toContain(RecordConditionOp.not_null);
  });

  it("required fields never get null tests", () => {
    const ops = operatorsForField(field({ type: FieldType.string, required: true }));
    expect(ops).not.toContain(RecordConditionOp.is_null);
    expect(ops).not.toContain(RecordConditionOp.not_null);
  });

  it("system fields mirror the server matrix", () => {
    expect(SYSTEM_FIELD_OPERATORS.get("id")).toEqual([
      RecordConditionOp.eq,
      RecordConditionOp.is_in,
    ]);
    expect(SYSTEM_FIELD_OPERATORS.get("created_at")).toEqual([
      RecordConditionOp.gt,
      RecordConditionOp.gte,
      RecordConditionOp.lt,
      RecordConditionOp.lte,
    ]);
    expect(SYSTEM_FIELD_OPERATORS.get("updated_at")).toEqual(
      SYSTEM_FIELD_OPERATORS.get("created_at"),
    );
    // Not filterable: attribution and ambient scope.
    expect(SYSTEM_FIELD_OPERATORS.has("created_by")).toBe(false);
    expect(SYSTEM_FIELD_OPERATORS.has("org")).toBe(false);
    expect(SYSTEM_FIELD_OPERATORS.has("partition")).toBe(false);
  });

  it("classifies operator arity", () => {
    expect(isValuelessOperator(RecordConditionOp.is_null)).toBe(true);
    expect(isValuelessOperator(RecordConditionOp.not_null)).toBe(true);
    expect(isValuelessOperator(RecordConditionOp.eq)).toBe(false);
    expect(isListOperator(RecordConditionOp.is_in)).toBe(true);
    expect(isListOperator(RecordConditionOp.not_in)).toBe(true);
    expect(isListOperator(RecordConditionOp.eq)).toBe(false);
  });
});

describe("isSortableField", () => {
  it("declared non-json fields sort; json does not", () => {
    expect(isSortableField(field({ type: FieldType.date }))).toBe(true);
    expect(isSortableField(field({ type: FieldType.string }))).toBe(true);
    expect(isSortableField(field({ type: FieldType.json }))).toBe(false);
    expect(isSortableField(field({ type: FieldType.field_type_unspecified }))).toBe(false);
  });
});

describe("buildUpdateFields", () => {
  it("carries dirty values and explicit nulls, omits untouched fields", () => {
    const payload = buildUpdateFields(
      new Map<string, string | null>([
        ["patient_phone", "+15550100"],
        ["notes", null],
      ]),
    );
    expect(payload).toEqual({ patient_phone: "+15550100", notes: null });
    expect("slot_time" in payload).toBe(false);
  });

  it("produces an empty object for no edits", () => {
    expect(buildUpdateFields(new Map())).toEqual({});
  });
});

describe("RESERVED_FIELD_NAMES", () => {
  it("matches the server's reserved set", () => {
    expect([...RESERVED_FIELD_NAMES].sort()).toEqual([
      "created_at",
      "created_by",
      "id",
      "org",
      "partition",
      "updated_at",
    ]);
  });
});
