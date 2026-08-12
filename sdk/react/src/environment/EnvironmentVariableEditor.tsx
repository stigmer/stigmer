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
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
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
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading variables"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-8 stg:animate-pulse stg:rounded"
            style={{ width: `${85 - i * 10}%` }}
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(loadError)}
      </p>
    );
  }

  return (
    <div className={cn("stg:space-y-1", className)}>
      {variables.length === 0 && !showAddForm ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          No variables configured.
        </p>
      ) : (
        <div
          className="stg:divide-border/60 stg:divide-y"
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
              "stg:mt-1 stg:flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:transition-colors",
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
        <div className="stg:flex stg:items-center stg:gap-2 stg:py-2">
          <span className="stg:shrink-0 stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
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
              "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1 stg:font-mono stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
      <div className="stg:group stg:flex stg:items-center stg:gap-3 stg:py-2">
        {/* Key + badge */}
        <div className="stg:flex stg:shrink-0 stg:items-baseline stg:gap-1.5">
          {variable.description ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="stg:font-mono stg:text-xs stg:font-medium stg:text-foreground" />
                }
              >
                {variable.key}
              </TooltipTrigger>
              <TooltipContent side="top">{variable.description}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
              {variable.key}
            </span>
          )}
          {variable.isSecret && (
            <span className="stg:text-[0.55rem] stg:uppercase stg:tracking-wider stg:text-muted-foreground-subtle">
              secret
            </span>
          )}
        </div>

        {/* Value */}
        <span
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:truncate stg:font-mono stg:text-xs",
            variable.isSecret && revealedValue !== null
              ? "stg:text-foreground"
              : "stg:text-muted-foreground",
          )}
        >
          {displayValue}
        </span>

        {/* Actions */}
        {mode === "confirming" ? (
          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
            <span className="stg:text-destructive stg:text-[0.65rem]">Delete?</span>
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
            <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:opacity-0 stg:transition-opacity stg:group-hover:opacity-100 stg:group-focus-within:opacity-100">
              {variable.isSecret && (
                /* Secret reveal is creator-only (can_read_secrets) at every
                   visibility level — org sharing never widens it. Hide the
                   affordance for everyone else instead of offering a button
                   that is guaranteed to fail (error prevention). */
                <PermissionGate
                  resource={{ kind: "environment", id: environmentId }}
                  relation="can_read_secrets"
                >
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
                </PermissionGate>
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
    <form onSubmit={handleSubmit} className="stg:space-y-2 stg:pt-2">
      <div className="stg:flex stg:items-center stg:gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="KEY"
          disabled={isAdding}
          autoFocus
          className={cn(
            "stg:w-40 stg:rounded-md stg:border stg:bg-background stg:px-2 stg:py-1 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            isDuplicate ? "stg:border-amber-500/70" : "stg:border-input",
          )}
        />

        <input
          type={isSecret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          disabled={isAdding}
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
        />

        <label className="stg:flex stg:shrink-0 stg:cursor-pointer stg:items-center stg:gap-1 stg:text-[0.65rem] stg:text-muted-foreground stg:select-none">
          <input
            type="checkbox"
            checked={isSecret}
            onChange={(e) => setIsSecret(e.target.checked)}
            disabled={isAdding}
            className="stg:accent-primary stg:size-3"
          />
          Secret
        </label>
      </div>

      {isDuplicate && (
        <p className="stg:text-[0.65rem] stg:text-amber-600 stg:dark:text-amber-400">
          This key already exists and will be overwritten.
        </p>
      )}

      <RowError error={error} />

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
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
            "stg:rounded-md stg:px-3 stg:py-1 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
    primary: "stg:text-primary stg:hover:text-primary-muted",
    muted: "stg:text-muted-foreground stg:hover:text-foreground",
    "muted-danger": "stg:text-muted-foreground stg:hover:text-destructive",
    danger: "stg:text-destructive stg:hover:text-destructive-muted",
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "stg:rounded stg:p-1 stg:transition-colors stg:disabled:pointer-events-none stg:disabled:opacity-40",
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
    <p className="stg:text-destructive stg:pb-1 stg:text-[0.6rem]" role="alert">
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
