"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps, KeyValueRow } from "./types";

/** Props for {@link InlineEditKeyValue}. */
export interface InlineEditKeyValueProps extends InlineEditBaseProps {
  /** Current key-value entries. */
  readonly value: readonly KeyValueRow[];
  /** Called with the updated rows when a change is confirmed. */
  readonly onSave: (rows: KeyValueRow[]) => Promise<boolean>;
  /** Label for the "key" column. @default "Key" */
  readonly keyLabel?: string;
  /** Show the value alongside the key in read mode and provide a value input in edit mode. @default false */
  readonly showValue?: boolean;
  /** Label for the "value" column (only relevant when showValue is true). @default "Value" */
  readonly valueLabel?: string;
  /** Show the "secret" toggle per row. @default false */
  readonly showSecretToggle?: boolean;
  /** Show the "optional" toggle per row. @default false */
  readonly showOptionalToggle?: boolean;
  /** Show the description field per row. @default false */
  readonly showDescription?: boolean;
  /** Controlled editing state. */
  readonly editing?: boolean;
  /** Called when editing state changes (controlled mode). */
  readonly onEditingChange?: (editing: boolean) => void;
}

/**
 * Inline editor for key-value pair lists (env vars, tags, etc.).
 *
 * Read mode shows a compact table. Edit mode adds/removes/edits
 * rows with per-row confirmation. The full updated list is saved
 * when the user clicks "Save changes".
 */
export function InlineEditKeyValue({
  value,
  onSave,
  keyLabel = "Key",
  showValue = false,
  valueLabel = "Value",
  showSecretToggle = false,
  showOptionalToggle = false,
  showDescription = false,
  editing: controlledEditing,
  onEditingChange,
  disabled,
  isSaving,
  error,
  className,
}: InlineEditKeyValueProps) {
  const [internalEditing, setInternalEditing] = useState(false);
  const isEditing = controlledEditing ?? internalEditing;
  const setIsEditing = useCallback(
    (v: boolean) => {
      setInternalEditing(v);
      onEditingChange?.(v);
    },
    [onEditingChange],
  );

  useEffect(() => {
    if (controlledEditing !== undefined) setInternalEditing(controlledEditing);
  }, [controlledEditing]);

  const [draft, setDraft] = useState<KeyValueRow[]>([...value]);

  const handleEdit = useCallback(() => {
    setDraft([...value]);
    setIsEditing(true);
  }, [value, setIsEditing]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft([...value]);
  }, [value, setIsEditing]);

  const handleSave = useCallback(async () => {
    const filtered = draft.filter((r) => r.key.trim());
    const ok = await onSave(filtered);
    if (ok) setIsEditing(false);
  }, [draft, onSave, setIsEditing]);

  const updateRow = useCallback((index: number, patch: Partial<KeyValueRow>) => {
    setDraft((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addRow = useCallback(() => {
    setDraft((prev) => [...prev, { key: "", value: "", isSecret: false, description: "" }]);
  }, []);

  if (disabled || !isEditing) {
    return (
      <div className={cn("flex flex-col", className)}>
        {value.length > 0 ? (
          <div className="flex flex-col divide-y divide-border">
            {value.map((row) => (
              <div key={row.key} className="flex items-start gap-3 px-3 py-2.5">
                <code className="shrink-0 font-mono text-sm font-medium text-foreground">
                  {row.key}
                </code>
                {showValue && (
                  <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                    {row.value}
                  </span>
                )}
                {showSecretToggle && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {row.isSecret ? "secret" : "config"}
                  </span>
                )}
                {showOptionalToggle && row.optional && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground-subtle">
                    optional
                  </span>
                )}
                {row.description && (
                  <span className="text-xs text-muted-foreground">{row.description}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground italic">No entries</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {draft.map((row, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-muted-faint p-2.5">
          <div className="flex flex-1 flex-col gap-1.5">
            <input
              type="text"
              value={row.key}
              onChange={(e) => updateRow(i, { key: e.target.value })}
              placeholder={keyLabel}
              className={cn(
                "rounded-md border border-border bg-input-bg px-2 py-1 font-mono text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
            {showValue && (
              <input
                type="text"
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder={valueLabel}
                className={cn(
                  "rounded-md border border-border bg-input-bg px-2 py-1 font-mono text-sm text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            )}
            {showDescription && (
              <input
                type="text"
                value={row.description ?? ""}
                onChange={(e) => updateRow(i, { description: e.target.value })}
                placeholder="Description"
                className={cn(
                  "rounded-md border border-border bg-input-bg px-2 py-1 text-xs text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            )}
            <div className="flex items-center gap-3">
              {showSecretToggle && (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.isSecret ?? false}
                    onChange={(e) => updateRow(i, { isSecret: e.target.checked })}
                    className="size-3.5 rounded border-border"
                  />
                  Secret
                </label>
              )}
              {showOptionalToggle && (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.optional ?? false}
                    onChange={(e) => updateRow(i, { optional: e.target.checked })}
                    className="size-3.5 rounded border-border"
                  />
                  Optional
                </label>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeRow(i)}
            aria-label={`Remove ${row.key || "entry"}`}
            className={cn(
              "mt-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
              "hover:bg-destructive-subtle hover:text-destructive",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium",
          "border border-dashed border-border text-muted-foreground",
          "hover:border-muted-foreground hover:text-foreground hover:bg-muted-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "transition-colors",
        )}
      >
        <PlusIcon className="size-3" />
        Add entry
      </button>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium",
            "border border-border bg-background text-foreground hover:bg-accent",
            "disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {isSaving && <Spinner />}
          Save changes
        </button>
      </div>

      {error && (
        <p className="px-1 text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function TrashIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4M12.667 4v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
