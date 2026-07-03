"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type EnvVarInput } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useUpdateEnvironmentVariables } from "./useUpdateEnvironmentVariables.js";
import { useRemoveEnvironmentVariables } from "./useRemoveEnvironmentVariables.js";
import { useRevealSecretValue } from "./useRevealSecretValue.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link EnvironmentVariableEditor}. */
export interface EnvironmentVariableEditorProps {
  /** The environment resource ID to display and manage variables for. */
  readonly environmentId: string;
  /** When `true`, all mutation controls (edit, delete, add) are hidden. */
  readonly readOnly?: boolean;
  /** Fired after a variable is successfully added or updated. */
  readonly onVariableUpdated?: (key: string) => void;
  /** Fired after a variable is successfully removed. */
  readonly onVariableRemoved?: (key: string) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained component that displays and manages all variables for
 * a single {@link Environment}. Fetches environment data by ID, renders
 * an editable variable list, and commits changes inline per variable.
 *
 * Each variable supports inline editing with immediate save, secret
 * value reveal (30 s auto-clear via `getSecretValue` RPC), and inline
 * delete confirmation. New variables are added via a collapsible form
 * at the bottom of the list.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * Part of the **Environment Flow** — manages persistent credentials
 * stored in Environment resources.
 *
 * Platform builders who need a fully custom UI should use the Layer 1
 * hooks directly ({@link useUpdateEnvironmentVariables},
 * {@link useRemoveEnvironmentVariables}, {@link useRevealSecretValue}).
 *
 * @example
 * ```tsx
 * <EnvironmentVariableEditor environmentId="env-abc123" />
 *
 * <EnvironmentVariableEditor
 *   environmentId={env.metadata.id}
 *   readOnly
 *   className="mt-4"
 * />
 * ```
 */
export function EnvironmentVariableEditor({
  environmentId,
  readOnly = false,
  onVariableUpdated,
  onVariableRemoved,
  className,
}: EnvironmentVariableEditorProps) {
  const stigmer = useStigmer();
  const { updateVariables } = useUpdateEnvironmentVariables();
  const { removeVariables } = useRemoveEnvironmentVariables();

  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const cancelled = { current: false };
    setIsLoading(true);
    setLoadError(null);

    stigmer.environment.get(environmentId).then(
      (result) => {
        if (cancelled.current) return;
        setEnvironment(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setLoadError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [environmentId, stigmer]);

  const variables = useMemo<VariableEntry[]>(() => {
    const data = environment?.spec?.data ?? {};
    return Object.entries(data)
      .map(([key, val]) => ({
        key,
        value: val.value,
        isSecret: val.isSecret,
        description: val.description,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [environment]);

  const handleSave = useCallback(
    async (key: string, input: EnvVarInput): Promise<void> => {
      const updated = await updateVariables({
        environmentId,
        variables: { [key]: input },
      });
      setEnvironment(updated);
      onVariableUpdated?.(key);
    },
    [environmentId, updateVariables, onVariableUpdated],
  );

  const handleRemove = useCallback(
    async (key: string): Promise<void> => {
      const updated = await removeVariables({
        environmentId,
        keys: [key],
      });
      setEnvironment(updated);
      onVariableRemoved?.(key);
    },
    [environmentId, removeVariables, onVariableRemoved],
  );

  const handleAdd = useCallback(
    async (key: string, input: EnvVarInput): Promise<void> => {
      await handleSave(key, input);
      setShowAddForm(false);
    },
    [handleSave],
  );

  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading variables"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="bg-muted-subtle h-8 animate-pulse rounded"
            style={{ width: `${85 - i * 10}%` }}
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(loadError)}
      </p>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {variables.length === 0 && !showAddForm ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No variables configured.
        </p>
      ) : (
        <div
          className="divide-border/60 divide-y"
          role="list"
          aria-label="Environment variables"
        >
          {variables.map((v) => (
            <VariableRow
              key={v.key}
              environmentId={environmentId}
              variable={v}
              readOnly={readOnly}
              onSave={handleSave}
              onDelete={handleRemove}
            />
          ))}
        </div>
      )}

      {!readOnly &&
        (showAddForm ? (
          <AddVariableForm
            onAdd={handleAdd}
            onCancel={() => setShowAddForm(false)}
            existingKeys={variables.map((v) => v.key)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className={cn(
              "mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "transition-colors",
            )}
          >
            <PlusIcon />
            Add variable
          </button>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface VariableEntry {
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// VariableRow
// ---------------------------------------------------------------------------

type RowMode = "idle" | "editing" | "confirming";

function VariableRow({
  environmentId,
  variable,
  readOnly,
  onSave,
  onDelete,
}: {
  environmentId: string;
  variable: VariableEntry;
  readOnly: boolean;
  onSave: (key: string, input: EnvVarInput) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<RowMode>("idle");
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);

  const {
    reveal,
    revealedValue,
    isRevealing,
    error: revealError,
    clearRevealedValue,
  } = useRevealSecretValue();

  const error = mutationError ?? revealError;

  const startEdit = useCallback(() => {
    setEditValue(variable.isSecret ? "" : variable.value);
    setMode("editing");
    setMutationError(null);
  }, [variable.isSecret, variable.value]);

  const cancelEdit = useCallback(() => {
    setMode("idle");
    setEditValue("");
    setMutationError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (variable.isSecret && !editValue.trim()) return;

    setIsSaving(true);
    setMutationError(null);
    try {
      await onSave(variable.key, {
        value: editValue,
        isSecret: variable.isSecret,
        description: variable.description || undefined,
      });
      setMode("idle");
      setEditValue("");
    } catch (err) {
      setMutationError(toError(err));
    } finally {
      setIsSaving(false);
    }
  }, [editValue, variable, onSave]);

  const requestDelete = useCallback(() => {
    setMode("confirming");
    setMutationError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    setIsDeleting(true);
    setMutationError(null);
    try {
      await onDelete(variable.key);
    } catch (err) {
      setMutationError(toError(err));
      setMode("idle");
    } finally {
      setIsDeleting(false);
    }
  }, [variable.key, onDelete]);

  const toggleReveal = useCallback(() => {
    if (revealedValue !== null) {
      clearRevealedValue();
    } else {
      reveal(environmentId, variable.key);
    }
  }, [environmentId, variable.key, reveal, revealedValue, clearRevealedValue]);

  const displayValue = variable.isSecret
    ? (revealedValue ?? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
    : (variable.value || "\u2014");

  // --- Edit mode ---
  if (mode === "editing") {
    return (
      <div role="listitem">
        <div className="flex items-center gap-2 py-2">
          <span className="shrink-0 font-mono text-xs font-medium text-foreground">
            {variable.key}
          </span>

          <input
            type={variable.isSecret ? "password" : "text"}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            disabled={isSaving}
            placeholder={variable.isSecret ? "Enter new value" : "Value"}
            autoFocus
            className={cn(
              "min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") cancelEdit();
            }}
          />

          <ActionButton
            onClick={handleSave}
            disabled={isSaving || (variable.isSecret && !editValue.trim())}
            label="Save"
            variant="primary"
          >
            {isSaving ? <SpinnerIcon /> : <CheckIcon />}
          </ActionButton>

          <ActionButton
            onClick={cancelEdit}
            disabled={isSaving}
            label="Cancel"
            variant="muted"
          >
            <XIcon />
          </ActionButton>
        </div>

        <RowError error={error} />
      </div>
    );
  }

  // --- Idle / Confirming mode ---
  return (
    <div role="listitem">
      <div className="group flex items-center gap-3 py-2">
        {/* Key + badge */}
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span
            className="font-mono text-xs font-medium text-foreground"
            title={variable.description || undefined}
          >
            {variable.key}
          </span>
          {variable.isSecret && (
            <span className="text-[0.55rem] uppercase tracking-wider text-muted-foreground-subtle">
              secret
            </span>
          )}
        </div>

        {/* Value */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-xs",
            variable.isSecret && revealedValue !== null
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {displayValue}
        </span>

        {/* Actions */}
        {mode === "confirming" ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-destructive text-[0.65rem]">Delete?</span>
            <ActionButton
              onClick={confirmDelete}
              disabled={isDeleting}
              label="Confirm delete"
              variant="danger"
            >
              {isDeleting ? <SpinnerIcon /> : <CheckIcon />}
            </ActionButton>
            <ActionButton
              onClick={() => setMode("idle")}
              label="Cancel delete"
              variant="muted"
            >
              <XIcon />
            </ActionButton>
          </div>
        ) : (
          !readOnly && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {variable.isSecret && (
                <ActionButton
                  onClick={toggleReveal}
                  disabled={isRevealing}
                  label={
                    revealedValue !== null
                      ? `Hide ${variable.key}`
                      : `Reveal ${variable.key}`
                  }
                  variant="muted"
                >
                  {isRevealing ? (
                    <SpinnerIcon />
                  ) : revealedValue !== null ? (
                    <EyeOffIcon />
                  ) : (
                    <EyeIcon />
                  )}
                </ActionButton>
              )}
              <ActionButton
                onClick={startEdit}
                label={`Edit ${variable.key}`}
                variant="muted"
              >
                <PencilIcon />
              </ActionButton>
              <ActionButton
                onClick={requestDelete}
                label={`Delete ${variable.key}`}
                variant="muted-danger"
              >
                <TrashIcon />
              </ActionButton>
            </div>
          )
        )}
      </div>

      <RowError error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddVariableForm
// ---------------------------------------------------------------------------

function AddVariableForm({
  onAdd,
  onCancel,
  existingKeys,
}: {
  onAdd: (key: string, input: EnvVarInput) => Promise<void>;
  onCancel: () => void;
  existingKeys: readonly string[];
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmedKey = key.trim();
  const isDuplicate = existingKeys.includes(trimmedKey);
  const canSubmit = trimmedKey !== "" && !isAdding;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      setIsAdding(true);
      setError(null);
      try {
        await onAdd(trimmedKey, { value, isSecret });
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsAdding(false);
      }
    },
    [canSubmit, trimmedKey, value, isSecret, onAdd],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-2 pt-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="KEY"
          disabled={isAdding}
          autoFocus
          className={cn(
            "w-40 rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            isDuplicate ? "border-amber-500/70" : "border-input",
          )}
        />

        <input
          type={isSecret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          disabled={isAdding}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
        />

        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[0.65rem] text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={isSecret}
            onChange={(e) => setIsSecret(e.target.checked)}
            disabled={isAdding}
            className="accent-primary size-3"
          />
          Secret
        </label>
      </div>

      {isDuplicate && (
        <p className="text-[0.65rem] text-amber-600 dark:text-amber-400">
          This key already exists and will be overwritten.
        </p>
      )}

      <RowError error={error} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isAdding && <SpinnerIcon />}
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isAdding}
          className={cn(
            "rounded-md px-3 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  label,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  variant: "primary" | "muted" | "muted-danger" | "danger";
  children: React.ReactNode;
}) {
  const colorClass = {
    primary: "text-primary hover:text-primary-muted",
    muted: "text-muted-foreground hover:text-foreground",
    "muted-danger": "text-muted-foreground hover:text-destructive",
    danger: "text-destructive hover:text-destructive-muted",
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "rounded p-1 transition-colors disabled:pointer-events-none disabled:opacity-40",
        colorClass,
      )}
    >
      {children}
    </button>
  );
}

function RowError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="text-destructive pb-1 text-[0.6rem]" role="alert">
      {getUserMessage(error)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs — SDK components avoid icon library dependencies)
// ---------------------------------------------------------------------------

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.59 6.59a2 2 0 0 0 2.82 2.82" />
      <path d="M10.73 10.73A6.5 6.5 0 0 1 8 12.5c-4 0-6.5-4.5-6.5-4.5a11.5 11.5 0 0 1 3.77-3.73" />
      <path d="M5.71 3.56A6.3 6.3 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11.5 11.5 0 0 1-1.28 1.73" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5.5 12.5l-3 .5.5-3 8-8z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h10" />
      <path d="M5.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5" />
      <path d="M4.5 5l.5 8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8" />
      <path d="M6.5 7.5v4M9.5 7.5v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5l3 3 6-6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
