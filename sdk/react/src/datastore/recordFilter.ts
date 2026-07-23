// The records-specific filter model (DD-008 SD-3) — typed 1:1 against
// `RecordConditionOp`.
//
// Deliberately NOT the workbench `FilterDef`/`FilterValue` model: its
// `string | string[]` value shape cannot carry typed values or
// value-less null operators, and its operator set includes `contains`,
// which `findRecords` cannot serve. Welding a server-grammar contract
// onto a client-filter model would couple two contracts that evolve
// independently — so this model mirrors the RPC grammar exactly and can
// express nothing the RPC cannot serve (DD-008 invariant 2).

import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  RecordConditionOp,
  RecordConditionSchema,
  RecordFilterSchema,
  type RecordFilter,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import {
  FieldType,
  type CollectionDeclaration,
  type FieldDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import {
  isListOperator,
  isValuelessOperator,
  OPERATOR_LABELS,
  SYSTEM_FIELD_OPERATORS,
  operatorsForField,
} from "./recordValues.js";

/**
 * One draft condition in the filter builder — the client-side twin of
 * the proto `RecordCondition`, with plain JSON values (converted to
 * `google.protobuf.Value` only at request-build time).
 */
export interface RecordConditionDraft {
  /** Declared field name, or a filterable system field (`id`, `created_at`, `updated_at`). */
  readonly field: string;
  /** Comparison operator — must be admitted by the field's operator set. */
  readonly op: RecordConditionOp;
  /** Scalar comparison value. Absent for `is_null`/`not_null` and list operators. */
  readonly value?: JsonValue;
  /** Comparison values for `is_in`/`not_in`. */
  readonly values?: readonly JsonValue[];
}

/**
 * A field the builder can offer: a declared filterable field or a
 * filterable system field, with the exact operator set the server
 * admits for it.
 */
export interface FilterableField {
  readonly name: string;
  /** The declaration, or `undefined` for system fields. */
  readonly declaration?: FieldDeclaration;
  /** The field type driving the value control (system fields use fixed types). */
  readonly type: FieldType;
  readonly operators: readonly RecordConditionOp[];
}

/**
 * The fields a collection's filter builder offers: declared filterable
 * fields (json is not filterable) followed by the filterable system
 * fields. `id` conditions take string values; the audit timestamps take
 * RFC 3339 timestamps — both ride the `timestamp`/`string` value
 * controls.
 *
 * `readableFields` is the caller's column-level read access from
 * `describeDatastore` (the read verb's `readable_fields`; empty means
 * every field). When restricted, unreadable declared fields are not
 * offered — the server refuses conditions on them (the existence-oracle
 * guard), and the builder must stay structurally unable to express an
 * unservable filter (DD-008 invariant 2). System fields are always
 * readable and always offered.
 */
export function filterableFields(
  collection: CollectionDeclaration,
  readableFields?: readonly string[],
): FilterableField[] {
  const readable =
    readableFields !== undefined && readableFields.length > 0 ? new Set(readableFields) : null;
  const declared: FilterableField[] = [];
  for (const field of collection.fields) {
    const operators = operatorsForField(field);
    if (operators.length === 0) continue; // json — not filterable
    if (readable !== null && !readable.has(field.name)) continue; // not readable under the grant
    declared.push({ name: field.name, declaration: field, type: field.type, operators });
  }
  return [
    ...declared,
    { name: "id", type: FieldType.string, operators: SYSTEM_FIELD_OPERATORS.get("id")! },
    {
      name: "created_at",
      type: FieldType.timestamp,
      operators: SYSTEM_FIELD_OPERATORS.get("created_at")!,
    },
    {
      name: "updated_at",
      type: FieldType.timestamp,
      operators: SYSTEM_FIELD_OPERATORS.get("updated_at")!,
    },
  ];
}

/**
 * Whether a draft is complete enough to serve: value-less operators
 * need nothing, list operators need at least one value, scalar
 * operators need a value.
 */
export function isConditionComplete(draft: RecordConditionDraft): boolean {
  if (draft.op === RecordConditionOp.record_condition_op_unspecified) return false;
  if (isValuelessOperator(draft.op)) return true;
  if (isListOperator(draft.op)) return (draft.values?.length ?? 0) > 0;
  return draft.value !== undefined;
}

/**
 * Build the proto `RecordFilter` from complete drafts. Returns
 * `undefined` for an empty set (an absent filter, not an empty one, is
 * the RPC's "no filter").
 */
export function buildRecordFilter(
  conditions: readonly RecordConditionDraft[],
): RecordFilter | undefined {
  const complete = conditions.filter(isConditionComplete);
  if (complete.length === 0) return undefined;
  return create(RecordFilterSchema, {
    conditions: complete.map((draft) =>
      create(RecordConditionSchema, {
        field: draft.field,
        op: draft.op,
        value: draft.value !== undefined ? fromJson(ValueSchema, draft.value) : undefined,
        values: (draft.values ?? []).map((v) => fromJson(ValueSchema, v)),
      }),
    ),
  });
}

/** Chip text for an active condition, e.g. `status = confirmed` or `notes is empty`. */
export function formatConditionChip(draft: RecordConditionDraft): string {
  const op = OPERATOR_LABELS.get(draft.op) ?? "?";
  if (isValuelessOperator(draft.op)) return `${draft.field} ${op}`;
  if (isListOperator(draft.op)) {
    return `${draft.field} ${op} [${(draft.values ?? []).map(formatChipValue).join(", ")}]`;
  }
  return `${draft.field} ${op} ${formatChipValue(draft.value)}`;
}

function formatChipValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}
