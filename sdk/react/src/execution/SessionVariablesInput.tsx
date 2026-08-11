"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { UseSessionVariablesReturn } from "./useSessionVariables.js";
import { useScrollShadows } from "../internal/useScrollShadows.js";
import { ScrollFade } from "../internal/ScrollFade.js";

/** Props for {@link SessionVariablesInput}. */
export interface SessionVariablesInputProps {
  /** Hook instance returned by {@link useSessionVariables}. */
  readonly sessionVariables: UseSessionVariablesReturn;
  /** Disable all inputs and buttons. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Map of env-var keys to the names of resources that require them.
   *
   * When a session variable's key matches a required key, a subtle
   * "Used by: X" indicator is shown, confirming the cross-link
   * between the variable and the agent/MCP server that needs it.
   *
   * Built by `SessionComposer` from the selected agent's and MCP
   * servers' `env` declarations.
   *
   * @example
   * ```ts
   * { "GITHUB_TOKEN": ["GitHub MCP Server", "Code Reviewer Agent"] }
   * ```
   */
  readonly requiredByMap?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Compact key-value editor for session-scoped environment variables.
 *
 * Designed to render inside a popover within {@link SessionComposer}.
 * Each entry collects a variable name, value, secret toggle, and an
 * optional "save for future" toggle. By default values are ephemeral
 * (single execution); toggling "save for future" persists them to the
 * user's personal environment.
 *
 * This is a **pure presentational component** with no knowledge of
 * sessions, executions, or orchestration. Platform builders can use
 * it standalone with {@link useSessionVariables} for custom UIs.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * const sessionVariables = useSessionVariables();
 *
 * <SessionVariablesInput sessionVariables={sessionVariables} />
 * ```
 */
export function SessionVariablesInput({
  sessionVariables,
  disabled = false,
  className,
  requiredByMap,
}: SessionVariablesInputProps) {
  const entries = useScrollShadows();

  const duplicateKeys = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const entry of sessionVariables.entries) {
      const k = entry.key.trim();
      if (k === "") continue;
      if (seen.has(k)) dupes.add(k);
      seen.add(k);
    }
    return dupes;
  }, [sessionVariables.entries]);

  return (
    <div
      className={cn("stg:w-80 stg:space-y-3", className)}
      aria-label="Session variables"
    >
      {/* Header */}
      <div className="stg:space-y-0.5">
        <h3 className="stg:text-xs stg:font-medium stg:text-foreground">
          Session variables
        </h3>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Additional environment variables for this session.
        </p>
      </div>

      {/* Entries */}
      {sessionVariables.entries.length > 0 ? (
        <div className="stg:relative">
          {entries.canScrollUp && <ScrollFade position="top" />}

          <div ref={entries.scrollRef} className="stg:max-h-64 stg:space-y-2.5 stg:overflow-y-auto">
            {sessionVariables.entries.map((entry) => {
              const isDuplicate = duplicateKeys.has(entry.key.trim());

              return (
                <VariableEntryRow
                  key={entry.id}
                  id={entry.id}
                  entryKey={entry.key}
                  value={entry.value}
                  isSecret={entry.isSecret}
                  saveForFuture={entry.saveForFuture}
                  isDuplicate={isDuplicate}
                  disabled={disabled}
                  onUpdate={sessionVariables.updateEntry}
                  onRemove={sessionVariables.removeEntry}
                  requiredBy={
                    entry.key.trim()
                      ? requiredByMap?.[entry.key.trim()]
                      : undefined
                  }
                />
              );
            })}
          </div>

          {entries.canScrollDown && <ScrollFade position="bottom" />}
        </div>
      ) : (
        <p className="stg:py-2 stg:text-center stg:text-[0.65rem] stg:text-muted-foreground-subtle">
          No variables added.
        </p>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={sessionVariables.addEntry}
        disabled={disabled}
        className={cn(
          "stg:inline-flex stg:w-full stg:items-center stg:justify-center stg:gap-1 stg:rounded-md stg:py-1.5 stg:text-xs",
          "stg:border stg:border-dashed stg:border-border stg:text-muted-foreground",
          "stg:hover:border-border stg:hover:bg-accent-hover stg:hover:text-foreground",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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

function VariableEntryRow({
  id,
  entryKey,
  value,
  isSecret,
  saveForFuture,
  isDuplicate,
  disabled,
  onUpdate,
  onRemove,
  requiredBy,
}: {
  id: string;
  entryKey: string;
  value: string;
  isSecret: boolean;
  saveForFuture: boolean;
  isDuplicate: boolean;
  disabled: boolean;
  onUpdate: UseSessionVariablesReturn["updateEntry"];
  onRemove: UseSessionVariablesReturn["removeEntry"];
  requiredBy?: readonly string[];
}) {
  const keyInputId = `stgm-sv-key-${id}`;
  const valInputId = `stgm-sv-val-${id}`;
  const removeLabel = entryKey.trim() || "entry";

  return (
    <div className="stg:space-y-1.5">
      {/* Key row */}
      <div className="stg:flex stg:items-center stg:gap-1.5">
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
            "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground-faint",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            isDuplicate && "stg:border-warning",
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
          className="stg:shrink-0 stg:rounded stg:p-0.5 stg:text-muted-foreground stg:hover:text-destructive stg:disabled:pointer-events-none stg:disabled:opacity-50"
          aria-label={`Remove ${removeLabel}`}
        >
          <XIcon />
        </button>
      </div>

      {/* Value row */}
      <div className="stg:relative">
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
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground-faint",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
      </div>

      {/* Save-for-future toggle */}
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={saveForFuture}
          aria-label={saveForFuture ? "Saved for future runs" : "Used once only"}
          disabled={disabled}
          onClick={() => onUpdate(id, { saveForFuture: !saveForFuture })}
          className={cn(
            "stg:relative stg:inline-flex stg:h-3.5 stg:w-6 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:transition-colors",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-1",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            saveForFuture ? "stg:bg-primary" : "stg:bg-input",
          )}
        >
          <span
            className={cn(
              "stg:pointer-events-none stg:block stg:h-2.5 stg:w-2.5 stg:translate-y-0.5 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
              saveForFuture ? "stg:translate-x-3" : "stg:translate-x-0.5",
            )}
          />
        </button>
        <span className="stg:text-[0.6rem] stg:text-muted-foreground">
          {saveForFuture ? "Save for future runs" : "This run only"}
        </span>
      </div>

      {/* Required-by indicator */}
      {requiredBy && requiredBy.length > 0 && (
        <p className="stg:text-[0.55rem] stg:text-primary-muted">
          Used by: {requiredBy.join(", ")}
        </p>
      )}

      {/* Duplicate warning */}
      {isDuplicate && (
        <p className="stg:text-[0.6rem] stg:text-warning" role="alert">
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
        "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:rounded-md stg:px-1.5 stg:py-1 stg:text-[0.55rem] stg:font-medium stg:uppercase stg:tracking-wider stg:transition-colors",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        checked
          ? "stg:bg-primary-subtle stg:text-primary"
          : "stg:bg-muted-subtle stg:text-muted-foreground stg:hover:bg-muted",
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
