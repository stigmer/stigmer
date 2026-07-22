// Canonical value semantics of declared datastore fields, at the UI
// boundary.
//
// The authoritative implementation lives in the record layer (OSS
// `pkg/domain/datastore/schema` + `records/filter.go`, mirrored
// byte-identically in the cloud Java service — the DD-004 cross-edition
// contract). This module is a client-side PROJECTION of that contract:
// it lets forms fail fast with friendly messages and lets the filter
// builder offer only servable operators. The server remains the
// enforcer — a stale or buggy projection degrades to a clean server
// denial, never a false allow (DD-008 invariant 3).
//
// Canonical encodings (DD-004):
//   - string:    the string itself (enum_values membership checked)
//   - integer:   integral JSON number
//   - number:    JSON number
//   - bool:      JSON boolean
//   - timestamp: RFC 3339 UTC, e.g. "2026-07-21T04:30:00Z"
//   - date:      "YYYY-MM-DD" (lexicographically chronological)
//   - time:      "HH:MM:SS" zero-padded ("HH:MM" input canonicalized)
//   - json:      any JSON value, stored as-is
//
// google.protobuf.Struct fields are plain `JsonObject` values in
// protobuf-es v2, so record payloads need no proto conversion — the
// entire client-side value story is validation + canonicalization of
// these JSON shapes.

import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import {
  FieldType,
  type FieldDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { RecordConditionOp } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";

/**
 * Record-envelope system field names (plus the cloud tenancy column and
 * the DD-010 partition label). Never declarable, never caller-writable.
 */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "org",
  "partition",
]);

/** Result of {@link coerceFieldValue}: a canonical value or a field-level message. */
export type CoerceResult =
  | { readonly ok: true; readonly value: JsonValue | null }
  | { readonly ok: false; readonly error: string };

const ok = (value: JsonValue | null): CoerceResult => ({ ok: true, value });
const fail = (error: string): CoerceResult => ({ ok: false, error });

// Zero-padded HH:MM or HH:MM:SS with valid ranges (mirrors the Go
// canonicalizeTime, which rejects unpadded input).
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// RFC 3339 date-time: requires the "T" separator and an explicit UTC
// "Z" or numeric offset — the same shape Go's time.RFC3339Nano accepts.
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Validate a caller-supplied field value against its declaration and
 * return the canonical JSON encoding (see module doc). `null` means
 * explicit null — valid here for any field; required-ness is write-path
 * policy (updates only see the supplied subset), exactly as in the
 * server's CanonicalizeValue.
 *
 * Error messages match the server's shape (`field "x" must be …`) so a
 * client-side rejection reads the same as the server rejection it
 * pre-empts.
 */
export function coerceFieldValue(
  field: FieldDeclaration,
  value: JsonValue | null,
): CoerceResult {
  if (value === null) return ok(null);
  const name = field.name;

  switch (field.type) {
    case FieldType.string: {
      if (typeof value !== "string") return fail(`field "${name}" must be a string`);
      const enums = field.enumValues;
      if (enums.length > 0 && !enums.includes(value)) {
        return fail(`field "${name}" must be one of [${enums.join(" ")}]`);
      }
      return ok(value);
    }

    case FieldType.integer: {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return fail(`field "${name}" must be an integer`);
      }
      // int64 on the server; reject values JS cannot carry exactly
      // rather than silently submitting a rounded number.
      if (!Number.isSafeInteger(value)) {
        return fail(`field "${name}" is too large to represent exactly`);
      }
      return ok(value);
    }

    case FieldType.number: {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(`field "${name}" must be a number`);
      }
      return ok(value);
    }

    case FieldType.bool: {
      if (typeof value !== "boolean") return fail(`field "${name}" must be a boolean`);
      return ok(value);
    }

    case FieldType.timestamp: {
      if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
        return fail(
          `field "${name}" must be an RFC 3339 timestamp (e.g. 2026-07-21T04:30:00Z)`,
        );
      }
      // The server canonicalizes to UTC on write; submitting the parsed
      // RFC 3339 value as-is (offset included) is valid input.
      return ok(value);
    }

    case FieldType.date: {
      if (typeof value !== "string" || !isValidCalendarDate(value)) {
        return fail(`field "${name}" must be a valid YYYY-MM-DD date`);
      }
      return ok(value);
    }

    case FieldType.time: {
      if (typeof value !== "string") {
        return fail(`field "${name}" must be an HH:MM[:SS] time string`);
      }
      const m = TIME_RE.exec(value);
      if (!m) {
        return fail(`field "${name}" must be a valid zero-padded HH:MM[:SS] time`);
      }
      // Canonicalize HH:MM → HH:MM:SS so values compare lexicographically.
      return ok(m[3] === undefined ? `${value}:00` : value);
    }

    case FieldType.json:
      return ok(value);

    default:
      return fail(`field "${name}" has an unsupported type`);
  }
}

/** Whether a YYYY-MM-DD string names a real calendar date (rejects 2026-02-30). */
function isValidCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

/**
 * Format a canonical field value for grid-cell display. Values render
 * in their DD-004 canonical encodings (honest, timezone-free); the one
 * concession to readability is trimming a timestamp's zero fractional
 * seconds (storage pads to nine digits for lexicographic ordering —
 * "…T04:30:00.000000000Z" and "…T04:30:00Z" are the same RFC 3339 UTC
 * instant).
 */
export function formatFieldValue(
  type: FieldType,
  value: JsonValue | null | undefined,
): string {
  if (value === null || value === undefined) return "";

  switch (type) {
    case FieldType.timestamp:
      return typeof value === "string" ? trimZeroFraction(value) : String(value);
    case FieldType.json:
      return JSON.stringify(value);
    case FieldType.bool:
      return value === true ? "true" : "false";
    default:
      return String(value);
  }
}

/** Also used for the envelope's created_at/updated_at system columns. */
export function formatSystemTimestamp(value: string): string {
  return trimZeroFraction(value);
}

function trimZeroFraction(ts: string): string {
  return ts.replace(/\.0+Z$/, "Z");
}

/**
 * The per-type operator matrix (record_io.proto @internal, DD-005 SD-2)
 * — a projection of the server's opsForFieldType. The filter builder
 * offers exactly these, making an unservable operator structurally
 * unofferable (DD-008 invariant 2):
 *
 *   string (incl. enum):   eq, neq, is_in, not_in
 *   bool:                  eq, neq
 *   integer, number,
 *   timestamp, date, time: eq, neq, gt, gte, lt, lte
 *   json:                  not filterable
 *   + is_null / not_null on any optional (non-required) field
 */
export function operatorsForField(field: FieldDeclaration): RecordConditionOp[] {
  const base = baseOperatorsForType(field.type);
  if (base.length === 0) return [];
  return field.required
    ? base
    : [...base, RecordConditionOp.is_null, RecordConditionOp.not_null];
}

function baseOperatorsForType(type: FieldType): RecordConditionOp[] {
  switch (type) {
    case FieldType.string:
      return [
        RecordConditionOp.eq,
        RecordConditionOp.neq,
        RecordConditionOp.is_in,
        RecordConditionOp.not_in,
      ];
    case FieldType.bool:
      return [RecordConditionOp.eq, RecordConditionOp.neq];
    case FieldType.integer:
    case FieldType.number:
    case FieldType.timestamp:
    case FieldType.date:
    case FieldType.time:
      return [
        RecordConditionOp.eq,
        RecordConditionOp.neq,
        RecordConditionOp.gt,
        RecordConditionOp.gte,
        RecordConditionOp.lt,
        RecordConditionOp.lte,
      ];
    default:
      // json (and unspecified) are not filterable.
      return [];
  }
}

/**
 * The filterable system fields and their operator sets (mirrors the
 * server's buildSystemCondition): `id` by identity, the audit
 * timestamps by range. `created_by`, `org`, and `partition` are not
 * filterable — attribution is the grant system's privacy boundary and
 * partition is ambient scope, never data.
 */
export const SYSTEM_FIELD_OPERATORS: ReadonlyMap<string, readonly RecordConditionOp[]> =
  new Map([
    ["id", [RecordConditionOp.eq, RecordConditionOp.is_in]],
    [
      "created_at",
      [RecordConditionOp.gt, RecordConditionOp.gte, RecordConditionOp.lt, RecordConditionOp.lte],
    ],
    [
      "updated_at",
      [RecordConditionOp.gt, RecordConditionOp.gte, RecordConditionOp.lt, RecordConditionOp.lte],
    ],
  ]);

/** Operators that take no value (null tests). */
export function isValuelessOperator(op: RecordConditionOp): boolean {
  return op === RecordConditionOp.is_null || op === RecordConditionOp.not_null;
}

/** Operators that take a value list (`values`) rather than a scalar. */
export function isListOperator(op: RecordConditionOp): boolean {
  return op === RecordConditionOp.is_in || op === RecordConditionOp.not_in;
}

/**
 * Human labels for the filter builder and chips. `is_in` is displayed
 * as "in" — the proto spelling exists only because `in` is reserved in
 * Java/Python, a substrate detail operators never see.
 */
export const OPERATOR_LABELS: ReadonlyMap<RecordConditionOp, string> = new Map([
  [RecordConditionOp.eq, "="],
  [RecordConditionOp.neq, "≠"],
  [RecordConditionOp.gt, ">"],
  [RecordConditionOp.gte, "≥"],
  [RecordConditionOp.lt, "<"],
  [RecordConditionOp.lte, "≤"],
  [RecordConditionOp.is_in, "in"],
  [RecordConditionOp.not_in, "not in"],
  [RecordConditionOp.is_null, "is empty"],
  [RecordConditionOp.not_null, "is not empty"],
]);

/**
 * Sortable fields: any declared non-json field, plus the system id and
 * audit timestamps (mirrors the server's BuildOrderBy).
 */
export function isSortableField(field: FieldDeclaration): boolean {
  return field.type !== FieldType.json && field.type !== FieldType.field_type_unspecified;
}

/**
 * Build an update payload from per-field edits (DD-005 partial merge).
 * The RPC's tri-state: a key present with a value replaces the field, a
 * key present with `null` explicitly clears it, an absent key leaves
 * the stored value untouched. Callers pass only the dirty fields —
 * cleared ones as `null`.
 */
export function buildUpdateFields(
  edits: ReadonlyMap<string, JsonValue | null>,
): JsonObject {
  const out: JsonObject = {};
  for (const [name, value] of edits) {
    out[name] = value;
  }
  return out;
}
