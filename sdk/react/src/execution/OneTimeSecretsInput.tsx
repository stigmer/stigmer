"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { UseOneTimeSecretsReturn } from "./useOneTimeSecrets";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";

export interface OneTimeSecretsInputProps {
  /** Hook instance returned by {@link useOneTimeSecrets}. */
  readonly secrets: UseOneTimeSecretsReturn;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Compact key-value editor for one-time execution-scoped secrets.
 *
 * Designed to render inside a popover within {@link SessionComposer}.
 * Each entry collects a variable name, value, and secret toggle.
 * Values are never persisted — they exist for a single execution only.
 *
 * This is a **pure presentational component** with no knowledge of
 * sessions, executions, or orchestration. Platform builders can use
 * it standalone with {@link useOneTimeSecrets} for custom UIs.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * const secrets = useOneTimeSecrets();
 *
 * <OneTimeSecretsInput secrets={secrets} />
 * ```
 */
export function OneTimeSecretsInput({
  secrets,
  disabled = false,
  className,
}: OneTimeSecretsInputProps) {
  const entries = useScrollShadows();

  const duplicateKeys = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const entry of secrets.entries) {
      const k = entry.key.trim();
      if (k === "") continue;
      if (seen.has(k)) dupes.add(k);
      seen.add(k);
    }
    return dupes;
  }, [secrets.entries]);

  return (
    <div
      className={cn("w-80 space-y-3", className)}
      aria-label="One-time execution secrets"
    >
      {/* Header */}
      <div className="space-y-0.5">
        <h3 className="text-xs font-medium text-foreground">
          One-time secrets
        </h3>
        <p className="text-[0.65rem] text-muted-foreground">
          These values exist for this execution only.
        </p>
      </div>

      {/* Entries */}
      {secrets.entries.length > 0 ? (
        <div className="relative">
          {entries.canScrollUp && <ScrollFade position="top" />}

          <div ref={entries.scrollRef} className="max-h-64 space-y-2.5 overflow-y-auto">
            {secrets.entries.map((entry) => {
              const isDuplicate = duplicateKeys.has(entry.key.trim());

              return (
                <SecretEntryRow
                  key={entry.id}
                  id={entry.id}
                  entryKey={entry.key}
                  value={entry.value}
                  isSecret={entry.isSecret}
                  isDuplicate={isDuplicate}
                  disabled={disabled}
                  onUpdate={secrets.updateEntry}
                  onRemove={secrets.removeEntry}
                />
              );
            })}
          </div>

          {entries.canScrollDown && <ScrollFade position="bottom" />}
        </div>
      ) : (
        <p className="py-2 text-center text-[0.65rem] text-muted-foreground/70">
          No secrets attached.
        </p>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={secrets.addEntry}
        disabled={disabled}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs",
          "border border-dashed border-border text-muted-foreground",
          "hover:border-border hover:bg-accent/50 hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <PlusIcon />
        <span>Add variable</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function SecretEntryRow({
  id,
  entryKey,
  value,
  isSecret,
  isDuplicate,
  disabled,
  onUpdate,
  onRemove,
}: {
  id: string;
  entryKey: string;
  value: string;
  isSecret: boolean;
  isDuplicate: boolean;
  disabled: boolean;
  onUpdate: UseOneTimeSecretsReturn["updateEntry"];
  onRemove: UseOneTimeSecretsReturn["removeEntry"];
}) {
  const keyInputId = `stgm-ots-key-${id}`;
  const valInputId = `stgm-ots-val-${id}`;
  const removeLabel = entryKey.trim() || "entry";

  return (
    <div className="space-y-1.5">
      {/* Key row */}
      <div className="flex items-center gap-1.5">
        <input
          id={keyInputId}
          type="text"
          value={entryKey}
          onChange={(e) => onUpdate(id, { key: e.target.value })}
          disabled={disabled}
          placeholder="VARIABLE_NAME"
          autoComplete="off"
          spellCheck={false}
          aria-label="Variable name"
          className={cn(
            "min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground",
            "placeholder:text-muted-foreground/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            isDuplicate && "border-warning",
          )}
        />

        <SecretToggle
          checked={isSecret}
          disabled={disabled}
          onChange={(v) => onUpdate(id, { isSecret: v })}
        />

        <button
          type="button"
          onClick={() => onRemove(id)}
          disabled={disabled}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Remove ${removeLabel}`}
        >
          <XIcon />
        </button>
      </div>

      {/* Value row */}
      <div className="relative">
        <input
          id={valInputId}
          type={isSecret ? "password" : "text"}
          value={value}
          onChange={(e) => onUpdate(id, { value: e.target.value })}
          disabled={disabled}
          placeholder={isSecret ? "••••••••" : "value"}
          autoComplete="off"
          aria-label={`Variable value${entryKey.trim() ? ` for ${entryKey.trim()}` : ""}`}
          className={cn(
            "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
            "placeholder:text-muted-foreground/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      </div>

      {/* Duplicate warning */}
      {isDuplicate && (
        <p className="text-[0.6rem] text-warning" role="alert">
          Duplicate key — last value wins.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secret toggle (compact checkbox-style)
// ---------------------------------------------------------------------------

function SecretToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? "Marked as secret" : "Not marked as secret"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[0.55rem] font-medium uppercase tracking-wider transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        checked
          ? "bg-primary/10 text-primary"
          : "bg-muted/50 text-muted-foreground hover:bg-muted",
      )}
    >
      <LockIcon />
      <span>{checked ? "secret" : "plain"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="10" height="7" rx="1.5" />
      <path d="M5 8V5a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
