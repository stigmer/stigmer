"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { Popover } from "@base-ui/react/popover";
import { create, type JsonValue } from "@bufbuild/protobuf";
import { RecordConditionOp } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import {
  FieldDeclarationSchema,
  type CollectionDeclaration,
  type FieldDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { useStigmerPortalContainer } from "../portal-container.js";
import { FIELD_INPUT_CLASSES, FieldValueControl } from "./FieldValueControl.js";
import {
  filterableFields,
  formatConditionChip,
  isConditionComplete,
  type FilterableField,
  type RecordConditionDraft,
} from "./recordFilter.js";
import {
  isListOperator,
  isValuelessOperator,
  OPERATOR_LABELS,
} from "./recordValues.js";

/** Props for {@link RecordFilterBuilder}. */
export interface RecordFilterBuilderProps {
  /** The collection whose declared schema drives fields and operators. */
  readonly collection: CollectionDeclaration;
  /**
   * The caller's readable fields from `describeDatastore` (the read
   * verb's `readable_fields`). Empty or omitted means every field.
   * When restricted, unreadable fields are not offered — the server
   * refuses conditions on them.
   */
  readonly readableFields?: readonly string[];
  /** Active conditions (AND-combined, per the DD-005 grammar). */
  readonly conditions: readonly RecordConditionDraft[];
  /** Called with the full condition set on add/remove/clear. */
  readonly onChange: (conditions: readonly RecordConditionDraft[]) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Schema-aware filter builder for the records browser (DD-008 SD-3):
 * active conditions render as removable chips; the "Add filter" popover
 * is draft-then-apply — a condition takes effect only on Apply, so
 * half-built drafts never fire queries.
 *
 * The builder can express nothing `findRecords` cannot serve (DD-008
 * invariant 2): fields come from the declarations plus the filterable
 * system fields, operators from the per-type matrix (an unservable
 * operator is structurally unofferable), and values from the same typed
 * controls the record form uses.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function RecordFilterBuilder({
  collection,
  readableFields,
  conditions,
  onChange,
  className,
}: RecordFilterBuilderProps) {
  const fields = useMemo(
    () => filterableFields(collection, readableFields),
    [collection, readableFields],
  );

  const removeCondition = useCallback(
    (index: number) => onChange(conditions.filter((_, i) => i !== index)),
    [conditions, onChange],
  );

  const addCondition = useCallback(
    (draft: RecordConditionDraft) => onChange([...conditions, draft]),
    [conditions, onChange],
  );

  return (
    <div
      role="toolbar"
      aria-label="Record filters"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {conditions.map((condition, index) => (
        <span
          key={`${condition.field}:${index}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
        >
          {formatConditionChip(condition)}
          <button
            type="button"
            onClick={() => removeCondition(index)}
            aria-label={`Remove filter ${formatConditionChip(condition)}`}
            className={cn(
              "inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <CrossIcon className="size-2.5" />
          </button>
        </span>
      ))}

      <AddFilterPopover fields={fields} onApply={addCondition} />

      {conditions.length > 1 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className={cn(
            "text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The draft-then-apply popover
// ---------------------------------------------------------------------------

function AddFilterPopover({
  fields,
  onApply,
}: {
  readonly fields: readonly FilterableField[];
  readonly onApply: (draft: RecordConditionDraft) => void;
}) {
  const portalContainer = useStigmerPortalContainer();
  const [open, setOpen] = useState(false);

  const [fieldName, setFieldName] = useState("");
  const [op, setOp] = useState<RecordConditionOp>(RecordConditionOp.record_condition_op_unspecified);
  const [value, setValue] = useState<JsonValue | undefined>(undefined);
  const [values, setValues] = useState<readonly JsonValue[]>([]);

  const selected = fields.find((f) => f.name === fieldName);

  const reset = useCallback(() => {
    setFieldName("");
    setOp(RecordConditionOp.record_condition_op_unspecified);
    setValue(undefined);
    setValues([]);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) reset();
    },
    [reset],
  );

  const selectField = useCallback(
    (name: string) => {
      setFieldName(name);
      setOp(RecordConditionOp.record_condition_op_unspecified);
      setValue(undefined);
      setValues([]);
    },
    [],
  );

  const draft: RecordConditionDraft = {
    field: fieldName,
    op,
    value: isListOperator(op) || isValuelessOperator(op) ? undefined : value,
    values: isListOperator(op) ? values : undefined,
  };
  const canApply = fieldName !== "" && isConditionComplete(draft);

  const apply = useCallback(() => {
    // Rebuild from state rather than closing over the render's draft.
    const applied: RecordConditionDraft = {
      field: fieldName,
      op,
      value: isListOperator(op) || isValuelessOperator(op) ? undefined : value,
      values: isListOperator(op) ? values : undefined,
    };
    onApply(applied);
    handleOpenChange(false);
  }, [onApply, handleOpenChange, fieldName, op, value, values]);

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2 py-0.5 text-xs text-muted-foreground",
          "hover:border-ring hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="size-3" />
        Add filter
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            className={cn(
              "z-popover w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md",
              "flex flex-col gap-2",
            )}
          >
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Field
              <select
                className={FIELD_INPUT_CLASSES}
                value={fieldName}
                onChange={(e) => selectField(e.target.value)}
              >
                <option value="">— Select —</option>
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            {selected && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Operator
                <select
                  className={FIELD_INPUT_CLASSES}
                  value={op === RecordConditionOp.record_condition_op_unspecified ? "" : String(op)}
                  onChange={(e) => {
                    setOp(
                      e.target.value === ""
                        ? RecordConditionOp.record_condition_op_unspecified
                        : (Number(e.target.value) as RecordConditionOp),
                    );
                    setValue(undefined);
                    setValues([]);
                  }}
                >
                  <option value="">— Select —</option>
                  {selected.operators.map((o) => (
                    <option key={o} value={o}>
                      {OPERATOR_LABELS.get(o)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selected &&
              op !== RecordConditionOp.record_condition_op_unspecified &&
              !isValuelessOperator(op) &&
              (isListOperator(op) ? (
                <ListValueEditor field={selected} values={values} onChange={setValues} />
              ) : (
                <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Value
                  <FieldValueControl
                    field={controlDeclaration(selected)}
                    value={value}
                    onChange={setValue}
                    aria-label={`Filter value for ${selected.name}`}
                  />
                </div>
              ))}

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className={cn(
                  "rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!canApply}
                className={cn(
                  "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
                  "hover:bg-primary-hover",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                Apply
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The declaration handed to the value control: the declared field
 * itself, or a synthetic declaration for system fields (`id` as string,
 * audit timestamps as timestamp).
 */
function controlDeclaration(field: FilterableField): FieldDeclaration {
  return (
    field.declaration ??
    create(FieldDeclarationSchema, { name: field.name, type: field.type })
  );
}

// ---------------------------------------------------------------------------
// List-value entry for in / not_in
// ---------------------------------------------------------------------------

function ListValueEditor({
  field,
  values,
  onChange,
}: {
  readonly field: FilterableField;
  readonly values: readonly JsonValue[];
  readonly onChange: (values: readonly JsonValue[]) => void;
}) {
  const [pending, setPending] = useState<JsonValue | undefined>(undefined);

  const add = useCallback(() => {
    if (pending === undefined) return;
    onChange([...values, pending]);
    setPending(undefined);
  }, [pending, values, onChange]);

  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      Values
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-foreground"
            >
              {typeof v === "string" ? v : JSON.stringify(v)}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                aria-label={`Remove value ${typeof v === "string" ? v : JSON.stringify(v)}`}
                className="inline-flex size-3 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <CrossIcon className="size-2" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <FieldValueControl
          field={controlDeclaration(field)}
          value={pending}
          onChange={setPending}
          aria-label={`Add filter value for ${field.name}`}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending === undefined}
          className={cn(
            "shrink-0 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — no icon-library dependency)
// ---------------------------------------------------------------------------

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function CrossIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
