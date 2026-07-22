"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { getRecordConstraint, getUserMessage } from "@stigmer/sdk";
import type {
  CollectionDeclaration,
  FieldDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import type { RecordEnvelope } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { FieldValueControl } from "./FieldValueControl.js";
import {
  buildUpdateFields,
  coerceFieldValue,
  formatSystemTimestamp,
} from "./recordValues.js";
import { formatSubject } from "./CollectionSchemaView.js";
import { useInsertRecord } from "./useInsertRecord.js";
import { useUpdateRecord } from "./useUpdateRecord.js";
import type { RecordScope } from "./useRecordList.js";

/** Props for {@link RecordFormPanel}. */
export interface RecordFormPanelProps {
  /** Whether the panel is open. */
  readonly open: boolean;
  /** Called when the panel requests to close (Escape, Cancel, or save). */
  readonly onOpenChange: (open: boolean) => void;
  /** Record addressing: org, datastore, collection, partition. */
  readonly scope: RecordScope;
  /** The collection declaration driving the form's typed controls. */
  readonly collection: CollectionDeclaration;
  /**
   * The record to edit, or `null`/`undefined` to insert a new one.
   * Edit submits a partial merge of dirty fields only.
   */
  readonly record?: RecordEnvelope | null;
  /** Called with the server-stamped envelope after a successful save. */
  readonly onSaved?: (envelope: RecordEnvelope) => void;
}

/**
 * Per-field edit state. `unset` distinguishes "never touched" from an
 * explicit clear — the honest projection of the update RPC's tri-state
 * (absent = unchanged, null = clear, value = replace).
 */
type FieldEdit =
  | { readonly kind: "value"; readonly value: JsonValue }
  | { readonly kind: "cleared" };

/**
 * The record write surface (DD-008 SD-4): one schema-generated panel
 * form serving insert and edit, with typed controls dispatched from
 * `FieldDeclaration`.
 *
 * - **Insert** submits every field the operator set; required fields
 *   gate the submit (error prevention — the server remains the
 *   enforcer).
 * - **Edit** submits a **partial merge**: only dirty fields travel, and
 *   the per-field clear affordance sends an explicit `null` — the form
 *   is honest about the RPC's tri-state. System fields render read-only
 *   and never travel.
 * - **Errors replay the DD-002/DD-005 contract for humans**: a
 *   constraint violation renders the declared message **verbatim** —
 *   field-adjacent when the `ErrorInfo` constraint name maps through
 *   the spec to declared fields (unique constraints), as a form-level
 *   banner otherwise. The console operator and the WhatsApp patient
 *   read the same bytes.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function RecordFormPanel({
  open,
  onOpenChange,
  scope,
  collection,
  record,
  onSaved,
}: RecordFormPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = record != null;

  const insert = useInsertRecord();
  const update = useUpdateRecord();
  const isSaving = insert.isInserting || update.isUpdating;

  const [edits, setEdits] = useState<ReadonlyMap<string, FieldEdit>>(new Map());
  const [fieldErrors, setFieldErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Reset form state whenever the panel opens (fresh draft per open).
  // Deps narrowed to the stable clearError callbacks (DD-010).
  const clearInsertError = insert.clearError;
  const clearUpdateError = update.clearError;
  useEffect(() => {
    if (open) {
      setEdits(new Map());
      setFieldErrors(new Map());
      setBannerError(null);
      clearInsertError();
      clearUpdateError();
    }
  }, [open, record?.id, clearInsertError, clearUpdateError]);

  // Native <dialog> open/close sync (the ConfirmDialog pattern).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  /** The effective value a field's control shows: edit > stored > empty. */
  const effectiveValue = useCallback(
    (field: FieldDeclaration): JsonValue | undefined => {
      const edit = edits.get(field.name);
      if (edit) return edit.kind === "cleared" ? undefined : edit.value;
      if (isEdit) {
        const stored = record?.fields?.[field.name];
        return stored === null ? undefined : stored;
      }
      return undefined;
    },
    [edits, isEdit, record],
  );

  const setFieldValue = useCallback((name: string, value: JsonValue | undefined) => {
    setEdits((prev) => {
      const next = new Map(prev);
      if (value === undefined) {
        // Emptying the control: in insert mode the field simply won't
        // travel; in edit mode an emptied control is an explicit clear.
        next.set(name, { kind: "cleared" });
      } else {
        next.set(name, { kind: "value", value });
      }
      return next;
    });
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const clearField = useCallback((name: string) => {
    setEdits((prev) => new Map(prev).set(name, { kind: "cleared" }));
  }, []);

  // Required fields gate the submit in insert mode (error prevention).
  const missingRequired = useMemo(() => {
    if (isEdit) return [];
    return collection.fields
      .filter((f) => f.required && f.default === undefined)
      .filter((f) => {
        const edit = edits.get(f.name);
        return !edit || edit.kind === "cleared";
      })
      .map((f) => f.name);
  }, [collection, edits, isEdit]);

  const handleSubmit = useCallback(async () => {
    setBannerError(null);

    // Client-side coercion (a projection of the server contract): fail
    // fast with field-adjacent messages; the server stays the enforcer.
    const coerced = new Map<string, JsonValue | null>();
    const errors = new Map<string, string>();
    for (const field of collection.fields) {
      const edit = edits.get(field.name);
      if (!edit) continue;
      if (edit.kind === "cleared") {
        if (isEdit) coerced.set(field.name, null);
        continue;
      }
      const result = coerceFieldValue(field, edit.value);
      if (result.ok) {
        coerced.set(field.name, result.value);
      } else {
        errors.set(field.name, result.error);
      }
    }
    if (errors.size > 0) {
      setFieldErrors(errors);
      return;
    }

    try {
      let saved: RecordEnvelope;
      if (isEdit) {
        if (coerced.size === 0) {
          onOpenChange(false); // nothing dirty — an honest no-op
          return;
        }
        saved = await update.updateRecord({
          ...scope,
          id: record.id,
          fields: buildUpdateFields(coerced),
        });
      } else {
        const payload: JsonObject = {};
        for (const [name, value] of coerced) {
          if (value !== null) payload[name] = value;
        }
        saved = await insert.insertRecord({ ...scope, record: payload });
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      placeServerError(err, collection, setFieldErrors, setBannerError);
    }
  }, [collection, edits, isEdit, record, scope, insert, update, onSaved, onOpenChange]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      aria-label={
        isEdit
          ? `Edit record in ${collection.name}`
          : `Insert record into ${collection.name}`
      }
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-md rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-6">
        <h3 className="text-base font-semibold text-foreground">
          {isEdit ? "Edit record" : "Insert record"}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {collection.name}
          </span>
        </h3>

        {bannerError && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-card px-3 py-2 text-sm text-destructive"
          >
            {bannerError}
          </div>
        )}

        {isEdit && record && <SystemFieldsSummary record={record} />}

        <div className="flex flex-col gap-3">
          {collection.fields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              value={effectiveValue(field)}
              error={fieldErrors.get(field.name)}
              isEdit={isEdit}
              cleared={edits.get(field.name)?.kind === "cleared"}
              onChange={(v) => setFieldValue(field.name, v)}
              onClear={() => clearField(field.name)}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          {missingRequired.length > 0 && (
            <span className="mr-auto text-xs text-muted-foreground">
              Required: {missingRequired.join(", ")}
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || missingRequired.length > 0}
            className={cn(
              "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground",
              "hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isSaving ? "Saving…" : isEdit ? "Save changes" : "Insert"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Server-error placement (DD-008 SD-4)
// ---------------------------------------------------------------------------

/**
 * Place a record-write error: field-adjacent when the ErrorInfo
 * constraint name maps to a unique constraint's declared fields, a
 * form-level banner otherwise. Either way the message is the server's
 * bytes, verbatim.
 */
function placeServerError(
  err: unknown,
  collection: CollectionDeclaration,
  setFieldErrors: (errors: ReadonlyMap<string, string>) => void,
  setBannerError: (message: string) => void,
): void {
  const message = getUserMessage(err);
  const constraintName = getRecordConstraint(err);
  if (constraintName) {
    const unique = collection.uniques.find((u) => u.name === constraintName);
    if (unique && unique.fields.length > 0) {
      setFieldErrors(new Map(unique.fields.map((f) => [f, message])));
      return;
    }
  }
  setBannerError(message);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  value,
  error,
  isEdit,
  cleared,
  onChange,
  onClear,
}: {
  readonly field: FieldDeclaration;
  readonly value: JsonValue | undefined;
  readonly error: string | undefined;
  readonly isEdit: boolean;
  readonly cleared: boolean;
  readonly onChange: (value: JsonValue | undefined) => void;
  readonly onClear: () => void;
}) {
  const controlId = useId();
  const showClear = isEdit && !field.required && !cleared && value !== undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <label htmlFor={controlId} className="text-xs font-medium text-muted-foreground">
          {field.name}
          {field.required && (
            <span className="text-destructive" aria-label="required">
              {" "}
              *
            </span>
          )}
        </label>
        {showClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${field.name}`}
            className={cn(
              "ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            Clear
          </button>
        )}
        {cleared && (
          <span className="ml-auto text-xs italic text-muted-foreground">
            will be cleared
          </span>
        )}
      </div>
      {field.description && (
        <p className="text-xs leading-tight text-muted-foreground">{field.description}</p>
      )}
      <FieldValueControl id={controlId} field={field} value={value} onChange={onChange} />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Read-only envelope columns shown in edit mode; never editable, never submitted. */
function SystemFieldsSummary({ record }: { readonly record: RecordEnvelope }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted p-3 text-xs">
      <dt className="font-medium text-muted-foreground">id</dt>
      <dd className="truncate font-mono text-foreground">{record.id}</dd>
      <dt className="font-medium text-muted-foreground">created_at</dt>
      <dd className="font-mono text-foreground">
        {record.createdAt
          ? formatSystemTimestamp(timestampDate(record.createdAt).toISOString())
          : ""}
      </dd>
      <dt className="font-medium text-muted-foreground">updated_at</dt>
      <dd className="font-mono text-foreground">
        {record.updatedAt
          ? formatSystemTimestamp(timestampDate(record.updatedAt).toISOString())
          : ""}
      </dd>
      <dt className="font-medium text-muted-foreground">created_by</dt>
      <dd className="truncate font-mono text-foreground">
        {formatSubject(record.createdBy)}
      </dd>
    </dl>
  );
}
